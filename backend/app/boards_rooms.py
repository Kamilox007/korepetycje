"""Live rooms for board pages: in-process state, WebSocket fan-out, periodic save.

One room per open page, keyed by page id. The room holds the merged element
state in memory and is the authority while anyone is connected; the database
is a safety net for restarts, not a sync channel. Consequently uvicorn has to
run a SINGLE worker (documented in README) - with two, people on the same
page would land in two rooms that never meet.

Threading model: all mutation of `rooms` and `Room.elements` happens on the
event loop. Database work is synchronous SQLAlchemy and goes through
`run_in_threadpool` with a short-lived session; a session is never held for
the life of a connection (SQLite has one writer, and a lesson lasts an hour).
"""
import asyncio
import json
import logging
import secrets
from datetime import datetime
from typing import Any

from fastapi import WebSocket
from starlette.concurrency import run_in_threadpool

from . import models, auth, boards_reconcile
from .database import SessionLocal

log = logging.getLogger("uvicorn.error")

# Decision 2.5: a save at most this often per room. A lost 15 s of drawing is
# nothing; a WAL frame every keystroke to Backblaze is not.
SAVE_INTERVAL_SECONDS = 15
FLUSH_TICK_SECONDS = 3
# Bigger than this is not a drawing update.
MAX_MESSAGE_BYTES = 1024 * 1024
MAX_NAME_CHARS = 40

# Close codes (4xxx = application-defined).
CLOSE_NOT_FOUND = 4404      # unknown token, archived board, page gone
CLOSE_TOO_BIG = 4009
CLOSE_BAD_MESSAGE = 4400


class Connection:
    __slots__ = ("ws", "peer_id", "name", "is_owner")

    def __init__(self, ws: WebSocket, is_owner: bool):
        self.ws = ws
        self.peer_id = secrets.token_hex(8)
        self.name = "Gość"
        self.is_owner = is_owner

    def peer(self) -> dict:
        return {"peer_id": self.peer_id, "name": self.name, "is_owner": self.is_owner}


class Room:
    def __init__(self, page_id: int, board_id: int, elements: list[dict], rev: int):
        self.page_id = page_id
        self.board_id = board_id
        self.elements: dict[str, dict] = {e["id"]: e for e in elements}
        self.rev = rev
        self.clients: dict[str, Connection] = {}
        self.dirty = False
        self.last_saved_at = datetime.utcnow()
        self.saving = False

    def snapshot(self) -> list[dict]:
        return boards_reconcile.ordered(self.elements)


rooms: dict[int, Room] = {}
# In production there is exactly one loop. The regression tests nest several
# TestClients (each with its own loop and lifespan), so the flush task is
# tracked per loop and `stop()` only touches the loop it runs on.
_flush_tasks: dict[asyncio.AbstractEventLoop, asyncio.Task] = {}


def _current_loop() -> asyncio.AbstractEventLoop | None:
    """The loop the rooms live on: the most recently started one still running."""
    for loop in reversed(list(_flush_tasks)):
        if not loop.is_closed():
            return loop
    return None


# ---------------------------------------------------------------- lifecycle

def start() -> None:
    """Called from the app lifespan: start the periodic flush on this loop."""
    loop = asyncio.get_running_loop()
    if loop not in _flush_tasks:
        _flush_tasks[loop] = loop.create_task(_flush_forever())


async def stop() -> None:
    """Save every dirty room and drop them all. Called on shutdown."""
    loop = asyncio.get_running_loop()
    task = _flush_tasks.pop(loop, None)
    if task:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass
    for room in list(rooms.values()):
        try:
            await _save(room, force=True)
        except Exception as e:  # noqa: BLE001
            log.warning("tablica: zapis strony %s przy zamykaniu nie powiódł się: %s", room.page_id, e)
    rooms.clear()


async def _flush_forever() -> None:
    """Runs for the life of the process. A failing save (a transient
    "database is locked", say) must not kill this task - the room stays dirty
    and the next tick tries again. Nothing here may raise past this loop."""
    while True:
        await asyncio.sleep(FLUSH_TICK_SECONDS)
        now = datetime.utcnow()
        for room in list(rooms.values()):
            if room.dirty and not room.saving and \
                    (now - room.last_saved_at).total_seconds() >= SAVE_INTERVAL_SECONDS:
                try:
                    await _save(room)
                except Exception as e:  # noqa: BLE001 - logged, retried next tick
                    log.warning("tablica: zapis strony %s nie powiódł się, ponowię: %s", room.page_id, e)


# ---------------------------------------------------------------- persistence

def _load_page(page_id: int) -> tuple[int, list[dict], int] | None:
    db = SessionLocal()
    try:
        page = db.get(models.BoardPage, page_id)
        if not page:
            return None
        return page.board_id, list(page.elements), page.rev
    finally:
        db.close()


def _write_page(page_id: int, elements: list[dict]) -> int | None:
    """Persist the room state. Returns the new rev, or None if the page is gone."""
    db = SessionLocal()
    try:
        page = db.get(models.BoardPage, page_id)
        if not page:
            return None
        _before_save(db, page)
        page.elements = elements
        page.rev += 1
        page.updated_at = auth.utcnow()
        page.board.updated_at = page.updated_at
        db.commit()
        return page.rev
    finally:
        db.close()


def _before_save(db, page: models.BoardPage) -> None:
    """Hook for the daily snapshot rule (boards_snapshots). Bound at import
    time there, so this module does not depend on it."""


def set_before_save_hook(fn) -> None:
    global _before_save
    _before_save = fn


async def _save(room: Room, force: bool = False) -> None:
    if not room.dirty and not force:
        return
    room.saving = True
    try:
        elements = room.snapshot()
        room.dirty = False
        rev = await run_in_threadpool(_write_page, room.page_id, elements)
        if rev is not None:
            room.rev = rev
        room.last_saved_at = datetime.utcnow()
    except Exception:
        # Keep the data for the next tick rather than lose it to a transient
        # "database is locked".
        room.dirty = True
        raise
    finally:
        room.saving = False


def merge_into_db(db, page: models.BoardPage, incoming: list[dict]) -> models.BoardPage:
    """Merge `incoming` into the stored page when NO room is open for it.

    Never a plain overwrite: two people may be saving, and the one with the
    stale copy must not erase the other's work. Callers check
    `merge_from_http` first; with a room open the room is the authority.
    """
    current = {e["id"]: e for e in page.elements}
    changed = boards_reconcile.reconcile(current, incoming)
    if changed:
        _before_save(db, page)
        page.elements = boards_reconcile.ordered(current)
        page.rev += 1
        page.updated_at = auth.utcnow()
        page.board.updated_at = page.updated_at
        db.commit()
        db.refresh(page)
    return page


def _touch_opened(board_id: int) -> None:
    db = SessionLocal()
    try:
        board = db.get(models.Board, board_id)
        if board:
            board.last_opened_at = auth.utcnow()
            db.commit()
    finally:
        db.close()


# ---------------------------------------------------------------- messaging

async def _send(conn: Connection, msg: dict) -> None:
    try:
        await conn.ws.send_text(json.dumps(msg, ensure_ascii=False))
    except Exception:
        # A dead socket is cleaned up by its own handler on the next receive.
        pass


async def _broadcast(room: Room, msg: dict, exclude: Connection | None = None) -> None:
    text = json.dumps(msg, ensure_ascii=False)
    for c in list(room.clients.values()):
        if c is exclude:
            continue
        try:
            await c.ws.send_text(text)
        except Exception:
            pass


async def _send_peers(room: Room, exclude: Connection | None = None) -> None:
    await _broadcast(room, {"t": "peers", "peers": [c.peer() for c in room.clients.values()]},
                     exclude=exclude)


# ---------------------------------------------------------------- room API

async def join(page_id: int, ws: WebSocket, is_owner: bool) -> tuple[Room, Connection] | None:
    """Enter the room for a page, creating it from the database on first entry.
    Returns None if the page no longer exists."""
    room = rooms.get(page_id)
    if room is None:
        loaded = await run_in_threadpool(_load_page, page_id)
        if loaded is None:
            return None
        board_id, elements, rev = loaded
        # Two people connecting at once both miss the dict and both load: the
        # second one must not replace the first room. Re-check after the await.
        room = rooms.get(page_id)
        if room is None:
            room = Room(page_id, board_id, elements, rev)
            rooms[page_id] = room
    conn = Connection(ws, is_owner)
    room.clients[conn.peer_id] = conn
    await _send(conn, {
        "t": "init", "elements": room.snapshot(), "rev": room.rev,
        "peer_id": conn.peer_id, "peers": [c.peer() for c in room.clients.values()],
    })
    # The newcomer already has the list in `init`; only the others need it.
    await _send_peers(room, exclude=conn)
    await run_in_threadpool(_touch_opened, room.board_id)
    return room, conn


async def leave(room: Room, conn: Connection) -> None:
    room.clients.pop(conn.peer_id, None)
    if room.clients:
        await _send_peers(room)
        return
    # Last one out: persist and forget. A room without clients left in the
    # dict is a memory leak that grows with every board ever opened.
    if rooms.get(room.page_id) is room:
        del rooms[room.page_id]
    try:
        await _save(room)
    except Exception as e:  # noqa: BLE001
        # Last chance for this data: put the room back so the flush loop
        # retries instead of the work being dropped with the room.
        log.warning("tablica: zapis strony %s przy wyjściu nie powiódł się, ponowię: %s", room.page_id, e)
        rooms.setdefault(room.page_id, room)


async def apply_update(room: Room, elements: list[dict], sender: Connection | None) -> list[dict]:
    """Merge incoming elements, fan out what changed. Returns the changed list.

    The sender does not get its own update echoed back - except for elements
    that lost the merge, where it receives the winning version so its screen
    matches everyone else's.
    """
    changed = boards_reconcile.reconcile(room.elements, elements)
    if changed:
        room.dirty = True
        await _broadcast(room, {"t": "update", "elements": changed}, exclude=sender)
    if sender is not None:
        accepted = {e["id"] for e in changed}
        lost = []
        for el in elements:
            cur = room.elements.get(el.get("id"))
            if cur is None or el["id"] in accepted:
                continue
            if (cur.get("version"), cur.get("versionNonce")) != (el.get("version"), el.get("versionNonce")):
                lost.append(cur)
        if lost:
            await _send(sender, {"t": "update", "elements": lost})
    return changed


async def apply_pointer(room: Room, conn: Connection, x: Any, y: Any, button: Any) -> None:
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return
    await _broadcast(room, {
        "t": "pointer", "peer_id": conn.peer_id, "x": x, "y": y,
        "button": button if button in ("up", "down") else "up",
    }, exclude=conn)


def clean_name(raw: Any) -> str:
    if not isinstance(raw, str):
        return "Gość"
    name = "".join(ch for ch in raw if ch.isprintable()).strip()[:MAX_NAME_CHARS]
    return name or "Gość"


async def set_name(room: Room, conn: Connection, raw: Any) -> None:
    conn.name = clean_name(raw)
    await _send_peers(room)


async def merge_from_http(page_id: int, elements: list[dict]) -> tuple[int, list[dict]] | None:
    """A PUT while a room is open must go through the room, or the fallback
    save of one person overwrites what the connected ones are drawing.
    Returns (rev, elements) or None when there is no room for this page."""
    room = rooms.get(page_id)
    if room is None:
        return None
    await apply_update(room, elements, sender=None)
    return room.rev, room.snapshot()


async def restore_in_room(page_id: int, snapshot: list[dict]) -> tuple[int, list[dict]] | None:
    """Apply a snapshot to an open room as a winning update (see
    boards_reconcile.restore_update). None when there is no room."""
    room = rooms.get(page_id)
    if room is None:
        return None
    update = boards_reconcile.restore_update(room.elements, snapshot)
    await apply_update(room, update, sender=None)
    # Do not wait for the flush tick: a restore is a deliberate act.
    await _save(room)
    return room.rev, room.snapshot()


async def flush(page_id: int) -> bool:
    """Persist a room now if it is dirty. False when there is no room."""
    room = rooms.get(page_id)
    if room is None:
        return False
    await _save(room)
    return True


async def close_pages(page_ids: list[int], code: int = CLOSE_NOT_FOUND) -> None:
    """Kick everyone out of these rooms (page deleted, board archived, token
    rotated) without saving - the caller has already decided about the data."""
    for page_id in page_ids:
        room = rooms.pop(page_id, None)
        if room is None:
            continue
        for c in list(room.clients.values()):
            try:
                await c.ws.close(code=code)
            except Exception:
                pass
        room.clients.clear()


def close_pages_threadsafe(page_ids: list[int], code: int = CLOSE_NOT_FOUND) -> None:
    """For sync endpoints (panel router): schedule the close on the loop."""
    loop = _current_loop()
    if loop is None or not page_ids:
        return
    asyncio.run_coroutine_threadsafe(close_pages(page_ids, code), loop)


def page_ids_of_board(db, board_id: int) -> list[int]:
    return [row[0] for row in db.query(models.BoardPage.id).filter(models.BoardPage.board_id == board_id)]

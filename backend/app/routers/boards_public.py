"""Link side of the whiteboard: /api/t/{token}, no login.

The token in the path is the whole credential (README, "Decyzje
projektowe"). No endpoint here takes a dependency that resolves a logged-in
user - the owner is detected softly from the session cookie, and a missing
or bad cookie simply means "guest". Keeping this router free of the role
gates is what guarantees a bare link can never reach the rest of the API.

Every failure to find the board answers the same 404: unknown token,
archived board, page of another board. A distinct status would tell a
scanner which tokens exist.
"""
import json
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import models, schemas, auth, boards_reconcile, boards_rooms
from ..database import get_db, SessionLocal
from ..ratelimit import limiter
from .boards import is_staff

router = APIRouter(prefix="/api/t", tags=["boards-public"])

# Loose on purpose: behind Caddy this is effectively a global budget, not a
# per-IP one (see ratelimit.py). A few parallel lessons with images must fit.
LIMIT_READ = "300/minute"
LIMIT_WRITE = "120/minute"

# A scene page bigger than this is not a drawing, it is an attack on the
# database (base64 in disguise, or a runaway client).
MAX_PAGE_BYTES = 1024 * 1024

NOT_FOUND = "Tablica nie znaleziona"


def board_by_token(db: Session, token: str) -> models.Board:
    board = (
        db.query(models.Board)
        .filter(models.Board.token == token, models.Board.archived_at.is_(None))
        .first()
    )
    if not board:
        raise HTTPException(404, NOT_FOUND)
    return board


def page_of(db: Session, board: models.Board, page_id: int) -> models.BoardPage:
    """The page only if it belongs to this board: a page id alone is not a lookup key."""
    page = db.get(models.BoardPage, page_id)
    if not page or page.board_id != board.id:
        raise HTTPException(404, NOT_FOUND)
    return page


def is_owner(user: models.User | None, board: models.Board) -> bool:
    """Same rule as the panel router's visibility: staff, or the creator."""
    if user is None:
        return False
    return is_staff(user) or board.created_by_user_id == user.id


def owner_or_403(request: Request, db: Session, board: models.Board) -> models.User:
    user = auth.optional_active_user(request.cookies, db)
    if not is_owner(user, board):
        # Safe to be explicit here: whoever asks already holds the token.
        raise HTTPException(403, "Tylko właściciel tablicy może to zrobić")
    return user


def validate_elements(elements: list) -> list[dict]:
    if not all(isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] for e in elements):
        raise HTTPException(400, "Nieprawidłowy element sceny")
    if boards_reconcile.contains_data_url(elements):
        raise HTTPException(400, "Scena nie może zawierać danych binarnych (data:)")
    return elements


def reject_oversized(request: Request) -> None:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_PAGE_BYTES:
        raise HTTPException(413, "Za duża scena")


def merge_into_page(db: Session, page: models.BoardPage, incoming: list[dict]) -> models.BoardPage:
    """Merge `incoming` into the stored page. Returns the page (refreshed).

    Never a plain overwrite: two people may be saving, and the one with the
    stale copy must not erase the other's work. When a live room is open for
    this page (see boards_rooms) the merge goes through the room instead, so
    the connected clients see it - that is wired in there.
    """
    current = {e["id"]: e for e in page.elements}
    changed = boards_reconcile.reconcile(current, incoming)
    if changed:
        page.elements = boards_reconcile.ordered(current)
        page.rev += 1
        page.updated_at = auth.utcnow()
        page.board.updated_at = page.updated_at
        db.commit()
        db.refresh(page)
    return page


def _page_out(page: models.BoardPage) -> schemas.PublicPageOut:
    return schemas.PublicPageOut(
        id=page.id, idx=page.idx, title=page.title, rev=page.rev, elements=page.elements,
    )


@router.get("/{token}", response_model=schemas.PublicBoardOut)
@limiter.limit(LIMIT_READ)
def get_board(token: str, request: Request, db: Session = Depends(get_db)):
    """Metadata and the page list; no elements, no write (last_opened_at is
    set when a live connection opens, not on a read)."""
    board = board_by_token(db, token)
    user = auth.optional_active_user(request.cookies, db)
    return schemas.PublicBoardOut(
        title=board.title, is_owner=is_owner(user, board),
        pages=[schemas.BoardPageMeta.model_validate(p) for p in board.pages],
    )


@router.get("/{token}/pages/{page_id}", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_READ)
def get_page(token: str, page_id: int, request: Request, db: Session = Depends(get_db)):
    board = board_by_token(db, token)
    return _page_out(page_of(db, board, page_id))


@router.put("/{token}/pages/{page_id}", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_WRITE)
async def put_page(
    token: str, page_id: int, payload: schemas.PageElementsIn, request: Request,
    db: Session = Depends(get_db),
):
    """Fallback save for when the WebSocket is down. Merges, never overwrites.

    With a live room open for the page the merge goes through the room, so
    the people connected see it and their own work is not clobbered on the
    next periodic save. async because the room lives on the event loop; the
    database path is pushed to the threadpool like any sync endpoint.
    """
    reject_oversized(request)
    board = board_by_token(db, token)
    page = page_of(db, board, page_id)
    incoming = validate_elements(payload.elements)
    via_room = await boards_rooms.merge_from_http(page.id, incoming)
    if via_room is not None:
        rev, elements = via_room
        return schemas.PublicPageOut(id=page.id, idx=page.idx, title=page.title, rev=rev, elements=elements)
    page = await run_in_threadpool(merge_into_page, db, page, incoming)
    return _page_out(page)


@router.post("/{token}/pages", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_WRITE)
def add_page(
    token: str, payload: schemas.PageCreate, request: Request, db: Session = Depends(get_db),
):
    board = board_by_token(db, token)
    owner_or_403(request, db, board)
    title = (payload.title or "").strip() or date.today().isoformat()
    next_idx = db.query(func.coalesce(func.max(models.BoardPage.idx), -1)).filter(
        models.BoardPage.board_id == board.id
    ).scalar() + 1
    page = models.BoardPage(board_id=board.id, idx=next_idx, title=title, elements=[], rev=0)
    db.add(page)
    board.updated_at = auth.utcnow()
    db.commit()
    db.refresh(page)
    return _page_out(page)


@router.patch("/{token}/pages/{page_id}", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_WRITE)
def rename_page(
    token: str, page_id: int, payload: schemas.PageUpdate, request: Request,
    db: Session = Depends(get_db),
):
    board = board_by_token(db, token)
    owner_or_403(request, db, board)
    page = page_of(db, board, page_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Tytuł strony jest wymagany")
    page.title = title
    db.commit()
    db.refresh(page)
    return _page_out(page)


@router.delete("/{token}/pages/{page_id}")
@limiter.limit(LIMIT_WRITE)
def delete_page(token: str, page_id: int, request: Request, db: Session = Depends(get_db)):
    """Removes the page and its snapshots. Other pages keep their id and idx:
    gaps in idx are fine, the order is what matters."""
    board = board_by_token(db, token)
    owner_or_403(request, db, board)
    page = page_of(db, board, page_id)
    if db.query(models.BoardPage.id).filter(models.BoardPage.board_id == board.id).count() <= 1:
        raise HTTPException(400, "Tablica musi mieć co najmniej jedną stronę")
    db.query(models.BoardSnapshot).filter(models.BoardSnapshot.page_id == page.id).delete(
        synchronize_session=False
    )
    db.delete(page)
    board.updated_at = auth.utcnow()
    db.commit()
    boards_rooms.close_pages_threadsafe([page_id])
    return {"ok": True}


# ---------------------------------------------------------------- WebSocket

def _ws_lookup(token: str, page_id: int, cookies: dict) -> tuple[int, int, bool] | None:
    """Board/page/owner for a handshake, on a short-lived session. None = 4404."""
    db = SessionLocal()
    try:
        board = (
            db.query(models.Board)
            .filter(models.Board.token == token, models.Board.archived_at.is_(None))
            .first()
        )
        if not board:
            return None
        page = db.get(models.BoardPage, page_id)
        if not page or page.board_id != board.id:
            return None
        user = auth.optional_active_user(cookies, db)
        return board.id, page.id, is_owner(user, board)
    finally:
        db.close()


@router.websocket("/{token}/ws")
async def board_ws(websocket: WebSocket, token: str, page_id: int):
    """Live sync for one page. Protocol (JSON, field `t`):

    client -> server: update {elements}, pointer {x, y, button}, hello {name}
    server -> client: init {elements, rev, peer_id, peers}, update {elements},
                      pointer {peer_id, x, y, button}, peers {peers}

    Authorization is the token in the path, exactly as for the HTTP side;
    the cookie only decides the owner flag. No `Depends(get_db)` here - a
    session held open for an hour-long lesson would block SQLite's single
    writer for everybody else.
    """
    found = await run_in_threadpool(_ws_lookup, token, page_id, dict(websocket.cookies))
    if found is None:
        # Accept first: a close before accept is reported to the browser as
        # a failed handshake (1006), not as our code.
        await websocket.accept()
        await websocket.close(code=boards_rooms.CLOSE_NOT_FOUND)
        return
    board_id, page_id, owner = found
    await websocket.accept()
    joined = await boards_rooms.join(page_id, websocket, owner)
    if joined is None:
        await websocket.close(code=boards_rooms.CLOSE_NOT_FOUND)
        return
    room, conn = joined
    try:
        while True:
            raw = await websocket.receive_text()
            if len(raw) > boards_rooms.MAX_MESSAGE_BYTES:
                await websocket.close(code=boards_rooms.CLOSE_TOO_BIG)
                break
            try:
                msg = json.loads(raw)
            except ValueError:
                await websocket.close(code=boards_rooms.CLOSE_BAD_MESSAGE)
                break
            if not isinstance(msg, dict):
                continue
            kind = msg.get("t")
            if kind == "update":
                elements = msg.get("elements")
                if not isinstance(elements, list) or not all(
                    isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] for e in elements
                ) or boards_reconcile.contains_data_url(elements):
                    await websocket.close(code=boards_rooms.CLOSE_BAD_MESSAGE)
                    break
                await boards_rooms.apply_update(room, elements, conn)
            elif kind == "pointer":
                await boards_rooms.apply_pointer(room, conn, msg.get("x"), msg.get("y"), msg.get("button"))
            elif kind == "hello":
                await boards_rooms.set_name(room, conn, msg.get("name"))
    except WebSocketDisconnect:
        pass
    finally:
        await boards_rooms.leave(room, conn)

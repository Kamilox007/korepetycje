"""Regression: live rooms - the WebSocket protocol and the in-memory room lifecycle.

Two connections to the same page must see each other's changes without an
echo, a stale copy must lose to the newer one and be corrected, a fallback
PUT must go through the open room (not straight to the database), and the
room must be written out and forgotten once the last person leaves.
"""
import sys, pathlib, json

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
from app.main import app
from app.database import SessionLocal
from app import models, boards_rooms

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def el(id, version, nonce, index="a0", **extra):
    return {"id": id, "type": "rectangle", "version": version, "versionNonce": nonce,
            "index": index, "isDeleted": False, **extra}


def recv_until(ws, kind, limit=10):
    """Skip peers/pointer chatter until a message of the wanted kind."""
    for _ in range(limit):
        msg = ws.receive_json()
        if msg["t"] == kind:
            return msg
    raise AssertionError(f"no {kind} message")


def page_in_db(page_id):
    db = SessionLocal()
    try:
        p = db.get(models.BoardPage, page_id)
        return p.rev, list(p.elements)
    finally:
        db.close()


with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })
    board = admin.post("/api/boards", json={"title": "Live"}).json()
    tok = board["path"].removeprefix("/t/")
    p0 = board["pages"][0]["id"]
    guest = TestClient(app)  # no cookie
    ws_url = f"/api/t/{tok}/ws?page_id={p0}"

    # --- handshake failures close with 4404 ---
    for label, url in (("unknown token", f"/api/t/zly/ws?page_id={p0}"),
                       ("page of another board / nonexistent page", f"/api/t/{tok}/ws?page_id=999999")):
        try:
            with guest.websocket_connect(url) as ws:
                ws.receive_text()
            check(f"{label} -> closed 4404", False)
        except WebSocketDisconnect as e:
            check(f"{label} -> closed 4404", e.code == boards_rooms.CLOSE_NOT_FOUND)

    # --- two people on one page ---
    with guest.websocket_connect(ws_url) as a:
        init_a = a.receive_json()
        check("first client gets init with the (empty) page", init_a["t"] == "init" and init_a["elements"] == [])
        check("init names the client's own peer_id", bool(init_a.get("peer_id")))
        check("init flags a guest as not owner",
              [p["is_owner"] for p in init_a["peers"] if p["peer_id"] == init_a["peer_id"]] == [False])
        check("a room now exists for the page", p0 in boards_rooms.rooms)

        with admin.websocket_connect(ws_url) as b:
            init_b = b.receive_json()
            check("second client gets init too", init_b["t"] == "init")
            check("the owner's cookie is honoured on the handshake",
                  [p["is_owner"] for p in init_b["peers"] if p["peer_id"] == init_b["peer_id"]] == [True])
            peers_a = recv_until(a, "peers")
            check("first client is told about the newcomer", len(peers_a["peers"]) == 2)

            # update A -> B, no echo to A
            a.send_json({"t": "update", "elements": [el("r1", 1, 10)]})
            upd_b = recv_until(b, "update")
            check("update from A reaches B", [e["id"] for e in upd_b["elements"]] == ["r1"])
            a.send_json({"t": "hello", "name": "  Kasia "})
            nxt = a.receive_json()
            check("A does not get its own update echoed (next message is the peers list)",
                  nxt["t"] == "peers")
            check("hello name is trimmed and stripped of control chars",
                  [p["name"] for p in nxt["peers"] if p["peer_id"] == init_a["peer_id"]] == ["Kasia"])
            recv_until(b, "peers")

            # stale copy loses and is corrected
            b.send_json({"t": "update", "elements": [el("r1", 3, 5, x=30)]})
            upd_a = recv_until(a, "update")
            check("B's newer version reaches A", upd_a["elements"][0]["x"] == 30)
            a.send_json({"t": "update", "elements": [el("r1", 2, 1, x=20)]})
            corr = recv_until(a, "update")
            check("sender of a losing version gets the winning one back",
                  corr["elements"][0]["version"] == 3 and corr["elements"][0]["x"] == 30)

            # pointer goes to the other, is not state
            a.send_json({"t": "pointer", "x": 1.5, "y": 2, "button": "down"})
            ptr = recv_until(b, "pointer")
            check("pointer reaches the other client with the sender's peer_id",
                  ptr["peer_id"] == init_a["peer_id"] and ptr["x"] == 1.5)

            # the room is the authority: DB untouched until a save
            rev, _ = page_in_db(p0)
            check("nothing written to the database yet (room holds the state)", rev == 0)

            # fallback PUT goes through the room
            r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("h1", 1, 1, index="a1")]})
            check("PUT while a room is open succeeds", r.status_code == 200)
            check("...and answers with the merged room state",
                  {e["id"] for e in r.json()["elements"]} == {"r1", "h1"})
            upd = recv_until(b, "update")
            check("PUT is broadcast to the connected clients", [e["id"] for e in upd["elements"]] == ["h1"])
            recv_until(a, "update")
            rev, _ = page_in_db(p0)
            check("PUT did not write straight to the database", rev == 0)

            # deletion propagates
            b.send_json({"t": "update", "elements": [el("h1", 2, 1, index="a1", isDeleted=True)]})
            d = recv_until(a, "update")
            check("a deletion propagates as isDeleted", d["elements"][0]["isDeleted"] is True)

        # B left: A is told
        peers_a = recv_until(a, "peers")
        check("remaining client sees the peer list shrink", len(peers_a["peers"]) == 1)

    # last one out: saved and forgotten
    check("room is gone after the last client leaves", p0 not in boards_rooms.rooms)
    rev, elements = page_in_db(p0)
    check("state landed in the database on the last leave", rev == 1 and
          {e["id"] for e in elements} == {"r1", "h1"})
    check("...with the winning versions",
          next(e for e in elements if e["id"] == "r1")["x"] == 30 and
          next(e for e in elements if e["id"] == "h1")["isDeleted"] is True)
    check("GET now serves the saved state",
          {e["id"] for e in guest.get(f"/api/t/{tok}/pages/{p0}").json()["elements"]} == {"r1", "h1"})

    # --- a rejoin loads from the database ---
    with guest.websocket_connect(ws_url) as a:
        init = a.receive_json()
        check("a new room is seeded from the saved page", {e["id"] for e in init["elements"]} == {"r1", "h1"})
        check("init carries the current rev", init["rev"] == 1)

        # bad payloads close the connection
        a.send_json({"t": "update", "elements": [el("img", 1, 1, link="data:image/png;base64,AA")]})
        try:
            a.receive_json()
            check("scene with data: closes the connection (4400)", False)
        except WebSocketDisconnect as e:
            check("scene with data: closes the connection (4400)", e.code == boards_rooms.CLOSE_BAD_MESSAGE)
    check("room is gone again", p0 not in boards_rooms.rooms)

    with guest.websocket_connect(ws_url) as a:
        a.receive_json()
        a.send_text("x" * (boards_rooms.MAX_MESSAGE_BYTES + 1))
        try:
            a.receive_json()
            check("oversized message closes the connection (4009)", False)
        except WebSocketDisconnect as e:
            check("oversized message closes the connection (4009)", e.code == boards_rooms.CLOSE_TOO_BIG)

    with guest.websocket_connect(ws_url) as a:
        a.receive_json()
        a.send_text("nie json")
        try:
            a.receive_json()
            check("malformed JSON closes the connection (4400)", False)
        except WebSocketDisconnect as e:
            check("malformed JSON closes the connection (4400)", e.code == boards_rooms.CLOSE_BAD_MESSAGE)

    # --- deleting the page kicks its room out ---
    p1 = admin.post(f"/api/t/{tok}/pages", json={"title": "Druga"}).json()["id"]
    with guest.websocket_connect(f"/api/t/{tok}/ws?page_id={p1}") as a:
        a.receive_json()
        admin.delete(f"/api/t/{tok}/pages/{p1}")
        try:
            a.receive_json()
            check("deleting the page closes its room with 4404", False)
        except WebSocketDisconnect as e:
            check("deleting the page closes its room with 4404", e.code == boards_rooms.CLOSE_NOT_FOUND)
    check("deleted page's room is gone", p1 not in boards_rooms.rooms)

    # --- rotating the token kicks everybody out ---
    with guest.websocket_connect(ws_url) as a:
        a.receive_json()
        a.send_json({"t": "update", "elements": [el("late", 1, 1, index="a2")]})
        admin.post(f"/api/boards/{board['id']}/rotate-token")
        try:
            a.receive_json()
            check("token rotation closes the room with 4404", False)
        except WebSocketDisconnect as e:
            check("token rotation closes the room with 4404", e.code == boards_rooms.CLOSE_NOT_FOUND)
    _, elements = page_in_db(p0)
    check("work drawn before the rotation was still saved",
          "late" in {e["id"] for e in elements})

    # --- the periodic save writes a dirty room while people are still in it ---
    tok = admin.get(f"/api/boards/{board['id']}").json()["path"].removeprefix("/t/")
    boards_rooms.SAVE_INTERVAL_SECONDS = 0  # the flush task reads this each tick
    rev_before, _ = page_in_db(p0)
    with guest.websocket_connect(f"/api/t/{tok}/ws?page_id={p0}") as a:
        a.receive_json()
        a.send_json({"t": "update", "elements": [el("periodic", 1, 1, index="a3")]})
        import time
        time.sleep(boards_rooms.FLUSH_TICK_SECONDS + 2)
        rev_after, elements = page_in_db(p0)
        check("periodic flush saved the room with clients still connected",
              rev_after == rev_before + 1 and "periodic" in {e["id"] for e in elements})
        check("room is no longer dirty after the flush", boards_rooms.rooms[p0].dirty is False)
        check("room's rev follows the database", boards_rooms.rooms[p0].rev == rev_after)
    rev_final, _ = page_in_db(p0)
    check("leaving a clean room does not write again", rev_final == rev_after)

    # --- a failing save must not kill the flush loop (shared process!) ---
    real_write = boards_rooms._write_page
    calls = {"n": 0}
    def flaky_write(page_id, elements):
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("database is locked")
        return real_write(page_id, elements)
    boards_rooms._write_page = flaky_write
    try:
        with guest.websocket_connect(f"/api/t/{tok}/ws?page_id={p0}") as a:
            a.receive_json()
            a.send_json({"t": "update", "elements": [el("after-fail", 1, 1, index="a4")]})
            time.sleep(boards_rooms.FLUSH_TICK_SECONDS * 2 + 2)
            _, elements = page_in_db(p0)
            check("the flush loop survived a failed write and saved on a later tick",
                  calls["n"] >= 2 and "after-fail" in {e["id"] for e in elements})
            check("the room is still registered", p0 in boards_rooms.rooms)
    finally:
        boards_rooms._write_page = real_write

    # --- last_opened_at is set on connect, not on GET ---
    detail = admin.get(f"/api/boards/{board['id']}").json()
    check("last_opened_at was set by the live connection", detail["last_opened_at"] is not None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

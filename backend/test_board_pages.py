"""Regression: the public board router - a link is the credential, pages by id.

Guards the things a bare link must and must not be able to do: read and
merge-save any page of its own board, nothing of any other board, and no
owner operations (add / rename / delete a page) without the owner's cookie.
"""
import sys, pathlib, sqlite3

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def el(id, version, nonce, index="a0", **extra):
    return {"id": id, "type": "rectangle", "version": version, "versionNonce": nonce,
            "index": index, "isDeleted": False, **extra}


def make_tutor(admin, username, password):
    admin.post("/api/users", json={
        "username": username, "password": "StartPass123!", "role": "tutor",
        "display_name": username.title(),
    })
    c = TestClient(app)
    c.__enter__()
    c.post("/api/auth/login", data={"username": username, "password": "StartPass123!"})
    c.post("/api/auth/change-password", json={
        "old_password": "StartPass123!", "new_password": password, "accept_privacy": True,
    })
    return c


with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })
    ewa = make_tutor(admin, "ewa", "EwaPass123!")
    olek = make_tutor(admin, "olek", "OlekPass123!")
    guest = TestClient(app)  # no cookie at all

    board = ewa.post("/api/boards", json={"title": "Kasia"}).json()
    tok = board["path"].removeprefix("/t/")
    p0 = board["pages"][0]["id"]
    other = olek.post("/api/boards", json={"title": "Olka"}).json()
    other_tok = other["path"].removeprefix("/t/")
    other_p0 = other["pages"][0]["id"]

    # --- lookup and owner detection ---
    r = guest.get(f"/api/t/{tok}")
    check("guest opens the board by token", r.status_code == 200)
    check("guest is not the owner", r.json()["is_owner"] is False)
    check("page list carries id/idx/title/rev but no elements",
          set(r.json()["pages"][0]) == {"id", "idx", "title", "rev", "updated_at"})
    check("creator's cookie makes them the owner", ewa.get(f"/api/t/{tok}").json()["is_owner"] is True)
    check("staff is an owner of any board", admin.get(f"/api/t/{tok}").json()["is_owner"] is True)
    check("another tutor with the link is a guest", olek.get(f"/api/t/{tok}").json()["is_owner"] is False)
    check("unknown token -> 404", guest.get("/api/t/nie-ma-takiego").status_code == 404)
    check("page of another board under this token -> 404",
          guest.get(f"/api/t/{tok}/pages/{other_p0}").status_code == 404)
    check("nonexistent page -> 404", guest.get(f"/api/t/{tok}/pages/999999").status_code == 404)

    # --- must_change_password is a guest ---
    admin.post("/api/users", json={"username": "swiezy", "password": "StartPass123!",
                                   "role": "tutor", "display_name": "S"})
    with TestClient(app) as fresh:
        fresh.post("/api/auth/login", data={"username": "swiezy", "password": "StartPass123!"})
        check("an account on its starting password is a guest",
              fresh.get(f"/api/t/{tok}").json()["is_owner"] is False)

    # --- PUT merges instead of overwriting ---
    r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("a", 1, 10)]})
    check("guest saves elements", r.status_code == 200 and r.json()["rev"] == 1)
    r = ewa.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("b", 1, 10, index="a1")]})
    check("a second save with a different element does not erase the first",
          {e["id"] for e in r.json()["elements"]} == {"a", "b"} and r.json()["rev"] == 2)
    r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("a", 1, 10)]})
    check("re-sending an unchanged element does not bump rev", r.json()["rev"] == 2)
    r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("a", 2, 10, isDeleted=True)]})
    check("a deletion lands as isDeleted, element stays in the list",
          next(e for e in r.json()["elements"] if e["id"] == "a")["isDeleted"] is True)
    r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("a", 1, 10)]})
    check("a stale live copy cannot resurrect it",
          next(e for e in r.json()["elements"] if e["id"] == "a")["isDeleted"] is True)
    check("GET returns what PUT merged",
          {e["id"] for e in guest.get(f"/api/t/{tok}/pages/{p0}").json()["elements"]} == {"a", "b"})
    check("elements come back ordered by index",
          [e["id"] for e in guest.get(f"/api/t/{tok}/pages/{p0}").json()["elements"]] == ["a", "b"])

    # --- what PUT refuses ---
    r = guest.put(f"/api/t/{tok}/pages/{p0}",
                  json={"elements": [el("img", 1, 1, link="data:image/png;base64,AAAA")]})
    check("a scene containing a data: URL is rejected", r.status_code == 400)
    r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [{"version": 1}]})
    check("an element without id is rejected", r.status_code == 400)
    r = guest.put(f"/api/t/{tok}/pages/{p0}", json={"elements": [el("big", 1, 1, text="x" * 1_100_000)]})
    check("a page over 1 MB is refused with 413", r.status_code == 413)
    r = guest.put(f"/api/t/{other_tok}/pages/{p0}", json={"elements": [el("z", 1, 1)]})
    check("saving a page under the wrong token -> 404", r.status_code == 404)

    # --- owner-only page operations ---
    check("guest cannot add a page -> 403",
          guest.post(f"/api/t/{tok}/pages", json={}).status_code == 403)
    check("another tutor with the link cannot add a page -> 403",
          olek.post(f"/api/t/{tok}/pages", json={}).status_code == 403)
    r = ewa.post(f"/api/t/{tok}/pages", json={"title": "Lekcja 2"})
    check("owner adds a page at the end", r.status_code == 200 and r.json()["idx"] == 1)
    p1 = r.json()["id"]
    p2 = ewa.post(f"/api/t/{tok}/pages", json={}).json()
    check("a page without a title gets today's date", len(p2["title"]) == 10 and p2["idx"] == 2)
    check("guest cannot rename -> 403",
          guest.patch(f"/api/t/{tok}/pages/{p1}", json={"title": "x"}).status_code == 403)
    check("owner renames",
          ewa.patch(f"/api/t/{tok}/pages/{p1}", json={"title": "Pochodne"}).json()["title"] == "Pochodne")
    check("empty title is rejected",
          ewa.patch(f"/api/t/{tok}/pages/{p1}", json={"title": " "}).status_code == 400)
    check("guest cannot delete -> 403", guest.delete(f"/api/t/{tok}/pages/{p1}").status_code == 403)

    # --- deleting keeps everybody else's identity ---
    db = SessionLocal()
    db.add(models.BoardSnapshot(board_id=board["id"], page_id=p1, title="t", elements=[]))
    db.commit()
    db.close()
    check("owner deletes a page", ewa.delete(f"/api/t/{tok}/pages/{p1}").status_code == 200)
    pages = guest.get(f"/api/t/{tok}").json()["pages"]
    check("remaining pages keep their id and idx (gaps allowed)",
          [(p["id"], p["idx"]) for p in pages] == [(p0, 0), (p2["id"], 2)])
    db = SessionLocal()
    left = db.query(models.BoardSnapshot).filter(models.BoardSnapshot.page_id == p1).count()
    db.close()
    check("the page's snapshots went with it (explicitly, no FK cascade)", left == 0)
    r = ewa.post(f"/api/t/{tok}/pages", json={})
    check("a new page continues after the highest idx", r.json()["idx"] == 3)
    for pid in (p2["id"], r.json()["id"]):
        ewa.delete(f"/api/t/{tok}/pages/{pid}")
    check("the last page cannot be deleted",
          ewa.delete(f"/api/t/{tok}/pages/{p0}").status_code == 400)

    # --- the database enforces (board_id, idx) ---
    db = SessionLocal()
    try:
        db.add(models.BoardPage(board_id=board["id"], idx=0, title="dup", elements=[], rev=0))
        db.commit()
        check("UNIQUE(board_id, idx) enforced by the database", False)
    except Exception as e:  # IntegrityError
        db.rollback()
        check("UNIQUE(board_id, idx) enforced by the database", "UNIQUE" in str(e).upper())
    db.close()

    # --- archived board: the link dies ---
    ewa.delete(f"/api/boards/{board['id']}")
    check("archived board answers 404 on the link", guest.get(f"/api/t/{tok}").status_code == 404)
    check("...and on its pages", guest.get(f"/api/t/{tok}/pages/{p0}").status_code == 404)
    ewa.post(f"/api/boards/{board['id']}/restore")
    check("restored board answers again", guest.get(f"/api/t/{tok}").status_code == 200)

    # --- rotation kills the old link at once ---
    new_tok = ewa.post(f"/api/boards/{board['id']}/rotate-token").json()["path"].removeprefix("/t/")
    check("old token -> 404 right after rotation", guest.get(f"/api/t/{tok}").status_code == 404)
    check("new token works", guest.get(f"/api/t/{new_tok}").status_code == 200)

    # --- the public router leaks nothing else ---
    for path in ("/api/students", "/api/boards", "/api/auth/me", "/api/lessons"):
        check(f"guest cannot reach {path}", guest.get(path).status_code in (401, 403))

    ewa.__exit__(None, None, None)
    olek.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

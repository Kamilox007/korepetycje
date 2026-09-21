"""Regression: the board token is the credential, and the panel side handles it right.

Tokens must be unique and unguessable, rotation must cut the old link off at
once, and a board somebody else made must look like it does not exist (404,
never 403 - a 403 confirms the id is taken).
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap, login_admin, make_user
bootstrap()

from fastapi.testclient import TestClient
from app.main import app

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


with TestClient(app) as admin:
    login_admin(admin)
    ewa = make_user(admin, "ewa", "tutor", "EwaPass123!")

    # --- creation ---
    r = ewa.post("/api/boards", json={"title": "Kasia - matura"})
    check("tutor creates a board", r.status_code == 200)
    b1 = r.json()
    check("board path is the SPA route with the token", b1["path"].startswith("/t/"))
    tok1 = b1["path"].removeprefix("/t/")
    check("token is long enough to be unguessable (>= 40 chars)", len(tok1) >= 40)
    check("a fresh board has exactly one page", len(b1["pages"]) == 1 and b1["pages"][0]["idx"] == 0)
    check("page metadata carries no elements", "elements" not in b1["pages"][0])

    b2 = ewa.post("/api/boards", json={"title": "Druga"}).json()
    check("two boards get two different tokens", b2["path"] != b1["path"])
    check("an empty title is rejected",
          ewa.post("/api/boards", json={"title": "   "}).status_code == 400)

    # --- listing ---
    ids = {b["id"] for b in ewa.get("/api/boards").json()}
    check("tutor lists their own boards", ids == {b1["id"], b2["id"]})
    check("list carries the page count", ewa.get("/api/boards").json()[0]["page_count"] == 1)

    # --- rotation ---
    r = ewa.post(f"/api/boards/{b1['id']}/rotate-token")
    check("rotation succeeds", r.status_code == 200)
    tok2 = r.json()["path"].removeprefix("/t/")
    check("rotation yields a new token", tok2 != tok1)
    check("the panel still shows the board under the same id",
          ewa.get(f"/api/boards/{b1['id']}").json()["title"] == "Kasia - matura")
    # The public router (commit 4) is what actually answers the link; here we
    # pin down that the stored token really changed.
    from app.database import SessionLocal
    from app import models
    db = SessionLocal()
    stored = db.get(models.Board, b1["id"]).token
    db.close()
    check("old token is gone from the database", stored == tok2 and stored != tok1)

    # --- archive / restore / purge ---
    check("archive", ewa.delete(f"/api/boards/{b1['id']}").json()["archived"] is True)
    check("archived board leaves the default list",
          b1["id"] not in {b["id"] for b in ewa.get("/api/boards").json()})
    check("and shows up under ?archived=true",
          b1["id"] in {b["id"] for b in ewa.get("/api/boards?archived=true").json()})
    check("archiving twice is a 400",
          ewa.delete(f"/api/boards/{b1['id']}").status_code == 400)
    check("purge of a live board is refused",
          admin.delete(f"/api/boards/{b2['id']}/purge").status_code == 400)
    check("purge is admin only",
          ewa.delete(f"/api/boards/{b1['id']}/purge").status_code == 403)
    check("restore", ewa.post(f"/api/boards/{b1['id']}/restore").status_code == 200)
    ewa.delete(f"/api/boards/{b1['id']}")
    check("admin purges an archived board",
          admin.delete(f"/api/boards/{b1['id']}/purge").json()["purged"] is True)
    check("purged board is gone for good",
          ewa.get(f"/api/boards/{b1['id']}").status_code == 404)
    db = SessionLocal()
    leftover = db.query(models.BoardPage).filter(models.BoardPage.board_id == b1["id"]).count()
    db.close()
    check("purge removed the pages explicitly (no reliance on FK cascade)", leftover == 0)

    # --- student attachment ---
    ala = admin.post("/api/students", json={"name": "Ala", "default_price": 80}).json()["id"]
    check("tutor cannot attach a student they have nothing to do with -> 404",
          ewa.post("/api/boards", json={"title": "X", "student_id": ala}).status_code == 404)
    staff_board = admin.post("/api/boards", json={"title": "Staff", "student_id": ala}).json()
    check("staff attaches any student", staff_board["student_name"] == "Ala")
    check("?student_id filters the list",
          [b["id"] for b in admin.get(f"/api/boards?student_id={ala}").json()] == [staff_board["id"]])
    r = admin.patch(f"/api/boards/{staff_board['id']}", json={"student_id": None})
    check("PATCH with student_id: null detaches", r.json()["student_id"] is None)
    r = admin.patch(f"/api/boards/{staff_board['id']}", json={"title": "Nowy tytuł"})
    check("PATCH without student_id leaves it alone", r.json()["title"] == "Nowy tytuł")

    # Purging a student detaches their boards rather than deleting them.
    admin.patch(f"/api/boards/{staff_board['id']}", json={"student_id": ala})
    admin.delete(f"/api/students/{ala}")
    admin.delete(f"/api/students/{ala}/purge")
    r = admin.get(f"/api/boards/{staff_board['id']}")
    check("student purge keeps the board and clears student_id",
          r.status_code == 200 and r.json()["student_id"] is None)

    ewa.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

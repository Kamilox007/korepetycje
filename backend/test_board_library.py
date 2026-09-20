"""Regression: the whiteboard library follows the account, not the browser.

Shapes a tutor adds to the library must come back on another device (same
account), must not leak to another tutor, must be out of reach for students
and guests, and a runaway payload must be refused rather than stored.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def make_user(admin, username, role, password):
    admin.post("/api/users", json={
        "username": username, "password": "StartPass123!", "role": role, "display_name": username,
    })
    c = TestClient(app)
    c.__enter__()
    c.post("/api/auth/login", data={"username": username, "password": "StartPass123!"})
    c.post("/api/auth/change-password", json={
        "old_password": "StartPass123!", "new_password": password, "accept_privacy": True,
    })
    return c


ITEM = {"id": "moja-brylka", "status": "unpublished", "created": 1, "name": "Bryłka",
        "elements": [{"id": "e1", "type": "line", "x": 0, "y": 0, "width": 10, "height": 10,
                      "points": [[0, 0], [10, 10]]}]}

with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })
    ewa = make_user(admin, "ewa", "tutor", "EwaPass123!")
    olek = make_user(admin, "olek", "tutor", "OlekPass123!")

    check("a fresh account has an empty library", ewa.get("/api/me/board-library").json() == {"items": []})
    r = ewa.put("/api/me/board-library", json={"items": [ITEM]})
    check("tutor saves a library item", r.status_code == 200 and r.json()["items"][0]["id"] == "moja-brylka")

    # Same account, another "device": a second client logging in from scratch.
    with TestClient(app) as ewa2:
        ewa2.post("/api/auth/login", data={"username": "ewa", "password": "EwaPass123!"})
        check("the same account sees the library from another session",
              ewa2.get("/api/me/board-library").json()["items"][0]["name"] == "Bryłka")

    check("another tutor does not see it", olek.get("/api/me/board-library").json() == {"items": []})
    check("staff has their own library too",
          admin.put("/api/me/board-library", json={"items": []}).status_code == 200)

    r = ewa.put("/api/me/board-library", json={"items": []})
    check("saving an empty list clears it", r.json() == {"items": []} and
          ewa.get("/api/me/board-library").json() == {"items": []})

    check("an item without id/elements is refused",
          ewa.put("/api/me/board-library", json={"items": [{"name": "x"}]}).status_code == 400)
    big = {**ITEM, "name": "x" * (2 * 1024 * 1024 + 10)}
    check("an oversized library is refused (413)",
          ewa.put("/api/me/board-library", json={"items": [big]}).status_code == 413)
    check("...and nothing was stored", ewa.get("/api/me/board-library").json() == {"items": []})

    guest = TestClient(app)
    check("guest (no cookie) -> 401", guest.get("/api/me/board-library").status_code == 401)

    student_id = admin.post("/api/students", json={"name": "Ala", "default_price": 80}).json()["id"]
    admin.post(f"/api/students/{student_id}/account", json={"username": "ala", "password": "StartPass123!"})
    with TestClient(app) as student:
        student.post("/api/auth/login", data={"username": "ala", "password": "StartPass123!"})
        student.post("/api/auth/change-password", json={
            "old_password": "StartPass123!", "new_password": "AlaPass123!", "accept_privacy": True,
        })
        check("student -> 403", student.get("/api/me/board-library").status_code == 403)

    ewa.__exit__(None, None, None)
    olek.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

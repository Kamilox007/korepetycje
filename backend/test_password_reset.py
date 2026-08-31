"""Regression for issue 9: a staff account password can be reset by an admin.

Before this the only way out of a forgotten tutor password was editing the
database over SSH.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app import auth, models
from app.database import SessionLocal

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


ADMIN_PW = "AdminPassword1"
TUTOR_PW = "TutorPassword1"

with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": ADMIN_PW, "accept_privacy": True})

    r = admin.post("/api/users", json={
        "username": "tutor1", "password": TUTOR_PW, "role": "tutor",
        "display_name": "Tutor One",
    })
    tutor_id = r.json()["id"]
    check("tutor account created", r.status_code == 200)

    # the tutor sets their own password and signs in on two devices
    with TestClient(app) as t1, TestClient(app) as t2:
        t1.post("/api/auth/login", data={"username": "tutor1", "password": TUTOR_PW})
        t1.post("/api/auth/change-password",
                json={"old_password": TUTOR_PW, "new_password": "OwnPassword123", "accept_privacy": True})
        t2.post("/api/auth/login", data={"username": "tutor1", "password": "OwnPassword123"})
        check("tutor works on a second device", t2.get("/api/auth/me").status_code == 200)

        # --- admin resets the password ---
        r = admin.post(f"/api/users/{tutor_id}/reset-password")
        check("reset -> 200", r.status_code == 200)
        new_pw = r.json().get("password")
        check("a new password is returned once", bool(new_pw))
        check("it is long enough", len(new_pw or "") >= auth.MIN_PASSWORD_LENGTH)

        # A reset must also end sessions, otherwise it changes nothing for
        # whoever was already signed in with the old password.
        check("existing sessions are revoked", t2.get("/api/auth/me").status_code == 401)

    with TestClient(app) as t:
        r = t.post("/api/auth/login", data={"username": "tutor1", "password": "OwnPassword123"})
        check("the old password stops working", r.status_code == 401)

        r = t.post("/api/auth/login", data={"username": "tutor1", "password": new_pw})
        check("the new password works", r.status_code == 200)
        check("it counts as a starting password", r.json()["must_change_password"] is True)
        check("nothing else is reachable yet", t.get("/api/students").status_code == 403)

        r = t.post("/api/auth/change-password",
                   json={"old_password": new_pw, "new_password": "SecondOwn123", "accept_privacy": True})
        check("the tutor can set their own password again", r.status_code == 200)

    # --- guard rails ---
    db = SessionLocal()
    admin_id = db.query(models.User).filter_by(username="admin").first().id
    db.close()
    r = admin.post(f"/api/users/{admin_id}/reset-password")
    check("resetting your own password this way is refused", r.status_code == 400)

    r = admin.post("/api/users/99999/reset-password")
    check("unknown user -> 404", r.status_code == 404)

# --- a secretary may reset a tutor but not an admin ---
with TestClient(app) as admin, TestClient(app) as sec:
    admin.post("/api/auth/login", data={"username": "admin", "password": ADMIN_PW})
    admin.post("/api/users", json={
        "username": "sec1", "password": "SecPassword1", "role": "secretary",
        "display_name": "Secretary",
    })
    sec.post("/api/auth/login", data={"username": "sec1", "password": "SecPassword1"})
    sec.post("/api/auth/change-password",
             json={"old_password": "SecPassword1", "new_password": "SecOwn12345", "accept_privacy": True})

    check("secretary may reset a tutor",
          sec.post(f"/api/users/{tutor_id}/reset-password").status_code == 200)

    db = SessionLocal()
    admin_id = db.query(models.User).filter_by(username="admin").first().id
    db.close()
    check("secretary may not reset an admin",
          sec.post(f"/api/users/{admin_id}/reset-password").status_code == 403)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

"""Regression for issue 1: a token issued to an account on its starting password
must not open any endpoint other than the password change."""
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


with TestClient(app) as c:
    # --- login with the default credentials ---
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    check("admin/admin login returns 200", r.status_code == 200)
    body = r.json()
    check("must_change_password == True", body["must_change_password"] is True)
    tok = {"Authorization": f"Bearer {body['access_token']}"}

    # --- short-lived token ---
    from jose import jwt
    from datetime import datetime, timezone
    exp = jwt.decode(body["access_token"], "test-secret", algorithms=["HS256"])["exp"]
    mins = (datetime.fromtimestamp(exp, timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 60
    check(f"token wygasa za ~{mins:.0f} min (nie 7 dni)", mins < 35)

    # --- this is the point: bypassing the frontend ---
    for path in ["/api/students", "/api/users", "/api/lessons", "/api/summary",
                 "/api/payments", "/api/subjects", "/api/reschedule-requests"]:
        r = c.get(path, headers=tok)
        check(f"GET {path} -> 403", r.status_code == 403)

    r = c.post("/api/students", json={"name": "Someone"}, headers=tok)
    check("POST /api/students -> 403", r.status_code == 403)

    # --- dozwolone mimo flagi ---
    check("GET /api/auth/me -> 200", c.get("/api/auth/me", headers=tok).status_code == 200)

    # --- validation of the new password ---
    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "krotkie"}, headers=tok)
    check("password too short -> 400", r.status_code == 400)

    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "admin"}, headers=tok)
    check("password identical to the old one -> 400", r.status_code == 400)

    r = c.post("/api/auth/change-password",
               json={"old_password": "zle", "new_password": "PoprawneHaslo123"}, headers=tok)
    check("wrong current password -> 400", r.status_code == 400)

    # --- poprawna zmiana ---
    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "PoprawneHaslo123"}, headers=tok)
    check("valid change -> 200", r.status_code == 200)
    new_tok = {"Authorization": f"Bearer {r.json()['access_token']}"}
    check("a new token was returned", "access_token" in r.json())

    exp = jwt.decode(r.json()["access_token"], "test-secret", algorithms=["HS256"])["exp"]
    days = (datetime.fromtimestamp(exp, timezone.utc) - datetime.now(timezone.utc)).days
    check(f"the new token is a full one ({days} days)", days >= 6)

    check("GET /api/students after the change -> 200",
          c.get("/api/students", headers=new_tok).status_code == 200)
    check("the old password no longer works",
          c.post("/api/auth/login", data={"username": "admin", "password": "admin"}).status_code == 401)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
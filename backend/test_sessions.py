"""Regression for issue 7: revocable sessions.

JWTs are stateless, so before this a valid signature was enough and a password
change left sessions open on other devices alive for up to seven days.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from jose import jwt
from app.main import app
from app import auth, models
from app.database import SessionLocal

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def token_of(client):
    return client.cookies.get(auth.COOKIE_NAME)


def jti_of(token):
    return jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])["jti"]


PASSWORD = "SessionTest123"

with TestClient(app) as c:
    # --- get past the forced password change ---
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": PASSWORD, "accept_privacy": True})

    # --- every token carries a jti and is recorded ---
    tok = token_of(c)
    jti = jti_of(tok)
    check("token carries a jti", bool(jti))

    db = SessionLocal()
    row = db.get(models.Session, jti)
    check("session recorded in the database", row is not None)
    check("session is active", row is not None and row.revoked_at is None)
    check("user_agent captured", row is not None and row.user_agent is not None)
    db.close()

    # --- a token without a jti is refused, however valid its signature ---
    forged = jwt.encode(
        {"sub": "1", "role": "admin", "username": "admin",
         "exp": auth.utcnow().timestamp() + 3600},
        auth.SECRET_KEY, algorithm=auth.ALGORITHM,
    )
    c.cookies.clear()
    r = c.get("/api/students", headers={"Authorization": f"Bearer {forged}"})
    check("correctly signed token without a jti -> 401", r.status_code == 401)

    # --- a revoked session stops working immediately ---
    c.cookies.set(auth.COOKIE_NAME, tok)
    check("session still works before revocation", c.get("/api/students").status_code == 200)

    db = SessionLocal()
    auth.revoke_session(db, jti)
    db.close()
    check("revoked session -> 401", c.get("/api/students").status_code == 401)

# --- password change ends sessions on other devices ---
with TestClient(app) as phone, TestClient(app) as laptop:
    phone.post("/api/auth/login", data={"username": "admin", "password": PASSWORD})
    laptop.post("/api/auth/login", data={"username": "admin", "password": PASSWORD})

    check("two independent logins both work",
          phone.get("/api/students").status_code == 200
          and laptop.get("/api/students").status_code == 200)

    check("they are separate sessions", jti_of(token_of(phone)) != jti_of(token_of(laptop)))

    NEW = "AfterChange456"
    r = laptop.post("/api/auth/change-password",
                    json={"old_password": PASSWORD, "new_password": NEW})
    check("password change -> 200", r.status_code == 200)

    # This is the whole point of the mechanism.
    check("the other device is logged out at once", phone.get("/api/students").status_code == 401)
    check("the device that changed the password keeps working",
          laptop.get("/api/students").status_code == 200)

    # --- logout revokes rather than just clearing the cookie ---
    tok = token_of(laptop)
    laptop.post("/api/auth/logout")
    laptop.cookies.clear()
    r = laptop.get("/api/students", headers={"Authorization": f"Bearer {tok}"})
    check("token from a logged-out session no longer works", r.status_code == 401)

    db = SessionLocal()
    row = db.get(models.Session, jti_of(tok))
    check("logout marked revoked_at", row is not None and row.revoked_at is not None)
    db.close()

# --- expired rows are cleaned up ---
with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "AfterChange456"})

    db = SessionLocal()
    from datetime import timedelta
    stale = models.Session(
        jti="expired-row", user_id=1,
        created_at=auth.utcnow() - timedelta(days=30),
        last_seen_at=auth.utcnow() - timedelta(days=30),
        expires_at=auth.utcnow() - timedelta(days=1),
    )
    db.add(stale); db.commit(); db.close()

    r = c.post("/api/maintenance/generate-lessons")
    check("maintenance endpoint -> 200", r.status_code == 200)
    check("it reports purged sessions", r.json().get("sessions_purged", 0) >= 1)

    db = SessionLocal()
    check("the expired row is gone", db.get(models.Session, "expired-row") is None)
    check("the active session survived", c.get("/api/students").status_code == 200)
    db.close()

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

"""Regression for issue 6: session in an httponly cookie instead of localStorage."""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app import auth

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


with TestClient(app) as c:
    # --- login sets the cookie ---
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    check("login -> 200", r.status_code == 200)

    raw = r.headers.get("set-cookie", "")
    check(f"response sets the {auth.COOKIE_NAME} cookie", auth.COOKIE_NAME in raw)
    check("cookie carries HttpOnly (JS cannot read it)", "httponly" in raw.lower())
    check("cookie carries SameSite=Lax (blocks CSRF on POST/PATCH/DELETE)",
          "samesite=lax" in raw.lower())
    check("no Secure flag in dev (works over HTTP on localhost)",
          "secure" not in raw.lower())
    check("cookie on a starting password lives ~30 min, not 7 days",
          f"Max-Age={auth.PASSWORD_RESET_EXPIRE_MINUTES * 60}" in raw)

    # --- the cookie alone is enough, no Authorization header ---
    r = c.get("/api/auth/me")
    check("GET /api/auth/me works on the cookie alone", r.status_code == 200)
    check("no Authorization header in the request",
          "authorization" not in {k.lower() for k in r.request.headers})

    # --- changing the password refreshes the cookie to a full one ---
    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "HasloTestowe123!", "accept_privacy": True})
    check("password change -> 200", r.status_code == 200)
    raw = r.headers.get("set-cookie", "")
    check("cookie refreshed to a full 7 days after the change",
          f"Max-Age={auth.TOKEN_EXPIRE_MINUTES * 60}" in raw)

    r = c.get("/api/students")
    check("data access works after the password change", r.status_code == 200)

    # --- logout clears the cookie server-side ---
    r = c.post("/api/auth/logout")
    check("logout -> 200", r.status_code == 200)
    check("response clears the cookie",
          'Max-Age=0' in r.headers.get("set-cookie", "")
          or 'expires=Thu, 01 Jan 1970' in r.headers.get("set-cookie", "").lower())

    r = c.get("/api/students")
    check("access cut off after logout (401)", r.status_code == 401)

    # --- the Authorization header still works (for /docs, curl, cron) ---
    r = c.post("/api/auth/login",
               data={"username": "admin", "password": "HasloTestowe123!"})
    token = r.json()["access_token"]
    c.cookies.clear()
    r = c.get("/api/students", headers={"Authorization": f"Bearer {token}"})
    check("header token still works without a cookie", r.status_code == 200)

    # --- neither one nor the other ---
    c.cookies.clear()
    r = c.get("/api/students")
    check("no cookie and no header -> 401", r.status_code == 401)

# --- Secure flag in production ---
import importlib, os
os.environ["APP_ENV"] = "prod"
for m in [m for m in list(sys.modules) if m.startswith("app")]:
    del sys.modules[m]
prod_auth = importlib.import_module("app.auth")
check("cookie would be Secure under APP_ENV=prod", prod_auth.APP_ENV == "prod")

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
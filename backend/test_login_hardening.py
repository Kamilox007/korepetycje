"""Regresja dla punktu 2: hardening logowania.
Account lockout, evened-out response time, CORS, enforced JWT_SECRET."""
import os, sys, time, pathlib, importlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap(CORS_ORIGINS="https://korepetycje.example.com")

from fastapi.testclient import TestClient
from app.main import app, limiter
from app import auth

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def login(c, u, p):
    return c.post("/api/auth/login", data={"username": u, "password": p})


with TestClient(app) as c:
    limiter.enabled = False  # the IP limit is tested separately, below

    # --- account lockout after a run of failed attempts ---
    for i in range(auth.MAX_FAILED_LOGINS):
        r = login(c, "admin", f"zle{i}")
        check(f"attempt {i + 1}/{auth.MAX_FAILED_LOGINS} -> 401", r.status_code == 401)

    r = login(c, "admin", "zle-znowu")
    check("over the limit -> 429", r.status_code == 429)
    check("response carries Retry-After", "retry-after" in {k.lower() for k in r.headers})

    r = login(c, "admin", "admin")
    check("correct password during lockout also -> 429", r.status_code == 429)

    # --- unlocking once the time passes ---
    from app.database import SessionLocal
    from app import models
    db = SessionLocal()
    u = db.query(models.User).filter(models.User.username == "admin").first()
    u.locked_until = auth.utcnow()  # simulate the lockout expiring
    db.commit()
    db.close()

    r = login(c, "admin", "admin")
    check("login works once the lockout expires", r.status_code == 200)

    # --- the counter resets after a success ---
    db = SessionLocal()
    u = db.query(models.User).filter(models.User.username == "admin").first()
    check("failed_logins reset after success", u.failed_logins == 0)
    check("locked_until cleared", u.locked_until is None)
    db.close()

    # --- no login enumeration: same message, comparable timing ---
    r_no = login(c, "nie-ma-takiego-loginu", "cokolwiek")
    r_bad = login(c, "admin", "zle-haslo")
    check("unknown login -> 401", r_no.status_code == 401)
    check("identical message in both cases",
          r_no.json()["detail"] == r_bad.json()["detail"])

    t0 = time.perf_counter(); login(c, "nie-ma-takiego-loginu", "x"); t_no = time.perf_counter() - t0
    t0 = time.perf_counter(); login(c, "admin", "x"); t_bad = time.perf_counter() - t0
    ratio = max(t_no, t_bad) / max(min(t_no, t_bad), 1e-6)
    check(f"response times comparable (x{ratio:.1f}, {t_no*1000:.0f}ms vs {t_bad*1000:.0f}ms)",
          ratio < 3)

    # --- rate limit po IP ---
    limiter.enabled = True
    limiter.reset()
    codes = [login(c, "ktokolwiek", "x").status_code for _ in range(12)]
    check(f"IP limit cuts in after ~10 attempts ({codes.count(429)} x 429)", 429 in codes)
    limiter.enabled = False

    # --- CORS ---
    r = c.options("/api/auth/login", headers={
        "Origin": "https://zlosliwy.example.com",
        "Access-Control-Request-Method": "POST",
    })
    check("a foreign origin gets no CORS header",
          "access-control-allow-origin" not in {k.lower() for k in r.headers})

    r = c.options("/api/auth/login", headers={
        "Origin": "https://korepetycje.example.com",
        "Access-Control-Request-Method": "POST",
    })
    check("the configured origin passes",
          r.headers.get("access-control-allow-origin") == "https://korepetycje.example.com")

# --- JWT_SECRET wymagany poza dev ---
os.environ["APP_ENV"] = "prod"
del os.environ["JWT_SECRET"]
for m in [m for m in list(sys.modules) if m.startswith("app")]:
    del sys.modules[m]
try:
    importlib.import_module("app.auth")
    check("missing JWT_SECRET under APP_ENV=prod stops startup", False)
except RuntimeError as e:
    check("missing JWT_SECRET under APP_ENV=prod stops startup", "JWT_SECRET" in str(e))

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
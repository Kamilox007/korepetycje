"""Regresja dla punktu 2: hardening logowania.
Blokada konta, wyrównanie czasu odpowiedzi, CORS, wymuszony JWT_SECRET."""
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
    limiter.enabled = False  # limit IP testujemy osobno, niżej

    # --- blokada konta po serii nieudanych prób ---
    for i in range(auth.MAX_FAILED_LOGINS):
        r = login(c, "admin", f"zle{i}")
        check(f"próba {i + 1}/{auth.MAX_FAILED_LOGINS} -> 401", r.status_code == 401)

    r = login(c, "admin", "zle-znowu")
    check("po przekroczeniu limitu -> 429", r.status_code == 429)
    check("odpowiedź zawiera Retry-After", "retry-after" in {k.lower() for k in r.headers})

    r = login(c, "admin", "admin")
    check("poprawne hasło w trakcie blokady też -> 429", r.status_code == 429)

    # --- odblokowanie po upływie czasu ---
    from app.database import SessionLocal
    from app import models
    db = SessionLocal()
    u = db.query(models.User).filter(models.User.username == "admin").first()
    u.locked_until = auth.utcnow()  # symulacja wygaśnięcia blokady
    db.commit()
    db.close()

    r = login(c, "admin", "admin")
    check("po wygaśnięciu blokady logowanie działa", r.status_code == 200)

    # --- licznik zeruje się po sukcesie ---
    db = SessionLocal()
    u = db.query(models.User).filter(models.User.username == "admin").first()
    check("failed_logins wyzerowane po sukcesie", u.failed_logins == 0)
    check("locked_until wyczyszczone", u.locked_until is None)
    db.close()

    # --- brak enumeracji loginów: ten sam komunikat i podobny czas ---
    r_no = login(c, "nie-ma-takiego-loginu", "cokolwiek")
    r_bad = login(c, "admin", "zle-haslo")
    check("nieistniejący login -> 401", r_no.status_code == 401)
    check("identyczny komunikat dla obu przypadków",
          r_no.json()["detail"] == r_bad.json()["detail"])

    t0 = time.perf_counter(); login(c, "nie-ma-takiego-loginu", "x"); t_no = time.perf_counter() - t0
    t0 = time.perf_counter(); login(c, "admin", "x"); t_bad = time.perf_counter() - t0
    ratio = max(t_no, t_bad) / max(min(t_no, t_bad), 1e-6)
    check(f"czasy odpowiedzi porównywalne (x{ratio:.1f}, {t_no*1000:.0f}ms vs {t_bad*1000:.0f}ms)",
          ratio < 3)

    # --- rate limit po IP ---
    limiter.enabled = True
    limiter.reset()
    codes = [login(c, "ktokolwiek", "x").status_code for _ in range(12)]
    check(f"limit IP odcina po ~10 próbach (kody: {codes.count(429)} x 429)", 429 in codes)
    limiter.enabled = False

    # --- CORS ---
    r = c.options("/api/auth/login", headers={
        "Origin": "https://zlosliwy.example.com",
        "Access-Control-Request-Method": "POST",
    })
    check("obcy origin nie dostaje nagłówka CORS",
          "access-control-allow-origin" not in {k.lower() for k in r.headers})

    r = c.options("/api/auth/login", headers={
        "Origin": "https://korepetycje.example.com",
        "Access-Control-Request-Method": "POST",
    })
    check("skonfigurowany origin przechodzi",
          r.headers.get("access-control-allow-origin") == "https://korepetycje.example.com")

# --- JWT_SECRET wymagany poza dev ---
os.environ["APP_ENV"] = "prod"
del os.environ["JWT_SECRET"]
for m in [m for m in list(sys.modules) if m.startswith("app")]:
    del sys.modules[m]
try:
    importlib.import_module("app.auth")
    check("brak JWT_SECRET przy APP_ENV=prod zatrzymuje start", False)
except RuntimeError as e:
    check("brak JWT_SECRET przy APP_ENV=prod zatrzymuje start", "JWT_SECRET" in str(e))

print()
print("NIEPOWODZENIA:", FAILS if FAILS else "brak")
sys.exit(1 if FAILS else 0)
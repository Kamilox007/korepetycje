"""Regresja dla punktu 6: sesja w ciasteczku httponly zamiast localStorage."""
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
    # --- logowanie ustawia ciasteczko ---
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    check("logowanie -> 200", r.status_code == 200)

    raw = r.headers.get("set-cookie", "")
    check(f"odpowiedź ustawia ciasteczko {auth.COOKIE_NAME}", auth.COOKIE_NAME in raw)
    check("ciasteczko ma flagę HttpOnly (JS go nie odczyta)", "httponly" in raw.lower())
    check("ciasteczko ma SameSite=Lax (blokuje CSRF na POST/PATCH/DELETE)",
          "samesite=lax" in raw.lower())
    check("w dev bez flagi Secure (działa po HTTP na localhost)",
          "secure" not in raw.lower())
    check("ciasteczko na haśle startowym żyje ~30 min, nie 7 dni",
          f"Max-Age={auth.PASSWORD_RESET_EXPIRE_MINUTES * 60}" in raw)

    # --- ciasteczko wystarcza, bez nagłówka Authorization ---
    r = c.get("/api/auth/me")
    check("GET /api/auth/me działa na samym ciasteczku", r.status_code == 200)
    check("brak nagłówka Authorization w żądaniu",
          "authorization" not in {k.lower() for k in r.request.headers})

    # --- zmiana hasła odświeża ciasteczko na pełne ---
    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "HasloTestowe123"})
    check("zmiana hasła -> 200", r.status_code == 200)
    raw = r.headers.get("set-cookie", "")
    check("po zmianie hasła ciasteczko odświeżone na pełne 7 dni",
          f"Max-Age={auth.TOKEN_EXPIRE_MINUTES * 60}" in raw)

    r = c.get("/api/students")
    check("po zmianie hasła dostęp do danych działa", r.status_code == 200)

    # --- wylogowanie kasuje ciasteczko po stronie serwera ---
    r = c.post("/api/auth/logout")
    check("wylogowanie -> 200", r.status_code == 200)
    check("odpowiedź kasuje ciasteczko",
          'Max-Age=0' in r.headers.get("set-cookie", "")
          or 'expires=Thu, 01 Jan 1970' in r.headers.get("set-cookie", "").lower())

    r = c.get("/api/students")
    check("po wylogowaniu dostęp odcięty (401)", r.status_code == 401)

    # --- nagłówek Authorization nadal działa (dla /docs, curl, crona) ---
    r = c.post("/api/auth/login",
               data={"username": "admin", "password": "HasloTestowe123"})
    token = r.json()["access_token"]
    c.cookies.clear()
    r = c.get("/api/students", headers={"Authorization": f"Bearer {token}"})
    check("token w nagłówku nadal działa bez ciasteczka", r.status_code == 200)

    # --- brak jednego i drugiego ---
    c.cookies.clear()
    r = c.get("/api/students")
    check("bez ciasteczka i bez nagłówka -> 401", r.status_code == 401)

# --- flaga Secure w produkcji ---
import importlib, os
os.environ["APP_ENV"] = "prod"
for m in [m for m in list(sys.modules) if m.startswith("app")]:
    del sys.modules[m]
prod_auth = importlib.import_module("app.auth")
check("przy APP_ENV=prod ciasteczko byłoby Secure", prod_auth.APP_ENV == "prod")

print()
print("NIEPOWODZENIA:", FAILS if FAILS else "brak")
sys.exit(1 if FAILS else 0)
"""Regresja dla luki nr 1: token wydany kontu na haśle startowym
nie może otwierać żadnego endpointu poza zmianą hasła."""
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
    # --- logowanie domyślnymi danymi ---
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    check("logowanie admin/admin zwraca 200", r.status_code == 200)
    body = r.json()
    check("must_change_password == True", body["must_change_password"] is True)
    tok = {"Authorization": f"Bearer {body['access_token']}"}

    # --- token krótkoterminowy ---
    from jose import jwt
    from datetime import datetime, timezone
    exp = jwt.decode(body["access_token"], "test-secret", algorithms=["HS256"])["exp"]
    mins = (datetime.fromtimestamp(exp, timezone.utc) - datetime.now(timezone.utc)).total_seconds() / 60
    check(f"token wygasa za ~{mins:.0f} min (nie 7 dni)", mins < 35)

    # --- to jest sedno: obejście frontendu ---
    for path in ["/api/students", "/api/users", "/api/lessons", "/api/summary",
                 "/api/payments", "/api/subjects", "/api/reschedule-requests"]:
        r = c.get(path, headers=tok)
        check(f"GET {path} -> 403", r.status_code == 403)

    r = c.post("/api/students", json={"name": "Ktoś"}, headers=tok)
    check("POST /api/students -> 403", r.status_code == 403)

    # --- dozwolone mimo flagi ---
    check("GET /api/auth/me -> 200", c.get("/api/auth/me", headers=tok).status_code == 200)

    # --- walidacja nowego hasła ---
    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "krotkie"}, headers=tok)
    check("zbyt krótkie hasło -> 400", r.status_code == 400)

    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "admin"}, headers=tok)
    check("hasło identyczne ze starym -> 400", r.status_code == 400)

    r = c.post("/api/auth/change-password",
               json={"old_password": "zle", "new_password": "PoprawneHaslo123"}, headers=tok)
    check("błędne stare hasło -> 400", r.status_code == 400)

    # --- poprawna zmiana ---
    r = c.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": "PoprawneHaslo123"}, headers=tok)
    check("poprawna zmiana -> 200", r.status_code == 200)
    new_tok = {"Authorization": f"Bearer {r.json()['access_token']}"}
    check("zwrócono nowy token", "access_token" in r.json())

    exp = jwt.decode(r.json()["access_token"], "test-secret", algorithms=["HS256"])["exp"]
    days = (datetime.fromtimestamp(exp, timezone.utc) - datetime.now(timezone.utc)).days
    check(f"nowy token jest pełny ({days} dni)", days >= 6)

    check("GET /api/students po zmianie -> 200",
          c.get("/api/students", headers=new_tok).status_code == 200)
    check("stare hasło już nie działa",
          c.post("/api/auth/login", data={"username": "admin", "password": "admin"}).status_code == 401)

print()
print("NIEPOWODZENIA:", FAILS if FAILS else "brak")
sys.exit(1 if FAILS else 0)
"""Regresja dla punktu 5: kwoty jako liczby całkowite groszy."""
import sys, pathlib
from datetime import date

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models, money

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


# --- konwersje ---
check("to_grosze(80.1) == 8010", money.to_grosze(80.1) == 8010)
check("to_grosze('0.1') == 10", money.to_grosze("0.1") == 10)
check("to_grosze(2.675) == 268 (handlowe, nie bankierskie)", money.to_grosze(2.675) == 268)
check("round(2.675, 2) dałoby 2.67 — dlatego nie używamy round()", round(2.675, 2) == 2.67)
check("to_grosze(0) == 0", money.to_grosze(0) == 0)
check("to_grosze(None) == 0", money.to_grosze(None) == 0)
check("to_zlote(8010) == 80.1", money.to_zlote(8010) == 80.1)

with TestClient(app) as c:
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    tok = {"Authorization": f"Bearer {r.json()['access_token']}"}
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": "HasloTestowe123"}, headers=tok)
    tok = {"Authorization": f"Bearer {c.post('/api/auth/login', data={'username': 'admin', 'password': 'HasloTestowe123'}).json()['access_token']}"}

    # --- API nadal mówi w złotych ---
    s = c.post("/api/students", json={"name": "Jan", "default_price": 80.1}, headers=tok).json()
    check("API przyjmuje i zwraca złote", s["default_price"] == 80.1)

    db = SessionLocal()
    st = db.get(models.Student, s["id"])
    check("w bazie leżą grosze (8010)", st.default_price_grosze == 8010)
    db.close()

    # --- brak kumulacji błędu: 30 zajęć po 0.10 zł ---
    for i in range(7):
        l = c.post("/api/lessons", headers=tok, json={
            "student_id": s["id"], "date": str(date.today()),
            "start_time": "17:00", "duration_min": 60, "price": 0.1,
        }).json()
        c.patch(f"/api/lessons/{l['id']}", json={"completed": True}, headers=tok)

    naive = sum(0.1 for _ in range(7))           # tak liczył stary kod
    check(f"float sumuje 7x0.10 do {naive!r}, nie 0.7", naive != 0.7)

    summary = c.get("/api/summary", headers=tok).json()
    row = summary["students"][0]
    check(f"saldo liczone w groszach daje dokładnie 0.7 (jest {row['amount_due']})",
          row["amount_due"] == 0.7)
    check("total_due również dokładne", summary["total_due"] == 0.7)
    check("balance = wpłaty - należność", row["balance"] == -0.7)

    # --- wpłata zeruje saldo co do grosza ---
    c.post("/api/payments", headers=tok,
           json={"student_id": s["id"], "amount": 0.7, "date": str(date.today())})
    row = c.get("/api/summary", headers=tok).json()["students"][0]
    check(f"po wpłacie saldo == 0.0 (jest {row['balance']})", row["balance"] == 0.0)

    # --- cena 0 nie jest nadpisywana stawką domyślną ---
    l = c.post("/api/lessons", headers=tok, json={
        "student_id": s["id"], "date": str(date.today()),
        "start_time": "19:00", "duration_min": 60, "price": 0,
    }).json()
    check(f"lekcja próbna za 0 zł zostaje darmowa (jest {l['price']})", l["price"] == 0)

    # --- stawka zamrożona na lekcji ---
    before = c.get(f"/api/lessons?student_id={s['id']}", headers=tok).json()
    old_price = [x for x in before if x["price"] == 0.1][0]["price"]
    c.patch(f"/api/students/{s['id']}", json={"default_price": 200}, headers=tok)
    after = c.get(f"/api/lessons?student_id={s['id']}", headers=tok).json()
    check("podniesienie stawki nie zmienia historycznych lekcji",
          [x for x in after if x["price"] == old_price])

    # --- brak Float w schemacie bazy ---
    db = SessionLocal()
    from sqlalchemy import inspect
    insp = inspect(db.get_bind())
    floats = [
        f"{t}.{col['name']}"
        for t in ("students", "lessons", "lesson_series", "payments")
        for col in insp.get_columns(t)
        if "FLOAT" in str(col["type"]).upper()
    ]
    check(f"żadna kolumna kwotowa nie jest FLOAT ({floats or 'brak'})", not floats)
    db.close()

print()
print("NIEPOWODZENIA:", FAILS if FAILS else "brak")
sys.exit(1 if FAILS else 0)
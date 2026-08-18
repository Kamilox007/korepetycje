"""Regression for issue 5: amounts as whole grosze."""
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
check("to_grosze(2.675) == 268 (half-up, not banker's)", money.to_grosze(2.675) == 268)
check("round(2.675, 2) would give 2.67, which is why round() is not used", round(2.675, 2) == 2.67)
check("to_grosze(0) == 0", money.to_grosze(0) == 0)
check("to_grosze(None) == 0", money.to_grosze(None) == 0)
check("to_zlote(8010) == 80.1", money.to_zlote(8010) == 80.1)

with TestClient(app) as c:
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    tok = {"Authorization": f"Bearer {r.json()['access_token']}"}
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": "HasloTestowe123"}, headers=tok)
    tok = {"Authorization": f"Bearer {c.post('/api/auth/login', data={'username': 'admin', 'password': 'HasloTestowe123'}).json()['access_token']}"}

    # --- the API still speaks zloty ---
    s = c.post("/api/students", json={"name": "Jan", "default_price": 80.1}, headers=tok).json()
    check("the API accepts and returns zloty", s["default_price"] == 80.1)

    db = SessionLocal()
    st = db.get(models.Student, s["id"])
    check("the database stores grosze (8010)", st.default_price_grosze == 8010)
    db.close()

    # --- no accumulating error: 30 lessons at 0.10 PLN ---
    for i in range(7):
        l = c.post("/api/lessons", headers=tok, json={
            "student_id": s["id"], "date": str(date.today()),
            "start_time": "17:00", "duration_min": 60, "price": 0.1,
        }).json()
        c.patch(f"/api/lessons/{l['id']}", json={"completed": True}, headers=tok)

    naive = sum(0.1 for _ in range(7))           # how the old code computed it
    check(f"float sumuje 7x0.10 do {naive!r}, nie 0.7", naive != 0.7)

    summary = c.get("/api/summary", headers=tok).json()
    row = summary["students"][0]
    check(f"a balance computed in grosze gives exactly 0.7 (got {row['amount_due']})",
          row["amount_due"] == 0.7)
    check("total_due is exact as well", summary["total_due"] == 0.7)
    check("balance = payments - amount due", row["balance"] == -0.7)

    # --- a payment zeroes the balance to the grosz ---
    c.post("/api/payments", headers=tok,
           json={"student_id": s["id"], "amount": 0.7, "date": str(date.today())})
    row = c.get("/api/summary", headers=tok).json()["students"][0]
    check(f"balance == 0.0 after the payment (got {row['balance']})", row["balance"] == 0.0)

    # --- a price of 0 is not overwritten by the default rate ---
    l = c.post("/api/lessons", headers=tok, json={
        "student_id": s["id"], "date": str(date.today()),
        "start_time": "19:00", "duration_min": 60, "price": 0,
    }).json()
    check(f"a 0 PLN trial lesson stays free (got {l['price']})", l["price"] == 0)

    # --- the rate is frozen on the lesson ---
    before = c.get(f"/api/lessons?student_id={s['id']}", headers=tok).json()
    old_price = [x for x in before if x["price"] == 0.1][0]["price"]
    c.patch(f"/api/students/{s['id']}", json={"default_price": 200}, headers=tok)
    after = c.get(f"/api/lessons?student_id={s['id']}", headers=tok).json()
    check("raising the rate does not change historical lessons",
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
    check(f"no money column is FLOAT ({floats or 'none'})", not floats)
    db.close()

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
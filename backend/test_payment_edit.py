"""Regression for issue 11: a recorded payment can be corrected.

Until now a typo in the amount or a missing payer meant deleting the payment and
entering it again, which left a hole in the history for no good reason.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app
from app import models
from app.database import SessionLocal

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": "PaymentTest123!", "accept_privacy": True})

    sid = c.post("/api/students", json={"name": "Payer Student", "default_price": 80}).json()["id"]
    pay = c.post("/api/payments", json={
        "student_id": sid, "amount": 150, "date": str(date.today()),
    }).json()
    check("payment created without a payer", pay.get("payer") is None)

    # --- filling in what was missed ---
    r = c.patch(f"/api/payments/{pay['id']}", json={"payer": "mama Kasi", "note": "przelew"})
    check("update -> 200", r.status_code == 200)
    check("payer saved", r.json()["payer"] == "mama Kasi")
    check("note saved", r.json()["note"] == "przelew")
    check("amount untouched by a partial update", r.json()["amount"] == 150.0)

    # --- correcting the amount goes through grosze, not float ---
    r = c.patch(f"/api/payments/{pay['id']}", json={"amount": 123.45})
    check("amount corrected", r.json()["amount"] == 123.45)

    db = SessionLocal()
    check("stored as whole grosze", db.get(models.Payment, pay["id"]).amount_grosze == 12345)
    db.close()

    summary = c.get("/api/summary").json()
    check("the balance follows the correction",
          summary["students"][0]["amount_paid"] == 123.45)

    # --- date can be corrected too ---
    yesterday = str(date.today() - timedelta(days=1))
    r = c.patch(f"/api/payments/{pay['id']}", json={"date": yesterday})
    check("date corrected", r.json()["date"] == yesterday)
    check("payer survived the date change", r.json()["payer"] == "mama Kasi")

    # --- clearing a field ---
    r = c.patch(f"/api/payments/{pay['id']}", json={"note": None})
    check("note can be cleared", r.json()["note"] is None)

    check("unknown payment -> 404",
          c.patch("/api/payments/99999", json={"payer": "x"}).status_code == 404)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

"""Regression: the forecast of income to the end of the quarter.

Not simply "paid so far + upcoming lessons": per student, what is still
expected is the upcoming value plus whatever is owed for lessons already held,
minus any credit. An advance payment must not be counted twice, and a debt must
be counted once it is expected to come in.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap, login_admin, make_user
bootstrap()

from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


today = date.today()
q = (today.month - 1) // 3
q_start = date(today.year, q * 3 + 1, 1)

with TestClient(app) as admin:
    login_admin(admin)
    tutor = make_user(admin, "fcast", "tutor", "ForecastPw123!")
    other = make_user(admin, "fother", "tutor", "ForecastOther123!")
    tid = tutor.get("/api/auth/me").json()["id"]
    oid = other.get("/api/auth/me").json()["id"]

    admin.post("/api/income-limits", json={"effective_from": str(q_start), "limit": 10000})

    def student(name):
        return admin.post("/api/students", json={"name": name, "default_price": 100}).json()["id"]

    def lesson(sid, hour, price, tutor_id=tid, completed=False, cancelled=False):
        r = admin.post("/api/lessons", json={
            "student_id": sid, "date": str(today), "start_time": f"{hour:02d}:00:00",
            "price": price, "assigned_tutor_id": tutor_id,
        })
        assert r.status_code == 200, r.text
        lid = r.json()["id"]
        if completed or cancelled:
            admin.patch(f"/api/lessons/{lid}", json={"completed": completed, "cancelled": cancelled})
        return lid

    def pay(sid, amount):
        r = admin.post("/api/payments", json={
            "student_id": sid, "amount": amount, "date": str(today), "assigned_tutor_id": tid,
        })
        assert r.status_code == 200, r.text

    # A: nothing paid, two lessons ahead -> both are still to come in
    a = student("A zwykly")
    lesson(a, 8, 100); lesson(a, 9, 100)

    # B: an advance payment covers both lessons -> nothing more expected,
    # and the payment must not be counted a second time on top
    b = student("B przedplata")
    pay(b, 500)
    lesson(b, 10, 100); lesson(b, 11, 100)

    # C: owes 300 for a lesson already held, plus one more ahead -> 400
    c_ = student("C zalega")
    lesson(c_, 12, 300, completed=True)
    lesson(c_, 13, 100)

    # D: credit covers only part of what is ahead -> the rest
    d = student("D czesciowo")
    pay(d, 150)
    lesson(d, 14, 100); lesson(d, 15, 100)

    # not counted: a cancelled lesson, and another tutor's lesson
    lesson(a, 16, 100, cancelled=True)
    lesson(a, 17, 100, tutor_id=oid)

    r = tutor.get("/api/me/quarterly-limit")
    check("tutor's quarterly view -> 200", r.status_code == 200)
    body = r.json()

    check("earned is the cash received this quarter", body["earned"] == 650.0)
    check("upcoming lessons exclude cancelled and other tutors' ones", body["upcoming_lessons"] == 7)
    check("their value", body["upcoming_value"] == 700.0)
    check("forecast = earned + expected (credit covers B, debt added for C)",
          body["forecast"] == 650.0 + (200 + 0 + 400 + 50))
    check("what is left to the limit after the forecast", body["forecast_remaining"] == 10000 - body["forecast"])

    rows = {row["tutor_id"]: row for row in admin.get("/api/summary/quarterly-limits").json()}
    check("the staff table carries the forecast too", rows[tid]["forecast"] == body["forecast"])
    check("the other tutor's own single lesson is forecast on its own, not mixed in",
          rows[oid]["upcoming_lessons"] == 1 and rows[oid]["forecast"] == 100.0)

    # a finished quarter has nothing left to forecast
    prev = q_start - timedelta(days=1)
    pq = (prev.month - 1) // 3 + 1
    old = tutor.get(f"/api/me/quarterly-limit?year={prev.year}&quarter={pq}").json()
    check("an earlier quarter has no forecast",
          old["forecast"] is None and old["upcoming_lessons"] is None and old["forecast_remaining"] is None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

"""Regression: quarterly income-limit tracking (działalność nierejestrowana).

Covers the calendar-quarter math, that only cash actually received counts and
only for the tutor it is credited to, that the limit value used is whichever
one was in effect at the start of the quarter (not simply the newest entry
ever added), that setting/removing the limit is admin-only, and that posting
the same effective_from twice corrects it instead of duplicating it.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def quarter_bounds(d):
    """Independent re-implementation of the backend's _quarter_bounds, so the
    test does not simply assert whatever the code under test computes."""
    q = (d.month - 1) // 3
    start = date(d.year, q * 3 + 1, 1)
    next_start = date(d.year + 1, 1, 1) if q == 3 else date(d.year, q * 3 + 4, 1)
    return start, next_start - timedelta(days=1)


ADMIN_PW = "QuarterAdmin1!"
TUTOR_PW = "QuarterTutor1!"
SEC_PW = "QuarterSec1!"

today = date.today()
q_start, q_end = quarter_bounds(today)
prev_quarter_day = q_start - timedelta(days=1)

with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password",
               json={"old_password": "admin", "new_password": ADMIN_PW, "accept_privacy": True})
    admin_id = admin.get("/api/auth/me").json()["id"]

    r = admin.post("/api/users", json={
        "username": "qtutor", "password": TUTOR_PW, "role": "tutor", "display_name": "Kwartalny Korepetytor",
    })
    tutor_id = r.json()["id"]
    r = admin.post("/api/users", json={
        "username": "qsec", "password": SEC_PW, "role": "secretary", "display_name": "Sekretariat",
    })

    with TestClient(app) as tutor, TestClient(app) as sec:
        tutor.post("/api/auth/login", data={"username": "qtutor", "password": TUTOR_PW})
        tutor.post("/api/auth/change-password",
                   json={"old_password": TUTOR_PW, "new_password": "TutorOwn123!", "accept_privacy": True})
        sec.post("/api/auth/login", data={"username": "qsec", "password": SEC_PW})
        sec.post("/api/auth/change-password",
                 json={"old_password": SEC_PW, "new_password": "SecOwn123!", "accept_privacy": True})

        # --- setting the limit: admin only ---
        check("secretary cannot set the limit",
              sec.post("/api/income-limits", json={"effective_from": str(q_start), "limit": 100}).status_code == 403)
        check("tutor cannot set the limit",
              tutor.post("/api/income-limits", json={"effective_from": str(q_start), "limit": 100}).status_code == 403)

        r = admin.post("/api/income-limits", json={"effective_from": "2020-01-01", "limit": 5000})
        check("admin sets an old (superseded) limit -> 200", r.status_code == 200)

        r = admin.post("/api/income-limits", json={"effective_from": str(q_start), "limit": 10813.50})
        check("admin sets the limit effective at the start of this quarter -> 200", r.status_code == 200)
        check("the amount round-trips exactly", r.json()["limit"] == 10813.50)

        # a later, still-future date must not affect the current quarter
        admin.post("/api/income-limits", json={
            "effective_from": str(q_end + timedelta(days=1)), "limit": 99999,
        })

        listed = admin.get("/api/income-limits").json()
        check("all three settings are listed", len(listed) == 3)

        # upsert: posting the same date again corrects it, not duplicates it
        r = admin.post("/api/income-limits", json={"effective_from": str(q_start), "limit": 10813.50})
        check("re-posting the same effective_from -> 200", r.status_code == 200)
        check("no duplicate row was created",
              len(admin.get("/api/income-limits").json()) == 3)

        # --- earnings: a student, a payment inside the quarter, one outside ---
        sid = admin.post("/api/students", json={"name": "Uczeń Kwartalny", "default_price": 100}).json()["id"]

        admin.post("/api/payments", json={
            "student_id": sid, "amount": 300, "date": str(today),
            "assigned_tutor_id": tutor_id,
        })
        admin.post("/api/payments", json={
            "student_id": sid, "amount": 9999, "date": str(prev_quarter_day),
            "assigned_tutor_id": tutor_id,
        })
        # credited to someone else entirely (the admin, acting as a tutor) -- must not count for qtutor
        admin.post("/api/payments", json={
            "student_id": sid, "amount": 8888, "date": str(today),
            "assigned_tutor_id": admin_id,
        })

        r = tutor.get("/api/me/quarterly-limit")
        check("tutor's own quarterly-limit endpoint -> 200", r.status_code == 200)
        body = r.json()
        check("quarter bounds match", body["quarter_start"] == str(q_start) and body["quarter_end"] == str(q_end))
        check("only the in-quarter payment credited to this tutor counts",
              body["earned"] == 300.0)
        check("the currently-effective limit is the one set for this quarter, not the old or future one",
              body["limit"] == 10813.50)
        check("remaining = limit - earned", round(body["remaining"], 2) == round(10813.50 - 300.0, 2))

        check("secretary cannot call the tutor-only endpoint",
              sec.get("/api/me/quarterly-limit").status_code == 403)

        # --- staff-wide view ---
        r = admin.get("/api/summary/quarterly-limits")
        check("staff quarterly-limits -> 200", r.status_code == 200)
        rows = {row["tutor_id"]: row for row in r.json()}
        check("every tutor/admin appears, including one with zero earned this quarter or not",
              tutor_id in rows and admin_id in rows)
        check("the tutor's row matches their own view", rows[tutor_id]["earned"] == 300.0)
        check("the admin's own row only counts their own payment",
              rows[admin_id]["earned"] == 8888.0)

        r = sec.get("/api/summary/quarterly-limits")
        check("secretary can see the staff-wide table too", r.status_code == 200)

        # --- deleting a setting ---
        old_id = next(s["id"] for s in listed if s["effective_from"] == "2020-01-01")
        check("secretary cannot delete a setting",
              sec.delete(f"/api/income-limits/{old_id}").status_code == 403)
        check("admin can delete a setting -> 200",
              admin.delete(f"/api/income-limits/{old_id}").status_code == 200)
        check("it is gone",
              all(s["id"] != old_id for s in admin.get("/api/income-limits").json()))

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

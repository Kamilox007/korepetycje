"""Regression for issue 8: archiving a student instead of deleting them.

Deleting cascaded into payments, so one click destroyed the settlement history
with no way back. Archiving hides the student; a real delete stays available as
a separate, deliberate operation for GDPR erasure requests.
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


PASSWORD = "ArchiveTest123!"

with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": PASSWORD, "accept_privacy": True})

    sid = c.post("/api/students", json={"name": "Anna Archive", "default_price": 80}).json()["id"]

    today = date.today()
    past = c.post("/api/lessons", json={
        "student_id": sid, "date": str(today - timedelta(days=7)),
        "start_time": "16:00:00", "price": 80,
    }).json()
    c.patch(f"/api/lessons/{past['id']}", json={"completed": True})
    future = c.post("/api/lessons", json={
        "student_id": sid, "date": str(today + timedelta(days=7)),
        "start_time": "16:00:00", "price": 80,
    }).json()
    c.post("/api/payments", json={"student_id": sid, "date": str(today), "amount": 50})

    acc = c.post(f"/api/students/{sid}/account",
                 json={"username": "anna", "password": "StartPassword1!"})
    check("student account created", acc.status_code == 200)

    # --- archiving ---
    r = c.delete(f"/api/students/{sid}")
    check("DELETE archives instead of deleting", r.status_code == 200 and r.json().get("archived"))

    db = SessionLocal()
    st = db.get(models.Student, sid)
    check("the student row still exists", st is not None)
    check("archived_at is set", st is not None and st.archived_at is not None)

    # This is the whole point: the settlement history survives.
    check("payments kept", db.query(models.Payment).filter_by(student_id=sid).count() == 1)
    check("completed lesson kept",
          db.query(models.Lesson).filter_by(student_id=sid, completed=True).count() == 1)
    check("unfinished future lesson removed",
          db.get(models.Lesson, future["id"]) is None)
    check("login account removed", db.query(models.User).filter_by(username="anna").count() == 0)
    db.close()

    # --- visibility ---
    active = c.get("/api/students").json()
    check("gone from the active list", all(s["id"] != sid for s in active))
    archived = c.get("/api/students?archived=true").json()
    check("present in the archive", any(s["id"] == sid for s in archived))

    summary = c.get("/api/summary").json()
    check("excluded from the summary",
          all(row["student_id"] != sid for row in summary["students"]))

    check("archiving twice is refused", c.delete(f"/api/students/{sid}").status_code == 400)

    # --- restoring ---
    r = c.post(f"/api/students/{sid}/restore")
    check("restore -> 200", r.status_code == 200)
    check("archived_at cleared", r.json().get("archived_at") is None)
    check("back in the active list",
          any(s["id"] == sid for s in c.get("/api/students").json()))
    check("history intact after restore",
          c.get("/api/summary").json()["students"][0]["amount_paid"] == 50.0)
    check("restoring a non-archived student is refused",
          c.post(f"/api/students/{sid}/restore").status_code == 400)

    # --- permanent erasure ---
    check("purge refused while the student is active",
          c.delete(f"/api/students/{sid}/purge").status_code == 400)

    c.delete(f"/api/students/{sid}")
    r = c.delete(f"/api/students/{sid}/purge")
    check("purge of an archived student -> 200", r.status_code == 200)

    db = SessionLocal()
    check("student really gone", db.get(models.Student, sid) is None)
    check("their payments gone too",
          db.query(models.Payment).filter_by(student_id=sid).count() == 0)
    db.close()

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

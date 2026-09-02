"""Regression: deleting a lesson (via series end-date, series removal, a single
lesson, or a student purge/archive) must not leave a dangling reschedule
request behind.

Neither Lesson nor Student declares an ORM relationship to RescheduleRequest,
so a bare delete does not cascade to it. SQLite does not enforce foreign keys
by default, so this was invisible in dev and in the test suite -- it only
surfaced as a hard failure on Postgres, where the delete is rejected outright.
This test turns SQLite's FK enforcement on to reproduce that.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from datetime import date, timedelta
from sqlalchemy import event
from fastapi.testclient import TestClient
from app.main import app
from app import models
from app.database import SessionLocal, engine

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


@event.listens_for(engine, "connect")
def _enforce_fk(dbapi_connection, connection_record):
    dbapi_connection.execute("PRAGMA foreign_keys=ON")


PASSWORD = "RescheduleTest123!"


def add_reschedule_request(student_id, lesson_id, tutor_id):
    db = SessionLocal()
    db.add(models.RescheduleRequest(
        lesson_id=lesson_id, student_id=student_id, tutor_id=tutor_id,
        proposed_date=date.today() + timedelta(days=14),
    ))
    db.commit()
    db.close()


with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": PASSWORD, "accept_privacy": True})
    admin_id = c.get("/api/auth/me").json()["id"]

    today = date.today()

    # --- 1. a single lesson delete ---
    sid = c.post("/api/students", json={"name": "Uczen Jeden", "default_price": 80}).json()["id"]
    lesson = c.post("/api/lessons", json={
        "student_id": sid, "date": str(today + timedelta(days=3)),
        "start_time": "10:00:00", "price": 80,
    }).json()
    add_reschedule_request(sid, lesson["id"], admin_id)
    r = c.delete(f"/api/lessons/{lesson['id']}")
    check("single lesson delete with a pending reschedule request -> 200", r.status_code == 200)

    # --- 2. a series end-date pulled earlier drops future occurrences ---
    sid2 = c.post("/api/students", json={"name": "Uczen Dwa", "default_price": 80}).json()["id"]
    series = c.post("/api/series", json={
        "student_id": sid2, "weekday": today.weekday(), "start_time": "12:00:00",
        "duration_min": 60, "price": 80, "start_date": str(today),
    }).json()
    lessons2 = c.get(f"/api/lessons?student_id={sid2}").json()
    future_lesson = next(l for l in lessons2 if not l["completed"])
    add_reschedule_request(sid2, future_lesson["id"], admin_id)
    r = c.patch(f"/api/series/{series['id']}", json={"end_date": str(today)})
    check("pulling a series end date earlier, past a pending reschedule request -> 200",
          r.status_code == 200)

    # --- 3. ending a series outright ---
    sid3 = c.post("/api/students", json={"name": "Uczen Trzy", "default_price": 80}).json()["id"]
    series3 = c.post("/api/series", json={
        "student_id": sid3, "weekday": today.weekday(), "start_time": "13:00:00",
        "duration_min": 60, "price": 80, "start_date": str(today),
    }).json()
    lessons3 = c.get(f"/api/lessons?student_id={sid3}").json()
    add_reschedule_request(sid3, lessons3[0]["id"], admin_id)
    r = c.delete(f"/api/series/{series3['id']}")
    check("ending a series with a pending reschedule request on one of its lessons -> 200",
          r.status_code == 200)

    # --- 4. archiving a student drops their future lessons ---
    sid4 = c.post("/api/students", json={"name": "Uczen Cztery", "default_price": 80}).json()["id"]
    lesson4 = c.post("/api/lessons", json={
        "student_id": sid4, "date": str(today + timedelta(days=5)),
        "start_time": "14:00:00", "price": 80,
    }).json()
    add_reschedule_request(sid4, lesson4["id"], admin_id)
    r = c.delete(f"/api/students/{sid4}")
    check("archiving a student with a pending reschedule request on a future lesson -> 200",
          r.status_code == 200 and r.json().get("archived"))

    # --- 5. purging an already-archived student ---
    sid5 = c.post("/api/students", json={"name": "Uczen Piec", "default_price": 80}).json()["id"]
    past5 = c.post("/api/lessons", json={
        "student_id": sid5, "date": str(today - timedelta(days=7)),
        "start_time": "15:00:00", "price": 80,
    }).json()
    c.patch(f"/api/lessons/{past5['id']}", json={"completed": True})
    # a reschedule request tied to the student directly (not filtered out by
    # archiving's future/uncompleted-only lesson cleanup)
    db = SessionLocal()
    db.add(models.RescheduleRequest(
        lesson_id=past5["id"], student_id=sid5, tutor_id=admin_id,
        proposed_date=today, status="rejected",
    ))
    db.commit()
    db.close()
    c.delete(f"/api/students/{sid5}")
    r = c.delete(f"/api/students/{sid5}/purge")
    check("purging an archived student with reschedule request history -> 200",
          r.status_code == 200)

    db = SessionLocal()
    check("the reschedule request is gone too",
          db.query(models.RescheduleRequest).filter_by(student_id=sid5).count() == 0)
    db.close()

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

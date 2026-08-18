"""Regresja dla punktu 4: generator serii.
Slot uniqueness, horizon clamp, GET without side effects."""
import sys, pathlib
from datetime import date, time, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models, services

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def count_lessons():
    db = SessionLocal()
    try:
        return db.query(models.Lesson).count()
    finally:
        db.close()


with TestClient(app) as c:
    # --- zaloguj admina ---
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    tok = {"Authorization": f"Bearer {r.json()['access_token']}"}
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": "HasloTestowe123"}, headers=tok)
    r = c.post("/api/auth/login", data={"username": "admin", "password": "HasloTestowe123"})
    tok = {"Authorization": f"Bearer {r.json()['access_token']}"}

    s = c.post("/api/students", json={"name": "Jan Kowalski", "default_price": 80},
               headers=tok).json()
    r = c.post("/api/series", headers=tok, json={
        "student_id": s["id"], "weekday": 1, "start_time": "17:00",
        "duration_min": 60, "price": 80, "start_date": str(date.today()),
    })
    check("series creation -> 200", r.status_code == 200)
    n_after_create = count_lessons()
    check(f"series materialised on creation ({n_after_create} lessons)",
          n_after_create > 10)

    # --- GET nie zapisuje ---
    before = count_lessons()
    for _ in range(3):
        c.get("/api/lessons", headers=tok)
    check("GET /api/lessons creates nothing", count_lessons() == before)

    # --- klamra na horyzont sterowany przez klienta ---
    r = c.get("/api/lessons?end=2099-01-01", headers=tok)
    check("GET with end=2099 -> 200", r.status_code == 200)
    check("GET with end=2099 does not generate thousands of rows", count_lessons() == before)

    horizon = services.clamp_horizon(date(2099, 1, 1))
    check(f"clamp_horizon obcina do {horizon}",
          horizon <= date.today() + timedelta(days=services.MAX_HORIZON_DAYS))
    check("clamp_horizon(None) yields the default",
          services.clamp_horizon(None) == date.today() + timedelta(days=services.DEFAULT_HORIZON_DAYS))

    # --- unique constraint na poziomie bazy ---
    db = SessionLocal()
    victim = db.query(models.Lesson).filter(models.Lesson.series_id.isnot(None)).first()
    dup = models.Lesson(
        tutor_id=victim.tutor_id, student_id=victim.student_id,
        series_id=victim.series_id, date=victim.date, origin_date=victim.origin_date,
        start_time=victim.start_time, duration_min=60, price=80,
    )
    db.add(dup)
    from sqlalchemy.exc import IntegrityError
    try:
        db.commit()
        check("duplicate slot rejected by the database", False)
    except IntegrityError:
        check("duplicate slot rejected by the database", True)
        db.rollback()

    # one-off lessons (series_id NULL) may repeat
    for _ in range(2):
        db.add(models.Lesson(
            tutor_id=victim.tutor_id, student_id=victim.student_id,
            series_id=None, origin_date=None, date=date.today(),
            start_time=time(9, 0), duration_min=60, price=80))
    try:
        db.commit()
        check("one-off lessons do not collide with each other", True)
    except IntegrityError:
        check("one-off lessons do not collide with each other", False)
        db.rollback()
    db.close()

    # --- endpoint konserwacyjny ---
    r = c.post("/api/maintenance/generate-lessons", headers=tok)
    check("maintenance endpoint -> 200", r.status_code == 200)
    check("returns the created count and the horizon",
          {"created", "horizon"} <= set(r.json()))
    check("the second call is idempotent",
          c.post("/api/maintenance/generate-lessons", headers=tok).json()["created"] == 0)

    # --- the generator tolerates a duplicate appearing mid-flight ---
    db = SessionLocal()
    series = db.query(models.LessonSeries).first()
    created = services.generate_lessons_for_series(db, series, services.clamp_horizon(None))
    check("ponowne generowanie tej samej serii nic nie dubluje", created == 0)
    db.close()

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)
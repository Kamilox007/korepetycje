"""Regresja dla punktu 4: generator serii.
Unikalność slotu, klamra na horyzont, GET bez efektów ubocznych."""
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
    check("utworzenie serii -> 200", r.status_code == 200)
    n_after_create = count_lessons()
    check(f"seria zmaterializowana przy tworzeniu ({n_after_create} zajęć)",
          n_after_create > 10)

    # --- GET nie zapisuje ---
    before = count_lessons()
    for _ in range(3):
        c.get("/api/lessons", headers=tok)
    check("GET /api/lessons nic nie tworzy", count_lessons() == before)

    # --- klamra na horyzont sterowany przez klienta ---
    r = c.get("/api/lessons?end=2099-01-01", headers=tok)
    check("GET z end=2099 -> 200", r.status_code == 200)
    check("GET z end=2099 nie generuje tysięcy wierszy", count_lessons() == before)

    horizon = services.clamp_horizon(date(2099, 1, 1))
    check(f"clamp_horizon obcina do {horizon}",
          horizon <= date.today() + timedelta(days=services.MAX_HORIZON_DAYS))
    check("clamp_horizon(None) daje wartość domyślną",
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
        check("duplikat slotu odrzucony przez bazę", False)
    except IntegrityError:
        check("duplikat slotu odrzucony przez bazę", True)
        db.rollback()

    # zajęcia jednorazowe (series_id NULL) mogą się powtarzać
    for _ in range(2):
        db.add(models.Lesson(
            tutor_id=victim.tutor_id, student_id=victim.student_id,
            series_id=None, origin_date=None, date=date.today(),
            start_time=time(9, 0), duration_min=60, price=80))
    try:
        db.commit()
        check("zajęcia jednorazowe nie kolidują ze sobą", True)
    except IntegrityError:
        check("zajęcia jednorazowe nie kolidują ze sobą", False)
        db.rollback()
    db.close()

    # --- endpoint konserwacyjny ---
    r = c.post("/api/maintenance/generate-lessons", headers=tok)
    check("endpoint konserwacyjny -> 200", r.status_code == 200)
    check("zwraca liczbę utworzonych i horyzont",
          {"created", "horizon"} <= set(r.json()))
    check("drugie wywołanie jest idempotentne",
          c.post("/api/maintenance/generate-lessons", headers=tok).json()["created"] == 0)

    # --- generator odporny na istniejący duplikat w locie ---
    db = SessionLocal()
    series = db.query(models.LessonSeries).first()
    created = services.generate_lessons_for_series(db, series, services.clamp_horizon(None))
    check("ponowne generowanie tej samej serii nic nie dubluje", created == 0)
    db.close()

print()
print("NIEPOWODZENIA:", FAILS if FAILS else "brak")
sys.exit(1 if FAILS else 0)
"""Regression for issue 10: editing a series instead of deleting and recreating it.

The rule under test is which changes reach existing occurrences. Metadata does,
timing does not touch lessons somebody already moved by hand, and nothing at all
reaches completed lessons.
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


PASSWORD = "SeriesTest123!"

with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": PASSWORD, "accept_privacy": True})

    sid = c.post("/api/students", json={"name": "Series Student", "default_price": 80}).json()["id"]
    subj = c.post("/api/subjects", json={"name": "Matematyka"}).json()["id"]

    # A series starting a week back, so some occurrences are already in the past.
    start = date.today() - timedelta(days=7)
    series = c.post("/api/series", json={
        "student_id": sid, "weekday": start.weekday(),
        "start_time": "16:00:00", "price": 80, "start_date": str(start),
    }).json()
    series_id = series["id"]
    check("series created without a level", series.get("level") is None)

    db = SessionLocal()
    all_lessons = db.query(models.Lesson).filter_by(series_id=series_id).order_by(models.Lesson.date).all()
    check("occurrences generated", len(all_lessons) > 3)

    # Mark the first one completed and move another by hand: these two are what
    # the propagation rules have to leave alone.
    past = all_lessons[0]
    past_id = past.id
    past.completed = True
    future_ids = [l.id for l in all_lessons if l.date >= date.today() and not l.completed]
    moved_id = future_ids[1]
    db.commit()
    db.close()

    r = c.patch(f"/api/lessons/{moved_id}", json={"date": str(date.today() + timedelta(days=20))})
    check("one lesson moved by hand", r.status_code == 200 and r.json()["rescheduled"] is True)

    # --- the user's actual case: a forgotten level ---
    r = c.patch(f"/api/series/{series_id}", json={"level": "rozszerzenie", "subject_id": subj})
    check("series update -> 200", r.status_code == 200)
    check("the series carries the level now", r.json()["level"] == "rozszerzenie")

    db = SessionLocal()
    rows = db.query(models.Lesson).filter_by(series_id=series_id).all()
    fut = [l for l in rows if l.date >= date.today() and not l.completed]
    check("every future lesson has the level",
          all(l.level == "rozszerzenie" for l in fut))
    check("the moved lesson got it too",
          db.get(models.Lesson, moved_id).level == "rozszerzenie")
    check("the subject reached them as well", all(l.subject_id == subj for l in fut))
    check("the completed lesson was left alone",
          db.get(models.Lesson, past_id).level is None)
    db.close()

    # --- price: future only, completed keeps its frozen rate ---
    c.patch(f"/api/series/{series_id}", json={"price": 100})
    db = SessionLocal()
    fut = [l for l in db.query(models.Lesson).filter_by(series_id=series_id).all()
           if l.date >= date.today() and not l.completed]
    check("the new rate reached future lessons", all(l.price_grosze == 10000 for l in fut))
    check("the completed lesson keeps its old rate",
          db.get(models.Lesson, past_id).price_grosze == 8000)
    db.close()

    # --- time: skips the lesson moved by hand ---
    db = SessionLocal()
    moved_before = db.get(models.Lesson, moved_id)
    moved_date_before, moved_time_before = moved_before.date, moved_before.start_time
    db.close()

    c.patch(f"/api/series/{series_id}", json={"start_time": "18:00:00"})
    db = SessionLocal()
    untouched = [l for l in db.query(models.Lesson).filter_by(series_id=series_id).all()
                 if l.date >= date.today() and not l.completed and not l.rescheduled]
    check("the new time reached untouched lessons",
          all(str(l.start_time).startswith("18:") for l in untouched))
    # This is what the user asked for.
    check("the hand-moved lesson kept its own time",
          db.get(models.Lesson, moved_id).start_time == moved_time_before)
    db.close()

    # --- weekday: shifts the schedule, still skipping the moved one ---
    new_weekday = (start.weekday() + 2) % 7
    c.patch(f"/api/series/{series_id}", json={"weekday": new_weekday})
    db = SessionLocal()
    shifted = [l for l in db.query(models.Lesson).filter_by(series_id=series_id).all()
               if l.date >= date.today() and not l.completed and not l.rescheduled]
    check("untouched lessons landed on the new weekday",
          all(l.date.weekday() == new_weekday for l in shifted))
    check("the hand-moved lesson kept its date",
          db.get(models.Lesson, moved_id).date == moved_date_before)
    check("no duplicate slots were created",
          len({l.origin_date for l in shifted if l.origin_date}) == len([l for l in shifted if l.origin_date]))
    db.close()

    # --- an earlier end date trims the tail ---
    cutoff = date.today() + timedelta(days=14)
    c.patch(f"/api/series/{series_id}", json={"end_date": str(cutoff)})
    db = SessionLocal()
    beyond = [l for l in db.query(models.Lesson).filter_by(series_id=series_id).all()
              if l.date > cutoff and not l.completed]
    check("nothing is scheduled past the new end date", beyond == [])
    db.close()

    check("unknown series -> 404", c.patch("/api/series/99999", json={"level": "podstawa"}).status_code == 404)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

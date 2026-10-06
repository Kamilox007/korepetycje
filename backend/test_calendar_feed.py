"""Regression: the public, token-gated .ics feed used for Google Calendar's
"subscribe from URL".

Covers that the token is issued lazily and works with no session at all (the
whole point -- Google's server fetches it unauthenticated), that it only ever
shows the one tutor's own lessons, that cancelled lessons and lessons outside
the feed's horizon are left out, that regenerating the token kills the old
URL, and that a wrong token is refused.
"""
import sys, pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap, login_admin, first_login
bootstrap()

from datetime import date, timedelta
from fastapi.testclient import TestClient
from app.main import app

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


ADMIN_PW = "FeedAdmin123!"
TUTOR_PW = "FeedTutor123!"
TUTOR2_PW = "FeedTutor2123!"

today = date.today()

with TestClient(app) as admin:
    login_admin(admin, ADMIN_PW)

    r = admin.post("/api/users", json={
        "username": "feedtutor", "password": TUTOR_PW, "role": "tutor", "display_name": "Feed Tutor",
    })
    tutor_id = r.json()["id"]
    r2 = admin.post("/api/users", json={
        "username": "feedtutor2", "password": TUTOR2_PW, "role": "tutor", "display_name": "Other Tutor",
    })
    tutor2_id = r2.json()["id"]

    check("admin (not a plain tutor account) is refused the feed endpoint",
          admin.get("/api/me/calendar-feed").status_code == 403)

    sid = admin.post("/api/students", json={"name": "Uczeń Feed", "default_price": 80}).json()["id"]

    in_range = admin.post("/api/lessons", json={
        "student_id": sid, "date": str(today + timedelta(days=3)),
        "start_time": "10:00:00", "price": 80, "assigned_tutor_id": tutor_id,
    }).json()
    cancelled = admin.post("/api/lessons", json={
        "student_id": sid, "date": str(today + timedelta(days=4)),
        "start_time": "10:00:00", "price": 80, "assigned_tutor_id": tutor_id,
    }).json()
    admin.patch(f"/api/lessons/{cancelled['id']}", json={"cancelled": True})
    out_of_range = admin.post("/api/lessons", json={
        "student_id": sid, "date": str(today + timedelta(days=400)),
        "start_time": "10:00:00", "price": 80, "assigned_tutor_id": tutor_id,
    }).json()
    other_tutors = admin.post("/api/lessons", json={
        "student_id": sid, "date": str(today + timedelta(days=3)),
        "start_time": "12:00:00", "price": 80, "assigned_tutor_id": tutor2_id,
    }).json()

    with TestClient(app) as tutor:
        first_login(tutor, "feedtutor", TUTOR_PW, "FeedTutorOwn1!")

        r = tutor.get("/api/me/calendar-feed")
        check("tutor gets a feed path -> 200", r.status_code == 200)
        path1 = r.json()["path"]
        check("path looks like an .ics URL", path1.startswith("/api/calendar/") and path1.endswith(".ics"))

        r2 = tutor.get("/api/me/calendar-feed")
        check("the token is stable across calls", r2.json()["path"] == path1)

    # --- the feed itself needs no session at all ---
    ics = admin.get(path1)
    check("feed fetch with no auth -> 200", ics.status_code == 200)
    check("content type is text/calendar", "text/calendar" in ics.headers.get("content-type", ""))
    body = ics.text
    check("the in-range lesson's student is in the feed", "Uczeń Feed" in body)
    check("the in-range lesson's UID is present", f"lesson-{in_range['id']}@" in body)
    check("the cancelled lesson is excluded", f"lesson-{cancelled['id']}@" not in body)
    check("the out-of-horizon lesson is excluded", f"lesson-{out_of_range['id']}@" not in body)
    check("the other tutor's lesson is excluded", f"lesson-{other_tutors['id']}@" not in body)

    check("an unknown token -> 404", admin.get("/api/calendar/not-a-real-token.ics").status_code == 404)

    # --- regenerating kills the old URL ---
    with TestClient(app) as tutor:
        tutor.post("/api/auth/login", data={"username": "feedtutor", "password": "FeedTutorOwn1!"})
        r = tutor.post("/api/me/calendar-feed/regenerate")
        check("regenerate -> 200", r.status_code == 200)
        path2 = r.json()["path"]
        check("regenerating actually changes the path", path2 != path1)

    check("the old URL no longer works", admin.get(path1).status_code == 404)
    check("the new URL works", admin.get(path2).status_code == 200)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

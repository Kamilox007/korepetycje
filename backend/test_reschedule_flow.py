"""Regression: the reschedule request round trip, student -> tutor/staff -> lesson.

A request is the one place where a student's action moves a lesson, so the two
things worth pinning down are that it only ever reaches their own lesson, and
that a decision is final — approving twice would move the lesson a second time
and quietly overwrite a slot somebody has since agreed on.
"""
import sys, pathlib
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def account(username, password):
    """Client logged in and past the forced password change."""
    c = TestClient(app)
    c.__enter__()
    c.post("/api/auth/login", data={"username": username, "password": "StartPass123!"})
    c.post("/api/auth/change-password", json={
        "old_password": "StartPass123!", "new_password": password, "accept_privacy": True,
    })
    return c


DAY = date.today() + timedelta(days=5)
NEW_DAY = date.today() + timedelta(days=7)

with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })

    for username, name in (("ewa", "Ewa"), ("olek", "Olek")):
        admin.post("/api/users", json={
            "username": username, "password": "StartPass123!", "role": "tutor",
            "display_name": name,
        })
    ewa = account("ewa", "EwaPass123!")
    olek = account("olek", "OlekPass123!")
    ewa_id = ewa.get("/api/auth/me").json()["id"]
    olek_id = olek.get("/api/auth/me").json()["id"]

    ala = admin.post("/api/students", json={"name": "Ala", "default_price": 80}).json()["id"]
    bob = admin.post("/api/students", json={"name": "Bob", "default_price": 80}).json()["id"]

    def lesson(student_id, tutor_id, hour):
        return admin.post("/api/lessons", json={
            "student_id": student_id, "date": str(DAY),
            "start_time": f"{hour:02d}:00:00", "price": 80,
            "assigned_tutor_id": tutor_id,
        }).json()["id"]

    ala_ewa = lesson(ala, ewa_id, 10)
    ala_olek = lesson(ala, olek_id, 12)
    bob_lesson = lesson(bob, olek_id, 14)

    admin.post(f"/api/students/{ala}/account",
               json={"username": "ala", "password": "StartPass123!"})
    student = account("ala", "AlaPass123!")

    # --- creating a request ---
    r = student.post("/api/me/reschedule-requests", json={
        "lesson_id": ala_ewa, "proposed_date": str(NEW_DAY),
        "proposed_time": "18:00:00", "message": "kolizja z klasówką",
    })
    check("student creates a request for their own lesson -> 200", r.status_code == 200)
    req = r.json()
    check("request starts pending", req["status"] == "pending")
    check("the proposal is stored as sent", req["proposed_date"] == str(NEW_DAY))

    check("a request for somebody else's lesson -> 404",
          student.post("/api/me/reschedule-requests",
                       json={"lesson_id": bob_lesson}).status_code == 404)
    check("a request for a lesson that does not exist -> 404",
          student.post("/api/me/reschedule-requests",
                       json={"lesson_id": 99999}).status_code == 404)
    check("the rejected attempts left nothing behind",
          len(student.get("/api/me/reschedule-requests").json()) == 1)

    # --- who gets to see it ---
    staff_view = admin.get("/api/reschedule-requests").json()
    check("staff see the request", [x["id"] for x in staff_view] == [req["id"]])
    check("the listing names the student and the current slot",
          staff_view[0]["student_name"] == "Ala"
          and staff_view[0]["lesson_date"] == str(DAY)
          and staff_view[0]["lesson_time"] == "10:00:00")
    check("the tutor teaching the lesson sees it",
          [x["id"] for x in ewa.get("/api/tutor/reschedule-requests").json()] == [req["id"]])
    check("a tutor who does not teach it does not",
          olek.get("/api/tutor/reschedule-requests").json() == [])

    # --- deciding ---
    check("the wrong tutor cannot approve it -> 404",
          olek.post(f"/api/tutor/reschedule-requests/{req['id']}/approve").status_code == 404)
    check("nor reject it -> 404",
          olek.post(f"/api/tutor/reschedule-requests/{req['id']}/reject").status_code == 404)
    check("the lesson has not moved",
          next(l for l in admin.get("/api/lessons").json()
               if l["id"] == ala_ewa)["date"] == str(DAY))

    r = ewa.post(f"/api/tutor/reschedule-requests/{req['id']}/approve",
                 json={"response": "ok, do zobaczenia"})
    check("the assigned tutor approves -> 200", r.status_code == 200)
    moved = r.json()
    check("the lesson took the proposed date", moved["date"] == str(NEW_DAY))
    check("and the proposed time", moved["start_time"] == "18:00:00")
    check("the lesson is flagged as manually moved", moved["rescheduled"] is True)
    check("the student sees the decision and the reply",
          student.get("/api/me/reschedule-requests").json()[0]["status"] == "approved"
          and student.get("/api/me/reschedule-requests").json()[0]["response"] == "ok, do zobaczenia")

    check("approving a second time -> 400",
          ewa.post(f"/api/tutor/reschedule-requests/{req['id']}/approve").status_code == 400)
    check("rejecting an already approved request -> 400",
          admin.post(f"/api/reschedule-requests/{req['id']}/reject").status_code == 400)

    # --- rejection, decided by staff this time ---
    second = student.post("/api/me/reschedule-requests", json={
        "lesson_id": ala_olek, "proposed_date": str(NEW_DAY),
    }).json()
    r = admin.post(f"/api/reschedule-requests/{second['id']}/reject",
                   json={"response": "wtedy nie mogę"})
    check("staff reject any request, not just their own students' -> 200", r.status_code == 200)
    after = {x["id"]: x for x in student.get("/api/me/reschedule-requests").json()}
    check("the request is marked rejected", after[second["id"]]["status"] == "rejected")
    check("with the reason attached", after[second["id"]]["response"] == "wtedy nie mogę")
    check("a rejected request leaves the lesson where it was",
          next(l for l in admin.get("/api/lessons").json()
               if l["id"] == ala_olek)["date"] == str(DAY))

    # --- a request that proposes nothing ("please move this, you pick") ---
    third = student.post("/api/me/reschedule-requests",
                         json={"lesson_id": ala_olek, "message": "proszę o inny termin"}).json()
    lesson_before = next(l for l in admin.get("/api/lessons").json() if l["id"] == ala_olek)
    r = admin.post(f"/api/reschedule-requests/{third['id']}/approve")
    check("approving an open-ended request -> 200", r.status_code == 200)
    check("the date is left alone when nothing was proposed",
          r.json()["date"] == lesson_before["date"]
          and r.json()["start_time"] == lesson_before["start_time"])

    check("an unknown request id -> 404",
          admin.post("/api/reschedule-requests/99999/approve").status_code == 404)

    ewa.__exit__(None, None, None)
    olek.__exit__(None, None, None)
    student.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

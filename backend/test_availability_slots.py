"""Regression: tutor availability and the free slots offered to a student.

`subtract_busy` is the arithmetic behind the slot list a student picks from, and
an off-by-one there offers a time the tutor is already teaching. The interval
maths is checked directly, then once more through the endpoint, where the lesson
being rescheduled must not count as blocking its own slot.
"""
import sys, pathlib
from datetime import date, timedelta

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app.services import subtract_busy

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


# ===================== interval arithmetic =====================
check("nothing busy leaves the whole window",
      subtract_busy(600, 720, []) == [(600, 720)])
check("a busy block outside the window changes nothing",
      subtract_busy(600, 720, [(400, 500), (800, 900)]) == [(600, 720)])
check("a block in the middle splits the window in two",
      subtract_busy(600, 720, [(630, 660)]) == [(600, 630), (660, 720)])
check("a block covering the window leaves nothing",
      subtract_busy(600, 720, [(540, 780)]) == [])
check("a block touching the start trims the front",
      subtract_busy(600, 720, [(600, 640)]) == [(640, 720)])
check("a block touching the end trims the back",
      subtract_busy(600, 720, [(680, 720)]) == [(600, 680)])
check("adjacent blocks do not eat into the window",
      subtract_busy(600, 720, [(560, 600), (720, 760)]) == [(600, 720)])
check("several blocks cut several holes",
      subtract_busy(600, 780, [(620, 640), (700, 720)])
      == [(600, 620), (640, 700), (720, 780)])
check("overlapping blocks collapse into one hole",
      subtract_busy(600, 780, [(620, 700), (660, 740)]) == [(600, 620), (740, 780)])
check("blocks given out of order are still subtracted",
      subtract_busy(600, 780, [(700, 720), (620, 640)])
      == [(600, 620), (640, 700), (720, 780)])
check("a leftover shorter than a minute is dropped",
      subtract_busy(600, 720, [(600, 719.5)]) == [])


# ===================== through the API =====================
DAY = date.today() + timedelta(days=3)
WEEKDAY = DAY.weekday()


def account(username, password):
    c = TestClient(app)
    c.__enter__()
    c.post("/api/auth/login", data={"username": username, "password": "StartPass123!"})
    c.post("/api/auth/change-password", json={
        "old_password": "StartPass123!", "new_password": password, "accept_privacy": True,
    })
    return c


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

    # --- availability is per tutor ---
    check("a tutor starts with no availability", ewa.get("/api/tutor/availability").json() == [])
    late = ewa.post("/api/tutor/availability", json={
        "weekday": WEEKDAY, "start_time": "16:00:00", "end_time": "18:00:00"}).json()
    early = ewa.post("/api/tutor/availability", json={
        "weekday": WEEKDAY, "start_time": "10:00:00", "end_time": "12:00:00"}).json()
    rows = ewa.get("/api/tutor/availability").json()
    check("both windows are saved", len(rows) == 2)
    check("returned in chronological order",
          [r["start_time"] for r in rows] == ["10:00:00", "16:00:00"])
    check("another tutor's availability is not visible",
          olek.get("/api/tutor/availability").json() == [])
    check("nor deletable by them -> 404",
          olek.delete(f"/api/tutor/availability/{early['id']}").status_code == 404)
    check("and the window survived the attempt",
          len(ewa.get("/api/tutor/availability").json()) == 2)
    check("the owner can delete it",
          ewa.delete(f"/api/tutor/availability/{late['id']}").status_code == 200)
    check("deleting the same row twice -> 404",
          ewa.delete(f"/api/tutor/availability/{late['id']}").status_code == 404)
    check("one window left", [r["id"] for r in ewa.get("/api/tutor/availability").json()] == [early["id"]])

    # --- slots offered to a student ---
    ala = admin.post("/api/students", json={"name": "Ala", "default_price": 80}).json()["id"]
    bob = admin.post("/api/students", json={"name": "Bob", "default_price": 80}).json()["id"]

    def lesson(student_id, tutor_id, start, day=DAY):
        return admin.post("/api/lessons", json={
            "student_id": student_id, "date": str(day), "start_time": start,
            "duration_min": 60, "price": 80, "assigned_tutor_id": tutor_id,
        }).json()

    ala_lesson = lesson(ala, ewa_id, "10:00:00")
    unassigned = lesson(ala, None, "09:00:00")
    olek_lesson = lesson(ala, olek_id, "13:00:00")
    bob_lesson = lesson(bob, ewa_id, "11:00:00")

    admin.post(f"/api/students/{ala}/account",
               json={"username": "ala", "password": "StartPass123!"})
    student = account("ala", "AlaPass123!")

    check("slots for somebody else's lesson -> 404",
          student.get(f"/api/me/lessons/{bob_lesson['id']}/available-slots").status_code == 404)
    check("slots for a lesson that does not exist -> 404",
          student.get("/api/me/lessons/99999/available-slots").status_code == 404)

    data = student.get(f"/api/me/lessons/{unassigned['id']}/available-slots").json()
    check("an unassigned lesson has nothing to offer", data["has_tutor"] is False)
    check("and names no tutor", data["tutor_name"] is None)

    data = student.get(f"/api/me/lessons/{olek_lesson['id']}/available-slots").json()
    check("a tutor with no availability offers nothing", data["has_tutor"] is False)
    check("but is still named, so the student knows who to ask", data["tutor_name"] == "Olek")

    # Bob's 11:00-12:00 lesson blocks the second half of Ewa's 10:00-12:00 window;
    # Ala's own 10:00 lesson is the one being moved, so it must not block itself.
    data = student.get(f"/api/me/lessons/{ala_lesson['id']}/available-slots").json()
    check("the assigned tutor's free time is offered", data["has_tutor"] is True)
    check("named", data["tutor_name"] == "Ewa")
    check("only days matching the declared weekday come back",
          data["days"] and all(d["weekday"] == WEEKDAY for d in data["days"]))
    day = next(d for d in data["days"] if d["date"] == str(DAY))
    check("the window stops where the other student's lesson starts",
          day["windows"] == [{"start": "10:00", "end": "11:00"}])
    check("the lesson being rescheduled does not block its own slot",
          day["slots"] == ["10:00"])

    # A second lesson at 10:00 leaves no hour-long gap at all that day.
    blocker = lesson(bob, ewa_id, "10:00:00")
    data = student.get(f"/api/me/lessons/{ala_lesson['id']}/available-slots").json()
    check("a fully booked day drops out of the list",
          all(d["date"] != str(DAY) for d in data["days"]))
    check("later weeks are still offered", len(data["days"]) >= 1)

    # Cancelling it frees the time again.
    admin.patch(f"/api/lessons/{blocker['id']}", json={"cancelled": True})
    data = student.get(f"/api/me/lessons/{ala_lesson['id']}/available-slots").json()
    check("a cancelled lesson stops blocking",
          any(d["date"] == str(DAY) for d in data["days"]))

    # A shorter lesson fits where an hour did not: 12:00-13:00 window, 45 min.
    ewa.post("/api/tutor/availability", json={
        "weekday": WEEKDAY, "start_time": "12:00:00", "end_time": "13:00:00"})
    short = lesson(ala, ewa_id, "12:00:00")
    admin.patch(f"/api/lessons/{short['id']}", json={"duration_min": 45})
    data = student.get(f"/api/me/lessons/{short['id']}/available-slots").json()
    day = next(d for d in data["days"] if d["date"] == str(DAY))
    check("start times are offered every half hour while the lesson still fits",
          "12:00" in day["slots"] and "12:30" not in day["slots"])

    ewa.__exit__(None, None, None)
    olek.__exit__(None, None, None)
    student.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

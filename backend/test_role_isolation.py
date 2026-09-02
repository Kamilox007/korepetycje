"""Regression: the tutor-scoped endpoints really are scoped, and the role gates hold.

The schema is split by tutor (migration 0007), but a filter that reads the wrong
one of `tutor_id` / `assigned_tutor_id` still returns rows — it just returns
somebody else's. Nothing about the response shape gives that away, so the leak is
only visible with two tutors in the database, which is what this sets up.
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


def make_tutor(admin, username, display_name, password):
    """Create a tutor and hand back a client already past the forced change."""
    admin.post("/api/users", json={
        "username": username, "password": "StartPass123!", "role": "tutor",
        "display_name": display_name,
    })
    c = TestClient(app)
    c.__enter__()
    c.post("/api/auth/login", data={"username": username, "password": "StartPass123!"})
    c.post("/api/auth/change-password", json={
        "old_password": "StartPass123!", "new_password": password, "accept_privacy": True,
    })
    return c


DAY = date.today() + timedelta(days=2)

with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })

    ewa = make_tutor(admin, "ewa", "Ewa", "EwaPass123!")
    olek = make_tutor(admin, "olek", "Olek", "OlekPass123!")
    ewa_id = ewa.get("/api/auth/me").json()["id"]
    olek_id = olek.get("/api/auth/me").json()["id"]

    # Three students: one per tutor, plus one they share. The shared one is the
    # interesting case — filtering by student is not enough, the figures
    # themselves have to be split.
    ala = admin.post("/api/students", json={"name": "Ala Ewy", "default_price": 80}).json()["id"]
    bob = admin.post("/api/students", json={"name": "Bob Olka", "default_price": 90}).json()["id"]
    cyn = admin.post("/api/students", json={"name": "Cyn Wspolna", "default_price": 100}).json()["id"]

    def lesson(student_id, tutor_id, hour, price, completed=True):
        l = admin.post("/api/lessons", json={
            "student_id": student_id, "date": str(DAY),
            "start_time": f"{hour:02d}:00:00", "price": price,
            "assigned_tutor_id": tutor_id,
        }).json()
        if completed:
            admin.patch(f"/api/lessons/{l['id']}", json={"completed": True})
        return l["id"]

    ala_lesson = lesson(ala, ewa_id, 10, 80)
    bob_lesson = lesson(bob, olek_id, 12, 90)
    cyn_ewa_lesson = lesson(cyn, ewa_id, 14, 100)
    cyn_olek_lesson = lesson(cyn, olek_id, 16, 200)

    admin.post("/api/payments", json={
        "student_id": ala, "amount": 80, "date": str(date.today()), "assigned_tutor_id": ewa_id})
    admin.post("/api/payments", json={
        "student_id": bob, "amount": 90, "date": str(date.today()), "assigned_tutor_id": olek_id})
    admin.post("/api/payments", json={
        "student_id": cyn, "amount": 30, "date": str(date.today()), "assigned_tutor_id": olek_id})

    # --- lessons ---
    ewa_lessons = ewa.get("/api/tutor/lessons").json()
    check("tutor sees their own lessons only",
          {l["id"] for l in ewa_lessons} == {ala_lesson, cyn_ewa_lesson})
    check("every returned lesson is assigned to the caller",
          all(l["assigned_tutor_id"] == ewa_id for l in ewa_lessons))
    check("the other tutor sees the complementary set",
          {l["id"] for l in olek.get("/api/tutor/lessons").json()} == {bob_lesson, cyn_olek_lesson})

    check("date range narrows the tutor's own list",
          olek.get(f"/api/tutor/lessons?start={DAY + timedelta(days=1)}").json() == [])

    # --- editing somebody else's lesson ---
    r = ewa.patch(f"/api/tutor/lessons/{bob_lesson}", json={"note": "nie moje"})
    check("tutor cannot edit a lesson assigned to another tutor -> 404", r.status_code == 404)
    check("and the lesson is untouched",
          admin.get("/api/lessons").json() and
          next(l for l in admin.get("/api/lessons").json() if l["id"] == bob_lesson)["note"] != "nie moje")
    check("but can edit their own",
          ewa.patch(f"/api/tutor/lessons/{ala_lesson}", json={"note": "moje"}).status_code == 200)

    # --- payments ---
    ewa_pay = ewa.get("/api/tutor/payments").json()
    check("tutor sees only payments credited to them",
          [p["amount"] for p in ewa_pay] == [80.0])
    check("the payment recorded for the shared student goes to the other tutor",
          sorted(p["amount"] for p in olek.get("/api/tutor/payments").json()) == [30.0, 90.0])

    # --- summary ---
    ewa_sum = ewa.get("/api/tutor/summary").json()
    check("summary lists only students this tutor teaches",
          sorted(s["student_name"] for s in ewa_sum["students"]) == ["Ala Ewy", "Cyn Wspolna"])
    shared = next(s for s in ewa_sum["students"] if s["student_name"] == "Cyn Wspolna")
    check("shared student's due covers only this tutor's lessons", shared["amount_due"] == 100.0)
    check("and none of the other tutor's payments", shared["amount_paid"] == 0.0)
    check("tutor totals exclude the other tutor entirely", ewa_sum["total_due"] == 180.0)

    olek_sum = olek.get("/api/tutor/summary").json()
    check("the other tutor's totals are their own", olek_sum["total_due"] == 290.0)
    check("staff totals are the sum of both",
          admin.get("/api/summary").json()["total_due"] == 470.0)

    # --- role gates ---
    staff_only = [
        ("GET", "/api/students"), ("GET", "/api/summary"), ("GET", "/api/payments"),
        ("GET", "/api/users"), ("GET", "/api/lessons"), ("GET", "/api/series"),
        ("GET", "/api/reschedule-requests"), ("GET", "/api/tutors"),
    ]
    for method, path in staff_only:
        check(f"tutor blocked from {path} -> 403",
              ewa.request(method, path).status_code == 403)
    check("tutor blocked from creating a student -> 403",
          ewa.post("/api/students", json={"name": "X", "default_price": 10}).status_code == 403)
    check("tutor blocked from the student panel -> 403",
          ewa.get("/api/me/lessons").status_code == 403)
    check("staff blocked from the tutor panel -> 403",
          admin.get("/api/tutor/lessons").status_code == 403)

    # --- the student panel is scoped to one student ---
    admin.post(f"/api/students/{ala}/account",
               json={"username": "ala", "password": "StartPass123!"})
    with TestClient(app) as student:
        student.post("/api/auth/login", data={"username": "ala", "password": "StartPass123!"})
        student.post("/api/auth/change-password", json={
            "old_password": "StartPass123!", "new_password": "AlaPass123!", "accept_privacy": True,
        })
        mine = student.get("/api/me/lessons").json()
        check("student sees only their own lessons", [l["id"] for l in mine] == [ala_lesson])
        check("student sees only their own payments",
              [p["amount"] for p in student.get("/api/me/payments").json()] == [80.0])
        check("student summary covers that student only",
              student.get("/api/me/summary").json()["student_name"] == "Ala Ewy")
        check("student blocked from the tutor panel -> 403",
              student.get("/api/tutor/lessons").status_code == 403)
        check("student blocked from staff endpoints -> 403",
              student.get("/api/students").status_code == 403)

    ewa.__exit__(None, None, None)
    olek.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

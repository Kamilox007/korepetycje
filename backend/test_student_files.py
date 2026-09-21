"""Regression: student materials (PDF) and the student's view of their boards.

A tutor may hand files only to students in their scope; a student sees only
their own files and only boards attached to them; type is checked by
content; purging a student takes the files with them (and the disk copy,
unless shared).
"""
import sys, pathlib, tempfile

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap

FILES_DIR = tempfile.mkdtemp(prefix="student-files-")
bootstrap(BOARD_FILES_PATH=FILES_DIR, STUDENT_FILE_MAX_MB="1", STUDENT_FILES_MAX_TOTAL_MB="2")

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n" + b"\x00" * 100
PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"\x00" * 100


def upload(client, student_id, data, filename="zadania.pdf", content_type="application/pdf"):
    return client.post(f"/api/students/{student_id}/files", files={"file": (filename, data, content_type)})


def make_user(admin, username, role, password):
    admin.post("/api/users", json={"username": username, "password": "StartPass123!", "role": role,
                                   "display_name": username.title()})
    c = TestClient(app)
    c.__enter__()
    c.post("/api/auth/login", data={"username": username, "password": "StartPass123!"})
    c.post("/api/auth/change-password", json={"old_password": "StartPass123!", "new_password": password,
                                              "accept_privacy": True})
    return c


def files_on_disk():
    return sorted(p for p in pathlib.Path(FILES_DIR).rglob("*") if p.is_file())


with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={"old_password": "admin", "new_password": "AdminPass123!",
                                                  "accept_privacy": True})
    ewa = make_user(admin, "ewa", "tutor", "EwaPass123!")
    olek = make_user(admin, "olek", "tutor", "OlekPass123!")
    ewa_id = ewa.get("/api/auth/me").json()["id"]

    ala = admin.post("/api/students", json={"name": "Ala", "default_price": 80}).json()["id"]
    bob = admin.post("/api/students", json={"name": "Bob", "default_price": 80}).json()["id"]
    admin.post("/api/lessons", json={"student_id": ala, "date": "2026-10-01", "start_time": "10:00:00",
                                     "price": 80, "assigned_tutor_id": ewa_id})

    # --- upload and scope ---
    r = upload(admin, ala, PDF)
    check("staff uploads a PDF", r.status_code == 200 and r.json()["mime"] == "application/pdf")
    check("name comes from the filename", r.json()["name"] == "zadania.pdf")
    check("uploader is recorded", r.json()["uploaded_by_name"] == "Administrator")
    f1 = r.json()["id"]
    r = upload(ewa, ala, PDF + b"x", filename="C:\\Users\\ewa\\rozw..pdf")
    check("tutor with a lesson uploads too", r.status_code == 200)
    check("path parts are stripped from the name", r.json()["name"] == "rozw..pdf")
    f2 = r.json()["id"]
    check("tutor without a lesson with the student -> 404", upload(olek, ala, PDF).status_code == 404)
    check("...and cannot list either", olek.get(f"/api/students/{ala}/files").status_code == 404)
    check("staff lists both", [f["id"] for f in admin.get(f"/api/students/{ala}/files").json()] == [f2, f1])
    r = upload(admin, ala, PDF, filename="bez-rozszerzenia")
    check("a .pdf suffix is added when missing", r.json()["name"] == "bez-rozszerzenia.pdf")

    # --- type by content ---
    check("PNG with a pdf header is refused (415)",
          upload(admin, ala, PNG, filename="x.pdf").status_code == 415)
    check("PDF with a wrong header is accepted by its bytes",
          upload(admin, bob, PDF, filename="x.bin", content_type="application/octet-stream").status_code == 200)
    check("empty file refused", upload(admin, ala, b"").status_code == 400)

    # --- limits ---
    check("over the per-file limit -> 413", upload(admin, ala, PDF + b"\x00" * (1024 * 1024)).status_code == 413)
    chunk = PDF + b"\x01" * (900 * 1024)
    check("first big file fits", upload(admin, bob, chunk).status_code == 200)
    check("second fits", upload(admin, bob, chunk + b"\x02").status_code == 200)
    check("third exceeds the student's quota -> 413", upload(admin, bob, chunk + b"\x03").status_code == 413)

    # --- content ---
    r = admin.get(f"/api/students/{ala}/files/{f1}/content")
    check("staff downloads the content", r.status_code == 200 and r.content == PDF)
    check("...served as pdf, inline, nosniff",
          r.headers["content-type"].startswith("application/pdf")
          and r.headers["content-disposition"].startswith("inline")
          and r.headers.get("x-content-type-options") == "nosniff")
    check("file id under another student -> 404",
          admin.get(f"/api/students/{bob}/files/{f1}/content").status_code == 404)

    # --- the student's own view ---
    admin.post(f"/api/students/{ala}/account", json={"username": "ala", "password": "StartPass123!"})
    board = ewa.post("/api/boards", json={"title": "Ala - tablica", "student_id": ala}).json()
    other = ewa.post("/api/boards", json={"title": "Cudza"}).json()
    archived = ewa.post("/api/boards", json={"title": "Stara", "student_id": ala}).json()
    ewa.delete(f"/api/boards/{archived['id']}")
    with TestClient(app) as student:
        student.post("/api/auth/login", data={"username": "ala", "password": "StartPass123!"})
        student.post("/api/auth/change-password", json={"old_password": "StartPass123!",
                                                        "new_password": "AlaPass123!", "accept_privacy": True})
        mine = student.get("/api/me/files").json()
        check("student sees their own files", sorted(f["id"] for f in mine) == sorted([f1, f2, mine[0]["id"]])
              if len(mine) == 3 else False)
        check("student downloads their file",
              student.get(f"/api/me/files/{f1}/content").content == PDF)
        bob_file = admin.get(f"/api/students/{bob}/files").json()[0]["id"]
        check("student cannot reach another student's file -> 404",
              student.get(f"/api/me/files/{bob_file}/content").status_code == 404)
        check("student cannot upload -> 403",
              student.post(f"/api/students/{ala}/files", files={"file": ("x.pdf", PDF, "application/pdf")}).status_code == 403)
        boards = student.get("/api/me/boards").json()
        check("student sees only boards attached to them, live ones",
              [b["id"] for b in boards] == [board["id"]])
        check("...with the link and page count",
              boards[0]["path"] == board["path"] and boards[0]["page_count"] == 1)
        check("student cannot reach the staff file listing -> 403",
              student.get(f"/api/students/{ala}/files").status_code == 403)

    # --- delete and dedup ---
    before = len(files_on_disk())
    check("tutor deletes a file they can see", ewa.delete(f"/api/students/{ala}/files/{f2}").status_code == 200)
    # f2's bytes were unique (PDF + "x"), so the disk copy goes with the record.
    check("deleted unique content is gone from disk", len(files_on_disk()) == before - 1)
    before = len(files_on_disk())
    check("staff deletes a file whose bytes another record shares",
          admin.delete(f"/api/students/{ala}/files/{f1}").status_code == 200)
    check("...and the shared disk copy stays (bob's record points at it)", len(files_on_disk()) == before)
    f1 = None
    check("deleting again -> 404", ewa.delete(f"/api/students/{ala}/files/{f2}").status_code == 404)

    # --- purge student ---
    admin.delete(f"/api/students/{ala}")
    admin.delete(f"/api/students/{ala}/purge")
    db = SessionLocal()
    left = db.query(models.StudentFile).filter(models.StudentFile.student_id == ala).count()
    db.close()
    check("purging the student removes their file records", left == 0)
    check("shared PDF bytes survive (bob still has them)",
          admin.get(f"/api/students/{bob}/files/{bob_file}/content").status_code == 200)

    ewa.__exit__(None, None, None)
    olek.__exit__(None, None, None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

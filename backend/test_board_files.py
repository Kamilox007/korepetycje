"""Regression: board images live on disk, not in the database, and are checked
by content.

A pasted photo must never land in the SQLite file (it would ride into every
Litestream snapshot), the type must come from the bytes and not from the
client's header, identical uploads must share one file, nothing the client
sends may become part of a filesystem path, and one board cannot eat the
disk.
"""
import sys, pathlib, tempfile, hashlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap

FILES_DIR = tempfile.mkdtemp(prefix="board-files-")
bootstrap(BOARD_FILES_PATH=FILES_DIR, BOARD_MAX_FILE_MB="1", BOARD_MAX_TOTAL_MB="2")

from fastapi.testclient import TestClient
from app.main import app
from app.database import SessionLocal
from app import models, boards_files

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


PNG = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) + b"\x00" * 100
JPEG = bytes([0xFF, 0xD8, 0xFF, 0xE0]) + b"\x00" * 100
GIF = b"GIF89a" + b"\x00" * 50
WEBP = b"RIFF\x00\x00\x00\x00WEBP" + b"\x00" * 50
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'


def upload(client, tok, file_id, data, filename="x.png", content_type="image/png"):
    return client.post(f"/api/t/{tok}/files",
                       files={"file": (filename, data, content_type)},
                       data={"file_id": file_id})


def files_on_disk():
    return sorted(p for p in pathlib.Path(FILES_DIR).rglob("*") if p.is_file())


with TestClient(app) as admin:
    admin.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    admin.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "AdminPass123!", "accept_privacy": True,
    })
    board = admin.post("/api/boards", json={"title": "Pliki"}).json()
    tok = board["path"].removeprefix("/t/")
    other = admin.post("/api/boards", json={"title": "Inna"}).json()
    other_tok = other["path"].removeprefix("/t/")
    guest = TestClient(app)

    # --- happy path ---
    r = upload(guest, tok, "abc123", PNG)
    check("guest uploads a PNG", r.status_code == 200 and r.json()["mime"] == "image/png")
    check("response carries the byte count", r.json()["bytes"] == len(PNG))
    sha = hashlib.sha256(PNG).hexdigest()
    check("file is on disk under its sha256, two-level fan-out",
          (pathlib.Path(FILES_DIR) / sha[:2] / sha).is_file())
    r = guest.get(f"/api/t/{tok}/files/abc123")
    check("file is served back", r.status_code == 200 and r.content == PNG)
    check("...with the sniffed content type", r.headers["content-type"].startswith("image/png"))
    check("...nosniff and long private cache",
          r.headers.get("x-content-type-options") == "nosniff" and
          "immutable" in r.headers.get("cache-control", "") and
          "private" in r.headers.get("cache-control", ""))
    db = SessionLocal()
    row = db.query(models.BoardFile).filter(models.BoardFile.file_id == "abc123").one()
    db.close()
    check("the database holds metadata only (no bytes column)",
          not hasattr(row, "data") and row.sha256 == sha and row.bytes == len(PNG))

    # --- type comes from the content ---
    r = upload(guest, tok, "fakepng", b"not an image at all", "x.png", "image/png")
    check("wrong content with a matching header is refused (415)", r.status_code == 415)
    r = upload(guest, tok, "svg1", SVG, "x.svg", "image/svg+xml")
    check("SVG is refused even with an image/* header", r.status_code == 415)
    r = upload(guest, tok, "jpg1", JPEG, "x.bin", "application/octet-stream")
    check("a JPEG with a wrong header is accepted by its bytes", r.json()["mime"] == "image/jpeg")
    check("GIF accepted", upload(guest, tok, "gif1", GIF).json()["mime"] == "image/gif")
    check("WebP accepted", upload(guest, tok, "webp1", WEBP).json()["mime"] == "image/webp")
    check("empty file refused", upload(guest, tok, "empty", b"").status_code == 400)

    # --- ids and paths ---
    r = upload(guest, tok, "../../etc/passwd", PNG)
    check("a file_id that looks like a path is refused", r.status_code == 400)
    check("nothing escaped the files directory",
          all(str(p).startswith(FILES_DIR) for p in files_on_disk()))
    try:
        boards_files.path_for("../x")
        check("path_for refuses anything but a sha256", False)
    except ValueError:
        check("path_for refuses anything but a sha256", True)
    check("unknown file_id -> 404", guest.get(f"/api/t/{tok}/files/nope").status_code == 404)
    check("file of another board under this token -> 404",
          guest.get(f"/api/t/{other_tok}/files/abc123").status_code == 404)
    check("unknown token -> 404", guest.get("/api/t/zly/files/abc123").status_code == 404)

    # --- dedup and idempotence ---
    before = len(files_on_disk())
    r = upload(guest, tok, "abc123", JPEG)
    check("re-uploading an existing file_id is a no-op (keeps the first)",
          r.status_code == 200 and r.json()["mime"] == "image/png")
    r = upload(guest, other_tok, "same-bytes", PNG)
    check("the same bytes on another board -> one file on disk",
          r.status_code == 200 and len(files_on_disk()) == before)
    db = SessionLocal()
    n = db.query(models.BoardFile).filter(models.BoardFile.sha256 == sha).count()
    db.close()
    check("...but two records", n == 2)

    # --- limits ---
    big = PNG + b"\x00" * (1024 * 1024)
    check("a file over the per-file limit -> 413", upload(guest, tok, "big", big).status_code == 413)
    # quota: 2 MB total; fill it with ~0.9 MB files
    chunk = PNG + b"\x01" * (900 * 1024)
    check("first big-ish file fits", upload(guest, tok, "q1", chunk).status_code == 200)
    chunk2 = PNG + b"\x02" * (900 * 1024)
    check("second fits", upload(guest, tok, "q2", chunk2).status_code == 200)
    chunk3 = PNG + b"\x03" * (900 * 1024)
    check("third exceeds the board quota -> 413", upload(guest, tok, "q3", chunk3).status_code == 413)
    check("the quota is per board: another board still accepts",
          upload(guest, other_tok, "q3", chunk3).status_code == 200)

    # --- purge removes files, but not ones another board still uses ---
    admin.delete(f"/api/boards/{board['id']}")
    disk_before = set(files_on_disk())
    r = admin.delete(f"/api/boards/{board['id']}/purge")
    check("purge succeeds", r.status_code == 200)
    check("shared file (same sha on the other board) survives the purge",
          (pathlib.Path(FILES_DIR) / sha[:2] / sha).is_file())
    jpeg_sha = hashlib.sha256(JPEG).hexdigest()
    check("a file only this board used is gone from disk",
          not (pathlib.Path(FILES_DIR) / jpeg_sha[:2] / jpeg_sha).exists())
    db = SessionLocal()
    left = db.query(models.BoardFile).filter(models.BoardFile.board_id == board["id"]).count()
    db.close()
    check("purge removed the file records explicitly", left == 0)
    check("the other board's file still serves",
          guest.get(f"/api/t/{other_tok}/files/same-bytes").status_code == 200)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

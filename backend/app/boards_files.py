"""Content-addressed file store on disk: board images and student materials.

Bytes never go into the database (see README, "Decyzje projektowe"): the path
is derived from the sha256 of the content, so nothing supplied by a client
ever becomes part of a filesystem path, and identical uploads share one file
- across boards and students alike, which is why the orphan check below
looks at every table that references the store.
"""
import hashlib
import os
import re
import tempfile
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from . import models

# Sits on the same volume as the database by default: one directory to back
# up. Not covered by Litestream - see the TODO in README.
FILES_PATH = Path(os.environ.get("BOARD_FILES_PATH", "/data/board_files"))
MAX_FILE_BYTES = int(os.environ.get("BOARD_MAX_FILE_MB", "10")) * 1024 * 1024
MAX_TOTAL_BYTES = int(os.environ.get("BOARD_MAX_TOTAL_MB", "200")) * 1024 * 1024


def path_for(sha256: str) -> Path:
    """{FILES_PATH}/{sha[:2]}/{sha}. Two-level fan-out keeps directories small."""
    if len(sha256) != 64 or any(c not in "0123456789abcdef" for c in sha256):
        raise ValueError("sha256 has to be 64 lowercase hex chars")
    return FILES_PATH / sha256[:2] / sha256


def remove_if_orphaned(db: Session, sha256: str) -> bool:
    """Delete the disk file unless another record still points at it.

    Call after the owning BoardFile rows are deleted (and flushed), otherwise
    the caller's own rows keep the file alive.
    """
    still_used = (
        db.query(models.BoardFile.id).filter(models.BoardFile.sha256 == sha256).first()
        or db.query(models.StudentFile.id).filter(models.StudentFile.sha256 == sha256).first()
    )
    if still_used:
        return False
    try:
        path_for(sha256).unlink(missing_ok=True)
    except OSError:
        # A file that is already gone is not worth failing the purge over.
        return False
    return True


PNG_MAGIC = bytes([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A])
JPEG_MAGIC = bytes([0xFF, 0xD8, 0xFF])

# Excalidraw file ids are hex strings; be a little more lenient, never a path.
FILE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,120}$")

# Only what a homework photo can be. SVG is deliberately absent (it can carry
# script and needs its own serving headers) - add it later if ever needed.
ALLOWED_MIME = {"image/png", "image/jpeg", "image/gif", "image/webp"}


# Student materials: PDF only for now (worksheets, solutions). Generous per-file
# limit - a scanned worksheet can be a few MB - and a quota per student.
STUDENT_FILE_MAX_BYTES = int(os.environ.get("STUDENT_FILE_MAX_MB", "20")) * 1024 * 1024
STUDENT_FILES_MAX_TOTAL_BYTES = int(os.environ.get("STUDENT_FILES_MAX_TOTAL_MB", "300")) * 1024 * 1024
PDF_MAGIC = b"%PDF-"


def sniff_mime(data: bytes) -> str | None:
    """MIME from the bytes themselves, never from the client's header."""
    if data.startswith(PDF_MAGIC):
        return "application/pdf"
    if data.startswith(PNG_MAGIC):
        return "image/png"
    if data.startswith(JPEG_MAGIC):
        return "image/jpeg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


async def read_upload(file, *, max_bytes: int, allowed: set[str], wrong_type: str) -> tuple[bytes, str]:
    """Read an UploadFile within a size limit and check its type by content.

    Returns (bytes, mime). Raises the same HTTP errors for every upload
    endpoint, so a board image and a student PDF fail the same way.
    """
    data = await file.read(max_bytes + 1)
    if len(data) > max_bytes:
        raise HTTPException(413, f"Plik przekracza {max_bytes // (1024 * 1024)} MB")
    if not data:
        raise HTTPException(400, "Pusty plik")
    mime = sniff_mime(data)
    if mime not in allowed:
        raise HTTPException(415, wrong_type)
    return data, mime


def board_usage(db: Session, board_id: int) -> int:
    return db.query(func.coalesce(func.sum(models.BoardFile.bytes), 0)).filter(
        models.BoardFile.board_id == board_id
    ).scalar()


def store_bytes(data: bytes) -> str:
    """Write content-addressed; returns the sha256. A second identical upload
    finds the file already there and writes nothing."""
    sha = hashlib.sha256(data).hexdigest()
    target = path_for(sha)
    if target.exists():
        return sha
    target.parent.mkdir(parents=True, exist_ok=True)
    # Temp file + rename: a crash mid-write must not leave a truncated file
    # under the final name, which would then be trusted forever.
    fd, tmp = tempfile.mkstemp(dir=target.parent, prefix=".upload-")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(data)
        os.replace(tmp, target)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise
    return sha

"""Pasted board images on disk.

Bytes never go into the database (see README, "Decyzje projektowe"): the path
is derived from the sha256 of the content, so nothing supplied by a client
ever becomes part of a filesystem path, and identical uploads share one file.
"""
import os
from pathlib import Path

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
    still_used = db.query(models.BoardFile.id).filter(models.BoardFile.sha256 == sha256).first()
    if still_used:
        return False
    try:
        path_for(sha256).unlink(missing_ok=True)
    except OSError:
        # A file that is already gone is not worth failing the purge over.
        return False
    return True

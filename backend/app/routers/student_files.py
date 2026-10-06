"""Student materials (PDF) and the student's own view of boards and files.

Two audiences on one router:
  - staff and tutors manage files under /api/students/{id}/files (a tutor
    only for students in their scope - same rule as attaching a board),
  - the student reads their own under /api/me/files and lists the boards
    attached to them under /api/me/boards.

Bytes go through the same content-addressed store as board images
(boards_files.py); the row is metadata. PDF only, checked by signature.
"""
import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy import func
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from .. import models, schemas, auth, boards_files
from ..database import get_db
from .boards import require_board_manager, resolve_student_for, board_path, page_counts, student_for_user

router = APIRouter(prefix="/api", tags=["student-files"])

ALLOWED_MIME = {"application/pdf"}


def _clean_name(raw: str | None) -> str:
    """Display name from the upload's filename: no path, no control chars,
    a sane length, and a .pdf suffix so the download has one."""
    name = (raw or "").replace("\\", "/").rsplit("/", 1)[-1]
    name = re.sub(r"[\x00-\x1f\x7f]", "", name).strip() or "dokument.pdf"
    if not name.lower().endswith(".pdf"):
        name += ".pdf"
    return name[:200]


def _usage(db: Session, student_id: int) -> int:
    return db.query(func.coalesce(func.sum(models.StudentFile.bytes), 0)).filter(
        models.StudentFile.student_id == student_id
    ).scalar()


def _out(f: models.StudentFile, db: Session) -> schemas.StudentFileOut:
    by = db.get(models.User, f.uploaded_by_user_id)
    item = schemas.StudentFileOut.model_validate(f)
    item.uploaded_by_name = by.label if by else None
    return item


def _files_of(db: Session, student: models.Student) -> list[schemas.StudentFileOut]:
    rows = (
        db.query(models.StudentFile)
        .filter(models.StudentFile.student_id == student.id)
        .order_by(models.StudentFile.created_at.desc(), models.StudentFile.id.desc())
        .all()
    )
    return [_out(f, db) for f in rows]


def _serve(f: models.StudentFile) -> FileResponse:
    path = boards_files.path_for(f.sha256)
    if not path.is_file():
        raise HTTPException(404, "Plik nie znaleziony")
    # inline: the browser opens the PDF in its viewer; the filename is still
    # there for "save as". RFC 5987 encoding for Polish letters.
    disposition = "inline; filename*=UTF-8''" + quote(f.name)
    return FileResponse(
        path, media_type=f.mime,
        headers={"Content-Disposition": disposition, "X-Content-Type-Options": "nosniff",
                 "Cache-Control": "private, max-age=3600"},
    )


# ---------------------------------------------------------------- staff / tutor

@router.get("/students/{student_id}/files", response_model=list[schemas.StudentFileOut])
def list_student_files(
    student_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    return _files_of(db, resolve_student_for(db, user, student_id))


@router.post("/students/{student_id}/files", response_model=schemas.StudentFileOut)
async def upload_student_file(
    student_id: int,
    file: UploadFile = File(...),
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    student = resolve_student_for(db, user, student_id)
    data, mime = await boards_files.read_upload(
        file, max_bytes=boards_files.STUDENT_FILE_MAX_BYTES, allowed=ALLOWED_MIME,
        wrong_type="Dozwolone są tylko pliki PDF",
    )
    if _usage(db, student.id) + len(data) > boards_files.STUDENT_FILES_MAX_TOTAL_BYTES:
        raise HTTPException(413, "Limit miejsca na materiały tego ucznia został wyczerpany")

    sha = await run_in_threadpool(boards_files.store_bytes, data)
    row = models.StudentFile(
        student_id=student.id, uploaded_by_user_id=user.id, name=_clean_name(file.filename),
        sha256=sha, mime=mime, bytes=len(data),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _out(row, db)


def _file_for(db: Session, student: models.Student, file_id: int) -> models.StudentFile:
    f = db.get(models.StudentFile, file_id)
    if not f or f.student_id != student.id:
        raise HTTPException(404, "Plik nie znaleziony")
    return f


@router.get("/students/{student_id}/files/{file_id}/content")
def get_student_file(
    student_id: int, file_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    student = resolve_student_for(db, user, student_id)
    return _serve(_file_for(db, student, file_id))


@router.delete("/students/{student_id}/files/{file_id}")
def delete_student_file(
    student_id: int, file_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    student = resolve_student_for(db, user, student_id)
    f = _file_for(db, student, file_id)
    sha = f.sha256
    db.delete(f)
    db.flush()
    boards_files.remove_if_orphaned(db, sha)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------- student

@router.get("/me/files", response_model=list[schemas.StudentFileOut])
def my_files(user: models.User = Depends(auth.require_student), db: Session = Depends(get_db)):
    return _files_of(db, student_for_user(db, user))


@router.get("/me/files/{file_id}/content")
def my_file_content(
    file_id: int, user: models.User = Depends(auth.require_student), db: Session = Depends(get_db),
):
    student = student_for_user(db, user)
    return _serve(_file_for(db, student, file_id))


@router.get("/me/boards", response_model=list[schemas.MyBoardOut])
def my_boards(user: models.User = Depends(auth.require_student), db: Session = Depends(get_db)):
    """Boards attached to this student, with their links. Access to a board is
    still the token in the link - this only saves the student the search
    through old messages for it. Archived boards stay out: their links are dead."""
    student = student_for_user(db, user)
    boards = (
        db.query(models.Board)
        .filter(models.Board.student_id == student.id, models.Board.archived_at.is_(None))
        .order_by(models.Board.updated_at.desc())
        .all()
    )
    counts = page_counts(db, [b.id for b in boards])
    return [
        schemas.MyBoardOut(id=b.id, title=b.title, path=board_path(b),
                           page_count=counts.get(b.id, 0), updated_at=b.updated_at)
        for b in boards
    ]

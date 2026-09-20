"""Panel side of the whiteboard: /api/boards, behind the role gate.

Physically separate from the public router (boards_public.py) so that nothing
reachable by a bare link ever has a dependency that resolves a logged-in
user. This one is the opposite: every endpoint needs a session.
"""
import json
import secrets
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from starlette.concurrency import run_in_threadpool
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from .. import models, schemas, auth, boards_files, boards_rooms, boards_reconcile, boards_snapshots
from ..database import get_db

router = APIRouter(prefix="/api/boards", tags=["boards"])
# The account's own library lives under /api/me so it cannot collide with
# /api/boards/{board_id}.
library_router = APIRouter(prefix="/api/me", tags=["boards"])

# A library is a handful of small drawings; anything near this is a mistake
# (or base64 in disguise).
MAX_LIBRARY_BYTES = 2 * 1024 * 1024


def require_board_manager(user: models.User = Depends(auth.require_active_user)) -> models.User:
    """Staff and tutors run boards; a student only ever gets the link."""
    if user.role not in ("admin", "secretary", "tutor"):
        raise HTTPException(status_code=403, detail="Wymagane konto korepetytora lub administracji")
    return user


def is_staff(user: models.User) -> bool:
    return user.role in ("admin", "secretary")


def visible_boards(db: Session, user: models.User):
    """Staff see every board; a tutor the ones assigned to them (or, for
    boards from before assignment existed, the ones they created).

    Deliberately NOT derived from student_id: the repo has two competing
    notions of "this tutor's student" (Student.tutor_id vs
    Lesson.assigned_tutor_id) and picking the wrong one leaks boards across
    tutors. Assignment is an explicit column, no guessing.
    """
    q = db.query(models.Board)
    if not is_staff(user):
        q = q.filter(or_(models.Board.assigned_tutor_id == user.id,
                         models.Board.created_by_user_id == user.id))
    return q


def owns_board(user: models.User | None, board: models.Board) -> bool:
    """The rule behind `is_owner` under the link - same circle as visibility."""
    if user is None:
        return False
    return is_staff(user) or board.assigned_tutor_id == user.id or board.created_by_user_id == user.id


def _resolve_assigned_tutor(db: Session, user: models.User, payload) -> int | None:
    """Who the board is for. A tutor is always themselves; staff choose a
    teaching account (tutor or admin, as in /api/tutors) or nobody."""
    if not is_staff(user):
        if "assigned_tutor_id" in payload.model_fields_set and payload.assigned_tutor_id not in (None, user.id):
            raise HTTPException(403, "Tylko administracja może przypisać tablicę innemu korepetytorowi")
        return user.id
    if payload.assigned_tutor_id is None:
        return None
    tutor = db.get(models.User, payload.assigned_tutor_id)
    if not tutor or tutor.role not in ("tutor", "admin"):
        raise HTTPException(404, "Korepetytor nie znaleziony")
    return tutor.id


def get_board_for(db: Session, user: models.User, board_id: int) -> models.Board:
    """404 rather than 403 for somebody else's board: a 403 would confirm it exists."""
    board = visible_boards(db, user).filter(models.Board.id == board_id).first()
    if not board:
        raise HTTPException(404, "Tablica nie znaleziona")
    return board


def new_token() -> str:
    # Same shape as User.calendar_token: 256 bits, URL-safe.
    return secrets.token_urlsafe(32)


def board_path(board: models.Board) -> str:
    return f"/t/{board.token}"


def _resolve_student(db: Session, user: models.User, student_id: int) -> models.Student:
    """The student a board may be attached to. For a tutor that is one they
    own or have a lesson with - the same "any lesson" rule as /api/tutor/summary."""
    student = db.get(models.Student, student_id)
    if student and not is_staff(user) and student.tutor_id != user.id:
        has_lesson = (
            db.query(models.Lesson.id)
            .filter(models.Lesson.student_id == student.id,
                    models.Lesson.assigned_tutor_id == user.id)
            .first()
        )
        if not has_lesson:
            student = None
    if not student:
        raise HTTPException(404, "Uczeń nie znaleziony")
    return student


def _page_counts(db: Session, board_ids: list[int]) -> dict[int, int]:
    if not board_ids:
        return {}
    rows = (
        db.query(models.BoardPage.board_id, func.count(models.BoardPage.id))
        .filter(models.BoardPage.board_id.in_(board_ids))
        .group_by(models.BoardPage.board_id)
        .all()
    )
    return dict(rows)


def _out(board: models.Board, db: Session, page_count: int | None = None,
         detail: bool = False) -> schemas.BoardOut:
    creator = db.get(models.User, board.created_by_user_id)
    tutor = db.get(models.User, board.assigned_tutor_id) if board.assigned_tutor_id else None
    data = dict(
        id=board.id, title=board.title, path=board_path(board),
        student_id=board.student_id,
        student_name=board.student.name if board.student else None,
        created_by_user_id=board.created_by_user_id,
        created_by_name=(creator.display_name or creator.username) if creator else None,
        assigned_tutor_id=board.assigned_tutor_id,
        assigned_tutor_name=(tutor.display_name or tutor.username) if tutor else None,
        created_at=board.created_at, updated_at=board.updated_at,
        last_opened_at=board.last_opened_at, archived_at=board.archived_at,
        page_count=page_count if page_count is not None else len(board.pages),
    )
    if detail:
        return schemas.BoardDetailOut(**data, pages=[
            schemas.BoardPageMeta.model_validate(p) for p in board.pages
        ])
    return schemas.BoardOut(**data)


@router.get("", response_model=list[schemas.BoardOut])
def list_boards(
    student_id: int | None = None,
    archived: bool = False,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    """Active boards by default; `?archived=true` lists the archive instead."""
    q = visible_boards(db, user)
    q = q.filter(models.Board.archived_at.isnot(None)) if archived \
        else q.filter(models.Board.archived_at.is_(None))
    if student_id is not None:
        q = q.filter(models.Board.student_id == student_id)
    boards = q.order_by(models.Board.updated_at.desc()).all()
    counts = _page_counts(db, [b.id for b in boards])
    return [_out(b, db, counts.get(b.id, 0)) for b in boards]


@router.post("", response_model=schemas.BoardDetailOut)
def create_board(
    payload: schemas.BoardCreate,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Tytuł tablicy jest wymagany")
    if payload.student_id is not None:
        _resolve_student(db, user, payload.student_id)
    board = models.Board(
        token=new_token(), title=title, student_id=payload.student_id,
        created_by_user_id=user.id,
        assigned_tutor_id=_resolve_assigned_tutor(db, user, payload),
    )
    # Every board starts with one page: the editor has nothing to show otherwise.
    board.pages.append(models.BoardPage(idx=0, title=date.today().isoformat(), elements=[], rev=0))
    db.add(board)
    db.commit()
    db.refresh(board)
    return _out(board, db, detail=True)


@router.get("/{board_id}", response_model=schemas.BoardDetailOut)
def get_board(
    board_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    """Metadata plus the page list, without elements - the panel never draws."""
    return _out(get_board_for(db, user, board_id), db, detail=True)


@router.patch("/{board_id}", response_model=schemas.BoardDetailOut)
def update_board(
    board_id: int,
    payload: schemas.BoardUpdate,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    board = get_board_for(db, user, board_id)
    if payload.title is not None:
        title = payload.title.strip()
        if not title:
            raise HTTPException(400, "Tytuł tablicy jest wymagany")
        board.title = title
    if "student_id" in payload.model_fields_set:
        if payload.student_id is not None:
            _resolve_student(db, user, payload.student_id)
        board.student_id = payload.student_id
    if "assigned_tutor_id" in payload.model_fields_set and is_staff(user):
        board.assigned_tutor_id = _resolve_assigned_tutor(db, user, payload)
    elif "assigned_tutor_id" in payload.model_fields_set:
        _resolve_assigned_tutor(db, user, payload)   # 403 for anyone but self
    db.commit()
    db.refresh(board)
    return _out(board, db, detail=True)


@router.post("/{board_id}/rotate-token", response_model=schemas.BoardDetailOut)
def rotate_token(
    board_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    """New link, same content. The old one stops working immediately - this is
    the mitigation for a leaked link, since links never expire on their own."""
    board = get_board_for(db, user, board_id)
    board.token = new_token()
    db.commit()
    db.refresh(board)
    # Whoever is connected got in on the old link: out they go.
    boards_rooms.close_pages_threadsafe(boards_rooms.page_ids_of_board(db, board.id))
    return _out(board, db, detail=True)


@router.delete("/{board_id}")
def archive_board(
    board_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    """Archive, not delete. The link answers 404 from now on; content stays."""
    board = get_board_for(db, user, board_id)
    if board.archived_at:
        raise HTTPException(400, "Tablica jest już zarchiwizowana")
    board.archived_at = auth.utcnow()
    db.commit()
    boards_rooms.close_pages_threadsafe(boards_rooms.page_ids_of_board(db, board.id))
    return {"ok": True, "archived": True}


@router.post("/{board_id}/restore", response_model=schemas.BoardDetailOut)
def restore_board(
    board_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    board = get_board_for(db, user, board_id)
    if not board.archived_at:
        raise HTTPException(400, "Tablica nie jest zarchiwizowana")
    board.archived_at = None
    db.commit()
    db.refresh(board)
    return _out(board, db, detail=True)


@router.delete("/{board_id}/purge")
def purge_board(
    board_id: int,
    user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db),
):
    """Erase a board and everything attached to it, irreversibly.

    Admin only and only for an archived board, so it cannot happen by a slip
    of the hand. Children are deleted explicitly: SQLite here does not
    enforce foreign keys, so ON DELETE CASCADE in the schema is a no-op.
    """
    board = db.get(models.Board, board_id)
    if not board:
        raise HTTPException(404, "Tablica nie znaleziona")
    if not board.archived_at:
        raise HTTPException(400, "Najpierw zarchiwizuj tablicę")

    hashes = {row[0] for row in db.query(models.BoardFile.sha256)
              .filter(models.BoardFile.board_id == board.id)}
    for Model in (models.BoardSnapshot, models.BoardFile, models.BoardPage):
        db.query(Model).filter(Model.board_id == board.id).delete(synchronize_session=False)
    db.delete(board)
    # Flush first, so remove_if_orphaned does not see this board's own rows.
    db.flush()
    for sha in hashes:
        boards_files.remove_if_orphaned(db, sha)
    db.commit()
    return {"ok": True, "purged": True}


# ---------------------------------------------------------------- snapshots

@router.get("/{board_id}/snapshots", response_model=list[schemas.BoardSnapshotOut])
def list_snapshots(
    board_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    """Newest first, without elements - restoring is the only thing they are for."""
    board = get_board_for(db, user, board_id)
    return (
        db.query(models.BoardSnapshot)
        .filter(models.BoardSnapshot.board_id == board.id)
        .order_by(models.BoardSnapshot.created_at.desc(), models.BoardSnapshot.id.desc())
        .all()
    )


@router.post("/{board_id}/snapshots/{snapshot_id}/restore", response_model=schemas.PublicPageOut)
async def restore_snapshot(
    board_id: int,
    snapshot_id: int,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    """Put a page back to the way a snapshot has it.

    Not a raw overwrite: the snapshot is turned into an update that wins the
    merge (boards_reconcile.restore_update) and applied the ordinary way -
    through the open room, so everybody connected sees it, or straight to
    the database when nobody is. The pre-restore state is snapshotted first,
    unconditionally, so a restore is itself reversible.
    """
    board = get_board_for(db, user, board_id)
    snap = db.get(models.BoardSnapshot, snapshot_id)
    if not snap or snap.board_id != board.id:
        raise HTTPException(404, "Snapshot nie znaleziony")
    page = db.get(models.BoardPage, snap.page_id)
    if not page:
        raise HTTPException(404, "Strona tego snapshotu już nie istnieje")

    # Bring the database up to date with the room (if any) before keeping a copy.
    await boards_rooms.flush(page.id)
    db.refresh(page)
    boards_snapshots.maybe_snapshot(db, page, force=True)
    db.commit()

    via_room = await boards_rooms.restore_in_room(page.id, snap.elements)
    if via_room is not None:
        rev, elements = via_room
    else:
        current = {e["id"]: e for e in page.elements}
        update = boards_reconcile.restore_update(current, snap.elements)
        page = await run_in_threadpool(boards_rooms.merge_into_db, db, page, update)
        rev, elements = page.rev, page.elements
    return schemas.PublicPageOut(id=page.id, idx=page.idx, title=page.title, rev=rev, elements=elements)


# ---------------------------------------------------------------- biblioteka konta

@library_router.get("/board-library", response_model=schemas.BoardLibrary)
def get_board_library(user: models.User = Depends(require_board_manager)):
    """Shapes this account added to the whiteboard library. Built-ins are
    shipped with the frontend and never stored here."""
    return schemas.BoardLibrary(items=user.board_library or [])


@library_router.put("/board-library", response_model=schemas.BoardLibrary)
def put_board_library(
    payload: schemas.BoardLibrary,
    user: models.User = Depends(require_board_manager),
    db: Session = Depends(get_db),
):
    items = payload.items
    if not all(isinstance(i, dict) and isinstance(i.get("id"), str) and isinstance(i.get("elements"), list)
               for i in items):
        raise HTTPException(400, "Nieprawidłowa pozycja biblioteki")
    if len(json.dumps(items)) > MAX_LIBRARY_BYTES:
        raise HTTPException(413, "Biblioteka jest za duża")
    user.board_library = items
    db.commit()
    return schemas.BoardLibrary(items=items)

"""Link side of the whiteboard: /api/t/{token}, no login.

The token in the path is the whole credential (README, "Decyzje
projektowe"). No endpoint here takes a dependency that resolves a logged-in
user - the owner is detected softly from the session cookie, and a missing
or bad cookie simply means "guest". Keeping this router free of the role
gates is what guarantees a bare link can never reach the rest of the API.

Every failure to find the board answers the same 404: unknown token,
archived board, page of another board. A distinct status would tell a
scanner which tokens exist.
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models, schemas, auth, boards_reconcile
from ..database import get_db
from ..ratelimit import limiter
from .boards import is_staff

router = APIRouter(prefix="/api/t", tags=["boards-public"])

# Loose on purpose: behind Caddy this is effectively a global budget, not a
# per-IP one (see ratelimit.py). A few parallel lessons with images must fit.
LIMIT_READ = "300/minute"
LIMIT_WRITE = "120/minute"

# A scene page bigger than this is not a drawing, it is an attack on the
# database (base64 in disguise, or a runaway client).
MAX_PAGE_BYTES = 1024 * 1024

NOT_FOUND = "Tablica nie znaleziona"


def board_by_token(db: Session, token: str) -> models.Board:
    board = (
        db.query(models.Board)
        .filter(models.Board.token == token, models.Board.archived_at.is_(None))
        .first()
    )
    if not board:
        raise HTTPException(404, NOT_FOUND)
    return board


def page_of(db: Session, board: models.Board, page_id: int) -> models.BoardPage:
    """The page only if it belongs to this board: a page id alone is not a lookup key."""
    page = db.get(models.BoardPage, page_id)
    if not page or page.board_id != board.id:
        raise HTTPException(404, NOT_FOUND)
    return page


def is_owner(user: models.User | None, board: models.Board) -> bool:
    """Same rule as the panel router's visibility: staff, or the creator."""
    if user is None:
        return False
    return is_staff(user) or board.created_by_user_id == user.id


def owner_or_403(request: Request, db: Session, board: models.Board) -> models.User:
    user = auth.optional_active_user(request.cookies, db)
    if not is_owner(user, board):
        # Safe to be explicit here: whoever asks already holds the token.
        raise HTTPException(403, "Tylko właściciel tablicy może to zrobić")
    return user


def validate_elements(elements: list) -> list[dict]:
    if not all(isinstance(e, dict) and isinstance(e.get("id"), str) and e["id"] for e in elements):
        raise HTTPException(400, "Nieprawidłowy element sceny")
    if boards_reconcile.contains_data_url(elements):
        raise HTTPException(400, "Scena nie może zawierać danych binarnych (data:)")
    return elements


def reject_oversized(request: Request) -> None:
    length = request.headers.get("content-length")
    if length and length.isdigit() and int(length) > MAX_PAGE_BYTES:
        raise HTTPException(413, "Za duża scena")


def merge_into_page(db: Session, page: models.BoardPage, incoming: list[dict]) -> models.BoardPage:
    """Merge `incoming` into the stored page. Returns the page (refreshed).

    Never a plain overwrite: two people may be saving, and the one with the
    stale copy must not erase the other's work. When a live room is open for
    this page (see boards_rooms) the merge goes through the room instead, so
    the connected clients see it - that is wired in there.
    """
    current = {e["id"]: e for e in page.elements}
    changed = boards_reconcile.reconcile(current, incoming)
    if changed:
        page.elements = boards_reconcile.ordered(current)
        page.rev += 1
        page.updated_at = auth.utcnow()
        page.board.updated_at = page.updated_at
        db.commit()
        db.refresh(page)
    return page


def _page_out(page: models.BoardPage) -> schemas.PublicPageOut:
    return schemas.PublicPageOut(
        id=page.id, idx=page.idx, title=page.title, rev=page.rev, elements=page.elements,
    )


@router.get("/{token}", response_model=schemas.PublicBoardOut)
@limiter.limit(LIMIT_READ)
def get_board(token: str, request: Request, db: Session = Depends(get_db)):
    """Metadata and the page list; no elements, no write (last_opened_at is
    set when a live connection opens, not on a read)."""
    board = board_by_token(db, token)
    user = auth.optional_active_user(request.cookies, db)
    return schemas.PublicBoardOut(
        title=board.title, is_owner=is_owner(user, board),
        pages=[schemas.BoardPageMeta.model_validate(p) for p in board.pages],
    )


@router.get("/{token}/pages/{page_id}", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_READ)
def get_page(token: str, page_id: int, request: Request, db: Session = Depends(get_db)):
    board = board_by_token(db, token)
    return _page_out(page_of(db, board, page_id))


@router.put("/{token}/pages/{page_id}", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_WRITE)
def put_page(
    token: str, page_id: int, payload: schemas.PageElementsIn, request: Request,
    db: Session = Depends(get_db),
):
    """Fallback save for when the WebSocket is down. Merges, never overwrites."""
    reject_oversized(request)
    board = board_by_token(db, token)
    page = page_of(db, board, page_id)
    incoming = validate_elements(payload.elements)
    return _page_out(merge_into_page(db, page, incoming))


@router.post("/{token}/pages", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_WRITE)
def add_page(
    token: str, payload: schemas.PageCreate, request: Request, db: Session = Depends(get_db),
):
    board = board_by_token(db, token)
    owner_or_403(request, db, board)
    title = (payload.title or "").strip() or date.today().isoformat()
    next_idx = db.query(func.coalesce(func.max(models.BoardPage.idx), -1)).filter(
        models.BoardPage.board_id == board.id
    ).scalar() + 1
    page = models.BoardPage(board_id=board.id, idx=next_idx, title=title, elements=[], rev=0)
    db.add(page)
    board.updated_at = auth.utcnow()
    db.commit()
    db.refresh(page)
    return _page_out(page)


@router.patch("/{token}/pages/{page_id}", response_model=schemas.PublicPageOut)
@limiter.limit(LIMIT_WRITE)
def rename_page(
    token: str, page_id: int, payload: schemas.PageUpdate, request: Request,
    db: Session = Depends(get_db),
):
    board = board_by_token(db, token)
    owner_or_403(request, db, board)
    page = page_of(db, board, page_id)
    title = payload.title.strip()
    if not title:
        raise HTTPException(400, "Tytuł strony jest wymagany")
    page.title = title
    db.commit()
    db.refresh(page)
    return _page_out(page)


@router.delete("/{token}/pages/{page_id}")
@limiter.limit(LIMIT_WRITE)
def delete_page(token: str, page_id: int, request: Request, db: Session = Depends(get_db)):
    """Removes the page and its snapshots. Other pages keep their id and idx:
    gaps in idx are fine, the order is what matters."""
    board = board_by_token(db, token)
    owner_or_403(request, db, board)
    page = page_of(db, board, page_id)
    if db.query(models.BoardPage.id).filter(models.BoardPage.board_id == board.id).count() <= 1:
        raise HTTPException(400, "Tablica musi mieć co najmniej jedną stronę")
    db.query(models.BoardSnapshot).filter(models.BoardSnapshot.page_id == page.id).delete(
        synchronize_session=False
    )
    db.delete(page)
    board.updated_at = auth.utcnow()
    db.commit()
    return {"ok": True}

"""Daily snapshots of board pages and their retention.

Whoever has the link can select everything and press Delete - usually by
accident - and the live save then overwrites the only copy. The rule
(decision 2.7): before a page is written, if it has no snapshot younger than
24 h, keep the state from BEFORE the write. Self-triggering, no cron, and it
naturally captures the state from before today's lesson. Kept 30 days, the
same window as the Litestream replica.
"""
from datetime import timedelta

from sqlalchemy.orm import Session

from . import models, auth, boards_rooms

SNAPSHOT_MIN_AGE = timedelta(hours=24)
RETENTION = timedelta(days=30)


def maybe_snapshot(db: Session, page: models.BoardPage, force: bool = False) -> bool:
    """Called right before a page's elements are overwritten. Returns True if
    a snapshot was taken. An empty page is not worth a row.

    `force` skips the 24 h check - used before a restore, so that a restore
    is itself reversible even on a day that already has its snapshot.
    """
    if not page.elements:
        return False
    if not force:
        cutoff = auth.utcnow() - SNAPSHOT_MIN_AGE
        recent = (
            db.query(models.BoardSnapshot.id)
            .filter(models.BoardSnapshot.page_id == page.id,
                    models.BoardSnapshot.created_at >= cutoff)
            .first()
        )
        if recent:
            return False
    db.add(models.BoardSnapshot(
        board_id=page.board_id, page_id=page.id, title=page.title,
        elements=list(page.elements), created_at=auth.utcnow(),
    ))
    # No commit here: the caller's write and the snapshot land together.
    return True


def purge_old(db: Session) -> int:
    """Drop snapshots past retention. Idempotent; piggybacks on the daily job."""
    cutoff = auth.utcnow() - RETENTION
    n = (
        db.query(models.BoardSnapshot)
        .filter(models.BoardSnapshot.created_at < cutoff)
        .delete(synchronize_session=False)
    )
    db.commit()
    return n


# The room saver does not import this module (it would be a cycle through
# the routers); it calls whatever hook is installed here.
boards_rooms.set_before_save_hook(maybe_snapshot)

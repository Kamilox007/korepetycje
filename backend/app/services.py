from datetime import date, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models

# How far ahead we materialise series occurrences.
DEFAULT_HORIZON_DAYS = 120
# Hard ceiling: without it a client could ask for ?end=2099-01-01 and have us
# generate thousands of rows per series.
MAX_HORIZON_DAYS = 400


def clamp_horizon(end: date | None) -> date:
    """Generation horizon, clamped regardless of what the client asks for."""
    today = date.today()
    requested = end or (today + timedelta(days=DEFAULT_HORIZON_DAYS))
    return min(requested, today + timedelta(days=MAX_HORIZON_DAYS))


def generate_lessons_for_series(
    db: Session,
    series: models.LessonSeries,
    until: date,
) -> int:
    """Create individual occurrences (Lesson) for a series up to `until`.

    Every occurrence carries `origin_date`, the original slot date in the series,
    which does NOT change when the lesson is rescheduled. That lets the generator
    skip slots it already created, even if their date was later moved or the
    lesson deleted. Slots recorded in SeriesSkip (removed by the user) are not
    recreated. Returns the number of lessons created.
    """
    end = series.end_date or until
    horizon = min(end, until)
    if horizon < series.start_date:
        return 0

    # first day >= start_date landing on the right weekday
    current = series.start_date
    days_ahead = (series.weekday - current.weekday()) % 7
    current = current + timedelta(days=days_ahead)

    # original slot dates that already exist as occurrences of this series
    existing_origins = {
        l.origin_date
        for l in db.query(models.Lesson)
        .filter(models.Lesson.series_id == series.id)
        .all()
        if l.origin_date is not None
    }

    # slots struck out (deleted): do not recreate
    skipped = {
        s.skip_date
        for s in db.query(models.SeriesSkip)
        .filter(models.SeriesSkip.series_id == series.id)
        .all()
    }

    created = 0
    pending: list[models.Lesson] = []
    while current <= horizon:
        if current not in existing_origins and current not in skipped:
            lesson = models.Lesson(
                tutor_id=series.tutor_id,
                assigned_tutor_id=series.assigned_tutor_id,
                student_id=series.student_id,
                series_id=series.id,
                subject_id=series.subject_id,
                level=series.level,
                title=series.title,
                date=current,
                origin_date=current,
                start_time=series.start_time,
                duration_min=series.duration_min,
                price_grosze=series.price_grosze,
            )
            pending.append(lesson)
        current += timedelta(days=7)

    # Insert one at a time: if a concurrent request already created the same
    # slot, the unique constraint rejects it and we simply move on instead of
    # failing the whole operation.
    for lesson in pending:
        try:
            with db.begin_nested():
                db.add(lesson)
            created += 1
        except IntegrityError:
            pass
    if created:
        db.commit()
    return created


def regenerate_all(db: Session, until: date | None = None, tutor_id: int | None = None) -> int:
    """Generate missing lessons for active series (optionally for one tutor).

    A write operation: do NOT call it from GET handlers. Runs at application
    start, after a series changes, and from the maintenance endpoint (cron).
    """
    until = clamp_horizon(until)
    total = 0
    q = db.query(models.LessonSeries).filter(
        models.LessonSeries.active == True  # noqa: E712
    )
    if tutor_id is not None:
        q = q.filter(models.LessonSeries.tutor_id == tutor_id)
    for series in q.all():
        total += generate_lessons_for_series(db, series, until)
    return total


def _to_min(t) -> int:
    """time -> minutes since midnight."""
    return t.hour * 60 + t.minute


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def subtract_busy(window_start: int, window_end: int, busy: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Subtract busy intervals (in minutes) from the window [start, end].
    Returns the list of free sub-intervals."""
    free = [(window_start, window_end)]
    for bs, be in busy:
        new_free = []
        for fs, fe in free:
            # no overlap
            if be <= fs or bs >= fe:
                new_free.append((fs, fe))
                continue
            # trim
            if bs > fs:
                new_free.append((fs, min(bs, fe)))
            if be < fe:
                new_free.append((max(be, fs), fe))
        free = new_free
    # drop empty or too-short intervals (<1 min)
    return [(s, e) for s, e in free if e - s >= 1]


def free_windows_for_tutor(db, tutor_id: int, start_date, days_ahead: int = 14,
                           duration_min: int = 60, exclude_lesson_id: int | None = None,
                           step_min: int = 30):
    """For every day in the range returns:
    - windows: free availability windows (windows minus the tutor's lessons),
    - slots: allowed start times for a lesson lasting `duration_min`
      (start + duration must fit inside a free interval).
    `exclude_lesson_id` skips one specific lesson when computing busy time
    (the one currently being rescheduled)."""
    from datetime import timedelta
    from . import models

    availability = (
        db.query(models.Availability)
        .filter(models.Availability.tutor_id == tutor_id)
        .all()
    )
    if not availability:
        return []

    by_weekday: dict[int, list[tuple[int, int]]] = {}
    for a in availability:
        by_weekday.setdefault(a.weekday, []).append((_to_min(a.start_time), _to_min(a.end_time)))

    result = []
    for offset in range(days_ahead):
        day = start_date + timedelta(days=offset)
        wd = day.weekday()
        windows = by_weekday.get(wd)
        if not windows:
            continue
        q = (
            db.query(models.Lesson)
            .filter(
                models.Lesson.assigned_tutor_id == tutor_id,
                models.Lesson.date == day,
                models.Lesson.cancelled == False,  # noqa: E712
            )
        )
        if exclude_lesson_id is not None:
            q = q.filter(models.Lesson.id != exclude_lesson_id)
        busy = [
            (_to_min(l.start_time), _to_min(l.start_time) + (l.duration_min or 60))
            for l in q.all()
        ]
        free = []
        for ws, we in sorted(windows):
            for fs, fe in subtract_busy(ws, we, busy):
                free.append((fs, fe))
        if not free:
            continue
        # start times: start + duration must fit inside the free interval
        slots = []
        for fs, fe in sorted(free):
            cur = fs
            while cur + duration_min <= fe:
                slots.append(_fmt(cur))
                cur += step_min
        if slots:
            result.append({
                "date": day,
                "weekday": wd,
                "windows": [{"start": _fmt(s), "end": _fmt(e)} for s, e in sorted(free)],
                "slots": slots,
            })
    return result

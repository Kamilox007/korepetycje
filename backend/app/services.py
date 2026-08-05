from datetime import date, timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import models

# Do jak dawna w przód materializujemy wystąpienia serii.
DEFAULT_HORIZON_DAYS = 120
# Twardy limit — bez niego klient mógłby poprosić o ?end=2099-01-01
# i kazać wygenerować tysiące wierszy na serię.
MAX_HORIZON_DAYS = 400


def clamp_horizon(end: date | None) -> date:
    """Horyzont generowania, ograniczony niezależnie od tego, o co poprosi klient."""
    today = date.today()
    requested = end or (today + timedelta(days=DEFAULT_HORIZON_DAYS))
    return min(requested, today + timedelta(days=MAX_HORIZON_DAYS))


def generate_lessons_for_series(
    db: Session,
    series: models.LessonSeries,
    until: date,
) -> int:
    """Tworzy pojedyncze wystąpienia (Lesson) dla serii aż do daty `until`.

    Każde wystąpienie ma `origin_date` = pierwotną datę slotu w serii, która
    NIE zmienia się przy przesunięciu zajęć. Dzięki temu generator pomija sloty,
    które już raz utworzył — nawet jeśli potem przesunięto im datę lub je usunięto.
    Sloty zapisane w SeriesSkip (usunięte przez użytkownika) nie są odtwarzane.
    Zwraca liczbę nowo utworzonych zajęć.
    """
    end = series.end_date or until
    horizon = min(end, until)
    if horizon < series.start_date:
        return 0

    # pierwszy dzień >= start_date o właściwym dniu tygodnia
    current = series.start_date
    days_ahead = (series.weekday - current.weekday()) % 7
    current = current + timedelta(days=days_ahead)

    # pierwotne daty slotów, które już istnieją jako wystąpienia tej serii
    existing_origins = {
        l.origin_date
        for l in db.query(models.Lesson)
        .filter(models.Lesson.series_id == series.id)
        .all()
        if l.origin_date is not None
    }

    # sloty skreślone (usunięte) — nie odtwarzać
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

    # Zapis pojedynczo: jeśli równoległe żądanie zdążyło utworzyć ten sam slot,
    # unique constraint go odrzuci, a my po prostu idziemy dalej zamiast
    # wywracać całą operację.
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
    """Generuje brakujące zajęcia dla aktywnych serii (opcjonalnie jednego korepetytora).

    Operacja zapisująca — NIE wołać z handlerów GET. Uruchamiana przy starcie
    aplikacji, po zmianie serii oraz z endpointu konserwacyjnego (cron).
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
    """time -> minuty od północy."""
    return t.hour * 60 + t.minute


def _fmt(m: int) -> str:
    return f"{m // 60:02d}:{m % 60:02d}"


def subtract_busy(window_start: int, window_end: int, busy: list[tuple[int, int]]) -> list[tuple[int, int]]:
    """Odejmuje zajęte przedziały (w minutach) od okna [start,end].
    Zwraca listę wolnych podprzedziałów."""
    free = [(window_start, window_end)]
    for bs, be in busy:
        new_free = []
        for fs, fe in free:
            # brak nakładania
            if be <= fs or bs >= fe:
                new_free.append((fs, fe))
                continue
            # przycięcie
            if bs > fs:
                new_free.append((fs, min(bs, fe)))
            if be < fe:
                new_free.append((max(be, fs), fe))
        free = new_free
    # usuń puste/za krótkie (<1 min)
    return [(s, e) for s, e in free if e - s >= 1]


def free_windows_for_tutor(db, tutor_id: int, start_date, days_ahead: int = 14,
                           duration_min: int = 60, exclude_lesson_id: int | None = None,
                           step_min: int = 30):
    """Dla każdego dnia w zakresie zwraca:
    - windows: wolne okna dyspozycyjności (okna minus zajęcia korepetytora),
    - slots: dozwolone godziny startu dla zajęć o długości `duration_min`
      (start + czas trwania musi zmieścić się w wolnym przedziale).
    `exclude_lesson_id` pomija konkretne zajęcia przy liczeniu zajętości
    (te, które właśnie przesuwamy)."""
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
        # godziny startu: start + duration musi zmieścić się w wolnym przedziale
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

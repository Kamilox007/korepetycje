import os
import secrets
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import date, timedelta
from fastapi import FastAPI, Depends, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from . import models, schemas, services, auth, money, transfer_code
from .database import get_db, SessionLocal


def seed_admin():
    """Ensure the admin account exists and adopt orphaned records.

    The database schema is Alembic's business; this only touches data.
    """
    db = SessionLocal()
    try:
        admin = db.query(models.User).filter(models.User.role == "admin").first()
        if admin is None:
            legacy = db.query(models.User).filter(models.User.username == "admin").first()
            if legacy is not None:
                legacy.role = "admin"
                if not legacy.display_name or legacy.display_name == "Korepetytor":
                    legacy.display_name = "Administrator"
                # an account still on the default password must change it at next login
                if auth.verify_password("admin", legacy.password_hash):
                    legacy.must_change_password = True
                admin = legacy
                db.commit()
            else:
                admin = models.User(
                    username="admin",
                    password_hash=auth.hash_password("admin"),
                    role="admin",
                    display_name="Administrator",
                    must_change_password=True,
                )
                db.add(admin)
                db.commit()
                db.refresh(admin)

        for Model in (models.Student, models.LessonSeries, models.Lesson, models.Payment):
            rows = db.query(Model).filter(Model.tutor_id == None).all()  # noqa: E711
            for r in rows:
                r.tutor_id = admin.id
        db.commit()
    finally:
        db.close()


def _require_migrated_db():
    """Refuse to start against a database that is not on the latest migration."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
    from .database import engine

    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    # script_location in the ini file is relative to CWD; resolve it ourselves
    # because uvicorn may be started from any directory
    cfg.set_main_option(
        "script_location", str(Path(__file__).resolve().parents[1] / "alembic")
    )
    head = ScriptDirectory.from_config(cfg).get_current_head()
    with engine.connect() as conn:
        current = MigrationContext.configure(conn).get_current_revision()
    if current != head:
        raise RuntimeError(
            f"Baza jest na migracji {current!r}, a kod oczekuje {head!r}. "
            "Uruchom: alembic upgrade head"
        )


def _generate_upcoming() -> int:
    """Materialise series occurrences for the coming months."""
    db = SessionLocal()
    try:
        return services.regenerate_all(db)
    finally:
        db.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    _require_migrated_db()
    seed_admin()
    _generate_upcoming()
    yield


app = FastAPI(title="Korepetycje API", version="3.0", lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Frontend origins, e.g. CORS_ORIGINS="https://panel.example.com"
# Defaults to the Vite dev server. A wildcard is deliberately rejected.
_origins = [
    o.strip()
    for o in os.environ.get(
        "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
    ).split(",")
    if o.strip() and o.strip() != "*"
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


# ===================== AUTH =====================
@app.post("/api/auth/login", response_model=schemas.LoginOut)
@limiter.limit("10/minute;40/hour")
def login(
    request: Request,
    response: Response,
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = auth.authenticate(db, form.username, form.password)
    # One token per login, recorded in `sessions` so it can be revoked later.
    # The token also comes back in the body, for /docs, curl and cron jobs.
    # Browsers ignore it and use the cookie instead.
    token = auth.open_session(db, user, request)
    auth.set_session_cookie(response, user, token, auth.token_lifetime(user))
    return schemas.LoginOut(
        access_token=token,
        role=user.role,
        username=user.username,
        display_name=user.display_name,
        must_change_password=user.must_change_password,
    )


@app.get("/api/auth/me", response_model=schemas.MeOut)
def me(user: models.User = Depends(auth.get_current_user)):
    return user


@app.post("/api/auth/change-password")
@limiter.limit("10/hour")
def change_password(
    request: Request,
    response: Response,
    payload: schemas.ChangePasswordIn,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    if not auth.verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Błędne dotychczasowe hasło")
    if len(payload.new_password) < auth.MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Nowe hasło musi mieć min. {auth.MIN_PASSWORD_LENGTH} znaków",
        )
    if auth.verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Nowe hasło musi różnić się od dotychczasowego")
    user.password_hash = auth.hash_password(payload.new_password)
    user.must_change_password = False
    db.commit()
    db.refresh(user)
    # Everything else this account had open dies now. Someone who learned the old
    # password loses access immediately instead of in up to seven days.
    auth.revoke_user_sessions(db, user.id)

    # The account held a short-lived token; issue a full one so the user stays in.
    token = auth.open_session(db, user, request)
    auth.set_session_cookie(response, user, token, auth.token_lifetime(user))
    return {"ok": True, "access_token": token}


@app.post("/api/auth/logout")
def logout(
    request: Request,
    response: Response,
    db: Session = Depends(get_db),
    user: models.User = Depends(auth.get_current_user),
):
    """Revoke this session and clear the cookie.

    Clearing the cookie alone would be cosmetic in two ways: an httponly cookie
    cannot be removed from JavaScript, and the token itself would stay valid
    until it expired. Revoking the session closes both.
    """
    jti = getattr(request.state, "jti", None)
    if jti:
        auth.revoke_session(db, jti)
    auth.clear_session_cookie(response)
    return {"ok": True}


# ===================== USER MANAGEMENT =====================
# A secretary may create tutors. An admin may create tutors and secretaries.
# Nobody but an admin creates or edits admin/secretary accounts.
@app.get("/api/users", response_model=list[schemas.UserOut])
def list_users(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    # a secretary sees tutors and students; an admin sees everyone
    q = db.query(models.User)
    if user.role == "secretary":
        q = q.filter(models.User.role.in_(["tutor", "student"]))
    return q.order_by(models.User.role, models.User.display_name).all()


@app.get("/api/tutors", response_model=list[schemas.TutorOption])
def list_tutors(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    # Admins are included: in a one- or two-person practice the owner teaches,
    # and leaving them off this list makes their own lessons unassignable.
    # Secretaries are not — they administer, they do not run lessons.
    rows = (
        db.query(models.User)
        .filter(models.User.role.in_(("tutor", "admin")))
        .order_by(models.User.display_name)
        .all()
    )
    return [schemas.TutorOption(id=t.id, display_name=t.display_name or t.username, color=t.color) for t in rows]


@app.post("/api/users", response_model=schemas.UserCreatedOut)
def create_user(
    payload: schemas.StaffUserCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    role = payload.role
    if role not in ("tutor", "secretary", "admin"):
        raise HTTPException(400, "Nieprawidłowa rola")
    # only an admin may create secretary/admin accounts
    if role in ("secretary", "admin") and user.role != "admin":
        raise HTTPException(403, "Tylko administrator może tworzyć konta administracji")
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(400, "Login jest już zajęty")
    u = models.User(
        username=payload.username,
        password_hash=auth.hash_password(payload.password),
        role=role,
        display_name=payload.display_name or payload.username,
        color=payload.color,
        must_change_password=True,
    )
    db.add(u)
    db.commit()
    db.refresh(u)
    return schemas.UserCreatedOut(
        id=u.id, username=u.username, role=u.role,
        display_name=u.display_name, password=payload.password,
    )


@app.patch("/api/users/{user_id}", response_model=schemas.UserOut)
def update_user(
    user_id: int,
    payload: schemas.UserUpdate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    target = db.get(models.User, user_id)
    if not target:
        raise HTTPException(404, "Użytkownik nie znaleziony")
    # a secretary does not edit staff accounts
    if target.role in ("admin", "secretary") and user.role != "admin":
        raise HTTPException(403, "Brak uprawnień do edycji tego konta")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(target, k, v)
    db.commit()
    db.refresh(target)
    return target


@app.post("/api/users/{user_id}/reset-password", response_model=schemas.UserCreatedOut)
def reset_user_password(
    user_id: int,
    payload: schemas.PasswordResetIn | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    """Set a starting password for a staff account and force a change at next login.

    For the case a tutor forgets their password. The new password is shown once,
    in the response; nothing stores it in readable form afterwards. Every session
    of that account is revoked, so a reset also ends access from anywhere the old
    password was still in use.
    """
    target = db.get(models.User, user_id)
    if not target:
        raise HTTPException(404, "Użytkownik nie znaleziony")
    # Same rule as when creating accounts: a secretary handles tutors only.
    if target.role in ("admin", "secretary") and user.role != "admin":
        raise HTTPException(403, "Brak uprawnień do resetu hasła tego konta")
    if target.id == user.id:
        raise HTTPException(400, "Własne hasło zmień przez „Zmień hasło”")

    new_password = (payload.password if payload and payload.password else None) \
        or secrets.token_urlsafe(9)
    if len(new_password) < auth.MIN_PASSWORD_LENGTH:
        raise HTTPException(400, f"Hasło musi mieć co najmniej {auth.MIN_PASSWORD_LENGTH} znaków")

    target.password_hash = auth.hash_password(new_password)
    target.must_change_password = True
    target.failed_logins = 0
    target.locked_until = None
    auth.revoke_user_sessions(db, target.id)
    db.commit()

    return schemas.UserCreatedOut(
        id=target.id, username=target.username, role=target.role,
        display_name=target.display_name, password=new_password,
    )


@app.delete("/api/users/{user_id}")
def delete_user(
    user_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    target = db.get(models.User, user_id)
    if not target:
        raise HTTPException(404, "Użytkownik nie znaleziony")
    if target.id == user.id:
        raise HTTPException(400, "Nie można usunąć własnego konta")
    # a secretary does not touch admin/secretary accounts
    if target.role in ("admin", "secretary") and user.role != "admin":
        raise HTTPException(403, "Brak uprawnień do usunięcia tego konta")
    # detach the tutor assignment from lessons and series
    if target.role == "tutor":
        for l in db.query(models.Lesson).filter(models.Lesson.assigned_tutor_id == target.id).all():
            l.assigned_tutor_id = None
        for s in db.query(models.LessonSeries).filter(models.LessonSeries.assigned_tutor_id == target.id).all():
            s.assigned_tutor_id = None
    db.delete(target)
    db.commit()
    return {"ok": True}


# ===================== SUBJECTS (staff) =====================
@app.get("/api/subjects", response_model=list[schemas.SubjectOut])
def list_subjects(user: models.User = Depends(auth.require_active_user), db: Session = Depends(get_db)):
    # any signed-in user may read subjects (needed to display names)
    return db.query(models.Subject).order_by(models.Subject.name).all()


@app.post("/api/subjects", response_model=schemas.SubjectOut)
def create_subject(
    payload: schemas.SubjectCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    if db.query(models.Subject).filter(models.Subject.name == payload.name).first():
        raise HTTPException(400, "Taki przedmiot już istnieje")
    subj = models.Subject(**payload.model_dump())
    db.add(subj)
    db.commit()
    db.refresh(subj)
    return subj


@app.delete("/api/subjects/{subject_id}")
def delete_subject(
    subject_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    subj = db.get(models.Subject, subject_id)
    if not subj:
        raise HTTPException(404, "Przedmiot nie znaleziony")
    # detach from lessons and series; the lessons themselves stay
    for l in db.query(models.Lesson).filter(models.Lesson.subject_id == subject_id).all():
        l.subject_id = None
    for s in db.query(models.LessonSeries).filter(models.LessonSeries.subject_id == subject_id).all():
        s.subject_id = None
    db.delete(subj)
    db.commit()
    return {"ok": True}


# ===================== STUDENTS (staff) =====================
def _student_out(s: models.Student) -> schemas.StudentOut:
    item = schemas.StudentOut.model_validate(s)
    item.has_account = s.user_id is not None
    return item


@app.get("/api/students", response_model=list[schemas.StudentOut])
def list_students(
    archived: bool = False,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    """Active students by default; `?archived=true` lists the archive instead."""
    q = db.query(models.Student)
    q = q.filter(models.Student.archived_at.isnot(None)) if archived \
        else q.filter(models.Student.archived_at.is_(None))
    return [_student_out(s) for s in q.order_by(models.Student.name).all()]


@app.post("/api/students", response_model=schemas.StudentOut)
def create_student(
    payload: schemas.StudentCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    student = models.Student(tutor_id=user.id, **payload.model_dump())
    db.add(student)
    db.commit()
    db.refresh(student)
    return _student_out(student)


def _get_student(db, student_id) -> models.Student:
    s = db.get(models.Student, student_id)
    if not s:
        raise HTTPException(404, "Uczeń nie znaleziony")
    return s


@app.patch("/api/students/{student_id}", response_model=schemas.StudentOut)
def update_student(
    student_id: int,
    payload: schemas.StudentUpdate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    student = _get_student(db, student_id)
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(student, k, v)
    db.commit()
    db.refresh(student)
    return _student_out(student)


@app.delete("/api/students/{student_id}")
def delete_student(
    student_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    """Archive a student: hide them from the lists, keep every record.

    Their login account is removed, so access ends immediately, and unfinished
    future lessons are dropped because they will not happen. Completed lessons
    and payments stay, because they are the settlement history.
    """
    student = _get_student(db, student_id)
    if student.archived_at:
        raise HTTPException(400, "Uczeń jest już zarchiwizowany")

    if student.user_id:
        acc = db.get(models.User, student.user_id)
        if acc:
            auth.revoke_user_sessions(db, acc.id)
            db.delete(acc)
        student.user_id = None

    today = date.today()
    db.query(models.Lesson).filter(
        models.Lesson.student_id == student.id,
        models.Lesson.date >= today,
        models.Lesson.completed.is_(False),
    ).delete(synchronize_session=False)
    db.query(models.LessonSeries).filter(
        models.LessonSeries.student_id == student.id
    ).update({models.LessonSeries.active: False}, synchronize_session=False)

    student.archived_at = auth.utcnow()
    db.commit()
    return {"ok": True, "archived": True}


@app.post("/api/students/{student_id}/restore", response_model=schemas.StudentOut)
def restore_student(
    student_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    """Bring an archived student back. Their series stay inactive on purpose:
    resuming lessons is a separate decision from undoing a mistaken archive."""
    student = _get_student(db, student_id)
    if not student.archived_at:
        raise HTTPException(400, "Uczeń nie jest zarchiwizowany")
    student.archived_at = None
    db.commit()
    return _student_out(student)


@app.delete("/api/students/{student_id}/purge")
def purge_student(
    student_id: int,
    user: models.User = Depends(auth.require_admin),
    db: Session = Depends(get_db),
):
    """Erase a student and everything attached to them, irreversibly.

    Exists for erasure requests under GDPR art. 17, which archiving cannot
    satisfy. Admin only, and only for an already archived student, so it cannot
    happen by a slip of the hand.
    """
    student = _get_student(db, student_id)
    if not student.archived_at:
        raise HTTPException(400, "Najpierw zarchiwizuj ucznia")
    db.delete(student)
    db.commit()
    return {"ok": True, "purged": True}


@app.post("/api/students/{student_id}/account", response_model=schemas.StudentAccountOut)
def create_student_account(
    student_id: int,
    payload: schemas.StudentAccountCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    student = _get_student(db, student_id)
    if student.user_id:
        raise HTTPException(400, "Ten uczeń ma już konto")
    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(400, "Login jest już zajęty")
    account = models.User(
        username=payload.username,
        password_hash=auth.hash_password(payload.password),
        role="student",
        display_name=student.name,
        must_change_password=True,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    student.user_id = account.id
    db.commit()
    return schemas.StudentAccountOut(
        student_id=student.id, username=payload.username, password=payload.password
    )


@app.delete("/api/students/{student_id}/account")
def delete_student_account(
    student_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    student = _get_student(db, student_id)
    if not student.user_id:
        raise HTTPException(404, "Uczeń nie ma konta")
    acc = db.get(models.User, student.user_id)
    student.user_id = None
    if acc:
        db.delete(acc)
    db.commit()
    return {"ok": True}


# ===================== SERIES (staff) =====================
@app.get("/api/series", response_model=list[schemas.SeriesOut])
def list_series(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    rows = db.query(models.LessonSeries).all()
    out = []
    for s in rows:
        item = schemas.SeriesOut.model_validate(s)
        if s.subject_id:
            subj = db.get(models.Subject, s.subject_id)
            item.subject_name = subj.name if subj else None
        out.append(item)
    return out


@app.post("/api/series", response_model=schemas.SeriesOut)
def create_series(
    payload: schemas.SeriesCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    _get_student(db, payload.student_id)
    series = models.LessonSeries(tutor_id=user.id, **payload.model_dump())
    db.add(series)
    db.commit()
    db.refresh(series)
    # the generator carries assigned_tutor_id, subject_id and level onto occurrences
    services.generate_lessons_for_series(db, series, services.clamp_horizon(None))
    return series


@app.patch("/api/series/{series_id}", response_model=schemas.SeriesOut)
def update_series(
    series_id: int,
    payload: schemas.SeriesUpdate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    """Edit a series and carry the change onto its future occurrences.

    What propagates depends on the kind of field, because the two kinds mean
    different things:

    * Metadata (subject, level, tutor, title) describes what the lesson IS, so it
      lands on every future occurrence — including ones already moved to another
      date. A lesson shifted to Thursday still has the wrong level.
    * Timing (weekday, start_time, duration) describes WHEN the slot falls, so it
      skips occurrences whose date was changed by hand. Those were moved
      deliberately and resetting them would undo somebody's decision.
    * Price lands on future occurrences only. Completed lessons keep the rate
      frozen at the moment they happened.

    Nothing here touches completed or past lessons: they are the settlement
    record, not a schedule.
    """
    series = db.get(models.LessonSeries, series_id)
    if not series:
        raise HTTPException(404, "Seria nie znaleziona")

    data = payload.model_dump(exclude_unset=True)
    if not data:
        return series

    old_weekday = series.weekday
    for k, v in data.items():
        setattr(series, k, v)

    today = date.today()
    future = db.query(models.Lesson).filter(
        models.Lesson.series_id == series_id,
        models.Lesson.date >= today,
        models.Lesson.completed.is_(False),
        models.Lesson.cancelled.is_(False),
    )

    # --- metadata: applies to every future occurrence ---
    meta = {k: data[k] for k in ("subject_id", "level", "assigned_tutor_id", "title")
            if k in data}
    if meta:
        future.update(meta, synchronize_session=False)

    if "price" in data:
        future.update({models.Lesson.price_grosze: series.price_grosze},
                      synchronize_session=False)

    # --- timing: only occurrences nobody has moved by hand ---
    untouched = future.filter(models.Lesson.rescheduled.is_(False))

    if "start_time" in data:
        untouched.update({models.Lesson.start_time: series.start_time},
                         synchronize_session=False)
    if "duration_min" in data:
        untouched.update({models.Lesson.duration_min: series.duration_min},
                         synchronize_session=False)

    if "weekday" in data and data["weekday"] != old_weekday:
        # Shift by the weekday delta rather than deleting and regenerating:
        # origin_date moves with the lesson, so the (series_id, origin_date)
        # constraint holds and the generator lines up with the new slots.
        delta = timedelta(days=data["weekday"] - old_weekday)
        for lesson in untouched.all():
            lesson.date = lesson.date + delta
            if lesson.origin_date:
                lesson.origin_date = lesson.origin_date + delta

    # An end date pulled earlier drops occurrences past it.
    if data.get("end_date"):
        db.query(models.Lesson).filter(
            models.Lesson.series_id == series_id,
            models.Lesson.date > data["end_date"],
            models.Lesson.completed.is_(False),
        ).delete(synchronize_session=False)

    db.commit()

    # Top up any slots the change opened up (a moved weekday, a later end date).
    if series.active:
        services.generate_lessons_for_series(db, series, services.clamp_horizon(None))

    db.refresh(series)
    return series


@app.delete("/api/series/{series_id}")
def delete_series(
    series_id: int,
    keep_past: bool = True,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    series = db.get(models.LessonSeries, series_id)
    if not series:
        raise HTTPException(404, "Seria nie znaleziona")
    q = db.query(models.Lesson).filter(models.Lesson.series_id == series_id)
    if keep_past:
        q = q.filter(
            models.Lesson.date >= date.today(),
            models.Lesson.completed == False,  # noqa: E712
        )
    for lesson in q.all():
        db.delete(lesson)
    series.active = False
    db.commit()
    return {"ok": True}


# ===================== LESSONS =====================
def _lesson_out(l: models.Lesson, db: Session) -> schemas.LessonOut:
    item = schemas.LessonOut.model_validate(l)
    item.student_name = l.student.name if l.student else None
    if l.assigned_tutor_id:
        t = db.get(models.User, l.assigned_tutor_id)
        if t:
            item.assigned_tutor_name = t.display_name or t.username
            item.assigned_tutor_color = t.color
    if l.subject_id:
        subj = db.get(models.Subject, l.subject_id)
        item.subject_name = subj.name if subj else None
    return item


@app.get("/api/health")
def health():
    """Probe for the Docker healthcheck. No auth, no database access: it answers
    "is the process alive", nothing more."""
    return {"status": "ok"}


@app.post("/api/maintenance/generate-lessons")
def generate_lessons(
    user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)
):
    """Top up missing series occurrences. Meant to be called from cron once a day.

    Also drops session rows whose tokens have expired anyway; piggybacking on the
    existing daily job avoids a second scheduled task.
    """
    created = services.regenerate_all(db)
    purged = auth.purge_expired_sessions(db)
    return {
        "created": created,
        "horizon": services.clamp_horizon(None),
        "sessions_purged": purged,
    }


@app.get("/api/lessons", response_model=list[schemas.LessonOut])
def list_lessons(
    start: date | None = None,
    end: date | None = None,
    student_id: int | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(models.Lesson)
    if start:
        q = q.filter(models.Lesson.date >= start)
    if end:
        q = q.filter(models.Lesson.date <= end)
    if student_id:
        q = q.filter(models.Lesson.student_id == student_id)
    lessons = q.order_by(models.Lesson.date, models.Lesson.start_time).all()
    return [_lesson_out(l, db) for l in lessons]


@app.post("/api/lessons", response_model=schemas.LessonOut)
def create_lesson(
    payload: schemas.LessonCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    student = _get_student(db, payload.student_id)
    data = payload.model_dump()
    if data.get("price") is None:
        # `not data["price"]` also overwrote a deliberate 0 (trial lesson)
        data["price"] = student.default_price
    lesson = models.Lesson(tutor_id=user.id, **data)
    db.add(lesson)
    db.commit()
    db.refresh(lesson)
    return _lesson_out(lesson, db)


@app.patch("/api/lessons/{lesson_id}", response_model=schemas.LessonOut)
def update_lesson(
    lesson_id: int,
    payload: schemas.LessonUpdate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    lesson = db.get(models.Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "Zajęcia nie znalezione")
    data = payload.model_dump(exclude_unset=True)
    if "date" in data or "start_time" in data:
        lesson.rescheduled = True
    for k, v in data.items():
        setattr(lesson, k, v)

    # A completed lesson has to say who taught it: it is what the charge is
    # credited against, and without it the amount lands on nobody's account.
    # Rather than refuse outright, fill in the obvious answer first — the series
    # it came from, or the person marking it done if they teach.
    if lesson.completed and not lesson.assigned_tutor_id:
        if lesson.series_id:
            series = db.get(models.LessonSeries, lesson.series_id)
            if series and series.assigned_tutor_id:
                lesson.assigned_tutor_id = series.assigned_tutor_id
        if not lesson.assigned_tutor_id and user.role in ("tutor", "admin"):
            lesson.assigned_tutor_id = user.id
        if not lesson.assigned_tutor_id:
            raise HTTPException(
                400, "Przypisz korepetytora, zanim oznaczysz zajęcia jako odbyte"
            )

    db.commit()
    db.refresh(lesson)
    return _lesson_out(lesson, db)


@app.delete("/api/lessons/{lesson_id}")
def delete_lesson(
    lesson_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    lesson = db.get(models.Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "Zajęcia nie znalezione")
    if lesson.series_id and lesson.origin_date:
        exists = (
            db.query(models.SeriesSkip)
            .filter(
                models.SeriesSkip.series_id == lesson.series_id,
                models.SeriesSkip.skip_date == lesson.origin_date,
            )
            .first()
        )
        if not exists:
            db.add(models.SeriesSkip(series_id=lesson.series_id, skip_date=lesson.origin_date))
    db.delete(lesson)
    db.commit()
    return {"ok": True}


# ----- tutor assignment -----
@app.post("/api/lessons/{lesson_id}/assign", response_model=schemas.LessonOut)
def assign_tutor_to_lesson(
    lesson_id: int,
    tutor_id: int | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    lesson = db.get(models.Lesson, lesson_id)
    if not lesson:
        raise HTTPException(404, "Zajęcia nie znalezione")
    if tutor_id is not None:
        t = db.get(models.User, tutor_id)
        if not t or t.role != "tutor":
            raise HTTPException(400, "Nieprawidłowy korepetytor")
    lesson.assigned_tutor_id = tutor_id
    db.commit()
    db.refresh(lesson)
    return _lesson_out(lesson, db)


# ===================== PAYMENTS (staff) =====================
@app.get("/api/payments", response_model=list[schemas.PaymentOut])
def list_payments(
    student_id: int | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    q = db.query(models.Payment)
    if student_id:
        q = q.filter(models.Payment.student_id == student_id)
    payments = q.order_by(models.Payment.date.desc()).all()
    out = []
    for p in payments:
        item = schemas.PaymentOut.model_validate(p)
        item.student_name = p.student.name if p.student else None
        out.append(item)
    return out


@app.post("/api/payments", response_model=schemas.PaymentOut)
def create_payment(
    payload: schemas.PaymentCreate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    student = _get_student(db, payload.student_id)
    data = payload.model_dump()
    if not data.get("date"):
        data["date"] = date.today()
    if not data.get("assigned_tutor_id"):
        data["assigned_tutor_id"] = _default_payment_tutor(db, student)
    payment = models.Payment(tutor_id=user.id, **data)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    item = schemas.PaymentOut.model_validate(payment)
    item.student_name = student.name
    return item


@app.patch("/api/payments/{payment_id}", response_model=schemas.PaymentOut)
def update_payment(
    payment_id: int,
    payload: schemas.PaymentUpdate,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    """Correct a recorded payment: who paid, when, how much, any note.

    The student is deliberately not editable. Moving a payment between students
    changes two balances at once, which is a transfer rather than a correction;
    deleting and re-entering makes that visible in the history.
    """
    payment = db.get(models.Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Wpłata nie znaleziona")

    data = payload.model_dump(exclude_unset=True)
    if "amount" in data:
        payment.amount = data.pop("amount")
    for k, v in data.items():
        setattr(payment, k, v)

    db.commit()
    db.refresh(payment)
    return payment


@app.delete("/api/payments/{payment_id}")
def delete_payment(
    payment_id: int,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    payment = db.get(models.Payment, payment_id)
    if not payment:
        raise HTTPException(404, "Płatność nie znaleziona")
    db.delete(payment)
    db.commit()
    return {"ok": True}


# ===================== SUMMARY (staff) =====================
def _default_payment_tutor(db: Session, student: models.Student) -> int | None:
    """Which tutor a payment belongs to when the form did not say.

    Unambiguous only when the student has lessons with exactly one tutor, which
    is the single-tutor case and the common one. With two, guessing would put
    money on the wrong account, so the caller has to choose.
    """
    ids = {
        row[0] for row in db.query(models.Lesson.assigned_tutor_id)
        .filter(models.Lesson.student_id == student.id,
                models.Lesson.assigned_tutor_id.isnot(None))
        .distinct()
    }
    return ids.pop() if len(ids) == 1 else None


def _summary_for_students(students, db=None, only_tutor_id: int | None = None):
    """Balances per student, and within a student per tutor.

    `only_tutor_id` narrows everything to one tutor's lessons and payments, which
    is what a tutor sees: their own accounts, not their colleague's.
    """
    rows = []
    total_due = total_paid = 0  # in grosze: summing floats accumulated error
    for s in students:
        lessons = [l for l in s.lessons if not l.cancelled]
        payments = list(s.payments)
        if only_tutor_id is not None:
            lessons = [l for l in lessons if l.assigned_tutor_id == only_tutor_id]
            payments = [p for p in payments if p.assigned_tutor_id == only_tutor_id]

        completed = [l for l in lessons if l.completed]
        due = sum(l.price_grosze for l in completed)
        paid = sum(p.amount_grosze for p in payments)

        # Group by tutor. Lessons and payments are gathered separately because a
        # student may have paid a tutor in advance, or owe one nothing yet.
        per_tutor: dict[int | None, dict[str, int]] = {}
        for l in completed:
            per_tutor.setdefault(l.assigned_tutor_id, {"due": 0, "paid": 0})["due"] += l.price_grosze
        for pay in payments:
            per_tutor.setdefault(pay.assigned_tutor_id, {"due": 0, "paid": 0})["paid"] += pay.amount_grosze

        names = {}
        if db is not None:
            for tid in per_tutor:
                if tid is None:
                    continue
                u = db.get(models.User, tid)
                if u:
                    names[tid] = u.display_name or u.username

        by_tutor = [
            schemas.TutorBalance(
                tutor_id=tid,
                tutor_name=names.get(tid) if tid else None,
                amount_due=money.to_zlote(v["due"]),
                amount_paid=money.to_zlote(v["paid"]),
                balance=money.to_zlote(v["paid"] - v["due"]),
            )
            for tid, v in sorted(per_tutor.items(), key=lambda kv: (kv[0] is None, kv[0] or 0))
        ]

        rows.append(
            schemas.StudentSummary(
                student_id=s.id,
                student_name=s.name,
                lessons_total=len(lessons),
                lessons_completed=len(completed),
                amount_due=money.to_zlote(due),
                amount_paid=money.to_zlote(paid),
                balance=money.to_zlote(paid - due),
                by_tutor=by_tutor,
            )
        )
        total_due += due
        total_paid += paid
    return schemas.SummaryOut(
        students=rows,
        total_due=money.to_zlote(total_due),
        total_paid=money.to_zlote(total_paid),
        total_balance=money.to_zlote(total_paid - total_due),
    )


@app.get("/api/summary", response_model=schemas.SummaryOut)
def get_summary(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    students = (
        db.query(models.Student)
        .filter(models.Student.archived_at.is_(None))
        .order_by(models.Student.name)
        .all()
    )
    return _summary_for_students(students, db)


# ===================== RESCHEDULE (staff) =====================
def _resched_out(r: models.RescheduleRequest) -> schemas.RescheduleOut:
    item = schemas.RescheduleOut.model_validate(r)
    item.student_name = r.student.name if r.student else None
    if r.lesson:
        item.lesson_date = r.lesson.date
        item.lesson_time = r.lesson.start_time
    return item


def _apply_approve(r: models.RescheduleRequest, response: str | None, db: Session):
    lesson = db.get(models.Lesson, r.lesson_id)
    if lesson:
        if r.proposed_date:
            lesson.date = r.proposed_date
        if r.proposed_time:
            lesson.start_time = r.proposed_time
        lesson.rescheduled = True
    r.status = "approved"
    if response is not None:
        r.response = response
    db.commit()
    db.refresh(lesson)
    return lesson


def _apply_reject(r: models.RescheduleRequest, response: str | None, db: Session):
    r.status = "rejected"
    if response is not None:
        r.response = response
    db.commit()


@app.get("/api/reschedule-requests", response_model=list[schemas.RescheduleOut])
def list_reschedule_requests(
    user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)
):
    rows = (
        db.query(models.RescheduleRequest)
        .order_by(models.RescheduleRequest.created_at.desc())
        .all()
    )
    return [_resched_out(r) for r in rows]


@app.post("/api/reschedule-requests/{req_id}/approve", response_model=schemas.LessonOut)
def approve_reschedule(
    req_id: int,
    payload: schemas.RescheduleDecision | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    r = db.get(models.RescheduleRequest, req_id)
    if not r:
        raise HTTPException(404, "Prośba nie znaleziona")
    if r.status != "pending":
        raise HTTPException(400, "Prośba została już rozpatrzona")
    lesson = _apply_approve(r, payload.response if payload else None, db)
    return _lesson_out(lesson, db)


@app.post("/api/reschedule-requests/{req_id}/reject")
def reject_reschedule(
    req_id: int,
    payload: schemas.RescheduleDecision | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    r = db.get(models.RescheduleRequest, req_id)
    if not r:
        raise HTTPException(404, "Prośba nie znaleziona")
    if r.status != "pending":
        raise HTTPException(400, "Prośba została już rozpatrzona")
    _apply_reject(r, payload.response if payload else None, db)
    return {"ok": True}


# ===================== TUTOR (restricted view) =====================
def _tutor_owns_request(r: models.RescheduleRequest, user, db) -> bool:
    """Whether the request concerns a lesson assigned to this tutor."""
    lesson = db.get(models.Lesson, r.lesson_id)
    return bool(lesson and lesson.assigned_tutor_id == user.id)


@app.get("/api/tutor/reschedule-requests", response_model=list[schemas.RescheduleOut])
def tutor_reschedule_requests(
    user: models.User = Depends(auth.require_tutor), db: Session = Depends(get_db)
):
    # requests for lessons assigned to this tutor
    rows = (
        db.query(models.RescheduleRequest)
        .join(models.Lesson, models.Lesson.id == models.RescheduleRequest.lesson_id)
        .filter(models.Lesson.assigned_tutor_id == user.id)
        .order_by(models.RescheduleRequest.created_at.desc())
        .all()
    )
    return [_resched_out(r) for r in rows]


@app.post("/api/tutor/reschedule-requests/{req_id}/approve", response_model=schemas.LessonOut)
def tutor_approve_reschedule(
    req_id: int,
    payload: schemas.RescheduleDecision | None = None,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    r = db.get(models.RescheduleRequest, req_id)
    if not r or not _tutor_owns_request(r, user, db):
        raise HTTPException(404, "Prośba nie znaleziona")
    if r.status != "pending":
        raise HTTPException(400, "Prośba została już rozpatrzona")
    lesson = _apply_approve(r, payload.response if payload else None, db)
    return _lesson_out(lesson, db)


@app.post("/api/tutor/reschedule-requests/{req_id}/reject")
def tutor_reject_reschedule(
    req_id: int,
    payload: schemas.RescheduleDecision | None = None,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    r = db.get(models.RescheduleRequest, req_id)
    if not r or not _tutor_owns_request(r, user, db):
        raise HTTPException(404, "Prośba nie znaleziona")
    if r.status != "pending":
        raise HTTPException(400, "Prośba została już rozpatrzona")
    _apply_reject(r, payload.response if payload else None, db)
    return {"ok": True}



@app.get("/api/tutor/summary", response_model=schemas.SummaryOut)
def tutor_summary(
    user: models.User = Depends(auth.require_tutor), db: Session = Depends(get_db)
):
    """Balances for this tutor's own students only.

    Filtered rather than merely presented differently: a tutor has no business
    seeing what a student owes somebody else.
    """
    ids = {
        row[0] for row in db.query(models.Lesson.student_id)
        .filter(models.Lesson.assigned_tutor_id == user.id).distinct()
    }
    if not ids:
        return schemas.SummaryOut(students=[], total_due=0, total_paid=0, total_balance=0)

    students = (
        db.query(models.Student)
        .filter(models.Student.id.in_(ids), models.Student.archived_at.is_(None))
        .order_by(models.Student.name)
        .all()
    )
    return _summary_for_students(students, db, only_tutor_id=user.id)


@app.get("/api/tutor/lessons", response_model=list[schemas.LessonOut])
def tutor_lessons(
    start: date | None = None,
    end: date | None = None,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    q = db.query(models.Lesson).filter(models.Lesson.assigned_tutor_id == user.id)
    if start:
        q = q.filter(models.Lesson.date >= start)
    if end:
        q = q.filter(models.Lesson.date <= end)
    lessons = q.order_by(models.Lesson.date, models.Lesson.start_time).all()
    return [_lesson_out(l, db) for l in lessons]


@app.patch("/api/tutor/lessons/{lesson_id}", response_model=schemas.LessonOut)
def tutor_update_lesson(
    lesson_id: int,
    payload: schemas.TutorLessonUpdate,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    lesson = db.get(models.Lesson, lesson_id)
    if not lesson or lesson.assigned_tutor_id != user.id:
        raise HTTPException(404, "Zajęcia nie znalezione")
    data = payload.model_dump(exclude_unset=True)
    if "date" in data or "start_time" in data:
        lesson.rescheduled = True
    for k, v in data.items():
        setattr(lesson, k, v)

    # A completed lesson has to say who taught it: it is what the charge is
    # credited against, and without it the amount lands on nobody's account.
    # Rather than refuse outright, fill in the obvious answer first — the series
    # it came from, or the person marking it done if they teach.
    if lesson.completed and not lesson.assigned_tutor_id:
        if lesson.series_id:
            series = db.get(models.LessonSeries, lesson.series_id)
            if series and series.assigned_tutor_id:
                lesson.assigned_tutor_id = series.assigned_tutor_id
        if not lesson.assigned_tutor_id and user.role in ("tutor", "admin"):
            lesson.assigned_tutor_id = user.id
        if not lesson.assigned_tutor_id:
            raise HTTPException(
                400, "Przypisz korepetytora, zanim oznaczysz zajęcia jako odbyte"
            )

    db.commit()
    db.refresh(lesson)
    return _lesson_out(lesson, db)


# tutor availability: skeleton, to be extended later
@app.get("/api/tutor/availability", response_model=list[schemas.AvailabilityOut])
def tutor_get_availability(
    user: models.User = Depends(auth.require_tutor), db: Session = Depends(get_db)
):
    rows = (
        db.query(models.Availability)
        .filter(models.Availability.tutor_id == user.id)
        .order_by(models.Availability.weekday, models.Availability.start_time)
        .all()
    )
    return rows


@app.post("/api/tutor/availability", response_model=schemas.AvailabilityOut)
def tutor_add_availability(
    payload: schemas.AvailabilityCreate,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    a = models.Availability(tutor_id=user.id, **payload.model_dump())
    db.add(a)
    db.commit()
    db.refresh(a)
    return a


@app.delete("/api/tutor/availability/{av_id}")
def tutor_delete_availability(
    av_id: int,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    a = db.get(models.Availability, av_id)
    if not a or a.tutor_id != user.id:
        raise HTTPException(404, "Nie znaleziono")
    db.delete(a)
    db.commit()
    return {"ok": True}


# ===================== STUDENT PANEL =====================
def _student_for_user(db, user) -> models.Student:
    s = db.query(models.Student).filter(models.Student.user_id == user.id).first()
    if not s:
        raise HTTPException(404, "Brak powiązanego profilu ucznia")
    return s


@app.get("/api/me/lessons", response_model=list[schemas.LessonOut])
def my_lessons(
    start: date | None = None,
    end: date | None = None,
    user: models.User = Depends(auth.require_student),
    db: Session = Depends(get_db),
):
    student = _student_for_user(db, user)
    q = db.query(models.Lesson).filter(models.Lesson.student_id == student.id)
    if start:
        q = q.filter(models.Lesson.date >= start)
    if end:
        q = q.filter(models.Lesson.date <= end)
    lessons = q.order_by(models.Lesson.date, models.Lesson.start_time).all()
    return [_lesson_out(l, db) for l in lessons]


@app.get("/api/me/summary", response_model=schemas.StudentSummary)
def my_summary(
    user: models.User = Depends(auth.require_student), db: Session = Depends(get_db)
):
    student = _student_for_user(db, user)
    return _summary_for_students([student], db).students[0]


@app.get("/api/me/transfer", response_model=schemas.TransferInfo)
def my_transfer_info(
    user: models.User = Depends(auth.require_student), db: Session = Depends(get_db)
):
    """Bank details and a scannable 2D payload per tutor the student owes.

    Not a payment gateway: nothing is charged, the payer confirms in their own
    banking app. It removes the retyping, which is where wrong transfer titles
    come from — and with two tutors, where money sent to the wrong account
    comes from.
    """
    student = _student_for_user(db, user)
    summary = _summary_for_students([student], db).students[0]
    fallback = transfer_code.configured()

    targets = []
    for row in summary.by_tutor:
        owed_grosze = max(0, -money.to_grosze(row.balance))

        account = recipient = None
        if row.tutor_id:
            tutor = db.get(models.User, row.tutor_id)
            if tutor and tutor.bank_account:
                account = tutor.bank_account
                recipient = tutor.display_name or tutor.username
        if not account and fallback:
            # Lessons with no tutor, or a tutor who has not set an account yet.
            account, recipient = fallback["account"], fallback["recipient"]
        if not account:
            continue

        title = f"Korepetycje {student.name}"
        try:
            payload = transfer_code.build(
                account=account, recipient=recipient, title=title,
                amount_grosze=owed_grosze,
                nip=(fallback or {}).get("nip", ""),
            )
        except ValueError:
            # A misconfigured account: skip it rather than show a code that
            # sends money into the void.
            continue

        targets.append(schemas.TransferTarget(
            tutor_id=row.tutor_id,
            recipient=recipient,
            account=transfer_code.format_account(account),
            title=title,
            amount=money.to_zlote(owed_grosze) if owed_grosze else None,
            qr_payload=payload,
        ))

    return schemas.TransferInfo(configured=bool(targets), targets=targets)


@app.get("/api/me/payments", response_model=list[schemas.PaymentOut])
def my_payments(
    user: models.User = Depends(auth.require_student), db: Session = Depends(get_db)
):
    student = _student_for_user(db, user)
    payments = (
        db.query(models.Payment)
        .filter(models.Payment.student_id == student.id)
        .order_by(models.Payment.date.desc())
        .all()
    )
    out = []
    for p in payments:
        item = schemas.PaymentOut.model_validate(p)
        item.student_name = student.name
        out.append(item)
    return out


@app.get("/api/me/reschedule-requests", response_model=list[schemas.RescheduleOut])
def my_reschedule_requests(
    user: models.User = Depends(auth.require_student), db: Session = Depends(get_db)
):
    student = _student_for_user(db, user)
    rows = (
        db.query(models.RescheduleRequest)
        .filter(models.RescheduleRequest.student_id == student.id)
        .order_by(models.RescheduleRequest.created_at.desc())
        .all()
    )
    return [_resched_out(r) for r in rows]


@app.post("/api/me/reschedule-requests", response_model=schemas.RescheduleOut)
def create_reschedule_request(
    payload: schemas.RescheduleCreate,
    user: models.User = Depends(auth.require_student),
    db: Session = Depends(get_db),
):
    student = _student_for_user(db, user)
    lesson = db.get(models.Lesson, payload.lesson_id)
    if not lesson or lesson.student_id != student.id:
        raise HTTPException(404, "Zajęcia nie znalezione")
    req = models.RescheduleRequest(
        lesson_id=lesson.id,
        tutor_id=lesson.tutor_id,
        student_id=student.id,
        proposed_date=payload.proposed_date,
        proposed_time=payload.proposed_time,
        message=payload.message,
        status="pending",
    )
    db.add(req)
    db.commit()
    db.refresh(req)
    return _resched_out(req)


@app.get("/api/me/lessons/{lesson_id}/available-slots", response_model=schemas.AvailableSlotsOut)
def my_lesson_available_slots(
    lesson_id: int,
    user: models.User = Depends(auth.require_student),
    db: Session = Depends(get_db),
):
    """Free windows of the assigned tutor for the next 14 days, for reschedule requests."""
    student = _student_for_user(db, user)
    lesson = db.get(models.Lesson, lesson_id)
    if not lesson or lesson.student_id != student.id:
        raise HTTPException(404, "Zajęcia nie znalezione")
    if not lesson.assigned_tutor_id:
        return schemas.AvailableSlotsOut(has_tutor=False)
    tutor = db.get(models.User, lesson.assigned_tutor_id)
    days = services.free_windows_for_tutor(
        db, lesson.assigned_tutor_id, date.today(), days_ahead=14,
        duration_min=lesson.duration_min or 60, exclude_lesson_id=lesson.id,
    )
    if not days:
        # a tutor is assigned but has no availability configured
        return schemas.AvailableSlotsOut(
            has_tutor=False,
            tutor_name=(tutor.display_name or tutor.username) if tutor else None,
        )
    return schemas.AvailableSlotsOut(
        has_tutor=True,
        tutor_name=(tutor.display_name or tutor.username) if tutor else None,
        days=days,
    )

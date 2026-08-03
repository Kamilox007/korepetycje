import os
from contextlib import asynccontextmanager
from pathlib import Path
from datetime import date, timedelta
from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordRequestForm
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy.orm import Session

from . import models, schemas, services, auth
from .database import get_db, SessionLocal


def seed_admin():
    """Zapewnia konto administratora i przypisuje osierocone rekordy do organizacji.

    Schemat bazy jest w gestii Alembica — tu tylko dane.
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
                # konto z wciąż domyślnym hasłem musi je zmienić przy najbliższym logowaniu
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
    """Nie startuj na bazie, która nie jest na najnowszej migracji."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory
    from alembic.runtime.migration import MigrationContext
    from .database import engine

    cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
    # script_location w ini jest względne wobec CWD — uniezależniamy się od tego,
    # bo uvicorn bywa uruchamiany z dowolnego katalogu
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    _require_migrated_db()
    seed_admin()
    yield


app = FastAPI(title="Korepetycje API", version="3.0", lifespan=lifespan)

limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Origins frontendu, np. CORS_ORIGINS="https://korepetycje.example.com"
# W dev domyślnie serwer Vite. Gwiazdka jest świadomie niedozwolona.
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
    form: OAuth2PasswordRequestForm = Depends(),
    db: Session = Depends(get_db),
):
    user = auth.authenticate(db, form.username, form.password)
    token = auth.create_access_token(user)
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
    payload: schemas.ChangePasswordIn,
    user: models.User = Depends(auth.get_current_user),
    db: Session = Depends(get_db),
):
    if not auth.verify_password(payload.old_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Błędne dotychczasowe hasło")
    if len(payload.new_password) < 10:
        raise HTTPException(status_code=400, detail="Nowe hasło musi mieć min. 10 znaków")
    if auth.verify_password(payload.new_password, user.password_hash):
        raise HTTPException(status_code=400, detail="Nowe hasło musi różnić się od dotychczasowego")
    user.password_hash = auth.hash_password(payload.new_password)
    user.must_change_password = False
    db.commit()
    db.refresh(user)
    # konto miało token krótkoterminowy — wydaj pełny, żeby nie wylogowywać użytkownika
    return {"ok": True, "access_token": auth.create_access_token(user)}


# ===================== ZARZĄDZANIE UŻYTKOWNIKAMI =====================
# Sekretariat może tworzyć korepetytorów. Admin może tworzyć korepetytorów
# i sekretariat. Nikt poza adminem nie tworzy/edytuje kont admin/sekretariat.
@app.get("/api/users", response_model=list[schemas.UserOut])
def list_users(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    # sekretariat widzi korepetytorów i uczniów; admin widzi wszystkich
    q = db.query(models.User)
    if user.role == "secretary":
        q = q.filter(models.User.role.in_(["tutor", "student"]))
    return q.order_by(models.User.role, models.User.display_name).all()


@app.get("/api/tutors", response_model=list[schemas.TutorOption])
def list_tutors(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    rows = db.query(models.User).filter(models.User.role == "tutor").order_by(models.User.display_name).all()
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
    # tylko admin może tworzyć sekretariat/admina
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
    # sekretariat nie edytuje kont administracji
    if target.role in ("admin", "secretary") and user.role != "admin":
        raise HTTPException(403, "Brak uprawnień do edycji tego konta")
    data = payload.model_dump(exclude_unset=True)
    for k, v in data.items():
        setattr(target, k, v)
    db.commit()
    db.refresh(target)
    return target


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
    # sekretariat nie rusza kont admin/sekretariat
    if target.role in ("admin", "secretary") and user.role != "admin":
        raise HTTPException(403, "Brak uprawnień do usunięcia tego konta")
    # odłącz przypisania korepetytora od zajęć/serii
    if target.role == "tutor":
        for l in db.query(models.Lesson).filter(models.Lesson.assigned_tutor_id == target.id).all():
            l.assigned_tutor_id = None
        for s in db.query(models.LessonSeries).filter(models.LessonSeries.assigned_tutor_id == target.id).all():
            s.assigned_tutor_id = None
    db.delete(target)
    db.commit()
    return {"ok": True}


# ===================== SUBJECTS (administracja) =====================
@app.get("/api/subjects", response_model=list[schemas.SubjectOut])
def list_subjects(user: models.User = Depends(auth.require_active_user), db: Session = Depends(get_db)):
    # czytać przedmioty mogą wszyscy zalogowani (do wyświetlania nazw)
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
    # odłącz od zajęć/serii (nie kasujemy zajęć)
    for l in db.query(models.Lesson).filter(models.Lesson.subject_id == subject_id).all():
        l.subject_id = None
    for s in db.query(models.LessonSeries).filter(models.LessonSeries.subject_id == subject_id).all():
        s.subject_id = None
    db.delete(subj)
    db.commit()
    return {"ok": True}


# ===================== STUDENTS (administracja) =====================
def _student_out(s: models.Student) -> schemas.StudentOut:
    item = schemas.StudentOut.model_validate(s)
    item.has_account = s.user_id is not None
    return item


@app.get("/api/students", response_model=list[schemas.StudentOut])
def list_students(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    rows = db.query(models.Student).order_by(models.Student.name).all()
    return [_student_out(s) for s in rows]


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
    student = _get_student(db, student_id)
    if student.user_id:
        acc = db.get(models.User, student.user_id)
        if acc:
            db.delete(acc)
    db.delete(student)
    db.commit()
    return {"ok": True}


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


# ===================== SERIES (administracja) =====================
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
    # generator przenosi assigned_tutor_id, subject_id i level na wystąpienia
    services.generate_lessons_for_series(db, series, date.today() + timedelta(days=90))
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


@app.get("/api/lessons", response_model=list[schemas.LessonOut])
def list_lessons(
    start: date | None = None,
    end: date | None = None,
    student_id: int | None = None,
    user: models.User = Depends(auth.require_staff),
    db: Session = Depends(get_db),
):
    horizon = end or (date.today() + timedelta(days=90))
    services.regenerate_all(db, horizon)

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
    if not data.get("price"):
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


# ----- przypisywanie korepetytora -----
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


# ===================== PAYMENTS (administracja) =====================
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
    payment = models.Payment(tutor_id=user.id, **data)
    db.add(payment)
    db.commit()
    db.refresh(payment)
    item = schemas.PaymentOut.model_validate(payment)
    item.student_name = student.name
    return item


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


# ===================== SUMMARY (administracja) =====================
def _summary_for_students(students):
    rows = []
    total_due = total_paid = 0.0
    for s in students:
        lessons = [l for l in s.lessons if not l.cancelled]
        completed = [l for l in lessons if l.completed]
        due = round(sum(l.price for l in completed), 2)
        paid = round(sum(p.amount for p in s.payments), 2)
        rows.append(
            schemas.StudentSummary(
                student_id=s.id,
                student_name=s.name,
                lessons_total=len(lessons),
                lessons_completed=len(completed),
                amount_due=due,
                amount_paid=paid,
                balance=round(paid - due, 2),
            )
        )
        total_due += due
        total_paid += paid
    return schemas.SummaryOut(
        students=rows,
        total_due=round(total_due, 2),
        total_paid=round(total_paid, 2),
        total_balance=round(total_paid - total_due, 2),
    )


@app.get("/api/summary", response_model=schemas.SummaryOut)
def get_summary(user: models.User = Depends(auth.require_staff), db: Session = Depends(get_db)):
    students = db.query(models.Student).order_by(models.Student.name).all()
    return _summary_for_students(students)


# ===================== RESCHEDULE (administracja) =====================
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


# ===================== KOREPETYTOR (widok ograniczony) =====================
def _tutor_owns_request(r: models.RescheduleRequest, user, db) -> bool:
    """Czy prośba dotyczy zajęcia przypisanego do tego korepetytora."""
    lesson = db.get(models.Lesson, r.lesson_id)
    return bool(lesson and lesson.assigned_tutor_id == user.id)


@app.get("/api/tutor/reschedule-requests", response_model=list[schemas.RescheduleOut])
def tutor_reschedule_requests(
    user: models.User = Depends(auth.require_tutor), db: Session = Depends(get_db)
):
    # prośby dotyczące zajęć przypisanych do tego korepetytora
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



@app.get("/api/tutor/lessons", response_model=list[schemas.LessonOut])
def tutor_lessons(
    start: date | None = None,
    end: date | None = None,
    user: models.User = Depends(auth.require_tutor),
    db: Session = Depends(get_db),
):
    horizon = end or (date.today() + timedelta(days=90))
    services.regenerate_all(db, horizon)
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
    db.commit()
    db.refresh(lesson)
    return _lesson_out(lesson, db)


# dyspozycyjność korepetytora — szkielet (rozbudowa w kolejnym etapie)
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


# ===================== PANEL UCZNIA =====================
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
    horizon = end or (date.today() + timedelta(days=90))
    services.regenerate_all(db, horizon)
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
    return _summary_for_students([student]).students[0]


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
    """Wolne okna przypisanego korepetytora na najbliższe 14 dni — do prośby o zmianę."""
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
        # korepetytor jest, ale nie ma ustawionej dyspozycyjności
        return schemas.AvailableSlotsOut(
            has_tutor=False,
            tutor_name=(tutor.display_name or tutor.username) if tutor else None,
        )
    return schemas.AvailableSlotsOut(
        has_tutor=True,
        tutor_name=(tutor.display_name or tutor.username) if tutor else None,
        days=days,
    )

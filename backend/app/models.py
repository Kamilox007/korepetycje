from datetime import datetime, date, time
from sqlalchemy import (
    MetaData,
    Integer, String, Float, Boolean, Date, Time, DateTime, ForeignKey, Text,
    UniqueConstraint,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

from .money import to_grosze, to_zlote


# Without this SQLAlchemy creates unnamed constraints, and Alembic in batch
# mode (the only mode that works on SQLite) then refuses to run with
# "ValueError: Constraint must have a name".
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class User(Base):
    """Login account. Role: 'tutor' or 'student'."""
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[str] = mapped_column(String(20), nullable=False)  # tutor | student
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)  # kolor korepetytora w kalendarzu
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # failed login counter and the moment until which the account stays locked (naive UTC)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # when role == student, the account points at the student record
    student_profile: Mapped["Student"] = relationship(
        back_populates="user", foreign_keys="Student.user_id", uselist=False
    )


class Student(Base):
    __tablename__ = "students"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # owning tutor
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # optional login account for the student
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    contact: Mapped[str | None] = mapped_column(String(200), nullable=True)
    default_price_grosze: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    user: Mapped["User"] = relationship(
        back_populates="student_profile", foreign_keys=[user_id]
    )
    lessons: Mapped[list["Lesson"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )
    series: Mapped[list["LessonSeries"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )
    payments: Mapped[list["Payment"]] = relationship(
        back_populates="student", cascade="all, delete-orphan"
    )

    @property
    def default_price(self) -> float:
        """Zloty, for (de)serialization only. Arithmetic runs on default_price_grosze."""
        return to_zlote(self.default_price_grosze)

    @default_price.setter
    def default_price(self, value) -> None:
        self.default_price_grosze = to_grosze(value)


class LessonSeries(Base):
    """A recurring lesson definition. Generates individual occurrences (Lesson)."""
    __tablename__ = "lesson_series"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # assigned tutor (may stay empty until staff assigns one)
    assigned_tutor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False)
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subjects.id"), nullable=True)
    level: Mapped[str | None] = mapped_column(String(20), nullable=True)  # basic | extended
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    price_grosze: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True)

    student: Mapped["Student"] = relationship(back_populates="series")
    lessons: Mapped[list["Lesson"]] = relationship(
        back_populates="series", cascade="all, delete-orphan"
    )

    @property
    def price(self) -> float:
        """Zloty, for (de)serialization only. Arithmetic runs on price_grosze."""
        return to_zlote(self.price_grosze)

    @price.setter
    def price(self, value) -> None:
        self.price_grosze = to_grosze(value)


class Lesson(Base):
    """A single lesson occurrence, either from a series or one-off."""
    __tablename__ = "lessons"
    __table_args__ = (
        # One series slot = at most one occurrence. Deduplicating in Python
        # (existing_origins in services) races under concurrent requests, so this
        # is the database-level guarantee. NULLs do not collide in SQL, so one-off
        # lessons (series_id IS NULL) are left alone.
        UniqueConstraint("series_id", "origin_date", name="uq_lessons_series_origin"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # assigned tutor (may be empty)
    assigned_tutor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False, index=True)
    series_id: Mapped[int | None] = mapped_column(
        ForeignKey("lesson_series.id"), nullable=True
    )
    subject_id: Mapped[int | None] = mapped_column(ForeignKey("subjects.id"), nullable=True)
    level: Mapped[str | None] = mapped_column(String(20), nullable=True)  # basic | extended
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # original series slot date, unchanged by reschedules; None for one-off lessons
    origin_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    duration_min: Mapped[int] = mapped_column(Integer, default=60)
    price_grosze: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    completed: Mapped[bool] = mapped_column(Boolean, default=False)
    cancelled: Mapped[bool] = mapped_column(Boolean, default=False)
    rescheduled: Mapped[bool] = mapped_column(Boolean, default=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)

    student: Mapped["Student"] = relationship(back_populates="lessons")
    series: Mapped["LessonSeries"] = relationship(back_populates="lessons")

    @property
    def price(self) -> float:
        """Zloty, for (de)serialization only. Arithmetic runs on price_grosze."""
        return to_zlote(self.price_grosze)

    @price.setter
    def price(self, value) -> None:
        self.price_grosze = to_grosze(value)


class Payment(Base):
    """A payment recorded against a student."""
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False, index=True)
    amount_grosze: Mapped[int] = mapped_column(Integer, nullable=False)
    date: Mapped[date] = mapped_column(Date, default=date.today)
    payer: Mapped[str | None] = mapped_column(String(200), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    student: Mapped["Student"] = relationship(back_populates="payments")

    @property
    def amount(self) -> float:
        """Zloty, for (de)serialization only. Arithmetic runs on amount_grosze."""
        return to_zlote(self.amount_grosze)

    @amount.setter
    def amount(self, value) -> None:
        self.amount_grosze = to_grosze(value)


class RescheduleRequest(Base):
    """A student's request to move a lesson. Staff approves or rejects it."""
    __tablename__ = "reschedule_requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lesson_id: Mapped[int] = mapped_column(ForeignKey("lessons.id"), nullable=False)
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("students.id"), nullable=False)
    proposed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    proposed_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    message: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="pending")  # pending|approved|rejected
    response: Mapped[str | None] = mapped_column(Text, nullable=True)  # staff comment
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    lesson: Mapped["Lesson"] = relationship()
    student: Mapped["Student"] = relationship()


class SeriesSkip(Base):
    """An original series slot date that was deleted and must not be regenerated."""
    __tablename__ = "series_skips"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    series_id: Mapped[int] = mapped_column(ForeignKey("lesson_series.id"), nullable=False, index=True)
    skip_date: Mapped[date] = mapped_column(Date, nullable=False)


class Availability(Base):
    """A tutor's availability window on a given weekday."""
    __tablename__ = "availability"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # 0=Mon ... 6=Sun
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)


class Subject(Base):
    """A subject defined by the organisation (e.g. maths, physics)."""
    __tablename__ = "subjects"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)

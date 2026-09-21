from datetime import datetime, date, time
from sqlalchemy import (
    MetaData,
    Integer, String, Float, Boolean, Date, Time, DateTime, ForeignKey, Text,
    UniqueConstraint, JSON,
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
    # Where this tutor's students send their transfers. Admin-only to edit:
    # swapping the number silently redirects payments, which is the real risk
    # here - not the number being seen, since it goes on every invoice anyway.
    bank_account: Mapped[str | None] = mapped_column(String(26), nullable=True)
    # Same rationale and same admin-only restriction as bank_account: a BLIK
    # phone number is an alternative way for students to pay this tutor.
    blik_phone: Mapped[str | None] = mapped_column(String(9), nullable=True)
    # Secret standing in for auth on the public .ics feed URL (below) - Google's
    # server fetches that URL with no session cookie to check, so the token
    # itself is what proves it's this tutor's feed. Generated lazily, and
    # replaceable if the URL ever leaks.
    calendar_token: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True, index=True)
    # Whiteboard library items the account added ("dodaj do biblioteki").
    # Follows the account across devices; the built-in shapes are not stored.
    board_library: Mapped[list | None] = mapped_column(JSON, nullable=True)
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=False)
    # Set once, the first time the account clears must_change_password with the
    # checkbox ticked (covers both the Regulamin and the Polityka Prywatności —
    # one checkbox, two documents). Kept indefinitely as evidence of consent;
    # never overwritten on a later password reset that reuses the same flow.
    privacy_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
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

    # Soft delete. Removing a student used to cascade into their payments, which
    # meant one click destroyed the financial record. Archiving hides them from
    # the lists while every lesson and payment stays intact.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

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
    # Overrides the assigned tutor's color in the calendar when set - a manual
    # flag (e.g. "still needs a time", or just to spot a moved lesson at a glance).
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)

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
    """A payment recorded against a student, credited to one tutor.

    With more than one tutor a bare "the student paid 200" is ambiguous: it has
    to say whose balance it settles, or the two accounts cannot be told apart.
    """
    __tablename__ = "payments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Author of the record. Kept separate from the tutor it is credited to:
    # a secretary may enter a payment for someone else's lesson.
    tutor_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # Whose balance this settles. Same name and meaning as on Lesson.
    assigned_tutor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
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


class IncomeLimitSetting(Base):
    """The nierejestrowana-działalność quarterly income limit, from a given date.

    Tied to the minimum wage, so it changes over time rather than staying one
    number forever -- a dated setting, not a single overwritable value.
    """
    __tablename__ = "income_limit_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    effective_from: Mapped[date] = mapped_column(Date, unique=True, nullable=False, index=True)
    limit_grosze: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    @property
    def limit(self) -> float:
        """Zloty, for (de)serialization only. Arithmetic runs on limit_grosze."""
        return to_zlote(self.limit_grosze)

    @limit.setter
    def limit(self, value) -> None:
        self.limit_grosze = to_grosze(value)


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


class Session(Base):
    """A record of an issued token, so that sessions can be revoked.

    JWTs are stateless: without this table a token stays valid until it expires,
    which means changing a password does not end sessions open elsewhere. Every
    request checks that its `jti` is still here and not revoked.
    """
    __tablename__ = "sessions"

    jti: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    # Throttled: rewritten at most once every few minutes, not on every request.
    # SQLite locks the file on write and the WAL stream would grow for nothing.
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime, nullable=False, index=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # NULL means active. Set on logout and on password change.
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


# ===================== TABLICA (współdzielona tablica z uczniem) =====================

class Board(Base):
    """A shared whiteboard. The token in the URL is the whole access control:
    whoever has the link can draw. There is no per-student permission table
    on purpose - see README, "Decyzje projektowe".
    """
    __tablename__ = "boards"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # Stored in the clear (not hashed): the panel has to show the link again.
    # Same shape as User.calendar_token, which plays the same role.
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # Optional: a trial-lesson board needs no student record. Only used to show
    # the board on the student's card - NOT a visibility rule (that goes by
    # created_by_user_id, so the two tutor columns on Student cannot be mixed up).
    student_id: Mapped[int | None] = mapped_column(ForeignKey("students.id"), nullable=True, index=True)
    # Who entered it. Same split as Lesson/Payment: the author is not
    # necessarily the tutor it belongs to, since staff can set boards up on a
    # tutor's behalf.
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    # Whose board it is: this tutor sees it in their panel and is its owner
    # under the link. A tutor creating a board is assigned automatically; staff
    # pick (or leave empty for a staff-only board).
    assigned_tutor_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    # Bumped on every page save.
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    # Set when someone connects to the board's WebSocket, not on GET - the
    # repo avoids a write on every read (compare Session.last_seen_at).
    last_opened_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Soft delete, same convention as Student. An archived board's link answers 404.
    archived_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True, index=True)

    student: Mapped["Student | None"] = relationship()
    pages: Mapped[list["BoardPage"]] = relationship(
        back_populates="board", cascade="all, delete-orphan", order_by="BoardPage.idx"
    )


class BoardPage(Base):
    """One page of a board. A new lesson usually gets a new page.

    Identity is `id`, never `idx`: rooms, snapshots and the WebSocket all point
    at a page by id, so deleting a page cannot re-target anything. `idx` is
    only the sort order and may have gaps after a delete.
    """
    __tablename__ = "board_pages"
    __table_args__ = (
        # Two clients adding a page at once is a race; the database decides,
        # not Python - same rule as (series_id, origin_date) on lessons.
        UniqueConstraint("board_id", "idx", name="uq_board_pages_board_idx"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    # ondelete documents intent; SQLite here does not enforce FKs, so purge
    # deletes children explicitly (see purge_board in main.py).
    board_id: Mapped[int] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    idx: Mapped[int] = mapped_column(Integer, nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    # Excalidraw elements, sorted by their fractional `index`. Never the
    # `files` map (binary data lives on disk, see BoardFile) and never
    # appState (that is per-browser view state, kept in localStorage).
    elements: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Save counter. Informational (tests, diagnostics) - not an optimistic
    # lock, since merges by version/versionNonce already resolve conflicts.
    rev: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    board: Mapped["Board"] = relationship(back_populates="pages")


class BoardFile(Base):
    """An image pasted into a board. Bytes live on disk under a sha256-derived
    path, never in the database: one photo of a homework problem would
    otherwise land in every Litestream snapshot.

    Two records may share a sha256 (global dedup); the disk file is removed
    only when the last record pointing at it goes.
    """
    __tablename__ = "board_files"
    __table_args__ = (
        UniqueConstraint("board_id", "file_id", name="uq_board_files_board_file_id"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # Identifier assigned by Excalidraw; referenced from image elements.
    file_id: Mapped[str] = mapped_column(String(120), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mime: Mapped[str] = mapped_column(String(60), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)


class BoardSnapshot(Base):
    """A page's elements as they were before the first save of a day.

    Whoever has the link can select-all and press Delete, usually by accident;
    the live save would then overwrite the only copy. Retained 30 days.
    """
    __tablename__ = "board_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    board_id: Mapped[int] = mapped_column(
        ForeignKey("boards.id", ondelete="CASCADE"), nullable=False, index=True
    )
    page_id: Mapped[int] = mapped_column(
        ForeignKey("board_pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    elements: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    # Indexed for the retention sweep.
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False, index=True)


class StudentFile(Base):
    """A PDF handed to a student (worksheet, solutions, notes).

    Same content-addressed disk store as BoardFile; the row is metadata only.
    ondelete documents intent - SQLite here does not enforce it, so
    purge_student removes these rows explicitly.
    """
    __tablename__ = "student_files"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), nullable=False)
    # Display name; the original filename, cleaned up. Never part of a path.
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    mime: Mapped[str] = mapped_column(String(60), nullable=False)
    bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

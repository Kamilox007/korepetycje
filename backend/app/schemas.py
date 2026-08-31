from datetime import date as date_t, time as time_t, datetime
from pydantic import BaseModel, ConfigDict


# ---------- Student ----------
class StudentBase(BaseModel):
    name: str
    contact: str | None = None
    default_price: float = 0.0
    note: str | None = None


class StudentCreate(StudentBase):
    pass


class StudentUpdate(BaseModel):
    name: str | None = None
    contact: str | None = None
    default_price: float | None = None
    note: str | None = None


class StudentOut(StudentBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    created_at: datetime
    user_id: int | None = None
    has_account: bool = False
    archived_at: datetime | None = None


# ---------- Lesson ----------
class LessonBase(BaseModel):
    student_id: int
    title: str | None = None
    date: date_t
    start_time: time_t
    duration_min: int = 60
    price: float = 0.0
    note: str | None = None
    subject_id: int | None = None
    level: str | None = None
    # Settable at creation: a one-off lesson otherwise starts unassigned and,
    # with two tutors, there is nothing to guess from later.
    assigned_tutor_id: int | None = None


class LessonCreate(LessonBase):
    pass


class LessonUpdate(BaseModel):
    title: str | None = None
    date: date_t | None = None
    start_time: time_t | None = None
    duration_min: int | None = None
    price: float | None = None
    completed: bool | None = None
    cancelled: bool | None = None
    note: str | None = None
    assigned_tutor_id: int | None = None
    subject_id: int | None = None
    level: str | None = None


class LessonOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    series_id: int | None
    title: str | None
    date: date_t
    origin_date: date_t | None = None
    start_time: time_t
    duration_min: int
    price: float
    completed: bool
    cancelled: bool
    rescheduled: bool
    note: str | None
    student_name: str | None = None
    assigned_tutor_id: int | None = None
    assigned_tutor_name: str | None = None
    assigned_tutor_color: str | None = None
    subject_id: int | None = None
    subject_name: str | None = None
    level: str | None = None


# ---------- LessonSeries ----------
class SeriesBase(BaseModel):
    student_id: int
    title: str | None = None
    weekday: int  # 0=Mon ... 6=Sun
    start_time: time_t
    duration_min: int = 60
    price: float = 0.0
    start_date: date_t
    end_date: date_t | None = None
    assigned_tutor_id: int | None = None
    subject_id: int | None = None
    level: str | None = None


class SeriesCreate(SeriesBase):
    pass


class SeriesUpdate(BaseModel):
    """Every field optional: only what is sent gets changed."""
    title: str | None = None
    weekday: int | None = None
    start_time: time_t | None = None
    duration_min: int | None = None
    price: float | None = None
    end_date: date_t | None = None
    assigned_tutor_id: int | None = None
    subject_id: int | None = None
    level: str | None = None
    active: bool | None = None


class SeriesOut(SeriesBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    active: bool
    subject_name: str | None = None
    assigned_tutor_name: str | None = None
    assigned_tutor_color: str | None = None


# ---------- Payment ----------
class PaymentBase(BaseModel):
    student_id: int
    amount: float
    date: date_t | None = None
    payer: str | None = None
    note: str | None = None
    # Which tutor's balance this settles. Optional on input: with one tutor the
    # server fills it in, so nothing has to change for a single-tutor setup.
    assigned_tutor_id: int | None = None


class PaymentCreate(PaymentBase):
    pass


class TransferTarget(BaseModel):
    """Payment details for one recipient, with the amount owed to them.

    account/qr_payload and phone are independent: a tutor may have set up
    either, both, or (transiently, mid-setup) neither, in which case this
    target is left out entirely — see the handler.
    """
    tutor_id: int | None = None
    recipient: str
    account: str | None = None          # formatted for reading
    title: str
    amount: float | None = None         # what is owed, zloty; None means "any"
    qr_payload: str | None = None       # ZBP 2D string, rendered client-side
    phone: str | None = None            # BLIK, formatted for reading


class TransferInfo(BaseModel):
    """One entry per tutor the student owes money to.

    A student taking two subjects from two tutors pays two different accounts,
    so the panel shows a code for each rather than one combined figure.
    """
    configured: bool
    targets: list[TransferTarget] = []


class PaymentUpdate(BaseModel):
    """Every field optional: only what is sent gets changed."""
    amount: float | None = None
    assigned_tutor_id: int | None = None
    date: date_t | None = None
    payer: str | None = None
    note: str | None = None


class PaymentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    student_id: int
    amount: float
    date: date_t
    payer: str | None
    note: str | None
    created_at: datetime
    student_name: str | None = None


# ---------- Summary ----------
class TutorBalance(BaseModel):
    """One student's account with one tutor."""
    tutor_id: int | None = None
    tutor_name: str | None = None
    amount_due: float
    amount_paid: float
    balance: float


class StudentSummary(BaseModel):
    student_id: int
    student_name: str
    lessons_total: int
    lessons_completed: int
    amount_due: float       # total for completed lessons
    amount_paid: float      # total payments
    balance: float          # paid - due (negative = owes money)
    # The same figures split by tutor. With one tutor this holds a single entry
    # equal to the totals above; the flat fields stay so nothing that reads the
    # overall balance has to care how many tutors there are.
    by_tutor: list[TutorBalance] = []


class SummaryOut(BaseModel):
    students: list[StudentSummary]
    total_due: float
    total_paid: float
    total_balance: float


# ---------- Auth / User ----------
class LoginOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: str
    username: str
    display_name: str | None = None
    must_change_password: bool = False


class MeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    role: str
    display_name: str | None = None
    must_change_password: bool = False


class ChangePasswordIn(BaseModel):
    old_password: str
    new_password: str
    # Confirms acceptance of both the Regulamin and the Polityka Prywatności
    # (one checkbox, two documents). Required (and checked) only while
    # must_change_password is still set — see the handler. Ignored on a
    # routine, already-onboarded password change.
    accept_privacy: bool = False


# student account created by staff
class StudentAccountCreate(BaseModel):
    username: str
    password: str


class StudentAccountOut(BaseModel):
    student_id: int
    username: str
    # password returned only once, on creation, so staff can pass it on
    password: str | None = None


# ---------- Reschedule requests ----------
class RescheduleCreate(BaseModel):
    lesson_id: int
    proposed_date: date_t | None = None
    proposed_time: time_t | None = None
    message: str | None = None


class RescheduleOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    lesson_id: int
    student_id: int
    proposed_date: date_t | None
    proposed_time: time_t | None
    message: str | None
    status: str
    created_at: datetime
    student_name: str | None = None
    lesson_date: date_t | None = None
    lesson_time: time_t | None = None
    response: str | None = None


# ---------- User management (admin / secretary) ----------
class StaffUserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str  # 'tutor' or 'secretary' (secretary is admin-only)
    color: str | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    role: str
    display_name: str | None = None
    color: str | None = None
    bank_account: str | None = None
    blik_phone: str | None = None


class UserUpdate(BaseModel):
    display_name: str | None = None
    color: str | None = None
    # Admin only; see the handler for why.
    bank_account: str | None = None
    blik_phone: str | None = None


class UserCreatedOut(BaseModel):
    id: int
    username: str
    role: str
    display_name: str | None = None
    password: str | None = None  # returned once, on creation


class PasswordResetIn(BaseModel):
    # Optional: when absent the server generates one.
    password: str | None = None


# lightweight entry for the assignable-tutor list
class TutorOption(BaseModel):
    id: int
    display_name: str
    color: str | None = None


# staff decision on a request (with optional feedback)
class RescheduleDecision(BaseModel):
    response: str | None = None


# a tutor may only change the time and mark attendance
class TutorLessonUpdate(BaseModel):
    date: date_t | None = None
    start_time: time_t | None = None
    completed: bool | None = None
    note: str | None = None


# availability
class AvailabilityCreate(BaseModel):
    weekday: int  # 0=Mon ... 6=Sun
    start_time: time_t
    end_time: time_t


class AvailabilityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    weekday: int
    start_time: time_t
    end_time: time_t


# ---------- Subjects ----------
class SubjectCreate(BaseModel):
    name: str
    color: str | None = None


class SubjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    color: str | None = None


# ---------- Wolne terminy korepetytora (dla ucznia) ----------
class FreeWindow(BaseModel):
    start: str  # "HH:MM"
    end: str    # "HH:MM"


class FreeDay(BaseModel):
    date: date_t
    weekday: int
    windows: list[FreeWindow]
    slots: list[str] = []  # dozwolone godziny startu "HH:MM"


class AvailableSlotsOut(BaseModel):
    has_tutor: bool                 # whether the lesson has a tutor with declared availability
    tutor_name: str | None = None
    days: list[FreeDay] = []

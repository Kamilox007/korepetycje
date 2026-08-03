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
    weekday: int  # 0=pon ... 6=niedz
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


class SeriesOut(SeriesBase):
    model_config = ConfigDict(from_attributes=True)
    id: int
    active: bool
    subject_name: str | None = None


# ---------- Payment ----------
class PaymentBase(BaseModel):
    student_id: int
    amount: float
    date: date_t | None = None
    payer: str | None = None
    note: str | None = None


class PaymentCreate(PaymentBase):
    pass


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
class StudentSummary(BaseModel):
    student_id: int
    student_name: str
    lessons_total: int
    lessons_completed: int
    amount_due: float       # suma za odbyte zajęcia
    amount_paid: float      # suma wpłat
    balance: float          # paid - due (ujemne = zalega)


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


# konto ucznia zakładane przez korepetytora
class StudentAccountCreate(BaseModel):
    username: str
    password: str


class StudentAccountOut(BaseModel):
    student_id: int
    username: str
    # hasło zwracane tylko raz, przy utworzeniu, by korepetytor mógł je przekazać
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


# ---------- Zarządzanie użytkownikami (admin / sekretariat) ----------
class StaffUserCreate(BaseModel):
    username: str
    password: str
    display_name: str | None = None
    role: str  # 'tutor' lub 'secretary' (secretary tylko dla admina)
    color: str | None = None


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    username: str
    role: str
    display_name: str | None = None
    color: str | None = None


class UserUpdate(BaseModel):
    display_name: str | None = None
    color: str | None = None


class UserCreatedOut(BaseModel):
    id: int
    username: str
    role: str
    display_name: str | None = None
    password: str | None = None  # zwracane raz, przy utworzeniu


# lekka pozycja na listę korepetytorów do przypisania
class TutorOption(BaseModel):
    id: int
    display_name: str
    color: str | None = None


# decyzja administracji o prośbie (z opcjonalnym feedbackiem)
class RescheduleDecision(BaseModel):
    response: str | None = None


# korepetytor może zmienić tylko termin i oznaczyć odbycie
class TutorLessonUpdate(BaseModel):
    date: date_t | None = None
    start_time: time_t | None = None
    completed: bool | None = None
    note: str | None = None


# dyspozycyjność
class AvailabilityCreate(BaseModel):
    weekday: int  # 0=pon ... 6=niedz
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
    has_tutor: bool                 # czy zajęcia mają przypisanego korepetytora z dyspozycyjnością
    tutor_name: str | None = None
    days: list[FreeDay] = []

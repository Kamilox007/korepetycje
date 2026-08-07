import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import models
from .database import get_db

# W produkcji ustaw APP_ENV=prod oraz JWT_SECRET na losowy, długi ciąg.
APP_ENV = os.environ.get("APP_ENV", "dev").lower()
_secret = os.environ.get("JWT_SECRET")
if not _secret:
    if APP_ENV != "dev":
        raise RuntimeError(
            "Brak zmiennej środowiskowej JWT_SECRET. Wygeneruj ją poleceniem:\n"
            "  python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    _secret = "dev-secret-zmien-mnie-w-produkcji"
SECRET_KEY = _secret

ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 dni
# konto na haśle startowym dostaje token krótkoterminowy — wystarczy na ustawienie hasła
PASSWORD_RESET_EXPIRE_MINUTES = 30

# blokada konta po serii nieudanych prób
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

# Hash porównywany, gdy login nie istnieje — wyrównuje czas odpowiedzi.
# Bez tego brak użytkownika zwraca odpowiedź natychmiast, a istniejący dopiero
# po ~100 ms bcrypta, co pozwala wyliczyć listę loginów.
_DUMMY_HASH = bcrypt.hashpw(b"x", bcrypt.gensalt()).decode("utf-8")


def utcnow() -> datetime:
    """Naiwny UTC — spójny z pozostałymi kolumnami DateTime w modelu."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

# auto_error=False: brak nagłówka nie jest błędem, bo token może przyjść
# w ciasteczku. Rozstrzyga get_current_user.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

# Nazwa ciasteczka sesyjnego. httponly, więc JavaScript go nie odczyta —
# to jest cała różnica względem trzymania tokenu w localStorage.
COOKIE_NAME = "korepetycje_session"


def set_session_cookie(response: Response, user: models.User) -> None:
    """Wystawia token w ciasteczku niedostępnym dla JS."""
    minutes = (
        PASSWORD_RESET_EXPIRE_MINUTES
        if user.must_change_password
        else TOKEN_EXPIRE_MINUTES
    )
    response.set_cookie(
        key=COOKIE_NAME,
        value=create_access_token(user),
        max_age=minutes * 60,
        httponly=True,
        # Bez HTTPS przeglądarka odrzuciłaby ciasteczko Secure — w dev po HTTP.
        secure=APP_ENV != "dev",
        # Lax blokuje wysyłanie ciasteczka przy żądaniach POST/PATCH/DELETE
        # inicjowanych z obcych witryn, co samo w sobie zamyka CSRF dla
        # wszystkich operacji zmieniających stan. GET-y są tylko do odczytu.
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/", httponly=True,
                           secure=APP_ENV != "dev", samesite="lax")


def hash_password(password: str) -> str:
    # bcrypt obsługuje maks. 72 bajty hasła
    pw = password.encode("utf-8")[:72]
    return bcrypt.hashpw(pw, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    pw = plain.encode("utf-8")[:72]
    try:
        return bcrypt.checkpw(pw, hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def create_access_token(user: models.User) -> str:
    minutes = (
        PASSWORD_RESET_EXPIRE_MINUTES
        if user.must_change_password
        else TOKEN_EXPIRE_MINUTES
    )
    expire = datetime.now(timezone.utc) + timedelta(minutes=minutes)
    payload = {
        "sub": str(user.id),
        "role": user.role,
        "username": user.username,
        "exp": expire,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(
    request: Request,
    header_token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    """Token z ciasteczka, a jeśli go nie ma — z nagłówka Authorization.

    Kolejność ma znaczenie: przeglądarka korzysta z ciasteczka, a /docs, curl
    i zadania crona z nagłówka. Jedna funkcja obsługuje oba przypadki.
    """
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Nieprawidłowy lub wygasły token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    token = request.cookies.get(COOKIE_NAME) or header_token
    if not token:
        raise cred_exc
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if user_id is None:
            raise cred_exc
    except JWTError:
        raise cred_exc

    user = db.get(models.User, int(user_id))
    if user is None:
        raise cred_exc
    return user


def authenticate(db: Session, username: str, password: str) -> models.User:
    """Weryfikuje dane logowania, licząc nieudane próby i blokując konto.

    Rzuca HTTPException 401 (złe dane) albo 429 (konto zablokowane).
    Komunikat 401 jest identyczny dla nieistniejącego loginu i złego hasła.
    """
    user = db.query(models.User).filter(models.User.username == username).first()
    bad = HTTPException(status_code=401, detail="Błędny login lub hasło")

    if user is None:
        # policz bcrypta mimo wszystko, żeby czas odpowiedzi nie zdradzał istnienia konta
        bcrypt.checkpw(password.encode("utf-8")[:72], _DUMMY_HASH.encode("utf-8"))
        raise bad

    now = utcnow()
    if user.locked_until and user.locked_until > now:
        left = int((user.locked_until - now).total_seconds())
        raise HTTPException(
            status_code=429,
            detail=f"Konto tymczasowo zablokowane. Spróbuj ponownie za {left // 60 + 1} min.",
            headers={"Retry-After": str(left)},
        )

    if not verify_password(password, user.password_hash):
        user.failed_logins = (user.failed_logins or 0) + 1
        if user.failed_logins >= MAX_FAILED_LOGINS:
            user.locked_until = now + timedelta(minutes=LOCKOUT_MINUTES)
            user.failed_logins = 0
        db.commit()
        raise bad

    if user.failed_logins or user.locked_until:
        user.failed_logins = 0
        user.locked_until = None
        db.commit()
    return user


def require_active_user(user: models.User = Depends(get_current_user)) -> models.User:
    """Konto z hasłem startowym nie ma dostępu do niczego poza zmianą hasła.

    Sprawdzenie opiera się na stanie konta w bazie, nie na claimie w tokenie —
    dzięki temu flaga ustawiona już PO zalogowaniu też odcina dostęp.
    """
    if user.must_change_password:
        raise HTTPException(
            status_code=403,
            detail="Ustaw własne hasło, aby korzystać z aplikacji",
            headers={"X-Password-Change-Required": "1"},
        )
    return user


def require_tutor(user: models.User = Depends(require_active_user)) -> models.User:
    if user.role != "tutor":
        raise HTTPException(status_code=403, detail="Wymagane konto korepetytora")
    return user


def require_student(user: models.User = Depends(require_active_user)) -> models.User:
    if user.role != "student":
        raise HTTPException(status_code=403, detail="Wymagane konto ucznia")
    return user


# admin lub sekretariat — pełne zarządzanie danymi (uczniowie, zajęcia, płatności)
def require_staff(user: models.User = Depends(require_active_user)) -> models.User:
    if user.role not in ("admin", "secretary"):
        raise HTTPException(status_code=403, detail="Wymagane konto administracji")
    return user


# tylko admin — zarządzanie kontami admin/sekretariat
def require_admin(user: models.User = Depends(require_active_user)) -> models.User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Wymagane konto administratora")
    return user

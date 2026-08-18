import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import models
from .database import get_db

# In production set APP_ENV=prod and JWT_SECRET to a long random string.
APP_ENV = os.environ.get("APP_ENV", "dev").lower()
_secret = os.environ.get("JWT_SECRET")
if not _secret:
    if APP_ENV != "dev":
        raise RuntimeError(
            "JWT_SECRET environment variable is missing. Generate one with:\n"
            "  python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    _secret = "dev-secret-change-me-in-production"
SECRET_KEY = _secret

ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
# An account on its starting password gets a short-lived token: enough to set a password.
PASSWORD_RESET_EXPIRE_MINUTES = 30

# Account lockout after a run of failed attempts.
MAX_FAILED_LOGINS = 5
LOCKOUT_MINUTES = 15

# Hash compared when the login does not exist, to even out response time.
# Without it a missing user answers instantly while an existing one answers
# after ~100 ms of bcrypt, which lets an attacker enumerate valid logins.
_DUMMY_HASH = bcrypt.hashpw(b"x", bcrypt.gensalt()).decode("utf-8")


def utcnow() -> datetime:
    """Naive UTC, consistent with the other DateTime columns in the model."""
    return datetime.now(timezone.utc).replace(tzinfo=None)

# auto_error=False: a missing header is not an error, because the token may
# arrive in a cookie instead. get_current_user decides.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)

# Session cookie name. httponly, so JavaScript cannot read it: that is the
# entire difference from keeping the token in localStorage.
COOKIE_NAME = "korepetycje_session"


def set_session_cookie(response: Response, user: models.User) -> None:
    """Issue the token in a cookie that JavaScript cannot reach."""
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
        # Without HTTPS the browser would reject a Secure cookie; dev runs on HTTP.
        secure=APP_ENV != "dev",
        # Lax stops the cookie from being sent on POST/PATCH/DELETE requests
        # initiated by foreign sites, which closes CSRF for every state-changing
        # operation on its own. GET endpoints are read-only.
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=COOKIE_NAME, path="/", httponly=True,
                           secure=APP_ENV != "dev", samesite="lax")


def hash_password(password: str) -> str:
    # bcrypt handles at most 72 bytes of password
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
    """Token from the cookie, falling back to the Authorization header.

    The order matters: browsers use the cookie, while /docs, curl and cron jobs
    use the header. One function covers both cases.
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
    """Verify credentials, counting failed attempts and locking the account.

    Raises HTTPException 401 (bad credentials) or 429 (account locked).
    The 401 message is identical for an unknown login and a wrong password.
    """
    user = db.query(models.User).filter(models.User.username == username).first()
    bad = HTTPException(status_code=401, detail="Błędny login lub hasło")

    if user is None:
        # run bcrypt anyway so response time does not reveal whether the account exists
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
    """An account on its starting password may do nothing but change that password.

    The check reads account state from the database rather than a claim in the
    token, so a flag set AFTER login also cuts access off.
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


# admin or secretary: full management of data (students, lessons, payments)
def require_staff(user: models.User = Depends(require_active_user)) -> models.User:
    if user.role not in ("admin", "secretary"):
        raise HTTPException(status_code=403, detail="Wymagane konto administracji")
    return user


# admin only: managing admin/secretary accounts
def require_admin(user: models.User = Depends(require_active_user)) -> models.User:
    if user.role != "admin":
        raise HTTPException(status_code=403, detail="Wymagane konto administratora")
    return user

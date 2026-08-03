import os
from datetime import datetime, timedelta, timezone

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from sqlalchemy.orm import Session

from . import models
from .database import get_db

# W produkcji ustaw zmienną środowiskową JWT_SECRET na losowy, długi ciąg.
SECRET_KEY = os.environ.get("JWT_SECRET", "dev-secret-zmien-mnie-w-produkcji")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 dni
# konto na haśle startowym dostaje token krótkoterminowy — wystarczy na ustawienie hasła
PASSWORD_RESET_EXPIRE_MINUTES = 30

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login")


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
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> models.User:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Nieprawidłowy lub wygasły token",
        headers={"WWW-Authenticate": "Bearer"},
    )
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

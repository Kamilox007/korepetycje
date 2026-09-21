"""Shared test bootstrap: a fresh directory plus a database migrated to head,
and the account helpers most scripts start with (admin past the forced
password change, extra accounts created through the API)."""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent


def bootstrap(**env):
    """Switch to a temporary directory and run `alembic upgrade head`."""
    os.environ.setdefault("JWT_SECRET", "test-secret")
    os.environ.update(env)
    os.chdir(tempfile.mkdtemp())
    sys.path.insert(0, str(BACKEND_DIR))

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")


# Every account created through the API starts on this password; the helpers
# below immediately replace it, because until then the backend answers 403.
START_PASSWORD = "StartPass123!"
ADMIN_PASSWORD = "AdminPass123!"


def first_login(client, username: str, start_password: str, new_password: str):
    """Log in with a starting password and clear the forced change.
    Returns the client, now holding a full-length session cookie."""
    r = client.post("/api/auth/login", data={"username": username, "password": start_password})
    assert r.status_code == 200, r.text
    r = client.post("/api/auth/change-password", json={
        "old_password": start_password, "new_password": new_password, "accept_privacy": True,
    })
    assert r.status_code == 200, r.text
    return client


def login_admin(client, new_password: str = ADMIN_PASSWORD):
    """The seeded admin/admin account, past its forced password change."""
    return first_login(client, "admin", "admin", new_password)


def client_for(username: str, password: str, start_password: str = START_PASSWORD):
    """A separate client logged in as an existing account, past the forced
    password change. The client is entered but never exited: these scripts
    run to the end and let the process die."""
    from fastapi.testclient import TestClient
    from app.main import app

    c = TestClient(app)
    c.__enter__()
    return first_login(c, username, start_password, password)


def make_user(admin, username: str, role: str, password: str, display_name: str | None = None):
    """Create an account via the API and hand back a client logged in as it."""
    r = admin.post("/api/users", json={
        "username": username, "password": START_PASSWORD, "role": role,
        "display_name": username.title() if display_name is None else display_name,
    })
    assert r.status_code == 200, r.text
    return client_for(username, password)

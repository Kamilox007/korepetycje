"""Wspólny start dla testów: świeży katalog + baza doprowadzona do head."""
import os
import sys
import tempfile
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parent


def bootstrap(**env):
    """Przełącza się na tymczasowy katalog i wykonuje `alembic upgrade head`."""
    os.environ.setdefault("JWT_SECRET", "test-secret")
    os.environ.update(env)
    os.chdir(tempfile.mkdtemp())
    sys.path.insert(0, str(BACKEND_DIR))

    from alembic import command
    from alembic.config import Config

    cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    command.upgrade(cfg, "head")

"""Regresja dla punktu 3: Alembic zastępuje ręczne _migrate_schema()."""
import os, sys, tempfile, pathlib, subprocess

BACKEND = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(BACKEND))

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


def alembic(cwd, *args):
    env = {**os.environ, "JWT_SECRET": "test-secret"}
    return subprocess.run(
        [sys.executable, "-m", "alembic", "-c", str(BACKEND / "alembic.ini"), *args],
        cwd=cwd, env=env, capture_output=True, text=True,
    )


workdir = tempfile.mkdtemp()

# --- upgrade od zera ---
r = alembic(workdir, "upgrade", "head")
check("upgrade head na pustej bazie", r.returncode == 0)

import sqlite3
db = pathlib.Path(workdir) / "korepetycje.db"
con = sqlite3.connect(db)
tables = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table'")}
expected = {"users", "students", "lessons", "lesson_series", "payments",
            "reschedule_requests", "series_skips", "availability", "subjects"}
check(f"utworzono wszystkie tabele ({len(expected & tables)}/{len(expected)})",
      expected <= tables)

idx = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")}
for want in ("ix_lessons_date", "ix_lessons_student_id", "ix_payments_student_id"):
    check(f"indeks {want} istnieje", want in idx)

cols = {r[1] for r in con.execute("PRAGMA table_info(users)")}
check("kolumny z patcha 02 obecne", {"failed_logins", "locked_until"} <= cols)
con.close()

# --- downgrade / upgrade w obie strony ---
r = alembic(workdir, "downgrade", "0001")
check("downgrade do 0001", r.returncode == 0)
con = sqlite3.connect(db)
idx = {r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='index'")}
check("downgrade zdjął indeksy z 0002", "ix_lessons_date" not in idx)
con.close()

r = alembic(workdir, "upgrade", "head")
check("ponowny upgrade head", r.returncode == 0)

r = alembic(workdir, "current")
check("baza raportuje rewizję 0002", "0002" in r.stdout)

# --- aplikacja nie startuje na nieaktualnej bazie ---
alembic(workdir, "downgrade", "0001")
os.chdir(workdir)
os.environ["JWT_SECRET"] = "test-secret"
from fastapi.testclient import TestClient
from app.main import app

try:
    with TestClient(app):
        check("start na bazie za starą migracją jest blokowany", False)
except RuntimeError as e:
    check("start na bazie za starą migracją jest blokowany",
          "alembic upgrade head" in str(e))

# --- po nadgonieniu migracji startuje normalnie ---
alembic(workdir, "upgrade", "head")
with TestClient(app) as c:
    r = c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    check("po upgrade aplikacja działa (seed admina)", r.status_code == 200)

print()
print("NIEPOWODZENIA:", FAILS if FAILS else "brak")
sys.exit(1 if FAILS else 0)

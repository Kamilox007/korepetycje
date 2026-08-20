# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A tutoring-scheduling and billing web app ("Korepetycje"). FastAPI + SQLAlchemy 2.0 backend
with a SQLite database, React 18 (Vite) frontend, deployed via Docker Compose behind Caddy.
Comments, docstrings, error messages, and UI labels are in Polish; explanatory prose in the
README and in this file is in English.

The README (`README.md`) is authoritative and detailed — read it for the full role matrix,
env vars, deployment steps, and a "Decyzje projektowe" (design decisions) section explaining
*why* things are built the way they are. Don't re-derive those decisions from scratch; check
there first.

## Commands

### Backend (`backend/`)

```bash
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head             # required before first start — app refuses to boot on a stale schema
uvicorn app.main:app --reload --port 8000
```

Migrations:

```bash
alembic upgrade head
alembic revision --autogenerate -m "opis"   # ALWAYS review the generated revision — autogenerate
                                             # sees renames as drop+add (data loss) and is trigger-happy on types
alembic check                               # do models match the current DB?
```

Regression tests (plain scripts, not pytest — each bootstraps its own temp SQLite DB via
`testing_utils.bootstrap()`, migrated to head, isolated from the dev DB):

```bash
pip install -r requirements-dev.txt
python test_forced_password.py    # single test file
for t in test_*.py; do echo "== $t"; python "$t" || exit 1; done   # everything, same as CI
```

### Frontend (`frontend/`)

```bash
npm install
npm run dev          # http://localhost:5173, Vite proxies /api to :8000
npm run build
```

End-to-end (Playwright — spins up its own backend+frontend against a throwaway `e2e.db`,
wiped every run; never points at the dev or prod database):

```bash
npx playwright install chromium   # once
npm run e2e            # full run: desktop + mobile emulation
npm run e2e:ui          # interactive, step-through
npm run e2e:report      # report from the last run (video/screenshots/trace on failure)
```

CI (`.github/workflows/`) runs the backend test scripts in a loop and does `npm run build` for
the frontend — no separate lint step exists.

## Architecture

### Roles and access

Four roles: `admin`, `secretary`, `tutor`, `student`. Admin and secretary ("staff") share almost
all endpoints and the same UI shell (`StaffShell` in `frontend/src/App.jsx`); secretary is
filtered out of admin-account management server-side, not client-side. Tutor and student each
get their own routes, tabs, and panel components. FastAPI dependencies
`require_staff` / `require_tutor` / `require_student` / `require_admin` in `backend/app/auth.py`
gate endpoints — check these before assuming an endpoint is reachable by a given role.

Full role capability matrix is in the README (`## Role` section) — don't duplicate it here,
just be aware it exists.

### Multi-tenant by tutor

The schema was split by tutor (migration `0007_split_by_tutor`): `Student`, `LessonSeries`,
`Lesson`, and `Payment` all carry a `tutor_id` (the owning/creating account) and most also carry
an `assigned_tutor_id` (whose balance/schedule it actually belongs to — these differ because
staff can record things on a tutor's behalf). `User.bank_account` is per-tutor too, since each
tutor's students pay into a different account. When touching balance, calendar, or payment
logic, check which of the two tutor columns is the relevant filter — using the wrong one either
leaks data across tutors or attributes it to the wrong one.

### Money

Amounts are stored as **integer grosze** (minor units), never float — see `backend/app/money.py`
docstring for why (float drift on repeated summation) and the README's "Decyzje projektowe" for
the rounding mode (`ROUND_HALF_UP`, not Python's banker's rounding). Models expose zloty-float
properties (`price`, `amount`, `default_price`) purely for API (de)serialization; all arithmetic
must go through the `_grosze` integer columns. `Lesson.price_grosze` is copied from the series at
creation time and frozen — raising a series price never rewrites historical lessons.

### Recurring lessons are materialized, not computed on read

`LessonSeries` defines a recurrence rule; `Lesson` rows are concrete, individually-editable
occurrences generated ahead of time by `services.generate_lessons_for_series` /
`services.regenerate_all` (run at app startup and daily via `_generate_upcoming` — see README's
"Zadanie okresowe" for the cron/endpoint). `SeriesSkip` marks an original slot date that was
deleted and must not be regenerated. A `(series_id, origin_date)` unique constraint is enforced
at the DB level, not deduplicated in Python, because concurrent requests would race. GET
endpoints never generate lessons as a side effect — see the CSRF note below for why that matters.
`origin_date` is preserved across a reschedule so the series slot can still be identified.

Editing a series propagates selectively: metadata (subject/level/tutor) hits all future
occurrences including manually-rescheduled ones; a time/date change skips manually-rescheduled
occurrences (so it doesn't clobber a deliberate move); price changes only future, unbilled
lessons.

### Auth

JWT (HS256) delivered in an httpOnly cookie — not accessible to JS, so XSS alone can't steal it.
No CSRF token: protection instead relies on `SameSite=Lax` plus the invariant that **every
state-changing operation uses POST/PATCH/DELETE, never GET**. Don't add a GET endpoint with side
effects. A `sessions` table (`backend/app/models.py`) makes JWTs revocable — every request checks
its `jti` against an open, non-revoked session row, so a password change actually ends other
sessions instead of waiting for token expiry. `Authorization: Bearer` header auth still works
alongside the cookie, for `/docs`, `curl`, and the cron job. Login is rate-limited (slowapi, per
IP) and additionally locks the account row after repeated failures.

A fresh install seeds an `admin`/`admin` account with `must_change_password=True`. That flag is
enforced **server-side**: while set, every endpoint except `/api/auth/me` and
`/api/auth/change-password` returns 403 and issued tokens are short-lived (30 min instead of 7
days) — the frontend's forced-password-change screen is a courtesy, not the actual gate.

### Frontend structure

Single-page app, `frontend/src/App.jsx` is the router root: it holds session state (`api.me()`
on load, since an httpOnly cookie can't be read from JS to check client-side), picks a shell by
role (`StaffShell` vs the shared `RoleShell` for tutor/student), and mounts `react-router-dom`
routes per role with Polish paths (`/kalendarz`, `/uczniowie`, …) matching their sidebar labels.
`frontend/src/api.js` is the sole fetch layer — every backend call goes through it; it centralizes
401 handling via `setUnauthorizedHandler`.

Delete/archive actions use a custom confirmation dialog (`Confirm.jsx`), never the native
`confirm()` — see README for why (users can suppress native dialogs, silently turning deletes
into no-ops). The confirmation for deleting a student (the only action that erases financial
history) requires retyping their name.

Custom `Modal.jsx` closes only on a genuine background click (mousedown+mouseup both landing on
the backdrop) — a plain `click` listener would fire when a user selects text inside the modal and
releases the mouse outside it, silently discarding the form.

### Data model

See the README's "Model danych" table for the full list of tables. `backend/app/models.py` is
the single source of truth for the schema; `backend/app/schemas.py` holds the Pydantic
request/response shapes.

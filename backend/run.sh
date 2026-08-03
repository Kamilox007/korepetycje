#!/usr/bin/env bash
set -e
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
alembic upgrade head          # schemat bazy do najnowszej wersji
uvicorn app.main:app --reload --port 8000

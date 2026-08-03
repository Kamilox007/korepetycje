import os

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from .models import Base

# SQLite na dev, Postgres na produkcji:
#   DATABASE_URL="postgresql+psycopg://user:haslo@db:5432/korepetycje"
SQLALCHEMY_DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./korepetycje.db")

_connect_args = (
    {"check_same_thread": False}
    if SQLALCHEMY_DATABASE_URL.startswith("sqlite")
    else {}
)
engine = create_engine(SQLALCHEMY_DATABASE_URL, connect_args=_connect_args)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

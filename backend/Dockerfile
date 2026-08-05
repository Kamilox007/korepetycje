FROM python:3.12-slim

# Bez tego logi uvicorna buforują się i `docker compose logs` milczy przy awarii
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /app

# Warstwa zależności osobno — zmiana kodu nie unieważnia cache pipa
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Baza leży na wolumenie, nie w obrazie — inaczej znika przy każdym deployu
ENV DATABASE_URL=sqlite:////data/korepetycje.db

# Nie uruchamiamy jako root
RUN useradd --create-home --uid 10001 app && mkdir -p /data && chown app:app /data
USER app

EXPOSE 8000

# Migracje PRZED startem: _require_migrated_db() i tak nie pozwoli wstać
# na nieaktualnym schemacie, więc lepiej niech to padnie tutaj, z czytelnym błędem.
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]

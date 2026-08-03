# Korepetycje — aplikacja do zarządzania zajęciami, płatnościami i kontami

Webowa aplikacja (osobny **backend** i **frontend**) do prowadzenia korepetycji.
Dwie role: **korepetytor** (pełne zarządzanie) i **uczeń** (panel z własnym terminarzem i saldem).

## Stack

- **Backend:** FastAPI + SQLAlchemy + SQLite, logowanie JWT (`backend/`)
- **Frontend:** React + Vite (`frontend/`)
- **Baza:** plik SQLite `backend/korepetycje.db` (tworzy się sam przy starcie)

## Role i funkcje

### Korepetytor
- Kalendarz (widok dzienny / tygodniowy / miesięczny)
- Uczniowie, zajęcia cykliczne, ceny, oznaczanie odbycia
- Płatności i podsumowanie z saldem per uczeń
- Zakładanie kont logowania uczniom (login + hasło startowe)
- Zakładka „Prośby" — akceptacja/odrzucanie próśb uczniów o przesunięcie zajęć

### Uczeń
- Logowanie własnym kontem (otrzymanym od korepetytora)
- Terminarz swoich zajęć + saldo i płatności (tylko do odczytu)
- Wysyłanie próśb o przesunięcie konkretnych zajęć (termin zmienia się dopiero po akceptacji korepetytora)

## Pierwsze logowanie

Przy pierwszym starcie backend tworzy konto korepetytora:

- **login:** `admin`
- **hasło:** `admin`

Aplikacja od razu poprosi o ustawienie własnego hasła. Wszystkie dotychczasowe dane
(z wcześniejszej wersji bez kont) zostają przypisane do tego konta.

## Uruchomienie

### Backend (terminal 1)

Linux / macOS:
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Windows:
```bat
cd backend
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API: http://localhost:8000 — dokumentacja: http://localhost:8000/docs

### Frontend (terminal 2)

```bash
cd frontend
npm install
npm run dev
```

Aplikacja: http://localhost:5173 (Vite proxuje `/api` do backendu na :8000).

## Bezpieczeństwo

- Hasła hashowane (bcrypt), logowanie tokenem JWT (7 dni ważności).
- Każdy endpoint sprawdza rolę i właściciela danych — korepetytor widzi tylko swoich
  uczniów, uczeń tylko własne dane.
- **W produkcji** ustaw zmienną środowiskową `JWT_SECRET` na długi, losowy ciąg:
  ```bash
  export JWT_SECRET="...długi losowy ciąg..."
  ```
  Bez tego używany jest domyślny sekret deweloperski (niebezpieczny w produkcji).

## Jak założyć konto uczniowi

1. Zakładka **Uczniowie** → przy uczniu kliknij **Załóż konto**
2. Podaj login i hasło startowe (hasło można wygenerować przyciskiem ↻)
3. Przekaż uczniowi dane — przy pierwszym logowaniu ustawi własne hasło

## Model danych

- `users` — konta logowania (rola: tutor / student)
- `students` — uczniowie (każdy należy do korepetytora przez `tutor_id`, opcjonalnie powiązany z kontem przez `user_id`)
- `lesson_series` — definicje zajęć cyklicznych
- `lessons` — pojedyncze wystąpienia zajęć
- `payments` — wpłaty
- `reschedule_requests` — prośby uczniów o przesunięcie zajęć

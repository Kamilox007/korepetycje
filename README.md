# Korepetycje — panel zarządzania zajęciami i rozliczeniami

Aplikacja webowa do prowadzenia korepetycji: terminarz, zajęcia cykliczne,
rozliczenia i konta uczniów. Backend w FastAPI, frontend w React, wdrożenie
przez Docker Compose.

Wersja produkcyjna: <https://panel.kamilkrzywon.pl>

## Stack

| Warstwa | Technologia |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Pydantic v2 |
| Migracje | Alembic (tryb `batch` — wymagany przez SQLite) |
| Baza | SQLite (`DATABASE_URL` pozwala przejść na PostgreSQL) |
| Uwierzytelnianie | JWT (HS256), hasła haszowane bcryptem |
| Ochrona logowania | slowapi (limit per IP) + blokada konta w bazie |
| Frontend | React 18, Vite 6, CSS bez frameworka |
| Wdrożenie | Docker Compose: `api` + `web` (Caddy) + `litestream` |
| TLS | Let's Encrypt przez Caddy, odnawiany automatycznie |
| Backup | Litestream → Backblaze B2, replikacja ciągła |

## Role

| Rola | Zakres |
|---|---|
| `admin` | pełne zarządzanie, w tym konta użytkowników |
| `secretary` | wszystko poza zarządzaniem kontami administracyjnymi |
| `tutor` | własny terminarz i zajęcia przypisane do siebie |
| `student` | własne zajęcia, saldo, historia wpłat, prośby o przesunięcie |

### Korepetytor i sekretariat
- Kalendarz: widok dzienny, tygodniowy i miesięczny
- Uczniowie, przedmioty, stawki, zajęcia cykliczne
- Oznaczanie odbycia i odwołania zajęć
- Wpłaty i podsumowanie salda per uczeń
- Zakładanie kont uczniom (login + hasło startowe)
- Akceptacja próśb o przesunięcie zajęć

### Uczeń
- Terminarz własnych zajęć i saldo (tylko do odczytu)
- Prośby o przesunięcie — termin zmienia się dopiero po akceptacji
- Podpowiadane wolne terminy na podstawie dostępności korepetytora

## Uruchomienie lokalne

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head             # schemat bazy — konieczne przed startem
uvicorn app.main:app --reload --port 8000
```

API: <http://localhost:8000> · dokumentacja: <http://localhost:8000/docs>

### Frontend

```bash
cd frontend
npm install
npm run dev                      # http://localhost:5173
```

Vite przekierowuje `/api` na backend pod `:8000`.

## Pierwsze logowanie

Przy pierwszym starcie tworzone jest konto `admin` / `admin` z wymuszoną
zmianą hasła.

Wymuszenie działa **po stronie backendu**: dopóki flaga `must_change_password`
jest ustawiona, każdy endpoint poza `/api/auth/me`
i `/api/auth/change-password` zwraca 403, a wydany token żyje 30 minut zamiast
7 dni. Pominięcie interfejsu nic nie daje. Nowe hasło musi mieć co najmniej
10 znaków i różnić się od dotychczasowego.

## Migracje

Schemat bazy jest wersjonowany Alembikiem. Aplikacja **nie wystartuje**, jeśli
baza nie jest na najnowszej rewizji — zamiast tego zgłosi błąd z instrukcją.

```bash
alembic upgrade head                          # aktualizacja
alembic revision --autogenerate -m "opis"     # nowa rewizja po zmianie modeli
alembic check                                 # czy modele zgadzają się z bazą
```

Wygenerowaną rewizję **zawsze przejrzyj przed uruchomieniem**. Autogenerate nie
wykrywa zmian nazw (widzi je jako drop + add, czyli utratę danych) i bywa zbyt
gorliwy przy typach.

Istniejąca baza sprzed wprowadzenia Alembica: uruchom raz
`python bootstrap_alembic.py` — skrypt uzupełnia braki, oznacza bazę jako `0001`
i dociąga resztę, po drodze robiąc kopię.

### Historia rewizji

| Rewizja | Zawartość |
|---|---|
| `0001` | schemat początkowy |
| `0002` | indeksy na kolumnach faktycznie filtrowanych |
| `0003` | unikalność slotu serii (`series_id`, `origin_date`) |
| `0004` | kwoty jako liczby całkowite w groszach |

## Konfiguracja

Zmienne środowiskowe (`.env`, wzór w `.env.example`):

| Zmienna | Znaczenie |
|---|---|
| `APP_ENV` | `dev` lub `prod`. Poza `dev` brak `JWT_SECRET` zatrzymuje start |
| `JWT_SECRET` | sekret podpisujący tokeny — długi, losowy |
| `DOMAIN` | domena, na którą Caddy pobiera certyfikat |
| `CORS_ORIGINS` | dozwolone originy, rozdzielone przecinkiem. `*` jest odrzucane |
| `DATABASE_URL` | domyślnie SQLite; Postgres przez `postgresql+psycopg://…` |
| `B2_KEY_ID`, `B2_APP_KEY` | poświadczenia Backblaze B2 dla Litestream |

Generowanie sekretu:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

## Wdrożenie

```bash
cp .env.example .env && nano .env
docker compose up -d --build
```

| Co zmieniłeś | Co uruchomić |
|---|---|
| `frontend/src/*` | `docker compose up -d --build web` |
| `backend/app/*`, migracje | `docker compose up -d --build api` |
| `deploy/Caddyfile` | `docker compose restart web` (montowany, bez builda) |
| `.env` | `docker compose up -d` |

Rekord A domeny musi wskazywać na serwer **przed** pierwszym uruchomieniem —
Caddy od razu występuje o certyfikat, a Let's Encrypt limituje nieudane
walidacje.

### Zadanie okresowe

Wystąpienia serii są materializowane przy starcie i przy tworzeniu serii.
Przy długo działającym procesie potrzebny jest impuls dobowy:

```cron
0 3 * * * cd /sciezka/korepetycje && docker compose exec -T api \
  python -c "from app.main import _generate_upcoming; print(_generate_upcoming())"
```

Alternatywnie `POST /api/maintenance/generate-lessons` (rola staff, idempotentne).

## Testy

```bash
cd backend
python test_forced_password.py    # wymuszona zmiana hasła
python test_login_hardening.py    # blokada konta, limity, CORS, JWT_SECRET
python test_migrations.py         # cykl migracji, blokada startu na starym schemacie
python test_series_generator.py   # unikalność slotu, klamra horyzontu, GET bez zapisu
python test_money.py              # arytmetyka w groszach, zamrożona stawka
```

Każdy zestaw pracuje na własnej bazie w katalogu tymczasowym i nie dotyka bazy
deweloperskiej. Wszystkie to regresje konkretnych błędów — jeśli któryś zacznie
padać po zmianie, prawdopodobnie ta zmiana cofnęła poprawkę.

## Decyzje projektowe

**Kwoty jako liczby całkowite w groszach.** `float` nie zapisuje dokładnie
`0.1`, więc sumowanie cen zajęć kumuluje błąd i saldo rozjeżdża się o grosz.
Konwersja odbywa się wyłącznie na granicy API — modele wystawiają właściwości
w złotych, arytmetyka idzie na `int`. Zaokrąglanie handlowe (`ROUND_HALF_UP`),
bo wbudowane `round()` używa bankierskiego i zwraca `2.67` dla `2.675`.

**Stawka zamrożona na zajęciach.** `Lesson.price_grosze` jest kopiowana
w momencie tworzenia. Podniesienie stawki nie zmienia historycznych rozliczeń.

**Saldo jest funkcją, nie kolumną.** `Σ(zajęcia płatne) − Σ(wpłaty)`, liczone
przy odczycie. Kolumna z saldem prędzej czy później rozjedzie się z danymi.

**Data i godzina osobno, bez strefy.** „Wtorek 17:00" zapisany dosłownie
przeżywa zmianę czasu. Przechowywanie w UTC wymagałoby przeliczania przy
każdym rozwinięciu serii.

**Serie materializowane, nie liczone w locie.** Konkretne wiersze z `origin_date`
plus `SeriesSkip` na wyjątki. Przesunięcie pojedynczego terminu to `UPDATE`,
a nie logika wyjątków przy każdym odczycie. Unikalność `(series_id, origin_date)`
jest wymuszona przez bazę, bo deduplikacja w Pythonie jest podatna na wyścig.

**Generowanie nie odbywa się w handlerach GET.** Odczyt nie ma efektów ubocznych,
a horyzont generowania jest zaklamrowany niezależnie od parametrów żądania.

## Model danych

| Tabela | Zawartość |
|---|---|
| `users` | konta logowania, rola, licznik nieudanych prób, blokada |
| `students` | uczniowie, stawka domyślna, powiązanie z kontem |
| `subjects` | przedmioty |
| `lesson_series` | definicje zajęć cyklicznych |
| `lessons` | pojedyncze wystąpienia, cena zamrożona, status |
| `series_skips` | pominięte wystąpienia serii |
| `payments` | wpłaty |
| `reschedule_requests` | prośby o przesunięcie |
| `availability` | dostępność korepetytora |

## Backup

Litestream replikuje bazę do Backblaze B2 na bieżąco (interwał 1 s), ze
snapshotem dobowym i retencją 30 dni.

Odtworzenie — **przetestuj, zanim będzie potrzebne**:

```bash
docker run --rm -v ./restore:/out \
  -v ./deploy/litestream.yml:/etc/litestream.yml:ro \
  -e LITESTREAM_ACCESS_KEY_ID=... -e LITESTREAM_SECRET_ACCESS_KEY=... \
  litestream/litestream:0.3 restore -o /out/test.db /data/korepetycje.db
```

Ostatni argument to ścieżka bazy, po której Litestream odnajduje wpis
w konfiguracji — nie adres repliki. Podanie obu naraz kończy się błędem.

## Znany dług techniczny

- Token w `localStorage` zamiast httpOnly cookie (podatność na XSS)
- Kolumny `tutor_id` na `students`/`lessons`/`payments` nie są używane do
  filtrowania — trzymają autora rekordu, nie właściciela
- `cascade="all, delete-orphan"` na `Student.payments` kasuje historię wpłat
  razem z uczniem; docelowo miękkie usuwanie
- `_summary_for_students` ładuje relacje do Pythona zamiast liczyć `GROUP BY`
- Frontend bez routera (nawigacja w stanie) i bez TypeScriptu; `Calendar.jsx`
  wymaga rozbicia
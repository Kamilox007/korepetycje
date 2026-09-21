# Korepetycje - panel zarządzania zajęciami i rozliczeniami

![testy](https://github.com/Kamilox007/korepetycje/actions/workflows/testy.yml/badge.svg)

Aplikacja webowa do prowadzenia korepetycji: terminarz, zajęcia cykliczne,
rozliczenia i konta uczniów. Backend w FastAPI, frontend w React, wdrożenie
przez Docker Compose.

Wersja produkcyjna: <https://panel.kamilkrzywon.pl>

## Stack

| Warstwa | Technologia |
|---|---|
| Backend | Python 3.12, FastAPI, SQLAlchemy 2.0, Pydantic v2 |
| Migracje | Alembic (tryb `batch` - wymagany przez SQLite) |
| Baza | SQLite |
| Uwierzytelnianie | JWT (HS256) w ciasteczku httpOnly, hasła haszowane bcryptem |
| Ochrona logowania | slowapi (limit per IP) + blokada konta w bazie |
| Frontend | React 18, React Router 7, Vite 6, CSS bez frameworka |
| Testy | skrypty regresji (backend) + Vitest (jednostkowe) + Playwright (end-to-end) |
| Wdrożenie | Docker Compose: `api` + `web` (Caddy) + `litestream` |
| TLS | Let's Encrypt przez Caddy, odnawiany automatycznie |
| Backup | Litestream → Backblaze B2, replikacja ciągła |

## Role

| Rola | Zakres |
|---|---|
| `admin` | pełne zarządzanie, w tym konta użytkowników |
| `secretary` | wszystko poza zarządzaniem kontami administracyjnymi |
| `tutor` | własny terminarz i zajęcia przypisane do siebie |
| `student` | własne zajęcia, saldo, historia wpłat, prośby o przesunięcie, swoje tablice i materiały |

### Korepetytor i sekretariat
- Kalendarz: widok dzienny, tygodniowy i miesięczny, z przenoszeniem zajęć
- Uczniowie, przedmioty, stawki, zajęcia cykliczne
- Edycja serii z kontrolowaną propagacją zmian na istniejące zajęcia
- Oznaczanie odbycia i odwołania zajęć
- Wpłaty z korektą kwoty, daty, wpłacającego i notatki
- Podsumowanie salda per uczeń
- Zakładanie kont uczniom i reset hasła kont personelu
- Archiwizacja uczniów z zachowaniem historii rozliczeń
- Akceptacja próśb o przesunięcie zajęć
- Tablica do zajęć online, współdzielona z uczniem przez link (niżej)
- Materiały dla ucznia: pliki PDF (zadania, rozwiązania) widoczne w jego panelu

Korepetytor widzi wyłącznie zajęcia przypisane do siebie: własny kalendarz
z tymi samymi trzema widokami, przenoszenie zajęć na inny dzień i godzinę oraz
rozpatrywanie próśb swoich uczniów.

### Uczeń
- Kalendarz własnych zajęć (dzień, tydzień, miesiąc) i saldo - tylko do odczytu
- Kod QR przelewu z kwotą do zapłaty i tytułem (standard 2D ZBP)
- Prośby o przesunięcie - termin zmienia się dopiero po akceptacji
- Podpowiadane wolne terminy na podstawie dostępności korepetytora
- Zakładka **Tablice i materiały**: linki do tablic przypisanych do ucznia
  i pliki PDF od korepetytora - tylko do odczytu

### Tablica

Moduł tablicy interaktywnej (Excalidraw) do prowadzenia korepetycji online.

- Korepetytor lub sekretariat zakłada tablicę w zakładce **Tablice**
  (np. „Kasia - matura rozszerzona"), opcjonalnie przypisując ją do ucznia -
  wtedy widać ją z poziomu listy uczniów. Sekretariat wybiera też, którego
  korepetytora to tablica; korepetytor zakładający ją sam jest przypisany
  automatycznie.
- Tablica dostaje **stały link** `https://<domena>/t/<token>`. Link wysyła się
  uczniowi raz; uczeń **nie loguje się i nie potrzebuje konta** - kto ma
  link, ten rysuje. Przy pierwszym wejściu podaje imię do etykiety przy
  kursorze (trzymane tylko w jego przeglądarce).
- Tablica ma **strony**: nowa lekcja to zwykle nowa strona. Uczeń może wrócić
  do notatek sprzed tygodni. Strony dodaje, nazywa i kasuje tylko właściciel.
- Rysowanie jest **na żywo**: obie osoby widzą kursory i kreski drugiej
  strony od razu. Przy braku łącza tablica zapisuje zmiany co 15 s przez
  HTTP i scala je po powrocie połączenia; wskaźnik na pasku mówi, w jakim
  jest stanie. Ctrl+Z cofa tylko własne zmiany.
- Wklejone obrazki (zdjęcie zadania) lądują na dysku serwera, nie w bazie.
  Limity: 10 MB na plik, 200 MB na tablicę.
- **Biblioteka** (przycisk po prawej): wbudowane bryły w rzucie ukośnym
  z przerywanymi krawędziami niewidocznymi (prostopadłościan, sześcian,
  graniastosłup, ostrosłupy, walec, stożek, kula) - te same dla każdego.
  Własne rysunki dodane przez „dodaj do biblioteki" zapisują się **na
  koncie** (ta sama biblioteka na każdym urządzeniu), u gościa - w jego
  przeglądarce.
- **Kratka** na pasku - ustawienie widoku tylko dla tego, kto ją włączył,
  pamiętane per tablica w przeglądarce.
- **Nowy link** w panelu unieważnia stary natychmiast (gdy wyciekł albo
  kurs się skończył); treść zostaje, połączone osoby są rozłączane.
- **Archiwizacja** wyłącza link i chowa tablicę z listy; przywrócenie włącza
  go z powrotem. Trwałe usunięcie - tylko admin, tylko z archiwum, z
  przepisaniem tytułu - kasuje strony, obrazki i snapshoty.
- **Historia**: przed pierwszym zapisem każdego dnia stan strony odkładany
  jest jako snapshot (30 dni). Po przypadkowym „zaznacz wszystko + Delete"
  właściciel przywraca stronę z panelu; przywrócenie widać od razu także
  u połączonych osób i samo jest odwracalne.

### Materiały ucznia

Staff (z listy uczniów, przycisk **Materiały**) i korepetytor (zakładka
**Materiały**, dla uczniów, z którymi ma zajęcia) dodają uczniowi pliki PDF -
zadania, rozwiązania, notatki. Uczeń z kontem widzi je w zakładce **Tablice
i materiały**, obok linków do swoich tablic, i otwiera w przeglądarce.
Tylko PDF, rozpoznawany po zawartości; limity 20 MB na plik i 300 MB na
ucznia. Bajty leżą w tym samym katalogu co obrazki tablic
(`BOARD_FILES_PATH`), więc obowiązuje ten sam TODO o backupie. Trwałe
usunięcie ucznia kasuje jego materiały.

## Uruchomienie lokalne

### Backend

```bash
cd backend
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
alembic upgrade head             # schemat bazy - konieczne przed startem
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
baza nie jest na najnowszej rewizji - zamiast tego zgłosi błąd z instrukcją.

```bash
alembic upgrade head                          # aktualizacja
alembic revision --autogenerate -m "opis"     # nowa rewizja po zmianie modeli
alembic check                                 # czy modele zgadzają się z bazą
```

Wygenerowaną rewizję **zawsze przejrzyj przed uruchomieniem**. Autogenerate nie
wykrywa zmian nazw (widzi je jako drop + add, czyli utratę danych) i bywa zbyt
gorliwy przy typach.

### Historia rewizji

| Rewizja | Zawartość |
|---|---|
| `0001` | schemat początkowy |
| `0002` | indeksy na kolumnach faktycznie filtrowanych |
| `0003` | unikalność slotu serii (`series_id`, `origin_date`) |
| `0004` | kwoty jako liczby całkowite w groszach |
| `0005` | rejestr sesji (unieważnianie tokenów) |
| `0006` | miękkie usuwanie uczniów (`archived_at`) |
| `0007` | podział rozliczeń między korepetytorów (`tutor_id`, `assigned_tutor_id`) |
| `0008` | znacznik akceptacji polityki prywatności |
| `0009` | numer BLIK korepetytora |
| `0010` | ustawienia limitu przychodu (działalność nierejestrowana) |
| `0011` | kolor pojedynczych zajęć w kalendarzu |
| `0012` | token publicznego kanału kalendarza (.ics) |
| `0013` | tablica: `boards`, `board_pages`, `board_files`, `board_snapshots` |
| `0014` | tablica: `assigned_tutor_id` - czyja jest tablica, niezależnie od tego, kto ją założył |
| `0015` | tablica: biblioteka kształtów na koncie (`users.board_library`) |
| `0016` | materiały ucznia (`student_files`, PDF) |

## Konfiguracja

Zmienne środowiskowe (`.env`, wzór w `.env.example`):

| Zmienna | Znaczenie |
|---|---|
| `APP_ENV` | `dev` lub `prod`. Poza `dev` brak `JWT_SECRET` zatrzymuje start |
| `JWT_SECRET` | sekret podpisujący tokeny - długi, losowy |
| `DOMAIN` | domena, na którą Caddy pobiera certyfikat |
| `CORS_ORIGINS` | dozwolone originy, rozdzielone przecinkiem. `*` jest odrzucane |
| `DATABASE_URL` | domyślnie SQLite; Postgres przez `postgresql+psycopg://…` |
| `B2_KEY_ID`, `B2_APP_KEY` | poświadczenia Backblaze B2 dla Litestream |
| `BANK_ACCOUNT`, `BANK_RECIPIENT` | opcjonalne: włączają kod QR przelewu w panelu ucznia |
| `BOARD_FILES_PATH` | katalog na obrazki wklejone do tablic; domyślnie `/data/board_files` (ten sam wolumen co baza) |
| `BOARD_MAX_FILE_MB` | limit rozmiaru jednego obrazka na tablicy; domyślnie `10` |
| `BOARD_MAX_TOTAL_MB` | limit łączny obrazków jednej tablicy; domyślnie `200` |
| `STUDENT_FILE_MAX_MB` | limit rozmiaru jednego pliku PDF w materiałach ucznia; domyślnie `20` |
| `STUDENT_FILES_MAX_TOTAL_MB` | limit łączny materiałów jednego ucznia; domyślnie `300` |

`APP_ENV` steruje też flagą `Secure` na ciasteczku sesyjnym - w `dev` jest
wyłączona, bo po HTTP przeglądarka odrzuciłaby takie ciasteczko.

Generowanie sekretu:

```bash
python -c "import secrets; print(secrets.token_urlsafe(64))"
```

## Wdrożenie

Sieć współdzielona z aplikacjami stojącymi za tym samym reverse proxy -
jednorazowo, przed pierwszym uruchomieniem:

```bash
docker network create edge
```

To jedyny element konfiguracji serwera, który nie wynika z żadnego pliku
w repozytorium. Przy odtwarzaniu maszyny od zera trzeba o nim pamiętać.

```bash
cp .env.example .env && nano .env
docker compose up -d --build
```

Caddy w tej usłudze terminuje TLS dla wszystkich domen na serwerze - także
dla strony `kamilkrzywon.pl`, która stoi w osobnym repozytorium
([kamilkrzywon-pl](https://github.com/Kamilox007/kamilkrzywon-pl)) i dołącza
do sieci `edge` pod nazwą `site`. Uruchom ją **przed** panelem, żeby Caddy
miał dokąd kierować ruch.

| Co zmieniłeś | Co uruchomić |
|---|---|
| `frontend/src/*` | `docker compose up -d --build web` |
| `backend/app/*`, migracje | `docker compose up -d --build api` |
| `deploy/Caddyfile` | `docker compose restart web` (montowany, bez builda) |
| `.env` | `docker compose up -d` |

**Backend musi chodzić na jednym workerze uvicorna** (tak jest w `Dockerfile`;
nie dokładaj `--workers`). Pokoje tablicy żyją w pamięci procesu - przy dwóch
workerach dwie osoby na tej samej stronie tablicy trafiłyby do dwóch pokoi,
które nigdy się nie spotkają. Patrz „Decyzje projektowe".

Rekord A domeny musi wskazywać na serwer **przed** pierwszym uruchomieniem -
Caddy od razu występuje o certyfikat, a Let's Encrypt limituje nieudane
walidacje.

Po wdrożeniu zmiany w uwierzytelnianiu wszyscy zalogowani muszą podać login
i hasło ponownie - stare tokeny z `localStorage` przestają być wysyłane,
a ciasteczka jeszcze nie ma.

### Zadanie okresowe

Wystąpienia serii są materializowane przy starcie i przy tworzeniu serii.
Przy długo działającym procesie potrzebny jest impuls dobowy:

```cron
0 3 * * * cd /sciezka/korepetycje && docker compose exec -T api \
  python -c "from app.main import _generate_upcoming; print(_generate_upcoming())"
```

Alternatywnie `POST /api/maintenance/generate-lessons` (rola staff, idempotentne).

To samo zadanie - w obu wariantach - sprząta snapshoty tablic starsze niż
30 dni.

## Testy

### Backend - regresje

Wymagają dodatkowej zależności spoza obrazu produkcyjnego:

```bash
cd backend
pip install -r requirements-dev.txt
```

```bash
python test_forced_password.py    # wymuszona zmiana hasła
python test_login_hardening.py    # blokada konta, limity, CORS, JWT_SECRET
python test_migrations.py         # cykl migracji, blokada startu na starym schemacie
python test_series_generator.py   # unikalność slotu, klamra horyzontu, GET bez zapisu
python test_money.py              # arytmetyka w groszach, zamrożona stawka
python test_cookie_session.py     # sesja w ciasteczku httpOnly, wylogowanie
python test_sessions.py           # rejestr sesji, unieważnianie przy zmianie hasła
python test_soft_delete.py        # archiwizacja ucznia, przywracanie, usunięcie trwałe
python test_password_reset.py     # reset hasła konta personelu
python test_series_update.py      # edycja serii i reguły propagacji na zajęcia
python test_payment_edit.py       # korekta wpłaty
python test_transfer_code.py      # kod QR przelewu (standard 2D ZBP)
python test_role_isolation.py     # rozdział danych między korepetytorami, bramki ról
python test_reschedule_flow.py    # prośby o przełożenie: uczeń -> korepetytor/staff
python test_availability_slots.py # dostępność korepetytora i wolne terminy
python test_board_token.py        # tablica: token, rotacja, archiwum, purge, przypisanie ucznia
python test_board_pages.py        # tablica: router publiczny, strony po id, PUT scalający
python test_board_reconcile.py    # tablica: reguła scalania (determinizm, przemienność, isDeleted)
python test_board_ws.py           # tablica: pokoje, WebSocket, zapis okresowy, PUT przez pokój
python test_board_snapshots.py    # tablica: reguła 24 h, przywracanie, retencja
python test_board_files.py        # tablica: obrazki po sygnaturze, dedup, quota, ścieżki
python test_board_library.py      # tablica: biblioteka kształtów na koncie, izolacja, limit
python test_student_files.py      # materiały ucznia: zakres korepetytora, PDF po sygnaturze, widok ucznia, purge
```

Każdy zestaw pracuje na własnej bazie w katalogu tymczasowym i nie dotyka bazy
deweloperskiej. Wszystkie to regresje konkretnych błędów - jeśli któryś zacznie
padać po zmianie, prawdopodobnie ta zmiana cofnęła poprawkę.

### Frontend - testy jednostkowe (Vitest)

```bash
cd frontend
npm install
npm test              # jednorazowy przebieg
npm run test:watch    # w tle, przy pracy nad kodem
```

Obejmują moduły bez UI, w których błąd jest cichy: `dates.js` (siatka miesiąca,
data lokalna zamiast UTC), `password.js` (polityka haseł, ta sama co w
`backend/app/auth.py`), `colors.js` i `tablica/reconcile.js` (reguła scalania
elementów tablicy, ta sama co w `backend/app/boards_reconcile.py`). Biegną w kilkaset milisekund, więc nadają
się do pętli edycja-zapis; scenariusze przez interfejs są w Playwrighcie niżej.

### Frontend - end-to-end (Playwright)

```bash
cd frontend
npm install
npx playwright install chromium    # jednorazowo, ~150 MB
npm run e2e                        # pełny przebieg: desktop + emulacja telefonu
npm run e2e:ui                     # tryb interaktywny, krok po kroku
npm run e2e:report                 # raport z ostatniego przebiegu
```

Playwright sam uruchamia backend i frontend, na **osobnej bazie `e2e.db`**
kasowanej przy każdym przebiegu - testy tworzą i usuwają uczniów, więc nie
mogą dotykać bazy deweloperskiej ani produkcyjnej. Sesja startowa (logowanie
plus wymuszona zmiana hasła) przygotowywana jest raz w `e2e/auth.setup.js`
i zapisywana do `e2e/.auth/`.

Zakres: potwierdzenia usuwania, wylogowanie przeżywające odświeżenie strony,
warstwowanie okien modalnych, układ mobilny (brak poziomego przewijania
strony, przewijalny pasek nawigacji) oraz tablica: wejście gościa bez konta,
dwie przeglądarki naraz na jednej stronie, Ctrl+Z nie cofający cudzej pracy,
rotacja linku. Testy tablicy czytają scenę przez `window.__tablicaAPI`,
wystawiane tylko na dev serverze - płótno to `<canvas>`, którego nie da się
odpytać z DOM.

Po nieudanym przebiegu `npm run e2e:report` pokazuje wideo, zrzuty i ślad,
po którym da się przewijać stan DOM krok po kroku.

## Decyzje projektowe

**Kwoty jako liczby całkowite w groszach.** `float` nie zapisuje dokładnie
`0.1`, więc sumowanie cen zajęć kumuluje błąd i saldo rozjeżdża się o grosz.
Konwersja odbywa się wyłącznie na granicy API - modele wystawiają właściwości
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
Ma to też skutek uboczny dla bezpieczeństwa - patrz punkt niżej.

**Sesja w ciasteczku httpOnly, bez tokenu CSRF.** Token nie jest dostępny dla
JavaScriptu, więc XSS nie wystarcza do jego wykradzenia. Ochronę przed CSRF
daje `SameSite=Lax`: przeglądarka nie dołącza ciasteczka do żądań POST, PATCH
i DELETE inicjowanych z obcych witryn, a wszystkie operacje zmieniające stan
używają tych metod. Warunkiem poprawności jest to, że żaden GET nie zmienia
danych. Nagłówek `Authorization` nadal działa - korzystają z niego `/docs`,
`curl` i zadania crona.

**Potwierdzenia usuwania we własnym oknie, nie przez `confirm()`.** Natywne
okno przeglądarki da się wyłączyć („nie pokazuj więcej okien dialogowych"),
po czym `confirm()` zwraca `false` i usuwanie po cichu przestaje działać.
Komunikaty opisują konsekwencje, a nie samą czynność; usunięcie ucznia -
jedyna operacja kasująca historię finansową - wymaga przepisania jego nazwiska.

**Etykiety powiązane z kontrolkami przez `htmlFor`/`id`.** Identyfikatory
generuje `useId()`, bo część formularzy bywa otwarta jednocześnie i statyczne
`id` dawałyby duplikaty w DOM. Dzięki temu czytnik ekranu odczytuje
przeznaczenie pola, kliknięcie w etykietę ustawia w nim kursor, a testy
chwytają pola po widocznym tekście zamiast po strukturze HTML.

**Edycja serii propaguje się zależnie od rodzaju pola.** Metadane (przedmiot,
poziom, prowadzący) trafiają na wszystkie przyszłe zajęcia, także te ręcznie
przesunięte - opisują, czym zajęcia są, niezależnie od terminu. Zmiana terminu
pomija zajęcia z ręcznie zmienioną datą, bo cofnęłaby czyjąś decyzję. Cena idzie
na przyszłe; odbyte zachowują stawkę zamrożoną w momencie odbycia.

**Usunięcie ucznia archiwizuje, nie kasuje.** `cascade delete` na wpłatach
oznaczał, że jedno kliknięcie niszczyło historię rozliczeń. Archiwizacja ukrywa
ucznia i kasuje jego konto oraz przyszłe nieodbyte zajęcia, ale zostawia zajęcia
odbyte i wpłaty. Trwałe usunięcie jest osobnym endpointem - tylko admin, tylko
dla zarchiwizowanego ucznia - bo art. 17 RODO wymaga, żeby dało się je wykonać.

**Sesje są rejestrowane w bazie.** JWT są bezstanowe, więc bez tabeli `sessions`
zmiana hasła nie kończyłaby sesji otwartych gdzie indziej. Każde żądanie
sprawdza, czy `jti` z tokenu nadal ma otwartą sesję. Koszt to jedno zapytanie na
żądanie - przy tej skali nieodczuwalny, a alternatywa (krótkie tokeny dostępowe
z refresh tokenem) opóźniałaby unieważnienie o kilkanaście minut i dokładała
kolejkowanie odświeżeń po stronie przeglądarki.

**Okno modalne zamyka się tylko przy prawdziwym kliknięciu w tło.** Zdarzenie
`click` wypada na wspólnym przodku wciśnięcia i puszczenia, więc zaznaczenie
tekstu w polu i puszczenie poza oknem rejestrowało się jako kliknięcie w tło
i kasowało wypełniony formularz.

**Płatności przez przelew, nie przez bramkę.** Kod 2D ZBP pozwala zeskanować
przelew w aplikacji banku: kwota i tytuł są wypełnione, więc wpłaty da się
przypisać do ucznia bez zgadywania. Bramka wymagałaby zarejestrowanej
działalności, regulaminu i prowizji od transakcji, a przy kilku uczniach
minimalna prowizja umowna przewyższyłaby wartość usługi. Kod QR daje większość
tej wygody za zero kosztów - kosztem ręcznego oznaczenia wpłaty, co i tak
trzeba robić.

**Tablica: link jest uprawnieniem, nie ma kont uczniów.** Token siedzi
w kolumnie `boards.token` i sam w sobie daje dostęp - bez tabeli udostępnień,
bez zapraszania, bez sprawdzania „czy ten uczeń ma dostęp". Uczeń często nie
ma konta w panelu i nie powinien go potrzebować, żeby porysować. Świadomy
zakład: kto ma link, ten pisze. Link nie wygasa, bo cały pomysł polega na
wielokrotnym użyciu przez cały kurs; mitygacje to rotacja tokenu i snapshoty.
Ten sam wzorzec, co publiczny kanał `.ics` kalendarza.

**Tablica: widoczność po przypisaniu, nie po uczniu.** Ten sam podział, co na
zajęciach i wpłatach: `created_by_user_id` mówi, kto tablicę założył,
`assigned_tutor_id` - czyja jest. Korepetytor widzi w panelu tablice
przypisane do siebie (i te, które sam założył); staff wszystkie. Sekretariat
może założyć tablicę korepetytorowi albo zostawić ją „tylko administracja".
Repozytorium ma dwie definicje „ucznia korepetytora" (`Student.tutor_id`
i `Lesson.assigned_tutor_id`), a wybór złej to wyciek notatek między
korepetytorami - dlatego `student_id` na tablicy nie daje nikomu dostępu
i służy tylko do pokazania jej przy uczniu.

**Tablica: pliki binarne poza bazą.** Zdjęcie zadania z telefonu ma 3 MB;
zapisane w SQLite trafiłoby do każdego snapshotu bazy i do strumienia WAL
Litestreama. Obrazki leżą na dysku pod ścieżką z `sha256` (dedup, nic od
klienta nie trafia do ścieżki), w bazie są tylko metadane. Typ rozpoznawany
po sygnaturze bajtowej, nie po nagłówku z żądania. **TODO:** katalog
`BOARD_FILES_PATH` nie jest objęty replikacją Litestream - wymaga osobnego
backupu (np. `rclone sync` do B2 w cronie).

**Tablica: snapshoty jako jedyna obrona przed przypadkowym skasowaniem.**
Kto ma link, może zaznaczyć wszystko i wcisnąć Delete, a zapis na żywo
nadpisuje stan. Przed pierwszym zapisem strony w ciągu 24 h stan sprzed zapisu
idzie do `board_snapshots` (30 dni, jak replika Litestreama). Reguła jest
samowyzwalająca - bez crona łapie stan sprzed dzisiejszej lekcji. Przywrócenie
nie nadpisuje: snapshot zamienia się w aktualizację, która wygrywa scalanie
(wyższy `version`), więc dociera też do połączonych osób, a stan sprzed
przywrócenia jest odkładany wymuszonym snapshotem.

**Tablica: scalanie po `version`/`versionNonce`, bez CRDT.** Przy dwóch-trzech
osobach Yjs to armata na muchę. Excalidraw i tak trzyma w każdym elemencie
licznik wersji: wygrywa wyższy `version`, remis rozstrzyga niższy
`versionNonce` - deterministycznie i niezależnie od kolejności pakietów.
Reguła jest zaimplementowana dwa razy celowo: na serwerze
(`boards_reconcile.py`, czysta funkcja, testowana w Pythonie) i u klienta
(`tablica/reconcile.js`), bo klient scala przychodzące zmiany ze stanem, który
zawiera edycje jeszcze niewysłane. Elementy `isDeleted` zostają w stanie -
usunięcie w Excalidrawie to flaga z podbitą wersją, a wyrzucenie ich
sprawiłoby, że skasowane rzeczy zmartwychwstają. `PUT` też scala, nigdy nie
nadpisuje, więc drugi mechanizm (kontrola `rev` z 409) był zbędny.

**Tablica: `app_state` po stronie klienta.** Scroll, zoom i wybrane narzędzie
to stan konkretnej przeglądarki - w `localStorage`, per link i per strona.
Zapisanie ich na serwerze sprawiałoby, że zoom jednej osoby skacze drugiej po
ekranie.

**Tablica: pokoje w pamięci jednego procesu.** Otwarta strona ma pokój
w słowniku procesu `api`; serwer jest autorytatywny, baza to siatka
bezpieczeństwa na restart (zapis co 15 s i przy wyjściu ostatniej osoby),
nie kanał synchronizacji. Stąd **wymóg jednego workera uvicorna** - patrz
„Wdrożenie". Skalowanie poziome wymagałoby Redis pub/sub; przy tej skali
celowo go nie ma i nie ma pod niego abstrakcji.

**Tablica: rate limit jest za Caddy de facto globalny.** Uvicorn honoruje
`X-Forwarded-For` tylko od `forwarded_allow_ips` (domyślnie `127.0.0.1`),
a Caddy łączy się z adresu sieci dockera, więc każdy klient ma to samo IP.
Dotyczy też limitu logowania. Limity na routerze publicznym są przez to luźne
(300/min, uploady 30/min), a przed zapełnieniem dysku broni quota per tablica,
nie limit żądań. **TODO:** `FORWARDED_ALLOW_IPS=*` w `docker-compose.yml`
(jedyną drogą do `api` jest Caddy) - osobna zmiana z własnym testem.

## Model danych

| Tabela | Zawartość |
|---|---|
| `users` | konta logowania, rola, licznik nieudanych prób, blokada |
| `students` | uczniowie, stawka domyślna, powiązanie z kontem, `archived_at` |
| `subjects` | przedmioty |
| `lesson_series` | definicje zajęć cyklicznych |
| `lessons` | pojedyncze wystąpienia, cena zamrożona, status |
| `series_skips` | pominięte wystąpienia serii |
| `payments` | wpłaty |
| `reschedule_requests` | prośby o przesunięcie |
| `availability` | dostępność korepetytora |
| `sessions` | wydane tokeny, do unieważniania sesji |
| `boards` | tablice: token (uprawnienie), tytuł, opcjonalny uczeń, twórca, przypisany korepetytor, `archived_at` |
| `board_pages` | strony tablicy: elementy Excalidrawa (JSON), `idx` do sortowania, licznik zapisów |
| `board_files` | metadane obrazków (sha256, typ, rozmiar); bajty na dysku w `BOARD_FILES_PATH` |
| `board_snapshots` | dobowe kopie stron do odzysku, retencja 30 dni |
| `users.board_library` | własne pozycje biblioteki tablicy (JSON), wbudowane bryły nie są tu zapisywane |
| `student_files` | materiały ucznia (PDF): metadane, bajty na dysku w `BOARD_FILES_PATH` |

## Backup

Litestream replikuje bazę do Backblaze B2 na bieżąco (interwał 1 s), ze
snapshotem dobowym i retencją 30 dni.

Odtworzenie - **przetestuj, zanim będzie potrzebne**:

```bash
docker run --rm -v ./restore:/out \
  -v ./deploy/litestream.yml:/etc/litestream.yml:ro \
  -e LITESTREAM_ACCESS_KEY_ID=... -e LITESTREAM_SECRET_ACCESS_KEY=... \
  litestream/litestream:0.3 restore -o /out/test.db /data/korepetycje.db
```

Ostatni argument to ścieżka bazy, po której Litestream odnajduje wpis
w konfiguracji - nie adres repliki. Podanie obu naraz kończy się błędem.

**TODO: obrazki tablic nie są backupowane.** Litestream replikuje wyłącznie
plik bazy. Katalog `BOARD_FILES_PATH` (domyślnie `/data/board_files`, na tym
samym wolumenie `db-data`) trzeba objąć osobnym mechanizmem, np. `rclone sync`
do tego samego bucketa B2 w cronie. Do tego czasu odtworzenie bazy przywróci
tablice z metadanymi obrazków, ale bez samych obrazków.

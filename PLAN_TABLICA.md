# Plan wdrożenia: moduł tablicy interaktywnej

> **Stan: wykonany (wrzesień 2026).** Etap 1 wszedł na `main` w PR #27,
> kolejne rzeczy w #31-#41. Dokument zostaje jako zapis decyzji i ich
> uzasadnień; aktualny opis działania jest w `README.md` (sekcja „Tablica"
> i „Decyzje projektowe"), a wskazówki dla kodu w `CLAUDE.md`. Odstępstwa
> od planu w trakcie realizacji: `assigned_tutor_id` wszedł od razu
> (sekcja 5.2 mówiła „na później"), commity 9 i 10 połączone, `reconcile.js`
> jest własną implementacją, nie wrapperem na paczkę (Vitest nie uruchomi
> kodu z DOM), snapshot przed przywróceniem jest wymuszany.

Dokument przeznaczony dla agenta kodującego pracującego w repozytorium
`Kamilox007/korepetycje`. Opisuje etap 1 w całości oraz zarys etapów dalszych.

---

## 0. Zasady pracy nad tym zadaniem

1. **Najpierw przeczytaj repozytorium.** W szczególności `CLAUDE.md`, `README.md`,
   `backend/app/models.py`, `backend/app/auth.py`, `backend/app/main.py`,
   strukturę `backend/app/routers/` (lub równoważną), `frontend/src/` oraz
   `deploy/Caddyfile`. Ten plan celowo nie powtarza istniejących konwencji —
   masz je odtworzyć z kodu.
2. **Dopasuj się do konwencji, które już istnieją**, nawet jeśli w tym dokumencie
   szkic wygląda inaczej. Szkice kodu tutaj są ilustracją intencji, nie wzorcem
   do skopiowania. Dotyczy to zwłaszcza: sposobu deklarowania modeli, nazw
   zależności FastAPI, obsługi dat, struktury routerów, stylu CSS.
3. **Nie zmieniaj decyzji z sekcji 2** bez zapytania. Są uzasadnione i część
   z nich wygląda na nieoptymalne, dopóki nie zna się kontekstu.
4. **Nie ruszaj istniejącej logiki rozliczeń, serii zajęć ani auth**, poza
   jawnie wymienionymi punktami:
   - sekcja 5.3 — wydzielenie rdzenia walidacji tokenu z `get_current_user`,
   - sekcja 5.2 — `purge_student` musi obsłużyć `boards.student_id`,
   - sekcja 6.2 — `vite.config.js` (proxy WebSocketów),
   - sekcja 5.7 — dołożenie retencji snapshotów do istniejącego zadania
     okresowego.
5. **Pytaj, gdy plan jest niejednoznaczny.** Lepiej zapytać niż zgadnąć.
   Otwarte pytania zebrane są w sekcji 12.
6. **Commituj etapami** zgodnie z sekcją 10. Nie rób jednego wielkiego commita.

---

## 1. Cel i kontekst

### Co budujemy

Moduł tablicy interaktywnej do prowadzenia korepetycji online, osadzony
w istniejącej aplikacji panelu. Zastępuje Miro, które jest źle dopasowane do
korepetycji (jest pod mapy myśli, nie pod rozwiązywanie zadań).

### Model użycia

- Korepetytor tworzy tablicę w panelu, np. „Kasia — matura rozszerzona".
- Tablica dostaje **stały, losowy token** i link postaci
  `https://panel.kamilkrzywon.pl/t/{token}`.
- Korepetytor wysyła link uczniowi raz (WhatsApp, mail). Uczeń używa go
  przez cały kurs, wielokrotnie.
- **Uczeń nie loguje się i nie ma konta na potrzeby tablicy.** Link wystarcza.
- Tablica ma strony. Nowa lekcja = nowa strona. Uczeń może przewinąć wstecz
  i zobaczyć notatki sprzed tygodni.

### Czym to nie jest

- Nie jest to osobna aplikacja ani osobny serwis. Moduł wchodzi do
  istniejącego backendu i frontendu.
- Nie ma osobnej domeny. Wszystko na `panel.kamilkrzywon.pl`.
  **Nie dotykaj `deploy/Caddyfile` ani DNS.**
- Nie ma osobnej bazy danych. Wszystko w istniejącej bazie SQLite.

---

## 2. Decyzje architektoniczne (nie zmieniaj bez pytania)

### 2.1 Excalidraw, nie tldraw, nie własny canvas

Osadzamy `@excalidraw/excalidraw` jako komponent React.

- **Własny canvas odpada** — rysowanie rysikiem z naciskiem, hit-testing,
  transformacje, undo/redo, eksport to setki godzin.
- **tldraw odpada z dwóch powodów.** Od wersji SDK 4.0 (wrzesień 2025)
  produkcyjne użycie wymaga klucza licencyjnego: komercyjnego (wycena
  indywidualna) albo darmowego „hobby", który wymusza widoczny watermark
  i jest tylko do użytku niekomercyjnego. Korepetycje za pieniądze to użycie
  komercyjne. Drugi powód: repozytorium jest na AGPL-3.0, z którą licencja
  tldraw jest nie do pogodzenia przy dystrybucji. Excalidraw jest na MIT —
  wchodzi do AGPL bez problemu.

### 2.2 Token jest tablicą

Nie ma tabeli `share_links`, nie ma zapraszania użytkowników, nie ma
sprawdzania „czy ten uczeń ma dostęp do tej tablicy". Token siedzi w kolumnie
tabeli `boards` i sam w sobie jest uprawnieniem dostępu.

Świadomy zakład: kto ma link, ten pisze po tablicy. Link nie wygasa, bo cały
pomysł polega na wielokrotnym użyciu. Mitygacje to rotacja tokenu (2.6)
i snapshoty (2.7), nie wygasanie.

### 2.3 Jedna baza danych

Sceny idą do istniejącego pliku SQLite, obok rozliczeń.

Rozważana była osobna baza (mniejszy narzut na Litestream), ale przegrywa:
klucze obce do `students` przestałyby działać, a integralność wymuszaną dziś
przez bazę trzeba by sprawdzać w Pythonie. Narzut na replikację jest mały pod
warunkiem, że trzymamy się 2.4 i 2.5.

### 2.4 Pliki binarne nigdy do bazy

Excalidraw trzyma wklejone obrazki jako base64 dataURL w osobnej mapie
`files` (`excalidrawAPI.getFiles()`), **obok** listy elementów — element
obrazka zawiera tylko `fileId`. Na serwer idą wyłącznie `elements`; mapy
`files` nie wysyłamy nigdy. Każdy plik z tej mapy trafia osobno na
`POST .../files` i ląduje na dysku pod nazwą pochodzącą z `sha256`.

Odrzucanie scen zawierających `data:` (5.4c) to zabezpieczenie na wypadek,
gdyby dataURL trafił do elementu inną drogą (np. pole `link`), nie główny
mechanizm.

Bez tego jedno zdjęcie zadania z telefonu (3 MB) trafia do każdego kolejnego
snapshotu bazy i do strumienia replikacji Litestreama.

### 2.5 Zapis sceny jest zdebounce'owany

Autozapis nie częściej niż **co 15 sekund** plus przy opuszczaniu strony.
Częstszy zapis nic nie daje (strata 15 s rysowania jest nieistotna),
a mnoży ruch WAL do Backblaze.

### 2.6 Rotacja tokenu zamiast wygasania

Przycisk „wygeneruj nowy link" przy tablicy w panelu. Stary link przestaje
działać natychmiast, treść tablicy zostaje. Scenariusz: uczeń kończy kurs,
dostaje eksport, token rotuje.

### 2.7 Snapshoty są obowiązkowe

Kto ma link, ten może zaznaczyć wszystko i wcisnąć Delete — najczęściej
przypadkiem. Bez snapshotów nie ma odzysku, bo zapis sceny nadpisuje stan.

Reguła: **przed zapisem strony, jeśli dla tej strony nie ma snapshotu
młodszego niż 24 h, zapisz stan sprzed zapisu jako snapshot.** Samowyzwalające
się, bez crona, i naturalnie łapie stan sprzed dzisiejszej lekcji.
Retencja 30 dni, jak w Litestreamie.

### 2.8 Realtime jest wymagany, serwer jest autorytatywny

Uczeń pisze po tablicy w trakcie lekcji, a korepetytor poprawia na bieżąco.
Bez synchronizacji na żywo ten scenariusz nie działa wcale, więc WebSocket
wchodzi do etapu 1.

Model: **serwer trzyma aktualny stan strony w pamięci i sam scala**
przychodzące zmiany regułą `version` / `versionNonce`. Klienci wysyłają
wyłącznie zmienione elementy, serwer rozsyła wynik scalenia pozostałym.

Bez CRDT. Przy 2–3 osobach na tablicy Yjs to armata na muchę, a Excalidraw
i tak trzyma w każdym elemencie licznik wersji, który wystarcza do
deterministycznego rozstrzygania konfliktów.

Scalanie po stronie serwera jest celowe — funkcja jest czysta, więc da się ją
przetestować w Pythonie, zgodnie z kulturą testową repozytorium. Klient ma
własną kopię tej samej reguły do łączenia przychodzących zmian ze swoim
lokalnym stanem, który może zawierać edycje jeszcze niewysłane.

### 2.8a Pokoje żyją w pamięci jednego procesu

Rejestr pokoi to zwykły słownik w procesie `api`, klucz `page_id`.
Baza jest tylko siatką bezpieczeństwa na restart, nie kanałem synchronizacji.

**Konsekwencja: uvicorn musi chodzić na jednym workerze.** Przy dwóch ludzie
wylądują w różnych pokojach tej samej tablicy i nie zobaczą się nawzajem.
Przy tej skali to ograniczenie bez znaczenia, ale musi być zapisane w README,
żeby nikt tego nie „zoptymalizował". Skalowanie poziome wymagałoby Redis
pub/sub — nie implementuj tego i nie przygotowuj pod to abstrakcji.

### 2.9 Rozpoznanie właściciela przez istniejące ciasteczko

Trasa tablicy jest na tym samym originie co panel, więc przeglądarka
korepetytora wyśle istniejące ciasteczko sesyjne bez żadnych zmian w auth.
Backend sprawdza je **opcjonalnie**: jest → właściciel, nie ma → gość.

Nie ruszamy `Domain` ciasteczka, `CORS_ORIGINS` ani `SameSite`.

---

## 3. Zakres etapu 1

### W zakresie

- Migracja Alembic `0013` z czterema nowymi tabelami.
- Router panelu `/api/boards` — CRUD tablic, rotacja tokenu, snapshoty.
- Router publiczny `/api/t/{token}` — odczyt i zapis stron, pliki.
- **WebSocket `/api/t/{token}/ws` — synchronizacja na żywo i kursory.**
- Ekran listy tablic w panelu z kopiowaniem linku.
- Ekran tablicy z Excalidrawem, poza layoutem panelu.
- Strony tablicy (dodawanie, tytuł, przełączanie, kasowanie).
- Upload i serwowanie plików binarnych.
- Snapshoty i przywracanie.
- Testy: regresje backendu, Vitest na reconcile, Playwright na ścieżkę gościa
  i na sesję dwóch przeglądarek jednocześnie.
- Aktualizacja `README.md`.

### Poza zakresem etapu 1

Edytor wzorów matematycznych i LaTeX, import PDF, eksport do PDF/PNG, przybory
geometryczne, miniaturki tablic, wysyłka linku mailem, czat tekstowy, audio
i wideo (rozmowa idzie obok, w Meet albo Zoomie). Nie implementuj tego teraz,
nawet jeśli wygląda na łatwe.

---

## 4. Model danych

Migracja: **rewizja `0013`** (ostatnia istniejąca to `0012_calendar_token`;
tabela „Historia rewizji" w README kończy się na `0006` i jest nieaktualna —
nie sugeruj się nią). Sama migracja to wyłącznie `create_table`, więc tryb
`batch` Alembica nie jest tu potrzebny — jest wymagany dopiero przy `alter`
na SQLite.

Po `alembic revision --autogenerate` **przejrzyj wygenerowany plik ręcznie
przed uruchomieniem**. Autogenerate bywa gorliwy przy typach `JSON`/`Text`.
`test_migrations.py` musi nadal przechodzić.

**Klucze obce nie są egzekwowane.** Repo nie włącza `PRAGMA foreign_keys`
w SQLite (patrz komentarz w `purge_student` w `main.py`). `ON DELETE CASCADE`
w definicjach poniżej dokumentuje intencję i zadziała na Postgresie, ale
**na SQLite jest no-opem** — każde trwałe usunięcie musi kasować rekordy
zależne jawnie w Pythonie, tak jak robi to istniejący `purge_student`.

### 4.1 `boards`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | int PK | |
| `token` | str(64) | UNIQUE, INDEX. `secrets.token_urlsafe(32)` — ten sam kształt co `users.calendar_token` |
| `title` | str | wymagany |
| `student_id` | int FK → `students.id` | **NULL dozwolony** |
| `created_by_user_id` | int FK → `users.id` | nie NULL |
| `created_at` | datetime | |
| `updated_at` | datetime | aktualizowany przy zapisie dowolnej strony |
| `last_opened_at` | datetime NULL | aktualizowany przy **połączeniu WS**, nie przy `GET` (repo celowo unika zapisu przy każdym odczycie — patrz throttling `last_seen_at` w `auth.py`) |
| `archived_at` | datetime NULL | miękkie usuwanie, konwencja z repo |

`student_id` jest opcjonalne celowo — tablica na lekcję próbną nie wymaga
zakładania rekordu ucznia. Gdy jest ustawione, tablica ma się pokazywać na
karcie ucznia w panelu. **`student_id` służy wyłącznie do tego** — nie jest
kryterium widoczności (patrz 5.2).

`created_by_user_id` jest jedynym kryterium własności tablicy dla roli
`tutor` (sekcja 5.2).

Przy `purge_student` (istniejący endpoint w `main.py`) tablice tego ucznia
mają dostać `student_id = NULL` — nie kasujemy ich, bo notatki należą do
korepetytora. To jedyna dozwolona zmiana w istniejącym endpoincie.

Token przechowujemy jawnie, nie zahashowany — panel musi móc wyświetlić link
ponownie. Zrzut bazy ujawnia tokeny, ale zrzut bazy ujawnia też wszystko inne.

### 4.2 `board_pages`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | int PK | |
| `board_id` | int FK → `boards.id` ON DELETE CASCADE | INDEX |
| `idx` | int | pozycja do sortowania, od 0 |
| `title` | str | domyślnie data utworzenia, np. „2026-09-20" |
| `elements` | JSON | lista elementów Excalidraw, domyślnie `[]`, posortowana po `index` (5.4a) |
| `rev` | int | licznik zapisów, start 0, inkrementowany przy zapisie; informacyjny |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**Tożsamością strony jest `id`, nie `idx`.** Wszystko, co wskazuje na stronę
— endpointy publiczne, klucz pokoju, parametr WebSocketa, snapshoty — używa
`board_pages.id`. `idx` służy wyłącznie do kolejności w UI. Powód: skasowanie
strony nie może zmieniać tożsamości pozostałych; gdyby kluczem był `idx`,
usunięcie strony 2 przy otwartym pokoju strony 3 przepięłoby ten pokój na
inną stronę, a snapshoty strony 3 wskazywałyby dawną stronę 4.

**`UniqueConstraint("board_id", "idx")`** — wymuszone przez bazę, nie przez
Pythona. Dwóch klientów tworzących stronę jednocześnie to wyścig; ta sama
zasada co przy `(series_id, origin_date)` w istniejącym kodzie. Nowa strona
dostaje `max(idx) + 1`. Po skasowaniu strony **nie przenumerowujemy** —
dziury w `idx` są dopuszczalne, sortowanie ich nie widzi, a przenumerowanie
pod unikalnym indeksem w SQLite jest kruche.

`app_state` Excalidrawa **nie jest zapisywany na serwerze**. Zawiera stan
widoku konkretnej przeglądarki (scroll, zoom, wybrane narzędzie, kolor).
Trzymaj go w `localStorage` klienta, per token i per strona.

### 4.3 `board_files`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | int PK | |
| `board_id` | int FK → `boards.id` ON DELETE CASCADE | INDEX |
| `file_id` | str | identyfikator nadany przez Excalidraw |
| `sha256` | str(64) | INDEX |
| `mime` | str | whitelist, sekcja 5.5 |
| `bytes` | int | rozmiar |
| `created_at` | datetime | |

**`UniqueConstraint("board_id", "file_id")`.**

Ścieżka na dysku wyliczana z `sha256`, nie przechowywana:
`{BOARD_FILES_PATH}/{sha256[:2]}/{sha256}`. Pliki są deduplikowane globalnie
po `sha256` — dwa rekordy mogą wskazywać na ten sam plik.

### 4.4 `board_snapshots`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | int PK | |
| `board_id` | int FK → `boards.id` ON DELETE CASCADE | INDEX |
| `page_id` | int FK → `board_pages.id` ON DELETE CASCADE | INDEX |
| `title` | str | tytuł strony w momencie snapshotu |
| `elements` | JSON | |
| `created_at` | datetime | INDEX (do retencji) |

Skasowanie strony kasuje jej snapshoty jawnie w Pythonie (kaskada z bazy
nie działa na SQLite — patrz wstęp sekcji 4).

---

## 5. Backend

### 5.1 Struktura

Dwa **fizycznie osobne routery**. To nie jest kosmetyka — router publiczny nie
może mieć żadnej zależności zwracającej zalogowanego użytkownika, żeby nie dało
się przez niego dojść do reszty API.

```
backend/app/routers/boards.py        # /api/boards  — za bramką ról
backend/app/routers/boards_public.py # /api/t       — bez bramki, z rate limitem
backend/app/boards_files.py          # zapis i walidacja plików
backend/app/boards_reconcile.py      # czysta funkcja scalania — testowalna osobno
backend/app/boards_rooms.py          # rejestr pokoi w pamięci, broadcast, zapis
```

Repo nie ma dziś katalogu `routers/` — wszystkie endpointy siedzą
w `main.py` (~1800 linii). Nowy katalog z `APIRouter` i `include_router`
w `main.py` jest dopuszczalny i wskazany; nie dokładaj kolejnych 600 linii
do `main.py`.

Prefiks `/api/t` jest celowy: Caddy kieruje `/api/*` do kontenera `api`,
więc **nie trzeba zmieniać `Caddyfile`**. Trasa SPA to `/t/{token}` (bez `/api`)
i obsługuje ją istniejący fallback na `index.html`.

### 5.2 Router panelu — `/api/boards`

Za istniejącą bramką ról. Zakres widoczności:

- `admin`, `secretary` — wszystkie tablice
- `tutor` — **wyłącznie** tablice z `created_by_user_id == user.id`
- `student` — brak dostępu do tego routera (uczeń korzysta wyłącznie z linku)

Celowo **nie** wyprowadzamy widoczności ze `student_id`. Repo ma dwie
konkurencyjne definicje „ucznia korepetytora" — `Student.tutor_id` (właściciel
rekordu) i `Lesson.assigned_tutor_id` (tak liczy `/api/tutor/summary`) — a
CLAUDE.md ostrzega, że pomylenie tych kolumn to wyciek danych między
korepetytorami. Jedna kolumna `created_by_user_id` nie zostawia miejsca na
pomyłkę. Staff tworzący tablicę w imieniu korepetytora to przypadek na
później (pole `owner_user_id`), nie na etap 1.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/boards` | lista; parametry `student_id`, `archived` |
| POST | `/api/boards` | body `{title, student_id?}`; generuje token; tworzy pierwszą stronę o `idx=0` |
| GET | `/api/boards/{id}` | metadane + lista stron **bez** `elements` |
| PATCH | `/api/boards/{id}` | body `{title?, student_id?}` |
| POST | `/api/boards/{id}/rotate-token` | nowy token, zwraca nowy link |
| DELETE | `/api/boards/{id}` | archiwizacja (ustawia `archived_at`) |
| DELETE | `/api/boards/{id}/purge` | trwałe usunięcie; **tylko `admin`**, **tylko dla zarchiwizowanej**; kasuje **jawnie** strony, snapshoty, rekordy plików (kaskada nie działa na SQLite) i pliki z dysku, których `sha256` nie jest już używany przez inną tablicę |
| GET | `/api/boards/{id}/snapshots` | lista snapshotów, bez `elements` |
| POST | `/api/boards/{id}/snapshots/{snapshot_id}/restore` | przywraca stan strony; jeśli strona ma otwarty pokój, przywrócenie przechodzi przez pokój (5.4d) |

Wzorce do odtworzenia z istniejącego kodu: archiwizacja zamiast kasowania,
trwałe usunięcie jako osobny endpoint tylko dla admina (art. 17 RODO),
potwierdzenie przez przepisanie nazwy przy operacji niszczącej dane.

**Tablica nienależąca do pytającego musi zwracać `404`, nie `403`.**
`403` potwierdza, że taka tablica istnieje.

### 5.3 Zależność opcjonalnego użytkownika

Potrzebna jest nowa zależność, np. `get_optional_user`, która:

- czyta to samo ciasteczko co istniejąca zależność,
- waliduje JWT i sprawdza `jti` w tabeli `sessions` — tak samo jak istniejąca,
- **zwraca `None` zamiast rzucać 401/403**, gdy ciasteczka nie ma,
  jest nieważne, sesja unieważniona lub konto zablokowane.

**Wyodrębnij rdzeń z `get_current_user`** do funkcji o kształcie
`resolve_session_token(token: str, db) -> models.User | None` (dekodowanie
JWT, sprawdzenie `jti` w `sessions`, throttlowany zapis `last_seen_at`),
a `get_current_user` przepisz tak, żeby ją wołała i rzucała 401 przy `None`.
Wariant „wywołaj istniejącą zależność i przechwyć wyjątek" **nie wchodzi
w grę**, bo `get_current_user` bierze `Request`, a w endpoincie
`@app.websocket` FastAPI wstrzykuje `WebSocket` — tej zależności nie da się
tam użyć. Ciasteczko czytaj osobno z `request.cookies` / `websocket.cookies`
i przekazuj sam token do rdzenia. **Nie duplikuj walidacji tokenu** — dwie
kopie tej logiki rozjadą się przy pierwszej zmianie w auth.

Istniejące testy auth (`test_sessions.py`, `test_cookie_session.py`,
`test_forced_password.py`, `test_login_hardening.py`) muszą przejść bez zmian
— to jest test, że refaktor niczego nie zmienił.

Uwaga na `must_change_password`: użytkownik z tą flagą **nie jest**
właścicielem w rozumieniu tablicy. Traktuj go jak gościa.

### 5.4 Router publiczny — `/api/t/{token}`

Bez zależności użytkownika w sygnaturze. Właściciel wykrywany przez
`get_optional_user` + porównanie z regułą widoczności z 5.2.

| Metoda | Ścieżka | Kto | Opis |
|---|---|---|---|
| GET | `/api/t/{token}` | każdy | `{title, is_owner, pages: [{id, idx, title, rev}]}` posortowane po `idx` |
| GET | `/api/t/{token}/pages/{page_id}` | każdy | `{id, idx, title, elements, rev}` |
| PUT | `/api/t/{token}/pages/{page_id}` | każdy | body `{elements}`; scalenie sceny (poniżej) |
| POST | `/api/t/{token}/pages` | właściciel | nowa strona na końcu (`max(idx) + 1`) |
| PATCH | `/api/t/{token}/pages/{page_id}` | właściciel | zmiana tytułu |
| DELETE | `/api/t/{token}/pages/{page_id}` | właściciel | kasuje stronę i jej snapshoty; **bez** przenumerowania `idx`; zamyka pokój tej strony kodem `4404`; ostatniej strony nie da się skasować |
| POST | `/api/t/{token}/files` | każdy | upload pliku, multipart |
| GET | `/api/t/{token}/files/{file_id}` | każdy | treść pliku |

`page_id` w ścieżce musi należeć do tablicy z `token` — strona innej tablicy
to `404`, nie lookup po samym `page_id`.

Nieznany token, token tablicy zarchiwizowanej, nieistniejąca strona → **`404`**,
zawsze ten sam kształt odpowiedzi. Operacja właścicielska wykonana przez
gościa → `403` (tu jest to bezpieczne, bo istnienie tablicy jest już znane).

#### Semantyka `PUT`

`PUT` **nie nadpisuje** — **scala** przysłane elementy ze stanem serwera tą
samą regułą co WebSocket (5.4a) i zwraca `{rev, elements}` ze stanem po
scaleniu. Nie ma kontroli `rev` ani `409`: skoro scalanie po
`version`/`versionNonce` jest przemienne i idempotentne, drugi mechanizm
rozstrzygania konfliktów byłby zbędny, a przy otwartym pokoju zapisującym co
15 s klient HTTP i tak nie miałby szans „trafić" w aktualny `rev`.

`rev` zostaje jako licznik zapisów — pomaga w testach i w diagnostyce, nie
jest warunkiem zapisu.

Kolejność: jeśli strona ma otwarty pokój → scalenie w pokoju i broadcast
(5.4d); w przeciwnym razie wczytaj `elements` z bazy, scal, sprawdź regułę
snapshotu z 2.7, zapisz, `rev += 1`.

Zapis aktualizuje `boards.updated_at`.

### 5.4a Scalanie — `boards_reconcile.py`

Funkcja czysta, bez zależności od FastAPI, bazy i stanu globalnego.

Reguła: wygrywa wyższy `version`; przy remisie **niższy** `versionNonce`.
Daje wynik deterministyczny i identyczny niezależnie od kolejności przyjścia
pakietów.

```python
def reconcile(current: dict[str, dict], incoming: list[dict]) -> list[dict]:
    """Scala elementy w stan bieżący. Zwraca te, które faktycznie się zmieniły —
    do rozesłania i do zapisu. `current` jest modyfikowany w miejscu."""
    changed = []
    for el in incoming:
        old = current.get(el["id"])
        if old is None or (el["version"], -el["versionNonce"]) > (old["version"], -old["versionNonce"]):
            current[el["id"]] = el
            changed.append(el)
    return changed
```

**Elementy z `isDeleted: true` zostają w stanie.** Excalidraw oznacza usunięcie
flagą zamiast wyrzucać element z tablicy. Wyrzucenie ich tutaj spowoduje, że
usunięcie u jednej osoby cofnie się przy synchronizacji z drugą.

**Kolejność elementów ma znaczenie.** Nowsze wersje Excalidrawa trzymają
z-order w polu `index` (fractional indexing, string). `current` jako `dict`
gubi kolejność, więc wszędzie tam, gdzie stan wychodzi na zewnątrz — `init`,
zapis do bazy, odpowiedź `PUT`/`GET` — sortuj po `index` (a elementy bez
`index`, jeśli się trafią, na koniec, stabilnie). Bez tego prostokąt
narysowany „pod" tekstem wyląduje u drugiej osoby nad nim.

Zanim napiszesz tę funkcję, przeczytaj `reconcileElements` w paczce
Excalidrawa (`data/reconcile`), żeby reguła w Pythonie odpowiadała temu,
co robi klient — patrz 6.4.

### 5.4b Pokoje — `boards_rooms.py`

Rejestr w pamięci procesu:

```
rooms: dict[int, Room]                  # page_id -> Room
Room: { board_id: int, elements: dict[str, dict], clients: set[Connection],
        dirty: bool, last_saved_at: datetime }
```

Kluczem jest `page_id` (4.2), nie `(board_id, idx)`.

Cykl życia pokoju:

- **Pierwsze wejście** — wczytaj `elements` z bazy do `Room.elements`.
- **Ostatnie wyjście** — zapisz, jeśli `dirty`, i usuń pokój ze słownika.
  Pokój bez klientów nie ma prawa zostać w pamięci.
- **Zapis okresowy** — zadanie w tle (`asyncio.create_task` w `lifespan`)
  zapisuje brudne pokoje nie częściej niż **co 15 s** (decyzja 2.5). Zapis
  przechodzi przez tę samą regułę snapshotu co `PUT` (decyzja 2.7)
  i inkrementuje `rev`.

Dostęp do bazy:

- **Nie trzymaj sesji SQLAlchemy przez czas życia połączenia WS.**
  `Depends(get_db)` w sygnaturze endpointu WS oznaczałoby sesję otwartą przez
  całą godzinną lekcję — przy SQLite (jeden pisarz) to prosta droga do
  `database is locked` w reszcie aplikacji. Pokój otwiera krótkie
  `SessionLocal()` tylko na wczytanie i na zapis, w bloku `try/finally`.
- SQLAlchemy jest synchroniczne, a handler WS asynchroniczny: wczytanie
  i zapis puszczaj przez `starlette.concurrency.run_in_threadpool`, żeby nie
  blokować pętli zdarzeń, przez którą idą kursory wszystkich pokoi.
- Mutacje `Room.elements` i `rooms` wykonuj wyłącznie w pętli zdarzeń
  (w handlerze, nie w wątku). Do wątku przekazuj gotową, zserializowaną
  listę do zapisu.

### 5.4c Protokół WebSocketa

Endpoint: `WS /api/t/{token}/ws?page_id={id}`.

Autoryzacja: ten sam lookup tokenu co w reszcie routera publicznego.
Nieznany token, tablica zarchiwizowana, nieistniejąca strona lub strona
spoza tej tablicy → zamknij połączenie kodem `4404`. Rola właściciela
ustalana przez rdzeń z 5.3 na ciasteczku z `websocket.cookies` (ten sam
origin, więc przeglądarka je dołączy do handshake'u). Połączenie ustawia
`boards.last_opened_at`.

Wiadomości **klient → serwer**:

| `t` | Ciało | Opis |
|---|---|---|
| `update` | `{elements: [...]}` | wyłącznie elementy zmienione od ostatniej wysyłki |
| `pointer` | `{x, y, button}` | pozycja kursora, nie zapisywana nigdzie |
| `hello` | `{name}` | etykieta przy kursorze; serwer przycina do 40 znaków i usuwa znaki sterujące — to trafia do innych osób w pokoju |

Wiadomości **serwer → klient**:

| `t` | Ciało | Opis |
|---|---|---|
| `init` | `{elements: [...], rev, peers: [...]}` | pełny stan po połączeniu |
| `update` | `{elements: [...]}` | wynik scalenia, tylko faktycznie zmienione |
| `pointer` | `{peer_id, x, y}` | kursor innej osoby |
| `peers` | `{peers: [{peer_id, name, is_owner}]}` | zmiana składu pokoju |

Zasady:

- Nadawca **nie dostaje** z powrotem własnego `update`, chyba że scalanie
  odrzuciło jego element — wtedy dostaje zwycięską wersję.
- `pointer` nie idzie do bazy i nie oznacza pokoju jako brudnego.
- Limit rozmiaru pojedynczej wiadomości: **1 MB**. Wiadomość większa →
  zamknięcie połączenia. Scena zawierająca `data:` → odrzucenie (decyzja 2.4).
- Ping/pong robi za nas uvicorn (`websockets`, domyślnie co 20 s, zamyka
  martwe połączenia) — **nie implementuj własnego pingu**. Po stronie klienta
  wystarczy reagować na `close`/`error` ponownym połączeniem.

#### Ponowne połączenie

Po utracie łącza klient:

1. otwiera połączenie na nowo i dostaje `init` z pełnym stanem serwera;
2. scala go ze swoim stanem lokalnym tą samą regułą (sekcja 6.4);
3. wysyła jako `update` te elementy, w których jego wersja wygrała.

Bez tego uczeń z kiepskim wi-fi wraca ze stanem sprzed kilku minut
i nadpisuje pracę drugiej osoby. **To jest wymagane, nie opcjonalne.**

### 5.4d Co zostaje z HTTP

Endpointy `GET` i `PUT` na stronach **zostają** i nie są martwym kodem:

- `GET` jest źródłem stanu przy wejściu, zanim WebSocket się zestawi,
  i ścieżką awaryjną, gdy połączenie nie dochodzi do skutku.
- `PUT` zostaje jako zapis awaryjny — gdy WebSocket padnie i nie wraca,
  klient ma czym zapisać pracę zamiast ją stracić.
- Gdy dla strony istnieje otwarty pokój, `PUT` **musi przejść przez ten pokój**
  (scalenie + broadcast), a nie pisać wprost do bazy. Inaczej zapis awaryjny
  jednej osoby skasuje pracę pozostałych. To samo dotyczy przywracania
  snapshotu z routera panelu.

### 5.5 Pliki

- Limit rozmiaru pojedynczego pliku: **10 MB**, konfigurowalny przez
  `BOARD_MAX_FILE_MB`.
- **Limit łączny na tablicę: 200 MB**, konfigurowalny przez
  `BOARD_MAX_TOTAL_MB` — `SUM(bytes)` po `board_files.board_id` przed
  przyjęciem uploadu. Bez tego każdy, kto ma link, może zapełnić dysk, a limit
  per IP z 5.6 tego nie powstrzyma (patrz uwaga tam). Przekroczenie → `413`.
- Whitelist MIME: `image/png`, `image/jpeg`, `image/gif`, `image/webp`.
  **Typ weryfikuj po zawartości pliku (sygnatura bajtowa), nie po nagłówku
  z żądania.** SVG **nie wchodzi** do etapu 1 — zdjęcia zadań to JPEG/PNG,
  a SVG wymaga osobnych nagłówków bezpieczeństwa (może zawierać skrypt).
  Dołożenie później to jeden wpis w whiteliście plus `Content-Disposition:
  attachment` i `Content-Security-Policy: default-src 'none'` przy
  serwowaniu.
- Wszystkie pliki serwuj z `X-Content-Type-Options: nosniff` (Caddy dokłada
  to na brzegu, ale endpoint ma być poprawny także bez Caddy).
- Katalog z `BOARD_FILES_PATH`, domyślnie `/data/board_files`.
- Ścieżkę buduj wyłącznie z wyliczonego `sha256`. Nic pochodzącego od klienta
  nie może trafić do ścieżki na dysku.

**Te pliki nie są objęte Litestreamem.** Dodaj to jako jawny `TODO`
w `README.md` — backup katalogu to osobna sprawa (np. `rclone sync` do B2
w cronie). Nie implementuj tego w etapie 1, ale nie przemilczaj.

### 5.6 Rate limit

`slowapi` na całym routerze publicznym, per IP. Punkt wyjścia:
**300 żądań/min**, `POST .../files` osobno **30/min**. WebSocket nie
podlega slowapi w ogóle — to nie problem, bo ruch po WS jest ograniczany
rozmiarem wiadomości (5.4c), a nie liczbą żądań.

Nie chodzi o obronę przed zgadywaniem tokenu (256 bitów entropii jest
nieodgadywalne), tylko o to, żeby skanowanie nie zapychało logów i dysku.

**Uwaga: za Caddy ten limit jest de facto globalny, nie per IP.** Uvicorn
honoruje `X-Forwarded-For` tylko od adresów z `forwarded_allow_ips`
(domyślnie `127.0.0.1`), a Caddy łączy się z adresu sieci dockera — więc
`get_remote_address` zwraca dla każdego klienta IP Caddy. To istniejący
stan (dotyczy też limitu logowania) i **nie naprawiamy go w tym zadaniu**,
ale wynikają z niego dwie rzeczy: limity muszą być na tyle luźne, żeby kilka
równoległych lekcji z obrazkami się w nich zmieściło (stąd 300, nie 120),
a przed zapełnieniem dysku broni quota per tablica z 5.5, nie rate limit.
Dopisz to jako `TODO` w README obok wpisu o backupie plików (naprawa to
`FORWARDED_ALLOW_IPS=*` w `docker-compose.yml`, bo jedyną drogą do `api`
jest Caddy — ale to osobna zmiana z własnym testem).

### 5.7 Retencja snapshotów

Kasowanie snapshotów starszych niż 30 dni. Dołóż do istniejącego mechanizmu
zadań okresowych zamiast zakładać nowy. Uwaga: README opisuje **dwie** drogi
uruchomienia — cron woła `_generate_upcoming()` z `main.py` przez
`docker compose exec`, a alternatywnie jest `POST /api/maintenance/generate-lessons`.
Retencja ma działać na **obu**, więc wepnij ją w miejsce wspólne (np. obok
`purge_expired_sessions` w endpoincie **i** w `_generate_upcoming`, albo
wydziel jedną funkcję `run_daily_maintenance` wołaną z obu). Operacja ma
być idempotentna.

---

## 6. Frontend

### 6.1 Trasy

| Trasa | Layout | Opis |
|---|---|---|
| `/tablice` | panel | lista tablic, tworzenie, kopiowanie linku, rotacja, archiwizacja |
| `/t/:token` | **brak** | ekran tablicy |

`/t/:token` **musi być poza layoutem panelu**. Gość nie ma widzieć nawigacji
do kalendarza, sald ani przycisku wylogowania. Właściciel dostaje na tym
ekranie mały pasek narzędzi właściciela (strony, powrót do panelu) renderowany
warunkowo z `is_owner`.

**Pułapka w `App.jsx`:** komponent najpierw woła `api.me()` i robi
`if (!auth) return <Login/>` (a potem `if (forcePw) return <ChangePassword/>`)
**zanim** dojdzie do jakiegokolwiek `<Routes>`. Gość pod `/t/{token}` zobaczy
dziś ekran logowania. Trasę tablicy dopasuj **przed** tymi bramkami — np.
na samym początku `App` sprawdź `useLocation().pathname.startsWith("/t/")`
i zwróć ekran tablicy (lazy) bez czekania na `api.me()`. Ekran tablicy sam
pyta `GET /api/t/{token}` i z `is_owner` wie, czy jest właścicielem — nie
potrzebuje stanu `auth` z `App`. Zalogowany właściciel z `must_change_password`
jest w tej ścieżce gościem (5.3) — to spójne, nie omijaj tego.

Na karcie ucznia w panelu dodaj sekcję z jego tablicami (filtr po `student_id`).

### 6.2 Osadzenie Excalidrawa

Instalacja: `npm i @excalidraw/excalidraw` w `frontend/`.

**Zweryfikuj poniższe przy zainstalowanej wersji** — szczegóły zmieniały się
między wydaniami. Sprawdź `node_modules/@excalidraw/excalidraw/` i README paczki,
nie zakładaj na podstawie starszych tutoriali.

1. **Self-hosting assetów.** Domyślnie komponent pobiera fonty i ikony z CDN
   (unpkg). To niespójne z resztą projektu i psuje działanie bez internetu.
   Ustaw `window.EXCALIDRAW_ASSET_PATH` i skopiuj assety z paczki do
   `public/excalidraw-assets/` skryptem `prebuild` **i** `predev`
   w `package.json`. **Nie `postinstall`:** w `frontend/Dockerfile`
   `npm install` odpala się przed `COPY . .`, więc katalog powstały
   w `postinstall` zależy od kolejności warstw. Katalog docelowy dopisz do
   `.gitignore`. Sprawdź w paczce, gdzie dokładnie leżą fonty w tej wersji.
2. **CSS.** Nowsze wersje wymagają osobnego importu arkusza z paczki.
3. **Konfiguracja Vite — dwie zmiany w `vite.config.js`:**
   - **`ws: true` w proxy `/api`** — bez tego WebSocket nie przechodzi przez
     dev server, a Playwright startuje właśnie `npm run dev`. Bez tej linii
     realtime nie działa ani lokalnie, ani w E2E. To jedyny plik konfiguracji
     infrastruktury, który wolno zmienić.
   - `define` z `process.env.IS_PREACT`, jeśli build lub runtime wywala się
     z błędem o `process` — zależy od wersji.
4. **Lazy loading.** Excalidraw to ok. 1 MB po gzipie. Ładuj obie trasy przez
   `React.lazy` + `Suspense`. Kalendarz, otwierany codziennie, nie ma płacić
   za tablicę otwieraną raz w tygodniu.
5. **Język.** `langCode="pl-PL"`.
6. **`UIOptions`.** Wyłącz elementy prowadzące poza aplikację: „Live
   collaboration", odnośniki do Excalidraw+, eksport do chmury Excalidrawa.
   Zostaw undo/redo, zoom, bibliotekę kształtów.

### 6.3 Cykl życia strony

- **Wejście:** `GET /api/t/{token}` → metadane i lista stron.
  `GET /api/t/{token}/pages/{page_id}` → elementy. `app_state` z `localStorage`
  (klucz per token i per `page_id`). Pliki: pobierz te, do których odwołuje
  się scena (`fileId` z elementów typu `image`), i wstaw przez
  `excalidrawAPI.addFiles`.
- **Praca:** po załadowaniu sceny otwórz WebSocket. `onChange` z Excalidrawa
  wykrywa elementy o podbitym `version` i wysyła je jako `update`, nie częściej
  niż **co 80 ms**. Do bazy nie zapisuje już klient — robi to serwer (5.4b).
- **Odbiór:** `update` z serwera scal z lokalną sceną regułą z 6.4
  i wstaw przez `updateScene`. Nie podmieniaj sceny w całości — zgubisz
  zaznaczenie i bieżącą kreskę użytkownika.
- **Kursory:** `onPointerUpdate` wysyła pozycję (throttle ~50 ms), a pozycje
  innych osób wstawiasz przez props `collaborators` — Excalidraw renderuje je
  sam, łącznie z etykietą imienia.
- **Imię:** zapytaj przy pierwszym wejściu, trzymaj w `localStorage` per token.
  Nie waliduj i nie zapisuj do bazy — to etykieta przy kursorze, nie tożsamość.
- **Nowy plik w scenie:** nowy wpis w `excalidrawAPI.getFiles()` bez
  odpowiadającego rekordu → wyślij na `POST /api/t/{token}/files`, dopiero
  potem wyślij element obrazka jako `update`. Do serwera idą wyłącznie
  `elements`; mapy `files` nie wysyłaj nigdy (2.4).
- **Wyjście:** wyślij zaległe zmiany przy `visibilitychange` na `hidden`
  i zamknij połączenie. `beforeunload` jest zawodny na mobile — nie polegaj
  na nim jako jedynym mechanizmie.
- **Przełączenie strony:** zamknij pokój starej strony, otwórz nowej.
  Jedno połączenie obsługuje jedną stronę.

Pokaż nienachalny wskaźnik stanu połączenia („na żywo" / „łączenie…" /
„offline — zmiany zapisane lokalnie"). Cicha awaria sieci kosztuje lekcję,
a przy dwóch rysujących osobach objawia się jako rozjeżdżanie się widoków
bez żadnego komunikatu.

### 6.4 Scalanie po stronie klienta

Osobny moduł bez zależności od Reacta: `frontend/src/tablica/reconcile.js`.

Ta sama reguła co na serwerze (5.4a), **celowo zduplikowana**: serwer
rozstrzyga konflikty między klientami, klient scala przychodzące zmiany ze
swoim stanem lokalnym, który może zawierać edycje jeszcze niewysłane.
Gdyby klient ufał serwerowi bezwarunkowo, kreska rysowana w momencie
przyjścia `update` znikałaby w trakcie rysowania.

**Najpierw sprawdź, czy zainstalowana wersja eksportuje `reconcileElements`**
z `@excalidraw/excalidraw`. Jeśli tak — `reconcile.js` ma być cienkim
wrapperem na tę funkcję, nie własną implementacją. Wersja z paczki robi dwie
rzeczy, których szkic poniżej nie robi: nie nadpisuje elementu, który
użytkownik właśnie edytuje (`appState.editingElement` / odpowiednik), i zwraca
listę uporządkowaną po `index` (fractional indexing). Własna implementacja
bez tego da migotanie edytowanego tekstu i rozjazd z-orderu między osobami.
Reguła w Pythonie (5.4a) ma wtedy odwzorowywać `shouldDiscardRemoteElement`
z paczki, a nie odwrotnie.

Obie implementacje muszą dawać identyczne wyniki. Przy zmianie reguły
w jednej z nich — zmień w obu i zaktualizuj oba zestawy testów.

Reguła: wygrywa wyższy `version`, remis rozstrzyga **niższy** `versionNonce`
(tak samo jak w Excalidrawie — zweryfikuj w zainstalowanej paczce).

```js
// szkic — sprawdź kierunek porównania versionNonce przy implementacji
export function reconcile(mine, theirs) {
  const out = new Map(theirs.map(el => [el.id, el]));
  for (const el of mine) {
    const other = out.get(el.id);
    if (!other || el.version > other.version ||
        (el.version === other.version && el.versionNonce < other.versionNonce)) {
      out.set(el.id, el);
    }
  }
  return [...out.values()];
}
```

Funkcja jest czysta — przetestuj ją w Vitest (sekcja 8.2), także wtedy, gdy
jest wrapperem na paczkę: test pilnuje, że aktualizacja Excalidrawa nie
zmieniła semantyki.

Uwaga na elementy usunięte: Excalidraw oznacza je `isDeleted: true` zamiast
wyrzucać z tablicy. Przy scalaniu **zachowaj je**, inaczej usunięcie u jednej
osoby cofnie się przy synchronizacji z drugą. Odfiltruj je dopiero przy
renderowaniu. Rozważ czyszczenie `isDeleted` przy zapisie na serwer, jeśli
scena zaczyna puchnąć — ale nie w etapie 1.

### 6.5 Historia undo a zmiany zdalne

**Zmiany przychodzące z serwera nie mogą trafiać do lokalnej historii undo.**
Inaczej Ctrl+Z u korepetytora cofa to, co przed chwilą narysował uczeń —
najbardziej mylący możliwy błąd na tablicy współdzielonej.

Excalidraw ma na to parametr przy wstawianiu sceny (w starszych wersjach
`commitToHistory`, w nowszych `captureUpdate` z odpowiednią stałą).
**Sprawdź nazwę w zainstalowanej paczce** i napisz pod to test E2E (8.3),
bo to regresja, która wraca przy każdej aktualizacji Excalidrawa.

### 6.6 Styl

CSS bez frameworka, zgodnie z resztą projektu. Etykiety powiązane z kontrolkami
przez `htmlFor`/`id` z `useId()`. Potwierdzenia we własnym oknie modalnym,
nie przez `confirm()`. Modal zamyka się tylko przy prawdziwym kliknięciu w tło.
Wszystkie te wzorce są już w repo — odtwórz je, nie wymyślaj na nowo.

---

## 7. Konfiguracja i wdrożenie

Nowe zmienne środowiskowe — dopisz do `.env.example` i do tabeli w `README.md`:

| Zmienna | Znaczenie | Domyślnie |
|---|---|---|
| `BOARD_FILES_PATH` | katalog na pliki wklejone do tablic | `/data/board_files` |
| `BOARD_MAX_FILE_MB` | limit rozmiaru pojedynczego pliku | `10` |
| `BOARD_MAX_TOTAL_MB` | limit łączny plików jednej tablicy | `200` |

Domyślna ścieżka leży na istniejącym wolumenie `db-data:/data`, więc
w `docker-compose.yml` **nie trzeba** nowego wolumenu — jeden katalog do
backupu. Upewnij się tylko, że katalog powstaje przy starcie (użytkownik `app`
w kontenerze ma prawa do `/data`).

**Nie zmieniaj:** `Caddyfile`, `CORS_ORIGINS`, domeny, konfiguracji ciasteczka,
`litestream.yml` (pliki binarne nie idą przez Litestream, patrz 5.5),
`docker-compose.yml` poza ewentualną zmienną środowiskową. Jedyny plik
infrastruktury do zmiany to `frontend/vite.config.js` (6.2).

---

## 8. Testy

Repozytorium ma mocną kulturę testową — każdy plik regresji odpowiada
konkretnemu błędowi. Trzymaj się tej konwencji: samodzielny skrypt, własna baza
w katalogu tymczasowym, zero kontaktu z bazą deweloperską.

### 8.1 Regresje backendu (`backend/test_*.py`)

- **`test_board_token.py`** — token unikalny; rotacja unieważnia stary
  natychmiast; nieznany token → 404; tablica zarchiwizowana → 404;
  router publiczny nie ujawnia niczego spoza swojej tablicy.
- **`test_board_pages.py`** — `UNIQUE(board_id, idx)` wymuszone przez bazę;
  `PUT` scala zamiast nadpisywać (dwa `PUT` z rozłącznymi elementami dają
  sumę, nie ostatni wygrywa) i inkrementuje `rev`; operacje na stronach
  wykonane przez gościa → 403; `page_id` innej tablicy pod tym tokenem → 404;
  kasowanie strony **nie** zmienia `id` ani `idx` pozostałych i kasuje jej
  snapshoty; ostatniej strony nie da się skasować; `purge` tablicy kasuje
  strony, snapshoty i rekordy plików (asercja bezpośrednio na tabelach —
  to pilnuje, że nikt nie polega na kaskadzie z bazy); `purge_student`
  zeruje `boards.student_id` zamiast kasować tablicę.
- **`test_board_snapshots.py`** — pierwszy zapis po 24 h tworzy snapshot ze
  stanu **sprzed** zapisu; drugi zapis tego samego dnia nie tworzy kolejnego;
  przywrócenie odtwarza treść; retencja kasuje starsze niż 30 dni
  i jest idempotentna.
- **`test_board_files.py`** — plik ponad limit odrzucony; przekroczenie
  quoty tablicy → 413; MIME spoza whitelisty odrzucony mimo zgodnego
  nagłówka (w tym SVG); dwa identyczne pliki dają jeden plik na dysku;
  ścieżka nie daje się wyjść poza katalog; `purge` tablicy nie kasuje pliku
  z dysku, jeśli inna tablica ma rekord z tym samym `sha256`.
- **`test_board_reconcile.py`** — funkcja z 5.4a: determinizm; idempotencja
  (`reconcile(stan, te_same_elementy)` zwraca pustą listę zmian);
  niezależność od kolejności (trzy zbiory scalone w dowolnej kolejności dają
  ten sam stan końcowy); element z niższym `version` nie nadpisuje wyższego;
  remis rozstrzygany po `versionNonce`; elementy z `isDeleted` przetrwają;
  wynik serializacji jest posortowany po `index`.
- **`test_board_ws.py`** — dwa połączenia do tej samej strony (użyj
  `TestClient.websocket_connect`): `update` od pierwszego dociera do drugiego;
  nadawca nie dostaje echa własnej zmiany; połączenie z nieznanym tokenem jest
  zamykane; wiadomość zawierająca `data:` w scenie jest odrzucana;
  po odłączeniu ostatniego klienta stan trafia do bazy i pokój znika z pamięci;
  `PUT` na stronę z otwartym pokojem przechodzi przez pokój, a nie wprost
  do bazy.

- **Rozszerz istniejący `test_role_isolation.py`** zamiast zakładać nowy plik:
  korepetytor B dostaje **404** (nie 403) na tablicę utworzoną przez
  korepetytora A — także wtedy, gdy `student_id` wskazuje ucznia, z którym
  B ma zajęcia (widoczność idzie po `created_by_user_id`, nie po uczniu);
  rola `student` nie ma dostępu do `/api/boards`;
  użytkownik z `must_change_password` nie jest właścicielem tablicy.
- **Istniejące testy auth przechodzą bez zmian** po refaktorze z 5.3 —
  to nie jest nowy plik, to warunek zaliczenia commita 3.

### 8.2 Vitest (`frontend/`)

- **`reconcile.test.js`** — determinizm (ta sama para wejść zawsze ten sam
  wynik), idempotencja (`reconcile(a, a) === a`), niezależność od kolejności
  (scalanie trzech zbiorów w dowolnej kolejności daje ten sam wynik),
  zachowanie elementów z `isDeleted`.

### 8.3 Playwright (`frontend/e2e/`)

- Otwarcie linku w **anonimowym kontekście** (bez ciasteczka sesji): tablica
  się ładuje, nie ma nawigacji panelu, nie ma przycisków właścicielskich.
- Narysowanie czegoś, odświeżenie strony, treść nadal jest.
- Rotacja tokenu w panelu: stary link przestaje działać w tym samym przebiegu.
- Układ mobilny: brak poziomego przewijania strony.
- **Dwa konteksty przeglądarki naraz** (właściciel z ciasteczkiem + gość
  anonimowy) na tej samej stronie tablicy: element narysowany u jednego
  pojawia się u drugiego bez odświeżania; usunięcie propaguje się i nie wraca.
  Uwaga: projekty Playwright w tym repo używają `storageState` admina, więc
  „właścicielem" w E2E jest admin (staff widzi wszystkie tablice — to
  wystarczy). Gość to `browser.newContext()` bez `storageState`.
- **Undo nie cofa cudzej pracy:** gość rysuje, właściciel wciska Ctrl+Z,
  element gościa zostaje. To regresja pilnująca decyzji z 6.5.

---

## 9. Aktualizacja README

`README.md` jest w tym projekcie rzeczywistą dokumentacją, nie ozdobą.
Dopisz:

- nowe wiersze w tabeli **Model danych**,
- rewizję `0013` w **Historii rewizji** — **oraz brakujące `0007`–`0012`**
  (tabela urwała się na `0006`; treść każdej rewizji odczytaj z docstringów
  plików w `backend/alembic/versions/`),
- nowe zmienne w tabeli **Konfiguracja**,
- nowe skrypty w sekcji **Testy**,
- sekcję opisującą moduł tablicy od strony użytkownika (tworzenie, link,
  strony, rotacja, odzysk ze snapshotu),
- wpisy w **Decyzjach projektowych** — w istniejącym stylu (teza pogrubiona,
  potem uzasadnienie): token jako uprawnienie zamiast kont uczniów;
  pliki binarne poza bazą ze względu na Litestream; snapshoty jako jedyna
  obrona przed przypadkowym skasowaniem; `app_state` po stronie klienta;
  scalanie po `version`/`versionNonce` zamiast CRDT przy dwóch–trzech osobach;
  stan pokoju w pamięci procesu i wynikający z tego **wymóg jednego workera**
  uvicorna — ten ostatni wpisz też przy instrukcji wdrożenia, nie tylko
  w decyzjach,
- **jawne `TODO`** (dwa): katalog `BOARD_FILES_PATH` nie jest objęty
  replikacją Litestream i wymaga osobnego backupu; rate limit per IP jest
  za Caddy de facto globalny (5.6).

---

## 10. Kolejność commitów

1. **Migracja i modele.** Rewizja `0013`, cztery tabele, bez endpointów.
   `alembic upgrade head`, `alembic check` i `test_migrations.py` przechodzą.
2. **Router panelu.** `/api/boards` z pełną izolacją ról, `purge` z jawnym
   kasowaniem dzieci, `purge_student` zerujący `student_id` +
   `test_role_isolation.py` rozszerzony + `test_board_token.py`.
3. **Scalanie.** `boards_reconcile.py` jako czysta funkcja
   + `test_board_reconcile.py`. Bez integracji z czymkolwiek. (Przed routerem
   publicznym, bo `PUT` już z niego korzysta.)
4. **Router publiczny, strony.** Refaktor `get_current_user` (5.3),
   `/api/t/{token}`, `PUT` scalający + `test_board_pages.py`; istniejące
   testy auth zielone.
5. **Pokoje i WebSocket.** `boards_rooms.py`, endpoint `/ws`, protokół,
   zapis okresowy, przekierowanie `PUT` przez pokój + `test_board_ws.py`.
6. **Snapshoty.** Reguła 24 h, przywracanie, retencja w zadaniu okresowym
   + `test_board_snapshots.py`.
7. **Pliki.** Upload, serwowanie, quota + `test_board_files.py`
   + zmienne w `.env.example`.
8. **Front: lista tablic.** Trasa `/tablice`, tworzenie, kopiowanie linku,
   rotacja, archiwizacja, sekcja na karcie ucznia.
9. **Front: tablica bez realtime.** Trasa `/t/:token` **przed bramką
   logowania w `App.jsx`**, Excalidraw, lazy, self-hosted assety, strony,
   odczyt i zapis przez HTTP, `ws: true` w Vite.
   Etap sprawdzalny ręcznie, zanim dojdzie warstwa czasu rzeczywistego.
10. **Front: realtime.** WebSocket, `reconcile.js` + Vitest, kursory,
    ponowne łączenie, wskaźnik stanu, izolacja historii undo.
11. **E2E i README.** Playwright (w tym scenariusz dwóch przeglądarek)
    + pełna aktualizacja dokumentacji.

Po każdym commicie: istniejące testy przechodzą, aplikacja startuje.

---

## 11. Pułapki

- **Excalidraw zmienia API między wersjami.** Nazwy propsów, ścieżki assetów,
  sposób importu CSS. Sprawdzaj w zainstalowanej paczce, nie w tutorialach.
- **`isDeleted`** — elementy usunięte zostają w tablicy z flagą. Pominięcie
  tego przy scalaniu powoduje „zmartwychwstawanie" skasowanych rzeczy.
- **dataURL w scenie** — najłatwiejsza droga do wysadzenia bazy i Litestreama.
  Dopisz asercję w teście, że zapisywana scena nie zawiera `data:`.
- **`app_state` na serwerze** — kusi, żeby zapisać całość jednym `PUT`,
  ale wtedy scroll i zoom jednej osoby skaczą drugiej po ekranie.
- **Alembic autogenerate przy SQLite** — zmiana nazwy widziana jest jako
  drop + add, czyli utrata danych. Przejrzyj rewizję.
- **404 kontra 403** przy cudzej tablicy w routerze panelu.
- **`beforeunload` na mobile** bywa nieodpalany. Kluczowy jest
  `visibilitychange`.
- **Historia undo** — patrz 6.5. Najbardziej mylący możliwy błąd.
- **Dwa workery uvicorna** rozdzielą ludzi po różnych pokojach tej samej
  tablicy. Patrz 2.8a.
- **Pokój bez klientów** zostający w słowniku to wyciek pamięci rosnący
  z każdą otwartą tablicą.
- **Ponowne połączenie bez scalenia** — klient wracający po awarii sieci
  nadpisze pracę drugiej osoby swoim starym stanem. Patrz 5.4c.
- **Pętla zwrotna** — `update` z serwera wstawiony przez `updateScene`
  odpala `onChange`, który wysyła to samo z powrotem. Rozpoznawaj elementy
  pochodzące z sieci i nie odsyłaj ich.
- **`PUT` omijający pokój** skasuje pracę osób podłączonych przez WebSocket.
  Patrz 5.4d.
- **`ON DELETE CASCADE` nic nie robi** — SQLite w tym repo nie ma włączonego
  `PRAGMA foreign_keys`. Każdy `purge` kasuje dzieci jawnie. Patrz wstęp
  sekcji 4.
- **`idx` jako tożsamość strony** — po skasowaniu strony pokoje i snapshoty
  wskazywałyby nie tę stronę. Tożsamością jest `board_pages.id`. Patrz 4.2.
- **`get_current_user` w endpoincie WS** — bierze `Request`, którego tam nie
  ma. Rdzeń walidacji musi być funkcją od `(token, db)`. Patrz 5.3.
- **Sesja SQLAlchemy trzymana przez całe połączenie WS** zablokuje resztę
  aplikacji na SQLite. Patrz 5.4b.
- **Bramka logowania w `App.jsx`** stoi przed `<Routes>` — gość zobaczy
  ekran logowania zamiast tablicy. Patrz 6.1.
- **Vite proxy bez `ws: true`** — WebSocket nie przejdzie ani w dev, ani
  w Playwright. Patrz 6.2.
- **Kolejność elementów** — `dict` po stronie serwera gubi z-order; sortuj
  po `index` przy każdym wyjściu stanu na zewnątrz. Patrz 5.4a.
- **Historia rewizji w README** urwała się na `0006`. Nowa migracja to
  `0013`, nie `0007`.

---

## 12. Pytania otwarte

Poniższe mają w planie przyjęte wartości domyślne. Jeśli któraś budzi
wątpliwości przy implementacji — **zapytaj, zanim zrobisz inaczej.**

1. **Czy gość (uczeń) może dodawać strony?** Domyślnie: nie, tylko właściciel.
   Argument za zmianą: uczeń rozwiązujący zadanie sam może chcieć czystej
   kartki bez proszenia.
2. **Czy zalogowany uczeń ma widzieć listę swoich tablic w panelu?**
   Domyślnie: nie. Dostęp wyłącznie przez link.
3. **Czy limit 10 MB na plik jest właściwy?** Zdjęcie zadania z telefonu to
   zwykle 2–5 MB. Rozważ kompresję po stronie klienta przed uploadem — nie jest
   w zakresie etapu 1.
4. **Czy tablica ma mieć limit stron?** Domyślnie: bez limitu. Po roku kursu
   to ~40 stron, co jest do przewinięcia, ale lista w UI będzie długa.
5. **Czy przy archiwizacji tablicy link ma przestać działać?**
   Domyślnie: tak (404). Alternatywa: tryb tylko do odczytu, żeby uczeń
   zachował wgląd w notatki po zakończeniu kursu. **To pytanie rozstrzygnij
   przed commitem 4** — wpływa na kształt `GET /api/t/{token}`, na WS
   (odrzucać `update` czy zamykać) i na testy w `test_board_token.py`;
   dokładanie tego później to przepisywanie trzech miejsc.
6. **Czy właściciel ma mieć tryb „podążaj za mną"** — przeciąganie widoku
   ucznia za swoim scrollem i zoomem? Domyślnie: nie. Przy tablicy z wieloma
   stronami bywa potrzebne („patrz tutaj"), ale wymaga rozszerzenia protokołu
   o wiadomość z viewportem i jest łatwe do dołożenia później.
7. **Czy przełączenie strony przez właściciela ma przełączać ją uczniowi?**
   Domyślnie: nie, każdy przegląda strony niezależnie. Jeśli tak, to jest to
   wariant punktu 6 i powinien wejść razem z nim.

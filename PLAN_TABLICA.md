# Plan wdrożenia: moduł tablicy interaktywnej

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
   jawnie wymienionymi punktami (sekcja 5.3 — zależność opcjonalnego użytkownika).
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

Excalidraw trzyma wklejone obrazki jako base64 dataURL wewnątrz sceny.
**Przed zapisem sceny pliki muszą być z niej wyjęte** i zapisane na dysku pod
nazwą pochodzącą z `sha256`. W scenie zostaje wyłącznie `fileId`.

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

Rejestr pokoi to zwykły słownik w procesie `api`, klucz `(board_id, page_idx)`.
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

- Migracja Alembic `0007` z czterema nowymi tabelami.
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

Migracja: **rewizja `0007`**, Alembic w trybie `batch` (wymagany przez SQLite).

Po `alembic revision --autogenerate` **przejrzyj wygenerowany plik ręcznie
przed uruchomieniem**. Autogenerate bywa gorliwy przy typach `JSON`/`Text`,
a batch mode przebudowuje tabelę.

### 4.1 `boards`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | int PK | |
| `token` | str(32) | UNIQUE, INDEX. `secrets.token_urlsafe(24)` |
| `title` | str | wymagany |
| `student_id` | int FK → `students.id` | **NULL dozwolony** |
| `created_by_user_id` | int FK → `users.id` | nie NULL |
| `created_at` | datetime | |
| `updated_at` | datetime | aktualizowany przy zapisie dowolnej strony |
| `last_opened_at` | datetime NULL | aktualizowany przy `GET /api/t/{token}` |
| `archived_at` | datetime NULL | miękkie usuwanie, konwencja z repo |

`student_id` jest opcjonalne celowo — tablica na lekcję próbną nie wymaga
zakładania rekordu ucznia. Gdy jest ustawione, tablica ma się pokazywać na
karcie ucznia w panelu.

`created_by_user_id` jest potrzebne do izolacji ról (sekcja 5.2): bez niego
nie da się powiedzieć, czyja jest tablica bez przypisanego ucznia.

Token przechowujemy jawnie, nie zahashowany — panel musi móc wyświetlić link
ponownie. Zrzut bazy ujawnia tokeny, ale zrzut bazy ujawnia też wszystko inne.

### 4.2 `board_pages`

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | int PK | |
| `board_id` | int FK → `boards.id` ON DELETE CASCADE | INDEX |
| `idx` | int | pozycja, od 0 |
| `title` | str | domyślnie data utworzenia, np. „2026-09-20" |
| `elements` | JSON | lista elementów Excalidraw, domyślnie `[]` |
| `rev` | int | licznik wersji, start 0, inkrementowany przy zapisie |
| `created_at` | datetime | |
| `updated_at` | datetime | |

**`UniqueConstraint("board_id", "idx")`** — wymuszone przez bazę, nie przez
Pythona. Dwóch klientów tworzących stronę jednocześnie to wyścig; ta sama
zasada co przy `(series_id, origin_date)` w istniejącym kodzie.

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
| `page_idx` | int | |
| `title` | str | tytuł strony w momencie snapshotu |
| `elements` | JSON | |
| `created_at` | datetime | INDEX (do retencji) |

---

## 5. Backend

### 5.1 Struktura

Dwa **fizycznie osobne routery**. To nie jest kosmetyka — router publiczny nie
może mieć żadnej zależności zwracającej zalogowanego użytkownika, żeby nie dało
się przez niego dojść do reszty API.

```
backend/app/routers/boards.py        # /api/boards  — za bramką ról
backend/app/routers/boards_public.py # /api/t       — bez bramki, z rate limitem
backend/app/boards_files.py          # wyjmowanie i zapis plików ze sceny
backend/app/boards_reconcile.py      # czysta funkcja scalania — testowalna osobno
backend/app/boards_rooms.py          # rejestr pokoi w pamięci, broadcast, zapis
```

Prefiks `/api/t` jest celowy: Caddy kieruje `/api/*` do kontenera `api`,
więc **nie trzeba zmieniać `Caddyfile`**. Trasa SPA to `/t/{token}` (bez `/api`)
i obsługuje ją istniejący fallback na `index.html`.

### 5.2 Router panelu — `/api/boards`

Za istniejącą bramką ról. Zakres widoczności:

- `admin`, `secretary` — wszystkie tablice
- `tutor` — tablice, w których `student_id` wskazuje na jego ucznia,
  **lub** `created_by_user_id` to on sam (przypadek tablicy bez ucznia)
- `student` — brak dostępu do tego routera (uczeń korzysta wyłącznie z linku)

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/boards` | lista; parametry `student_id`, `archived` |
| POST | `/api/boards` | body `{title, student_id?}`; generuje token; tworzy pierwszą stronę o `idx=0` |
| GET | `/api/boards/{id}` | metadane + lista stron **bez** `elements` |
| PATCH | `/api/boards/{id}` | body `{title?, student_id?}` |
| POST | `/api/boards/{id}/rotate-token` | nowy token, zwraca nowy link |
| DELETE | `/api/boards/{id}` | archiwizacja (ustawia `archived_at`) |
| DELETE | `/api/boards/{id}/purge` | trwałe usunięcie; **tylko `admin`**, **tylko dla zarchiwizowanej**; kasuje też pliki z dysku |
| GET | `/api/boards/{id}/snapshots` | lista snapshotów, bez `elements` |
| POST | `/api/boards/{id}/snapshots/{snapshot_id}/restore` | przywraca stan strony |

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

Zaimplementuj ją przez wywołanie istniejącej logiki i przechwycenie wyjątku,
albo przez wyodrębnienie wspólnej funkcji. **Nie duplikuj walidacji tokenu** —
dwie kopie tej logiki rozjadą się przy pierwszej zmianie w auth.

Uwaga na `must_change_password`: użytkownik z tą flagą **nie jest**
właścicielem w rozumieniu tablicy. Traktuj go jak gościa.

### 5.4 Router publiczny — `/api/t/{token}`

Bez zależności użytkownika w sygnaturze. Właściciel wykrywany przez
`get_optional_user` + porównanie z regułą widoczności z 5.2.

| Metoda | Ścieżka | Kto | Opis |
|---|---|---|---|
| GET | `/api/t/{token}` | każdy | `{title, is_owner, pages: [{idx, title, rev}]}`; ustawia `last_opened_at` |
| GET | `/api/t/{token}/pages/{idx}` | każdy | `{idx, title, elements, rev}` |
| PUT | `/api/t/{token}/pages/{idx}` | każdy | body `{elements, rev}`; zapis sceny |
| POST | `/api/t/{token}/pages` | właściciel | nowa strona na końcu |
| PATCH | `/api/t/{token}/pages/{idx}` | właściciel | zmiana tytułu |
| DELETE | `/api/t/{token}/pages/{idx}` | właściciel | kasuje stronę i przenumerowuje `idx` |
| POST | `/api/t/{token}/files` | każdy | upload pliku, multipart |
| GET | `/api/t/{token}/files/{file_id}` | każdy | treść pliku |

Nieznany token, token tablicy zarchiwizowanej, nieistniejąca strona → **`404`**,
zawsze ten sam kształt odpowiedzi. Operacja właścicielska wykonana przez
gościa → `403` (tu jest to bezpieczne, bo istnienie tablicy jest już znane).

#### Kontrola kolizji przy `PUT`

1. Klient wysyła `elements` oraz `rev`, na którym bazował.
2. Jeśli `rev` z żądania **równa się** `rev` w bazie: zapisz, `rev += 1`,
   zwróć `{rev}` z nową wartością.
3. Jeśli **nie równa się**: nie zapisuj, zwróć **`409`** z ciałem
   `{rev, elements}` — aktualnym stanem serwera.
4. Klient scala lokalnie (sekcja 6.4) i ponawia **dokładnie raz**. Drugi `409`
   pod rząd to komunikat dla użytkownika, nie pętla.

Przed zapisem sprawdź regułę snapshotu z 2.7.

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

### 5.4b Pokoje — `boards_rooms.py`

Rejestr w pamięci procesu:

```
rooms: dict[tuple[int, int], Room]      # (board_id, page_idx) -> Room
Room: { elements: dict[str, dict], clients: set[Connection], dirty: bool,
        last_saved_at: datetime }
```

Cykl życia pokoju:

- **Pierwsze wejście** — wczytaj `elements` z bazy do `Room.elements`.
- **Ostatnie wyjście** — zapisz, jeśli `dirty`, i usuń pokój ze słownika.
  Pokój bez klientów nie ma prawa zostać w pamięci.
- **Zapis okresowy** — zadanie w tle zapisuje brudne pokoje nie częściej niż
  **co 15 s** (decyzja 2.5). Zapis przechodzi przez tę samą regułę snapshotu
  co `PUT` (decyzja 2.7) i inkrementuje `rev`.

### 5.4c Protokół WebSocketa

Endpoint: `WS /api/t/{token}/ws?page={idx}`.

Autoryzacja: ten sam lookup tokenu co w reszcie routera publicznego.
Nieznany token, tablica zarchiwizowana, nieistniejąca strona → zamknij
połączenie kodem `4404`. Rola właściciela ustalana przez `get_optional_user`
na ciasteczku wysłanym w handshake'u (ten sam origin, więc przeglądarka je
dołączy).

Wiadomości **klient → serwer**:

| `t` | Ciało | Opis |
|---|---|---|
| `update` | `{elements: [...]}` | wyłącznie elementy zmienione od ostatniej wysyłki |
| `pointer` | `{x, y, button}` | pozycja kursora, nie zapisywana nigdzie |
| `hello` | `{name}` | etykieta przy kursorze |

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
- Serwer wysyła ping co 30 s i zamyka połączenia bez odpowiedzi.

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
- `PUT` zostaje jako zapis awaryjny z kontrolą `rev` — gdy WebSocket padnie
  i nie wraca, klient ma czym zapisać pracę zamiast ją stracić.
- Gdy dla strony istnieje otwarty pokój, `PUT` **musi przejść przez ten pokój**
  (scalenie + broadcast), a nie pisać wprost do bazy. Inaczej zapis awaryjny
  jednej osoby skasuje pracę pozostałych.

### 5.5 Pliki

- Limit rozmiaru pojedynczego pliku: **10 MB**, konfigurowalny przez
  `BOARD_MAX_FILE_MB`.
- Whitelist MIME: `image/png`, `image/jpeg`, `image/gif`, `image/webp`,
  `image/svg+xml`. **Typ weryfikuj po zawartości pliku, nie po nagłówku
  z żądania.**
- SVG serwuj z `Content-Disposition: attachment` i
  `Content-Security-Policy: default-src 'none'` — SVG może zawierać skrypt.
- Katalog z `BOARD_FILES_PATH`, domyślnie `/data/board_files`.
- Ścieżkę buduj wyłącznie z wyliczonego `sha256`. Nic pochodzącego od klienta
  nie może trafić do ścieżki na dysku.

**Te pliki nie są objęte Litestreamem.** Dodaj to jako jawny `TODO`
w `README.md` — backup katalogu to osobna sprawa (np. `rclone sync` do B2
w cronie). Nie implementuj tego w etapie 1, ale nie przemilczaj.

### 5.6 Rate limit

`slowapi` na całym routerze publicznym, per IP. Punkt wyjścia:
**120 żądań/min**, `PUT` i `POST` osobno **30/min**.

Nie chodzi o obronę przed zgadywaniem tokenu (192 bity entropii są
nieodgadywalne), tylko o to, żeby skanowanie nie zapychało logów i dysku.

### 5.7 Retencja snapshotów

Kasowanie snapshotów starszych niż 30 dni. Dołóż do istniejącego mechanizmu
zadań okresowych (patrz `POST /api/maintenance/...` i wpis crona w README)
zamiast zakładać nowy. Operacja ma być idempotentna.

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

Na karcie ucznia w panelu dodaj sekcję z jego tablicami (filtr po `student_id`).

### 6.2 Osadzenie Excalidrawa

Instalacja: `npm i @excalidraw/excalidraw` w `frontend/`.

**Zweryfikuj poniższe przy zainstalowanej wersji** — szczegóły zmieniały się
między wydaniami. Sprawdź `node_modules/@excalidraw/excalidraw/` i README paczki,
nie zakładaj na podstawie starszych tutoriali.

1. **Self-hosting assetów.** Domyślnie komponent pobiera fonty i ikony z CDN
   (unpkg). To niespójne z resztą projektu i psuje działanie bez internetu.
   Ustaw `window.EXCALIDRAW_ASSET_PATH` i skopiuj assety z paczki do `public/`
   krokiem w `package.json` (`postinstall` albo `prebuild`). Sprawdź w paczce,
   gdzie dokładnie leżą fonty w tej wersji.
2. **CSS.** Nowsze wersje wymagają osobnego importu arkusza z paczki.
3. **Konfiguracja Vite.** Excalidraw może wymagać wpisu `define` w
   `vite.config.js` (`process.env.IS_PREACT`). Jeśli build lub runtime się
   wywala z błędem o `process`, to jest to.
4. **Lazy loading.** Excalidraw to ok. 1 MB po gzipie. Ładuj obie trasy przez
   `React.lazy` + `Suspense`. Kalendarz, otwierany codziennie, nie ma płacić
   za tablicę otwieraną raz w tygodniu.
5. **Język.** `langCode="pl-PL"`.
6. **`UIOptions`.** Wyłącz elementy prowadzące poza aplikację: „Live
   collaboration", odnośniki do Excalidraw+, eksport do chmury Excalidrawa.
   Zostaw undo/redo, zoom, bibliotekę kształtów.

### 6.3 Cykl życia strony

- **Wejście:** `GET /api/t/{token}` → metadane i lista stron.
  `GET /api/t/{token}/pages/{idx}` → elementy. `app_state` z `localStorage`
  (klucz per token i per `idx`). Pliki: pobierz te, do których odwołuje się
  scena, i wstaw przez API Excalidrawa.
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
- **Nowy plik w scenie:** wykryj `fileId` bez odpowiadającego rekordu, wyślij
  na `POST /api/t/{token}/files`, dopiero potem zapisz scenę. Scena wysyłana
  na serwer **nie może zawierać dataURL** (2.4).
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

Obie implementacje muszą dawać identyczne wyniki. Przy zmianie reguły
w jednej z nich — zmień w obu i zaktualizuj oba zestawy testów.

Reguła: wygrywa wyższy `version`, remis rozstrzyga **niższy** `versionNonce`.

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

Funkcja jest czysta — przetestuj ją w Vitest (sekcja 8.2). W etapie 2 ta sama
reguła przenosi się na serwer bez zmiany semantyki.

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

W `docker-compose.yml` zamontuj wolumen dla `BOARD_FILES_PATH`. Może to być ten
sam wolumen, w którym leży baza — wtedy jeden katalog do backupu.

**Nie zmieniaj:** `Caddyfile`, `CORS_ORIGINS`, domeny, konfiguracji ciasteczka,
`litestream.yml` (pliki binarne nie idą przez Litestream, patrz 5.5).

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
  zgodny `rev` zapisuje i inkrementuje; niezgodny `rev` zwraca 409 **i nie
  zapisuje**; operacje na stronach wykonane przez gościa → 403;
  kasowanie strony przenumerowuje `idx` bez dziur.
- **`test_board_snapshots.py`** — pierwszy zapis po 24 h tworzy snapshot ze
  stanu **sprzed** zapisu; drugi zapis tego samego dnia nie tworzy kolejnego;
  przywrócenie odtwarza treść; retencja kasuje starsze niż 30 dni
  i jest idempotentna.
- **`test_board_files.py`** — plik ponad limit odrzucony; MIME spoza whitelisty
  odrzucony mimo zgodnego nagłówka; dwa identyczne pliki dają jeden plik na
  dysku; ścieżka nie daje się wyjść poza katalog; SVG serwowany z nagłówkami
  bezpieczeństwa.
- **`test_board_reconcile.py`** — funkcja z 5.4a: determinizm; idempotencja
  (`reconcile(stan, te_same_elementy)` zwraca pustą listę zmian);
  niezależność od kolejności (trzy zbiory scalone w dowolnej kolejności dają
  ten sam stan końcowy); element z niższym `version` nie nadpisuje wyższego;
  remis rozstrzygany po `versionNonce`; elementy z `isDeleted` przetrwają.
- **`test_board_ws.py`** — dwa połączenia do tej samej strony (użyj
  `TestClient.websocket_connect`): `update` od pierwszego dociera do drugiego;
  nadawca nie dostaje echa własnej zmiany; połączenie z nieznanym tokenem jest
  zamykane; wiadomość zawierająca `data:` w scenie jest odrzucana;
  po odłączeniu ostatniego klienta stan trafia do bazy i pokój znika z pamięci;
  `PUT` na stronę z otwartym pokojem przechodzi przez pokój, a nie wprost
  do bazy.

- **Rozszerz istniejący `test_role_isolation.py`** zamiast zakładać nowy plik:
  korepetytor B dostaje **404** (nie 403) na tablicę ucznia korepetytora A;
  tablica bez `student_id` widoczna tylko dla twórcy i staff;
  rola `student` nie ma dostępu do `/api/boards`;
  użytkownik z `must_change_password` nie jest właścicielem tablicy.

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
- **Undo nie cofa cudzej pracy:** gość rysuje, właściciel wciska Ctrl+Z,
  element gościa zostaje. To regresja pilnująca decyzji z 6.5.

---

## 9. Aktualizacja README

`README.md` jest w tym projekcie rzeczywistą dokumentacją, nie ozdobą.
Dopisz:

- nowe wiersze w tabeli **Model danych**,
- rewizję `0007` w **Historii rewizji**,
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
- **jawny `TODO`**: katalog `BOARD_FILES_PATH` nie jest objęty replikacją
  Litestream i wymaga osobnego backupu.

---

## 10. Kolejność commitów

1. **Migracja i modele.** Rewizja `0007`, cztery tabele, bez endpointów.
   `alembic upgrade head` i `alembic check` przechodzą.
2. **Router panelu.** `/api/boards` z pełną izolacją ról +
   `test_role_isolation.py` rozszerzony + `test_board_token.py`.
3. **Router publiczny, strony.** `/api/t/{token}`, `get_optional_user`,
   kontrola `rev` + `test_board_pages.py`.
4. **Scalanie.** `boards_reconcile.py` jako czysta funkcja
   + `test_board_reconcile.py`. Bez integracji z czymkolwiek.
5. **Pokoje i WebSocket.** `boards_rooms.py`, endpoint `/ws`, protokół,
   zapis okresowy, przekierowanie `PUT` przez pokój + `test_board_ws.py`.
6. **Snapshoty.** Reguła 24 h, przywracanie, retencja w zadaniu okresowym
   + `test_board_snapshots.py`.
7. **Pliki.** Upload, serwowanie, wyjmowanie ze sceny + `test_board_files.py`
   + wolumen w compose.
8. **Front: lista tablic.** Trasa `/tablice`, tworzenie, kopiowanie linku,
   rotacja, archiwizacja, sekcja na karcie ucznia.
9. **Front: tablica bez realtime.** Trasa `/t/:token`, Excalidraw, lazy,
   self-hosted assety, strony, odczyt i zapis przez HTTP.
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
   zachował wgląd w notatki po zakończeniu kursu.
6. **Czy właściciel ma mieć tryb „podążaj za mną"** — przeciąganie widoku
   ucznia za swoim scrollem i zoomem? Domyślnie: nie. Przy tablicy z wieloma
   stronami bywa potrzebne („patrz tutaj"), ale wymaga rozszerzenia protokołu
   o wiadomość z viewportem i jest łatwe do dołożenia później.
7. **Czy przełączenie strony przez właściciela ma przełączać ją uczniowi?**
   Domyślnie: nie, każdy przegląda strony niezależnie. Jeśli tak, to jest to
   wariant punktu 6 i powinien wejść razem z nim.

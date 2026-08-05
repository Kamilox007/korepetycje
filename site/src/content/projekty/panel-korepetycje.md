---
title: System zarządzania korepetycjami
opis: Aplikacja produkcyjna do terminarza, rozliczeń i kont uczniów. Działa codziennie, na moich własnych danych.
stack: [Python, FastAPI, SQLAlchemy, React, Docker, Caddy]
kolejnosc: 1
---

Prowadzę korepetycje i przez dwa lata rozliczałem je w arkuszu kalkulacyjnym.
Arkusz przestał wystarczać w momencie, w którym pomyliłem się w saldzie ucznia
i zorientowałem się dopiero po trzech tygodniach.

## Decyzje, które okazały się słuszne

**Saldo jest funkcją, nie kolumną.** Nie trzymam pola `balance` w tabeli ucznia —
liczę je jako różnicę sumy lekcji podlegających rozliczeniu i sumy wpłat.
Kolumna rozjechałaby się przy pierwszym błędzie w kodzie i nie byłoby jak tego wykryć.

**Stawka zamrożona na lekcji.** W momencie tworzenia lekcji kopiuję stawkę z profilu
ucznia. Podniesienie ceny we wrześniu nie zmienia wstecz rozliczeń z czerwca.

**Kwoty jako liczby całkowite w groszach.** Nigdy `float`. Zaokrąglanie jawne,
przez `Decimal` z `ROUND_HALF_UP`.

## Decyzje, które musiałem cofnąć

Pierwsza wersja trzymała lekcje cykliczne jako regułę powtarzania i wyliczała
terminy w locie. Wyglądało to elegancko do pierwszego przesunięcia pojedynczych
zajęć — wtedy okazało się, że każdy wyjątek trzeba modelować osobno.

Przepisałem to na materializowanie konkretnych wierszy w bazie.
Przesunięcie terminu jest teraz zwykłym `UPDATE`, a nie logiką wyjątków od reguły.

Druga pomyłka: czas w UTC dla wszystkiego. Poprawne dla znaczników czasu,
ale błędne dla powtarzalności — „co wtorek o 17:00" jest zakotwiczone w czasie
lokalnym. Dodanie siedmiu dób w UTC daje po zmianie czasu godzinę 16:00 albo 18:00.
Cykl rozwijam więc w strefie `Europe/Warsaw`, a dopiero wynik konwertuję.

## Bezpieczeństwo i dane

Uczniowie nie rejestrują się sami — dostają link z tokenem zaproszenia.
Blokada konta po pięciu nieudanych próbach logowania, limit zapytań na adres IP,
wyrównany czas odpowiedzi przy logowaniu (żeby nie dało się wykryć,
które adresy e-mail istnieją w bazie).

Część uczniów to osoby nieletnie, więc dane są przetwarzane w UE,
a wdrożenie objęte umową powierzenia zgodną z art. 28 RODO.

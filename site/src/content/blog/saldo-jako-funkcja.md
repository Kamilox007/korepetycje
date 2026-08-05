---
title: Saldo, którego nie ma w bazie
opis: Dlaczego przechowywanie sumy w kolumnie prawie zawsze kończy się rozjechaniem danych.
data: 2026-08-01
tagi: [bazy danych, projektowanie]
---

Kuszące jest trzymanie salda ucznia w kolumnie. Jeden `SELECT` i mamy wynik,
zero liczenia. Problem pojawia się nie wtedy, gdy kod jest poprawny,
lecz wtedy, gdy przestaje taki być.

## Redundancja bez możliwości weryfikacji

Kolumna `balance` jest zapisem wyniku, który wynika z innych danych:

$$
s = \sum_{i \in L} c_i - \sum_{j \in W} p_j
$$

gdzie $L$ to lekcje podlegające rozliczeniu, a $W$ — wpłaty.
Jeśli przechowuję zarówno składniki, jak i wynik, mam dwa źródła prawdy.
Przy rozbieżności nie ma sposobu, żeby stwierdzić, które jest prawdziwe.

Gorzej: rozbieżność nie zgłasza się sama. Kolumna z błędną wartością
wygląda dokładnie tak samo jak kolumna poprawna.

## Koszt liczenia jest pomijalny

Typowy argument za denormalizacją to wydajność. Sprawdźmy skalę:
dwudziestu uczniów, po sto lekcji rocznie, to dwa tysiące wierszy.
Agregacja po zaindeksowanej kolumnie to ułamek milisekundy.

Optymalizuję coś, co nie jest wąskim gardłem, płacąc za to klasą błędów,
których nie umiem wykryć.

## Kiedy denormalizacja ma sens

Gdy pomiar pokaże, że warto — nie wcześniej. Wtedy właściwym narzędziem
jest widok zmaterializowany, odświeżany w kontrolowany sposób,
a nie kolumna aktualizowana ręcznie w kilkunastu miejscach w kodzie.

Różnica jest zasadnicza: widok da się przebudować od zera z danych źródłowych.
Kolumny, która rozjechała się pół roku temu, nie da się odtworzyć.

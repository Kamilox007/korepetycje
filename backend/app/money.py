"""Kwoty trzymamy w bazie jako liczby całkowite groszy.

Float nie potrafi dokładnie zapisać 0.1, więc sumowanie cen zajęć kumuluje błąd —
przy rozliczeniach z rodzicami kończy się to saldem różniącym się o grosz.
Konwersja odbywa się wyłącznie na granicy API: wewnątrz zawsze int.
"""
from decimal import Decimal, ROUND_HALF_UP


def to_grosze(value) -> int:
    """Złote (float/str/Decimal/int) -> grosze.

    Przez str(), bo Decimal(80.1) to 80.09999999999999431..., a Decimal("80.1")
    to dokładnie 80.1. Zaokrąglenie handlowe (0.5 w górę), nie bankierskie —
    wbudowane round() w Pythonie dałoby round(2.675, 2) == 2.67.
    """
    if value is None:
        return 0
    if isinstance(value, int) and not isinstance(value, bool):
        return value * 100
    d = Decimal(str(value)) * 100
    return int(d.to_integral_value(rounding=ROUND_HALF_UP))


def to_zlote(grosze: int | None) -> float:
    """Grosze -> złote. Wywoływane raz, przy wyjściu z API."""
    if grosze is None:
        return 0.0
    return int(grosze) / 100

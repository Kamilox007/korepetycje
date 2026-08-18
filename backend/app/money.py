"""Amounts are stored in the database as whole grosze (integer minor units).

Float cannot represent 0.1 exactly, so summing lesson prices accumulates error,
and settling up with parents ends with a balance off by a grosz. Conversion
happens only at the API boundary: internally it is always int.
"""
from decimal import Decimal, ROUND_HALF_UP


def to_grosze(value) -> int:
    """Zloty (float/str/Decimal/int) -> grosze.

    Goes through str(), because Decimal(80.1) is 80.09999999999999431... while
    Decimal("80.1") is exactly 80.1. Half-up rounding, not banker's: Python's
    built-in round() would give round(2.675, 2) == 2.67.
    """
    if value is None:
        return 0
    if isinstance(value, int) and not isinstance(value, bool):
        return value * 100
    d = Decimal(str(value)) * 100
    return int(d.to_integral_value(rounding=ROUND_HALF_UP))


def to_zlote(grosze: int | None) -> float:
    """Grosze -> zloty. Called once, on the way out of the API."""
    if grosze is None:
        return 0.0
    return int(grosze) / 100

"""Bank transfer QR payloads, per the ZBP "2D" recommendation (v1.0, 2013).

Polish banking apps scan this and pre-fill the transfer form: account, amount
and title. It is not a payment gateway - nobody is charged automatically, the
payer still confirms in their own bank - but it removes the retyping, which is
where mistakes in the transfer title come from.

Field layout, pipe-separated:

    NIP|PL|NRB|amount|recipient|title|reserve1|reserve2|reserve3

An individual (recipient "type 2" in the recommendation) leaves the NIP empty,
so the payload starts with a separator.
"""
import os
import re
import unicodedata

# The recommendation lists the permitted characters; hyphens and colons are not
# among them, so anything outside this set is dropped rather than passed through
# and risking a bank rejecting the code.
_ALLOWED = re.compile(r"[^A-Za-z0-9 ,./@#&*_ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]")

MAX_RECIPIENT = 20
MAX_TITLE = 32
# Total payload limit from the recommendation.
MAX_PAYLOAD = 160


def _clean(text: str, limit: int) -> str:
    """Strip disallowed characters and cut to the field's length limit."""
    text = _ALLOWED.sub("", (text or "").strip())
    return re.sub(r"\s+", " ", text)[:limit].strip()


def normalize_account(account: str) -> str:
    """Digits only. Accepts spaces and a leading PL, as copied from a bank."""
    acc = re.sub(r"\s+", "", (account or "").upper())
    if acc.startswith("PL"):
        acc = acc[2:]
    return re.sub(r"\D", "", acc)


def valid_account(account: str) -> bool:
    """A Polish NRB is 26 digits and carries its own checksum.

    Worth verifying here: a typo in the configured account would otherwise
    produce codes that send money to nobody, and the app would never notice.
    """
    acc = normalize_account(account)
    if len(acc) != 26:
        return False
    # ISO 7064 mod 97-10. The four leading IBAN characters move to the end:
    # first the country code as digits (P=25, L=21), then the two check digits.
    rearranged = acc[2:] + "2521" + acc[:2]
    return int(rearranged) % 97 == 1


def format_account(account: str) -> str:
    """Group as 00 0000 0000 ... for display."""
    acc = normalize_account(account)
    return " ".join([acc[:2]] + [acc[i:i + 4] for i in range(2, len(acc), 4)])


def normalize_phone(phone: str) -> str:
    """Digits only, dropping a leading +48/48 country code."""
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 11 and digits.startswith("48"):
        digits = digits[2:]
    return digits


def valid_phone(phone: str) -> bool:
    """A Polish mobile number is 9 digits. No checksum to verify, unlike a NRB."""
    return len(normalize_phone(phone)) == 9


def format_phone(phone: str) -> str:
    """Group as XXX XXX XXX for display."""
    digits = normalize_phone(phone)
    return " ".join(digits[i:i + 3] for i in range(0, len(digits), 3))


def build(*, account: str, recipient: str, title: str,
          amount_grosze: int | None, nip: str = "") -> str:
    """Assemble the payload. `amount_grosze=None` lets the payer type the amount."""
    acc = normalize_account(account)
    if len(acc) != 26:
        raise ValueError("Numer rachunku musi mieć 26 cyfr")

    # Six digits, zero padded. All zeros means "let the payer decide", which is
    # what we want when there is nothing outstanding.
    amount = "000000" if not amount_grosze or amount_grosze <= 0 else str(amount_grosze).zfill(6)

    payload = "|".join([
        re.sub(r"\D", "", nip or ""),
        "PL",
        acc,
        amount,
        _clean(recipient, MAX_RECIPIENT),
        _clean(title, MAX_TITLE),
        "", "", "",
    ])
    if len(payload) > MAX_PAYLOAD:
        raise ValueError("Payload przekracza 160 znaków")
    return payload


def configured() -> dict | None:
    """Bank details from the environment, or None when they are not set.

    Kept in configuration rather than the database: there is one recipient for
    the whole installation, and an account number is not the kind of thing that
    should be editable through the web interface.
    """
    account = os.environ.get("BANK_ACCOUNT", "").strip()
    recipient = os.environ.get("BANK_RECIPIENT", "").strip()
    if not account or not recipient:
        return None
    phone = os.environ.get("BANK_BLIK_PHONE", "").strip()
    return {
        "account": normalize_account(account),
        "recipient": recipient,
        "nip": os.environ.get("BANK_NIP", "").strip(),
        "phone": normalize_phone(phone) if valid_phone(phone) else "",
    }

"""Regression for the ZBP 2D transfer payload.

The format is fixed by the recommendation and banks reject codes that stray from
it, so the payload is checked against the examples printed in the document
itself rather than against my reading of the prose.
"""
import sys, pathlib, os

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from app import transfer_code as tc

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


ZBP_ACCOUNT = "92124012340001567890123456"

# --- examples straight out of the recommendation, section 3 ---
check("3.1 business recipient with a fixed amount",
      tc.build(account=ZBP_ACCOUNT, recipient="Odbiorca 1", title="FV 1234/34/2012",
               amount_grosze=1200, nip="1234567890")
      == "1234567890|PL|92124012340001567890123456|001200|Odbiorca 1|FV 1234/34/2012|||")

check("3.2 amount left for the payer to type",
      tc.build(account=ZBP_ACCOUNT, recipient="Odbiorca 1", title="FV 1234/34/2012",
               amount_grosze=None, nip="1234567890")
      == "1234567890|PL|92124012340001567890123456|000000|Odbiorca 1|FV 1234/34/2012|||")

check("3.3 individual recipient, empty NIP",
      tc.build(account=ZBP_ACCOUNT, recipient="Odbiorca 1", title="Przelew ekspress",
               amount_grosze=1200)
      == "|PL|92124012340001567890123456|001200|Odbiorca 1|Przelew ekspress|||")

# --- amount encoding ---
parts = lambda p: p.split("|")
check("amount is six digits, zero padded",
      parts(tc.build(account=ZBP_ACCOUNT, recipient="X", title="Y", amount_grosze=1))[3] == "000001")
check("a large amount is not truncated",
      parts(tc.build(account=ZBP_ACCOUNT, recipient="X", title="Y", amount_grosze=1234567))[3] == "1234567")
check("zero means the payer decides",
      parts(tc.build(account=ZBP_ACCOUNT, recipient="X", title="Y", amount_grosze=0))[3] == "000000")

# --- field limits, which banks enforce ---
long_name = "Bardzo Dluga Nazwa Odbiorcy Ponad Limit"
check("recipient cut to 20 characters",
      len(parts(tc.build(account=ZBP_ACCOUNT, recipient=long_name, title="Y",
                         amount_grosze=100))[4]) <= 20)
long_title = "Korepetycje " + "x" * 60
check("title cut to 32 characters",
      len(parts(tc.build(account=ZBP_ACCOUNT, recipient="X", title=long_title,
                         amount_grosze=100))[5]) <= 32)

# --- character set: hyphens and colons are not in the permitted list ---
payload = tc.build(account=ZBP_ACCOUNT, recipient="Jan Kowalski",
                   title="Korepetycje: Anna-Maria", amount_grosze=100)
check("disallowed characters dropped", ":" not in payload and "-" not in payload)
check("Polish diacritics survive",
      "ł" in tc.build(account=ZBP_ACCOUNT, recipient="X", title="Wpłata",
                      amount_grosze=100))

# --- account handling ---
check("spaces and the PL prefix are stripped",
      tc.normalize_account("PL 92 1240 1234 0001 5678 9012 3456") == ZBP_ACCOUNT)
check("checksum accepts a valid account", tc.valid_account(ZBP_ACCOUNT))
check("checksum rejects a typo", not tc.valid_account("92124012340001567890123457"))
check("checksum rejects a short number", not tc.valid_account("9212401234"))
check("formatted for reading",
      tc.format_account(ZBP_ACCOUNT) == "92 1240 1234 0001 5678 9012 3456")

# --- refuses to build nonsense ---
try:
    tc.build(account="123", recipient="X", title="Y", amount_grosze=100)
    check("a malformed account raises", False)
except ValueError:
    check("a malformed account raises", True)

check("payload stays within the 160 character limit",
      len(tc.build(account=ZBP_ACCOUNT, recipient="X" * 30, title="Y" * 50,
                   amount_grosze=999999)) <= tc.MAX_PAYLOAD)

# --- configuration ---
os.environ.pop("BANK_ACCOUNT", None)
os.environ.pop("BANK_RECIPIENT", None)
check("no configuration means no transfer section", tc.configured() is None)

os.environ["BANK_ACCOUNT"] = "PL 92 1240 1234 0001 5678 9012 3456"
os.environ["BANK_RECIPIENT"] = "Kamil Krzywon"
cfg = tc.configured()
check("configuration is picked up", cfg is not None and cfg["account"] == ZBP_ACCOUNT)

# --- the endpoint, with a student who owes money ---
from datetime import date
from fastapi.testclient import TestClient
from app.main import app

with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})
    c.post("/api/auth/change-password",
           json={"old_password": "admin", "new_password": "TransferTest1"})

    sid = c.post("/api/students", json={"name": "Jan Kowalski", "default_price": 80}).json()["id"]
    lesson = c.post("/api/lessons", json={
        "student_id": sid, "date": str(date.today()),
        "start_time": "16:00:00", "price": 80,
    }).json()
    c.patch(f"/api/lessons/{lesson['id']}", json={"completed": True})

    acc = c.post(f"/api/students/{sid}/account",
                 json={"username": "jan", "password": "StartPassword1"}).json()

with TestClient(app) as s:
    s.post("/api/auth/login", data={"username": "jan", "password": "StartPassword1"})
    s.post("/api/auth/change-password",
           json={"old_password": "StartPassword1", "new_password": "StudentPass1"})

    r = s.get("/api/me/transfer")
    check("student can read transfer details", r.status_code == 200)
    data = r.json()
    check("configured flag set", data["configured"] is True)
    check("amount equals what is owed", data["amount"] == 80.0)
    check("payload carries that amount", data["qr_payload"].split("|")[3] == "008000")
    check("title identifies the student", "Jan Kowalski" in data["title"])
    check("account shown grouped", " " in data["account"])

    # Paying it off should leave nothing to prefill.
    with TestClient(app) as staff:
        staff.post("/api/auth/login", data={"username": "admin", "password": "TransferTest1"})
        staff.post("/api/payments", json={"student_id": sid, "amount": 80, "date": str(date.today())})

    data = s.get("/api/me/transfer").json()
    check("nothing owed leaves the amount open", data["amount"] is None)
    check("payload switches to manual entry", data["qr_payload"].split("|")[3] == "000000")

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

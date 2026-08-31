"""Regression: passwords must satisfy the composition policy (>=10 chars,
one uppercase letter, one digit, one special character) — enforced by every
endpoint that sets a password, not just self-service change."""
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from testing_utils import bootstrap
bootstrap()

from fastapi.testclient import TestClient
from app.main import app
from app import auth

FAILS = []


def check(label, cond):
    print(("  OK   " if cond else "  FAIL ") + label)
    if not cond:
        FAILS.append(label)


# --- the policy function itself ---
check("too short is rejected", auth.password_policy_error("Aa1!aaa") is not None)
check("no uppercase is rejected", auth.password_policy_error("aaaaaaaaa1!") is not None)
check("no digit is rejected", auth.password_policy_error("Aaaaaaaaaa!") is not None)
check("no special character is rejected", auth.password_policy_error("Aaaaaaaaaa1") is not None)
check("a compliant password is accepted", auth.password_policy_error("Aaaaaaaaa1!") is None)

# --- the generator always produces a compliant password ---
check("generate_password() is always policy-compliant",
      all(auth.password_policy_error(auth.generate_password()) is None for _ in range(50)))

with TestClient(app) as c:
    c.post("/api/auth/login", data={"username": "admin", "password": "admin"})

    # --- self-service change (still on the starting password) ---
    r = c.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "nouppercase1!", "accept_privacy": True,
    })
    check("change-password rejects a password with no uppercase letter", r.status_code == 400)

    r = c.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "NoDigitHere!", "accept_privacy": True,
    })
    check("change-password rejects a password with no digit", r.status_code == 400)

    r = c.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "NoSpecialChar1", "accept_privacy": True,
    })
    check("change-password rejects a password with no special character", r.status_code == 400)

    r = c.post("/api/auth/change-password", json={
        "old_password": "admin", "new_password": "CompliantPass1!", "accept_privacy": True,
    })
    check("change-password accepts a compliant password", r.status_code == 200)

    # --- staff creating accounts: no length check at all before this policy existed ---
    r = c.post("/api/users", json={
        "username": "weaktutor", "password": "short1!", "role": "tutor",
    })
    check("create_user rejects a password that is too short", r.status_code == 400)

    r = c.post("/api/users", json={
        "username": "oktutor", "password": "CompliantPass1!", "role": "tutor",
    })
    check("create_user accepts a compliant password", r.status_code == 200)
    tutor_id = r.json()["id"]

    sid = c.post("/api/students", json={"name": "Test Student", "default_price": 80}).json()["id"]
    r = c.post(f"/api/students/{sid}/account", json={
        "username": "weakstudent", "password": "alllowercase1!",
    })
    check("create_student_account rejects a password with no uppercase letter", r.status_code == 400)

    r = c.post(f"/api/students/{sid}/account", json={
        "username": "okstudent", "password": "CompliantPass1!",
    })
    check("create_student_account accepts a compliant password", r.status_code == 200)

    # --- reset-password: an explicit weak password is rejected, the default
    #     auto-generated one is always compliant ---
    r = c.post(f"/api/users/{tutor_id}/reset-password", json={"password": "tooweak"})
    check("reset-password rejects an explicit weak password", r.status_code == 400)

    r = c.post(f"/api/users/{tutor_id}/reset-password")
    check("reset-password with no payload -> 200", r.status_code == 200)
    check("the auto-generated reset password is policy-compliant",
          auth.password_policy_error(r.json()["password"]) is None)

print()
print("FAILURES:", FAILS if FAILS else "none")
sys.exit(1 if FAILS else 0)

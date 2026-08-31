// Password policy, mirrored from backend/app/auth.py's password_policy_error.
// Checked again here purely for immediate feedback — the backend is the real
// gate and re-validates on every endpoint that sets a password.
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_HINT =
  `Co najmniej ${PASSWORD_MIN_LENGTH} znaków, w tym wielka litera, cyfra i znak specjalny.`;

export function passwordError(pw) {
  if (pw.length < PASSWORD_MIN_LENGTH) return `Hasło musi mieć co najmniej ${PASSWORD_MIN_LENGTH} znaków.`;
  if (!/[A-Z]/.test(pw)) return "Hasło musi zawierać co najmniej jedną wielką literę.";
  if (!/[0-9]/.test(pw)) return "Hasło musi zawierać co najmniej jedną cyfrę.";
  if (!/[^A-Za-z0-9]/.test(pw)) return "Hasło musi zawierać co najmniej jeden znak specjalny.";
  return null;
}

const UPPER = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const LOWER = "abcdefghijklmnopqrstuvwxyz";
const DIGITS = "0123456789";
const SPECIALS = "!@#$%^&*-_=+";

// A starting password that always satisfies passwordError. Not meant to be
// memorised — every account it's issued to has must_change_password set,
// forcing a real password at first login.
export function genStartPassword(length = 12) {
  const pick = (s) => s[Math.floor(Math.random() * s.length)];
  const chars = [pick(UPPER), pick(DIGITS), pick(SPECIALS)];
  const pool = UPPER + LOWER + DIGITS + SPECIALS;
  while (chars.length < length) chars.push(pick(pool));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

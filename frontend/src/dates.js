export const DAYS_PL = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];
export const DAYS_SHORT = ["Pon", "Wt", "Śr", "Czw", "Pt", "Sob", "Nd"];
export const DURATION_OPTIONS = [45, 60, 90];
export const MONTHS_PL = [
  "stycznia", "lutego", "marca", "kwietnia", "maja", "czerwca",
  "lipca", "sierpnia", "września", "października", "listopada", "grudnia",
];

// pythonowy weekday: 0=pon ... 6=niedz
export function pyWeekday(d) {
  return (d.getDay() + 6) % 7;
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISO(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

// the Monday of the week containing d
export function startOfWeek(d) {
  const n = new Date(d);
  n.setDate(n.getDate() - pyWeekday(n));
  n.setHours(0, 0, 0, 0);
  return n;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function sameDay(a, b) {
  return toISODate(a) === toISODate(b);
}

export function fmtMoney(v) {
  return new Intl.NumberFormat("pl-PL", {
    style: "currency",
    currency: "PLN",
  }).format(v || 0);
}

export function fmtTime(t) {
  // "16:00:00" -> "16:00"
  return (t || "").slice(0, 5);
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

// month grid: whole weeks (Mon-Sun) covering the entire month
export function monthGrid(d) {
  const first = startOfMonth(d);
  const gridStart = startOfWeek(first);
  const last = endOfMonth(d);
  const cells = [];
  let cur = new Date(gridStart);
  // until we pass the last day of the month and close the final week
  while (cur <= last || pyWeekday(cur) !== 0) {
    cells.push(new Date(cur));
    cur = addDays(cur, 1);
    if (cells.length > 42) break; // bezpiecznik
  }
  return cells;
}

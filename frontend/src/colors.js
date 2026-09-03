// Fixed tutor colour palette: high contrast, legible on a light background
export const TUTOR_COLORS = [
  "#e6194b", // red
  "#3cb44b", // green
  "#4363d8", // blue
  "#f58231", // orange
  "#911eb4", // purple
  "#008080", // teal
  "#e6a700", // gold
  "#f032e6", // pink
  "#9a6324", // brown
  "#469990", // turquoise
  "#3ec6f0", // sky blue / cyan
];

// neutral colour for lessons with no tutor assigned
export const UNASSIGNED_COLOR = "#9b9fab";

// Deterministic colour per student, drawn from the same palette as tutors.
// Not persisted anywhere: just a stable way to tell students apart at a glance
// in the tutor/student calendar, where every lesson used to look identical.
export function colorForStudent(id) {
  if (id == null) return null;
  return TUTOR_COLORS[id % TUTOR_COLORS.length];
}

// lighten a hex colour for use as a background (mix with white)
export function tint(hex, amount = 0.85) {
  if (!hex) return null;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

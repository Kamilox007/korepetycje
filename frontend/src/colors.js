// Gotowa paleta kolorów korepetytorów (kontrastowe, czytelne na jasnym tle)
export const TUTOR_COLORS = [
  "#e6194b", // czerwony
  "#3cb44b", // zielony
  "#4363d8", // niebieski
  "#f58231", // pomarańczowy
  "#911eb4", // fioletowy
  "#008080", // morski
  "#e6a700", // złoty
  "#f032e6", // różowy
  "#9a6324", // brązowy
  "#469990", // turkusowy
];

// kolor neutralny dla zajęć bez przypisanego korepetytora
export const UNASSIGNED_COLOR = "#9b9fab";

// rozjaśnia kolor hex do tła (miesza z bielą)
export function tint(hex, amount = 0.85) {
  if (!hex) return null;
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const mix = (c) => Math.round(c + (255 - c) * amount);
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

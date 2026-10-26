import { describe, it, expect } from "vitest";
import { poprawKoncowki } from "./kreski";

/** Ręcznie pisana „3": start u góry z lewej, dwa brzuszki, koniec na dole z lewej. */
function trojka() {
  const pts = [];
  for (let t = 0; t <= 1.0001; t += 0.04) pts.push([40 * Math.sin(Math.PI * t) + 10 * t, 50 * t]);
  for (let t = 0.04; t <= 1.0001; t += 0.04) pts.push([45 * Math.sin(Math.PI * t), 50 + 50 * t]);
  const [ox, oy] = pts[0];
  return pts.map(([x, y]) => [x - ox, y - oy]);
}

describe("poprawKoncowki", () => {
  it("zwykła kreska zostaje nietknięta", () => {
    expect(poprawKoncowki(trojka())).toBeNull();
  });

  it("„3” z fałszywym ostatnim punktem na starcie traci ten punkt - nie robi się z niej „B”", () => {
    const dobra = trojka();
    const wynik = poprawKoncowki([...dobra, [0, 0]]);
    expect(wynik).not.toBeNull();
    expect(wynik.usunietyKoniec).toBe(true);
    expect(wynik.usunietyPoczatek).toBe(false);
    expect(wynik.points).toEqual(dobra);
    expect(wynik.dx).toBe(0);
    expect(wynik.dy).toBe(0);
  });

  it("fałszywy punkt zgłoszony dwa razy (ruch + oderwanie) też odpada w całości", () => {
    const dobra = trojka();
    const wynik = poprawKoncowki([...dobra, [0, 0], [0, 0]]);
    expect(wynik?.usunietyKoniec).toBe(true);
    expect(wynik.zKonca).toBe(2);           // tyle samo odpada z nacisku rysika
    expect(wynik.points).toEqual(dobra);
  });

  it("powtórzony ostatni punkt bez skoku (rysik odpoczywa na końcu) zostaje", () => {
    const dobra = trojka();
    const ost = dobra[dobra.length - 1];
    expect(poprawKoncowki([...dobra, ost, ost])).toBeNull();
  });

  it("skok w bok na końcu też odpada, nie tylko powrót na start", () => {
    const dobra = trojka();
    const ost = dobra[dobra.length - 1];
    expect(poprawKoncowki([...dobra, [ost[0] + 5, ost[1] - 80]])?.usunietyKoniec).toBe(true);
  });

  it("szybki ruch na końcu w tę samą stronę zostaje - to zamierzony fragment", () => {
    // prosta kreska w prawo, ostatni odcinek długi, ale dalej w prawo
    const pts = Array.from({ length: 20 }, (_, i) => [i * 3, 0]);
    pts.push([57 + 60, 2]);
    expect(poprawKoncowki(pts)).toBeNull();
  });

  it("fałszywy pierwszy punkt odpada, a kreska przesuwa się do nowego początku", () => {
    const dobra = trojka();
    // punkt startowy daleko i pod ostrym kątem do reszty kreski
    const zlyStart = [[-5, 90], ...dobra.map(([x, y]) => [x, y])];
    const [sx, sy] = zlyStart[0];
    const wzgl = zlyStart.map(([x, y]) => [x - sx, y - sy]);
    const wynik = poprawKoncowki(wzgl);
    expect(wynik?.usunietyPoczatek).toBe(true);
    expect(wynik.points[0]).toEqual([0, 0]);
    // element przesuwa się dokładnie tam, gdzie zaczynała się dobra część
    expect(wynik.dx).toBeCloseTo(5);
    expect(wynik.dy).toBeCloseTo(-90);
    expect(wynik.points).toHaveLength(dobra.length);
    wynik.points.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(dobra[i][0]);
      expect(y).toBeCloseTo(dobra[i][1]);
    });
  });

  it("wymiary liczone z poprawionych punktów", () => {
    const wynik = poprawKoncowki([...trojka(), [0, 0]]);
    const xs = wynik.points.map((p) => p[0]), ys = wynik.points.map((p) => p[1]);
    expect(wynik.width).toBeCloseTo(Math.max(...xs) - Math.min(...xs));
    expect(wynik.height).toBeCloseTo(Math.max(...ys) - Math.min(...ys));
  });

  it("kropki i krótkie kreski są pomijane", () => {
    expect(poprawKoncowki([[0, 0]])).toBeNull();
    expect(poprawKoncowki([[0, 0], [1, 1], [2, 2], [30, -40]])).toBeNull();
    expect(poprawKoncowki(undefined)).toBeNull();
  });
});

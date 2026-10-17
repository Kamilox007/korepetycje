import { describe, it, expect } from "vitest";
import { BUILTIN_LIBRARY, isBuiltin } from "./library";

const pozycja = (nazwa) => BUILTIN_LIBRARY.find((i) => i.name === nazwa);
const wszystkieElementy = BUILTIN_LIBRARY.flatMap((i) => i.elements);

describe("wbudowana biblioteka", () => {
  it("tabele 3×3 … 9×9 z numeracją od 1, wiersze i kolumny", () => {
    for (let n = 3; n <= 9; n++) {
      const t = pozycja(`Tabela ${n}×${n}`);
      expect(t, `Tabela ${n}×${n}`).toBeTruthy();
      const liczby = t.elements.filter((e) => e.type === "text").map((e) => e.text);
      const oczekiwane = Array.from({ length: n }, (_, i) => String(i + 1));
      // każda liczba dwa razy: nad kolumną i przed wierszem; zera nie ma
      expect(liczby.sort()).toEqual([...oczekiwane, ...oczekiwane].sort());
      expect(t.elements.filter((e) => e.type === "line")).toHaveLength(2 * (n + 1));
    }
  });

  it("czworokąty: romb, równoległobok, oba trapezy", () => {
    for (const n of ["Romb", "Równoległobok", "Trapez równoramienny", "Trapez prostokątny"]) {
      expect(pozycja(n), n).toBeTruthy();
    }
  });

  it("z chemii zostały pierścienie i szkło laboratoryjne", () => {
    const chemia = ["Pierścień benzenowy", "Cykloheksan", "Probówka", "Zlewka", "Kolba stożkowa"];
    for (const n of chemia) expect(pozycja(n), n).toBeTruthy();
    for (const n of ["Cząsteczka wody", "Klatki orbitalne", "Strzałka reakcji", "Strzałki równowagi",
      "Łańcuch węglowy (zygzak)", "Wiązania: pojedyncze, podwójne, potrójne"]) {
      expect(pozycja(n), n).toBeUndefined();
    }
  });

  it("nowe kształty są zgrupowane - wstawiona tabela przesuwa się w całości", () => {
    for (const nazwa of ["Tabela 9×9", "Romb", "Trapez prostokątny"]) {
      const grupy = new Set(pozycja(nazwa).elements.map((e) => (e.groupIds || []).join(",")));
      expect(grupy.size, nazwa).toBe(1);
      expect([...grupy][0], nazwa).not.toBe("");
    }
  });

  it("stałe, unikalne identyfikatory - inaczej kształty mnożą się przy każdym otwarciu", () => {
    const ids = wszystkieElementy.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(BUILTIN_LIBRARY.map((i) => i.id)).size).toBe(BUILTIN_LIBRARY.length);
    expect(BUILTIN_LIBRARY.every(isBuiltin)).toBe(true);
    // drugi import daje dokładnie te same dane (moduł jest liczony raz, ale
    // nonce/seed nie mogą zależeć od losowania)
    for (const e of wszystkieElementy) {
      expect(Number.isInteger(e.versionNonce) && Number.isInteger(e.seed)).toBe(true);
    }
  });

  it("każdy indeks to poprawny klucz porządkowy Excalidrawa", () => {
    // Pierwszy znak mówi, ile cyfr ma część całkowita ("a" - 1, "b" - 2...);
    // "b9" czy "d1" są za krótkie i Excalidraw rzuca na nich w trakcie rysowania.
    const poprawny = (k) => {
      if (typeof k !== "string" || !/^[0-9A-Za-z]+$/.test(k)) return false;
      const g = k[0];
      if (g >= "a" && g <= "z") return k.length >= g.charCodeAt(0) - 97 + 2;
      if (g >= "A" && g <= "Z") return k.length >= 90 - g.charCodeAt(0) + 2;
      return false;
    };
    for (const item of BUILTIN_LIBRARY) {
      for (const e of item.elements) expect(poprawny(e.index), `${item.name}: ${e.index}`).toBe(true);
      const kolejne = item.elements.map((e) => e.index);
      expect(kolejne).toEqual([...kolejne].sort());
    }
  });
});

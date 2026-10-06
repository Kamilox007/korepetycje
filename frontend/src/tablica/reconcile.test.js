import { describe, it, expect } from "vitest";
import {
  wins, mergeElements, orderByIndex, pendingChanges, markKnown, localWinners, versionKey,
} from "./reconcile";

// Reguła musi być identyczna z backend/app/boards_reconcile.py (i z
// shouldDiscardRemoteElement w Excalidrawie): wyższy version wygrywa, remis
// rozstrzyga NIŻSZY versionNonce. Rozjazd między klientem a serwerem
// objawia się jako dwa ekrany, które cicho pokazują co innego.
const el = (id, version, versionNonce, extra = {}) =>
  ({ id, version, versionNonce, index: "a0", isDeleted: false, ...extra });

describe("wins", () => {
  it("brak bieżącego elementu: przychodzący wygrywa", () => {
    expect(wins(el("a", 1, 1), undefined)).toBe(true);
  });
  it("wyższy version wygrywa niezależnie od nonce", () => {
    expect(wins(el("a", 3, 999), el("a", 2, 1))).toBe(true);
    expect(wins(el("a", 2, 1), el("a", 3, 999))).toBe(false);
  });
  it("remis: niższy versionNonce wygrywa", () => {
    expect(wins(el("a", 2, 10), el("a", 2, 20))).toBe(true);
    expect(wins(el("a", 2, 20), el("a", 2, 10))).toBe(false);
  });
  it("identyczna wersja nie wygrywa (idempotencja)", () => {
    expect(wins(el("a", 2, 10), el("a", 2, 10))).toBe(false);
  });
});

describe("mergeElements", () => {
  it("determinizm: ta sama para wejść daje ten sam wynik", () => {
    const local = [el("a", 1, 1), el("b", 2, 2, { index: "a1" })];
    const remote = [el("a", 2, 5, { x: 1 }), el("c", 1, 1, { index: "a2" })];
    const r1 = mergeElements(local, remote).elements;
    const r2 = mergeElements(local, remote).elements;
    expect(r1).toEqual(r2);
  });

  it("idempotencja: scalenie stanu z samym sobą niczego nie zmienia", () => {
    const local = [el("a", 1, 1), el("b", 2, 2, { index: "a1" })];
    const { elements, accepted } = mergeElements(local, local);
    expect(elements).toEqual(orderByIndex(local));
    expect(accepted).toEqual([]);
  });

  it("niezależność od kolejności: trzy zbiory w dowolnej kolejności dają ten sam stan", () => {
    const batches = [
      [el("a", 1, 10), el("b", 2, 20, { index: "a1", x: 1 })],
      [el("b", 2, 5, { index: "a1", x: 2 }), el("c", 1, 1, { index: "a2" })],
      [el("a", 3, 99, { x: 3 }), el("c", 1, 1, { index: "a2" })],
    ];
    const perms = [
      [0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0],
    ];
    const results = perms.map((p) => {
      let state = [];
      for (const i of p) state = mergeElements(state, batches[i]).elements;
      return state;
    });
    for (const r of results) expect(r).toEqual(results[0]);
    const byId = Object.fromEntries(results[0].map((e) => [e.id, e]));
    expect(byId.a.x).toBe(3);
    expect(byId.b.x).toBe(2);   // remis 2:20 vs 2:5 - niższy nonce
    expect(byId.c).toBeDefined();
  });

  it("elementy isDeleted zostają i nie zmartwychwstają od starszej kopii", () => {
    const local = [el("d", 2, 1, { isDeleted: true })];
    const { elements } = mergeElements(local, [el("d", 1, 1)]);
    expect(elements).toHaveLength(1);
    expect(elements[0].isDeleted).toBe(true);
    const { elements: e2 } = mergeElements([el("d", 1, 1)], [el("d", 2, 1, { isDeleted: true })]);
    expect(e2[0].isDeleted).toBe(true);
  });

  it("rozróżnia przyjęte od odrzuconych", () => {
    const local = [el("a", 5, 1), el("b", 1, 1, { index: "a1" })];
    const { accepted, rejected } = mergeElements(local, [el("a", 1, 1), el("b", 2, 1, { index: "a1" })]);
    expect(accepted.map((e) => e.id)).toEqual(["b"]);
    expect(rejected.map((e) => e.id)).toEqual(["a"]);
  });

  it("element w trakcie edycji nie jest nadpisywany (protectIds)", () => {
    const local = [el("t", 1, 1, { text: "pisze..." })];
    const { elements, rejected } = mergeElements(local, [el("t", 5, 1, { text: "cudze" })], {
      protectIds: new Set(["t"]),
    });
    expect(elements[0].text).toBe("pisze...");
    expect(rejected).toHaveLength(1);
  });

  it("ignoruje śmieci bez id", () => {
    const { elements } = mergeElements([], [{ version: 1 }, { id: "", version: 1 }, el("ok", 1, 1)]);
    expect(elements.map((e) => e.id)).toEqual(["ok"]);
  });
});

describe("orderByIndex", () => {
  it("sortuje po fractional index, remis po id, brak index na koniec", () => {
    const out = orderByIndex([
      el("z", 1, 1, { index: "a2" }), el("y", 1, 1, { index: "a0" }),
      el("w", 1, 1, { index: "a1" }), el("x", 1, 1, { index: "a1" }),
      { id: "n", version: 1, versionNonce: 1 },
    ]);
    expect(out.map((e) => e.id)).toEqual(["y", "w", "x", "z", "n"]);
  });
});

describe("pendingChanges / markKnown / localWinners", () => {
  it("zwraca tylko elementy, których wersja różni się od znanej", () => {
    const known = markKnown(new Map(), [el("a", 1, 1), el("b", 1, 1)]);
    const pending = pendingChanges([el("a", 1, 1), el("b", 2, 1), el("c", 1, 1)], known);
    expect(pending.map((e) => e.id)).toEqual(["b", "c"]);
    markKnown(known, pending);
    expect(pendingChanges([el("a", 1, 1), el("b", 2, 1), el("c", 1, 1)], known)).toEqual([]);
  });

  it("versionKey traktuje brak wersji jak 0", () => {
    expect(versionKey({ id: "x" })).toBe("0:0");
  });

  it("localWinners: po ponownym połączeniu wysyłamy to, co wygrało lokalnie", () => {
    const local = [el("a", 3, 1), el("b", 1, 1), el("c", 1, 1)];
    const server = [el("a", 2, 1), el("b", 2, 1)];
    expect(localWinners(local, server).map((e) => e.id)).toEqual(["a", "c"]);
  });
});

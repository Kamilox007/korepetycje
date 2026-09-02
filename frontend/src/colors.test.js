import { describe, it, expect } from "vitest";
import { TUTOR_COLORS, UNASSIGNED_COLOR, colorForStudent, tint } from "./colors";

describe("TUTOR_COLORS", () => {
  it("holds well-formed hex colours", () => {
    for (const c of [...TUTOR_COLORS, UNASSIGNED_COLOR]) {
      expect(c).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("has no duplicates - two tutors would otherwise share a colour early", () => {
    expect(new Set(TUTOR_COLORS).size).toBe(TUTOR_COLORS.length);
  });

  it("keeps the unassigned grey out of the palette", () => {
    expect(TUTOR_COLORS).not.toContain(UNASSIGNED_COLOR);
  });
});

describe("colorForStudent", () => {
  it("is stable for a given id", () => {
    expect(colorForStudent(7)).toBe(colorForStudent(7));
  });

  it("gives neighbouring ids different colours", () => {
    expect(colorForStudent(3)).not.toBe(colorForStudent(4));
  });

  it("wraps round the palette instead of running off the end", () => {
    const n = TUTOR_COLORS.length;
    expect(colorForStudent(n)).toBe(TUTOR_COLORS[0]);
    expect(colorForStudent(n + 3)).toBe(TUTOR_COLORS[3]);
    expect(colorForStudent(9999)).toBe(TUTOR_COLORS[9999 % n]);
  });

  it("returns nothing when there is no student, rather than a colour for id 0", () => {
    expect(colorForStudent(null)).toBeNull();
    expect(colorForStudent(undefined)).toBeNull();
    expect(colorForStudent(0)).toBe(TUTOR_COLORS[0]);
  });
});

describe("tint", () => {
  it("mixes towards white", () => {
    expect(tint("#000000", 0)).toBe("rgb(0, 0, 0)");
    expect(tint("#000000", 1)).toBe("rgb(255, 255, 255)");
    expect(tint("#ffffff", 0.85)).toBe("rgb(255, 255, 255)");
  });

  it("lightens by default, so text stays readable on top", () => {
    const [r, g, b] = tint("#4363d8").match(/\d+/g).map(Number);
    expect(r).toBeGreaterThan(0x43);
    expect(g).toBeGreaterThan(0x63);
    expect(b).toBeGreaterThan(0xd8);
  });

  it("stays inside the byte range for every palette entry", () => {
    for (const c of TUTOR_COLORS) {
      for (const v of tint(c).match(/\d+/g).map(Number)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    }
  });

  it("passes a missing colour straight through", () => {
    expect(tint(null)).toBeNull();
    expect(tint(undefined)).toBeNull();
  });

  it("accepts a hex with or without the leading hash", () => {
    expect(tint("4363d8")).toBe(tint("#4363d8"));
  });
});

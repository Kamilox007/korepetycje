import { describe, it, expect } from "vitest";
import {
  pyWeekday, toISODate, parseISO, startOfWeek, addDays, sameDay,
  fmtMoney, fmtTime, startOfMonth, endOfMonth, monthGrid, DAYS_PL, DAYS_SHORT,
} from "./dates";

// 2026-01-05 is a Monday, 2026-01-04 the Sunday before it.
const MONDAY = new Date(2026, 0, 5);
const SUNDAY = new Date(2026, 0, 4);

describe("pyWeekday", () => {
  it("counts from Monday, like the backend does", () => {
    expect(pyWeekday(MONDAY)).toBe(0);
    expect(pyWeekday(SUNDAY)).toBe(6);
  });

  it("indexes the day-name tables", () => {
    expect(DAYS_PL[pyWeekday(MONDAY)]).toBe("Poniedziałek");
    expect(DAYS_SHORT[pyWeekday(SUNDAY)]).toBe("Nd");
    expect(DAYS_PL).toHaveLength(7);
    expect(DAYS_SHORT).toHaveLength(7);
  });
});

describe("toISODate", () => {
  it("zero-pads month and day", () => {
    expect(toISODate(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  // The whole reason this exists instead of toISOString().slice(0, 10): that
  // converts to UTC first, so an evening date east of Greenwich comes back as
  // the day before and the lesson lands in the wrong calendar cell.
  it("reads the local date, not the UTC one", () => {
    expect(toISODate(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(toISODate(new Date(2026, 0, 5, 0, 1))).toBe("2026-01-05");
  });
});

describe("parseISO", () => {
  it("round-trips with toISODate", () => {
    expect(toISODate(parseISO("2026-03-09"))).toBe("2026-03-09");
  });

  it("builds a local midnight, so the day is not shifted by the timezone", () => {
    const d = parseISO("2026-03-09");
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 2, 9]);
    expect([d.getHours(), d.getMinutes()]).toEqual([0, 0]);
  });
});

describe("startOfWeek", () => {
  it("returns the Monday of that week", () => {
    expect(toISODate(startOfWeek(new Date(2026, 0, 8)))).toBe("2026-01-05");
  });

  it("treats Sunday as the end of the week, not the start", () => {
    expect(toISODate(startOfWeek(SUNDAY))).toBe("2025-12-29");
  });

  it("is idempotent and clears the time", () => {
    const once = startOfWeek(new Date(2026, 0, 8, 17, 30));
    expect(once.getHours()).toBe(0);
    expect(toISODate(startOfWeek(once))).toBe(toISODate(once));
  });

  it("does not modify the date it was given", () => {
    const d = new Date(2026, 0, 8);
    startOfWeek(d);
    expect(toISODate(d)).toBe("2026-01-08");
  });
});

describe("addDays", () => {
  it("crosses month and year boundaries", () => {
    expect(toISODate(addDays(new Date(2026, 0, 30), 3))).toBe("2026-02-02");
    expect(toISODate(addDays(new Date(2026, 11, 31), 1))).toBe("2027-01-01");
  });

  it("goes backwards too, and leaves the original alone", () => {
    const d = new Date(2026, 2, 1);
    expect(toISODate(addDays(d, -1))).toBe("2026-02-28");
    expect(toISODate(d)).toBe("2026-03-01");
  });
});

describe("sameDay", () => {
  it("compares the day, ignoring the time", () => {
    expect(sameDay(new Date(2026, 0, 5, 8), new Date(2026, 0, 5, 22))).toBe(true);
    expect(sameDay(new Date(2026, 0, 5), new Date(2026, 0, 6))).toBe(false);
  });
});

describe("fmtTime", () => {
  it("drops the seconds the API sends", () => {
    expect(fmtTime("16:00:00")).toBe("16:00");
    expect(fmtTime("09:30")).toBe("09:30");
  });

  it("survives a missing value instead of throwing", () => {
    expect(fmtTime(null)).toBe("");
    expect(fmtTime(undefined)).toBe("");
  });
});

describe("fmtMoney", () => {
  it("formats zloty amounts", () => {
    const out = fmtMoney(80.5);
    expect(out).toMatch(/80/);
    expect(out).toMatch(/zł/);
  });

  it("shows a missing amount as zero rather than NaN", () => {
    expect(fmtMoney(null)).toBe(fmtMoney(0));
    expect(fmtMoney(undefined)).toBe(fmtMoney(0));
    expect(fmtMoney(null)).not.toMatch(/NaN/);
  });

  it("keeps a negative balance negative", () => {
    expect(fmtMoney(-80)).toMatch(/-|−/);
  });
});

describe("startOfMonth / endOfMonth", () => {
  it("brackets the month", () => {
    expect(toISODate(startOfMonth(new Date(2026, 1, 17)))).toBe("2026-02-01");
    expect(toISODate(endOfMonth(new Date(2026, 1, 17)))).toBe("2026-02-28");
  });

  it("knows how long each month is", () => {
    expect(toISODate(endOfMonth(new Date(2024, 1, 3)))).toBe("2024-02-29"); // leap year
    expect(toISODate(endOfMonth(new Date(2026, 3, 3)))).toBe("2026-04-30");
  });
});

describe("monthGrid", () => {
  // February 2026 starts on a Sunday and ends on a Saturday - the worst case,
  // where the grid has to reach back into January and forward into March.
  const grid = monthGrid(new Date(2026, 1, 15));

  it("starts on a Monday and holds whole weeks", () => {
    expect(pyWeekday(grid[0])).toBe(0);
    expect(grid.length % 7).toBe(0);
  });

  it("covers the whole month", () => {
    expect(grid.map(toISODate)).toContain("2026-02-01");
    expect(grid.map(toISODate)).toContain("2026-02-28");
  });

  it("pads with the neighbouring months rather than leaving holes", () => {
    expect(toISODate(grid[0])).toBe("2026-01-26");
    expect(toISODate(grid[grid.length - 1])).toBe("2026-03-01");
  });

  it("runs consecutively, one day per cell", () => {
    for (let i = 1; i < grid.length; i++) {
      expect(toISODate(grid[i])).toBe(toISODate(addDays(grid[i - 1], 1)));
    }
  });

  it("never exceeds six weeks, whichever month it is asked for", () => {
    for (let m = 0; m < 12; m++) {
      const cells = monthGrid(new Date(2026, m, 1));
      expect(cells.length).toBeLessThanOrEqual(42);
      expect(cells.length % 7).toBe(0);
      expect(pyWeekday(cells[0])).toBe(0);
    }
  });

  it("handles a month that already begins on a Monday", () => {
    const june = monthGrid(new Date(2026, 5, 10)); // 2026-06-01 is a Monday
    expect(toISODate(june[0])).toBe("2026-06-01");
  });
});

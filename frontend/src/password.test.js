import { describe, it, expect } from "vitest";
import { passwordError, genStartPassword, PASSWORD_MIN_LENGTH, PASSWORD_HINT } from "./password";

// These mirror backend/app/auth.py (MIN_PASSWORD_LENGTH, password_policy_error).
// If the backend policy is tightened and this file is not, the form accepts a
// password the server then rejects, and the user sees a Polish error out of
// nowhere - so the rules are asserted here explicitly, not just sampled.
describe("passwordError", () => {
  it("accepts a password that meets every rule", () => {
    expect(passwordError("PoprawneHaslo1!")).toBeNull();
  });

  it("requires ten characters", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(passwordError("Abc123!xy")).not.toBeNull();   // 9
    expect(passwordError("Abc123!xyz")).toBeNull();      // 10
  });

  it("requires an uppercase letter", () => {
    expect(passwordError("bezwielkiej1!")).toMatch(/wielk/);
  });

  it("requires a digit", () => {
    expect(passwordError("BezCyfryTutaj!")).toMatch(/cyfr/);
  });

  it("requires a special character", () => {
    expect(passwordError("BezZnaku12345")).toMatch(/specjaln/);
  });

  it("reports the length first, so one message at a time", () => {
    // fails all four rules at once
    expect(passwordError("abc")).toMatch(/10 znaków/);
  });

  it("counts anything outside [A-Za-z0-9] as special, the same regex the backend uses", () => {
    expect(passwordError("HasloDobre1ł")).toBeNull();
    expect(passwordError("Haslo Dobre1")).toBeNull(); // a space qualifies
  });

  it("does not choke on an empty field", () => {
    expect(passwordError("")).toMatch(/10 znaków/);
  });

  it("names the length in the hint shown next to the field", () => {
    expect(PASSWORD_HINT).toContain(String(PASSWORD_MIN_LENGTH));
  });
});

describe("genStartPassword", () => {
  it("always produces something the policy accepts", () => {
    // Generated at random: one sample proves nothing, so run it enough times
    // that a missing character class would have to show up.
    for (let i = 0; i < 500; i++) {
      const pw = genStartPassword();
      expect(passwordError(pw), `rejected: ${pw}`).toBeNull();
    }
  });

  it("defaults to twelve characters and honours a longer request", () => {
    expect(genStartPassword()).toHaveLength(12);
    expect(genStartPassword(20)).toHaveLength(20);
  });

  it("still satisfies the policy at the shortest allowed length", () => {
    for (let i = 0; i < 100; i++) {
      expect(passwordError(genStartPassword(PASSWORD_MIN_LENGTH))).toBeNull();
    }
  });

  it("uses only characters that survive a copy-paste", () => {
    for (let i = 0; i < 100; i++) {
      expect(genStartPassword()).toMatch(/^[A-Za-z0-9!@#$%^&*\-_=+]+$/);
    }
  });

  it("does not park the required characters in fixed positions", () => {
    // Without the shuffle every generated password would start with an
    // uppercase letter, a digit and a special character in that order.
    const firsts = new Set();
    for (let i = 0; i < 200; i++) firsts.add(genStartPassword()[0]);
    expect(firsts.size).toBeGreaterThan(5);
  });

  it("does not repeat itself", () => {
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(genStartPassword());
    expect(seen.size).toBe(200);
  });
});

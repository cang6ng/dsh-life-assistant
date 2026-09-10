/**
 * Appearance preference (UI Spec §18 as amended by v1.0.4). Pure decision
 * table + the storage accessors — no jsdom in this repo (contract §48), which
 * is fine here because every rule that can be wrong is a pure function. The
 * two accessors are exercised *outside* a browser on purpose: that is the
 * "no localStorage" host, and they must degrade rather than throw.
 */

import { describe, expect, it } from "vitest";
import {
  THEME_KEY,
  nextPreference,
  parseThemePreference,
  readThemePreference,
  resolveScheme,
  writeThemePreference,
  type Scheme,
  type ThemePreference,
  type ThemeStorage,
} from "../apps/desktop/src/store/themePreference";

function fakeStorage(initial: Record<string, string> = {}): ThemeStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] as string) : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const throwingStorage: ThemeStorage = {
  getItem: () => {
    throw new Error("SecurityError");
  },
  setItem: () => {
    throw new Error("QuotaExceededError");
  },
};

const PREFERENCES: ThemePreference[] = ["system", "light", "dark"];
const SCHEMES: Scheme[] = ["light", "dark"];

describe("parseThemePreference — anything unrecognised is 追随系统", () => {
  it("keeps the two explicit choices", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
  });

  it("accepts the explicit system choice", () => {
    expect(parseThemePreference("system")).toBe("system");
  });

  it("falls back to system for a missing key", () => {
    expect(parseThemePreference(null)).toBe("system");
  });

  it("falls back for empty, corrupt or foreign values", () => {
    // A key written by another app, a truncated write, a hand-edited value —
    // none of them may strand the user on a scheme they did not pick.
    for (const raw of ["", " ", "DARK", "Dark", "true", "1", "null", "nope"]) {
      expect(parseThemePreference(raw), raw).toBe("system");
    }
  });
});

describe("resolveScheme — an explicit choice ignores the OS entirely", () => {
  it("follows the system only while the preference is system", () => {
    expect(resolveScheme("system", "light")).toBe("light");
    expect(resolveScheme("system", "dark")).toBe("dark");
  });

  it("returns the explicit choice whatever the system says", () => {
    for (const scheme of SCHEMES) {
      expect(resolveScheme("light", scheme)).toBe("light");
      expect(resolveScheme("dark", scheme)).toBe("dark");
    }
  });
});

describe("nextPreference — the toggle never lands on what is on screen", () => {
  it("always flips the rendered scheme", () => {
    for (const preference of PREFERENCES) {
      for (const system of SCHEMES) {
        const shown = resolveScheme(preference, system);
        const next = nextPreference(preference, system);
        // Load-bearing: derived from the *resolved* scheme, not from the
        // preference, so pressing the button while following the system still
        // does the obvious thing instead of appearing to do nothing.
        expect(resolveScheme(next, system), `${preference}/${system}`).not.toBe(shown);
        expect(next).not.toBe("system");
      }
    }
  });

  it("leaves 追随系统 for an explicit choice, in the right direction", () => {
    expect(nextPreference("system", "light")).toBe("dark");
    expect(nextPreference("system", "dark")).toBe("light");
  });

  it("is an involution on the resolved scheme", () => {
    for (const system of SCHEMES) {
      const once = nextPreference("system", system);
      const twice = nextPreference(once, system);
      expect(resolveScheme(twice, system)).toBe(resolveScheme("system", system));
    }
  });
});

describe("storage accessors survive every way storage can be unavailable", () => {
  it("reads 追随系统 when there is no storage at all", () => {
    expect(readThemePreference(null)).toBe("system");
  });

  it("reads 追随系统 from an empty store — the untouched first run", () => {
    expect(readThemePreference(fakeStorage())).toBe("system");
  });

  it("round-trips an explicit choice", () => {
    const storage = fakeStorage();
    writeThemePreference(storage, "dark");
    expect(storage.data[THEME_KEY]).toBe("dark");
    expect(readThemePreference(storage)).toBe("dark");
    writeThemePreference(storage, "light");
    expect(readThemePreference(storage)).toBe("light");
  });

  it("writes the explicit system choice rather than deleting the key", () => {
    // Re-picking 追随系统 must be representable: if it deleted the key, a
    // user who chose it could not be told apart from one who never chose.
    const storage = fakeStorage();
    writeThemePreference(storage, "system");
    expect(readThemePreference(storage)).toBe("system");
  });

  it("survives a storage that throws on both accessors", () => {
    expect(readThemePreference(throwingStorage)).toBe("system");
    expect(() => writeThemePreference(throwingStorage, "dark")).not.toThrow();
  });

  it("reads a corrupt value as 追随系统 rather than crashing the boot", () => {
    expect(readThemePreference(fakeStorage({ [THEME_KEY]: "  " }))).toBe("system");
    expect(readThemePreference(fakeStorage({ [THEME_KEY]: "darkish" }))).toBe("system");
  });
});

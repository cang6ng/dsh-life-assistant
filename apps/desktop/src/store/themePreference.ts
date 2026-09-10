/**
 * The appearance preference (UI Spec §18 as amended by v1.0.4).
 *
 * DOM-free on purpose. The root `tsconfig.json` excludes `apps/desktop/src`,
 * but it still typechecks whatever a node test imports — and this module is
 * imported by `tests/desktop-theme-preference.test.ts`, with no DOM lib in
 * scope. So the storage is a parameter (`ThemeStorage`), not `window`: the
 * whole decision table *and* the failure paths are then testable under plain
 * node, which is the only test environment this repo has.
 *
 * This is the ONLY client-side persisted value in the app. It is a display
 * preference: it holds no identity, no credential and no server state, and
 * losing it degrades to `system` — i.e. exactly the behaviour every version
 * up to v1.0.3 shipped with (§18's original "Follow System").
 */

export type ThemePreference = "system" | "light" | "dark";
export type Scheme = "light" | "dark";

/**
 * The slice of Web Storage this module needs, structurally typed so the
 * module never names `Storage` (a DOM type). `null` stands for "no storage
 * available" — private mode, a denied origin, or a non-browser host.
 */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The storage key. It is duplicated in `apps/desktop/index.html`, whose
 * pre-paint script cannot import this module — a test pins the two copies
 * together so they cannot drift.
 */
export const THEME_KEY = "chinook.theme";

/** Anything that is not an explicit choice is `system` — including a corrupt,
 *  empty or foreign value, so a broken key can never strand the app on a
 *  scheme the user did not pick. */
export function parseThemePreference(raw: string | null): ThemePreference {
  return raw === "light" || raw === "dark" ? raw : "system";
}

/** The scheme to render: an explicit preference ignores the OS entirely, so
 *  choosing 亮色/暗色 is immune to later `prefers-color-scheme` events. */
export function resolveScheme(preference: ThemePreference, system: Scheme): Scheme {
  return preference === "system" ? system : preference;
}

/** What the one-click toggle selects: the opposite of what is on screen.
 *  Deliberately derived from the *resolved* scheme rather than from the
 *  preference — while following the system there is no preference to invert,
 *  and the button must still do the obvious thing. */
export function nextPreference(current: ThemePreference, system: Scheme): ThemePreference {
  return resolveScheme(current, system) === "dark" ? "light" : "dark";
}

/** Never throws: a storage failure is a session-only choice, not a crash. */
export function readThemePreference(storage: ThemeStorage | null): ThemePreference {
  try {
    return parseThemePreference(storage === null ? null : storage.getItem(THEME_KEY));
  } catch {
    return "system";
  }
}

/** Never throws, for the same reason. */
export function writeThemePreference(storage: ThemeStorage | null, preference: ThemePreference): void {
  try {
    storage?.setItem(THEME_KEY, preference);
  } catch {
    /* private mode / quota — the choice just does not survive a restart. */
  }
}

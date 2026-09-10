/**
 * Theme assembly (UI Spec §18/§19.1). Fluent web-light/web-dark + one brand
 * ramp override "Chinook Warm". The three allowed stops are #C2410C (base),
 * #A3360A (light hover) and #FF9E73 (dark active). Tints derive via
 * `color-mix` with an allowed stop — no other hex appears anywhere in code.
 */

import { createDarkTheme, createLightTheme, type BrandVariants, type Theme } from "@fluentui/react-components";

/** Chinook Warm ramp, 10…160. The binding stops: 80=#C2410C, 60≈#A3360A, 130=#FF9E73. */
export const chinookBrand: BrandVariants = {
  10: "#2D0A00",
  20: "#461400",
  30: "#5E1D00",
  40: "#752700",
  50: "#8D3103",
  60: "#A3360A", // light hover
  70: "#B23C0C",
  80: "#C2410C", // base
  90: "#D25522",
  100: "#E0683A",
  110: "#EC7C4F",
  120: "#F79066",
  130: "#FF9E73", // dark active
  140: "#FFB795",
  150: "#FFCFB8",
  160: "#FFE5D9",
};

export interface ThemeTokens extends Theme {
  chinookUserBubbleBg: string;
}

/**
 * The accent the shell publishes as `--chinook-accent` (§19.1's two allowed
 * stops for it): the base tone on light, the active tone on dark. It lives
 * here rather than in app.tsx so the ramp has exactly one home — the theme
 * host used to spell these two hexes out again.
 */
export const CHINOOK_ACCENT: Record<"light" | "dark", string> = {
  light: chinookBrand[80], // #C2410C
  dark: chinookBrand[130], // #FF9E73
};

function withCustom(base: Theme, userBubble: string): ThemeTokens {
  const tokens = base as ThemeTokens;
  tokens.chinookUserBubbleBg = userBubble;
  return tokens;
}

export function buildLightTheme(): ThemeTokens {
  const base = createLightTheme(chinookBrand);
  // Brand overrides: base/hover/pressed stops + the few accent roles the spec
  // budget allows (brand dot, send button, links, streaming caret).
  base.colorBrandBackground = chinookBrand[80];
  base.colorBrandBackgroundHover = chinookBrand[60];
  base.colorBrandBackgroundPressed = chinookBrand[50];
  base.colorBrandForeground1 = chinookBrand[60];
  base.colorBrandForeground2 = chinookBrand[80];
  base.colorBrandBackground2 = "color-mix(in srgb, #C2410C 12%, transparent)";
  // §6.4/§10.4 code face is Consolas, not Fluent's Cascadia default.
  base.fontFamilyMonospace = "Consolas, 'Courier New', monospace";
  // The custom property value is assigned by the theme host (app.tsx), so the
  // mix can reference the Fluent runtime var --colorNeutralBackground1.
  return withCustom(base, "color-mix(in srgb, #C2410C 12%, var(--colorNeutralBackground1))");
}

export function buildDarkTheme(): ThemeTokens {
  const base = createDarkTheme(chinookBrand);
  // Dark: active tone #FF9E73 carries the brand roles; on-brand foreground
  // flips to a dark warm stop so filled controls keep contrast.
  base.colorBrandBackground = chinookBrand[130];
  base.colorBrandBackgroundHover = chinookBrand[140];
  base.colorBrandBackgroundPressed = chinookBrand[120];
  base.colorBrandForeground1 = "#FF9E73";
  base.colorBrandForeground2 = "#FFB795";
  base.colorBrandBackground2 = "color-mix(in srgb, #FF9E73 18%, transparent)";
  base.colorNeutralForegroundOnBrand = chinookBrand[10];
  base.fontFamilyMonospace = "Consolas, 'Courier New', monospace";
  return withCustom(base, "color-mix(in srgb, #FF9E73 18%, var(--colorNeutralBackground1))");
}

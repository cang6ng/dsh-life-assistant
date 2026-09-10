/**
 * Named motion definitions (§21).
 *
 * Everything here is a Fluent *presence component* — a WAAPI-driven animation
 * built by `createPresenceComponent` — rather than a griffel `transition`.
 * That is not a style preference: the Fluent Drawer animates its own surface
 * through WAAPI, and a CSS `transition` on the same element cannot override it
 * (they would both write the same properties, with the animation winning).
 * Going through the same mechanism is the only way to change the timing.
 *
 * §21's numbers are what these definitions exist to hold:
 *
 *   Drawer open/close       200 ms translateX + opacity ease-out
 *   Tool row state flip     150 ms opacity cross-fade
 *   Session switch fade     150 ms opacity 0.4 → 1
 *   Streaming caret         400 ms opacity blink (steady under reduced motion)
 *
 * 200 ms is `motionTokens.durationNormal`. Fluent's own drawer motions are
 * keyed off the drawer `size` and start at `durationGentle` (250 ms), so the
 * default overshoots §21 by 50 ms — hence a definition of our own.
 *
 * Only the drawer is a presence component. The other three animate an element
 * that never unmounts, on a class toggle or an infinite loop; a presence
 * component has no hook for either (`enter`/`exit` fire on appear/unappear).
 * They are griffel `animationName` keyframes objects instead, which griffel
 * compiles into its own `@keyframes` bucket. That form is why this file no
 * longer needs a helper: the app previously injected a `<style>` element into
 * `document.head` and referenced the animation by name from it, and these
 * definitions remove the last hand-written CSS from the client.
 */

import { createElement, type ComponentProps } from "react";
import { createPresenceComponent, motionTokens, type GriffelStyle } from "@fluentui/react-components";

/**
 * The custom property Fluent's Drawer uses for its own width. The off-screen
 * keyframe is expressed in terms of it, so the slide distance and the surface
 * width can never disagree — including when the width is overridden.
 */
const DRAWER_SIZE_VAR = "--fui-Drawer--size";

/** Where the surface starts before it slides in, per its edge and direction. */
function offscreenTransform(position: string, dir: string): string {
  const toPositiveX = `translate3d(var(${DRAWER_SIZE_VAR}), 0, 0)`;
  const toNegativeX = `translate3d(calc(var(${DRAWER_SIZE_VAR}) * -1), 0, 0)`;
  switch (position) {
    case "start":
      return dir === "rtl" ? toPositiveX : toNegativeX;
    case "end":
      return dir === "rtl" ? toNegativeX : toPositiveX;
    case "bottom":
      return `translate3d(0, var(${DRAWER_SIZE_VAR}), 0)`;
    default:
      return "translate3d(0, 0, 0)";
  }
}

/**
 * A drawer's slide (§21): 200 ms translateX + opacity, ease-out on the way in
 * and its mirror on the way out — the same keyframe pair Fluent ships, at
 * §21's duration instead of the size-derived default.
 *
 * Used by both drawers: the activity drawer (§12.4, from the end edge) and the
 * narrow-window sidebar overlay (§22, from the start edge).
 */
export const ChinookDrawerMotion = createPresenceComponent<{ position: string; dir: string }>(
  ({ position, dir }) => {
    const keyframes = [
      { transform: offscreenTransform(position, dir), opacity: 0 },
      { transform: "translate3d(0, 0, 0)", opacity: 1 },
    ];
    return {
      enter: {
        keyframes,
        duration: motionTokens.durationNormal,
        easing: motionTokens.curveDecelerateMid,
      },
      exit: {
        keyframes: [...keyframes].reverse(),
        duration: motionTokens.durationNormal,
        easing: motionTokens.curveAccelerateMin,
      },
    };
  },
);

/**
 * The value both drawers pass as `surfaceMotion`.
 *
 * The render-function form is what makes this take effect — a bare component
 * is silently ignored, because the slot has to hand the motion component the
 * surface element (as `children`) and the runtime params (`visible`,
 * `position`, `dir`, `appear`, …). `_Default` is Fluent's own drawer motion,
 * discarded: using it would restore the 250 ms timing §21 overrides.
 *
 * Written with `createElement` rather than JSX so this module stays a `.ts`
 * file — the definitions here are plain data as far as React is concerned.
 */
export const DRAWER_SURFACE_MOTION = {
  children: (_Default: unknown, props: ComponentProps<typeof ChinookDrawerMotion>) =>
    createElement(ChinookDrawerMotion, props),
};

/**
 * The 设置 dialog's surface (§21 for the new modal surface).
 *
 * Fluent's own `DialogSurfaceMotion` is the `Scale` variant — scale out at
 * 0.85 plus a fade — but pinned to `durationGentle` (250 ms) on both legs, and
 * its backdrop (`FadeRelaxed`) likewise. §21's table has no row for a modal
 * surface, so leaving the default would have made 250 the one number in an app
 * whose vocabulary is otherwise 150/200/400 — and this dialog replaced a
 * hand-rolled overlay that §21 did cover at 200. The geometry below is
 * Fluent's (`Scale`'s two atoms, in its order); only the duration moves.
 *
 * Both slots take the same `{children}` render-function form as the drawer,
 * and for the same reason: the slot has to hand the motion component the
 * element and the runtime params (`visible`, `appear`).
 */
export const ChinookDialogMotion = createPresenceComponent(() => ({
  enter: [
    {
      keyframes: [{ scale: 0.85 }, { scale: 1 }],
      duration: motionTokens.durationNormal,
      easing: motionTokens.curveDecelerateMid,
    },
    {
      keyframes: [{ opacity: 0 }, { opacity: 1 }],
      duration: motionTokens.durationNormal,
      easing: motionTokens.curveDecelerateMid,
    },
  ],
  exit: [
    {
      keyframes: [{ scale: 1 }, { scale: 0.85 }],
      duration: motionTokens.durationNormal,
      easing: motionTokens.curveAccelerateMin,
    },
    {
      keyframes: [{ opacity: 1 }, { opacity: 0 }],
      duration: motionTokens.durationNormal,
      easing: motionTokens.curveAccelerateMin,
    },
  ],
}));

/** The dialog's dimming scrim: Fluent's plain fade, at §21's 200 ms. */
export const ChinookBackdropMotion = createPresenceComponent(() => ({
  enter: {
    keyframes: [{ opacity: 0 }, { opacity: 1 }],
    duration: motionTokens.durationNormal,
    easing: motionTokens.curveEasyEase,
  },
  exit: {
    keyframes: [{ opacity: 1 }, { opacity: 0 }],
    duration: motionTokens.durationNormal,
    easing: motionTokens.curveEasyEase,
  },
}));

/** Passed as `Dialog`'s `surfaceMotion` / `DialogSurface`'s `backdropMotion`. */
export const DIALOG_SURFACE_MOTION = {
  children: (_Default: unknown, props: ComponentProps<typeof ChinookDialogMotion>) =>
    createElement(ChinookDialogMotion, props),
};

export const DIALOG_BACKDROP_MOTION = {
  children: (_Default: unknown, props: ComponentProps<typeof ChinookBackdropMotion>) =>
    createElement(ChinookBackdropMotion, props),
};

/**
 * §21 tool-row flip: a row that has just reached its final state fades in over
 * 150 ms. The row is keyed on its own state, so this plays once per flip.
 */
export const FADE_IN: GriffelStyle["animationName"] = { from: { opacity: 0 }, to: { opacity: 1 } };

/** §21 session switch: the conversation container fades 0.4 → 1 over 150 ms. */
export const VIEW_FADE_IN: GriffelStyle["animationName"] = { from: { opacity: 0.4 }, to: { opacity: 1 } };

/**
 * §21 streaming caret: a 400 ms opacity blink. Written as four explicit stops
 * rather than the two grouped selectors (`0%, 60%`) the literal CSS would use,
 * because griffel compiles one stop per object key.
 *
 * §21 also requires a *steady* caret under `prefers-reduced-motion`; the
 * keyframes stay here and the media override that switches them off lives with
 * the caret's own rule (markdown/MarkdownView.tsx), where the rest of the
 * caret is described.
 */
export const CARET_BLINK: GriffelStyle["animationName"] = {
  "0%": { opacity: 1 },
  "60%": { opacity: 1 },
  "61%": { opacity: 0 },
  "100%": { opacity: 0 },
};

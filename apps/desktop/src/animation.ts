/**
 * Named @keyframes used by griffel `animationName`. Griffel keyframes objects
 * require @griffel/react (not a direct dependency); following the
 * MarkdownView precedent (markdown/MarkdownView.tsx), the animation bodies
 * are injected once as a literal stylesheet and referenced by name.
 * Motion definitions per UI Spec §21.
 */

const SHEET = `
@keyframes chinookFadeIn {
  from { opacity: 0 }
  to { opacity: 1 }
}
@keyframes chinookViewFadeIn {
  from { opacity: 0.4 }
  to { opacity: 1 }
}
`;

let injected = false;

/** Idempotent; safe to call at module scope (guarded for SSR-less browser). */
export function ensureKeyframes(): void {
  if (injected || typeof document === "undefined") return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = SHEET;
  document.head.appendChild(style);
}

/** §21 tool-row flip: 150 ms opacity cross-fade on state change. */
export const FADE_IN = "chinookFadeIn";
/** §21 session switch: content cross-fade 150 ms. */
export const VIEW_FADE_IN = "chinookViewFadeIn";

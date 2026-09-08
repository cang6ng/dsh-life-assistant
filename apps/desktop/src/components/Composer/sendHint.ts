/**
 * Composer send-failure hint lifecycle (UI Spec §8.2/§18.4; Targeted Repair
 * P3). Pure — no React/DOM/Fluent imports, so the exact fixed semantics are
 * unit-testable under node.
 *
 * §8.2: a transport failure (send never reached the bridge) keeps the text
 * and shows `发送失败，请重试`. The flag is transient: it must not survive a
 * NEW effective operation or a context change —
 *
 *   - `send-result ok`   → the new send was accepted; the old failure is
 *                          obsolete (P3: previously only a keystroke cleared
 *                          it, so it resurfaced after the retry turn ended)
 *   - `send-result !ok`  → this send failed → show the hint
 *   - `session-changed`  → a stale failure from another session must not
 *                          pollute the new context
 *   - `draft-changed`    → a keystroke dismisses the hint (unchanged §8.2)
 */

export type SendHintEvent =
  | { kind: "send-result"; ok: boolean }
  | { kind: "session-changed" }
  | { kind: "draft-changed" };

export function nextSendFailed(_prev: boolean, ev: SendHintEvent): boolean {
  switch (ev.kind) {
    case "send-result":
      return !ev.ok;
    case "session-changed":
    case "draft-changed":
      return false;
  }
}

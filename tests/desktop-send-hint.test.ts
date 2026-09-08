/**
 * Composer send-failure hint lifecycle (Targeted Repair P3). sendHint.ts is a
 * pure reducer, so the fixed semantics are testable under node without React:
 *
 *   failed send      → hint ON (发送失败，请重试, §8.2)
 *   accepted resend  → hint OFF  — the old failure is obsolete once the new
 *                      send is ACCEPTED; it must not resurface when the retry
 *                      turn/end completes (this was the P3 stale-error bug)
 *   rejected send    → hint ON
 *   session switch   → hint OFF (a failure from another context must not
 *                      pollute the new conversation)
 *   keystroke        → hint OFF (unchanged §8.2 dismiss-on-type)
 *
 * Case D end-to-end: send failure → error → recovery send accepted → turn
 * completes → the hint stays cleared (no residue to re-render).
 */

import { describe, expect, it } from "vitest";
import { nextSendFailed, type SendHintEvent } from "../apps/desktop/src/components/Composer/sendHint";

describe("composer send-failure hint (Targeted Repair P3)", () => {
  it("a rejected send raises the hint", () => {
    expect(nextSendFailed(false, { kind: "send-result", ok: false })).toBe(true);
    // repeated failures keep it raised
    expect(nextSendFailed(true, { kind: "send-result", ok: false })).toBe(true);
  });

  it("an accepted resend clears an old failure (the P3 bug: it used to resurface when the retry turn ended)", () => {
    expect(nextSendFailed(true, { kind: "send-result", ok: true })).toBe(false);
    // and stays clear across later accepted sends
    expect(nextSendFailed(false, { kind: "send-result", ok: true })).toBe(false);
  });

  it("a session switch clears a failure from another context", () => {
    expect(nextSendFailed(true, { kind: "session-changed" })).toBe(false);
    expect(nextSendFailed(false, { kind: "session-changed" })).toBe(false);
  });

  it("a keystroke dismisses the hint (unchanged §8.2)", () => {
    expect(nextSendFailed(true, { kind: "draft-changed" })).toBe(false);
  });

  it("Case D: failure → error → recovery send → turn completes leaves no stale error to re-render", () => {
    let f: boolean = false;
    const step = (ev: SendHintEvent): void => {
      f = nextSendFailed(f, ev);
    };
    step({ kind: "send-result", ok: false }); // turn 1 send failed → hint
    expect(f).toBe(true);
    step({ kind: "draft-changed" }); // user sees the error, edits / retries
    expect(f).toBe(false);
    step({ kind: "send-result", ok: true }); // retry accepted
    expect(f).toBe(false);
    // assistant/tool streaming + turn/end happen — none may re-raise the hint
    // (rendered hint is `sendFailed` alone, evaluated when !pending && !turnActive)
    expect(f).toBe(false);
  });

  it("recovery on the SAME session after a restart-restore also clears: the accepted-send rule is session-agnostic by design", () => {
    // restart-restore keeps activeSessionId identical (no session-changed
    // event fires) — the accepted-resend rule is what clears the stale hint.
    let f = nextSendFailed(true, { kind: "send-result", ok: true });
    expect(f).toBe(false);
  });
});

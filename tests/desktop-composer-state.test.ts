/**
 * Composer lock + hint matrix (Round I, §8.2/§28.1). composerState.ts is pure
 * — the sendHint.ts precedent — so the whole matrix runs under plain node:
 *
 *   the reported bug: `hasSession === false` must NOT lock the composer. The
 *   lock is derived (§28.1: activeTurn === null && runtime ready); a missing
 *   session used to be an extra condition, which produced a disabled box with
 *   a blank caption on the no-conversation screen — indistinguishable from a
 *   frozen app. `send()` creates the session (§7.2).
 *
 *   the counter-case: `opening` DOES lock. A session.open in flight leaves the
 *   runtime `ready` until the bridge's `restoring` event lands a frame later,
 *   so status alone would leave the box typeable during a boot restore — and a
 *   send there creates a session the restore then replaces on screen.
 *
 * Invariants asserted over every combination of the six inputs:
 *   locked ⇒ a non-empty reason is shown (never a dead box without one);
 *   locked ⇒ the hint is not the idle enabling hint;
 *   hintError ⇔ the hint is the P3 send-failure line.
 */

import { describe, expect, it } from "vitest";
import { composerState, type ComposerStateInput } from "../apps/desktop/src/components/Composer/composerState";
import { copy } from "../apps/desktop/src/copy";
import type { RuntimeStatus } from "../apps/desktop/src/protocol/types";

const STATUSES: RuntimeStatus[] = [
  "starting",
  "ready",
  "restoring",
  "disconnected",
  "error",
  "restarting",
];

const base: ComposerStateInput = {
  turnActive: false,
  pending: false,
  runtimeStatus: "ready",
  opening: false,
  hasSession: true,
  sendFailed: false,
};

const input = (patch: Partial<ComposerStateInput> = {}): ComposerStateInput => ({ ...base, ...patch });

describe("composer lock + hint (Round I)", () => {
  it("idle, ready, session open: enabled with the plain composing hint", () => {
    expect(composerState(input())).toEqual({
      locked: false,
      hint: "composer.hint",
      hintError: false,
    });
  });

  it("the reported screen: no session yet, runtime ready → ENABLED, says what Enter will do", () => {
    const s = composerState(input({ hasSession: false }));
    expect(s.locked).toBe(false);
    expect(s.hint).toBe("composer.newSession");
    expect(copy[s.hint]).toBe("输入后按 Enter 会自动创建新会话");
  });

  it("a live turn or an in-flight submit locks the box and says the agent is answering", () => {
    for (const busy of [{ turnActive: true }, { pending: true }, { turnActive: true, pending: true }]) {
      const s = composerState(input(busy));
      expect(s.locked).toBe(true);
      expect(s.hint).toBe("composer.sending");
    }
  });

  it("a session open in flight locks the box with 正在恢复会话… even while the runtime still reads ready", () => {
    const s = composerState(input({ opening: true, hasSession: false }));
    expect(s.locked).toBe(true);
    expect(s.hint).toBe("restore.loading");
    expect(copy[s.hint]).toBe("正在恢复会话…");
    // and with a session already bound (a sidebar click over a live one)
    expect(composerState(input({ opening: true }))).toMatchObject({
      locked: true,
      hint: "restore.loading",
    });
  });

  it("a non-ready runtime locks with the same caption (restore, not a dead box)", () => {
    for (const runtimeStatus of STATUSES) {
      if (runtimeStatus === "ready") continue;
      const s = composerState(input({ runtimeStatus }));
      expect(s.locked).toBe(true);
      expect(s.hint).toBe("restore.loading");
    }
  });

  it("busy outranks opening; opening outranks a pending failure; a failure outranks sessionless", () => {
    // busy > everything
    expect(composerState(input({ pending: true, opening: true, sendFailed: true })).hint).toBe(
      "composer.sending",
    );
    // opening > sendFailed — what is happening now beats what went wrong before
    expect(composerState(input({ opening: true, sendFailed: true }))).toMatchObject({
      locked: true,
      hint: "restore.loading",
      hintError: false,
    });
    // sendFailed > sessionless, and it never locks on its own: the user's next
    // move is to edit or resend (§8.2 keeps the text).
    const failed = composerState(input({ sendFailed: true, hasSession: false }));
    expect(failed).toEqual({ locked: false, hint: "composer.sendFailed", hintError: true });
    // not-ready > sessionless
    expect(composerState(input({ runtimeStatus: "restoring", hasSession: false })).hint).toBe(
      "restore.loading",
    );
  });

  it("the send-failure hint is the only error-coloured one", () => {
    expect(composerState(input({ sendFailed: true })).hintError).toBe(true);
    for (const patch of [
      {},
      { hasSession: false },
      { pending: true },
      { turnActive: true },
      { opening: true },
      { runtimeStatus: "restoring" as RuntimeStatus },
    ]) {
      expect(composerState(input(patch)).hintError).toBe(false);
    }
  });

  it("every combination of the six inputs: locked ⇒ a non-empty reason is on screen", () => {
    for (const turnActive of [false, true]) {
      for (const pending of [false, true]) {
        for (const runtimeStatus of STATUSES) {
          for (const opening of [false, true]) {
            for (const hasSession of [false, true]) {
              for (const sendFailed of [false, true]) {
                const i = { turnActive, pending, runtimeStatus, opening, hasSession, sendFailed };
                const s = composerState(i);
                const where = JSON.stringify(i);
                const reason = copy[s.hint];
                // The hint resolves to a real, non-empty string (the old blank
                // caption is what made the screen read as a freeze).
                expect(typeof reason, where).toBe("string");
                expect(reason.trim().length, `${where} → ${s.hint}`).toBeGreaterThan(0);
                // A locked box never shows the idle "Enter 发送" caption as if
                // the user could act on it.
                if (s.locked) expect(s.hint, where).not.toBe("composer.hint");
                // The lock is §28.1's derived rule, plus the in-flight open.
                expect(s.locked, where).toBe(pending || turnActive || runtimeStatus !== "ready" || opening);
                // A sessionless box is typeable whenever the runtime is settled
                // and nothing is in flight.
                if (runtimeStatus === "ready" && !opening && !pending && !turnActive && !hasSession) {
                  expect(s.locked, where).toBe(false);
                }
              }
            }
          }
        }
      }
    }
  });
});

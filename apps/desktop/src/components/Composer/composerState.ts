/**
 * Composer lock + hint line (§8.2/§8.3/§28.1), pure — the sendHint.ts
 * precedent, so the matrix is testable under node without React.
 *
 * The lock is *derived* (§28.1: enabled ⇔ `activeTurn === null` and the
 * runtime is `ready`). A missing session is deliberately NOT a lock: `send()`
 * creates one on demand (§7.2), and the chips on the no-conversation screen
 * have always worked through that path — only the box beside them did not.
 *
 * Every locked state carries a non-empty hint. A disabled composer with a
 * blank caption is what made that screen read as a frozen app.
 */

import type { RuntimeStatus } from "../../protocol/types";
import type { CopyKey } from "../../copy";

export interface ComposerStateInput {
  /** A turn is live in the store (`state.activeTurn !== null`). */
  turnActive: boolean;
  /** Local: a submit is in flight (covers the create + turn/send round trip). */
  pending: boolean;
  runtimeStatus: RuntimeStatus;
  /**
   * A session.open is in flight (AppValue.opening). Needed *in addition* to
   * the status: the shell sets it synchronously when it issues the invoke,
   * while the bridge's `restoring` status arrives over the event channel a
   * frame later. Without it the box stays typeable during a boot restore —
   * and a send in that window creates a second session that the restore then
   * replaces on screen, swallowing the message.
   */
  opening: boolean;
  hasSession: boolean;
  /** The P3 transient failure lifecycle (sendHint.ts). */
  sendFailed: boolean;
}

export interface ComposerState {
  locked: boolean;
  hint: CopyKey;
  hintError: boolean;
}

export function composerState(input: ComposerStateInput): ComposerState {
  const ready = input.runtimeStatus === "ready";
  const busy = input.pending || input.turnActive;
  // A session open (or the P1 restart hold) is not a state the user can send
  // from — the column is showing §5.4/§13, so the box must say the same thing.
  const opening = input.opening || !ready;
  const locked = busy || opening;

  let hint: CopyKey = "composer.hint";
  let hintError = false;
  if (busy) {
    hint = "composer.sending";
  } else if (opening) {
    // Covers `restoring` and every other non-ready status (starting /
    // disconnected / error / restarting replace the conversation column with
    // the §16 state card, so the composer is not even mounted there) plus an
    // in-flight open. Says what is happening instead of leaving the box blank.
    hint = "restore.loading";
  } else if (input.sendFailed) {
    // Only ever set by a submit that already ended, so it cannot coexist with
    // `busy`. It never locks: the user's next move is to edit or resend.
    hint = "composer.sendFailed";
    hintError = true;
  } else if (!input.hasSession) {
    // No conversation yet (empty home, or a list that never resolved). The
    // input is the entry point — sending creates the session (§7.2).
    hint = "composer.newSession";
  }

  return { locked, hint, hintError };
}

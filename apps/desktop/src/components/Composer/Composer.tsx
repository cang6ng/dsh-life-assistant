/**
 * Composer (§8/§27.1): the pinned send panel — plain multi-line textarea,
 * auto-grow 1 → 6 lines, Enter sends / Shift+Enter newlines (IME-guarded),
 * silent 4000-char clamp with an n/4000 counter caption while the draft
 * exceeds 3500 chars. States per §8.2: disabled while a turn is active
 * (sending copy), no session / restoring, or the runtime is not ready;
 * transport failure keeps the text and shows 发送失败，请重试. P3: that
 * transient hint is a pure lifecycle (sendHint.ts) — an accepted resend, a
 * session switch or a keystroke clears it. Draft text lives in
 * ConversationView (§28.3).
 */

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { SendRegular } from "@fluentui/react-icons";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { nextSendFailed } from "./sendHint";

const MAX_LENGTH = 4000; // §8.3
const COUNTER_AT = 3500;
const LINE_HEIGHT = 20; // body 14/20 (§20.1)
const MAX_LINES = 6;

const useStyles = makeStyles({
  wrapper: {
    flexShrink: 0,
    padding: "8px 24px 14px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  panel: {
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: "8px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    padding: "10px 10px 10px 14px",
    boxSizing: "border-box",
  },
  textarea: {
    flex: "1 1 auto",
    minWidth: "0",
    border: "none",
    outline: "none",
    resize: "none",
    background: "transparent",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    lineHeight: `${LINE_HEIGHT}px`,
    color: tokens.colorNeutralForeground1,
    padding: "0",
    maxHeight: `${LINE_HEIGHT * MAX_LINES}px`,
    overflowY: "auto",
    "::placeholder": {
      color: tokens.colorNeutralForegroundDisabled,
    },
    ":disabled": {
      color: tokens.colorNeutralForegroundDisabled,
      cursor: "not-allowed",
    },
  },
  sendButton: {
    flexShrink: 0,
    minWidth: "40px",
    height: "36px",
  },
  hintLine: {
    maxWidth: "760px",
    margin: "0 auto",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    paddingTop: "5px",
    fontSize: "12px",
    lineHeight: "16px",
    color: tokens.colorNeutralForeground3,
    minHeight: "21px",
    boxSizing: "border-box",
  },
  hintError: {
    color: tokens.colorStatusDangerForeground1,
  },
  counter: {
    marginLeft: "auto",
    fontSize: "12px",
    fontVariantNumeric: "tabular-nums",
    color: tokens.colorNeutralForeground3,
    flexShrink: 0,
  },
});

export interface ComposerProps {
  /** Draft text for the active session (ConversationView owns the map). */
  value: string;
  onChange: (text: string) => void;
}

export function Composer({ value, onChange }: ComposerProps) {
  const styles = useStyles();
  const { state } = useApp();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  // P3: the transient send-failure hint lives in this lifecycle reducer
  // (sendHint.ts) — an accepted resend, a session switch or a keystroke all
  // clear it; a rejection sets it.
  const [sendFailed, dispatchHint] = useReducer(nextSendFailed, false);
  const { actions } = useApp();
  const send = actions.send;

  const runtimeReady = state.runtime.status === "ready";
  const turnActive = state.activeTurn !== null;
  const hasSession = state.activeSessionId !== null;

  // §8.2 disable matrix
  const locked = turnActive || pending || !runtimeReady || !hasSession;
  const trimmed = value.trim();
  const canSend = !locked && trimmed.length > 0;

  // Auto-grow 1 → 6 lines (§8.3).
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    const rows = Math.max(1, Math.min(MAX_LINES, Math.ceil(el.scrollHeight / LINE_HEIGHT)));
    el.style.height = `${rows * LINE_HEIGHT}px`;
  }, [value]);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return; // §8.3 IME
    if (e.shiftKey) return; // Shift+Enter newline
    e.preventDefault();
    void submit();
  };

  const submit = async (): Promise<void> => {
    const text = value.trim();
    if (text.length === 0 || !canSend || pending) return;
    setPending(true);
    try {
      const res = await send(text);
      // §17.2 transport failure: hint shows, text restored (it never left).
      // P3: an ACCEPTED resend clears the old failure here — it must not
      // resurface once the retry turn finishes.
      dispatchHint({ kind: "send-result", ok: res.ok });
    } finally {
      setPending(false);
    }
  };

  const onChangeText = (e: ChangeEvent<HTMLTextAreaElement>): void => {
    const next = e.target.value.slice(0, MAX_LENGTH); // §8.3 silent clamp
    onChange(next);
    dispatchHint({ kind: "draft-changed" }); // a keystroke dismisses the hint
  };

  // P3: a stale send failure from another session must not pollute the new
  // conversation context (open/switch/restart-restore never change
  // activeSessionId only when restoring the SAME session — there the
  // accepted-resend rule above clears it).
  const prevSessionRef = useRef(state.activeSessionId);
  useEffect(() => {
    const before = prevSessionRef.current;
    prevSessionRef.current = state.activeSessionId;
    if (before !== state.activeSessionId) {
      dispatchHint({ kind: "session-changed" });
    }
  }, [state.activeSessionId]);

  // Hint line per §8.2.
  let hint: string = copy["composer.hint"];
  let hintError = false;
  if (pending || turnActive) {
    hint = copy["composer.sending"];
  } else if (sendFailed) {
    hint = copy["composer.sendFailed"];
    hintError = true;
  } else if (!runtimeReady || !hasSession) {
    hint = "";
  }

  return (
    <div className={styles.wrapper}>
      <div className={styles.panel}>
        <textarea
          ref={textareaRef}
          className={styles.textarea}
          rows={1}
          value={value}
          placeholder={copy["composer.placeholder"]}
          disabled={locked}
          aria-label={copy["composer.placeholder"]}
          onChange={onChangeText}
          onKeyDown={onKeyDown}
        />
        <Button
          className={styles.sendButton}
          appearance="primary"
          icon={pending ? undefined : <SendRegular aria-hidden="true" />}
          disabled={!canSend && !pending}
          aria-label={copy["composer.placeholder"]}
          onClick={() => void submit()}
        >
          {pending ? <Spinner size="tiny" aria-hidden="true" /> : null}
        </Button>
      </div>
      <div className={styles.hintLine}>
        <span className={hintError ? styles.hintError : undefined}>{hint}</span>
        {value.length > COUNTER_AT && (
          <span className={styles.counter}>{copy["composer.counter"].replace("{n}", String(value.length))}</span>
        )}
      </div>
    </div>
  );
}

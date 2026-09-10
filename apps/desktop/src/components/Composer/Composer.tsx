/**
 * Composer (§8/§27.1): the pinned send panel — plain multi-line textarea,
 * auto-grow 1 → 6 lines, Enter sends / Shift+Enter newlines (IME-guarded),
 * silent 4000-char clamp with an n/4000 counter caption while the draft
 * exceeds 3500 chars. Lock and hint both come from composerState.ts (§8.2):
 * disabled while a turn is active (sending copy) or a session open is in
 * flight (正在恢复会话…), never blank, and *not* disabled merely for want of a
 * session — send() creates one (§7.2). Transport failure keeps the text and
 * shows 发送失败，请重试. P3: that transient hint is a pure lifecycle
 * (sendHint.ts) — an accepted resend, a session switch or a keystroke clears
 * it. Draft text lives in ConversationView (§28.3).
 */

import {
  useEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { Button, Field, Spinner, Textarea, makeStyles, tokens } from "@fluentui/react-components";
import { SendRegular } from "@fluentui/react-icons";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { nextSendFailed } from "./sendHint";
import { composerState } from "./composerState";

const MAX_LENGTH = 4000; // §8.3
const COUNTER_AT = 3500;
const LINE_HEIGHT = 20; // body 14/20 (§20.1)
const MAX_LINES = 6;
/**
 * Vertical padding inside the <textarea>, and the reason the caret sits where
 * it does. §8.1 draws the single-line state as placeholder and send button on
 * one row; the panel is `align-items: flex-end` so a grown textarea keeps the
 * button against its last line. A bare 20 px line box under that alignment
 * pins the text to the bottom of the 36 px button row instead — 16 px of dead
 * space above it, which is what made the box look top-heavy. Padding the
 * textarea symmetrically makes one line measure exactly the button's height,
 * so the two centres coincide at one line and stay coincident as it grows.
 * The auto-grow effect below subtracts it again when counting rows.
 */
const INPUT_PAD_Y = 8;

const useStyles = makeStyles({
  wrapper: {
    flexShrink: 0,
    padding: "8px 24px 14px",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  // The Field supplies the panel's max width (§8.4: ≤ 760 px, centred) and
  // renders the locked/error line under it (§8.1). It is deliberately the
  // *parent* of the panel rather than of the textarea alone: Fluent renders a
  // validationMessage after its children, and §8.1 puts that line below the
  // panel, not inside it. The textarea still receives the Field's id and
  // `aria-describedby` — Field passes those through React context.
  field: {
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
  },
  panel: {
    width: "100%",
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: "8px",
    borderRadius: "10px",
    backgroundColor: tokens.colorNeutralBackground1,
    // §8.1's border, in the brief's "Subtle Border" register (the same stop the
    // activity drawer draws its 1 px edge with). Stroke1 read as a hard outline
    // around a panel whose fill is the page's own background; the focus ring
    // below is what carries the affordance.
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    // Vertical padding is deliberately smaller than the textarea's own: the
    // two stack, and it is their sum that reads as the text's breathing room.
    padding: "8px 8px 8px 14px",
    boxSizing: "border-box",
    // §8.1's panel is the input's visible boundary — the textarea is flush
    // inside it, so this is where the focus indicator belongs. It replaces the
    // `outline: none` the raw textarea used to carry with nothing (§23.3), and
    // it uses the same compound-brand token Fluent's own focus underline does.
    ":focus-within": {
      border: `1px solid ${tokens.colorCompoundBrandStroke}`,
    },
  },
  // Textarea renders a <span class="fui-Textarea"> around the <textarea>, and
  // both slots draw chrome: the root has a 1px border, a background and the
  // animated bottom-edge focus underline, the field has the size preset's
  // padding. §8.1 wants a plain multi-line box flush inside the panel, so all
  // of it goes. `content: none` targets that underline specifically — the
  // library's own forced-colors outline is on a different pseudo-property and
  // survives.
  input: {
    flex: "1 1 auto",
    minWidth: "0",
    border: "none",
    padding: "0",
    backgroundColor: "transparent",
    "::after": {
      content: "none",
    },
  },
  inputField: {
    padding: `${INPUT_PAD_Y}px 0`,
    // The medium Textarea preset floors the <textarea> at 52 px, which would
    // make the §8.3 auto-grow measure three lines before the user typed one
    // (the effect reads back `scrollHeight`). §8.3 starts at a single 20 px
    // line, so the preset's floor goes and the inline height owns the box.
    minHeight: "0",
    maxHeight: `${LINE_HEIGHT * MAX_LINES + INPUT_PAD_Y * 2}px`,
    // The auto-grow effect writes `height` in border-box terms (rows × line +
    // padding), so the padding has to be counted inside it.
    boxSizing: "border-box",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300,
    lineHeight: `${LINE_HEIGHT}px`,
    color: tokens.colorNeutralForeground1,
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
    // The panel's own radius is 10 px; the library's default 4 px on a 36 px
    // button reads as a different, squarer shape sitting inside it.
    borderRadius: "8px",
  },
  // The line itself is Fluent's validation message (caption1, foreground3, red
  // when the state is error), so only the row layout is ours: hint left,
  // counter pinned right.
  hintRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    minHeight: "16px",
  },
  counter: {
    marginLeft: "auto",
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
  const { state, opening } = useApp();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  // `pending` mirrored for the effects below — read without re-running them.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // P3: the transient send-failure hint lives in this lifecycle reducer
  // (sendHint.ts) — an accepted resend, a session switch or a keystroke all
  // clear it; a rejection sets it.
  const [sendFailed, dispatchHint] = useReducer(nextSendFailed, false);
  const send = useApp().actions.send;

  // §8.2 lock + hint, derived together in one pure function so the two can
  // never disagree (a locked box always says why — composerState.ts). `opening`
  // is not redundant with the status: it is set the moment the desktop issues
  // session.open, while the bridge's `restoring` event lands a frame later.
  const { locked, hint, hintError } = composerState({
    turnActive: state.activeTurn !== null,
    pending,
    runtimeStatus: state.runtime.status,
    opening,
    hasSession: state.activeSessionId !== null,
    sendFailed,
  });
  const trimmed = value.trim();
  const canSend = !locked && trimmed.length > 0;

  // Auto-grow 1 → 6 lines (§8.3).
  useEffect(() => {
    const el = textareaRef.current;
    if (el === null) return;
    el.style.height = "auto";
    // `scrollHeight` counts the textarea's own vertical padding; the row count
    // must not, or a single line measures as two. Subtract it to count rows,
    // then add it back so one line lands on exactly the button's height.
    const content = el.scrollHeight - INPUT_PAD_Y * 2;
    const rows = Math.max(1, Math.min(MAX_LINES, Math.ceil(content / LINE_HEIGHT)));
    el.style.height = `${rows * LINE_HEIGHT + INPUT_PAD_Y * 2}px`;
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

  const onChangeText = (_ev: ChangeEvent<HTMLTextAreaElement>, data: { value: string }): void => {
    const next = data.value.slice(0, MAX_LENGTH); // §8.3 silent clamp
    onChange(next);
    dispatchHint({ kind: "draft-changed" }); // a keystroke dismisses the hint
  };

  // P3: a stale send failure from another session must not pollute the new
  // conversation context (open/switch/restart-restore never change
  // activeSessionId only when restoring the SAME session — there the
  // accepted-resend rule above clears it).
  //
  // A sessionless send is the exception: it binds a session (§7.2) a whole
  // round trip before its own send-result comes back, so resetting here would
  // wipe the failure submit() is about to report — the user would see the text
  // sitting in the box with no explanation. While a submit is in flight it owns
  // the hint; it always ends by dispatching a definitive send-result.
  const prevSessionRef = useRef(state.activeSessionId);
  useEffect(() => {
    const before = prevSessionRef.current;
    prevSessionRef.current = state.activeSessionId;
    if (before !== state.activeSessionId && !pendingRef.current) {
      dispatchHint({ kind: "session-changed" });
    }
  }, [state.activeSessionId]);

  // A blinking caret is the cheapest proof the app is not frozen: when the
  // composer becomes usable (mount, a finished turn, a restored session), put
  // focus in the box — but never take it from something the user is already
  // using (a sidebar row, a dialog). Keyed on `locked` rather than mount: the
  // restore that runs at boot disables the box (which blurs it), so a
  // mount-only focus would be thrown away and the caret would never come back.
  useEffect(() => {
    if (locked) return;
    // Both overlays are Fluent modals now, so neither leaves the caret loose on
    // `body` — clicking their chrome is a no-op rather than a focus reset. The
    // guard stays because the reason it exists outlives the bug it was written
    // for: stealing focus while a surface is up would pull the caret out of the
    // key field mid-typing, whatever the surface's focus behaviour.
    if (state.ui.configOpen || state.ui.drawerOpen) return;
    const el = textareaRef.current;
    if (el === null) return;
    const active = document.activeElement;
    if (active === null || active === document.body || active === el) {
      el.focus();
    }
  }, [locked, state.ui.configOpen, state.ui.drawerOpen]);

  return (
    <div className={styles.wrapper}>
      <Field
        className={styles.field}
        // `none` is not the default: Fluent infers "error" from the mere
        // presence of a validationMessage, and the hint line is only an error
        // in the §8.2 send-failure state. It is also what drives `role="alert"`
        // and the red caption.
        validationState={hintError ? "error" : "none"}
        validationMessage={
          <span className={styles.hintRow}>
            <span>{copy[hint]}</span>
            {value.length > COUNTER_AT && (
              <span className={styles.counter}>
                {copy["composer.counter"].replace("{n}", String(value.length))}
              </span>
            )}
          </span>
        }
      >
        <div className={styles.panel}>
          <Textarea
            // Textarea forwards its ref to the <textarea> itself (not the
            // wrapping span), so the auto-grow measurement below is unchanged.
            ref={textareaRef}
            className={styles.input}
            textarea={{ className: styles.inputField }}
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
      </Field>
    </div>
  );
}

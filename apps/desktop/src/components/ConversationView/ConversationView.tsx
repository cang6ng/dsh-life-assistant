/**
 * ConversationView (§6/§7/§13/§27.1): the conversation column — scrollable
 * turn-block stack (EmptyState / restore loader / restore-failure card
 * replace it per §5.4/§7/§13) above the pinned Composer. Draft text lives
 * here per §28.3 (Map<sessionId, string>, plus one slot for the
 * no-conversation-yet state, cleared when the session's turn starts).
 * Session switches fade the content (§21) and snap the scroll (§15).
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Button,
  MessageBar,
  MessageBarActions,
  MessageBarBody,
  MessageBarTitle,
  Spinner,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { ConversationScroll, type ConversationScrollHandle } from "../ConversationScroll/ConversationScroll";
import { TurnBlock } from "../TurnBlock/TurnBlock";
import { Composer } from "../Composer/Composer";
import { EmptyState } from "./EmptyState";
import { VIEW_FADE_IN } from "../../motion";

/**
 * Draft slot for the state with no session yet. Session ids are always
 * `session-<uuid>` (apps/cli/src/runtime.ts), so this can never collide with
 * one; the `""` that `sessionKey` uses for the scroll container and the React
 * key is not a usable draft key (§28.3).
 */
const NEW_DRAFT_KEY = "__new-session__";

const useStyles = makeStyles({
  root: {
    flex: "1 1 auto",
    minHeight: "0",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.colorNeutralBackground1,
    minWidth: "0",
  },
  fade: {
    width: "100%",
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    animationName: VIEW_FADE_IN, // §21 session switch fade 150ms (motion.ts)
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  turns: {
    display: "flex",
    flexDirection: "column",
    gap: "24px", // §20.2 sp5: the dominant vertical rhythm
    width: "100%",
    maxWidth: "760px", // §4.2 column cap, centered
    margin: "0 auto",
    padding: "16px 24px 24px",
    boxSizing: "border-box",
  },
  loadHost: {
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    width: "100%",
    maxWidth: "760px",
    margin: "0 auto",
    padding: "24px",
    boxSizing: "border-box",
  },
  loadText: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  // §13's restore-failure surface. It is Fluent's `MessageBar`, not a Card
  // holding one: the MessageBar already *is* the bordered, icon-led error
  // surface with an action slot, so wrapping it in a Card would draw two
  // nested frames around the same message and give the card no content of its
  // own. The intent supplies the red pairing, the icon and the announcement
  // (see the JSX note on role="alert").
  failCard: {
    margin: "auto",
    maxWidth: "420px",
    width: "100%",
  },
  failDetail: {
    marginTop: "4px",
    fontSize: "12px",
    lineHeight: "17px",
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "120px",
    overflowY: "auto",
  },
});

interface Block {
  user?: Extract<ConversationItem, { kind: "user" }>;
  assistant: Extract<ConversationItem, { kind: "assistant" }>;
}

/** Group the flat chronological items into user+assistant turn blocks (§6.1). */
function buildBlocks(items: ConversationItem[]): Block[] {
  const out: Block[] = [];
  for (const item of items) {
    if (item.kind === "user") {
      out.push({ user: item, assistant: null as unknown as Block["assistant"] });
    } else {
      const last = out[out.length - 1];
      if (last !== undefined && last.user !== undefined && (last.assistant as unknown) === null) {
        last.assistant = item;
      } else {
        out.push({ assistant: item }); // leading synthetic note (§13 archive)
      }
    }
  }
  return out.filter((b) => (b.assistant as unknown) !== null);
}

export function ConversationView() {
  const styles = useStyles();
  const { state, opening, actions } = useApp();
  const { activeSessionId } = state;
  const sessionKey = activeSessionId ?? "";
  const { items, openError } = state.conversation;

  const scrollRef = useRef<ConversationScrollHandle>(null);
  const [drafts, setDrafts] = useState<Map<string, string>>(() => new Map());
  const activeTurnId = state.activeTurn?.turnId ?? null;
  const prevActiveTurnRef = useRef(activeTurnId);
  const prevSessionRef = useRef(sessionKey);

  const blocks = useMemo(() => buildBlocks(items), [items]);
  // With no session yet the draft lives in its own slot — the composer stays
  // typeable there and the send creates the session (§7.2).
  const draftKey = activeSessionId ?? NEW_DRAFT_KEY;
  const draft = drafts.get(draftKey) ?? "";

  // §28.3: clear the draft of a session the moment its turn starts (turn/start
  // confirms; the user text is locked into the conversation as the bubble).
  useEffect(() => {
    if (activeTurnId === null) return;
    setDrafts((map) => {
      const keys = activeSessionId === null ? [NEW_DRAFT_KEY] : [activeSessionId, NEW_DRAFT_KEY];
      if (!keys.some((key) => map.has(key))) return map;
      const next = new Map(map);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, [activeTurnId, activeSessionId]);

  const setDraft = (text: string): void => {
    setDrafts((map) => {
      const next = new Map(map);
      next.set(draftKey, text);
      return next;
    });
  };

  // §15.1: a send is deliberate intent — always scroll to bottom. A turn can
  // only start through the user's send (idle → busy transition).
  useEffect(() => {
    const before = prevActiveTurnRef.current;
    prevActiveTurnRef.current = activeTurnId;
    if (before === null && activeTurnId !== null) {
      scrollRef.current?.jumpToBottom();
    }
  }, [activeTurnId]);

  // New session: the scroll snaps at first content paint (handled by
  // ConversationScroll's sessionKey branch). What is handled here is the
  // draft's home: a sessionless send binds a session (§7.2) a whole round trip
  // before its turn starts, and the draft key flips with it — so the text must
  // be handed over before paint, or the box would blank out the moment the
  // session exists (and a send that then fails, §17.2, would have nothing left
  // to restore). Only a no-session → session flip carries text across;
  // switching between two sessions must not.
  useLayoutEffect(() => {
    const before = prevSessionRef.current;
    prevSessionRef.current = sessionKey;
    if (before !== "" || activeSessionId === null) return;
    setDrafts((map) => {
      const held = map.get(NEW_DRAFT_KEY);
      if (held === undefined || map.has(activeSessionId)) return map;
      const next = new Map(map);
      next.delete(NEW_DRAFT_KEY);
      next.set(activeSessionId, held);
      return next;
    });
  }, [sessionKey, activeSessionId]);

  const blocksView = (
    <div className={styles.turns}>
      {blocks.map((block) => (
        <TurnBlock
          key={block.user?.id ?? block.assistant.id}
          user={block.user}
          assistant={block.assistant}
        />
      ))}
    </div>
  );

  let content: ReactNode;
  if (openError !== null) {
    content = (
      <div className={styles.loadHost}>
        {/* The §13 failure surface. It carries no explicit `role` any more:
            MessageBar runs its own live-region announcer (`politeness`
            defaults to assertive for `intent="error"`, which is what
            `role="alert"` was emulating), and an extra alert region on the
            same node would make a screen reader read the failure twice. */}
        <MessageBar intent="error" layout="multiline" className={styles.failCard}>
          <MessageBarBody>
            <MessageBarTitle>{copy["restore.failed"]}</MessageBarTitle>
            <div className={styles.failDetail}>{openError}</div>
          </MessageBarBody>
          <MessageBarActions
            containerAction={
              <Button appearance="primary" onClick={() => void actions.retryOpen()}>
                {copy["restore.retry"]}
              </Button>
            }
          >
            <Button appearance="secondary" onClick={() => void actions.restoreClose()}>
              {copy["restore.close"]}
            </Button>
          </MessageBarActions>
        </MessageBar>
      </div>
    );
  } else if (opening || (blocks.length === 0 && state.runtime.status === "restoring")) {
    // §7.2: the empty state must never flash during a restore — while a
    // session is being opened or created the column says so (and the composer
    // repeats it in its hint). `opening` covers the opens the desktop started
    // (boot and sidebar); `restoring` covers the P1 restart-hold, which sets
    // no `opening` flag. Guarded by `blocks.length === 0`, this can never
    // hide a conversation that is already on screen (§16).
    content = (
      <div className={styles.loadHost}>
        <Spinner size="medium" aria-hidden="true" />
        <div className={styles.loadText}>{copy["restore.loading"]}</div>
      </div>
    );
  } else if (blocks.length === 0) {
    content = (
      <div className={styles.loadHost}>
        <EmptyState />
      </div>
    );
  } else {
    content = blocksView;
  }

  return (
    <div className={styles.root}>
      <ConversationScroll
        ref={scrollRef}
        sessionKey={sessionKey}
        blockCount={blocks.length}
      >
        <div key={sessionKey} className={styles.fade}>
          {content}
        </div>
      </ConversationScroll>
      <Composer value={draft} onChange={setDraft} />
    </div>
  );
}

/**
 * ConversationView (§6/§7/§13/§27.1): the conversation column — scrollable
 * turn-block stack (EmptyState / restore loader / restore-failure card
 * replace it per §5.4/§7/§13) above the pinned Composer. Draft text lives
 * here per §28.3 (Map<sessionId, string>, cleared when that session's turn
 * starts). Session switches fade the content (§21) and snap the scroll (§15).
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { ConversationScroll, type ConversationScrollHandle } from "../ConversationScroll/ConversationScroll";
import { TurnBlock } from "../TurnBlock/TurnBlock";
import { Composer } from "../Composer/Composer";
import { EmptyState } from "./EmptyState";
import { ensureKeyframes, VIEW_FADE_IN } from "../../animation";

ensureKeyframes();

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
    animationName: VIEW_FADE_IN, // §21 session switch fade 150ms
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
  failCard: {
    margin: "auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "8px",
    maxWidth: "420px",
    padding: "28px 36px",
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusLarge,
    backgroundColor: tokens.colorNeutralBackground1,
    textAlign: "center",
  },
  failTitle: {
    fontSize: "15px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  failDetail: {
    fontSize: "12px",
    lineHeight: "17px",
    color: tokens.colorNeutralForeground3,
    fontFamily: tokens.fontFamilyMonospace,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "120px",
    overflowY: "auto",
  },
  failActions: {
    display: "flex",
    flexDirection: "row",
    gap: "10px",
    marginTop: "6px",
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
  const draft = sessionKey !== "" ? (drafts.get(sessionKey) ?? "") : "";

  // §28.3: clear the draft of a session the moment its turn starts (turn/start
  // confirms; the user text is locked into the conversation as the bubble).
  useEffect(() => {
    if (activeTurnId !== null && activeSessionId !== null) {
      setDrafts((map) => {
        if (!map.has(activeSessionId)) return map;
        const next = new Map(map);
        next.delete(activeSessionId);
        return next;
      });
    }
  }, [activeTurnId, activeSessionId]);

  const setDraft = (text: string): void => {
    if (sessionKey === "") return;
    setDrafts((map) => {
      const next = new Map(map);
      next.set(sessionKey, text);
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
  // ConversationScroll's sessionKey branch); nothing further needed here.
  useEffect(() => {
    prevSessionRef.current = sessionKey;
  }, [sessionKey]);

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
        <div className={styles.failCard} role="alert">
          <div className={styles.failTitle}>{copy["restore.failed"]}</div>
          <div className={styles.failDetail}>{openError}</div>
          <div className={styles.failActions}>
            <Button appearance="primary" onClick={() => void actions.retryOpen()}>
              {copy["restore.retry"]}
            </Button>
            <Button appearance="secondary" onClick={() => void actions.restoreClose()}>
              {copy["restore.close"]}
            </Button>
          </div>
        </div>
      </div>
    );
  } else if (opening) {
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

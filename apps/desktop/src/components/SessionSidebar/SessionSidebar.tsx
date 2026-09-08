/**
 * SessionSidebar (§5/§27.1): 264 px list — NewSessionButton + SessionList
 * (today/yesterday/earlier groups). SessionList/SessionGroup are named
 * components of this node (rows are buttons; ↑/↓ move focus through them).
 * The rail variant (< 900 px, §22) is owned by DesktopShell — this node
 * renders the full-width panel only.
 */

import { useRef, type KeyboardEvent } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { SessionSummary } from "../../protocol/types";
import { copy } from "../../copy";
import { dayGroup, type DayGroup } from "../../util/format";
import { useApp } from "../../appContext";
import { NewSessionButton } from "../NewSessionButton/NewSessionButton";
import { SessionItem } from "../SessionItem/SessionItem";

const useStyles = makeStyles({
  sidebar: {
    width: "264px",
    backgroundColor: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    minHeight: "0",
    flexShrink: 0,
  },
  list: {
    flex: "1 1 auto",
    overflowY: "auto",
    padding: "0 8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  groupLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    letterSpacing: "0.2px",
    padding: "12px 10px 4px",
  },
});

function SessionGroup({ label, items, locked }: { label: string; items: SessionSummary[]; locked: boolean }) {
  const styles = useStyles();
  const { state, actions } = useApp();
  return (
    <div role="group" aria-label={label}>
      <div className={styles.groupLabel}>{label}</div>
      {items.map((session) => (
        <SessionItem
          key={session.sessionId}
          session={session}
          active={session.sessionId === state.activeSessionId}
          locked={locked}
          groupLabel={label}
          onOpen={(id) => void actions.openSession(id)}
        />
      ))}
    </div>
  );
}

const GROUP_ORDER: DayGroup[] = ["today", "yesterday", "earlier"];
const GROUP_LABEL: Record<DayGroup, string> = {
  today: copy["sidebar.group.today"],
  yesterday: copy["sidebar.group.yesterday"],
  earlier: copy["sidebar.group.earlier"],
};

function SessionList({ sessions }: { sessions: SessionSummary[] | null }) {
  const styles = useStyles();
  const { state } = useApp();
  const locked = state.activeTurn !== null;
  const buckets: Record<DayGroup, SessionSummary[]> = { today: [], yesterday: [], earlier: [] };
  if (sessions !== null) {
    for (const session of sessions) buckets[dayGroup(session.createdAt)].push(session);
  }
  const rows = GROUP_ORDER.filter((g) => buckets[g].length > 0);
  if (rows.length === 0) {
    return <div className={styles.list} />;
  }
  return (
    <div className={styles.list}>
      {rows.map((group) => (
        <SessionGroup key={group} label={GROUP_LABEL[group]} items={buckets[group]} locked={locked} />
      ))}
    </div>
  );
}

export function SessionSidebar() {
  const styles = useStyles();
  const { state } = useApp();
  const listRef = useRef<HTMLDivElement>(null);

  // §23: ↑/↓ move focus through the session rows while the sidebar has focus.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>): void => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const container = listRef.current;
    if (container === null) return;
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    const index = buttons.findIndex((b) => document.activeElement === b || b.contains(document.activeElement));
    if (index < 0 && buttons.length === 0) return;
    e.preventDefault();
    const dir = e.key === "ArrowDown" ? 1 : -1;
    const next = buttons[index + dir] ?? (dir === 1 ? buttons[0] : buttons[buttons.length - 1]);
    next?.focus();
  };

  return (
    <nav className={styles.sidebar} aria-label="会话列表" onKeyDown={onKeyDown}>
      <NewSessionButton />
      <div ref={listRef} style={{ minHeight: "0", flex: "1 1 auto", overflowY: "auto" }}>
        <SessionList sessions={state.sessions} />
      </div>
    </nav>
  );
}

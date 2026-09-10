/**
 * SessionSidebar (§5/§27.1): 264 px list — NewSessionButton + SessionList
 * (today/yesterday/earlier groups). SessionList/SessionGroup are named
 * components of this node. The rail variant (< 900 px, §22) is owned by
 * DesktopShell — this node renders the full-width panel only.
 *
 * The rows are a Fluent `FlatTree`. The hand-rolled ↑/↓ keydown handler that
 * used to live here is gone: roving focus is tabster's job now, which is both
 * less code and correct in the corners the old one got wrong (it picked the
 * next element by `querySelectorAll("button")`, so it also walked into any
 * other button that happened to be inside the list).
 *
 * **One tree per day group, not one tree with branch items.** The groups are
 * always-visible section headings, not disclosures — §5 gives them no
 * chevron and no collapsed state — so modelling them as branch tree items
 * would either add a focusable control that does nothing when clicked or add
 * a collapsing behaviour the design does not have. As separate labelled
 * trees, every `tree` contains only `treeitem`s, and the group name is the
 * tree's accessible name. The trade-off is that ↑/↓ stops at a group
 * boundary rather than running the whole list; Tab moves between groups.
 */

import { makeStyles, tokens, FlatTree, Text } from "@fluentui/react-components";
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
    // Stated rather than left to the spec's promotion rule (one non-visible
    // axis makes the other compute to `auto`): a row that outgrows the 264 px
    // column must ellipsize inside itself, never turn the whole list into a
    // horizontally scrolled region — which is how a long session title once
    // clipped the start of every other title's text.
    overflowX: "hidden",
    padding: "0 8px 12px",
    display: "flex",
    flexDirection: "column",
    gap: "2px",
  },
  group: {
    display: "flex",
    flexDirection: "column",
  },
  groupLabel: {
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground3,
    letterSpacing: "0.2px",
    padding: "12px 10px 4px",
    display: "block",
  },
});

interface SidebarProps {
  /**
   * Called after the user opens or creates a session. The rail variant (§22)
   * passes a closer so the overlay panel dismisses on selection; the docked
   * sidebar passes nothing, because there is no panel to dismiss.
   */
  onNavigate?: () => void;
}

function SessionGroup({
  label,
  items,
  locked,
  onNavigate,
}: {
  label: string;
  items: SessionSummary[];
  locked: boolean;
  onNavigate?: () => void;
}) {
  const styles = useStyles();
  const { state, actions } = useApp();
  return (
    <div className={styles.group}>
      {/* The heading is the tree's visible twin; the tree carries the same
          string as its aria-label, so the group is announced once on entry. */}
      <Text className={styles.groupLabel}>{label}</Text>
      <FlatTree aria-label={label} appearance="subtle" size="small">
        {items.map((session, index) => (
          <SessionItem
            key={session.sessionId}
            session={session}
            active={session.sessionId === state.activeSessionId}
            locked={locked}
            groupLabel={label}
            index={index}
            total={items.length}
            onOpen={(id) => {
              void actions.openSession(id);
              onNavigate?.();
            }}
          />
        ))}
      </FlatTree>
    </div>
  );
}

const GROUP_ORDER: DayGroup[] = ["today", "yesterday", "earlier"];
const GROUP_LABEL: Record<DayGroup, string> = {
  today: copy["sidebar.group.today"],
  yesterday: copy["sidebar.group.yesterday"],
  earlier: copy["sidebar.group.earlier"],
};

function SessionList({ sessions, onNavigate }: { sessions: SessionSummary[] | null; onNavigate?: () => void }) {
  const { state } = useApp();
  const locked = state.activeTurn !== null;
  const buckets: Record<DayGroup, SessionSummary[]> = { today: [], yesterday: [], earlier: [] };
  if (sessions !== null) {
    for (const session of sessions) buckets[dayGroup(session.createdAt)].push(session);
  }
  const rows = GROUP_ORDER.filter((g) => buckets[g].length > 0);
  // An empty list is an empty scroller, not an empty state: the empty-state
  // card (§16) belongs to the conversation column, and a sidebar that grows a
  // placeholder would push the ＋ button around (§5.1 keeps it pinned on top).
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((group) => (
        <SessionGroup
          key={group}
          label={GROUP_LABEL[group]}
          items={buckets[group]}
          locked={locked}
          onNavigate={onNavigate}
        />
      ))}
    </>
  );
}

export function SessionSidebar({ onNavigate }: SidebarProps) {
  const styles = useStyles();
  const { state } = useApp();

  return (
    <nav className={styles.sidebar} aria-label={copy["sidebar.open"]}>
      <NewSessionButton onNavigate={onNavigate} />
      {/* Overflow lives on the scroll container; ↑/↓ within each tree is
          tabster's (SessionItem), not a keydown handler here. */}
      <div className={styles.list}>
        <SessionList sessions={state.sessions} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

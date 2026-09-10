/**
 * SessionItem (§5.2/§5.3/§27.1): a `FlatTreeItem` row — title (14/400,
 * truncated) + right time label (HH:mm today else MM-DD). Active session:
 * accent 8% tinted background + 600 title. Locked while a turn is active
 * (§5.3/§16.5).
 *
 * §29 froze this row as a "custom row: native `<button>`"; the v1.0.4
 * amendment moves it to the tree, which is why the row is now a tree item
 * rather than a button. What the tree brings that the button did not:
 * ↑/↓ roving focus owned by tabster (the sidebar's hand-rolled keydown
 * handler is gone), correct `tree`/`treeitem` semantics, and the aria-level/
 * setsize/posinset triple the sidebar's grouping was previously silent about.
 *
 * `selectionMode` is deliberately unset: 'single' would inject a Radio into
 * every row, and §5 has no notion of selecting a session — clicking one
 * *opens* it. So the row is a leaf tree item whose accessible name is the
 * §23.4 "{title}，{group}" pair, and `aria-current="page"` still marks the
 * open one.
 *
 * Locked rows are `aria-disabled` rather than `disabled`: a tree item is a
 * `div`, not a native control, so `disabled` would be inert markup — and
 * `aria-disabled` keeps the row focusable and announcable, which is what
 * §5.3's tooltip needs in order to be reachable at all.
 */

import {
  FlatTreeItem,
  TreeItemLayout,
  Tooltip,
  makeStyles,
  mergeClasses,
  tokens,
  treeItemLayoutClassNames,
} from "@fluentui/react-components";
import type { SessionSummary } from "../../protocol/types";
import { copy } from "../../copy";
import { sideTimeLabel, titleFromText } from "../../util/format";

const useStyles = makeStyles({
  // TreeItemLayout's own metrics are a taller, roomier row than §5.2's 34 px
  // list line; the box is overridden while the item, its focus ring and its
  // hover state stay the library's.
  layout: {
    minHeight: "34px",
    padding: "4px 10px",
    borderRadius: tokens.borderRadiusMedium,
    fontSize: tokens.fontSizeBase300, // 14px
    color: tokens.colorNeutralForeground1,
    // The column that has to give way when a title is long is `main`, not the
    // span inside it: `main` is the flex item, and a flex item's default
    // `min-width: auto` floors it at its min-content width — for a nowrap title
    // that floor is the whole string, so it never shrank and the row outgrew
    // §5's 264 px column (the overflow then propagated into the list, which
    // showed a horizontal scrollbar and clipped every title at the left edge).
    // Named through Fluent's own exported slot-class map rather than the
    // literal string, so a rename upstream fails the typecheck instead of
    // silently un-styling the row.
    [`& .${treeItemLayoutClassNames.main}`]: {
      minWidth: 0,
    },
  },
  // §5.2: accent 8% tint over the panel (no left bar). --chinook-accent is
  // set by the theme host (light #C2410C / dark #FF9E73).
  active: {
    backgroundColor: "color-mix(in srgb, var(--chinook-accent) 8%, transparent)",
  },
  activeTitle: {
    fontWeight: 600,
  },
  // §5.2's single-line truncation. `display: block` is what makes the other
  // three properties mean anything: `main` is a block container, so without it
  // the span stays `inline`, and `overflow`/`text-overflow` are ignored on an
  // inline box — the text ran on and pushed the time label out of the row.
  title: {
    display: "block",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  time: {
    flexShrink: 0,
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
});

interface SessionItemProps {
  session: SessionSummary;
  active: boolean;
  /** True while a turn is active (§5.3: rows locked). */
  locked: boolean;
  /** Group label for the accessible name (§23: `{title}，{group}`). */
  groupLabel: string;
  /** Position within the group, for the aria-posinset/setsize pair. */
  index: number;
  total: number;
  onOpen: (sessionId: string) => void;
}

export function SessionItem({ session, active, locked, groupLabel, index, total, onOpen }: SessionItemProps) {
  const styles = useStyles();
  const title = titleFromText(session.title); // util falls back to 新会话
  const lockedRow = locked && !active;

  const item = (
    <FlatTreeItem
      value={session.sessionId}
      itemType="leaf"
      aria-level={1}
      aria-setsize={total}
      aria-posinset={index + 1}
      aria-label={`${title}，${groupLabel}`}
      aria-current={active ? "page" : undefined}
      aria-disabled={lockedRow ? true : undefined}
      onClick={() => {
        if (!lockedRow) onOpen(session.sessionId);
      }}
    >
      <TreeItemLayout
        // `mergeClasses`, not string concatenation: these two classes come from
        // one `makeStyles` call, and Fluent components merge their `className`
        // prop with `mergeClasses` themselves. A concatenated pair arrives as a
        // single string, and griffel resolves a string to the definitions of
        // the *first* sequence it finds — so the tint was silently dropped and
        // the active row rendered exactly like the others. Merging here instead
        // resolves both definition sets per property, with `active` winning
        // where they collide.
        className={mergeClasses(styles.layout, active && styles.active)}
        // `aside` is the slot for non-actionable trailing content — exactly
        // what the time label is.
        aside={<span className={styles.time}>{sideTimeLabel(session.createdAt)}</span>}
      >
        <span className={mergeClasses(styles.title, active && styles.activeTitle)}>{title}</span>
      </TreeItemLayout>
    </FlatTreeItem>
  );

  if (lockedRow) {
    // The tree item's root is a div, so it does not swallow pointer events the
    // way a disabled <button> does — no <span> wrapper needed here.
    return (
      <Tooltip content={copy["sidebar.switchLocked"]} relationship="label">
        {item}
      </Tooltip>
    );
  }
  return item;
}

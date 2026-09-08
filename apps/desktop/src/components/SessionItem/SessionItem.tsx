/**
 * SessionItem (§5.2/§5.3/§27.1): native-button row — title (14/400,
 * truncated) + right time label (HH:mm today else MM-DD). Active session:
 * accent 8% tinted background + 600 title. Disabled with a tooltip while a
 * turn is active (§5.3/§16.5).
 */

import { makeStyles, tokens, Tooltip } from "@fluentui/react-components";
import type { SessionSummary } from "../../protocol/types";
import { copy } from "../../copy";
import { sideTimeLabel, titleFromText } from "../../util/format";

const useStyles = makeStyles({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
    width: "100%",
    minHeight: "34px",
    padding: "4px 10px",
    borderRadius: tokens.borderRadiusMedium,
    border: "none",
    background: "transparent",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: "inherit",
    fontSize: tokens.fontSizeBase300, // 14px
    color: tokens.colorNeutralForeground1,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    "&:focus-visible": {
      outline: `1px solid ${tokens.colorBrandStroke1}`,
      outlineOffset: "1px",
    },
    "&:disabled": {
      cursor: "not-allowed",
      color: tokens.colorNeutralForegroundDisabled,
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
  title: {
    flex: "1 1 auto",
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
  /** True while a turn is active (§5.3: rows disabled). */
  locked: boolean;
  /** Group label for the accessible name (§23: `{title}，{group}`). */
  groupLabel: string;
  onOpen: (sessionId: string) => void;
}

export function SessionItem({ session, active, locked, groupLabel, onOpen }: SessionItemProps) {
  const styles = useStyles();
  const title = titleFromText(session.title); // util falls back to 新会话
  const button = (
    <button
      type="button"
      className={styles.row}
      disabled={locked && !active}
      aria-label={`${title}，${groupLabel}`}
      aria-current={active ? "page" : undefined}
      onClick={() => {
        if (!locked || active) onOpen(session.sessionId);
      }}
    >
      <span className={active ? `${styles.title} ${styles.activeTitle}` : styles.title}>{title}</span>
      <span className={styles.time}>{sideTimeLabel(session.createdAt)}</span>
    </button>
  );
  if (locked && !active) {
    // v9 disabled elements swallow pointer events — the Tooltip wraps a span.
    return (
      <Tooltip content={copy["sidebar.switchLocked"]} relationship="label">
        <span>{button}</span>
      </Tooltip>
    );
  }
  return button;
}

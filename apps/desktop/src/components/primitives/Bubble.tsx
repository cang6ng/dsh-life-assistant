/**
 * Bubble primitive (UI Spec §27.2): shared message shell — a rounded panel
 * for the user side, chrome-less for the assistant side — plus the §6.5
 * hover-revealed `HH:mm` caption at the outer edge.
 */

import type { ReactNode } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import { formatClock } from "../../util/format";

// `chinookUserBubbleBg` is a runtime theme token (§6.2) surfaced as the CSS
// custom property --chinook-user-bubble by the theme host in app.tsx.
const USER_BUBBLE_VAR = "var(--chinook-user-bubble)";

const useStyles = makeStyles({
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-end",
    gap: "8px",
    maxWidth: "100%",
  },
  userRow: {
    justifyContent: "flex-end",
  },
  assistantRow: {
    justifyContent: "flex-start",
  },
  user: {
    maxWidth: "70%", // §6.2
    borderRadius: "8px",
    borderBottomRightRadius: "6px", // 2px tail corner (§6.2)
    padding: "8px 12px",
    backgroundColor: USER_BUBBLE_VAR,
    color: tokens.colorNeutralForeground1,
    fontSize: tokens.fontSizeBase300,
    lineHeight: "22px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
  assistant: {
    maxWidth: "100%",
    color: tokens.colorNeutralForeground1,
  },
  time: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    opacity: 0,
    transition: "opacity 150ms ease",
    alignSelf: "center",
    flexShrink: 0,
    fontVariantNumeric: "tabular-nums",
  },
  rowHover: {
    "&:hover .chinook-bubble-time": {
      opacity: 1,
    },
    "&:focus-within .chinook-bubble-time": {
      opacity: 1,
    },
  },
  timeLeft: {
    order: -1, // assistant: caption on the outer (left) edge
  },
});

interface BubbleProps {
  kind: "user" | "assistant";
  ts: number;
  children: ReactNode;
  /** Extra class for the assistant content (markdown body). */
  assistantClassName?: string;
}

/**
 * Shared message shell. `time` is rendered inside the row with a marker
 * class so hover/focus on the row reveals it (§6.5).
 */
export function Bubble({ kind, ts, children, assistantClassName }: BubbleProps) {
  const styles = useStyles();
  const rowCls =
    kind === "user"
      ? `${styles.row} ${styles.userRow} ${styles.rowHover}`
      : `${styles.row} ${styles.assistantRow} ${styles.rowHover}`;
  return (
    <div className={rowCls}>
      {kind === "assistant" && (
        <span className={`${styles.time} ${styles.timeLeft} chinook-bubble-time`} aria-hidden="true">
          {formatClock(ts)}
        </span>
      )}
      {kind === "user" ? (
        <div className={styles.user}>{children}</div>
      ) : (
        <div className={`${styles.assistant} ${assistantClassName ?? ""}`}>{children}</div>
      )}
      {kind === "user" && (
        <span className={`${styles.time} chinook-bubble-time`} aria-hidden="true">
          {formatClock(ts)}
        </span>
      )}
    </div>
  );
}

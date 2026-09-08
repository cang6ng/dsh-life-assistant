/**
 * ScrollToBottomPill (§15.2/§27.1): floating "back to latest" affordance —
 * bottom-center of the conversation column, 8 px above the composer panel.
 * Appears only while auto-follow is off and new content arrived since
 * (§15.2). NeutralBackground1 + border, radius 999, 13 px, subtle shadow;
 * keyboard focusable.
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDownRegular } from "@fluentui/react-icons";
import { copy } from "../../copy";

const useStyles = makeStyles({
  pill: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
    height: "30px",
    padding: "0 14px",
    borderRadius: "999px",
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    boxShadow: tokens.shadow2,
    fontSize: "13px",
    color: tokens.colorNeutralForeground1,
    cursor: "pointer",
    fontFamily: "inherit",
    animationName: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animationDuration: "150ms",
    animationTimingFunction: "ease",
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground1Hover,
    },
    "&:focus-visible": {
      outline: `1px solid ${tokens.colorBrandStroke1}`,
      outlineOffset: "1px",
    },
  },
  icon: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
});

export function ScrollToBottomPill({ onClick }: { onClick: () => void }) {
  const styles = useStyles();
  return (
    <button type="button" className={styles.pill} onClick={onClick}>
      <ArrowDownRegular className={styles.icon} aria-hidden="true" />
      {copy["scroll.backToLatest"]}
    </button>
  );
}

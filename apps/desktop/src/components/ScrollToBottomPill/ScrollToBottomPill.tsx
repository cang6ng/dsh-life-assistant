/**
 * ScrollToBottomPill (§15.2/§27.1): floating "back to latest" affordance —
 * bottom-center of the conversation column, 8 px above the composer panel.
 * Appears only while auto-follow is off and new content arrived since
 * (§15.2). NeutralBackground1 + border, radius 999, 13 px, subtle shadow;
 * keyboard focusable.
 *
 * v1.0.4: the pill is Fluent's `secondary` Button. That appearance already is
 * the §15.2 recipe — `colorNeutralBackground1` surface, `colorNeutralStroke1`
 * hairline, the hover/pressed states and the focus ring — so all this file
 * still owns is the shape (999 px) and the §15.2 entrance fade.
 */

import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { ArrowDownRegular } from "@fluentui/react-icons";
import { copy } from "../../copy";

const useStyles = makeStyles({
  pill: {
    minWidth: "0", // Fluent's Button floor is 96px; the pill is content-sized
    height: "30px",
    padding: "0 14px",
    borderRadius: "999px",
    fontSize: "13px",
    boxShadow: tokens.shadow2,
    animationName: {
      from: { opacity: 0 },
      to: { opacity: 1 },
    },
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  icon: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
  },
});

export function ScrollToBottomPill({ onClick }: { onClick: () => void }) {
  const styles = useStyles();
  return (
    <Button
      appearance="secondary"
      className={styles.pill}
      icon={<ArrowDownRegular className={styles.icon} aria-hidden="true" />}
      onClick={onClick}
    >
      {copy["scroll.backToLatest"]}
    </Button>
  );
}

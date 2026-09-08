/**
 * StatusDot primitive (UI Spec §27.2 / §29): a small round tone dot used by
 * the runtime badge and the status bar. Tones via semantic tokens — the only
 * accent usage is the brand dot when `ready`.
 */

import { makeStyles, tokens } from "@fluentui/react-components";

const useStyles = makeStyles({
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    flexShrink: 0,
  },
  neutral: {
    backgroundColor: tokens.colorNeutralForeground3,
  },
  brand: {
    backgroundColor: tokens.colorBrandBackground,
  },
  danger: {
    backgroundColor: tokens.colorStatusDangerForeground1,
  },
});

export type StatusDotTone = "neutral" | "brand" | "danger";

export function StatusDot({ tone }: { tone: StatusDotTone }) {
  const styles = useStyles();
  const cls =
    tone === "brand" ? styles.brand : tone === "danger" ? styles.danger : styles.neutral;
  return <span className={`${styles.dot} ${cls}`} aria-hidden="true" />;
}

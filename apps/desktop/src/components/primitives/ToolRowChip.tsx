/**
 * ToolRowChip primitive (UI Spec §27.2): one-liner chip carrying a verdict
 * glyph + label, with an optional expand affordance on the right (§11.3).
 *
 * v1.0.4: the shell is Fluent's `Tag`, the error code is Fluent's `Badge`.
 * Both were verified against the installed `@fluentui/react-tags@9.9.5` /
 * `react-badge@9.5.5` before being adopted:
 *
 * - `Tag`'s three grid areas (`media` / `primary` / `dismissIcon`) are exactly
 *   the chip's three parts — tone glyph, label, trailing 展开 action — so the
 *   row's layout is the library's own and no `display` override is needed.
 *   `appearance="outline"` draws `colorSubtleBackground` + `colorNeutralStroke1`
 *   with the §10 6 px radius, which is the chip's box.
 * - `dismissIcon` is a plain span slot, so putting the 展开 `Button` there
 *   keeps the control a real button rather than a clickable div.
 * - The error code used to be a hand-styled span; `Badge appearance="tint"
 *   color="danger"` is the same object with the library's own red pairing, so
 *   it follows the theme instead of hard-coding two palette entries.
 */

import {
  Badge,
  Button,
  Spinner,
  Tag,
  makeStyles,
  mergeClasses,
  shorthands,
  tokens,
} from "@fluentui/react-components";
import { CheckmarkCircleRegular, DismissCircleRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  // §10: 26 px chip, 6 px radius. `Tag`'s own sizes are 24/32, so the box is
  // pinned here; the radius is the library's `borderRadiusMedium` either way.
  chip: {
    minHeight: "26px",
    backgroundColor: tokens.colorNeutralBackground1,
    maxWidth: "100%",
  },
  // Header line inside an expanded panel — the panel owns the border (§10.4),
  // so the chip drops its own.
  chipFlush: {
    backgroundColor: "transparent",
    ...shorthands.borderColor("transparent"),
  },
  tone: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
  },
  ok: {
    color: tokens.colorStatusSuccessForeground1,
  },
  err: {
    color: tokens.colorStatusDangerForeground1,
  },
  running: {
    color: tokens.colorNeutralForeground2,
  },
  // The primary grid cell: label plus the optional code badge, both of which
  // must be able to shrink so the ellipsis works.
  body: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
    minWidth: "0",
    maxWidth: "100%",
  },
  label: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.colorNeutralForeground2,
    minWidth: "0",
    flex: "1 1 auto",
  },
  expand: {
    minWidth: "0",
    height: "22px",
    fontSize: "12px",
    flexShrink: 0,
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    flexShrink: 0,
  },
});

type Kind = "running" | "done" | "error";

export interface ToolRowChipProps {
  kind: Kind;
  label: string;
  /** §10.3: an error's structured code rendered as a small chip, e.g. `ACCESS_DENIED`. */
  code?: string;
  /** 收起详情 style header inside an expanded panel (§10.4). */
  bordered?: boolean;
  /** Toggle affordance text (§11.3: 展开 / 收起). */
  expandLabel?: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  className?: string;
}

/** Tone glyph per kind (§10.3/§29: Spinner / CheckmarkCircle / DismissCircle). */
export function ToolRowChip({
  kind,
  label,
  code,
  bordered = true,
  expandLabel,
  expanded,
  onToggleExpand,
  className,
}: ToolRowChipProps) {
  const styles = useStyles();
  const tone =
    kind === "running" ? (
      <Spinner size="tiny" aria-label={label} />
    ) : kind === "done" ? (
      <CheckmarkCircleRegular aria-hidden="true" />
    ) : (
      <DismissCircleRegular aria-hidden="true" />
    );
  const toneClass =
    kind === "running" ? styles.running : kind === "done" ? styles.ok : styles.err;

  return (
    <Tag
      size="small"
      appearance="outline"
      className={mergeClasses(styles.chip, !bordered && styles.chipFlush, className)}
      media={
        <span className={mergeClasses(styles.tone, toneClass)} aria-hidden={kind === "running" ? undefined : true}>
          {tone}
        </span>
      }
      primaryText={
        <span className={styles.body}>
          {code !== undefined && (
            <Badge className={styles.code} appearance="tint" color="danger" size="small">
              {code}
            </Badge>
          )}
          <span className={styles.label}>{label}</span>
          {/* The trailing action rides inside the primary cell rather than in
              `Tag`'s `dismissIcon` slot: that slot is gated on `dismissible`
              (renderTag renders it only when `state.dismissible`), and turning
              it on would make the whole Tag a `<button>` — the expand control
              would then be a button inside a button. */}
          {expandLabel !== undefined && onToggleExpand !== undefined && (
            <Button
              appearance="subtle"
              size="small"
              className={styles.expand}
              onClick={onToggleExpand}
              aria-expanded={expanded === true}
            >
              {expandLabel}
            </Button>
          )}
        </span>
      }
    />
  );
}

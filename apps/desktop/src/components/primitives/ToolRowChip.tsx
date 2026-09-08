/**
 * ToolRowChip primitive (UI Spec §27.2): one-liner chip carrying a verdict
 * glyph + label, with an optional expand affordance on the right (§11.3).
 */

import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import { CheckmarkCircleRegular, DismissCircleRegular } from "@fluentui/react-icons";

const useStyles = makeStyles({
  chip: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
    minHeight: "26px",
    padding: "2px 6px 2px 8px",
    borderRadius: tokens.borderRadiusMedium, // 6px (§10 tools)
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    fontSize: "13px",
    lineHeight: "18px",
    maxWidth: "100%",
  },
  // Header line inside an expanded panel — the panel owns the border (§10.4).
  chipFlush: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "6px",
    minHeight: "26px",
    padding: "0 2px",
    fontSize: "13px",
    lineHeight: "18px",
    maxWidth: "100%",
  },
  ok: {
    color: tokens.colorStatusSuccessForeground1,
    flexShrink: 0,
    display: "inline-flex",
  },
  err: {
    color: tokens.colorStatusDangerForeground1,
    flexShrink: 0,
    display: "inline-flex",
  },
  running: {
    color: tokens.colorNeutralForeground2,
    flexShrink: 0,
    display: "inline-flex",
  },
  label: {
    color: tokens.colorNeutralForeground2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    flex: "1 1 auto",
  },
  expand: {
    marginLeft: "auto",
    padding: "0 4px",
    minWidth: "0",
    height: "22px",
    fontSize: "12px",
    flexShrink: 0,
  },
  code: {
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "11px",
    lineHeight: "16px",
    padding: "0 5px",
    borderRadius: "3px",
    backgroundColor: tokens.colorPaletteRedBackground2,
    color: tokens.colorStatusDangerForeground1,
    flexShrink: 0,
    whiteSpace: "nowrap",
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
  onClick?: () => void;
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
  onClick,
  className,
}: ToolRowChipProps) {
  const styles = useStyles();
  const row = (
    <>
      {kind === "running" ? (
        <span className={styles.running}>
          <Spinner size="tiny" aria-label={label} />
        </span>
      ) : kind === "done" ? (
        <span className={styles.ok}>
          <CheckmarkCircleRegular aria-hidden="true" />
        </span>
      ) : (
        <span className={styles.err}>
          <DismissCircleRegular aria-hidden="true" />
        </span>
      )}
      {code !== undefined && <span className={styles.code}>{code}</span>}
      <span className={styles.label}>{label}</span>
      {expandLabel !== undefined && onToggleExpand !== undefined && onClick === undefined && (
        <Button
          appearance="subtle"
          size="small"
          className={styles.expand}
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand();
          }}
          aria-expanded={expanded === true}
        >
          {expandLabel}
        </Button>
      )}
    </>
  );
  const chipCls = bordered ? styles.chip : styles.chipFlush;
  if (onClick !== undefined) {
    // Whole-row button (§11.3: the collapsed strip line is clickable).
    return (
      <button
        type="button"
        className={`${chipCls} ${className ?? ""}`}
        onClick={onClick}
        aria-expanded={expanded === true}
      >
        {row}
      </button>
    );
  }
  return <span className={`${chipCls} ${className ?? ""}`}>{row}</span>;
}

/**
 * ToolDetailPanel (§10.4/§27.1): the second technical layer under a tool row
 * header — 参数 (pretty JSON) · 结果 (pretty JSON / raw error) · 耗时 · 状态
 * (成功 / error code). Code face 12.5 px, pre-wrap, NeutralBackground3 panel,
 * max-height 240 px with internal scroll. The full raw *timeline* lives only
 * in the Activity Drawer (§12) — never here.
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import type { ToolActivity } from "../../protocol/types";
import { copy } from "../../copy";
import { formatDuration } from "../../util/format";

const useStyles = makeStyles({
  // Vertical rhythm inside the §10.4 panel comes from the Card's own gap
  // (`--fui-Card--size`), so the rows carry no margin of their own.
  fields: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  row: {
    display: "flex",
    flexDirection: "row",
    gap: "10px",
    alignItems: "flex-start",
  },
  label: {
    width: "44px",
    flexShrink: 0,
    fontSize: "12px",
    lineHeight: "20px",
    color: tokens.colorNeutralForeground3,
    paddingTop: "8px",
  },
  value: {
    flex: "1 1 auto",
    minWidth: "0",
    maxHeight: "240px", // §10.4
    overflow: "auto",
    margin: 0,
    padding: "8px 10px",
    borderRadius: "4px",
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12.5px",
    lineHeight: "18px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: tokens.colorNeutralForeground2,
  },
  meta: {
    display: "flex",
    flexDirection: "row",
    gap: "24px",
    fontSize: "12px",
    lineHeight: "16px",
    color: tokens.colorNeutralForeground2,
    paddingTop: "2px",
  },
  okStatus: {
    color: tokens.colorStatusSuccessForeground1,
  },
  errStatus: {
    color: tokens.colorStatusDangerForeground1,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
  },
  runningStatus: {
    color: tokens.colorNeutralForeground3,
  },
});

function pretty(v: unknown): string {
  if (v === undefined) return "—";
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export function ToolDetailPanel({ tool }: { tool: ToolActivity }) {
  const styles = useStyles();
  // §10.4 结果 for a failed tool carries the raw error (message + code);
  // for a successful tool the structured result body.
  const resultValue = tool.ok ? tool.result : tool.error ? { error: tool.error } : undefined;
  const status = tool.ok ? (
    <span className={styles.okStatus}>{copy["detail.statusOk"]}</span>
  ) : (
    <span className={styles.errStatus}>{tool.error?.code ?? copy["err.tool.unknown"]}</span>
  );
  return (
    <div className={styles.fields}>
      <div className={styles.row}>
        <span className={styles.label}>{copy["detail.args"]}</span>
        <pre className={styles.value}>{pretty(tool.arguments)}</pre>
      </div>
      <div className={styles.row}>
        <span className={styles.label}>{copy["detail.result"]}</span>
        <pre className={styles.value}>{pretty(resultValue)}</pre>
      </div>
      <div className={styles.meta}>
        <span>
          {copy["detail.duration"]} {formatDuration(tool.durationMs)}
        </span>
        <span>
          {copy["detail.status"]} {status}
        </span>
      </div>
    </div>
  );
}

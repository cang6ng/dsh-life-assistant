/**
 * StatusBar (§16.6/§27.1): 28 px quiet chrome — left dot + short status text,
 * right caption (`deepseek-v4-flash · 会话已自动保存`, or `Agent 正在回答…`
 * while a turn runs).
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { StatusDot, type StatusDotTone } from "../primitives/StatusDot";

const useStyles = makeStyles({
  bar: {
    height: "28px",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "7px",
    padding: "0 14px",
    backgroundColor: tokens.colorNeutralBackground2,
    borderTop: `1px solid ${tokens.colorNeutralStroke1}`,
    flexShrink: 0,
  },
  status: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground2,
  },
  right: {
    marginLeft: "auto",
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
});

function toneFor(status: string): StatusDotTone {
  switch (status) {
    case "ready":
      return "brand";
    case "disconnected":
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

const STATUS_TEXT: Record<string, string> = {
  starting: copy["status.starting"],
  ready: copy["status.ready"],
  restoring: copy["status.restoring"],
  disconnected: copy["status.disconnected"],
  error: copy["status.error"],
  restarting: copy["status.restarting"],
};

export function StatusBar() {
  const styles = useStyles();
  const { state } = useApp();
  const busy = state.activeTurn !== null;
  const left = STATUS_TEXT[state.runtime.status] ?? state.runtime.status;
  const right = busy ? copy["status.busy"] : state.runtime.status === "ready" ? copy["status.model"] : "";
  return (
    <footer className={styles.bar}>
      <StatusDot tone={toneFor(state.runtime.status)} />
      <span className={styles.status}>{left}</span>
      {right !== "" && <span className={styles.right}>{right}</span>}
    </footer>
  );
}

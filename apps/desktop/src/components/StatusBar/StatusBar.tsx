/**
 * StatusBar (§16.6/§27.1): 28 px quiet chrome — left dot + short status text,
 * right caption (`{model} · 会话已自动保存`, or `Agent 正在回答…` while a turn
 * runs). The model comes from `state.config`, whose only field this is — the
 * endpoint and the credential deliberately never reach the store (§44).
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import { copy, statusModelCopy } from "../../copy";
import { useApp } from "../../appContext";
import { StatusDot, type StatusDotTone } from "../primitives/StatusDot";

/** Shown until the first `config.get` lands (and whenever it cannot). */
const FALLBACK_MODEL = "deepseek-v4-flash";

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
  const right = busy
    ? copy["status.busy"]
    : state.runtime.status === "ready"
      ? statusModelCopy(state.config?.model ?? FALLBACK_MODEL)
      : "";
  return (
    <footer className={styles.bar}>
      <StatusDot tone={toneFor(state.runtime.status)} />
      <span className={styles.status}>{left}</span>
      {right !== "" && <span className={styles.right}>{right}</span>}
    </footer>
  );
}

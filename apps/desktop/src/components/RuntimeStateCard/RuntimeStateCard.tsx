/**
 * RuntimeStateCard (§16/§27.1): one component, variant prop —
 * starting / disconnected / error / restarting. Replaces the whole main
 * region content (DesktopShell). `restoring` never reaches here — it keeps
 * the content area visible (§5.4 loader instead).
 */

import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { copy } from "../../copy";
import { useApp } from "../../appContext";

const useStyles = makeStyles({
  host: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  card: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: "12px",
    maxWidth: "440px",
    padding: "28px 36px",
    textAlign: "center",
  },
  title: {
    fontSize: "17px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  sub: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground2,
    lineHeight: "20px",
  },
  detail: {
    width: "100%",
    textAlign: "left",
  },
  raw: {
    margin: 0,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12.5px",
    lineHeight: "18px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    maxHeight: "160px",
    overflowY: "auto",
    backgroundColor: tokens.colorNeutralBackground3,
    borderRadius: tokens.borderRadiusMedium,
    padding: "8px 10px",
    color: tokens.colorNeutralForeground2,
  },
  caption: {
    fontSize: "12px",
    color: tokens.colorStatusDangerForeground1,
  },
  actions: {
    display: "flex",
    flexDirection: "row",
    gap: "10px",
    marginTop: "6px",
  },
});

export type RuntimeCardVariant = "starting" | "disconnected" | "error" | "restarting";

export function RuntimeStateCard({ variant }: { variant: RuntimeCardVariant }) {
  const styles = useStyles();
  const { state, actions } = useApp();
  const [retryFailed, setRetryFailed] = useState(false);
  const prevStatus = useRef(state.runtime.status);

  // restarting → error again ⇒ the reconnect failed (§16.2 caption).
  useEffect(() => {
    const before = prevStatus.current;
    prevStatus.current = state.runtime.status;
    if (before === "restarting" && state.runtime.status === "error") {
      setRetryFailed(true);
    }
  }, [state.runtime.status]);

  const busy = variant === "starting" || variant === "restarting";
  let title: string;
  let sub: string | null = null;
  let raw: string | null = null;
  let action: string | null = null;
  let onAction: (() => void) | null = null;
  // The second way out of the error card. A missing or rejected credential is
  // the most common cause of reaching this card at all, and restarting the
  // agent cannot fix either — 模型设置 can.
  let secondary: string | null = null;
  let onSecondary: (() => void) | null = null;

  switch (variant) {
    case "starting":
      title = copy["card.starting.title"];
      break;
    case "restarting":
      title = copy["status.restarting"];
      break;
    case "disconnected":
      title = copy["card.disconnected.title"];
      sub = copy["card.disconnected.sub"];
      action = copy["card.disconnected.action"];
      onAction = () => {
        setRetryFailed(false);
        void actions.restartAgent();
      };
      break;
    case "error":
      title = copy["card.error.title"];
      raw = state.runtime.detail ?? copy["err.turn.unknown"];
      action = copy["card.error.action"];
      onAction = () => {
        setRetryFailed(false);
        void actions.restartAgent();
      };
      secondary = copy["card.config.action"];
      onSecondary = actions.openConfig;
      break;
  }

  return (
    <div className={styles.host}>
      <div className={styles.card} role="status">
        {busy && <Spinner size="medium" aria-hidden="true" />}
        <Text className={styles.title}>{title}</Text>
        {sub !== null && <Text className={styles.sub}>{sub}</Text>}
        {raw !== null && variant === "error" && (
          <div className={styles.detail}>
            <Accordion collapsible>
              <AccordionItem value="detail">
                <AccordionHeader size="small">查看详情</AccordionHeader>
                <AccordionPanel>
                  <pre className={styles.raw}>{raw}</pre>
                </AccordionPanel>
              </AccordionItem>
            </Accordion>
          </div>
        )}
        {action !== null && onAction !== null && (
          <div className={styles.actions}>
            <Button appearance="primary" onClick={onAction}>
              {action}
            </Button>
            {secondary !== null && onSecondary !== null && (
              <Button appearance="secondary" onClick={onSecondary}>
                {secondary}
              </Button>
            )}
          </div>
        )}
        {retryFailed && <Text className={styles.caption}>{copy["card.error.retryFailed"]}</Text>}
      </div>
    </div>
  );
}

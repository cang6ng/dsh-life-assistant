/**
 * TitleBar (§4.3/§27.1): brand (drag region) · RuntimeStatusBadge ·
 * ActivityEntryButton · WindowControls. 40 px; custom chrome since the host
 * window is undecorated (decorations: false).
 */

import { useEffect, useState } from "react";
import { Button, Spinner, makeStyles, tokens } from "@fluentui/react-components";
import {
  DismissRegular,
  SquareMultipleRegular,
  SquareRegular,
  SubtractRegular,
} from "@fluentui/react-icons";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { RuntimeStatusBadge } from "../RuntimeStatusBadge/RuntimeStatusBadge";

const useStyles = makeStyles({
  bar: {
    height: "40px",
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "12px",
    paddingLeft: "14px",
    paddingRight: "6px",
    backgroundColor: tokens.colorNeutralBackground2,
    userSelect: "none",
    flexShrink: 0,
  },
  brand: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    alignSelf: "stretch",
    cursor: "default",
  },
  dot: {
    width: "8px",
    height: "8px",
    borderRadius: "50%",
    backgroundColor: tokens.colorBrandBackground,
    flexShrink: 0,
  },
  title: {
    fontSize: "14px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
    whiteSpace: "nowrap",
  },
  spacer: {
    flex: "1 1 auto",
    alignSelf: "stretch",
  },
  activity: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
  },
  controls: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
  },
  controlButton: {
    minWidth: "34px",
    width: "34px",
    height: "28px",
    borderRadius: "4px",
    margin: "0 1px",
  },
});

/** Activity entry — ghost “活动” button with a running spinner (§12.2/§29). */
function ActivityEntryButton() {
  const styles = useStyles();
  const { state, actions } = useApp();
  const busy = state.activeTurn !== null;
  return (
    <Button
      appearance="subtle"
      size="small"
      aria-label={copy["activity.button"]}
      onClick={actions.toggleDrawer}
    >
      <span className={styles.activity}>
        {busy && <Spinner size="tiny" aria-hidden="true" />}
        {copy["activity.button"]}
      </span>
    </Button>
  );
}

/** Standard Windows minimize / maximize-restore / close (§4.3, §29). */
function WindowControls() {
  const styles = useStyles();
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    let live = true;
    const refresh = (): void => {
      void win.isMaximized().then((m) => {
        if (live) setMaximized(m);
      });
    };
    refresh();
    let unlisten: (() => void) | undefined;
    void win.onResized(() => refresh()).then((fn) => {
      if (!live) fn();
      else unlisten = fn;
    });
    return () => {
      live = false;
      unlisten?.();
    };
  }, []);

  return (
    <div className={styles.controls} aria-label="窗口控制">
      <Button
        appearance="subtle"
        className={styles.controlButton}
        aria-label="最小化"
        icon={<SubtractRegular aria-hidden="true" />}
        onClick={() => void invoke("window_minimize")}
      />
      <Button
        appearance="subtle"
        className={styles.controlButton}
        aria-label={maximized ? "还原" : "最大化"}
        icon={maximized ? <SquareMultipleRegular aria-hidden="true" /> : <SquareRegular aria-hidden="true" />}
        onClick={() => void invoke("window_toggle_maximize")}
      />
      <Button
        appearance="subtle"
        className={styles.controlButton}
        aria-label="关闭"
        icon={<DismissRegular aria-hidden="true" />}
        onClick={() => void invoke("window_close")}
      />
    </div>
  );
}

export function TitleBar() {
  const styles = useStyles();
  const { state } = useApp();
  return (
    <div className={styles.bar}>
      {/* The brand area is the window drag region (Tauri v2 data attribute). */}
      <div className={styles.brand} data-tauri-drag-region>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.title}>{copy["app.title"]}</span>
      </div>
      <RuntimeStatusBadge status={state.runtime.status} />
      <div className={styles.spacer} data-tauri-drag-region />
      <ActivityEntryButton />
      <WindowControls />
    </div>
  );
}

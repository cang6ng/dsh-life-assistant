/**
 * TitleBar (§4.3/§27.1): brand (drag region) · RuntimeStatusBadge ·
 * ThemeToggleButton · SettingsEntryButton · ActivityEntryButton ·
 * WindowControls. 40 px; custom chrome since the host window is undecorated
 * (decorations: false).
 *
 * The bar stays a flex row rather than a Fluent Toolbar: Toolbar brings its
 * own height and an overflow menu, and a 40 px undecorated bar cannot afford
 * either — an overflow menu would swallow the window controls.
 */

import { useEffect, useState } from "react";
import {
  Button,
  Spinner,
  ToggleButton,
  Tooltip,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import {
  DismissRegular,
  SettingsRegular,
  SquareMultipleRegular,
  SquareRegular,
  SubtractRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
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
  domain: {
    fontSize: "12px",
    fontWeight: 400,
    color: tokens.colorNeutralForeground3,
    whiteSpace: "nowrap",
  },
  domainSeparator: {
    color: tokens.colorNeutralForeground4,
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

/**
 * 设置 — present in EVERY runtime state, deliberately: a first-run user with
 * no credential configured lands on the error card, and this has to be
 * reachable from there or there is no way forward inside the product.
 *
 * Keeps the position the 模型设置 button held; the model endpoint is now the
 * panel's 模型 tab.
 */
function SettingsEntryButton() {
  const styles = useStyles();
  const { actions } = useApp();
  return (
    <Button
      appearance="subtle"
      size="small"
      aria-label={copy["config.button"]}
      onClick={actions.openConfig}
    >
      <span className={styles.activity}>
        <SettingsRegular aria-hidden="true" />
        {copy["config.button"]}
      </span>
    </Button>
  );
}

/**
 * The one-click appearance toggle (§18 as amended by v1.0.4). It is a plain
 * Fluent ToggleButton driving the app's own FluentProvider swap — the library
 * ships no theme switcher, and this needs no styling of its own beyond the
 * icon it advertises.
 *
 * The icon shows what a click *gives you* (a moon while light, a sun while
 * dark), which is the convention Windows uses for the same control.
 */
function ThemeToggleButton() {
  const { scheme, actions } = useApp();
  const dark = scheme === "dark";
  const label = dark ? copy["theme.toggle.toLight"] : copy["theme.toggle.toDark"];
  return (
    <Tooltip content={label} relationship="label">
      <ToggleButton
        appearance="subtle"
        size="small"
        checked={dark}
        aria-label={label}
        icon={dark ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
        onClick={actions.toggleTheme}
      />
    </Tooltip>
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
    // The bar itself carries a bare drag region, so the padding and the gaps
    // between the entry buttons move the window too — a bare attribute only
    // fires when the click lands on that element itself, and every child is
    // either clickable (blocks the drag) or has its own region.
    <div className={styles.bar} data-tauri-drag-region>
      {/* The brand block is the primary drag handle. "deep" rather than bare:
          a bare attribute only fires when the click's target *is* the element,
          which the title text, the dot and the domain span are not — clicking
          the word "DSH Life Assistant" would otherwise not move the window. */}
      <div className={styles.brand} data-tauri-drag-region="deep">
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.title}>{copy["app.title"]}</span>
        <span className={styles.domainSeparator} aria-hidden="true">
          ·
        </span>
        <span className={styles.domain}>{copy["app.domain"]}</span>
      </div>
      <RuntimeStatusBadge status={state.runtime.status} />
      <div className={styles.spacer} data-tauri-drag-region />
      <ThemeToggleButton />
      <SettingsEntryButton />
      <ActivityEntryButton />
      <WindowControls />
    </div>
  );
}

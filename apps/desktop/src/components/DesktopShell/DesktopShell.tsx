/**
 * DesktopShell (§4/§16/§22/§23.2/§27.1): the window skeleton —
 * TitleBar (40 px) · main region (sidebar or 44 px rail ↔ content /
 * runtime state card) · StatusBar (28 px). Runtime state cards (§16) replace
 * the conversation column's content only — the sidebar stays visible with
 * disabled rows. Width < 900 px collapses the sidebar into the rail overlay
 * (§22); global shortcuts Ctrl+N / Esc / Ctrl+Alt+A (§23.2).
 */

import { useEffect, useState } from "react";
import { Button, makeStyles, tokens, Tooltip } from "@fluentui/react-components";
import { AddRegular, PanelLeftRegular } from "@fluentui/react-icons";
import type { RuntimeStatus } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { TitleBar } from "../TitleBar/TitleBar";
import { StatusBar } from "../StatusBar/StatusBar";
import { SessionSidebar } from "../SessionSidebar/SessionSidebar";
import { ConversationView } from "../ConversationView/ConversationView";
import { RuntimeStateCard, type RuntimeCardVariant } from "../RuntimeStateCard/RuntimeStateCard";
import { ActivityDrawer } from "../ActivityDrawer/ActivityDrawer";
import { ApiConfigPanel } from "../ApiConfig/ApiConfigPanel";

const NARROW_QUERY = "(max-width: 899px)"; // §22 content-width threshold

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    // Containing block for the ApiConfig modal, which covers the whole window
    // (title bar and status bar included) rather than only the main region.
    position: "relative",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  main: {
    flex: "1 1 auto",
    minHeight: "0",
    display: "flex",
    flexDirection: "row",
    position: "relative",
  },
  conversation: {
    flex: "1 1 auto",
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
  },
  cardHost: {
    flex: "1 1 auto",
    minWidth: "0",
    display: "flex",
    flexDirection: "column",
  },
  rail: {
    width: "44px",
    flexShrink: 0,
    backgroundColor: tokens.colorNeutralBackground2,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingTop: "10px",
    gap: "4px",
  },
  railButton: {
    width: "32px",
    minWidth: "32px",
    height: "32px",
  },
  overlayHost: {
    position: "absolute",
    inset: 0,
    zIndex: 30,
    display: "flex",
    flexDirection: "row",
  },
  scrim: {
    flex: "1 1 auto",
    cursor: "pointer",
    backgroundColor: "color-mix(in srgb, var(--colorNeutralBackground1) 55%, transparent)",
  },
  overlayPanel: {
    width: "264px",
    flexShrink: 0,
    boxShadow: tokens.shadow16,
    zIndex: 31,
  },
});

const CARD_STATES: ReadonlySet<RuntimeStatus> = new Set(["starting", "disconnected", "error", "restarting"]);

/**
 * Rail variant (§22): 44 px column — ＋ (new session) above the panel-open
 * affordance; both respect the turn lock via their tooltip state.
 */
function Rail({ onOpenPanel }: { onOpenPanel?: () => void }) {
  const styles = useStyles();
  const { state, actions } = useApp();
  const locked = state.activeTurn !== null;
  const tip = locked ? copy["sidebar.switchLocked"] : copy["newSession"];
  const plus = (
    <Button
      className={styles.railButton}
      appearance="subtle"
      aria-label={copy["newSession"]}
      icon={<AddRegular aria-hidden="true" />}
      disabled={locked}
      onClick={() => void actions.newSession()}
    />
  );
  return (
    <div className={styles.rail}>
      <Tooltip content={tip} relationship="label">
        <span>{plus}</span>
      </Tooltip>
      {onOpenPanel !== undefined && (
        <Tooltip content={copy["sidebar.open"]} relationship="label">
          <Button
            className={styles.railButton}
            appearance="subtle"
            aria-label={copy["sidebar.open"]}
            icon={<PanelLeftRegular aria-hidden="true" />}
            onClick={onOpenPanel}
          />
        </Tooltip>
      )}
    </div>
  );
}

export function DesktopShell() {
  const styles = useStyles();
  const { state, actions } = useApp();
  const status = state.runtime.status;
  const [narrow, setNarrow] = useState(() => window.matchMedia(NARROW_QUERY).matches);
  const [railOpen, setRailOpen] = useState(false);

  // §22: window width drives the rail collapse (640–899 px content width).
  useEffect(() => {
    const mq = window.matchMedia(NARROW_QUERY);
    const onChange = (): void => {
      setNarrow(mq.matches);
      if (!mq.matches) setRailOpen(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // §23.2 shortcuts: Ctrl+N new session, Esc closes drawer / rail overlay,
  // Ctrl+Alt+A toggles the activity drawer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "n") {
        e.preventDefault();
        void actions.newSession();
        return;
      }
      if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        actions.toggleDrawer();
        return;
      }
      if (e.key === "Escape") {
        // Outermost surface first: the settings modal sits above the drawer,
        // which sits above the narrow-window rail overlay.
        if (state.ui.configOpen) {
          actions.closeConfig();
        } else if (state.ui.drawerOpen) {
          actions.closeDrawer();
        } else if (railOpen) {
          setRailOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [actions, state.ui.configOpen, state.ui.drawerOpen, railOpen]);

  const showCard = CARD_STATES.has(status);
  return (
    <div className={styles.root}>
      <TitleBar />
      <div className={styles.main}>
        {narrow ? <Rail onOpenPanel={() => setRailOpen(true)} /> : <SessionSidebar />}
        {showCard ? (
          <div className={styles.cardHost}>
            <RuntimeStateCard variant={status as RuntimeCardVariant} />
          </div>
        ) : (
          <div className={styles.conversation}>
            <ConversationView />
          </div>
        )}
        <ActivityDrawer />
        {narrow && !showCard && railOpen && (
          <div className={styles.overlayHost}>
            <div
              className={styles.scrim}
              onClick={() => setRailOpen(false)}
              aria-hidden="true"
            />
            <div
              className={styles.overlayPanel}
              onClickCapture={(e) => {
                // §22: closing on selection — any button click in the panel.
                if (e.target instanceof HTMLElement && e.target.closest("button") !== null) {
                  setRailOpen(false);
                }
              }}
            >
              <SessionSidebar />
            </div>
          </div>
        )}
      </div>
      <StatusBar />
      {state.ui.configOpen && <ApiConfigPanel />}
    </div>
  );
}

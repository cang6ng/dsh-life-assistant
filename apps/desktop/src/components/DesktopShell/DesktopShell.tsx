/**
 * DesktopShell (§4/§16/§22/§23.2/§27.1): the window skeleton —
 * TitleBar (40 px) · main region (sidebar or 44 px rail ↔ content /
 * runtime state card) · StatusBar (28 px). Runtime state cards (§16) replace
 * the conversation column's content only — the sidebar stays visible with
 * disabled rows. Width < 900 px collapses the sidebar into the rail overlay
 * (§22); global shortcuts Ctrl+N / Esc / Ctrl+Alt+A (§23.2).
 *
 * Both overlays in this file are Fluent `OverlayDrawer`s, one per §22/§12.4,
 * and neither the rail panel nor the activity drawer is positioned by hand.
 * They differ in exactly one prop: the rail panel is modal (scrim, focus trap,
 * Esc) and the activity drawer is not (§12.4's "Backdrop: none, ever"). Both
 * mount inside the main region so they sit between the bars rather than over
 * the window controls — see the note on `contain: paint` below.
 */

import { useEffect, useState } from "react";
import { Button, makeStyles, OverlayDrawer, tokens, Tooltip } from "@fluentui/react-components";
import { AddRegular, PanelLeftRegular } from "@fluentui/react-icons";
import type { RuntimeStatus } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { DRAWER_SURFACE_MOTION } from "../../motion";
import { TitleBar } from "../TitleBar/TitleBar";
import { StatusBar } from "../StatusBar/StatusBar";
import { SessionSidebar } from "../SessionSidebar/SessionSidebar";
import { ConversationView } from "../ConversationView/ConversationView";
import { RuntimeStateCard, type RuntimeCardVariant } from "../RuntimeStateCard/RuntimeStateCard";
import { ActivityDrawer } from "../ActivityDrawer/ActivityDrawer";
import { SettingsPanel } from "../Settings/SettingsPanel";

const NARROW_QUERY = "(max-width: 899px)"; // §22 content-width threshold

const useStyles = makeStyles({
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    position: "relative",
    backgroundColor: tokens.colorNeutralBackground1,
  },
  main: {
    flex: "1 1 auto",
    minHeight: "0",
    display: "flex",
    flexDirection: "row",
    position: "relative",
    // The activity drawer is a Fluent OverlayDrawer, whose surface is
    // `position: fixed` against the viewport — top:0/bottom:0, i.e. over the
    // title bar and the window controls. §12.4 wants it "below the title bar,
    // above the status bar", which is exactly this element's box: paint
    // containment makes it the containing block for fixed descendants, so the
    // drawer's inset follows the 40 px and 28 px bars instead of duplicating
    // their heights. (Verified: without this the surface spans 0→viewport, with
    // it 40→height−28.)
    contain: "paint",
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
  // §22: the overlay panel is 264 px, the same width as the docked sidebar it
  // replaces. Fluent's size presets are 320/592/940/full, so the width goes
  // through the same custom property Fluent sizes itself from — which is also
  // what the slide in DRAWER_SURFACE_MOTION travels by.
  railDrawer: {
    "--fui-Drawer--size": "264px",
    boxShadow: tokens.shadow16,
    // Above the activity drawer, which is a sibling in this region with no
    // z-index of its own. (The backdrop needs none: it precedes the surface in
    // the portal, so it already paints underneath.)
    zIndex: 40,
  },
  // The drawer's root is a flex column with `alignItems: flex-start`, so a
  // child does not stretch — the sidebar is only full-height if something
  // between the two says so.
  railBody: {
    display: "flex",
    flexDirection: "column",
    alignSelf: "stretch",
    flex: "1 1 auto",
    minHeight: "0",
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
  // The activity drawer is portaled into this element (see `contain: paint`
  // above). Held in state rather than a ref because `mountNode` wants an
  // element, and the portal can only be given one once it exists — which
  // happens in the same commit's ref phase, before the first paint.
  const [mainEl, setMainEl] = useState<HTMLDivElement | null>(null);

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
      <div className={styles.main} ref={setMainEl}>
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
        {/* Mounted only once the region exists. Mounting it earlier would hand
            the portal a `null` mount node and then move it in the next commit,
            and that remount discards the presence component's initial styles:
            the closed surface would stay at its natural position — i.e. open
            on screen — until the first open/close cycle moved it out. */}
        {mainEl !== null && <ActivityDrawer mountNode={mainEl} />}
        {narrow && !showCard && (
          <OverlayDrawer
            className={styles.railDrawer}
            open={railOpen}
            position="start"
            // §22's panel opens "with scrim", so the backdrop is wanted here —
            // the converse of §12.4. That is the default `modalType`, which
            // also supplies the two things the hand-rolled overlay lacked:
            // keyboard dismissal (Esc / backdrop click via `onOpenChange`)
            // instead of a click-only `aria-hidden` div, and a focus trap
            // while the panel is up.
            mountNode={mainEl}
            aria-label={copy["sidebar.open"]}
            surfaceMotion={DRAWER_SURFACE_MOTION}
            onOpenChange={(_, data) => {
              if (!data.open) setRailOpen(false);
            }}
          >
            <div className={styles.railBody}>
              {/* §22's other dismissal: picking a session (or starting a new
                  one) closes the panel. That used to be an `onClickCapture`
                  that looked for `closest("button")` — which no longer matches
                  a session row now that rows are tree items, and never matched
                  a keyboard activation anyway. The sidebar reports the
                  navigation instead of the shell guessing at it. */}
              <SessionSidebar onNavigate={() => setRailOpen(false)} />
            </div>
          </OverlayDrawer>
        )}
      </div>
      <StatusBar />
      {state.ui.configOpen && <SettingsPanel />}
    </div>
  );
}

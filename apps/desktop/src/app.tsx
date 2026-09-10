/**
 * App composition root (UI Spec §27 tree, in its frozen order):
 * AppStateProvider (useReducer + the entire IPC effect surface: channel
 * subscription with rAF-batched dispatch §14.1, boot reconcile, and the
 * invoke-response → store-action mapping that the host router requires)
 * renders ThemeHost (FluentProvider + §18's resolved scheme; CSS custom
 * properties --chinook-user-bubble / --chinook-accent for the components
 * that need them).
 *
 * The order matters and is not cosmetic: the appearance preference lives in
 * the store, so the scheme is only knowable *below* the reducer — the theme
 * host used to sit above it and follow matchMedia on its own, which is why
 * there was nowhere for a preference to be read from.
 *
 * Architecture: components call AppActions; AppStateProvider is the only
 * module that imports bridge/client.ts (besides the client module itself).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { FluentProvider, makeStaticStyles, makeStyles, tokens } from "@fluentui/react-components";
import type {
  ApiConfigData,
  ApiConfigModelsDraft,
  ApiConfigPatchData,
  ApiConfigSavedData,
  ApiConfigTestedData,
  ApiModelsListedData,
  Envelope,
} from "./protocol/types";
import { actionFromEvent, type DrawerFilter } from "./store/actions";
import { reducer } from "./store/reducer";
import { INITIAL_STATE, type SettingsTab } from "./store/state";
import {
  nextPreference,
  readThemePreference,
  resolveScheme,
  writeThemePreference,
  type Scheme,
  type ThemePreference,
  type ThemeStorage,
} from "./store/themePreference";
import { buildDarkTheme, buildLightTheme, CHINOOK_ACCENT, type ThemeTokens } from "./theme";
import { DesktopShell } from "./components/DesktopShell/DesktopShell";
import { configRequestFailedCopy, copy } from "./copy";
import {
  AppCtx,
  type AppActions,
  type ApiConfigLoadResult,
  type ApiConfigSaveResult,
  type ApiModelsResult,
  type AppValue,
  type SendResult,
} from "./appContext";
import * as bridge from "./bridge/client";

const useStaticStyles = makeStaticStyles({
  "html, body, #root": {
    height: "100%",
    margin: 0,
    padding: 0,
    overflow: "hidden",
  },
  body: {
    fontFamily:
      '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", system-ui, sans-serif',
    WebkitFontSmoothing: "antialiased",
  },
});

// ---------------------------------------------------------------------------
// ThemeHost
// ---------------------------------------------------------------------------

/**
 * Keeps the shell's height chain definite: #root (100%, static styles above)
 * → FluentProvider → .chinook-app → DesktopShell .root{height:"100%"}.
 * Without a height on these two wrappers the shell resolves against an
 * auto-height parent and sizes to its content, so the conversation's inner
 * scroller never gets a bounded height and long conversations cannot scroll.
 */
const useHostStyles = makeStyles({
  fill: {
    height: "100%",
  },
  /**
   * The app's own surface. It has to be an element *inside* FluentProvider:
   * `tokens.colorNeutralBackground1` compiles to `var(--colorNeutralBackground1)`
   * and that variable is defined on the provider element, so the rule for
   * `html, body, #root` above (ancestors of it) can never resolve one. Without
   * this, the canvas behind the shell keeps WebView2's default white and a
   * dark launch flashes it before the first paint.
   */
  surface: {
    backgroundColor: tokens.colorNeutralBackground1,
    color: tokens.colorNeutralForeground1,
  },
});

/**
 * The OS scheme, and only the OS scheme. It is consulted solely while the
 * preference is 追随系统 (see `resolveScheme`) — an explicit 亮色/暗色 choice
 * must not be yanked around by a Windows theme event.
 */
function useSystemScheme(): Scheme {
  const query = "(prefers-color-scheme: dark)";
  const [dark, setDark] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (): void => setDark(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return dark ? "dark" : "light";
}

/**
 * FluentProvider + the theme host for the resolved scheme (§18). Renders the
 * shell and publishes the two CSS custom properties the components that
 * cannot take a token need (§19.1).
 */
function ThemeHost({ scheme, children }: { scheme: Scheme; children: ReactNode }) {
  const styles = useHostStyles();
  const theme: ThemeTokens = useMemo(
    () => (scheme === "dark" ? buildDarkTheme() : buildLightTheme()),
    [scheme],
  );
  const vars = useMemo(
    () =>
      ({
        "--chinook-user-bubble": theme.chinookUserBubbleBg,
        "--chinook-accent": CHINOOK_ACCENT[scheme],
      }) as CSSProperties,
    [scheme, theme],
  );

  return (
    // `applyStylesToPortals` must be off. Left at its default, FluentProvider
    // publishes its own entire root className as the portal `themeClassName`,
    // so every portal node also receives this provider's surface styles —
    // `background-color: colorNeutralBackground1` from the provider itself and
    // the `height: 100%` this file passes as `className`. Fluent positions a
    // portal node as a full-viewport `position: absolute; inset: 0 auto 0 0;
    // z-index: 1000000` element, so those two make it an opaque full-screen
    // sheet: hovering the theme toggle or opening the model Combobox blanked
    // the whole app. Off, portals get the theme class alone — the CSS
    // variables — which is all the portaled surfaces need.
    <FluentProvider theme={theme} className={styles.fill} applyStylesToPortals={false}>
      <div style={vars} className={`chinook-app ${styles.fill} ${styles.surface}`}>
        {children}
      </div>
    </FluentProvider>
  );
}

// ---------------------------------------------------------------------------
// AppStateProvider
// ---------------------------------------------------------------------------

/** Result of resolving the session a sessionless send must run on (§7.2). */
type EnsureSessionResult = { ok: true; sessionId: string } | { ok: false; code: string };

/**
 * The host's Web Storage, or null where it cannot be reached at all. Reading
 * `window.localStorage` is itself a throw in some policies, which is why the
 * probe is here and the accessors in themePreference.ts only have to cope
 * with a `null`.
 */
function appStorage(): ThemeStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function AppStateProvider({ children }: { children: ReactNode }) {
  useStaticStyles();
  // The stored preference is applied in the lazy initialiser, i.e. within the
  // first render — reading it in an effect instead would paint the wrong
  // scheme for a frame on every launch.
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE, (initial) => ({
    ...initial,
    ui: { ...initial.ui, themePreference: readThemePreference(appStorage()) },
  }));
  const stateRef = useRef(state);
  stateRef.current = state;

  const systemScheme = useSystemScheme();
  const scheme = resolveScheme(state.ui.themePreference, systemScheme);
  const systemSchemeRef = useRef(systemScheme);
  systemSchemeRef.current = systemScheme;

  // The native-chrome half of the theme. `color-scheme` is what WebView2 reads
  // to theme the form controls and scrollbars it draws itself; the CSS side
  // cannot reach them. It is a property write, not a stylesheet, so §27.2's
  // "styles come from griffel" holds. (index.html sets the same property
  // before the bundle loads, so the first paint is already right.)
  useEffect(() => {
    document.documentElement.style.colorScheme = scheme;
  }, [scheme]);

  // Persist only what the user actually chose: the mount pass is skipped, so a
  // user who never opens 外观 leaves no key behind and 追随系统 stays the
  // implicit default it has always been.
  const writtenRef = useRef<ThemePreference | null>(null);
  useEffect(() => {
    const preference = state.ui.themePreference;
    const previous = writtenRef.current;
    writtenRef.current = preference;
    if (previous === null || previous === preference) return;
    writeThemePreference(appStorage(), preference);
  }, [state.ui.themePreference]);

  // A *count*, not a flag: the boot auto-open and a sidebar click can overlap,
  // and the first to finish must not unlock the composer while the second is
  // still in flight.
  const [openingCount, setOpeningCount] = useState(0);
  const beginOpen = useCallback((): void => setOpeningCount((n) => n + 1), []);
  const endOpen = useCallback((): void => setOpeningCount((n) => (n > 0 ? n - 1 : 0)), []);
  const opening = openingCount > 0;
  const retrySessionRef = useRef<string | null>(null);

  // ---- restart recovery (Targeted Repair P1) -------------------------------
  // A respawned bridge boots with NO session bound (single open session,
  // §30.4 #8), so its `ready` must not release the composer while a session
  // was active: Bridge Ready ≠ Desktop Ready. restartAgent arms the target;
  // the next bridge-ready (flush) starts the hold (RESTORE_START → reducer
  // gates ready) and reopens the session; SESSION_OPENED then releases it.
  const restoreTargetRef = useRef<string | null>(null);

  /** Map one response envelope (requestId present, resolved by the host
   *  router to the invoking command — never on the channel) to the store. */
  const applyResponse = useCallback(
    (env: Envelope) => {
      const action = actionFromEvent(env, Date.now());
      if (action !== null) dispatch(action);
    },
    [],
  );

  const responseError = useCallback((env: Envelope): string => {
    if (!bridge.envelopeIsError(env)) return "";
    return bridge.envelopeError(env).message;
  }, []);

  /**
   * Reopen the session that was active before a restart inside the fresh
   * bridge (snapshot hydration restores items/log) — Case A. Success flows
   * through SESSION_OPENED, which releases the reducer hold as ready.
   * Failure surfaces the §16.3 runtime-error card instead of a false ready
   * (Case C); 重新启动 retries the whole restart+restore, and opening any
   * other session / 新会话 recovers via the reducer's bind rule. Never
   * overwrite a fresher host truth (disconnected) with this failure.
   */
  const restoreSession = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const env = await bridge.sessionOpen(sessionId);
      if (bridge.envelopeIsError(env)) {
        if (stateRef.current.runtime.status !== "disconnected") {
          dispatch({
            type: "RUNTIME_STATUS",
            status: "error",
            detail: bridge.envelopeError(env).message,
          });
        }
        return;
      }
      applyResponse(env); // session/opened → SESSION_OPENED releases the hold
    } catch (err) {
      if (stateRef.current.runtime.status !== "disconnected") {
        dispatch({ type: "RUNTIME_STATUS", status: "error", detail: String(err) });
      }
    }
  }, [applyResponse]);

  // ---- event channel (rAF-batched dispatch, §14.1) -----------------------
  const eventQueue = useRef<Envelope[]>([]);
  const flushScheduled = useRef(false);
  const flush = useCallback(() => {
    flushScheduled.current = false;
    const batch = eventQueue.current;
    eventQueue.current = [];
    const ts = Date.now();
    for (const env of batch) {
      const action = actionFromEvent(env, ts);
      if (action === null) continue;
      if (
        action.type === "RUNTIME_STATUS" &&
        action.status === "ready" &&
        restoreTargetRef.current !== null
      ) {
        // Targeted Repair P1: the restart's fresh bridge is ready but has no
        // session bound — hold the desktop at `restoring` (RESTORE_START) and
        // reopen the active session; ready only follows the reopen result.
        const target = restoreTargetRef.current;
        restoreTargetRef.current = null;
        dispatch({ type: "RESTORE_START" });
        void restoreSession(target);
        continue;
      }
      dispatch(action);
    }
  }, [restoreSession]);
  const enqueueEvent = useCallback(
    (env: Envelope) => {
      eventQueue.current.push(env);
      if (!flushScheduled.current) {
        flushScheduled.current = true;
        requestAnimationFrame(flush);
      }
    },
    [flush],
  );

  // ---- boot: subscribe → reconcile status → session list → auto-open ------
  const bootedRef = useRef(false);
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    // §7.2/§13: the whole boot is a restore as far as the screen is concerned,
    // so `opening` is held from the first frame until the session to restore —
    // or the fact that there is none — is known. Opening only for the
    // `session/open` call itself left the session/list round trip painting the
    // empty state and its chips, which the loader then replaced: exactly the
    // flash §7.2 forbids, caught on the boot trace. It also means the composer
    // stays locked for the boot, so a keystroke cannot race the restore into
    // creating a second session. Cleared in `finally` so a failure cannot
    // leave the loader up: OPEN_FAILED puts the §13 failure card there.
    void (async () => {
      beginOpen();
      try {
        await bridge.subscribeEvents(enqueueEvent);
        // Reconcile the runtime status (events may have raced the subscribe).
        const statusEnv = await bridge.agentStatus();
        applyResponse(statusEnv);
        const listEnv = await bridge.sessionList();
        if (bridge.envelopeIsError(listEnv)) return;
        applyResponse(listEnv);
        const sessions = (listEnv.data as { sessions?: { sessionId: string }[] }).sessions ?? [];
        const first = sessions[0];
        // Not if a session is bound already: a send can create one while
        // `session/list` is in flight, and auto-opening over that would
        // replace the conversation on screen and swallow the message
        // streaming into it.
        if (first !== undefined && stateRef.current.activeSessionId === null) {
          retrySessionRef.current = first.sessionId;
          try {
            const openEnv = await bridge.sessionOpen(first.sessionId);
            if (bridge.envelopeIsError(openEnv)) {
              dispatch({ type: "OPEN_FAILED", message: responseError(openEnv) });
            } else {
              applyResponse(openEnv);
            }
          } catch (e) {
            dispatch({ type: "OPEN_FAILED", message: String(e) });
          }
        }
      } finally {
        endOpen();
      }
    })();
  }, [applyResponse, enqueueEvent, responseError, beginOpen, endOpen]);

  // ---- actions -------------------------------------------------------------

  const openSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const st = stateRef.current;
      if (st.activeTurn !== null) return; // §16.5 rows are disabled anyway
      retrySessionRef.current = sessionId;
      beginOpen();
      try {
        const env = await bridge.sessionOpen(sessionId);
        if (bridge.envelopeIsError(env)) {
          dispatch({ type: "OPEN_FAILED", message: responseError(env) });
        } else {
          applyResponse(env);
        }
      } catch (e) {
        dispatch({ type: "OPEN_FAILED", message: String(e) });
      } finally {
        endOpen();
      }
    },
    [applyResponse, responseError, beginOpen, endOpen],
  );

  /**
   * In-flight create. Concurrent callers share it rather than each creating a
   * session: the typed composer and the suggestion chips can both send from
   * the no-conversation screen (§7.2), and 新会话 / Ctrl+N can land while such
   * a send is being set up. Two creates would leave a stray empty session
   * behind — or, if the second response arrives mid-turn, a session the
   * reducer drops on the floor entirely.
   *
   * The response is applied *here*, once, so every joiner sees the same bound
   * session, and the promise resolves with the id: a joiner resuming in a
   * microtask cannot rely on `stateRef` having caught up with the dispatch.
   */
  const createRef = useRef<Promise<EnsureSessionResult> | null>(null);

  const createSession = useCallback((): Promise<EnsureSessionResult> => {
    const inFlight = createRef.current;
    if (inFlight !== null) return inFlight;
    const attempt = (async (): Promise<EnsureSessionResult> => {
      try {
        const env = await bridge.sessionCreate();
        if (bridge.envelopeIsError(env)) {
          return { ok: false, code: bridge.envelopeError(env).code };
        }
        applyResponse(env);
        const data = env.data as { session?: { sessionId?: string } };
        const created = data?.session?.sessionId;
        return created === undefined
          ? { ok: false, code: "NOT_FOUND" }
          : { ok: true, sessionId: created };
      } catch {
        // A rejected invoke (host gone) is not an error envelope. Mapped here
        // so the caller reports 发送失败 instead of throwing into nowhere —
        // and so a rejection is never what the next caller joins.
        return { ok: false, code: "TRANSPORT" };
      } finally {
        createRef.current = null; // settled: a retry starts a fresh attempt
      }
    })();
    createRef.current = attempt;
    return attempt;
  }, [applyResponse]);

  const newSession = useCallback(async (): Promise<void> => {
    if (stateRef.current.activeTurn !== null) return;
    // Shares the in-flight create: asking for 新会话 while a sessionless send
    // is being set up yields the session that send just created — which is a
    // new one, and sending into it is what the user meant either way.
    await createSession();
  }, [createSession]);

  /** The session a sessionless send runs on: the active one, or a fresh one. */
  const ensureSession = useCallback((): Promise<EnsureSessionResult> => {
    const active = stateRef.current.activeSessionId;
    if (active !== null) return Promise.resolve({ ok: true, sessionId: active });
    return createSession();
  }, [createSession]);

  const send = useCallback(
    async (text: string): Promise<SendResult> => {
      const st = stateRef.current;
      if (st.runtime.status !== "ready" || st.activeTurn !== null) {
        return { ok: false, code: "NOT_READY" };
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) return { ok: false, code: "INVALID_ARGUMENT" };
      // The typed composer and the suggestion chips both reach a
      // no-conversation screen; either creates the session first (§7.2).
      const session = await ensureSession();
      if (!session.ok) return { ok: false, code: session.code };
      let env: Envelope;
      try {
        env = await bridge.turnSend(session.sessionId, trimmed);
      } catch {
        // A rejected invoke is the §17.2 transport failure too — report it as
        // one so the composer says 发送失败，请重试 with the text still in the
        // box, rather than rejecting a promise nobody is catching.
        return { ok: false, code: "TRANSPORT" };
      }
      if (bridge.envelopeIsError(env)) {
        return { ok: false, code: bridge.envelopeError(env).code };
      }
      return { ok: true };
    },
    [ensureSession],
  );

  const retryOpen = useCallback(async (): Promise<void> => {
    const target = retrySessionRef.current;
    if (target !== null) {
      dispatch({ type: "OPEN_RETRY" });
      await openSession(target);
    }
  }, [openSession]);

  const restoreClose = useCallback(async (): Promise<void> => {
    // §13 关闭 → the bridge creates a fresh session (empty state).
    await newSession();
  }, [newSession]);

  const restartAgent = useCallback(async (): Promise<void> => {
    // P1: a reconnect while a session is active arms the reopen of that
    // session in the fresh bridge — the desktop is only ready again after it
    // (no active session → plain ready, Case B).
    restoreTargetRef.current = stateRef.current.activeSessionId;
    dispatch({ type: "RUNTIME_STATUS", status: "restarting" });
    const env = await bridge.agentRestart();
    if (bridge.envelopeIsError(env)) {
      restoreTargetRef.current = null;
      dispatch({
        type: "RUNTIME_STATUS",
        status: "error",
        detail: bridge.envelopeError(env).message,
      });
    }
  }, []);

  // ---- model-endpoint configuration (§4.3, v1.0.2) ------------------------
  // These four are the ONLY path by which a model credential leaves React, and
  // it leaves as an argument to `bridge.configSave` (which persists it) or
  // `bridge.configModels` (which uses it once) and nowhere else. No result
  // shape below has a field that could carry one back (§44).

  const loadApiConfig = useCallback(async (): Promise<ApiConfigLoadResult> => {
    try {
      const env = await bridge.configGet();
      if (bridge.envelopeIsError(env)) {
        return { ok: false, message: bridge.envelopeError(env).message };
      }
      return { ok: true, config: env.data as ApiConfigData };
    } catch (e) {
      return { ok: false, message: String(e) };
    }
  }, []);

  const saveApiConfig = useCallback(
    async (patch: ApiConfigPatchData): Promise<ApiConfigSaveResult> => {
      try {
        const env = await bridge.configSave(patch);
        if (bridge.envelopeIsError(env)) {
          return { ok: false, message: bridge.envelopeError(env).message };
        }
        const data = env.data as ApiConfigSavedData;
        // The status bar follows the model that is now in effect. The model id
        // is not a secret; the key that came with it never gets this far.
        dispatch({ type: "CONFIG_MODEL", model: data.config.model });
        return { ok: true, data };
      } catch (e) {
        return { ok: false, message: String(e) };
      }
    },
    [],
  );

  const testApiConnection = useCallback(async (): Promise<ApiConfigTestedData> => {
    try {
      const env = await bridge.configTest();
      if (bridge.envelopeIsError(env)) {
        const err = bridge.envelopeError(env);
        return {
          connected: false,
          code: err.code,
          message: configRequestFailedCopy(err.code, err.message),
          latencyMs: 0,
        };
      }
      return env.data as ApiConfigTestedData;
    } catch {
      return {
        connected: false,
        code: "TRANSPORT",
        message: copy["config.err.noHost"],
        latencyMs: 0,
      };
    }
  }, []);

  /**
   * `config.models` — the one-shot draft. Note what is NOT here: the key is
   * handed straight to the bridge call, so it reaches neither the store nor a
   * log line, and the result carries only ids and a caption.
   */
  const listApiModels = useCallback(
    async (draft: ApiConfigModelsDraft): Promise<ApiModelsResult> => {
      try {
        const env = await bridge.configModels(draft);
        if (bridge.envelopeIsError(env)) {
          const err = bridge.envelopeError(env);
          return { ok: false, message: configRequestFailedCopy(err.code, err.message) };
        }
        return { ok: true, data: env.data as ApiModelsListedData };
      } catch {
        return { ok: false, message: copy["config.err.noHost"] };
      }
    },
    [],
  );

  /**
   * The config read is tied to the runtime reaching `ready`, not to mount:
   * `config.get` needs a booted runtime and answers NOT_READY before that, and
   * a cold boot needs several seconds. Leaving `ready` re-arms it, so a
   * restart's fresh runtime is read again (a restart can pick up renames in
   * the environment layer, which changes `writable` for the key ref).
   */
  const configReadDoneRef = useRef(false);
  useEffect(() => {
    if (state.runtime.status !== "ready") {
      configReadDoneRef.current = false;
      return;
    }
    if (configReadDoneRef.current) return;
    configReadDoneRef.current = true;
    void (async () => {
      const result = await loadApiConfig();
      if (result.ok) dispatch({ type: "CONFIG_MODEL", model: result.config.model });
    })();
  }, [state.runtime.status, loadApiConfig]);

  const actions = useMemo<AppActions>(
    () => ({
      send,
      newSession,
      openSession,
      retryOpen,
      restoreClose,
      restartAgent,
      toggleDrawer: () => dispatch({ type: "DRAWER_TOGGLE" }),
      setDrawerFilter: (filter: DrawerFilter) =>
        dispatch({ type: "DRAWER_SET_FILTER", filter }),
      closeDrawer: () => dispatch({ type: "DRAWER_CLOSE" }),
      toggleStrip: (turnId: number) => dispatch({ type: "STRIP_TOGGLE", turnId }),
      setSettingsTab: (tab: SettingsTab) => dispatch({ type: "SETTINGS_TAB_SET", tab }),
      setThemePreference: (preference: ThemePreference) =>
        dispatch({ type: "THEME_SET", preference }),
      // Reads the *current* scheme, not the stored preference: while following
      // the system there is no preference to invert, and the button must still
      // do the obvious thing. Both reads come from refs so the action identity
      // (and therefore the whole actions memo) stays stable.
      toggleTheme: () =>
        dispatch({
          type: "THEME_SET",
          preference: nextPreference(
            stateRef.current.ui.themePreference,
            systemSchemeRef.current,
          ),
        }),
      openConfig: () => dispatch({ type: "CONFIG_OPEN" }),
      closeConfig: () => dispatch({ type: "CONFIG_CLOSE" }),
      loadApiConfig,
      saveApiConfig,
      testApiConnection,
      listApiModels,
    }),
    [
      send,
      newSession,
      openSession,
      retryOpen,
      restoreClose,
      restartAgent,
      loadApiConfig,
      saveApiConfig,
      testApiConnection,
      listApiModels,
    ],
  );

  const value = useMemo<AppValue>(
    () => ({ state, opening, scheme, actions }),
    [state, opening, scheme, actions],
  );

  // §27's tree puts the store above the theme host, and the dependency runs
  // that way too: the scheme is `state.ui.themePreference` resolved against
  // the OS, so only this component can compute it.
  return (
    <AppCtx.Provider value={value}>
      <ThemeHost scheme={scheme}>{children}</ThemeHost>
    </AppCtx.Provider>
  );
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export function App() {
  useStaticStyles();
  return (
    <AppStateProvider>
      <DesktopShell />
    </AppStateProvider>
  );
}

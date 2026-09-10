/**
 * App composition root (UI Spec §27 tree): ThemeHost (FluentProvider +
 * follows the OS color scheme, §18; CSS custom properties --chinook-user-
 * bubble / --chinook-accent for the components that need them) and
 * AppStateProvider (useReducer + the entire IPC effect surface: channel
 * subscription with rAF-batched dispatch §14.1, boot reconcile, and the
 * invoke-response → store-action mapping that the host router requires).
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
import { FluentProvider, makeStaticStyles, makeStyles } from "@fluentui/react-components";
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
import { INITIAL_STATE } from "./store/state";
import { buildDarkTheme, buildLightTheme, type ThemeTokens } from "./theme";
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
});

function useColorScheme(): "light" | "dark" {
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

function ThemeHost({ children }: { children: ReactNode }) {
  const styles = useHostStyles();
  const scheme = useColorScheme();
  const theme: ThemeTokens = useMemo(
    () => (scheme === "dark" ? buildDarkTheme() : buildLightTheme()),
    [scheme],
  );
  const vars = useMemo(() => {
    const accent = scheme === "dark" ? "#FF9E73" : "#C2410C"; // §19.1 stops
    return {
      "--chinook-user-bubble": theme.chinookUserBubbleBg,
      "--chinook-accent": accent,
    } as CSSProperties;
  }, [scheme, theme]);

  return (
    <FluentProvider theme={theme} className={styles.fill}>
      <div style={vars} className={`chinook-app ${styles.fill}`}>
        {children}
      </div>
    </FluentProvider>
  );
}

// ---------------------------------------------------------------------------
// AppStateProvider
// ---------------------------------------------------------------------------

function AppStateProvider({ children }: { children: ReactNode }) {
  useStaticStyles();
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const stateRef = useRef(state);
  stateRef.current = state;
  const [opening, setOpening] = useState(false);
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
    void (async () => {
      await bridge.subscribeEvents(enqueueEvent);
      // Reconcile the runtime status (events may have raced the subscribe).
      const statusEnv = await bridge.agentStatus();
      applyResponse(statusEnv);
      const listEnv = await bridge.sessionList();
      if (bridge.envelopeIsError(listEnv)) return;
      applyResponse(listEnv);
      const sessions = (listEnv.data as { sessions?: { sessionId: string }[] }).sessions ?? [];
      const first = sessions[0];
      if (first !== undefined) {
        retrySessionRef.current = first.sessionId;
        const openEnv = await bridge.sessionOpen(first.sessionId);
        if (bridge.envelopeIsError(openEnv)) {
          dispatch({ type: "OPEN_FAILED", message: responseError(openEnv) });
        } else {
          applyResponse(openEnv);
        }
      }
    })();
  }, [applyResponse, enqueueEvent, responseError]);

  // ---- actions -------------------------------------------------------------

  const openSession = useCallback(
    async (sessionId: string): Promise<void> => {
      const st = stateRef.current;
      if (st.activeTurn !== null) return; // §16.5 rows are disabled anyway
      retrySessionRef.current = sessionId;
      setOpening(true);
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
        setOpening(false);
      }
    },
    [applyResponse, responseError],
  );

  const newSession = useCallback(async (): Promise<void> => {
    const st = stateRef.current;
    if (st.activeTurn !== null) return;
    const env = await bridge.sessionCreate();
    if (bridge.envelopeIsError(env)) return;
    applyResponse(env);
  }, [applyResponse]);

  const send = useCallback(
    async (text: string): Promise<SendResult> => {
      const st = stateRef.current;
      if (st.runtime.status !== "ready" || st.activeTurn !== null) {
        return { ok: false, code: "NOT_READY" };
      }
      const trimmed = text.trim();
      if (trimmed.length === 0) return { ok: false, code: "INVALID_ARGUMENT" };
      let sessionId = st.activeSessionId;
      if (sessionId === null) {
        // A chip on the empty, session-less state creates one first (§7.2).
        const createEnv = await bridge.sessionCreate();
        if (bridge.envelopeIsError(createEnv)) {
          return { ok: false, code: bridge.envelopeError(createEnv).code };
        }
        applyResponse(createEnv);
        const data = createEnv.data as { session?: { sessionId?: string } };
        const created = data?.session?.sessionId;
        if (created === undefined) return { ok: false, code: "NOT_FOUND" };
        sessionId = created;
      }
      const env = await bridge.turnSend(sessionId, trimmed);
      if (bridge.envelopeIsError(env)) {
        return { ok: false, code: bridge.envelopeError(env).code };
      }
      return { ok: true };
    },
    [applyResponse],
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
    () => ({ state, opening, actions }),
    [state, opening, actions],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

// ---------------------------------------------------------------------------
// App root
// ---------------------------------------------------------------------------

export function App() {
  useStaticStyles();
  return (
    <ThemeHost>
      <AppStateProvider>
        <DesktopShell />
      </AppStateProvider>
    </ThemeHost>
  );
}

/**
 * Reducer contract (UI Spec §28.2). Pure; no side effects; unit-tested under
 * node (contract §48). Invariants per spec:
 *   - session-scoped mutations apply only when the envelope's sessionId
 *     equals activeSessionId (no-op otherwise — belt and braces);
 *   - no user/assistant item is appended while activeTurn !== null;
 *   - item mutations touch only the open assistant item of the active turn;
 *   - a tool finalize only targets the newest running activity;
 *   - TEXT_DELTA appends (chunks are the text source of truth); STEP_DONE
 *     never rewrites text.
 */

import { assistantItemId, liveUserItemId, STREAMING_STATUS, type RootState } from "./state";
import type { StoreAction } from "./actions";
import type {
  AssistantStatus,
  ConversationItem,
  TimelineRow,
  TurnEndReason,
} from "../protocol/types";

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const now = () => Date.now();

function activeSessionOnly(s: RootState, sessionId: string): boolean {
  return s.activeSessionId !== null && s.activeSessionId === sessionId;
}

/** Index of the last appended assistant item (the open one). */
function lastAssistantIndex(items: ConversationItem[]): number {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].kind === "assistant") return i;
  }
  return -1;
}

function pushLog(s: RootState, row: TimelineRow): TimelineRow[] {
  return [...s.conversation.log, row];
}

/**
 * Runtime object after a successful session bind (session/opened or
 * session/created). Targeted Repair P1/P3 recovery rule: the bridge only
 * completes an open/create when it can accept turns, so a completed bind
 * disproves any desktop-side readiness gate — the restore hold
 * (RESTORE_START) or the error surfaced when a reopen failed (Case C:
 * no false ready, but no dead end either — a working session restores ready).
 */
function boundRuntime(s: RootState): RootState["runtime"] {
  if (!s.runtime.restorePending && s.runtime.status !== "error") return s.runtime;
  return { status: "ready", detail: undefined, restorePending: false };
}

/** Final status per §28.2: blocked resolves by text presence. */
export function finalStatus(reason: TurnEndReason, hasText: boolean): AssistantStatus {
  switch (reason) {
    case "completed":
      return "complete";
    case "aborted":
      return "stopped";
    case "max-tokens":
      return "limited";
    case "error":
      return "failed";
    case "interrupted":
      return "interrupted";
    case "blocked":
      return hasText ? "complete" : "no-answer";
  }
}

function finalizeOpenItem(
  s: RootState,
  fn: (item: Extract<ConversationItem, { kind: "assistant" }>) => Extract<ConversationItem, { kind: "assistant" }>,
): ConversationItem[] {
  const items = s.conversation.items;
  const idx = lastAssistantIndex(items);
  if (idx < 0) return items;
  const copy = [...items];
  copy[idx] = fn(copy[idx] as Extract<ConversationItem, { kind: "assistant" }>);
  return copy;
}

// ---------------------------------------------------------------------------
// reducer
// ---------------------------------------------------------------------------

export function reducer(state: RootState, action: StoreAction): RootState {
  switch (action.type) {
    case "RUNTIME_STATUS": {
      // Targeted Repair P1 hold: while a session reopen is owed (RESTORE_START
      // armed by a restart with an active session), bridge readiness must not
      // release the composer — the fresh bridge has no session bound, so a
      // turn.send would fail. The bridge also re-emits ready/restoring around
      // our reopen; only its result (SESSION_OPENED) or host truth
      // (disconnected/error, or a new restart) may end the hold — everything
      // else while held is ignored.
      if (state.runtime.restorePending && action.status !== "disconnected" && action.status !== "error" && action.status !== "restarting") {
        return state;
      }
      // Any status change that ends the hold also clears it.
      const runtime = { status: action.status, detail: action.detail, restorePending: false };
      if (state.activeTurn === null) return { ...state, runtime };
      // Orphan-turn guard: a non-idle status while a turn is open means the
      // stream died (bridge restart / disconnect / explicit restart) and no
      // turn/end will ever arrive. Finalize the open item as interrupted and
      // log the end so a later reconnect never leaves the composer locked
      // and the half answer shows 上次回答未完成 (§14.2 invariant).
      if (action.status !== "ready") {
        const ts = now();
        const items = finalizeOpenItem(state, (item) => ({
          ...item,
          status: "interrupted" as AssistantStatus,
        }));
        const log = pushLog(state, {
          type: "turn/end",
          turnId: state.activeTurn.turnId,
          ts,
          reason: "interrupted",
        });
        return {
          ...state,
          runtime,
          conversation: { ...state.conversation, items, log },
          activeTurn: null,
        };
      }
      return { ...state, runtime };
    }

    case "RESTORE_START":
      // Hold the desktop at `restoring` (content stays visible, composer
      // locked via !runtimeReady) until the reopen resolves. restorePending
      // gates the RUNTIME_STATUS branch above.
      return { ...state, runtime: { status: "restoring", detail: undefined, restorePending: true } };

    case "SESSIONS_REPLACE":
      return { ...state, sessions: action.sessions };

    case "SESSION_CREATED": {
      // Only while idle — a create mid-turn must not reset the view.
      if (state.activeTurn !== null) return state;
      const session = action.session;
      return {
        ...state,
        // A completed bind disproves the restore hold / restore-failure error.
        runtime: boundRuntime(state),
        // A null list (the boot `session/list` failed) becomes a one-item list
        // rather than staying null — otherwise the session the user just
        // created is invisible in the sidebar.
        sessions: [session, ...(state.sessions ?? []).filter((x) => x.sessionId !== session.sessionId)],
        activeSessionId: session.sessionId,
        activeTurn: null,
        conversation: { items: [], log: [], openError: null },
      };
    }

    case "SESSION_OPENED": {
      const session = action.session;
      // Sanity: never replace the conversation while a turn is live.
      if (state.activeTurn !== null) return state;
      return {
        ...state,
        // Targeted Repair P1: this is what releases the restart hold — the
        // reopened session is bound (hydrated items/log), desktop → ready.
        // P3 recovery: a successful open also disproves a restore-failure
        // error (Case C: sidebar/retry recovery without a false ready first).
        runtime: boundRuntime(state),
        sessions: state.sessions
          ? state.sessions.map((x) => (x.sessionId === session.sessionId ? session : x))
          : state.sessions,
        activeSessionId: session.sessionId,
        activeTurn: null,
        conversation: { items: action.items, log: action.log, openError: null },
      };
    }

    case "SESSION_TITLE": {
      if (state.sessions === null) return state;
      const sessions = state.sessions.map((x) =>
        x.sessionId === action.sessionId ? { ...x, title: action.title } : x,
      );
      return { ...state, sessions };
    }

    case "TURN_START": {
      if (state.activeTurn !== null) return state; // invariant: assert, don't corrupt
      if (!activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      const userItem: ConversationItem = {
        kind: "user",
        id: liveUserItemId(action.turnId),
        text: action.userText,
        ts,
      };
      const assistantItem: ConversationItem = {
        kind: "assistant",
        id: assistantItemId(state.activeSessionId as string, action.turnId),
        text: "",
        ts,
        status: STREAMING_STATUS,
        tools: [],
      };
      const log = pushLog(state, { type: "turn/start", turnId: action.turnId, ts });
      return {
        ...state,
        conversation: { ...state.conversation, items: [...state.conversation.items, userItem, assistantItem], log },
        activeTurn: { turnId: action.turnId, startedAt: ts },
      };
    }

    case "TOOL_CALL": {
      if (state.activeTurn === null || !activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      const items = finalizeOpenItem(state, (item) => ({
        ...item,
        tools: [
          ...item.tools,
          {
            name: action.tool.name,
            callId: action.tool.callId,
            arguments: action.tool.arguments,
            ok: true, // in-flight; TOOL_RESULT overrides
            ts,
          },
        ],
      }));
      const log = pushLog(state, {
        type: "tool/call",
        turnId: action.turnId,
        ts,
        tool: {
          name: action.tool.name,
          callId: action.tool.callId,
          arguments: action.tool.arguments,
          ok: true,
          ts,
        },
      });
      return { ...state, conversation: { ...state.conversation, items, log } };
    }

    case "TOOL_RESULT": {
      if (state.activeTurn === null || !activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      const t = action.tool;
      const items = finalizeOpenItem(state, (item) => {
        // Finalize the newest running activity with this callId (§28.2).
        const tools = [...item.tools];
        for (let i = tools.length - 1; i >= 0; i -= 1) {
          if (tools[i].callId === t.callId) {
            tools[i] = {
              name: t.name,
              callId: t.callId,
              arguments: tools[i].arguments,
              ok: t.ok,
              error: t.error,
              durationMs: t.durationMs,
              result: t.result,
              ts: tools[i].ts,
            };
            break;
          }
        }
        return { ...item, tools };
      });
      const log = pushLog(state, {
        type: "tool/result",
        turnId: action.turnId,
        ts,
        tool: {
          name: t.name,
          callId: t.callId,
          arguments: {},
          ok: t.ok,
          error: t.error,
          durationMs: t.durationMs,
          result: t.result,
          ts,
        },
      });
      return { ...state, conversation: { ...state.conversation, items, log } };
    }

    case "TEXT_DELTA": {
      if (state.activeTurn === null || !activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      const items = finalizeOpenItem(state, (item) => ({ ...item, text: item.text + action.text }));
      const log = pushLog(state, { type: "chunk", turnId: action.turnId, ts, chars: action.text.length });
      return { ...state, conversation: { ...state.conversation, items, log } };
    }

    case "STEP_DONE": {
      if (state.activeTurn === null || !activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      // §28.2: never rewrites accumulated text (chunks are the source of
      // truth); the wire text field is deliberately unused here.
      const log = pushLog(state, {
        type: "step",
        turnId: action.turnId,
        ts,
        usage: action.usage,
        interrupted: action.interrupted,
      });
      return { ...state, conversation: { ...state.conversation, log } };
    }

    case "TURN_ERROR": {
      if (state.activeTurn === null || !activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      const items = finalizeOpenItem(state, (item) => ({
        ...item,
        error: { code: action.code, message: action.message },
      }));
      const log = pushLog(state, { type: "turn/error", turnId: action.turnId, ts, code: action.code, message: action.message });
      return { ...state, conversation: { ...state.conversation, items, log } };
    }

    case "TURN_END": {
      if (!activeSessionOnly(state, action.sessionId)) return state;
      const ts = action.ts > 0 ? action.ts : now();
      const items = finalizeOpenItem(state, (item) => {
        const hasText = item.text.length > 0;
        return { ...item, status: finalStatus(action.reason, hasText) };
      });
      const log = pushLog(state, { type: "turn/end", turnId: action.turnId, ts, reason: action.reason });
      return { ...state, conversation: { ...state.conversation, items, log }, activeTurn: null };
    }

    case "OPEN_FAILED":
      return {
        ...state,
        conversation: { ...state.conversation, openError: action.message },
        activeTurn: null,
      };

    case "OPEN_RETRY":
      return { ...state, conversation: { ...state.conversation, openError: null } };

    case "DRAWER_TOGGLE":
      return { ...state, ui: { ...state.ui, drawerOpen: !state.ui.drawerOpen } };
    case "DRAWER_SET_FILTER":
      return { ...state, ui: { ...state.ui, drawerFilter: action.filter } };
    case "DRAWER_CLOSE":
      return { ...state, ui: { ...state.ui, drawerOpen: false } };
    // The model-settings overlay. Purely presentational: `configOpen` moves
    // nothing but the overlay's visibility, and CONFIG_MODEL carries a model
    // ID — never a credential (§44).
    case "CONFIG_OPEN":
      return { ...state, ui: { ...state.ui, configOpen: true } };
    case "CONFIG_CLOSE":
      return { ...state, ui: { ...state.ui, configOpen: false } };
    case "CONFIG_TOGGLE":
      return { ...state, ui: { ...state.ui, configOpen: !state.ui.configOpen } };
    case "CONFIG_MODEL":
      return { ...state, config: { model: action.model } };
    case "SETTINGS_TAB_SET":
      return { ...state, ui: { ...state.ui, settingsTab: action.tab } };
    case "THEME_SET":
      return { ...state, ui: { ...state.ui, themePreference: action.preference } };
    case "STRIP_TOGGLE":
      return {
        ...state,
        ui: {
          ...state.ui,
          expandedTurnIds: {
            ...state.ui.expandedTurnIds,
            [action.turnId]: !state.ui.expandedTurnIds[action.turnId],
          },
        },
      };

    default:
      return state;
  }
}

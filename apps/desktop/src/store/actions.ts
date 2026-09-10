/**
 * Store actions + the single wire→action adapter (UI Spec §28.2/§26.3).
 * Response envelopes (requestId present) never arrive on the channel — the
 * Rust host resolves them to the invoking command — so the adapter only
 * sees streaming events. Responses are dispatched by bridge/client.ts when
 * their promises resolve (SESSION_CREATED / SESSION_OPENED / SESSIONS_REPLACE).
 *
 * Wire envelopes carry no `ts`; the adapter stamps Date.now() per arrival
 * (snapshot rows carry their own ts from the bridge).
 */

import type {
  ConversationItem,
  Envelope,
  RuntimeStatus,
  SessionSummary,
  TimelineRow,
  TurnEndReason,
} from "../protocol/types";
import type { SettingsTab } from "./state";
import type { ThemePreference } from "./themePreference";

export type DrawerFilter = "all" | "tools";

export type StoreAction =
  | { type: "RUNTIME_STATUS"; status: RuntimeStatus; detail?: string }
  /**
   * Targeted Repair P1: a restarted bridge reported `ready` while the
   * desktop owed the active session a reopen (restartAgent armed a target).
   * React dispatches this instead of the raw ready — the reducer holds the
   * desktop at `restoring` until the session.open result (SESSION_OPENED or
   * a RUNTIME_STATUS error/disconnected) releases it.
   */
  | { type: "RESTORE_START" }
  | { type: "SESSIONS_REPLACE"; sessions: SessionSummary[] }
  | { type: "SESSION_CREATED"; session: SessionSummary }
  | {
      type: "SESSION_OPENED";
      session: SessionSummary;
      items: ConversationItem[];
      log: TimelineRow[];
    }
  | { type: "SESSION_TITLE"; sessionId: string; title: string }
  | { type: "TURN_START"; sessionId: string; turnId: number; userText: string; ts: number }
  | {
      type: "TOOL_CALL";
      sessionId: string;
      turnId: number;
      tool: { name: string; arguments: Record<string, unknown>; callId: string };
      ts: number;
    }
  | {
      type: "TOOL_RESULT";
      sessionId: string;
      turnId: number;
      tool: {
        name: string;
        callId: string;
        durationMs: number;
        ok: boolean;
        error?: { code: string; message: string };
        result?: unknown;
      };
      ts: number;
    }
  | { type: "TEXT_DELTA"; sessionId: string; turnId: number; text: string; ts: number }
  | { type: "STEP_DONE"; sessionId: string; turnId: number; usage?: unknown; interrupted?: boolean; ts: number }
  | { type: "TURN_ERROR"; sessionId: string; turnId: number; code: string; message: string; ts: number }
  | { type: "TURN_END"; sessionId: string; turnId: number; reason: TurnEndReason; ts: number }
  | { type: "OPEN_FAILED"; message: string }
  | { type: "OPEN_RETRY" }
  | { type: "DRAWER_TOGGLE" }
  | { type: "DRAWER_SET_FILTER"; filter: DrawerFilter }
  | { type: "DRAWER_CLOSE" }
  | { type: "STRIP_TOGGLE"; turnId: number }
  | { type: "CONFIG_OPEN" }
  | { type: "CONFIG_CLOSE" }
  | { type: "CONFIG_TOGGLE" }
  /** Cache the model id the status bar renders (no credential ever rides here). */
  | { type: "CONFIG_MODEL"; model: string }
  | { type: "SETTINGS_TAB_SET"; tab: SettingsTab }
  /** §18 as amended. The reducer only stores it; the side effects (storage,
   *  `color-scheme`, the OS listener's effect) belong to the action creator. */
  | { type: "THEME_SET"; preference: ThemePreference };

// ---------------------------------------------------------------------------
// wire adapter
// ---------------------------------------------------------------------------

const toRecord = (v: unknown): Record<string, unknown> | undefined => {
  if (v !== null && typeof v === "object") return v as Record<string, unknown>;
  return undefined;
};

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | undefined => (typeof v === "number" ? v : undefined);

/**
 * Map one envelope to a store action — streaming events (no requestId) and the
 * responses the host router resolves an invoke with. Returns null for envelope
 * types the store does not handle (future-proofing: unknown types are ignored,
 * never crash the reducer).
 */
export function actionFromEvent(env: Envelope, ts: number): StoreAction | null {
  const data = toRecord(env.data);
  if (!data) return null;
  const sessionId = str(env.sessionId);
  const turnId = num(env.turnId);

  switch (env.type) {
    // `runtime/status` is the pushed event; `agent.status` is the RESPONSE to
    // the boot reconcile's status read (app.tsx) and carries the same payload.
    // Without the response case that reconcile quietly did nothing, so a
    // frontend that subscribed to the event channel *after* the bridge
    // announced `ready` — a cold webview, or any page reload — sat at
    // 正在启动… forever, with a live runtime behind it.
    case "runtime/status":
    case "agent.status": {
      const status = str(data.status) as RuntimeStatus | undefined;
      if (!status) return null;
      return { type: "RUNTIME_STATUS", status, detail: str(data.detail) };
    }
    case "session/list": {
      const sessions = Array.isArray(data.sessions)
        ? (data.sessions as unknown as SessionSummary[])
        : [];
      return { type: "SESSIONS_REPLACE", sessions };
    }
    case "session/created": {
      const session = data.session as unknown as SessionSummary;
      if (!session || typeof session.sessionId !== "string") return null;
      return { type: "SESSION_CREATED", session };
    }
    case "session/opened": {
      const session = data.session as unknown as SessionSummary;
      const items = Array.isArray(data.items) ? (data.items as unknown as ConversationItem[]) : [];
      const log = Array.isArray(data.log) ? (data.log as unknown as TimelineRow[]) : [];
      if (!session || typeof session.sessionId !== "string") return null;
      return { type: "SESSION_OPENED", session, items, log };
    }
    case "session/title": {
      const id = str(data.sessionId);
      const title = str(data.title);
      if (!id || title === undefined) return null;
      return { type: "SESSION_TITLE", sessionId: id, title };
    }
    case "turn/start": {
      const text = str(data.userText);
      if (sessionId === undefined || turnId === undefined || text === undefined) return null;
      return { type: "TURN_START", sessionId, turnId, userText: text, ts };
    }
    case "tool/call": {
      const tool = toRecord(data.tool);
      const callId = tool ? str(tool.callId) : undefined;
      const name = tool ? str(tool.name) : undefined;
      const args = tool ? tool.arguments : undefined;
      if (sessionId === undefined || turnId === undefined || !tool || !callId || !name) return null;
      const arguments_: Record<string, unknown> =
        args !== null && typeof args === "object" ? (args as Record<string, unknown>) : {};
      return { type: "TOOL_CALL", sessionId, turnId, tool: { name, arguments: arguments_, callId }, ts };
    }
    case "tool/result": {
      const tool = toRecord(data.tool);
      const callId = tool ? str(tool.callId) : undefined;
      const name = tool ? str(tool.name) : undefined;
      if (sessionId === undefined || turnId === undefined || !tool || !callId || !name) return null;
      const error = toRecord(tool.error);
      return {
        type: "TOOL_RESULT",
        sessionId,
        turnId,
        tool: {
          name,
          callId,
          durationMs: num(tool.durationMs) ?? 0,
          ok: tool.ok === true,
          error: error && str(error.code)
            ? { code: String(error.code), message: str(error.message) ?? String(error.code) }
            : undefined,
          result: tool.result,
        },
        ts,
      };
    }
    case "assistant/chunk": {
      const text = str(data.text);
      if (sessionId === undefined || turnId === undefined || text === undefined) return null;
      return { type: "TEXT_DELTA", sessionId, turnId, text, ts };
    }
    case "assistant/message": {
      if (sessionId === undefined || turnId === undefined) return null;
      return {
        type: "STEP_DONE",
        sessionId,
        turnId,
        usage: data.usage,
        interrupted: data.interrupted === true,
        ts,
      };
    }
    case "turn/error": {
      const code = str(data.code);
      const message = str(data.message);
      if (sessionId === undefined || turnId === undefined || code === undefined) return null;
      return { type: "TURN_ERROR", sessionId, turnId, code, message: message ?? code, ts };
    }
    case "turn/end": {
      const reason = str(data.reason) as TurnEndReason | undefined;
      if (sessionId === undefined || turnId === undefined || !reason) return null;
      return { type: "TURN_END", sessionId, turnId, reason, ts };
    }
    default:
      return null;
  }
}

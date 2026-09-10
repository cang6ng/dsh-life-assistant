/**
 * Desktop presentation protocol — the exact wire contract of UI Spec §26.
 *
 * Generic agent presentation protocol shared (by text) between the Node
 * Agent Bridge and the React frontend. NO Chinook-specific event types and
 * NO `@deepseek-ai/*` types may ever leak in here: arguments/result JSON is
 * opaque to the wire (UI Spec §26.5).
 *
 * Every protocol message is one JSON line on the bridge's stdout:
 *
 * ```ts
 * interface Envelope {
 *   protocolVersion: 1;
 *   requestId?: string;      // present on requests and their responses
 *   sessionId?: string | null;
 *   turnId?: number | null;  // dsh turn number within the session
 *   seq: number;             // per-session dsh event seq, else presentation counter
 *   type: string;            // see below
 *   data: unknown;           // JSON-serializable payload
 * }
 * ```
 *
 * This module contains types + tiny helpers only; importing it must have no
 * runtime side effects beyond these constants.
 */

export const PROTOCOL_VERSION = 1 as const;

// ---------------------------------------------------------------------------
// §26.1 envelope
// ---------------------------------------------------------------------------

export interface Envelope {
  protocolVersion: typeof PROTOCOL_VERSION;
  requestId?: string;
  sessionId?: string | null;
  turnId?: number | null;
  seq: number;
  type: string;
  data: unknown;
}

/** Uniform error response data (mirrors the V1 tool contract deliberately). */
export interface ProtocolErrorData {
  ok: false;
  error: { code: string; message: string };
}

export type RuntimeStatus = "starting" | "ready" | "restoring" | "disconnected" | "error" | "restarting";
export type TurnEndReason = "completed" | "aborted" | "blocked" | "error" | "max-tokens" | "interrupted";
export type AssistantStatus = "complete" | "stopped" | "failed" | "limited" | "interrupted" | "no-answer";

// ---------------------------------------------------------------------------
// §26.2 request payloads (received on stdin / from Tauri Commands)
// ---------------------------------------------------------------------------

export interface SessionListRequest {
  type: "session.list";
}
export interface SessionCreateRequest {
  type: "session.create";
}
export interface SessionOpenRequest {
  type: "session.open";
  sessionId: string;
}
export interface AgentStatusRequest {
  type: "agent.status";
}
export interface AgentRestartRequest {
  type: "agent.restart";
}
export interface TurnSendRequest {
  type: "turn.send";
  sessionId: string;
  text: string;
}

/**
 * Model-endpoint configuration. `data` is deliberately absent from get/test —
 * neither takes an argument, so neither can carry a credential value back or
 * forth. `config.save` carries a key ONE WAY only: the wire never returns one.
 */
export interface ConfigGetRequest {
  type: "config.get";
}
export interface ConfigSaveRequest {
  type: "config.save";
  data: {
    /** "" clears the override and restores the endpoint default. */
    baseUrl?: string;
    model?: string;
    /** Absent or "" keeps the stored key. */
    apiKey?: string;
    /** Explicit removal of the stored key. */
    clearApiKey?: boolean;
  };
}
export interface ConfigTestRequest {
  type: "config.test";
}

export type Request =
  | SessionListRequest
  | SessionCreateRequest
  | SessionOpenRequest
  | AgentStatusRequest
  | AgentRestartRequest
  | TurnSendRequest
  | ConfigGetRequest
  | ConfigSaveRequest
  | ConfigTestRequest;

// ---------------------------------------------------------------------------
// §26.4 session & item shapes (React-consumable; no DSH types)
// ---------------------------------------------------------------------------

export interface SessionSummary {
  sessionId: string;
  title: string;
  createdAt: number;
  messageCount?: number;
}

export interface ToolActivity {
  name: string; // wire name (search_catalog, …)
  callId: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error?: { code: string; message: string };
  durationMs?: number;
  result?: unknown; // parsed structured result (or raw JSON string)
  ts: number;
}

export type ConversationItem =
  | {
      kind: "user";
      id: string;
      text: string;
      ts: number;
    }
  | {
      kind: "assistant";
      id: string; // `${sessionId}:${turnId}`
      text: string;
      ts: number;
      status: AssistantStatus;
      tools: ToolActivity[]; // ordered per turn; empty when none
      // Reducer-side superset (§28.2): recorded on the open item during a live
      // turn / carried by snapshot items so resumed failures keep their caption.
      error?: { code: string; message: string };
      usage?: unknown;
      interrupted?: boolean;
      archived?: { olderCount: number };
    };

/** §28.1 — one row per presentation event; drawer groups 'chunk' rows visually. */
export type TimelineRow =
  | { type: "turn/start"; turnId: number; ts: number }
  | { type: "tool/call" | "tool/result"; turnId: number; ts: number; tool: ToolActivity }
  | { type: "chunk"; turnId: number; ts: number; chars: number } // per assistant/chunk
  | { type: "step"; turnId: number; ts: number; usage?: unknown; interrupted?: boolean } // assistant/message
  | { type: "turn/error"; turnId: number; ts: number; code: string; message: string }
  | { type: "turn/end"; turnId: number; ts: number; reason: TurnEndReason };

// ---------------------------------------------------------------------------
// §26.2/§26.3 response data shapes
// ---------------------------------------------------------------------------

export interface RuntimeStatusData {
  status: RuntimeStatus;
  detail?: string;
}
export interface SessionListData {
  sessions: SessionSummary[];
}
export interface SessionCreatedData {
  session: SessionSummary; // title may update later
}
export interface SessionOpenedData {
  session: SessionSummary;
  items: ConversationItem[];
  log: TimelineRow[];
}
export interface SessionTitleUpdatedData {
  sessionId: string;
  title: string;
}
export interface TurnStartData {
  userText: string;
}
export interface ToolCallData {
  turnId: number;
  tool: { name: string; arguments: Record<string, unknown>; callId: string };
}
export interface ToolResultData {
  turnId: number;
  tool: {
    name: string;
    callId: string;
    durationMs: number;
    ok: boolean;
    error?: { code: string; message: string };
    result?: unknown;
  };
}
export interface AssistantChunkData {
  turnId: number;
  text: string; // text only; the bridge dropped reasoning
}
export interface AssistantMessageData {
  turnId: number;
  text: string;
  usage?: unknown;
  interrupted?: boolean;
}
export interface TurnErrorData {
  turnId: number;
  code: string;
  message: string;
}
export interface TurnEndData {
  turnId: number;
  reason: TurnEndReason;
}
export interface AgentStatusData {
  status: RuntimeStatus;
}
export interface TurnSendAcceptData {
  accepted: true;
}

/**
 * §26.2 model-endpoint configuration rows.
 *
 * The security-relevant shape here is what is NOT in it: `ApiConfigData` has
 * no field that can carry a credential value. The UI sends a key and reads
 * back only whether one resolves, from which layer, and whether this process
 * may change it (contract §44 — React never receives the model credential).
 */
export interface ApiKeyStateData {
  /** The credential reference in use. */
  ref: string;
  configured: boolean;
  /** Supplying layer; `env` means inherited and therefore read-only. */
  source?: string;
  writable: boolean;
}
export interface ApiConfigData {
  provider: string;
  model: string;
  /** User-supplied base URL; "" means the default endpoint is in use. */
  baseUrl: string;
  /** Whether the user layer owns `baseURL`. */
  baseUrlOverridden: boolean;
  apiKey: ApiKeyStateData;
}
export interface ApiConfigSavedData {
  config: ApiConfigData;
  /** True when the default model changed and the live session was rebound. */
  modelChanged: boolean;
  /** A credential write the store refused; the settings write still applied. */
  apiKeyError?: string;
}
/**
 * The probe's OWN outcome. The success flag is `connected`, never `ok`:
 * `{ ok: false }` is the protocol's error-envelope discriminator
 * (`isErrorData`), so a successful response carrying a negative verdict under
 * that name would be read as a failed request by every layer downstream.
 */
export interface ApiConfigTestedData {
  connected: boolean;
  /** Machine-routable failure code; absent on success. */
  code?: string;
  /** Render-ready Chinese caption; "" on success. */
  message: string;
  latencyMs: number;
}

/** type → response/event data payload map (mirrors §26.2–26.3 rows). */
export interface DataByType {
  "runtime/status": RuntimeStatusData;
  "session/list": SessionListData;
  "session/created": SessionCreatedData;
  "session/opened": SessionOpenedData;
  "session/title": SessionTitleUpdatedData;
  "turn/start": TurnStartData;
  "tool/call": ToolCallData;
  "tool/result": ToolResultData;
  "assistant/chunk": AssistantChunkData;
  "assistant/message": AssistantMessageData;
  "turn/error": TurnErrorData;
  "turn/end": TurnEndData;
  "agent.status": AgentStatusData;
  "turn.send": TurnSendAcceptData;
  "session.list": SessionListData;
  "session.create": SessionCreatedData;
  "session.open": SessionOpenedData;
  "config.describe": ApiConfigData;
  "config.saved": ApiConfigSavedData;
  "config.tested": ApiConfigTestedData;
}

/** Request names whose canonical success envelope type differs (response-as-event). */
export type RequestType = Request["type"];

/** Request → success response envelope type (reducer rows consume the canonical type). */
export const SUCCESS_TYPE_BY_REQUEST: Record<RequestType, string> = {
  "session.list": "session/list",
  "session.create": "session/created",
  "session.open": "session/opened",
  "agent.status": "agent.status",
  "agent.restart": "agent.restart",
  "turn.send": "turn.send",
  "config.get": "config.describe",
  "config.save": "config.saved",
  "config.test": "config.tested",
};

/** Error code vocabulary (spec §26.2 + bridge-defined generic codes). */
export const ERROR_CODES = {
  TURN_ACTIVE: "TURN_ACTIVE",
  NOT_READY: "NOT_READY",
  NOT_FOUND: "NOT_FOUND",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  UNKNOWN_REQUEST: "UNKNOWN_REQUEST",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  BOOT_FAILED: "BOOT_FAILED",
  /** The profile did not mount a service the configuration surface needs. */
  CONFIG_UNAVAILABLE: "CONFIG_UNAVAILABLE",
} as const;

export function errorData(code: string, message: string): ProtocolErrorData {
  return { ok: false, error: { code, message } };
}

// ---------------------------------------------------------------------------
// tiny pure helpers (used by the bridge, mirrored where needed by tests)
// ---------------------------------------------------------------------------

let presentationSeq = 0;
export function nextPresentationSeq(): number {
  presentationSeq += 1;
  return presentationSeq;
}

export function makeEnvelope(partial: {
  type: string;
  data: unknown;
  sessionId?: string | null;
  turnId?: number | null;
  requestId?: string;
  seq?: number;
}): Envelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: partial.requestId,
    sessionId: partial.sessionId ?? null,
    turnId: partial.turnId ?? null,
    seq: partial.seq ?? nextPresentationSeq(),
    type: partial.type,
    data: partial.data,
  };
}

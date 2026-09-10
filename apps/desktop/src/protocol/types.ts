/**
 * Presentation protocol types — a byte-identical re-declaration of UI Spec
 * §26/§28. The frontend imports ONLY this module for wire/state shapes; it
 * never imports `@deepseek-ai/*`, never touches DSH or SQLite types (§60).
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

export type RuntimeStatus = "starting" | "ready" | "restoring" | "disconnected" | "error" | "restarting";
export type TurnEndReason = "completed" | "aborted" | "blocked" | "error" | "max-tokens" | "interrupted";
export type AssistantStatus = "complete" | "stopped" | "failed" | "limited" | "interrupted" | "no-answer";

// ---------------------------------------------------------------------------
// §26.4 session & item shapes
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
      error?: { code: string; message: string };
      usage?: unknown;
      interrupted?: boolean;
      archived?: { olderCount: number };
    };

// ---------------------------------------------------------------------------
// §28.1 timeline rows (activity drawer log)
// ---------------------------------------------------------------------------

export type TimelineRow =
  | { type: "turn/start"; turnId: number; ts: number }
  | { type: "tool/call" | "tool/result"; turnId: number; ts: number; tool: ToolActivity }
  | { type: "chunk"; turnId: number; ts: number; chars: number }
  | { type: "step"; turnId: number; ts: number; usage?: unknown; interrupted?: boolean }
  | { type: "turn/error"; turnId: number; ts: number; code: string; message: string }
  | { type: "turn/end"; turnId: number; ts: number; reason: TurnEndReason };

// ---------------------------------------------------------------------------
// §26.2/§26.3 payloads (response data of commands + event data on the channel)
// ---------------------------------------------------------------------------

export interface RuntimeStatusData {
  status: RuntimeStatus;
  detail?: string;
}
export interface SessionListData {
  sessions: SessionSummary[];
}
export interface SessionCreatedData {
  session: SessionSummary;
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
  text: string; // text only — reasoning was dropped at the bridge (§14)
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
export interface TurnSendAcceptData {
  accepted: true;
}

// ---------------------------------------------------------------------------
// model-endpoint configuration (§26.2)
// ---------------------------------------------------------------------------

/** Whether a stored key resolves, and whether this process can change it. */
export interface ApiKeyStateData {
  ref: string;
  configured: boolean;
  /** Supplying layer; `env` means inherited and therefore read-only. */
  source?: string;
  writable: boolean;
}
/**
 * The endpoint configuration as the UI may see it. There is deliberately no
 * field anywhere in this shape that can carry a credential value (§44): the
 * UI sends a key and reads back only whether one resolves.
 */
export interface ApiConfigData {
  provider: string;
  model: string;
  /** User-supplied base URL; "" means the default endpoint is in use. */
  baseUrl: string;
  baseUrlOverridden: boolean;
  apiKey: ApiKeyStateData;
}
export interface ApiConfigSavedData {
  config: ApiConfigData;
  modelChanged: boolean;
  /** A credential write the store refused; the settings write still applied. */
  apiKeyError?: string;
}
/**
 * A probe outcome. The flag is `connected`, never `ok` — `{ ok: false }` is
 * the error-envelope discriminator (`isErrorData`), so a successful response
 * carrying a negative verdict under that name would be read as a failed
 * request by every layer downstream.
 */
export interface ApiConfigTestedData {
  connected: boolean;
  code?: string;
  /** Render-ready Chinese caption; "" on success. */
  message: string;
  latencyMs: number;
}
/**
 * A listing outcome. Same trap as the probe's flag, same answer: it is
 * `listed`, never `ok`. The one endpoint-supplied thing here is `models` —
 * model ids, which the UI offers as choices and sends back verbatim. No field
 * in this shape can carry a credential (§44).
 */
export interface ApiModelsListedData {
  listed: boolean;
  models: string[];
  code?: string;
  /** Render-ready Chinese caption; "" on success. */
  message: string;
  latencyMs: number;
}

/** One `config.save` patch; absent fields mean "leave unchanged". */
export interface ApiConfigPatchData {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

/**
 * One `config.models` draft. Both halves are one-shot: they are sent, used for
 * one outbound request, and stored nowhere — so this is a way to *ask about* an
 * endpoint the user has not committed to, not a second way to save one.
 */
export interface ApiConfigModelsDraft {
  baseUrl: string;
  apiKey?: string;
}

/** Uniform error shape `{ ok:false, error:{ code, message } }`. */
export interface ProtocolErrorData {
  ok: false;
  error: { code: string; message: string };
}

/** Error code vocabulary shared with the bridge (§26.2). */
export const ERROR_CODES = {
  TURN_ACTIVE: "TURN_ACTIVE",
  NOT_READY: "NOT_READY",
  NOT_FOUND: "NOT_FOUND",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  UNKNOWN_REQUEST: "UNKNOWN_REQUEST",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  BOOT_FAILED: "BOOT_FAILED",
  CONFIG_UNAVAILABLE: "CONFIG_UNAVAILABLE",
} as const;

export function isErrorData(data: unknown): data is ProtocolErrorData {
  const d = data as ProtocolErrorData | null | undefined;
  return d !== null && typeof d === "object" && d.ok === false && typeof d?.error?.code === "string";
}

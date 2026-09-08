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
} as const;

export function isErrorData(data: unknown): data is ProtocolErrorData {
  const d = data as ProtocolErrorData | null | undefined;
  return d !== null && typeof d === "object" && d.ok === false && typeof d?.error?.code === "string";
}

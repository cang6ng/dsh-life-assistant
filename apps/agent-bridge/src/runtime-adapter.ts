/**
 * Runtime event adapter (contract §9, §14, §15): normalizes real DSH
 * `SessionEvent`s into the frozen presentation protocol of UI Spec §26.
 *
 * Pure-ish mapping rules:
 *
 *  - reasoning is DROPPED at this boundary (contract §14): `reasoning-delta`
 *    chunks and reasoning content blocks never become presentation events;
 *  - business failures arrive as a SUCCESSFUL `tool/result` whose payload
 *    text parses to `{ ok:false, error:{ code, message } }` — normalized into
 *    the presentation `ok:false` shape (contract §15); only true tool crashes
 *    use the dsh event `error` field;
 *  - `user/message`, `request/header`, `request/context`, `session/end-seed`
 *    and other runtime-internal events never surface live (the user text was
 *    already delivered inside the turn/start of the accepted `turn.send`);
 *  - per-call `durationMs` is measured bridge-side between `tool/call` and
 *    `tool/result` (UI Spec §30.4 #5);
 *  - `turn/error` is derived from a `turn/end` whose reason is `error`
 *    (LlmFailure), emitted immediately before that `turn/end`;
 *  - `seq` on mapped envelopes = the dsh session seq (ordering integrity).
 */

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import {
  type AssistantChunkData,
  type AssistantMessageData,
  type ToolCallData,
  type ToolResultData,
  type TurnEndReason,
  type TurnStartData,
} from "./protocol.js";

export type PresentationEvent =
  | { type: "turn/start"; data: TurnStartData; seq: number; ts: number }
  | { type: "tool/call"; data: ToolCallData; seq: number; ts: number }
  | { type: "tool/result"; data: ToolResultData; seq: number; ts: number }
  | { type: "assistant/chunk"; data: AssistantChunkData; seq: number; ts: number }
  | { type: "assistant/message"; data: AssistantMessageData; seq: number; ts: number }
  | { type: "turn/error"; data: { turnId: number; code: string; message: string }; seq: number; ts: number }
  | { type: "turn/end"; data: { turnId: number; reason: TurnEndReason }; seq: number; ts: number };

/** Registry pairing tool/call with tool/result per turn (names + durationMs). */
export class ToolCallRegistry {
  private readonly perTurn = new Map<number, Map<string, { name: string; at: number }>>();

  register(turn: number, callId: string, name: string, at: number): void {
    let turnCalls = this.perTurn.get(turn);
    if (turnCalls === undefined) {
      turnCalls = new Map();
      this.perTurn.set(turn, turnCalls);
    }
    turnCalls.set(callId, { name, at });
  }

  resolve(turn: number, callId: string): { name: string; at: number } | undefined {
    return this.perTurn.get(turn)?.get(callId);
  }

  clearTurn(turn: number): void {
    this.perTurn.delete(turn);
  }
}

// ---------------------------------------------------------------------------
// payload helpers (structural, mirror the dsh shapes — see V1 spec + runtime)
// ---------------------------------------------------------------------------

function textOfBlock(block: unknown): string {
  const b = block as { type?: string; text?: string };
  return b?.type === "text" && typeof b.text === "string" ? b.text : "";
}

/** The tool-visible payload text of a ToolResultMessage. */
export function toolResultPayloadText(message: unknown): string {
  const msg = message as { content?: unknown[] };
  const block = (msg?.content ?? [])[0] as { type?: string; content?: unknown[] } | undefined;
  if (block === undefined) return "";
  const nested = Array.isArray(block.content) ? block.content : [block];
  return nested.map(textOfBlock).join("");
}

/** The assistant-visible text of an AssistantMessage (reasoning blocks excluded). */
export function assistantMessageText(message: unknown): string {
  const msg = message as { content?: unknown[] };
  return (msg?.content ?? []).map(textOfBlock).join("");
}

export interface ParsedToolPayload {
  ok: boolean;
  error?: { code: string; message: string };
  result?: unknown;
}

/** §15 normalization of the payload text inside a tool/result message. */
export function parseToolPayload(text: string): ParsedToolPayload {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true };
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") {
      const asObj = parsed as { ok?: unknown; error?: { code?: unknown; message?: unknown } };
      if (asObj.ok === false && asObj.error !== undefined) {
        const err = asObj.error;
        return {
          ok: false,
          error: {
            code: typeof err.code === "string" ? err.code : "TOOL_ERROR",
            message: typeof err.message === "string" ? err.message : "",
          },
        };
      }
      return { ok: true, result: parsed };
    }
    return { ok: true, result: parsed };
  } catch {
    // not JSON — a plain-text success payload stays visible as-is
    return { ok: true, result: trimmed };
  }
}

// ---------------------------------------------------------------------------
// per-event mapping
// ---------------------------------------------------------------------------

export interface MapContext {
  /** Text of the accepted turn.send for the next live turn/start. */
  pendingUserText: string | null;
  registry: ToolCallRegistry;
}

/**
 * Map one real DSH session event to zero or more presentation events.
 * `userTextForTurn` supplies the accepted send text when a turn/start fires.
 */
export function sessionEventToPresentation(
  event: SessionEvent,
  ctx: MapContext,
): PresentationEvent[] {
  const data = event.data as Record<string, unknown> | undefined;
  const turn = typeof data?.turn === "number" ? data.turn : undefined;
  const ts = event.time;

  switch (event.type) {
    case "turn/start": {
      if (turn === undefined) return [];
      const userText = ctx.pendingUserText ?? "";
      ctx.pendingUserText = null;
      return [{ type: "turn/start", data: { userText }, seq: event.seq, ts }];
    }

    case "tool/call": {
      if (turn === undefined) return [];
      const call = data as { callId?: unknown; name?: unknown; arguments?: unknown };
      if (typeof call.callId !== "string" || typeof call.name !== "string") return [];
      ctx.registry.register(turn, call.callId, call.name, ts);
      const args = parseToolArguments(call.arguments);
      const out: PresentationEvent = {
        type: "tool/call",
        data: { turnId: turn, tool: { name: call.name, arguments: args, callId: call.callId } },
        seq: event.seq,
        ts,
      };
      return [out];
    }

    case "tool/result": {
      if (turn === undefined) return [];
      const result = data as { callId?: unknown; message?: unknown; error?: unknown };
      if (typeof result.callId !== "string") return [];
      const reg = ctx.registry.resolve(turn, result.callId);
      const name = reg?.name ?? "tool";
      const durationMs = reg !== undefined ? Math.max(0, ts - reg.at) : 0;
      const payloadText = toolResultPayloadText(result.message);
      const parsed = parseToolPayload(payloadText);

      let ok = true;
      let error: { code: string; message: string } | undefined;
      let finalResult: unknown;
      if (result.error !== undefined) {
        // a REAL tool crash (dsh event error), not a business refusal
        const err = result.error as { code?: unknown; name?: unknown; message?: unknown };
        ok = false;
        error = {
          code: typeof err.code === "string" ? err.code : typeof err.name === "string" ? err.name : "TOOL_ERROR",
          message: typeof err.message === "string" ? err.message : "",
        };
      } else if (!parsed.ok) {
        ok = false;
        error = parsed.error;
      } else {
        finalResult = parsed.result;
      }

      const out: PresentationEvent = {
        type: "tool/result",
        data: {
          turnId: turn,
          tool: { name, callId: result.callId, durationMs, ok, error, result: finalResult },
        },
        seq: event.seq,
        ts,
      };
      return [out];
    }

    case "assistant/chunk": {
      if (turn === undefined) return [];
      const chunk = data?.chunk as { type?: string; text?: unknown } | undefined;
      if (chunk === undefined) return [];
      // §14: reasoning-delta and every non-text chunk never cross this boundary.
      if (chunk.type !== "text-delta") return [];
      const text = typeof chunk.text === "string" ? chunk.text : "";
      const out: PresentationEvent = {
        type: "assistant/chunk",
        data: { turnId: turn, text },
        seq: event.seq,
        ts,
      };
      return [out];
    }

    case "assistant/message": {
      if (turn === undefined) return [];
      const msg = data as { message?: unknown; usage?: unknown; interrupted?: unknown };
      const text = assistantMessageText(msg.message);
      const usage = msg.usage;
      const interrupted = msg.interrupted === true;
      const out: PresentationEvent = {
        type: "assistant/message",
        data: { turnId: turn, text, usage, interrupted: interrupted || undefined },
        seq: event.seq,
        ts,
      };
      return [out];
    }

    case "turn/end": {
      if (turn === undefined) return [];
      const reason = normalizeTurnEndReason(data?.reason);
      if (reason === "error") {
        // derive turn/error from the LlmFailure carried by the end event; the
        // failure fields may be spread on the event or nested under `error`.
        const err = (data?.error ?? data) as { code?: unknown; name?: unknown; message?: unknown } | undefined;
        const code =
          typeof data?.code === "string"
            ? data.code
            : typeof err?.code === "string"
              ? err.code
              : typeof err?.name === "string"
                ? err.name
                : "LLM_ERROR";
        const message =
          typeof data?.message === "string"
            ? data.message
            : typeof err?.message === "string"
              ? err.message
              : "模型调用失败，请重试。";
        return [
          {
            type: "turn/error",
            data: { turnId: turn, code, message },
            seq: event.seq,
            ts,
          },
          { type: "turn/end", data: { turnId: turn, reason }, seq: event.seq, ts },
        ];
      }
      return [{ type: "turn/end", data: { turnId: turn, reason }, seq: event.seq, ts }];
    }

    default:
      // reasoning blocks, user/message (live), request/header, request/context,
      // session/end-seed, ignorable internals — never presented live.
      return [];
  }
}

/**
 * The real dsh `turn/end` carries `reason` as `{ kind: 'completed' | … }`
 * (observed live), not a bare string — accept both shapes.
 */
export function normalizeTurnEndReason(raw: unknown): TurnEndReason {
  const kind = raw !== null && typeof raw === "object" ? (raw as { kind?: unknown }).kind : raw;
  switch (kind) {
    case "completed":
    case "aborted":
    case "blocked":
    case "error":
    case "max-tokens":
    case "interrupted":
      return kind;
    default:
      return "error";
  }
}

/** tool arguments travel as a raw JSON string — parse defensively. */
export function parseToolArguments(raw: unknown): Record<string, unknown> {
  if (raw === null || raw === undefined) return {};
  if (typeof raw === "object") {
    if (Array.isArray(raw)) return {};
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through */
    }
  }
  return {};
}

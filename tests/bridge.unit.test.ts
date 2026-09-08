/**
 * Node Bridge unit tests (contract §48): JSONL parse, Envelope, reasoning
 * filter, tool normalization (incl. the ACCESS_DENIED business-failure
 * payload), session hydration, title generation, unknown tool/event,
 * malformed protocol input.
 */

import { describe, expect, it } from "vitest";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { decodeJsonLine, encodeJsonLine } from "../apps/agent-bridge/src/jsonl";
import { ERROR_CODES, errorData, makeEnvelope } from "../apps/agent-bridge/src/protocol";
import {
  normalizeTurnEndReason,
  parseToolPayload,
  sessionEventToPresentation,
  ToolCallRegistry,
} from "../apps/agent-bridge/src/runtime-adapter";
import { buildConversationSnapshot, SNAPSHOT_MAX_TURNS } from "../apps/agent-bridge/src/session-adapter";
import { deriveTitle } from "../apps/agent-bridge/src/title-index";

// ---------------------------------------------------------------------------
// synthetic-event helpers (structural mirrors of the dsh shapes)
// ---------------------------------------------------------------------------

let seqCounter = 1000;
function eventOf(type: string, data: unknown, extra?: Partial<SessionEvent>): SessionEvent {
  seqCounter += 1;
  return { type, seq: seqCounter, time: Date.now(), data, ignorable: false, ...extra } as unknown as SessionEvent;
}

function userMessageEvent(text: string): SessionEvent {
  return eventOf("user/message", {
    content: [{ type: "text", text }],
    source: { kind: "user" },
  });
}

function turnStart(turn: number): SessionEvent {
  return eventOf("turn/start", { turn });
}

function turnEnd(turn: number, reason: "completed" | "error" | "aborted"): SessionEvent {
  if (reason === "error") {
    return eventOf("turn/end", { turn, reason: { kind: "error" }, code: "RATE_LIMITED", message: "配额耗尽" });
  }
  return eventOf("turn/end", { turn, reason: { kind: reason } });
}

function textChunk(turn: number, text: string): SessionEvent {
  return eventOf("assistant/chunk", { turn, chunk: { type: "text-delta", text } });
}

function reasoningChunk(turn: number): SessionEvent {
  return eventOf("assistant/chunk", { turn, chunk: { type: "reasoning-delta", text: "hidden chain-of-thought" } });
}

function usageChunk(turn: number): SessionEvent {
  return eventOf("assistant/chunk", { turn, chunk: { type: "usage", usage: { outputTokens: 12 } } });
}

function assistantMessage(turn: number, text: string): SessionEvent {
  return eventOf("assistant/message", {
    turn,
    step: 1,
    message: { role: "assistant", content: [{ type: "text", text }] },
    usage: { outputTokens: 12 },
  });
}

function toolCall(turn: number, callId: string, name: string, argsJson: string, at: number): SessionEvent {
  return eventOf("tool/call", { turn, step: 1, callId, name, arguments: argsJson }, { time: at });
}

function toolResultText(turn: number, callId: string, payloadText: string, at: number, error?: unknown): SessionEvent {
  // Real dsh shape (dsh-agent-loop appendToolResult): the event data carries
  // NO top-level callId — the tool-result message owns it via `source.callId`
  // and the content block's `toolCallId`.
  return eventOf(
    "tool/result",
    {
      turn,
      step: 1,
      message: {
        role: "tool",
        source: { kind: "tool", callId },
        content: [
          { type: "tool-result", toolCallId: callId, content: [{ type: "text", text: payloadText }] },
        ],
      },
      error,
    },
    { time: at },
  );
}

const mapOne = (event: SessionEvent): ReturnType<typeof sessionEventToPresentation> =>
  sessionEventToPresentation(event, { pendingUserText: null, registry: new ToolCallRegistry() });

// ---------------------------------------------------------------------------

describe("JSONL parse (contract §48)", () => {
  it("round-trips one envelope per line", () => {
    const envelope = makeEnvelope({ type: "session.list", data: { sessions: [] } });
    const line = encodeJsonLine(envelope);
    expect(decodeJsonLine(line)).toEqual(envelope);
  });

  it("rejects malformed input without throwing", () => {
    expect(decodeJsonLine("not json")).toBeNull();
    expect(decodeJsonLine("")).toBeNull();
    expect(decodeJsonLine("   ")).toBeNull();
    expect(decodeJsonLine("[1,2]")).toBeNull();
    expect(decodeJsonLine('"just a string"')).toBeNull();
    expect(decodeJsonLine("{}")).toEqual({});
  });
});

describe("Envelope (contract §48 / §26.1)", () => {
  it("defaults protocolVersion=1 and increments seq", () => {
    const a = makeEnvelope({ type: "x", data: {} });
    const b = makeEnvelope({ type: "x", data: {} });
    expect(a.protocolVersion).toBe(1);
    expect(a.seq).toBeLessThan(b.seq);
    expect(b.sessionId).toBeNull();
    expect(b.turnId).toBeNull();
  });

  it("carries requestId and explicit seq", () => {
    const e = makeEnvelope({ type: "turn.send", requestId: "r-1", seq: 42, data: { accepted: true } });
    expect(e.requestId).toBe("r-1");
    expect(e.seq).toBe(42);
  });

  it("builds the uniform error shape", () => {
    expect(errorData(ERROR_CODES.TURN_ACTIVE, "x")).toEqual({
      ok: false,
      error: { code: "TURN_ACTIVE", message: "x" },
    });
  });
});

describe("reasoning filtering (contract §14/§48)", () => {
  it("drops reasoning-delta chunks and usage chunks", () => {
    expect(mapOne(reasoningChunk(1))).toEqual([]);
    expect(mapOne(usageChunk(1))).toEqual([]);
  });

  it("keeps text-delta chunks only", () => {
    const out = mapOne(textChunk(1, "hello"));
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("assistant/chunk");
    if (out[0].type === "assistant/chunk") {
      expect(out[0].data).toEqual({ turnId: 1, text: "hello" });
    }
  });

  it("extracts only text blocks from assistant messages (no reasoning blocks)", () => {
    const event = eventOf("assistant/message", {
      turn: 1,
      step: 1,
      message: {
        role: "assistant",
        content: [
          { type: "reasoning", text: "hidden" },
          { type: "text", text: "visible answer" },
        ],
      },
    });
    const out = mapOne(event);
    expect(out).toHaveLength(1);
    if (out[0].type === "assistant/message") {
      expect(out[0].data.text).toBe("visible answer");
    }
  });
});

describe("tool normalization (contract §15/§48)", () => {
  it("parses raw JSON argument strings into objects", () => {
    const at = Date.now();
    const out = mapOne(toolCall(1, "c1", "search_catalog", '{"query":"Queen","entity_type":"album"}', at));
    expect(out).toHaveLength(1);
    if (out[0].type === "tool/call") {
      expect(out[0].data.tool).toEqual({
        name: "search_catalog",
        callId: "c1",
        arguments: { query: "Queen", entity_type: "album" },
      });
    }
  });

  it("normalizes a business ACCESS_DENIED payload into ok:false (not a crash)", () => {
    const registry = new ToolCallRegistry();
    const t0 = Date.now();
    const call = toolCall(1, "c1", "get_invoice_details", '{"invoiceId":1}', t0);
    const payload = JSON.stringify({ ok: false, error: { code: "ACCESS_DENIED", message: "无法访问该发票" } });
    const result = toolResultText(1, "c1", payload, t0 + 500);
    const out = sessionEventToPresentation(result, { pendingUserText: null, registry: registryFactory(call) });
    expect(out).toHaveLength(1);
    if (out[0].type === "tool/result") {
      expect(out[0].data.tool).toMatchObject({
        name: "get_invoice_details",
        callId: "c1",
        ok: false,
        error: { code: "ACCESS_DENIED", message: "无法访问该发票" },
      });
      expect(out[0].data.tool.durationMs).toBe(500);
      expect(out[0].data.tool.result).toBeUndefined();
    }
  });

  it("maps a REAL tool crash (event error) to ok:false with the crash code", () => {
    const registry = new ToolCallRegistry();
    const call = toolCall(1, "c1", "search_catalog", "{}", Date.now());
    const result = toolResultText(1, "c1", "", Date.now() + 10, { name: "DATABASE_ERROR", message: "db down" });
    const out = sessionEventToPresentation(result, { pendingUserText: null, registry: registryFactory(call) });
    if (out[0].type === "tool/result") {
      expect(out[0].data.tool.ok).toBe(false);
      expect(out[0].data.tool.error?.code).toBe("DATABASE_ERROR");
    }
  });

  it("passes structured JSON results through and keeps plain-text results", () => {
    const registry = new ToolCallRegistry();
    const call = toolCall(1, "c1", "search_catalog", "{}", Date.now());
    const json = JSON.stringify({ ok: true, albums: ["A1"] });
    const out = sessionEventToPresentation(toolResultText(1, "c1", json, Date.now() + 5), {
      pendingUserText: null,
      registry: registryFactory(call),
    });
    if (out[0].type === "tool/result") {
      expect(out[0].data.tool.ok).toBe(true);
      expect(out[0].data.tool.result).toEqual({ ok: true, albums: ["A1"] });
    }
    const out2 = sessionEventToPresentation(toolResultText(2, "c2", "all good", Date.now() + 5), {
      pendingUserText: null,
      registry: registryFactory(toolCall(2, "c2", "remember", "{}", Date.now())),
    });
    if (out2[0].type === "tool/result") {
      expect(out2[0].data.tool.ok).toBe(true);
      expect(out2[0].data.tool.result).toBe("all good");
    }
  });
});

function registryFactory(...calls: SessionEvent[]): ToolCallRegistry {
  const registry = new ToolCallRegistry();
  for (const call of calls) {
    const d = call.data as { turn: number; callId: string; name: string };
    sessionEventToPresentation(call, { pendingUserText: null, registry });
    void d;
  }
  return registry;
}

describe("parseToolPayload (contract §15)", () => {
  it("recognizes the business-failure envelope", () => {
    expect(parseToolPayload(JSON.stringify({ ok: false, error: { code: "NOT_FOUND", message: "没找到" } }))).toEqual({
      ok: false,
      error: { code: "NOT_FOUND", message: "没找到" },
    });
  });
  it("accepts plain text and empty payloads as success", () => {
    expect(parseToolPayload("").ok).toBe(true);
    expect(parseToolPayload("just words").result).toBe("just words");
  });
});

describe("unknown tool/event tolerance (§48)", () => {
  it("silently drops runtime-internal and unknown event types", () => {
    expect(mapOne(eventOf("request/header", {}))).toEqual([]);
    expect(mapOne(eventOf("session/end-seed", {}))).toEqual([]);
    expect(mapOne(eventOf("some-future-event", {}))).toEqual([]);
    expect(mapOne(eventOf("assistant/chunk", { turn: 1, chunk: { type: "mystery" } }))).toEqual([]);
  });
});

describe("turn/end reason normalization (§48)", () => {
  it("accepts the observed object kind and plain strings", () => {
    expect(normalizeTurnEndReason({ kind: "completed" })).toBe("completed");
    expect(normalizeTurnEndReason({ kind: "max-tokens" })).toBe("max-tokens");
    expect(normalizeTurnEndReason("aborted")).toBe("aborted");
    expect(normalizeTurnEndReason({ kind: "mystery" })).toBe("error");
  });

  it("derives turn/error from a real error end and keeps completed clean", () => {
    const errorEnd = mapOne(turnEnd(1, "error"));
    expect(errorEnd).toHaveLength(2);
    expect(errorEnd[0].type).toBe("turn/error");
    expect(errorEnd[1].type).toBe("turn/end");
    if (errorEnd[0].type === "turn/error") {
      expect(errorEnd[0].data).toEqual({ turnId: 1, code: "RATE_LIMITED", message: "配额耗尽" });
    }
    const doneEnd = mapOne(turnEnd(1, "completed"));
    expect(doneEnd).toHaveLength(1);
    expect(doneEnd[0].type).toBe("turn/end");
  });
});

describe("session hydration snapshot (§16/§48)", () => {
  const SID = "session-test-1";

  function twoTurnLog(): SessionEvent[] {
    const t0 = Date.now();
    return [
      turnStart(1),
      userMessageEvent("帮我找一些 Queen 的专辑"),
      toolCall(1, "c1", "search_catalog", '{"query":"Queen"}', t0 + 10),
      toolResultText(1, "c1", JSON.stringify({ ok: true, albums: ["Greatest Hits I"] }), t0 + 40),
      textChunk(1, "Queen "),
      textChunk(1, "有这些专辑"),
      assistantMessage(1, "Queen 有这些专辑"),
      turnEnd(1, "completed"),
      turnStart(2),
      userMessageEvent("访问别人的发票"),
      toolCall(2, "c2", "get_invoice_details", '{"invoiceId":1}', t0 + 100),
      toolResultText(
        2,
        "c2",
        JSON.stringify({ ok: false, error: { code: "ACCESS_DENIED", message: "无法访问该发票" } }),
        t0 + 120,
      ),
      assistantMessage(2, "这张发票不属于当前账户。"),
      turnEnd(2, "completed"),
    ];
  }

  it("builds items, statuses, tools and the drawer log", () => {
    const snapshot = buildConversationSnapshot(SID, 1000, twoTurnLog());
    expect(snapshot.firstUserText).toBe("帮我找一些 Queen 的专辑");
    expect(snapshot.messageCount).toBe(4); // 2 user + 2 assistant messages
    expect(snapshot.items.map((i) => i.kind)).toEqual(["user", "assistant", "user", "assistant"]);
    const [u1, a1, u2, a2] = snapshot.items;
    expect(u1).toMatchObject({ kind: "user", text: "帮我找一些 Queen 的专辑" });
    expect(a1).toMatchObject({ kind: "assistant", id: `${SID}:1`, text: "Queen 有这些专辑", status: "complete" });
    expect((a1 as { tools: unknown[] }).tools).toHaveLength(1);
    const tools = (a2 as { tools: Array<{ ok: boolean; error?: { code: string }; durationMs?: number }> }).tools;
    expect(tools[0].ok).toBe(false);
    expect(tools[0].error?.code).toBe("ACCESS_DENIED");
    expect(tools[0].durationMs).toBe(20);
    expect(a2).toMatchObject({ kind: "assistant", id: `${SID}:2`, status: "complete" });
    // log rows cover the mapped presentation stream
    const rowTypes = snapshot.log.map((r) => r.type);
    expect(rowTypes.filter((t) => t === "chunk")).toHaveLength(2);
    expect(rowTypes.filter((t) => t === "turn/end")).toHaveLength(2);
    expect(rowTypes[0]).toBe("turn/start");
  });

  it("maps aborted/error/max-tokens ends to stopped/failed/limited", () => {
    const t0 = Date.now();
    const log = [
      turnStart(1),
      userMessageEvent("hi"),
      assistantMessage(1, "partial"),
      turnEnd(1, "aborted"),
      turnStart(2),
      userMessageEvent("boom"),
      turnEnd(2, "error"),
    ];
    const snapshot = buildConversationSnapshot(SID, 0, log);
    const items = snapshot.items.filter((i) => i.kind === "assistant");
    expect(items[0]).toMatchObject({ status: "stopped" });
    expect(items[1]).toMatchObject({ status: "failed", error: { code: "RATE_LIMITED", message: "配额耗尽" } });
    void t0;
  });

  it("caps the window at 200 turns and folds older messages into one archive item", () => {
    const t0 = Date.now();
    const log: SessionEvent[] = [];
    for (let turn = 1; turn <= SNAPSHOT_MAX_TURNS + 5; turn += 1) {
      log.push(turnStart(turn), userMessageEvent(`消息 ${turn}`), assistantMessage(turn, `回答 ${turn}`), turnEnd(turn, "completed"));
    }
    const snapshot = buildConversationSnapshot(SID, t0, log);
    expect(snapshot.items.length).toBe(1 + SNAPSHOT_MAX_TURNS * 2); // archive + 200 pairs
    const archive = snapshot.items[0];
    expect(archive).toMatchObject({ kind: "assistant", archived: { olderCount: 10 } });
  });
});

describe("title generation (§5.2/§17/§48)", () => {
  it("trims, collapses newlines and truncates at 24 chars with …", () => {
    expect(deriveTitle("  你好  ")).toBe("你好");
    expect(deriveTitle("a\nb\nc")).toBe("a b c");
    expect(deriveTitle("x".repeat(24))).toBe("x".repeat(24));
    expect(deriveTitle("y".repeat(25))).toBe("y".repeat(24) + "…");
    expect(deriveTitle("   ")).toBe("");
  });
});

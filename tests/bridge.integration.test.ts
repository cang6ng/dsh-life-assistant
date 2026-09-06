/**
 * Bridge integration test (contract §48, §49): the real AgentRuntime boots
 * the actual chinook profile (no LLM call — same offline pattern as
 * agent.e2e.test.ts) and the bridge answers JSONL requests with canonical
 * presentation envelopes.
 */

import { describe, expect, it } from "vitest";
import { AgentBridge } from "../apps/agent-bridge/src/main";
import type { Envelope, SessionSummary } from "../apps/agent-bridge/src/protocol";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor(lines: Envelope[], predicate: (e: Envelope) => boolean, timeoutMs = 30_000): Promise<Envelope> {
  const start = Date.now();
  for (;;) {
    const hit = lines.find(predicate);
    if (hit !== undefined) return hit;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for envelope");
    await sleep(50);
  }
}

async function bootBridge(): Promise<{ bridge: AgentBridge; lines: Envelope[]; dispose: () => Promise<void> }> {
  const lines: Envelope[] = [];
  const bridge = new AgentBridge({
    writeLine: (line) => lines.push(JSON.parse(line) as Envelope),
  });
  await bridge.start();
  const ready = await waitFor(lines, (e) => e.type === "runtime/status" && (e.data as { status?: string }).status === "ready");
  expect(ready).toBeDefined();
  return {
    bridge,
    lines,
    dispose: () => bridge.dispose(),
  };
}

describe("AgentBridge over the real runtime", () => {
  it("starts with starting→ready and lists persisted sessions", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "s1", type: "agent.status" }));
      const status = await waitFor(lines, (e) => e.type === "agent.status");
      expect((status.data as { status: string }).status).toBe("ready");

      await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "s2", type: "session.list" }));
      const listed = await waitFor(lines, (e) => e.requestId === "s2");
      expect(listed.type).toBe("session/list");
      const sessions = (listed.data as { sessions: SessionSummary[] }).sessions;
      expect(Array.isArray(sessions)).toBe(true);
      // newest first ordering
      const createdAts = sessions.map((s) => s.createdAt);
      expect([...createdAts].sort((a, b) => b - a)).toEqual(createdAts);
    } finally {
      await dispose();
    }
  });

  it("creates a session, then opens it back to an empty hydrated conversation", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "c1", type: "session.create" }));
      const created = await waitFor(lines, (e) => e.requestId === "c1");
      expect(created.type).toBe("session/created");
      const sid = created.sessionId;
      expect(sid).toMatch(/^session-/);
      expect((created.data as { session: SessionSummary }).session.title).toBe("");

      // open the same session — hydration of a brand-new (message-less) session
      await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "o1", type: "session.open", data: { sessionId: sid } }));
      const opened = await waitFor(lines, (e) => e.requestId === "o1");
      expect(opened.type).toBe("session/opened");
      const data = opened.data as { session: SessionSummary; items: unknown[]; log: unknown[] };
      expect(data.session.sessionId).toBe(sid);
      expect(data.items).toEqual([]);
      expect(data.log).toEqual([]);
    } finally {
      await dispose();
    }
  });

  it("guards turn.send: NOT_READY without an open session / INVALID_ARGUMENT on empty text", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      await bridge.handleRequestLine(
        JSON.stringify({ protocolVersion: 1, requestId: "t1", type: "turn.send", data: { sessionId: "nope", text: "hi" } }),
      );
      const rejected = await waitFor(lines, (e) => e.requestId === "t1");
      expect(rejected.type).toBe("turn.send");
      expect(rejected.data).toMatchObject({ ok: false, error: { code: "NOT_READY" } });

      await bridge.handleRequestLine(
        JSON.stringify({ protocolVersion: 1, requestId: "c2", type: "session.create" }),
      );
      const created = await waitFor(lines, (e) => e.requestId === "c2");
      await bridge.handleRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          requestId: "t2",
          type: "turn.send",
          data: { sessionId: created.sessionId, text: "   " },
        }),
      );
      const empty = await waitFor(lines, (e) => e.requestId === "t2");
      expect(empty.data).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
    } finally {
      await dispose();
    }
  });

  it("answers unknown requests and malformed lines without crashing", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      await bridge.handleRequestLine("this is not json {");
      await bridge.handleRequestLine(JSON.stringify({ hello: "world" }));
      await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "u1", type: "no.such.request" }));
      const unknown = await waitFor(lines, (e) => e.requestId === "u1");
      expect(unknown.data).toMatchObject({ ok: false, error: { code: "UNKNOWN_REQUEST" } });
      expect(unknown.type).toBe("no.such.request");
    } finally {
      await dispose();
    }
  });
});

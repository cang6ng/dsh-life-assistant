/**
 * Bridge integration test (contract §48, §49): the real AgentRuntime boots
 * the actual chinook profile (no LLM call — same offline pattern as
 * agent.e2e.test.ts) and the bridge answers JSONL requests with canonical
 * presentation envelopes.
 *
 * Isolation: every suite that boots the real runtime used to share the
 * repository `.dsh`, so under Vitest file-level parallelism one suite's
 * session.create could land inside another's listSessions() assertion. This
 * suite provisions its own throwaway home (helpers/test-home.ts) and sets
 * `$DSH_HOME` BEFORE the dynamic import of the bridge module (cli/runtime
 * binds the home at import time). Vitest's forks pool runs each test file in
 * its own worker process — the env cannot leak across files.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Envelope, SessionSummary } from "../apps/agent-bridge/src/protocol";
import { cleanupTestHome, provisionTestHome } from "./helpers/test-home";

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Suite-local home + lazily imported bridge class (import must follow env). */
let home: string | undefined;
let agentBridgeCtor: typeof import("../apps/agent-bridge/src/main").AgentBridge | undefined;

async function loadAgentBridge(): Promise<typeof import("../apps/agent-bridge/src/main").AgentBridge> {
  if (agentBridgeCtor === undefined) {
    if (home === undefined) throw new Error("test home not provisioned");
    process.env.DSH_HOME = home; // must precede the runtime module import
    const mod = await import("../apps/agent-bridge/src/main");
    agentBridgeCtor = mod.AgentBridge;
  }
  return agentBridgeCtor;
}

async function waitFor(lines: Envelope[], predicate: (e: Envelope) => boolean, timeoutMs = 30_000): Promise<Envelope> {
  const start = Date.now();
  for (;;) {
    const hit = lines.find(predicate);
    if (hit !== undefined) return hit;
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for envelope");
    await sleep(50);
  }
}

/** Instance type of the lazily loaded bridge class (type-only — no module eval). */
type AgentBridgeInstance = import("../apps/agent-bridge/src/main").AgentBridge;

async function bootBridge(): Promise<{ bridge: AgentBridgeInstance; lines: Envelope[]; dispose: () => Promise<void> }> {
  const AgentBridge = await loadAgentBridge();
  const lines: Envelope[] = [];
  const bridge = new AgentBridge({
    dshHome: home,
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
  beforeAll(() => {
    home = provisionTestHome();
  });

  afterAll(() => {
    delete process.env.DSH_HOME;
    cleanupTestHome(home);
    home = undefined;
  });

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

  it("restart substrate: a fresh bridge (like a respawned sidecar) boots with no open session, rejects turn.send NOT_READY, and only the session.open of the persisted session makes it ready again", { timeout: 90_000 }, async () => {
    // Bridge instance 1 persists a session (crash before dispose simulates the
    // sidecar death — the session store is flushed to disk by the runtime).
    let createdId: string | null = null;
    {
      const { bridge, lines, dispose } = await bootBridge();
      try {
        await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "cr1", type: "session.create" }));
        const created = await waitFor(lines, (e) => e.requestId === "cr1");
        expect(created.type).toBe("session/created");
        createdId = created.sessionId ?? null; // P2: envelope sessionId is `string | null | undefined`
      } finally {
        await dispose();
      }
    }
    expect(createdId).toMatch(/^session-/);

    // Bridge instance 2 = the fresh process after a restart: no session bound.
    const { bridge, lines, dispose } = await bootBridge();
    try {
      // P1 root: a turn sent without reopening fails NOT_READY — this is the
      // "fake ready" send failure the desktop repair eliminates.
      await bridge.handleRequestLine(
        JSON.stringify({ protocolVersion: 1, requestId: "tp1", type: "turn.send", data: { sessionId: createdId, text: "hi" } }),
      );
      const rejected = await waitFor(lines, (e) => e.requestId === "tp1");
      expect(rejected.type).toBe("turn.send");
      expect(rejected.data).toMatchObject({ ok: false, error: { code: "NOT_READY" } });

      // session.open re-binds the persisted session in the fresh bridge.
      await bridge.handleRequestLine(
        JSON.stringify({ protocolVersion: 1, requestId: "op1", type: "session.open", data: { sessionId: createdId } }),
      );
      const opened = await waitFor(lines, (e) => e.requestId === "op1");
      expect(opened.type).toBe("session/opened");
      expect(opened.sessionId).toBe(createdId);

      // The bridge is ready again and the reopened session is the open one —
      // a subsequent turn.send passes the guard (the real agent turn runs in
      // the desktop runtime verification, §9).
      await bridge.handleRequestLine(JSON.stringify({ protocolVersion: 1, requestId: "st1", type: "agent.status" }));
      const status = await waitFor(lines, (e) => e.requestId === "st1");
      expect((status.data as { status: string }).status).toBe("ready");
    } finally {
      await dispose();
    }
  });
});

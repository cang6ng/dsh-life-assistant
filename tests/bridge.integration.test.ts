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

import { readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiConfigData, ApiModelsListedData, Envelope, SessionSummary } from "../apps/agent-bridge/src/protocol";
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

/** One request/response round trip through the real bridge. */
async function send(bridge: AgentBridgeInstance, lines: Envelope[], type: string, data?: unknown): Promise<Envelope> {
  const requestId = `q-${type}-${lines.length}`;
  await bridge.handleRequestLine(
    JSON.stringify({ protocolVersion: 1, requestId, type, ...(data === undefined ? {} : { data }) }),
  );
  return waitFor(lines, (e) => e.requestId === requestId);
}

// File-scoped: both suites below share the one throwaway home, so the
// teardown must outlive the first `describe` (a describe-scoped afterAll
// would delete the home out from under the second one).
beforeAll(() => {
  // The credential store refuses a write for any ref the launching
  // environment supplies, and `createAgentRuntime` aliases
  // ANTHROPIC_AUTH_TOKEN onto DEEPSEEK_API_KEY. A developer machine with
  // either exported would silently turn the config suite below into
  // read-only assertions, so the suite pins its own environment.
  delete process.env.DEEPSEEK_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  home = provisionTestHome();
});

afterAll(() => {
  delete process.env.DSH_HOME;
  cleanupTestHome(home);
  home = undefined;
});

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

/**
 * The configuration surface against the REAL profile: the mounted
 * `llm-deepseek` namespace, the real credential store, real files. No model
 * call is made anywhere in this block — `config.test` needs a live endpoint
 * and belongs to the manual end-to-end pass.
 *
 * The credential assertions read the file for the reference NAME and the
 * document's own shape; the value is checked only inside this throwaway home,
 * which is deleted with it, and never in the response.
 */
describe("AgentBridge configuration surface over the real runtime", () => {
  const KEY = "sk-integration-only-000000000000";

  it("describes the mounted namespaces before anything is configured", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const res = await send(bridge, lines, "config.get");
      expect(res.type).toBe("config.describe");
      const config = res.data as ApiConfigData;
      expect(config.provider).toBe("deepseek-official");
      expect(config.model).not.toBe("");
      // Nothing stored yet: the adapter's own default is in effect.
      expect(config.baseUrlOverridden).toBe(false);
      expect(config.apiKey).toEqual({
        ref: "DEEPSEEK_API_KEY",
        configured: false,
        writable: true,
      });
    } finally {
      await dispose();
    }
  });

  it("writes base URL, model and key to the throwaway home and never echoes the key", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const res = await send(bridge, lines, "config.save", {
        baseUrl: "https://gateway.invalid/v1",
        model: "gpt-4o-mini",
        apiKey: KEY,
      });
      expect(res.type).toBe("config.saved");
      const data = res.data as { config: ApiConfigData; modelChanged: boolean; apiKeyError?: string };
      expect(data.apiKeyError).toBeUndefined();
      expect(data.modelChanged).toBe(true);
      expect(data.config).toMatchObject({
        model: "gpt-4o-mini",
        baseUrl: "https://gateway.invalid/v1",
        baseUrlOverridden: true,
        apiKey: { configured: true, writable: true },
      });
      // The write-only contract, end to end.
      expect(JSON.stringify(res.data)).not.toContain(KEY);

      // The settings layer owns `baseURL` under the adapter's namespace.
      const settings = readFileSync(join(home as string, "settings.yaml"), "utf8");
      expect(settings).toContain("llm-deepseek");
      expect(settings).toContain("baseURL");
      expect(settings).toContain("gateway.invalid");
      // The model was written through ITS service, into its own namespace.
      expect(readFileSync(join(home as string, "settings.yaml"), "utf8")).toContain("agent-default-model");

      // The credential document keeps its strict shape, and holds the ref.
      const credentials = readFileSync(join(home as string, ".credentials.yaml"), "utf8");
      expect(credentials).toContain("version: 1");
      expect(credentials).toContain("refs:");
      expect(credentials).toContain("DEEPSEEK_API_KEY");

      // A later read agrees with the store rather than with our response.
      const after = await send(bridge, lines, "config.get");
      expect((after.data as ApiConfigData).apiKey.configured).toBe(true);
    } finally {
      await dispose();
    }
  });

  it("keeps the stored key when a later save omits it, and clears it only on request", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      // Omitted apiKey — the ordinary "I only changed the model" save.
      const kept = await send(bridge, lines, "config.save", { model: "deepseek-v4-flash" });
      const keptData = kept.data as { config: ApiConfigData; apiKeyError?: string };
      expect(keptData.apiKeyError).toBeUndefined();
      // `source: "file"` is the whole point: the key resolves from the managed
      // store, not from a launching environment that would outrank it.
      expect(keptData.config.apiKey).toEqual({
        ref: "DEEPSEEK_API_KEY",
        configured: true,
        source: "file",
        writable: true,
      });
      const credentialsPath = join(home as string, ".credentials.yaml");
      expect(readFileSync(credentialsPath, "utf8")).toContain("DEEPSEEK_API_KEY");

      // An empty key means the same thing as an omitted one; the bridge drops
      // it, so this is really asserting the patch never said "clear".
      const emptied = await send(bridge, lines, "config.save", { apiKey: "" });
      expect(emptied.data).toMatchObject({ ok: false, error: { code: "INVALID_ARGUMENT" } });
      expect(readFileSync(credentialsPath, "utf8")).toContain("DEEPSEEK_API_KEY");

      // The explicit act.
      const cleared = await send(bridge, lines, "config.save", { clearApiKey: true });
      const clearedData = cleared.data as { config: ApiConfigData; apiKeyError?: string };
      expect(clearedData.apiKeyError).toBeUndefined();
      expect(clearedData.config.apiKey.configured).toBe(false);
      expect(readFileSync(credentialsPath, "utf8")).not.toContain("DEEPSEEK_API_KEY");
      // Clearing a credential must not disturb the endpoint beside it.
      expect(clearedData.config.baseUrl).toBe("https://gateway.invalid/v1");
    } finally {
      await dispose();
    }
  });

  it("resets an overridden base URL back to the adapter default", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const reset = await send(bridge, lines, "config.save", { baseUrl: "" });
      const config = (reset.data as { config: ApiConfigData }).config;
      expect(config.baseUrlOverridden).toBe(false);
      // "" is the absence of an override, not a broken endpoint: the mounted
      // adapter row declares no `baseURL`, so nothing surfaces a resolved
      // value here and the adapter applies its own default at call time. The
      // panel renders this as an empty field with the default as placeholder,
      // which is what the copy promises.
      expect(config.baseUrl).toBe("");
    } finally {
      await dispose();
    }
  });
});

/**
 * 获取模型 — `config.models` against the REAL runtime and a real socket.
 *
 * The endpoint is a throwaway `node:http` server on 127.0.0.1:0: offline, no
 * model call, and the only way to pin what actually goes out on the wire. Two
 * things can only be asserted here: that the stored credential is resolved
 * through the real store when the draft carries no key, and that a draft key
 * is what the header carries when it does.
 *
 * The stub deliberately echoes the Authorization header into its 401 body — a
 * gateway that does that is exactly the case the code-only caption exists for,
 * and the leak assertions below are only real because it does.
 */
describe("AgentBridge model listing over the real runtime", () => {
  const LIST_KEY = "sk-listing-integration-000000000000";
  const WRONG_KEY = "sk-listing-wrong-0000000000000";

  let server: Server | undefined;
  let origin = "";
  /** Every request the stub saw — the assertion surface for the bearer. */
  const seen: Array<{ url: string; authorization?: string }> = [];

  beforeAll(async () => {
    const stub = createServer((req, res) => {
      const authorization = req.headers.authorization;
      seen.push({ url: req.url ?? "", ...(authorization === undefined ? {} : { authorization }) });
      const answer = (status: number, body: unknown): void => {
        res.writeHead(status, { "content-type": "application/json" });
        res.end(JSON.stringify(body));
      };
      if (req.url === "/v1/models") {
        if (authorization !== `Bearer ${LIST_KEY}`) {
          answer(401, { error: { message: `invalid key: ${authorization ?? "none"}` } });
          return;
        }
        answer(200, {
          object: "list",
          data: [{ id: "stub-a" }, { id: "stub-b", object: "model" }, { id: "stub-c" }],
        });
        return;
      }
      answer(404, { error: { message: "no such route" } });
    });
    server = stub;
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    const address = stub.address();
    if (address === null || typeof address === "string") throw new Error("stub has no port");
    origin = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    if (server === undefined) return;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
  });

  it("lists through the STORED credential when the draft carries no key", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const saved = await send(bridge, lines, "config.save", { baseUrl: `${origin}/v1`, apiKey: LIST_KEY });
      expect(saved.type).toBe("config.saved");

      const res = await send(bridge, lines, "config.models", { baseUrl: `${origin}/v1` });
      expect(res.type).toBe("config.listed");
      const data = res.data as ApiModelsListedData;
      expect(data.listed).toBe(true);
      expect(data.code).toBeUndefined();
      expect(data.models).toEqual(["stub-a", "stub-b", "stub-c"]);
      expect(data.message).toBe("");
      // The key the adapter itself would use, read from the managed store and
      // put on the wire as a bearer — and nowhere in the answer.
      expect(seen.at(-1)?.authorization).toBe(`Bearer ${LIST_KEY}`);
      expect(JSON.stringify(res.data)).not.toContain(LIST_KEY);
      // Listing asks and never writes: the draft is not a second save path.
      const after = await send(bridge, lines, "config.get");
      expect((after.data as ApiConfigData).model).not.toBe("");
    } finally {
      await dispose();
    }
  });

  it("sends the DRAFT key when there is one, and leaks nothing when it is refused", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const res = await send(bridge, lines, "config.models", {
        baseUrl: `${origin}/v1`,
        apiKey: WRONG_KEY,
      });
      expect(res.type).toBe("config.listed");
      expect(res.data).toMatchObject({ listed: false, models: [], code: "HTTP_401" });
      // The draft outranks the stored key for this one request…
      expect(seen.at(-1)?.authorization).toBe(`Bearer ${WRONG_KEY}`);
      // …and the stub's body, which echoes it, reaches neither the caption nor
      // any other field: the answer carries the code and the table's wording.
      const data = res.data as ApiModelsListedData;
      expect(data.message).toContain("API Key 被拒绝");
      expect(JSON.stringify(res.data)).not.toContain(WRONG_KEY);
      expect(JSON.stringify(res.data)).not.toContain("invalid key");
    } finally {
      await dispose();
    }
  });

  it("answers a keyless 401 as 'no credential' — and never sends a bare bearer", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const cleared = await send(bridge, lines, "config.save", { clearApiKey: true });
      expect(cleared.type).toBe("config.saved");

      const res = await send(bridge, lines, "config.models", { baseUrl: `${origin}/v1` });
      expect(res.data).toMatchObject({ listed: false, models: [], code: "HTTP_401" });
      expect((res.data as ApiModelsListedData).message).toContain("尚未配置 API Key");
      // "No credential" is an absent header, not an empty one.
      expect(Object.hasOwn(seen.at(-1) ?? {}, "authorization")).toBe(false);
    } finally {
      await dispose();
    }
  });

  it("maps an endpoint with no listing route to a 'type it yourself' caption", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const res = await send(bridge, lines, "config.models", { baseUrl: `${origin}/nope` });
      expect(res.data).toMatchObject({ listed: false, models: [], code: "HTTP_404" });
      expect((res.data as ApiModelsListedData).message).toContain("请手动填写模型名称");
    } finally {
      await dispose();
    }
  });

  it("refuses a blank base URL without opening a connection at all", { timeout: 60_000 }, async () => {
    const { bridge, lines, dispose } = await bootBridge();
    try {
      const before = seen.length;
      const res = await send(bridge, lines, "config.models", { baseUrl: "" });
      // A successful request carrying a negative verdict — never an error
      // envelope, because the bridge did not refuse it and the panel renders
      // the two the same way as a caption.
      expect(res.type).toBe("config.listed");
      expect(res.data).toMatchObject({ listed: false, models: [], code: "NO_BASE_URL" });
      expect((res.data as ApiModelsListedData).message).toContain("请先填写 Base URL");
      expect(seen.length).toBe(before);
    } finally {
      await dispose();
    }
  });
});

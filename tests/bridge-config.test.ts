/**
 * Bridge model-endpoint configuration (v1.0.2, contract §44): the three
 * `config.*` requests, their guards, and — the point of the whole file — the
 * credential's ONE-WAY journey.
 *
 * The bridge is driven through the injectable `RuntimeFactory` seam
 * (main.ts:61), so a recording fake stands in for the real AgentRuntime: what
 * it *receives* is the assertion surface for the key, and what the bridge
 * *emits* (both protocol lines and stderr diagnostics) is checked to contain
 * no trace of it. The probe-failure caption table, being pure, is imported
 * directly from apps/cli/src/probe-failure.ts.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AgentBridge, type RuntimeFactory } from "../apps/agent-bridge/src/main";
import { ERROR_CODES, SUCCESS_TYPE_BY_REQUEST, type Envelope } from "../apps/agent-bridge/src/protocol";
import { describeProbeFailure } from "../apps/cli/src/probe-failure";
import type {
  AgentRuntime,
  ApiConfig,
  ApiConfigPatch,
  ApiConfigSaveResult,
  ApiModelsDraft,
  ApiModelsResult,
  ApiProbeResult,
} from "../apps/cli/src/runtime";

/**
 * A value no legitimate output can contain by accident. Short and distinctive
 * enough that `expect(text).not.toContain(KEY)` is a real assertion.
 */
const KEY = "sk-bridge-test-DEADBEEF0123456789";

const BASE_CONFIG: ApiConfig = {
  provider: "deepseek-official",
  model: "deepseek-v4-flash",
  baseUrl: "",
  baseUrlOverridden: false,
  apiKey: { ref: "DEEPSEEK_API_KEY", configured: false, writable: true },
};

/** The recording stand-in: a real AgentRuntime in shape, a ledger in practice. */
class FakeRuntime implements AgentRuntime {
  patches: ApiConfigPatch[] = [];
  config: ApiConfig = BASE_CONFIG;
  probe: ApiProbeResult = { connected: true, message: "", latencyMs: 12 };
  /** Every listing draft, verbatim — the assertion surface for its key. */
  drafts: ApiModelsDraft[] = [];
  listed: ApiModelsResult = { listed: true, models: ["m-1", "m-2"], message: "", latencyMs: 8 };
  /** Set when the fake should reject the next save like a real service would. */
  saveThrows: Error | null = null;
  /** Set when the fake should fail the next listing like a real service would. */
  listThrows: Error | null = null;

  private releaseAsk: (() => void) | null = null;

  async startSession(): Promise<string> {
    return "session-fake-1";
  }
  async ask(): Promise<string> {
    await new Promise<void>((resolve) => {
      this.releaseAsk = resolve;
    });
    return "";
  }
  /** Let a suspended turn finish so the test process can exit cleanly. */
  finishTurn(): void {
    this.releaseAsk?.();
    this.releaseAsk = null;
  }
  async listSessions(): Promise<Array<{ id: string; createdAt: number }>> {
    return [];
  }
  async closeSession(): Promise<void> {}
  async dispose(): Promise<void> {}
  subscribeSessionEvents(): () => void {
    return () => {};
  }
  describeActiveSession(): { id: string; createdAt: number } | null {
    return null;
  }
  readActiveSessionSnapshot(): null {
    return null;
  }
  async readApiConfig(): Promise<ApiConfig> {
    return this.config;
  }
  async saveApiConfig(patch: ApiConfigPatch): Promise<ApiConfigSaveResult> {
    if (this.saveThrows !== null) throw this.saveThrows;
    this.patches.push(patch);
    return { config: this.config, modelChanged: patch.model !== undefined };
  }
  async testApiConnection(): Promise<ApiProbeResult> {
    return this.probe;
  }
  async listApiModels(draft: ApiModelsDraft): Promise<ApiModelsResult> {
    if (this.listThrows !== null) throw this.listThrows;
    this.drafts.push(draft);
    return this.listed;
  }
}

let home: string;

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "chinook-bridge-config-"));
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
});

interface Harness {
  bridge: AgentBridge;
  runtime: FakeRuntime | null;
  lines: Envelope[];
  logs: string[];
  /** Everything the bridge wrote anywhere, for the leak assertions. */
  allOutput: () => string;
  send: (type: string, data?: unknown) => Promise<Envelope>;
}

async function boot(runtime: FakeRuntime | null): Promise<Harness> {
  const lines: Envelope[] = [];
  const logs: string[] = [];
  const factory: RuntimeFactory = async () => {
    if (runtime === null) throw new Error("runtime unavailable (deliberate)");
    return runtime;
  };
  const bridge = new AgentBridge(
    {
      dshHome: home,
      writeLine: (line) => lines.push(JSON.parse(line) as Envelope),
      log: (line) => logs.push(line),
    },
    factory,
  );
  await bridge.start();
  let counter = 0;
  return {
    bridge,
    runtime,
    lines,
    logs,
    allOutput: () => [...lines.map((l) => JSON.stringify(l)), ...logs].join("\n"),
    send: async (type, data) => {
      counter += 1;
      const requestId = `rq-${counter}`;
      await bridge.handleRequestLine(
        JSON.stringify({ protocolVersion: 1, requestId, type, ...(data === undefined ? {} : { data }) }),
      );
      const hit = lines.find((e) => e.requestId === requestId);
      if (hit === undefined) throw new Error(`no response for ${type}`);
      return hit;
    },
  };
}

describe("config protocol pairing (v1.0.2)", () => {
  it("routes every request type to a distinct success type", () => {
    const targets = Object.values(SUCCESS_TYPE_BY_REQUEST);
    expect(new Set(targets).size).toBe(targets.length);
    expect(SUCCESS_TYPE_BY_REQUEST["config.get"]).toBe("config.describe");
    expect(SUCCESS_TYPE_BY_REQUEST["config.save"]).toBe("config.saved");
    expect(SUCCESS_TYPE_BY_REQUEST["config.test"]).toBe("config.tested");
    expect(SUCCESS_TYPE_BY_REQUEST["config.models"]).toBe("config.listed");
  });
});

describe("config.get → config.describe (v1.0.2)", () => {
  it("returns the read shape and never a value", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const res = await h.send("config.get");
      expect(res.type).toBe("config.describe");
      expect(res.data).toEqual(BASE_CONFIG);
      // The absence is the contract: no field of this shape can hold a secret.
      const serialized = JSON.stringify(res.data);
      expect(serialized).not.toContain("value");
      expect(serialized).not.toContain(KEY);
    } finally {
      await h.bridge.dispose();
    }
  });

  it("answers NOT_READY while no runtime is up, like every other request", { timeout: 20_000 }, async () => {
    const h = await boot(null);
    try {
      const res = await h.send("config.get");
      expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.NOT_READY } });
    } finally {
      await h.bridge.dispose();
    }
  });

  it("reports a settings failure as CONFIG_UNAVAILABLE rather than crashing", { timeout: 20_000 }, async () => {
    const runtime = new FakeRuntime();
    runtime.readApiConfig = async () => {
      throw new Error("settings namespace missing");
    };
    const h = await boot(runtime);
    try {
      const res = await h.send("config.get");
      expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.CONFIG_UNAVAILABLE } });
    } finally {
      await h.bridge.dispose();
    }
  });
});

describe("config.save (v1.0.2)", () => {
  it("delivers the key to the runtime and to nowhere else", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const res = await h.send("config.save", {
        baseUrl: "https://gateway.example.com/v1",
        model: "gpt-4o-mini",
        apiKey: KEY,
      });
      expect(res.type).toBe("config.saved");
      expect(res.data).toMatchObject({ modelChanged: true });

      // It arrived, verbatim and only as an argument.
      expect(h.runtime?.patches).toEqual([
        { baseUrl: "https://gateway.example.com/v1", model: "gpt-4o-mini", apiKey: KEY },
      ]);
      // …and it left no trace on the wire or in the diagnostics. The log line
      // for a save reports flags, never values.
      expect(h.allOutput()).not.toContain(KEY);
      expect(h.logs.join("\n")).toContain("apiKey=true");
    } finally {
      await h.bridge.dispose();
    }
  });

  it("passes an ABSENT apiKey through as absent — the keep-the-stored-one path", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      await h.send("config.save", { model: "gpt-4o-mini" });
      const patch = h.runtime?.patches[0] as ApiConfigPatch;
      // Not `undefined`-valued: the property must not exist, because a real
      // runtime branches on `patch.apiKey !== undefined` and a present-but-
      // undefined key is the shape that would clear the stored credential.
      expect(Object.hasOwn(patch, "apiKey")).toBe(false);
      expect(Object.hasOwn(patch, "baseUrl")).toBe(false);
      expect(Object.hasOwn(patch, "clearApiKey")).toBe(false);
    } finally {
      await h.bridge.dispose();
    }
  });

  it("reads an EMPTY apiKey as 'keep', and a true clearApiKey as a clear", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      // A write-only field renders empty on every open, so an empty submit is
      // the ordinary case, not a request — it contributes nothing to the patch.
      const empty = await h.send("config.save", { apiKey: "" });
      expect(h.runtime?.patches).toEqual([]);
      expect(empty.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.INVALID_ARGUMENT } });

      await h.send("config.save", { clearApiKey: true });
      expect(h.runtime?.patches).toEqual([{ clearApiKey: true }]);
    } finally {
      await h.bridge.dispose();
    }
  });

  it("rejects a patch that asks for nothing, and a non-boolean clear flag", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      // An empty patch is a client bug, not a no-op save: answer it loudly.
      for (const payload of [{}, { clearApiKey: "yes" }, { model: 7 }]) {
        const res = await h.send("config.save", payload);
        expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.INVALID_ARGUMENT } });
      }
      expect(h.runtime?.patches).toEqual([]);
    } finally {
      await h.bridge.dispose();
    }
  });

  it("surfaces a rejected key as INVALID_ARGUMENT with the runtime's own Chinese wording", { timeout: 20_000 }, async () => {
    const runtime = new FakeRuntime();
    runtime.saveThrows = new Error("API Key 含非法字符（空格或换行）");
    const h = await boot(runtime);
    try {
      const res = await h.send("config.save", { apiKey: "sk-a b" });
      expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.INVALID_ARGUMENT } });
      expect(JSON.stringify(res.data)).toContain("API Key 含非法字符");
    } finally {
      await h.bridge.dispose();
    }
  });

  it("guards against changing the endpoint mid-turn", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const created = await h.send("session.create");
      const sessionId = created.sessionId;
      // A turn that never settles keeps the bridge busy.
      const turn = h.bridge.handleRequestLine(
        JSON.stringify({ protocolVersion: 1, requestId: "t1", type: "turn.send", data: { sessionId, text: "hi" } }),
      );
      const accepted = h.lines.find((e) => e.requestId === "t1");
      expect(accepted?.data).toEqual({ accepted: true });

      const blocked = await h.send("config.save", { model: "x" });
      expect(blocked.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.TURN_ACTIVE } });

      h.runtime?.finishTurn();
      await turn;
    } finally {
      await h.bridge.dispose();
    }
  });
});

describe("config.test (v1.0.2)", () => {
  it("passes a success verdict through — and names the flag `connected`, never `ok`", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const res = await h.send("config.test");
      expect(res.type).toBe("config.tested");
      expect(res.data).toEqual({ connected: true, message: "", latencyMs: 12 });
      // `{ ok: false }` is the error-envelope discriminator; a successful
      // response carrying a negative verdict under that name would be read as
      // a failed request by every layer downstream.
      expect(Object.hasOwn(res.data as object, "ok")).toBe(false);
    } finally {
      await h.bridge.dispose();
    }
  });

  it("passes a failure verdict through with its mapped caption and code", { timeout: 20_000 }, async () => {
    const runtime = new FakeRuntime();
    runtime.probe = {
      connected: false,
      code: "AUTH",
      message: describeProbeFailure({ code: "AUTH" }),
      latencyMs: 340,
    };
    const h = await boot(runtime);
    try {
      const res = await h.send("config.test");
      expect(res.data).toMatchObject({ connected: false, code: "AUTH", latencyMs: 340 });
      expect((res.data as { message: string }).message).toContain("API Key 被拒绝");
    } finally {
      await h.bridge.dispose();
    }
  });

  it("reports an unroutable probe as CONFIG_UNAVAILABLE", { timeout: 20_000 }, async () => {
    const runtime = new FakeRuntime();
    runtime.testApiConnection = async () => {
      throw new Error("llm service not mounted");
    };
    const h = await boot(runtime);
    try {
      const res = await h.send("config.test");
      expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.CONFIG_UNAVAILABLE } });
    } finally {
      await h.bridge.dispose();
    }
  });

  it("guards against probing mid-turn", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const created = await h.send("session.create");
      const turn = h.bridge.handleRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          requestId: "t1",
          type: "turn.send",
          data: { sessionId: created.sessionId, text: "hi" },
        }),
      );
      const blocked = await h.send("config.test");
      expect(blocked.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.TURN_ACTIVE } });
      h.runtime?.finishTurn();
      await turn;
    } finally {
      await h.bridge.dispose();
    }
  });
});

describe("config.models (v1.0.2)", () => {
  it("delivers the draft to the runtime and to nowhere else", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const res = await h.send("config.models", { baseUrl: "https://gateway.example.com/v1", apiKey: KEY });
      expect(res.type).toBe("config.listed");
      expect(res.data).toMatchObject({ listed: true, models: ["m-1", "m-2"] });
      // Verbatim and only as an argument — the same journey `config.save`'s key
      // takes, and the draft is stored nowhere on the way (no patch is written).
      expect(h.runtime?.drafts).toEqual([
        { baseUrl: "https://gateway.example.com/v1", apiKey: KEY },
      ]);
      expect(h.runtime?.patches).toEqual([]);
      // `{ ok: false }` is the error-envelope discriminator; a *successful*
      // request whose listing failed would otherwise be read as a failed one.
      expect(Object.hasOwn(res.data as object, "ok")).toBe(false);
      expect(h.allOutput()).not.toContain(KEY);
      expect(h.logs.join("\n")).toContain("draftKey=true");
    } finally {
      await h.bridge.dispose();
    }
  });

  it("passes an ABSENT or EMPTY apiKey through as absent — the stored-key path", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      await h.send("config.models", { baseUrl: "https://gateway.example.com/v1" });
      await h.send("config.models", { baseUrl: "https://gateway.example.com/v1", apiKey: "" });
      // Not `undefined`-valued: a real runtime branches on
      // `draft.apiKey === undefined` to decide whether to resolve the stored
      // credential, and a present-but-empty key is not the same request.
      expect(h.runtime?.drafts).toEqual([
        { baseUrl: "https://gateway.example.com/v1" },
        { baseUrl: "https://gateway.example.com/v1" },
      ]);
      for (const draft of h.runtime?.drafts ?? []) {
        expect(Object.hasOwn(draft, "apiKey")).toBe(false);
      }
    } finally {
      await h.bridge.dispose();
    }
  });

  it("rejects a missing base URL and a non-string key", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      // What the bridge judges is the SHAPE. An empty string is a well-formed
      // base URL, and the runtime answers it in the listing's own vocabulary
      // (NO_BASE_URL) — judging the URL itself is the panel's and the host's
      // job, so a blank one is deliberately not an INVALID_ARGUMENT here.
      for (const payload of [{}, { baseUrl: 7 }, { baseUrl: "https://x.example", apiKey: 7 }]) {
        const res = await h.send("config.models", payload);
        expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.INVALID_ARGUMENT } });
      }
      expect(h.runtime?.drafts).toEqual([]);
    } finally {
      await h.bridge.dispose();
    }
  });

  it("passes a failed listing through as a caption, not as an error envelope", { timeout: 20_000 }, async () => {
    const runtime = new FakeRuntime();
    runtime.listed = {
      listed: false,
      models: [],
      code: "HTTP_404",
      message: "该端点未提供模型列表（404），请手动填写模型名称",
      latencyMs: 21,
    };
    const h = await boot(runtime);
    try {
      const res = await h.send("config.models", { baseUrl: "https://gateway.example.com/v1" });
      expect(res.type).toBe("config.listed");
      expect(res.data).toMatchObject({ listed: false, models: [], code: "HTTP_404" });
      expect(JSON.stringify(res.data)).toContain("请手动填写模型名称");
    } finally {
      await h.bridge.dispose();
    }
  });

  it("reports an unroutable listing as CONFIG_UNAVAILABLE rather than crashing", { timeout: 20_000 }, async () => {
    const runtime = new FakeRuntime();
    runtime.listThrows = new Error("llm service not mounted");
    const h = await boot(runtime);
    try {
      const res = await h.send("config.models", { baseUrl: "https://gateway.example.com/v1" });
      expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.CONFIG_UNAVAILABLE } });
    } finally {
      await h.bridge.dispose();
    }
  });

  it("answers NOT_READY while no runtime is up, like every other request", { timeout: 20_000 }, async () => {
    const h = await boot(null);
    try {
      const res = await h.send("config.models", { baseUrl: "https://gateway.example.com/v1" });
      expect(res.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.NOT_READY } });
    } finally {
      await h.bridge.dispose();
    }
  });

  it("guards against listing mid-turn", { timeout: 20_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const created = await h.send("session.create");
      const turn = h.bridge.handleRequestLine(
        JSON.stringify({
          protocolVersion: 1,
          requestId: "t1",
          type: "turn.send",
          data: { sessionId: created.sessionId, text: "hi" },
        }),
      );
      const blocked = await h.send("config.models", { baseUrl: "https://gateway.example.com/v1" });
      expect(blocked.data).toMatchObject({ ok: false, error: { code: ERROR_CODES.TURN_ACTIVE } });
      expect(h.runtime?.drafts).toEqual([]);
      h.runtime?.finishTurn();
      await turn;
    } finally {
      await h.bridge.dispose();
    }
  });
});

describe("probe failure captions (pure table)", () => {
  it("maps the whole DSH failure vocabulary to Chinese, by code alone", () => {
    expect(describeProbeFailure({ code: "MISSING_CREDENTIAL" })).toContain("尚未配置 API Key");
    expect(describeProbeFailure({ code: "INVALID_CREDENTIAL" })).toContain("格式不正确");
    expect(describeProbeFailure({ code: "AUTH" })).toContain("401/403");
    expect(describeProbeFailure({ code: "QUOTA" })).toContain("额度");
    expect(describeProbeFailure({ code: "NO_ADAPTER" })).toContain("模型路由");
    expect(describeProbeFailure({ code: "RATE_LIMIT" })).toContain("429");
    expect(describeProbeFailure({ code: "SERVER" })).toContain("5xx");
    expect(describeProbeFailure({ code: "CONTEXT_WINDOW_EXCEEDED" })).toContain("窗口上限");
    expect(describeProbeFailure({ code: "INVALID_REQUEST" })).toContain("/chat/completions");
    expect(describeProbeFailure({ code: "HTTP_404" })).toContain("404");
    expect(describeProbeFailure({ code: "TRANSPORT" })).toContain("无法连接");
    expect(describeProbeFailure({ code: "INVALID_RESPONSE" })).toContain("完整响应");
    expect(describeProbeFailure({ code: "ABORTED" })).toContain("已取消");
  });

  it("reports a timeout with the deadline it actually used", () => {
    expect(describeProbeFailure({ code: "TIMEOUT" }, { timeoutMs: 20_000 })).toContain("20 秒");
    expect(describeProbeFailure({ code: "TRANSPORT", timedOut: true }, { timeoutMs: 5_000 })).toContain(
      "连接超时（5 秒）",
    );
  });

  it("falls back honestly for an unmapped or absent code", () => {
    expect(describeProbeFailure({})).toContain("请检查 Base URL");
    expect(describeProbeFailure({ code: "HTTP_418" })).toBe("端点返回 HTTP 418");
    expect(describeProbeFailure({ code: "WHO_KNOWS" })).toContain("WHO_KNOWS");
  });

  it("leaves EMPTY_RESPONSE unmapped — the runtime counts it as success", () => {
    // Not in the table on purpose: `testApiConnection` treats it as a pass, so
    // mapping it to a caption would be copy for a message never rendered.
    expect(describeProbeFailure({ code: "EMPTY_RESPONSE" })).toContain("EMPTY_RESPONSE");
  });
});

describe("bridge stdout purity (§10) under configuration traffic", () => {
  it("keeps every config payload free of credential-shaped strings", { timeout: 30_000 }, async () => {
    const h = await boot(new FakeRuntime());
    try {
      const created = await h.send("session.create");
      expect(created.type).toBe("session/created");
      await h.send("config.get");
      await h.send("config.save", { baseUrl: "https://gateway.example.com", model: "gpt-4o-mini", apiKey: KEY });
      await h.send("config.save", { clearApiKey: true });
      await h.send("config.test");
      await h.send("config.models", { baseUrl: "https://gateway.example.com", apiKey: KEY });
      await h.send("config.models", { baseUrl: "https://gateway.example.com" });

      const dump = h.allOutput();
      expect(dump).not.toContain(KEY);
      expect(dump).not.toContain("sk-");
      // Every line on stdout is still a protocol envelope — nothing else.
      for (const line of h.lines) expect(typeof line.type).toBe("string");
    } finally {
      await h.bridge.dispose();
    }
  });
});

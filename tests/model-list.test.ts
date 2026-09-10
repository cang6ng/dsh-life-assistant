/**
 * Model listing — the pure host half of 「获取模型」 (contract §44, §17.1).
 *
 * Three things are pinned here, all of them offline and none of them a model
 * call: the URL the base URL turns into, the parser's tolerance of real-world
 * listing bodies, and the caption table. `fetchModelList` is driven through its
 * injectable transport, so the request itself (method, headers, the bearer's
 * exact shape) is asserted without a socket.
 *
 * The one assertion that is not about behaviour: a listing body is arbitrary
 * JSON from a machine we do not control, so nothing from it may appear in a
 * failure — only the routable code.
 */

import { describe, expect, it } from "vitest";
import {
  MODEL_LIST_MAX_BYTES,
  describeModelListFailure,
  fetchModelList,
  modelListingUrl,
  parseModelList,
  type FetchLike,
} from "../apps/cli/src/model-list";
import { describeProbeFailure } from "../apps/cli/src/probe-failure";

// ---------------------------------------------------------------------------
// the URL
// ---------------------------------------------------------------------------

describe("modelListingUrl", () => {
  it("appends /models to a plain base URL", () => {
    expect(modelListingUrl("https://api.deepseek.com")).toBe("https://api.deepseek.com/models");
    expect(modelListingUrl("https://gateway.example.com/v1")).toBe(
      "https://gateway.example.com/v1/models",
    );
  });

  it("normalizes the shapes a user actually pastes", () => {
    expect(modelListingUrl("  https://api.deepseek.com/  ")).toBe("https://api.deepseek.com/models");
    expect(modelListingUrl("https://api.deepseek.com/v1///")).toBe(
      "https://api.deepseek.com/v1/models",
    );
    // The panel invites a full chat URL and strips the suffix for the form; the
    // host repeats the rule so the two ends agree on any input.
    expect(modelListingUrl("https://api.deepseek.com/v1/chat/completions")).toBe(
      "https://api.deepseek.com/v1/models",
    );
    expect(modelListingUrl("https://api.deepseek.com/chat/completions/")).toBe(
      "https://api.deepseek.com/models",
    );
    expect(modelListingUrl("HTTPS://api.deepseek.com/v1/CHAT/COMPLETIONS")).toBe(
      "HTTPS://api.deepseek.com/v1/models",
    );
  });

  it("refuses anything that is not a usable http(s) base", () => {
    for (const raw of ["", "   ", "not a url", "ftp://x.example", "file:///etc/passwd", "https://"]) {
      expect(modelListingUrl(raw), raw).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// the parser
// ---------------------------------------------------------------------------

describe("parseModelList", () => {
  it("reads the OpenAI shape, ids in endpoint order", () => {
    const parsed = parseModelList({
      object: "list",
      data: [
        { id: "deepseek-v4-flash", object: "model", owned_by: "deepseek" },
        { id: "deepseek-v4-pro" },
        { id: "gpt-4o-mini", created: 1715367049 },
      ],
    });
    expect(parsed).toEqual({
      ok: true,
      models: ["deepseek-v4-flash", "deepseek-v4-pro", "gpt-4o-mini"],
    });
  });

  it("skips malformed rows instead of failing the whole listing", () => {
    const parsed = parseModelList({
      data: [null, 7, "gpt-4o", { id: 7 }, { id: "" }, { id: "   " }, { name: "no-id" }, { id: "ok" }],
    });
    expect(parsed).toEqual({ ok: true, models: ["ok"] });
  });

  it("trims ids and drops duplicates, keeping the first position", () => {
    const parsed = parseModelList({ data: [{ id: " a " }, { id: "a" }, { id: "b" }, { id: "b " }] });
    expect(parsed).toEqual({ ok: true, models: ["a", "b"] });
  });

  it("distinguishes an empty listing from a body that is not a listing", () => {
    // Two different facts, two different surfaces: "this endpoint advertises
    // nothing" versus "this endpoint does not speak the dialect".
    expect(parseModelList({ object: "list", data: [] })).toEqual({ ok: true, models: [] });
    for (const body of [null, undefined, 7, "data", [], {}, { data: "nope" }, { data: null }]) {
      expect(parseModelList(body), JSON.stringify(body)).toEqual({ ok: false });
    }
  });
});

// ---------------------------------------------------------------------------
// the caption table
// ---------------------------------------------------------------------------

describe("describeModelListFailure", () => {
  it("maps the listing-specific codes in its own words", () => {
    expect(describeModelListFailure({ code: "NO_BASE_URL" })).toContain("请先填写 Base URL");
    expect(describeModelListFailure({ code: "HTTP_404" })).toContain("请手动填写模型名称");
    // NOT the probe's wording: that describes a truncated /chat/completions
    // stream, which is not the request this surface makes.
    expect(describeModelListFailure({ code: "INVALID_RESPONSE" })).toContain("未返回模型列表");
    expect(describeModelListFailure({ code: "INVALID_RESPONSE" })).not.toContain("完整响应");
  });

  it("reads a keyless 401/403 as 'no credential', not as a rejected one", () => {
    expect(describeModelListFailure({ code: "HTTP_401" }, { sentCredential: false })).toContain(
      "尚未配置 API Key",
    );
    expect(describeModelListFailure({ code: "HTTP_403" }, { sentCredential: false })).toContain(
      "尚未配置 API Key",
    );
    // With a key sent — or with the fact unknown — it is the credential
    // verdict, in the probe table's own words (a raw fetch reports the status;
    // dsh-llm would have normalized it to `AUTH`, so it is mapped here).
    expect(describeModelListFailure({ code: "HTTP_401" }, { sentCredential: true })).toContain(
      "API Key 被拒绝",
    );
    expect(describeModelListFailure({ code: "HTTP_403" })).toContain("API Key 被拒绝");
    expect(describeModelListFailure({ code: "HTTP_403" })).toBe(
      describeProbeFailure({ code: "AUTH" }),
    );
  });

  it("delegates every shared code to the probe's table, deadline included", () => {
    expect(describeModelListFailure({ code: "TRANSPORT" })).toContain("无法连接");
    expect(describeModelListFailure({ code: "MISSING_CREDENTIAL" })).toContain("尚未配置 API Key");
    expect(describeModelListFailure({ code: "INVALID_CREDENTIAL" })).toContain("格式不正确");
    expect(describeModelListFailure({ code: "RATE_LIMIT" })).toContain("429");
    expect(describeModelListFailure({ code: "TIMEOUT" }, { timeoutMs: 20_000 })).toContain("20 秒");
    // An unmapped status keeps its number and nothing else.
    expect(describeModelListFailure({ code: "HTTP_418" })).toBe("端点返回 HTTP 418");
  });
});

// ---------------------------------------------------------------------------
// the request
// ---------------------------------------------------------------------------

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
}

/** A transport that records what it was handed and answers from a script. */
function recordingFetch(
  answer: (call: Call) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>,
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = { url, method: init.method, headers: init.headers };
    calls.push(call);
    return answer(call);
  };
  return { fetchImpl, calls };
}

function jsonResponse(body: unknown, status = 200) {
  return async () => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
}

describe("fetchModelList", () => {
  it("GETs the URL with a bearer token, and nothing else in the headers", async () => {
    const { fetchImpl, calls } = recordingFetch(jsonResponse({ data: [{ id: "m-1" }] }));
    const result = await fetchModelList({
      url: "https://gateway.example.com/v1/models",
      apiKey: "sk-abc",
      signal: new AbortController().signal,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, models: ["m-1"] });
    expect(calls).toEqual([
      {
        url: "https://gateway.example.com/v1/models",
        method: "GET",
        headers: { accept: "application/json", authorization: "Bearer sk-abc" },
      },
    ]);
  });

  it("omits the authorization header entirely when there is no key", async () => {
    // A keyless local gateway must still answer, so "no credential" is an
    // absent header — never `Bearer undefined`, never `Bearer `.
    const { fetchImpl, calls } = recordingFetch(jsonResponse({ data: [] }));
    const result = await fetchModelList({
      url: "http://127.0.0.1:8080/v1/models",
      signal: new AbortController().signal,
      fetchImpl,
    });
    expect(result).toEqual({ ok: true, models: [] });
    expect(Object.hasOwn(calls[0]?.headers ?? {}, "authorization")).toBe(false);
    // An empty string is "no credential" too.
    const empty = recordingFetch(jsonResponse({ data: [] }));
    await fetchModelList({
      url: "http://127.0.0.1:8080/v1/models",
      apiKey: "",
      signal: new AbortController().signal,
      fetchImpl: empty.fetchImpl,
    });
    expect(Object.hasOwn(empty.calls[0]?.headers ?? {}, "authorization")).toBe(false);
  });

  it("maps a non-2xx answer to its status code, with no prose from the body", async () => {
    const echo = "sk-echoed-back-BY-THE-GATEWAY";
    for (const status of [401, 403, 404, 429, 500]) {
      const { fetchImpl } = recordingFetch(async () => ({
        ok: false,
        status,
        text: async () => JSON.stringify({ error: { message: `bad key ${echo}` } }),
      }));
      const result = await fetchModelList({
        url: "https://gateway.example.com/v1/models",
        apiKey: "sk-abc",
        signal: new AbortController().signal,
        fetchImpl,
      });
      expect(result).toEqual({ ok: false, failure: { code: `HTTP_${status}`, status } });
      expect(JSON.stringify(result)).not.toContain(echo);
    }
  });

  it("reports our own deadline as TIMEOUT and anything else as TRANSPORT", async () => {
    const controller = new AbortController();
    const { fetchImpl } = recordingFetch(async () => {
      controller.abort();
      throw new Error("This operation was aborted");
    });
    const timed = await fetchModelList({
      url: "https://gateway.example.com/v1/models",
      signal: controller.signal,
      fetchImpl,
    });
    expect(timed).toEqual({ ok: false, failure: { code: "TIMEOUT" } });

    const transport = await fetchModelList({
      url: "https://gateway.example.com/v1/models",
      signal: new AbortController().signal,
      fetchImpl: async () => {
        throw new Error("getaddrinfo ENOTFOUND gateway.example.com");
      },
    });
    expect(transport).toEqual({ ok: false, failure: { code: "TRANSPORT" } });
  });

  it("refuses a body that is not a listing, capped at the pi-ai size limit", async () => {
    const cases: Array<() => Promise<{ ok: boolean; status: number; text(): Promise<string> }>> = [
      async () => ({ ok: true, status: 200, text: async () => "<html>not json</html>" }),
      jsonResponse({ object: "list" }),
      jsonResponse({ data: "nope" }),
      async () => ({ ok: true, status: 200, text: async () => "x".repeat(MODEL_LIST_MAX_BYTES + 1) }),
    ];
    for (const answer of cases) {
      const result = await fetchModelList({
        url: "https://gateway.example.com/v1/models",
        signal: new AbortController().signal,
        fetchImpl: async () => answer(),
      });
      expect(result).toEqual({ ok: false, failure: { code: "INVALID_RESPONSE" } });
    }
  });

  it("accepts a listing that is exactly at the cap", async () => {
    // The guard is `>`, not `>=`: a body at exactly the limit is still read.
    // Whitespace padding keeps it there and is legal trailing JSON.
    const id = "m".repeat(1024);
    const body = JSON.stringify({ data: [{ id }] });
    const padding = " ".repeat(MODEL_LIST_MAX_BYTES - body.length);
    const result = await fetchModelList({
      url: "https://gateway.example.com/v1/models",
      signal: new AbortController().signal,
      fetchImpl: async () => ({ ok: true, status: 200, text: async () => body + padding }),
    });
    expect(result).toEqual({ ok: true, models: [id] });
  });

  it("reports a body read failure as TRANSPORT rather than a listing", async () => {
    const result = await fetchModelList({
      url: "https://gateway.example.com/v1/models",
      signal: new AbortController().signal,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => {
          throw new Error("terminated");
        },
      }),
    });
    expect(result).toEqual({ ok: false, failure: { code: "TRANSPORT" } });
  });
});

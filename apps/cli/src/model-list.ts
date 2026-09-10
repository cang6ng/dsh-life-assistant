/**
 * Model listing: the 「获取模型」 button's host half (§17.1 caption style).
 *
 * DSH offers no listing for the route this app uses — `ctx.llm.discoverModels`
 * is registered by the pi-ai plugin alone, and the mounted DeepSeek adapter
 * only ever calls `{baseURL}/chat/completions`. So the endpoint is asked
 * directly, on the one dialect every OpenAI-compatible gateway shares:
 * `GET {baseUrl}/models` with a bearer token, answering
 * `{ object: "list", data: [{ id, … }] }`.
 *
 * Deliberately code-only, exactly like `probe-failure.ts`: the endpoint's raw
 * body is NEVER rendered into a caption. A listing body is arbitrary JSON from
 * a machine we do not control, and a caption travels host → Rust → React → DOM;
 * the routable code carries what the user can act on, and the diagnostic text
 * stays in the host's own stderr log.
 */

import { errorChain } from "@deepseek-ai/dsh-llm";
import { describeProbeFailure, type ProbeFailureLike } from "./probe-failure";

/** The path appended to the endpoint's base URL (OpenAI's listing standard). */
const MODELS_PATH = "/models";
/** A pasted URL often carries the chat path; stripped here as the form does. */
const CHAT_COMPLETIONS_SUFFIX = "/chat/completions";

/**
 * The largest listing body we will read. Mirrors the guard the pi-ai plugin
 * applies to the same request: a listing is a small document, and anything
 * past this is not one.
 */
export const MODEL_LIST_MAX_BYTES = 4 * 1024 * 1024;

/** A machine-routable failure; never the endpoint's own prose. */
export interface ModelListFailureLike extends ProbeFailureLike {
  /** True when the deadline expired rather than the endpoint answering. */
  timedOut?: boolean;
}

/** Facts the caption needs that are not part of the failure itself. */
export interface ModelListContext {
  /** The deadline in milliseconds (rendered as whole seconds). */
  timeoutMs?: number;
  /**
   * Whether the request carried a credential at all. Changes what a 401 means:
   * an endpoint that was never offered a key has not *rejected* one.
   */
  sentCredential?: boolean;
}

/**
 * Turn the configured base URL into the listing URL.
 *
 * Mirrors the adapter's own string concatenation rather than rebuilding the
 * URL from its parts — a base URL that works for `/chat/completions` must
 * produce the listing URL the same way, credentials embedded in it included.
 * @param raw - the base URL exactly as the user typed it.
 * @returns the listing URL, or null when the input is not a usable http(s) base.
 */
export function modelListingUrl(raw: string): string | null {
  let value = raw.trim().replace(/\/+$/, "");
  if (value.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    value = value.slice(0, -CHAT_COMPLETIONS_SUFFIX.length).replace(/\/+$/, "");
  }
  if (value === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || parsed.hostname === "") {
    return null;
  }
  return `${value}${MODELS_PATH}`;
}

/** The listing as parsed, or a refusal — an empty listing is still a listing. */
export type ModelListParse = { ok: true; models: string[] } | { ok: false };

/**
 * Read a listing body.
 *
 * A discriminated result rather than a bare array: "the endpoint does not
 * speak this dialect" and "the endpoint advertises no models" are different
 * facts, and the surface says different things about them.
 * @param body - the parsed JSON body.
 * @returns the ids in endpoint order, deduplicated; or a refusal.
 */
export function parseModelList(body: unknown): ModelListParse {
  if (body === null || typeof body !== "object") return { ok: false };
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return { ok: false };
  const seen = new Set<string>();
  const models: string[] = [];
  for (const row of data) {
    // A malformed row is skipped, not fatal: gateways in the wild mix in
    // rows the OpenAI shape does not describe.
    if (row === null || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push(trimmed);
  }
  return { ok: true, models };
}

/**
 * Render one listing failure as a fixed Chinese caption.
 *
 * Codes shared with the connection probe delegate to `describeProbeFailure`,
 * so the two surfaces cannot drift apart. Three are intercepted first, because
 * the probe's wording describes a different request:
 * @param failure - the machine-routable code plus status/deadline facts.
 * @param context - deadline and whether a credential was sent.
 * @returns the caption to render verbatim; never empty.
 */
export function describeModelListFailure(
  failure: ModelListFailureLike,
  context: ModelListContext = {},
): string {
  switch (failure.code) {
    case "NO_BASE_URL":
      return "请先填写 Base URL，留空时无法获取模型列表";
    case "INVALID_RESPONSE":
      // Not delegated: probe-failure's wording describes a truncated
      // /chat/completions stream and would misdirect here.
      return "端点未返回模型列表（不是有效的 OpenAI 兼容响应）";
    case "HTTP_404":
      return "该端点未提供模型列表（404），请手动填写模型名称";
    case "HTTP_401":
    case "HTTP_403":
      if (context.sentCredential === false) {
        return "尚未配置 API Key；若该端点需要密钥，请填写后再获取";
      }
      // A raw fetch reports the status while the probe's table is keyed on
      // dsh-llm's own taxonomy, which normalizes 401/403 to `AUTH` — so the
      // credential verdict is translated to that code rather than falling
      // through to the generic 「端点返回 HTTP 401」, which says nothing about
      // the key the user just sent. The wording stays owned by that table.
      return describeProbeFailure({ code: "AUTH" });
    default:
      break;
  }
  return describeProbeFailure(failure, { timeoutMs: context.timeoutMs });
}

/** The minimal transport shape this module needs; `globalThis.fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The listing, or the machine-routable reason there is none. */
export type ModelListFetch =
  | { ok: true; models: string[] }
  | { ok: false; failure: ModelListFailureLike };

/**
 * Ask an endpoint which models it serves.
 *
 * The credential, when there is one, is used as a bearer token and appears
 * nowhere else — not in the returned failure, not in a caption, not in the log
 * line below (which carries the transport's own words and the base URL only).
 * @param options - the listing URL, an optional one-shot credential, the
 *   caller's deadline signal, and an injectable transport for tests.
 * @returns the ids, or a routable failure.
 */
export async function fetchModelList(options: {
  url: string;
  apiKey?: string;
  signal: AbortSignal;
  fetchImpl?: FetchLike;
}): Promise<ModelListFetch> {
  const doFetch = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const headers: Record<string, string> = { accept: "application/json" };
  if (options.apiKey !== undefined && options.apiKey !== "") {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  let response: Awaited<ReturnType<FetchLike>>;
  try {
    response = await doFetch(options.url, { method: "GET", headers, signal: options.signal });
  } catch (error) {
    console.error(`[model-list] request failed: ${errorChain(error)}`);
    // Our own deadline, not the transport's failure mode: an aborted fetch
    // throws an error whose name says nothing about who aborted it.
    return { ok: false, failure: { code: options.signal.aborted ? "TIMEOUT" : "TRANSPORT" } };
  }
  if (!response.ok) {
    console.error(`[model-list] endpoint answered HTTP ${response.status}`);
    return { ok: false, failure: { code: `HTTP_${response.status}`, status: response.status } };
  }
  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    console.error(`[model-list] body read failed: ${errorChain(error)}`);
    return { ok: false, failure: { code: "TRANSPORT" } };
  }
  if (text.length > MODEL_LIST_MAX_BYTES) {
    console.error(`[model-list] body too large (${text.length} chars)`);
    return { ok: false, failure: { code: "INVALID_RESPONSE" } };
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    console.error("[model-list] body is not JSON");
    return { ok: false, failure: { code: "INVALID_RESPONSE" } };
  }
  const parsed = parseModelList(body);
  if (!parsed.ok) {
    console.error("[model-list] body carries no model array");
    return { ok: false, failure: { code: "INVALID_RESPONSE" } };
  }
  return { ok: true, models: parsed.models };
}

/* chinook agent bridge bundle */

// apps/cli/src/runtime.ts
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  PROFILE_PATCH_FILENAME,
  boot,
  healProfilesModuleFallback,
  loadOptionalPatches,
  loadProfile
} from "@deepseek-ai/dsh-app-boot";
import {
  installModelSelection
} from "@deepseek-ai/dsh-agent";
import { createUserMessage, errorChain as errorChain2, normalizeApiKey } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";

// apps/cli/src/probe-failure.ts
var CHAT_COMPLETIONS_HINT = "\u8BF7\u786E\u8BA4\u5B83\u662F OpenAI \u517C\u5BB9\u7684 /chat/completions \u7AEF\u70B9";
function timeoutSeconds(context) {
  return Math.max(1, Math.round((context.timeoutMs ?? 2e4) / 1e3));
}
function describeProbeFailure(failure, context = {}) {
  if (failure.timedOut === true) {
    return `\u8FDE\u63A5\u8D85\u65F6\uFF08${timeoutSeconds(context)} \u79D2\uFF09\uFF0C\u8BF7\u68C0\u67E5 Base URL \u4E0E\u7F51\u7EDC`;
  }
  switch (failure.code) {
    case "MISSING_CREDENTIAL":
      return "\u5C1A\u672A\u914D\u7F6E API Key\uFF0C\u8BF7\u586B\u5199\u540E\u4FDD\u5B58\u518D\u6D4B\u8BD5";
    case "INVALID_CREDENTIAL":
      return "API Key \u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u8BF7\u91CD\u65B0\u586B\u5199";
    case "AUTH":
      return "API Key \u88AB\u62D2\u7EDD\uFF08401/403\uFF09\uFF0C\u8BF7\u68C0\u67E5\u5BC6\u94A5\u662F\u5426\u6709\u6548";
    case "QUOTA":
      return "\u8D26\u6237\u989D\u5EA6\u4E0D\u8DB3\u6216\u5DF2\u6B20\u8D39";
    case "NO_ADAPTER":
      return "\u6A21\u578B\u8DEF\u7531\u672A\u6CE8\u518C\uFF0C\u8BF7\u91CD\u65B0\u542F\u52A8 Agent";
    case "RATE_LIMIT":
      return "\u8BF7\u6C42\u88AB\u9650\u6D41\uFF08429\uFF09\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5";
    case "SERVER":
      return "\u7AEF\u70B9\u670D\u52A1\u5F02\u5E38\uFF085xx\uFF09\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5";
    case "CONTEXT_WINDOW_EXCEEDED":
      return "\u4E0A\u4E0B\u6587\u8D85\u51FA\u8BE5\u6A21\u578B\u7684\u7A97\u53E3\u4E0A\u9650";
    case "INVALID_REQUEST":
      return `\u8BF7\u6C42\u88AB\u7AEF\u70B9\u62D2\u7EDD\uFF08400\uFF09${CHAT_COMPLETIONS_HINT}`;
    case "HTTP_404":
      return "\u5730\u5740\u6216\u6A21\u578B\u4E0D\u5B58\u5728\uFF08404\uFF09\uFF0C\u8BF7\u68C0\u67E5 Base URL \u4E0E\u6A21\u578B\u540D\u79F0";
    case "TRANSPORT":
      return "\u65E0\u6CD5\u8FDE\u63A5\u5230\u8BE5\u7AEF\u70B9\uFF0C\u8BF7\u68C0\u67E5 Base URL \u4E0E\u7F51\u7EDC";
    case "TIMEOUT":
      return `\u8FDE\u63A5\u8D85\u65F6\uFF08${timeoutSeconds(context)} \u79D2\uFF09\uFF0C\u8BF7\u68C0\u67E5 Base URL \u4E0E\u7F51\u7EDC`;
    case "ABORTED":
      return "\u8BF7\u6C42\u5DF2\u53D6\u6D88";
    case "STREAM_CLOSED":
    case "INVALID_RESPONSE":
      return `\u7AEF\u70B9\u672A\u8FD4\u56DE\u5B8C\u6574\u54CD\u5E94\uFF0C${CHAT_COMPLETIONS_HINT}`;
    case void 0:
    case "":
      return "\u8FDE\u63A5\u5931\u8D25\uFF0C\u8BF7\u68C0\u67E5 Base URL\u3001API Key \u4E0E\u6A21\u578B\u540D\u79F0";
    default:
      return failure.code.startsWith("HTTP_") ? `\u7AEF\u70B9\u8FD4\u56DE HTTP ${failure.code.slice("HTTP_".length)}` : `\u8FDE\u63A5\u5931\u8D25\uFF08${failure.code}\uFF09`;
  }
}

// apps/cli/src/model-list.ts
import { errorChain } from "@deepseek-ai/dsh-llm";
var MODELS_PATH = "/models";
var CHAT_COMPLETIONS_SUFFIX = "/chat/completions";
var MODEL_LIST_MAX_BYTES = 4 * 1024 * 1024;
function modelListingUrl(raw) {
  let value = raw.trim().replace(/\/+$/, "");
  if (value.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    value = value.slice(0, -CHAT_COMPLETIONS_SUFFIX.length).replace(/\/+$/, "");
  }
  if (value === "") return null;
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:" || parsed.hostname === "") {
    return null;
  }
  return `${value}${MODELS_PATH}`;
}
function parseModelList(body) {
  if (body === null || typeof body !== "object") return { ok: false };
  const data = body.data;
  if (!Array.isArray(data)) return { ok: false };
  const seen = /* @__PURE__ */ new Set();
  const models = [];
  for (const row of data) {
    if (row === null || typeof row !== "object") continue;
    const id = row.id;
    if (typeof id !== "string") continue;
    const trimmed = id.trim();
    if (trimmed === "" || seen.has(trimmed)) continue;
    seen.add(trimmed);
    models.push(trimmed);
  }
  return { ok: true, models };
}
function describeModelListFailure(failure, context = {}) {
  switch (failure.code) {
    case "NO_BASE_URL":
      return "\u8BF7\u5148\u586B\u5199 Base URL\uFF0C\u7559\u7A7A\u65F6\u65E0\u6CD5\u83B7\u53D6\u6A21\u578B\u5217\u8868";
    case "INVALID_RESPONSE":
      return "\u7AEF\u70B9\u672A\u8FD4\u56DE\u6A21\u578B\u5217\u8868\uFF08\u4E0D\u662F\u6709\u6548\u7684 OpenAI \u517C\u5BB9\u54CD\u5E94\uFF09";
    case "HTTP_404":
      return "\u8BE5\u7AEF\u70B9\u672A\u63D0\u4F9B\u6A21\u578B\u5217\u8868\uFF08404\uFF09\uFF0C\u8BF7\u624B\u52A8\u586B\u5199\u6A21\u578B\u540D\u79F0";
    case "HTTP_401":
    case "HTTP_403":
      if (context.sentCredential === false) {
        return "\u5C1A\u672A\u914D\u7F6E API Key\uFF1B\u82E5\u8BE5\u7AEF\u70B9\u9700\u8981\u5BC6\u94A5\uFF0C\u8BF7\u586B\u5199\u540E\u518D\u83B7\u53D6";
      }
      return describeProbeFailure({ code: "AUTH" });
    default:
      break;
  }
  return describeProbeFailure(failure, { timeoutMs: context.timeoutMs });
}
async function fetchModelList(options) {
  const doFetch = options.fetchImpl ?? globalThis.fetch;
  const headers = { accept: "application/json" };
  if (options.apiKey !== void 0 && options.apiKey !== "") {
    headers.authorization = `Bearer ${options.apiKey}`;
  }
  let response;
  try {
    response = await doFetch(options.url, { method: "GET", headers, signal: options.signal });
  } catch (error) {
    console.error(`[model-list] request failed: ${errorChain(error)}`);
    return { ok: false, failure: { code: options.signal.aborted ? "TIMEOUT" : "TRANSPORT" } };
  }
  if (!response.ok) {
    console.error(`[model-list] endpoint answered HTTP ${response.status}`);
    return { ok: false, failure: { code: `HTTP_${response.status}`, status: response.status } };
  }
  let text;
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
  let body;
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

// apps/cli/src/runtime.ts
var PROFILE_NAME = "chinook";
var BIN_NAME = "chinook-agent";
var FALLBACK_MODEL = { provider: "deepseek-official", model: "deepseek-v4-flash" };
var REPO_ROOT = resolve(import.meta.dirname, "../../..");
var DSH_HOME = resolve(process.env.DSH_HOME ?? join(REPO_ROOT, ".dsh"));
var INSTALL_ANCHOR = realpathSync(createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json"));
var LLM_SETTINGS_NS = "llm-deepseek";
var DEFAULT_API_KEY_REF = "DEEPSEEK_API_KEY";
var PROBE_TIMEOUT_MS = 2e4;
async function createAgentRuntime() {
  process.env.DSH_HOME ??= DSH_HOME;
  const inheritedToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (process.env.DEEPSEEK_API_KEY === void 0 && inheritedToken !== void 0 && inheritedToken !== "") {
    process.env.DEEPSEEK_API_KEY = inheritedToken;
  }
  const profile = loadProfile(BIN_NAME, PROFILE_NAME, INSTALL_ANCHOR, DSH_HOME);
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home: DSH_HOME });
  const rootConfig = join(profile.dir, "cordis.yml");
  const homePatches = loadOptionalPatches(BIN_NAME, join(DSH_HOME, PROFILE_PATCH_FILENAME)) ?? [];
  const patches = structuredClone([
    ...profile.layers.flatMap((layer) => layer.patches),
    ...profile.patches,
    ...homePatches
  ]);
  const ctx = await boot(BIN_NAME, rootConfig, patches);
  await ctx.get("loader")?.await();
  const registry = ctx.get("agents");
  const sessions = ctx.get("sessions");
  const persistence = ctx.get("sessionPersistence");
  if (registry === void 0 || sessions === void 0) {
    throw new Error(`${BIN_NAME}: the ${PROFILE_NAME} profile did not mount the agent runtime (agents/sessions missing).`);
  }
  const modelSelection = () => {
    const service = ctx.get("agentDefaultModel");
    return service?.currentSelection() ?? FALLBACK_MODEL;
  };
  const agentOptions = () => {
    const selection = modelSelection();
    return { provider: selection.provider, model: selection.model };
  };
  let liveModelSelection = null;
  let active = null;
  const sessionEventSinks = /* @__PURE__ */ new Set();
  ctx.on("session/event", (eventSession, event) => {
    if (active === null || eventSession !== active.agent.session) return;
    const sessionId = String(eventSession.id);
    for (const sink of sessionEventSinks) {
      try {
        sink(sessionId, event);
      } catch (error) {
        console.error(`[warning] session event sink failed: ${String(error)}`);
      }
    }
  });
  const closeActiveSession = async () => {
    if (active === null) return;
    const { agent, dispose: dispose2 } = active;
    active = null;
    try {
      await agent.whenIdle();
    } catch {
    }
    try {
      await sessions?.flush(agent.session);
    } catch (error) {
      console.error(`[warning] session flush failed: ${String(error)}`);
    }
    try {
      await dispose2();
    } catch (error) {
      console.error(`[warning] session dispose failed: ${String(error)}`);
    }
  };
  const startSession = async (resumeId) => {
    await closeActiveSession();
    const setup = (agentCtx) => {
      liveModelSelection = { current: modelSelection(), assembled: void 0 };
      installModelSelection(agentCtx, liveModelSelection);
    };
    let handle;
    if (resumeId !== void 0) {
      handle = await registry.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions: agentOptions(),
        setup
      });
    } else {
      handle = await registry.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: agentOptions(),
        setup
      });
    }
    const id = String(handle.agent.id);
    active = { id, agent: handle.agent, dispose: () => handle.dispose() };
    await handle.agent.whenIdle();
    return id;
  };
  const ask = async (text, onDelta) => {
    const session = active;
    if (session === null || session === void 0) {
      throw new Error("no active session \u2014 start or resume one first");
    }
    const { agent } = session;
    const message = createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" }
    });
    let replyText = "";
    const disposeListener = ctx.on("session/event", (eventSession, event) => {
      if (eventSession !== agent.session) return;
      if (event.type === "assistant/chunk") {
        const chunk = event.data.chunk;
        if (chunk.type === "text-delta") {
          replyText += chunk.text;
          if (chunk.text !== "" && onDelta !== void 0) onDelta(chunk.text);
        }
      }
    });
    try {
      agent.followup(message);
      await agent.whenIdle();
      await sessions?.flush(agent.session);
    } finally {
      disposeListener();
    }
    return replyText;
  };
  const describeActiveSession = () => {
    if (active === null) return null;
    const header = active.agent.session.header;
    return { id: String(header.id), createdAt: header.createdAt };
  };
  const readActiveSessionSnapshot = () => {
    if (active === null) return null;
    const header = active.agent.session.header;
    return { id: String(header.id), createdAt: header.createdAt, events: active.agent.session.snapshotEvents() };
  };
  const subscribeSessionEvents = (cb) => {
    sessionEventSinks.add(cb);
    return () => {
      sessionEventSinks.delete(cb);
    };
  };
  const missingService = (service) => new Error(`${BIN_NAME}: the ${PROFILE_NAME} profile did not mount the ${service} service (${service} missing).`);
  const requireSettings = () => {
    const settings = ctx.get("settings");
    if (settings === void 0) throw missingService("settings");
    return settings;
  };
  const llmSettingsDescriptor = () => {
    const descriptor = requireSettings().describe({ redactSecrets: true }).find((candidate) => candidate.ns === LLM_SETTINGS_NS);
    if (descriptor === void 0) {
      throw new Error(`${BIN_NAME}: the ${PROFILE_NAME} profile did not register the ${LLM_SETTINGS_NS} settings namespace.`);
    }
    return descriptor;
  };
  const apiKeyRef = (descriptor) => {
    const section = descriptor.value;
    const ref = section?.apiKeyEnv;
    return typeof ref === "string" && ref !== "" ? ref : DEFAULT_API_KEY_REF;
  };
  const readApiConfig = async () => {
    const descriptor = llmSettingsDescriptor();
    const resolved = descriptor.value ?? {};
    const user = descriptor.user ?? void 0;
    const ref = apiKeyRef(descriptor);
    const credentials = ctx.get("credentials");
    const info = credentials === void 0 ? { configured: false, writable: false } : await credentials.describe(ref);
    const selection = modelSelection();
    const baseUrl = typeof resolved.baseURL === "string" ? resolved.baseURL : "";
    return {
      provider: selection.provider,
      model: selection.model,
      baseUrl,
      baseUrlOverridden: user !== void 0 && Object.hasOwn(user, "baseURL"),
      apiKey: {
        ref,
        configured: info.configured,
        source: info.source,
        writable: info.writable
      }
    };
  };
  const saveApiConfig = async (patch) => {
    const settings = requireSettings();
    const credentials = ctx.get("credentials");
    const descriptor = llmSettingsDescriptor();
    const ref = apiKeyRef(descriptor);
    const before = modelSelection().model;
    let apiKeyError;
    if (patch.baseUrl !== void 0) {
      const value = patch.baseUrl.trim();
      await settings.mutate(
        LLM_SETTINGS_NS,
        [value === "" ? { op: "unset", path: ["baseURL"] } : { op: "set", path: ["baseURL"], value }],
        descriptor.revision
      );
    }
    let modelChanged = false;
    if (patch.model !== void 0) {
      const model = patch.model.trim();
      if (model === "") throw new Error("\u6A21\u578B\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
      if (model !== before) {
        const defaultModel = ctx.get("agentDefaultModel");
        if (defaultModel === void 0) throw missingService("agentDefaultModel");
        await defaultModel.saveSelection({ ...modelSelection(), model });
        modelChanged = true;
        if (liveModelSelection !== null) liveModelSelection.current = modelSelection();
      }
    }
    if (patch.clearApiKey === true) {
      if (credentials === void 0) {
        apiKeyError = "\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u672A\u6302\u8F7D\u51ED\u636E\u5E93\uFF0C\u672A\u6E05\u9664\u5BC6\u94A5";
      } else if (!(await credentials.describe(ref)).writable) {
        apiKeyError = `\u5BC6\u94A5\u7531\u542F\u52A8\u73AF\u5883\u63D0\u4F9B\uFF08${ref}\uFF09\uFF0C\u65E0\u6CD5\u5728\u5E94\u7528\u5185\u4FEE\u6539`;
      } else {
        try {
          await credentials.unset(ref);
        } catch (error) {
          console.error(`[warning] credential unset failed: ${String(error)}`);
          apiKeyError = "\u5BC6\u94A5\u6E05\u9664\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        }
      }
    } else if (patch.apiKey !== void 0 && patch.apiKey !== "") {
      const check = normalizeApiKey(patch.apiKey);
      if (!check.ok) {
        throw new Error(
          check.reason === "illegalCharacters" ? "API Key \u542B\u975E\u6CD5\u5B57\u7B26\uFF08\u7A7A\u683C\u6216\u6362\u884C\uFF09" : "API Key \u4E0D\u80FD\u4E3A\u7A7A"
        );
      }
      if (credentials === void 0) {
        apiKeyError = "\u5F53\u524D\u8FD0\u884C\u73AF\u5883\u672A\u6302\u8F7D\u51ED\u636E\u5E93\uFF0C\u5BC6\u94A5\u672A\u4FDD\u5B58";
      } else if (!(await credentials.describe(ref)).writable) {
        apiKeyError = `\u5BC6\u94A5\u7531\u542F\u52A8\u73AF\u5883\u63D0\u4F9B\uFF08${ref}\uFF09\uFF0C\u65E0\u6CD5\u5728\u5E94\u7528\u5185\u4FEE\u6539`;
      } else {
        try {
          await credentials.set(ref, check.value);
        } catch (error) {
          console.error(`[warning] credential write failed: ${errorChain2(error)}`);
          apiKeyError = "\u5BC6\u94A5\u5199\u5165\u5931\u8D25\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
        }
      }
    }
    return {
      config: await readApiConfig(),
      modelChanged,
      ...apiKeyError === void 0 ? {} : { apiKeyError }
    };
  };
  const testApiConnection = async () => {
    const llm = ctx.get("llm");
    if (llm === void 0) throw missingService("llm");
    const selection = modelSelection();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const startedAt = Date.now();
    let failure = null;
    let finished = false;
    try {
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [
          createUserMessage({ content: [{ type: "text", text: "ping" }], source: { kind: "user" } })
        ],
        maxTokens: 1,
        signal: controller.signal
      });
      for await (const chunk of stream) {
        if (chunk.type !== "finish") continue;
        finished = true;
        const reason = chunk.reason;
        if ((reason?.kind === "error" || reason?.kind === "aborted") && reason.failure !== void 0) {
          failure = { ...reason.failure, timedOut: controller.signal.aborted };
        }
        break;
      }
    } catch (error) {
      console.error(`[warning] probe stream failed: ${errorChain2(error)}`);
      failure = { code: "PROBE_FAILED" };
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - startedAt;
    if (failure !== null && failure.code !== "EMPTY_RESPONSE") {
      console.error(`[probe] connection test failed: ${failure.code ?? "UNKNOWN"}`);
      return {
        connected: false,
        code: failure.code,
        message: describeProbeFailure(failure, { timeoutMs: PROBE_TIMEOUT_MS }),
        latencyMs
      };
    }
    if (!finished) {
      return {
        connected: false,
        code: "STREAM_CLOSED",
        message: describeProbeFailure({ code: "STREAM_CLOSED" }, { timeoutMs: PROBE_TIMEOUT_MS }),
        latencyMs
      };
    }
    return { connected: true, message: "", latencyMs };
  };
  const listApiModels = async (draft) => {
    const startedAt = Date.now();
    const refuse = (code, sentCredential2) => {
      console.error(`[model-list] failed: ${code}`);
      return {
        listed: false,
        models: [],
        code,
        message: describeModelListFailure({ code }, { timeoutMs: PROBE_TIMEOUT_MS, sentCredential: sentCredential2 }),
        latencyMs: Date.now() - startedAt
      };
    };
    const url = modelListingUrl(draft.baseUrl);
    if (url === null) return refuse("NO_BASE_URL", false);
    let apiKey;
    if (draft.apiKey !== void 0 && draft.apiKey !== "") {
      const check = normalizeApiKey(draft.apiKey);
      if (!check.ok) return refuse("INVALID_CREDENTIAL", true);
      apiKey = check.value;
    } else {
      const credentials = ctx.get("credentials");
      apiKey = credentials === void 0 ? void 0 : (await credentials.resolve(apiKeyRef(llmSettingsDescriptor())))?.value;
    }
    const sentCredential = apiKey !== void 0 && apiKey !== "";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const listed = await fetchModelList({
        url,
        ...sentCredential ? { apiKey } : {},
        signal: controller.signal
      });
      if (!listed.ok) return refuse(listed.failure.code ?? "UNKNOWN", sentCredential);
      return { listed: true, models: listed.models, message: "", latencyMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  };
  const listSessions = async () => {
    if (persistence === void 0) return [];
    const headers = await persistence.list();
    return headers.filter((h) => h.origin === void 0 && h.parentSession === void 0).map((h) => ({ id: String(h.id), createdAt: h.createdAt })).sort((a, b) => b.createdAt - a.createdAt);
  };
  const dispose = async () => {
    await closeActiveSession();
    const fiber = ctx.fiber;
    if (fiber !== void 0) {
      try {
        await fiber.dispose();
      } catch (error) {
        console.error(`[warning] runtime dispose failed: ${String(error)}`);
      }
    }
  };
  return {
    startSession,
    ask,
    listSessions,
    closeSession: closeActiveSession,
    dispose,
    subscribeSessionEvents,
    describeActiveSession,
    readActiveSessionSnapshot,
    readApiConfig,
    saveApiConfig,
    testApiConnection,
    listApiModels
  };
}

// apps/agent-bridge/src/protocol.ts
var PROTOCOL_VERSION = 1;
var ERROR_CODES = {
  TURN_ACTIVE: "TURN_ACTIVE",
  NOT_READY: "NOT_READY",
  NOT_FOUND: "NOT_FOUND",
  INVALID_ARGUMENT: "INVALID_ARGUMENT",
  UNKNOWN_REQUEST: "UNKNOWN_REQUEST",
  NOT_IMPLEMENTED: "NOT_IMPLEMENTED",
  BOOT_FAILED: "BOOT_FAILED",
  /** The profile did not mount a service the configuration surface needs. */
  CONFIG_UNAVAILABLE: "CONFIG_UNAVAILABLE"
};
function errorData(code, message) {
  return { ok: false, error: { code, message } };
}
var presentationSeq = 0;
function nextPresentationSeq() {
  presentationSeq += 1;
  return presentationSeq;
}
function makeEnvelope(partial) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: partial.requestId,
    sessionId: partial.sessionId ?? null,
    turnId: partial.turnId ?? null,
    seq: partial.seq ?? nextPresentationSeq(),
    type: partial.type,
    data: partial.data
  };
}

// apps/agent-bridge/src/jsonl.ts
import { createInterface } from "node:readline";
import { writeFileSync, renameSync, existsSync, unlinkSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join as join2 } from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
function encodeJsonLine(value) {
  return JSON.stringify(value);
}
function decodeJsonLine(raw) {
  const line = raw.trim();
  if (line === "") return null;
  try {
    const parsed = JSON.parse(line);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
function createJsonlWriter(stdout) {
  const onError = () => {
    if (process.stdout.destroyed || process.stdout.closed) {
      process.exitCode = 0;
    }
  };
  stdout.on("error", onError);
  return (obj) => {
    stdout.write(encodeJsonLine(obj) + "\n");
  };
}
function createLineReader(input) {
  const rl = createInterface({ input, crlfDelay: Infinity });
  const closed = new Promise((resolve6) => {
    rl.once("close", () => resolve6());
    rl.once("error", () => resolve6());
  });
  return {
    onLine(cb) {
      rl.on("line", cb);
    },
    whenClosed: () => closed,
    close() {
      rl.close();
    }
  };
}
function writeJsonFileAtomically(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join2(tmpdir(), `dsh-index-${randomUUID2()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    if (existsSync(file)) renameSync(file, `${file}.bak`);
    renameSync(tmp, file);
    try {
      unlinkSync(`${file}.bak`);
    } catch {
    }
  } catch {
    try {
      copyFileSync(tmp, file);
      unlinkSync(tmp);
    } catch {
    }
  }
}

// apps/agent-bridge/src/title-index.ts
import { existsSync as existsSync2, readFileSync } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";
var TITLE_MAX = 24;
var INDEX_FILENAME = "desktop-session-index.json";
function deriveTitle(rawText) {
  const collapsed = rawText.replace(/\s+/g, " ").trim();
  return collapsed.length > TITLE_MAX ? `${collapsed.slice(0, TITLE_MAX)}\u2026` : collapsed;
}
function defaultIndexPath(dshHome) {
  return resolve2(dshHome, INDEX_FILENAME);
}
var TitleIndex = class {
  file;
  data = { version: 1, sessions: {} };
  dirty = false;
  timer = null;
  constructor(dshHome, file) {
    this.file = file ?? defaultIndexPath(dshHome);
    try {
      if (existsSync2(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, "utf8"));
        this.data = {
          version: 1,
          sessions: parsed.sessions ?? {}
        };
      }
    } catch (error) {
      process.stderr.write(`[bridge] title index unreadable (${this.file}): ${String(error)}
`);
      this.data = { version: 1, sessions: {} };
    }
  }
  get(sessionId) {
    return this.data.sessions[sessionId];
  }
  /** Set a field; persist is debounced + flushed on exit. */
  set(sessionId, patch) {
    const existing = this.data.sessions[sessionId] ?? { title: "", messageCount: 0 };
    this.data.sessions[sessionId] = { ...existing, ...patch };
    this.dirty = true;
    this.schedulePersist();
  }
  entries() {
    return Object.entries(this.data.sessions).map(([sessionId, entry]) => ({ sessionId, ...entry }));
  }
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    writeJsonFileAtomically(this.file, this.data);
  }
  schedulePersist() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, 300);
  }
};

// apps/agent-bridge/src/runtime-adapter.ts
var ToolCallRegistry = class {
  perTurn = /* @__PURE__ */ new Map();
  register(turn, callId, name, at) {
    let turnCalls = this.perTurn.get(turn);
    if (turnCalls === void 0) {
      turnCalls = /* @__PURE__ */ new Map();
      this.perTurn.set(turn, turnCalls);
    }
    turnCalls.set(callId, { name, at });
  }
  resolve(turn, callId) {
    return this.perTurn.get(turn)?.get(callId);
  }
  clearTurn(turn) {
    this.perTurn.delete(turn);
  }
};
function textOfBlock(block) {
  const b = block;
  return b?.type === "text" && typeof b.text === "string" ? b.text : "";
}
function toolResultPayloadText(message) {
  const msg = message;
  const block = (msg?.content ?? [])[0];
  if (block === void 0) return "";
  const nested = Array.isArray(block.content) ? block.content : [block];
  return nested.map(textOfBlock).join("");
}
function assistantMessageText(message) {
  const msg = message;
  return (msg?.content ?? []).map(textOfBlock).join("");
}
function parseToolPayload(text) {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true };
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed !== null && typeof parsed === "object") {
      const asObj = parsed;
      if (asObj.ok === false && asObj.error !== void 0) {
        const err = asObj.error;
        return {
          ok: false,
          error: {
            code: typeof err.code === "string" ? err.code : "TOOL_ERROR",
            message: typeof err.message === "string" ? err.message : ""
          }
        };
      }
      return { ok: true, result: parsed };
    }
    return { ok: true, result: parsed };
  } catch {
    return { ok: true, result: trimmed };
  }
}
function sessionEventToPresentation(event, ctx) {
  const data = event.data;
  const turn = typeof data?.turn === "number" ? data.turn : void 0;
  const ts = event.time;
  switch (event.type) {
    case "turn/start": {
      if (turn === void 0) return [];
      const userText = ctx.pendingUserText ?? "";
      ctx.pendingUserText = null;
      return [{ type: "turn/start", data: { userText }, seq: event.seq, ts }];
    }
    case "tool/call": {
      if (turn === void 0) return [];
      const call = data;
      if (typeof call.callId !== "string" || typeof call.name !== "string") return [];
      ctx.registry.register(turn, call.callId, call.name, ts);
      const args = parseToolArguments(call.arguments);
      const out = {
        type: "tool/call",
        data: { turnId: turn, tool: { name: call.name, arguments: args, callId: call.callId } },
        seq: event.seq,
        ts
      };
      return [out];
    }
    case "tool/result": {
      if (turn === void 0) return [];
      const result = data;
      const msg = result.message;
      const contentBlock = Array.isArray(msg?.content) ? msg.content[0] : void 0;
      const nestedCallId = msg?.source?.callId ?? contentBlock?.toolCallId;
      const callId = typeof result.callId === "string" ? result.callId : typeof nestedCallId === "string" ? nestedCallId : void 0;
      if (typeof callId !== "string") return [];
      const reg = ctx.registry.resolve(turn, callId);
      const name = reg?.name ?? "tool";
      const durationMs = reg !== void 0 ? Math.max(0, ts - reg.at) : 0;
      const payloadText = toolResultPayloadText(result.message);
      const parsed = parseToolPayload(payloadText);
      let ok = true;
      let error;
      let finalResult;
      if (result.error !== void 0) {
        const err = result.error;
        ok = false;
        error = {
          code: typeof err.code === "string" ? err.code : typeof err.name === "string" ? err.name : "TOOL_ERROR",
          message: typeof err.message === "string" ? err.message : ""
        };
      } else if (!parsed.ok) {
        ok = false;
        error = parsed.error;
      } else {
        finalResult = parsed.result;
      }
      const out = {
        type: "tool/result",
        data: {
          turnId: turn,
          tool: { name, callId, durationMs, ok, error, result: finalResult }
        },
        seq: event.seq,
        ts
      };
      return [out];
    }
    case "assistant/chunk": {
      if (turn === void 0) return [];
      const chunk = data?.chunk;
      if (chunk === void 0) return [];
      if (chunk.type !== "text-delta") return [];
      const text = typeof chunk.text === "string" ? chunk.text : "";
      const out = {
        type: "assistant/chunk",
        data: { turnId: turn, text },
        seq: event.seq,
        ts
      };
      return [out];
    }
    case "assistant/message": {
      if (turn === void 0) return [];
      const msg = data;
      const text = assistantMessageText(msg.message);
      const usage = msg.usage;
      const interrupted = msg.interrupted === true;
      const out = {
        type: "assistant/message",
        data: { turnId: turn, text, usage, interrupted: interrupted || void 0 },
        seq: event.seq,
        ts
      };
      return [out];
    }
    case "turn/end": {
      if (turn === void 0) return [];
      const reason = normalizeTurnEndReason(data?.reason);
      if (reason === "error") {
        const err = data?.error ?? data;
        const code = typeof data?.code === "string" ? data.code : typeof err?.code === "string" ? err.code : typeof err?.name === "string" ? err.name : "LLM_ERROR";
        const message = typeof data?.message === "string" ? data.message : typeof err?.message === "string" ? err.message : "\u6A21\u578B\u8C03\u7528\u5931\u8D25\uFF0C\u8BF7\u91CD\u8BD5\u3002";
        return [
          {
            type: "turn/error",
            data: { turnId: turn, code, message },
            seq: event.seq,
            ts
          },
          { type: "turn/end", data: { turnId: turn, reason }, seq: event.seq, ts }
        ];
      }
      return [{ type: "turn/end", data: { turnId: turn, reason }, seq: event.seq, ts }];
    }
    default:
      return [];
  }
}
function normalizeTurnEndReason(raw) {
  const kind = raw !== null && typeof raw === "object" ? raw.kind : raw;
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
function parseToolArguments(raw) {
  if (raw === null || raw === void 0) return {};
  if (typeof raw === "object") {
    if (Array.isArray(raw)) return {};
    return raw;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
    }
  }
  return {};
}

// apps/agent-bridge/src/session-adapter.ts
var SNAPSHOT_MAX_TURNS = 200;
function isUserMessage(event) {
  const src = event.data?.source;
  return src?.kind === "user";
}
function textOfUserMessage(event) {
  const content = event.data?.content ?? [];
  return content.map((b) => {
    const block = b;
    return block?.type === "text" && typeof block.text === "string" ? block.text : "";
  }).join("");
}
function buildConversationSnapshot(sessionId, createdAt, events, maxTurns = SNAPSHOT_MAX_TURNS) {
  const registry = new ToolCallRegistry();
  const frames = [];
  const orphanUsers = [];
  let current = null;
  let lastTurn = 0;
  let firstUserText = "";
  for (const event of events) {
    const raw = event.data;
    if (event.type === "turn/start") {
      const rawTurn = typeof raw?.turn === "number" ? raw.turn : lastTurn + 1;
      lastTurn = rawTurn;
      const frame = {
        turnId: rawTurn,
        userTexts: [],
        steps: 0,
        toolRows: [],
        text: "",
        interrupted: false,
        ts: event.time,
        logRows: [],
        open: true
      };
      frames.push(frame);
      current = frame;
      frame.logRows.push({ type: "turn/start", turnId: rawTurn, ts: event.time });
      continue;
    }
    if (event.type === "user/message") {
      const text = textOfUserMessage(event);
      if (isUserMessage(event) && text !== "") {
        if (firstUserText === "") firstUserText = text;
        if (current !== null && current.open) {
          current.userTexts.push({ text, ts: event.time, seq: event.seq });
        } else {
          orphanUsers.push({ text, ts: event.time, seq: event.seq });
        }
      }
      continue;
    }
    const mapped = sessionEventToPresentation(event, { pendingUserText: null, registry });
    if (mapped.length === 0) continue;
    for (const presentation of mapped) {
      if (presentation.type === "turn/start") continue;
      if (current === null) continue;
      switch (presentation.type) {
        case "tool/call": {
          const activity = {
            name: presentation.data.tool.name,
            callId: presentation.data.tool.callId,
            arguments: presentation.data.tool.arguments,
            ok: true,
            // executing until its result finalizes
            ts: presentation.ts
          };
          current.toolRows.push(activity);
          current.logRows.push({ type: "tool/call", turnId: current.turnId, ts: presentation.ts, tool: activity });
          break;
        }
        case "tool/result": {
          const fin = presentation.data.tool;
          const activity = current.toolRows.find((t) => t.callId === fin.callId);
          if (activity !== void 0) {
            activity.ok = fin.ok;
            activity.error = fin.error;
            activity.durationMs = fin.durationMs;
            activity.result = fin.result;
            current.logRows.push({
              type: "tool/result",
              turnId: current.turnId,
              ts: presentation.ts,
              tool: { ...activity }
            });
          }
          break;
        }
        case "assistant/chunk": {
          current.logRows.push({
            type: "chunk",
            turnId: current.turnId,
            ts: presentation.ts,
            chars: presentation.data.text.length
          });
          break;
        }
        case "assistant/message": {
          current.steps += 1;
          current.text += presentation.data.text;
          current.usage = presentation.data.usage;
          if (presentation.data.interrupted === true) current.interrupted = true;
          current.logRows.push({
            type: "step",
            turnId: current.turnId,
            ts: presentation.ts,
            usage: presentation.data.usage,
            interrupted: presentation.data.interrupted
          });
          break;
        }
        case "turn/error": {
          current.error = { code: presentation.data.code, message: presentation.data.message };
          current.logRows.push({
            type: "turn/error",
            turnId: current.turnId,
            ts: presentation.ts,
            code: presentation.data.code,
            message: presentation.data.message
          });
          break;
        }
        case "turn/end": {
          current.open = false;
          current.endReason = presentation.data.reason;
          current.ts = presentation.ts;
          current.logRows.push({
            type: "turn/end",
            turnId: current.turnId,
            ts: presentation.ts,
            reason: presentation.data.reason
          });
          break;
        }
      }
    }
  }
  if (current !== null && current.open) {
    current.open = false;
    current.endReason = "interrupted";
    current.interrupted = true;
    current.logRows.push({ type: "turn/end", turnId: current.turnId, ts: current.ts, reason: "interrupted" });
  }
  const droppedCount = frames.length - Math.min(frames.length, maxTurns);
  let olderCount = 0;
  for (const frame of frames.slice(0, droppedCount)) {
    olderCount += frame.userTexts.length + frame.steps;
  }
  const orphansFolded = droppedCount > 0 ? orphanUsers.length : 0;
  const keepOrphans = !orphansFolded;
  const items = [];
  const log = [];
  let messageCount = olderCount + (keepOrphans ? orphanUsers.length : 0);
  if (keepOrphans) {
    for (const orphan of orphanUsers) {
      items.push({ kind: "user", id: `${sessionId}:u${orphan.seq}`, text: orphan.text, ts: orphan.ts });
    }
  }
  if (olderCount + orphansFolded > 0) {
    const keep = frames.slice(droppedCount);
    items.push({
      kind: "assistant",
      id: `${sessionId}:archive`,
      text: "",
      ts: keep[0]?.userTexts[0]?.ts ?? keep[0]?.ts ?? createdAt,
      status: "complete",
      tools: [],
      archived: { olderCount: olderCount + orphansFolded }
    });
  }
  for (const frame of frames.slice(droppedCount)) {
    for (const user of frame.userTexts) {
      items.push({ kind: "user", id: `${sessionId}:u${user.seq}`, text: user.text, ts: user.ts });
    }
    messageCount += frame.userTexts.length + frame.steps;
    items.push({
      kind: "assistant",
      id: `${sessionId}:${frame.turnId}`,
      text: frame.text,
      ts: frame.ts,
      status: assistantStatusFor(frame),
      tools: frame.toolRows,
      error: frame.error,
      usage: frame.usage,
      interrupted: frame.interrupted || void 0
    });
    log.push(...frame.logRows);
  }
  return { items, log, messageCount, firstUserText, createdAt };
}
function assistantStatusFor(frame) {
  switch (frame.endReason) {
    case "aborted":
      return "stopped";
    case "error":
      return "failed";
    case "max-tokens":
      return "limited";
    case "interrupted":
      return "interrupted";
    case "blocked":
      return frame.text !== "" ? "complete" : "no-answer";
    case "completed":
    default:
      return frame.text !== "" ? "complete" : "no-answer";
  }
}

// apps/agent-bridge/src/home.ts
import { cpSync, existsSync as existsSync4, mkdirSync as mkdirSync2, readFileSync as readFileSync2, readdirSync, symlinkSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname as dirname2, join as join5, resolve as resolve4 } from "node:path";

// apps/agent-bridge/src/env.ts
import { existsSync as existsSync3 } from "node:fs";
import { join as join4, resolve as resolve3 } from "node:path";
var REPO_ROOT2 = resolve3(import.meta.dirname, "../../..");
function envOr(name, fallback) {
  const v = process.env[name];
  return v !== void 0 && v !== "" ? v : fallback;
}
function resolveDshHome() {
  return resolve3(envOr("DSH_HOME", join4(REPO_ROOT2, ".dsh")));
}
function bootResourcesDir() {
  const dir = process.env.CHINOOK_BOOT_RESOURCES;
  return dir !== void 0 && dir !== "" && existsSync3(dir) ? resolve3(dir) : null;
}

// apps/agent-bridge/src/home.ts
var PROVISION_MARKER = ".desktop-provisioned";
var TEMPLATE_DIRNAME = "home-template";
function homeTemplateDir() {
  const base = bootResourcesDir();
  return base === null ? null : resolve4(base, TEMPLATE_DIRNAME);
}
function linkProfileBundleFallbacks() {
  const base = bootResourcesDir();
  const home = resolveDshHome();
  if (base === null) return;
  const fallbackDir = join5(home, "profiles", "node_modules");
  const runtimeModules = join5(base, "node_modules");
  const profileDir = join5(home, "profiles", "chinook");
  if (!existsSync4(profileDir) || !existsSync4(runtimeModules)) return;
  let bundles;
  try {
    bundles = JSON.parse(readFileSync2(join5(profileDir, "package.json"), "utf8")).dsh?.profile?.bundles ?? [];
  } catch {
    return;
  }
  if (bundles.length === 0) return;
  mkdirSync2(fallbackDir, { recursive: true });
  for (const name of bundles) {
    const link = join5(fallbackDir, ...name.split("/"));
    if (existsSync4(link)) continue;
    const source = join5(runtimeModules, ...name.split("/"));
    if (!existsSync4(source)) continue;
    try {
      mkdirSync2(dirname2(link), { recursive: true });
      symlinkSync(source, link, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      process.stderr.write(`[bridge] profile bundle fallback link failed for ${name}: ${String(error)}
`);
    }
  }
}
function provisionHomeIfNeeded() {
  const template = homeTemplateDir();
  const home = resolveDshHome();
  if (template === null) return;
  const marker = join5(home, PROVISION_MARKER);
  if (existsSync4(marker)) return;
  mkdirSync2(home, { recursive: true });
  for (const entry of readdirSync(template)) {
    cpSync(join5(template, entry), join5(home, entry), {
      recursive: true,
      force: true,
      errorOnExist: false
    });
  }
  writeFileSync2(marker, (/* @__PURE__ */ new Date()).toISOString(), "utf8");
}
function ensureProvisionedHome() {
  if (homeTemplateDir() === null) return;
  linkProfileBundleFallbacks();
}

// apps/agent-bridge/src/main.ts
import { fileURLToPath } from "node:url";
import { resolve as resolve5 } from "node:path";
var AgentBridge = class {
  runtime = null;
  runtimeFactory;
  index;
  writeLine;
  log;
  runtimeStatus = "starting";
  openSessionId = null;
  turnOpen = false;
  // presentation activeTurn ≠ null
  askInFlight = false;
  currentTurnId = null;
  pendingUserText = null;
  disposed = false;
  registry = new ToolCallRegistry();
  ledgers = /* @__PURE__ */ new Map();
  presentationSeq = 0;
  constructor(options, runtimeFactory) {
    this.writeLine = options.writeLine;
    this.log = options.log ?? ((line) => process.stderr.write(`[bridge] ${line}
`));
    this.index = new TitleIndex(options.dshHome ?? resolveDshHome());
    this.runtimeFactory = runtimeFactory ?? (() => createAgentRuntime());
  }
  // -------------------------------------------------------------------------
  // low-level emission (stdout purity)
  // -------------------------------------------------------------------------
  nextSeq() {
    this.presentationSeq += 1;
    return this.presentationSeq;
  }
  write(envelope) {
    this.writeLine(JSON.stringify(envelope));
  }
  emit(partial) {
    this.write(makeEnvelope({ seq: partial.seq ?? this.nextSeq(), ...partial }));
  }
  setStatus(type, detail) {
    this.runtimeStatus = type;
    this.emit({
      type: "runtime/status",
      sessionId: null,
      turnId: null,
      data: detail === void 0 ? { status: type } : { status: type, detail }
    });
  }
  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------
  async start() {
    this.setStatus("starting");
    try {
      provisionHomeIfNeeded();
      ensureProvisionedHome();
    } catch (error) {
      this.log(`home provisioning failed: ${String(error)}`);
    }
    try {
      const runtime = await this.runtimeFactory();
      this.runtime = runtime;
      runtime.subscribeSessionEvents((sessionId, event) => this.onSessionEvent(sessionId, event));
      this.setStatus("ready");
    } catch (error) {
      this.log(`boot failed: ${String(error)}`);
      this.setStatus("error", String(error));
    }
  }
  async dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.index.flush();
    if (this.runtime !== null) {
      try {
        await this.runtime.dispose();
      } catch (error) {
        this.log(`runtime dispose failed: ${String(error)}`);
      }
      this.runtime = null;
    }
  }
  /** Synchronous index flush for the process-exit path. */
  disposeSync() {
    this.index.flush();
  }
  // -------------------------------------------------------------------------
  // live session events → presentation envelopes (order preserved)
  // -------------------------------------------------------------------------
  onSessionEvent(sessionId, event) {
    if (this.disposed) return;
    if (this.openSessionId === null || sessionId !== this.openSessionId) return;
    if (process.env.BRIDGE_DEBUG_RAW === "1" && (event.type === "turn/end" || event.type === "turn/start")) {
      this.log(`RAW ${event.type} ${JSON.stringify(event.data)}`);
    }
    const mapped = sessionEventToPresentation(event, {
      pendingUserText: this.pendingUserText,
      registry: this.registry
    });
    if (mapped.length === 0) return;
    if (mapped.some((m) => m.type === "turn/start")) this.pendingUserText = null;
    const rawData = event.data;
    const envelopeTurn = typeof rawData.turn === "number" ? rawData.turn : null;
    for (const presentation of mapped) {
      const envelope = makeEnvelope({
        type: presentation.type,
        sessionId,
        turnId: presentation.type === "turn/start" ? envelopeTurn : null,
        seq: presentation.seq,
        data: presentation.data
      });
      if (presentation.type === "turn/start") {
        const text = presentation.data.userText;
        this.turnOpen = true;
        this.currentTurnId = envelopeTurn;
        this.write(envelope);
        this.onTurnStarted(sessionId, text);
      } else {
        if (envelopeTurn !== null) envelope.turnId = envelopeTurn;
        this.write(envelope);
        this.afterEvent(sessionId, presentation.type, presentation);
      }
    }
  }
  afterEvent(sessionId, type, presentation) {
    if (type === "assistant/message") {
      this.bumpMessages(sessionId, 1);
    } else if (type === "turn/end") {
      this.turnOpen = false;
      this.currentTurnId = null;
      const data = presentation.data;
      this.registry.clearTurn(data.turnId);
    }
  }
  onTurnStarted(sessionId, userText) {
    const entry = this.ledgers.get(sessionId);
    if (entry !== void 0 && entry.title === "") {
      const title = deriveTitle(userText);
      if (title !== "") this.setTitle(sessionId, title);
    }
    this.bumpMessages(sessionId, 1);
  }
  bumpMessages(sessionId, by) {
    const entry = this.ledgers.get(sessionId) ?? { title: "", messageCount: 0 };
    entry.messageCount += by;
    this.ledgers.set(sessionId, entry);
    this.index.set(sessionId, { title: entry.title, messageCount: entry.messageCount });
  }
  setTitle(sessionId, title) {
    const entry = this.ledgers.get(sessionId) ?? { title: "", messageCount: 0 };
    entry.title = title;
    this.ledgers.set(sessionId, entry);
    this.index.set(sessionId, { title, messageCount: entry.messageCount });
    this.emit({ type: "session/title", sessionId, turnId: null, data: { sessionId, title } });
  }
  summary(sessionId, createdAt) {
    const entry = this.ledgers.get(sessionId) ?? { title: "", messageCount: 0 };
    return { sessionId, title: entry.title, createdAt, messageCount: entry.messageCount };
  }
  // -------------------------------------------------------------------------
  // requests
  // -------------------------------------------------------------------------
  async handleRequestLine(raw) {
    const parsed = decodeJsonLine(raw);
    if (parsed === null || typeof parsed !== "object") {
      this.log(`malformed line dropped: ${raw.slice(0, 120)}`);
      return;
    }
    const req = parsed;
    if (req.protocolVersion !== 1 || typeof req.type !== "string") {
      this.log(`non-protocol line dropped: ${raw.slice(0, 120)}`);
      return;
    }
    try {
      await this.dispatch(req);
    } catch (error) {
      this.log(`request failed: ${String(error)}`);
      if (typeof req.requestId === "string") {
        this.write(
          makeEnvelope({
            type: req.type,
            requestId: req.requestId,
            data: errorData(ERROR_CODES.NOT_READY, `\u8BF7\u6C42\u5904\u7406\u5931\u8D25\uFF1A${String(error)}`)
          })
        );
      }
    }
  }
  async dispatch(req) {
    const requestId = req.requestId;
    const respond = (type, data) => {
      this.write(makeEnvelope({ type, requestId, sessionId: this.openSessionId, seq: this.nextSeq(), data }));
    };
    const fail = (code, message) => {
      respond(req.type, errorData(code, message));
    };
    if (req.type !== "agent.status" && req.type !== "agent.restart" && this.runtime === null) {
      fail(ERROR_CODES.NOT_READY, "Agent \u5C1A\u672A\u542F\u52A8");
      return;
    }
    switch (req.type) {
      case "agent.status":
        respond("agent.status", { status: this.runtimeStatus });
        return;
      case "agent.restart":
        fail(ERROR_CODES.NOT_IMPLEMENTED, "agent.restart \u662F\u5BBF\u4E3B\u8FDB\u7A0B\u7EA7\u64CD\u4F5C\uFF08\u7531\u684C\u9762\u5BBF\u4E3B\u91CD\u65B0\u62C9\u8D77\uFF09");
        return;
      case "session.list": {
        const sessions = [];
        for (const header of await this.rt.listSessions()) {
          const entry = this.ledgers.get(header.id) ?? this.index.get(header.id);
          sessions.push({
            sessionId: header.id,
            title: entry?.title ?? "",
            createdAt: header.createdAt,
            messageCount: entry?.messageCount ?? 0
          });
        }
        sessions.sort((a, b) => b.createdAt - a.createdAt);
        respond("session/list", { sessions });
        return;
      }
      case "session.create":
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "\u5F53\u524D\u56DE\u7B54\u8FDB\u884C\u4E2D\uFF0C\u65E0\u6CD5\u65B0\u5EFA\u4F1A\u8BDD");
          return;
        }
        if (this.runtimeStatus === "error") {
          fail(ERROR_CODES.NOT_READY, "Agent \u8FD0\u884C\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u542F\u52A8");
          return;
        }
        await this.createSession(requestId);
        return;
      case "session.open": {
        const body = req.data;
        if (typeof body?.sessionId !== "string") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "session.open \u9700\u8981 sessionId");
          return;
        }
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "\u5F53\u524D\u56DE\u7B54\u8FDB\u884C\u4E2D\uFF0C\u65E0\u6CD5\u5207\u6362\u4F1A\u8BDD");
          return;
        }
        if (this.runtimeStatus === "error") {
          fail(ERROR_CODES.NOT_READY, "Agent \u8FD0\u884C\u5931\u8D25\uFF0C\u8BF7\u91CD\u65B0\u542F\u52A8");
          return;
        }
        await this.openSession(body.sessionId, requestId);
        return;
      }
      case "turn.send": {
        const body = req.data;
        if (this.openSessionId === null || body?.sessionId !== this.openSessionId) {
          fail(ERROR_CODES.NOT_READY, "\u6CA1\u6709\u6253\u5F00\u7684\u4F1A\u8BDD");
          return;
        }
        if (typeof body?.text !== "string") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "turn.send \u9700\u8981 text");
          return;
        }
        const text = body.text.trim();
        if (text === "") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "\u6D88\u606F\u4E0D\u80FD\u4E3A\u7A7A");
          return;
        }
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "\u5F53\u524D\u56DE\u7B54\u6B63\u5728\u751F\u6210\u4E2D\uFF0C\u8BF7\u7B49\u5F85\u5B8C\u6210");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent \u5C1A\u672A\u5C31\u7EEA");
          return;
        }
        respond("turn.send", { accepted: true });
        this.pendingUserText = text;
        this.askInFlight = true;
        try {
          await this.rt.ask(text);
        } catch (error) {
          this.log(`turn failed: ${String(error)}`);
          if (!this.turnOpen) {
            const turnId = this.currentTurnId ?? 0;
            this.write(
              makeEnvelope({
                type: "turn/error",
                sessionId: this.openSessionId,
                turnId,
                seq: this.nextSeq(),
                data: { turnId, code: "INTERNAL", message: `\u56DE\u7B54\u5931\u8D25\uFF1A${String(error)}` }
              })
            );
            this.write(
              makeEnvelope({
                type: "turn/end",
                sessionId: this.openSessionId,
                turnId,
                seq: this.nextSeq(),
                data: { turnId, reason: "error" }
              })
            );
            this.turnOpen = false;
            this.currentTurnId = null;
          }
        } finally {
          this.pendingUserText = null;
          this.askInFlight = false;
        }
        return;
      }
      // ---- model-endpoint configuration (v1.0.2) ---------------------------
      // Reading is ungated (the panel may load mid-turn); saving, probing and
      // listing are TURN_ACTIVE-guarded like session.create/open — a
      // configuration surface working under a streaming answer is exactly what
      // those guards exist to prevent. Note what is logged: flags and counts
      // only, never a value from `req.data` (a key travels in that payload).
      case "config.get":
        try {
          respond("config.describe", await this.rt.readApiConfig());
        } catch (error) {
          this.log(`config read failed: ${String(error)}`);
          fail(ERROR_CODES.CONFIG_UNAVAILABLE, `\u65E0\u6CD5\u8BFB\u53D6\u6A21\u578B\u914D\u7F6E\uFF1A${String(error)}`);
        }
        return;
      case "config.save": {
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "\u5F53\u524D\u56DE\u7B54\u8FDB\u884C\u4E2D\uFF0C\u65E0\u6CD5\u4FEE\u6539\u6A21\u578B\u914D\u7F6E");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent \u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u542F\u52A8\u540E\u518D\u8BD5");
          return;
        }
        const body = req.data ?? {};
        const patch = {};
        if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
        if (typeof body.model === "string") patch.model = body.model;
        if (typeof body.apiKey === "string" && body.apiKey !== "") patch.apiKey = body.apiKey;
        if (body.clearApiKey === true) patch.clearApiKey = true;
        if (Object.keys(patch).length === 0) {
          fail(ERROR_CODES.INVALID_ARGUMENT, "\u6CA1\u6709\u9700\u8981\u4FDD\u5B58\u7684\u4FEE\u6539");
          return;
        }
        try {
          const result = await this.rt.saveApiConfig(patch);
          this.log(
            `config save applied (baseUrl=${patch.baseUrl !== void 0}, model=${patch.model !== void 0}, apiKey=${patch.apiKey !== void 0}, clearKey=${patch.clearApiKey === true})`
          );
          respond("config.saved", result);
        } catch (error) {
          const message = String(error);
          const code = message.includes("\u6A21\u578B\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A") || message.includes("API Key") ? ERROR_CODES.INVALID_ARGUMENT : ERROR_CODES.CONFIG_UNAVAILABLE;
          this.log(`config save failed: ${message}`);
          fail(code, `\u4FDD\u5B58\u914D\u7F6E\u5931\u8D25\uFF1A${message}`);
        }
        return;
      }
      case "config.test":
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "\u5F53\u524D\u56DE\u7B54\u8FDB\u884C\u4E2D\uFF0C\u65E0\u6CD5\u6D4B\u8BD5\u8FDE\u63A5");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent \u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u542F\u52A8\u540E\u518D\u8BD5");
          return;
        }
        try {
          respond("config.tested", await this.rt.testApiConnection());
        } catch (error) {
          this.log(`connection test failed: ${String(error)}`);
          fail(ERROR_CODES.CONFIG_UNAVAILABLE, `\u65E0\u6CD5\u6D4B\u8BD5\u8FDE\u63A5\uFF1A${String(error)}`);
        }
        return;
      case "config.models": {
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "\u5F53\u524D\u56DE\u7B54\u8FDB\u884C\u4E2D\uFF0C\u65E0\u6CD5\u83B7\u53D6\u6A21\u578B\u5217\u8868");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent \u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u91CD\u65B0\u542F\u52A8\u540E\u518D\u8BD5");
          return;
        }
        const body = req.data ?? {};
        if (typeof body.baseUrl !== "string") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "\u7F3A\u5C11 Base URL");
          return;
        }
        if (body.apiKey !== void 0 && typeof body.apiKey !== "string") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "API Key \u53C2\u6570\u65E0\u6548");
          return;
        }
        const draftKey = typeof body.apiKey === "string" && body.apiKey !== "" ? body.apiKey : void 0;
        try {
          const result = await this.rt.listApiModels({
            baseUrl: body.baseUrl,
            ...draftKey === void 0 ? {} : { apiKey: draftKey }
          });
          this.log(
            `config models listed (baseUrl=${body.baseUrl !== ""}, draftKey=${draftKey !== void 0}, listed=${result.listed}, count=${result.models.length})`
          );
          respond("config.listed", result);
        } catch (error) {
          this.log(`model listing failed: ${String(error)}`);
          fail(ERROR_CODES.CONFIG_UNAVAILABLE, `\u65E0\u6CD5\u83B7\u53D6\u6A21\u578B\u5217\u8868\uFF1A${String(error)}`);
        }
        return;
      }
      default:
        fail(ERROR_CODES.UNKNOWN_REQUEST, `\u672A\u77E5\u8BF7\u6C42\u7C7B\u578B\uFF1A${String(req.type)}`);
    }
  }
  get busy() {
    return this.turnOpen || this.askInFlight;
  }
  /**
   * The active runtime. Invariant: every request path that touches the agent
   * has already bailed with NOT_READY when `this.runtime === null` (the guard
   * at the top of `dispatch`), so the non-null assertion below is safe.
   */
  get rt() {
    return this.runtime;
  }
  async createSession(requestId) {
    this.setStatus("restoring", "\u6B63\u5728\u521B\u5EFA\u65B0\u4F1A\u8BDD\u2026");
    try {
      const id = await this.rt.startSession();
      this.openSessionId = id;
      const snapshot = this.rt.readActiveSessionSnapshot();
      const createdAt = snapshot?.createdAt ?? Date.now();
      this.ledgers.set(id, { title: "", messageCount: 0 });
      this.setStatus("ready");
      this.write(
        makeEnvelope({
          type: "session/created",
          requestId,
          sessionId: id,
          seq: this.nextSeq(),
          data: { session: this.summary(id, createdAt) }
        })
      );
    } catch (error) {
      this.log(`session create failed: ${String(error)}`);
      this.setStatus("ready");
      this.write(
        makeEnvelope({
          type: "session.create",
          requestId,
          seq: this.nextSeq(),
          data: errorData(ERROR_CODES.NOT_READY, `\u521B\u5EFA\u4F1A\u8BDD\u5931\u8D25\uFF1A${String(error)}`)
        })
      );
    }
  }
  async openSession(sessionId, requestId) {
    this.setStatus("restoring", "\u6B63\u5728\u6062\u590D\u4F1A\u8BDD\u2026");
    this.openSessionId = null;
    try {
      await this.rt.startSession(sessionId);
      const snapshot = this.rt.readActiveSessionSnapshot();
      if (snapshot === null) throw new Error("resume produced no snapshot");
      const built = buildConversationSnapshot(snapshot.id, snapshot.createdAt, snapshot.events);
      const existing = this.index.get(snapshot.id);
      const title = existing !== void 0 && existing.title !== "" ? existing.title : built.firstUserText;
      const messageCount = existing?.messageCount ?? built.messageCount;
      this.openSessionId = snapshot.id;
      const entry = { title, messageCount };
      this.ledgers.set(snapshot.id, entry);
      this.index.set(snapshot.id, entry);
      if (title !== "" && (existing === void 0 || existing.title === "")) {
        this.emit({ type: "session/title", sessionId: snapshot.id, turnId: null, data: { sessionId: snapshot.id, title } });
      }
      this.setStatus("ready");
      this.write(
        makeEnvelope({
          type: "session/opened",
          requestId,
          sessionId: snapshot.id,
          seq: this.nextSeq(),
          data: {
            session: this.summary(snapshot.id, snapshot.createdAt),
            items: built.items,
            log: built.log
          }
        })
      );
    } catch (error) {
      this.log(`session open failed: ${String(error)}`);
      this.setStatus("ready");
      this.write(
        makeEnvelope({
          type: "session.open",
          requestId,
          seq: this.nextSeq(),
          data: errorData(ERROR_CODES.NOT_FOUND, `\u6062\u590D\u4F1A\u8BDD\u5931\u8D25\uFF1A${String(error)}`)
        })
      );
    }
  }
};
function isMain(argv1) {
  if (argv1 === void 0) return false;
  const self = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  return resolve5(argv1).replaceAll("\\", "/") === self;
}
async function runMain() {
  const writer = createJsonlWriter(process.stdout);
  const bridge = new AgentBridge({
    dshHome: resolveDshHome(),
    writeLine: (line) => {
      if (process.stdout.writable) process.stdout.write(`${line}
`);
    }
  });
  const shutdown = async (code) => {
    await bridge.dispose();
    process.exitCode = code;
  };
  process.on("SIGTERM", () => void shutdown(0));
  process.on("SIGINT", () => void shutdown(0));
  process.on("exit", () => bridge.disposeSync());
  await bridge.start();
  const reader = createLineReader(process.stdin);
  reader.onLine((line) => {
    void bridge.handleRequestLine(line);
  });
  await reader.whenClosed();
  await shutdown(0);
}
if (isMain(process.argv[1])) {
  void runMain();
}
export {
  AgentBridge
};

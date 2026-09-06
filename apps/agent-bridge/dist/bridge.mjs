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
import { installModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId } from "@deepseek-ai/dsh-session";
var PROFILE_NAME = "chinook";
var BIN_NAME = "chinook-agent";
var FALLBACK_MODEL = { provider: "deepseek-official", model: "deepseek-v4-flash" };
var REPO_ROOT = resolve(import.meta.dirname, "../../..");
var DSH_HOME = resolve(process.env.DSH_HOME ?? join(REPO_ROOT, ".dsh"));
var INSTALL_ANCHOR = realpathSync(createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json"));
async function createAgentRuntime() {
  process.env.DSH_HOME ??= DSH_HOME;
  process.env.DEEPSEEK_API_KEY ??= process.env.ANTHROPIC_AUTH_TOKEN;
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
      installModelSelection(agentCtx, { current: modelSelection(), assembled: void 0 });
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
    readActiveSessionSnapshot
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
  BOOT_FAILED: "BOOT_FAILED"
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
  const closed = new Promise((resolve5) => {
    rl.once("close", () => resolve5());
    rl.once("error", () => resolve5());
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
      if (typeof result.callId !== "string") return [];
      const reg = ctx.registry.resolve(turn, result.callId);
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
          tool: { name, callId: result.callId, durationMs, ok, error, result: finalResult }
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
import { cpSync, existsSync as existsSync4, mkdirSync as mkdirSync2, readdirSync, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join5, resolve as resolve4 } from "node:path";

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

// apps/agent-bridge/src/main.ts
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
  const a = argv1.replaceAll("\\", "/");
  return a.endsWith("apps/agent-bridge/src/main.ts") || a.endsWith("agent-bridge/dist/bridge.mjs");
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

/**
 * AgentRuntime: in-process DSH profile boot + thin agent driving for the
 * chinook-agent CLI (spec §20–§22).
 *
 * Boot chain mirrors the `dsh` launcher recipe against the project-local
 * home: load the `chinook` profile (bundle layers + user patch layer),
 * heal the shared module fallback mirror, then boot the cordis tree over the
 * profile's empty root. Sessions are created/resumed through
 * `ctx.agents` (the agent-loop factory), driven with `followup` +
 * `whenIdle`, persisted with `ctx.sessions.flush`, and torn down with the
 * handle's `dispose()` — exactly the canonical client pattern (headless /
 * ACP style), minus every V2 concern.
 */

import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import {
  PROFILE_PATCH_FILENAME,
  boot,
  healProfilesModuleFallback,
  loadOptionalPatches,
  loadProfile,
} from "@deepseek-ai/dsh-app-boot";
import {
  installModelSelection,
  type Agent,
  type AgentRegistry,
  type ModelSelection,
  type ModelSelectionRef,
} from "@deepseek-ai/dsh-agent";
import { createUserMessage, errorChain, normalizeApiKey, type UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId, type Session, type SessionEvent } from "@deepseek-ai/dsh-session";
import type { Context } from "@deepseek-ai/cordis";
import { describeProbeFailure, type ProbeFailureLike } from "./probe-failure";

export const PROFILE_NAME = "chinook";
export const BIN_NAME = "chinook-agent";
const FALLBACK_MODEL: ModelSelection = { provider: "deepseek-official", model: "deepseek-v4-flash" };

const REPO_ROOT = resolve(import.meta.dirname, "../../..");
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(REPO_ROOT, ".dsh"));
const INSTALL_ANCHOR = realpathSync(createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json"));

/** Structural stand-ins for services whose concrete packages stay inside the profile store. */
interface LoaderLike {
  await(): Promise<void>;
}
interface SessionHeaderLike {
  id: unknown;
  createdAt: number;
  origin?: unknown;
  parentSession?: unknown;
  cwd?: string;
}
interface PersistenceLike {
  list(signal?: AbortSignal): Promise<SessionHeaderLike[]>;
}
interface SessionStoreLike {
  flush(session: unknown): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Model-endpoint configuration stand-ins (settings / credentials / llm)
//
// The `llm-deepseek` settings namespace, the credential store and the model
// default are all DSH services; this module reaches them through the same
// structural stand-in style as LoaderLike/SessionStoreLike, so no new
// dependency edge enters the graph and `ctx` never escapes this file.
// ---------------------------------------------------------------------------

/** One path-addressed edit to a settings namespace's user section. */
type SettingsPathOpLike =
  | { op: "set"; path: readonly string[]; value: unknown }
  | { op: "unset"; path: readonly string[] };

/** One registered namespace as `describe()` surfaces it. */
interface SettingsDescriptorLike {
  ns: string;
  value: unknown;
  revision: number;
  /** Raw user section; a field's presence here is what marks it user-overridden. */
  user?: unknown;
}

interface SettingsProviderLike {
  get(ns: string): unknown;
  describe(options?: { redactSecrets?: boolean }): SettingsDescriptorLike[];
  mutate(ns: string, ops: readonly SettingsPathOpLike[], expectedRevision?: number): Promise<void>;
}

/** `ctx.credentials` — never returns a value, only whether one resolves. */
interface CredentialProviderLike {
  describe(ref: string): Promise<{ configured: boolean; source?: string; writable: boolean }>;
  set(ref: string, value: string): Promise<void>;
  unset(ref: string): Promise<void>;
}

/** The one `ctx.llm` call the connection probe needs. */
interface LlmServiceLike {
  stream(options: {
    provider: string;
    model: string;
    messages: UserMessage[];
    maxTokens?: number;
    signal?: AbortSignal;
  }): AsyncIterable<LlmChunkLike>;
}

interface LlmChunkLike {
  type: string;
  reason?: { kind: string; failure?: ProbeFailureLike };
}

interface DefaultModelServiceLike {
  currentSelection(): ModelSelection;
  saveSelection(next: ModelSelection): Promise<void>;
}

/** Settings namespace owned by the mounted `dsh-llm-deepseek` adapter. */
export const LLM_SETTINGS_NS = "llm-deepseek";
/** The reference the adapter reads a key through when the section names none. */
export const DEFAULT_API_KEY_REF = "DEEPSEEK_API_KEY";
/**
 * The probe's own deadline. Deliberately far below the Rust host's 90 s
 * REQUEST_TIMEOUT: a black-holed endpoint must report our own diagnosis
 * (TIMEOUT) instead of the host's generic one.
 */
const PROBE_TIMEOUT_MS = 20_000;

/** Whether a stored key resolves, and whether this process can change it. */
export interface ApiKeyState {
  /** The credential reference in use (the section's `apiKeyEnv`). */
  ref: string;
  configured: boolean;
  /** Supplying layer — `env` is inherited and therefore cannot be written. */
  source?: string;
  writable: boolean;
}

/**
 * The endpoint configuration as the desktop may see it. Note what is absent:
 * there is no field anywhere in this shape that can carry a credential value.
 */
export interface ApiConfig {
  provider: string;
  model: string;
  /** User-supplied base URL; "" means the default endpoint is in use. */
  baseUrl: string;
  /** Whether the user layer owns `baseURL` (i.e. an override is stored). */
  baseUrlOverridden: boolean;
  apiKey: ApiKeyState;
}

/** One save request; every field is optional and absent means "leave alone". */
export interface ApiConfigPatch {
  /** "" clears the override, restoring the endpoint's default. */
  baseUrl?: string;
  /** Model id, sent to the endpoint verbatim. */
  model?: string;
  /** A new key; "" or absent keeps the stored one (write-only field). */
  apiKey?: string;
  /** Explicitly remove the stored key. Ignored when a new key is supplied. */
  clearApiKey?: boolean;
}

export interface ApiConfigSaveResult {
  /** The configuration as it stands after the write. */
  config: ApiConfig;
  /** True when the default model actually changed (the live session was rebound). */
  modelChanged: boolean;
  /**
   * A credential write the store refused — the save otherwise succeeded.
   * Absent when the key was accepted or left alone.
   */
  apiKeyError?: string;
}

/** One connection probe's outcome; `message` is render-ready Chinese. */
export interface ApiProbeResult {
  connected: boolean;
  /** Machine-routable failure code, absent on success. */
  code?: string;
  /** Chinese caption; "" on success. Never provider prose (see probe-failure). */
  message: string;
  latencyMs: number;
}

/** The client surface main.ts drives. */
export interface AgentRuntime {
  /** Create a fresh session, or resume a persisted one; returns the session id. */
  startSession(resumeId?: string): Promise<string>;
  /** Send one user prompt and wait for the turn to settle, streaming text deltas. */
  ask(text: string, onDelta?: (delta: string) => void): Promise<string>;
  /** Persisted resumable sessions, newest first. */
  listSessions(): Promise<Array<{ id: string; createdAt: number }>>;
  /** Flush + dispose the active session (it stays resumable). */
  closeSession(): Promise<void>;
  /** Close the active session and shut the whole profile tree down. */
  dispose(): Promise<void>;

  /**
   * Desktop V2 additive surface (contract §6): a persistent live-event sink.
   *
   * Registers one `session/event` listener per subscription; each event is
   * delivered only while the emitting session is the runtime's active
   * session. Returns an unsubscribe function. Never re-emits history that
   * `snapshotEvents()` already returned — use the snapshot API for
   * hydration, this sink for live streaming only.
   */
  subscribeSessionEvents(cb: (sessionId: string, event: SessionEvent) => void): () => void;
  /**
   * Desktop V2 additive surface: the active session's summary, or null when
   * no session is open. Useful to gate events on the bridge's own open id.
   */
  describeActiveSession(): { id: string; createdAt: number } | null;
  /**
   * Desktop V2 additive surface: the active session's full frozen event log
   * (constructor seeds + replayed resume history), for snapshot hydration.
   */
  readActiveSessionSnapshot(): { id: string; createdAt: number; events: readonly SessionEvent[] } | null;

  /**
   * Read the live model-endpoint configuration: the adapter's resolved base
   * URL plus whether the user layer owns it, the current default model, and
   * whether a credential resolves. Never returns a credential value.
   */
  readApiConfig(): Promise<ApiConfig>;
  /**
   * Persist a configuration patch (settings namespace + credential store) and
   * report what took effect. A credential write the store refuses never blocks
   * the settings write — the refusal comes back as `apiKeyError`.
   */
  saveApiConfig(patch: ApiConfigPatch): Promise<ApiConfigSaveResult>;
  /**
   * Prove the saved configuration end to end with one minimal model call: it
   * exercises credential resolution, the base URL and the model id together.
   */
  testApiConnection(): Promise<ApiProbeResult>;
}

export async function createAgentRuntime(): Promise<AgentRuntime> {
  // Project-local home: sessions/credentials stay under the repo, never in
  // the user profile dir. Set before loadProfile (heal) and boot (config
  // expressions resolve $DSH_HOME).
  process.env.DSH_HOME ??= DSH_HOME;
  // Credential bridge: the DeepSeek-compatible endpoint also accepts the
  // ANTHROPIC_AUTH_TOKEN (see README). The deepseek adapter resolves
  // DEEPSEEK_API_KEY through `ctx.credentials`, whose inherited-environment
  // layer outranks the managed `$DSH_HOME/.credentials.yaml` — so an alias set
  // here makes the ref environment-supplied, and the credential store refuses
  // in-app writes for it (see `readApiConfig`'s `writable`, which the desktop
  // surfaces as a read-only field rather than a save that silently no-ops).
  //
  // Deliberately NOT `??=`: assigning `undefined` into `process.env` stores
  // the STRING "undefined". With neither variable set, that made the ref look
  // environment-supplied — the store reported `configured: true,
  // writable: false` for a key that does not exist, the in-app field went
  // read-only with "remove the environment variable" advice for a variable
  // nobody set, and the adapter resolved the literal "undefined" as the
  // bearer token. On a fresh install (no variables anywhere) that is exactly
  // the machine this configuration surface exists for.
  const inheritedToken = process.env.ANTHROPIC_AUTH_TOKEN;
  if (
    process.env.DEEPSEEK_API_KEY === undefined &&
    inheritedToken !== undefined &&
    inheritedToken !== ""
  ) {
    process.env.DEEPSEEK_API_KEY = inheritedToken;
  }

  const profile = loadProfile(BIN_NAME, PROFILE_NAME, INSTALL_ANCHOR, DSH_HOME);
  await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home: DSH_HOME });
  const rootConfig = join(profile.dir, "cordis.yml");
  const homePatches = loadOptionalPatches(BIN_NAME, join(DSH_HOME, PROFILE_PATCH_FILENAME)) ?? [];
  const patches = structuredClone([
    ...profile.layers.flatMap((layer) => layer.patches),
    ...profile.patches,
    ...homePatches,
  ]);
  const ctx = await boot(BIN_NAME, rootConfig, patches);
  // Plugins mount asynchronously after boot resolves; the loader's await()
  // drains every mount task (headless gates on the same call).
  await (ctx.get("loader") as LoaderLike | undefined)?.await();

  const registry = ctx.get("agents") as AgentRegistry | undefined;
  const sessions = ctx.get("sessions") as SessionStoreLike | undefined;
  const persistence = ctx.get("sessionPersistence") as PersistenceLike | undefined;
  if (registry === undefined || sessions === undefined) {
    throw new Error(`${BIN_NAME}: the ${PROFILE_NAME} profile did not mount the agent runtime (agents/sessions missing).`);
  }

  const modelSelection = (): ModelSelection => {
    const service = ctx.get("agentDefaultModel") as { currentSelection(): ModelSelection } | undefined;
    return service?.currentSelection() ?? FALLBACK_MODEL;
  };

  const agentOptions = () => {
    const selection = modelSelection();
    return { provider: selection.provider, model: selection.model };
  };

  // The live session's mutable model selection. Holding the object (rather
  // than building one inline per session) is what lets a saved model reach the
  // NEXT step of an already-running session: prompt assembly snapshots
  // `current` before delegating, so a switch applies without a rebind.
  let liveModelSelection: ModelSelectionRef | null = null;

  let active: { id: string; agent: Agent; dispose: () => Promise<void> } | null = null;

  // Desktop V2 additive: one persistent fan-out over the cordis session/event
  // firehose, guarded to the active session exactly like ask()'s own listener.
  const sessionEventSinks = new Set<(sessionId: string, event: SessionEvent) => void>();
  ctx.on("session/event", (eventSession: Session, event: SessionEvent) => {
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

  const closeActiveSession = async (): Promise<void> => {
    if (active === null) return;
    const { agent, dispose } = active;
    active = null;
    try {
      await agent.whenIdle();
    } catch {
      // loop already quiet or disposed mid-turn — flush still below
    }
    try {
      await sessions?.flush(agent.session);
    } catch (error) {
      console.error(`[warning] session flush failed: ${String(error)}`);
    }
    try {
      await dispose();
    } catch (error) {
      console.error(`[warning] session dispose failed: ${String(error)}`);
    }
  };

  const startSession = async (resumeId?: string): Promise<string> => {
    await closeActiveSession();
    const setup = (agentCtx: Context) => {
      liveModelSelection = { current: modelSelection(), assembled: undefined };
      installModelSelection(agentCtx, liveModelSelection);
    };
    let handle: Awaited<ReturnType<AgentRegistry["create"]>>;
    if (resumeId !== undefined) {
      handle = await registry.resume({
        resumeSessionId: SessionId(resumeId),
        agentOptions: agentOptions(),
        setup,
      });
    } else {
      handle = await registry.create({
        sessionId: SessionId(`session-${randomUUID()}`),
        meta: { cwd: process.cwd() },
        agentOptions: agentOptions(),
        setup,
      });
    }
    const id = String(handle.agent.id);
    active = { id, agent: handle.agent, dispose: () => handle.dispose() };
    await handle.agent.whenIdle();
    return id;
  };

  const ask = async (text: string, onDelta?: (delta: string) => void): Promise<string> => {
    const session = active;
    if (session === null || session === undefined) {
      throw new Error("no active session — start or resume one first");
    }
    const { agent } = session;
    const message = createUserMessage({
      content: [{ type: "text", text }],
      source: { kind: "user" },
    });
    let replyText = "";
    const disposeListener = ctx.on("session/event", (eventSession: Session, event: SessionEvent) => {
      if (eventSession !== agent.session) return;
      if (event.type === "assistant/chunk") {
        const chunk = event.data.chunk;
        if (chunk.type === "text-delta") {
          replyText += chunk.text;
          if (chunk.text !== "" && onDelta !== undefined) onDelta(chunk.text);
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

  const describeActiveSession = (): { id: string; createdAt: number } | null => {
    if (active === null) return null;
    const header = active.agent.session.header;
    return { id: String(header.id), createdAt: header.createdAt };
  };

  const readActiveSessionSnapshot = (): {
    id: string;
    createdAt: number;
    events: readonly SessionEvent[];
  } | null => {
    if (active === null) return null;
    const header = active.agent.session.header;
    return { id: String(header.id), createdAt: header.createdAt, events: active.agent.session.snapshotEvents() };
  };

  const subscribeSessionEvents = (cb: (sessionId: string, event: SessionEvent) => void): (() => void) => {
    sessionEventSinks.add(cb);
    return () => {
      sessionEventSinks.delete(cb);
    };
  };

  // -------------------------------------------------------------------------
  // model-endpoint configuration
  // -------------------------------------------------------------------------

  const missingService = (service: string): Error =>
    new Error(`${BIN_NAME}: the ${PROFILE_NAME} profile did not mount the ${service} service (${service} missing).`);

  const requireSettings = (): SettingsProviderLike => {
    const settings = ctx.get("settings") as SettingsProviderLike | undefined;
    if (settings === undefined) throw missingService("settings");
    return settings;
  };

  /** The `llm-deepseek` descriptor: resolved value, raw user layer, revision. */
  const llmSettingsDescriptor = (): SettingsDescriptorLike => {
    // `redactSecrets` is mandatory on every wire surface; this namespace
    // declares no `role('secret')` field (its key slot is a credential REFERENCE,
    // never a value), so nothing is stripped — but the habit is the contract.
    const descriptor = requireSettings()
      .describe({ redactSecrets: true })
      .find((candidate) => candidate.ns === LLM_SETTINGS_NS);
    if (descriptor === undefined) {
      throw new Error(`${BIN_NAME}: the ${PROFILE_NAME} profile did not register the ${LLM_SETTINGS_NS} settings namespace.`);
    }
    return descriptor;
  };

  /** The credential reference the adapter will resolve the key through. */
  const apiKeyRef = (descriptor: SettingsDescriptorLike): string => {
    const section = descriptor.value as { apiKeyEnv?: unknown } | undefined;
    const ref = section?.apiKeyEnv;
    return typeof ref === "string" && ref !== "" ? ref : DEFAULT_API_KEY_REF;
  };

  /** The endpoint facts the desktop is allowed to see (no credential value). */
  const readApiConfig = async (): Promise<ApiConfig> => {
    const descriptor = llmSettingsDescriptor();
    const resolved = (descriptor.value ?? {}) as { baseURL?: unknown };
    const user = (descriptor.user ?? undefined) as Record<string, unknown> | undefined;
    const ref = apiKeyRef(descriptor);
    const credentials = ctx.get("credentials") as CredentialProviderLike | undefined;
    const info = credentials === undefined
      ? { configured: false, writable: false }
      : await credentials.describe(ref);
    const selection = modelSelection();
    const baseUrl = typeof resolved.baseURL === "string" ? resolved.baseURL : "";
    return {
      provider: selection.provider,
      model: selection.model,
      baseUrl,
      baseUrlOverridden: user !== undefined && Object.hasOwn(user, "baseURL"),
      apiKey: {
        ref,
        configured: info.configured,
        source: info.source,
        writable: info.writable,
      },
    };
  };

  const saveApiConfig = async (patch: ApiConfigPatch): Promise<ApiConfigSaveResult> => {
    const settings = requireSettings();
    const credentials = ctx.get("credentials") as CredentialProviderLike | undefined;
    const descriptor = llmSettingsDescriptor();
    const ref = apiKeyRef(descriptor);
    const before = modelSelection().model;
    let apiKeyError: string | undefined;

    // 1. Base URL. A path-addressed write, never `replace`: the wholesale form
    //    has to restate the section, so it would delete every user key this
    //    caller never read (`apiKeyEnv` among them).
    if (patch.baseUrl !== undefined) {
      const value = patch.baseUrl.trim();
      await settings.mutate(
        LLM_SETTINGS_NS,
        [value === "" ? { op: "unset", path: ["baseURL"] } : { op: "set", path: ["baseURL"], value }],
        descriptor.revision,
      );
    }

    // 2. Model. Written through the service that owns the namespace, so the
    //    desktop never hand-edits `agent-default-model` itself.
    let modelChanged = false;
    if (patch.model !== undefined) {
      const model = patch.model.trim();
      if (model === "") throw new Error("模型名称不能为空");
      if (model !== before) {
        const defaultModel = ctx.get("agentDefaultModel") as DefaultModelServiceLike | undefined;
        if (defaultModel === undefined) throw missingService("agentDefaultModel");
        await defaultModel.saveSelection({ ...modelSelection(), model });
        modelChanged = true;
        // The open session keeps its own selection object; re-read it so the
        // new model reaches the next step instead of only the next session.
        if (liveModelSelection !== null) liveModelSelection.current = modelSelection();
      }
    }

    // 3. API key — write-only. Absent or empty means "keep the stored one".
    if (patch.clearApiKey === true) {
      if (credentials === undefined) {
        apiKeyError = "当前运行环境未挂载凭据库，未清除密钥";
      } else if (!(await credentials.describe(ref)).writable) {
        apiKeyError = `密钥由启动环境提供（${ref}），无法在应用内修改`;
      } else {
        try {
          await credentials.unset(ref);
        } catch (error) {
          console.error(`[warning] credential unset failed: ${String(error)}`);
          apiKeyError = "密钥清除失败，请稍后重试";
        }
      }
    } else if (patch.apiKey !== undefined && patch.apiKey !== "") {
      const check = normalizeApiKey(patch.apiKey);
      if (!check.ok) {
        throw new Error(
          check.reason === "illegalCharacters" ? "API Key 含非法字符（空格或换行）" : "API Key 不能为空",
        );
      }
      if (credentials === undefined) {
        apiKeyError = "当前运行环境未挂载凭据库，密钥未保存";
      } else if (!(await credentials.describe(ref)).writable) {
        // The inherited environment outranks the managed store and cannot be
        // shadowed from inside the process: say so instead of appearing to save.
        apiKeyError = `密钥由启动环境提供（${ref}），无法在应用内修改`;
      } else {
        try {
          await credentials.set(ref, check.value);
        } catch (error) {
          // Never interpolate the underlying error into the caption: a refused
          // write can quote the value it refused.
          console.error(`[warning] credential write failed: ${errorChain(error)}`);
          apiKeyError = "密钥写入失败，请稍后重试";
        }
      }
    }

    return {
      config: await readApiConfig(),
      modelChanged,
      ...(apiKeyError === undefined ? {} : { apiKeyError }),
    };
  };

  const testApiConnection = async (): Promise<ApiProbeResult> => {
    const llm = ctx.get("llm") as LlmServiceLike | undefined;
    if (llm === undefined) throw missingService("llm");
    const selection = modelSelection();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    const startedAt = Date.now();
    let failure: ProbeFailureLike | null = null;
    let finished = false;
    try {
      // One minimal call through the ordinary adapter path: it resolves the
      // credential, hits `{baseURL}/chat/completions` and names the model,
      // which is exactly the configuration under test. No `purpose`: that
      // would put DeepSeek-specific `thinking` fields on the wire and could
      // fail an otherwise compatible third-party endpoint.
      const stream = llm.stream({
        provider: selection.provider,
        model: selection.model,
        messages: [
          createUserMessage({ content: [{ type: "text", text: "ping" }], source: { kind: "user" } }),
        ],
        maxTokens: 1,
        signal: controller.signal,
      });
      for await (const chunk of stream) {
        if (chunk.type !== "finish") continue;
        finished = true;
        const reason = chunk.reason;
        if ((reason?.kind === "error" || reason?.kind === "aborted") && reason.failure !== undefined) {
          failure = { ...reason.failure, timedOut: controller.signal.aborted };
        }
        break;
      }
    } catch (error) {
      // The adapter reports its own failures as a terminal finish chunk, so a
      // throw here is a consumer/protocol failure rather than a provider one.
      console.error(`[warning] probe stream failed: ${errorChain(error)}`);
      failure = { code: "PROBE_FAILED" };
    } finally {
      clearTimeout(timer);
    }
    const latencyMs = Date.now() - startedAt;

    // EMPTY_RESPONSE is the one failure code that still proves the probe's
    // point: the endpoint authenticated, routed the model and answered — it
    // merely returned no content for a one-token request.
    if (failure !== null && failure.code !== "EMPTY_RESPONSE") {
      // Diagnostic detail stays host-side (stderr); the caption is code-only.
      console.error(`[probe] connection test failed: ${failure.code ?? "UNKNOWN"}`);
      return {
        connected: false,
        code: failure.code,
        message: describeProbeFailure(failure, { timeoutMs: PROBE_TIMEOUT_MS }),
        latencyMs,
      };
    }
    if (!finished) {
      return {
        connected: false,
        code: "STREAM_CLOSED",
        message: describeProbeFailure({ code: "STREAM_CLOSED" }, { timeoutMs: PROBE_TIMEOUT_MS }),
        latencyMs,
      };
    }
    return { connected: true, message: "", latencyMs };
  };

  const listSessions = async (): Promise<Array<{ id: string; createdAt: number }>> => {
    if (persistence === undefined) return [];
    const headers = await persistence.list();
    return headers
      .filter((h) => h.origin === undefined && h.parentSession === undefined)
      .map((h) => ({ id: String(h.id), createdAt: h.createdAt }))
      .sort((a, b) => b.createdAt - a.createdAt);
  };

  const dispose = async (): Promise<void> => {
    await closeActiveSession();
    const fiber = (ctx as unknown as { fiber?: { dispose(): Promise<void> | void } }).fiber;
    if (fiber !== undefined) {
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
  };
}

export type { UserMessage };

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
import { installModelSelection, type Agent, type AgentRegistry, type ModelSelection } from "@deepseek-ai/dsh-agent";
import { createUserMessage, type UserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId, type Session, type SessionEvent } from "@deepseek-ai/dsh-session";
import type { Context } from "@deepseek-ai/cordis";

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
}

export async function createAgentRuntime(): Promise<AgentRuntime> {
  // Project-local home: sessions/credentials stay under the repo, never in
  // the user profile dir. Set before loadProfile (heal) and boot (config
  // expressions resolve $DSH_HOME).
  process.env.DSH_HOME ??= DSH_HOME;
  // Credential bridge: the DeepSeek-compatible endpoint accepts the
  // ANTHROPIC_AUTH_TOKEN (see README); the deepseek adapter reads
  // DEEPSEEK_API_KEY env-first, before the (invalid stub) credential store.
  process.env.DEEPSEEK_API_KEY ??= process.env.ANTHROPIC_AUTH_TOKEN;

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
      installModelSelection(agentCtx, { current: modelSelection(), assembled: undefined });
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
  };
}

export type { UserMessage };

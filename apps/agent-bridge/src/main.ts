/**
 * Node Agent Bridge — Transport Adapter (contract §9).
 *
 * stdin JSONL requests → existing AgentRuntime → normalized presentation
 * envelopes → stdout JSONL. stdout carries protocol lines ONLY (§10); every
 * diagnostic goes to stderr.
 *
 * The bridge hosts exactly one AgentRuntime + one open session at a time
 * (UI Spec §30.4 #8). Requests are guarded by a small state machine:
 *
 *   - boot:          `runtime/status starting` → boot → `ready`; a boot
 *                    failure keeps the process alive in `error` (the host
 *                    重新启动 respawns us — we never self-restart)
 *   - session.create/open: `restoring` → run → `ready`, then the canonical
 *                    `session/created` / `session/opened` envelope (which is
 *                    also the request response, UI Spec §26.2)
 *   - turn.send:     respond `{ accepted:true }` synchronously, then stream
 *                    `turn/start` … `turn/end` (reasoning dropped, §14);
 *                    guarded with TURN_ACTIVE / NOT_READY (UI Spec §26.2)
 *   - agent.restart: a host-level operation — the Rust host kills and
 *                    respawns this process; it never round-trips through us
 *
 * Envelope `seq` = the dsh session seq for session events (ordering
 * integrity) and the bridge's own presentation counter for everything else.
 * Session title bookkeeping (contract §17) happens at the first user message
 * and at snapshot hydration; the disposable index lives at $DSH_HOME.
 */

import { createAgentRuntime, type AgentRuntime, type ApiConfigPatch } from "../../cli/src/runtime.js";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import {
  ERROR_CODES,
  errorData,
  makeEnvelope,
  type Envelope,
  type Request,
  type RuntimeStatus,
  type SessionSummary,
} from "./protocol.js";
import { createJsonlWriter, createLineReader, decodeJsonLine, logStderr } from "./jsonl.js";
import { deriveTitle, TitleIndex } from "./title-index.js";
import { buildConversationSnapshot } from "./session-adapter.js";
import { sessionEventToPresentation, ToolCallRegistry } from "./runtime-adapter.js";
import { ensureProvisionedHome, provisionHomeIfNeeded } from "./home.js";
import { resolveDshHome } from "./env.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

interface LedgerEntry {
  title: string;
  messageCount: number;
}

export interface BridgeOptions {
  dshHome?: string;
  writeLine: (line: string) => void; // stdout (protocol only)
  log?: (line: string) => void; // stderr
}

/** Injectable runtime seam for tests; defaults to the real AgentRuntime. */
export type RuntimeFactory = () => Promise<AgentRuntime>;

export class AgentBridge {
  private runtime: AgentRuntime | null = null;
  private readonly runtimeFactory: RuntimeFactory;
  private readonly index: TitleIndex;
  private readonly writeLine: (line: string) => void;
  private readonly log: (line: string) => void;

  private runtimeStatus: RuntimeStatus = "starting";
  private openSessionId: string | null = null;
  private turnOpen = false; // presentation activeTurn ≠ null
  private askInFlight = false;
  private currentTurnId: number | null = null;
  private pendingUserText: string | null = null;
  private disposed = false;

  private readonly registry = new ToolCallRegistry();
  private readonly ledgers = new Map<string, LedgerEntry>();
  private presentationSeq = 0;

  constructor(options: BridgeOptions, runtimeFactory?: RuntimeFactory) {
    this.writeLine = options.writeLine;
    this.log = options.log ?? ((line) => process.stderr.write(`[bridge] ${line}\n`));
    this.index = new TitleIndex(options.dshHome ?? resolveDshHome());
    this.runtimeFactory = runtimeFactory ?? (() => createAgentRuntime());
  }

  // -------------------------------------------------------------------------
  // low-level emission (stdout purity)
  // -------------------------------------------------------------------------

  private nextSeq(): number {
    this.presentationSeq += 1;
    return this.presentationSeq;
  }

  private write(envelope: Envelope): void {
    this.writeLine(JSON.stringify(envelope));
  }

  private emit(partial: Omit<Envelope, "protocolVersion" | "seq"> & { seq?: number }): void {
    this.write(makeEnvelope({ seq: partial.seq ?? this.nextSeq(), ...partial }));
  }

  private setStatus(type: RuntimeStatus, detail?: string): void {
    this.runtimeStatus = type;
    this.emit({
      type: "runtime/status",
      sessionId: null,
      turnId: null,
      data: detail === undefined ? { status: type } : { status: type, detail },
    });
  }

  // -------------------------------------------------------------------------
  // lifecycle
  // -------------------------------------------------------------------------

  async start(): Promise<void> {
    this.setStatus("starting");
    try {
      provisionHomeIfNeeded();
      // Every launch (packaged homes only): profile-bundle junctions the
      // dsh heal does not mirror (§43/§45 packaged resource wiring).
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

  async dispose(): Promise<void> {
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
  disposeSync(): void {
    this.index.flush();
  }

  // -------------------------------------------------------------------------
  // live session events → presentation envelopes (order preserved)
  // -------------------------------------------------------------------------

  private onSessionEvent(sessionId: string, event: SessionEvent): void {
    if (this.disposed) return;
    if (this.openSessionId === null || sessionId !== this.openSessionId) return;
    if (process.env.BRIDGE_DEBUG_RAW === "1" && (event.type === "turn/end" || event.type === "turn/start")) {
      this.log(`RAW ${event.type} ${JSON.stringify(event.data)}`);
    }

    const mapped = sessionEventToPresentation(event, {
      pendingUserText: this.pendingUserText,
      registry: this.registry,
    });
    if (mapped.length === 0) return;
    if (mapped.some((m) => m.type === "turn/start")) this.pendingUserText = null;

    const rawData = event.data as { turn?: unknown };
    const envelopeTurn = typeof rawData.turn === "number" ? rawData.turn : null;

    for (const presentation of mapped) {
      const envelope = makeEnvelope({
        type: presentation.type,
        sessionId,
        turnId: presentation.type === "turn/start" ? envelopeTurn : null,
        seq: presentation.seq,
        data: presentation.data,
      });

      if (presentation.type === "turn/start") {
        const text = (presentation.data as { userText: string }).userText;
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

  private afterEvent(
    sessionId: string,
    type: string,
    presentation: { data: unknown },
  ): void {
    if (type === "assistant/message") {
      this.bumpMessages(sessionId, 1);
    } else if (type === "turn/end") {
      this.turnOpen = false;
      this.currentTurnId = null;
      const data = presentation.data as { turnId: number };
      this.registry.clearTurn(data.turnId);
    }
  }

  private onTurnStarted(sessionId: string, userText: string): void {
    // The user message itself counts; the title is derived from its text.
    const entry = this.ledgers.get(sessionId);
    if (entry !== undefined && entry.title === "") {
      const title = deriveTitle(userText);
      if (title !== "") this.setTitle(sessionId, title);
    }
    this.bumpMessages(sessionId, 1);
  }

  private bumpMessages(sessionId: string, by: number): void {
    const entry = this.ledgers.get(sessionId) ?? { title: "", messageCount: 0 };
    entry.messageCount += by;
    this.ledgers.set(sessionId, entry);
    this.index.set(sessionId, { title: entry.title, messageCount: entry.messageCount });
  }

  private setTitle(sessionId: string, title: string): void {
    const entry = this.ledgers.get(sessionId) ?? { title: "", messageCount: 0 };
    entry.title = title;
    this.ledgers.set(sessionId, entry);
    this.index.set(sessionId, { title, messageCount: entry.messageCount });
    this.emit({ type: "session/title", sessionId, turnId: null, data: { sessionId, title } });
  }

  private summary(sessionId: string, createdAt: number): SessionSummary {
    const entry = this.ledgers.get(sessionId) ?? { title: "", messageCount: 0 };
    return { sessionId, title: entry.title, createdAt, messageCount: entry.messageCount };
  }

  // -------------------------------------------------------------------------
  // requests
  // -------------------------------------------------------------------------

  async handleRequestLine(raw: string): Promise<void> {
    const parsed = decodeJsonLine(raw);
    if (parsed === null || typeof parsed !== "object") {
      this.log(`malformed line dropped: ${raw.slice(0, 120)}`);
      return;
    }
    const req = parsed as Partial<Envelope>;
    if (req.protocolVersion !== 1 || typeof req.type !== "string") {
      this.log(`non-protocol line dropped: ${raw.slice(0, 120)}`);
      return;
    }
    try {
      await this.dispatch(req as Envelope);
    } catch (error) {
      this.log(`request failed: ${String(error)}`);
      if (typeof req.requestId === "string") {
        this.write(
          makeEnvelope({
            type: req.type as string,
            requestId: req.requestId,
            data: errorData(ERROR_CODES.NOT_READY, `请求处理失败：${String(error)}`),
          }),
        );
      }
    }
  }

  private async dispatch(req: Envelope): Promise<void> {
    const requestId = req.requestId;
    const respond = (type: string, data: unknown): void => {
      this.write(makeEnvelope({ type, requestId, sessionId: this.openSessionId, seq: this.nextSeq(), data }));
    };
    const fail = (code: string, message: string): void => {
      respond(req.type as string, errorData(code, message));
    };

    if (req.type !== "agent.status" && req.type !== "agent.restart" && this.runtime === null) {
      fail(ERROR_CODES.NOT_READY, "Agent 尚未启动");
      return;
    }

    switch (req.type as Request["type"]) {
      case "agent.status":
        respond("agent.status", { status: this.runtimeStatus });
        return;

      case "agent.restart":
        fail(ERROR_CODES.NOT_IMPLEMENTED, "agent.restart 是宿主进程级操作（由桌面宿主重新拉起）");
        return;

      case "session.list": {
        const sessions: SessionSummary[] = [];
        for (const header of await this.rt.listSessions()) {
          const entry = this.ledgers.get(header.id) ?? this.index.get(header.id);
          sessions.push({
            sessionId: header.id,
            title: entry?.title ?? "",
            createdAt: header.createdAt,
            messageCount: entry?.messageCount ?? 0,
          });
        }
        sessions.sort((a, b) => b.createdAt - a.createdAt);
        respond("session/list", { sessions });
        return;
      }

      case "session.create":
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "当前回答进行中，无法新建会话");
          return;
        }
        if (this.runtimeStatus === "error") {
          fail(ERROR_CODES.NOT_READY, "Agent 运行失败，请重新启动");
          return;
        }
        await this.createSession(requestId);
        return;

      case "session.open": {
        const body = req.data as { sessionId?: unknown };
        if (typeof body?.sessionId !== "string") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "session.open 需要 sessionId");
          return;
        }
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "当前回答进行中，无法切换会话");
          return;
        }
        if (this.runtimeStatus === "error") {
          fail(ERROR_CODES.NOT_READY, "Agent 运行失败，请重新启动");
          return;
        }
        await this.openSession(body.sessionId, requestId);
        return;
      }

      case "turn.send": {
        const body = req.data as { sessionId?: unknown; text?: unknown };
        if (this.openSessionId === null || body?.sessionId !== this.openSessionId) {
          fail(ERROR_CODES.NOT_READY, "没有打开的会话");
          return;
        }
        if (typeof body?.text !== "string") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "turn.send 需要 text");
          return;
        }
        const text = body.text.trim();
        if (text === "") {
          fail(ERROR_CODES.INVALID_ARGUMENT, "消息不能为空");
          return;
        }
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "当前回答正在生成中，请等待完成");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent 尚未就绪");
          return;
        }
        // Accepted — respond first, then run the turn; events stream after.
        respond("turn.send", { accepted: true });
        this.pendingUserText = text;
        this.askInFlight = true;
        try {
          await this.rt.ask(text);
        } catch (error) {
          this.log(`turn failed: ${String(error)}`);
          if (!this.turnOpen) {
            // no turn/end ever arrived — synthesize the failure surface
            const turnId = this.currentTurnId ?? 0;
            this.write(
              makeEnvelope({
                type: "turn/error",
                sessionId: this.openSessionId,
                turnId,
                seq: this.nextSeq(),
                data: { turnId, code: "INTERNAL", message: `回答失败：${String(error)}` },
              }),
            );
            this.write(
              makeEnvelope({
                type: "turn/end",
                sessionId: this.openSessionId,
                turnId,
                seq: this.nextSeq(),
                data: { turnId, reason: "error" },
              }),
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
      // Reading is ungated (the panel may load mid-turn); saving and probing
      // are TURN_ACTIVE-guarded like session.create/open — flipping the
      // endpoint under a streaming answer is exactly what those guards exist
      // to prevent. Note what is logged: flags and reference names only, never
      // a value from `req.data` (the key travels in that payload).

      case "config.get":
        try {
          respond("config.describe", await this.rt.readApiConfig());
        } catch (error) {
          this.log(`config read failed: ${String(error)}`);
          fail(ERROR_CODES.CONFIG_UNAVAILABLE, `无法读取模型配置：${String(error)}`);
        }
        return;

      case "config.save": {
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "当前回答进行中，无法修改模型配置");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent 尚未就绪，请重新启动后再试");
          return;
        }
        const body = (req.data ?? {}) as {
          baseUrl?: unknown;
          model?: unknown;
          apiKey?: unknown;
          clearApiKey?: unknown;
        };
        const patch: ApiConfigPatch = {};
        if (typeof body.baseUrl === "string") patch.baseUrl = body.baseUrl;
        if (typeof body.model === "string") patch.model = body.model;
        if (typeof body.apiKey === "string" && body.apiKey !== "") patch.apiKey = body.apiKey;
        if (body.clearApiKey === true) patch.clearApiKey = true;
        if (Object.keys(patch).length === 0) {
          fail(ERROR_CODES.INVALID_ARGUMENT, "没有需要保存的修改");
          return;
        }
        try {
          const result = await this.rt.saveApiConfig(patch);
          // Refs and flags only — `patch.apiKey` holds a credential.
          this.log(
            `config save applied (baseUrl=${patch.baseUrl !== undefined}, model=${patch.model !== undefined}, ` +
              `apiKey=${patch.apiKey !== undefined}, clearKey=${patch.clearApiKey === true})`,
          );
          respond("config.saved", result);
        } catch (error) {
          const message = String(error);
          const code = message.includes("模型名称不能为空") || message.includes("API Key")
            ? ERROR_CODES.INVALID_ARGUMENT
            : ERROR_CODES.CONFIG_UNAVAILABLE;
          this.log(`config save failed: ${message}`);
          fail(code, `保存配置失败：${message}`);
        }
        return;
      }

      case "config.test":
        if (this.busy) {
          fail(ERROR_CODES.TURN_ACTIVE, "当前回答进行中，无法测试连接");
          return;
        }
        if (this.runtimeStatus !== "ready") {
          fail(ERROR_CODES.NOT_READY, "Agent 尚未就绪，请重新启动后再试");
          return;
        }
        try {
          respond("config.tested", await this.rt.testApiConnection());
        } catch (error) {
          this.log(`connection test failed: ${String(error)}`);
          fail(ERROR_CODES.CONFIG_UNAVAILABLE, `无法测试连接：${String(error)}`);
        }
        return;

      default:
        fail(ERROR_CODES.UNKNOWN_REQUEST, `未知请求类型：${String(req.type)}`);
    }
  }

  private get busy(): boolean {
    return this.turnOpen || this.askInFlight;
  }

  /**
   * The active runtime. Invariant: every request path that touches the agent
   * has already bailed with NOT_READY when `this.runtime === null` (the guard
   * at the top of `dispatch`), so the non-null assertion below is safe.
   */
  private get rt(): AgentRuntime {
    return this.runtime as AgentRuntime;
  }

  private async createSession(requestId?: string): Promise<void> {
    this.setStatus("restoring", "正在创建新会话…");
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
          data: { session: this.summary(id, createdAt) },
        }),
      );
    } catch (error) {
      this.log(`session create failed: ${String(error)}`);
      this.setStatus("ready");
      this.write(
        makeEnvelope({
          type: "session.create",
          requestId,
          seq: this.nextSeq(),
          data: errorData(ERROR_CODES.NOT_READY, `创建会话失败：${String(error)}`),
        }),
      );
    }
  }

  private async openSession(sessionId: string, requestId?: string): Promise<void> {
    this.setStatus("restoring", "正在恢复会话…");
    this.openSessionId = null;
    try {
      await this.rt.startSession(sessionId);
      const snapshot = this.rt.readActiveSessionSnapshot();
      if (snapshot === null) throw new Error("resume produced no snapshot");
      const built = buildConversationSnapshot(snapshot.id, snapshot.createdAt, snapshot.events);
      const existing = this.index.get(snapshot.id);
      const title = existing !== undefined && existing.title !== "" ? existing.title : built.firstUserText;
      const messageCount = existing?.messageCount ?? built.messageCount;
      this.openSessionId = snapshot.id;
      const entry: LedgerEntry = { title, messageCount };
      this.ledgers.set(snapshot.id, entry);
      this.index.set(snapshot.id, entry);
      if (title !== "" && (existing === undefined || existing.title === "")) {
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
            log: built.log,
          },
        }),
      );
    } catch (error) {
      this.log(`session open failed: ${String(error)}`);
      this.setStatus("ready");
      this.write(
        makeEnvelope({
          type: "session.open",
          requestId,
          seq: this.nextSeq(),
          data: errorData(ERROR_CODES.NOT_FOUND, `恢复会话失败：${String(error)}`),
        }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// process glue (only when run directly or via the bundled entry)
// ---------------------------------------------------------------------------

function isMain(argv1: string | undefined): boolean {
  if (argv1 === undefined) return false;
  // Location-independent: run only when executed directly (dev bundle path
  // OR the packaged `runtime/bridge/bridge.mjs` copy), never when the module
  // is imported by tests/hosts. Resolved paths avoid symlink/cwd surprises.
  const self = fileURLToPath(import.meta.url).replaceAll("\\", "/");
  return resolve(argv1).replaceAll("\\", "/") === self;
}

async function runMain(): Promise<void> {
  const writer = createJsonlWriter(process.stdout);
  const bridge = new AgentBridge({
    dshHome: resolveDshHome(),
    writeLine: (line) => {
      // writeLine receives an ALREADY-serialized protocol line (§10 purity);
      // raw write, no re-encoding.
      if (process.stdout.writable) process.stdout.write(`${line}\n`);
    },
  });

  const shutdown = async (code: number): Promise<void> => {
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

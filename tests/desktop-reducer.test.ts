/**
 * Desktop reducer unit tests (contract §48 — React). The reducer is pure
 * (store/reducer.ts imports no DOM / React), so it runs under plain node:
 *   turn/start · tool/call · tool/result · assistant/chunk · turn/end ·
 *   business error (turn/error) · session opened · runtime disconnected
 * (the orphan-turn finalize). State invariants asserted where the contract
 * calls them out (§28.2): session-scoped events only apply to the active
 * session, no items append while a turn is live, a tool finalize only
 * targets the newest running activity, chunks are the text source of truth.
 */

import { describe, expect, it } from "vitest";
import { reducer } from "../apps/desktop/src/store/reducer";
import { INITIAL_STATE, type RootState } from "../apps/desktop/src/store/state";
import type { StoreAction } from "../apps/desktop/src/store/actions";
import type { TurnEndReason } from "../apps/desktop/src/protocol/types";

// ---------------------------------------------------------------------------
// builders
// ---------------------------------------------------------------------------

const SESSION_A = { sessionId: "s-a", title: "会话甲", createdAt: 1000 };
const SESSION_B = { sessionId: "s-b", title: "会话乙", createdAt: 2000 };

function openedA(items: RootState["conversation"]["items"] = [], log: RootState["conversation"]["log"] = []): RootState {
  return reducer(INITIAL_STATE, {
    type: "SESSION_OPENED",
    session: SESSION_A,
    items,
    log,
  });
}

const T = 1_700_000_000_000;
let seq = 0;
const t = (): number => T + seq++ * 1000;

const call = {
  type: "TOOL_CALL",
  sessionId: "s-a",
  turnId: 1,
  tool: { name: "search_catalog", arguments: { query: "Queen" }, callId: "c1" },
} as const;

type ToolResultAction = Extract<StoreAction, { type: "TOOL_RESULT" }>;
const result = (patch: Partial<ToolResultAction["tool"]> = {}): ToolResultAction =>
  ({
    type: "TOOL_RESULT",
    sessionId: "s-a",
    turnId: 1,
    tool: {
      name: "search_catalog",
      callId: "c1",
      durationMs: 1200,
      ok: true,
      result: { count: 3, entity_type: "album" },
      ...patch,
    },
    ts: t(),
  }) as ToolResultAction;

/** Start one turn in session A; returns (state, turnId=1). */
function turnInFlight(items: RootState["conversation"]["items"] = [], log: RootState["conversation"]["log"] = []): RootState {
  return reducer(openedA(items, log), {
    type: "TURN_START",
    sessionId: "s-a",
    turnId: 1,
    userText: "帮我找 Queen 的专辑",
    ts: t(),
  });
}

const lastAssistant = (s: RootState) => {
  const items = s.conversation.items;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    if (items[i].kind === "assistant") return items[i] as Extract<RootState["conversation"]["items"][number], { kind: "assistant" }>;
  }
  throw new Error("no assistant item");
};

// ---------------------------------------------------------------------------

describe("desktop reducer — session lifecycle", () => {
  it("session/opened replaces the conversation and sets the active session", () => {
    const s = openedA();
    expect(s.activeSessionId).toBe("s-a");
    expect(s.conversation.items).toEqual([]);
    expect(s.conversation.log).toEqual([]);
    expect(s.activeTurn).toBeNull();
  });

  it("session/opened for another session does not replace a live turn", () => {
    const live = turnInFlight();
    const s = reducer(live, {
      type: "SESSION_OPENED",
      session: SESSION_B,
      items: [],
      log: [],
    });
    // Guarded: a restore must never clobber the in-flight conversation.
    expect(s.activeSessionId).toBe("s-a");
    expect(s.activeTurn?.turnId).toBe(1);
    expect(s.conversation.items).toHaveLength(2);
  });

  it("session/created is visible in the sidebar even when the list never resolved", () => {
    // Boot with a failed `session/list` leaves `sessions` null; the session a
    // sessionless send then creates must still appear (§7.2 — the created
    // session IS the conversation the user is looking at).
    expect(INITIAL_STATE.sessions).toBeNull();
    const s = reducer(INITIAL_STATE, { type: "SESSION_CREATED", session: SESSION_A });
    expect(s.sessions).toEqual([SESSION_A]);
    // and a second create prepends without duplicating
    const s2 = reducer(s, { type: "SESSION_CREATED", session: SESSION_B });
    expect(s2.sessions).toEqual([SESSION_B, SESSION_A]);
    const s3 = reducer(s2, { type: "SESSION_CREATED", session: SESSION_A });
    expect(s3.sessions).toEqual([SESSION_A, SESSION_B]);
  });
});

describe("desktop reducer — turn/start (§48)", () => {
  it("appends the user bubble + open assistant item and sets activeTurn", () => {
    const s = turnInFlight();
    expect(s.activeTurn).toEqual({ turnId: 1, startedAt: expect.any(Number) });
    const items = s.conversation.items;
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: "user", text: "帮我找 Queen 的专辑" });
    const a = items[1];
    expect(a).toMatchObject({ kind: "assistant", text: "", status: "no-answer", tools: [] });
    expect(s.conversation.log[0]).toMatchObject({ type: "turn/start", turnId: 1 });
  });

  it("ignores a second turn/start while one is live (invariant)", () => {
    const live = turnInFlight();
    const s = reducer(live, {
      type: "TURN_START",
      sessionId: "s-a",
      turnId: 2,
      userText: "第二条",
      ts: t(),
    });
    expect(s.activeTurn?.turnId).toBe(1);
    expect(s.conversation.items).toHaveLength(2);
  });

  it("ignores events for a session that is not active (invariant)", () => {
    const live = turnInFlight();
    const s = reducer(live, {
      type: "TURN_START",
      sessionId: "s-b",
      turnId: 9,
      userText: "别处",
      ts: t(),
    });
    expect(s.activeTurn?.turnId).toBe(1);
    expect(s.conversation.items).toHaveLength(2);
  });
});

describe("desktop reducer — tool/call + tool/result (§48)", () => {
  it("tool/call appends an in-flight activity to the open item and logs it", () => {
    const s = reducer(turnInFlight(), { ...call, ts: t() });
    expect(lastAssistant(s).tools).toEqual([
      expect.objectContaining({ callId: "c1", name: "search_catalog", ok: true }),
    ]);
    expect(s.conversation.log.at(-1)).toMatchObject({ type: "tool/call", tool: { callId: "c1" } });
  });

  it("tool/result finalizes only the newest running activity with that callId", () => {
    let s = turnInFlight();
    s = reducer(s, { ...call, ts: t() });
    s = reducer(s, {
      type: "TOOL_CALL",
      sessionId: "s-a",
      turnId: 1,
      tool: { name: "remember", arguments: { text: "喜欢 Queen" }, callId: "c2" },
      ts: t(),
    });
    s = reducer(s, result({ callId: "c1" }));
    const tools = lastAssistant(s).tools;
    expect(tools).toHaveLength(2);
    // c1 (older) is now final; c2 (newer, unmatched) still in flight.
    expect(tools[0]).toMatchObject({ callId: "c1", ok: true, durationMs: 1200 });
    expect(tools[1]).toMatchObject({ callId: "c2", ok: true });
    expect(s.activeTurn).not.toBeNull(); // the turn is not over
  });

  it("business error: tool/result ok=false keeps code + message on the activity", () => {
    let s = turnInFlight();
    s = reducer(s, { ...call, ts: t() });
    s = reducer(
      s,
      result({
        durationMs: 80,
        ok: false,
        error: { code: "DATABASE_ERROR", message: "db down" },
      }),
    );
    expect(lastAssistant(s).tools[0]).toMatchObject({
      ok: false,
      error: { code: "DATABASE_ERROR", message: "db down" },
    });
  });

  it("tool events while idle are ignored (no turn → no activity)", () => {
    const idle = openedA();
    const s = reducer(reducer(idle, { ...call, ts: t() }), result());
    expect(s.conversation.items).toEqual([]);
  });
});

describe("desktop reducer — assistant/chunk + step (§48)", () => {
  it("chunks append to the open item's text and log a chunk row each", () => {
    let s = turnInFlight();
    const delta = (text: string) =>
      reducer(s, { type: "TEXT_DELTA", sessionId: "s-a", turnId: 1, text, ts: t() });
    s = delta("Queen 的");
    s = delta("专辑");
    expect(lastAssistant(s).text).toBe("Queen 的专辑");
    const chunks = s.conversation.log.filter((r) => r.type === "chunk");
    expect(chunks.map((c) => c.chars)).toEqual([7, 2]); // "Queen 的" + "专辑"
  });

  it("chunks to a finished turn are ignored", () => {
    const done = reducer(turnInFlight(), {
      type: "TURN_END",
      sessionId: "s-a",
      turnId: 1,
      reason: "completed",
      ts: t(),
    });
    const s = reducer(done, { type: "TEXT_DELTA", sessionId: "s-a", turnId: 1, text: "迟到", ts: t() });
    expect(lastAssistant(s).text).toBe("");
  });
});

describe("desktop reducer — turn/end final statuses (§28.2 mapping)", () => {
  const end = (reason: TurnEndReason, seeded = "") => {
    let s = turnInFlight();
    if (seeded !== "") {
      s = reducer(s, { type: "TEXT_DELTA", sessionId: "s-a", turnId: 1, text: seeded, ts: t() });
    }
    return reducer(s, { type: "TURN_END", sessionId: "s-a", turnId: 1, reason, ts: t() });
  };

  it("completed → complete and clears activeTurn", () => {
    const s = end("completed", "有正文");
    expect(lastAssistant(s).status).toBe("complete");
    expect(s.activeTurn).toBeNull();
    expect(s.conversation.log.at(-1)).toMatchObject({ type: "turn/end", reason: "completed" });
  });

  it("aborted → stopped; max-tokens → limited; interrupted → interrupted", () => {
    expect(lastAssistant(end("aborted", "x")).status).toBe("stopped");
    expect(lastAssistant(end("max-tokens", "x")).status).toBe("limited");
    expect(lastAssistant(end("interrupted", "x")).status).toBe("interrupted");
  });

  it("error → failed", () => {
    expect(lastAssistant(end("error", "x")).status).toBe("failed");
  });

  it("blocked resolves by text presence: text → complete, no text → no-answer", () => {
    expect(lastAssistant(end("blocked", "有")).status).toBe("complete");
    expect(lastAssistant(end("blocked")).status).toBe("no-answer");
  });

  it("business error: turn/error stamps the item, then end(error) → failed", () => {
    let s = turnInFlight();
    s = reducer(s, {
      type: "TURN_ERROR",
      sessionId: "s-a",
      turnId: 1,
      code: "LLM_UNAVAILABLE",
      message: "模型服务不可用",
      ts: t(),
    });
    expect(lastAssistant(s).error).toEqual({ code: "LLM_UNAVAILABLE", message: "模型服务不可用" });
    s = reducer(s, { type: "TURN_END", sessionId: "s-a", turnId: 1, reason: "error", ts: t() });
    expect(lastAssistant(s).status).toBe("failed");
  });
});

describe("desktop reducer — restart recovery hold (Targeted Repair P1)", () => {
  it("RESTORE_START holds at restoring; bridge ready/restoring during the hold is ignored", () => {
    let s = reducer(openedA(), { type: "RESTORE_START" });
    expect(s.runtime).toMatchObject({ status: "restoring", restorePending: true });
    // The respawned bridge re-emits ready (and its own restoring→ready
    // around our reopen) — none may release the composer before the result.
    s = reducer(s, { type: "RUNTIME_STATUS", status: "ready" });
    expect(s.runtime).toMatchObject({ status: "restoring", restorePending: true });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "restoring" });
    expect(s.runtime).toMatchObject({ status: "restoring", restorePending: true });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "starting" });
    expect(s.runtime).toMatchObject({ status: "restoring", restorePending: true });
  });

  it("ready only after the reopen: session/opened releases the hold (Case A)", () => {
    let s = reducer(openedA(), { type: "RUNTIME_STATUS", status: "restarting" });
    s = reducer(s, { type: "RESTORE_START" }); // the fresh bridge's ready → hold
    // The reopen completes: session/opened hydrates A and releases ready.
    const items = [
      { kind: "user", id: "u-1", text: "查一下订单", ts: T },
      { kind: "assistant", id: "s-a:1", text: "有 7 笔", ts: T, status: "complete", tools: [] },
    ] as RootState["conversation"]["items"];
    s = reducer(s, { type: "SESSION_OPENED", session: SESSION_A, items, log: [] });
    expect(s.runtime).toMatchObject({ status: "ready", restorePending: false });
    expect(s.activeSessionId).toBe("s-a");
    expect(s.conversation.items).toEqual(items);
    // The very next turn on the SAME session succeeds — no switch needed.
    s = reducer(s, {
      type: "TURN_START",
      sessionId: "s-a",
      turnId: 2,
      userText: "继续",
      ts: t(),
    });
    expect(s.activeTurn?.turnId).toBe(2);
    expect(s.conversation.items).toHaveLength(4);
  });

  it("host truth ends the hold: disconnected/error/restarting clear restorePending", () => {
    for (const status of ["disconnected", "error", "restarting"] as const) {
      let s = reducer(openedA(), { type: "RESTORE_START" });
      s = reducer(s, { type: "RUNTIME_STATUS", status });
      expect(s.runtime.status).toBe(status);
      expect(s.runtime.restorePending).toBe(false);
    }
  });

  it("restore failure surfaces error — never a false ready (Case C)", () => {
    let s = reducer(openedA(), { type: "RESTORE_START" });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "error", detail: "恢复会话失败：boom" });
    expect(s.runtime).toMatchObject({
      status: "error",
      detail: "恢复会话失败：boom",
      restorePending: false,
    });
    // Composer stays locked (runtime not ready) — turns cannot be sent.
    expect(s.activeSessionId).toBe("s-a");
  });

  it("after a restore failure a successful open of another session recovers ready", () => {
    let s = reducer(openedA(), { type: "RESTORE_START" });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "error", detail: "恢复会话失败：boom" });
    s = reducer(s, { type: "SESSION_OPENED", session: SESSION_B, items: [], log: [] });
    expect(s.runtime).toMatchObject({ status: "ready", restorePending: false });
    expect(s.activeSessionId).toBe("s-b");
  });

  it("新建会话 after a failed restore binds a fresh session and recovers ready", () => {
    let s = reducer(openedA(), { type: "RESTORE_START" });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "error", detail: "恢复会话失败：boom" });
    s = reducer(s, { type: "SESSION_CREATED", session: SESSION_B });
    expect(s.runtime.status).toBe("ready");
    expect(s.activeSessionId).toBe("s-b");
    expect(s.conversation.items).toEqual([]);
  });

  it("plain restart without an active session never holds (Case B)", () => {
    let s = reducer(INITIAL_STATE, { type: "RUNTIME_STATUS", status: "restarting" });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "ready" });
    expect(s.runtime).toMatchObject({ status: "ready", restorePending: false });
  });

  it("SESSION_OPENED/CREATED keep a non-gated runtime untouched (no stray flips)", () => {
    const opened = openedA(); // INITIAL runtime is `starting`
    expect(opened.runtime.status).toBe("starting");
    expect(opened.runtime.restorePending).toBe(false);
    const created = reducer(INITIAL_STATE, { type: "SESSION_CREATED", session: SESSION_A });
    expect(created.runtime.status).toBe("starting");
    expect(created.runtime.restorePending).toBe(false);
  });
});

describe("desktop reducer — runtime state (§48: runtime disconnected)", () => {
  it("orphan turn is finalized as interrupted when the runtime leaves ready", () => {
    let s = turnInFlight();
    s = reducer(s, { ...call, ts: t() });
    s = reducer(s, { type: "TEXT_DELTA", sessionId: "s-a", turnId: 1, text: "一半的回答", ts: t() });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "disconnected" });
    // The open item is final-interrupted, log closed, composer never locked.
    expect(lastAssistant(s).status).toBe("interrupted");
    expect(s.activeTurn).toBeNull();
    expect(s.conversation.log.at(-1)).toMatchObject({ type: "turn/end", reason: "interrupted" });
    expect(s.runtime.status).toBe("disconnected");
  });

  it("RUNTIME_STATUS ready alone never corrupts a live turn", () => {
    const live = turnInFlight();
    const s = reducer(live, { type: "RUNTIME_STATUS", status: "ready" });
    expect(s.activeTurn?.turnId).toBe(1);
    expect(s.conversation.items).toHaveLength(2);
  });

  it("reconnect after a restart keeps the finalized conversation", () => {
    let s = turnInFlight();
    s = reducer(s, { type: "RUNTIME_STATUS", status: "restarting" });
    s = reducer(s, { type: "RUNTIME_STATUS", status: "ready" });
    expect(s.activeTurn).toBeNull();
    expect(lastAssistant(s).status).toBe("interrupted");
    expect(s.runtime.status).toBe("ready");
  });
});

describe("desktop reducer — ui flags", () => {
  it("drawer open/filter/close and strip expansion toggle independently", () => {
    let s = reducer(INITIAL_STATE, { type: "DRAWER_TOGGLE" });
    expect(s.ui.drawerOpen).toBe(true);
    s = reducer(s, { type: "DRAWER_SET_FILTER", filter: "tools" });
    expect(s.ui.drawerFilter).toBe("tools");
    s = reducer(s, { type: "DRAWER_CLOSE" });
    expect(s.ui.drawerOpen).toBe(false);
    s = reducer(s, { type: "STRIP_TOGGLE", turnId: 3 });
    expect(s.ui.expandedTurnIds[3]).toBe(true);
    s = reducer(s, { type: "STRIP_TOGGLE", turnId: 3 });
    expect(s.ui.expandedTurnIds[3]).toBe(false);
  });

  it("the settings overlay opens, closes and toggles without disturbing the drawer", () => {
    // Start with the drawer open and the overlay closed, so the two flags are
    // distinguishable at every step.
    const base = reducer(INITIAL_STATE, { type: "DRAWER_TOGGLE" });
    expect([base.ui.configOpen, base.ui.drawerOpen]).toEqual([false, true]);

    const opened = reducer(base, { type: "CONFIG_OPEN" });
    expect([opened.ui.configOpen, opened.ui.drawerOpen]).toEqual([true, true]);
    // Closing is idempotent, and neither move touches the drawer.
    expect(reducer(opened, { type: "CONFIG_CLOSE" }).ui).toMatchObject({ configOpen: false, drawerOpen: true });
    expect(reducer(reducer(opened, { type: "CONFIG_CLOSE" }), { type: "CONFIG_CLOSE" }).ui.configOpen).toBe(false);

    expect(reducer(base, { type: "CONFIG_TOGGLE" }).ui.configOpen).toBe(true);
    expect(reducer(opened, { type: "CONFIG_TOGGLE" }).ui.configOpen).toBe(false);
  });

  it("carries the appearance preference and the settings tab (§18 as amended)", () => {
    // The initial value is deterministic and never read from storage — app.tsx
    // seeds the persisted value through the reducer's lazy initialiser.
    expect(INITIAL_STATE.ui).toMatchObject({
      themePreference: "system",
      settingsTab: "general",
    });

    const dark = reducer(INITIAL_STATE, { type: "THEME_SET", preference: "dark" });
    expect(dark.ui.themePreference).toBe("dark");
    // Setting the same preference again is a no-op on the value (the effect
    // that persists it is keyed on the field, so it must not flap).
    expect(reducer(dark, { type: "THEME_SET", preference: "dark" }).ui.themePreference).toBe("dark");
    expect(reducer(dark, { type: "THEME_SET", preference: "system" }).ui.themePreference).toBe("system");

    expect(reducer(INITIAL_STATE, { type: "SETTINGS_TAB_SET", tab: "model" }).ui.settingsTab).toBe("model");
  });
});

describe("desktop reducer — model caption (§16.6, v1.0.2)", () => {
  it("carries only a model id, and starts unset so the shell can fall back", () => {
    expect(INITIAL_STATE.config).toBeNull();
    const s = reducer(INITIAL_STATE, { type: "CONFIG_MODEL", model: "gpt-4o-mini" });
    expect(s.config).toEqual({ model: "gpt-4o-mini" });
    // A later read replaces it outright — there is no history to accumulate.
    expect(reducer(s, { type: "CONFIG_MODEL", model: "deepseek-v4-flash" }).config).toEqual({
      model: "deepseek-v4-flash",
    });
  });

  it("never lets a turn or a session switch resurrect a stale model", () => {
    const s = reducer(INITIAL_STATE, { type: "CONFIG_MODEL", model: "gpt-4o-mini" });
    const afterOpen = reducer(s, {
      type: "SESSION_OPENED",
      session: SESSION_A,
      items: [],
      log: [],
    });
    expect(afterOpen.config).toEqual({ model: "gpt-4o-mini" });
  });
});

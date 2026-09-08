/**
 * Agent-loop end-to-end (DoD §48D/E): createAgentRuntime boots the real
 * `chinook` profile in-process — no mocks, no DSH Core changes — and the
 * /new → persist → /resume → close lifecycle works. Fully offline: no LLM
 * call is made (sessions are created and drained, never prompted).
 *
 * Isolation: the runtime binds `$DSH_HOME` when cli/runtime is imported
 * (module scope), so this suite provisions its own throwaway home and sets
 * the env BEFORE the dynamic import — it never reads or writes the
 * repository `.dsh`. (Vitest's forks pool runs each test file in its own
 * worker process, so the env assignment cannot leak across files.)
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentRuntime } from "../apps/cli/src/runtime";
import { cleanupTestHome, provisionTestHome } from "./helpers/test-home";

describe("agent runtime lifecycle (offline)", () => {
  let runtime: AgentRuntime | undefined;
  let home: string | undefined;

  beforeAll(async () => {
    home = provisionTestHome();
    process.env.DSH_HOME = home; // suite-local home; must precede the runtime import
    const { createAgentRuntime } = await import("../apps/cli/src/runtime");
    runtime = await createAgentRuntime();
  }, 60_000);

  afterAll(async () => {
    await runtime?.dispose();
    delete process.env.DSH_HOME;
    cleanupTestHome(home);
    home = undefined;
  }, 30_000);

  it("/new: creates a fresh session that persists and lists newest-first", async () => {
    const id = await runtime!.startSession();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    await runtime!.closeSession();
    const sessions = await runtime!.listSessions();
    expect(sessions.length).toBeGreaterThan(0);
    expect(sessions[0]!.id).toBe(id); // newest first
    expect(sessions.some((s) => s.id === id)).toBe(true);
  });

  it("/resume <id>: rehydrates the persisted session", async () => {
    const listed = await runtime!.listSessions();
    const target = listed[0]!;
    const resumed = await runtime!.startSession(target.id);
    expect(resumed).toBe(target.id);
    await runtime!.closeSession();
  });

  it("starting a new session auto-closes the previous one first", async () => {
    const first = await runtime!.startSession();
    const second = await runtime!.startSession(); // closes `first`
    expect(second).not.toBe(first);
    await runtime!.closeSession();
    const sessions = await runtime!.listSessions();
    for (const id of [first, second]) expect(sessions.some((s) => s.id === id)).toBe(true);
  });

  it("closeSession with no active session is a safe no-op", async () => {
    const before = await runtime!.listSessions();
    await runtime!.closeSession();
    expect(await runtime!.listSessions()).toEqual(before);
  });
});

/**
 * Agent-loop end-to-end (DoD §48D/E): createAgentRuntime boots the real
 * `chinook` profile in-process — no mocks, no DSH Core changes — and the
 * /new → persist → /resume → close lifecycle works. Fully offline: no LLM
 * call is made (sessions are created and drained, never prompted).
 *
 * Requires a bootstrapped home (`pnpm bootstrap` — the pretest hook runs it).
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgentRuntime, type AgentRuntime } from "../apps/cli/src/runtime";

describe("agent runtime lifecycle (offline)", () => {
  let runtime: AgentRuntime | undefined;

  beforeAll(async () => {
    runtime = await createAgentRuntime();
  }, 60_000);

  afterAll(async () => {
    await runtime?.dispose();
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

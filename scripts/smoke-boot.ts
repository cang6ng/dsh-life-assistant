/**
 * Offline smoke-boot of the chinook profile through the real CLI runtime
 * chain: loadProfile → heal → boot → loader.await → registry.create.
 *
 * No LLM call is made — a session is created (the loop fabricates the
 * seeded system context locally) and immediately torn down. Exit code 0
 * proves the full profile composes and mounts in-process.
 */

import { createAgentRuntime } from "../apps/cli/src/runtime.js";

const check = (name: string, ok: boolean, extra = ""): void => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra === "" ? "" : `  (${extra})`}`);
  if (!ok) process.exitCode = 1;
};

const runtime = await createAgentRuntime();
check("profile boot: createAgentRuntime resolved", true);

const id = await runtime.startSession();
check("startSession returns a session id", typeof id === "string" && id.length > 0, id);

await runtime.closeSession();
const sessions = await runtime.listSessions();
check("listSessions sees the flushed session", sessions.some((s) => s.id === id), `${sessions.length} listed`);

await runtime.dispose();
console.log(process.exitCode === 1 ? "SMOKE-BOOT FAILED" : "SMOKE-BOOT OK");

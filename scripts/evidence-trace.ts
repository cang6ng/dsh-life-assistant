/**
 * DoD evidence trace: boots the real chinook profile (same recipe as the CLI
 * runtime) and drives scripted prompts while printing every tool invocation
 * and its result from the session log events (`tool/call`, `tool/result`).
 *
 * The output proves which tools the model actually executed and what each
 * returned — used to validate the V1 transcript end-to-end.
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
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { SessionId, type Session, type SessionEvent } from "@deepseek-ai/dsh-session";
import type { Context } from "@deepseek-ai/cordis";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const DSH_HOME = resolve(process.env.DSH_HOME ?? join(REPO_ROOT, ".dsh"));
const INSTALL_ANCHOR = realpathSync(createRequire(import.meta.url).resolve("@deepseek-ai/dsh/package.json"));

process.env.DSH_HOME ??= DSH_HOME;
process.env.DEEPSEEK_API_KEY ??= process.env.ANTHROPIC_AUTH_TOKEN;

const profile = loadProfile("chinook-agent", "chinook", INSTALL_ANCHOR, DSH_HOME);
await healProfilesModuleFallback({ installAnchor: INSTALL_ANCHOR, profile, home: DSH_HOME });
const homePatches = loadOptionalPatches("chinook-agent", join(DSH_HOME, PROFILE_PATCH_FILENAME)) ?? [];
const patches = structuredClone([
  ...profile.layers.flatMap((layer) => layer.patches),
  ...profile.patches,
  ...homePatches,
]);
const ctx = await boot("chinook-agent", join(profile.dir, "cordis.yml"), patches);
await (ctx.get("loader") as { await(): Promise<void> } | undefined)?.await();

const registry = ctx.get("agents") as AgentRegistry;
const selection = (ctx.get("agentDefaultModel") as { currentSelection(): ModelSelection }).currentSelection();
const handle = await registry.create({
  sessionId: SessionId(`session-${randomUUID()}`),
  meta: { cwd: process.cwd() },
  agentOptions: { provider: selection.provider, model: selection.model },
  setup: (agentCtx: Context) => {
    installModelSelection(agentCtx, { current: selection, assembled: undefined });
  },
});
const agent = handle.agent;
await agent.whenIdle();

const textOf = (block: unknown): string => {
  const b = block as { type?: string; text?: string };
  return b?.type === "text" && typeof b.text === "string" ? b.text : "";
};

ctx.on("session/event", (session: unknown, event: SessionEvent) => {
  if (session !== agent.session) return;
  if (event.type === "tool/call") {
    console.log(`\n[tool] call ${event.data.name} ${event.data.arguments}`);
  } else if (event.type === "tool/result") {
    // ToolResultMessage.content is [ToolResultBlock]; the rendered payload
    // text sits in that block's own content.
    const block = event.data.message.content[0];
    const inner = (block.content ?? []).map(textOf).join("");
    const code = event.data.error === undefined ? "" : ` ${event.data.error.code}`;
    console.log(`[tool] result${code} ${inner.slice(0, 500)}`);
  }
});

const ask = async (text: string): Promise<string> => {
  console.log(`\nYou > ${text}`);
  const message = createUserMessage({ content: [{ type: "text", text }], source: { kind: "user" } });
  let reply = "";
  const off = ctx.on("session/event", (session: unknown, event: SessionEvent) => {
    if (session !== agent.session) return;
    if (event.type === "assistant/chunk") {
      const chunk = event.data.chunk;
      if (chunk.type === "text-delta") reply += chunk.text;
    }
  });
  agent.followup(message);
  await agent.whenIdle();
  off();
  console.log(`\nAgent > ${reply}`);
  return reply;
};

await ask("Show me the details of invoice number 1.");
await ask("What do you remember about my music taste?");
await ask("List my orders.");

await ctx.sessions?.flush?.(agent.session);
await handle.dispose();
await (ctx as unknown as { fiber?: { dispose(): Promise<void> | void } }).fiber?.dispose();
console.log("\nTRACE-DONE");

/**
 * Packaged-runtime smoke (build-time verification, not shipped): spawns the
 * BUNDLED node.exe + the stamped bridge.mjs with a scratch DSH_HOME and
 * CHINOOK_BOOT_RESOURCES, then drives one real turn over the JSONL protocol
 * so the chinook profile, plugin tools, native sqlite and the LLM provider
 * all execute against the packaged resource tree. Exits non-zero on failure.
 *
 * Usage: node apps/desktop/scripts/pack-smoke.mjs [scratch-home]
 */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repo = resolve(scriptDir, "../../..");
const runtimeDir = join(repo, "apps/desktop/src-tauri/runtime");
const scratchHome = resolve(process.argv[2] ?? join(repo, ".packtest-home"));
const nodeExe = join(runtimeDir, "node/node.exe");
const bridge = join(runtimeDir, "bridge/bridge.mjs");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(nodeExe, [bridge], {
  cwd: repo,
  env: {
    ...process.env,
    DSH_HOME: scratchHome,
    CHINOOK_BOOT_RESOURCES: runtimeDir,
  },
  stdio: ["pipe", "pipe", "inherit"],
});

const lines = [];
child.stdout.setEncoding("utf8");
const reader = createInterface({ input: child.stdout });
reader.on("line", (line) => {
  if (line.trim() !== "") lines.push(JSON.parse(line));
});

async function waitFor(pred, timeoutMs = 120_000, label = "envelope") {
  const start = Date.now();
  for (;;) {
    const hit = lines.find(pred);
    if (hit !== undefined) return hit;
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(100);
  }
}

let seq = 0;
const send = (type, data) => {
  seq += 1;
  child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId: `r${seq}`, type, data })}\n`);
  return `r${seq}`;
};

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`PACK-SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
};

try {
  await waitFor((e) => e.type === "runtime/status" && e.data.status === "ready", 120_000, "ready");

  send("session.create");
  const created = await waitFor((e) => e.requestId === "r1", 60_000, "session/created");
  assert(created.type === "session/created", `expected session/created got ${created.type}`);
  const sid = created.sessionId;
  assert(typeof sid === "string" && sid.startsWith("session-"), `odd sessionId ${sid}`);
  console.log("PACK-SMOKE: session", sid);

  // A real turn: business tool + streaming + completion (needs the LLM key
  // in the environment, same as any live verification).
  send("turn.send", { sessionId: sid, text: "查一下我最近的订单列表。" });
  const accepted = await waitFor((e) => e.requestId === "r2", 30_000, "turn.send accept");
  assert(accepted.data?.accepted === true, `turn.send not accepted: ${JSON.stringify(accepted.data)}`);

  const end = await waitFor((e) => e.type === "turn/end", 180_000, "turn/end");
  const kinds = lines.map((l) => l.type);
  const tools = lines.filter((l) => l.type === "tool/result");
  const chunks = lines.filter((l) => l.type === "assistant/chunk");
  console.log("PACK-SMOKE: turn/end", end.data.reason, "| tool/result rows:", tools.length, "| chunk rows:", chunks.length);
  assert(end.data.reason?.kind === "completed" || end.data.reason === "completed", `turn/end reason ${JSON.stringify(end.data.reason)}`);
  assert(tools.length >= 1, "expected at least one tool/result row");
  const lastTool = tools[tools.length - 1].data.tool;
  assert(lastTool.ok === true, `tool not ok: ${JSON.stringify(lastTool.error ?? lastTool.ok)}`);
  console.log("PACK-SMOKE: last tool", lastTool.name, "ok,", lastTool.durationMs, "ms");

  send("session.open", { sessionId: sid });
  const opened = await waitFor((e) => e.requestId === `r${seq}`, 60_000, "session/open");
  assert(opened.type === "session/opened", `expected session/opened got ${opened.type}`);
  assert(opened.data.items?.length >= 1, "hydration should return items");
  console.log("PACK-SMOKE: reopen items", opened.data.items.length, "log rows", opened.data.log.length);

  console.log("PACK-SMOKE: PASS");
} catch (err) {
  console.error("PACK-SMOKE FAIL:", err.message);
  console.error("envelopes so far:", lines.map((l) => `${l.type}${l.requestId ? "#" + l.requestId : ""}`).join(" "));
  process.exit(1);
} finally {
  child.kill();
}

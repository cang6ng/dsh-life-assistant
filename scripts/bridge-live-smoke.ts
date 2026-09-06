/**
 * Bridge live smoke: spawn the bundled bridge, drive a real session create →
 * turn.send (live LLM) → session.open (resume snapshot) over stdin JSONL,
 * then print a compact protocol trace + a machine summary line.
 *
 * Evidence for Phase I / contract §58 (streaming verification).
 */

import { spawn } from "node:child_process";
import { resolve } from "node:path";

const REPO = resolve(import.meta.dirname, "..");
const BRIDGE = resolve(REPO, "apps", "agent-bridge", "dist", "bridge.mjs");

interface Envelope {
  protocolVersion: number;
  requestId?: string;
  sessionId?: string | null;
  turnId?: number | null;
  seq: number;
  type: string;
  data: Record<string, unknown>;
}

const child = spawn(process.execPath, [BRIDGE], { cwd: REPO, stdio: ["pipe", "pipe", "pipe"] });
const lines: Envelope[] = [];
let stderrTail = "";
child.stderr.on("data", (b) => {
  stderrTail = (stderrTail + b.toString()).slice(-2000);
});

const collect = new Promise<void>((resolveCollect) => {
  child.stdout.on("data", (b) => {
    for (const raw of b.toString().split("\n")) {
      if (raw.trim() === "") continue;
      try {
        lines.push(JSON.parse(raw) as Envelope);
      } catch {
        // ignore
      }
    }
  });
  child.on("exit", () => resolveCollect());
});

const send = (requestId: string, type: string, data?: unknown): void => {
  child.stdin.write(`${JSON.stringify({ protocolVersion: 1, requestId, type, data: data ?? {} })}\n`);
};

const waitFor = (requestId: string): Promise<Envelope> =>
  new Promise((resolveWait) => {
    const check = (): void => {
      const hit = lines.find((l) => l.requestId === requestId);
      if (hit !== undefined) return resolveWait(hit);
      setTimeout(check, 100);
    };
    check();
  });

const waitForType = (type: string, count = 1): Promise<Envelope[]> =>
  new Promise((resolveWait) => {
    const check = (): void => {
      const hits = lines.filter((l) => l.type === type);
      if (hits.length >= count) return resolveWait(hits);
      setTimeout(check, 100);
    };
    check();
  });

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const text = (): string =>
  lines
    .filter((l) => l.type === "assistant/chunk")
    .map((l) => (l.data as { text?: string }).text ?? "")
    .join("");

async function main(): Promise<void> {
  const prompt = process.argv[2] ?? "帮我找一些 Queen 的专辑。";
  send("r-create", "session.create");
  const created = await waitFor("r-create");
  console.log(`[1] create → ${(created.data as { session?: unknown }).session !== undefined ? "session/created" : created.type}`);

  send("r-send", "turn.send", { sessionId: created.sessionId, text: prompt });
  const accepted = await waitFor("r-send");
  console.log(`[2] turn.send → ${accepted.type} ${JSON.stringify(accepted.data)}`);
  await waitForType("turn/end");
  console.log(`[3] turn stream envelope counts: ${counts()}`);
  for (const l of lines.filter((l) => l.type === "turn/error" || l.type === "turn/end" || l.type === "turn/start")) {
    console.log(`[3a] RAW ${l.type} data=${JSON.stringify(l.data)} seq=${l.seq}`);
  }
  console.log(`[4] assistant text (${text().length} chars): ${text().slice(0, 160)}…`);
  console.log(`[5] tools seen: ${toolTrace()}`);

  send("r-open", "session.open", { sessionId: created.sessionId });
  const opened = await waitFor("r-open");
  const openData = opened.data as {
    session?: { sessionId: string; title: string; messageCount?: number };
    items?: unknown[];
    log?: unknown[];
  };
  console.log(
    `[6] reopen → ${opened.type} title=${JSON.stringify(openData.session?.title)} items=${openData.items?.length} log=${openData.log?.length} count=${openData.session?.messageCount}`,
  );
  const kinds = (openData.items ?? []).map((i) => (i as { kind?: string }).kind).join(",");
  console.log(`[7] item kinds: ${kinds}`);
  child.stdin.end();
  await sleep(1500);
  child.kill();
  await collect;
  console.log(`SUMMARY session=${created.sessionId} turnEnvelopes=${turnEnvelopeCount()} replyChars=${text().length} stderrTail=${JSON.stringify(stderrTail.slice(-120))}`);
}

function counts(): string {
  const by: Record<string, number> = {};
  for (const l of lines) by[l.type] = (by[l.type] ?? 0) + 1;
  return Object.entries(by)
    .map(([k, v]) => `${k}×${v}`)
    .join(" ");
}

function turnEnvelopeCount(): number {
  const end = lines.findIndex((l) => l.type === "turn/end");
  return end >= 0 ? end + 1 : 0;
}

function toolTrace(): string {
  const out: string[] = [];
  for (const l of lines) {
    if (l.type === "tool/call") {
      const t = l.data as { tool?: { name: string } };
      out.push(`${t.tool?.name}()`);
    } else if (l.type === "tool/result") {
      const t = l.data as { tool?: { ok: boolean; error?: { code: string } } };
      out.push(t.tool?.ok === false ? `✗${t.tool?.error?.code}` : "✓");
    }
  }
  return out.join(" ");
}

main().catch((error) => {
  console.error(`FAILED: ${String(error)}`);
  process.exit(1);
});

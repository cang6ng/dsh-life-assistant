/**
 * JSONL transport helpers (stdin/stdout rule of contract §10).
 *
 * stdout is reserved for protocol lines ONLY; every diagnostic goes to
 * stderr. All writes funnel through `writeJsonLine`, all reads through
 * `createLineReader`.
 */

import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { writeFileSync, renameSync, existsSync, unlinkSync, copyFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

export function encodeJsonLine(value: unknown): string {
  return JSON.stringify(value);
}

/** Parse one raw line into an object; returns null when malformed (caller logs + ignores). */
export function decodeJsonLine(raw: string): unknown {
  const line = raw.trim();
  if (line === "") return null;
  try {
    const parsed: unknown = JSON.parse(line);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Protocol-only writer: one JSON object per stdout line. Never throws on EPIPE. */
export function createJsonlWriter(stdout: Writable): (obj: unknown) => void {
  const onError = () => {
    // Parent died or closed the pipe — the host owns our lifecycle. Do not
    // crash loudly; exit quietly once the current turn settles.
    if (process.stdout.destroyed || process.stdout.closed) {
      process.exitCode = 0;
    }
  };
  stdout.on("error", onError);
  return (obj: unknown) => {
    stdout.write(encodeJsonLine(obj) + "\n");
  };
}

export interface LineReader {
  onLine(cb: (line: string) => void): void;
  /** Resolves on end-of-input or stream error. */
  whenClosed(): Promise<void>;
  close(): void;
}

export function createLineReader(input: Readable): LineReader {
  const rl: Interface = createInterface({ input, crlfDelay: Infinity });
  const closed = new Promise<void>((resolve) => {
    rl.once("close", () => resolve());
    rl.once("error", () => resolve());
  });
  return {
    onLine(cb) {
      rl.on("line", cb);
    },
    whenClosed: () => closed,
    close() {
      rl.close();
    },
  };
}

/** stderr logger — stdout purity (contract §10). */
export function logStderr(...args: unknown[]): void {
  process.stderr.write(`[bridge] ${args.map(String).join(" ")}\n`);
}

/**
 * Atomic-ish file write used by the disposable title index (contract §17):
 * write tmp + rename so a crash never truncates the index.
 */
export function writeJsonFileAtomically(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = join(tmpdir(), `dsh-index-${randomUUID()}.tmp`);
  try {
    writeFileSync(tmp, JSON.stringify(value, null, 2), "utf8");
    if (existsSync(file)) renameSync(file, `${file}.bak`);
    renameSync(tmp, file);
    try {
      unlinkSync(`${file}.bak`);
    } catch {
      /* no previous file — fine */
    }
  } catch {
    // rename may fail across volumes; a same-dir copy fallback is enough for a
    // disposable index. If even that fails the index is simply lost — never fatal.
    try {
      copyFileSync(tmp, file);
      unlinkSync(tmp);
    } catch {
      /* best effort */
    }
  }
}

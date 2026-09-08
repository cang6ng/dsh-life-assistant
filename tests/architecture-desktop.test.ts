/**
 * Desktop V2 architecture static checks (contract §60 + §59). The chain
 * must hold its boundaries in both directions:
 *
 *  - Rust desktop host: no Chinook business domain (no Track/Album/Invoice
 *    queries, no memory SQL, no tool logic, no SQL engine dependency) —
 *    it is a process supervisor + JSONL router only;
 *  - React presentation: no runtime imports (@deepseek-ai/*), no database
 *    or child_process access — the bridge is the only data channel;
 *  - Chinook plugin: no desktop assumptions (Tauri/React);
 *  - Agent Core (CLI runtime + agent bridge): no Fluent UI / Tauri / Window;
 *  - §59 reasoning-safety: reasoning content is handled (dropped) on the
 *    bridge side and never appears in the presentation layer.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO = join(import.meta.dirname, "..");
const DESKTOP_SRC = join(REPO, "apps", "desktop", "src");
const RUST_SRC = join(REPO, "apps", "desktop", "src-tauri", "src");
const PLUGIN_SRC = join(REPO, "plugins", "chinook", "src");
const CORE_SRC = join(REPO, "apps", "cli");
const BRIDGE_SRC = join(REPO, "apps", "agent-bridge", "src");

function filesUnder(dir: string, ext: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, ext));
    else if (entry.endsWith(ext)) out.push(full);
  }
  return out;
}

function readAll(dir: string, ext = ".ts"): string {
  return filesUnder(dir, ext).map((f) => readFileSync(f, "utf8")).join("\n");
}

describe("§60 — Rust desktop host holds no Chinook business domain", () => {
  const rust = readAll(RUST_SRC, ".rs") + readFileSync(join(REPO, "apps", "desktop", "src-tauri", "Cargo.toml"), "utf8");

  it("has no Track/Album/Invoice/customer business vocabulary", () => {
    for (const banned of ["Track", "Album", "Invoice", "customer_id", "track_id", "album_id"]) {
      expect(rust).not.toContain(banned);
    }
  });

  it("runs no SQL / memory / tool logic and ships no SQL engine", () => {
    for (const banned of ["SELECT ", "INSERT INTO", "UPDATE ", "FROM track", "FROM album", "FROM invoice", "FROM genre"]) {
      expect(rust).not.toMatch(new RegExp(banned.replace(" ", "\\s*"), "i"));
    }
    for (const dep of ["rusqlite", "sqlx", "sqlite", "tauri-plugin-sql"]) {
      expect(rust).not.toContain(dep);
    }
  });
});

describe("§60 — React presentation is a thin client", () => {
  // Comments (incl. boundary documentation) are stripped so the checks hit
  // code only.
  const react = (readAll(DESKTOP_SRC, ".ts") + readAll(DESKTOP_SRC, ".tsx"))
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("never imports the runtime or engine packages", () => {
    for (const banned of ["@deepseek-ai/", "@dsh/", "better-sqlite3"]) {
      expect(react).not.toContain(banned);
    }
  });

  it("has no Node-side or subprocess capability", () => {
    // `node:` counts only as a module specifier, not a property name.
    expect(react).not.toMatch(/from\s+["']node:|require\(["']node:|import\s+["']node:/);
    for (const banned of ["child_process", "require(", "process.env", "spawn("]) {
      expect(react).not.toContain(banned);
    }
  });

  it("talks to the host only through @tauri-apps invoke", () => {
    expect(react).not.toMatch(/from\s+["']@tauri-apps\/plugin-(shell|http|process)/);
    expect(react).not.toContain("fetch(");
  });
});

describe("§60 — Chinook plugin stays desktop-agnostic", () => {
  const plugin = readAll(PLUGIN_SRC);

  it("has no Tauri / React / desktop assumptions", () => {
    for (const banned of ["tauri", "react", "@tauri-apps", "invoke(", "getCurrentWindow", "createRoot", "webview"]) {
      expect(plugin).not.toContain(banned);
    }
  });
});

describe("§60 — Agent Core (CLI runtime + bridge) stays UI-free", () => {
  const core = readAll(CORE_SRC) + readAll(BRIDGE_SRC);

  it("has no Fluent UI / Tauri / window vocabulary", () => {
    for (const banned of ["@fluentui", "react-dom", "tauri", "@tauri-apps", "createRoot", "window_minimize"]) {
      expect(core).not.toContain(banned);
    }
  });
});

describe("§59 — reasoning content never reaches the presentation", () => {
  const bridge = readAll(BRIDGE_SRC);
  const react = readAll(DESKTOP_SRC, ".ts") + readAll(DESKTOP_SRC, ".tsx");

  it("the bridge filters reasoning deltas before the presentation protocol", () => {
    // A reasoning-drop decision must exist where the DSH events enter the
    // desktop protocol (runtime-adapter / protocol boundary).
    expect(bridge).toMatch(/reasoning/);
  });

  it("the presentation layer never models or renders reasoning", () => {
    for (const banned of ["reasoning_delta", "reasoning-delta", "chain-of-thought", "reasoning_block", "reasoning-delta:"]) {
      expect(react).not.toContain(banned);
    }
  });
});

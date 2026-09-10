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

describe("§44 — the model credential stays out of presentation state", () => {
  /** Source with comments removed, so a documented rule is not a violation. */
  const code = (rel: string): string =>
    readFileSync(join(DESKTOP_SRC, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("models no credential anywhere in the store — the config slice is a model id", () => {
    // `\btoken\b`: the store legitimately says "max-tokens" (a turn-end reason).
    const credentialWord = /apiKey|api_key|credential|secret|\btoken\b/i;
    for (const rel of ["store/state.ts", "store/actions.ts", "store/reducer.ts"]) {
      expect(code(rel), rel).not.toMatch(credentialWord);
    }
  });

  it("declares no response shape able to carry a key value", () => {
    const types = code("protocol/types.ts");
    const declared = types.slice(types.indexOf("export interface ApiKeyStateData"));
    const body = declared.slice(0, declared.indexOf("}"));
    // The key state is a presence triple: whether one resolves, from where,
    // and whether this process may change it. No value, no preview, no tail.
    for (const field of ["configured", "writable", "ref"]) expect(body).toContain(field);
    for (const forbidden of ["value", "preview", "last4", "masked"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("lets the credential travel only as an argument, and only upward", () => {
    const client = code("bridge/client.ts");
    // Both reads are argument-less: there is no API to ask for a key back.
    expect(client).toMatch(/export function configGet\(\): Promise<Envelope>/);
    expect(client).toMatch(/export function configTest\(\): Promise<Envelope>/);
    // Exactly two functions accept a credential-bearing draft, and both send
    // it host-ward: `configSave` persists it, `configModels` uses it once for
    // one outbound request and stores nothing. A third is a new decision about
    // the credential's direction, not an accident — so it fails here first.
    const drafts = [
      ...client.matchAll(/export function (\w+)\((\w+): (ApiConfigPatchData|ApiConfigModelsDraft)\)/g),
    ].map((m) => m[1]);
    expect(drafts).toEqual(["configSave", "configModels"]);
  });

  it("declares no listing shape able to carry a key value", () => {
    const types = code("protocol/types.ts");
    const declared = types.slice(types.indexOf("export interface ApiModelsListedData"));
    const body = declared.slice(0, declared.indexOf("}"));
    // Ids, a verdict, a machine code and our own caption. Nothing a key could
    // ride out on — in particular not the endpoint's own prose, which a
    // misconfigured gateway can echo a credential inside.
    for (const field of ["listed", "models", "code", "message", "latencyMs"]) {
      expect(body).toContain(field);
    }
    for (const forbidden of ["value", "preview", "last4", "masked", "apiKey"]) {
      expect(body, forbidden).not.toContain(forbidden);
    }
  });

  it("never reads the key input back out of the DOM", () => {
    // The settings surface moved to components/Settings/, but the file that
    // handles the credential did not — it is still this one, so this is where
    // the guard belongs. The renderer that wraps it is checked too, so a
    // "helpful" refactor cannot read the field out from a parent instead.
    for (const rel of [
      "components/ApiConfig/ApiConfigPanel.tsx",
      "components/Settings/SettingsPanel.tsx",
    ]) {
      const source = code(rel);
      for (const banned of ["querySelector", "defaultValue", "localStorage", "sessionStorage"]) {
        expect(source, `${rel}: ${banned}`).not.toContain(banned);
      }
    }
  });
});

describe("§18 — the appearance preference is one key, spelled the same in both places", () => {
  const desktop = join(REPO, "apps", "desktop");
  const themePref = readFileSync(join(DESKTOP_SRC, "store", "themePreference.ts"), "utf8");
  const indexHtml = readFileSync(join(desktop, "index.html"), "utf8");
  /** Comments stripped, so a documented non-rule is not a violation. */
  const code = (rel: string): string =>
    readFileSync(join(DESKTOP_SRC, rel), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("declares the storage key once in the module and once in the pre-paint script", () => {
    // index.html runs before the bundle, so it cannot import the module and
    // the literal is necessarily duplicated. Pinned so the two cannot drift:
    // a mismatch would leave the app flashing the wrong scheme on every
    // launch while React itself agreed with the stored preference.
    const literal = themePref.match(/THEME_KEY\s*=\s*"([^"]+)"/)?.[1];
    expect(literal).toBeTruthy();
    expect(indexHtml).toContain(`"${literal}"`);
  });

  it("tells the engine the document supports both schemes, before any CSS lands", () => {
    expect(indexHtml).toMatch(/<meta\s+name="color-scheme"\s+content="light dark"/);
    // The pre-paint script is the only way to avoid a white first frame in
    // dark, so it must also exist — the meta alone only sets the canvas.
    expect(indexHtml).toMatch(/documentElement\.style\.colorScheme/);
  });

  it("keeps the preference display-only — nothing about it reaches the bridge", () => {
    // A display preference is not host state: it must not be a protocol type
    // or a bridge call, or it would travel the credential channel's neighbours.
    const types = code("protocol/types.ts");
    expect(types).not.toMatch(/themePreference|colorScheme|theme/i);
    const client = code("bridge/client.ts");
    expect(client).not.toMatch(/theme/i);
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

describe("§4.3 — the custom window chrome can actually move the window", () => {
  // The window has no native decorations (`decorations: false`), so its only
  // move handle is a `data-tauri-drag-region` element in the title bar: the
  // core script turns a mousedown on one into
  // `invoke('plugin:window|start_dragging')`, which the ACL gates. That command
  // is NOT part of `core:default`, and the rejection is swallowed by the script
  // — so dropping the grant makes the whole window silently undraggable.
  const capabilities = JSON.parse(
    readFileSync(join(REPO, "apps", "desktop", "src-tauri", "capabilities", "default.json"), "utf8"),
  ) as { permissions: string[] };

  it("grants core:window:allow-start-dragging", () => {
    expect(capabilities.permissions).toContain("core:window:allow-start-dragging");
  });

  it("marks the title bar and its brand block as drag regions", () => {
    // A bare attribute only fires when the click's target IS that element, so
    // the brand's own text (a child span) needs the "deep" form to drag it.
    const titleBar = readFileSync(join(DESKTOP_SRC, "components", "TitleBar", "TitleBar.tsx"), "utf8");
    expect(titleBar).toMatch(/data-tauri-drag-region\b/);
    expect(titleBar).toContain('data-tauri-drag-region="deep"');
  });
});

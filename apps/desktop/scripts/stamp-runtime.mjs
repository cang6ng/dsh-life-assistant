/**
 * Stamp the packaged runtime resource tree (contract §43/§45, UI spec §41):
 *
 *   <src-tauri>/runtime/
 *     node/node.exe          — the Node runtime used to launch the sidecar
 *     bridge/bridge.mjs      — the built agent-bridge bundle
 *     node_modules/          — the runtime dependency closure as REAL files
 *                              (dev resolves it from the pnpm store; a
 *                              packaged app has no store, and ESM bare-
 *                              specifier resolution walks up from the
 *                              bundle, so every package the sidecar + DSH
 *                              boot actually loads must sit here, with
 *                              native binaries dereferenced)
 *     home-template/         — first-run DSH home image (real files, no
 *                              junctions): data/{chinook.db,memory.db} and
 *                              profiles/chinook/{package.json,cordis.yml,
 *                              cordis.patch.yml}. node_modules/ + module
 *                              fallbacks are NOT stamped: the DSH boot heal
 *                              regenerates them against the packaged
 *                              node_modules above on first launch
 *                              (dsh-app-boot healProfilesModuleFallback).
 *
 * Run before `tauri build`; idempotent (wipes + regenerates the tree).
 * Never bundles credentials: LLM API keys reach the sidecar only through
 * the Rust host env forwarding (contract §44).
 */

import { cpSync, existsSync, mkdirSync, realpathSync, readFileSync, rmSync, writeFileSync, statSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "../../..");
const DESKTOP = resolve(REPO_ROOT, "apps/desktop");
const SRC_TAURI = join(DESKTOP, "src-tauri");
const RUNTIME_DIR = join(SRC_TAURI, "runtime");
const rootRequire = createRequire(join(REPO_ROOT, "package.json"));

/** Package names that may appear at the top of the closure. */
const ALLOWED_TOP = new Set(["better-sqlite3", "chinook-dsh-plugin"]);

/** A directory is a node_modules walk: ancestors of `dir` each host node_modules. */
function resolvePackageDir(fromDir, name) {
  const scoped = name.startsWith("@");
  let dir = fromDir;
  for (;;) {
    const candidate = scoped ? join(dir, "node_modules", ...name.split("/")) : join(dir, "node_modules", name);
    if (existsSync(candidate)) return realpathSync(candidate);
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`cannot resolve ${name} from ${fromDir}`);
}

/** Prod dependency names of one package manifest (deps/peer/optional). */
function depNames(manifest) {
  const out = [];
  for (const key of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = manifest?.[key];
    if (deps !== null && typeof deps === "object") out.push(...Object.keys(deps));
  }
  return out;
}

/**
 * Collect { name → real package dir } for the runtime dependency closure.
 * Each dependency resolves from its DECLARING package's real directory, so
 * pnpm's per-package store links (including peer copies such as
 * cordis-plugin-include under a cordis install) are found exactly as Node
 * finds them at runtime. Roots resolve from the repo root node_modules.
 */
function collectClosure() {
  const rootManifest = JSON.parse(readFileSync(join(REPO_ROOT, "package.json"), "utf8"));
  const roots = [];
  for (const key of ["dependencies", "devDependencies"]) {
    for (const name of Object.keys(rootManifest[key] ?? {})) {
      if (name.startsWith("@deepseek-ai/") || ALLOWED_TOP.has(name)) roots.push(name);
    }
  }
  const closure = new Map();
  const queue = roots.map((name) => ({ name, fromDir: REPO_ROOT }));
  while (queue.length > 0) {
    const { name, fromDir } = queue.pop();
    if (closure.has(name)) continue;
    let realDir;
    try {
      realDir = resolvePackageDir(fromDir, name);
    } catch {
      // Mirrors the dev graph: an optional/uninstalled peer (e.g.
      // utf-8-validate under ws) that Node itself cannot resolve here is
      // not part of the runnable closure.
      console.warn(`[stamp] skip unresolvable dep ${name} (from ${fromDir})`);
      continue;
    }
    closure.set(name, realDir);
    const manifestPath = join(realDir, "package.json");
    const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : undefined;
    for (const dep of depNames(manifest)) {
      if (!closure.has(dep)) queue.push({ name: dep, fromDir: realDir });
    }
  }
  return closure;
}

function wipeAndMk(dir) {
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
}

// ---------------------------------------------------------------------------
// Prune: keep only the packages the chinook profile can actually reach at
// boot. The full closure above is grown from the repo-root manifest (which
// lists the whole DSH workspace), so it contains every capability row the
// monorepo ships — webhooks, MCP, ACP, shells, subagents, the pi-ai and
// Bedrock/OpenAI/Google provider SDKs, ripgrep, sharp, koffi, … — even
// though the chinook profile disables those rows (§36). Shipping them would
// add hundreds of MB of never-executed code (and other-platform binaries).
//
// Ground truth is the boot composition itself: the profile's
// `dsh.profile.bundles` plus every row of the dsh-base patch that the
// profile patch does NOT disable is mounted by name at startup, and each
// mounted package's code statically imports its own dependencies. So:
//   anchors = bridge.mjs + bundle packages + enabled row packages
//   keep    = anchors ∪ { bare specifiers reachable from anchors }
// Everything else in node_modules/ is deleted.
// ---------------------------------------------------------------------------

const BARE_IMPORT = /from\s*["'](@?[a-zA-Z0-9_][\w.-]*(?:\/[\w.-]+)*)["']|require\s*\(\s*["'](@?[a-zA-Z0-9_][\w.-]*(?:\/[\w.-]+)*)["']\s*\)|import\s*\(\s*["'](@?[a-zA-Z0-9_][\w.-]*(?:\/[\w.-]+)*)["']\s*\)/g;

// Dynamic-but-literal resolutions (createRequire(...).resolve("pkg/package.json")
// etc.). Statically invisible to bare-import scanning yet load-bearing: the
// AgentRuntime's install anchor (`apps/cli/src/runtime.ts` INSTALL_ANCHOR)
// resolves "@deepseek-ai/dsh/package.json" this way at bridge import time.
const RESOLVE_LITERAL = /\.resolve\(\s*["'](@?[a-zA-Z0-9_][\w.-]*(?:\/[\w.-]+)*)["']\s*\)/g;

/** Parse the `- id:`/`name:` pairs of a cordis patch into [id, pkgName][]. */
function patchRows(yamlText) {
  const rows = [];
  for (const m of yamlText.matchAll(/^\s*- id: (\S+)\s*\n\s*name: (.+)$/gm)) {
    const name = m[2].trim();
    rows.push([m[1], name.startsWith("'") || name.startsWith('"') ? name.slice(1, -1) : name]);
  }
  return rows;
}

/** Top-level entry under <nm> that contains `p` (its own package root). */
function topEntryUnder(nm, p) {
  const rel = p.slice(nm.length + 1).replaceAll("\\", "/");
  const seg = rel.split("/");
  return seg[0].startsWith("@") ? `${seg[0]}/${seg[1]}` : seg[0];
}

/** Bare-specifier import strings found in one file (static imports only). */
function bareSpecifiers(text) {
  const out = [];
  let m;
  BARE_IMPORT.lastIndex = 0;
  while ((m = BARE_IMPORT.exec(text)) !== null) {
    const s = m[1] ?? m[2] ?? m[3];
    if (!s.startsWith(".") && !s.startsWith("node:")) out.push(s);
  }
  return out;
}

/**
 * Dynamic-but-literal resolve specifiers (require.resolve / import.meta.resolve
 * / createRequire(...).resolve("pkg")). Scanned ONLY over the bridge bundle:
 * the esbuild-inlined AgentRuntime resolves its install anchor
 * `@deepseek-ai/dsh/package.json` this way with no static import anywhere, so
 * no manifest declares it. Inside ordinary packages such calls target
 * manifest-declared loaders, which the manifest pass already covers — scanning
 * every file there would make the flat tree's reachability graph almost fully
 * connected (every package's dist contains some `.resolve(`), defeating prune.
 */
function resolveLiteralSpecifiers(text) {
  const out = [];
  let m;
  RESOLVE_LITERAL.lastIndex = 0;
  while ((m = RESOLVE_LITERAL.exec(text)) !== null) {
    const s = m[1];
    if (!s.startsWith(".") && !s.startsWith("node:")) out.push(s);
  }
  return out;
}

/** Walk one package dir, collecting bare specifiers from every JS file. */
function* specifiersOfDir(dir) {
  const queue = [dir];
  while (queue.length > 0) {
    const d = queue.pop();
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "node_modules") queue.push(p);
      } else if (/\.(js|mjs|cjs)$/.test(e.name)) {
        let text;
        try {
          text = readFileSync(p, "utf8");
        } catch {
          continue;
        }
        for (const s of bareSpecifiers(text)) yield s;
      }
    }
  }
}

/** Split a bare specifier into its package-root part ("a/b/c" → "a/b"). */
function specRoot(spec) {
  const seg = spec.split("/");
  return seg[0].startsWith("@") ? `${seg[0]}/${seg[1]}` : seg[0];
}

// Foreign-platform markers: these native-binary packages exist per-target
// (darwin/linux/musl/freebsd/wasm/ia32/arm64/…). The desktop app only ever
// runs the win32-x64 builds, so manifest-declared variants for other targets
// are pruned even when their loader package is kept.
const FOREIGN_PLATFORM = /darwin|linux|musl|freebsd|android|openbsd|webcontainers|wasm32|ia32|arm64|ppc64|riscv64|s390x|loong64/;

/** Delete node_modules/ entries unreachable from the boot anchors. */
function pruneUnreachable(runtimeDir) {
  const nm = join(runtimeDir, "node_modules");
  const template = join(runtimeDir, "home-template");
  const bridgeDir = join(runtimeDir, "bridge");

  // -- anchors: profile bundles + enabled rows + bridge entry --------------
  const anchors = new Set();
  const profileManifest = JSON.parse(readFileSync(join(template, "profiles/chinook/package.json"), "utf8"));
  for (const bundle of profileManifest.dsh.profile.bundles) anchors.add(bundle);

  const basePatch = readFileSync(join(nm, "@deepseek-ai", "dsh-base", "cordis.patch.yml"), "utf8");
  const profilePatch = readFileSync(join(template, "profiles/chinook/cordis.patch.yml"), "utf8");
  const disabledIds = new Set((profilePatch.match(/^\s*- id: (\S+)/gm) ?? []).map((s) => s.replace(/^\s*- id: /, "")));
  const baseRows = patchRows(basePatch);
  for (const [id, name] of baseRows) {
    if (!disabledIds.has(id)) anchors.add(name);
  }
  // Every row name the base patch can mount. Rows are loaded BY NAME from the
  // cordis patches (the enabled ones anchor the prune above); a row's package
  // must never re-enter through the manifest pass, or the kitchen-sink
  // `@deepseek-ai/dsh` app manifest would pull the whole disabled capability
  // surface (mcp/acp/pwsh/terminal/hooks/skills/…) back into the closure.
  const allRowNames = new Set(baseRows.map(([, name]) => name));
  console.log(`[stamp] prune anchors : ${anchors.size} (bundles + enabled rows)`);

  // -- reachability over the flat copy (Node walks up from each file) ------
  const keep = new Set();
  const queue = [];
  const drained = new Set();

  const addAnchor = (pkgName) => {
    // subpath names (row exports like "pkg/list-agents") anchor the package root
    pkgName = specRoot(pkgName);
    if (keep.has(pkgName)) return;
    const dir = join(nm, ...pkgName.split("/"));
    if (!existsSync(dir)) return;
    keep.add(pkgName);
    queue.push(dir);
  };

  const resolveDir = (fromDir, spec) => {
    // Node semantics: nearest <dir>/node_modules/<spec> walking upward.
    // exports-map subpaths ("pkg/stream") have no physical file at the
    // package root, so fall back to the package root dir when present.
    let d = fromDir;
    for (;;) {
      const full = join(d, "node_modules", ...spec.split("/"));
      if (existsSync(full)) return topEntryUnder(nm, full);
      const root = join(d, "node_modules", ...specRoot(spec).split("/"));
      if (existsSync(root)) return specRoot(spec);
      const parent = dirname(d);
      if (parent === d) break;
      d = parent;
    }
    return null;
  };

  const drain = (dir) => {
    if (drained.has(dir)) return;
    drained.add(dir);
    for (const spec of specifiersOfDir(dir)) {
      const hit = resolveDir(dir, spec);
      if (hit !== null) addAnchor(hit);
    }
  };

  for (const a of anchors) addAnchor(a);
  // bridge.mjs itself is not under node_modules; scan it from its own dir.
  // Static imports AND dynamic-literal resolves: the AgentRuntime install
  // anchor (@deepseek-ai/dsh) appears only as createRequire(...).resolve(...)
  // inside the bundle and must stay in the closure (see resolveLiteralSpecifiers).
  const bridgeFile = join(bridgeDir, "bridge.mjs");
  const bridgeText = readFileSync(bridgeFile, "utf8");
  for (const spec of [...bareSpecifiers(bridgeText), ...resolveLiteralSpecifiers(bridgeText)]) {
    const hit = resolveDir(bridgeDir, spec);
    if (hit !== null) addAnchor(hit);
  }
  while (queue.length > 0) drain(queue.pop());

  // -- manifest pass: loader packages resolve platform binaries and other
  //    native deps dynamically (sharp picks @img/sharp-<target> at runtime),
  //    so also keep every manifest-declared dep of a kept package — except
  //    native builds for foreign platforms, which this installer never runs.
  const depQueue = [...keep];
  while (depQueue.length > 0) {
    const name = depQueue.pop();
    const manifestPath = join(nm, ...name.split("/"), "package.json");
    if (!existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    } catch {
      continue;
    }
    for (const key of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const deps = manifest?.[key];
      if (deps === null || typeof deps !== "object") continue;
      for (const dep of Object.keys(deps)) {
        const root = specRoot(dep);
        if (keep.has(root) || !existsSync(join(nm, ...root.split("/")))) continue;
        // Row packages are patch-mounted, never manifest-loaded (see above).
        if (allRowNames.has(root)) continue;
        // landlock is a Linux-only sandbox helper — never usable on win32.
        if (root.includes("landlock")) continue;
        if (FOREIGN_PLATFORM.test(root)) continue;
        keep.add(root);
        depQueue.push(root);
      }
    }
  }
  // static imports of the newly kept manifest deps (fixpoint)
  for (;;) {
    while (queue.length > 0) drain(queue.pop());
    let added = false;
    for (const name of keep) {
      const dir = join(nm, ...name.split("/"));
      if (drained.has(dir)) continue;
      drain(dir);
      added = true;
    }
    if (!added) break;
  }

  // -- delete the rest ------------------------------------------------------
  const before = [];
  for (const top of readdirSync(nm)) {
    const full = join(nm, top);
    if (top.startsWith("@")) {
      for (const sub of readdirSync(full)) before.push(`${top}/${sub}`);
    } else {
      before.push(top);
    }
  }
  const dirSize = (dir) => {
    let total = 0;
    const stack = [dir];
    while (stack.length > 0) {
      const d = stack.pop();
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) stack.push(p);
        else total += statSync(p).size;
      }
    }
    return total;
  };
  let removedBytes = 0;
  let removed = 0;
  for (const name of before) {
    // Platform-variant packages (sharp/koffi/… native builds) resolve from the
    // loader's OWN nested node_modules, which only ever holds the installed
    // platform's build; a top-level flat copy of other targets is dead weight.
    if (keep.has(name) && !FOREIGN_PLATFORM.test(name)) continue;
    const dir = join(nm, ...name.split("/"));
    removed += 1;
    removedBytes += dirSize(dir);
    rmSync(dir, { recursive: true, force: true });
    // tidy now-empty scope dir
    const scope = dirname(dir);
    if (scope !== nm && readdirSync(scope).length === 0) rmSync(scope, { recursive: true, force: true });
  }
  console.log(
    `[stamp] prune keep     : ${keep.size} packages, removed ${removed} of ${before.length} (${(removedBytes / 1048576).toFixed(1)} MB freed)`,
  );
}

function main() {
  console.log("[stamp] repo root      :", REPO_ROOT);
  console.log("[stamp] runtime target :", RUNTIME_DIR);
  wipeAndMk(RUNTIME_DIR);

  // 1. node.exe — the sidecar interpreter (launched by Rust packaged_launch).
  const nodeExeDir = join(RUNTIME_DIR, "node");
  mkdirSync(nodeExeDir, { recursive: true });
  cpSync(process.execPath, join(nodeExeDir, "node.exe"));
  console.log("[stamp] node.exe       :", process.execPath);

  // 2. bridge bundle (build with apps/agent-bridge/build.mjs beforehand).
  const bridgeSrc = join(REPO_ROOT, "apps/agent-bridge/dist/bridge.mjs");
  if (!existsSync(bridgeSrc)) throw new Error(`bridge bundle missing at ${bridgeSrc}; run node apps/agent-bridge/build.mjs first`);
  const bridgeDir = join(RUNTIME_DIR, "bridge");
  mkdirSync(bridgeDir, { recursive: true });
  cpSync(bridgeSrc, join(bridgeDir, "bridge.mjs"));
  console.log("[stamp] bridge.mjs     :", statSync(bridgeSrc).size, "bytes");

  // 3. node_modules — dereferenced real-file dependency closure.
  const closure = collectClosure();
  const nmDir = join(RUNTIME_DIR, "node_modules");
  for (const [name, realDir] of [...closure].sort()) {
    const dest = join(nmDir, ...name.split("/"));
    mkdirSync(dirname(dest), { recursive: true });
    cpSync(realDir, dest, { recursive: true, dereference: true, force: true });
  }
  console.log("[stamp] closure        :", closure.size, "packages");

  // 4. home-template — the first-run DSH home image.
  const template = join(RUNTIME_DIR, "home-template");
  const dataDir = join(template, "data");
  const profileDir = join(template, "profiles", "chinook");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(profileDir, { recursive: true });

  // data/chinook.db — the read-only business fixture (validated by bootstrap).
  const chinookDb = join(REPO_ROOT, "data", "chinook.db");
  if (!existsSync(chinookDb)) throw new Error(`Chinook DB missing at ${chinookDb}`);
  cpSync(chinookDb, join(dataDir, "chinook.db"));

  // data/memory.db — schema-only (never carries development memory state).
  const Database = rootRequire("better-sqlite3");
  const db = new Database(join(dataDir, "memory.db"));
  const { MEMORY_SCHEMA } = rootRequire(join(REPO_ROOT, "plugins/chinook/lib/storage/memory.js"));
  db.exec(MEMORY_SCHEMA);
  db.close();

  // profiles/chinook — manifest + patch layers only (no node_modules: the
  // DSH boot heal regenerates links against the packaged closure above).
  for (const file of ["package.json", "cordis.yml", "cordis.patch.yml"]) {
    const src = join(REPO_ROOT, "profiles", "chinook", file);
    if (!existsSync(src)) throw new Error(`profile file missing at ${src}`);
    cpSync(src, join(profileDir, file));
  }

  console.log("[stamp] home-template  : data/ + profiles/chinook/");

  // 5. prune node_modules to the reachable boot closure (see above).
  pruneUnreachable(RUNTIME_DIR);

  console.log("[stamp] done.");
}

main();

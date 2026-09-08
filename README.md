# DSH Chinook Agent

A runnable **Chinook Music Store agent** on the DSH runtime — one agent core,
two presentation layers:

- **V1 CLI** — a thin REPL over the real DSH agent stack (`apps/cli/`);
- **Desktop V2** — a Windows desktop app (React + Fluent UI in WebView2 over a
  Tauri v2 Rust host) that talks to the **same** AgentRuntime through a Node
  JSONL transport bridge (`apps/agent-bridge/`).

The agent core scope is unchanged: one business plugin, one profile, no auth
frameworks, no vector DBs, no RAG, no second LLM. The full contracts live in
[`docs/DSH_CHINOOK_AGENT_V1_SPEC.md`](docs/DSH_CHINOOK_AGENT_V1_SPEC.md),
[`docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md`](docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md)
and
[`docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION_CONTRACT.md`](docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION_CONTRACT.md).

```
You > what jazz is popular right now?
Agent > (live streamed reply, backed by catalog tools)
```

## Architecture

Fixed shape: **Generic DSH Runtime + Chinook Business Plugin + Thin
Presentation** (CLI *or* Desktop bridge). Desktop V2 is a new presentation
layer — it never replaces the agent core.

| Layer | Where | Contents |
|---|---|---|
| DSH runtime | `node_modules/@deepseek-ai/*` (pinned `0.1.2-rc.1`) | Agent registry + agent loop, session persistence, LLM adapter, tool runtime, system prompt — **untouched** |
| Chinook profile | `profiles/chinook/` | Bundle composition (`@deepseek-ai/dsh-base` + `chinook-dsh-plugin`), cordis patch disabling everything V1 forbids (shell/fs/web/subagent/skill/goal tools, workflow, …) |
| Chinook plugin | `plugins/chinook/` | 7 tools, services, SQLite storage, demo identity, system-prompt section — the only Chinook business logic |
| Thin CLI | `apps/cli/` | REPL with `/new`, `/resume [id]`, `/exit`; boots the profile in-process |
| Desktop presentation | `apps/desktop/` (React + Fluent UI frontend, `src-tauri/` Rust host) + `apps/agent-bridge/` (transport-only JSONL bridge) | Windows app: WebView frontend → Tauri commands → one Node sidecar (bridge) over stdin/stdout JSONL → the same AgentRuntime. No agent business logic, no tool logic, no SQL here |
| Data | `data/chinook.db` (read-only business fixture, 3503 tracks) + `data/memory.db` (agent memory, auto-created) | |

The profile is booted with the same recipe as the `dsh` launcher
(`loadProfile` → module-fallback heal → `boot` → loader drain). The CLI uses
a project-local DSH home (`.dsh/`); the installed desktop app owns a per-app
home (`%APPDATA%\com.dsh.chinook\agent`) provisioned on first run from the
bundled home template — sessions and credentials never touch the user
profile directory.

### The seven tools

| Tool | Purpose | Account-bound |
|---|---|---|
| `search_catalog` | tracks/albums/artists/genres by keyword (`entity_type`, `limit`) | – |
| `find_similar_albums` | same-genre albums ranked by sales | – |
| `popular_in_genre` | best-selling tracks of a genre | – |
| `list_my_orders` | the customer's invoices, newest first | yes |
| `get_invoice_details` | invoice line items — **only own invoices** (`ACCESS_DENIED` otherwise) | yes |
| `remember` | save a fact about the customer | yes |
| `recall` | search remembered facts | yes |

No tool ever asks the model for a customer id: identity comes from the
`IdentityProvider` (`CHINOOK_CUSTOMER_ID` env, demo default customer 1), and
tools bound to an anonymous identity answer `IDENTITY_REQUIRED`. Results are
a structured `{ok, ...}` / `{ok:false, error:{code, message}}` JSON contract.

## Getting started

Prerequisites: **Node ≥ 22**, **pnpm**; for the desktop host additionally the
**Rust stable toolchain** (MSVC target) and **WebView2** (preinstalled on
Windows 10/11). No Node/pnpm is needed to *run* an installed desktop app — it
bundles its own Node.

```bash
pnpm install
pnpm bootstrap          # verify data/chinook.db, mirror .dsh/data, init memory DB, install profile
# provide a model key:
#   export DEEPSEEK_API_KEY=sk-...           (env wins)
#   # or ANTHROPIC_AUTH_TOKEN=sk-ant-...     (bridged to the DeepSeek-compatible endpoint)
pnpm chinook-agent      # or: pnpm dev
```

Inside the agent:

```
You > /new
Started new session: session-...
You > find me Queen albums
You > remember that I love jazz
You > list my orders
You > /resume          # list persisted sessions
You > /resume session-...   # continue one
You > /exit
```

A plain first prompt auto-starts a session. Memory persists across sessions
and processes (SQLite, not the session log); sessions persist as compressed
logs under `.dsh/sessions/`.

## Windows desktop app (Desktop V2)

Same profile, same seven tools, same sessions — a desktop presentation layer:
React + Fluent UI in a WebView2 window, a Tauri v2 Rust host that spawns
exactly one Node sidecar (the agent bridge) and routes a typed JSONL
protocol over stdin/stdout. The Rust host keeps no Chinook business logic and
the frontend never sees credentials.

### Configure the model key (env only)

Credentials never go into source, config, or git — keys are read from the
environment at runtime (`DEEPSEEK_API_KEY` or `ANTHROPIC_AUTH_TOKEN`, same
vars as the CLI). The desktop host forwards the required env to its sidecar;
the React frontend never receives a key. When launching an *installed* app,
set the variable in the shell you start it from.

### Run the desktop app in dev

```bash
pnpm install
pnpm bootstrap              # provisions .dsh — the dev home shared with the CLI
node apps/agent-bridge/build.mjs     # rebuild the bridge bundle (only when its src changed)
cd apps/desktop && node ../../node_modules/@tauri-apps/cli/tauri.js dev
```

`apps/desktop` intentionally has no `package.json` of its own: the tauri CLI
is the repo-root devDependency. Desktop dev uses the repo-bootstrapped
`.dsh/` home (same sessions and memory as the CLI) and system Node.

### Run the tests

```bash
pnpm test                    # vitest: V1 suites + bridge unit/integration + desktop reducer + agent e2e
cd apps/desktop/src-tauri && cargo test   # Rust host unit tests + real-sidecar integration
```

### Build the Windows installer

The release bundles its own Node runtime, the compiled bridge, the pruned
DSH dependency closure and a first-run home template, so an installed app
needs nothing else:

```bash
pnpm install
node apps/agent-bridge/build.mjs            # 1. compile bridge.mjs
node apps/desktop/scripts/stamp-runtime.mjs # 2. stamp src-tauri/runtime/ (node.exe + deps + home template)
node apps/desktop/scripts/pack-smoke.mjs    # 3. optional: real-turn smoke test of the stamped tree (needs a model key)
cd apps/desktop && node ../../node_modules/@tauri-apps/cli/tauri.js build
```

Find the installers in `apps/desktop/src-tauri/target/release/bundle/`:
`nsis/*-setup.exe` and `msi/*.msi`. Install the exe (or MSI), double-click —
first run provisions the per-app home at `%APPDATA%\com.dsh.chinook\agent`
from the bundled template and boots the agent automatically.

Implementation notes (runtime wiring, sidecar packaging, known constraints)
are recorded in
[`docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION.md`](docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION.md).

## Development

```bash
pnpm test               # bootstrap + V1 suites + desktop suites (unit, tools, architecture, e2e)
pnpm build              # typecheck all + compile the plugin to plugins/chinook/lib
pnpm chinook-agent      # run the CLI (tsx)
```

Layout notes:

- `plugins/chinook/src/` — the plugin, strictly layered:
  `tools → services → storage`; only storage touches SQLite.
- DSH Core is never modified; the root `package.json` depends on pinned
  `@deepseek-ai/dsh@0.1.2-rc.1` and its runtime packages.
- The plugin compiles for Node ESM (`NodeNext`) so the DSH loader can load
  it under plain Node; sources use explicit `.js` import specifiers.
- Database defaults resolve from `$DSH_HOME/data/` (bootstrap mirrors it to
  the repository `data/`) because the loader mounts plugins from pnpm's
  virtual store where package-relative anchors point nowhere.
- `apps/agent-bridge/src/` — bridge sources; `apps/agent-bridge/build.mjs`
  bundles them into `dist/bridge.mjs`. Bridge tests live in `tests/`.
- `apps/desktop/scripts/` — build-time tooling (`stamp-runtime.mjs`,
  `pack-smoke.mjs`, `cdp-drive.mjs` dev driver); none of it is shipped.

## Known limitations

- Identity is a demo env var, not an auth system (V2).
- No V2-of-the-agent features by design: no RAG/embeddings, no second LLM,
  no web/TUI. The desktop app is a presentation layer over the V1 agent
  core, not a new agent.
- Session history is not summarized; long sessions grow the log.
- Windows-specific convenience: `.dsh/` mirrors use directory junctions.

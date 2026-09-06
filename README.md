# DSH Chinook Agent V1

A runnable **Chinook Music Store agent** on the DSH runtime — a thin CLI over
the real DSH agent stack, one business plugin, one profile. V1 scope only:
no auth frameworks, no vector DBs, no RAG, no second LLM, no web/TUI. The
full contract lives in [`docs/DSH_CHINOOK_AGENT_V1_SPEC.md`](docs/DSH_CHINOOK_AGENT_V1_SPEC.md).

```
You > what jazz is popular right now?
Agent > (live streamed reply, backed by catalog tools)
```

## Architecture

Fixed V1 shape: **Generic DSH Runtime + Chinook Business Plugin + Thin CLI**.

| Layer | Where | Contents |
|---|---|---|
| DSH runtime | `node_modules/@deepseek-ai/*` (pinned `0.1.2-rc.1`) | Agent registry + agent loop, session persistence, LLM adapter, tool runtime, system prompt — **untouched** |
| Chinook profile | `profiles/chinook/` | Bundle composition (`@deepseek-ai/dsh-base` + `chinook-dsh-plugin`), cordis patch disabling everything V1 forbids (shell/fs/web/subagent/skill/goal tools, workflow, …) |
| Chinook plugin | `plugins/chinook/` | 7 tools, services, SQLite storage, demo identity, system-prompt section — the only Chinook business logic |
| Thin CLI | `apps/cli/` | REPL with `/new`, `/resume [id]`, `/exit`; boots the profile in-process |
| Data | `data/chinook.db` (read-only business fixture, 3503 tracks) + `data/memory.db` (agent memory, auto-created) | |

The profile is booted with the same recipe as the `dsh` launcher
(`loadProfile` → module-fallback heal → `boot` → loader drain), from a
project-local DSH home (`.dsh/`) so sessions and credentials never touch the
user profile directory.

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

## Development

```bash
pnpm test               # bootstrap + 7 test files (unit, tools, architecture, offline agent e2e)
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

## Known limitations (V1)

- Identity is a demo env var, not an auth system (V2).
- No V2 features by design: no RAG/embeddings, no second LLM, no web/TUI.
- Session history is not summarized; long sessions grow the log.
- Windows-specific convenience: `.dsh/` mirrors use directory junctions.

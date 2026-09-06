# DSH Chinook Desktop V2 — UI / UX / Interaction Specification

| | |
|---|---|
| Status | Ready for implementation |
| Product | DSH Chinook Desktop V2 (Windows-first desktop agent application) |
| Input contract | `docs/DSH_CHINOOK_DESKTOP_V2_UI_DESIGN_BRIEF.md` (frozen) |
| Implementation basis | Real repo state: DSH Chinook Agent V1 accepted (`docs/DSH_CHINOOK_AGENT_V1_SPEC.md`, `docs/DSH_CHINOOK_AGENT_V1_ACCEPTANCE.md`) |
| Scope | UI / UX / Interaction specification ONLY. No implementation (no Tauri app, no React pages, no Rust host, no Node bridge, no IPC) |
| Allowed project change | this file only |

---

## 0. How to read this spec

This document is the single source of truth for the Desktop V2 user
experience. A subsequent Autonomous Implementation Agent must be able to
build the UI **without making any product, layout, interaction, wording, or
state-model decision** on its own. Where a decision could go several ways,
this spec already picked one. Every section is written against the **actual
V1 implementation** (verified by read-only inspection), and §30 records every
place where the real runtime differs from an idealised assumption.

Terminology: “bridge” = the future Node Agent Bridge layer; “host” = the
future Tauri/Rust layer; “the agent” = the existing DSH + Chinook plugin
agent; “presentation event” = the normalized event that React consumes (never
a raw DSH type).

---

## 1. Product Definition

### 1.1 What it is

**Chinook Agent** — an agent-native Windows desktop assistant for the
Chinook digital music store. The product surface is one window: an assistant
that searches a real catalog, recommends music, reads real orders/invoices
with ownership security, and keeps long-term memory of the customer —
**showing the user, in order: user request → agent activity → tool calls →
real business data → streaming answer.**

The app must make the LLM→agent→tool→data→answer pipeline *visible* (Activity
UI), but the **assistant answer remains the visual subject**. Tool activity
is always secondary information.

### 1.2 What it is not

- Not a music store website with a chat box.
- Not an enterprise admin dashboard.
- Not a ChatGPT clone (no giant logo, no “clone conversation” pattern).
- Not a developer console by default.

### 1.3 Persona and voice

- Product language: **Simplified Chinese** (all static UI strings are fixed
  in §25; the agent's natural-language answers are produced by the model and
  typically follow the user's language).
- Tone: calm, brief, helpful. No emoji in static UI chrome; agent answers
  may contain emoji (model output is rendered as-is).
- Agent persona: “Chinook 音乐商店助手” — can search/discover music, knows the
  current customer's orders/invoices, remembers music taste. Never invents
  catalog or account data (this is enforced by the V1 system prompt; the UI
  must not undermine it by presenting tool failure as success).

### 1.4 Scope guard

One main window. One runtime. One active session. One active turn per
session (see §16.4). No login, no multi-user, no cloud, no shopping cart,
no payment, no multi-window, no web server, no RAG/vector DB, no MCP, no
plugin marketplace, no macOS support in V2 first release.

---

## 2. Design Principles

Decisions in this spec always resolved ties toward: **simpler → more
restrained → easier to implement → more agent-characteristic → more Windows
desktop**. Concretely:

1. **Agent first, chrome last.** The conversation column is the product;
   everything else recedes. Sidebar and drawer are quiet surfaces.
2. **Progress is narration, not internals.** “正在搜索音乐目录” is shown;
   model reasoning, raw JSON, and stack traces are never primary UI.
3. **One thing at a time.** A session runs one turn; the composer locks;
   session switching is disabled during a turn. Predictability beats power.
4. **Real data, honest states.** Tool success/failure renders from the
   structured `{ok, error}` contract — never inferred from prose.
5. **Restraint.** No gradients, no dashboards, no bouncing animations. One
   subtle accent color (§19.1). Motion 150–250 ms, functional only.
6. **Windows-native.** Fluent tokens, Segoe UI Variable, standard window
   behaviors, keyboard-first where it costs nothing.
7. **Streaming always.** The moment `assistant/chunk` arrives it must be
   visible; the UI never waits for a full answer (§14).

---

## 3. Information Architecture

```
Desktop window (single)
├── Title bar          brand · runtime status · activity entry · window controls
├── Main region
│   ├── Session sidebar      (grouped session list; collapsible on narrow windows)
│   └── Conversation area
│       ├── Turn column      (user bubble → turn activity → assistant bubble)
│       └── Composer         (locked/unlocked by turn state)
├── Activity drawer    (right; hidden by default; technical timeline of the active session)
└── Overlay states     (starting / disconnected / runtime error / restarting)
```

Navigation model: **no tabs, no back-stack**. Moving between sessions is a
sidebar selection; the top-level states (starting/disconnected/error) replace
the main region content with a centered state card (§16).

---

## 4. Main Window

### 4.1 Wireframe (annotated)

```
 ┌──────────────────────────────────────────────────────────────────────────┐
 │  ● Chinook Agent      [正在启动|已连接|正在恢复|已断开|错误]    [活动] [─][□][×] │  ← Title bar 40px
 ├──────────────┬───────────────────────────────────────────────────────────┤
 │              │                                                           │
 │  ＋ 新会话   │    (Conversation column, max width 760px, centered)      │
 │              │                                                           │
 │  ──────────  │    [user bubble]                                          │
 │  今天        │    [activity strip]                                       │
 │  • 帮我找…   │    [assistant streaming bubble ▍]                         │
 │  • 爵士乐…   │                                                           │
 │  ──────────  │                                                           │
 │  昨天        │                                                           │
 │  • 查看订单… │                                                           │
 │  ──────────  │    ┌──────────────────────────────────────────┐          │
 │  更早        │    │ [输入框……]                        [发送]  │ ← Composer │
 │              │    └──────────────────────────────────────────┘          │
 ├──────────────┴───────────────────────────────────────────────────────────┤
 │  ● Agent 已连接 · deepseek-v4-flash · 会话 已自动保存            (Status bar 28px)│
 └──────────────────────────────────────────────────────────────────────────┘
  <- 264px sidebar ->  <- fluid (>=584px) ->  [Activity drawer 360px, optional]
```

### 4.2 Window facts (frozen)

| Property | Value |
|---|---|
| Target first-screen size | 1050 × 700 (logical px, DPI-aware) |
| Minimum window size | 640 × 520 (enforced by host window config) |
| Default sidebar width | 264 px |
| Sidebar collapse threshold | window width < 900 px → sidebar auto-collapses to a 44 px rail of a single “新会话” icon button + expandable overlay panel; see §22 |
| Conversation column max width | 760 px (centered horizontally) |
| Conversation column min width | 0 (fluid down to window edge minus sidebar/rail) |
| Composer max width | 760 px (same column) |
| Activity drawer width | 360 px, overlay from the right edge, above content, below title bar |
| Status bar height | 28 px |
| Title bar height | 40 px |
| Windows | single window; no child windows |

### 4.3 Title bar (custom, drag region)

Contents, left to right:

1. **Brand** — accent dot (●, 8 px, §22 accent) + “Chinook Agent” in 14 px / 600 weight. The brand area is the window drag region.
2. **Runtime status badge** — a compact pill right of the brand (§16.1); copy strings in §25 (`status.*`).
3. **Activity entry button** — ghost icon button labelled “活动” (opens the drawer, §12). Present at all times; visually disabled (but still clickable, showing the drawer's own empty state) when the active session has no activity yet.
4. **Window controls** — standard minimize / maximize-restore / close glyph buttons on the right (host provides native behavior; hover states follow Fluent `subtle`). No macOS traffic-light aesthetics.

No navigation bar, no menu bar, no settings gear in V2 first release.

---

## 5. Session Sidebar

### 5.1 Structure

```
┌──────────────────────────┐
│ ＋ 新会话                 │  ← full-width secondary button, 36px, below padding
├──────────────────────────┤
│ 今天                      │  ← group label (12px, secondary)
│ • 帮我找 Queen 的专辑      │  ← SessionItem (active state if current)
│ • 爵士乐推荐              │
│ 昨天                      │
│ • 查看我的订单            │
│ 更早                      │
│ • 有没有黑胶唱片          │
└──────────────────────────┘
```

### 5.2 Sessions and titles (frozen rules)

- Session list source: bridge `session.list` (§26) — the real V1 persistence
  headers carry **no title** (constraint §30.4 #2), so the sidebar model is
  `{ sessionId, title, createdAt, isCurrent? }`.
- **Title rule**: title = first user message text of that session, trimmed,
  newlines collapsed to spaces, truncated at **24 characters** with `…`.
  A session with no user message yet shows “新会话”.
- Grouping rule: `今天` (local calendar day), `昨天`, `更早` — based on
  `createdAt`. Only non-empty groups render.
- Sort: newest first within a group; groups ordered 今天 → 昨天 → 更早.
- Each item shows title (body 14px/400, truncated) and a right-aligned time
  label (caption 12px, tertiary): today → `HH:mm`, else `MM-DD`.
- The active session item: neutral background token + 2px accent left bar or
  accent-tinted background (single visual treatment — spec picks: accent 8% 
  tinted background, no left bar), title in 600 weight.
- Hover: subtle neutral hover background; the row is a single button
  (accessible label: “打开会话：{title}”).

### 5.3 Behaviors

| Action | Behavior |
|---|---|
| Click inactive session | If no active turn: bridge `session.open(sessionId)` → loading state → conversation hydrates. If a turn is active: nothing happens, and the sidebar row is disabled with tooltip “请等待当前回答完成” (§16.5) |
| Click current session | no-op |
| 新建会话 | If no active turn: bridge `session.create` → sidebar item “新会话” appears and is selected. If a turn is active: disabled (same rule) |
| Keyboard | `↑`/`↓` move focus through session items; `Enter` opens focused; `Ctrl+N` new session (§23) |

### 5.4 Session switch loading state

On open, the current conversation area shows (under the existing header, in
the column) a centered inline loading block: spinner + “正在恢复会话…” until
the bridge returns the snapshot (§13). If open fails → §13 restore-failure card.

---

## 6. Conversation

### 6.1 Model

The conversation column renders a **vertical stack of turn blocks**. One
turn block = one user message + its agent turn (activity + assistant text).
Strictly chronological.

```
UserMessage
└── TurnBlock ── UserMessage
                 ├── TurnActivityStrip   (live or collapsed; see §11)
                 └── AssistantMessage    (streaming / complete / ended-abnormally)
```

Wireframe of an active turn (§10):

```
 ┌─────────────────────────────────────────────────────────────┐
 │ 我  (right-aligned bubble)                                  │
 │ 帮我找一些 Queen 的专辑。                                    │
 ├─────────────────────────────────────────────────────────────┤
 │ ◌ 正在搜索音乐目录                            ← running chip │
 ├─────────────────────────────────────────────────────────────┤
 │ (assistant bubble, appears at first text-delta)            │
 │ Chinook 的目录里有这几张 Queen 专辑：                        │
 │                                                            │
 │ Greatest Hits I … ▍        ← streaming text + caret        │
 └─────────────────────────────────────────────────────────────┘
```

### 6.2 User bubble

- Right-aligned; quiet accent-tinted bubble, text `colorNeutralForeground1`.
  Visual rule: a light warm tint over the page neutral — never a loud filled
  color. Implementation: one custom token `chinookUserBubbleBg` defined in
  theme.ts (light: `color-mix(in srgb, #C2410C 12%, colorNeutralBackground1)`;
  dark: `color-mix(in srgb, #FF9E73 18%, colorNeutralBackground1)`); if the
  installed Fluent theme's `colorBrandBackground2` already reads as that
  tint, use that token instead. The tint is the decision; the exact token is
  an implementation detail.
- Max width 70% of column; rounded corners 8 px with a 2 px tail corner on
  the right.
- Body 14px/22px; no markdown rendering in user messages (plain text,
  whitespace preserved, URLs shown as plain text).

### 6.3 Assistant bubble

- Left-aligned, no background (page background), full column width up to
  760 px — the answer is the visual subject.
- Rendered markdown (§15.4), body 14px/24px.
- A small provenance caption above the bubble while streaming (hide after
  first chunk once text flows; always shown when idle):
  `Chinook · 刚刚` — spec keeps provenance minimal: show `Chinook` in
  12px tertiary **only when the turn produced zero tool activity** (so the
  user always knows the source), otherwise the activity strip already names
  the source.
- Status footer under the text when the turn ended abnormally (§17.2).

### 6.4 Markdown rendering

Supported subset (implementation must use a lightweight renderer, e.g. a
small hand-rolled parser or `react-markdown` restricted by allowlist —
decision: allowlist config, no raw HTML, no images, no autolink
footnotes):

| Feature | Style |
|---|---|
| Paragraphs | spacing 8px between blocks |
| `#`–`###` headings | body 16/600, 14/600, 13/600, color foreground1, margin 12/8/4 |
| Bold / italic / inline code | 600 weight / italic / code face 13px `Consolas`, tinted background `NeutralBackground3` radius 3px, padding 0 4px |
| Bullet & numbered lists | compact; nested indentation 16px |
| Fenced code blocks | block in `NeutralBackground3` panel radius 6px, padding 8–10px, `Consolas` 12.5px, horizontal scroll if wider than column; **no syntax highlighting in V2 first release** |
| Tables | grid table, header row 600 weight, borders `SubtleBorder`, cell padding 6px 10px, 13.5px, wrapped in horizontal-scroll container |
| Blockquote | 2px accent-left border, foreground2, italic off |
| Anything else | ignored (never rendered raw) |

### 6.5 Message timestamps

Hovering a bubble (or focus) reveals `HH:mm` caption at its outer edge.
Never permanently printed per message (keeps the column calm).

---

## 7. Empty State (new session)

### 7.1 Wireframe

```
 ┌──────────────────────────────────────────────────────────────┐
 │                                                              │
 │                                                              │
 │                 ●  (accent dot, 40px, soft 16% halo)          │
 │                                                              │
 │              今天想听点什么？                                 │
 │                                                              │
 │   搜索音乐、获取推荐，或者查看你在 Chinook 的订单。              │
 │   数据来自真实目录，回答由 AI 助手一步步完成。                   │
 │                                                              │
 │   ┌──────────────────────┐  ┌──────────────────────────┐     │
 │   │ 🎵 帮我找 Queen 的专辑 │  │ 🎷 推荐一些爵士乐          │     │
 │   └──────────────────────┘  └──────────────────────────┘     │
 │   ┌──────────────────────┐                                   │
 │   │ 🧾 查看我的最近订单    │   ← three suggestion chips       │
 │   └──────────────────────┘                                   │
 │                                                              │
 │    (vertical centering within the scroll area;               │
 │     composer visible and enabled below)                      │
 └──────────────────────────────────────────────────────────────┘
```

### 7.2 Rules

- Appears when the active session has zero conversation items.
- Headline: **“今天想听点什么？”** (26px, 600). Sub-line:
  “搜索音乐、获取推荐，或者查看你在 Chinook 的订单。数据来自真实目录，回答由 AI
  助手一步步完成。” (14px, foreground2).
- Suggestion chips are real inputs, not decoration: clicking submits exactly
  the chip text (labels fixed — §25 copy table):
  1. `帮我找 Queen 的专辑` → demo flow 1 (§24.1)
  2. `推荐一些爵士乐` → catalog flow (`popular_in_genre` + `search_catalog`)
  3. `查看我的最近订单` → demo flow 4 (§24.4)
- Chip style: `Button appearance=secondary`, radius 6, padding 10/16,
  icon glyph optional per chip (🎵 🎷 🧾 glyphs as text, 14px — these are the
  only emoji allowed in chrome; they live in the empty state only).
- Layout: the block is vertically centered in the available area (not pinned
  to the top), horizontally centered. Gaps: headline→sub 8px, sub→chips 24px,
  chip row gap 10px.
- When a session switch restores content, empty state unmounts; it never
  flashes during restore (replace only after snapshot arrives).

---

## 8. Composer

### 8.1 Structure

```
 ┌─────────────────────────────────────────────────────────────┐
 │ 问点什么… (placeholder)                             [发送 ↗] │
 │                                                            │
 │ 输入 / 发送 · Enter 发送，Shift + Enter 换行   (hint line)    │
 └─────────────────────────────────────────────────────────────┘
```

Rendered as a rounded 10px panel (`NeutralBackground1`, 1px `SubtleBorder`),
with the textarea flush inside and the send button fixed in the bottom-right
corner of the panel.

### 8.2 States (frozen)

| State | Textarea | Send button | Hint line |
|---|---|---|---|
| Idle, empty | enabled, placeholder `问点什么…` | disabled | `Enter 发送，Shift + Enter 换行` |
| Idle, non-empty | enabled | enabled (accent filled) | as above |
| Turn active (sending) | **disabled** (locked, §16.4) | disabled, shows inline spinner glyph | `Agent 正在回答…` |
| No session / restoring | disabled | disabled | — |
| Runtime disconnected/error | disabled | disabled | — |
| Turn ended with error | enabled, text preserved | enabled | — |

### 8.3 Input rules

- Plain multi-line `textarea`, auto-grow 1 → 6 lines (then internal
  scroll). Enter = submit; Shift+Enter = newline (no IME conflicts: the
  browser/OS IME composition keydown events must not submit — guard with
  `e.nativeEvent.isComposing`).
- Trim on submit; empty-after-trim does not send. Max length 4000 chars
  (silent clamp; a `n/4000` counter caption appears only while the draft
  exceeds 3500 chars).
- During submission the text stays visible in the composer until
  `turn/start` confirms; then composer clears, text is locked into the
  conversation as the user bubble. If send fails before `turn/start`
  (transport error), text is restored and an error hint shows (§18.4).
- **No stop control (V2 first release)**: while a turn is active the
  composer carries no cancel/stop affordance and stays fully locked (§8.2)
  until `turn/end` (§16.4). The hint line reads `Agent 正在回答…`
  (`composer.sending`); nothing in the UI can interrupt a running turn.

### 8.4 Layout

Composer is pinned at the bottom of the conversation column (never floats
over content); 12px above it sits the “back to latest” affordance when
applicable (§15.2). Panel width = conversation column width (≤ 760 px).

---

## 9. Agent Activity (product states)

The bridge maps DSH events (§30.2) onto a small product vocabulary. The UI
only ever sees these presentation states — never raw reasoning or raw
stream chunks:

| Presentation phase | Trigger (bridge logic) | Copy (static) |
|---|---|---|
| `understanding` | `turn/start` received, no tool yet | `正在理解你的请求…` |
| `tool-running` | `tool/call` for tool T received | `正在{ToolName}…` (per-tool verbs §10.1) |
| `tool-done` | `tool/result` for T, `ok:true` | `✓ {已完成动作} {summary}` (§10.2) |
| `tool-error` | `tool/result` with `ok:false` | per code (§17.1) |
| `tool-business-denied` | `tool/result` `ok:false` + code `ACCESS_DENIED` | `! 无法访问该内容` (§17.1) |
| `streaming` | first `assistant/chunk` of the turn | (text streams; strip minimizes to one line `正在整理结果…`) |
| `turn-done` | `turn/end reason.completed` | strip collapses (§11.3) |
| `turn-stopped` | `turn/end reason.aborted` | `已停止` chip in strip footer |
| `turn-failed` | `turn/end reason.error` | error surface §18.3/§18.4 |
| `turn-limited` | `turn/end reason.max-tokens` | `回答达到长度上限` caption under bubble |
| `turn-interrupted` | `turn/end reason.interrupted` (crash-orphan resume) | `上次回答未完成` caption under bubble |

Rules:
- **No chain-of-thought, ever.** The bridge drops `reasoning-delta` chunks
  and reasoning blocks before they reach React (§30.6). “正在理解你的请求…”
  is a status, not a thought transcript.
- Multiple steps inside one turn (dsh `step/start`/`step/end`) are invisible
  to the conversation UI; tools and text accumulate into the single turn
  block until `turn/end`.

---

## 10. Tool Activity (productized display of the 7 tools)

### 10.1 Tool display metadata (frontend static config; wire protocol stays generic — §26.5)

| Tool (wire `name`) | UI verb (running → done) | Icon (Fluent glyph) | Role |
|---|---|---|---|
| `search_catalog` | 正在搜索音乐目录 → 已搜索音乐目录 | `Search` | 目录搜索 |
| `find_similar_albums` | 正在查找相似专辑 → 已查找相似专辑 | `Albums` | 音乐推荐 |
| `popular_in_genre` | 正在查询热门音乐 → 已查询热门音乐 | `MusicNote` | 音乐推荐 |
| `list_my_orders` | 正在查询订单 → 已查询订单 | `Receipt` | 订单 |
| `get_invoice_details` | 正在查询发票详情 → 已查询发票详情 | `Document` | 订单 |
| `remember` | 正在保存音乐偏好 → 已保存音乐偏好 | `Bookmark` | 记忆 |
| `recall` | 正在读取长期记忆 → 已读取长期记忆 | `History` | 记忆 |

Unknown tool names (future-proofing) fall back to verb `运行 {name}` /
`已完成 {name}` and a generic glyph `Code`.

### 10.2 Compact summary lines (done state)

Summaries derive from the generic result shape `{ok:true, count?, items?, …}`
by the rules below (frontend-side; keys verified against V1 payloads §30.3):

| Tool | Summary template | Notes |
|---|---|---|
| `search_catalog` | `找到 {count} 条结果` | when `entity_type=album` also render `找到 {count} 张专辑`; track→`首曲目`; artist→`位艺人`; genre→`个流派`; `all` → `条结果` |
| `find_similar_albums` | `推荐 {count} 张相似专辑` | |
| `popular_in_genre` | `{genre} 热门 · {count} 首` | genre verbatim from result |
| `list_my_orders` | `共 {count} 笔订单` | |
| `get_invoice_details` | `发票 #{invoiceId} · {lines} 条明细` | nested invoice object |
| `remember` | `已记住：{text 前 18 字}…` | text from `memory.text` |
| `recall` | `找到 {count} 条偏好记录` | items are memory rows |
| fallback | `操作完成` | |

### 10.3 Running/success/error/denied visuals

```
running           ◌ (spinner 14px, neutral)  正在搜索音乐目录 …
success           ✓ (check 14px, status-success color, subtle)  已搜索音乐目录 · 找到 5 条结果
error             ! (14px, status-danger)    code chip [ACCESS_DENIED] 无法访问该内容
```

All colors via Fluent semantic tokens (§19.1), never raw hex (three brand
stops excepted).

### 10.4 Detail (second layer)

Primary surface never dumps JSON. A tool row (or the collapsed strip, §11)
offers a text action `查看详情`. Expanding shows, per tool, a **detail
panel**:

```
┌───────────────────────────────────────────────────────────┐
│ ✓ 已搜索音乐目录 · 找到 5 条结果            [收起详情]      │
│ 参数   {"query":"Queen","entity_type":"album"}            │
│ 结果   { "ok": true, "count": 5, "items": [ … ] }         │
│ 耗时   1.2s    状态 成功                                   │
└───────────────────────────────────────────────────────────┘
```

Fields: 参数 (pretty JSON), 结果 (pretty JSON), 耗时 (`durationMs`, from
bridge), 状态 (成功 / code / 已停止). Code face 12.5px, pre-wrap, panel
background `NeutralBackground3`, max-height 240px scroll. The full technical
**timeline** (raw events incl. timing, error names) lives only in the
Activity Drawer (§12).

### 10.5 Wireframe — tool expanded in the conversation

```
 │ 帮我找一些 Queen 的专辑。
 ├───────────────────────────────────────────────┐
 │ ✓ 已搜索音乐目录 · 找到 5 条结果      [查看详情]│   ← collapsed row (alt)
 ├───────────────────────────────────────────────┤
 │ ✓ 已搜索音乐目录 · 找到 5 条结果      [收起详情]│   ← expanded
 │  参数 {...}  结果 {...}  耗时 0.9s            │
 └───────────────────────────────────────────────┘
 │ (assistant streaming text below)
```

---

## 11. Activity Timeline (lifecycle inside a turn)

### 11.1 Wireframe — active turn timeline

```
 ┌─────────────── user ───────────────┐
 │ 推荐一些爵士乐                      │
 ├─────────────────────────────────────┤
 │ ◌ 正在理解你的请求…      (0–600ms)   │   ← “understanding” line
 │ ✓ 已读取长期记忆 · 找到 1 条偏好记录  │
 │ ◌ 正在查询热门音乐 …                │   ← currently running
 │ (upcoming tools append below)      │
 ├─────────────────────────────────────┤
 │ (streaming answer …)  ▍            │
 └─────────────────────────────────────┘
```

Ordering rule: activity rows appear **above** the assistant bubble (the
bubble mounts at the first text chunk). Both stack chronologically.

### 11.2 Live rules

- Rows appear the instant `tool/call` arrives (name known immediately — the
  V1 loop emits `tool/call` with `name` + full `arguments` before executing).
- A running tool row shows the spinner + verb. On `tool/result`, the row
  flips to its done state and its summary fills in. Multiple rows can be
  present; only the newest may be running (V1 turns execute tools
  sequentially — one running at a time by construction).
- The understanding line is removed as soon as the first `tool/call`
  arrives, or at the first `assistant/chunk` if the turn never calls tools.

### 11.3 Collapse rule (turn end)

When `turn/end` (any reason) closes the turn, the strip **auto-collapses**
into one secondary line:

```
 │ 完成 · 使用 3 个工具                [展开]        ← click to expand
```

- Copy: reason `completed` → `完成 · 使用 {n} 个工具`; `aborted` →
  `已停止 · 使用 {n} 个工具`; error → `出错了 · 使用 {n} 个工具`.
- `n=0` → no strip at all.
- Expanded state re-opens rows exactly as they were (§10.4). Expand/collapse
  is per turn and sticky for the session lifetime (not persisted).
- Motion: height/opacity 150 ms ease (§21).

---

## 12. Activity Drawer

### 12.1 Purpose

Technical showcase / debug / interview-demo surface: the **raw normalized
event timeline** of the *active session*, replayable even after a session
reloads (from the hydrated snapshot).

### 12.2 Entry

- Title-bar ghost button `活动` (with a tiny dot indicator while a turn is
  running). Always clickable. Keyboard `Ctrl+Alt+A` toggles (§23).
- Never auto-opens. Drawer state is not persisted across app restarts.

### 12.3 Wireframe

```
 ┌─────────────── Title bar ─────────────┐
 │ 活动事件            [全部|工具]  [×]    │
 ├────────────────────────────────────────┤
 │ ┌ session-6393… · 今天 14:02          │
 │ │ turn/start    seq 41  0ms           │
 │ │ tool/call recall {…}                │   ← click row → expands raw
 │ │ tool/result recall ok 812ms         │
 │ │ tool/call search_catalog {…}        │
 │ │ tool/result search_catalog ok 1.2s  │
 │ │ assistant/chunk ×318  4.1s          │
 │ │ turn/end completed 4.3s             │
 │ └─────────────────────────────────────┘
 │ (older turns above; auto-scroll to the newest while a turn runs) │
 └────────────────────────────────────────┘
```

### 12.4 Rules

| Property | Decision |
|---|---|
| Width | 360 px fixed, overlay drawer from right edge, below title bar, above status bar |
| Backdrop | none, ever — the drawer overlays the conversation with only a 1px left border (`colorNeutralStroke2`) and never dims the live answer |
| Content | grouped per turn, newest at bottom; each row: event glyph + type + short payload summary |
| Row expansion | click row → raw payload panel (pretty JSON, code face); one row expanded at a time per turn |
| Filters | `全部 / 工具` segmented control (tools-only hides chunk/end rows) |
| Close | `×`, `Esc`, or clicking the title-bar 活动 button again |
| Empty | `暂无活动事件` centered, secondary |
| While a turn runs | rows stream in live; auto-scroll follows unless the user scrolled up (same rule as conversation, §15.2) |
| Content | events: `turn/start`, `tool/call`, `tool/result`, `assistant/chunk` (grouped as `assistant/chunk ×n`), `assistant/message` usage line when present, `turn/end {reason}`. Reasoning chunks are never present (bridge drops them). Raw error `{name, code}` shown for tool errors |

---

## 13. Session Resume UX

Flow and states:

```
Sidebar click
   │  bridge session.open(id)            ← any session, incl. the current one
   ▼
[loading]   conversation column center: spinner + “正在恢复会话…”
   │  bridge returns snapshot (items list, newest turn ordering)
   ▼
[restored]  items rendered; activity strips collapsed by default
            for turns > 0 (expandable); user scroll position at bottom
   │
   ▼
[ready]     composer enabled
```

| Situation | Behavior |
|---|---|
| Restore succeeds | history renders exactly as it was (user bubbles, assistant text, collapsed per-turn tool rows; timestamps `MM-DD HH:mm` for past sessions) |
| Restore fails (log corrupt / missing) | inline error card in the column: `会话恢复失败` + reason caption + buttons `重试` / `关闭`（关闭 → empty state of a new session created by the bridge） |
| Switch while a turn is active | blocked (§5.3/§16.5) |
| Session whose last turn crashed (`reason.interrupted` on hydrate) | last assistant bubble shows caption `上次回答未完成` (idle; composer unlocked) |
| Resume ordering of turns | full fidelity, oldest first; snapshot cap 200 turns (older ones summarized into a single non-expandable assistant note `…更早的 {n} 条消息已归档` — spec requires the bridge snapshot to include this synthetic item rather than raw truncation) |

---

## 14. Streaming UX

### 14.1 Rules

- Text is appended **per chunk** (`assistant/chunk`, text only). First chunk
  mounts the assistant bubble; every subsequent chunk updates it. Batched
  rendering: update at most once per animation frame (accumulate chunks,
  schedule `requestAnimationFrame` commit).
- The bubble stays mounted when chunks pause (between steps) — tool rows may
  appear while text waits.
- **Stream end** = `turn/end`. After it, no further mutation of that
  assistant item; if the turn ends with no text and no error (rare
  `blocked`), the bubble never mounts; the strip shows `未生成回答`.
- Cursor: while streaming, append a caret `▍` (accent color, 400 ms
  opacity blink). Remove at stream end or at user focus of the text (decision
  — remove at end; caret is a streaming cue only). `prefers-reduced-motion`
  → steady (non-blinking) caret.
- The renderer re-renders the full accumulated markdown per commit (§6.4).
- Errors/limits mid-stream: keep the partial text visible; never replace it
  with an error page (§17).

### 14.2 Wireframe — first chunk

```
 │ ◌ 正在查询订单 …
 │ (bubble appears here at the first text chunk)
 │ Chinook 的目录里有这几张 Queen 专辑：
 │ Greatest Hits I · Greatest Hits II▍
```

---

## 15. Auto Scroll

### 15.1 Rules (frozen)

| Condition | Behavior |
|---|---|
| User is at/near bottom (≤ 80 px from scroll end) | new content (chunks, tool rows, new turn) auto-scrolls the container to bottom (instant during streaming; 200 ms smooth only for structural inserts such as a new turn block) |
| User scrolled up beyond the threshold during an active stream | auto-follow stops; no forced scrolling |
| User scrolls back to the threshold | auto-follow resumes immediately |
| New user message is sent | always scroll to bottom (the send is a deliberate intent) |
| Session switch / restore | scroll to bottom instantly after first paint |

### 15.2 “Back to latest” affordance

A floating pill, bottom-center of the column, 8 px above the composer panel:

```
          ┌─────────────────────────┐
          │ ↓ 回到最新消息            │
          └─────────────────────────┘
```

- Appears only when auto-follow is off **and** new content arrived since.
- Click → scroll to bottom (instantly), hide pill, auto-follow resumes.
- Pill style: `NeutralBackground1` + border, radius 999, 13px, subtle
  shadow; keyboard focusable.

---

## 16. Runtime States & Turn Locking

### 16.1 Desktop runtime states

| State | Meaning | Surface |
|---|---|---|
| `starting` | bridge/host booting agent | status badge `正在启动…`; main region = centered card: spinner + `正在启动 Chinook Agent…` |
| `ready` | agent connected, idle | badge `● Agent 已连接` (accent dot); content usable |
| `busy` | a turn is active | **not a badge** — expressed by composer lock + activity strip + status-bar right text `Agent 正在回答…` |
| `restoring` | session open in progress | badge `正在恢复…` (§13) |
| `disconnected` | sidecar exited / IPC lost | badge `已断开`; main region = center card `Agent Runtime 已断开` + `[重新连接]`; composer disabled |
| `error` | boot/agent fatal error | badge `错误`; center card with user-readable message + `[重新启动]` (+ `查看详情` accordion for the raw message, code face) |
| `restarting` | reconnect/restart in flight | badge `正在重新启动…`; card shows spinner |

### 16.2 Disconnected wireframe

```
 ┌──────────────────────────────────────────────┐
 │                                              │
 │                    Agent Runtime 已断开       │
 │               与 Agent 的连接意外中断。        │
 │          你的会话已保存在本机，不会丢失。       │
 │                                              │
 │              ┌──────────────┐                │
 │              │ 重新连接      │                │
 │              └──────────────┘                │
 │                                              │
 │      (sidebar still visible; rows disabled)   │
 └──────────────────────────────────────────────┘
```

Rules: this surface is a **state card inside the main region** (not a modal,
not an error dialog). 重新连接 → `restarting` → `ready` or back to `error`
(card stays with a caption `重试失败，请稍后再试` if the second attempt
fails). Never show Rust/Node stack traces to the user here.

### 16.3 Error card wireframe (runtime)

```
 │                   出问题了
 │        Agent 无法启动：无法加载会话数据。
 │   ┌────────────────────────────────────────────┐
 │   │ 查看详情 (raw message, code face)          │
 │   └────────────────────────────────────────────┘
 │              [重新启动]
```

### 16.4 Turn lock (single active turn)

- The V1 runtime is strictly single-turn per session (§30.4 #8). The UI makes
  this a product rule: `turn/start` → composer lock; `turn/end` → unlock.
  A second send attempt is impossible (composer disabled) — the bridge also
  rejects `turn.send` while a turn is pending with code `TURN_ACTIVE` (UI
  shows nothing; the lock already prevented it).
- Stream end (`turn/end`) always unlocks, even on error/abort.
- **No cancel in V2 first release**: no stop/cancel control exists anywhere
  in the desktop UI; a turn ends only when the runtime finishes it
  (`turn/end`, any reason). `aborted` / `interrupted` reasons are rendered
  read-only when a historic session or the runtime itself produced them
  (§9/§17.2) — they never imply any user-initiated cancel capability.

### 16.5 Session-switch lock

While a turn is active: session rows and 新建会话 are disabled
(tooltip §5.3). This prevents flushing/tearing a live session — matches the
runtime, which flushes the current session when another is opened.

### 16.6 Status bar (bottom, 28 px)

Left: runtime dot + short status text (`Agent 已连接`). Right: context info
when available — `deepseek-v4-flash · 会话已自动保存`. Busy → right text
`Agent 正在回答…`. The status bar is quiet chrome; never a second control
center.

---

## 17. Error Model

Two disjoint families (§20 of the brief), presented differently and never
mixed:

### 17.1 Business errors (agent/tool domain)

Arrive as `tool/result` with `ok:false` → tool row error state (§10.3/§10.4)
plus the assistant's own natural-language handling (V1 prompt already tells
the agent to explain politely — e.g. invoice ACCESS_DENIED). The conversation
shows the assistant's explanation as normal content; the tool row carries
the structured code. **No red page, no modal.**

Presentation mapping for the known codes (Chinese caption on the tool row;
raw message shown only in detail/drawer):

| Code | Caption on tool row | Detail panel message |
|---|---|---|
| `ACCESS_DENIED` | `! 无法访问该内容` | “请求被拒绝：该发票/数据不属于当前账户” + raw message below (code face) |
| `IDENTITY_REQUIRED` | `! 需要客户身份` | “当前没有客户身份，账户与记忆工具不可用（运行环境未配置 CHINOOK_CUSTOMER_ID）” |
| `NOT_FOUND` | `! 未找到相关数据` | raw message |
| `INVALID_ARGUMENT` | `! 请求参数无效` | raw message |
| `DATABASE_ERROR` / `MEMORY_ERROR` | `! 数据服务异常` | raw message |
| unknown code | `! 操作失败` | raw message |

Note for the implementer: V1 tool result messages are English agent-facing
strings; the **presentation copy above is fixed Chinese** and does not
translate them; raw strings appear only in the technical second layer.

### 17.2 Runtime errors (host domain)

| Failure | Surface | Recovery |
|---|---|---|
| Bridge boot fails | §16.3 card | 重新启动 |
| IPC/channel broken mid-run | §16.2 disconnected card | 重新连接 |
| Turn transport failure (send never reached bridge) | composer hint `发送失败，请重试` + text restored | resend |
| Turn fails inside agent (`turn/end reason.error`) | conversation-level: strip `出错了 · 使用 n 个工具`; if text already streamed, bubble keeps partial text + caption `回答中断`; if no text at all, an inline row under the strip: `回答生成失败` + code caption (`LlmFailure` code when the bridge supplies it, else `未知错误`) | composer unlocks; retry by sending again |
| Session restore fails | §13 inline card | 重试 / 关闭 |

`turn/end reason.max-tokens` → caption `回答达到长度上限` (partial text
kept). `reason.aborted` → read-only compatibility state (historic session or
runtime-produced only; V2 first release never initiates it): strip `已停止` +
bubble caption `已停止生成`. `reason.blocked` → strip `未生成回答`.

---

## 18. Light / Dark Theme

- Mode source: `Follow System` (host/OS). No settings page, no in-app
  toggle in V2 first release (development-only toggle allowed in the
  frontend via `FluentProvider` override).
- Implementation: single `FluentProvider` themed `web-light` / `web-dark`
  per `matchMedia('(prefers-color-scheme: dark)')`, listening to changes.
- Mica/Acrylic: **optional polish, out of first-release acceptance**; spec
  allows window `Mica` backdrop only behind a fallback solid
  `colorNeutralBackground1` when unavailable. If used, content surfaces must
  stay opaque tokens.

---

## 19. Visual Design (color)

### 19.1 Tokens

Use Fluent semantic tokens for everything. The full palette is the Fluent
`web-light`/`web-dark` theme with these overrides only:

| Purpose | Token (light / dark) |
|---|---|
| Window background (conversation column) | `colorNeutralBackground1` |
| Sidebar background | `colorNeutralBackground2` |
| Panels (drawer, composer, detail, tool rows) | `colorNeutralBackground1` on 2 where it sits above |
| Borders | `colorNeutralStroke1` (subtle), `colorNeutralStroke2` for separators |
| Primary text | `colorNeutralForeground1` |
| Secondary text | `colorNeutralForeground2` |
| Tertiary/captions | `colorNeutralForeground3` |
| Disabled | `colorNeutralForegroundDisabled` |
| Accent (Chinook) | `colorBrandBackground` = **one brand ramp override** “Chinook Warm” (#C2410C light / #FF9E73 dark active tones; ramp definition below) |
| Tool success | `colorStatusSuccessForeground1` (+`colorPaletteGreenBackground2` tint for filled checks) |
| Tool error | `colorStatusDangerForeground1` (+ tint `colorPaletteRedBackground2`) |
| Info / running | `colorNeutralForeground2` (no blue “info” everywhere) |

Brand ramp (define once in the design-token module; no other hex in code):
`#C2410C` (base), light hover `#A3360A`, dark active `#FF9E73`. Accent usage
budget: brand dot, active-session tint, send button filled state, links-in-
markdown, streaming caret, status-badge “已连接” dot. Everything else neutral.

### 19.2 Forbidden

Gradients, glassy panels, glow, “enterprise blue”, per-message rainbow
coloring, saturated dashboard cards.

---

## 20. Typography & Spacing

### 20.1 Type scale (frozen)

Font stack: `"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI",
system-ui, sans-serif`. Code: `"Cascadia Code", Consolas, monospace`.

| Role | Size / weight / line | Fluent alias |
|---|---|---|
| Empty-state headline | 26 / 600 / 36 | `fontSizeHero800` (visual) |
| Conversation body (assistant text) | 14 / 400 / 24 | `fontSizeBase300` |
| User bubble | 14 / 400 / 22 | `fontSizeBase300` |
| Bubble provenance | 12 / 400 / 16 | `fontSizeBase200` |
| Tool strip rows | 13 / 400 / 18 | `fontSizeBase200`+ |
| Tool strip captions (展开/查看详情) | 12 / 400 | `fontSizeBase200` |
| Sidebar session title | 14 / 400 | `fontSizeBase300` |
| Sidebar group label | 12 / 600, `colorNeutralForeground3`, letter-spacing 0.2px | caption |
| Section titles (drawer) | 12 / 600 uppercase-ish (no letterspacing tricks; plain) | — |
| Composer text | 14 / 400 / 20 | `fontSizeBase300` |
| Hint/caption line | 12 / 400 / 16 | `fontSizeBase200` |
| Code / technical detail | 12.5 / 400 / 18 | `fontFamilyMonospace` |
| Status bar | 12 / 400 | `fontSizeBase200` |
| App title (title bar) | 14 / 600 | — |

Numbers/labels: `HH:mm` uses tabular figures where trivial (no extra dep).

### 20.2 Spacing scale (4 px grid)

| Token | px | Typical use |
|---|---|---|
| `sp1` | 4 | icon–text in chips; inline code padding |
| `sp2` | 8 | vertical rhythm between captions; tool-row internal gap |
| `sp3` | 12 | bubble padding small; group label margins |
| `sp4` | 16 | column horizontal padding; card padding |
| `sp5` | 24 | between turn blocks (the dominant vertical rhythm) |
| `sp6` | 32 | empty-state gaps; drawer section margins |
| `sp7` | 40 | empty-state centering breathing room |

Conversation column padding: 24 px horizontal / 16 px top / 16 px bottom.
Bubble horizontal padding 12/16; bubble corner radius 8 (user), assistant
text no bubble chrome. Tool rows radius 6. Panels radius 10 (composer),
8 (detail/drawer cards). Border 1px `colorNeutralStroke1` everywhere a
border exists; no heavy borders.

---

## 21. Motion

| Use | Spec |
|---|---|
| Tool row state flip | 150 ms opacity/color cross-fade (no transform) |
| Strip collapse/expand | 200 ms height+opacity ease-out |
| Drawer open/close | 200 ms translateX + opacity ease-out |
| Streaming caret | 400 ms opacity blink; **disabled** under `prefers-reduced-motion` (steady caret) |
| Session switch fade | 150 ms opacity 0.4→1 on the conversation container |
| Back-to-latest pill | 150 ms opacity |
| Everything else | none |

No spring physics, no stagger, no particle/confetti, no infinite loop
animations except the running spinner.

---

## 22. Responsive Behavior

| Window width | Behavior |
|---|---|
| ≥ 1050 | sidebar 264 + fluid column + optional drawer 360 |
| 900 – 1049 | same (sidebar collapsible via rail toggle still available) |
| 640 – 899 | sidebar auto-collapses: 44 px rail with `＋` icon button; open → 264 px overlay panel above content with scrim; close on selection or Esc |
| < 900 with drawer | drawer overlays full content width (360 px still) |
| Height < 700 | sidebar/column scroll independently; composer stays pinned; title/status bars fixed |
| Any | conversation column centers; content never scales text with window size (no `zoom` on the app) |

Minimum window 640×520 enforced by the host. Width thresholds apply to the
window *content* width.

---

## 23. Accessibility

Minimum bar (no enterprise WCAG audit in this phase):

1. **Keyboard navigation order**: Title bar controls → sidebar → conversation
   (turn blocks read-only; focus moves into the scroll container? no — focus
   stays on chrome; conversation is not focusable as a whole) → composer.
   Tab order exactly that; no traps.
2. **Shortcuts** (Windows): `Enter` send, `Shift+Enter` newline,
   `Ctrl+N` 新会话, `Esc` close drawer / close sidebar overlay,
   `Ctrl+Alt+A` toggle 活动 drawer, `↑/↓` in sidebar list (when sidebar has
   focus). There is no help page in V2; the list above is documented in this
   spec, and the composer hint line (§8.2) is the only in-app documentation.
3. **Focus visible**: Fluent focus rings (`:focus-visible`) on all controls;
   never suppressed.
4. **Roles/labels**: conversation container `role="log"` +
   `aria-label="会话内容"` with `aria-live="polite"` applied to the *last*
   assistant bubble only while streaming (`aria-atomic=false`); do not
   announce every chunk — announce per ~300ms or per sentence-end is
   over-engineered: decision = set `aria-live="polite"` on the streaming
   bubble container and let the SR coalesce; on turn end remove live.
   Tool strips: `aria-hidden="true"` for the whole activity area **unless**
   it ends in error, in which case an `role="status"` line
   `出了错：{caption}` is announced once.
   Buttons/labels: every icon button has `aria-label` (发送消息, 新建会话,
   打开活动, 收起详情, 回到最新消息, 关闭). Session rows announce
   `{title}，{group}`.
5. **Contrast**: Fluent default tokens satisfy AA in both themes; do not
   lighten secondary text below `colorNeutralForeground2`.
6. **Reduced motion**: §21.
7. **Text scaling**: body/UI at 100–200% system text scale must not clip
   (avoid fixed heights on bubbles/tool rows; use min-height).
8. **IME**: Enter guard during composition (§8.3).

---

## 24. Demo Flows (acceptance scripts)

Each demo lists the exact user input, the expected presentation event
sequence, and the visible UI states. These scripts are also the manual
acceptance test (§31).

### 24.1 Demo 1 — 帮我找一些 Queen 的专辑。

```
You > 帮我找一些 Queen 的专辑。
```
Events: `turn/start` → `tool/call search_catalog {query:"Queen", entity_type:"album"}` → `tool/result ok count:5` → `assistant/chunk ×n` → `turn/end completed`.

UI moments:
1. composer locks; strip: `正在理解你的请求…`
2. strip row: spinner `正在搜索音乐目录 …`
3. row done: `✓ 已搜索音乐目录 · 找到 5 张专辑` (entity_type=album → 张专辑)
4. assistant bubble streams the answer text (Queen album list)
5. strip collapses: `完成 · 使用 1 个工具`; composer unlocks.
Accept: sidebar first row of current session titled `帮我找一些 Queen 的专辑`.

### 24.2 Demo 2 — 记住我喜欢爵士乐。

Events: `turn/start` → `tool/call remember {fact:"我喜欢爵士乐"}` → `tool/result ok` → text → end.

UI: row `正在保存音乐偏好 …` → `✓ 已保存音乐偏好` (remember summary shows text prefix) → collapsed `完成 · 使用 1 个工具`.

### 24.3 Demo 3 — 新会话提问你记得我喜欢什么音乐吗？

Requires Demo 2 executed in the same identity (V1 memory is customer-scoped,
persists across sessions).

1. 新建会话 → empty state appears.
2. Send `你记得我喜欢什么音乐吗？`
3. Events: `recall` (maybe 1–2 calls) → text mentions 爵士乐.
4. UI must show `✓ 已读取长期记忆 · 找到 1 条偏好记录` **before** the
   answer streams — memory is visibly an agent action, not an invisible
   database read.
Accept: answer text refers to 爵士乐 and the recall tool row shows a hit.

### 24.4 Demo 4 — 查看我的订单。

Events: `list_my_orders` → ok (`count:7`, V1 fixture customer 1) → text
answer rendering the order list (markdown table).

UI: `✓ 已查询订单 · 共 7 笔订单`; answer table readable; strip collapses.
Accept: table content equals V1 invoice ids 382/327/316/195/143/121/98 when
run under the default demo identity (CHINOOK_CUSTOMER_ID=1).

### 24.5 Demo 5 — 访问非本人的发票。

User sends `帮我查一下 1 号发票的详情。` (invoice 1 belongs to another
customer).

Events: `tool/call get_invoice_details {invoice_id:1}` → `tool/result
{ok:false, error:{code:"ACCESS_DENIED"}}` → assistant polite explanation →
`turn/end completed`.

UI moments (must NOT be a scary red page):
1. row error state: `! 无法访问该内容` (code chip ACCESS_DENIED in detail)
2. assistant text streams the refusal explanation in normal prose
3. strip: `完成 · 使用 1 个工具`（business denial is a completed turn）.
Accept: no modal, no red page, no raw JSON in the primary surface.

### 24.6 Demo 6 (engineering) — resume + drawer

Resume Demo 1's session from the sidebar: conversation restores with the
collapsed strip; open 活动 drawer: rows for the session show tool/result of
search_catalog; expand row → JSON arguments/result identical to V1 payload
shape `{"ok":true,...}`.

---

## 25. Copy (Chinese, fixed)

Static UI strings (implementation MUST use these exact strings; a single
`copy.ts` module in the frontend):

| Key | String |
|---|---|
| app.title | Chinook Agent |
| empty.headline | 今天想听点什么？ |
| empty.sub | 搜索音乐、获取推荐，或者查看你在 Chinook 的订单。数据来自真实目录，回答由 AI 助手一步步完成。 |
| empty.chip.queen | 帮我找 Queen 的专辑 |
| empty.chip.jazz | 推荐一些爵士乐 |
| empty.chip.orders | 查看我的最近订单 |
| newSession | 新会话 |
| composer.placeholder | 问点什么… |
| composer.hint | Enter 发送，Shift + Enter 换行 |
| composer.sending | Agent 正在回答… |
| composer.sendFailed | 发送失败，请重试 |
| composer.counter | {n}/4000 |
| sidebar.group.today | 今天 |
| sidebar.group.yesterday | 昨天 |
| sidebar.group.earlier | 更早 |
| sidebar.untitled | 新会话 |
| sidebar.switchLocked | 请等待当前回答完成 |
| activity.button | 活动 |
| activity.empty | 暂无活动事件 |
| activity.filter.all | 全部 |
| activity.filter.tools | 工具 |
| understanding | 正在理解你的请求… |
| strip.done | 完成 · 使用 {n} 个工具 |
| strip.stopped | 已停止 · 使用 {n} 个工具 |
| strip.failed | 出错了 · 使用 {n} 个工具 |
| strip.expand | 展开 |
| strip.collapse | 收起 |
| strip.noAnswer | 未生成回答 |
| detail.open | 查看详情 |
| detail.close | 收起详情 |
| detail.args | 参数 |
| detail.result | 结果 |
| detail.duration | 耗时 |
| detail.status | 状态 |
| detail.statusOk | 成功 |
| bubble.caption.limited | 回答达到长度上限 |
| bubble.caption.stopped | 已停止生成 |
| bubble.caption.interrupted | 上次回答未完成 |
| bubble.caption.failed | 回答中断 |
| scroll.backToLatest | 回到最新消息 |
| restore.loading | 正在恢复会话… |
| restore.failed | 会话恢复失败 |
| restore.retry | 重试 |
| restore.close | 关闭 |
| archive.older | …更早的 {n} 条消息已归档 |
| status.starting | 正在启动… |
| status.ready | Agent 已连接 |
| status.restoring | 正在恢复… |
| status.disconnected | 已断开 |
| status.error | 错误 |
| status.restarting | 正在重新启动… |
| status.busy | Agent 正在回答… |
| status.model | deepseek-v4-flash · 会话已自动保存 |
| card.starting.title | 正在启动 Chinook Agent… |
| card.disconnected.title | Agent Runtime 已断开 |
| card.disconnected.sub | 与 Agent 的连接意外中断。你的会话已保存在本机，不会丢失。 |
| card.disconnected.action | 重新连接 |
| card.error.title | 出问题了 |
| card.error.action | 重新启动 |
| card.error.retryFailed | 重试失败，请稍后再试 |
| tool.* | §10.1 verbs and §10.2 summaries (also in copy module) |
| err.tool.accessDenied | 无法访问该内容 |
| err.tool.identityRequired | 需要客户身份 |
| err.tool.notFound | 未找到相关数据 |
| err.tool.invalidArgument | 请求参数无效 |
| err.tool.data | 数据服务异常 |
| err.tool.unknown | 操作失败 |
| err.turn.generation | 回答生成失败 |
| err.turn.unknown | 未知错误 |
| provenance.assistant | Chinook |

---

## 26. Presentation Event & Request Model (wire contract for React ↔ bridge)

Frozen now; the future host/bridge transport (Tauri commands/channels +
stdin/stdout JSONL) implements exactly this. **Generic agent presentation
protocol — no Chinook-specific event types** (no `queen_result`,
`invoice_ui`, …).

### 26.1 Message envelope

```ts
interface Envelope {
  protocolVersion: 1;
  requestId?: string;      // present on requests and their responses
  sessionId?: string | null;
  turnId?: number | null;  // dsh turn number within the session
  seq: number;             // per-session dsh event seq, else presentation counter
  type: string;            // see §26.2–26.3
  data: unknown;           // JSON-serializable payload
}
```

### 26.2 Requests (request/response; future Tauri Commands)

| Request | Payload | Response data |
|---|---|---|
| `session.list` | — | `{ sessions: SessionSummary[] }` |
| `session.create` | — | `{ sessionId }` (+ emits `session/opened`) |
| `session.open` | `{ sessionId }` | `{ session: SessionSummary, items: ConversationItem[], log: TimelineRow[] }` (log = §28.1 rows for the drawer, §12) |
| `agent.status` | — | `{ status }` |
| `agent.restart` | — | emits `runtime/status` events |
| `turn.send` | `{ sessionId, text }` | `{ accepted: true }`; errors `TURN_ACTIVE`, `NOT_READY` |

Error response shape (uniform): `{ ok:false, error:{ code, message } }` —
mirrors the V1 tool contract deliberately.

### 26.3 Events (streaming; future Tauri Channel)

```ts
type RuntimeStatusEvent      = { status: 'starting'|'ready'|'restoring'|'disconnected'|'error'|'restarting'; detail?: string };
type SessionListEvent        = { sessions: SessionSummary[] };            // full replace
type SessionOpenedEvent      = { session: SessionSummary, items: ConversationItem[] };
type SessionCreatedEvent     = { session: SessionSummary };               // title may update later
type SessionTitleUpdatedEvent= { sessionId, title };                      // after first user message
type TurnStartEvent          = { userText: string };
type ToolCallEvent           = { turnId, tool: { name, arguments: Record<string,unknown>, callId } };
type ToolResultEvent         = { turnId, tool: { name, callId, durationMs, ok: boolean, error?: {code,message}, result?: unknown } };
type AssistantChunkEvent     = { turnId, text: string };                  // text only; bridge dropped reasoning
type AssistantMessageEvent   = { turnId, text, usage?: {…}, interrupted?: boolean };  // terminal text of a step
type TurnErrorEvent          = { turnId, code, message };                 // from reason.error LlmFailure
type TurnEndEvent            = { turnId, reason: 'completed'|'aborted'|'blocked'|'error'|'max-tokens'|'interrupted' };
```

Ordering guarantee: within a session, events arrive in dsh log order
(`turn/start` → zero or more `tool/call`+`tool/result` → `assistant/chunk`* →
`assistant/message` → `turn/end`). `turn/error` precedes its `turn/end`.

### 26.4 Session & item shapes (React-consumable; no DSH types)

```ts
interface SessionSummary { sessionId: string; title: string; createdAt: number; messageCount?: number; }

type ConversationItem =
  | { kind: 'user'; id: string; text: string; ts: number }
  | { kind: 'assistant'; id: string;          // `${sessionId}:${turnId}`
      text: string; ts: number; status: 'complete'|'stopped'|'failed'|'limited'|'interrupted'|'no-answer';
      tools: ToolActivity[];                  // ordered per turn; empty when none
      archived?: { olderCount: number } };

interface ToolActivity {
  name: string;            // wire name (search_catalog, …)
  callId: string;
  arguments: Record<string, unknown>;
  ok: boolean;
  error?: { code: string; message: string };
  durationMs?: number;
  result?: unknown;        // parsed structured result (or raw JSON string)
  ts: number;
}
```

React imports *only* these types (+ the event types above) from a shared
presentation module — never from `@deepseek-ai/*`.

### 26.5 Where per-tool product language lives

Tool display metadata (names, verbs, glyphs, summary templates, §10.1/§10.2)
is **frontend static configuration keyed by tool name**, applied over the
generic `ToolActivity` shape. Unknown tools degrade to the generic verb +
`result` raw view. The wire protocol itself never carries Chinook-flavored
fields (arguments/result JSON is opaque to the wire).

---

## 27. React Component Architecture (frozen)

The tree below is the ceiling for V2 first release — do not add another
abstraction layer (no `Page`/`View` shells, no HOC or render-prop layers, no
separate UI-kit package beyond the primitives noted). The implementer may
inline trivial markup, but every named node owns a distinct responsibility
and must exist as a component.

```
App
└── <AppStateProvider>                     §28 store (useReducer + Context)
    └── <FluentProvider> + <ThemeHost>     webLight/webDark per system (§18)
        └── DesktopShell                   3-row grid: TitleBar / MainRegion / StatusBar
            ├── TitleBar                   brand (drag region) · RuntimeStatusBadge ·
            │                              ActivityEntryButton · WindowControls
            ├── MainRegion                 RuntimeStateCard (starting/disconnected/error/
            │                              restarting only) OR content split:
            │   ├── SessionSidebar         264 px; rail variant at < 900 px (§22)
            │   │   ├── NewSessionButton
            │   │   └── SessionList
            │   │       ├── SessionGroup   今天/昨天/更早
            │   │       └── SessionItem
            │   └── ConversationView       centered column ≤ 760 px
            │       ├── EmptyState         §7 when items empty (replaces the
            │       │                      scroll area in that case)
            │       ├── ConversationScroll owns autoscroll (§15); role="log"
            │       │   └── TurnBlock[]    one per turn
            │       │       ├── UserBubble
            │       │       ├── ActivityStrip     live rows (§11.2) or collapsed
            │       │       │                   chip (§11.3)
            │       │       │   └── ToolRow → ToolDetailPanel (Accordion, §10.4)
            │       │       └── AssistantBubble   markdown (§6.3/§6.4) + captions
            │       ├── ScrollToBottomPill §15.2
            │       └── Composer           §8
            └── StatusBar                  28 px (§16.6)
        ActivityDrawer                     §12 portal, overlay end position
```

Render rule for a live turn: `turn/start` appends the user item and an empty
accumulating assistant item to the store (§28.2). `AssistantBubble` renders
nothing while its item text is empty (this produces the “mount at first
chunk” behavior of §14.1), while `ActivityStrip` renders above it from the
same item's `tools[]`.

### 27.1 Component responsibilities

| Component | Owns / behavior |
|---|---|
| `DesktopShell` | grid layout only; switches MainRegion content to `RuntimeStateCard` when runtime status is starting/disconnected/error/restarting (state cards replace the whole content area, §16); during `restoring` the content area stays visible with the §5.4 inline loader |
| `TitleBar` | drag region attribute on brand area; brand; badge; 活动 entry; window controls (min/max/close wired to host commands); a11y labels §23 |
| `RuntimeStatusBadge` | renders the §16.1 runtime status with §25 `status.*` copy + dot tone (§29 mapping) |
| `SessionSidebar` | list data + grouping + selection dispatch; row enablement by activeTurn |
| `NewSessionButton` / `SessionItem` | §5.2/§5.3; disabled + tooltip while a turn is active |
| `ConversationView` | column chrome, empty-state switch, composer placement; holds the draft map (§28.3) |
| `ConversationScroll` | virtualization-free scroll container; autoscroll & back-to-latest signals (§15); `role="log"` |
| `TurnBlock` | groups one user item + its assistant item; hosts strip expand state (from store, §28.1) |
| `UserBubble` / `AssistantBubble` | pure rendering of items (kind user / assistant); hover timestamps (§6.5); captions §17.2 |
| `ActivityStrip` / `ToolRow` / `ToolDetailPanel` | §10/§11; state icons, summaries via toolMeta.ts; details accordion |
| `Composer` | §8; draft text, IME guard, lock derivation (no stop control, §8.3) |
| `ScrollToBottomPill` | §15.2 affordance (view-local visibility) |
| `ActivityDrawer` | §12; reads `conversation.log` (§28.1); local row expansion, store filter |
| `RuntimeStateCard` | one component, variant prop for starting/disconnected/error/restarting (§16; restoring keeps the content area + §5.4 loader instead) |
| `StatusBar` | §16.6 dot + status text + right caption |

### 27.2 File layout & styling rules (binding)

The frontend is one Vite + React + TS package (the host crate/repo path is
chosen by the implementation plan; the internal split below is binding):

```
frontend/src/
├── main.tsx / app.tsx      providers assembly (FluentProvider + AppStateProvider)
├── theme.ts                §19 token overrides + theme-switching hook
├── copy.ts                 §25 strings, single export object
├── toolMeta.ts             §10.1/§10.2 metadata (verbs, icons, summary builders)
├── protocol/               §26/§28 presentation types ONLY — no @deepseek-ai imports
├── store/                  state.ts · reducer.ts · actions.ts (§28)
├── bridge/                 typed client over §26.2/§26.3 — sole IPC choke point
├── markdown/               allowlisted renderer (§6.4)
└── components/             one folder per §27.1 node + primitives/
                            (Bubble, ToolRowChip, StatusDot)
```

Styling: `makeStyles`/griffel tokens only; CSS modules, plain CSS files and
CSS frameworks are forbidden; flex/grid layout only (absolute positioning
reserved for the drawer, pill and state cards); no global reset that removes
`:focus-visible`.

---

## 28. Frontend State Model

One `useReducer` store + one Context provider at App root. No Redux/MobX or
other state framework (brief §28): the event rate (≤ a few dozen
events/second during a turn) is trivially handled by a reducer.

### 28.1 Root state

```ts
type RuntimeStatus = 'starting'|'ready'|'restoring'|'disconnected'|'error'|'restarting';
// 'busy' is derived, never stored: busy ⇔ activeTurn !== null (§16.1)

interface RootState {
  runtime: { status: RuntimeStatus; detail?: string };
  sessions: SessionSummary[] | null;         // null until the first session/list
  activeSessionId: string | null;
  conversation: {
    items: ConversationItem[];               // §26.4, chronological
    log: TimelineRow[];                      // §12 drawer timeline
    openError: string | null;                // §13 restore-failure card; null = ok
  };
  activeTurn: { turnId: number; startedAt: number } | null;
  ui: {
    drawerOpen: boolean;
    drawerFilter: 'all' | 'tools';
    expandedTurnIds: Record<string, boolean>; // §11.3 strip expansion
  };
}

type TimelineRow =            // one row per presentation event; the drawer groups
                              // consecutive 'chunk' rows visually (assistant/chunk ×n)
  | { type: 'turn/start'; turnId: number; ts: number }
  | { type: 'tool/call' | 'tool/result'; turnId: number; ts: number; tool: ToolActivity }
  | { type: 'chunk'; turnId: number; ts: number; chars: number }       // per assistant/chunk
  | { type: 'step'; turnId: number; ts: number; usage?: unknown; interrupted?: boolean }  // assistant/message
  | { type: 'turn/error'; turnId: number; ts: number; code: string; message: string }
  | { type: 'turn/end'; turnId: number; ts: number; reason: TurnEndReason };
```

Mapping to the brief's field sketch: `runtimeStatus` → `runtime.status`
(status 'restoring' is emitted by the bridge around a `session.open` and
shows badge + §5.4 loader; the content area stays visible);
`sessions` → `sessions`; `activeSessionId`; `conversationItems` →
`conversation.items`; `activeTurn`; `activityDrawer` → `ui.drawer*`;
`composer` lock is **derived** (enabled ⇔ `activeTurn === null` and
`runtime.status === 'ready'`), never stored.

A live turn is represented in `items` as exactly two items appended at
`turn/start`: a user item (text = the accepted send — a failed send never
appends one) followed by an empty assistant item that accumulates `tools[]`
and `text` until `turn/end` finalizes its `status`. The live path and the
resume snapshot therefore share one item shape (§26.4); `session.open`
populates `items` + `log` from the bridge snapshot.

### 28.2 Event → action → effect (reducer contract)

Rows name the envelope `type` string (§26.3); all mutations below apply only
when the envelope's `sessionId` equals `activeSessionId` (bridge never sends
others — belt-and-braces guard, dev-assert otherwise).

| Envelope `type` | Action | Effect |
|---|---|---|
| `runtime/status` | RUNTIME_STATUS | set `runtime`; starting/disconnected/error/restarting replace the content view (MainRegion); restoring/ready keep it |
| `session/list` | SESSIONS_REPLACE | `sessions` full replace (entries with `title:''` are legal — sidebar shows 新会话 until opened, §5.2) |
| `session/created` | SESSION_CREATED | only when `activeTurn === null`: prepend summary, set `activeSessionId`, reset `conversation` to empty items/log, `openError: null` |
| `session/opened` | SESSION_OPENED | set `activeSessionId`; `conversation = { items, log, openError: null }`; `activeTurn = null` |
| `session/title` | SESSION_TITLE | update that summary's title in place (list order unchanged) |
| `turn/start` | TURN_START | assert `activeTurn === null`; append user item + empty assistant item; log row; `activeTurn = {turnId, startedAt}` |
| `tool/call` | TOOL_CALL | append running `ToolActivity` to the open assistant item; log row |
| `tool/result` | TOOL_RESULT | finalize the matching running activity (`ok`, `error`, `durationMs`, `result`); log row |
| `assistant/chunk` | TEXT_DELTA | append chunk text to the open item; append `chunk` log row (rendering batching is a ConversationScroll concern, §14.1 — the store updates per event) |
| `assistant/message` | STEP_DONE | **never rewrites accumulated text** (chunks are the text source of truth); records `usage` / `interrupted` on the item and a `step` log row for the drawer |
| `turn/error` | TURN_ERROR | store `{code, message}` on the open item for the §17.2 error surface; log row |
| `turn/end` | TURN_END | finalize the item's `status`: completed→`complete`, aborted→`stopped`, max-tokens→`limited`, error→`failed`, interrupted→`interrupted`, blocked→(`text`? `complete` : `no-answer`); `activeTurn = null`; log row |
| — | OPEN_FAILED | (`session.open` request failed) `conversation.openError` set; `runtime.status` back to ready — §13 card shows |
| — | OPEN_RETRY | clears `openError`, dispatches `session.open` again |

UI actions: `ui.drawer.toggle` / `ui.drawer.setFilter` / `ui.drawer.close`;
`ui.strip.toggle(turnId)` flips `expandedTurnIds[turnId]`. The
back-to-latest click is routed imperatively to `ConversationScroll`, not
stored.

Reducer invariants (dev assertions): no user/assistant item is appended
while `activeTurn !== null`; item mutations touch only the open assistant
item of the active session; a tool finalize only targets the newest running
activity.

### 28.3 What stays local (never in the store)

- Composer draft text: kept in a `Map<sessionId, string>` held by
  `ConversationView` (survives session switching within an app run; cleared
  for a session the moment its `turn/start` fires). IME composition state.
- Autoscroll position, follow-state and “back to latest” visibility:
  refs + rAF batching inside `ConversationScroll` (§14.1/§15) — the store is
  not re-rendered per chunk; commits happen at most once per frame.
- Activity Drawer per-row expansion (one open row per turn, §12.4; unmount
  on close is fine). Drawer open/filter live in the store.
- Hover and focus ephemera.

---

## 29. Fluent UI React v9 Component Mapping (frozen)

Frontend dependency set: `@fluentui/react-components` (v9 stable),
`@fluentui/react-icons`, plus React/Vite/TS at the versions the chosen
Fluent release supports (pinned by the implementer). No other UI dependency;
no CSS framework; styles via `makeStyles` + theme tokens only.

| Feature (§) | Fluent v9 component | Notes |
|---|---|---|
| Theme & tokens (§18/§19) | `FluentProvider` `theme={webLightTheme \| webDarkTheme}` | brand override applied in theme.ts (§19.1); dev-only toggle permitted |
| NewSessionButton (§5) | `Button appearance="secondary" icon={<Add/>}` | full row width; disabled while a turn is active |
| SessionItem (§5) | custom row: native `<button>` styled with tokens | title span + time span inside; active tint bg; tooltip when disabled |
| SessionGroup label | `Text` (12px/600 custom class) | color neutralForeground3 |
| Runtime status badge (§16.1) | `Badge` + custom `StatusDot` span | tone per state: starting/restoring/restarting neutral; ready brand; disconnected/error danger |
| Activity entry (§12.2) | `Button appearance="subtle"` content `活动` | prepend `<Spinner size="tiny"/>` while a turn runs |
| Window controls (§4.3) | three `Button appearance="subtle" size="small"` | icons `ChromeMinimize` / `ChromeMaximize` (swap `ChromeRestore` while maximized) / `ChromeClose`; wired to host window commands |
| Empty state (§7) | `Text` headline (custom 26px class) + `Button appearance="secondary"` chips | 🎵/🎷/🧾 glyphs as plain text |
| User/Assistant bubbles (§6) | custom primitives — no stock bubble | tokens per §6.2/§6.3; `chinookUserBubbleBg` (§6.2) |
| Markdown (§6.4) | custom allowlisted renderer | block styles via tokens; no raw HTML |
| ActivityStrip rows (§11) | custom rows | running: `Spinner size="tiny"`; success `CheckmarkCircle`; error `DismissCircle`; colors from semantic tokens (§19.1) |
| Collapsed strip (§11.3) | `Button appearance="subtle" size="small"` | chevron rotates with expansion; aria-expanded |
| Tool detail (§10.4) | `Accordion` + one `AccordionItem` per tool | header = icon + verb + summary; panel = 参数/结果/耗时/状态 code blocks |
| Composer (§8) | `Textarea` + `Button appearance="primary" icon={<Send/>}` | send disabled when empty/busy; while busy the icon swaps to `Spinner size="tiny"`; auto-grow implemented manually (1–6 lines, §8.3) |
| Scroll pill (§15.2) | `Button appearance="secondary"` | pill radius 999 via class; icon `ArrowDown` |
| Activity Drawer (§12) | `Drawer type="overlay" position="end"` | width fixed at 360 px by CSS on the drawer panel (component size presets are irrelevant); header: `Text` + `TabList` (全部/工具) + close `Button` |
| Drawer rows (§12.4) | custom expandable rows | raw payloads in `<pre>` code-face blocks; consecutive chunk rows grouped visually (×n, §28.1) |
| State cards (§16) | custom centered card | `Spinner` (starting/restarting) + `Text` + `Button appearance="primary"`; raw message behind a small `Accordion` 查看详情 |
| Status bar (§16.6) | custom 28 px row | `StatusDot` + `Text`; right caption neutralForeground3 |
| Tooltips on disabled rows (§5.3) | `Tooltip` | wrap the disabled control in a `<span>` (v9 disabled elements swallow pointer events) |
| Focus/visibility | Fluent defaults | no global CSS reset removing `:focus-visible` |

Glyph set — imported by name from `@fluentui/react-icons` (`Spinner` from
`@fluentui/react-components`): `Add`, `Send`, `ChevronDown`,
`ChevronRight`, `CheckmarkCircle`, `DismissCircle`, `Dismiss`, `ArrowDown`,
`Search`, `Albums`, `MusicNote`, `Receipt`, `Document`, `Bookmark`,
`History`, `Code`, `ChromeMinimize`, `ChromeMaximize`, `ChromeRestore`,
`ChromeClose`. If one name is missing in the installed icon version, swap
that single glyph — never the design.

---

## 30. React / Rust / Node Responsibilities & implementation constraints found

### 30.1 Boundary table

| React (frontend) | Rust (host) | Node (bridge) | Agent core (unchanged) |
|---|---|---|---|
| render, interaction, streaming UI, session navigation, activity visualization, theme, a11y, copy | window & app lifecycle, sidecar spawn/supervise, IPC (commands/channels), env/path passing, event forwarding, restart | JSONL protocol on stdin/stdout with the host, AgentRuntime adapter, dsh event → presentation event normalization (§26.3), session snapshot builder, title index, reasoning filtering, duration timing | everything as today: DSH boot, agent loop, sessions, tools, memory, identity, LLM |
| never: DSH, SQLite, process, tool logic, LLM, business rules | never: music/invoice/memory logic, agent orchestration, presentation-language rules | never: new tools, new LLM, business rules (does not interpret result payloads semantically — frontend does) | no change; not modified by V2 |

### 30.2 Verified mapping — current runtime facts (evidence: read-only inspection of V1)

| Desktop need | Actual V1 capability (file evidence) |
|---|---|
| Turn begin | `ctx.on('session/event')` `turn/start {turn}` — real event |
| Tool invocation | `tool/call {turn, step, callId, name, arguments}` — `arguments` is the raw model JSON string; emitted before execution |
| Tool outcome | `tool/result {turn, step, callId, message, error?{name,code}}` — tool payload is pretty-printed JSON inside `message.content[0].content[0].text`; business failures surface as `ok:false` inside that JSON (structured `{ok,error:{code,message}}`), not as `event.error` |
| Assistant tokens | `assistant/chunk {turn, step, chunk}` with `chunk.type='text-delta' {index,text}` |
| Reasoning tokens | `assistant/chunk` `chunk.type='reasoning-delta'` EXISTS — must be filtered (see §30.6) |
| Step/turn closure | `step/start`,`step/end`, `turn/end {turn, reason}`; reason kinds: `completed|aborted|blocked|error|max-tokens|interrupted`; error carries `LlmFailure {message, code}` |
| User text | `user/message` (content text) — also the source for session titles and snapshot user items |
| Session create/resume | `AgentRuntime.startSession(resumeId?)` (registry.create/resume + `installModelSelection`) |
| Persistence list | `AgentRuntime.listSessions()` → `{id, createdAt}[]` newest-first; resume by `id` |
| Flush semantics | session flushed on close/switch (`closeSession`), JSONL is append-on-flush, compressed `.zstd` files under `.dsh/sessions/<cwd-key>/<sessionId>/` |
| Single active session | runtime keeps one active handle; switching = flush current → open target |
| Identity | `CHINOOK_CUSTOMER_ID` env read at plugin mount (boot-time); default demo customer 1; account/memory tools return `IDENTITY_REQUIRED` when unset/invalid |
| Credentials | env-first `DEEPSEEK_API_KEY`, bridged from `ANTHROPIC_AUTH_TOKEN` — both are host-provided env at sidecar spawn |
| Model | `deepseek-v4-flash` (default-model selection; read-only display string in §25) |

### 30.3 Verified tool payload shapes (drives §10 summaries)

`search_catalog` → `{ok:true, query, entity_type, count, items:[{type,id,name,artist?,album?,genre?}]}`; `find_similar_albums` → `{ok:true, album_name, count, items:[{album,artist,genreMatchTracks}]}`; `popular_in_genre` → `{ok:true, genre, count, items:[{track,artist,album,timesSold}]}`; `list_my_orders` → `{ok:true, count, items:[{invoiceId,invoiceDate,billingCity,billingCountry,total}]}`; `get_invoice_details` → `{ok:true, invoice:{invoiceId,invoiceDate,total,lines:[{track,artist,unitPrice,quantity}]}}`; `remember` → `{ok:true, memory:{id,text,createdAt,updatedAt}}`; `recall` → `{ok:true, count, items:[{id,text,createdAt,updatedAt}]}`. Error payloads: `{ok:false, error:{code,message}}` with codes `INVALID_ARGUMENT | NOT_FOUND | IDENTITY_REQUIRED | ACCESS_DENIED | DATABASE_ERROR | MEMORY_ERROR`.

### 30.4 Constraints discovered (implementation notes for the bridge, NOT runtime changes)

1. **`AgentRuntime.ask` is a plain text-request API** (returns final text,
   optional delta callback). It does not expose tool events or turn events,
   and has no cancel. The bridge must either (a) extend
   `apps/cli/src/runtime.ts` with an **additive, optional** per-turn event
   sink (e.g. `startSession`/`ask` accepting `onEvent(sessionEvent)` /
   exposing a `subscribeSessionEvents(cb)`) that forwards the verified
   `session/event` vocabulary, or (b) own the boot chain itself (the CLI
   runtime boot recipe is documented in `runtime.ts`). Both keep DSH Core,
   plugin, tools, memory, identity untouched. Decision: **(a)** — a thin,
   additive event subscription on the existing runtime module; the dsh
   `SessionEvent` type is mapped to §26 types in the bridge, never imported
   by React.
2. **Session list carries no title and no message count** — titles derive
   from the first `user/message` text. The bridge maintains its own small
   sidecar index (JSON file under `$DSH_HOME` — a new bridge-owned file,
   not a change to session semantics) mapping `sessionId → {title,
   messageCount}` updated on create/open/turn; on first `session.list` after
   app start the index may be empty → list returns `title:''` and React
   shows 新会话 until the session is opened (acceptance: opening a session
   always yields its real title; list titles refresh when the app restarts
   and the index is rebuilt by reading… decision: index is rebuilt lazily —
   entries hydrate on `session.open`; the sidebar shows 新会话 for never-
   opened sessions in the same app run, and the index persists so next runs
   show real titles. Restrained and simple.)
3. **Turn identity**: dsh turns are per-session integers; presentation
   `turnId` = the dsh turn number (envelope `turnId`). Snapshot items key
   `assistant` id by `${sessionId}:${turnId}`.
4. **Snapshot hydration** reads compressed JSONL rows. Snapshot = ordered
   render of `user/message` text, per-turn tool calls/results
   (`tool/call`+`tool/result` pairing by `callId`), assistant final text
   from `assistant/message` text blocks, turn end reason. Bounded at 200 turns; older turns collapse into the §13 archive
   synthetic item. Timestamps = event `time`.
   This logic lives in the bridge adapter.
5. **Turn duration** for §10.4: bridge timestamps `tool/call`→`tool/result`
   per `callId`.
6. **Reasoning must be dropped** before the wire (§26.3 chunk events carry
   text only). The bridge filters `reasoning-delta` chunks and reasoning
   blocks at the adapter.
7. **Business failures are data, not events**: an `ACCESS_DENIED` arrives as
   a *successful* `tool/result` whose payload JSON says `ok:false`. The
   bridge must parse the rendered payload text to produce
   `ToolResultEvent.ok/error`; it must not treat it as a channel error.
8. **One active session/turn is enforced by the runtime design**; the UI
   lock (§16.4) plus bridge rejection (`TURN_ACTIVE`) is belt-and-braces.
9. **Identity is boot-time**: changing the demo customer requires a sidecar
   restart with a different `CHINOOK_CUSTOMER_ID`; V2 shows no identity UI
   and documents the env contract (host passes `DEEPSEEK_API_KEY` /
   `ANTHROPIC_AUTH_TOKEN` / `CHINOOK_CUSTOMER_ID` / `DSH_HOME` at spawn).
10. **Displayed model name** is read from the runtime default-model
    selection at boot and shown in the status bar (string may differ from
    §25 default only via this live value; never hardcode other model
    names).

---

## 31. V2 UI Acceptance Criteria

### 31.1 Product rules
- [ ] Single main window ≥ 640×520; default 1050×700.
- [ ] Conversation is the visual subject; tool activity never dominates (§6/§11).
- [ ] One active turn per session: composer locks on `turn/start`, unlocks on `turn/end`; session switching disabled during the turn.
- [ ] Assistant text renders per chunk; never wait-for-full-answer.
- [ ] Reasoning (chain-of-thought) is absent from every surface (conversation, tool detail, drawer).
- [ ] Auto-scroll rules (§15) work; “回到最新消息” pill appears/disappears correctly.
- [ ] Business denial (Demo 5) shows the polite answer + subtle tool-row error; no modal, no red page, no raw JSON in the primary surface.
- [ ] Runtime disconnect → center state card with 重新连接; no stack traces to users; raw detail behind 查看详情 only.

### 31.2 Session UX
- [ ] 新建会话 creates and selects a session (empty state visible).
- [ ] Session list groups 今天/昨天/更早 and titles by first user message (24-char truncation); UUIDs never shown as titles.
- [ ] Clicking a historical session restores its conversation (loading → content) with collapsed tool strips.
- [ ] Restore failure path shows 会话恢复失败 + 重试/关闭.
- [ ] Crash-orphaned last turn shows 上次回答未完成 caption.

### 31.3 Activity & tools
- [ ] All 7 tools render by §10 metadata (verbs, icons, summaries from real result keys).
- [ ] Live tool row shows running → success/error flip; summaries match §10.2 templates.
- [ ] Collapse on turn end: `完成 · 使用 n 个工具`; re-expand shows per-tool details (参数/结果/耗时/状态).
- [ ] Activity drawer shows the raw normalized timeline with expandable rows and 全部/工具 filter; opens via 活动 button and `Ctrl+Alt+A`.

### 31.4 Theming/typography/a11y
- [ ] Follows system light/dark via FluentProvider; all colors from tokens except the defined brand ramp (§19.1).
- [ ] Type scale/spacing per §20; no hardcoded hex elsewhere; no gradients.
- [ ] Keyboard: Tab order, shortcuts (§23), focus rings, `role="log"` + polite live region on streaming, aria-labels on icon buttons.
- [ ] `prefers-reduced-motion` honored (§21).
- [ ] Component tree, store model and Fluent mapping implemented per §27–§29.

### 31.5 Demo scripts pass
- [ ] Demos 1–6 (§24) execute and produce the exact listed UI moments.
- [ ] Demo 4 table equals the real V1 invoice fixture under `CHINOOK_CUSTOMER_ID=1` (ids 382…98).
- [ ] Resume + drawer engineering demo reproduces raw V1 JSON payload shapes (§30.3).

### 31.6 Runtime-state transitions
- [ ] starting → ready; ready ↔ busy (turn); disconnected → restarting → ready; error card → 重新启动 works; all badge copy per §16.1/§25.

---

## 32. Explicit Non-goals (V2 first release)

1. No implementation in this phase (no Tauri app, React pages, Rust host, Node bridge, IPC, or sidecar code).
2. No modifications to Agent Core, Chinook plugin, tools, services, memory, identity, or session semantics.
3. No login/registration, user switching UI, or multi-account; identity remains the boot-time env contract.
4. No shopping cart, checkout, payment, refund, or user-center flows.
5. No cloud sync, multi-device, or multi-window; no web server; no macOS support.
6. No RAG, vector DB, embeddings, MCP, plugin marketplace, or multi-agent UI.
7. No voice, no file/image attachments, no markdown images/HTML.
8. No chat affordances beyond V1: no regenerate, no edit-and-resend, no branching/forks, no copy-to-clipboard buttons on every message (OS copy suffices), no message reactions.
9. No settings page, no theme toggle UI, no model picker, no “identity/customer” switcher, no system-prompt viewer.
10. No reasoning/CoT display in any form (§9/§30.6).
11. No animations beyond §21; no Mica/Acrylic dependency (optional polish only).
12. No message persistence beyond what the existing runtime provides; the bridge's own title index is the only new stored artifact, and it is disposable/rebuilt.

---

## 33. Open items (intentionally none)

This spec resolves every decision the UI phase needs. Anything this document
does not cover is either inherited unchanged from the Design Brief (frozen)
or is an implementation detail left to the implementing engineer (exact
Fluent component props, file layout, CSS mechanics) that cannot create
product ambiguity.

# DSH Chinook Desktop V2 --- Implementation Contract

> 本文件由原 Desktop V2 Autonomous Implementation Prompt 拆分而来。
> 保留原文中的技术契约、实现约束、阶段要求、测试要求、Definition of Done
> 与最终报告要求。 Agent 角色、启动动作与自主执行指令由单独的 Claude
> Code Goal 提供。

# 0. 必读契约

开始前完整阅读并理解：

``` text
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

这是本阶段：

# UI / UX / Interaction / Presentation Protocol 的最高实现契约。

同时阅读：

``` text
docs/DSH_CHINOOK_AGENT_V1_SPEC.md
```

以及当前仓库中存在的：

``` text
V1 acceptance report
README
package.json
apps/cli/
plugins/chinook/
profiles/chinook/
tests/
```

但：

> 不要重新讨论 V1 架构是否正确。

V1 已通过验收。

------------------------------------------------------------------------

# 1. 工作模式

这是：

# DIRECT IMPLEMENTATION TASK

执行：

``` text
Inspect
  ↓
Baseline
  ↓
Implement
  ↓
Integrate
  ↓
Build
  ↓
Test
  ↓
Run
  ↓
Debug
  ↓
Retest
  ↓
Package
  ↓
Verify
```

不要先输出长篇方案。

不要在每个阶段结束后等待用户确认。

对于能够通过：

``` text
源码
类型定义
官方文档
测试
实际运行
```

自行判断的问题，直接解决并继续。

只有真正无法通过项目本身解决的外部阻塞，才允许停止。

------------------------------------------------------------------------

# 2. Git Baseline

首先检查：

``` bash
git status
```

如果当前仓库尚未初始化 Git：

1.  检查 `.gitignore`
2.  确保至少排除：

``` text
node_modules/
.dsh/
tmp/
.env
*.log
target/
dist/
src-tauri/target/
runtime artifacts
local memory/session artifacts that should not be versioned
```

3.  初始化 Git。
4.  将**开始 Desktop Implementation 之前的当前状态**提交为 baseline。

建议：

``` text
chore: freeze agent v1 and desktop v2 ui spec
```

不要上传远程仓库。

不要创建 GitHub repo。

如果已经存在 Git：

> 不要重写历史，只记录当前 baseline 状态然后继续。

------------------------------------------------------------------------

# 3. 核心架构不可重新设计

目标架构已经冻结：

``` text
┌─────────────────────────────┐
│ React + Fluent UI           │
│ Presentation                │
└──────────────┬──────────────┘
               │
       Tauri Commands
       Tauri Channels
               │
┌──────────────▼──────────────┐
│ Tauri v2 + Rust            │
│ Desktop Host               │
└──────────────┬──────────────┘
               │
       stdin / stdout
             JSONL
               │
┌──────────────▼──────────────┐
│ Node Agent Bridge          │
│ Transport Adapter          │
└──────────────┬──────────────┘
               │
       TypeScript API
               │
┌──────────────▼──────────────┐
│ Existing AgentRuntime      │
│ DSH Runtime                │
└──────────────┬──────────────┘
               │
┌──────────────▼──────────────┐
│ Chinook Plugin             │
│ Tools / Services / SQLite  │
└─────────────────────────────┘
```

不要变成：

``` text
React
 ↓
HTTP Server
 ↓
REST
```

也不要变成：

``` text
Rust Agent Runtime
```

更不能：

``` text
React
 ↓
直接访问 SQLite
```

------------------------------------------------------------------------

# 4. 技术栈固定

## Desktop

使用：

``` text
Tauri v2 stable
Rust
```

使用当前可用的最新稳定 Tauri v2 版本组合。

禁止：

``` text
Tauri 3 alpha/beta
Electron
NW.js
```

如果各 Tauri package 当前 stable patch 号不同：

> 使用官方推荐且互相兼容的 stable v2 组合，不要强迫所有 package
> 版本号完全相同。

------------------------------------------------------------------------

## Frontend

固定：

``` text
React
TypeScript
Vite
@fluentui/react-components
@fluentui/react-icons
```

使用 Fluent UI React v9 stable。

禁止主 UI 使用旧：

``` text
@fluentui/react
```

------------------------------------------------------------------------

# 5. 不允许重写 Agent Core

必须保留现有：

``` text
TypeScript
Node.js
DSH
AgentRuntime
Chinook Plugin
7 Tools
SQLite
Session
Memory
Identity
LLM
```

绝对禁止：

``` text
把 Agent 改写成 Rust
重新实现 Tool
重新实现 Session
重新实现 Memory
重新实现 Agent Loop
迁移 SQLite 到 Rust
```

------------------------------------------------------------------------

# 6. Agent Core 允许的唯一修改类型

UI Spec 已经通过真实代码检查发现：

``` text
AgentRuntime.ask
```

目前无法直接向 Desktop Bridge 暴露所有：

``` text
turn/start
tool/call
tool/result
assistant/chunk
turn/end
```

事件。

因此允许对：

``` text
apps/cli/src/runtime.ts
```

或其实际等价 Runtime 模块做：

# additive-only integration change

例如增加：

``` text
subscribeSessionEvents(...)
```

或者等价的可选 Event Sink。

要求：

1.  不能改变现有 CLI 行为。
2.  不能改变 Agent business behavior。
3.  不能改变 Tool schema。
4.  不能改变 Session semantics。
5.  不能改变 Memory。
6.  不能改变 Identity。
7.  CLI 原有测试必须继续通过。
8.  新 API 只为 Adapter 提供事件出口。

不要借机重构 Agent。

------------------------------------------------------------------------

# 7. Desktop V2 不支持主动 Stop

这是冻结产品决策。

Desktop V2 first release：

``` text
turn/start
 ↓
Composer locked
 ↓
Agent runs
 ↓
turn/end
 ↓
Composer unlocked
```

不实现：

``` text
Stop Generation
Cancel Generation
turn.cancel
```

不要自行研究 Abort 后再把它加回来。

仍然必须兼容读取历史/runtime 自身产生的：

``` text
turn/end reason.aborted
```

但只是：

``` text
read-only rendering state
```

------------------------------------------------------------------------

# 8. 推荐工程结构

在保持当前仓库合理结构的前提下，目标形态：

``` text
apps/
├── cli/
│
├── agent-bridge/
│   ├── src/
│   │   ├── main.ts
│   │   ├── protocol.ts
│   │   ├── runtime-adapter.ts
│   │   ├── session-adapter.ts
│   │   ├── title-index.ts
│   │   └── jsonl.ts
│   └── package.json
│
└── desktop/
    ├── src/
    │   ├── main.tsx
    │   ├── app.tsx
    │   ├── theme.ts
    │   ├── copy.ts
    │   ├── toolMeta.ts
    │   │
    │   ├── protocol/
    │   ├── store/
    │   ├── bridge/
    │   ├── markdown/
    │   │
    │   └── components/
    │
    ├── src-tauri/
    │   ├── Cargo.toml
    │   ├── tauri.conf.json
    │   ├── capabilities/
    │   │
    │   └── src/
    │       ├── lib.rs
    │       ├── main.rs
    │       ├── commands.rs
    │       ├── paths.rs
    │       │
    │       └── agent/
    │           ├── mod.rs
    │           ├── process.rs
    │           ├── protocol.rs
    │           └── router.rs
    │
    ├── package.json
    └── vite.config.ts
```

如果实际 workspace 结构要求稍有不同：

> 可以做最小工程适配，但不能改变职责边界。

------------------------------------------------------------------------

# 9. Node Agent Bridge

首先实现：

``` text
apps/agent-bridge/
```

它是：

# Transport Adapter

不是第二个 Agent Runtime。

负责：

``` text
stdin JSONL
     ↓
parse request
     ↓
existing AgentRuntime
     ↓
normalize DSH events
     ↓
stdout JSONL
```

------------------------------------------------------------------------

# 10. stdout / stderr 绝对规则

Bridge：

``` text
stdout
=
JSONL protocol only
```

例如：

``` json
{"protocolVersion":1,"type":"turn/start",...}
```

所有：

``` text
debug
boot log
warning
stack trace
diagnostic
```

只能：

``` text
stderr
```

禁止：

``` ts
console.log("bridge ready")
```

污染 stdout。

如果需要日志：

``` ts
console.error(...)
```

或等价 stderr logger。

------------------------------------------------------------------------

# 11. Presentation Protocol

严格实现 UI Spec §26。

Envelope 至少：

``` ts
interface Envelope {
  protocolVersion: 1;
  requestId?: string;
  sessionId?: string | null;
  turnId?: number | null;
  seq: number;
  type: string;
  data: unknown;
}
```

不要重新设计另一套协议。

------------------------------------------------------------------------

# 12. 普通 Request

至少实现：

``` text
session.list
session.create
session.open

agent.status
agent.restart

turn.send
```

不存在：

``` text
turn.cancel
```

------------------------------------------------------------------------

# 13. Streaming Events

至少：

``` text
runtime/status

session/list
session/created
session/opened
session/title

turn/start

tool/call
tool/result

assistant/chunk
assistant/message

turn/error
turn/end
```

React 不允许直接消费：

``` text
@deepseek-ai/*
```

类型。

------------------------------------------------------------------------

# 14. Reasoning Filtering

真实 DSH 存在：

``` text
assistant/chunk
reasoning-delta
```

必须：

``` text
DSH
 ↓
Node Bridge
 ↓
DROP reasoning
 ↓
React never sees it
```

任何：

``` text
reasoning-delta
reasoning block
hidden chain-of-thought
```

都不能进入 Presentation Protocol。

只允许：

``` text
assistant/chunk text
```

------------------------------------------------------------------------

# 15. Tool Result Normalization

真实 DSH 的：

``` text
tool/result
```

中业务结果可能存在于 message 文本中的 JSON。

尤其：

``` json
{
  "ok": false,
  "error": {
    "code": "ACCESS_DENIED",
    "message": "..."
  }
}
```

这是：

``` text
successful DSH tool/result event
+
business failure payload
```

不是 IPC 错误。

Bridge 必须根据 frozen Spec 转换成：

``` ts
{
  ok: false,
  error: {
    code,
    message
  }
}
```

Presentation Event。

不要把 ACCESS_DENIED 当成 Runtime crash。

------------------------------------------------------------------------

# 16. Session Snapshot Adapter

`session.open` 必须返回：

``` ts
{
  session,
  items,
  log
}
```

Bridge 根据现有：

``` text
DSH Session persistence
zstd JSONL
```

恢复：

``` text
User Messages
Assistant Messages
Tool Calls
Tool Results
Turn Ends
Activity Timeline
```

不要让 Rust 解析 DSH Session 日志。

不要让 React 解析 DSH Session 日志。

只有：

``` text
Node Bridge
```

理解 Session Event。

------------------------------------------------------------------------

# 17. Session Title Index

因为现有 Session header 没有 title：

允许 Bridge 创建：

``` text
bridge-owned disposable title index
```

位于：

``` text
$DSH_HOME
```

例如：

``` text
desktop-session-index.json
```

只存：

``` text
sessionId
title
messageCount
```

标题规则严格遵守 UI Spec：

``` text
first user message
trim
collapse newline
24 chars
…
```

它：

``` text
不是 Session Core
不是业务数据库
```

只是 Desktop Presentation Index。

------------------------------------------------------------------------

# 18. Rust Desktop Host

Rust 只负责：

``` text
window
lifecycle
sidecar
stdin/stdout
IPC
paths
environment
restart
event forwarding
```

Rust 绝对不能出现 Chinook business functions：

``` rust
search_catalog()
get_invoice()
remember_music()
```

------------------------------------------------------------------------

# 19. AgentProcessManager

实现一个小型：

``` text
AgentProcessManager
```

职责：

``` text
spawn
shutdown
restart
status

send JSONL
read JSONL
route requestId
forward events
```

不要建立复杂 Actor Framework。

不要引入：

``` text
Kafka
message bus
distributed queue
```

------------------------------------------------------------------------

# 20. Sidecar 生命周期

Desktop 启动：

``` text
Tauri App
 ↓
Rust Host
 ↓
spawn Node Agent Bridge
 ↓
Bridge boot AgentRuntime
 ↓
runtime/status ready
```

整个应用生命周期只启动：

``` text
one long-lived Agent sidecar
```

不要每条消息 spawn Node。

------------------------------------------------------------------------

# 21. Sidecar Crash

如果：

``` text
Node exits
stdout EOF
pipe broken
```

Rust 必须：

``` text
detect
 ↓
runtime/status disconnected
 ↓
React state card
```

UI：

``` text
Agent Runtime 已断开
[重新连接]
```

允许：

``` text
manual restart
```

不要无限自动 crash loop。

------------------------------------------------------------------------

# 22. Tauri IPC

普通操作：

``` text
Tauri Commands
```

Streaming：

``` text
Tauri Channels
```

不要：

``` text
REST
HTTP server
SSE server
WebSocket
```

------------------------------------------------------------------------

# 23. Tauri Commands

保持极少。

可对应：

``` text
agent_status
agent_restart

session_list
session_create
session_open

turn_send
```

必要的内部命名可以遵守 Rust convention。

但是：

> 不允许一个业务 Tool 对应一个 Tauri command。

禁止：

``` text
invoke("search_catalog")
invoke("list_my_orders")
```

永远：

``` text
turn_send
 ↓
Agent
 ↓
Agent chooses tool
```

------------------------------------------------------------------------

# 24. Tauri Channel

`turn_send` 必须能将：

``` text
turn/start
tool/call
tool/result
assistant/chunk
turn/end
```

实时推给 React。

不要把完整回答攒完以后一次返回。

------------------------------------------------------------------------

# 25. Frontend

严格实现：

``` text
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

不要再做 UI 决策。

特别是：

``` text
1050 × 700 default
640 × 520 minimum

264px sidebar
760px conversation max
360px activity drawer

< 900px sidebar collapse
```

按照 Spec。

------------------------------------------------------------------------

# 26. Frontend 核心组件

必须实现 Spec §27 的核心组件树。

包括：

``` text
DesktopShell
TitleBar
RuntimeStatusBadge

SessionSidebar
NewSessionButton
SessionList
SessionGroup
SessionItem

ConversationView
ConversationScroll

EmptyState

TurnBlock
UserBubble
AssistantBubble

ActivityStrip
ToolRow
ToolDetailPanel

Composer

ScrollToBottomPill

ActivityDrawer
RuntimeStateCard
StatusBar
```

不要为了减少文件把整个 UI 写进：

``` text
App.tsx
```

也不要反向过度组件化。

------------------------------------------------------------------------

# 27. Frontend 状态

使用：

``` text
useReducer
Context
hooks
```

不要引入：

``` text
Redux
MobX
Zustand
```

除非出现 Spec 无法满足的明确技术阻塞。

默认认为不需要。

------------------------------------------------------------------------

# 28. Streaming Rendering

严格：

``` text
assistant/chunk
 ↓
append
 ↓
render
```

更新最多：

``` text
once per animation frame
```

可用：

``` text
requestAnimationFrame
```

batch。

必须看到：

``` text
我查
我查到
我查到了……
```

真实增长。

不能等完整回答。

------------------------------------------------------------------------

# 29. Assistant Markdown

实现 Spec allowlist。

推荐使用：

``` text
react-markdown
```

或足够简单可靠的实现。

必须：

``` text
raw HTML disabled
images disabled
```

支持：

``` text
paragraph
heading
bold
italic
inline code
code block
list
table
blockquote
```

不要引入完整浏览器 Markdown IDE。

------------------------------------------------------------------------

# 30. Activity UX

这是展示重点。

真实：

``` text
tool/call search_catalog
```

主 UI：

``` text
正在搜索音乐目录…
```

完成：

``` text
✓ 已搜索音乐目录 · 找到 5 张专辑
```

Turn 完成：

``` text
完成 · 使用 1 个工具
```

主界面禁止默认 dump：

``` json
{"query":"Queen"}
```

技术 JSON 只能：

``` text
查看详情
Activity Drawer
```

------------------------------------------------------------------------

# 31. 7 Tool Metadata

严格实现 Spec：

``` text
search_catalog
find_similar_albums
popular_in_genre
list_my_orders
get_invoice_details
remember
recall
```

UI metadata 必须集中：

``` text
toolMeta.ts
```

不要散落 switch 到各组件。

Unknown Tool 必须 fallback。

------------------------------------------------------------------------

# 32. Activity Drawer

实现：

``` text
360px overlay drawer
```

默认关闭。

入口：

``` text
活动
```

支持：

``` text
全部
工具
```

技术详情可以看到：

``` text
turn/start
tool/call
tool/result
assistant/chunk ×n
turn/end
```

Reasoning 永远不存在。

------------------------------------------------------------------------

# 33. Session UX

必须：

``` text
New Session
Session List
Today
Yesterday
Earlier
Session Open
Restore
```

Session UUID：

> 不作为用户标题。

标题来自：

``` text
first user message
```

------------------------------------------------------------------------

# 34. Session 切换锁

Active Turn：

``` text
session switching disabled
new session disabled
composer disabled
```

直到：

``` text
turn/end
```

------------------------------------------------------------------------

# 35. Empty State

严格实现三个入口：

``` text
帮我找 Queen 的专辑

推荐一些爵士乐

查看我的最近订单
```

点击：

> 直接作为真实 User Turn 发送。

不要做 fake demo。

------------------------------------------------------------------------

# 36. Runtime UI

必须覆盖：

``` text
starting
ready
restoring
disconnected
error
restarting
```

Rust stack trace：

> 不能直接成为普通用户主界面。

技术 detail 可以折叠显示。

------------------------------------------------------------------------

# 37. Business Error

例如：

``` text
ACCESS_DENIED
```

主 UI：

``` text
! 无法访问该内容
```

Agent 的拒绝回答照常 Streaming。

不要：

``` text
red full-screen crash
```

------------------------------------------------------------------------

# 38. Themes

实现：

``` text
Light
Dark
Follow System
```

用户层面 first release：

``` text
Follow System only
```

不做 Settings 页面。

使用：

``` text
FluentProvider
webLightTheme
webDarkTheme
```

以及 Spec 中定义的 Chinook Warm brand ramp。

------------------------------------------------------------------------

# 39. Fluent UI

严格使用：

``` text
@fluentui/react-components
@fluentui/react-icons
```

style：

``` text
makeStyles
Fluent tokens
```

不要增加：

``` text
Tailwind
Bootstrap
MUI
Ant Design
Chakra
```

不要混第二套 Design System。

------------------------------------------------------------------------

# 40. Windows Window

实现：

``` text
single window
```

默认：

``` text
1050 × 700
```

最低：

``` text
640 × 520
```

允许自定义 Title Bar。

必须保留正常：

``` text
minimize
maximize / restore
close
drag
double-click maximize behavior
```

不要为了视觉效果破坏 Windows 标准窗口行为。

------------------------------------------------------------------------

# 41. Native Layer

Windows First。

平台相关代码如果存在：

``` text
src-tauri/src/platform/windows/
```

或等价隔离结构。

不要把 Windows-specific API 散落所有 Rust 文件。

未来 macOS：

> 可以新增 Adapter，不需要改 Agent。

但 V2 不实现 macOS。

------------------------------------------------------------------------

# 42. App Data

开发环境可以使用项目本地 runtime。

正式 Desktop runtime：

使用：

``` text
Tauri app data directory
```

并准备：

``` text
agent/
sessions/
data/
```

Rust 负责：

``` text
path
directory
env
```

Node 仍负责：

``` text
SQLite
DSH Session
Memory
```

------------------------------------------------------------------------

# 43. DSH_HOME

Desktop Sidecar Spawn 时设置：

``` text
DSH_HOME=<desktop app data>/agent
```

并确保：

``` text
Chinook DB
Memory DB
Session
Profile
```

能按当前 Runtime 的实际路径规则找到。

不要硬编码当前开发机绝对路径。

------------------------------------------------------------------------

# 44. Credentials

不要把真实：

``` text
API Key
ANTHROPIC_AUTH_TOKEN
DEEPSEEK_API_KEY
```

写进：

``` text
source
tauri.conf.json
frontend
git
```

开发时继承合法 env。

Rust 只负责：

``` text
forward required env
```

React 永远不能获得模型 credential。

------------------------------------------------------------------------

# 45. Sidecar Packaging

最终 Windows App：

> 用户不应该要求额外安装 Node / pnpm。

因此最终 release 必须：

``` text
bundle Node runtime
bundle compiled Agent Bridge
bundle required Agent JS/runtime resources
bundle DSH dependencies/profile
bundle Chinook read-only data
```

根据 DSH 的动态 Plugin/Profile 特性：

不要为了单文件幻想破坏 runtime。

允许 bundle 成：

``` text
application resources
+
sidecar
```

只要用户安装后的 App：

``` text
double click
→ works
```

------------------------------------------------------------------------

# 46. Sidecar Security

Tauri capability 只允许：

``` text
the exact bundled Chinook Agent sidecar
```

不要开放：

``` text
arbitrary shell command
cmd.exe
powershell
generic execute
```

给 WebView。

------------------------------------------------------------------------

# 47. 开发实施顺序

严格按下面执行。

## Phase A --- Baseline

``` text
inspect
git baseline
dependency check
```

------------------------------------------------------------------------

## Phase B --- Runtime Event Adapter

在不改变 V1 行为的前提下实现：

``` text
incremental session event subscription
```

先测试：

``` text
CLI still works
V1 tests still pass
```

------------------------------------------------------------------------

## Phase C --- Node Agent Bridge

实现：

``` text
JSONL
protocol
runtime adapter
session snapshot
title index
reasoning filtering
tool normalization
```

单独从终端验证：

``` text
stdin JSONL
 ↓
real AgentRuntime
 ↓
stdout JSONL
```

至少能完成 Queen search。

------------------------------------------------------------------------

## Phase D --- Desktop Scaffold

创建：

``` text
Tauri v2
React
TypeScript
Vite
Fluent UI v9
```

先能打开窗口。

------------------------------------------------------------------------

## Phase E --- UI

按 Spec 完成：

``` text
Layout
Sidebar
Empty State
Conversation
Composer
Tool Activity
Activity Drawer
Runtime States
Theme
Accessibility
```

可以先用 fixture data 验证视觉。

但 fixture 不能作为最终实现。

------------------------------------------------------------------------

## Phase F --- Rust Host

实现：

``` text
AgentProcessManager
sidecar lifecycle
JSONL pipes
Commands
Channels
restart
status
paths
env
```

------------------------------------------------------------------------

## Phase G --- Integration

接通：

``` text
React
 ↓
Tauri
 ↓
Rust
 ↓
Node Bridge
 ↓
AgentRuntime
```

删除最终运行路径中的 UI fake data。

------------------------------------------------------------------------

## Phase H --- Session

验证：

``` text
session.list
session.create
session.open
desktop restart
resume
```

------------------------------------------------------------------------

## Phase I --- Real Demo

使用真实 LLM 和真实数据库完成 Spec §24 Demos。

------------------------------------------------------------------------

## Phase J --- Packaging

完成 Windows：

``` text
tauri build
```

验证 installer/bundle。

如果当前环境能安装产物：

> 实际安装并启动。

如果 CI/环境客观限制无法完成安装，可以明确报告，但必须至少完成可生成
Windows bundle 的 build。

------------------------------------------------------------------------

# 48. Tests

不要只靠手工。

至少补充：

## Node Bridge

测试：

``` text
JSONL parse
Envelope
Reasoning filter
Tool normalization
ACCESS_DENIED
Session hydration
Title generation
Unknown tool/event
Protocol malformed input
```

------------------------------------------------------------------------

## React

重点测试 reducer：

``` text
turn/start
tool/call
tool/result
assistant/chunk
turn/end
```

以及：

``` text
business error
session opened
runtime disconnected
```

不要求为每个视觉组件写 snapshot test。

------------------------------------------------------------------------

## Rust

至少测试：

``` text
JSONL protocol deserialize
request routing
process state
```

能纯单测的部分。

------------------------------------------------------------------------

# 49. 原 V1 Test Suite 不得回归

必须再次运行：

``` text
pnpm test
```

或者当前 workspace 的等价全部测试命令。

V1：

``` text
59 tests
```

是历史参考。

如果数量因新增 V2 tests 增长正常。

但：

> 原 V1 核心测试不得被删除或弱化。

------------------------------------------------------------------------

# 50. Build

至少完成：

``` text
TypeScript typecheck
Frontend build
Bridge build
V1 plugin build
cargo check
cargo test
Tauri dev boot
Tauri production build
```

使用当前 workspace 实际命令。

------------------------------------------------------------------------

# 51. 禁止为了通过测试作弊

不能：

``` text
delete failing tests
skip core tests
mock away entire Agent
hardcode Queen answer
hardcode Jazz memory
hardcode order list
fake tool activity
fake streaming timer
```

最终 Demo 必须来自真实：

``` text
DSH Agent
Tool Calling
SQLite
LLM
Session
Memory
```

------------------------------------------------------------------------

# 52. Demo 1

真实桌面 App：

``` text
帮我找 Queen 的专辑
```

必须：

``` text
User bubble
 ↓
正在搜索音乐目录
 ↓
search_catalog real call
 ↓
tool result
 ↓
streaming answer
```

------------------------------------------------------------------------

# 53. Demo 2

``` text
记住我喜欢爵士乐
```

必须真实调用：

``` text
remember
```

------------------------------------------------------------------------

# 54. Demo 3

新 Session：

``` text
你记得我喜欢什么音乐吗？
```

必须真实：

``` text
recall
```

得到 Jazz。

------------------------------------------------------------------------

# 55. Demo 4

``` text
查看我的订单
```

必须真实：

``` text
list_my_orders
```

------------------------------------------------------------------------

# 56. Demo 5

其他客户 Invoice：

``` text
get_invoice_details
 ↓
ACCESS_DENIED
```

Desktop：

``` text
subtle tool failure row
+
safe streamed answer
```

------------------------------------------------------------------------

# 57. Demo 6

关闭 Desktop。

重新启动。

历史 Session：

``` text
Sidebar
 ↓
open
 ↓
restore
 ↓
Conversation
 ↓
Activity Drawer
```

正常。

------------------------------------------------------------------------

# 58. Streaming 验证

不能仅证明：

``` text
final answer exists
```

必须证明：

``` text
assistant/chunk
```

在 turn 完成之前持续进入 React。

请保留可验证 evidence：

``` text
timestamp
seq
event type
```

但不要污染普通 UI。

------------------------------------------------------------------------

# 59. Presentation Reasoning 安全检查

最终加入自动测试或静态检查：

Presentation Protocol / React state：

绝不能出现：

``` text
reasoning-delta
chain-of-thought
reasoning block content
```

如果 DSH Event 中出现 reasoning：

Bridge 丢弃。

------------------------------------------------------------------------

# 60. Architecture Check

最终检查：

## Rust

没有：

``` text
Track
Album
Invoice business query
Memory SQL
Tool logic
```

## React

没有：

``` text
@deepseek-ai/*
better-sqlite3
Node child_process
```

## Chinook Plugin

没有：

``` text
Tauri
React
Rust desktop assumptions
```

## Agent Core

没有：

``` text
Fluent UI
Window
Tauri
```

------------------------------------------------------------------------

# 61. README

更新 README，使新开发者能够：

``` text
install prerequisites
configure env
run V1 CLI
run Desktop dev
run tests
build Desktop
find installer
```

README 必须和真实 commands 一致。

不要删除 CLI 使用方式。

Desktop 是新增 Presentation Layer，不是替换 Agent Core。

------------------------------------------------------------------------

# 62. Documentation

保留：

``` text
docs/DSH_CHINOOK_AGENT_V1_SPEC.md
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

不要把实现细节反向改写 frozen Spec。

如果真实实现出现一个必须记录、但不影响 frozen UX 的工程差异：

新增：

``` text
docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION.md
```

记录：

``` text
runtime wiring
sidecar packaging
commands
build
known implementation constraints
```

不要篡改设计契约来迎合代码。

------------------------------------------------------------------------

# 63. Definition of Done

只有以下全部达到，才能宣布 Desktop V2 完成。

``` text
[ ] V1 tests still pass

[ ] Node Agent Bridge implemented
[ ] stdout JSONL purity verified
[ ] reasoning filtered

[ ] Tauri v2 app implemented
[ ] Rust Host implemented
[ ] Sidecar lifecycle implemented

[ ] React + Fluent UI implemented
[ ] UI matches frozen Spec
[ ] system dark/light works

[ ] session list works
[ ] session create works
[ ] session resume works

[ ] tool activity works
[ ] activity drawer works

[ ] assistant streaming works

[ ] runtime disconnected UI works
[ ] agent restart works

[ ] customer identity still trusted runtime state
[ ] invoice security unchanged
[ ] long-term memory unchanged

[ ] Demos 1–6 pass with real Agent

[ ] cargo check passes
[ ] cargo test passes
[ ] TypeScript build passes
[ ] frontend build passes
[ ] complete test suite passes

[ ] Tauri dev runs

[ ] Windows production build succeeds

[ ] README matches reality
```

------------------------------------------------------------------------

# 64. 不属于 V2 的内容

不要加入：

``` text
Login
OAuth
RBAC

Cloud Sync
SaaS

Shopping Cart
Checkout
Payment
Refund

RAG
Vector DB

Multi-Agent

MCP

Voice
Files
Images

Web Server
REST
WebSocket

Web App

macOS implementation

Auto updater

Settings page

Model picker

Theme picker

Customer switcher

Turn Cancel / Stop Generation
```

------------------------------------------------------------------------

# 65. 遇到技术问题时

不要停下来问用户普通工程问题。

例如：

``` text
Tauri permission
Rust compile
Fluent component API
Node ESM
pnpm workspace
Windows path
sidecar path
JSONL
zstd
process lifecycle
```

都自己：

``` text
inspect
research
implement
run
fix
retest
```

如果某个 Spec 中的 Fluent 图标名称在当前版本不存在：

> 使用语义最接近的 Fluent v9 icon 替代。

这不构成产品设计变更。

------------------------------------------------------------------------

# 66. 不允许擅自降级

如果：

``` text
sidecar packaging
```

困难，不允许改成：

``` text
用户自己启动 pnpm agent
```

如果：

``` text
Tauri Channel
```

困难，不允许改成：

``` text
HTTP
```

如果：

``` text
Streaming
```

困难，不允许改成：

``` text
wait final answer
```

如果：

``` text
Session hydration
```

困难，不允许删除历史会话。

必须继续解决。

------------------------------------------------------------------------

# 67. 外部阻塞

只有例如：

``` text
Windows SDK/Rust/Tauri build tool completely unavailable
required external model credential unavailable
registry/network unavailable and dependency absent
```

才属于真正 external blocker。

即使 Live LLM 因 credential 被阻塞：

仍然继续完成所有：

``` text
code
build
offline tests
desktop integration
```

最后将：

``` text
Live Acceptance
```

标为 BLOCKED。

不要因此停止整个实施任务。

------------------------------------------------------------------------

# 68. 最终 Implementation Report

完成后输出：

# DSH Chinook Desktop V2 --- Implementation Report

必须包含：

## Final Status

``` text
COMPLETE
```

或：

``` text
PARTIAL / BLOCKED
```

不能模糊。

------------------------------------------------------------------------

## Architecture

给出实际最终链路：

``` text
React
→ Tauri
→ Rust
→ Node Bridge
→ AgentRuntime
→ DSH
```

------------------------------------------------------------------------

## Files

列出新增/修改核心文件。

------------------------------------------------------------------------

## Runtime Adapter Changes

明确说明：

``` text
V1 AgentRuntime
```

实际做了哪些 additive change。

证明没有修改 business behavior。

------------------------------------------------------------------------

## Commands

实际：

``` text
install
test
desktop dev
desktop build
```

------------------------------------------------------------------------

## Tests

真实数字：

``` text
test files
passed
failed
skipped
```

------------------------------------------------------------------------

## Build

真实：

``` text
frontend
TypeScript
Rust
Tauri
```

结果。

------------------------------------------------------------------------

## Live Demo

报告 Demos 1--6 的真实结果。

必须包含：

``` text
tool call evidence
streaming evidence
session resume evidence
```

------------------------------------------------------------------------

## Packaging

说明：

``` text
Windows bundle
```

生成位置和实际结果。

------------------------------------------------------------------------

## Architecture Integrity

确认：

``` text
React has no Agent business logic
Rust has no Chinook business logic
Node Bridge is transport only
Agent Core remains Agent Core
```

------------------------------------------------------------------------

## Known Limitations

只列真实 V2 限制。

不要把 Non-goals 当 Bug。

------------------------------------------------------------------------

# 69. 最终原则

最重要的是：

> 不要重新设计。

产品设计已经完成：

``` text
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

Agent 设计也已经完成：

``` text
docs/DSH_CHINOOK_AGENT_V1_SPEC.md
```

你现在只负责：

# 把两份已经冻结的设计连接起来，变成一个真正可以运行的 Windows Desktop Agent Application。

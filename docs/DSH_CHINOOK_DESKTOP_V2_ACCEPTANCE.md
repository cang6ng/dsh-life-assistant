# DSH Chinook Desktop V2 --- Independent Acceptance Contract

> 本文件定义 Desktop V2 的独立只读验收协议。验收对象是当前仓库中的真实
> Desktop V2 实现，而不是 Implementation Agent 的报告。
>
> **核心原则：不要相信任何 COMPLETE、测试数字、Demo
> 结论或安装验证声明。只相信冻结契约、当前仓库、实际源码、命令执行结果和
> Auditor 亲自获得的运行证据。**

## 0. 验收角色

执行者是 **Independent Read-Only Desktop Acceptance Auditor**。

任务不是开发、修复、重构、优化、补测试或改 Spec，而是独立判断当前 DSH
Chinook Desktop V2 是否真正满足冻结契约和 Definition of Done。

发现问题时严格执行：

``` text
记录证据 → 判定 FAIL → 继续其余可执行验收
```

禁止"顺手修一下"。

## 1. 必读契约

完整阅读：

``` text
docs/DSH_CHINOOK_AGENT_V1_SPEC.md
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION_CONTRACT.md
docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION.md
README.md
```

并检查
`package.json`、workspace、`apps/cli/`、`apps/agent-bridge/`、`apps/desktop/`、`plugins/chinook/`、`profiles/chinook/`、`tests/`。

Implementation 文档和之前的 COMPLETE
报告只能作为**待核实线索**，不能作为证据本身。

## 2. 绝对只读

不得修改源码、Rust、React、Bridge、测试、README、Spec/Contract、依赖、lockfile、Cargo、Tauri
config/capability、Profile、AgentRuntime、Plugin、Tool
schema、Session、Memory、Identity，也不得删除/skip/弱化测试或提交 Git。

如果 Build/Test/Runtime/Packaging/Live Demo 失败，记录：

``` text
FAIL
原因：
证据：
影响：
Severity：
建议修复方向：
```

然后继续其他验收。

## 3. Repository Baseline / Integrity

开始前记录：

``` bash
git status --short
git diff --stat
git diff
git diff --cached --stat
git diff --cached
```

结束后再次执行并比较。Auditor 不得造成 tracked
source/config/document/test 变化。

允许 Build/Test 产生 gitignored 的
`target/`、`dist/`、runtime、logs、cache、临时 DSH_HOME、installer
artifacts，但不得删除验收前已有用户数据。

最终报告必须说明 Baseline/Final Git status、是否修改 tracked
files、产生了哪些 runtime/build artifacts。

## 4. 验收流程

``` text
Inspect
→ Static Architecture Audit
→ V1 Regression Audit
→ Bridge / Protocol Audit
→ Frontend / UI Audit
→ Rust / Tauri Audit
→ Build Verification
→ Offline Test Verification
→ Runtime Verification
→ Live End-to-End Verification
→ Packaging / Installed-App Verification
→ Security / Credential Verification
→ Repository Integrity Check
→ Final Verdict
```

不得进入 Implement / Fix。

## 5. 冻结架构

独立确认真实实现仍是：

``` text
React + Fluent UI
→ Tauri Commands / Channels
→ Tauri v2 Rust Host
→ stdin / stdout JSONL
→ Node Agent Bridge
→ existing AgentRuntime
→ DSH + Chinook Plugin + SQLite + LLM
```

不得退化为 HTTP/REST/WebSocket、React 直连 SQLite、Rust 承担 Chinook
业务或 Rust 重写 Agent。

## 6. V1 Core Regression Boundary

重点审计 `apps/cli/src/runtime.ts` 或等价 Runtime。允许的变化只有
Implementation Contract 所允许的 **additive-only integration
change**（如 Event Sink / Session Event Subscription）。

确认没有改变 Agent business behavior、7 Tool
schema、Identity、Memory、Session semantics、Invoice
ownership、Service/Storage business rules 和 CLI 原有行为。

## 7. Layer Boundary

### React

不得包含 `@deepseek-ai/*`、`better-sqlite3`、`child_process`、Chinook
SQL、Invoice ownership、Memory SQL、LLM credential 或 Tool 实现。

### Rust

只负责 window/lifecycle/sidecar/stdin-stdout/IPC/paths/env/restart/event
forwarding，不得包含 Track/Album/Invoice/Memory 等业务查询或 Agent
orchestration。

### Node Bridge

只负责 JSONL、protocol、runtime/session adapter、title index、event
normalization、reasoning filtering；不得成为第二个 Agent Runtime。

### Chinook Plugin / Agent Core

不得出现 Tauri、Fluent UI、React、Windows window 或 Rust desktop
assumptions。

## 8. 技术栈

确认主路径使用：

``` text
Tauri v2 stable
Rust
React
TypeScript
Vite
@fluentui/react-components
@fluentui/react-icons
```

不得以 Electron/NW.js/Tauri 3 prerelease/旧 Fluent UI 或
Tailwind/Bootstrap/MUI/Ant/Chakra 替代冻结技术栈。区分 active dependency
与 legacy artifact。

## 9. Node Agent Bridge

确认真实链路：

``` text
stdin JSONL
→ parse request
→ existing AgentRuntime
→ normalize DSH events
→ stdout JSONL
```

检查 protocol、runtime adapter、session adapter、JSONL、title
index、error handling。不得是 mock/fake runtime。

## 10. stdout JSONL Purity

硬要求：

``` text
stdout = JSONL protocol only
```

debug、boot log、warning、stack trace、diagnostic 必须走
stderr。通过静态检查和 Bridge 实际启动/交互双重验证。任何非 JSONL stdout
行均 FAIL。

## 11. Presentation Protocol

验证 Envelope 至少体现：

``` text
protocolVersion
requestId
sessionId
turnId
seq
type
data
```

普通 Request 至少支持：

``` text
session.list
session.create
session.open
agent.status
agent.restart
turn.send
```

确认不存在 V2 主动 `turn.cancel`。

Streaming Events 至少支持实际需要的：

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

允许最小实现差异，但不得改变冻结语义。

## 12. Correlation / Sequence

检查 requestId/sessionId/turnId/seq 能正确关联 Request、Turn、Streaming
Event。同一 Turn 的 seq 应可排序、不无故倒退、不跨 Turn 混淆。

## 13. Reasoning Filtering

硬性安全要求：

``` text
DSH reasoning-delta / reasoning block
→ Node Bridge DROP
→ Presentation Protocol / React 永远不可见
```

执行静态检查、自动测试；如 Live DSH 产生 reasoning，确认 Presentation
输出无对应内容。若 hidden reasoning 进入 React/UI/Drawer：**P0 FAIL**。

## 14. Tool Result Normalization

重点检查 `ACCESS_DENIED`、`NOT_FOUND` 等业务失败。

必须区分：

``` text
successful DSH tool/result event + business payload ok:false
```

与 Runtime/IPC crash。ACCESS_DENIED 不得导致 runtime
disconnected/full-screen crash。

## 15. Session Snapshot / Hydration

`session.open` 必须恢复 Frozen Spec 要求的 session/items/log 或等价
Presentation Snapshot：

``` text
DSH Session persistence
→ Node Bridge parses/normalizes
→ React consumes presentation model
```

Rust/React 不得直接理解 DSH Session persistence。必须实际验证历史
Session 恢复。

## 16. Session Title Index

标题不能默认 UUID，应按 first user message → trim → collapse newline →
24 chars → ... 规则生成。若有 `desktop-session-index.json` 或等价
index，确认它只是 disposable Presentation Index，不替代 Session
Core/业务数据库，且位于合理 app data/DSH_HOME。

## 17. Rust Desktop Host / Process Manager

确认 Rust 只负责 Desktop Host 职责。检查 AgentProcessManager
或等价实现是否覆盖 spawn/shutdown/restart/status/send JSONL/read
JSONL/request routing/event forwarding，且没有复杂不必要的业务框架。

## 18. One Long-Lived Sidecar

确认应用生命周期内使用一个 long-lived Agent sidecar，而不是每条 User
Message spawn Node。可观察 PID 时记录证据。

## 19. Sidecar Crash / Restart

验证或通过可信现有测试证明：

``` text
sidecar exit / pipe broken
→ Rust detects
→ runtime/status disconnected
→ UI disconnected state
→ manual restart
→ restarting
→ ready
```

不得无限自动 crash loop。不得修改代码制造测试条件。

## 20. Tauri IPC Boundary

确认普通操作使用 Tauri Commands，Streaming Turn 使用 Tauri Channel 或
Frozen Spec 等价 Tauri v2 mechanism。

禁止 REST/HTTP/SSE/WebSocket。不得一 Tool 一 Command；必须是
`turn_send → Agent chooses tool`。

## 21. Sidecar Capability Security

WebView 不得获得 arbitrary shell、cmd.exe、powershell 或 generic
execute。Capability 应最小化到必要 bundled sidecar。若 WebView
可任意执行系统命令：**P0 FAIL**。

## 22. Frozen UI Compliance

依据 `DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md` 检查核心能力是否存在：

``` text
DesktopShell / TitleBar / RuntimeStatus
SessionSidebar / NewSession / SessionList
Conversation / EmptyState / User / Assistant
ActivityStrip / ToolRow / ToolDetail
Composer / ScrollToBottom
ActivityDrawer / RuntimeStateCard / StatusBar
```

不要求文件名机械一致。

## 23. Window / Layout

验证 Frozen Spec 的近似约束：

``` text
default ≈ 1050×700
minimum ≈ 640×520
sidebar ≈ 264px
conversation max ≈ 760px
drawer ≈ 360px
<900px sidebar collapse
```

验证单窗口及 minimize/maximize/restore/close/drag/double-click maximize
等正常 Windows 行为。

## 24. Fluent UI / Theme

确认主 UI 使用 Fluent v9、Fluent icons、makeStyles/tokens。验证 Follow
System、Light、Dark 机制；首期无需 Settings/Theme Picker。

## 25. Frontend State Model

确认 React 消费 Desktop Presentation Event，而不是 DSH 内部类型。优先
useReducer/Context/hooks；若出现
Redux/MobX/Zustand，检查是否违反冻结约束。

## 26. Real Streaming

核心硬验收：

``` text
assistant/chunk
→ 多次增量进入 Presentation/React
→ turn/end
```

必须保留 timestamp/seq/event type 等证据，证明多个 chunk 在 turn/end
之前到达。不能用最终长文本、fake timer 或 final-answer slicing 冒充
Streaming。

## 27. Auto Scroll

验证 bottom 时 chunk
自动跟随；用户手动上滚后停止抢滚动并出现"回到最新消息"。

## 28. Markdown Safety

确认 raw HTML disabled、images disabled，不允许 script/HTML 注入，并支持
Frozen Spec 所需基本 Markdown。明显 WebView XSS 风险按 P0/P1 判定。

## 29. Agent Activity

Activity 必须来自真实 tool/call、tool/result，而非 fake data。主 UI
默认不得 dump raw JSON；arguments/result 只能在详情/Drawer 第二层展示。

## 30. Seven Tool Metadata

集中 metadata 应覆盖：

``` text
search_catalog
find_similar_albums
popular_in_genre
list_my_orders
get_invoice_details
remember
recall
```

并具有 Unknown Tool fallback。

## 31. Activity Drawer

确认默认关闭、约 360px overlay、存在"活动"入口及 Frozen Spec
规定的筛选/详情能力。可观察 turn/tool/chunk/end；Reasoning 永远不存在。

## 32. Session UX

验证 New Session、Today/Yesterday/Earlier、Session
Open/Restore。标题不默认 UUID。Active Turn 期间 session switching/new
session/composer 应锁定直到 turn/end。

## 33. Empty State

确认三个入口：

``` text
帮我找 Queen 的专辑
推荐一些爵士乐
查看我的最近订单
```

点击后发送真实 User Turn，不得是假 Demo。

## 34. Runtime / Business Error UX

确认 starting/ready/restoring/disconnected/error/restarting。普通 UI
不直接 dump Rust/Node stack。

foreign invoice 的 ACCESS_DENIED 应是 subtle business failure + safe
assistant response，不得变成 Runtime crash，也不得泄露 owner customer
ID/name/email/address/purchase history。

## 35. App Data / DSH_HOME

正式 Desktop runtime 应使用 Tauri app data，Sidecar 使用等价：

``` text
DSH_HOME=<desktop app data>/agent
```

确认 Chinook DB、Memory DB、Session、Profile 在 packaged/installed
环境按真实规则找到，不依赖开发机绝对路径。

## 36. Credential Discipline

真实 API key/token 不得写入
source/frontend/tauri.conf/git/installer/bundled JS。允许 host env →
Rust forward → sidecar。React 永远不能获得模型 credential。

如发现真实 credential 被提交/打包：**P0 FAIL**。最终报告不得回显 secret
值，只报告位置和类型。

## 37. V1 / Bridge / React / Rust Tests

亲自执行当前完整测试。Implementation Report 的 `113/113` 和 `15/15` 只是
claims。

记录真实：

``` text
test files
passed
failed
skipped
exit code
```

确认原 V1 核心测试未被删除、skip 或实质弱化。

特别检查 architecture guard 跳过
`node_modules/target/dist/generated runtime vendor`
是否只是排除第三方生成物，而不是把项目源码排除。

Bridge 测试应可信覆盖 JSONL、Envelope、Reasoning filter、Tool
normalization、ACCESS_DENIED、Session
hydration、Title、Unknown/malformed input。

React 重点覆盖
turn/start、tool/call、tool/result、assistant/chunk、turn/end、business
error、session opened、runtime disconnected。

Rust 至少覆盖 JSONL deserialize、routing、process state、path handling
等可单测核心。

## 38. Build Verification

使用 README/package/Cargo 的真实命令完成等价：

``` text
TypeScript typecheck
V1/plugin build
Bridge build
Frontend build
cargo check
cargo test
Tauri production build
```

如环境支持，执行 Tauri dev boot。记录关键 command、exit
code、result。禁止修代码。

## 39. Runtime Boot

实际启动 Desktop dev 或正式开发入口，确认：

``` text
Tauri App
→ Rust Host
→ Node Bridge
→ AgentRuntime
→ runtime/status ready
→ React usable
```

## 40. Bridge Standalone Real Probe

有合法 credential 时，从终端验证：

``` text
stdin JSONL
→ real AgentRuntime
→ real Tool Calling
→ stdout JSONL
```

至少一个真实业务 query，并同时验证 stdout purity。无 credential 则 Live
部分 BLOCKED，但继续 offline 验收。

## 41. Live Demo 1 --- Queen

输入：

``` text
帮我找一些 Queen 的专辑。
```

必须真实观察：

``` text
turn/start
→ tool/call search_catalog
→ Chinook SQLite result
→ tool/result
→ assistant/chunk × N
→ turn/end
```

不能仅凭模型知识回答。

## 42. Live Demo 2 --- Remember Jazz

输入：

``` text
记住我喜欢爵士乐。
```

必须真实调用 `remember`。优先使用隔离 app data，避免污染正式用户数据。

## 43. Live Demo 3 --- Cross-Session Recall

新 Session 输入：

``` text
你记得我喜欢什么音乐吗？
```

必须真实调用 `recall` 并从长期 Memory 得到 Jazz，而不是上一 Session 短期
context。

## 44. Live Demo 4 --- Orders

输入：

``` text
查看我的订单。
```

必须真实调用 `list_my_orders`，结果只属于可信 Demo Identity。

## 45. Live Demo 5 --- Foreign Invoice

选择不属于当前 Demo Customer 的 invoice，必须：

``` text
get_invoice_details
→ ACCESS_DENIED
```

验证 Runtime 不 crash、UI 业务拒绝、安全自然语言回答、Tool
原始结果不泄露 owner identity。

## 46. Live Demo 6 --- Desktop Restart / Resume

完成明确对话后关闭 Desktop，重新启动，再从 Sidebar 打开历史
Session。确认 User/Assistant/Tool Activity/Turn state 按 Frozen Spec
hydration。

## 47. Streaming Evidence

至少记录一个真实 Turn：

``` text
assistant/chunk(seq=a,time=t1)
assistant/chunk(seq=b,time=t2)
...
turn/end(seq=z,time=tN)
```

多个 chunk 必须在 turn/end 前到达。

## 48. Tool Event Sanity Check

Implementation Report 曾声称某次 probe 出现：

``` text
171 assistant chunks
168 tool/call events
```

不得直接相信或直接判错。独立核实：

1.  是否统计口径/描述错误；
2.  是否真有单 Turn 168 次 Tool；
3.  是否把其他 event 数量误写成 tool/call；
4.  是否存在 duplicate forwarding、event replay、listener duplication；
5.  React 是否重复显示 Activity。

若简单 Turn 确有异常大量重复 Tool Calls，按影响判
P0/P1。最终报告必须明确核实结论。

## 49. Packaging

亲自执行 Tauri production build，记录真实 NSIS/MSI
产物、大小、路径。历史 54.8MB/102.0MB 不作为当前证据。

## 50. Packaged Runtime Self-Containment

最终用户不得额外安装 Node/pnpm/repo node_modules。确认 bundle/resource
包含运行所需 Node runtime、compiled Bridge、Agent JS/runtime
resources、DSH dependencies/profile、Chinook read-only data。

## 51. Repo-Free Closure Probe

尽可能将 stamped/bundled runtime 放到没有 repository
ancestor/node_modules fallback 的隔离位置运行。

确认至少：

``` text
sidecar boot
session.create
real business turn（credential 可用）
turn/end
```

无 credential 时至少完成 boot/protocol/session，并将 Live 标 BLOCKED。

## 52. Installed-App Verification

Windows 环境允许时，实际安装 NSIS/MSI 并启动 installed exe：

``` text
launch
→ sidecar ready
→ runtime ready
→ real user turn
→ tool calling
→ streaming
→ session history
```

环境客观不能安装时可 BLOCKED，但不得用 dev mode 冒充 installed PASS。

## 53. Runtime Tree Location

确认 installed runtime state 位于合理 `%LOCALAPPDATA%` / `%APPDATA%` /
Tauri app data，而非 repo、硬编码 developer path 或 source tree。

## 54. Dependency Closure / Prune

独立检查 stamping/prune：

-   动态 resolve 所需依赖被包含；
-   不依赖 repo ancestor；
-   不把禁用 capability 面重新打包；
-   不误删运行必要包；
-   构建可重复。

历史 `527 kept / 88 removed / 297 MB` 只是 claim，以当前 build +
repo-free probe 为准。

## 55. No Fake Business / Streaming

静态搜索+runtime 验证 production path 不存在 hardcoded
Queen/Jazz/orders/invoice、fake tool activity timer、fake assistant
streaming timer。Fixture 可用于测试/视觉开发，但不得进入 production
主路径。

## 56. V2 No Stop / Cancel

确认没有 Stop Generation、Cancel Generation、turn.cancel。Active Turn
期间 composer/session switch/new session 锁定直到
turn/end。允许只读渲染历史 `turn/end reason.aborted`。

## 57. Accessibility

检查 keyboard navigation、focus visible、screen reader labels、button
aria labels、contrast、reduced motion。无需企业级 WCAG
文档，但核心功能明显不可键盘操作应按影响判 P1/P2。

## 58. README / Documentation

README 应真实覆盖 prerequisites、install、env、V1 CLI、Desktop
dev、tests、Desktop build、installer location，且命令与实现一致。

确认 Frozen Spec/Contract 保留，Implementation 文档没有反向篡改 frozen
contract 来迎合代码。

## 59. Non-goals

以下不存在不得判缺陷：

``` text
Login/OAuth/RBAC
Cloud Sync/SaaS
Cart/Checkout/Payment/Refund
RAG/Vector DB/Multi-Agent/MCP
Voice/Files/Images
Web Server/REST/WebSocket/Web App
macOS implementation
Auto updater
Settings/Model picker/Theme picker/Customer switcher
Turn Cancel / Stop Generation
```

## 60. External Blocker

只有 credential/endpoint/Windows SDK/Rust/Tauri build
tools/registry/network/installer execution 等真正外部条件才能 BLOCKED。

代码 bug、compile error、test failure、packaging bug必须 FAIL。

即使 Live LLM BLOCKED，也继续 static/offline/build/packaging/protocol
验收。

## 61. Severity

``` text
P0 — V2 无法运行；严重安全/credential/COT 泄露；架构根本失效
P1 — Frozen Spec / DoD 核心能力不满足
P2 — 非阻塞但真实质量/UX/工程问题
P3 — 建议项，不影响验收
```

只有 P0=0、P1=0 且核心 Live/Packaging DoD 有真实证据才允许 PASS。

## 62. Final Verdict

最终只能：

### PASS

Frozen architecture、V1 regression、Bridge/JSONL/reasoning
filter、Rust/Tauri、React、真实 streaming/tool
activity、Session、restart、Identity/security/memory、Demos
1--6、Tests、Build、Windows bundle、自足 packaging、README、Repository
Integrity 全部满足。

### FAIL

存在代码/架构/安全/测试/runtime/streaming/session/packaging
问题。即使只需改一行，Auditor 也必须 FAIL，不允许修。

### BLOCKED

仅因真正外部条件无法完成关键验收。若 Static/Offline/Build 全通过但 Live
credential 缺失，最终仍为 BLOCKED，不能 FULL PASS。

## 63. Final Acceptance Report

严格输出：

# DSH Chinook Desktop V2 --- Independent Acceptance Report

### Final Verdict

`PASS / FAIL / BLOCKED` + 一句话原因。

### 1. Repository Integrity

Baseline Git status；Final Git status；Auditor modified tracked files
YES/NO；Generated artifacts。

### 2. Contract Compliance

表格至少包含 Frozen architecture、V1 Core boundary、React/Rust/Bridge
boundary、Tauri/Fluent stack、JSONL purity、Presentation
Protocol、Reasoning filtering、Tool normalization、Session
hydration、Credential discipline、No V2 overengineering。

### 3. Build Verification

真实命令、exit code、结果。

### 4. Test Verification

Vitest/test files/passed/failed/skipped/exit code；Cargo
passed/failed/skipped/exit code；V1 regression。

### 5. Runtime Verification

Tauri dev、Sidecar boot、runtime/status、restart。

### 6. Live Demo Acceptance

Queen/search_catalog；Remember/remember；Cross-session/recall；Orders/list_my_orders；Foreign
invoice/ACCESS_DENIED；Desktop restart/session hydration。每项
PASS/FAIL/BLOCKED。

### 7. Streaming Evidence

至少一个真实 turnId、first/later chunk seq/time、turn/end
seq/time、turn/end 前 chunk 数；结论 REAL STREAMING/FAIL/BLOCKED。

### 8. Tool Event Sanity

专门核实 `171 assistant chunks / 168 tool/call events`，说明是否
duplicate forwarding/listener duplication/replay/统计错误/异常重复调用。

### 9. Packaging

Tauri production build、NSIS、MSI、bundle paths。

### 10. Repo-Free / Installed-App

Repo-free probe、installed EXE boot、real Agent turn、streaming、session
resume、app-data paths。

### 11. Security

Reasoning never reaches Presentation；credential absent from
source/bundle/frontend；arbitrary shell unavailable；Invoice ownership
unchanged；Memory isolation unchanged。

### 12. UI / UX Frozen Spec

Main Window、Sidebar、Empty State、Conversation、Composer、Tool
Activity、Activity Drawer、Runtime
States、Light/Dark、Responsive、Accessibility。

### 13. Issues

按 P0/P1/P2/P3 列出；没有则 `None.`，不要凑数。

### 14. Known V2 Limitations

只列 Frozen Spec 允许或真实但不阻塞 V2 的限制，不把 Non-goals 当 Bug。

### 15. Final Recommendation

PASS：

> **DSH Chinook Desktop V2 independently accepted. Desktop V2 can be
> frozen as the completed Windows desktop implementation.**

FAIL：

> **Do not freeze Desktop V2. Fix the listed P0/P1 acceptance failures
> first, then run a new independent read-only acceptance.**

BLOCKED：

明确解除哪些外部条件后才能完成最终验收。

## 64. 最终原则

不要相信 Implementation Agent 的
COMPLETE、113/113、15/15、NSIS/MSI、repo-free probe、installed
demo、streaming/session hydration 等声明。

它们全部是 **claims to verify**，不是 **facts to inherit**。

**发现错误 ≠ 修复错误。**

最终目标不是证明上一位 Agent 是对的，而是：

# 独立判断当前仓库中的 Desktop V2 到底是否真的完成。

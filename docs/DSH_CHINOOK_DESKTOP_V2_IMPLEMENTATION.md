# DSH Chinook Desktop V2 — Implementation Notes

工程实现记录（非设计契约）。冻结的设计见：

- `docs/DSH_CHINOOK_AGENT_V1_SPEC.md`（Agent Core）
- `docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md`（桌面 UX / 交互 / 呈现协议）
- `docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION_CONTRACT.md`（实现合同 §0–§69）

本文只记录真实实现与工程决策：runtime wiring、sidecar packaging、commands、
build、以及必须记录但不影响 frozen UX 的实现约束。设计契约从未被改写来迁就
代码；若两者冲突，以本文为准的地方都只是实现层解释。

---

## 1. 总体形态

一个 Agent Core、两种 Presentation：

```
React + Fluent UI (WebView2)
   │  invoke() / Channel events          apps/desktop/src
   ▼
Tauri v2 Rust host (commands + channel)  apps/desktop/src-tauri/src
   │  stdin/stdout JSONL，单 sidecar 长驻  agent/process.rs
   ▼
Node Agent Bridge (transport only)       apps/agent-bridge/src
   │  同一 AgentRuntime（CLI 也在用）
   ▼
DSH runtime → chinook profile → chinook-dsh-plugin → SQLite / LLM
```

Rust host 不持有任何 Chinook 业务逻辑；React 不持有 Agent 业务逻辑；Bridge
是纯 transport adapter（§9）；Agent Core 保持 V1 原样，唯一改动是按 §6 允许的
增量：`apps/cli/src/runtime.ts` 暴露事件出口（其余文件未动）。

## 2. Runtime wiring

### DSH_HOME 选择（`lib.rs`）

| 构建 | DSH_HOME | launch |
|---|---|---|
| dev（debug_assertions） | `<repo>/.dsh`（与 CLI 共享，`pnpm bootstrap` 准备） | `dev_launch`：系统 `node` + `apps/agent-bridge/dist/bridge.mjs`，无 `CHINOOK_BOOT_RESOURCES` |
| 安装包（release） | `app.path().app_data_dir()/agent` → `%APPDATA%\com.dsh.chinook\agent` | `packaged_launch`：bundled `runtime/node/node.exe` + `runtime/bridge/bridge.mjs`，cwd=`runtime/bridge`，env `CHINOOK_BOOT_RESOURCES`=runtime 目录 |

`spawn_manager` 预建 `sessions/`、`data/`；Rust 只负责 path/dir/env，SQLite、
DSH session、memory 全部在 Node 侧按 DSH_HOME 实际路径规则解析（§42/§43）。

### Credentials（§44）

- API key 只存在于运行进程 env（`DEEPSEEK_API_KEY` 或 `ANTHROPIC_AUTH_TOKEN`）；
  source / tauri.conf.json / frontend / git 一律不含 key。
- Rust `Command` 默认继承宿主 env → sidecar 拿到 key；React 从不接收 credential。
- 安装后的 app 从启动它的 shell 继承 env（Windows 上即资源管理器/快捷方式
  所在进程的 env 快照）。

### 事件流

Bridge stdout 只输出协议行（§10）；一切诊断走 stderr。Rust 侧 stdout reader
按 envelope 区分：带 `requestId` → router 应答；否则 → EventBus → Tauri
Channel → React。sidecar 崩溃（stdout EOF）→ `runtime/status disconnected`，
仅显式 `agent_restart` 可恢复（§21，无自动重启循环）。

## 3. Bridge 实现要点

- 请求类型：`session.list / create / open`、`turn.send`、`agent.status`；
  `agent.restart` 是宿主级操作（Rust kill+respawn，不经过 bridge）。
- `turn.send` 先同步应答 `{accepted:true}` 再流式推送 `turn/start … turn/end`；
  `TURN_ACTIVE / NOT_READY` 状态机防并发。
- Reasoning 不上报（§14）；工具结果归一化（§15）；session title 记账 + 磁盘
  index（§17）；打开会话时快照 hydration（items/log）。
- `apps/agent-bridge/build.mjs` 把 src 打成单文件 ESM `dist/bridge.mjs`
  （esbuild），打包时被 stamp 进 runtime。

## 4. Sidecar packaging（`stamp-runtime.mjs`）

`tauri build` 之前运行（幂等，整体重建）。产物 `apps/desktop/src-tauri/runtime/`：

```
runtime/
  node/node.exe          捆绑的 Node 解释器（从构建机 process.execPath 复制）
  bridge/bridge.mjs      编译后的 bridge bundle
  node_modules/          运行时依赖闭包的“真实文件”拷贝（去 junction/去引用）
  home-template/         首启 DSH home 镜像：data/{chinook.db,memory.db schema}
                         + profiles/chinook/{package.json,cordis.yml,cordis.patch.yml}
```

依赖闭包收集：从 repo-root manifest 的 `@deepseek-ai/*` + 白名单顶层包
（better-sqlite3、chinook-dsh-plugin）出发，按 **pnpm 真实 store 目录**（每个包
从它自己 realpath 处解析声明依赖）BFS 出完整集合（582 包），以真实文件复制到
flat `node_modules/`（Node 式向上解析可命中）。

### Prune（对可达启动闭包求交）

dev graph 会带入全部 monorepo capability（webhooks/MCP/ACP/shells/subagents、
pi-ai/Bedrock/OpenAI/Google SDK、ripgrep、sharp、koffi、…），而 chinook
profile 禁用了对应 rows —— 安装包不需要它们。

- **anchors** = profile bundles ∪ dsh-base patch 中未被 profile patch 禁用的 row
  包（85 rows − 34 disabled = 51，+2 bundles = 53）∪ bridge.mjs 的裸导入。
- **keep**：从 anchors 做静态 bare-import BFS（`from/require/import()` 正则），
  解析按 Node 语义向上找 `<dir>/node_modules/<spec>`；exports-map subpath
  （如 `eventsource-parser/stream`）无物理文件 → 回退包根。
- **bridge 动态锚（踩坑教训）**：AgentRuntime 的安装锚点
  `@deepseek-ai/dsh/package.json` 在 runtime.ts 里是
  `createRequire(...).resolve(...)` 字面量，**没有**任何静态 import —— 初版
  prune 漏掉它，真安装后 boot 在 bridge.mjs 顶层
  `Cannot find module '@deepseek-ai/dsh/package.json'` 崩溃（repo 内测试因
  祖先 node_modules 遮蔽看不见）。修复：bridge.mjs 额外扫描
  `.resolve("pkg")` 动态字面量（RESOLVE_LITERAL），只扫 bridge 入口文件——
  普通包内该类调用都指向 manifest 已声明的 loader，由 manifest pass 覆盖；
  全树扫描会让扁平闭包的“可达性图”近乎全连通，prune 失效。
- **row 排除**：`@deepseek-ai/dsh` 是 kitchen-sink app manifest（直接声明
  50+ capability 包，含全部被禁用 rows）。rows 永远由 cordis patch 按名装载
  （启用的已在上层锚定），因此 manifest pass 对 base patch 出现过的 row 名
  一律跳过 —— 否则 dsh 的 manifest 会把整个禁用 capability 面（mcp/acp/
  pwsh/terminal/hooks/provider SDK…约 +139 包、+250 MB）重新拉进闭包。
- **manifest pass**：sharp 这类 loader 运行期按平台动态 require 平台二进制
  （`@img/sharp-win32-x64`），静态扫描看不见 → 对 kept 包 manifest 声明的
  dependencies/optional/peer 全保留（fixpoint 后补扫静态导入），但剔除
  `FOREIGN_PLATFORM`（darwin/linux/musl/freebsd/wasm32/arm64/… 变体）与
  landlock（Linux-only）。
- **平台变体清扫**：loader 的平台二进制从 loader 自己的**嵌套**
  node_modules 解析（pnpm 只装当前平台），顶层扁平副本里其它目标的
  `@img/sharp-*` / `@koromix/koffi-*` 变体是死重 → 删除循环对名字匹配
  `FOREIGN_PLATFORM` 的顶层条目一律删除。
- 结果：527 kept / 88 removed，释放约 297 MB（node_modules ≈ 288 MB）。

### 首启 provisioning 与 heal

home-template 用真实文件（无 junction）；bridge `home.ts` 首次启动拷到
DSH_HOME 并写 `.desktop-provisioned` 标记（部分拷贝由重拷修复）。profile 的
`node_modules` **不 stamp**：DSH 启动 heal（dsh-app-boot `healProfilesModuleFallback`）
把安装闭包镜像到 `<home>/profiles/node_modules`、把 bundle 依赖闭包镜像到
profile 本地。

**实现约束（重要）**：heal 的 installAnchor 是 `@deepseek-ai/dsh` 的
package.json（`apps/cli/src/runtime.ts`），因此镜像集合 = dsh 依赖闭包，
**不含 profile 自选 bundle 本身**（如 `chinook-dsh-plugin`）。dev 下该 import
向上走到 repo `node_modules` 恰好命中；packaged home 位于 `%APPDATA%`，没有
这个祖先。修复：`home.ts linkProfileBundleFallbacks()` 每次启动把 profile
manifest 声明的 bundles 以 junction 链到 `<home>/profiles/node_modules/`
（junction 无需管理员权限、永远指向当前 runtime 拷贝，避免升级后陈旧副本）。
heal 只增不改自己的条目列表，两者互不干扰。

### 路径前缀（实现约束）

tauri v2 的 `resource_dir()` 在 Windows 可能返回 `\\?\C:\…` verbatim 长路径；
把它原样放进 sidecar argv/cwd/env 后，node 主模块解析会退化成 drive letter
（症状 `EISDIR: illegal operation on a directory, lstat 'C:'`）。`process.rs`
的 `portable_path()` 在 `packaged_launch` 里剥掉 `\\?\`（含 `\\?\UNC\` 形态），
带回归单测。

## 5. Commands

```bash
pnpm install                 # 根 devDeps 含 @tauri-apps/cli
pnpm bootstrap               # 校验 data/chinook.db、建 .dsh（dev home，CLI/桌面共享）

# 桌面 dev（热更）：
cd apps/desktop && node ../../node_modules/@tauri-apps/cli/tauri.js dev
# （apps/desktop 刻意没有自己的 package.json）

# 测试：
pnpm test                    # vitest：V1 + bridge unit/integration + desktop reducer + e2e
cd apps/desktop/src-tauri && cargo test

# 生产安装包：
node apps/agent-bridge/build.mjs             # 1. bridge bundle
node apps/desktop/scripts/stamp-runtime.mjs  # 2. runtime 镜像（幂等）
node apps/desktop/scripts/pack-smoke.mjs     # 3. 可选冒烟（真实 turn，需模型 key）
cd apps/desktop && node ../../node_modules/@tauri-apps/cli/tauri.js build
# 产物：src-tauri/target/release/bundle/nsis/DSH Chinook_0.2.0_x64-setup.exe
#      src-tauri/target/release/bundle/msi/DSH Chinook_0.2.0_x64_en-US.msi
```

`tauri.conf.json` `bundle.resources` 用字符串数组 `["./runtime"]`（资源以原
目录结构落到 `$RESOURCE/runtime/…`；对象映射数组 `[{from,to}]` 不是合法
schema）。安装布局即 `%LOCALAPPDATA%\DSH Chinook\runtime\{node,bridge,
node_modules,home-template}`，与 `packaged_launch` 期望一致。

## 6. Build 与验证结果（真实）

- 前端：`vite build`（build-frontend.mjs，2191 modules，~495 kB js）。
- Rust：`cargo test` 15/15（含 portable_path 回归、真实 sidecar JSONL 集成）。
- vitest：113/113（bridge unit/integration、desktop reducer、V1 全部套件）。
- pack-smoke：stamped runtime 上真实 LLM turn —— `list_my_orders` ok 7 ms、
  203 assistant chunks、turn/end completed、重开 session hydration items≥1。
- 安装包双产物已产出并做真实安装验证（NSIS 54.8 MB / MSI 102.0 MB）：静默
  安装 → `%LOCALAPPDATA%\DSH Chinook\chinook-desktop.exe` + `runtime/`；
  首启 provision 出 `%APPDATA%\com.dsh.chinook\agent\{data,profiles,sessions}`。
- **最终真实安装验收（无 repo 遮蔽）**：清空 home 后启动已安装的 exe →
  sidecar ready → WebView2 打开（CDP 9223）→ 界面空状态 → 新建会话 →
  CDP 驱动输入真实中文业务 turn “查一下我最近的订单列表。”→ 流式回答
  完成：返回真实 SQLite 数据（最近 7 笔订单 #382/#327/#316/… 日期与金额），
  UI 呈现 “完成 · 使用 1 个工具” 工具行，控制台零错误；点击侧栏历史会话 →
  快照 hydration 恢复整段对话。整个运行树只位于 `%LOCALAPPDATA%` 与
  `%APPDATA%`（无 repo node_modules 祖先）。

**pack-smoke 的已知盲区**：scratch home 建在 repo 内，向上解析能“看穿”到 repo
`node_modules`，因此它验证的是 stamped 闭包 + 协议 + 真实 turn，并不验证
packaged home 的 bundle 可达性（那由 §4 的 junction fallback 承担，见上）。

**repo-free 闭包探针（新增，解决盲区）**：把 stamped `runtime/` 整树复制到
`%TEMP%`（bridge.mjs 无任何 repo 祖先），DSH_HOME 也放 `%TEMP%`，用拷贝内自带
的 `node.exe` + `bridge.mjs` 直跑协议探针：`session.create` → 真实中文业务 turn
（“查一下我最近的订单列表。”）→ `turn/end reason=completed`，171 个
assistant chunks、168 个 tool/call 事件 —— 证明 packaged 闭包在**无仓库遮蔽**
下完整自足（provisioning → heal 镜像 → bundle junction fallback → SQLite →
真实 LLM 全链路）。同轮验证 heal 把 `profiles/node_modules` 镜像成指向 runtime
闭包的 junction（home 仅 ~2 MB），`@deepseek-ai/dsh` 与 `chinook-dsh-plugin`
均可达。

## 7. 静态 guard 的一次必要调整（V1 architecture.test.ts）

`tests/architecture.test.ts` 的全仓静态 walk（禁止 langchain/redis 等）在
Desktop V2 出现后会把 `apps/desktop/src-tauri/{target,runtime}` 与 dist 的
**第三方/生成内容**当作仓库代码扫描：runtime node_modules 里 1.4 万个 vendor
`.ts` 源文件（约 91 MB 文本）含无关字符串（第三方注释里的 “langchain/
redis”），测试既误报失败，也在 vitest worker 里撑爆堆（“invalid table
size — heap out of memory”，113 套件里唯独它确定性崩溃，单跑也崩）。修复：
`sourceFiles` 跳过 `node_modules`/`target`/`dist` —— guard 语义不变（仓库
自研代码仍全量受检，8 个断言原样），仅把生成的 vendor 树排除在“仓库代码”
之外。这是测试随仓库形态演进做的环境修正，不是削弱。

## 8. 已知实现约束（真实限制，非 Non-goal）

- 单 sidecar / 单打开会话；`agent.restart` 走宿主重启（frozen）。
- session 历史不摘要，长会话日志增长（V1 限制沿承）。
- 身份仍为 demo env var（`CHINOOK_CUSTOMER_ID`），不是鉴权系统。
- 安装包 ~55 MB（NSIS）/ ~102 MB（MSI）；未签名，SmartScreen 会提示。
- Windows-only（frozen）；无 macOS/Linux 打包路径。

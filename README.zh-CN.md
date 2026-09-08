# DSH Life Assistant

[English](README.md) | 简体中文

一个围绕用户授权数据与领域工具构建的可扩展个人 AI 助手。

当前版本首先实现 **Chinook Music** 领域，用音乐目录、购买记录、长期偏好记忆和本地 Session，验证"个人数据 → Domain Tools → Persistent Agent → Desktop Experience"的完整工作方式——同一个持久化个人 Agent，使用领域工具与本地数据理解偏好、搜索音乐、查询购买历史、记住长期兴趣，并提供桌面原生的交互体验。

![DSH Life Assistant](assets/screenshots/desktop-home.png)

## 今天可以做什么

以下全部为 v1.0.1 中真实发布的能力——都由 Chinook Music 领域支撑。

- **音乐目录搜索** — 跨目录查找艺人、专辑与曲目
- **音乐推荐** — 相似专辑与流派热度，全部基于真实数据
- **订单查询** — 用自然语言询问自己的购买历史
- **发票所有权保护** — 发票明细只对当前客户可读
- **客户级长期记忆** — 按客户记住事实，并在后续会话中复用
- **持久化会话** — 每段对话都是可恢复的持久 Agent 会话
- **流式回复** — 助手回答逐 token 实时流式呈现
- **可见的 Tool 活动** — 每一次 Tool 调用都实时展示，而不是藏在模型内部
- **桌面 Activity Drawer（活动抽屉）** — 完整可查的 Agent 运行轨迹：模型回合、Tool 调用、耗时
- **Sidecar 崩溃恢复** — Agent 进程被守护，崩溃后自动重启并重连会话

## 当前领域 — Chinook Music

```
DSH Life Assistant
│
├── 共享 Agent Runtime
│     ├── Session
│     ├── Memory
│     ├── Tool Calling
│     ├── Streaming
│     └── Desktop Runtime
│
└── 领域插件（Domain Plugins）
      ├── Chinook Music          ✅ 已实现（v1.0.0）
      ├── Personal Finance       ◌ 未来
      ├── Calendar / Tasks       ◌ 未来
      └── 其他用户授权数据       ◌ 未来
```

### 为什么先做 Chinook？

Chinook 不是随手挑的 Demo。它提供了一个结构清晰、可真实查询的音乐商店数据域，因此被选为第一个 Domain Implementation，用于端到端验证完整模式：领域插件、Tool Calling、长期记忆、数据所有权与桌面交互。

## 架构

一个持久化的 DSH Agent Runtime，外加可扩展的领域边界——添加新领域时，桌面宿主与 Agent 核心无需改动。

```mermaid
flowchart TD
    UI["React + Fluent UI<br/>Desktop Presentation"]
    HOST["Tauri v2 + Rust<br/>Desktop Host"]
    BRIDGE["Node Agent Bridge<br/>Transport Adapter"]
    AGENT["DSH AgentRuntime<br/>Persistent Personal Agent"]

    DOMAIN["Domain Plugins"]

    MUSIC["Chinook Music<br/>Implemented"]
    FINANCE["Personal Finance<br/>Future"]
    CALENDAR["Calendar / Tasks<br/>Future"]

    UI --> HOST
    HOST --> BRIDGE
    BRIDGE --> AGENT
    AGENT --> DOMAIN

    DOMAIN --> MUSIC
    DOMAIN -. future .-> FINANCE
    DOMAIN -. future .-> CALENDAR
```

技术路径保持明确：

```text
React + Fluent UI
        ↓
Tauri Commands / Channels
        ↓
Rust Desktop Host
        ↓
stdin/stdout JSONL
        ↓
Node Agent Bridge
        ↓
DSH AgentRuntime
        ↓
领域插件（Domain Plugin）
        ↓
Tools / SQLite / Memory
```

| 层 | 职责 |
| --- | --- |
| React + Fluent UI | 展示层。纯对话/时间线 UI，从不直接访问数据库或模型 |
| Rust Desktop Host | 窗口、应用生命周期与单个长驻 Agent sidecar 进程 |
| Node Agent Bridge | 传输适配层 — 通过 stdin/stdout 上的 JSONL 在宿主与 Agent Runtime 之间通信 |
| DSH AgentRuntime | DeepSeek Harness Agent 核心：会话、模型调用、Tool 分发、记忆 |
| 领域插件 | 业务层 — 由 SQLite 与客户记忆支撑的领域 Tool |

## Agent Tools

以下是 Chinook Music 领域当前提供的 7 个 Tool：

| Tool | 作用 |
| --- | --- |
| `search_catalog` | 按艺人、专辑或曲目搜索音乐目录 |
| `find_similar_albums` | 推荐与给定专辑相似的专辑 |
| `popular_in_genre` | 展示某一音乐流派中的热门内容 |
| `list_my_orders` | 列出当前客户的订单 |
| `get_invoice_details` | 读取某张发票的明细行（带所有权校验） |
| `remember` | 将当前客户的一条事实写入长期记忆 |
| `recall` | 检索已存储的当前客户事实 |

## 桌面体验

桌面应用包装了与最初 CLI 相同的 Agent 核心。首页为对话视图，带一条实时活动条：Agent 工作时，你能看到当前步骤（模型回合、Tool 调用、Tool 结果），回复实时流式呈现。标题栏同时展示产品名（**DSH Life Assistant**）与当前领域（**Chinook Music**）。**Activity Drawer（活动抽屉）** 保存每次运行的完整轨迹。侧边栏列出持久化会话，包括可恢复的历史会话。Agent 作为应用管控下的子 Node 进程运行——若崩溃会被自动重启并重连会话。

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 前端 | React 18 + Fluent UI v9，经 Tauri v2 在 WebView2 中渲染 |
| 桌面宿主 | Rust（Tauri v2）；NSIS / MSI 安装包 |
| Agent 桥 | Node.js 进程经 stdin/stdout JSONL 与 Rust 通信（esbuild 打包） |
| Agent 运行时 | DeepSeek Harness（DSH）AgentRuntime（`@deepseek-ai/dsh`） |
| 业务层 | TypeScript 领域插件：7 个 Tool、SQLite 服务、按客户记忆 |
| 数据 | 经 `better-sqlite3` 使用 SQLite — 公开 Chinook 示例库结构，外加记忆存储 |
| 工具链 | pnpm workspace、TypeScript、Vite、Vitest、Cargo |

## 项目结构

```text
dsh-life-assistant/
├── apps/
│   ├── agent-bridge/     # Node 桥：桌面宿主 <-> DSH 的 JSONL 传输适配层
│   ├── cli/              # Agent CLI REPL（最初入口）
│   └── desktop/          # Tauri 桌面应用：React 前端、Rust 宿主、打包
├── plugins/chinook/      # Chinook Music 领域插件：Tool、服务、记忆
├── profiles/chinook/     # Chinook Music 领域的 DSH profile 装配
├── scripts/              # bootstrap 与构建辅助脚本
├── tests/                # Vitest 套件：插件、服务、桥、架构
└── assets/screenshots/   # 项目截图
```

## 快速开始

### 前置要求

- Node.js ≥ 22 与 pnpm
- Rust stable（MSVC 工具链）+ Visual Studio Build Tools（C++）— 仅桌面宿主需要
- Windows 10/11 及 WebView2 运行时（Windows 11 已内置）

### 1. 安装依赖

```bash
pnpm install
```

### 2. 环境配置

复制 `.env.example` 为 `.env` 并填入模型凭据（见 [环境](#环境)）。切勿提交真实凭据——仓库只跟踪 `.env.example`。

### 3. 初始化本地数据

```bash
pnpm bootstrap
```

该命令在本地 DSH home 下准备 Chinook Music 数据库、初始化记忆存储表结构并装配 profile。

### 4. 使用 Agent

原有 CLI REPL 仍然可用——桌面应用是当前的主要产品入口：

```bash
pnpm chinook-agent
```

### 5. 桌面开发

```bash
cd apps/desktop
node ../../node_modules/@tauri-apps/cli/tauri.js dev
```

该命令构建 React 前端、编译 Rust 宿主并打开带热重载的桌面窗口。

### 6. 测试

```bash
pnpm test
cd apps/desktop/src-tauri && cargo test
```

### 7. 生产构建与打包

```bash
node apps/agent-bridge/build.mjs        # 打包 bridge
node apps/desktop/scripts/stamp-runtime.mjs   # 生成应用自带运行时镜像
cd apps/desktop
node ../../node_modules/@tauri-apps/cli/tauri.js build
```

安装包输出到 `apps/desktop/src-tauri/target/release/bundle/`：

- **NSIS 安装包**（`DSH Life Assistant_1.0.1_x64-setup.exe`）— Windows 推荐安装方式
- **MSI**（`DSH Life Assistant_1.0.1_x64_en-US.msi`）— 备选安装格式

## 环境

| 变量 | 用途 | 示例 |
| --- | --- | --- |
| `DEEPSEEK_API_KEY` | DeepSeek 兼容模型端点的主要凭据 | `sk-your-key` |
| `ANTHROPIC_AUTH_TOKEN` | 备用凭据（同一端点接受的 Anthropic 格式 token） | `sk-ant-...` |
| `CHINOOK_CUSTOMER_ID` | 演示客户身份；订单/发票/记忆均以其为作用域 | `1` |
| `DSH_HOME` | DSH home 目录覆盖（开发环境默认为 `<repo>/.dsh`） | `C:\path\to\home` |

完整说明见 `.env.example`。`CHINOOK_CUSTOMER_ID` 未设置或无效即为匿名——订单、发票与记忆 Tool 会返回 `IDENTITY_REQUIRED`。

## 开发

```bash
pnpm build             # 对 workspace 做类型检查并编译插件
pnpm chinook-agent     # 在 CLI REPL 中运行 Agent
```

开发运行将 DSH home 放在 `<repo>/.dsh`。打包后的桌面应用会在 `%APPDATA%\com.dsh.chinook` 下创建自己的 home，并从内置运行时镜像（Node + bridge + 精简依赖 + 全新 schema-only home）运行，因此被安装的机器既不需要 Node，也不需要仓库检出。

## 测试 / 构建

- `pnpm test` — Vitest：12 个套件 / 128 个测试，覆盖插件服务、Tool、记忆、桥（单元 + 集成）、Agent e2e、桌面 reducer 与架构不变量
- `cd apps/desktop/src-tauri && cargo test` — Rust 宿主测试
- `pnpm build` — workspace 类型检查 + 插件编译；Tauri 生产构建会执行前端构建与 Rust release 构建，产出上面的 NSIS/MSI 安装包

## Roadmap

```text
✅ Chinook Music 领域（v1.0.0 — 已发布）
◌ Personal Finance 领域
◌ Calendar / Tasks 领域
◌ 更多用户授权数据领域
```

未来可以继续接入个人财务、日程、任务等用户授权的数据域。以上目前都未实现——当前架构只是建立了"无需重写桌面宿主或 Agent 核心即可增加新领域"的边界。没有时间承诺。

## 架构边界

- 桌面宿主只负责窗口、应用生命周期与 sidecar 进程——不含任何业务逻辑
- React 层是纯展示层，从不直接查询数据库或调用模型
- 业务规则（发票所有权、记忆作用域、目录查询）都在领域插件中
- Node 桥是薄传输适配层；所有 Agent 行为来自 DSH 与插件

## 已知限制

- **Windows-first**：桌面应用在 Windows 11 上构建并验证；其他平台尚未覆盖
- **演示身份而非认证**：v1 使用本地演示身份（`CHINOOK_CUSTOMER_ID`）；未实现生产级认证
- **单用户、本地化**：数据存放在本机；没有服务端、云端或多用户模式
- **需要可用的模型凭据**：对话依赖上面环境变量配置的可达模型端点
- **未签名安装包**：NSIS/MSI 未做代码签名，首次运行 Windows SmartScreen 可能告警
- **仅安装版，无独立便携 exe**：桌面可执行文件随运行时资源一起分装在安装包内，未验证可脱离资源独立运行
- **演示数据**：业务数据是公开 Chinook 示例商店，不是真实生产后端

## 致谢

- **DeepSeek Harness（DSH）** — 本项目所基于的 Agent 运行时
- **Chinook sample database** — 作为第一个领域表结构与数据的公开示例音乐商店数据集
- **Original Chinook/LangChain example** — 领域 Agent 的创意借鉴自经典 Chinook + LangChain 示例（[langchain-basics](https://github.com/masoodfaisal/langchain-basics)）

## License / 第三方声明

本仓库目前未为其自身源码声明 License；在所有者选定之前不授予任何 License。

第三方组件保留各自 License：DeepSeek Harness 各包、React、Fluent UI 与 `better-sqlite3` 为 MIT；Tauri 为 Apache-2.0 OR MIT。Chinook 示例数据库是广泛流传的公开示例数据集。

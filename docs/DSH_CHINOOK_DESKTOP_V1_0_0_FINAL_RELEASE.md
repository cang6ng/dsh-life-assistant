# DSH Chinook Desktop Agent v1.0.0 — Final Release Contract

> 本文件由原 Final Release Cleanup & GitHub Publishing Prompt 拆分而来。
>
> 本文件承载正式发布前的 Cleanup、Regression、Repository Hygiene、Secrets Audit、README、Release Build、Git Freeze、Tag、GitHub Push 与 Final Release Gate。
>
> 当前阶段不是继续开发新功能，而是将已经完成并验收通过的 Agent Core V1 与 Desktop V2 收尾、冻结并准备公开发布。
>
> GitHub 首个完整 Desktop 产品版本统一使用：
>
> **v1.0.0**

# 1. 工作模式

执行：

```text
Inspect
  ↓
Targeted Cleanup
  ↓
Regression
  ↓
Repository Cleanup
  ↓
Security / Secrets Audit
  ↓
README Reproducibility
  ↓
Release Build
  ↓
Git Freeze
  ↓
GitHub Push
  ↓
Final Report

```

不要先输出方案。

先检查当前仓库，然后直接执行。

对于普通代码错误、构建问题、测试问题、README 不一致、Git hygiene 问题，自主解决。

不要每一步向我确认。

---

# 2. 必读

首先阅读：

```text
docs/DSH_CHINOOK_AGENT_V1_SPEC.md
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
README.md
package.json

```

以及当前：

```text
apps/
plugins/
profiles/
tests/
scripts/
src-tauri/

```

实际代码。

不要假设当前 Git 状态。

不要相信之前 Agent 的报告，先检查当前工作树实际情况。

---

# 3. 本轮的定位

这是：

# RELEASE CLEANUP

不是：

```text
Architecture Redesign
Agent V3
Desktop V3
Feature Expansion

```

当前版本可以存在少量非阻塞不足。

本轮目标是：

> 修掉明显且低风险的小问题，让项目达到一个干净、稳定、能够公开上传 GitHub 的状态。

---

# 4. 允许修复的问题

可以修：

```text
明显 UI 小 bug
明显交互瑕疵
文案错误
轻微布局问题
简单边界状态错误
明显 TypeScript/Rust warning
构建错误
测试不稳定
README 与实现不一致
路径/启动脚本问题
发布配置问题
.gitignore 问题

```

前提是：

> 修复必须是局部、低风险、容易验证的。

---

# 5. 禁止扩 Scope

不要新增：

```text
新 Tool
新 Agent
Multi-Agent
RAG
Vector DB
MCP
登录注册
OAuth
RBAC
云同步
Web 版本
macOS 实现
购物车
支付
退款
模型选择器
Settings 页面
语音
文件上传
图片能力
Turn Cancel
第二 LLM

```

不要为了“更专业”扩功能。

---

# 6. 冻结的核心不得顺手重构

除非发现真正阻塞发布的 Bug，否则不要重新设计或重构：

```text
AgentRuntime
DSH Agent Loop
Chinook Plugin
7 Tools
Identity
Memory
Session semantics
Presentation Protocol
Rust Host architecture
Node Bridge architecture
Restart Recovery state machine
P1 restorePending logic
P3 send failure lifecycle

```

特别禁止：

```text
“既然都到这里了，我顺便重构一下……”

```

当前原则：

# 稳定优先于漂亮。

---

# 7. 已知历史验证结果

历史上已经达到：

```text
pnpm build                           PASS
pnpm test                            PASS
默认 Vitest file parallelism         PASS
cargo test                           PASS
Desktop frontend typecheck          PASS
Frontend production build           PASS
Bridge build                        PASS
真实 Desktop Runtime                 PASS
Tool Calling                         PASS
Streaming                            PASS
Session Resume                       PASS
Restart Recovery                     PASS

```

这些只是历史参考。

本轮必须重新亲自执行。

---

# 8. 首先检查 Git 状态

运行：

```bash
git status --short
git diff --stat
git diff

```

如果当前仓库仍未初始化 Git：

> 先不要立即 `git add .`。

先完成整个 repository/security cleanup，最后再 `git init`。

如果已经存在 Git：

> 不要重写历史。

记录当前状态。

---

# 9. 检查当前未提交 / 未跟踪文件

重点审查：

```text
apps/desktop/
apps/agent-bridge/
tests/
docs/
package.json
pnpm-lock.yaml
Cargo.toml
Cargo.lock
tauri.conf.json
capabilities/
README.md
.gitignore

```

确认哪些属于正式源码，哪些只是：

```text
build artifact
runtime artifact
debug artifact
temporary trace

```

不要因为文件是 untracked 就直接删除。

先判断用途。

---

# 10. Repository Hygiene

最终 Git 仓库不得包含：

```text
node_modules/
.dsh/
tmp/
*.log
.env
.env.local
target/
src-tauri/target/
开发缓存
测试临时 home
runtime session logs
本机安装路径产物
CDP probe scripts
临时 trace

```

除非某个 artifact 被项目明确设计为必须随源码发布。

---

# 11. Secrets Audit

这是正式发布前硬门槛。

搜索整个准备提交的仓库，检查是否存在：

```text
DEEPSEEK_API_KEY 实值
ANTHROPIC_AUTH_TOKEN 实值
OPENAI_API_KEY 实值
Bearer Token
Authorization header
API Secret
password
个人 access token
GitHub token

```

检查：

```text
.env
源码
测试
文档
日志
session
trace
JSON
Shell history artifacts

```

允许存在：

```text
DEEPSEEK_API_KEY=
ANTHROPIC_AUTH_TOKEN=
CHINOOK_CUSTOMER_ID=1

```

这种 `.env.example` 示例。

绝对不能提交真实 secret。

如果发现：

> 清理 secret，并确保没有被放入即将提交的 Git history。

---

# 12. Runtime Data Audit

重点检查：

```text
.dsh/
data/memory.db
Desktop AppData copy
Session JSONL

```

原则：

## chinook.db

如果这是项目运行必须的固定 Chinook fixture：

> 可以保留。

确认它不包含项目用户自己的敏感数据，只是公开 Chinook 示例数据。

## memory.db

如果当前文件包含开发/验收过程中写入的：

```text
User likes jazz
Deep Purple

```

等真实 runtime memory：

> 不要把这些运行状态作为正式源码发布。

优先：

- 提供干净初始化版本；或
- 由 bootstrap 自动创建 memory.db。

不要破坏程序启动。

## Session

不要提交：

```text
真实 .dsh session logs

```

---

# 13. `.gitignore`

整理 `.gitignore`。

至少合理覆盖：

```text
node_modules/
.dsh/
tmp/
.env
.env.*
!.env.example

dist/
target/
apps/desktop/src-tauri/target/

*.log

```

但注意：

如果某个 `dist` 是 Desktop sidecar 打包过程中必须进入源码仓库的预构建资源：

> 先理解实际 build pipeline。

优先保证：

```text
clone
→ install
→ build

```

可以重新生成。

不要机械 ignore 导致 release build 缺文件。

---

# 14. 小 Bug / 小不足收尾

检查当前 Desktop App。

允许对明显且安全的小问题进行最终修复。

重点看：

```text
窗口启动
Session Sidebar
New Session
Session Restore
Composer
Streaming
Tool Activity
Activity Drawer
Runtime Status
Disconnected / Restart
Light/Dark Theme
中文文案
小窗口布局

```

如果只是：

```text
轻微 spacing
文案
状态残留
明显 disabled 错误

```

可以修。

如果修复需要：

```text
重新设计状态机
修改 Agent Runtime 核心
大范围协议变化

```

不要修。

记录为：

```text
Known Limitation

```

---

# 15. 不追求零缺陷

这一点非常重要。

当前目标不是：

```text
找到所有理论上的 Edge Case

```

而是：

> 得到一个适合 GitHub / Demo / 简历展示的稳定版本。

对于：

```text
极端竞态
非常难复现的非阻塞 polish
未来功能不足

```

只记录，不继续扩大开发。

---

# 16. README 最终整理

README 是 GitHub 首页的一部分。

必须保证一个陌生开发者可以理解：

## 项目是什么

简洁说明：

> 基于 DeepSeek Harness / DSH 构建的可扩展音乐商店 AI Agent，并使用 Tauri v2 + React + Fluent UI 产品化为 Windows Desktop Application。

## Architecture

至少给出：

```text
React / Fluent UI
        ↓
Tauri / Rust
        ↓
Node Agent Bridge
        ↓
DSH AgentRuntime
        ↓
Chinook Plugin
        ↓
Tools / SQLite / Memory

```

## Features

至少：

```text
音乐目录搜索
音乐推荐
订单查询
Invoice ownership
长期记忆
Session persistence
Tool Calling
Streaming
Desktop Activity UI
Sidecar restart recovery

```

## Tech Stack

```text
TypeScript
Node.js
DeepSeek Harness
Tauri v2
Rust
React
Vite
Fluent UI React v9
SQLite

```

## Quick Start

真实可执行：

```text
Prerequisites
Install
Environment
Bootstrap
CLI
Desktop Dev
Tests
Build

```

## Environment

只给：

```text
.env.example

```

不要真实 token。

## Tests

写真实命令，不要伪造数量。

## Limitations

简洁写当前真正限制，例如：

```text
Windows first
Demo identity
single active turn
local session/memory
no production auth

```

不要把 README 写成论文。

---

# 17. README 不要夸大

禁止写：

```text
production-ready enterprise platform
fully secure multi-user SaaS

```

正确定位：

> Windows-first desktop AI music-store assistant / extensible DSH business-agent reference implementation.

---

# 18. Build / Test 回归

完成所有修改后运行：

```bash
pnpm build
pnpm test

```

默认 file parallelism。

不要使用：

```text
--no-file-parallelism
retry-until-pass

```

---

# 19. Test Stability

因为此前曾有并行 test isolation defect：

至少连续运行默认：

```bash
pnpm test

```

3 次。

要求：

```text
3 / 3 PASS

```

不需要再跑 5 次。

---

# 20. Rust

运行项目真实 Rust checks：

```bash
cargo test

```

并根据 workspace 路径执行：

```bash
cargo check

```

如 Cargo 项目位于：

```text
apps/desktop/src-tauri

```

使用正确 cwd。

---

# 21. Frontend

运行当前真实命令：

```text
Desktop frontend typecheck
Vite production build

```

必须 PASS。

---

# 22. Bridge

重新执行：

```text
agent-bridge build

```

必须 PASS。

---

# 23. Production Desktop Build

执行正式：

```text
Tauri production build

```

目标：

```text
Windows executable / installer successfully generated

```

记录实际 artifact 路径。

不要只跑：

```text
tauri dev

```

---

# 24. Smoke Runtime

如果当前合法模型 credential 和网络仍可用：

实际启动当前 Desktop App。

至少验证一个完整真实 turn：

```text
帮我找 Queen 的专辑

```

确认：

```text
real Agent
real search_catalog
Tool Activity
Streaming
turn/end

```

即可。

不需要重新执行两次 sidecar kill。

P1 已经独立验收过。

---

# 25. 基础 Desktop Smoke

还确认：

```text
App starts
Session sidebar visible
Existing session can open
New session works
Composer works
Activity drawer opens
Runtime connected state correct

```

不要重复做完整 V2 acceptance。

---

# 26. Architecture Integrity

最终再做一次轻量静态检查。

## React

不能包含：

```text
@deepseek-ai/*
better-sqlite3
direct child_process
Chinook SQL

```

## Rust

不能包含：

```text
Track SQL
Invoice SQL
Memory SQL
music recommendation business logic

```

## Node Bridge

不能增加：

```text
new business tools
business authorization logic
second LLM

```

## Agent Core

不能依赖：

```text
React
Tauri UI
Fluent UI
Window APIs

```

---

# 27. Windows First

保持：

```text
Windows First

```

不要为了这次 release 开始适配 macOS。

只需要确保平台相关 Rust 代码没有无理由污染 Agent Core。

---

# 28. Release Version

内部开发曾称：

```text
Agent V1
Desktop V2

```

但这是项目开发阶段编号。

GitHub 第一次公开完整 Desktop 产品版本统一使用：

# v1.0.0

不要把公开首发版本标记成 v2.0.0。

---

# 29. Git 初始化 / 整理

所有 cleanup 和 regression PASS 后，再处理 Git。

如果尚未初始化：

```bash
git init

```

确保默认分支：

```bash
git branch -M main

```

然后：

```bash
git status --short

```

逐项检查准备提交的文件。

不要直接无脑：

```bash
git add .

```

直到 secrets/runtime audit 完成。

---

# 30. Git Commit

确认仓库干净、安全、测试全绿后：

```bash
git add <正式需要提交的文件>

```

再次：

```bash
git status
git diff --cached --stat
git diff --cached

```

重点重新扫描 staged 内容：

```text
API key
token
.env
session log
runtime memory
absolute local path

```

全部安全后提交。

Commit message：

```text
feat: release DSH Chinook Desktop Agent

```

---

# 31. Git Tag

提交成功后：

```bash
git tag -a v1.0.0 -m "DSH Chinook Desktop Agent v1.0.0"

```

如果该 tag 已存在：

> 不要覆盖，检查当前仓库真实状态并合理处理。

---

# 32. GitHub Remote

检查：

```bash
git remote -v

```

如果已经配置正确的 GitHub remote：

> 使用现有 remote。

不要擅自改成别的仓库。

---

# 33. GitHub Push

如果：

```text
remote 已配置
+
当前环境 GitHub authentication 可用

```

则执行：

```bash
git push -u origin main
git push origin v1.0.0

```

不要 force push。

不要：

```text
git push --force

```

---

# 34. 如果没有 GitHub Remote

如果：

```text
git remote -v

```

为空：

不要编造仓库 URL。

不要创建到错误账户。

完成：

```text
local clean commit
v1.0.0 tag

```

然后最终报告：

```text
GITHUB_PUSH_BLOCKED
Reason: no origin remote configured

```

并给出用户只需要执行的下一条命令。

这不是代码失败。

---

# 35. 如果 GitHub Authentication 失败

不要删除 commit。

不要改 remote。

不要 force push。

保留：

```text
clean local main
+
v1.0.0 tag

```

报告实际 authentication blocker。

---

# 36. GitHub Repo 不应包含

最终远程仓库重点确认没有：

```text
.env
API key
token
.dsh/
个人 Session
个人 memory state
node_modules
Rust target
temp traces
测试 probe
本机绝对路径配置

```

---

# 37. Release Artifact

如果：

```text
Tauri build

```

已经生成：

```text
.exe
.msi
NSIS installer

```

记录 artifact。

如果 GitHub CLI：

```text
gh

```

已经合法登录，并且 remote 已明确：

可以创建：

```text
GitHub Release v1.0.0

```

并上传最终 Windows installer。

但是：

> 只有在能够明确确认 repository 与 account 的情况下执行。

不要自行创建未知远程仓库。

如果条件不满足：

只完成 source push + tag。

---

# 38. 不要上传开发调试产物到 Release

Release 只允许最终用户需要的：

```text
installer
必要 checksum（可选）

```

不要上传：

```text
logs
node_modules zip
target zip
session database
debug probes

```

---

# 39. Final Release Gate

只有下面全部满足才允许宣布：

# READY\_FOR\_GITHUB

```text
[ ] 小范围 cleanup 完成
[ ] 无阻塞级已知 bug

[ ] pnpm build PASS
[ ] pnpm test 默认并行 ×3 PASS
[ ] cargo check PASS
[ ] cargo test PASS
[ ] Desktop TypeScript PASS
[ ] Frontend production build PASS
[ ] Bridge build PASS
[ ] Tauri production build PASS

[ ] README 与实际一致
[ ] .gitignore 正确
[ ] secrets audit PASS
[ ] runtime-data audit PASS

[ ] staged files inspected
[ ] no API key/token
[ ] no personal sessions
[ ] no personal memory state

[ ] Git main commit created
[ ] v1.0.0 tag created

```

GitHub push 如果因：

```text
missing remote
missing authentication

```

而不能完成，可以：

```text
READY_FOR_GITHUB
+
PUSH_BLOCKED

```

但必须准确说明。

---

# 40. 不允许为了全绿作弊

禁止：

```text
skip failing tests
删除失败测试
关闭 Vitest 并行
硬编码测试结果
mock 掉整个 Agent
把 Tauri production build 从验收中删掉

```

遇到真实问题就修。

---

# 41. 不再追求产品扩张

完成以上 release gate 后：

# 停止开发。

不要继续：

```text
“我还顺便加入了……”

```

这次任务成功的标志不是功能更多。

而是：

> 当前已有产品被整理成一个稳定、干净、可公开、可复现的 GitHub Release。

---

# 42. 最终报告格式

最终输出：

# DSH Chinook Desktop Agent — Final Release Report

## Final Status

只允许：

```text
RELEASED
READY_FOR_GITHUB
BLOCKED

```

---

## 1. Final Cleanup

列出：

```text
修了哪些小 bug
修了哪些文案/体验
明确没有做哪些重构

```

如果没有必要修：

```text
No production cleanup required.

```

不要为了报告好看制造修改。

---

## 2. Repository Cleanup

说明：

```text
删除/忽略哪些 runtime artifact
.gitignore changes
memory/session handling

```

---

## 3. Security Audit

明确：

```text
Secrets found:
Secrets removed:
Staged secret scan:

```

最终必须确认：

```text
No credentials committed.

```

---

## 4. Build

真实报告：

```text
pnpm build
Desktop frontend
Bridge
Rust
Tauri production build

```

---

## 5. Tests

报告：

```text
pnpm test ×3

```

每次真实结果。

以及：

```text
cargo test

```

---

## 6. Desktop Smoke

说明：

```text
App boot
Session
Real Tool Call
Streaming

```

真实结果。

---

## 7. Git

说明：

```text
branch
commit SHA
commit message
tag
working tree status

```

---

## 8. GitHub

说明：

```text
remote
push result
repository URL
tag push
GitHub Release（如完成）

```

如果没 push：

明确 blocker。

---

## 9. Release Artifact

列出：

```text
Windows installer / exe
artifact path
size

```

如果已上传 GitHub Release：

给出 release 信息。

---

## 10. Known Limitations

只写真正仍存在、且不阻塞首发的问题。

例如：

```text
Windows-first
Demo identity
single-user local app
no production auth

```

不要重新把所有 Non-goals 列一遍。

---

# 43. 最终要求

不要再进行新的架构设计。

不要扩大功能范围。

现在立即开始：

```text
Inspect
→ Cleanup
→ Test
→ Build
→ Security Audit
→ README
→ Git Freeze
→ Tag
→ Push

```

目标：

---

# 最终原则

本阶段不是 Architecture Redesign、Agent V3、Desktop V3 或 Feature Expansion。

完成 Release Gate 后停止开发。

本轮成功的标志不是增加更多功能，而是：

> **当前已有产品被整理成一个稳定、干净、可公开、可复现的 GitHub Release。**

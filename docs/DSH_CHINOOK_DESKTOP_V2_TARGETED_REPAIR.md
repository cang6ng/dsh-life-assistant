# DSH Chinook Desktop V2 — Targeted Repair Contract

> 本文件定义 Desktop V2 独立验收后的一次定向修复任务。
>
> Desktop V2 主体已经完成，并且独立 Read-Only Auditor 已经完成全量验收。
>
> 本轮不是重新实施 Desktop V2。
>
> 唯一目标是：
>
> **修复独立验收中发现的 Restart Recovery 核心缺陷，以及一个关联的小型 UI 状态缺陷，然后完成针对性回归验证。**

---

# 1. 必读文件

开始前完整阅读：

```text
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION_CONTRACT.md
docs/DSH_CHINOOK_DESKTOP_V2_IMPLEMENTATION.md
```

以及当前仓库的真实实现。

同时参考独立验收器已经确认的以下问题。

---

# 2. P1 — Restart Recovery 后出现“假 Ready”

独立验收器已经稳定复现两次：

```text
sidecar crash
→ UI 显示 disconnected
→ 用户点击“重新连接”
→ 新 sidecar 成功启动
→ runtime/status = ready
→ composer 被重新启用
→ 但是当前 active session 没有在新 Bridge / AgentRuntime 中重新 open
→ 用户发送消息
→ 发送失败，请重试
```

此时：

- Runtime 表面已经 Ready；
- UI 允许用户输入；
- 但当前 Session 实际没有重新绑定到新的 Bridge；
- 点击当前 Session 本身又是 no-op；
- 用户只能先切到其他 Session，再切回来才能恢复。

这是本轮必须修复的核心问题。

正确恢复语义应当类似：

```text
Disconnected
↓
用户点击重新连接
↓
Restarting
↓
new sidecar / bridge ready
↓
如果当前存在 activeSessionId：
    session.open(activeSessionId)
↓
等待 session restore / hydration 完成
↓
恢复当前 conversation / runtime binding
↓
Ready
↓
composer enabled
↓
下一条 turn.send 可以立即成功
```

也就是说：

> **Bridge Ready 不等于 Desktop Ready。**

如果当前存在 active session，则 restart 后必须完成 active session reopen / restore，才能把 Desktop 暴露为真正可用的 Ready 状态。

如果不存在 active session，则可以正常进入无 Session 的 Ready 状态。

不要通过清空 activeSessionId、强制创建新 Session、要求用户手动切换 Session 等方式绕过问题。

不要修改 DSH Session semantics。

不要重新实现 Session。

应该在现有：

```text
React
↔ Tauri/Rust
↔ Node Bridge
↔ AgentRuntime
```

边界中实现正确的 restart recovery orchestration。

---

# 3. P3 — stale “发送失败，请重试”状态

独立验收器还发现：

当一次发送失败后：

```text
发送失败，请重试
```

提示可能在之后一次成功 Turn 完成后仍然残留。

目前似乎只有下一次：

```text
turn/start
```

才会清除。

修复目标：

> 一次新的有效操作成功后，旧的 transient send error 不应继续污染当前 UI 状态。

请根据当前 reducer/state model 做最小修复。

不要顺便重构整个 error model。

---

# 4. 工作原则

这是：

# TARGETED REPAIR

不要重新设计 Desktop V2。

不要重构：

- Agent Core
- Chinook Plugin
- Tool schema
- Identity
- Memory
- Session persistence
- Presentation Protocol
- Rust Host architecture
- Node Bridge architecture
- React component architecture

除非修复该问题所需，否则不要修改无关文件。

特别禁止：

```text
HTTP
REST
WebSocket
新增 turn.cancel
新增复杂状态框架
重新实现 Session
重写 AgentRuntime
修改业务 Tool
```

---

# 5. 修复前检查

先检查当前 Git 状态和相关实现。

重点追踪：

```text
agent_restart
runtime/status
activeSessionId
session.open
session/opened
restoring
ready
composer disabled/enabled
turn.send
send error state
```

确认真正的状态流和 race condition / missing orchestration 在哪里。

不要根据验收报告直接猜代码。

---

# 6. 修复要求

完成修复后必须证明以下流程真实成立。

## Case A — Crash + Restart + Continue Same Session

```text
Session A 已打开
↓
产生已有 conversation
↓
sidecar crash
↓
Disconnected
↓
点击重新连接
↓
Restarting
↓
Bridge ready
↓
Session A 自动 reopen / restore
↓
Conversation 正常保留
↓
Desktop Ready
↓
直接发送下一条消息
↓
turn.send 成功
↓
真实 Agent 正常回答
```

过程中不允许：

```text
切换到 Session B 再切回来
新建 Session
手工重新点击当前 Session
```

才能恢复。

---

## Case B — Restart with no active session

如果当前没有 active session：

```text
restart
→ bridge ready
→ Desktop ready
```

不得错误调用不存在的 Session。

---

## Case C — Session restore failure

如果 sidecar restart 成功，但 active session reopen 失败：

不要显示虚假的正常 Ready。

应该根据 Frozen UI Spec 使用合理的：

```text
restoring / error / recoverable state
```

并确保用户不会在 Runtime 实际无法接受 turn 时获得一个正常可用的 Composer。

不要引入新的产品流程，只使用已有 Runtime/Error 模型解决。

---

## Case D — stale send error

验证：

```text
一次 send failure
→ 出现错误提示
→ 后续恢复成功
→ 新 Turn 成功
→ 旧错误提示消失
```

---

# 7. Tests

必须新增或补强针对该 bug 的自动测试。

至少覆盖：

```text
restart while activeSessionId exists
bridge becomes ready
active session is reopened
ready only after restore
turn_send succeeds after restart
restart with no active session
session restore failure does not expose false ready
stale send error clears after recovery/success
```

优先测试真正负责该状态机的 reducer / bridge / Rust integration 层。

不要为了测试方便 mock 掉整个行为。

---

# 8. Regression

修复后必须重新运行当前项目真实命令，包括至少：

```text
完整 Vitest suite
cargo test
TypeScript / frontend build
必要的 bridge build
```

确认：

- 原 V1 tests 不回归；
- Desktop V2 tests 不回归；
- Streaming 不受影响；
- Session create/list/open/resume 不受影响；
- agent.restart 仍然正常；
- Tool Calling / business behavior 不受影响。

---

# 9. Targeted Runtime Verification

自动测试通过后，必须进行真实运行验证。

至少执行：

```text
Desktop 启动
→ 打开一个真实 Session
→ 发送一条真实 Agent Turn
→ kill sidecar
→ UI disconnected
→ 点击重新连接
→ 自动恢复原 Session
→ 不切换 Session
→ 直接发送下一条真实消息
→ Agent 正常 Tool Calling / Streaming
```

如果合法模型 credential 当前可用：

必须使用真实 LLM + AgentRuntime。

不要用 mock 代替最终验证。

同时观察：

```text
runtime/status
session.open
session/opened
turn.send
assistant/chunk
turn/end
```

保留足够证据证明 restart recovery 已真实修复。

---

# 10. Git / Scope Integrity

完成后检查：

```text
git status
git diff --stat
git diff
```

确保只修改解决这些问题所必需的文件。

不要顺手处理其他 P2/P3、UI polish 或架构优化。

---

# 11. 完成标准

只有全部满足才允许宣布本轮 Repair COMPLETE：

```text
[ ] Restart 后 active session 自动恢复
[ ] 不需要切换 Session 才能继续发送
[ ] 不再出现 false Ready
[ ] Session reopen 失败时不会开放不可用 Composer
[ ] restart 无 active session 正常
[ ] stale send error 已修复
[ ] targeted tests 通过
[ ] full Vitest suite 通过
[ ] cargo test 通过
[ ] TypeScript/frontend/bridge build 通过
[ ] 真实 Desktop restart recovery 验证通过
[ ] V1 business behavior 未改变
[ ] Streaming / Tool Calling / Session semantics 未回归
```

---

# 12. 最终 Repair Report

完成后输出：

# Desktop V2 Targeted Repair Report

必须包括：

## Root Cause

说明原问题为什么发生。

## Changes

列出具体修改文件和修改职责。

## Restart State Flow

给出修复后的真实状态链路。

## Tests

列出真实 test 数量、passed/failed/skipped。

## Runtime Evidence

说明真实 crash → reconnect → same-session send 验证结果。

## Regression

说明 V1/Desktop/Streaming/Tool/Session 是否保持正常。

## Remaining Issues

只列本轮仍真实存在的问题。

不要把 Non-goals 当问题。

---

# 13. 最终原则

本轮不是重新实施 Desktop V2。

不要扩大 Scope。

不要重新设计。

不要用 workaround 绕过 Session 恢复问题。

目标只有：

```text
定位 Restart Recovery 根因
→ 做最小正确修复
→ 修复 stale transient error
→ 增加针对性测试
→ 完成真实 Runtime 验证
→ 全量回归
→ 报告
```

修复必须基于当前真实实现，而不是根据验收报告直接猜代码。

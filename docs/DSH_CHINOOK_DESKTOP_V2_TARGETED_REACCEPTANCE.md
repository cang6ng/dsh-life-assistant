# DSH Chinook Desktop V2 — Targeted Repair Independent Acceptance Contract

> 本文件定义 Desktop V2 Targeted Repair 之后的独立只读回归验收协议。
>
> Desktop V2 主体已经完成，此前独立验收发现两个缺陷：
>
> - **P1 — Restart Recovery 后出现假 Ready**
> - **P3 — Composer 的“发送失败，请重试”状态在后续成功后仍可能重新出现**
>
> Implementation Agent 声称已经完成针对性修复。
>
> 本次任务不是相信 Implementation Agent 的报告，而是：
>
> **独立、只读地验证这两个缺陷是否真正被修复，并确认没有引入关键回归。**

---

# 1. READ ONLY

本轮严格禁止：

- 修改源码
- 修改测试
- 修改配置
- 修改 Spec
- 修复问题
- 格式化代码
- 安装不必要依赖
- Git commit
- 删除现有 runtime data

发现任何问题：

```text
记录
→ 给证据
→ 判定 FAIL
```

不要修。

---

# 2. 必读

首先阅读：

```text
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
docs/DSH_CHINOOK_DESKTOP_V2_TARGETED_REPAIR.md
```

以及与 Restart Recovery 实际相关的当前代码。

重点独立检查：

```text
apps/desktop/
store/state.ts
store/actions.ts
store/reducer.ts
app.tsx
Composer/
Node Agent Bridge
Rust AgentProcessManager
相关 tests
```

路径以当前真实仓库为准。

不要根据 Implementation Agent 的文件清单假设实际代码结构。

可以阅读 Targeted Repair Report，但只能将其视为**待核实线索**，不能作为验收证据。

---

# 3. 不重新设计

Desktop V2 frozen contract：

```text
React
→ Tauri
→ Rust Host
→ Node Bridge
→ AgentRuntime
→ DSH
```

以及：

```text
turn/start
→ Composer locked
→ turn/end
→ Composer unlocked
```

V2 first release：

```text
没有主动 Turn Cancel
```

不要重新讨论这些架构。

---

# 4. P1 — Restart Recovery 根因修复验证

独立检查现在是否真正满足：

```text
Bridge Ready ≠ Desktop Ready
```

当 Restart 前存在 active session A 时：

```text
sidecar crash
    ↓
Desktop disconnected
    ↓
用户重新连接
    ↓
新 sidecar starts
    ↓
bridge ready
    ↓
Desktop MUST NOT expose ready/composer yet
    ↓
session.open(A)
    ↓
hydrate complete
    ↓
SESSION_OPENED / equivalent bind completion
    ↓
Desktop ready
    ↓
composer enabled
```

重点确认：

- activeSessionId 没有被错误清空；
- restart target 正确保存；
- bridge ready 不会提前释放 UI；
- composer 在 session hydration 完成前不可发送；
- restore 成功才进入真正 ready；
- 不需要用户手动点 Session Sidebar；
- 不会偷偷创建新的 Session 代替旧 Session。

---

# 5. P1 State-Machine Edge Cases

至少验证以下 Cases。

## Case A — Active Session Restart

```text
active session A
→ crash
→ reconnect
→ A automatically restored
→ immediately send another turn
→ succeeds
```

必须 PASS。

## Case B — No Active Session

```text
no active session
→ restart
→ bridge ready
```

不应该等待一个不存在的 restore target，也不能死锁。

## Case C — Restore Failure

如果 restore target 无法打开：

必须：

```text
not fake ready
```

而进入符合 Spec 的：

```text
error / restore failure
```

状态。

Composer 不允许错误地变成可发送状态。

该 Case 可以通过已有自动测试和状态机证据验证。

如果可安全构造临时环境，则进一步现场验证。

不要破坏现有用户 Session 来测试。

## Case D — Host Truth Wins

Restore hold 期间如果：

```text
sidecar 再次 disconnected
runtime error
restart begins again
```

状态机不能卡死在：

```text
restorePending
```

必须以实际 host/runtime 状态为准。

---

# 6. P3 — Send Failure Hint Verification

独立验证 Composer 的 send-failure 生命周期。

至少验证精确序列：

```text
send attempt 1
→ rejected / failed
→ 显示 发送失败，请重试

用户重新发送
→ attempt 2 accepted
→ send failure state cleared immediately

turn/start
→ streaming

turn/end
→ Composer enabled
```

最终：

# “发送失败，请重试”绝不能重新出现。

同时检查：

```text
draft changed
session changed
```

仍然可以合理清除旧失败状态。

---

# 7. Automated Tests

亲自运行当前完整测试。

至少：

```text
pnpm test
cargo test
```

以及项目真实存在的：

```text
frontend typecheck
frontend build
bridge build
```

记录：

```text
files
passed
failed
skipped
exit code
```

不要引用 Implementation Agent 报告中的数字。

---

# 8. Targeted Tests

确认测试不是只检查表面变量。

重点阅读和评价：

- Restart Recovery reducer cases
- bridge cross-instance reopen behavior
- Composer send failure lifecycle

测试必须能够在修复被删除时合理失败。

不要为了证明 coverage 而修改测试。

---

# 9. Real Runtime P1 Reproduction

如果当前环境具备此前可用的模型 credential 和 Desktop runtime：

必须亲自进行真实 Desktop 验证。

流程：

```text
1. 启动真实 Desktop App
2. 打开一个已有历史的 Session A
3. 在 Session A 发送一条真实 Agent 请求
4. 等待 Tool Call + Streaming + turn/end
5. 从 OS 层终止 Node Agent sidecar
6. 确认 UI → disconnected
7. 点击重新连接
8. 确认新 sidecar 实际产生
9. 不点击任何 Session
10. 确认 Session A 自动恢复
11. 确认历史 conversation hydrate
12. 确认 UI ready
13. 立即发送下一条真实请求
14. 确认成功完成 Tool Calling + Streaming
```

这是 P1 的核心验收。

---

# 10. 必须执行两次 Restart Cycle

为了排除偶然：

```text
crash
→ reconnect
→ restore
→ turn success

再次 crash
→ reconnect
→ restore
→ turn success
```

两个周期全部成功才算 Runtime P1 PASS。

---

# 11. Tool / Streaming Evidence

Post-restart turn 不能只验证：

```text
有一段 Assistant 文本
```

必须确认：

```text
turn/start
tool/call
tool/result
assistant/chunk
turn/end
```

真实发生。

至少给出：

```text
tool name
event ordering
streaming evidence
```

不要展示或收集 reasoning-delta 内容。

---

# 12. Session Identity

Restart 前后必须确认：

```text
same sessionId
```

不能只是 UI 看起来有历史。

验证新进程实际：

```text
session.open(oldSessionId)
```

或等价证据。

---

# 13. Fake Ready Negative Check

重点寻找任何时间窗口：

```text
UI says Agent 已连接
+
Composer enabled
+
Bridge has no open session
```

只要能够出现：

# P1 FAIL

即使窗口只有几十毫秒也属于错误。

---

# 14. Regression Checks

至少确认：

```text
normal cold boot
new session
session switching
existing session open
normal turn
tool activity
streaming
memory
business errors
runtime disconnected card
restart button
```

没有因修复明显回归。

不要求重新执行所有产品 Demo，但核心 runtime 路径必须检查。

---

# 15. Business Core 不应被修改

确认本轮 Targeted Repair 没有为了修 Restart：

- 修改 Chinook Tools
- 修改 invoice ownership
- 修改 memory semantics
- 修改 identity semantics
- 修改 DSH Core
- 引入第二 Runtime

如果存在：

判为架构回归。

---

# 16. Repository Integrity

开始前记录仓库状态。

如果 Git 可用：

```text
git status --short
git diff --stat
```

结束后再次比较。

如果存在 untracked Desktop tree：

明确报告，但不要修改。

Read-only Audit 不允许改变 tracked project source。

测试产生的 gitignored runtime artifacts 可以存在，但必须记录。

---

# 17. Verdict

最终只允许：

# PASS

要求：

```text
P1 fixed
P3 fixed
all targeted tests pass
critical regressions absent
real two-cycle restart verification passes
post-restart real Tool Calling + Streaming passes
```

# FAIL

任何：

```text
fake ready remains
session not automatically restored
post-restart turn fails
restore can deadlock
P3 stale hint remains
tests fail
critical regression
```

都必须 FAIL。

# BLOCKED

只用于真正外部阻塞，例如：

```text
模型 credential 不可用
当前环境无法启动 Windows Desktop runtime
```

代码本身的问题不能称 BLOCKED。

---

# 18. Severity

问题分：

```text
P0 — Desktop 无法正常使用 / 数据安全问题
P1 — Restart Recovery / 核心 DoD 失败
P2 — 非阻塞真实缺陷
P3 — polish / minor state issue
```

只有：

```text
P0 = 0
P1 = 0
```

并且 P1/P3 修复验收通过，才允许 PASS。

---

# 19. Final Report

输出：

# DSH Chinook Desktop V2 — Targeted Repair Independent Acceptance

## Final Verdict

PASS / FAIL / BLOCKED

## P1 Restart Recovery

- Static:
- Automated:
- Runtime:
- Two-cycle:
- Same session restored:
- Post-restore turn:
- Tool evidence:
- Streaming evidence:
- Result:

## P3 Send Failure Hint

- State lifecycle:
- Automated evidence:
- Result:

## Regression

- pnpm test:
- cargo test:
- TypeScript:
- Frontend:
- Bridge:
- Core runtime:

## Issues

P0:
P1:
P2:
P3:

## Repository Integrity

说明验收前后状态。

## Final Recommendation

如果 PASS：

> **Desktop V2 targeted repair independently accepted. The Desktop V2 implementation can now be frozen.**

如果 FAIL：

> **Do not freeze Desktop V2. Return only the listed P0/P1/P3 defects to the Implementation Agent for targeted repair.**

如果 BLOCKED：

明确说明解除哪些真正外部条件后才能完成验收。

---

# 20. 最终原则

不修代码。

只验收。

不要相信上一位 Agent 的 Targeted Repair Report。

只相信：

```text
当前代码
测试
真实 Runtime
你亲自获得的证据
```

最终目标不是确认 Implementation Agent 的说法，而是独立判断：

# P1/P3 是否真的修复，并且修复没有引入关键回归。

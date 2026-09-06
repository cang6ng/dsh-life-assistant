# DSH Chinook Desktop V2 — UI / Interaction Design Brief

# 一、当前项目状态

请首先检查当前仓库的真实代码、目录结构、README、AgentRuntime、CLI、Session、事件流和现有配置。

不要假设仓库状态。

重点理解当前已经存在的：

```
TypeScript / Node.js
DeepSeek DSH Runtime
Chinook Plugin
7 个业务 Tools
SQLite
Session
Memory
CLI REPL
AgentRuntime
```

尤其确认当前 Agent Runtime 实际能够提供哪些事件，例如：

```
turn/start
tool/call
tool/result
assistant/chunk
turn/end
```

以及：

```
Session create
Session resume
Session persistence
```

这些是 Desktop UI 设计的真实基础。

# 二、不要重新验收 Agent V1

DSH Chinook Agent Core 已经通过前一阶段验收。

本阶段默认：

```
Agent Core = DONE
Business Layer = DONE
```

不要再次讨论：

- Agent V1 是否成立
- 是否应该使用 DSH
- 是否应该继续使用 TypeScript
- 是否需要 LangChain
- 是否应该换 Agent Framework

这些问题已经结束。

# 三、V2 产品方向已经冻结

下一阶段产品形态：

**Windows Desktop Agent Application**

技术路线固定：

## Desktop

```
Tauri v2
Rust
```

首期：

```
Windows First
```

未来允许扩展 macOS。

禁止：

```
Electron
```

## Frontend

固定：

```
React
TypeScript
Vite
@fluentui/react-components
Fluent UI React v9
```

UI：

```
中文
简洁
克制
现代
Windows Native Feeling
Raycast / Search Overlay 风格
Agent Native
```

不要做传统企业后台。

不要做传统商城网页。

不要做 ChatGPT 页面复制品。

# 四、最终架构已经冻结

目标：

```
React + Fluent UI
        ↓
Tauri Commands / Channels
        ↓
Rust Desktop Host
        ↓
stdin / stdout JSONL
        ↓
Node Agent Bridge
        ↓
现有 AgentRuntime
        ↓
DSH + Chinook Plugin + SQLite + LLM
```

职责：

```
Presentation Layer
React + Fluent UI

Desktop Host Layer
Tauri + Rust

Transport Adapter
Node Agent Bridge

Agent Application Layer
现有 TypeScript AgentRuntime + DSH

Business / Data Layer
Chinook Plugin + Tools + SQLite
```

# 五、本阶段禁止实现完整 V2

本阶段主要产出：

```
UI / UX / Interaction Spec
```

不要现在直接完成：

```
Tauri IPC integration
Node sidecar
Rust process manager
真实 Agent integration
Windows installer
完整 V2
```

除非为了理解现有项目需要做只读检查。

不要修改：

```
Agent Core
Chinook Plugin
Tools
Services
Memory
Identity
Session semantics
```

# 六、核心产品定义

这个应用不是：

```
音乐商城网站 + 一个客服聊天框
```

而是：

# 一个以 Agent 为核心的 AI 音乐商店桌面助手。

它必须让用户明显感受到：

```
LLM
↓
Agent Activity
↓
Tool Calling
↓
真实业务数据
↓
Streaming Answer
```

而不是一个普通聊天应用。

# 七、主产品结构

首期只设计：

# 单主窗口 Desktop Application

核心结构：

```
┌─────────────────────────────────────────────────────────────┐
│                       Title Bar                             │
├────────────────┬────────────────────────────────────────────┤
│                │                                            │
│ Session        │               Conversation                 │
│ Sidebar        │                                            │
│                │                                            │
│                │                                            │
│                │                                            │
│                │                                            │
│                │                                            │
│                │                                            │
│                │                                            │
│                │                 Composer                   │
├────────────────┴────────────────────────────────────────────┤
│                       Status Bar                            │
└─────────────────────────────────────────────────────────────┘
```

右侧可以存在：

```
Activity Drawer
```

但默认关闭。

不要默认三栏 Developer Console。

# 八、主界面必须详细设计

请完整设计：

## 1. Title Bar

包括：

```
Chinook 品牌
Agent Runtime 状态
必要 Windows Window Controls
```

状态至少：

```
正在启动
已连接
正在恢复
已断开
错误
```

不要设计复杂 Navigation Bar。

## 2. Session Sidebar

必须支持：

```
新建会话
当前会话
最近会话
历史会话
点击恢复
```

推荐按：

```
今天
昨天
更早
```

分组。

Session 主标题不要显示 UUID。

默认使用：

```
第一条 User Message
```

生成本地标题。

例如：

```
帮我找 Queen 的专辑
爵士乐推荐
查看我的订单
```

## 3. Conversation Area

必须详细定义：

```
User Message
Assistant Message
Agent Activity
Tool Activity
Streaming State
Error State
```

Assistant 回答必须成为视觉主体。

Tool Activity 是辅助信息。

## 4. Composer

必须定义：

```
输入
Enter submit
Shift + Enter newline
发送按钮
发送中状态
disabled 状态
empty 状态
```

V2 首期：

> 一个 Session 同时只允许一个 Active Turn。

所以：

```
turn/start
→ composer lock

turn/end
→ composer unlock
```

# 九、Empty State

新会话不能只是：

```
有什么可以帮您？
```

必须设计产品化 Empty State。

建议围绕三类能力：

```
音乐搜索
音乐推荐
订单查询
```

例如：

```
今天想听点什么？

搜索音乐、获取推荐，
或者查看你在 Chinook 的订单。

[帮我找 Queen 的专辑]

[推荐一些爵士乐]

[查看我的最近订单]
```

请进一步完善视觉层级、间距和交互。

# 十、Agent Activity 是 V2 核心

这是本阶段最重要的 UI 设计任务之一。

不要把 Agent 做成普通聊天框。

必须把当前已有事件：

```
turn/start
tool/call
tool/result
assistant/chunk
turn/end
```

映射成清晰的产品状态。

例如：

```
正在理解你的请求…
```

然后：

```
◌ 正在搜索音乐目录
```

完成：

```
✓ 已搜索音乐目录
  找到 5 个结果
```

然后：

```
Chinook

Queen 在 Chinook 中有以下专辑……
```

# 十一、禁止展示模型 Chain-of-Thought

UI 中所谓：

```
Thinking
```

只是：

```
Agent execution status
```

例如：

```
正在理解请求
正在搜索音乐目录
正在查询订单
正在读取音乐偏好
正在整理结果
```

禁止设计：

```
Thought:
用户问 Queen，所以我应该先……
```

不要展示隐藏推理。

# 十二、7 个 Tool 的产品化显示

当前 Agent 具有：

```
search_catalog
find_similar_albums
popular_in_genre
list_my_orders
get_invoice_details
remember
recall
```

请设计统一的：

```
Tool Display Metadata
```

例如：

| Internal Tool       | UI Name      |
| ------------------- | ------------ |
| search_catalog      | 搜索音乐目录 |
| find_similar_albums | 查找相似专辑 |
| popular_in_genre    | 查询热门音乐 |
| list_my_orders      | 查询我的订单 |
| get_invoice_details | 查询发票详情 |
| remember            | 保存音乐偏好 |
| recall              | 读取长期记忆 |

为每个 Tool 设计：

```
running state
success state
error state
compact summary
expanded detail
```

# 十三、Tool Activity 默认不能 dump JSON

禁止主界面默认：

```
search_catalog({
    query: "Queen",
    entity_type: "album"
})
```

普通用户看到：

```
✓ 已搜索音乐目录
找到 5 张相关专辑
```

点击：

```
查看详情
```

才可以看到：

```
Tool Name
Arguments
Result
Duration
Raw JSON
```

技术信息应是第二层。

# 十四、Activity Timeline

请设计：

```
Agent Activity
```

在一个 Turn 中的完整生命周期。

例如：

```
Agent Activity

✓ 读取长期记忆
✓ 搜索音乐目录 · 8 个结果
✓ 查询爵士乐热门歌曲
```

Turn 完成后自动压缩为：

```
✓ 完成 · 使用了 3 个工具
```

用户点击可以重新展开。

# 十五、Activity Drawer

右侧 Drawer 用于：

```
技术展示
Debug
面试 Demo
查看 Agent 行为
```

默认关闭。

展开后可以显示：

```
Turn
│
├── turn/start
│
├── recall
│   ├── arguments
│   └── result
│
├── search_catalog
│   ├── arguments
│   └── result
│
├── assistant streaming
│
└── turn/end
```

请详细设计：

```
什么时候出现入口
入口放在哪里
Drawer 宽度
内容层级
展开/收起行为
```

# 十六、Streaming UX

当前 Agent 已有：

```
assistant/chunk
```

所以必须做真正 Streaming UI。

定义：

```
first chunk
subsequent chunks
cursor / typing indicator
markdown rendering
auto scroll
user manual scroll
stream end
```

避免：

```
等整段回答完成后一次性显示。
```

# 十七、Auto Scroll

请明确设计：

用户位于：

```
conversation bottom
```

时：

```
assistant/chunk
→ 自动跟随
```

用户手动向上滚动后：

```
停止自动抢滚动
```

底部显示：

```
↓ 回到最新消息
```

避免 Streaming 强制把用户拉回底部。

# 十八、Session Resume UX

用户点击历史 Session：

```
SessionSidebar
 ↓
Loading
 ↓
Restore
 ↓
Conversation
```

请定义：

```
加载状态
恢复成功
恢复失败
当前 Session 切换
Turn 正在执行时是否允许切换
```

V2 首期建议：

> Active Turn 进行期间禁止 Session 切换。

# 十九、Runtime State

必须有完整 Desktop Runtime 状态设计。

至少：

```
Starting
Ready
Busy
Disconnected
Error
Restarting
```

对应 UI：

### Starting

```
正在启动 Chinook Agent…
```

### Ready

```
● Agent 已连接
```

### Busy

正常通过 Turn Activity 表达。

### Disconnected

```
Agent Runtime 已断开

[重新连接]
```

### Error

显示用户可理解的信息。

不要把 Rust stack trace 直接显示给普通用户。

# 二十、Error Model

区分：

## Business Error

例如：

```
ACCESS_DENIED
NOT_FOUND
```

属于：

```
Agent / Tool Result
```

UI 应自然表达。

例如：

```
! 无法访问该发票
```

最终 Assistant：

```
这张发票不属于当前账户，因此无法查看。
```

## Runtime Error

例如：

```
Node sidecar crash
DSH boot failure
IPC broken
```

属于：

```
Desktop Host Error
```

显示：

```
Agent Runtime 已断开

[重新启动]
```

这两类错误禁止混淆。

# 二十一、视觉设计

整体风格：

```
Fluent UI
Windows Native
Raycast
Command Palette
AI Native
Minimal
```

核心：

```
留白
柔和层级
轻边框
克制阴影
清晰 Typography
```

禁止：

```
大型渐变
赛博朋克
Dashboard
满屏 Card
传统企业蓝
ChatGPT Copy
Discord Copy
```

# 二十二、颜色

使用 Fluent Tokens 为基础。

主要：

```
Neutral Background
Neutral Foreground
Subtle Border
```

只允许一个轻量 Chinook Accent Color。

Tool：

```
Running
Success
Warning/Error
```

必须符合 Fluent Semantic Color。

不要手写大量 hard-coded hex。

# 二十三、Typography

请定义：

```
App title
Section title
Body
Secondary
Caption
Tool activity
Code / technical detail
```

优先使用系统字体：

```
Segoe UI Variable / Segoe UI
```

中文自然 fallback。

# 二十四、Window

目标首屏：

```
约 1050 × 700
```

但必须响应式。

请定义：

```
minimum width
minimum height
sidebar width
conversation max width
drawer width
composer width
```

小窗口时：

```
Sidebar 可以收起
```

首期不要做多窗口。

# 二十五、Dark / Light Theme

首期：

```
Follow System
```

必须同时考虑：

```
Light
Dark
```

但不需要 Settings 页面。

# 二十六、暂时不要优先做 Mica

可以在 Spec 中标记：

```
Optional Polish
```

但：

```
Mica / Acrylic
```

不属于第一版核心验收标准。

# 二十七、Frontend Component Architecture

请设计最终 React Component Tree。

例如：

```
App
│
├── DesktopShell
│
├── TitleBar
│
├── SessionSidebar
│
│   ├── NewSessionButton
│   ├── SessionGroup
│   └── SessionItem
│
├── ConversationView
│   ├── EmptyState
│   ├── UserMessage
│   ├── AssistantMessage
│   ├── TurnActivity
│   └── ScrollToBottom
│
├── Composer
│
├── ActivityDrawer
│
└── RuntimeStatus
```

可以优化，但不要过度组件化。

# 二十八、Frontend State Model

设计最小状态模型：

```
runtimeStatus
sessions
activeSessionId
conversationItems
activeTurn
activityDrawer
composer
```

不要直接引入：

```
Redux
MobX
复杂状态框架
```

除非你能证明 React reducer/context 完全不足。

首期优先：

```
React Context
useReducer
hooks
```

# 二十九、Conversation Data Model

请定义 UI 层需要的：

```
ConversationItem
```

例如：

```
type ConversationItem =
  | UserMessage
  | AssistantMessage
  | ActivityGroup;
```

再定义：

```
TurnActivity
ToolActivity
```

但不要直接让 React 依赖 DSH 内部 event 类型。

React 应消费：

```
Desktop Presentation Event
```

# 三十、Desktop Protocol 只需要设计，不实现

虽然本阶段不实施 IPC，但 UI Spec 必须明确未来 UI 依赖的事件模型。

至少：

```
protocolVersion
requestId
sessionId
turnId
seq
type
data
```

事件：

```
runtime/status

session/list
session/created
session/opened

turn/start

tool/call
tool/result

assistant/chunk

turn/error
turn/end
```

不要定义 Chinook-specific protocol：

```
queen_result
invoice_ui
jazz_recommendation
```

协议必须是通用 Agent Presentation Protocol。

# 三十一、普通 Request / Streaming Boundary

设计中明确：

普通 Request/Response：

```
session_list
session_create
session_open
agent_status
agent_restart
```

未来：

```
Tauri Commands
```

Streaming Turn：

```
turn_send
```

未来：

```
Tauri Channel
```

不要设计 REST/SSE/WebSocket。

# 三十二、Rust / React / Node 边界

Spec 中必须有明确表格：

## React

负责：

```
render
interaction
streaming UI
session navigation
activity visualization
```

不负责：

```
DSH
SQLite
Process
Tool
LLM
```

## Rust

负责：

```
window
app lifecycle
sidecar lifecycle
IPC
path/env
event forwarding
```

不负责：

```
music logic
invoice logic
memory logic
Agent orchestration
```

## Node Bridge

负责：

```
JSONL protocol
AgentRuntime adapter
event normalization
Session snapshot adapter
```

不负责：

```
new business tools
new LLM
business rules
```

## Agent Core

保持当前职责不变。

# 三十三、设计 Demo 场景

完整设计至少以下 5 个 Demo。

## Demo 1

```
帮我找一些 Queen 的专辑。
```

应展示：

```
User Message
↓
Agent Activity
↓
搜索音乐目录
↓
Tool Success
↓
Streaming Answer
```

## Demo 2

```
记住我喜欢爵士乐。
```

展示：

```
保存音乐偏好
```

## Demo 3

新 Session：

```
你记得我喜欢什么音乐吗？
```

展示：

```
读取长期记忆
↓
Jazz
```

## Demo 4

```
查看我的订单。
```

展示订单 Tool Activity。

## Demo 5

访问非本人 Invoice。

显示：

```
Tool Activity
↓
业务拒绝
↓
安全自然语言回答
```

不要显示恐怖的红色异常页。

# 三十四、Accessibility

至少考虑：

```
keyboard navigation
focus visible
screen reader labels
contrast
button aria labels
reduced motion
```

不需要做企业级 WCAG 文档。

但基础 Accessibility 必须进入设计。

# 三十五、动画

只允许：

```
150–250ms
subtle
functional
```

例如：

```
Activity expand
Drawer
Streaming cursor
Session switch
```

不要：

```
大面积弹跳
炫技动画
粒子效果
```

# 三十六、本阶段交付物

必须创建：

```
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

内容至少包含：

1. Product Definition
2. Design Principles
3. Information Architecture
4. Main Window
5. Layout Dimensions
6. Empty State
7. Conversation Model
8. User Message
9. Assistant Message
10. Streaming UX
11. Agent Activity
12. Tool Activity
13. Activity Drawer
14. Session Sidebar
15. Session Resume
16. Composer
17. Runtime Status
18. Error States
19. Light/Dark Theme
20. Typography
21. Spacing / Layout
22. Responsive Behavior
23. Accessibility
24. Component Architecture
25. Frontend State Model
26. Presentation Event Model
27. React/Rust/Node Responsibilities
28. Demo Flows
29. V2 UI Acceptance Criteria
30. Explicit Non-goals

# 三十七、必须包含 ASCII Wireframes

不要只写文字。

至少画：

```
Main Window
Empty State
Active Turn
Tool Expanded
Activity Drawer
Disconnected State
```

ASCII Wireframe。

要求足够具体，让开发 Agent 看文档就能实施。

# 三十八、必须给 Fluent UI Component Mapping

例如：

```
New Session
→ Button

Runtime Status
→ Badge

Activity Drawer
→ Drawer

Tool Details
→ Accordion

Composer
→ Textarea / Button
```

根据 Fluent UI React v9 实际组件合理选择。

# 三十九、不要实现代码

本阶段不要：

```
npm create tauri-app
创建 React 页面
创建 Rust Host
写 IPC
写 sidecar
```

唯一允许的项目修改：

```
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

如果为了调研当前实现确实需要运行只读命令，可以执行。

禁止修改其他文件。

# 四十、不要只给我最终摘要

你必须真正把完整 Spec 写入：

```
docs/DSH_CHINOOK_DESKTOP_V2_UI_SPEC.md
```

完成后再输出简短报告：

```
UI Spec created
关键设计决策
与当前 AgentRuntime 的映射
发现的实现约束
下一阶段建议
```

# 四十一、设计原则

如果存在多个合理设计：

优先选择：

```
更简单
更克制
更容易实际实现
更能体现 Agent 特征
更符合 Windows Desktop
```

不要为了“设计感”增加不必要功能。

# 四十二、不要自行扩 Scope

当前不要加入：

```
登录注册
商城主页
购物车
支付
退款
用户中心
云同步
多用户
多窗口
Web Server
RAG
Vector DB
Multi-Agent
MCP
Plugin Marketplace
macOS 正式支持
```

这些都不是当前目标。

# 四十三、最终目标

本阶段最终不是得到一个桌面 App。

而是得到：

**一份足够详细、没有关键产品歧义、可以直接交给下一位 Autonomous Implementation Agent 实施的 Desktop V2 UI Specification。**

成功标准：

> 下一阶段的 Implementation Agent 不需要自己重新设计界面，只需要严格按照这份 Spec 实现。
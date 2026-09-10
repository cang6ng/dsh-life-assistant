/**
 * Static UI strings (UI Spec §25). Fixed Chinese copy — a single module,
 * used verbatim everywhere. Tool rows read per-tool verbs from toolMeta.ts.
 */
export const copy = {
  "app.title": "DSH Life Assistant",
  "app.domain": "Chinook Music",
  "empty.headline": "今天想听点什么？",
  "empty.sub": "搜索音乐、获取推荐，或者查看你在 Chinook 的订单。数据来自真实目录，回答由 AI 助手一步步完成。",
  "empty.chip.queen": "帮我找 Queen 的专辑",
  "empty.chip.jazz": "推荐一些爵士乐",
  "empty.chip.orders": "查看我的最近订单",
  newSession: "新会话",
  "composer.placeholder": "问点什么…",
  "composer.hint": "Enter 发送，Shift + Enter 换行",
  "composer.sending": "Agent 正在回答…",
  "composer.sendFailed": "发送失败，请重试",
  "composer.counter": "{n}/4000",
  "sidebar.group.today": "今天",
  "sidebar.group.yesterday": "昨天",
  "sidebar.group.earlier": "更早",
  "sidebar.untitled": "新会话",
  "sidebar.switchLocked": "请等待当前回答完成",
  "sidebar.open": "会话列表",
  "activity.button": "活动",
  "activity.title": "活动事件",
  "activity.empty": "暂无活动事件",
  "activity.filter.all": "全部",
  "activity.filter.tools": "工具",
  understanding: "正在理解你的请求…",
  "strip.done": "完成 · 使用 {n} 个工具",
  "strip.stopped": "已停止 · 使用 {n} 个工具",
  "strip.failed": "出错了 · 使用 {n} 个工具",
  "strip.expand": "展开",
  "strip.collapse": "收起",
  "strip.noAnswer": "未生成回答",
  "detail.open": "查看详情",
  "detail.close": "收起详情",
  "detail.args": "参数",
  "detail.result": "结果",
  "detail.duration": "耗时",
  "detail.status": "状态",
  "detail.statusOk": "成功",
  "bubble.caption.limited": "回答达到长度上限",
  "bubble.caption.stopped": "已停止生成",
  "bubble.caption.interrupted": "上次回答未完成",
  "bubble.caption.failed": "回答中断",
  "scroll.backToLatest": "回到最新消息",
  "restore.loading": "正在恢复会话…",
  "restore.failed": "会话恢复失败",
  "restore.retry": "重试",
  "restore.close": "关闭",
  "archive.older": "…更早的 {n} 条消息已归档",
  "status.starting": "正在启动…",
  "status.ready": "Agent 已连接",
  "status.restoring": "正在恢复…",
  "status.disconnected": "已断开",
  "status.error": "错误",
  "status.restarting": "正在重新启动…",
  "status.busy": "Agent 正在回答…",
  "status.model": "{model} · 会话已自动保存",
  "card.starting.title": "正在启动 DSH Life Assistant…",
  "card.disconnected.title": "Agent Runtime 已断开",
  "card.disconnected.sub": "与 Agent 的连接意外中断。你的会话已保存在本机，不会丢失。",
  "card.disconnected.action": "重新连接",
  "card.error.title": "出问题了",
  "card.error.action": "重新启动",
  "card.error.retryFailed": "重试失败，请稍后再试",
  // §17.1 business error captions by code
  "err.tool.accessDenied": "无法访问该内容",
  "err.tool.identityRequired": "需要客户身份",
  "err.tool.notFound": "未找到相关数据",
  "err.tool.invalidArgument": "请求参数无效",
  "err.tool.data": "数据服务异常",
  "err.tool.unknown": "操作失败",
  // §17.2 turn-level failures
  "err.turn.generation": "回答生成失败",
  "err.turn.unknown": "未知错误",
  // §23.4: announced prefix for the once-announced error line `出了错：{caption}`.
  "err.announce": "出了错：",
  "provenance.assistant": "Chinook Music",
  // ---- model-endpoint configuration (ApiConfigPanel) ----------------------
  "config.button": "模型设置",
  "config.title": "模型设置",
  "config.sub": "配置一个 OpenAI 兼容的模型端点。Base URL 与 API Key 保存后立即生效；模型名称保存后应用到下一条消息。",
  "config.baseUrl.label": "Base URL",
  "config.baseUrl.hint": "留空使用默认端点。只需填到域名（或 /v1），不要包含 /chat/completions。",
  "config.baseUrl.stripped": "已自动去掉 /chat/completions 后缀",
  "config.baseUrl.overridden": "当前使用自定义端点",
  "config.apiKey.label": "API Key",
  "config.apiKey.hint": "留空表示保持已保存的密钥。密钥只写入本机凭据库，界面不会回显。",
  "config.apiKey.configured": "已配置（来源：{source}）",
  "config.apiKey.missing": "尚未配置",
  "config.apiKey.readOnly": "密钥由启动环境提供（{ref}），无法在应用内修改。请先移除该环境变量再重启应用。",
  "config.apiKey.clear": "清除密钥",
  "config.apiKey.willClear": "保存后将清除本机保存的密钥",
  "config.model.label": "模型名称",
  "config.model.hint": "模型名会原样发送给端点。",
  "config.model.fetch": "获取模型",
  "config.model.listLabel": "模型列表",
  "config.model.fetching": "正在获取…",
  "config.model.fetchTitle": "从 Base URL 请求模型列表（GET /models）",
  "config.model.fetchNeedBaseUrl": "请先填写 Base URL，再获取模型列表",
  "config.model.fetchLocked": "请等待当前回答完成，再获取模型列表",
  "config.model.fetched": "已获取 {count} 个模型 · 也可直接输入",
  "config.model.fetchEmpty": "端点未返回任何模型，请手动填写模型名称",
  "config.model.fetchFailed": "获取失败：{message}",
  "config.save": "保存",
  "config.saveAndTest": "保存并测试连接",
  "config.test": "测试连接",
  "config.test.dirty": "请先保存，再测试连接",
  "config.close": "关闭",
  "config.loading": "正在读取配置…",
  "config.locked": "请等待当前回答完成",
  "config.saving": "正在保存…",
  "config.testing": "正在测试连接…",
  "config.saved": "已保存",
  "config.saved.applying": "已保存，模型将在下一条消息生效",
  "config.test.ok": "连接成功（{ms} ms）",
  "config.test.fail": "连接失败：{message}",
  "config.err.baseUrl": "请输入以 http:// 或 https:// 开头的地址",
  "config.err.model": "模型名称不能为空",
  "config.err.load": "无法读取配置：{message}",
  "config.err.save": "保存失败：{message}",
  "config.err.notReady": "Agent 尚未就绪，请稍后重试",
  "config.err.noHost": "无法与 Agent 通信，请重新启动应用",
  "card.config.action": "模型设置",
} as const;

export type CopyKey = keyof typeof copy;

export function stripCopy(kind: "done" | "stopped" | "failed", n: number): string {
  const key = kind === "done" ? "strip.done" : kind === "stopped" ? "strip.stopped" : "strip.failed";
  return copy[key].replace("{n}", String(n));
}

/** The status-bar caption with the live model id (§16.6). */
export function statusModelCopy(model: string): string {
  return copy["status.model"].replace("{model}", model);
}

/** `已配置（来源：…）` — the layer a stored key resolves from, never its value. */
export function apiKeyConfiguredCopy(source: string): string {
  return copy["config.apiKey.configured"].replace("{source}", source);
}

export function apiKeyReadOnlyCopy(ref: string): string {
  return copy["config.apiKey.readOnly"].replace("{ref}", ref);
}

export function configLoadFailedCopy(message: string): string {
  return copy["config.err.load"].replace("{message}", message);
}

export function configSaveFailedCopy(message: string): string {
  return copy["config.err.save"].replace("{message}", message);
}

export function configTestOkCopy(ms: number): string {
  return copy["config.test.ok"].replace("{ms}", String(ms));
}

export function configTestFailCopy(message: string): string {
  return copy["config.test.fail"].replace("{message}", message);
}

/** `已获取 N 个模型 · 也可直接输入` — N is a count, never any part of the body. */
export function modelsFetchedCopy(count: number): string {
  return copy["config.model.fetched"].replace("{count}", String(count));
}

export function modelsFetchFailedCopy(message: string): string {
  return copy["config.model.fetchFailed"].replace("{message}", message);
}

/**
 * A `config.test`/`config.models` request the bridge itself refused, so the
 * probe (or the listing) never ran. The bridge's Chinese words are for a
 * person, not for a user staring at a disabled composer — translate the two
 * that mean something here.
 */
export function configRequestFailedCopy(code: string, message: string): string {
  if (code === "NOT_READY") return copy["config.err.notReady"];
  if (code === "TURN_ACTIVE") return copy["config.locked"];
  return message;
}

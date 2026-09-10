/**
 * Connection-probe failure captions (§17.1 caption style).
 *
 * The 「测试连接」 probe reports its outcome as a code from the DSH LLM
 * taxonomy plus a fixed Chinese caption. The mapping lives here — host-side,
 * pure, and unit-testable under node — so the React surface only renders a
 * string it was handed and never has to know a single `@deepseek-ai/*` code
 * (contract §44/§60).
 *
 * Deliberately code-only: the provider's raw failure text is NEVER rendered
 * into this caption. A misconfigured gateway can echo the request (or even the
 * credential) back in its error body, and a caption travels host → Rust →
 * React → DOM; the machine-routable code carries the diagnostic value the user
 * can act on, and the full text stays in the host's own stderr log.
 */

/** The subset of an LLM failure this mapping judges (never the raw value). */
export interface ProbeFailureLike {
  /** Stable provider-neutral machine-routing code (dsh-llm `LlmFailure.code`). */
  code?: string;
  /** HTTP status the provider returned, when available. */
  status?: number;
  /** True when the probe's own deadline expired rather than the provider failing. */
  timedOut?: boolean;
}

/** Options carrying probe-time facts the caption interpolates. */
export interface ProbeFailureContext {
  /** The probe's own deadline in milliseconds (rendered as whole seconds). */
  timeoutMs?: number;
}

const CHAT_COMPLETIONS_HINT = "请确认它是 OpenAI 兼容的 /chat/completions 端点";

function timeoutSeconds(context: ProbeFailureContext): number {
  return Math.max(1, Math.round((context.timeoutMs ?? 20_000) / 1000));
}

/**
 * Render one probe failure as a fixed Chinese caption.
 * @param failure - the machine-routable code plus optional status/deadline facts.
 * @param context - probe-time facts used by the timeout caption.
 * @returns the caption to render verbatim; never empty.
 */
export function describeProbeFailure(
  failure: ProbeFailureLike,
  context: ProbeFailureContext = {},
): string {
  if (failure.timedOut === true) {
    return `连接超时（${timeoutSeconds(context)} 秒），请检查 Base URL 与网络`;
  }
  switch (failure.code) {
    case "MISSING_CREDENTIAL":
      return "尚未配置 API Key，请填写后保存再测试";
    case "INVALID_CREDENTIAL":
      return "API Key 格式不正确，请重新填写";
    case "AUTH":
      return "API Key 被拒绝（401/403），请检查密钥是否有效";
    case "QUOTA":
      return "账户额度不足或已欠费";
    case "NO_ADAPTER":
      return "模型路由未注册，请重新启动 Agent";
    case "RATE_LIMIT":
      return "请求被限流（429），请稍后再试";
    case "SERVER":
      return "端点服务异常（5xx），请稍后再试";
    case "CONTEXT_WINDOW_EXCEEDED":
      return "上下文超出该模型的窗口上限";
    case "INVALID_REQUEST":
      return `请求被端点拒绝（400）${CHAT_COMPLETIONS_HINT}`;
    case "HTTP_404":
      return "地址或模型不存在（404），请检查 Base URL 与模型名称";
    case "TRANSPORT":
      return "无法连接到该端点，请检查 Base URL 与网络";
    case "TIMEOUT":
      return `连接超时（${timeoutSeconds(context)} 秒），请检查 Base URL 与网络`;
    case "ABORTED":
      return "请求已取消";
    case "STREAM_CLOSED":
    case "INVALID_RESPONSE":
      return `端点未返回完整响应，${CHAT_COMPLETIONS_HINT}`;
    case undefined:
    case "":
      return "连接失败，请检查 Base URL、API Key 与模型名称";
    default:
      // A provider-specific HTTP status keeps its number; anything else keeps
      // its code. Both are machine facts, never provider prose.
      return failure.code.startsWith("HTTP_")
        ? `端点返回 HTTP ${failure.code.slice("HTTP_".length)}`
        : `连接失败（${failure.code}）`;
  }
}

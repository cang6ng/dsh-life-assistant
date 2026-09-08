/**
 * Tool display metadata + summary builders (UI Spec §10.1/§10.2).
 * Wire names/result shapes verified against §30.3 (V1 payloads). Pure
 * presentational mapping: no logic beyond turning a generic result JSON
 * into one Chinese summary line.
 */

import type { ToolActivity } from "./protocol/types";
import { copy } from "./copy";

export interface ToolMeta {
  /** Running verb, e.g. "正在搜索音乐目录". */
  running: string;
  /** Done verb, e.g. "已搜索音乐目录". */
  done: string;
  /** Fluent icon name (see toolIcon.ts for the component map). */
  icon: "Search" | "Albums" | "MusicNote" | "Receipt" | "Document" | "Bookmark" | "History" | "Code";
  role: string;
}

export const TOOL_META: Record<string, ToolMeta> = {
  search_catalog: {
    running: "正在搜索音乐目录",
    done: "已搜索音乐目录",
    icon: "Search",
    role: "目录搜索",
  },
  find_similar_albums: {
    running: "正在查找相似专辑",
    done: "已查找相似专辑",
    icon: "Albums",
    role: "音乐推荐",
  },
  popular_in_genre: {
    running: "正在查询热门音乐",
    done: "已查询热门音乐",
    icon: "MusicNote",
    role: "音乐推荐",
  },
  list_my_orders: {
    running: "正在查询订单",
    done: "已查询订单",
    icon: "Receipt",
    role: "订单",
  },
  get_invoice_details: {
    running: "正在查询发票详情",
    done: "已查询发票详情",
    icon: "Document",
    role: "订单",
  },
  remember: {
    running: "正在保存音乐偏好",
    done: "已保存音乐偏好",
    icon: "Bookmark",
    role: "记忆",
  },
  recall: {
    running: "正在读取长期记忆",
    done: "已读取长期记忆",
    icon: "History",
    role: "记忆",
  },
};

/**
 * §17.1 presentation caption for a tool error code (fixed Chinese). Unknown
 * codes and identity/data families fall back per the spec mapping; raw
 * English messages appear only in the detail layer.
 */
export function toolErrorCaption(code: string | undefined): string {
  switch (code) {
    case "ACCESS_DENIED":
      return copy["err.tool.accessDenied"];
    case "IDENTITY_REQUIRED":
      return copy["err.tool.identityRequired"];
    case "NOT_FOUND":
      return copy["err.tool.notFound"];
    case "INVALID_ARGUMENT":
      return copy["err.tool.invalidArgument"];
    case "DATABASE_ERROR":
    case "MEMORY_ERROR":
      return copy["err.tool.data"];
    default:
      return copy["err.tool.unknown"];
  }
}

/** Fallback for unknown/future tool names (§10.1: `运行 {name}` / generic glyph). */
export function metaFor(name: string): ToolMeta {
  return (
    TOOL_META[name] ?? {
      running: `运行 ${name}`,
      done: `已完成 ${name}`,
      icon: "Code",
      role: name,
    }
  );
}

// ---------------------------------------------------------------------------
// §10.2 compact summaries from result JSON (keys per §30.3)
// ---------------------------------------------------------------------------

/** Structural accessor used by the per-tool builders below. */
function asRecord(v: unknown): Record<string, unknown> | undefined {
  if (v !== null && typeof v === "object") return v as Record<string, unknown>;
  return undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

const ENTITY_LABEL: Record<string, string> = {
  album: "张专辑",
  track: "首曲目",
  artist: "位艺人",
  genre: "个流派",
};

/** `找到 {count} 条结果` family — entity_type narrows the unit word. */
function searchSummary(result: unknown): string {
  const r = asRecord(result);
  if (!r) return "找到结果";
  const count = num(r.count) ?? 0;
  const unit = ENTITY_LABEL[str(r.entity_type) ?? "all"] ?? "条结果";
  return `找到 ${count} ${unit}`;
}

/**
 * §10.2 summary builders. `tool` is the finalized ToolActivity (call
 * arguments + result merged by the reducer, so both sides are available).
 */
export function summarizeTool(tool: ToolActivity): string {
  if (!tool.ok) {
    return tool.error?.code ?? "操作失败";
  }
  const name = tool.name;
  const r = asRecord(tool.result);
  const count = r ? num(r.count) : undefined;
  switch (name) {
    case "search_catalog":
      return searchSummary(tool.result);
    case "find_similar_albums":
      return `推荐 ${count ?? 0} 张相似专辑`;
    case "popular_in_genre":
      return `${str(r?.genre) ?? "该流派"} 热门 · ${count ?? 0} 首`;
    case "list_my_orders":
      return `共 ${count ?? 0} 笔订单`;
    case "get_invoice_details": {
      const invoice = asRecord(r?.invoice);
      const invoiceId = invoice ? num(invoice.invoiceId) : undefined;
      const lines = invoice && Array.isArray(invoice.lines) ? invoice.lines.length : 0;
      return `发票 #${invoiceId ?? "?"} · ${lines} 条明细`;
    }
    case "remember": {
      const memory = asRecord(r?.memory);
      const text = memory ? str(memory.text) : undefined;
      if (!text) return "已记住音乐偏好";
      return `已记住：${text.length > 18 ? `${text.slice(0, 18)}…` : text}`;
    }
    case "recall":
      return `找到 ${count ?? 0} 条偏好记录`;
    default:
      return "操作完成";
  }
}

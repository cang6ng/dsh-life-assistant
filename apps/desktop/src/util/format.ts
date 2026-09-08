/**
 * Presentation formatting helpers (UI Spec §5.2, §6.5, §10.4, §20).
 * Local-clock strings; no Intl deps (Chinese copy is static — §25).
 */

import { copy } from "../copy";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `HH:mm` in the user's local time (tabular digits where trivial). */
export function formatClock(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** `MM-DD` for non-today timestamps. */
export function formatShortDate(ts: number): string {
  const d = new Date(ts);
  return `${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Sidebar time label: today → `HH:mm`, else `MM-DD` (§5.2). */
export function sideTimeLabel(ts: number): string {
  const now = new Date();
  const d = new Date(ts);
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  return sameDay ? formatClock(ts) : formatShortDate(ts);
}

function startOfLocalDay(d: Date): number {
  const c = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  return c.getTime();
}

export type DayGroup = "today" | "yesterday" | "earlier";

/** Calendar-day grouping key (§5.2): 今天 / 昨天 / 更早. */
export function dayGroup(ts: number): DayGroup {
  const now = new Date();
  const dayStart = startOfLocalDay(now);
  const tsStart = startOfLocalDay(new Date(ts));
  if (tsStart >= dayStart) return "today";
  if (tsStart >= dayStart - 86_400_000) return "yesterday";
  return "earlier";
}

/** Duration `ms` → `1.2s` / `340ms` (§10.4 detail 耗时). */
export function formatDuration(ms?: number): string {
  if (ms === undefined || ms === null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  return `${s >= 10 ? s.toFixed(0) : s.toFixed(1)}s`;
}

/** Truncate `text` at `max` chars appending `…` (spec: 24 for titles). */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

/**
 * §5.2 title rule: first user message — trimmed, newlines collapsed to
 * spaces, truncated at 24 chars with `…`; empty → “新会话”.
 */
export function titleFromText(text: string): string {
  const flat = text.replace(/\s*\n+\s*/g, " ").trim();
  if (!flat) return copy["sidebar.untitled"];
  return truncate(flat, 24);
}

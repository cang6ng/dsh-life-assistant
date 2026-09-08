/**
 * ActivityDrawer (§12/§27.1): the raw normalized event timeline of the
 * active session — the technical showcase surface. 360 px overlay from the
 * right edge of the main region (below the title bar, above the status bar),
 * NO backdrop, 1 px left border (colorNeutralStroke2), 200 ms translateX +
 * opacity animation. Rows grouped per turn, newest at bottom; consecutive
 * chunk rows coalesce into one `assistant/chunk ×n` row; clicking a row
 * expands its raw payload (pretty JSON, one expanded row per turn at a
 * time). Filters: 全部 / 工具 (tools hides turn/chunk/step/end rows).
 * Auto-scroll follows while the drawer is open and the user is at the
 * bottom (§15.2 rule applied to the drawer).
 */

import { useEffect, useRef, useState } from "react";
import { Button, makeStyles, tokens } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { TimelineRow, ToolActivity } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { metaFor, type ToolMeta } from "../../toolMeta";
import { formatDuration, sideTimeLabel } from "../../util/format";
import { toolGlyph } from "../../toolIcon";

const useStyles = makeStyles({
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    width: "360px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 20,
    boxShadow: tokens.shadow8,
  },
  open: {
    transform: "translateX(0)",
    opacity: 1,
    visibility: "visible",
    transition: "transform 200ms ease-out, opacity 200ms ease-out",
  },
  closed: {
    transform: "translateX(8px)",
    opacity: 0,
    visibility: "hidden",
    pointerEvents: "none",
    transition: "transform 200ms ease, opacity 200ms ease, visibility 0s linear 200ms",
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
    padding: "0 8px 0 18px",
    height: "44px",
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerTitle: {
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
    marginRight: "auto",
  },
  list: {
    flex: "1 1 auto",
    minHeight: "0",
    overflowY: "auto",
    padding: "10px 12px 16px",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  empty: {
    flex: "1 1 auto",
    display: "grid",
    placeItems: "center",
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
  },
  group: {
    display: "flex",
    flexDirection: "column",
    gap: "1px",
  },
  groupHead: {
    fontSize: "12px",
    lineHeight: "16px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "4px",
    fontVariantNumeric: "tabular-nums",
  },
  row: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    border: "none",
    background: "transparent",
    borderRadius: "4px",
    padding: "2px 6px",
    minHeight: "24px",
    cursor: "pointer",
    textAlign: "left",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    lineHeight: "18px",
    color: tokens.colorNeutralForeground2,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground2,
    },
    "&:focus-visible": {
      outline: `1px solid ${tokens.colorBrandStroke1}`,
    },
  },
  rowDanger: {
    color: tokens.colorStatusDangerForeground1,
  },
  rowOk: {
    color: tokens.colorStatusSuccessForeground1,
  },
  rowLabel: {
    flex: "1 1 auto",
    minWidth: "0",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowTime: {
    flexShrink: 0,
    fontSize: "11px",
    color: tokens.colorNeutralForeground3,
    fontVariantNumeric: "tabular-nums",
  },
  raw: {
    margin: "2px 4px 4px",
    padding: "6px 8px",
    borderRadius: "4px",
    backgroundColor: tokens.colorNeutralBackground3,
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    lineHeight: "17px",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: tokens.colorNeutralForeground2,
    maxHeight: "200px",
    overflowY: "auto",
  },
  icon: {
    display: "inline-flex",
    flexShrink: 0,
    fontSize: "12px",
  },
});

/** Compact one-line payload summary for tool rows (§12.4 `recall {…}`). */
function compactArgs(args: Record<string, unknown>): string {
  try {
    const s = JSON.stringify(args);
    if (s === undefined || s === "{}") return "{}";
    return s.length > 46 ? `${s.slice(0, 46)}…` : s;
  } catch {
    return "{}";
  }
}

interface DisplayRow {
  key: string;
  ts: number;
  /** 'tool' = a tool call/result row (kept under the 工具 filter). */
  kind: "tool" | "event";
  ok?: boolean;
  icon?: ToolMeta["icon"];
  label: string;
  /** Raw payload shown when the row is expanded (never in the primary line). */
  payload: unknown;
}

interface DisplayGroup {
  turnId: number;
  startedAt: number;
  rows: DisplayRow[];
}

/** Map the flat timeline onto per-turn display rows (chunks coalesced). */
function buildDisplayRows(log: TimelineRow[]): DisplayGroup[] {
  const groups: { turnId: number; rows: TimelineRow[]; startedAt: number }[] = [];
  for (const row of log) {
    let group = groups[groups.length - 1];
    if (group === undefined || group.turnId !== row.turnId) {
      group = { turnId: row.turnId, rows: [], startedAt: row.ts };
      groups.push(group);
    }
    group.rows.push(row);
  }
  const out: DisplayGroup[] = [];
  for (const g of groups) {
    const rows: DisplayRow[] = [];
    let chunkRun: Extract<TimelineRow, { type: "chunk" }>[] = [];
    const flushChunks = (): void => {
      if (chunkRun.length === 0) return;
      const count = chunkRun.length;
      const chars = chunkRun.reduce((acc, r) => acc + r.chars, 0);
      const first = chunkRun[0].ts;
      const last = chunkRun[chunkRun.length - 1].ts;
      rows.push({
        key: `chunk-${first}`,
        ts: last,
        kind: "event",
        label: `assistant/chunk ×${count} · ${chars} 字`,
        payload: { count, chars, spanMs: last - first, firstTs: first, lastTs: last },
      });
      chunkRun = [];
    };
    const toolRow = (
      tag: "call" | "result",
      rowTs: number,
      t: ToolActivity,
      label: string,
      payload: unknown,
      ok?: boolean,
    ): DisplayRow => ({
      // tag + log-row ts disambiguate a hydrated call/result pair: resumed
      // logs carry the same tool snapshot on both rows, and a fast local tool
      // can put both events in the same millisecond.
      key: `${tag}-${t.callId}-${rowTs}`,
      ts: rowTs,
      kind: "tool",
      ok,
      icon: metaFor(t.name).icon,
      label,
      payload,
    });
    for (const row of g.rows) {
      switch (row.type) {
        case "turn/start":
          rows.push({ key: "start", ts: row.ts, kind: "event", label: "turn/start", payload: { turnId: row.turnId } });
          break;
        case "tool/call":
          flushChunks();
          rows.push(
            toolRow("call", row.ts, row.tool, `tool/call ${row.tool.name} ${compactArgs(row.tool.arguments)}`, {
              name: row.tool.name,
              callId: row.tool.callId,
              arguments: row.tool.arguments,
            }),
          );
          break;
        case "tool/result":
          flushChunks();
          rows.push(
            toolRow(
              "result",
              row.ts,
              row.tool,
              `tool/result ${row.tool.name} ${row.tool.ok ? "ok" : row.tool.error?.code ?? "error"} ${formatDuration(row.tool.durationMs)}`,
              {
                name: row.tool.name,
                callId: row.tool.callId,
                ok: row.tool.ok,
                durationMs: row.tool.durationMs,
                error: row.tool.error,
                result: row.tool.result,
              },
              row.tool.ok,
            ),
          );
          break;
        case "chunk":
          chunkRun.push(row);
          break;
        case "step":
          flushChunks();
          rows.push({
            key: `step-${row.ts}`,
            ts: row.ts,
            kind: "event",
            label: "assistant/message",
            payload: { usage: row.usage, interrupted: row.interrupted },
          });
          break;
        case "turn/error":
          flushChunks();
          rows.push({
            key: `err-${row.ts}`,
            ts: row.ts,
            kind: "event",
            label: `turn/error ${row.code}`,
            payload: { code: row.code, message: row.message },
          });
          break;
        case "turn/end":
          flushChunks();
          rows.push({
            key: `end-${row.ts}`,
            ts: row.ts,
            kind: "event",
            label: `turn/end ${row.reason}`,
            payload: { reason: row.reason },
          });
          break;
      }
    }
    flushChunks();
    out.push({ turnId: g.turnId, startedAt: g.startedAt, rows });
  }
  return out;
}

type Filter = "all" | "tools";

export function ActivityDrawer() {
  const styles = useStyles();
  const { state, actions } = useApp();
  const open = state.ui.drawerOpen;
  const filter: Filter = state.ui.drawerFilter;
  const log = state.conversation.log;
  const sessionId = state.activeSessionId;
  const listRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const prevLogLenRef = useRef(log.length);
  const [expanded, setExpanded] = useState<Record<number, string>>({});

  // §12.4 rows stream in live — auto-scroll to the newest unless the user
  // scrolled up inside the drawer (same rule as §15.2, local to the drawer).
  useEffect(() => {
    const el = listRef.current;
    if (el === null) return;
    const grew = log.length !== prevLogLenRef.current;
    prevLogLenRef.current = log.length;
    if (grew && open && followingRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [log.length, open]);

  // Session switch: list replaced — reset follow and row expansion.
  useEffect(() => {
    followingRef.current = true;
    setExpanded({});
    const el = listRef.current;
    if (el !== null && open) el.scrollTop = el.scrollHeight;
  }, [sessionId, open]);

  const all = buildDisplayRows(log);
  const shown: DisplayGroup[] =
    filter === "tools"
      ? all
          .map((g) => ({ ...g, rows: g.rows.filter((r) => r.kind === "tool") }))
          .filter((g) => g.rows.length > 0)
      : all;
  const empty = shown.length === 0;
  const shortSession =
    sessionId !== null && sessionId.length > 14 ? `${sessionId.slice(0, 14)}…` : (sessionId ?? "");

  return (
    <div className={open ? `${styles.drawer} ${styles.open}` : `${styles.drawer} ${styles.closed}`} aria-hidden={!open}>
      <div className={styles.header}>
        <span className={styles.headerTitle}>{copy["activity.title"]}</span>
        {(["all", "tools"] as Filter[]).map((f) => (
          <Button
            key={f}
            appearance={filter === f ? "secondary" : "subtle"}
            size="small"
            aria-pressed={filter === f}
            onClick={() => actions.setDrawerFilter(f)}
          >
            {f === "all" ? copy["activity.filter.all"] : copy["activity.filter.tools"]}
          </Button>
        ))}
        <Button
          appearance="subtle"
          size="small"
          aria-label={copy["detail.close"]}
          icon={<DismissRegular aria-hidden="true" />}
          onClick={actions.closeDrawer}
        />
      </div>
      {empty ? (
        <div className={styles.empty}>{copy["activity.empty"]}</div>
      ) : (
        <div
          ref={listRef}
          className={styles.list}
          role="log"
          aria-label={copy["activity.title"]}
          onScroll={() => {
            const el = listRef.current;
            if (el === null) return;
            followingRef.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 80;
          }}
        >
          {shown.map((group) => (
            <div className={styles.group} key={group.turnId}>
              <div className={styles.groupHead}>
                {shortSession} · {sideTimeLabel(group.startedAt)}
              </div>
              {group.rows.map((row) => {
                const isExpanded = expanded[group.turnId] === row.key;
                const toneCls = row.ok === false ? styles.rowDanger : row.ok === true ? styles.rowOk : undefined;
                const Icon = row.icon !== undefined ? toolGlyph(row.icon) : null;
                return (
                  <div key={row.key}>
                    <button
                      type="button"
                      className={`${styles.row} ${toneCls ?? ""}`}
                      onClick={() =>
                        setExpanded((prev) => {
                          const next = { ...prev };
                          if (next[group.turnId] === row.key) delete next[group.turnId];
                          else next[group.turnId] = row.key;
                          return next;
                        })
                      }
                      aria-expanded={isExpanded}
                    >
                      {Icon !== null ? (
                        <Icon className={styles.icon} aria-hidden="true" />
                      ) : (
                        <span aria-hidden="true">•</span>
                      )}
                      <span className={styles.rowLabel}>{row.label}</span>
                      <span className={styles.rowTime}>{formatDuration(row.ts - group.startedAt)}</span>
                    </button>
                    {isExpanded && <pre className={styles.raw}>{prettyPayload(row.payload)}</pre>}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function prettyPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

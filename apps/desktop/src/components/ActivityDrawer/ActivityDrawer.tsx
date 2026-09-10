/**
 * ActivityDrawer (§12/§27.1): the raw normalized event timeline of the
 * active session — the technical showcase surface. 360 px overlay from the
 * right edge of the main region (below the title bar, above the status bar),
 * NO backdrop, 1 px left border (colorNeutralStroke2), 200 ms translateX +
 * opacity animation. Rows grouped per turn, newest at bottom; consecutive
 * chunk rows coalesce into one `assistant/chunk ×n` row; expanding a row
 * reveals its raw payload (pretty JSON, one expanded row per turn at a
 * time). Filters: 全部 / 工具 (tools hides turn/chunk/step/end rows).
 * Auto-scroll follows while the drawer is open and the user is at the
 * bottom (§15.2 rule applied to the drawer).
 *
 * Structure and motion are Fluent's now (`OverlayDrawer` + `DrawerHeader` /
 * `DrawerBody`, `Accordion` rows, a `TabList` filter, `ChinookDrawerMotion`),
 * replacing a hand-rolled translateX overlay, hand-rolled `aria-expanded`
 * rows, a hand-rolled focus ring and two `aria-pressed` buttons.
 *
 * Two structural consequences worth knowing before editing:
 *
 *  - **§12.4's "Backdrop: none, ever" is now guaranteed by the component,
 *    not by a comment.** `OverlayDrawer` renders a backdrop only when
 *    `modalType !== "non-modal"`, so `non-modal` is what makes the rule
 *    structural. It also means there is deliberately no focus trap and no
 *    body-scroll lock — the drawer must never dim or freeze the live answer,
 *    so Esc and the close button are the whole dismissal story.
 *  - **The drawer is `position: fixed`, but it must not cover the bars.**
 *    Fluent anchors the surface to the viewport (`top:0; bottom:0`), which
 *    would put it over the 40 px title bar — including the window controls.
 *    §12.4 wants it below the title bar and above the status bar. Two things
 *    arrange that, and both are needed: this drawer is portaled into the main
 *    region rather than the default body node (`mountNode`), and that region
 *    carries `contain: paint`, which makes it the containing block for fixed
 *    descendants. The geometry then follows the bars automatically instead of
 *    duplicating their heights here.
 */

import { useEffect, useRef, useState } from "react";
import {
  Accordion,
  AccordionHeader,
  AccordionItem,
  AccordionPanel,
  Button,
  DrawerBody,
  DrawerHeader,
  OverlayDrawer,
  Tab,
  TabList,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { TimelineRow, ToolActivity } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { DRAWER_SURFACE_MOTION } from "../../motion";
import { metaFor, type ToolMeta } from "../../toolMeta";
import { formatDuration, sideTimeLabel } from "../../util/format";
import { toolGlyph } from "../../toolIcon";

const useStyles = makeStyles({
  drawer: {
    // §29: "width fixed at 360 px by CSS on the drawer panel (component size
    // presets are irrelevant)". Fluent's presets are 320/592/940/full, so the
    // width goes through the same custom property Fluent sizes itself from —
    // which also means ChinookDrawerMotion's slide travels exactly one panel
    // width, with no second copy of "360".
    "--fui-Drawer--size": "360px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderLeft: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow8,
  },
  // DrawerHeader is a column with XXL padding from the library; §12.4/§29's
  // header is a 44 px row. The structure (and its slots) stays Fluent's.
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: "4px",
    height: "44px",
    padding: "0 8px 0 18px",
    flexShrink: 0,
    borderBottom: `1px solid ${tokens.colorNeutralStroke2}`,
  },
  headerTitle: {
    fontSize: "12px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground2,
    marginRight: "auto",
  },
  // DrawerBody is the scroll container (the library gives it flex:1 +
  // overflow:auto), so the auto-follow ref belongs on it.
  list: {
    flex: "1 1 auto",
    minHeight: "0",
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
  // An AccordionHeader's own box is a full-width padded button; §12.4's row
  // is a dense monospace line, so the metrics are overridden while the
  // button, its aria-expanded and its focus ring stay the library's.
  row: {
    borderRadius: "4px",
    padding: "0",
  },
  rowButton: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    width: "100%",
    minHeight: "24px",
    padding: "2px 6px",
    borderRadius: "4px",
    fontFamily: tokens.fontFamilyMonospace,
    fontSize: "12px",
    lineHeight: "18px",
    color: tokens.colorNeutralForeground2,
    "&:hover": {
      backgroundColor: tokens.colorNeutralBackground2,
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

export function ActivityDrawer({ mountNode }: { mountNode: HTMLElement | null }) {
  const styles = useStyles();
  const { state, actions } = useApp();
  const open = state.ui.drawerOpen;
  const filter: Filter = state.ui.drawerFilter;
  const log = state.conversation.log;
  const sessionId = state.activeSessionId;
  const listRef = useRef<HTMLDivElement>(null);
  const followingRef = useRef(true);
  const prevLogLenRef = useRef(log.length);
  /** Expanded row per turn id — §12.4: one at a time within a turn. */
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
    <OverlayDrawer
      open={open}
      position="end"
      // §12.4 "Backdrop: none, ever" — the library renders a backdrop only
      // when modalType is not "non-modal", so this is what enforces it.
      modalType="non-modal"
      // Kept mounted: the raw log is a scroll position the user returns to,
      // and resetting it on every open would lose their place.
      unmountOnClose={false}
      // Portaled into the main region (not the default body node) so that
      // region's `contain: paint` applies — see the header note on geometry.
      mountNode={mountNode}
      className={styles.drawer}
      surfaceMotion={DRAWER_SURFACE_MOTION}
    >
      <DrawerHeader className={styles.header}>
        <Text className={styles.headerTitle}>{copy["activity.title"]}</Text>
        <TabList
          size="small"
          selectedValue={filter}
          onTabSelect={(_, data) =>
            actions.setDrawerFilter(data.value === "tools" ? "tools" : "all")
          }
        >
          <Tab value="all">{copy["activity.filter.all"]}</Tab>
          <Tab value="tools">{copy["activity.filter.tools"]}</Tab>
        </TabList>
        <Button
          appearance="subtle"
          size="small"
          aria-label={copy["activity.close"]}
          icon={<DismissRegular aria-hidden="true" />}
          onClick={actions.closeDrawer}
        />
      </DrawerHeader>
      <DrawerBody
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
        {empty ? (
          <div className={styles.empty}>{copy["activity.empty"]}</div>
        ) : (
          shown.map((group) => (
            <div className={styles.group} key={group.turnId}>
              <div className={styles.groupHead}>
                {shortSession} · {sideTimeLabel(group.startedAt)}
              </div>
              {/* One Accordion per turn: §12.4 allows one expanded row per
                  turn, which is exactly a single-open, collapsible accordion.
                  It is controlled by `expanded` so the rule lives here rather
                  than depending on the component's internal toggle order. */}
              <Accordion
                collapsible
                openItems={expanded[group.turnId] === undefined ? [] : [expanded[group.turnId]]}
                onToggle={(_, data) => {
                  const value = String(data.value);
                  setExpanded((prev) => {
                    const next = { ...prev };
                    if (next[group.turnId] === value) delete next[group.turnId];
                    else next[group.turnId] = value;
                    return next;
                  });
                }}
              >
                {group.rows.map((row) => {
                  const toneCls = row.ok === false ? styles.rowDanger : row.ok === true ? styles.rowOk : undefined;
                  const Icon = row.icon !== undefined ? toolGlyph(row.icon) : null;
                  return (
                    <AccordionItem key={row.key} value={row.key} className={styles.row}>
                      <AccordionHeader
                        className={styles.rowButton}
                        // §12.4's rows carry the event glyph, not a chevron;
                        // the disclosure is the row itself.
                        expandIcon={null}
                      >
                        {Icon !== null ? (
                          <Icon className={styles.icon} aria-hidden="true" />
                        ) : (
                          <span aria-hidden="true">•</span>
                        )}
                        <span className={`${styles.rowLabel} ${toneCls ?? ""}`}>{row.label}</span>
                        <span className={styles.rowTime}>{formatDuration(row.ts - group.startedAt)}</span>
                      </AccordionHeader>
                      <AccordionPanel>
                        <pre className={styles.raw}>{prettyPayload(row.payload)}</pre>
                      </AccordionPanel>
                    </AccordionItem>
                  );
                })}
              </Accordion>
            </div>
          ))
        )}
      </DrawerBody>
    </OverlayDrawer>
  );
}

function prettyPayload(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

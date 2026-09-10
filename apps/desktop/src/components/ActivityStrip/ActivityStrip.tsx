/**
 * ActivityStrip (§11/§27.1): the per-turn tool activity area.
 *
 * Live turn (§11.1/§11.2): chronological chips — an `正在理解你的请求…` line
 * while no tool has fired and no text has flowed; one chip per tool; the
 * newest activity shows the running verb until its `tool/result` flips it.
 * The understanding line leaves at the first tool or chunk.
 *
 * Ended turn (§11.3): auto-collapses to one secondary line
 * `完成 · 使用 {n} 个工具` + `展开`, unless the strip is expanded (store,
 * sticky for the session) — then the rows render in their final states.
 * `n=0` renders no strip, except `blocked` which renders `未生成回答`.
 */

import { Button, makeStyles, tokens } from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { copy, stripCopy } from "../../copy";
import { ToolRow } from "../ToolRow/ToolRow";
import { ToolRowChip } from "../primitives/ToolRowChip";

const useStyles = makeStyles({
  area: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: "4px",
    maxWidth: "100%",
  },
  // §11.3's line box: 13/18 quiet text with the 展开/收起 cue on the right.
  // The two clickable variants are Fluent `Button`s, which bring the pointer,
  // the hover feedback and the focus ring; what is pinned here is the type and
  // the flush box, because this line sits in the conversation flow rather than
  // on a toolbar. `quiet` reuses the same box for the non-clickable line.
  chipLine: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    fontSize: "13px",
    lineHeight: "18px",
    color: tokens.colorNeutralForeground2,
    height: "auto",
    minHeight: "22px",
    padding: "0",
    "&:hover .chinook-strip-cue": {
      color: tokens.colorBrandForeground1,
    },
  },
  quiet: {
    color: tokens.colorNeutralForeground2,
    padding: "2px 2px",
    cursor: "default",
  },
  cue: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    transition: "color 150ms ease",
  },
  understanding: {
    display: "inline-flex",
  },
});

type AssistantItem = Extract<ConversationItem, { kind: "assistant" }>;

export interface ActivityStripProps {
  turnId: number;
  /** The turn's assistant item (final tools/status; live items mutate). */
  item: AssistantItem;
  /** True while this is the active turn (rows render in flight). */
  live: boolean;
  /** §11.3 store flag: expanded rows of an ended turn. */
  expanded: boolean;
  onToggleExpand: () => void;
}

/** Strip family for the collapsed summary line (§11.3 + §17.2 additions). */
function stripKind(status: AssistantItem["status"]): "done" | "stopped" | "failed" | "no-answer" {
  switch (status) {
    case "stopped":
      return "stopped";
    case "failed":
      return "failed";
    case "no-answer":
      return "no-answer";
    default:
      return "done"; // complete / limited / interrupted
  }
}

export function ActivityStrip({ item, live, expanded, onToggleExpand }: ActivityStripProps) {
  const styles = useStyles();
  const tools = item.tools;
  const n = tools.length;
  const hasText = item.text.length > 0;
  const understanding =
    live && n === 0 && !hasText && item.status === "no-answer";

  // Live: understanding line + tool rows (newest may be running).
  if (live) {
    return (
      <div className={styles.area}>
        {understanding && (
          <ToolRowChip kind="running" label={copy.understanding} />
        )}
        {tools.map((tool, i) => (
          <ToolRow key={tool.callId} tool={tool} running={n - 1 === i} />
        ))}
      </div>
    );
  }

  // Ended: strip collapsed unless expanded; the no-answer line and all
  // done/stopped/failed families follow §11.3 with the blocked special case.
  if (item.status === "no-answer") {
    return (
      <div className={styles.area}>
        <span className={`${styles.chipLine} ${styles.quiet}`}>
          <span className={styles.understanding}>{copy["strip.noAnswer"]}</span>
        </span>
      </div>
    );
  }
  if (n === 0) return null;

  if (!expanded) {
    const kind = stripKind(item.status);
    const label = kind === "no-answer" ? copy["strip.noAnswer"] : stripCopy(kind, n);
    return (
      <div className={styles.area}>
        <Button
          appearance="subtle"
          size="small"
          className={styles.chipLine}
          onClick={onToggleExpand}
          aria-expanded={false}
        >
          <span>{label}</span>
          <span className={`${styles.cue} chinook-strip-cue`}>{copy["strip.expand"]}</span>
        </Button>
      </div>
    );
  }
  return (
    <div className={styles.area}>
      {tools.map((tool) => (
        <ToolRow key={tool.callId} tool={tool} running={false} />
      ))}
      <Button
        appearance="subtle"
        size="small"
        className={styles.chipLine}
        onClick={onToggleExpand}
        aria-expanded={true}
      >
        <span className={`${styles.cue} chinook-strip-cue`}>{copy["strip.collapse"]}</span>
      </Button>
    </div>
  );
}

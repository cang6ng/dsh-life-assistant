/**
 * ToolRow (§10.3/§10.4/§27.1): one tool activity inside a turn's activity
 * strip. Chip line — running verb · done verb + summary · error caption +
 * code chip — with a 查看详情/收起详情 affordance that opens the per-tool
 * technical detail panel (参数 / 结果 / 耗时 / 状态, §10.4). Row detail
 * state is local to the row; the strip's own expand/collapse lives in the
 * store (§11.3).
 */

import { useState, type ReactNode } from "react";
import { Card, makeStyles, tokens } from "@fluentui/react-components";
import type { ToolActivity } from "../../protocol/types";
import { copy } from "../../copy";
import { metaFor, summarizeTool, toolErrorCaption } from "../../toolMeta";
import { ToolRowChip } from "../primitives/ToolRowChip";
import { ToolDetailPanel } from "./ToolDetailPanel";
import { FADE_IN } from "../../motion";

const useStyles = makeStyles({
  host: {
    display: "flex",
    flexDirection: "column",
    maxWidth: "100%",
    minWidth: "0",
  },
  // §10.4 expanded: the panel owns the border, the header line is flush.
  // Fluent's `Card appearance="outline"` already draws the 6 px radius and the
  // `colorNeutralStroke1` hairline (as its `::after` overlay, so a CardPreview
  // could sit under it); what is ours is the box — §10.4's tighter padding, the
  // opaque surface, and the gap between the header chip and the detail rows.
  panel: {
    "--fui-Card--size": "6px",
    padding: "3px 8px 8px",
    backgroundColor: tokens.colorNeutralBackground1,
    maxWidth: "100%",
  },
  // §21: 150 ms opacity cross-fade when a row flips to its final state
  // (keyframes in motion.ts).
  flip: {
    animationName: FADE_IN,
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
});

export interface ToolRowProps {
  tool: ToolActivity;
  /** True only for the newest activity of the live turn (§11.2: one at a time). */
  running: boolean;
}

export function ToolRow({ tool, running }: ToolRowProps) {
  const styles = useStyles();
  const [open, setOpen] = useState(false);
  const meta = metaFor(tool.name);

  let chip: ReactNode;
  if (running) {
    chip = <ToolRowChip kind="running" label={`${meta.running} …`} />;
  } else if (tool.ok) {
    chip = (
      <ToolRowChip
        kind="done"
        label={`${meta.done} · ${summarizeTool(tool)}`}
        expandLabel={open ? copy["detail.close"] : copy["detail.open"]}
        expanded={open}
        bordered={!open}
        onToggleExpand={() => setOpen(!open)}
      />
    );
  } else {
    chip = (
      <ToolRowChip
        kind="error"
        label={toolErrorCaption(tool.error?.code)}
        code={tool.error?.code}
        expandLabel={open ? copy["detail.close"] : copy["detail.open"]}
        expanded={open}
        bordered={!open}
        onToggleExpand={() => setOpen(!open)}
      />
    );
  }

  return (
    <div className={running ? styles.host : `${styles.host} ${styles.flip}`}>
      {open && !running ? (
        <Card appearance="outline" className={styles.panel}>
          {chip}
          <ToolDetailPanel tool={tool} />
        </Card>
      ) : (
        chip
      )}
    </div>
  );
}

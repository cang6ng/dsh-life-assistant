/**
 * AssistantBubble (§6.3/§14/§17.2/§27.1): the answer is the visual subject —
 * full column width, no bubble chrome, markdown body. Renders nothing while
 * the item text is empty ("mount at first chunk"). Streaming carries a
 * provenance caption (`Chinook`, only when the turn produced zero tools) and
 * a polite live region; idle captions appear for abnormal endings.
 */

import { memo } from "react";
import { makeStyles, tokens } from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { copy } from "../../copy";
import { MarkdownView } from "../../markdown/MarkdownView";
import { Bubble } from "../primitives/Bubble";

const useStyles = makeStyles({
  host: {
    alignSelf: "flex-start",
    maxWidth: "100%",
    minWidth: "0",
  },
  provenance: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginBottom: "2px",
  },
  live: {
    "&:empty": {
      display: "none",
    },
  },
  caption: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
    marginTop: "4px",
  },
  body: {
    fontSize: tokens.fontSizeBase300, // 14px
    lineHeight: "24px",
    minHeight: "1px",
  },
});

export type AssistantItem = Extract<ConversationItem, { kind: "assistant" }>;

export interface AssistantBubbleProps {
  item: AssistantItem;
  /** True while this item is the live turn's accumulating assistant item. */
  streaming: boolean;
  /** Latest caption copy for abnormal endings, else null. */
  caption: string | null;
}

export const AssistantBubble = memo(function AssistantBubble({
  item,
  streaming,
  caption,
}: AssistantBubbleProps) {
  const styles = useStyles();
  // §14.1: "mount at first chunk" — nothing renders while text is empty.
  if (item.text.length === 0) return null;

  const provenance = streaming || item.tools.length === 0;
  return (
    <div className={styles.host}>
      {provenance && item.tools.length === 0 && (
        <div className={styles.provenance}>{copy["provenance.assistant"]}</div>
      )}
      <Bubble kind="assistant" ts={item.ts}>
        <div className={styles.body} aria-live={streaming ? "polite" : undefined} aria-atomic={false}>
          <MarkdownView text={item.text} streaming={streaming} />
        </div>
      </Bubble>
      {caption !== null && !streaming && <div className={styles.caption}>{caption}</div>}
    </div>
  );
});

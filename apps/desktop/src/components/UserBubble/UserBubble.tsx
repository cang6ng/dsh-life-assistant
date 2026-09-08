/**
 * UserBubble (§6.2/§27.1): right-aligned quiet accent-tinted bubble, plain
 * text (no markdown), whitespace preserved, max width 70% of the column.
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { Bubble } from "../primitives/Bubble";

const useStyles = makeStyles({
  host: {
    alignSelf: "flex-end",
    maxWidth: "100%",
  },
  caption: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
});

export function UserBubble({ item }: { item: Extract<ConversationItem, { kind: "user" }> }) {
  const styles = useStyles();
  return (
    <div className={styles.host}>
      <Bubble kind="user" ts={item.ts}>
        {item.text}
      </Bubble>
    </div>
  );
}

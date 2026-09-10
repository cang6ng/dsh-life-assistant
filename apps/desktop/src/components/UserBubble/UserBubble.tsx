/**
 * UserBubble (§6.2/§27.1): right-aligned quiet accent-tinted bubble, plain
 * text (no markdown), whitespace preserved, max width 70% of the column.
 */

import { Text, makeStyles } from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { Bubble } from "../primitives/Bubble";

const useStyles = makeStyles({
  host: {
    alignSelf: "flex-end",
    maxWidth: "100%",
  },
  // `Text` would otherwise impose its own 20 px line box; §6.2 keeps the
  // bubble's 22 px. Everything else about the type belongs to the bubble.
  text: {
    lineHeight: "22px",
  },
});

export function UserBubble({ item }: { item: Extract<ConversationItem, { kind: "user" }> }) {
  const styles = useStyles();
  return (
    <div className={styles.host}>
      <Bubble kind="user" ts={item.ts}>
        <Text className={styles.text}>{item.text}</Text>
      </Bubble>
    </div>
  );
}

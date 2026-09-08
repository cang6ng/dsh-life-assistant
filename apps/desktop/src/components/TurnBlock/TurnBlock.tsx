/**
 * TurnBlock (§6.1/§27.1): one user message + its agent turn rendered as a
 * vertical block — UserBubble → ActivityStrip (live or collapsed) → error
 * row (failed turn with no text, §17.2) → AssistantBubble with an idle
 * caption for abnormal endings (§17.2). Blocks are strictly chronological
 * and separated by the conversation's 24 px rhythm.
 */

import { makeStyles, tokens } from "@fluentui/react-components";
import type { ConversationItem } from "../../protocol/types";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { UserBubble } from "../UserBubble/UserBubble";
import { ActivityStrip } from "../ActivityStrip/ActivityStrip";
import { AssistantBubble } from "../AssistantBubble/AssistantBubble";
import { ToolRowChip } from "../primitives/ToolRowChip";

const useStyles = makeStyles({
  block: {
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    maxWidth: "100%",
    minWidth: "0",
  },
  archive: {
    fontSize: "13px",
    color: tokens.colorNeutralForeground3,
    padding: "2px 0",
  },
});

type AssistantItem = Extract<ConversationItem, { kind: "assistant" }>;

export interface TurnBlockProps {
  /** Absent only for a leading synthetic note (archive item, §13). */
  user?: Extract<ConversationItem, { kind: "user" }>;
  assistant: AssistantItem;
}

/**
 * Idle caption under the bubble text for abnormal endings (§17.2). Returns
 * null for healthy turns, for the failed-without-text case (that one gets
 * the error row instead) and for empty bubbles.
 */
function idleCaption(status: AssistantItem["status"], hasText: boolean): string | null {
  switch (status) {
    case "limited":
      return copy["bubble.caption.limited"];
    case "stopped":
      return copy["bubble.caption.stopped"];
    case "interrupted":
      return copy["bubble.caption.interrupted"];
    case "failed":
      return hasText ? copy["bubble.caption.failed"] : null;
    default:
      return null;
  }
}

export function TurnBlock({ user, assistant }: TurnBlockProps) {
  const styles = useStyles();
  const { state, actions } = useApp();

  // The turn id rides in the assistant item id (`${sessionId}:${turnId}`).
  const separator = assistant.id.indexOf(":");
  const turnId = separator > 0 ? Number(assistant.id.slice(separator + 1)) : NaN;
  const live =
    state.activeTurn !== null && state.activeSessionId !== null
      ? assistant.id === `${state.activeSessionId}:${state.activeTurn.turnId}`
      : false;

  // §13: synthetic archived-note item — a quiet, non-expandable line.
  if (assistant.archived !== undefined) {
    return (
      <div className={styles.block}>
        {user !== undefined && <UserBubble item={user} />}
        <div className={styles.archive}>
          {copy["archive.older"].replace("{n}", String(assistant.archived.olderCount))}
        </div>
      </div>
    );
  }

  const expanded = state.ui.expandedTurnIds[turnId] === true;
  const hasText = assistant.text.length > 0;
  const caption = live ? null : idleCaption(assistant.status, hasText);

  // §17.2: a failed turn that never produced text shows one inline error row
  // (code caption = the bridge's error code, else 未知错误). Announced once.
  const errorRow =
    !live && assistant.status === "failed" && !hasText ? (
      <div role="status" aria-label={`${copy["err.announce"]}${copy["err.turn.generation"]}`}>
        <ToolRowChip
          kind="error"
          label={copy["err.turn.generation"]}
          code={assistant.error?.code ?? copy["err.turn.unknown"]}
        />
      </div>
    ) : null;

  return (
    <div className={styles.block}>
      {user !== undefined && <UserBubble item={user} />}
      <ActivityStrip
        turnId={turnId}
        item={assistant}
        live={live}
        expanded={expanded}
        onToggleExpand={() => actions.toggleStrip(turnId)}
      />
      {errorRow}
      <AssistantBubble item={assistant} streaming={live} caption={caption} />
    </div>
  );
}

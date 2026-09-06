/**
 * Session snapshot adapter (contract §16): turns a frozen DSH session event
 * log (resume replay) into the React-consumable shapes of UI Spec §26.4:
 *
 *   { session, items, log }
 *
 * Item statuses come from each turn's `turn/end` reason (completed →
 * complete, aborted → stopped, error → failed, max-tokens → limited,
 * interrupted → interrupted, blocked → no-answer when textless).
 * Assistant text is the concatenation of the turn's `assistant/message`
 * step texts (reasoning never crossed the adapter, §14). Tool activities
 * reuse the identical normalization as the live path (§15) — one source of
 * truth via `sessionEventToPresentation`.
 *
 * The conversation window is capped at the newest 200 turns; older turns are
 * folded into a single archived assistant item whose `olderCount` is the
 * number of user + assistant messages folded away (UI Spec §13).
 */

import type { SessionEvent } from "@deepseek-ai/dsh-session";
import { type AssistantStatus, type ConversationItem, type ToolActivity, type TimelineRow } from "./protocol.js";
import { sessionEventToPresentation, ToolCallRegistry } from "./runtime-adapter.js";

export interface ConversationSnapshot {
  items: ConversationItem[];
  log: TimelineRow[];
  /** user/message + assistant/message count inside the kept window. */
  messageCount: number;
  /** First user text (title rule, UI Spec §5.2); "" when the session never spoke. */
  firstUserText: string;
  createdAt: number;
}

export const SNAPSHOT_MAX_TURNS = 200;

interface TurnFrame {
  turnId: number;
  userTexts: Array<{ text: string; ts: number; seq: number }>;
  steps: number; // assistant/message events
  toolRows: ToolActivity[];
  text: string;
  usage?: unknown;
  interrupted: boolean;
  error?: { code: string; message: string };
  ts: number; // turn/end time
  logRows: TimelineRow[];
  endReason?: "completed" | "aborted" | "blocked" | "error" | "max-tokens" | "interrupted";
  open: boolean;
}

function isUserMessage(event: SessionEvent): boolean {
  const src = (event.data as { source?: { kind?: string } } | undefined)?.source;
  return src?.kind === "user";
}

function textOfUserMessage(event: SessionEvent): string {
  const content = (event.data as { content?: unknown[] } | undefined)?.content ?? [];
  return content
    .map((b) => {
      const block = b as { type?: string; text?: string };
      return block?.type === "text" && typeof block.text === "string" ? block.text : "";
    })
    .join("");
}

export function buildConversationSnapshot(
  sessionId: string,
  createdAt: number,
  events: readonly SessionEvent[],
  maxTurns = SNAPSHOT_MAX_TURNS,
): ConversationSnapshot {
  const registry = new ToolCallRegistry();
  const frames: TurnFrame[] = [];
  const orphanUsers: Array<{ text: string; ts: number; seq: number }> = [];
  let current: TurnFrame | null = null;
  let lastTurn = 0;
  let firstUserText = "";

  for (const event of events) {
    const raw = event.data as { turn?: unknown } | undefined;

    // Frame boundaries are taken from the RAW turn/start (the presentation
    // payload carries only userText, UI Spec §26.3).
    if (event.type === "turn/start") {
      const rawTurn = typeof raw?.turn === "number" ? raw.turn : lastTurn + 1;
      lastTurn = rawTurn;
      const frame: TurnFrame = {
        turnId: rawTurn,
        userTexts: [],
        steps: 0,
        toolRows: [],
        text: "",
        interrupted: false,
        ts: event.time,
        logRows: [],
        open: true,
      };
      frames.push(frame);
      current = frame;
      frame.logRows.push({ type: "turn/start", turnId: rawTurn, ts: event.time });
      continue;
    }

    if (event.type === "user/message") {
      const text = textOfUserMessage(event);
      if (isUserMessage(event) && text !== "") {
        if (firstUserText === "") firstUserText = text;
        if (current !== null && current.open) {
          // dsh emits turn/start before the user/message; the text lives on
          // the frame for the item, the drawer row was logged at turn/start.
          current.userTexts.push({ text, ts: event.time, seq: event.seq });
        } else {
          // Frame-less user message (defensive) — rendered standalone.
          orphanUsers.push({ text, ts: event.time, seq: event.seq });
        }
      }
      continue;
    }

    const mapped = sessionEventToPresentation(event, { pendingUserText: null, registry });
    if (mapped.length === 0) continue;

    for (const presentation of mapped) {
      if (presentation.type === "turn/start") continue; // frame already opened above

      if (current === null) continue; // defensive: no open turn for this event

      switch (presentation.type) {
        case "tool/call": {
          const activity: ToolActivity = {
            name: presentation.data.tool.name,
            callId: presentation.data.tool.callId,
            arguments: presentation.data.tool.arguments,
            ok: true, // executing until its result finalizes
            ts: presentation.ts,
          };
          current.toolRows.push(activity);
          current.logRows.push({ type: "tool/call", turnId: current.turnId, ts: presentation.ts, tool: activity });
          break;
        }
        case "tool/result": {
          const fin = presentation.data.tool;
          const activity = current.toolRows.find((t) => t.callId === fin.callId);
          if (activity !== undefined) {
            activity.ok = fin.ok;
            activity.error = fin.error;
            activity.durationMs = fin.durationMs;
            activity.result = fin.result;
            current.logRows.push({
              type: "tool/result",
              turnId: current.turnId,
              ts: presentation.ts,
              tool: { ...activity },
            });
          }
          break;
        }
        case "assistant/chunk": {
          current.logRows.push({
            type: "chunk",
            turnId: current.turnId,
            ts: presentation.ts,
            chars: presentation.data.text.length,
          });
          break;
        }
        case "assistant/message": {
          current.steps += 1;
          current.text += presentation.data.text;
          current.usage = presentation.data.usage;
          if (presentation.data.interrupted === true) current.interrupted = true;
          current.logRows.push({
            type: "step",
            turnId: current.turnId,
            ts: presentation.ts,
            usage: presentation.data.usage,
            interrupted: presentation.data.interrupted,
          });
          break;
        }
        case "turn/error": {
          current.error = { code: presentation.data.code, message: presentation.data.message };
          current.logRows.push({
            type: "turn/error",
            turnId: current.turnId,
            ts: presentation.ts,
            code: presentation.data.code,
            message: presentation.data.message,
          });
          break;
        }
        case "turn/end": {
          current.open = false;
          current.endReason = presentation.data.reason;
          current.ts = presentation.ts;
          current.logRows.push({
            type: "turn/end",
            turnId: current.turnId,
            ts: presentation.ts,
            reason: presentation.data.reason,
          });
          break;
        }
      }
    }
  }

  // Crash-repaired sessions are closed by V1 persistence; be defensive anyway.
  if (current !== null && current.open) {
    current.open = false;
    current.endReason = "interrupted";
    current.interrupted = true;
    current.logRows.push({ type: "turn/end", turnId: current.turnId, ts: current.ts, reason: "interrupted" });
  }

  // Window the newest `maxTurns` frames; fold older messages into one archive item.
  const droppedCount = frames.length - Math.min(frames.length, maxTurns);
  let olderCount = 0;
  for (const frame of frames.slice(0, droppedCount)) {
    olderCount += frame.userTexts.length + frame.steps;
  }
  // Frame-less user messages are the oldest content: standalone when the
  // window is fully visible, folded into the archive marker otherwise.
  const orphansFolded = droppedCount > 0 ? orphanUsers.length : 0;
  const keepOrphans = !orphansFolded;

  const items: ConversationItem[] = [];
  const log: TimelineRow[] = [];
  let messageCount = olderCount + (keepOrphans ? orphanUsers.length : 0);

  if (keepOrphans) {
    for (const orphan of orphanUsers) {
      items.push({ kind: "user", id: `${sessionId}:u${orphan.seq}`, text: orphan.text, ts: orphan.ts });
    }
  }

  if (olderCount + orphansFolded > 0) {
    const keep = frames.slice(droppedCount);
    items.push({
      kind: "assistant",
      id: `${sessionId}:archive`,
      text: "",
      ts: keep[0]?.userTexts[0]?.ts ?? keep[0]?.ts ?? createdAt,
      status: "complete",
      tools: [],
      archived: { olderCount: olderCount + orphansFolded },
    });
  }

  for (const frame of frames.slice(droppedCount)) {
    for (const user of frame.userTexts) {
      items.push({ kind: "user", id: `${sessionId}:u${user.seq}`, text: user.text, ts: user.ts });
    }
    messageCount += frame.userTexts.length + frame.steps;

    items.push({
      kind: "assistant",
      id: `${sessionId}:${frame.turnId}`,
      text: frame.text,
      ts: frame.ts,
      status: assistantStatusFor(frame),
      tools: frame.toolRows,
      error: frame.error,
      usage: frame.usage,
      interrupted: frame.interrupted || undefined,
    });
    log.push(...frame.logRows);
  }

  return { items, log, messageCount, firstUserText, createdAt };
}

function assistantStatusFor(frame: TurnFrame): AssistantStatus {
  switch (frame.endReason) {
    case "aborted":
      return "stopped";
    case "error":
      return "failed";
    case "max-tokens":
      return "limited";
    case "interrupted":
      return "interrupted";
    case "blocked":
      return frame.text !== "" ? "complete" : "no-answer";
    case "completed":
    default:
      return frame.text !== "" ? "complete" : "no-answer";
  }
}

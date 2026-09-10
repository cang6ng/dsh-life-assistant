/**
 * Root state shape (UI Spec §28.1). Pure types + initial value — no Fluent,
 * no DOM, so the reducer stays unit-testable under node (contract §48).
 */

import type {
  AssistantStatus,
  ConversationItem,
  RuntimeStatus,
  SessionSummary,
  TimelineRow,
} from "../protocol/types";

export interface RootState {
  /** 'busy' is derived (activeTurn !== null), never stored (§16.1).
   *  `restorePending` (Targeted Repair P1): the desktop owes the active
   *  session a reopen inside a restarted bridge. While it is true, bridge
   *  `ready` must not release the composer — Bridge Ready ≠ Desktop Ready. */
  runtime: { status: RuntimeStatus; detail?: string; restorePending: boolean };
  /** null until the first session/list resolves. */
  sessions: SessionSummary[] | null;
  activeSessionId: string | null;
  conversation: {
    items: ConversationItem[]; // §26.4, chronological
    log: TimelineRow[]; // §12 drawer timeline
    openError: string | null; // §13 restore-failure card; null = ok
  };
  activeTurn: { turnId: number; startedAt: number } | null;
  /**
   * Model-endpoint configuration, reduced to the ONE field the shell renders
   * (the status bar caption). null until a `config.describe` resolves.
   *
   * The rest of the configuration — and the API key above all — never enters
   * this store: it lives in the panel's own component state and dies with it.
   * That is contract §44 made structural, and
   * tests/architecture-desktop.test.ts keeps a later refactor from
   * "helpfully" caching a credential here.
   */
  config: { model: string } | null;
  ui: {
    drawerOpen: boolean;
    drawerFilter: "all" | "tools";
    /** §11.3 strip expansion, keyed by turn id. */
    expandedTurnIds: Record<string, boolean>;
    /** The model-settings overlay (ApiConfigPanel) is open. */
    configOpen: boolean;
  };
}

export const INITIAL_STATE: RootState = {
  runtime: { status: "starting", restorePending: false },
  sessions: null,
  activeSessionId: null,
  conversation: { items: [], log: [], openError: null },
  activeTurn: null,
  config: null,
  ui: { drawerOpen: false, drawerFilter: "all", expandedTurnIds: {}, configOpen: false },
};

/**
 * Item status while a live turn accumulates (UI Spec §26.4 lists no
 * 'streaming' status): the open assistant item carries this placeholder
 * until `turn/end` finalizes it (§28.2). No render path reads it — the live
 * turn is driven by `activeTurn` and by text emptiness (§27 render rule).
 */
export const STREAMING_STATUS: AssistantStatus = "no-answer";

/** User-item id for live turns (assistant uses `${sessionId}:${turnId}`). */
export function liveUserItemId(turnId: number): string {
  return `u-${turnId}`;
}

export function assistantItemId(sessionId: string, turnId: number): string {
  return `${sessionId}:${turnId}`;
}

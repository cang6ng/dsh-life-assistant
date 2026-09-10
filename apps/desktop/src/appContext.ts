/**
 * App store context (UI Spec §27 tree: AppStateProvider → Context).
 * The provider (app.tsx) owns useReducer + all IPC effects; components
 * consume state + a fixed action surface through this module only — no
 * component ever imports bridge/client.ts directly.
 */

import { createContext, useContext } from "react";
import type { DrawerFilter } from "./store/actions";
import type { RootState } from "./store/state";
import type {
  ApiConfigData,
  ApiConfigPatchData,
  ApiConfigSavedData,
  ApiConfigTestedData,
} from "./protocol/types";

/** send() outcome for the composer hint (never throws). */
export interface SendResult {
  ok: boolean;
  /** Bridge error code when known (TURN_ACTIVE / NOT_READY / …). */
  code?: string;
}

/** `config.get` as the panel consumes it — a failure is a caption, not a throw. */
export type ApiConfigLoadResult =
  | { ok: true; config: ApiConfigData }
  | { ok: false; message: string };

/** `config.save` likewise: the refusal text is rendered, never retried blind. */
export type ApiConfigSaveResult =
  | { ok: true; data: ApiConfigSavedData }
  | { ok: false; message: string };

export interface AppActions {
  /** Submit one user turn for the active session. Resolves after the
   *  bridge accepted it (`turn.send` response) — never after the turn ends. */
  send: (text: string) => Promise<SendResult>;
  /** 新建会话 — disabled surface-wise while a turn is active. */
  newSession: () => Promise<void>;
  /** Open a session from the sidebar (§5.3/§13). */
  openSession: (sessionId: string) => Promise<void>;
  /** §13 restore-failure card 重试. */
  retryOpen: () => Promise<void>;
  /** §13 restore-failure card 关闭 → bridge creates a fresh session. */
  restoreClose: () => Promise<void>;
  /** §16.2/§16.3 reconnect/restart. */
  restartAgent: () => Promise<void>;
  toggleDrawer: () => void;
  setDrawerFilter: (filter: DrawerFilter) => void;
  closeDrawer: () => void;
  toggleStrip: (turnId: number) => void;

  // ---- model-endpoint configuration (§4.3, v1.0.2) ------------------------
  openConfig: () => void;
  closeConfig: () => void;
  /** Read the endpoint config. null-shaped result, never a throw. */
  loadApiConfig: () => Promise<ApiConfigLoadResult>;
  /**
   * Persist one patch. The `apiKey` field travels UP only: it is an argument
   * here and appears in no result, no store slice and no log line (§44).
   */
  saveApiConfig: (patch: ApiConfigPatchData) => Promise<ApiConfigSaveResult>;
  /** One minimal completion through the configured endpoint. Never throws. */
  testApiConnection: () => Promise<ApiConfigTestedData>;
}

export interface AppValue {
  state: RootState;
  /** §5.4/§13: a session.open is in flight (loader in the column). */
  opening: boolean;
  actions: AppActions;
}

export const AppCtx = createContext<AppValue | null>(null);

export function useApp(): AppValue {
  const value = useContext(AppCtx);
  if (value === null) throw new Error("useApp outside AppStateProvider");
  return value;
}

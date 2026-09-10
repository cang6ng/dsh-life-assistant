/**
 * Typed IPC client — the SOLE choke point between React and the Rust host
 * (UI Spec §26.2/§26.3, contract §23/§24). Every command resolves with the
 * canonical §26 envelope JSON; streaming events arrive on the channel.
 * Responses NEVER arrive on the channel (the host router resolves them to
 * the pending invoke), so callers map response envelopes to store actions
 * themselves (app.tsx).
 *
 * No store imports here — this module only moves envelopes.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import type { ApiConfigModelsDraft, ApiConfigPatchData, Envelope } from "../protocol/types";
import { isErrorData } from "../protocol/types";

export interface CommandError {
  code: string;
  message: string;
}

/** True when the envelope's data is the uniform `{ ok:false, error }` shape. */
export function envelopeIsError(env: Envelope): boolean {
  return isErrorData(env.data);
}

/** Extract the uniform error shape from a failed response envelope. */
export function envelopeError(env: Envelope): CommandError {
  const d = env.data as { error?: { code?: unknown; message?: unknown } };
  return {
    code: typeof d?.error?.code === "string" ? d.error.code : "UNKNOWN",
    message: typeof d?.error?.message === "string" ? d.error.message : "未知错误",
  };
}

// ---------------------------------------------------------------------------
// requests (Tauri Commands → Rust host → bridge)
// ---------------------------------------------------------------------------

function request(name: string, args: Record<string, unknown>): Promise<Envelope> {
  return invoke<Envelope>(name, args);
}

export function agentStatus(): Promise<Envelope> {
  return request("agent_status", {});
}

/** Manual reconnect (§21): host kills and respawns the sidecar. */
export function agentRestart(): Promise<Envelope> {
  return request("agent_restart", {});
}

export function sessionList(): Promise<Envelope> {
  return request("session_list", {});
}

export function sessionCreate(): Promise<Envelope> {
  return request("session_create", {});
}

export function sessionOpen(sessionId: string): Promise<Envelope> {
  return request("session_open", { sessionId });
}

export function turnSend(sessionId: string, text: string): Promise<Envelope> {
  return request("turn_send", { sessionId, text });
}

// ---------------------------------------------------------------------------
// model-endpoint configuration
//
// NOTE the direction of `apiKey`: it is an argument, never a result. Two
// functions accept one — `configSave` (persists it) and `configModels` (uses
// it once, for one outbound request) — and no function in this module returns
// a credential, because the response shapes it resolves with have no field
// that could carry one (§44).
// ---------------------------------------------------------------------------

export function configGet(): Promise<Envelope> {
  return request("config_get", {});
}

/**
 * Persist a patch. Absent fields are omitted from the invoke payload entirely:
 * the host's `Option<String>` parameters distinguish "not supplied" from
 * "supplied empty" (empty base URL = clear the override; empty key = keep the
 * stored one), and `undefined` would collapse the two.
 */
export function configSave(patch: ApiConfigPatchData): Promise<Envelope> {
  const args: Record<string, unknown> = {};
  if (patch.baseUrl !== undefined) args.baseUrl = patch.baseUrl;
  if (patch.model !== undefined) args.model = patch.model;
  if (patch.apiKey !== undefined) args.apiKey = patch.apiKey;
  if (patch.clearApiKey !== undefined) args.clearApiKey = patch.clearApiKey;
  return request("config_save", args);
}

export function configTest(): Promise<Envelope> {
  return request("config_test", {});
}

/**
 * Ask an endpoint which model ids it serves. The draft is one-shot: it is sent,
 * used for this request, and stored nowhere — so the panel can list an endpoint
 * the user has not committed to yet. The key is omitted rather than passed as
 * `undefined`, for the same reason as `configSave` above.
 */
export function configModels(draft: ApiConfigModelsDraft): Promise<Envelope> {
  const args: Record<string, unknown> = { baseUrl: draft.baseUrl };
  if (draft.apiKey !== undefined) args.apiKey = draft.apiKey;
  return request("config_models", args);
}

// ---------------------------------------------------------------------------
// streaming events (Tauri Channel)
// ---------------------------------------------------------------------------

/**
 * Subscribe to the streaming event feed. The Rust host's `events_subscribe`
 * replaces the previous sink — repeated calls supersede stale ones (window
 * reload), so the app subscribes exactly once at boot.
 */
export async function subscribeEvents(onEnvelope: (env: Envelope) => void): Promise<void> {
  const channel = new Channel<Envelope>();
  channel.onmessage = onEnvelope;
  await invoke("events_subscribe", { channel });
}

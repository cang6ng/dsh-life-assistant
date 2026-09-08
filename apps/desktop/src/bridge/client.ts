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
import type { Envelope } from "../protocol/types";
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

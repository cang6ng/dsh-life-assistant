/**
 * Envelope → store action mapping (store/actions.ts). Pure, so it runs under
 * node. The case that matters here is `agent.status`: it is a *response*, not
 * an event, and it is the only thing that can recover a session that missed
 * the bridge's `runtime/status: ready` event (the boot reconcile). It used to
 * map to nothing, which pinned the desktop at 正在启动… forever.
 */

import { describe, expect, it } from "vitest";
import { actionFromEvent } from "../apps/desktop/src/store/actions";
import type { Envelope } from "../apps/desktop/src/protocol/types";

const env = (patch: Partial<Envelope>): Envelope =>
  ({ protocolVersion: 1, seq: 1, type: "runtime/status", data: {}, ...patch }) as Envelope;

describe("envelope → action (store/actions.ts)", () => {
  it("the pushed runtime/status event maps to RUNTIME_STATUS", () => {
    expect(actionFromEvent(env({ data: { status: "ready" } }), 0)).toEqual({
      type: "RUNTIME_STATUS",
      status: "ready",
      detail: undefined,
    });
  });

  it("the agent.status RESPONSE (the boot reconcile) maps to RUNTIME_STATUS too", () => {
    // Shaped exactly as the bridge answers `agent.status` over the host.
    const response = env({
      type: "agent.status",
      requestId: "req-6",
      sessionId: null,
      turnId: null,
      data: { status: "ready" },
    });
    expect(actionFromEvent(response, 0)).toEqual({
      type: "RUNTIME_STATUS",
      status: "ready",
      detail: undefined,
    });
  });

  it("an unrecognised or malformed status is ignored, never thrown on", () => {
    expect(actionFromEvent(env({ type: "agent.status", data: {} }), 0)).toBeNull();
    expect(actionFromEvent(env({ type: "no.such.type", data: { status: "ready" } }), 0)).toBeNull();
    expect(actionFromEvent(env({ data: null }), 0)).toBeNull();
  });
});

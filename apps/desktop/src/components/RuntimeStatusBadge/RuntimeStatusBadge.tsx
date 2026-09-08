/**
 * RuntimeStatusBadge (§16.1/§27.1): compact pill with §25 `status.*` copy.
 * 'busy' is never a badge state — it is derived from activeTurn and
 * expressed by the composer lock, the activity strip and the status bar.
 */

import { Badge } from "@fluentui/react-components";
import type { RuntimeStatus } from "../../protocol/types";
import { copy } from "../../copy";
import { StatusDot, type StatusDotTone } from "../primitives/StatusDot";

function tone(status: RuntimeStatus): StatusDotTone {
  switch (status) {
    case "ready":
      return "brand";
    case "disconnected":
    case "error":
      return "danger";
    default:
      return "neutral";
  }
}

const LABEL: Record<RuntimeStatus, string> = {
  starting: copy["status.starting"],
  ready: copy["status.ready"],
  restoring: copy["status.restoring"],
  disconnected: copy["status.disconnected"],
  error: copy["status.error"],
  restarting: copy["status.restarting"],
};

export function RuntimeStatusBadge({ status }: { status: RuntimeStatus }) {
  return (
    <Badge appearance="tint" size="small">
      <span
        style={{
          display: "inline-flex",
          flexDirection: "row",
          alignItems: "center",
          gap: "5px",
        }}
      >
        <StatusDot tone={tone(status)} />
        {LABEL[status]}
      </span>
    </Badge>
  );
}

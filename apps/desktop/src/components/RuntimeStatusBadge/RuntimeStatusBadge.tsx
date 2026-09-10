/**
 * RuntimeStatusBadge (§16.1/§27.1): compact pill with §25 `status.*` copy.
 * 'busy' is never a badge state — it is derived from activeTurn and
 * expressed by the composer lock, the activity strip and the status bar.
 */

import { Badge, Text, makeStyles } from "@fluentui/react-components";
import type { RuntimeStatus } from "../../protocol/types";
import { copy } from "../../copy";
import { StatusDot, type StatusDotTone } from "../primitives/StatusDot";

const useStyles = makeStyles({
  // The dot + label pair inside the badge. It used to be an inline `style`,
  // which is the one thing §27.2 does not allow; `Text` carries the slot so
  // the badge's own caption size and colour are inherited rather than set.
  content: {
    display: "inline-flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "5px",
  },
});

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
  const styles = useStyles();
  return (
    <Badge appearance="tint" size="small">
      <Text className={styles.content}>
        <StatusDot tone={tone(status)} />
        {LABEL[status]}
      </Text>
    </Badge>
  );
}

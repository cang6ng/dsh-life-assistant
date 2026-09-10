/**
 * NewSessionButton (§5.1/§5.3/§27.1): full-width secondary + Add icon;
 * disabled with tooltip while a turn is active (§16.5).
 */

import { AddRegular } from "@fluentui/react-icons";
import { Button, makeStyles, tokens, Tooltip } from "@fluentui/react-components";
import { copy } from "../../copy";
import { useApp } from "../../appContext";

const useStyles = makeStyles({
  host: {
    padding: "10px 10px 8px",
  },
  button: {
    width: "100%",
    height: "36px",
    borderRadius: tokens.borderRadiusMedium,
  },
});

export function NewSessionButton({ onNavigate }: { onNavigate?: () => void }) {
  const styles = useStyles();
  const { state, actions } = useApp();
  const locked = state.activeTurn !== null;
  const button = (
    <div className={styles.host}>
      <Button
        appearance="secondary"
        className={styles.button}
        icon={<AddRegular aria-hidden="true" />}
        aria-label={copy["newSession"]}
        disabled={locked}
        onClick={() => {
          void actions.newSession();
          onNavigate?.(); // §22: the rail panel closes on selection
        }}
      >
        {copy["newSession"]}
      </Button>
    </div>
  );
  if (locked) {
    return (
      <Tooltip content={copy["sidebar.switchLocked"]} relationship="label">
        <span>{button}</span>
      </Tooltip>
    );
  }
  return button;
}

/**
 * EmptyState (§7/§27.1): shown when the active session has zero conversation
 * items. Headline + sub-line + three suggestion chips that are real inputs —
 * each submits exactly its label (copy §25). The chips are the only emoji
 * allowed in chrome (🎵 🎷 🧾 glyphs as text). If no session exists yet the
 * chip creates one through the bridge, then sends.
 */

import { useState } from "react";
import { Button, Text, makeStyles, tokens } from "@fluentui/react-components";
import { copy } from "../../copy";
import { useApp } from "../../appContext";

const useStyles = makeStyles({
  host: {
    flex: "1 1 auto",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    padding: "40px 0 64px",
    textAlign: "center",
    maxWidth: "100%",
  },
  logo: {
    width: "44px",
    height: "44px",
    borderRadius: "50%",
    display: "grid",
    placeItems: "center",
    backgroundColor: "color-mix(in srgb, var(--chinook-accent) 14%, transparent)",
    marginBottom: "20px",
  },
  dot: {
    width: "12px",
    height: "12px",
    borderRadius: "50%",
    backgroundColor: tokens.colorBrandBackground,
  },
  // §7/§20.1 freeze the headline at 26/600/36 — no Fluent type ramp step is
  // that size (`Text size={900}` is a different metric and `fontWeight` would
  // have to be picked anyway), so the pixels stay here and `Text` supplies the
  // element. Both lines take `block` so the sub-line's max-width can apply.
  headline: {
    fontSize: "26px",
    fontWeight: 600,
    lineHeight: "36px",
    color: tokens.colorNeutralForeground1,
    marginBottom: "8px",
  },
  sub: {
    fontSize: "14px",
    lineHeight: "22px",
    color: tokens.colorNeutralForeground2,
    maxWidth: "460px",
  },
  chips: {
    display: "flex",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: "10px",
    marginTop: "24px",
  },
  chip: {
    borderRadius: "6px", // §7.2 chip radius
    padding: "0 16px",
    height: "36px",
  },
  glyph: {
    fontSize: "14px",
    marginRight: "2px",
  },
});

interface Chip {
  glyph: string;
  label: string;
}

const CHIPS: Chip[] = [
  { glyph: "🎵", label: copy["empty.chip.queen"] },
  { glyph: "🎷", label: copy["empty.chip.jazz"] },
  { glyph: "🧾", label: copy["empty.chip.orders"] },
];

export function EmptyState() {
  const styles = useStyles();
  const { actions } = useApp();
  const [pending, setPending] = useState<string | null>(null);

  const run = async (label: string): Promise<void> => {
    setPending(label);
    try {
      await actions.send(label);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className={styles.host}>
      <div className={styles.logo} aria-hidden="true">
        <span className={styles.dot} />
      </div>
      <Text block className={styles.headline}>
        {copy["empty.headline"]}
      </Text>
      <Text block className={styles.sub}>
        {copy["empty.sub"]}
      </Text>
      <div className={styles.chips}>
        {CHIPS.map((chip) => (
          <Button
            key={chip.label}
            appearance="secondary"
            className={styles.chip}
            disabled={pending !== null}
            onClick={() => void run(chip.label)}
          >
            <span className={styles.glyph} aria-hidden="true">
              {chip.glyph}
            </span>
            {chip.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

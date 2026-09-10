/**
 * 设置 (§4.3/§18 as amended by v1.0.4). Two tabs:
 *
 *   通用  外观 — 追随系统 / 亮色 / 暗色 (§18), stored client-side
 *   模型  the model endpoint, which keeps its own component and its own file
 *
 * The surface is a Fluent `Dialog` rather than the hand-rolled overlay it
 * replaced. That is not cosmetic: the old overlay had no focus trap (a
 * `Composer` comment documented the workaround), no `aria-modal` semantics
 * behind its `role="dialog"` claim, and a scrim that only responded to a
 * click. All three now come from the component, and the two absolutely
 * positioned layers that implemented them are gone (§27.2's absolute-
 * positioning budget shrinks to the drawer, the scroll pill and the state
 * cards).
 *
 * The dialog keeps a dimming backdrop — it always had one (`scrim`), and
 * §12.4's "Backdrop: none, ever" governs the *activity drawer*, not this.
 *
 * `ApiConfigPanel` is rendered here rather than moved: the §44 architecture
 * test reads that file by path, and more to the point that file is where the
 * credential is handled, so that is where the guard belongs.
 */

import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  Field,
  Radio,
  RadioGroup,
  Tab,
  TabList,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import { copy } from "../../copy";
import { useApp } from "../../appContext";
import { parseThemePreference } from "../../store/themePreference";
import { DIALOG_BACKDROP_MOTION, DIALOG_SURFACE_MOTION } from "../../motion";
import { ApiConfigPanel } from "../ApiConfig/ApiConfigPanel";

const useStyles = makeStyles({
  surface: {
    width: "560px",
    maxWidth: "calc(100vw - 48px)",
    maxHeight: "calc(100vh - 48px)",
  },
  // The dialog's own height is the cap; the body is what scrolls, so the
  // title and the tab strip stay put while a long model list scrolls under
  // them.
  body: {
    maxHeight: "calc(100vh - 48px)",
    minHeight: 0,
  },
  content: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    minHeight: "132px",
    overflowY: "auto",
  },
  general: {
    display: "flex",
    flexDirection: "column",
    gap: "10px",
    paddingTop: "4px",
  },
  caption: {
    color: tokens.colorNeutralForeground3,
  },
});

/** 通用 — the appearance choice (§18 as amended). */
function GeneralSection() {
  const styles = useStyles();
  const { state, actions } = useApp();
  return (
    <div className={styles.general}>
      <Field label={copy["settings.appearance"]}>
        <RadioGroup
          layout="horizontal"
          value={state.ui.themePreference}
          // Parsed rather than cast: an unexpected value degrades to
          // 追随系统 instead of becoming an unrenderable state.
          onChange={(_, data) => actions.setThemePreference(parseThemePreference(data.value))}
        >
          <Radio value="system" label={copy["settings.appearance.system"]} />
          <Radio value="light" label={copy["settings.appearance.light"]} />
          <Radio value="dark" label={copy["settings.appearance.dark"]} />
        </RadioGroup>
      </Field>
    </div>
  );
}

export function SettingsPanel() {
  const styles = useStyles();
  const { state, actions } = useApp();
  const tab = state.ui.settingsTab;

  return (
    // Mounted only while `ui.configOpen` (DesktopShell). `open` is therefore
    // a constant true: the way to close is to unmount, which is what the
    // onOpenChange below (Esc, backdrop click) arranges.
    <Dialog
      open
      // §21: Fluent's Dialog motions are pinned to `durationGentle` (250 ms).
      // These two slots hold Fluent's own geometry at §21's 200 ms.
      surfaceMotion={DIALOG_SURFACE_MOTION}
      onOpenChange={(_, data) => {
        if (!data.open) actions.closeConfig();
      }}
    >
      <DialogSurface className={styles.surface} backdropMotion={DIALOG_BACKDROP_MOTION}>
        <DialogBody className={styles.body}>
          <DialogTitle
            action={
              <Button
                appearance="subtle"
                size="small"
                aria-label={copy["config.close"]}
                icon={<DismissRegular aria-hidden="true" />}
                onClick={actions.closeConfig}
              />
            }
          >
            {copy["config.title"]}
          </DialogTitle>
          <DialogContent className={styles.content}>
            <TabList
              selectedValue={tab}
              onTabSelect={(_, data) =>
                actions.setSettingsTab(data.value === "model" ? "model" : "general")
              }
            >
              <Tab value="general">{copy["settings.tab.general"]}</Tab>
              <Tab value="model">{copy["settings.tab.model"]}</Tab>
            </TabList>
            {tab === "general" ? <GeneralSection /> : <ApiConfigPanel />}
          </DialogContent>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}

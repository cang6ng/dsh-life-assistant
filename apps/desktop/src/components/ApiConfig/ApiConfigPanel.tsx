/**
 * The 模型 tab (§4.3/§16, v1.0.2): Base URL · API Key · 模型名称.
 *
 * Mounted only while the settings surface is open and this tab is selected
 * (SettingsPanel), never always-mounted behind a slide: the key input then
 * does not exist in the DOM at all while the tab is away.
 *
 * The credential rule this component exists to honour (§44) is visible in the
 * flow: the key travels UP only. It starts empty every time the panel opens
 * (there is nothing to prefill — the host never returns a value), it is never
 * copied into component state that outlives the save, and the state line
 * reports only whether a key resolves and from which layer. 获取模型 widens
 * the "leaves as an argument" set to two calls, not the direction: the draft
 * key goes out and nothing key-shaped comes back.
 *
 * The model list is the panel's own state, never the store's: it is a view of
 * one endpoint's answer, so it dies with the panel and is keyed to the URL
 * that produced it.
 *
 * This file owns no dialog of its own — the surface belongs to
 * SettingsPanel. `tests/architecture-desktop.test.ts` reads this path by name
 * for the §44 DOM-read ban, which is why the file stayed put when the
 * settings surface was introduced.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Button,
  Combobox,
  Field,
  Input,
  Option,
  Spinner,
  Text,
  makeStyles,
  tokens,
} from "@fluentui/react-components";
import type { ApiConfigData } from "../../protocol/types";
import {
  apiKeyConfiguredCopy,
  apiKeyReadOnlyCopy,
  configSaveFailedCopy,
  configTestFailCopy,
  configTestOkCopy,
  configLoadFailedCopy,
  modelsFetchFailedCopy,
  modelsFetchedCopy,
  copy,
} from "../../copy";
import { useApp } from "../../appContext";
import {
  buildApiConfigPatch,
  formIsDirty,
  normalizeBaseUrl,
  validateApiConfigForm,
  type ApiConfigFormBaseline,
  type ApiConfigFormValues,
} from "./form";

const useStyles = makeStyles({
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: "14px",
  },
  sub: {
    fontSize: "12.5px",
    lineHeight: "18px",
    color: tokens.colorNeutralForeground2,
  },
  /** Label · trailing state · trailing action, on the line above a control. */
  fieldHead: {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: "8px",
  },
  state: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  /** A `Field` hint/none-of-the-above line that carries more than text. */
  hintRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    gap: "8px",
    flexWrap: "wrap",
  },
  hintText: {
    fontSize: "12px",
    lineHeight: "17px",
    color: tokens.colorNeutralForeground3,
  },
  note: {
    fontSize: "12px",
    lineHeight: "17px",
    color: tokens.colorBrandForeground1,
  },
  warn: {
    fontSize: "12px",
    lineHeight: "17px",
    color: tokens.colorStatusWarningForeground1,
  },
  error: {
    fontSize: "12px",
    lineHeight: "17px",
    color: tokens.colorStatusDangerForeground1,
  },
  actions: {
    display: "flex",
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: "8px",
    marginTop: "2px",
  },
  result: {
    display: "flex",
    flexDirection: "column",
    gap: "3px",
    minHeight: "17px",
  },
});

const EMPTY_FORM: ApiConfigFormValues = { baseUrl: "", model: "", apiKey: "" };

function baselineOf(config: ApiConfigData): ApiConfigFormBaseline {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKeyConfigured: config.apiKey.configured,
  };
}

type LoadState = "loading" | "ready" | "error";
type Busy = "save" | "test" | "models" | null;

/**
 * One endpoint's answer. `baseUrl` is the normalized URL that produced `ids`:
 * the list is rendered only while the form still points there, so a stale list
 * can never write endpoint A's model id into a form aimed at endpoint B.
 */
interface ModelList {
  baseUrl: string;
  ids: string[];
  /** False when the endpoint answered, but not with a listing. */
  ok: boolean;
  message: string;
}

export function ApiConfigPanel() {
  const styles = useStyles();
  const { state, actions } = useApp();

  const [form, setForm] = useState<ApiConfigFormValues>(EMPTY_FORM);
  const [config, setConfig] = useState<ApiConfigData | null>(null);
  const [baseline, setBaseline] = useState<ApiConfigFormBaseline | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [clearApiKey, setClearApiKey] = useState(false);
  const [modelList, setModelList] = useState<ModelList | null>(null);
  // The fetched ids live in a Combobox popup now, so a successful listing has
  // to open it: otherwise 获取模型 would look like it did nothing until the
  // user thought to click the field.
  const [listOpen, setListOpen] = useState(false);

  /** Adopt a configuration the host just returned as the new baseline. */
  const adopt = useCallback((next: ApiConfigData) => {
    setConfig(next);
    setBaseline(baselineOf(next));
    setForm({ baseUrl: next.baseUrl, model: next.model, apiKey: "" });
    setClearApiKey(false);
    // A saved endpoint invalidates any list fetched against the previous one.
    setModelList(null);
  }, []);

  const load = useCallback(async () => {
    setLoadState("loading");
    const result = await actions.loadApiConfig();
    if (!result.ok) {
      setLoadError(result.message);
      setLoadState("error");
      return;
    }
    adopt(result.config);
    setLoadState("ready");
  }, [actions, adopt]);

  useEffect(() => {
    void load();
    // The panel mounts on open; a single read is what it is for. A retry is an
    // explicit user act (重新连接), not an effect re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const locked = state.activeTurn !== null;
  const errors = useMemo(() => validateApiConfigForm(form), [form]);
  const dirty = useMemo(
    () => (baseline === null ? false : formIsDirty(form, baseline, { clearApiKey })),
    [form, baseline, clearApiKey],
  );
  const invalid = Object.keys(errors).length > 0;
  const strippedSuffix = normalizeBaseUrl(form.baseUrl).strippedSuffix;
  const apiKey = config?.apiKey ?? null;
  const canWriteKey = apiKey !== null && apiKey.writable;

  const onSave = useCallback(async () => {
    if (baseline === null) return;
    setBusy("save");
    setResult(null);
    setWarnings([]);
    const outcome = await actions.saveApiConfig(
      buildApiConfigPatch(form, baseline, { clearApiKey }),
    );
    setBusy(null);
    if (!outcome.ok) {
      setResult({ ok: false, message: configSaveFailedCopy(outcome.message) });
      return;
    }
    adopt(outcome.data.config);
    setWarnings(outcome.data.apiKeyError === undefined ? [] : [outcome.data.apiKeyError]);
    setResult({
      ok: true,
      message: outcome.data.modelChanged ? copy["config.saved.applying"] : copy["config.saved"],
    });
    // Save-and-verify in one gesture: the probe now tests exactly what was
    // just persisted, so the user learns whether the endpoint works at all.
    const probe = await actions.testApiConnection();
    setResult(
      probe.connected
        ? { ok: true, message: `${copy["config.saved"]} · ${configTestOkCopy(probe.latencyMs)}` }
        : { ok: false, message: configTestFailCopy(probe.message) },
    );
  }, [actions, adopt, baseline, clearApiKey, form]);

  const onTest = useCallback(async () => {
    setBusy("test");
    setResult(null);
    const probe = await actions.testApiConnection();
    setBusy(null);
    setResult(
      probe.connected
        ? { ok: true, message: configTestOkCopy(probe.latencyMs) }
        : { ok: false, message: configTestFailCopy(probe.message) },
    );
  }, [actions]);

  const canSave = !locked && busy === null && loadState === "ready" && dirty && !invalid;
  const canTest = !locked && busy === null && loadState === "ready" && !dirty;

  // Deliberately NOT gated on a clean form: fetching is what you do *while*
  // editing the endpoint. It is gated on a non-empty URL, though — on a fresh
  // install `baseUrl` is "" (the default endpoint, which is not ours to
  // interrogate) and no field error is set, so a validity-only gate would
  // enable a button whose only possible answer is NO_BASE_URL.
  const normalizedBaseUrl = normalizeBaseUrl(form.baseUrl).value;
  const canFetchModels =
    !locked && busy === null && loadState === "ready" && errors.baseUrl === undefined && normalizedBaseUrl !== "";
  const fetchModelsTitle = locked
    ? copy["config.model.fetchLocked"]
    : normalizedBaseUrl === ""
      ? copy["config.model.fetchNeedBaseUrl"]
      : errors.baseUrl !== undefined
        ? copy[errors.baseUrl]
        : copy["config.model.fetchTitle"];

  const onFetchModels = useCallback(async () => {
    const target = normalizeBaseUrl(form.baseUrl).value;
    const draftKey = form.apiKey.trim();
    setBusy("models");
    setModelList(null);
    const outcome = await actions.listApiModels(
      draftKey === "" ? { baseUrl: target } : { baseUrl: target, apiKey: draftKey },
    );
    setBusy(null);
    if (!outcome.ok) {
      setModelList({ baseUrl: target, ids: [], ok: false, message: modelsFetchFailedCopy(outcome.message) });
      return;
    }
    const { listed, models, message } = outcome.data;
    setModelList({
      baseUrl: target,
      ids: listed ? models : [],
      ok: listed,
      message: !listed
        ? modelsFetchFailedCopy(message)
        : models.length === 0
          ? copy["config.model.fetchEmpty"] // a listing that is legitimately empty
          : modelsFetchedCopy(models.length),
    });
    setListOpen(listed && models.length > 0);
  }, [actions, form.apiKey, form.baseUrl]);


  return (
    <div className={styles.panel}>
        <Text className={styles.sub}>{copy["config.sub"]}</Text>

        {loadState === "loading" && (
          <div className={styles.hintRow}>
            <Spinner size="tiny" aria-hidden="true" />
            <Text className={styles.hintText}>{copy["config.loading"]}</Text>
          </div>
        )}

        {loadState === "error" && (
          <>
            <Text className={styles.error}>{configLoadFailedCopy(loadError)}</Text>
            <div className={styles.actions}>
              <Button appearance="secondary" onClick={() => void actions.restartAgent()}>
                {copy["card.disconnected.action"]}
              </Button>
              <Button appearance="primary" onClick={() => void load()}>
                {copy["restore.retry"]}
              </Button>
            </div>
          </>
        )}

        {loadState === "ready" && config !== null && (
          <>
            <Field
              label={copy["config.baseUrl.label"]}
              hint={strippedSuffix ? copy["config.baseUrl.stripped"] : copy["config.baseUrl.hint"]}
              validationMessage={
                errors.baseUrl !== undefined ? copy[errors.baseUrl] : undefined
              }
              validationState={errors.baseUrl !== undefined ? "error" : "none"}
            >
              <Input
                type="text"
                spellCheck={false}
                autoComplete="off"
                placeholder="https://api.deepseek.com"
                value={form.baseUrl}
                onChange={(_, data) => setForm((f) => ({ ...f, baseUrl: data.value }))}
              />
            </Field>
            {/* Saved-state note, not form state: it describes the endpoint the
                host currently has, so it is a sibling of the field. */}
            {config.baseUrlOverridden && (
              <Text className={styles.state}>{copy["config.baseUrl.overridden"]}</Text>
            )}

            <Field
              label={
                <>
                  {copy["config.apiKey.label"]}
                  {"  "}
                  <Text className={styles.state}>
                    {apiKey !== null && apiKey.configured && apiKey.source !== undefined
                      ? apiKeyConfiguredCopy(apiKey.source)
                      : copy["config.apiKey.missing"]}
                  </Text>
                </>
              }
              // The clear button cannot live inside `Field`'s label (a label
              // must not contain an interactive child — the click would be
              // forwarded to the input as well), so it rides the hint line.
              hint={
                <span className={styles.hintRow}>
                  {apiKey !== null && !apiKey.writable ? (
                    <Text className={styles.warn}>{apiKeyReadOnlyCopy(apiKey.ref)}</Text>
                  ) : clearApiKey ? (
                    <Text className={styles.warn}>{copy["config.apiKey.willClear"]}</Text>
                  ) : (
                    <Text className={styles.hintText}>{copy["config.apiKey.hint"]}</Text>
                  )}
                  {canWriteKey && config.apiKey.configured && !clearApiKey && (
                    <Button
                      appearance="subtle"
                      size="small"
                      disabled={locked || busy !== null}
                      onClick={() => setClearApiKey(true)}
                    >
                      {copy["config.apiKey.clear"]}
                    </Button>
                  )}
                </span>
              }
            >
              <Input
                type="password"
                spellCheck={false}
                autoComplete="new-password"
                placeholder="sk-…"
                value={form.apiKey}
                disabled={!canWriteKey}
                onChange={(_, data) => setForm((f) => ({ ...f, apiKey: data.value }))}
              />
            </Field>

            <Field
              label={copy["config.model.label"]}
              validationMessage={errors.model !== undefined ? copy[errors.model] : undefined}
              validationState={errors.model !== undefined ? "error" : "none"}
            >
              <Combobox
                freeform
                // Open when a listing lands, closed otherwise: the popup is
                // the fetched list, and 获取模型 has to show its work.
                open={listOpen}
                onOpenChange={(_, data) => setListOpen(data.open)}
                value={form.model}
                placeholder="deepseek-v4-flash"
                // Combobox types `onChange` as the underlying <input>'s own
                // React handler (the `data`-shaped one belongs to Input), so
                // typing reads the DOM event and picking reads onOptionSelect.
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                onOptionSelect={(_, data) => {
                  if (data.optionValue !== undefined) {
                    setForm((f) => ({ ...f, model: data.optionValue as string }));
                  }
                }}
              >
                {/* Shown only while the form still points at the endpoint that
                    answered — see onFetchModels. Clicking is a fill, not a save. */}
                {modelList !== null &&
                  modelList.baseUrl === normalizedBaseUrl &&
                  modelList.ids.map((id) => (
                    <Option key={id} value={id}>
                      {id}
                    </Option>
                  ))}
              </Combobox>
            </Field>
            <div className={styles.hintRow}>
              <Button
                appearance="subtle"
                size="small"
                disabled={!canFetchModels}
                title={fetchModelsTitle}
                onClick={() => void onFetchModels()}
              >
                {busy === "models" ? copy["config.model.fetching"] : copy["config.model.fetch"]}
              </Button>
              {modelList !== null && modelList.baseUrl === normalizedBaseUrl ? (
                <Text className={modelList.ok ? styles.note : styles.error}>{modelList.message}</Text>
              ) : (
                <Text className={styles.hintText}>{copy["config.model.hint"]}</Text>
              )}
            </div>

            <div className={styles.result} role="status">
              {result !== null && (
                <Text className={result.ok ? styles.note : styles.error}>{result.message}</Text>
              )}
              {warnings.map((warning) => (
                <Text key={warning} className={styles.warn}>
                  {warning}
                </Text>
              ))}
              {locked && <Text className={styles.hintText}>{copy["config.locked"]}</Text>}
            </div>

            <div className={styles.actions}>
              <Button
                appearance="secondary"
                disabled={!canTest}
                title={dirty ? copy["config.test.dirty"] : undefined}
                onClick={() => void onTest()}
              >
                {busy === "test" ? copy["config.testing"] : copy["config.test"]}
              </Button>
              <Button appearance="primary" disabled={!canSave} onClick={() => void onSave()}>
                {busy === "save" ? copy["config.saving"] : copy["config.saveAndTest"]}
              </Button>
            </div>
          </>
        )}
    </div>
  );
}

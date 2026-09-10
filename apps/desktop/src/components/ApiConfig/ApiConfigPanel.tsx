/**
 * ModelSettings overlay (§4.3/§16, v1.0.2): Base URL · API Key · 模型名称.
 *
 * Mounted only while `ui.configOpen` (DesktopShell), never always-mounted
 * behind a slide: the key input then does not exist in the DOM at all while
 * the panel is closed.
 *
 * The credential rule this component exists to honour (§44) is visible in the
 * flow: the key travels UP only. It starts empty every time the panel opens
 * (there is nothing to prefill — the host never returns a value), it is never
 * copied into component state that outlives the save, and the state line
 * reports only whether a key resolves and from which layer.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { ApiConfigData } from "../../protocol/types";
import {
  apiKeyConfiguredCopy,
  apiKeyReadOnlyCopy,
  configSaveFailedCopy,
  configTestFailCopy,
  configTestOkCopy,
  configLoadFailedCopy,
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
  host: {
    position: "absolute",
    inset: 0,
    zIndex: 40,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  scrim: {
    position: "absolute",
    inset: 0,
    backgroundColor: "color-mix(in srgb, var(--colorNeutralBackground1) 55%, transparent)",
  },
  panel: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    gap: "14px",
    width: "560px",
    maxWidth: "calc(100% - 48px)",
    maxHeight: "calc(100% - 48px)",
    overflowY: "auto",
    padding: "20px 24px 18px",
    backgroundColor: tokens.colorNeutralBackground1,
    borderRadius: tokens.borderRadiusXLarge,
    border: `1px solid ${tokens.colorNeutralStroke2}`,
    boxShadow: tokens.shadow16,
  },
  header: {
    display: "flex",
    flexDirection: "row",
    alignItems: "flex-start",
    gap: "8px",
  },
  heading: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
    flex: "1 1 auto",
    minWidth: 0,
  },
  title: {
    fontSize: "17px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  sub: {
    fontSize: "12.5px",
    lineHeight: "18px",
    color: tokens.colorNeutralForeground2,
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "4px",
  },
  labelRow: {
    display: "flex",
    flexDirection: "row",
    alignItems: "baseline",
    gap: "8px",
  },
  label: {
    fontSize: "13px",
    fontWeight: 600,
    color: tokens.colorNeutralForeground1,
  },
  state: {
    fontSize: "12px",
    color: tokens.colorNeutralForeground3,
  },
  input: {
    height: "30px",
    padding: "0 10px",
    fontSize: "13px",
    fontFamily: tokens.fontFamilyBase,
    color: tokens.colorNeutralForeground1,
    backgroundColor: tokens.colorNeutralBackground1,
    border: `1px solid ${tokens.colorNeutralStroke1}`,
    borderRadius: tokens.borderRadiusMedium,
    outline: "none",
    selectors: {
      ":focus": { border: `1px solid ${tokens.colorBrandStroke1}` },
      ":disabled": {
        backgroundColor: tokens.colorNeutralBackground3,
        color: tokens.colorNeutralForeground4,
      },
    },
  },
  hint: {
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
type Busy = "save" | "test" | null;

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

  /** Adopt a configuration the host just returned as the new baseline. */
  const adopt = useCallback((next: ApiConfigData) => {
    setConfig(next);
    setBaseline(baselineOf(next));
    setForm({ baseUrl: next.baseUrl, model: next.model, apiKey: "" });
    setClearApiKey(false);
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

  return (
    <div className={styles.host}>
      <div className={styles.scrim} aria-hidden="true" />
      <div
        className={styles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="api-config-title"
      >
        <div className={styles.header}>
          <div className={styles.heading}>
            <Text id="api-config-title" className={styles.title}>
              {copy["config.title"]}
            </Text>
            <Text className={styles.sub}>{copy["config.sub"]}</Text>
          </div>
          <Button
            appearance="subtle"
            size="small"
            aria-label={copy["config.close"]}
            icon={<DismissRegular aria-hidden="true" />}
            onClick={actions.closeConfig}
          />
        </div>

        {loadState === "loading" && (
          <div className={styles.labelRow}>
            <Spinner size="tiny" aria-hidden="true" />
            <Text className={styles.hint}>{copy["config.loading"]}</Text>
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
            <div className={styles.field}>
              <div className={styles.labelRow}>
                <Text className={styles.label}>{copy["config.baseUrl.label"]}</Text>
                {config.baseUrlOverridden && (
                  <Text className={styles.state}>{copy["config.baseUrl.overridden"]}</Text>
                )}
              </div>
              <input
                className={styles.input}
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label={copy["config.baseUrl.label"]}
                placeholder="https://api.deepseek.com"
                value={form.baseUrl}
                onChange={(e) => setForm((f) => ({ ...f, baseUrl: e.target.value }))}
              />
              {strippedSuffix ? (
                <Text className={styles.note}>{copy["config.baseUrl.stripped"]}</Text>
              ) : (
                <Text className={styles.hint}>{copy["config.baseUrl.hint"]}</Text>
              )}
              {errors.baseUrl !== undefined && (
                <Text className={styles.error}>{copy[errors.baseUrl]}</Text>
              )}
            </div>

            <div className={styles.field}>
              <div className={styles.labelRow}>
                <Text className={styles.label}>{copy["config.apiKey.label"]}</Text>
                <Text className={styles.state}>
                  {apiKey !== null && apiKey.configured && apiKey.source !== undefined
                    ? apiKeyConfiguredCopy(apiKey.source)
                    : copy["config.apiKey.missing"]}
                </Text>
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
              </div>
              <input
                className={styles.input}
                type="password"
                spellCheck={false}
                autoComplete="new-password"
                aria-label={copy["config.apiKey.label"]}
                placeholder="sk-…"
                value={form.apiKey}
                disabled={!canWriteKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
              {apiKey !== null && !apiKey.writable ? (
                <Text className={styles.warn}>{apiKeyReadOnlyCopy(apiKey.ref)}</Text>
              ) : clearApiKey ? (
                <Text className={styles.warn}>{copy["config.apiKey.willClear"]}</Text>
              ) : (
                <Text className={styles.hint}>{copy["config.apiKey.hint"]}</Text>
              )}
            </div>

            <div className={styles.field}>
              <Text className={styles.label}>{copy["config.model.label"]}</Text>
              <input
                className={styles.input}
                type="text"
                spellCheck={false}
                autoComplete="off"
                aria-label={copy["config.model.label"]}
                placeholder="deepseek-v4-flash"
                value={form.model}
                onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
              />
              {errors.model !== undefined ? (
                <Text className={styles.error}>{copy[errors.model]}</Text>
              ) : (
                <Text className={styles.hint}>{copy["config.model.hint"]}</Text>
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
              {locked && <Text className={styles.hint}>{copy["config.locked"]}</Text>}
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
    </div>
  );
}

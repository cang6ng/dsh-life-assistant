/**
 * Model-endpoint form semantics (UI Spec §4.3/§16). Pure — no React, DOM or
 * Fluent imports — so the exact behaviour is unit-testable under node, the
 * same way Composer/sendHint.ts is.
 *
 * The load-bearing rule is the TRI-STATE of every field, which is why the
 * patch builder needs the baseline rather than the values alone:
 *
 *   untouched   → the key is absent from the patch (the host leaves it alone)
 *   cleared     → base URL: "" (the host unsets the override, restoring the
 *                 endpoint default); key: 清除密钥 (the host unsets the ref)
 *   changed     → the new value
 *
 * An empty API-key INPUT, though, is not "clear" — it is "keep the stored
 * one", because the field is write-only and therefore always renders empty.
 * Clearing is an explicit, separate act.
 */

export interface ApiConfigFormValues {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** The configuration last read from the host — what "untouched" compares to. */
export interface ApiConfigFormBaseline {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

/** Field → the copy key of its error; absent when the field is valid. */
export interface ApiConfigFormErrors {
  baseUrl?: "config.err.baseUrl";
  model?: "config.err.model";
}

/** The invoke payload for `config.save`; absent fields mean "leave alone". */
export interface ApiConfigFormPatch {
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
}

const CHAT_COMPLETIONS_SUFFIX = "/chat/completions";

/**
 * Normalize a typed base URL: trim, drop trailing slashes, and drop a pasted
 * `/chat/completions` suffix. The runtime appends that path itself, so a
 * pasted full URL would otherwise 404 — the caller surfaces `strippedSuffix`
 * so the user sees the edit rather than silently getting a different value.
 * "" stays "" (the default endpoint).
 */
export function normalizeBaseUrl(raw: string): { value: string; strippedSuffix: boolean } {
  let value = raw.trim();
  if (value === "") return { value: "", strippedSuffix: false };
  while (value.endsWith("/")) value = value.slice(0, -1);
  let strippedSuffix = false;
  if (value.toLowerCase().endsWith(CHAT_COMPLETIONS_SUFFIX)) {
    value = value.slice(0, -CHAT_COMPLETIONS_SUFFIX.length);
    while (value.endsWith("/")) value = value.slice(0, -1);
    strippedSuffix = true;
  }
  return { value, strippedSuffix };
}

/** An absolute http(s) URL with a host, or "" for "use the default". */
function isUsableBaseUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** Judge the two fields a user can get wrong. The key is never judged here. */
export function validateApiConfigForm(values: ApiConfigFormValues): ApiConfigFormErrors {
  const errors: ApiConfigFormErrors = {};
  if (!isUsableBaseUrl(normalizeBaseUrl(values.baseUrl).value)) {
    errors.baseUrl = "config.err.baseUrl";
  }
  if (values.model.trim() === "") {
    errors.model = "config.err.model";
  }
  return errors;
}

/**
 * Build the patch for the fields that actually differ from the baseline (plus
 * an explicit clear). Typing a key wins over a stale 清除密钥 toggle: the end
 * state is identical either way, and issuing an unset first could fail on a
 * read-only reference for a save that would otherwise succeed.
 */
export function buildApiConfigPatch(
  values: ApiConfigFormValues,
  baseline: ApiConfigFormBaseline,
  options: { clearApiKey: boolean },
): ApiConfigFormPatch {
  const patch: ApiConfigFormPatch = {};
  const baseUrl = normalizeBaseUrl(values.baseUrl).value;
  if (baseUrl !== normalizeBaseUrl(baseline.baseUrl).value) patch.baseUrl = baseUrl;
  const model = values.model.trim();
  if (model !== baseline.model.trim()) patch.model = model;
  const apiKey = values.apiKey.trim();
  if (apiKey !== "") patch.apiKey = apiKey;
  else if (options.clearApiKey) patch.clearApiKey = true;
  return patch;
}

/** True when saving would change anything — the gate on 保存 / 测试连接. */
export function formIsDirty(
  values: ApiConfigFormValues,
  baseline: ApiConfigFormBaseline,
  options: { clearApiKey: boolean },
): boolean {
  return Object.keys(buildApiConfigPatch(values, baseline, options)).length > 0;
}

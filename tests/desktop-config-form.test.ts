/**
 * Model-endpoint form semantics (v1.0.2). `components/ApiConfig/form.ts` is a
 * pure module — no React, DOM or Fluent — so the exact behaviour is testable
 * under node, the way Composer/sendHint.ts is.
 *
 * The load-bearing case is the TRI-STATE of the API-key field. The field is
 * write-only, so it renders empty on every open; "empty" must therefore mean
 * KEEP, and clearing must be its own explicit act. Getting that wrong erases
 * a working credential by pressing 保存 after changing only the model.
 */

import { describe, expect, it } from "vitest";
import {
  buildApiConfigPatch,
  formIsDirty,
  normalizeBaseUrl,
  validateApiConfigForm,
  type ApiConfigFormBaseline,
  type ApiConfigFormValues,
} from "../apps/desktop/src/components/ApiConfig/form";

const BASE: ApiConfigFormBaseline = {
  baseUrl: "https://gateway.example.com/v1",
  model: "gpt-4o-mini",
  apiKeyConfigured: true,
};

const values = (over: Partial<ApiConfigFormValues> = {}): ApiConfigFormValues => ({
  baseUrl: BASE.baseUrl,
  model: BASE.model,
  apiKey: "",
  ...over,
});

const patchOf = (over: Partial<ApiConfigFormValues> = {}, clearApiKey = false) =>
  buildApiConfigPatch(values(over), BASE, { clearApiKey });

describe("normalizeBaseUrl (v1.0.2)", () => {
  it("trims and drops trailing slashes", () => {
    expect(normalizeBaseUrl("  https://api.deepseek.com/  ").value).toBe("https://api.deepseek.com");
    expect(normalizeBaseUrl("https://x.test///").value).toBe("https://x.test");
  });

  it("drops a pasted /chat/completions suffix, since the runtime appends it", () => {
    const pasted = normalizeBaseUrl("https://gw.test/v1/chat/completions");
    expect(pasted.value).toBe("https://gw.test/v1");
    expect(pasted.strippedSuffix).toBe(true);
    // case-insensitive and tolerant of a trailing slash
    expect(normalizeBaseUrl("https://gw.test/v1/Chat/Completions/").value).toBe("https://gw.test/v1");
  });

  it("leaves a URL that merely mentions the path alone", () => {
    const inner = normalizeBaseUrl("https://gw.test/chat/completions/v2");
    expect(inner.value).toBe("https://gw.test/chat/completions/v2");
    expect(inner.strippedSuffix).toBe(false);
  });

  it("keeps the empty string empty — that is 'use the default endpoint'", () => {
    expect(normalizeBaseUrl("")).toEqual({ value: "", strippedSuffix: false });
    expect(normalizeBaseUrl("   ")).toEqual({ value: "", strippedSuffix: false });
  });
});

describe("validateApiConfigForm (v1.0.2)", () => {
  it("accepts an empty base URL and any absolute http(s) URL", () => {
    expect(validateApiConfigForm(values({ baseUrl: "" }))).toEqual({});
    expect(validateApiConfigForm(values({ baseUrl: "http://localhost:8080/v1" }))).toEqual({});
  });

  it("rejects a non-URL, a non-http scheme and a hostless URL", () => {
    for (const baseUrl of ["not a url", "ftp://gw.test", "https://", "gateway.example.com/v1"]) {
      expect(validateApiConfigForm(values({ baseUrl }))).toEqual({ baseUrl: "config.err.baseUrl" });
    }
  });

  it("rejects a blank model name and trims before judging", () => {
    expect(validateApiConfigForm(values({ model: "" }))).toEqual({ model: "config.err.model" });
    expect(validateApiConfigForm(values({ model: "   " }))).toEqual({ model: "config.err.model" });
    expect(validateApiConfigForm(values({ model: "  gpt-4o-mini  " }))).toEqual({});
  });

  it("never judges the key — normalizing one is the host's job, not the form's", () => {
    expect(validateApiConfigForm(values({ apiKey: "sk-a b\nc" }))).toEqual({});
  });

  it("reports both fields at once", () => {
    expect(validateApiConfigForm({ baseUrl: "nope", model: "", apiKey: "" })).toEqual({
      baseUrl: "config.err.baseUrl",
      model: "config.err.model",
    });
  });
});

describe("buildApiConfigPatch (v1.0.2)", () => {
  it("is empty when nothing changed — 保存 stays disabled", () => {
    expect(patchOf()).toEqual({});
    expect(formIsDirty(values(), BASE, { clearApiKey: false })).toBe(false);
  });

  it("ignores cosmetic differences that normalization erases", () => {
    expect(patchOf({ baseUrl: `${BASE.baseUrl}/` })).toEqual({});
    expect(patchOf({ baseUrl: ` ${BASE.baseUrl}/chat/completions ` })).toEqual({});
    expect(patchOf({ model: `  ${BASE.model}  ` })).toEqual({});
  });

  it("sends only the changed base URL, normalized", () => {
    expect(patchOf({ baseUrl: "https://other.test/v1/chat/completions" })).toEqual({
      baseUrl: "https://other.test/v1",
    });
  });

  it("sends an EMPTY base URL to clear the override — not to keep it", () => {
    // The asymmetry with the key field is deliberate: "" is a real value for
    // a base URL (the endpoint default), and a real absence for a key.
    expect(patchOf({ baseUrl: "" })).toEqual({ baseUrl: "" });
  });

  it("KEEPS a stored key when the write-only field is left empty", () => {
    const patch = patchOf({ model: "gpt-5" });
    expect(Object.hasOwn(patch, "apiKey")).toBe(false);
    expect(Object.hasOwn(patch, "clearApiKey")).toBe(false);
  });

  it("clears the key only on the explicit 清除密钥 act", () => {
    expect(patchOf({}, true)).toEqual({ clearApiKey: true });
    // …and only when the field is empty: a typed key is the whole instruction.
    expect(patchOf({ apiKey: "sk-new" }, true)).toEqual({ apiKey: "sk-new" });
  });

  it("trims a typed key before sending it", () => {
    expect(patchOf({ apiKey: "  sk-new\n" })).toEqual({ apiKey: "sk-new" });
  });

  it("combines changes, and dirty tracks the patch's emptiness", () => {
    const patch = patchOf({ baseUrl: "", model: "gpt-5", apiKey: "sk-new" });
    expect(patch).toEqual({ baseUrl: "", model: "gpt-5", apiKey: "sk-new" });
    expect(formIsDirty(values({ baseUrl: "", model: "gpt-5", apiKey: "sk-new" }), BASE, { clearApiKey: false })).toBe(true);
  });

  it("is dirty for a clear alone, even with every text field untouched", () => {
    expect(formIsDirty(values(), BASE, { clearApiKey: true })).toBe(true);
  });

  it("does not depend on the baseline's key state to decide 'keep'", () => {
    // With no key configured the same empty field is still a no-op rather than
    // a spurious clear: the patch says nothing, and the host stores nothing.
    const unconfigured: ApiConfigFormBaseline = { ...BASE, apiKeyConfigured: false };
    expect(buildApiConfigPatch(values(), unconfigured, { clearApiKey: false })).toEqual({});
  });
});

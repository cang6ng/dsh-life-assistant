/**
 * Shared tool-layer helpers.
 *
 * Every tool returns the structured result shape from spec §32:
 *
 *     { ok: true,  ...payload }
 *     { ok: false, error: { code, message } }
 *
 * Expected business failures (INVALID_ARGUMENT, NOT_FOUND,
 * IDENTITY_REQUIRED, ACCESS_DENIED, DATABASE_ERROR, MEMORY_ERROR) are
 * converted into the `ok: false` payload; anything else is rethrown so the
 * DSH tool runtime surfaces it as a real tool error.
 */

import type { ContentBlock } from "@deepseek-ai/dsh-llm";
import { ChinookError, type ChinookErrorCode } from "../errors.js";
import type { JsonValue } from "../json.js";

export interface FailureResult {
  ok: false;
  error: { code: ChinookErrorCode; message: string };
}

/**
 * Narrow a typed service value to JsonValue at the DSH tool boundary.
 * Services produce plain data (primitives, arrays, plain objects) that
 * conforms to JSON by construction; this cast documents that boundary.
 */
export function jsonValueOf(value: unknown): JsonValue {
  return value as unknown as JsonValue;
}

export function errorResult(code: ChinookErrorCode, message: string): JsonValue {
  return { ok: false, error: { code, message } };
}

/** Convert an expected business error into the structured failure payload. */
export function failureOf(error: unknown): JsonValue {
  if (error instanceof ChinookError) return jsonValueOf(error.toResult());
  throw error;
}

/** Pretty JSON is the parseable, model-friendly rendering of every result. */
export function renderJson(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: "text", text: JSON.stringify(value, null, 2) }];
}

/**
 * Layered error taxonomy for the Chinook plugin.
 *
 * Services throw these; tools convert them into the structured
 * `{ ok: false, error: { code, message } }` result shape that the Agent
 * consumes. Codes follow the V1 spec's minimum taxonomy.
 */

export type ChinookErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "IDENTITY_REQUIRED"
  | "ACCESS_DENIED"
  | "DATABASE_ERROR"
  | "MEMORY_ERROR";

export class ChinookError extends Error {
  readonly code: ChinookErrorCode;

  constructor(code: ChinookErrorCode, message: string) {
    super(message);
    this.name = "ChinookError";
    this.code = code;
  }

  /** Structured error payload returned to the Agent inside tool results. */
  toResult(): { ok: false; error: { code: ChinookErrorCode; message: string } } {
    return { ok: false, error: { code: this.code, message: this.message } };
  }
}

export function invalidArgument(message: string): ChinookError {
  return new ChinookError("INVALID_ARGUMENT", message);
}

export function notFound(message: string): ChinookError {
  return new ChinookError("NOT_FOUND", message);
}

export function identityRequired(): ChinookError {
  return new ChinookError(
    "IDENTITY_REQUIRED",
    "No customer identity is available for this request. Account and memory tools need a signed-in customer.",
  );
}

export function accessDenied(message: string): ChinookError {
  return new ChinookError("ACCESS_DENIED", message);
}

export function databaseError(message: string): ChinookError {
  return new ChinookError("DATABASE_ERROR", message);
}

export function memoryError(message: string): ChinookError {
  return new ChinookError("MEMORY_ERROR", message);
}

/**
 * Identity layer: the current customer is program-trusted context, never a
 * model-supplied parameter. V1 ships a single DemoIdentityProvider that
 * resolves the customer id from the `CHINOOK_CUSTOMER_ID` environment
 * variable (see README), falling back to a documented demo default.
 */

export interface IdentityProvider {
  /**
   * The current customer id, or `null` when no identity is available.
   * Account and memory tools must refuse (IDENTITY_REQUIRED) when null.
   */
  getCurrentCustomerId(): number | null;
}

export interface DemoIdentityOptions {
  /** Fallback used when `CHINOOK_CUSTOMER_ID` is unset or invalid. */
  demoCustomerId?: number | null;
}

/**
 * Demo identity provider backed by the `CHINOOK_CUSTOMER_ID` environment
 * variable, re-read on every call so tests and deployments can switch the
 * active demo customer without rebuilding the plugin.
 *
 * Default demo customer id is 1 (documented in the project README). Pass
 * `demoCustomerId: null` (or set `CHINOOK_CUSTOMER_ID` to an empty string)
 * to force the anonymous state for identity-required tests.
 */
export class DemoIdentityProvider implements IdentityProvider {
  private readonly demoCustomerId: number | null;

  constructor(options: DemoIdentityOptions = {}) {
    this.demoCustomerId = options.demoCustomerId === undefined ? 1 : options.demoCustomerId;
  }

  getCurrentCustomerId(): number | null {
    const raw = process.env.CHINOOK_CUSTOMER_ID;
    if (raw !== undefined && raw !== "") {
      const parsed = Number(raw);
      if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
      // Invalid env value behaves as "anonymous" rather than silently
      // mapping to a real customer.
      return null;
    }
    return this.demoCustomerId;
  }
}

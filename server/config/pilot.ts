/**
 * Pilot mode configuration (server side).
 *
 * ADR adr-016: Kitabu Connect runs as a school-cluster pilot. In pilot mode the
 * platform never holds or moves money, so purchase orders, Paystack initialisation,
 * escrow, wallet top-ups/withdrawals and every platform fee are switched off.
 * The code is kept, not deleted: set PILOT_MODE=false to bring it back.
 *
 * PILOT_MODE defaults to TRUE when unset. Only an explicit "false", "0", "off" or "no"
 * turns it off.
 */

const OFF_VALUES = new Set(["false", "0", "off", "no"]);

export function parsePilotMode(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const normalised = String(value).trim().toLowerCase();
  if (normalised === "") return true;
  return !OFF_VALUES.has(normalised);
}

/** Read at call time so tests and scripts can flip process.env.PILOT_MODE. */
export function isPilotMode(): boolean {
  return parsePilotMode(process.env.PILOT_MODE);
}

export const PILOT_DISABLED_CODE = "FEATURE_DISABLED_IN_PILOT";

export const PILOT_DISABLED_MESSAGE =
  "This feature is switched off during the Kitabu Connect school pilot. " +
  "Kitabu Connect never holds your money: pay the seller directly (M-Pesa or cash) at handover.";

export const PILOT_PAYMENT_NOTICE =
  "Pay the seller directly (M-Pesa or cash) at handover. Kitabu Connect never holds your money.";

/** Suggested used price band, as a fraction of the list price (ADR adr-016, 40 to 60%). */
export const PILOT_SUGGESTED_PRICE_MIN_RATIO = 0.4;
export const PILOT_SUGGESTED_PRICE_MAX_RATIO = 0.6;

/** Current consent notice version. Bump when the notice text changes. */
export const CONSENT_VERSION = "2026-11-v1";

/** The booklist year the pilot is loaded for. */
export const PILOT_BOOKLIST_YEAR = 2027;

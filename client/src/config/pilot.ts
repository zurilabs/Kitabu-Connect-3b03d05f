/**
 * Pilot mode configuration (client side). Mirrors server/config/pilot.ts.
 *
 * VITE_PILOT_MODE defaults to TRUE when unset. Only an explicit "false", "0",
 * "off" or "no" turns it off. In pilot mode the money, cycle, dispute, chat,
 * referral, gamification and wallet screens are hidden (ADR adr-016).
 */

const OFF_VALUES = new Set(["false", "0", "off", "no"]);

export function parsePilotMode(value: string | undefined | null): boolean {
  if (value === undefined || value === null) return true;
  const normalised = String(value).trim().toLowerCase();
  if (normalised === "") return true;
  return !OFF_VALUES.has(normalised);
}

export const PILOT_MODE: boolean = parsePilotMode(import.meta.env.VITE_PILOT_MODE as string | undefined);

export const PILOT_PAYMENT_NOTICE =
  "Pay the seller directly (M-Pesa or cash) at handover. Kitabu Connect never holds your money.";

export const CONSENT_VERSION = "2026-11-v1";

/** Routes hidden in pilot mode. Guards redirect these to /dashboard. */
export const PILOT_HIDDEN_ROUTE_PREFIXES = [
  "/swap-cycles",
  "/disputes",
  "/conversations",
  "/swap-conversations",
  "/orders",
  "/referrals",
] as const;

export function isPilotHiddenRoute(path: string): boolean {
  return PILOT_HIDDEN_ROUTE_PREFIXES.some(
    (p) => path === p || path.startsWith(p + "/")
  );
}

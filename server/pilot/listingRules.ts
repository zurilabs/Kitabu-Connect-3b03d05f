/**
 * Listing rules and price guidance for the pilot (adr-016). Pure functions.
 */
import {
  PILOT_SUGGESTED_PRICE_MIN_RATIO,
  PILOT_SUGGESTED_PRICE_MAX_RATIO,
} from "../config/pilot";

export interface PilotListingCheck {
  ok: boolean;
  message?: string;
  code?: "WRITTEN_IN_BLOCKED";
}

/**
 * In pilot mode a book with writing in it cannot be listed: the pilot only handles
 * clean, reusable books. Outside pilot mode the flag is recorded but not blocking.
 */
export function checkListingForPilot(
  listing: { writtenIn?: boolean | null },
  pilotMode: boolean
): PilotListingCheck {
  if (pilotMode && listing.writtenIn === true) {
    return {
      ok: false,
      code: "WRITTEN_IN_BLOCKED",
      message:
        "Written-in books cannot be listed in the pilot, because the next family cannot reuse them. " +
        "Rub out any pencil marks and list it again, or keep this copy for your own use.",
    };
  }
  return { ok: true };
}

export interface SuggestedPrice {
  min: number;
  max: number;
}

/** Suggested used price: 40 to 60% of the list price, rounded to the nearest KES 10. */
export function suggestedUsedPrice(
  listPrice: number | string | null | undefined
): SuggestedPrice | null {
  if (listPrice === null || listPrice === undefined || listPrice === "") return null;
  const n = typeof listPrice === "string" ? parseFloat(listPrice) : listPrice;
  if (!Number.isFinite(n) || n <= 0) return null;
  const round10 = (v: number) => Math.round(v / 10) * 10;
  return {
    min: round10(n * PILOT_SUGGESTED_PRICE_MIN_RATIO),
    max: round10(n * PILOT_SUGGESTED_PRICE_MAX_RATIO),
  };
}

/**
 * Reservation rules for the pilot (adr-017). Pure functions, no database.
 */

export const MAX_ACTIVE_RESERVATIONS_PER_BUYER = 10;

export type ReservationStatus = "reserved" | "cancelled" | "completed";

/** First word of a full name, or a neutral label. Never returns phone, email or other details. */
export function firstName(fullName: string | null | undefined): string {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first ? first : "A parent";
}

export interface ReserveCheck {
  ok: boolean;
  status?: number;
  message?: string;
}

/** Decide whether a buyer may reserve a listing. */
export function checkReservable(input: {
  buyerId: string;
  listing: { sellerId: string; listingStatus: string | null; listingType: string | null; quantityAvailable: number | null };
  activeReservationsForBuyer: number;
}): ReserveCheck {
  const { buyerId, listing } = input;
  if (listing.sellerId === buyerId) {
    return { ok: false, status: 400, message: "You cannot reserve your own listing." };
  }
  if (listing.listingType === "swap") {
    return { ok: false, status: 400, message: "Swap listings use a swap request, not a reservation." };
  }
  if (listing.listingStatus === "reserved") {
    return { ok: false, status: 409, message: "This book is already reserved by another parent." };
  }
  if (listing.listingStatus !== "active" || (listing.quantityAvailable ?? 1) <= 0) {
    return { ok: false, status: 409, message: "This book is no longer available." };
  }
  if (input.activeReservationsForBuyer >= MAX_ACTIVE_RESERVATIONS_PER_BUYER) {
    return {
      ok: false,
      status: 422,
      message: `You can hold at most ${MAX_ACTIVE_RESERVATIONS_PER_BUYER} reservations at a time. Complete or cancel one first.`,
    };
  }
  return { ok: true };
}

/** Role of a user in a reservation, or null for non-parties (callers answer 404). */
export function reservationRole(
  userId: string,
  r: { buyerId: string; sellerId: string }
): "buyer" | "seller" | null {
  if (r.buyerId === userId) return "buyer";
  if (r.sellerId === userId) return "seller";
  return null;
}

/** Notification text. Contains book title, first name and collection day only. */
export function reservationNotificationText(input: {
  bookTitle: string;
  buyerName: string | null | undefined;
  collectionDay?: { date: string; startTime: string; endTime: string } | null;
}): string {
  const day = input.collectionDay
    ? `Hand over at the school collection day on ${input.collectionDay.date}, ${input.collectionDay.startTime} to ${input.collectionDay.endTime}.`
    : "No collection day is scheduled yet; you will be told when one is set.";
  return `${firstName(input.buyerName)} reserved "${input.bookTitle}". ${day}`;
}

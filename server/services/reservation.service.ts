import { db } from "../db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { bookListings, collectionDays, listingReservations, users } from "../db/schema";
import { booklistService } from "./booklist.service";
import { notificationService } from "./notification.service";
import {
  checkReservable,
  firstName,
  reservationNotificationText,
  reservationRole,
} from "../pilot/reservations";

type Fail = { success: false; status: number; message: string };

/**
 * Pilot reservations (adr-017). A reservation locks one sell listing for one buyer until the
 * school collection day. Contact details are never exposed: first names and the day only.
 */
export class ReservationService {
  async reserve(buyerId: string, listingId: number): Promise<Fail | { success: true; reservation: any }> {
    const outcome = await db.transaction(async (tx) => {
      const [listing] = await tx.select().from(bookListings).where(eq(bookListings.id, listingId)).limit(1);
      if (!listing) return { success: false as const, status: 404, message: "Listing not found" };

      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)` })
        .from(listingReservations)
        .where(and(eq(listingReservations.buyerId, buyerId), eq(listingReservations.status, "reserved")));

      const check = checkReservable({
        buyerId,
        listing,
        activeReservationsForBuyer: Number(count),
      });
      if (!check.ok) return { success: false as const, status: check.status!, message: check.message! };

      // Guarded UPDATE: only one concurrent buyer can move the listing from active to reserved.
      const [claim] = await tx
        .update(bookListings)
        .set({ listingStatus: "reserved" })
        .where(
          and(
            eq(bookListings.id, listingId),
            eq(bookListings.listingStatus, "active"),
            eq(bookListings.listingType, "sell")
          )
        );
      if ((claim as unknown as { affectedRows: number }).affectedRows !== 1) {
        return { success: false as const, status: 409, message: "This book is already reserved by another parent." };
      }

      const day = await booklistService.getNextCollectionDay(listing.schoolId ?? null);
      const [inserted] = await tx.insert(listingReservations).values({
        listingId,
        buyerId,
        sellerId: listing.sellerId,
        collectionDayId: day?.id ?? null,
        status: "reserved",
      });
      return { success: true as const, id: inserted.insertId, listing, day };
    });

    if (!outcome.success) return outcome;

    const [buyer] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, buyerId)).limit(1);
    await notificationService.createNotification({
      userId: outcome.listing.sellerId,
      type: "reservation_created",
      title: "Your book was reserved",
      message: reservationNotificationText({
        bookTitle: outcome.listing.title,
        buyerName: buyer?.fullName,
        collectionDay: outcome.day,
      }),
      relatedBookListingId: outcome.listing.id,
      actionUrl: "/reservations",
    });

    const [reservation] = await db
      .select()
      .from(listingReservations)
      .where(eq(listingReservations.id, outcome.id))
      .limit(1);
    return { success: true, reservation };
  }

  async list(userId: string, role: "buyer" | "seller") {
    const mine = role === "buyer" ? listingReservations.buyerId : listingReservations.sellerId;
    const rows = await db
      .select()
      .from(listingReservations)
      .where(eq(mine, userId))
      .orderBy(desc(listingReservations.createdAt))
      .limit(200);
    if (rows.length === 0) return [];

    const listings = await db
      .select({
        id: bookListings.id,
        title: bookListings.title,
        photo: bookListings.primaryPhotoUrl,
        price: bookListings.price,
      })
      .from(bookListings)
      .where(inArray(bookListings.id, Array.from(new Set(rows.map((r) => r.listingId)))));
    const otherIds = Array.from(new Set(rows.map((r) => (role === "buyer" ? r.sellerId : r.buyerId))));
    const people = await db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, otherIds));
    const dayIds = rows.map((r) => r.collectionDayId).filter((d): d is number => d !== null);
    const days = dayIds.length
      ? await db.select().from(collectionDays).where(inArray(collectionDays.id, Array.from(new Set(dayIds))))
      : [];

    return rows.map((r) => {
      const listing = listings.find((l) => l.id === r.listingId);
      const other = people.find((p) => p.id === (role === "buyer" ? r.sellerId : r.buyerId));
      const day = days.find((d) => d.id === r.collectionDayId);
      return {
        id: r.id,
        listingId: r.listingId,
        status: r.status,
        role,
        bookTitle: listing?.title ?? "Book",
        photoUrl: listing?.photo ?? null,
        price: listing?.price ?? null,
        otherPartyFirstName: firstName(other?.fullName),
        collectionDay: day
          ? { id: day.id, date: day.date, startTime: day.startTime, endTime: day.endTime, venueNote: day.venueNote }
          : null,
        myConfirmed: role === "buyer" ? r.buyerConfirmed : r.sellerConfirmed,
        otherConfirmed: role === "buyer" ? r.sellerConfirmed : r.buyerConfirmed,
        createdAt: r.createdAt,
      };
    });
  }

  /** The caller's active reservation for a listing (buyer side), for the listing page. */
  async getMyActiveForListing(userId: string, listingId: number) {
    const [r] = await db
      .select()
      .from(listingReservations)
      .where(
        and(
          eq(listingReservations.listingId, listingId),
          eq(listingReservations.buyerId, userId),
          eq(listingReservations.status, "reserved")
        )
      )
      .limit(1);
    if (!r) return null;
    const [day] = r.collectionDayId
      ? await db.select().from(collectionDays).where(eq(collectionDays.id, r.collectionDayId)).limit(1)
      : [];
    return {
      id: r.id,
      collectionDay: day
        ? { id: day.id, date: day.date, startTime: day.startTime, endTime: day.endTime, venueNote: day.venueNote }
        : null,
    };
  }

  private async getForParty(userId: string, id: number) {
    const [r] = await db.select().from(listingReservations).where(eq(listingReservations.id, id)).limit(1);
    if (!r || !reservationRole(userId, r)) return null; // non-parties get 404 (no IDOR)
    return r;
  }

  async cancel(userId: string, id: number): Promise<Fail | { success: true }> {
    const r = await this.getForParty(userId, id);
    if (!r) return { success: false, status: 404, message: "Reservation not found" };
    if (r.status !== "reserved") {
      return { success: false, status: 409, message: "This reservation is no longer active." };
    }

    await db.transaction(async (tx) => {
      await tx
        .update(listingReservations)
        .set({ status: "cancelled", cancelledBy: userId })
        .where(and(eq(listingReservations.id, id), eq(listingReservations.status, "reserved")));
      await tx
        .update(bookListings)
        .set({ listingStatus: "active" })
        .where(and(eq(bookListings.id, r.listingId), eq(bookListings.listingStatus, "reserved")));
    });

    const [listing] = await db.select({ title: bookListings.title }).from(bookListings).where(eq(bookListings.id, r.listingId)).limit(1);
    const [actor] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
    const otherId = r.buyerId === userId ? r.sellerId : r.buyerId;
    await notificationService.createNotification({
      userId: otherId,
      type: "reservation_cancelled",
      title: "A reservation was cancelled",
      message: `${firstName(actor?.fullName)} cancelled the reservation for "${listing?.title ?? "the book"}". The book is available again.`,
      relatedBookListingId: r.listingId,
      actionUrl: "/reservations",
    });
    return { success: true };
  }

  async confirm(userId: string, id: number): Promise<Fail | { success: true; status: string }> {
    const r = await this.getForParty(userId, id);
    if (!r) return { success: false, status: 404, message: "Reservation not found" };
    if (r.status !== "reserved") {
      return { success: false, status: 409, message: "This reservation is no longer active." };
    }

    const isBuyer = r.buyerId === userId;
    const buyerConfirmed = isBuyer ? true : r.buyerConfirmed;
    const sellerConfirmed = isBuyer ? r.sellerConfirmed : true;
    const done = buyerConfirmed && sellerConfirmed;

    await db.transaction(async (tx) => {
      await tx
        .update(listingReservations)
        .set({ buyerConfirmed, sellerConfirmed, status: done ? "completed" : "reserved" })
        .where(and(eq(listingReservations.id, id), eq(listingReservations.status, "reserved")));
      if (done) {
        await tx
          .update(bookListings)
          .set({ listingStatus: "sold", soldAt: new Date(), quantityAvailable: 0 })
          .where(eq(bookListings.id, r.listingId));
      }
    });

    if (!done) {
      const [listing] = await db.select({ title: bookListings.title }).from(bookListings).where(eq(bookListings.id, r.listingId)).limit(1);
      const [actor] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, userId)).limit(1);
      await notificationService.createNotification({
        userId: isBuyer ? r.sellerId : r.buyerId,
        type: "reservation_confirmed",
        title: "Handover confirmed by the other parent",
        message: `${firstName(actor?.fullName)} confirmed the handover of "${listing?.title ?? "the book"}". Please confirm on your side.`,
        relatedBookListingId: r.listingId,
        actionUrl: "/reservations",
      });
    }
    return { success: true, status: done ? "completed" : "reserved" };
  }
}

export const reservationService = new ReservationService();

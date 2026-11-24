import { db } from "../db";
import {
  schools,
  schoolBooklists,
  schoolBooklistItems,
  collectionDays,
  children,
  wishlistItems,
  bookListings,
  type CreateBooklistInput,
  type BooklistItemInput,
  type CreateCollectionDayInput,
  type UpdateCollectionDayInput,
} from "../db/schema";
import { and, asc, desc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { PILOT_BOOKLIST_YEAR } from "../config/pilot";
import {
  booklistItemKey,
  buildWishlistDrafts,
  canonicalGrade,
  dedupeBooklistItems,
  eligibleBooklistItems,
  rankMatchesForItem,
} from "../pilot/matching";
import { suggestedUsedPrice } from "../pilot/listingRules";
import { todayEat } from "../pilot/dates";

export { todayEat };

function itemValues(booklistId: number, items: BooklistItemInput[]) {
  return items.map((i) => ({
    booklistId,
    title: i.title,
    subject: i.subject ?? null,
    publisher: i.publisher ?? null,
    isbn: i.isbn ?? null,
    kicdApproved: i.kicdApproved,
    reusable: i.reusable,
    listPriceKes:
      i.listPriceKes !== undefined && i.listPriceKes !== null ? i.listPriceKes.toFixed(2) : null,
  }));
}

export class BooklistService {
  /* ---------- Admin: booklists ---------- */

  async createBooklist(adminId: string, rawInput: CreateBooklistInput) {
    const input = { ...rawInput, grade: canonicalGrade(rawInput.grade) };
    const [school] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.id, input.schoolId))
      .limit(1);
    if (!school) return { success: false as const, status: 404, message: "School not found" };

    // One booklist per school x grade x year x source: reuse it if it exists.
    const [existing] = await db
      .select()
      .from(schoolBooklists)
      .where(
        and(
          eq(schoolBooklists.schoolId, input.schoolId),
          eq(schoolBooklists.grade, input.grade),
          eq(schoolBooklists.year, input.year),
          eq(schoolBooklists.source, input.source)
        )
      )
      .limit(1);

    let booklistId: number;
    let created = false;
    if (existing) {
      booklistId = existing.id;
    } else {
      const [result] = await db.insert(schoolBooklists).values({
        schoolId: input.schoolId,
        grade: input.grade,
        year: input.year,
        source: input.source,
        createdBy: adminId,
      });
      booklistId = result.insertId;
      created = true;
    }

    let itemsAdded = 0;
    let itemsSkipped = 0;
    if (input.items && input.items.length > 0) {
      const fresh = await this.newItemsFor(booklistId, input.items);
      if (fresh.length > 0) await db.insert(schoolBooklistItems).values(itemValues(booklistId, fresh));
      itemsAdded = fresh.length;
      itemsSkipped = input.items.length - fresh.length;
    }

    const booklist = await this.getBooklistById(booklistId);
    return { success: true as const, created, itemsAdded, itemsSkipped, booklist };
  }

  /** Items not already in the booklist (by ISBN, else normalised title) and not repeated in the input. */
  private async newItemsFor(booklistId: number, items: BooklistItemInput[]) {
    const existing = await db
      .select({ title: schoolBooklistItems.title, isbn: schoolBooklistItems.isbn })
      .from(schoolBooklistItems)
      .where(eq(schoolBooklistItems.booklistId, booklistId));
    return dedupeBooklistItems(items, existing.map(booklistItemKey));
  }

  async addItems(booklistId: number, items: BooklistItemInput[]) {
    const [booklist] = await db
      .select({ id: schoolBooklists.id })
      .from(schoolBooklists)
      .where(eq(schoolBooklists.id, booklistId))
      .limit(1);
    if (!booklist) return { success: false as const, status: 404, message: "Booklist not found" };

    const fresh = await this.newItemsFor(booklistId, items);
    if (fresh.length > 0) await db.insert(schoolBooklistItems).values(itemValues(booklistId, fresh));
    return {
      success: true as const,
      itemsAdded: fresh.length,
      itemsSkipped: items.length - fresh.length,
      booklist: await this.getBooklistById(booklistId),
    };
  }

  async getBooklistById(booklistId: number) {
    const [booklist] = await db
      .select()
      .from(schoolBooklists)
      .where(eq(schoolBooklists.id, booklistId))
      .limit(1);
    if (!booklist) return null;
    const items = await db
      .select()
      .from(schoolBooklistItems)
      .where(eq(schoolBooklistItems.booklistId, booklistId))
      .orderBy(asc(schoolBooklistItems.id));
    return { ...booklist, items };
  }

  async listBooklists(filters: { schoolId?: string; grade?: string; year?: number }) {
    const conditions = [] as ReturnType<typeof eq>[];
    if (filters.schoolId) conditions.push(eq(schoolBooklists.schoolId, filters.schoolId));
    if (filters.grade) conditions.push(eq(schoolBooklists.grade, canonicalGrade(filters.grade)));
    if (filters.year) conditions.push(eq(schoolBooklists.year, filters.year));

    const lists = await db
      .select()
      .from(schoolBooklists)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(schoolBooklists.year), asc(schoolBooklists.grade))
      .limit(200);

    if (lists.length === 0) return [];
    const items = await db
      .select()
      .from(schoolBooklistItems)
      .where(
        inArray(
          schoolBooklistItems.booklistId,
          lists.map((l) => l.id)
        )
      )
      .orderBy(asc(schoolBooklistItems.id));
    return lists.map((l) => ({ ...l, items: items.filter((i) => i.booklistId === l.id) }));
  }

  /* ---------- Collection days ---------- */

  async createCollectionDay(adminId: string, input: CreateCollectionDayInput) {
    const [school] = await db
      .select({ id: schools.id })
      .from(schools)
      .where(eq(schools.id, input.schoolId))
      .limit(1);
    if (!school) return { success: false as const, status: 404, message: "School not found" };

    const [result] = await db.insert(collectionDays).values({
      schoolId: input.schoolId,
      date: input.date,
      startTime: input.startTime,
      endTime: input.endTime,
      venueNote: input.venueNote ?? null,
      status: input.status,
      createdBy: adminId,
    });

    const [day] = await db
      .select()
      .from(collectionDays)
      .where(eq(collectionDays.id, result.insertId))
      .limit(1);
    return { success: true as const, collectionDay: day };
  }

  /** Admin: change status, time or venue of a collection day (a day is cancelled by status). */
  async updateCollectionDay(dayId: number, input: UpdateCollectionDayInput) {
    const [day] = await db.select().from(collectionDays).where(eq(collectionDays.id, dayId)).limit(1);
    if (!day) return { success: false as const, status: 404, message: "Collection day not found" };

    const startTime = input.startTime ?? day.startTime;
    const endTime = input.endTime ?? day.endTime;
    if (endTime <= startTime) {
      return { success: false as const, status: 422, message: "End time must be after start time" };
    }

    const set: Partial<typeof collectionDays.$inferInsert> = { startTime, endTime };
    if (input.status !== undefined) set.status = input.status;
    if (input.venueNote !== undefined) set.venueNote = input.venueNote;
    await db.update(collectionDays).set(set).where(eq(collectionDays.id, dayId));

    const [updated] = await db.select().from(collectionDays).where(eq(collectionDays.id, dayId)).limit(1);
    return { success: true as const, collectionDay: updated };
  }

  /**
   * A client-supplied collection day must exist, belong to the listing's school and not be
   * cancelled. Returns an error message (422) or null when valid.
   */
  async validateCollectionDayForSchool(dayId: number, schoolId: string | null): Promise<string | null> {
    const [day] = await db.select().from(collectionDays).where(eq(collectionDays.id, dayId)).limit(1);
    if (!day) return "Collection day not found";
    if (!schoolId || day.schoolId !== schoolId) {
      return "That collection day is not at the school of this book";
    }
    if (day.status === "cancelled") return "That collection day has been cancelled";
    return null;
  }

  /** Upcoming (today or later), not cancelled, soonest first. */
  async listUpcomingCollectionDays(schoolId?: string) {
    const conditions = [
      gte(collectionDays.date, todayEat()),
      ne(collectionDays.status, "cancelled"),
    ];
    if (schoolId) conditions.push(eq(collectionDays.schoolId, schoolId));
    return db
      .select()
      .from(collectionDays)
      .where(and(...conditions))
      .orderBy(asc(collectionDays.date), asc(collectionDays.startTime))
      .limit(100);
  }

  async getNextCollectionDay(schoolId: string | null) {
    if (!schoolId) return null;
    const days = await this.listUpcomingCollectionDays(schoolId);
    return days[0] ?? null;
  }

  /* ---------- Parent: child slot booklist ---------- */

  private async getOwnedSlot(parentId: string, childId: number) {
    const [child] = await db
      .select()
      .from(children)
      .where(and(eq(children.id, childId), eq(children.parentId, parentId)))
      .limit(1);
    return child ?? null;
  }

  /** Booklist items for a school + grade + year (all sources). */
  private async getItemsForSlot(schoolId: string, grade: string, year: number) {
    const lists = await db
      .select({ id: schoolBooklists.id })
      .from(schoolBooklists)
      .where(
        and(
          eq(schoolBooklists.schoolId, schoolId),
          eq(schoolBooklists.grade, canonicalGrade(grade)),
          eq(schoolBooklists.year, year)
        )
      );
    if (lists.length === 0) return [];
    const rows = await db
      .select()
      .from(schoolBooklistItems)
      .where(
        inArray(
          schoolBooklistItems.booklistId,
          lists.map((l) => l.id)
        )
      )
      .orderBy(asc(schoolBooklistItems.id));
    // Several sources can list the same book: show and build it once.
    return dedupeBooklistItems(rows);
  }

  /**
   * Auto-build the child slot's wishlist from the school's booklist for the year.
   * Reusable, KICD-approved items only. Idempotent: items already linked are skipped.
   * No notifications are sent here; the booklist page shows matches directly.
   */
  async buildWishlistForSlot(parentId: string, childId: number, year = PILOT_BOOKLIST_YEAR) {
    const slot = await this.getOwnedSlot(parentId, childId);
    if (!slot) return { success: false as const, status: 404, message: "Child slot not found" };
    if (!slot.schoolId) {
      return {
        success: false as const,
        status: 400,
        message: "Add a school to this child slot to see its booklist.",
      };
    }

    const items = await this.getItemsForSlot(slot.schoolId, slot.grade, year);
    const existing = await db
      .select({ booklistItemId: wishlistItems.booklistItemId })
      .from(wishlistItems)
      .where(eq(wishlistItems.childId, childId));
    const linkedIds = existing
      .map((e) => e.booklistItemId)
      .filter((id): id is number => id !== null && id !== undefined);

    const drafts = buildWishlistDrafts(
      items,
      { grade: slot.grade, schoolId: slot.schoolId, curriculum: slot.curriculum },
      linkedIds
    );

    if (drafts.length > 0) {
      await db.insert(wishlistItems).values(
        drafts.map((d) => ({
          childId,
          title: d.title,
          publisher: d.publisher,
          isbn: d.isbn,
          subject: d.subject,
          grade: d.grade,
          curriculum: d.curriculum,
          notes: d.notes,
          booklistItemId: d.booklistItemId,
          status: "active",
        }))
      )
      // UNIQUE(child_id, booklist_item_id): a concurrent build is a no-op on duplicates.
      .onDuplicateKeyUpdate({ set: { childId: sql`child_id` } });
    }

    return { success: true as const, slot, items, created: drafts.length };
  }

  /**
   * "My child's 2027 booklist" (read-only): each reusable item with matched open listings
   * (same school first, then same grade elsewhere) and the next collection day.
   */
  async getChildBooklistView(parentId: string, childId: number, year = PILOT_BOOKLIST_YEAR) {
    // Read-only: the wishlist build is a separate POST (buildWishlistForSlot).
    const slot = await this.getOwnedSlot(parentId, childId);
    if (!slot) return { success: false as const, status: 404, message: "Child slot not found" };
    if (!slot.schoolId) {
      return {
        success: false as const,
        status: 400,
        message: "Add a school to this child slot to see its booklist.",
      };
    }
    const items = await this.getItemsForSlot(slot.schoolId, slot.grade, year);
    const eligible = eligibleBooklistItems(items);

    const openListings = await db
      .select()
      .from(bookListings)
      .where(
        and(
          eq(bookListings.listingStatus, "active"),
          sql`${bookListings.quantityAvailable} > 0`,
          ne(bookListings.sellerId, parentId),
          eq(bookListings.writtenIn, false)
        )
      )
      .orderBy(desc(bookListings.createdAt))
      .limit(500);

    const slotRef = { schoolId: slot.schoolId, grade: slot.grade };

    const viewItems = eligible.map((item) => {
      const ranked = rankMatchesForItem(openListings, item, slotRef, { excludeSellerId: parentId });
      return {
        id: item.id,
        title: item.title,
        subject: item.subject,
        publisher: item.publisher,
        isbn: item.isbn,
        listPriceKes: item.listPriceKes,
        suggestedUsedPrice: suggestedUsedPrice(item.listPriceKes),
        matches: ranked.map((m) => ({
          tier: m.tier,
          score: m.score,
          listing: {
            id: m.listing.id,
            title: m.listing.title,
            price: m.listing.price,
            condition: m.listing.condition,
            classGrade: m.listing.classGrade,
            listingType: m.listing.listingType,
            primaryPhotoUrl: m.listing.primaryPhotoUrl,
            schoolId: m.listing.schoolId,
          },
        })),
      };
    });

    const nextCollectionDay = await this.getNextCollectionDay(slot.schoolId);

    return {
      success: true as const,
      year,
      slot: {
        id: slot.id,
        grade: slot.grade,
        schoolId: slot.schoolId,
        schoolName: slot.schoolName,
        curriculum: slot.curriculum,
      },
      hasBooklist: items.length > 0,
      excludedCount: items.length - eligible.length,
      items: viewItems,
      matchedCount: viewItems.filter((i) => i.matches.length > 0).length,
      nextCollectionDay,
    };
  }
}

export const booklistService = new BooklistService();

/**
 * School booklist matching for the pilot (adr-016). Pure functions, no database.
 *
 * Flow: a child slot (grade + school) -> that school+grade booklist for the year ->
 * reusable, KICD-approved items only -> wishlist drafts -> match open listings at the
 * same school first, then the same grade elsewhere in the cluster.
 */

export interface BooklistItemLike {
  id: number;
  title: string;
  subject?: string | null;
  publisher?: string | null;
  isbn?: string | null;
  kicdApproved: boolean;
  reusable: boolean;
  listPriceKes?: string | number | null;
}

export interface ChildSlotRef {
  grade: string;
  schoolId: string | null;
  curriculum?: string | null;
}

export interface WishlistDraft {
  title: string;
  subject: string | null;
  publisher: string | null;
  isbn: string | null;
  grade: string;
  curriculum: string | null;
  booklistItemId: number;
  notes: string | null;
}

/** Only reusable, KICD-approved items are matched. Workbooks and unapproved titles are excluded. */
export function eligibleBooklistItems<T extends BooklistItemLike>(items: T[]): T[] {
  return items.filter((i) => i.reusable === true && i.kicdApproved === true);
}

/**
 * Build wishlist drafts from a booklist. Items already on the child's wishlist
 * (by booklistItemId) are skipped, so the build is idempotent.
 */
export function buildWishlistDrafts(
  items: BooklistItemLike[],
  slot: ChildSlotRef,
  alreadyLinkedItemIds: Iterable<number> = []
): WishlistDraft[] {
  const linked = new Set<number>(alreadyLinkedItemIds);
  return eligibleBooklistItems(items)
    .filter((i) => !linked.has(i.id))
    .map((i) => ({
      title: i.title,
      subject: i.subject ?? null,
      publisher: i.publisher ?? null,
      isbn: i.isbn ?? null,
      grade: slot.grade,
      curriculum: slot.curriculum ?? null,
      booklistItemId: i.id,
      notes: null,
    }));
}

export type MatchTier = "same_school" | "same_grade_cluster";

/** Canonical stored form: trimmed, single spaces, each word capitalised ("grade  5" -> "Grade 5"). */
export function canonicalGrade(g: string | null | undefined): string {
  return (g ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

/** Comparison form. Used on write and on read so both sides agree. */
export function normalizeGrade(g: string | null | undefined): string {
  return canonicalGrade(g).toLowerCase();
}

/** Dedupe key for a booklist item: ISBN when present, else the title with punctuation and case removed. */
export function booklistItemKey(item: { isbn?: string | null; title: string }): string {
  const isbn = normalizeIsbn(item.isbn);
  if (isbn) return `isbn:${isbn}`;
  return `title:${item.title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
}

/** Drop items whose key was already seen (in `existingKeys` or earlier in the list). First one wins. */
export function dedupeBooklistItems<T extends { isbn?: string | null; title: string }>(
  items: T[],
  existingKeys: Iterable<string> = []
): T[] {
  const seen = new Set<string>(existingKeys);
  const out: T[] = [];
  for (const item of items) {
    const key = booklistItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function normalizeIsbn(isbn: string | null | undefined): string {
  return (isbn ?? "").replace(/[\s-]/g, "").toUpperCase();
}

function titleTokens(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0); // keep single-character tokens: grade digits matter
}

/** Dice coefficient on title tokens, 0..1. */
export function titleSimilarity(a: string, b: string): number {
  const ta = new Set(titleTokens(a));
  const tb = new Set(titleTokens(b));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  ta.forEach((t) => {
    if (tb.has(t)) shared += 1;
  });
  return (2 * shared) / (ta.size + tb.size);
}

export interface ListingLike {
  id: number;
  title: string;
  isbn?: string | null;
  classGrade?: string | null;
  schoolId?: string | null;
  writtenIn?: boolean | null;
  sellerId?: string | null;
}

/**
 * Score a listing against a wishlist draft or item, 0..100. ISBN equality is a full match.
 * Used for the booklist page. New-listing notifications keep using the existing
 * wishlist scorer in bookListing.service.
 */
export function scoreListingForItem(
  listing: ListingLike,
  item: { title: string; isbn?: string | null }
): number {
  const li = normalizeIsbn(listing.isbn);
  const ii = normalizeIsbn(item.isbn);
  if (li && ii && li === ii) return 100;
  return Math.round(titleSimilarity(listing.title, item.title) * 100);
}

export const MATCH_SCORE_THRESHOLD = 60;

/**
 * Tier a listing for a child slot. The grade MUST match for both tiers (a Grade 6 book is
 * never a match for a Grade 5 slot); the school only decides the ranking:
 * - same_school: same grade, handed over at the slot's school
 * - same_grade_cluster: same grade, elsewhere in the cluster
 * - null: not a match
 */
export function tierForListing(
  listing: Pick<ListingLike, "schoolId" | "classGrade">,
  slot: Pick<ChildSlotRef, "schoolId" | "grade">
): MatchTier | null {
  const slotGrade = normalizeGrade(slot.grade);
  if (!slotGrade || normalizeGrade(listing.classGrade) !== slotGrade) return null;
  if (slot.schoolId && listing.schoolId && listing.schoolId === slot.schoolId) {
    return "same_school";
  }
  return "same_grade_cluster";
}

export interface RankedMatch<L extends ListingLike> {
  listing: L;
  score: number;
  tier: MatchTier;
}

const TIER_RANK: Record<MatchTier, number> = {
  same_school: 0,
  same_grade_cluster: 1,
};

/**
 * Match listings to one booklist item and order them: same school first, then the same
 * grade elsewhere; within a tier by score (desc), then newest listing first.
 * Written-in books and the buyer's own listings are never returned.
 */
export function rankMatchesForItem<L extends ListingLike>(
  listings: L[],
  item: { title: string; isbn?: string | null },
  slot: Pick<ChildSlotRef, "schoolId" | "grade">,
  opts: { excludeSellerId?: string; threshold?: number } = {}
): RankedMatch<L>[] {
  const threshold = opts.threshold ?? MATCH_SCORE_THRESHOLD;
  const out: RankedMatch<L>[] = [];
  for (const listing of listings) {
    if (listing.writtenIn === true) continue;
    if (opts.excludeSellerId && listing.sellerId === opts.excludeSellerId) continue;
    const score = scoreListingForItem(listing, item);
    if (score < threshold) continue;
    const tier = tierForListing(listing, slot);
    if (!tier) continue;
    out.push({ listing, score, tier });
  }
  return out.sort(
    (a, b) =>
      TIER_RANK[a.tier] - TIER_RANK[b.tier] ||
      b.score - a.score ||
      b.listing.id - a.listing.id
  );
}

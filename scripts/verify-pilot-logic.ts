/**
 * Focused checks for the pure pilot logic (adr-016).
 *
 * No test runner is installed in this repo and adding one needs a dependency security
 * review first, so these checks use node:assert and run with tsx:
 *
 *   npm run test:pilot        (or: npx tsx scripts/verify-pilot-logic.ts)
 *
 * No database, network or secrets are needed. Exits non-zero on the first failure.
 */
import assert from "node:assert/strict";
import { parsePilotMode } from "../server/config/pilot";
import {
  calculatePurchaseOrderFees,
  calculateSwapOrderFees,
} from "../server/utils/paystackFees";
import { calculateWithdrawalFee, calculateWithdrawalBreakdown } from "../server/utils/withdrawalFees";
import {
  buildWishlistDrafts,
  eligibleBooklistItems,
  rankMatchesForItem,
  tierForListing,
  titleSimilarity,
  canonicalGrade,
  dedupeBooklistItems,
} from "../server/pilot/matching";
import { isRealDate, isTodayOrFuture } from "../server/pilot/dates";
import { checkListingForPilot, suggestedUsedPrice } from "../server/pilot/listingRules";
import { consentRequirementError, hasCurrentConsent, hasValidConsent } from "../server/pilot/consent";
import { childSlotLabel, toChildSlot } from "../server/pilot/childSlot";
import {
  MAX_ACTIVE_RESERVATIONS_PER_BUYER,
  checkReservable,
  firstName,
  reservationNotificationText,
  reservationRole,
} from "../server/pilot/reservations";
import { buildWhatsAppShareUrl } from "../client/src/lib/whatsapp";
import {
  OTP_MAX_ATTEMPTS,
  SlidingWindowLimiter,
  checkOtpSendAllowed,
  generateOtpCode,
  otpCodesMatch,
  shouldExposeDevOtp,
} from "../server/lib/otpPolicy";
import { isAdminUser } from "../server/lib/roles";

let passed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}`);
    throw err;
  }
}

function withPilot<T>(value: string | undefined, fn: () => T): T {
  const previous = process.env.PILOT_MODE;
  if (value === undefined) delete process.env.PILOT_MODE;
  else process.env.PILOT_MODE = value;
  try {
    return fn();
  } finally {
    if (previous === undefined) delete process.env.PILOT_MODE;
    else process.env.PILOT_MODE = previous;
  }
}

console.log("Pilot flag");
test("PILOT_MODE defaults to true when unset or empty", () => {
  assert.equal(parsePilotMode(undefined), true);
  assert.equal(parsePilotMode(""), true);
  assert.equal(parsePilotMode("true"), true);
  assert.equal(parsePilotMode("anything"), true);
});
test("PILOT_MODE turns off only on an explicit false value", () => {
  for (const v of ["false", "FALSE", "0", "off", "no", " false "]) {
    assert.equal(parsePilotMode(v), false, v);
  }
});

console.log("Fees in pilot mode");
test("purchase fees are 0 (no 5% service fee, no Paystack fee) in pilot mode", () => {
  const fees = withPilot("true", () => calculatePurchaseOrderFees(500));
  assert.equal(fees.serviceFee, 0);
  assert.equal(fees.paystackFee, 0);
  assert.equal(fees.subtotal, 500);
  assert.equal(fees.totalAmount, 500);
});
test("purchase fees are 0 when PILOT_MODE is unset (default on)", () => {
  const fees = withPilot(undefined, () => calculatePurchaseOrderFees(500));
  assert.equal(fees.serviceFee, 0);
  assert.equal(fees.totalAmount, 500);
});
test("swap fee (KES 50 per party) is 0 in pilot mode", () => {
  const fees = withPilot("true", () => calculateSwapOrderFees(50));
  assert.equal(fees.exchangeFee, 0);
  assert.equal(fees.paystackFee, 0);
  assert.equal(fees.totalPerParty, 0);
});
test("withdrawal fee is 0 in pilot mode", () => {
  withPilot("true", () => {
    assert.equal(calculateWithdrawalFee(1000, "mpesa"), 0);
    assert.equal(calculateWithdrawalFee(30000, "bank"), 0);
    assert.equal(calculateWithdrawalBreakdown(1000, "mpesa").amountToReceive, 1000);
  });
});
test("fees are unchanged when PILOT_MODE=false (reversible)", () => {
  withPilot("false", () => {
    const fees = calculatePurchaseOrderFees(500);
    assert.equal(fees.serviceFee, 25);
    assert.ok(fees.paystackFee > 0);
    assert.equal(calculateSwapOrderFees(50).exchangeFee, 50);
    assert.equal(calculateWithdrawalFee(1000, "mpesa"), 20);
  });
});

console.log("Booklist to wishlist");
const items = [
  { id: 1, title: "Mathematics Activities Grade 5", subject: "Mathematics", publisher: "KLB", isbn: "9789966100016", kicdApproved: true, reusable: true, listPriceKes: 450 },
  { id: 2, title: "English Workbook Grade 5", subject: "English", publisher: "Oxford", isbn: null, kicdApproved: true, reusable: false },
  { id: 3, title: "Unapproved Science Guide", subject: "Science", publisher: "X", isbn: null, kicdApproved: false, reusable: true },
  { id: 4, title: "Kiswahili Grade 5", subject: "Kiswahili", publisher: "Longhorn", isbn: null, kicdApproved: true, reusable: true, listPriceKes: "380.00" },
];
const slot = { grade: "Grade 5", schoolId: "school-a", curriculum: "CBC" };
test("only reusable, KICD-approved items are eligible", () => {
  assert.deepEqual(eligibleBooklistItems(items).map((i) => i.id), [1, 4]);
});
test("wishlist drafts carry grade, curriculum and the booklist item link", () => {
  const drafts = buildWishlistDrafts(items, slot);
  assert.equal(drafts.length, 2);
  assert.equal(drafts[0].grade, "Grade 5");
  assert.equal(drafts[0].curriculum, "CBC");
  assert.equal(drafts[0].booklistItemId, 1);
  assert.equal(drafts[0].isbn, "9789966100016");
});
test("wishlist build is idempotent (already linked items are skipped)", () => {
  const drafts = buildWishlistDrafts(items, slot, [1]);
  assert.deepEqual(drafts.map((d) => d.booklistItemId), [4]);
  assert.equal(buildWishlistDrafts(items, slot, [1, 4]).length, 0);
});

console.log("Matching order");
const listings = [
  { id: 10, title: "Mathematics Activities Grade 5 Teacher Edition", isbn: null, classGrade: "Grade 5", schoolId: "school-b", sellerId: "s1", writtenIn: false },
  { id: 11, title: "Mathematics Activities Grade 5", isbn: null, classGrade: "Grade 5", schoolId: "school-a", sellerId: "s2", writtenIn: false },
  { id: 12, title: "Mathematics Activities Grade 5 (KLB)", isbn: "978-9966-10-0016", classGrade: "Grade 5", schoolId: "school-c", sellerId: "s3", writtenIn: false },
  { id: 13, title: "Mathematics Activities Grade 5", isbn: null, classGrade: "Grade 5", schoolId: "school-a", sellerId: "s4", writtenIn: true },
  { id: 14, title: "Cooking for Beginners", isbn: null, classGrade: "Grade 5", schoolId: "school-a", sellerId: "s5", writtenIn: false },
  { id: 15, title: "Mathematics Activities Grade 5", isbn: null, classGrade: "Grade 8", schoolId: "school-z", sellerId: "s6", writtenIn: false },
  { id: 16, title: "Mathematics Activities Grade 5", isbn: null, classGrade: "Grade 5", schoolId: "school-a", sellerId: "me", writtenIn: false },
  { id: 17, title: "Mathematics Activities Grade 6", isbn: null, classGrade: "Grade 6", schoolId: "school-a", sellerId: "s7", writtenIn: false },
  { id: 18, title: "Mathematics Activities Grade 5", isbn: null, classGrade: "Grade 6", schoolId: "school-a", sellerId: "s8", writtenIn: false },
  { id: 19, title: "Mathematics Activities Grade 5", isbn: null, classGrade: null, schoolId: "school-a", sellerId: "s9", writtenIn: false },
];
const slotRef = { schoolId: "school-a", grade: "Grade 5" };
test("same-school listing ranks before same-grade-elsewhere listings", () => {
  const ranked = rankMatchesForItem(listings, items[0], slotRef, { excludeSellerId: "me" });
  assert.deepEqual(ranked.map((r) => [r.listing.id, r.tier]), [
    [11, "same_school"],
    [12, "same_grade_cluster"],
    [10, "same_grade_cluster"],
  ]);
});
test("an ISBN match outranks a partial title match inside the same tier", () => {
  const ranked = rankMatchesForItem(listings, items[0], slotRef, { excludeSellerId: "me" });
  assert.equal(ranked[1].listing.id, 12);
  assert.equal(ranked[1].score, 100);
});
test("written-in, own, unrelated and other-grade-elsewhere listings are excluded", () => {
  const ids = rankMatchesForItem(listings, items[0], slotRef, { excludeSellerId: "me" }).map((r) => r.listing.id);
  for (const excluded of [13, 14, 15, 16, 17, 18, 19]) assert.ok(!ids.includes(excluded), `listing ${excluded}`);
});
test("tierForListing handles grade spelling and missing school", () => {
  assert.equal(tierForListing({ schoolId: null, classGrade: " grade  5 " }, { schoolId: "x", grade: "Grade 5" }), "same_grade_cluster");
  assert.equal(tierForListing({ schoolId: null, classGrade: null }, { schoolId: "x", grade: "Grade 5" }), null);
  assert.equal(tierForListing({ schoolId: "x", classGrade: "GRADE 5" }, { schoolId: "x", grade: "Grade 5" }), "same_school");
});
test("wrong grade is never a match, even at the same school (regression)", () => {
  assert.equal(tierForListing({ schoolId: "x", classGrade: "Grade 6" }, { schoolId: "x", grade: "Grade 5" }), null);
  assert.equal(tierForListing({ schoolId: "y", classGrade: "Grade 6" }, { schoolId: "x", grade: "Grade 5" }), null);
  assert.equal(tierForListing({ schoolId: "x", classGrade: null }, { schoolId: "x", grade: "Grade 5" }), null);
});
test("grade digits are kept in title tokens: Grade 5 vs Grade 6 titles differ", () => {
  assert.ok(titleSimilarity("Mathematics Grade 5", "Mathematics Grade 6") < 1);
  assert.equal(titleSimilarity("Mathematics Grade 5", "Mathematics Grade 5"), 1);
  assert.equal(canonicalGrade(" grade   5 "), "Grade 5");
});

console.log("Listing rules");
test("written_in = true is rejected in pilot mode with a reason", () => {
  const result = checkListingForPilot({ writtenIn: true }, true);
  assert.equal(result.ok, false);
  assert.equal(result.code, "WRITTEN_IN_BLOCKED");
  assert.match(result.message ?? "", /written-in/i);
});
test("written_in = false, or unset, is accepted in pilot mode", () => {
  assert.equal(checkListingForPilot({ writtenIn: false }, true).ok, true);
  assert.equal(checkListingForPilot({}, true).ok, true);
});
test("written_in does not block outside pilot mode", () => {
  assert.equal(checkListingForPilot({ writtenIn: true }, false).ok, true);
});
test("suggested used price is 40 to 60% of list price, none without a list price", () => {
  assert.deepEqual(suggestedUsedPrice(1000), { min: 400, max: 600 });
  assert.deepEqual(suggestedUsedPrice("450.00"), { min: 180, max: 270 });
  assert.equal(suggestedUsedPrice(null), null);
  assert.equal(suggestedUsedPrice(0), null);
  assert.equal(suggestedUsedPrice(undefined), null);
});

console.log("Consent and child slots");
test("consent is valid only when given and not withdrawn afterwards", () => {
  assert.equal(hasValidConsent({}), false);
  assert.equal(hasValidConsent({ consentGivenAt: "2026-11-24T08:00:00Z" }), true);
  assert.equal(
    hasValidConsent({ consentGivenAt: "2026-11-24T08:00:00Z", consentWithdrawnAt: "2026-11-25T08:00:00Z" }),
    false
  );
  assert.equal(
    hasValidConsent({ consentGivenAt: "2026-11-26T08:00:00Z", consentWithdrawnAt: "2026-11-25T08:00:00Z" }),
    true
  );
});
test("completing onboarding needs ticked consent unless valid consent exists", () => {
  assert.ok(consentRequirementError({ markAsComplete: true, existing: {} }));
  assert.ok(consentRequirementError({ markAsComplete: true, consentAccepted: false, existing: {} }));
  assert.equal(consentRequirementError({ markAsComplete: true, consentAccepted: true, existing: {} }), null);
  assert.equal(consentRequirementError({ markAsComplete: false, existing: {} }), null);
  assert.equal(
    consentRequirementError({ markAsComplete: true, existing: { consentGivenAt: new Date() } }),
    null
  );
});
test("child slot output never carries a name", () => {
  const out = toChildSlot(
    { id: 1, name: "Amani", grade: "Grade 4", schoolName: "Test School", schoolId: "s" },
    0
  );
  assert.equal(out.name, null);
  assert.equal(out.displayName, "Grade 4 slot at Test School");
  assert.ok(!JSON.stringify(out).includes("Amani"));
  assert.equal(childSlotLabel({ grade: null, schoolName: null }), "your child");
});

console.log("WhatsApp share link");
test("share URL is wa.me, url-encoded, with the listing URL and no personal data", () => {
  const url = buildWhatsAppShareUrl({
    title: "Maths & Science",
    listingUrl: "https://example.org/book/42",
    grade: "Grade 5",
  });
  assert.ok(url.startsWith("https://wa.me/?text="));
  assert.ok(!url.includes(" "));
  const text = decodeURIComponent(url.slice("https://wa.me/?text=".length));
  assert.ok(text.includes("https://example.org/book/42"));
  assert.ok(text.includes("Maths & Science"));
});

console.log("Item dedupe, dates, consent version");
test("booklist items dedupe by isbn, else by normalised title", () => {
  const out = dedupeBooklistItems([
    { title: "Maths Grade 5", isbn: "978-1-23456-789-7" },
    { title: "Other title", isbn: "9781234567897" },
    { title: "English  Activities!", isbn: null },
    { title: "english activities", isbn: null },
  ]);
  assert.equal(out.length, 2);
  assert.equal(dedupeBooklistItems([{ title: "English Activities" }], ["title:english activities"]).length, 0);
});
test("collection day dates must be real and not in the past", () => {
  assert.equal(isRealDate("2027-02-31"), false);
  assert.equal(isRealDate("2027-13-01"), false);
  assert.equal(isRealDate("2027-02-28"), true);
  const now = new Date("2026-11-24T10:00:00Z");
  assert.equal(isTodayOrFuture("2026-11-23", now), false);
  assert.equal(isTodayOrFuture("2026-11-24", now), true);
});
test("consent from an older notice version is not current", () => {
  const given = { consentGivenAt: new Date("2026-11-01"), consentWithdrawnAt: null };
  assert.equal(hasCurrentConsent({ ...given, consentVersion: "v1" }, "v2"), false);
  assert.equal(hasCurrentConsent({ ...given, consentVersion: "v2" }, "v2"), true);
  assert.equal(hasCurrentConsent({ consentVersion: "v2" }, "v2"), false);
});
test("written-in message explains reuse", () => {
  const r = checkListingForPilot({ writtenIn: true }, true);
  assert.ok(r.message?.includes("next family cannot reuse"));
});

console.log("Reservations");
test("reserve rules: own, swap, reserved, unavailable, cap", () => {
  const base = { sellerId: "s", listingStatus: "active", listingType: "sell", quantityAvailable: 1 };
  assert.equal(checkReservable({ buyerId: "b", listing: base, activeReservationsForBuyer: 0 }).ok, true);
  assert.equal(checkReservable({ buyerId: "s", listing: base, activeReservationsForBuyer: 0 }).status, 400);
  assert.equal(checkReservable({ buyerId: "b", listing: { ...base, listingType: "swap" }, activeReservationsForBuyer: 0 }).ok, false);
  assert.equal(checkReservable({ buyerId: "b", listing: { ...base, listingStatus: "reserved" }, activeReservationsForBuyer: 0 }).status, 409);
  assert.equal(checkReservable({ buyerId: "b", listing: { ...base, listingStatus: "sold" }, activeReservationsForBuyer: 0 }).status, 409);
  assert.equal(
    checkReservable({ buyerId: "b", listing: base, activeReservationsForBuyer: MAX_ACTIVE_RESERVATIONS_PER_BUYER }).status,
    422
  );
});
test("reservation parties only; others are non-parties", () => {
  const r = { buyerId: "b", sellerId: "s" };
  assert.equal(reservationRole("b", r), "buyer");
  assert.equal(reservationRole("s", r), "seller");
  assert.equal(reservationRole("x", r), null);
});
test("notification text has first name, title and day, never contact details", () => {
  const text = reservationNotificationText({
    bookTitle: "Maths Grade 5",
    buyerName: "Wanjiku Kamau 0712345678 w@x.com",
    collectionDay: { date: "2026-12-12", startTime: "09:00", endTime: "12:00" },
  });
  assert.ok(text.includes("Wanjiku reserved") && text.includes("Maths Grade 5") && text.includes("2026-12-12"));
  assert.ok(!text.includes("Kamau") && !text.includes("0712") && !text.includes("@"));
  assert.equal(firstName(null), "A parent");
});

console.log("Login codes and admin (adr-018)");
test("OTP codes are 6 digits from a secure source", () => {
  const codes = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const c = generateOtpCode();
    assert.match(c, /^\d{6}$/);
    codes.add(c);
  }
  assert.ok(codes.size > 150, "codes should vary");
});
test("send limit: one per minute and five per hour per email", () => {
  const now = new Date("2026-12-01T10:00:00Z");
  assert.deepEqual(checkOtpSendAllowed([], now), { allowed: true });
  const r1 = checkOtpSendAllowed([new Date(now.getTime() - 30_000)], now);
  assert.equal(r1.allowed, false);
  if (!r1.allowed) assert.equal(r1.retryAfterSeconds, 30);
  assert.deepEqual(checkOtpSendAllowed([new Date(now.getTime() - 61_000)], now), { allowed: true });
  const five = [5, 15, 25, 35, 45].map((m) => new Date(now.getTime() - m * 60_000));
  const r2 = checkOtpSendAllowed(five, now);
  assert.equal(r2.allowed, false);
  const old = [61, 70, 80, 90, 100].map((m) => new Date(now.getTime() - m * 60_000));
  assert.deepEqual(checkOtpSendAllowed(old, now), { allowed: true });
});
test("code comparison is exact", () => {
  assert.equal(otpCodesMatch("012345", "012345"), true);
  assert.equal(otpCodesMatch("012345", " 012345 "), true);
  assert.equal(otpCodesMatch("012345", "12345"), false);
  assert.equal(otpCodesMatch("012345", "0123456"), false);
  assert.equal(otpCodesMatch("012345", "012346"), false);
  assert.equal(OTP_MAX_ATTEMPTS, 5);
});
test("dev OTP is exposed only with NODE_ENV=development AND EXPOSE_DEV_OTP=true", () => {
  assert.equal(shouldExposeDevOtp({ NODE_ENV: "development" } as NodeJS.ProcessEnv), false);
  assert.equal(shouldExposeDevOtp({ NODE_ENV: "production", EXPOSE_DEV_OTP: "true" } as NodeJS.ProcessEnv), false);
  assert.equal(shouldExposeDevOtp({ NODE_ENV: "development", EXPOSE_DEV_OTP: "true" } as NodeJS.ProcessEnv), true);
});
test("per-IP limiter blocks over the limit and recovers after the window", () => {
  const l = new SlidingWindowLimiter(3, 1000);
  assert.equal(l.hit("ip", 0), true);
  assert.equal(l.hit("ip", 10), true);
  assert.equal(l.hit("ip", 20), true);
  assert.equal(l.hit("ip", 30), false);
  assert.equal(l.hit("other", 30), true);
  assert.equal(l.hit("ip", 1500), true);
});
test("admin rights come only from the stored role, never the email", () => {
  assert.equal(isAdminUser({ role: "ADMIN" }), true);
  assert.equal(isAdminUser({ role: "PARENT" }), false);
  assert.equal(isAdminUser(null), false);
  assert.equal(isAdminUser({ role: "PARENT", email: "x@kitabu.admin" } as { role: string }), false);
});

console.log(`
${passed} checks passed`);

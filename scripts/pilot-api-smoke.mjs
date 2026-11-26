// Pilot API smoke test. Run against a LOCAL dev server only, started with NODE_ENV=development
// and EXPOSE_DEV_OTP=true (so login codes are returned), on a throwaway database. Restart the
// server before each run: the per-IP login limits are in memory.
// DATABASE_URL must be set for this script too (it grants the test admin with scripts/set-admin-role.ts).
// Usage: node scripts/pilot-api-smoke.mjs <schoolIdA> <schoolNameA> <schoolIdB> <schoolNameB>
import { execFileSync } from "node:child_process";
const BASE = "http://localhost:5000";
const [SA, SAN, SB, SBN] = process.argv.slice(2);
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`); };

async function call(token, method, path, body) {
  const r = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { cookie: `auth_token=${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    redirect: "manual",
  });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch { json = null; }
  return { status: r.status, json, text, headers: r.headers };
}

async function login(email) {
  const s = await call(null, "POST", "/api/auth/send-otp", { email });
  const code = s.json?.code ?? s.json?.devCode ?? s.json?.otp ?? s.json?.message?.match(/Code: (\d{6})/)?.[1];
  if (!code) throw new Error("no dev OTP code in response: " + s.text);
  const v = await call(null, "POST", "/api/auth/verify-otp", { email, code: String(code) });
  const sc = v.headers.get("set-cookie") || "";
  const m = sc.match(/auth_token=([^;]+)/);
  if (!m) throw new Error("no auth cookie: " + v.status + " " + v.text);
  return m[1];
}

const short = (r) => `${r.status} ${(r.text || "").slice(0, 160).replace(/\s+/g, " ")}`;

const run = async () => {
  const stamp = Date.now();
  const admin = await login(`pilot${stamp}@kitabu.admin`);
  const seller = await login(`seller${stamp}@test.local`);
  const buyer = await login(`buyer${stamp}@test.local`);
  const other = await login(`other${stamp}@test.local`);

  // Onboarding
  let r = await call(admin, "POST", "/api/onboarding/complete", { fullName: "Pilot Admin", consentAccepted: true, children: [] });
  check("admin onboarding completes", r.status === 200, short(r));

  // adr-018: an @kitabu.admin email gives no admin rights until granted with the script
  check("@kitabu.admin email is not made ADMIN at onboarding", r.json?.user?.role === "PARENT", `role=${r.json?.user?.role}`);
  r = await call(admin, "POST", "/api/booklists", { schoolId: SA, grade: "Grade 5", year: 2027, items: [] });
  check("ungranted @kitabu.admin account cannot create booklists", r.status === 403, short(r));
  const grant = execFileSync(process.execPath, [
    "node_modules/tsx/dist/cli.mjs", "scripts/set-admin-role.ts", "grant", `pilot${stamp}@kitabu.admin`,
  ], { encoding: "utf8", env: process.env });
  check("set-admin-role script grants ADMIN", /-> ADMIN/.test(grant), grant.trim().split("\n").pop());
  r = await call(other, "POST", "/api/onboarding/complete", { fullName: "No Consent", children: [{ grade: "Grade 5", schoolId: SA, schoolName: SAN }] });
  check("onboarding without consent is refused", r.status >= 400, short(r));
  r = await call(other, "POST", "/api/onboarding/complete", { fullName: "No Consent", markAsComplete: false, children: [{ grade: "Grade 5", schoolId: SA, schoolName: SAN }] });
  const otherKids = await call(other, "GET", "/api/children");
  const otherCount = (otherKids.json?.children ?? otherKids.json?.data ?? otherKids.json ?? []).length ?? 0;
  check("markAsComplete=false without consent stores no child slots", otherCount === 0, `children=${otherCount} onboarding=${r.status}`);
  r = await call(seller, "POST", "/api/onboarding/complete", { fullName: "Seller Parent", phoneNumber: "+2547" + String(stamp).slice(-8), consentAccepted: true, children: [{ grade: "Grade 6", schoolId: SA, schoolName: SAN, name: "Should Be Dropped" }] });
  check("seller onboarding with consent", r.status === 200, short(r));
  r = await call(buyer, "POST", "/api/onboarding/complete", { fullName: "Buyer Parent", phoneNumber: "+2541" + String(stamp).slice(-8), consentAccepted: true, children: [{ grade: "Grade 5", schoolId: SA, schoolName: SAN, name: "Secret Child" }] });
  check("buyer onboarding with consent", r.status === 200, short(r));

  const kids = await call(buyer, "GET", "/api/children");
  const kidList = kids.json?.children ?? kids.json?.data ?? kids.json;
  const child = Array.isArray(kidList) ? kidList[0] : null;
  check("buyer child slot exists", !!child, short(kids));
  check("child name is never returned", !kids.text.includes("Secret Child") && (child?.name ?? null) === null, `name=${child?.name}`);
  const db = await call(buyer, "GET", "/api/onboarding/status");
  check("onboarding status has no child name", !db.text.includes("Secret Child"), short(db));

  // Booklists (admin only)
  const items = [
    { title: "Spotlight Mathematics Grade 5", subject: "Mathematics", publisher: "Spotlight", isbn: "9789966000501", kicdApproved: true, reusable: true, listPriceKes: 750 },
    { title: "Longhorn English Grade 5", subject: "English", publisher: "Longhorn", kicdApproved: true, reusable: true, listPriceKes: 650 },
    { title: "Grade 5 Maths Activity Workbook", subject: "Mathematics", kicdApproved: true, reusable: false, listPriceKes: 400 },
    { title: "Unapproved Revision Guide Grade 5", subject: "Mathematics", kicdApproved: false, reusable: true },
  ];
  r = await call(seller, "POST", "/api/booklists", { schoolId: SA, grade: "Grade 5", year: 2027, items });
  check("non-admin cannot create booklist", r.status === 403, short(r));
  r = await call(admin, "POST", "/api/booklists", { schoolId: SA, grade: "grade 5 ", year: 2027, items });
  check("admin creates booklist", r.status === 200 || r.status === 201, short(r));
  const booklistId = r.json?.booklist?.id ?? r.json?.data?.booklist?.id ?? r.json?.id ?? r.json?.data?.id;
  r = await call(admin, "POST", "/api/booklists", { schoolId: SA, grade: "Grade 5", year: 2027, items });
  check("re-posting same booklist dedupes items", /itemsSkipped/.test(r.text) && (r.text.match(/"itemsSkipped":\s*(\d+)/)?.[1] ?? "0") !== "0", short(r));

  // Collection days
  r = await call(admin, "POST", "/api/collection-days", { schoolId: SA, date: "2020-01-01", startTime: "09:00", endTime: "12:00" });
  check("past collection day rejected", r.status === 400 || r.status === 422, short(r));
  r = await call(admin, "POST", "/api/collection-days", { schoolId: SA, date: "2026-02-30", startTime: "09:00", endTime: "12:00" });
  check("impossible date rejected", r.status === 400 || r.status === 422, short(r));
  r = await call(admin, "POST", "/api/collection-days", { schoolId: SA, date: "2026-12-12", startTime: "09:00", endTime: "12:00", venueNote: "Main gate" });
  check("admin creates collection day 12 Dec", r.status === 200 || r.status === 201, short(r));
  const dayId = r.json?.collectionDay?.id ?? r.json?.data?.id ?? r.json?.id ?? r.json?.data?.collectionDay?.id;
  r = await call(admin, "POST", "/api/collection-days", { schoolId: SB, date: "2026-12-13", startTime: "09:00", endTime: "12:00" });
  const otherSchoolDayId = r.json?.collectionDay?.id ?? r.json?.data?.id ?? r.json?.id ?? r.json?.data?.collectionDay?.id;

  // Listings
  const listing = (over) => ({ title: "Spotlight Mathematics Grade 5", author: "Spotlight Editors", isbn: "9789966000501", publisher: "Spotlight", subject: "Mathematics", classGrade: "Grade 5", curriculum: "CBC", condition: "Good", listingType: "sell", price: 400, schoolId: SB, ...over });
  r = await call(seller, "POST", "/api/books", listing({}));
  check("seller lists grade 5 maths book", r.status === 200 || r.status === 201, short(r));
  const goodListingId = r.json?.listing?.id ?? r.json?.data?.id ?? r.json?.id ?? r.json?.book?.id ?? r.json?.data?.listing?.id;
  const goodSchool = r.json?.listing?.schoolId ?? r.json?.data?.schoolId ?? r.json?.schoolId ?? r.json?.book?.schoolId;
  check("listing school derived from seller slot, not client", goodSchool === SA, `schoolId=${goodSchool}`);
  r = await call(seller, "POST", "/api/books", listing({ title: "Spotlight Mathematics Grade 6", isbn: null, classGrade: "Grade 6" }));
  check("seller lists grade 6 maths book", r.status === 200 || r.status === 201, short(r));
  r = await call(seller, "POST", "/api/books", listing({ writtenIn: true }));
  check("written-in listing blocked with 422", r.status === 422, short(r));

  // Booklist view and build (buyer)
  r = await call(buyer, "POST", `/api/booklists/child/${child?.id}/build`);
  check("buyer builds wishlist from booklist", r.status === 200 || r.status === 201, short(r));
  await Promise.all([call(buyer, "POST", `/api/booklists/child/${child?.id}/build`), call(buyer, "POST", `/api/booklists/child/${child?.id}/build`)]);
  const view = await call(buyer, "GET", `/api/booklists/child/${child?.id}`);
  check("buyer booklist view loads", view.status === 200, short(view));
  const vt = view.text;
  check("view includes reusable KICD items", vt.includes("Spotlight Mathematics Grade 5") && vt.includes("Longhorn English Grade 5"));
  check("view excludes workbook and unapproved items", !vt.includes("Activity Workbook") && !vt.includes("Unapproved Revision"));
  check("grade 5 listing matched", vt.includes(`"id":${goodListingId}`) || vt.includes(`"listingId":${goodListingId}`), `listing ${goodListingId}`);
  check("grade 6 listing NOT matched", !vt.includes("Spotlight Mathematics Grade 6"));
  check("next collection day shown", vt.includes("2026-12-12"));
  const wl = await call(buyer, "GET", "/api/wishlist");
  const spot = (wl.text.match(/Spotlight Mathematics Grade 5/g) || []).length;
  check("no duplicate wishlist rows after concurrent builds", spot === 1, `occurrences=${spot}`);
  r = await call(other, "POST", "/api/consent", { accepted: true }); check("other parent gives consent via API", r.status === 200, short(r));
  r = await call(other, "GET", `/api/booklists/child/${child?.id}`);
  check("another parent cannot read buyer's child view (IDOR)", r.status === 403 || r.status === 404, short(r));

  // Swap with collection day at the wrong school
  r = await call(seller, "POST", "/api/books", listing({ title: "Longhorn English Grade 5", isbn: null, subject: "English", listingType: "swap", price: undefined, willingToSwapFor: "Grade 6 books" }));
  check("seller lists a swap book", r.status === 201, short(r));
  const swapListingId = r.json?.listing?.id;
  r = await call(buyer, "POST", "/api/swaps", { requestedListingId: swapListingId,offeredBookTitle: "Old Grade 4 English", offeredBookCondition: "Good" });
  const swapId = r.json?.swapRequest?.swapRequest?.id ?? r.json?.swapRequest?.id ?? r.json?.data?.id ?? r.json?.id ?? r.json?.data?.swapRequest?.id;
  check("buyer creates swap request", !!swapId, short(r));
  if (swapId) {
    r = await call(seller, "PUT", `/api/swaps/${swapId}/accept`, { collectionDayId: otherSchoolDayId });
    check("accept with other school's collection day rejected", r.status === 422, short(r));
    r = await call(seller, "PUT", `/api/swaps/${swapId}/accept`, { collectionDayId: dayId });
    check("accept with own school's collection day, no fee, no order", r.status === 200 && !/swapOrder"?:\s*\{/.test(r.text), short(r));
  }

  // Money is off
  for (const [m, p] of [["GET", "/api/wallet"], ["POST", "/api/wallet/topup"], ["GET", "/api/escrow"], ["POST", "/api/swap-orders"], ["GET", "/api/cycles"], ["GET", "/api/disputes"], ["GET", "/api/referrals"], ["GET", "/api/conversations"]]) {
    r = await call(buyer, m, p, m === "POST" ? { amount: 100 } : undefined);
    check(`${m} ${p} disabled (410)`, r.status === 410, short(r));
  }
  r = await call(null, "POST", "/api/webhooks/paystack", { event: "charge.success", data: { reference: "x" } });
  check("paystack webhook acknowledged without processing", r.status === 200 || r.status === 404, short(r));
  r = await call(null, "GET", "/api/debug/config");
  check("debug config route removed", r.status === 404 || !(r.json && "paystackConfigured" in r.json), short(r));

  // Reservations (adr-017)
  r = await call(seller, "POST", "/api/books", listing({ title: "Reserve Test Science Grade 5", isbn: null, subject: "Science" }));
  const resListingId = r.json?.listing?.id;
  check("seller lists a book to reserve", !!resListingId, short(r));
  r = await call(seller, "POST", "/api/reservations", { listingId: resListingId });
  check("own listing cannot be reserved", r.status === 400, short(r));
  r = await call(buyer, "POST", "/api/consent", { accepted: true });
  r = await call(buyer, "POST", "/api/reservations", { listingId: resListingId });
  check("buyer reserves the listing", r.status === 201, short(r));
  const reservationId = r.json?.reservation?.id;
  const view2 = await call(null, "GET", `/api/books/${resListingId}`);
  check("listing shows as reserved", view2.json?.listing?.listingStatus === "reserved", short(view2));
  check("listing exposes seller first name only", view2.json?.listing?.sellerFirstName === "Seller" && !view2.text.includes("Seller Parent"), `name=${view2.json?.listing?.sellerFirstName}`);
  const buyer2 = await login(`buyer2${stamp}@test.local`);
  r = await call(buyer2, "POST", "/api/onboarding/complete", { fullName: "Second Buyer", phoneNumber: "+2549" + String(stamp).slice(-8), consentAccepted: true, children: [] });
  check("second buyer onboarding", r.status === 200, short(r));
  r = await call(buyer2, "POST", "/api/reservations", { listingId: resListingId });
  check("second buyer is blocked", r.status === 409, short(r));
  const racers = await Promise.all([call(buyer2, "POST", "/api/reservations", { listingId: resListingId }), call(admin, "POST", "/api/reservations", { listingId: resListingId })]);
  check("concurrent reserve attempts on a taken listing all fail", racers.every((x) => x.status === 409), racers.map((x) => x.status).join(","));
  r = await call(other, "POST", `/api/reservations/${reservationId}/cancel`);
  check("non-party cancel returns 404", r.status === 404, short(r));
  r = await call(other, "POST", `/api/reservations/${reservationId}/confirm`);
  check("non-party confirm returns 404", r.status === 404, short(r));
  const sellerNotes = await call(seller, "GET", "/api/notifications");
  const noteText = sellerNotes.text;
  check("seller notified with title, buyer first name and day", noteText.includes("Reserve Test Science Grade 5") && noteText.includes("Buyer reserved") && noteText.includes("2026-12-12"), noteText.slice(0, 200));
  check("notification has no phone, email or surname", !/\+254|@test\.local|Parent reserved/.test(noteText.replace(/"email":"[^"]*"/g, "")), "");
  r = await call(buyer, "GET", "/api/reservations?role=buyer");
  check("buyer sees reservation with first name only", r.status === 200 && r.text.includes("Seller") && !r.text.includes("Seller Parent") && !r.text.includes("+254"), short(r));
  r = await call(seller, "GET", "/api/reservations?role=seller");
  check("seller sees reservation", r.status === 200 && r.text.includes("Reserve Test Science Grade 5") && !r.text.includes("Buyer Parent"), short(r));
  r = await call(buyer, "POST", `/api/reservations/${reservationId}/cancel`);
  check("buyer cancels reservation", r.status === 200, short(r));
  const view3 = await call(null, "GET", `/api/books/${resListingId}`);
  check("cancel frees the listing", view3.json?.listing?.listingStatus === "active", short(view3));
  r = await call(buyer, "POST", "/api/reservations", { listingId: resListingId });
  const reservation2 = r.json?.reservation?.id;
  check("listing can be reserved again after cancel", r.status === 201, short(r));
  r = await call(buyer, "POST", `/api/reservations/${reservation2}/confirm`);
  check("buyer confirms handover (not done yet)", r.status === 200 && r.json?.status === "reserved", short(r));
  const mid = await call(null, "GET", `/api/books/${resListingId}`);
  check("listing not sold after one confirmation", mid.json?.listing?.listingStatus === "reserved", short(mid));
  r = await call(seller, "POST", `/api/reservations/${reservation2}/confirm`);
  check("seller confirms: reservation completed", r.status === 200 && r.json?.status === "completed", short(r));
  const sold = await call(null, "GET", `/api/books/${resListingId}`);
  check("both confirmed marks listing sold with soldAt", sold.json?.listing?.listingStatus === "sold" && !!sold.json?.listing?.soldAt, short(sold));
  r = await call(buyer, "POST", "/api/reservations", { listingId: resListingId });
  check("sold listing cannot be reserved", r.status === 409, short(r));
  // true race: two onboarded buyers reserve one fresh listing at the same time
  r = await call(seller, "POST", "/api/books", listing({ title: "Race Test English Grade 5", isbn: null, subject: "English" }));
  const raceId = r.json?.listing?.id;
  const race = await Promise.all([call(buyer, "POST", "/api/reservations", { listingId: raceId }), call(buyer2, "POST", "/api/reservations", { listingId: raceId })]);
  check("race: exactly one of two simultaneous reservations wins", race.map((x) => x.status).sort().join(",") === "201,409", race.map((x) => x.status).join(","));
  // swap listing cannot be reserved
  r = await call(buyer, "POST", "/api/reservations", { listingId: swapListingId });
  check("swap listing cannot be reserved", r.status === 400, short(r));

  // Duplicate phone on onboarding
  const dupPhone = "+2547" + String(stamp).slice(-8);
  const dupUser = await login(`dup${stamp}@test.local`);
  r = await call(dupUser, "POST", "/api/onboarding/complete", { fullName: "Dup Phone", phoneNumber: dupPhone, consentAccepted: true, children: [] });
  check("duplicate phone onboarding returns 409 with message", r.status === 409 && r.text.includes("already registered to another account"), short(r));

  // Consent withdraw
  r = await call(buyer, "POST", "/api/consent/withdraw");
  check("buyer withdraws consent", r.status === 200, short(r));
  const after = await call(buyer, "GET", "/api/children");
  const afterList = after.json?.children ?? after.json?.data ?? after.json ?? [];
  check("child slots deleted after withdraw", Array.isArray(afterList) && afterList.length === 0, short(after));
  r = await call(buyer, "POST", "/api/children", { grade: "Grade 5", schoolId: SA, schoolName: SAN });
  check("child write blocked after withdraw (CONSENT_REQUIRED)", r.status === 403 && r.text.includes("CONSENT_REQUIRED"), short(r));
  r = await call(buyer, "POST", "/api/wishlist", { title: "Anything", grade: "Grade 5" });
  check("wishlist write blocked after withdraw", r.status === 403, short(r));

  // adr-018: login code protections
  const target = `guess${stamp}@test.local`;
  r = await call(null, "POST", "/api/auth/send-otp", { email: target });
  const realCode = r.json?.message?.match(/Code: (\d{6})/)?.[1];
  check("code sent to new email", r.status === 200 && !!realCode, short(r));
  r = await call(null, "POST", "/api/auth/send-otp", { email: target });
  check("second code within a minute is refused (429)", r.status === 429 && !!r.headers.get("retry-after"), short(r));
  const wrong = realCode === "000000" ? "111111" : "000000";
  const guesses = [];
  for (let i = 0; i < 5; i++) guesses.push((await call(null, "POST", "/api/auth/verify-otp", { email: target, code: wrong })).status);
  check("five wrong codes are rejected", guesses.every((s) => s === 400), guesses.join(","));
  r = await call(null, "POST", "/api/auth/verify-otp", { email: target, code: realCode });
  check("correct code no longer works after five wrong guesses", r.status === 400 && !(r.headers.get("set-cookie") || "").includes("auth_token="), short(r));

  const target2 = `reuse${stamp}@test.local`;
  r = await call(null, "POST", "/api/auth/send-otp", { email: target2 });
  const code2 = r.json?.message?.match(/Code: (\d{6})/)?.[1];
  r = await call(null, "POST", "/api/auth/verify-otp", { email: target2, code: code2 });
  check("correct code logs in", r.status === 200, short(r));
  r = await call(null, "POST", "/api/auth/verify-otp", { email: target2, code: code2 });
  check("a used code cannot be used again", r.status === 400, short(r));

  // Burst: parallel code requests for one email must not all pass the send limit
  const burstEmail = `burst${stamp}@test.local`;
  const burst = await Promise.all(Array.from({ length: 5 }, () => call(null, "POST", "/api/auth/send-otp", { email: burstEmail })));
  const burstOk = burst.filter((x) => x.status === 200).length;
  const burst429 = burst.filter((x) => x.status === 429).length;
  check("parallel burst: exactly one code sent, the rest 429", burstOk === 1 && burst429 === 4, burst.map((x) => x.status).join(","));

  // Lockout: 10 wrong guesses across codes in the last hour block even a correct new code.
  // Seeds the earlier failures directly in the local smoke DB (docker container kitabu-smoke-mysql).
  const lockEmail = `lock${stamp}@test.local`;
  execFileSync("docker", ["exec", "kitabu-smoke-mysql", "mysql", "-uroot", "-psmoke", "kitabu_smoke", "-e",
    `INSERT INTO otp_codes (id, email, code, created_at, verified, attempts, expires_at) VALUES (UUID(), '${lockEmail}', '999999', NOW() - INTERVAL 2 MINUTE, 0, 10, NOW())`],
    { stdio: "ignore" });
  r = await call(null, "POST", "/api/auth/send-otp", { email: lockEmail });
  const lockCode = r.json?.message?.match(/Code: (\d{6})/)?.[1];
  r = await call(null, "POST", "/api/auth/verify-otp", { email: lockEmail, code: lockCode });
  check("10 wrong guesses in the hour lock the email, even with the right code", r.status === 400 && /try again in an hour/.test(r.text), short(r));

  r = await call(seller, "PUT", "/api/profile", { email: `taken${stamp}@test.local` });
  check("email change through profile is refused", r.status === 400 && /cannot be changed/.test(r.text), short(r));
  r = await call(seller, "PUT", "/api/profile", { fullName: "Seller Renamed" });
  check("profile name change still works", r.status === 200, short(r));
  r = await call(null, "GET", "/api/debug/config");
  check("no debug config JSON", !(r.json && typeof r.json === "object" && "nodeEnv" in r.json), short(r));

  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
};
run().catch((e) => { console.error("SMOKE ABORTED:", e.message); process.exit(1); });

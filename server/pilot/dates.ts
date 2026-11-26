/**
 * Date helpers for the pilot. Pure functions, no database.
 */

/** Today as YYYY-MM-DD in East Africa Time (UTC+3). */
export function todayEat(now: Date = new Date()): string {
  const eat = new Date(now.getTime() + 3 * 60 * 60 * 1000);
  return eat.toISOString().slice(0, 10);
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2027-02-31 and 2027-13-01). */
export function isRealDate(ymd: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** True when the date is today (EAT) or later. */
export function isTodayOrFuture(ymd: string, now: Date = new Date()): boolean {
  return ymd >= todayEat(now);
}

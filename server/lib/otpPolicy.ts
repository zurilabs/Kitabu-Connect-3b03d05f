/**
 * Login code (OTP) rules (adr-018). Pure functions so they can be checked without a database.
 */
import { randomInt, timingSafeEqual } from "crypto";

export const OTP_TTL_MS = 10 * 60 * 1000; // a code lives 10 minutes
export const OTP_MAX_ATTEMPTS = 5; // wrong guesses before the code is burned
export const OTP_MIN_GAP_MS = 60 * 1000; // at most one send per email per minute
export const OTP_MAX_SENDS_PER_HOUR = 5; // per email
export const OTP_MAX_SENDS_PER_IP_PER_HOUR = 20; // per client IP, all emails together

/** 6-digit code from a cryptographically secure source. */
export function generateOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/**
 * Whether another code may be sent to this email, given the creation times of codes
 * sent to it in the last hour. Returns the seconds to wait when it may not.
 */
export function checkOtpSendAllowed(
  recentSends: Date[],
  now: Date = new Date()
): { allowed: true } | { allowed: false; retryAfterSeconds: number; reason: string } {
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const inLastHour = recentSends.map((d) => d.getTime()).filter((t) => t > hourAgo).sort((a, b) => b - a);

  if (inLastHour.length > 0 && now.getTime() - inLastHour[0] < OTP_MIN_GAP_MS) {
    const wait = Math.ceil((OTP_MIN_GAP_MS - (now.getTime() - inLastHour[0])) / 1000);
    return { allowed: false, retryAfterSeconds: wait, reason: `Please wait ${wait} seconds before asking for another code.` };
  }
  if (inLastHour.length >= OTP_MAX_SENDS_PER_HOUR) {
    const oldest = inLastHour[inLastHour.length - 1];
    const wait = Math.ceil((oldest + 60 * 60 * 1000 - now.getTime()) / 1000);
    return { allowed: false, retryAfterSeconds: wait, reason: "Too many codes requested for this email. Please try again later." };
  }
  return { allowed: true };
}

/** Constant-time comparison of two 6-digit codes. */
export function otpCodesMatch(expected: string, given: string): boolean {
  const a = Buffer.from(expected.padEnd(6, " "));
  const b = Buffer.from(String(given).trim().padEnd(6, " ").slice(0, 6));
  return a.length === b.length && timingSafeEqual(a, b) && String(given).trim().length === expected.length;
}

/**
 * The code is returned in the API response only on a local developer machine that has
 * opted in explicitly. NODE_ENV=development alone is not enough.
 */
export function shouldExposeDevOtp(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "development" && env.EXPOSE_DEV_OTP === "true";
}

/** Simple in-memory sliding-window counter per key (single server instance). */
export class SlidingWindowLimiter {
  private hits = new Map<string, number[]>();
  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Records a hit and returns false when the key is over the limit. */
  hit(key: string, now: number = Date.now()): boolean {
    const from = now - this.windowMs;
    const kept = (this.hits.get(key) ?? []).filter((t) => t > from);
    if (kept.length >= this.limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > 10_000) this.prune(now);
    return true;
  }

  private prune(now: number) {
    const from = now - this.windowMs;
    Array.from(this.hits.keys()).forEach((k) => {
      const kept = (this.hits.get(k) ?? []).filter((t: number) => t > from);
      if (kept.length) this.hits.set(k, kept);
      else this.hits.delete(k);
    });
  }
}

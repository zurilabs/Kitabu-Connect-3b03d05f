import { db } from "../db";
import { users, otpCodes, type User } from "server/db/schema";
import { eq, and, gt, lt, or, desc, sql } from "drizzle-orm";
import { generateToken } from "../lib/jwt";
import { sendOTPEmail } from "../lib/email";
import {
  KeyedMutex,
  OTP_MAX_ATTEMPTS,
  OTP_MAX_FAILED_PER_EMAIL_PER_HOUR,
  OTP_TTL_MS,
  checkOtpSendAllowed,
  generateOtpCode,
  otpCodesMatch,
  shouldExposeDevOtp,
} from "../lib/otpPolicy";

const otpSendLock = new KeyedMutex();

export class AuthService {
  /**
   * Send OTP verification code to user's email
   */
  async sendOTP(
    email: string
  ): Promise<{ success: boolean; message: string; rateLimited?: boolean; retryAfterSeconds?: number; internalError?: boolean }> {
    try {
      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email)) {
        return {
          success: false,
          message: "Invalid email address",
        };
      }

      // Normalize email (lowercase)
      const normalizedEmail = email.toLowerCase().trim();

      // adr-018: the check-then-insert below runs one request at a time per email, so a burst of
      // parallel requests cannot all pass the send limit and create several live codes.
      const issued = await otpSendLock.run(normalizedEmail, async () => {
        // Per-email send limit (1 per minute, 5 per hour). Times are compared on the database
        // clock so a different app/DB timezone cannot skew the windows.
        const [nowRows] = (await db.execute(sql`SELECT NOW() AS dbNow`)) as unknown as [Array<{ dbNow: Date }>];
        const dbNow = nowRows[0]?.dbNow ?? new Date();
        const recent = await db
          .select({ createdAt: otpCodes.createdAt })
          .from(otpCodes)
          .where(and(eq(otpCodes.email, normalizedEmail), sql`${otpCodes.createdAt} > NOW() - INTERVAL 1 HOUR`));
        const sendCheck = checkOtpSendAllowed(recent.map((r) => r.createdAt), new Date(dbNow));
        if (!sendCheck.allowed) return { ok: false as const, sendCheck };

        // Only one live code per email. Expire any earlier unused codes.
        await db
          .update(otpCodes)
          .set({ expiresAt: new Date() })
          .where(and(eq(otpCodes.email, normalizedEmail), eq(otpCodes.verified, false), gt(otpCodes.expiresAt, new Date())));

        const code = generateOtpCode();
        await db.insert(otpCodes).values({
          email: normalizedEmail,
          code,
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
          verified: false,
          attempts: 0,
        });
        return { ok: true as const, code };
      });

      if (!issued.ok) {
        const { sendCheck } = issued;
        return {
          success: false,
          rateLimited: true,
          retryAfterSeconds: sendCheck.allowed ? undefined : sendCheck.retryAfterSeconds,
          message: sendCheck.allowed ? "Please try again." : sendCheck.reason,
        };
      }
      const code = issued.code;

      // Send OTP via email
      const emailResult = await sendOTPEmail(normalizedEmail, code);

      if (!emailResult.success) {
        console.error("[AuthService] Failed to send verification email");
      }

      // adr-018: the code is only echoed back on a developer machine that opted in
      // with EXPOSE_DEV_OTP=true; NODE_ENV=development alone is not enough.
      return {
        success: true,
        message: shouldExposeDevOtp()
          ? `OTP sent to ${normalizedEmail}. Code: ${code} (dev mode)`
          : `Verification code sent to ${normalizedEmail}`,
      };
    } catch (error) {
      console.error("[AuthService] sendOTP error:", error);
      return {
        success: false,
        internalError: true,
        message: "Failed to send verification code. Please try again.",
      };
    }
  }

  /**
   * Verify OTP code and authenticate user
   */
  async verifyOTP(
    email: string,
    code: string
  ): Promise<{ success: boolean; token?: string; user?: User; isNewUser?: boolean; message?: string }> {
    try {
      // Normalize email
      const normalizedEmail = email.toLowerCase().trim();

      const invalid = { success: false as const, message: "Invalid or expired verification code" };

      // adr-018: per-email lockout. Wrong guesses are counted across every unused code sent to
      // this email in the last hour, so requesting new codes does not reset the guess budget.
      const [failed] = await db
        .select({ total: sql<number>`COALESCE(SUM(${otpCodes.attempts}), 0)` })
        .from(otpCodes)
        .where(
          and(
            eq(otpCodes.email, normalizedEmail),
            eq(otpCodes.verified, false),
            sql`${otpCodes.createdAt} > NOW() - INTERVAL 1 HOUR`
          )
        );
      if (Number(failed?.total ?? 0) >= OTP_MAX_FAILED_PER_EMAIL_PER_HOUR) {
        return { success: false, message: "Too many wrong codes for this email. Please try again in an hour." };
      }

      // adr-018: there is at most one live code per email; take the newest one.
      const [otpRecord] = await db
        .select()
        .from(otpCodes)
        .where(
          and(
            eq(otpCodes.email, normalizedEmail),
            eq(otpCodes.verified, false),
            gt(otpCodes.expiresAt, new Date())
          )
        )
        .orderBy(desc(otpCodes.createdAt))
        .limit(1);

      if (!otpRecord) return invalid;

      // Count this attempt first, atomically, so parallel guesses cannot exceed the limit.
      const [attemptResult] = await db
        .update(otpCodes)
        .set({ attempts: sql`${otpCodes.attempts} + 1` })
        .where(and(eq(otpCodes.id, otpRecord.id), lt(otpCodes.attempts, OTP_MAX_ATTEMPTS)));
      if (!attemptResult || (attemptResult as { affectedRows?: number }).affectedRows !== 1) {
        await db.update(otpCodes).set({ expiresAt: new Date() }).where(eq(otpCodes.id, otpRecord.id));
        return { success: false, message: "Too many wrong codes. Please request a new code." };
      }

      if (!otpCodesMatch(otpRecord.code, code)) {
        if (otpRecord.attempts + 1 >= OTP_MAX_ATTEMPTS) {
          await db.update(otpCodes).set({ expiresAt: new Date() }).where(eq(otpCodes.id, otpRecord.id));
          return { success: false, message: "Too many wrong codes. Please request a new code." };
        }
        return invalid;
      }

      // Mark OTP as used; the guard stops the same code being used twice in parallel.
      const [useResult] = await db
        .update(otpCodes)
        .set({ verified: true })
        .where(and(eq(otpCodes.id, otpRecord.id), eq(otpCodes.verified, false)));
      if (!useResult || (useResult as { affectedRows?: number }).affectedRows !== 1) return invalid;

      // Check if user exists (by email)
      let [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);

      let isNewUser = false;

      // Create new user if doesn't exist
      if (!user) {
        isNewUser = true;

        const [newUser] = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            authProvider: "email",
            role: "PARENT", // Default role
            onboardingCompleted: false,
          })
          .$returningId();

        // Fetch the created user
        [user] = await db.select().from(users).where(eq(users.id, newUser.id)).limit(1);
      }

      // Generate JWT token
      const token = await generateToken(user);

      return {
        success: true,
        token,
        user,
        isNewUser,
      };
    } catch (error) {
      console.error("[AuthService] verifyOTP error:", error);
      return {
        success: false,
        message: "Failed to verify code. Please try again.",
      };
    }
  }

  /**
   * Authenticate or create user via Google OAuth
   */
  async authenticateWithGoogle(
    googleId: string,
    email: string,
    fullName?: string,
    profilePictureUrl?: string
  ): Promise<{ success: boolean; token?: string; user?: User; isNewUser?: boolean; message?: string }> {
    try {
      // Normalize email
      const normalizedEmail = email.toLowerCase().trim();

      // Check if user exists (by Google ID or email)
      let [user] = await db
        .select()
        .from(users)
        .where(
          or(
            eq(users.googleId, googleId),
            eq(users.email, normalizedEmail)
          )
        )
        .limit(1);

      let isNewUser = false;

      // adr-018: an account already linked to a different Google account is not taken over.
      if (user && user.googleId && user.googleId !== googleId) {
        return { success: false, message: "This email is linked to a different Google account." };
      }

      if (!user) {
        // Create new user with Google OAuth
        isNewUser = true;

        const [newUser] = await db
          .insert(users)
          .values({
            email: normalizedEmail,
            googleId,
            fullName,
            profilePictureUrl,
            authProvider: "google",
            role: "PARENT",
            onboardingCompleted: false,
          })
          .$returningId();

        [user] = await db.select().from(users).where(eq(users.id, newUser.id)).limit(1);
      } else if (!user.googleId) {
        // Link Google account to existing email user
        await db
          .update(users)
          .set({
            googleId,
            fullName: fullName || user.fullName,
            profilePictureUrl: profilePictureUrl || user.profilePictureUrl,
          })
          .where(eq(users.id, user.id));

        [user] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
      }

      // Generate JWT token
      const token = await generateToken(user);

      return {
        success: true,
        token,
        user,
        isNewUser,
      };
    } catch (error) {
      console.error("[AuthService] authenticateWithGoogle error:", error);
      return {
        success: false,
        message: "Failed to authenticate with Google. Please try again.",
      };
    }
  }

  /**
   * Get user by ID
   */
  async getUserById(userId: string): Promise<User | null> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      return user || null;
    } catch (error) {
      console.error("[AuthService] getUserById error:", error);
      return null;
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<User | null> {
    try {
      const normalizedEmail = email.toLowerCase().trim();
      const [user] = await db.select().from(users).where(eq(users.email, normalizedEmail)).limit(1);
      return user || null;
    } catch (error) {
      console.error("[AuthService] getUserByEmail error:", error);
      return null;
    }
  }

  /**
   * Get user by Google ID
   */
  async getUserByGoogleId(googleId: string): Promise<User | null> {
    try {
      const [user] = await db.select().from(users).where(eq(users.googleId, googleId)).limit(1);
      return user || null;
    } catch (error) {
      console.error("[AuthService] getUserByGoogleId error:", error);
      return null;
    }
  }
}

export const authService = new AuthService();

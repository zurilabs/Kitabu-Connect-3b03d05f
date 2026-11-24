import { db } from "../db";
import { users, children, wishlistItems } from "../db/schema";
import { eq, inArray } from "drizzle-orm";
import { CONSENT_VERSION } from "../config/pilot";
import { hasValidConsent } from "../pilot/consent";

/**
 * Parental consent for processing children's data (ODPC guidance, adr-016).
 * Consent is recorded with a timestamp and notice version and can be withdrawn.
 * Withdrawal also deletes the user's child slots and wishlist links.
 */
export class ConsentService {
  async getStatus(userId: string) {
    const [user] = await db
      .select({
        consentGivenAt: users.consentGivenAt,
        consentVersion: users.consentVersion,
        consentWithdrawnAt: users.consentWithdrawnAt,
      })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    if (!user) return { success: false as const, message: "User not found" };

    return {
      success: true as const,
      consent: {
        valid: hasValidConsent(user),
        givenAt: user.consentGivenAt,
        version: user.consentVersion,
        withdrawnAt: user.consentWithdrawnAt,
        currentVersion: CONSENT_VERSION,
      },
    };
  }

  /** Record (or re-record after withdrawal) consent against the current notice version. */
  async giveConsent(userId: string) {
    await db
      .update(users)
      .set({
        consentGivenAt: new Date(),
        consentVersion: CONSENT_VERSION,
        consentWithdrawnAt: null,
      })
      .where(eq(users.id, userId));
    return this.getStatus(userId);
  }

  /**
   * Withdraw consent and delete this user's child slots and the wishlist items linked
   * to them, in one transaction. Listings, swaps and ratings are not child data and stay.
   */
  async withdrawAndDeleteChildData(userId: string) {
    const deletedChildSlots = await db.transaction(async (tx) => {
      const slots = await tx
        .select({ id: children.id })
        .from(children)
        .where(eq(children.parentId, userId));
      const ids = slots.map((s) => s.id);

      if (ids.length > 0) {
        await tx.delete(wishlistItems).where(inArray(wishlistItems.childId, ids));
        await tx.delete(children).where(inArray(children.id, ids));
      }

      await tx
        .update(users)
        .set({ consentWithdrawnAt: new Date() })
        .where(eq(users.id, userId));

      return ids.length;
    });

    const status = await this.getStatus(userId);
    return { success: true as const, deletedChildSlots, consent: status.success ? status.consent : undefined };
  }
}

export const consentService = new ConsentService();

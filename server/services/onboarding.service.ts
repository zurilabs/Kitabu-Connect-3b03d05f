import { db } from "../db";
import { users, children, type User, type CompleteOnboardingInput } from "server/db/schema";
import { eq } from "drizzle-orm";
import { consentRequirementError, hasCurrentConsent } from "../pilot/consent";
import { CONSENT_VERSION } from "../config/pilot";

export class OnboardingService {
  async completeOnboarding(userId: string, data: CompleteOnboardingInput): Promise<{ success: boolean; user?: User; message?: string; status?: number }> {
    try {
      console.log('[OnboardingService] completeOnboarding called', {
        userId,
        childrenCount: data.children?.length || 0,
      });

      // Get user's current email to check for admin role
      const [currentUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!currentUser) {
        return {
          success: false,
          message: "User not found",
        };
      }

      // Parental consent is required to complete onboarding (adr-016, ODPC children's data guidance)
      const markComplete = data.markAsComplete !== false;
      const consentError = consentRequirementError({
        markAsComplete: markComplete,
        consentAccepted: data.consentAccepted,
        existing: currentUser,
      });
      if (consentError) {
        return { success: false, message: consentError };
      }

      // Child slots are only stored with valid, current consent (given now or already on
      // record), regardless of markAsComplete.
      const consentOk =
        data.consentAccepted === true || hasCurrentConsent(currentUser, CONSENT_VERSION);
      if (data.children && data.children.length > 0 && !consentOk) {
        return {
          success: false,
          message: "Parental consent is required before child details can be saved.",
        };
      }

      // adr-018: the role is never derived from the email address. Keep whatever role the
      // account already has; ADMIN is granted only with scripts/set-admin-role.ts.
      const role = currentUser.role === "ADMIN" ? "ADMIN" : "PARENT";

      // Update user with onboarding data (without school fields)
      const updateData: any = {
        fullName: data.fullName,
        role,
        latitude: data.latitude !== null && data.latitude !== undefined ? data.latitude.toString() : null,
        longitude: data.longitude !== null && data.longitude !== undefined ? data.longitude.toString() : null,
        onboardingCompleted: data.markAsComplete !== false, // Only mark complete if explicitly requested (defaults to true)
        updatedAt: new Date(),
      };

      // Record consent when the checkbox was ticked (version-stamped, withdrawable later)
      if (data.consentAccepted === true) {
        updateData.consentGivenAt = new Date();
        updateData.consentVersion = CONSENT_VERSION;
        updateData.consentWithdrawnAt = null;
      }

      // Only update phoneNumber if provided
      if (data.phoneNumber) {
        updateData.phoneNumber = data.phoneNumber;
      }

      await db
        .update(users)
        .set(updateData)
        .where(eq(users.id, userId));

      console.log('[OnboardingService] User updated successfully');

      // Create child records if provided
      if (data.children && data.children.length > 0) {
        console.log('[OnboardingService] Creating child records:', data.children.length);
        // Get current max displayOrder
        const existingChildren = await db
          .select()
          .from(children)
          .where(eq(children.parentId, userId));

        let maxOrder = existingChildren.reduce(
          (max, child) => Math.max(max, child.displayOrder),
          -1
        );

        for (const child of data.children) {
          maxOrder += 1;
          // Child slot only: grade + school (+ curriculum). No child name (adr-016).
          await db.insert(children).values({
            parentId: userId,
            name: null,
            grade: child.grade,
            schoolId: child.schoolId,
            schoolName: child.schoolName,
            curriculum: child.curriculum || null,
            displayOrder: maxOrder,
          });

          console.log('[OnboardingService] Child inserted successfully');
        }

        console.log(`[OnboardingService] All ${data.children.length} children created successfully`);
      } else {
        console.log('[OnboardingService] No children to create');
      }

      // Fetch updated user
      const [updatedUser] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!updatedUser) {
        return {
          success: false,
          message: "User not found",
        };
      }

      return {
        success: true,
        user: updatedUser,
      };
    } catch (error) {
      // Phone number already used by another account (unique index users_phone_number_unique)
      const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
      const code = e?.code ?? e?.cause?.code;
      const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
      if (code === "ER_DUP_ENTRY" && /phone/i.test(text)) {
        console.warn("[OnboardingService] duplicate phone number on onboarding");
        return {
          success: false,
          status: 409,
          message: "This phone number is already registered to another account.",
        };
      }
      // Do not log the error object for DB errors: it can echo submitted values (phone number).
      console.error("[OnboardingService] completeOnboarding error:", (error as { code?: string })?.code ?? "unknown");
      return {
        success: false,
        message: "Failed to complete onboarding. Please try again.",
      };
    }
  }

  async checkOnboardingStatus(userId: string): Promise<{ completed: boolean; user?: User }> {
    try {
      const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);

      if (!user) {
        return { completed: false };
      }

      return {
        completed: user.onboardingCompleted,
        user,
      };
    } catch (error) {
      console.error("[OnboardingService] checkOnboardingStatus error:", error);
      return { completed: false };
    }
  }
}

export const onboardingService = new OnboardingService();

/**
 * Parental consent rules (adr-016). Pure functions, no database.
 */

export interface ConsentState {
  consentGivenAt?: Date | string | null;
  consentWithdrawnAt?: Date | string | null;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const t = v instanceof Date ? v.getTime() : new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/** Consent is valid if it was given and not withdrawn after it was given. */
export function hasValidConsent(state: ConsentState): boolean {
  const given = toTime(state.consentGivenAt);
  if (given === null) return false;
  const withdrawn = toTime(state.consentWithdrawnAt);
  return withdrawn === null || withdrawn < given;
}

/**
 * Returns an error message when onboarding may not be completed, otherwise null.
 * Consent is needed only when the request marks onboarding complete and the user
 * has no valid consent on record.
 */
export function consentRequirementError(input: {
  markAsComplete: boolean;
  consentAccepted?: boolean;
  existing: ConsentState;
}): string | null {
  if (!input.markAsComplete) return null;
  if (hasValidConsent(input.existing)) return null;
  if (input.consentAccepted === true) return null;
  return "Parental consent is required to join. Please read the notice and tick the consent box.";
}

/** Valid consent recorded against the CURRENT notice version (older versions must be re-given). */
export function hasCurrentConsent(
  state: ConsentState & { consentVersion?: string | null },
  currentVersion: string
): boolean {
  return hasValidConsent(state) && state.consentVersion === currentVersion;
}

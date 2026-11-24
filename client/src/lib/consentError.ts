/** Thrown when the server answers 403 with code CONSENT_REQUIRED (parental consent missing, withdrawn or outdated). */
export class ConsentRequiredError extends Error {
  constructor(message = "Parental consent is required.") {
    super(message);
    this.name = "ConsentRequiredError";
  }
}

export function isConsentRequiredError(err: unknown): err is ConsentRequiredError {
  return err instanceof ConsentRequiredError;
}

/** Throws ConsentRequiredError for a 403 CONSENT_REQUIRED response; otherwise throws Error(fallback). */
export async function throwForFailedResponse(response: Response, fallback: string): Promise<never> {
  const body = await response.json().catch(() => ({}) as { message?: string; code?: string });
  if (response.status === 403 && body.code === "CONSENT_REQUIRED") {
    throw new ConsentRequiredError(body.message);
  }
  throw new Error(body.message || fallback);
}

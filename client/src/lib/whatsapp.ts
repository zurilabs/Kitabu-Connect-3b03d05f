/**
 * WhatsApp share links for class groups (adr-016). Pure, no personal data.
 *
 * Uses the wa.me "share to a chat of your choice" form (no phone number). The text holds
 * only the book title, the grade, and the public listing URL. Never put a name, phone
 * number, or any child detail in the text.
 */

export interface WhatsAppShareInput {
  title: string;
  /** Absolute public URL of the listing page, e.g. https://example.org/book/42 */
  listingUrl: string;
  grade?: string | null;
}

export function buildWhatsAppShareText({ title, listingUrl, grade }: WhatsAppShareInput): string {
  const gradePart = grade && grade.trim() ? ` (${grade.trim()})` : "";
  return `Used book on Kitabu Connect: ${title.trim()}${gradePart}. See it here: ${listingUrl}`;
}

export function buildWhatsAppShareUrl(input: WhatsAppShareInput): string {
  return `https://wa.me/?text=${encodeURIComponent(buildWhatsAppShareText(input))}`;
}

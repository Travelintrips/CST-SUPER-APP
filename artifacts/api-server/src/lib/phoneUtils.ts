/**
 * Normalizes an Indonesian phone number to the 62XXXXXXXXXX format.
 * Handles leading 0, +62, or bare digits.
 * Used by whatsapp.ts, webhooks.ts, portal.ts, and any other module
 * that needs to normalize phone numbers before matching/sending.
 */
export function normalizePhone(raw: string): string {
  let digits = raw.replace(/[^\d]/g, "");
  if (digits.startsWith("62")) {
    // Malformed "620XXXXXXX": country code 62 followed by a leftover leading 0.
    // e.g. "6280818657329" → "62818657329"
    if (digits.startsWith("620")) digits = "62" + digits.slice(3);
    return digits;
  }
  if (digits.startsWith("0")) return "62" + digits.slice(1);
  return "62" + digits;
}

/**
 * Parses a comma-separated list of phone numbers and normalizes each one.
 */
export function normalizePhoneList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(normalizePhone);
}

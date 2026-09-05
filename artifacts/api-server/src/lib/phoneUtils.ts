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
 * Normalizes a Customer Portal contact number without assuming Indonesia.
 *
 * Portal accounts keep the historical digits-only representation (for
 * example, 6281234567890) so existing identity matches remain compatible.
 * International numbers must include a country code via + or 00; local
 * Indonesian 0XXXXXXXXXX input remains supported for legacy accounts.
 */
export function normalizePortalPhone(raw: string): string {
  const input = String(raw ?? "").trim();
  if (!input) return "";

  const hasInternationalPrefix = input.startsWith("+") || input.startsWith("00");
  let digits = input.replace(/[^\d]/g, "");
  if (input.startsWith("00")) digits = digits.slice(2);
  if (!digits) return "";

  if (!hasInternationalPrefix) {
    if (digits.startsWith("620")) digits = "62" + digits.slice(3);
    else if (digits.startsWith("0")) digits = "62" + digits.slice(1);
    else if (!digits.startsWith("62")) return "";
  }

  return digits;
}

export function isValidPortalPhone(phone: string): boolean {
  return /^[1-9]\d{7,14}$/.test(String(phone ?? ""));
}

export function isValidIndonesianPhone(phone: string): boolean {
  return /^62\d{8,13}$/.test(phone);
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

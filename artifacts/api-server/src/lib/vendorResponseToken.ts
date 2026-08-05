import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const s = process.env.PORTAL_ADMIN_KEY ?? process.env.SESSION_SECRET ?? "";
  if (!s) {
    throw new Error(
      "Vendor response token secret not configured. " +
      "Set PORTAL_ADMIN_KEY or SESSION_SECRET environment variable."
    );
  }
  return s;
}

/**
 * Token window size: 7 days.
 * Tokens rotate every 7 days so old links eventually expire.
 * Returns the floor of the current 7-day epoch.
 */
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

function currentWindow(): number {
  return Math.floor(Date.now() / WINDOW_MS);
}

/**
 * Produce a 64-hex-char HMAC token scoped to orderNumber + optional vendorId + time window.
 * Tokens expire after at most 48 hours (window rollover).
 *
 * @param orderNumber  - logistic order number
 * @param vendorId     - optional vendor ID for per-vendor isolation
 * @param window       - override time window (for prev-window verify)
 */
export function signVendorResponseToken(
  orderNumber: string,
  vendorId?: number | null,
  window?: number,
): string {
  const w = window ?? currentWindow();
  const payload = vendorId != null
    ? `${orderNumber}:v${vendorId}:w${w}`
    : `${orderNumber}:w${w}`;
  return createHmac("sha256", getSecret()).update(payload).digest("hex");
}

/**
 * Verify a vendor response token using constant-time comparison.
 * Accepts tokens from current window OR previous window (grace period for
 * tokens generated just before a window rollover).
 */
export function verifyVendorResponseToken(
  orderNumber: string,
  token: string,
  vendorId?: number | null,
): boolean {
  if (!token) return false;
  try {
    const tokenBuf = Buffer.from(token, "hex");
    if (tokenBuf.length !== 32) return false; // 64 hex = 32 bytes

    const w = currentWindow();
    for (const window of [w, w - 1]) {
      const expected = Buffer.from(signVendorResponseToken(orderNumber, vendorId, window), "hex");
      if (expected.length === tokenBuf.length && timingSafeEqual(expected, tokenBuf)) {
        return true;
      }
    }
    return false;
  } catch {
    return false;
  }
}

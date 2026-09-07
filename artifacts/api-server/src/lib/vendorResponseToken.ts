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

export type VendorResponseTokenPurpose =
  | "product_vendor_response"
  | "logistic_vendor_response";

const TOKEN_VERSION = "v2";
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string): string {
  return createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

/**
 * Produce a versioned, purpose-bound HMAC token with an explicit expiry.
 * The random nonce prevents regeneration from reproducing the same credential.
 */
export function signVendorResponseToken(
  orderNumber: string,
  vendorId?: number | null,
  _window?: number,
  purpose: VendorResponseTokenPurpose = "logistic_vendor_response",
): string {
  const issuedAt = Date.now();
  const payload = {
    v: TOKEN_VERSION,
    o: orderNumber,
    p: purpose,
    e: issuedAt + TOKEN_TTL_MS,
    n: Buffer.from(`${issuedAt}:${Math.random()}:${orderNumber}`).toString("base64url"),
    ...(vendorId != null ? { vendorId } : {}),
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  return `${TOKEN_VERSION}.${encodedPayload}.${signPayload(`${TOKEN_VERSION}.${encodedPayload}`)}`;
}

/**
 * Verify token signature, purpose, entity binding, optional vendor binding, and
 * explicit expiry using constant-time comparison.
 */
export function verifyVendorResponseToken(
  orderNumber: string,
  token: string,
  vendorId?: number | null,
  purpose: VendorResponseTokenPurpose = "logistic_vendor_response",
): boolean {
  if (!token) return false;
  try {
    const [version, encodedPayload, signature] = token.split(".");
    if (version !== TOKEN_VERSION || !encodedPayload || !signature) return false;

    const signedInput = `${version}.${encodedPayload}`;
    const expected = Buffer.from(signPayload(signedInput));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;

    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as {
      v?: unknown;
      o?: unknown;
      p?: unknown;
      e?: unknown;
      vendorId?: unknown;
    };
    if (
      payload.v !== TOKEN_VERSION ||
      payload.o !== orderNumber ||
      payload.p !== purpose ||
      typeof payload.e !== "number" ||
      !Number.isSafeInteger(payload.e) ||
      payload.e <= Date.now() ||
      payload.e > Date.now() + TOKEN_TTL_MS
    ) {
      return false;
    }
    if (vendorId != null && Number(payload.vendorId) !== vendorId) return false;
    return true;
  } catch {
    return false;
  }
}

export function hashVendorResponseToken(token: string): string {
  return createHmac("sha256", getSecret()).update(`hash:${token}`).digest("hex");
}

export function vendorResponseTokenTtlMs(): number {
  return TOKEN_TTL_MS;
}

export function constantTimeTokenHashEqual(leftHash: string, rightHash: string): boolean {
  const left = Buffer.from(leftHash, "utf8");
  const right = Buffer.from(rightHash, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

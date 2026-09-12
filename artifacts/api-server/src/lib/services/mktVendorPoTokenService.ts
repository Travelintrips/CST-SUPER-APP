/**
 * mktVendorPoTokenService.ts — Phase 2G: Vendor PO confirmation token
 *
 * Design contract:
 * - Token is opaque: crypto.randomBytes(32).toString("hex") — 64 lowercase hex
 *   chars. It carries no encoded meaning (unlike vendorResponseToken.ts's
 *   time-windowed HMAC signature) — it is looked up by exact match against
 *   mkt_purchase_orders.vendor_token, which is a unique-indexed column.
 * - vendor_token_version increments on every rotate — old token strings
 *   become permanently unmatchable once replaced (no history table needed).
 * - Lookup does an indexed exact-match SELECT, then re-verifies with
 *   timingSafeEqual as defense-in-depth against any future refactor that
 *   might otherwise introduce a non-constant-time comparison path.
 * - Never throws to the caller — all failures resolve to a typed result.
 */

import { randomBytes, timingSafeEqual } from "crypto";
import { db, mktPurchaseOrdersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { logger } from "../logger.js";

const TOKEN_BYTES = 32; // 32 bytes → 64 hex chars
const TOKEN_TTL_DAYS = 14;
const TOKEN_HEX_RE = /^[0-9a-f]{64}$/i;

export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString("hex");
}

export interface RotateTokenResult {
  token: string;
  expiresAt: Date;
  version: number;
}

/**
 * rotateVendorToken — generate a fresh token for a PO and persist it.
 * Called by the lifecycle service when a PO is issued (or re-issued after
 * a revision). Does NOT check/guard PO status — callers are responsible for
 * gating this to the correct lifecycle transition.
 */
export async function rotateVendorToken(poId: number): Promise<RotateTokenResult> {
  const token = generateOpaqueToken();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  const [row] = await db
    .update(mktPurchaseOrdersTable)
    .set({
      vendorToken: token,
      vendorTokenVersion: sql`${mktPurchaseOrdersTable.vendorTokenVersion} + 1`,
      vendorTokenExpiresAt: expiresAt,
      vendorTokenUsedAt: null,
      lastTokenGeneratedAt: new Date(),
    })
    .where(eq(mktPurchaseOrdersTable.id, poId))
    .returning({ vendorTokenVersion: mktPurchaseOrdersTable.vendorTokenVersion });

  return { token, expiresAt, version: row?.vendorTokenVersion ?? 1 };
}

export type TokenLookupFailure = "NOT_FOUND" | "EXPIRED" | "MALFORMED";

export type TokenLookupResult =
  | { ok: true; po: typeof mktPurchaseOrdersTable.$inferSelect }
  | { ok: false; code: TokenLookupFailure };

/**
 * findPoByVendorToken — resolve a PO from its opaque vendor token.
 * Returns NOT_FOUND for both "no such token" and "token exists but does not
 * pass the constant-time re-check" so timing/response shape never leaks
 * which case occurred.
 */
export async function findPoByVendorToken(token: string): Promise<TokenLookupResult> {
  if (!token || !TOKEN_HEX_RE.test(token)) {
    return { ok: false, code: "MALFORMED" };
  }

  try {
    const rows = await db
      .select()
      .from(mktPurchaseOrdersTable)
      .where(eq(mktPurchaseOrdersTable.vendorToken, token))
      .limit(1);

    const po = rows[0];
    if (!po || !po.vendorToken) return { ok: false, code: "NOT_FOUND" };

    // Defense-in-depth constant-time compare — the indexed WHERE above is
    // already an exact match, but this protects against a future refactor
    // (e.g. prefix lookup for sharding) accidentally becoming timing-unsafe.
    const stored = Buffer.from(po.vendorToken, "hex");
    const supplied = Buffer.from(token, "hex");
    if (stored.length !== supplied.length || !timingSafeEqual(stored, supplied)) {
      return { ok: false, code: "NOT_FOUND" };
    }

    if (po.vendorTokenExpiresAt && new Date(po.vendorTokenExpiresAt).getTime() < Date.now()) {
      return { ok: false, code: "EXPIRED" };
    }

    return { ok: true, po };
  } catch (err) {
    logger.warn({ err }, "[mktVendorPoToken] findPoByVendorToken gagal");
    return { ok: false, code: "NOT_FOUND" };
  }
}

/** markVendorTokenUsed — record the first time a vendor takes an action on the token (accept/reject/revision). Non-fatal. */
export async function markVendorTokenUsed(poId: number): Promise<void> {
  await db
    .update(mktPurchaseOrdersTable)
    .set({ vendorTokenUsedAt: new Date() })
    .where(eq(mktPurchaseOrdersTable.id, poId))
    .catch((err: unknown) => {
      logger.warn({ err, poId }, "[mktVendorPoToken] markVendorTokenUsed gagal (non-fatal)");
    });
}

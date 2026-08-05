/**
 * Treasury-specific strict company resolver.
 *
 * Kontrak keamanan:
 *  - Tidak ada actor (unauthenticated) → TreasuryAuthError AUTHENTICATION_REQUIRED (401)
 *  - Actor ada tapi tidak punya company → TreasuryAuthError COMPANY_CONTEXT_REQUIRED (403)
 *  - Cross-company tanpa permission  → TreasuryAuthError COMPANY_ACCESS_DENIED (403)
 *  - TIDAK ada fallback ke company 1
 *  - Header company tidak boleh menjadi satu-satunya otoritas;
 *    hanya session/user diakui.
 */

import type { Request } from "express";

// ── Error codes ───────────────────────────────────────────────────────────────

export const AUTHENTICATION_REQUIRED  = "AUTHENTICATION_REQUIRED"  as const;
export const COMPANY_CONTEXT_REQUIRED = "COMPANY_CONTEXT_REQUIRED" as const;
export const COMPANY_ACCESS_DENIED    = "COMPANY_ACCESS_DENIED"    as const;

export type TreasuryAuthErrorCode =
  | typeof AUTHENTICATION_REQUIRED
  | typeof COMPANY_CONTEXT_REQUIRED
  | typeof COMPANY_ACCESS_DENIED;

// ── Custom error class ────────────────────────────────────────────────────────

export class TreasuryAuthError extends Error {
  readonly code: TreasuryAuthErrorCode;
  readonly httpStatus: 401 | 403;

  constructor(code: TreasuryAuthErrorCode) {
    super(code);
    this.name       = "TreasuryAuthError";
    this.code       = code;
    this.httpStatus = code === AUTHENTICATION_REQUIRED ? 401 : 403;
    // Ensure prototype chain works for instanceof checks
    Object.setPrototypeOf(this, TreasuryAuthError.prototype);
  }
}

// ── Strict resolver ───────────────────────────────────────────────────────────

/**
 * Resolves the company ID for a Treasury request, applying strict auth rules.
 *
 * Throws TreasuryAuthError — never returns a fallback company.
 *
 * Resolution order:
 *  1. No authenticated user → 401
 *  2. Non-admin user with assigned company → return that company (ignore query param)
 *  3. Non-admin user without company → 403
 *  4. Admin with explicit allowlist + ?companyId param outside list → 403
 *  5. Admin with ?companyId param → return that company
 *  6. Admin without ?companyId → use admin's own company; if none → 403
 *
 * Intentionally ignored (not sole authority):
 *  - x-company-id / x-company headers (spoofable)
 *  - req.body.companyId (not reliable for GET requests, potential CSRF vector)
 */
export function resolveCompanyIdStrict(req: Request): number {
  const user = req.user;

  // 1. No authenticated session
  if (!user) {
    throw new TreasuryAuthError(AUTHENTICATION_REQUIRED);
  }

  // 2. Non-admin locked to their own company
  if (user.role !== "admin") {
    if (user.companyId == null) {
      throw new TreasuryAuthError(COMPANY_CONTEXT_REQUIRED);
    }
    return user.companyId;
  }

  // ── Admin path ────────────────────────────────────────────────────────────

  const rawParam = req.query["companyId"] ?? req.query["company"];
  const n = rawParam != null ? parseInt(String(rawParam), 10) : NaN;

  const allowedIds = (user as any)?.allowedCompanyIds as number[] | undefined;

  if (!Number.isNaN(n)) {
    // ?companyId param provided — validate against allowlist if present
    if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(n)) {
      throw new TreasuryAuthError(COMPANY_ACCESS_DENIED);
    }
    return n;
  }

  // No param — fall back to admin's own company
  if (user.companyId != null) {
    return user.companyId;
  }

  // Admin with no company and no param
  if (allowedIds && allowedIds.length > 0) {
    return allowedIds[0]!;
  }

  throw new TreasuryAuthError(COMPANY_CONTEXT_REQUIRED);
}

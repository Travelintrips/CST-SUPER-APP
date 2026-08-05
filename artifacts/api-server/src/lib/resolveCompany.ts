import type { Request } from "express";
import { writeAuditLog } from "./auditLog.js";

// ── Cross-company context switch detection ────────────────────────────────────
// Called once per request (guarded by per-request flag) when an admin/unassigned
// user overrides the company context via ?companyId param.
function logCompanyContextSwitch(
  req: Request,
  sourceCompanyId: number | null,
  targetCompanyId: number
): void {
  const FLAG = "__companyContextSwitchLogged";
  if ((req as any)[FLAG]) return; // already logged for this request
  (req as any)[FLAG] = true;

  const user = req.user as { id?: string; email?: string | null; role?: string | null } | undefined;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.socket?.remoteAddress
    ?? "unknown";

  writeAuditLog({
    companyId: targetCompanyId,
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    action: "COMPANY_CONTEXT_SWITCH",
    module: "administration",
    referenceId: `${sourceCompanyId ?? "none"}→${targetCompanyId}`,
    newData: {
      severity: "HIGH",
      userId: user?.id ?? null,
      role: user?.role ?? null,
      sourceCompany: sourceCompanyId,
      targetCompany: targetCompanyId,
      route: req.originalUrl ?? req.url,
      method: req.method,
      timestamp: new Date().toISOString(),
    },
    ipAddress: ip,
    userAgent: (req.headers["user-agent"] as string) ?? "unknown",
  });
}

/**
 * Resolves the active company ID for the current request.
 *
 * Isolation rules:
 *  - Non-admin authenticated users with an assigned company_id are locked to
 *    that company. The client-supplied ?companyId / ?company param is ignored.
 *  - Admin users and users without an assigned company may override via query
 *    param (e.g. for multi-company admin or holding-group views).
 *  - Unauthenticated requests fall back to the client param, then 1.
 *
 * Side-effect: when an admin overrides to a company different from their own,
 * logs COMPANY_CONTEXT_SWITCH (severity: HIGH) to erp_audit_logs.
 */
export function resolveCompanyId(req: Request): number {
  const user = req.user;

  if (user?.companyId != null && user.role !== "admin") {
    return user.companyId;
  }

  const raw = (
    req.query["companyId"] ??
    req.query["company"] ??
    (req.body as Record<string, unknown> | undefined)?.["companyId"]
  ) as string | undefined;
  const n = raw ? parseInt(String(raw), 10) : NaN;
  let resolved = Number.isNaN(n) ? (user?.companyId ?? 1) : n;

  // ── Allowed-company guard ──────────────────────────────────────────────────
  // If this admin has an explicit company allowlist, clamp the resolved company
  // to one of the permitted IDs. Falls back to the user's own company, then the
  // first allowed company, then 1 — never leaks data to an unauthorised company.
  const allowedIds = (user as any)?.allowedCompanyIds as number[] | undefined;
  if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(resolved)) {
    resolved = user?.companyId != null && allowedIds.includes(user.companyId)
      ? user.companyId
      : (allowedIds[0] ?? 1);
  }

  // Detect context switch: admin/unassigned user targeting a different company
  if (
    user &&
    !Number.isNaN(n) &&
    user.companyId != null &&
    n !== user.companyId
  ) {
    logCompanyContextSwitch(req, user.companyId, resolved);
  }

  return resolved;
}

/**
 * Like resolveCompanyId, but admin (or unassigned user) can request
 * cross-company aggregation by passing `?company=all` / `?companyId=all`.
 * Returns "all" to signal the caller to skip the company filter.
 */
export function resolveCompanyScope(req: Request): number | "all" {
  const user = req.user;
  if (user?.companyId != null && user.role !== "admin") {
    return user.companyId;
  }
  const raw = (
    req.query["companyId"] ??
    req.query["company"] ??
    (req.body as Record<string, unknown> | undefined)?.["companyId"]
  ) as string | undefined;

  const allowedIds = (user as any)?.allowedCompanyIds as number[] | undefined;

  if (raw && String(raw).toLowerCase() === "all") {
    // Restricted admins (non-empty allowlist) MUST NOT receive "all" — clamp to their primary
    // or first allowed company so downstream callers don't skip the company filter entirely.
    if (allowedIds && allowedIds.length > 0) {
      return user?.companyId != null && allowedIds.includes(user.companyId)
        ? user.companyId
        : (allowedIds[0] ?? 1);
    }
    return "all";
  }
  const n = raw ? parseInt(String(raw), 10) : NaN;
  const resolved = Number.isNaN(n) ? (user?.companyId ?? 1) : n;

  // Clamp to allowed companies
  if (allowedIds && allowedIds.length > 0 && !allowedIds.includes(resolved)) {
    return user?.companyId != null && allowedIds.includes(user.companyId)
      ? user.companyId
      : (allowedIds[0] ?? 1);
  }

  return resolved;
}

/**
 * Returns the list of company IDs the admin is allowed to access.
 * Empty array means no restriction (all companies).
 * Non-admins always get their own single company.
 */
export function getAllowedCompanyIds(req: Request): number[] | null {
  const user = req.user;
  if (!user) return null;
  if (user.role !== "admin") {
    return user.companyId != null ? [user.companyId] : null;
  }
  const allowedIds = (user as any)?.allowedCompanyIds as number[] | undefined;
  return allowedIds && allowedIds.length > 0 ? allowedIds : null; // null = no restriction
}

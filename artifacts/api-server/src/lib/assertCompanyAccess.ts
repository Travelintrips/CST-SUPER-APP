import type { Request, Response } from "express";
import { writeAuditLog } from "./auditLog.js";

const CROSS_COMPANY_RESPONSE = {
  success: false,
  message: "Access denied for this company context",
} as const;

/**
 * IDOR ownership guard.
 *
 * Returns `true` when access is allowed (caller may proceed).
 * Returns `false` when access is denied (403 already sent — caller must return immediately).
 *
 * Admin / super_admin cross-company access is allowed but generates a
 * CROSS_COMPANY_RESOURCE_ACCESS_ALLOWED audit log entry (HIGH severity).
 *
 * Non-admin cross-company access is denied with 403 and generates a
 * CROSS_COMPANY_RESOURCE_ACCESS_DENIED audit log entry (HIGH severity).
 *
 * Usage:
 *   const companyId = resolveCompanyId(req);
 *   if (!await assertCompanyAccess(resource.companyId, companyId, req, res,
 *     { resourceType: "accounting_payment", resourceId: id })) return;
 */
export async function assertCompanyAccess(
  resourceCompanyId: number | null | undefined,
  resolvedCompanyId: number,
  req: Request,
  res: Response,
  metadata: {
    resourceType: string;
    resourceId: number | string;
  }
): Promise<boolean> {
  if (resourceCompanyId == null) return true;
  if (resourceCompanyId === resolvedCompanyId) return true;

  const user = req.user as
    | {
        id?: string;
        email?: string | null;
        role?: string | null;
        companyId?: number | null;
      }
    | undefined;

  const role = user?.role ?? null;
  const isAdmin = role === "admin" || role === "super_admin";

  const auditPayload = {
    severity: "HIGH",
    userId: user?.id ?? null,
    role,
    method: req.method,
    route: req.originalUrl,
    resourceType: metadata.resourceType,
    resourceId: metadata.resourceId,
    resourceCompanyId,
    activeCompanyId: user?.companyId ?? null,
    resolvedCompanyId,
    timestamp: new Date().toISOString(),
  };

  if (isAdmin) {
    writeAuditLog({
      userId: user?.id ?? null,
      userEmail: user?.email ?? null,
      companyId: resolvedCompanyId,
      action: "CROSS_COMPANY_RESOURCE_ACCESS_ALLOWED",
      module: metadata.resourceType,
      referenceId: String(metadata.resourceId),
      newData: auditPayload,
    });
    return true;
  }

  writeAuditLog({
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    companyId: resolvedCompanyId,
    action: "CROSS_COMPANY_RESOURCE_ACCESS_DENIED",
    module: metadata.resourceType,
    referenceId: String(metadata.resourceId),
    newData: auditPayload,
  });

  res.status(403).json(CROSS_COMPANY_RESPONSE);
  return false;
}

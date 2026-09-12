import type { Request, Response } from "express";
import { extractRequestMeta, writeAuditLog } from "./auditLog.js";

const CROSS_TENANT_DENY_RESPONSE = {
  success: false,
  message: "Access denied: resource belongs to a different tenant",
} as const;

const NULL_TENANT_DENY_RESPONSE = {
  success: false,
  message: "Access denied: resource has no tenant assignment",
} as const;

/**
 * Tenant-level IDOR ownership guard.
 *
 * Returns `true`  when access is allowed (caller may proceed).
 * Returns `false` when access is denied (403 already sent — caller must `return` immediately).
 *
 * Behaviour:
 *  1. Same tenant                → allow (no audit log).
 *  2. resourceTenantId is null   → depends on `options.allowNullTenant`:
 *       true  → allow (global resource, no audit log).
 *       false → deny 403 + CROSS_TENANT_RESOURCE_ACCESS_DENIED audit (default).
 *  3. Different tenant, role === "super_admin"
 *                                → allow + CROSS_TENANT_RESOURCE_ACCESS_ALLOWED audit (HIGH).
 *  4. Different tenant, any other role
 *                                → deny 403 + CROSS_TENANT_RESOURCE_ACCESS_DENIED audit (HIGH).
 *
 * Usage:
 *   const tenantId = resolveTenantId(req);           // caller resolves
 *   if (!await assertTenantAccess(resource.tenantId, tenantId, req, res, {
 *     resourceType: "freight_shipment",
 *     resourceId:   shipmentId,
 *   })) return;
 */
export async function assertTenantAccess(
  resourceTenantId: number | null | undefined,
  resolvedTenantId: number,
  req: Request,
  res: Response,
  metadata: {
    resourceType: string;
    resourceId: number | string;
    /** When true, a null/undefined resourceTenantId is treated as a global
     *  resource and access is allowed unconditionally. Default: false. */
    allowNullTenant?: boolean;
  }
): Promise<boolean> {
  // ── 1. null tenant handling ────────────────────────────────────────────────
  if (resourceTenantId == null) {
    if (metadata.allowNullTenant) return true;
    // Deny: resource has no tenant — treat as misconfiguration / forbidden
    const { ipAddress, userAgent, userId, userEmail } = extractRequestMeta(req);
    const user = req.user as { id?: string; email?: string | null; role?: string | null } | undefined;
    const role = user?.role ?? null;
    writeAuditLog({
      userId,
      userEmail,
      companyId: resolvedTenantId,
      action: "CROSS_TENANT_RESOURCE_ACCESS_DENIED",
      module: metadata.resourceType,
      referenceId: String(metadata.resourceId),
      newData: {
        severity: "HIGH",
        reason: "null_tenant",
        userId,
        role,
        method: req.method,
        route: req.originalUrl,
        tenantId: resolvedTenantId,
        resourceTenantId: null,
        resourceType: metadata.resourceType,
        resourceId: metadata.resourceId,
        timestamp: new Date().toISOString(),
      },
      ipAddress,
      userAgent,
    });
    res.status(403).json(NULL_TENANT_DENY_RESPONSE);
    return false;
  }

  // ── 2. Same tenant — fast path ─────────────────────────────────────────────
  if (resourceTenantId === resolvedTenantId) return true;

  // ── 3 & 4. Different tenant — check for super_admin override ──────────────
  const { ipAddress, userAgent, userId, userEmail } = extractRequestMeta(req);
  const user = req.user as { id?: string; email?: string | null; role?: string | null } | undefined;
  const role = user?.role ?? null;
  const isSuperAdmin = role === "super_admin";

  const auditPayload: Record<string, unknown> = {
    severity: "HIGH",
    userId,
    role,
    method: req.method,
    route: req.originalUrl,
    tenantId: resolvedTenantId,
    resourceTenantId,
    resourceType: metadata.resourceType,
    resourceId: metadata.resourceId,
    timestamp: new Date().toISOString(),
  };

  if (isSuperAdmin) {
    // ── 3. Super admin override — allowed, logged ──────────────────────────
    writeAuditLog({
      userId,
      userEmail,
      companyId: resolvedTenantId,
      action: "CROSS_TENANT_RESOURCE_ACCESS_ALLOWED",
      module: metadata.resourceType,
      referenceId: String(metadata.resourceId),
      newData: auditPayload,
      ipAddress,
      userAgent,
    });
    return true;
  }

  // ── 4. Deny — different tenant, no override ────────────────────────────────
  writeAuditLog({
    userId,
    userEmail,
    companyId: resolvedTenantId,
    action: "CROSS_TENANT_RESOURCE_ACCESS_DENIED",
    module: metadata.resourceType,
    referenceId: String(metadata.resourceId),
    newData: auditPayload,
    ipAddress,
    userAgent,
  });
  res.status(403).json(CROSS_TENANT_DENY_RESPONSE);
  return false;
}

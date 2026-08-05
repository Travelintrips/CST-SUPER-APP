/**
 * Unified Audit Trail — wrapper ergonomis di atas writeAuditLog.
 *
 * Satu entry point untuk semua modul. Non-fatal, fire-and-forget.
 * Ditulis ke tabel erp_audit_logs.
 *
 * Usage:
 *   audit(req, { action: "create", module: "payment", resourceId: vpyNum, after: row });
 *   auditSystem({ action: "status_change", module: "logistics", resourceId: orderId, before, after });
 */

import type { Request } from "express";
import { writeAuditLog, extractRequestMeta } from "./auditLog.js";

export type AuditAction =
  | "create" | "update" | "delete"
  | "status_change" | "payment" | "approve"
  | "reject" | "cancel" | "reversal"
  | "login" | "logout" | "export" | "import"
  | "validate" | "bulk_update";

export type AuditModule =
  | "sales" | "purchase" | "accounting"
  | "expense" | "inventory" | "logistics"
  | "vendor" | "customer" | "tax"
  | "payment" | "auth" | "settings" | "pos";

export interface AuditOpts {
  action: AuditAction | string;
  module: AuditModule | string;
  resourceId: string | number;
  description?: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  companyId?: number | null;
  branchId?: number | null;
}

/**
 * Log audit dari request HTTP (actor + IP diekstrak otomatis dari req).
 */
export function audit(req: Request, opts: AuditOpts): void {
  const meta = extractRequestMeta(req);
  writeAuditLog({
    companyId: opts.companyId ?? meta.companyId,
    branchId: opts.branchId ?? null,
    userId: meta.userId,
    userEmail: meta.userEmail,
    action: opts.action,
    module: opts.module,
    referenceId: String(opts.resourceId),
    oldData: opts.before ?? null,
    newData: opts.after ?? null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * Log audit dari background/system context (tanpa HTTP request).
 */
export function auditSystem(opts: AuditOpts & {
  actorId?: string | null;
  actorEmail?: string | null;
  actorType?: string;
}): void {
  writeAuditLog({
    companyId: opts.companyId ?? null,
    branchId: opts.branchId ?? null,
    userId: opts.actorId ?? "system",
    userEmail: opts.actorEmail ?? null,
    action: opts.action,
    module: opts.module,
    referenceId: String(opts.resourceId),
    oldData: opts.before ?? null,
    newData: opts.after ?? null,
    ipAddress: null,
    userAgent: "system",
  });
}

/**
 * Log status change — shortcut ergonomis.
 */
export function auditStatusChange(
  req: Request,
  opts: {
    module: AuditModule | string;
    resourceId: string | number;
    oldStatus: string;
    newStatus: string;
    companyId?: number | null;
    extra?: Record<string, unknown>;
  },
): void {
  audit(req, {
    action: "status_change",
    module: opts.module,
    resourceId: opts.resourceId,
    companyId: opts.companyId,
    before: { status: opts.oldStatus, ...(opts.extra ?? {}) },
    after: { status: opts.newStatus, ...(opts.extra ?? {}) },
  });
}

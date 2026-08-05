/**
 * SAP AUDIT MIDDLEWARE
 * ====================
 * Express middleware yang secara otomatis mencatat setiap
 * mutasi API ke `sap_audit_ledger` (append-only, immutable).
 *
 * Dipasang pada route-route yang perlu full SAP-level traceability:
 *   - SAP approval workflow endpoints
 *   - SAP journal posting/reversal endpoints
 *
 * RULES (per spec):
 *  - EVERY action = logged
 *  - EVERY change = traceable
 *  - NO DELETE EVER
 *  - ONLY APPEND
 */

import type { Request, Response, NextFunction } from "express";
import { buildAuditLog, writeSapAuditLog } from "../lib/sapApprovalEngine.js";

/**
 * Intercepts res.json() to capture `after` state,
 * then writes an audit entry to sap_audit_ledger.
 *
 * Usage:
 *   router.post("/vendor-invoices/:id/sap-approve", sapAuditMiddleware, handler)
 *
 * The middleware reads:
 *   req.body        → before snapshot (what the client sent)
 *   req.method      → maps to action
 *   req.params.id   → entity_id
 *   req.user?.id    → actor_id
 *   req.user?.role  → role
 */
export function sapAuditMiddleware(req: Request, res: Response, next: NextFunction): void {
  const originalJson = res.json.bind(res);

  res.json = function (data: unknown) {
    const entityType = (req.body as Record<string, unknown>)?.entity_type as string
      ?? req.path.replace(/\/api\/purchase\/vendor-invoices\/\d+\//, "")
      ?? "vendor_invoice";

    const entityId = req.params["id"]
      ?? (req.body as Record<string, unknown>)?.id
      ?? "unknown";

    const action = deriveAction(req.method, req.path);

    const entry = buildAuditLog({
      entityType,
      entityId:  String(entityId),
      action,
      actorId:   (req as any).user?.id   ?? (req as any).user?.email ?? null,
      role:      (req as any).user?.role ?? null,
      before:    req.method !== "GET" ? (req.body ?? null) : null,
      after:     data,
    });

    writeSapAuditLog(entry).catch(() => {});

    return originalJson(data);
  };

  next();
}

function deriveAction(method: string, path: string): string {
  if (path.includes("sap-approve"))  return "SAP_APPROVE";
  if (path.includes("sap-submit"))   return "SAP_SUBMIT";
  if (path.includes("sap-reject"))   return "SAP_REJECT";
  if (path.includes("sap-post"))     return "SAP_POST";
  if (path.includes("sap-lock"))     return "SAP_LOCK";
  if (path.includes("sap-journal"))  return "SAP_JOURNAL_POST";
  if (path.includes("sap-reverse"))  return "SAP_JOURNAL_REVERSE";
  switch (method) {
    case "POST":   return "CREATE";
    case "PUT":    return "UPDATE";
    case "PATCH":  return "UPDATE";
    case "DELETE": return "DELETE";
    default:       return method;
  }
}

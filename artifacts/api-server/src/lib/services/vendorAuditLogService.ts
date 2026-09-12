/**
 * vendorAuditLogService — Audit trail untuk semua aksi pada Vendor Profile.
 *
 * Setiap perubahan tercatat dengan: actor, supplier, action, before, after,
 * timestamp, ip, userAgent.
 *
 * Non-fatal: kegagalan menulis audit log tidak menghentikan operasi utama.
 */

import { db, vendorAuditLogsTable } from "@workspace/db";
import type { Request } from "express";

export type VendorAuditAction =
  // Admin actions
  | "status_changed"
  | "vendor_verified"
  | "marketplace_published"
  | "marketplace_unpublished"
  | "marketplace_status_changed"
  | "profile_edited_admin"
  | "logo_uploaded_admin"
  | "document_uploaded"
  | "document_deleted"
  | "document_verified"
  | "document_rejected"
  | "review_moderated"
  // Vendor self actions
  | "profile_edited_vendor"
  | "logo_uploaded_vendor"
  // Onboarding / lifecycle
  | "onboarding_completed"
  | "invite_accepted";

export interface VendorAuditEntry {
  supplierId: number;
  action: VendorAuditAction;
  actor: string;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ip?: string | null;
  userAgent?: string | null;
}

/**
 * Tulis satu entri audit. Non-blocking — error dilog ke console tapi tidak dilempar.
 */
export async function logVendorAudit(entry: VendorAuditEntry): Promise<void> {
  await db
    .insert(vendorAuditLogsTable)
    .values({
      supplierId: entry.supplierId,
      action: entry.action,
      actor: entry.actor,
      before: entry.before ?? null,
      after: entry.after ?? null,
      ip: entry.ip ?? null,
      userAgent: entry.userAgent ?? null,
    })
    .catch((e: unknown) => {
      console.error("[vendorAudit] Failed to write audit entry:", {
        action: entry.action,
        supplierId: entry.supplierId,
        err: e,
      });
    });
}

/** Ekstrak actor identifier dari Express Request. */
export function actorFromReq(req: Request): string {
  return (
    (req as any).user?.email ??
    (req as any).session?.user?.email ??
    String((req as any).portalCustomerId ?? "unknown")
  );
}

/** Ekstrak IP dari Request headers (proxy-aware). */
export function ipFromReq(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return Array.isArray(forwarded) ? forwarded[0] : forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress ?? null;
}

/** Ekstrak User-Agent dari Request headers. */
export function uaFromReq(req: Request): string | null {
  return (req.headers["user-agent"] as string) ?? null;
}

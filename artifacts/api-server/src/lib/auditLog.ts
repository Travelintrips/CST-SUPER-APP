/**
 * Audit Log Service — ERP
 *
 * writeAuditLog()     — fire-and-forget, tidak memblok request, dipakai untuk operasi non-kritis.
 * writeAuditLogSync() — async/await, MELEMPAR exception jika gagal. Wajib dipakai untuk
 *                       approve / reject / void / delete agar kegagalan audit membatalkan action.
 *
 * Modules: auth | pos | product | recipe | stock | transfer | return | damage | opname | role | permission
 * Actions: login | logout | create | update | delete | confirm | cancel | pay | adjust | transfer | opname
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { Request } from "express";

export interface AuditLogEntry {
  companyId?: number | null;
  branchId?: number | null;
  userId?: string | null;
  userEmail?: string | null;
  action: string;
  module: string;
  referenceId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  oldData?: Record<string, unknown> | null;
  newData?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

type UserInfo = { id?: string; email?: string | null; companyId?: number | null };

export function extractRequestMeta(req: Request): {
  ipAddress: string;
  userAgent: string;
  userId: string | null;
  userEmail: string | null;
  companyId: number | null;
} {
  const user = req.user as UserInfo | undefined;
  return {
    ipAddress: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ?? req.socket?.remoteAddress ?? "unknown",
    userAgent: (req.headers["user-agent"] as string) ?? "unknown",
    userId: user?.id ?? null,
    userEmail: user?.email ?? null,
    companyId: user?.companyId ?? null,
  };
}

// ─── Shared INSERT builder ────────────────────────────────────────────────────

function buildInsert(entry: AuditLogEntry) {
  const oldDataStr = entry.oldData != null ? JSON.stringify(entry.oldData) : null;
  const newDataStr = entry.newData != null ? JSON.stringify(entry.newData) : null;
  return sql`
    INSERT INTO erp_audit_logs (
      company_id, branch_id, user_id, user_email,
      action, module, reference_id,
      old_data, new_data,
      ip_address, user_agent, created_at
    ) VALUES (
      ${entry.companyId ?? null},
      ${entry.branchId ?? null},
      ${entry.userId ?? null},
      ${entry.userEmail ?? null},
      ${entry.action},
      ${entry.module},
      ${entry.referenceId ?? null},
      ${oldDataStr ? sql`${oldDataStr}::jsonb` : sql`NULL`},
      ${newDataStr ? sql`${newDataStr}::jsonb` : sql`NULL`},
      ${entry.ipAddress ?? null},
      ${entry.userAgent ?? null},
      NOW()
    )
  `;
}

// ─── Fire-and-forget (operasi non-kritis) ────────────────────────────────────

export function writeAuditLog(entry: AuditLogEntry): void {
  db.execute(buildInsert(entry)).catch((err: unknown) => {
    console.error("[auditLog] Failed to write audit entry:", err);
  });
}

/** Convenience: extract meta from req and write fire-and-forget audit log */
export function auditFromReq(
  req: Request,
  opts: {
    action: string;
    module: string;
    branchId?: number | null;
    referenceId?: string | null;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  },
): void {
  const meta = extractRequestMeta(req);
  writeAuditLog({
    companyId: meta.companyId,
    branchId: opts.branchId ?? null,
    userId: meta.userId,
    userEmail: meta.userEmail,
    action: opts.action,
    module: opts.module,
    referenceId: opts.referenceId ?? null,
    oldData: opts.oldData ?? null,
    newData: opts.newData ?? null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

// ─── Synchronous / blocking (approve · reject · void · delete) ───────────────
// Gunakan untuk semua finance actions yang harus membatalkan operasi jika audit gagal.

export async function writeAuditLogSync(entry: AuditLogEntry): Promise<void> {
  await db.execute(buildInsert(entry));
}

/** Convenience: extract meta from req and write SYNCHRONOUS audit log.
 *  Throws if the DB write fails — caller MUST handle the error and return 500. */
export async function auditFromReqSync(
  req: Request,
  opts: {
    action: string;
    module: string;
    branchId?: number | null;
    referenceId?: string | null;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  },
): Promise<void> {
  const meta = extractRequestMeta(req);
  await writeAuditLogSync({
    companyId: meta.companyId,
    branchId: opts.branchId ?? null,
    userId: meta.userId,
    userEmail: meta.userEmail,
    action: opts.action,
    module: opts.module,
    referenceId: opts.referenceId ?? null,
    oldData: opts.oldData ?? null,
    newData: opts.newData ?? null,
    ipAddress: meta.ipAddress,
    userAgent: meta.userAgent,
  });
}

/**
 * SAP HARDENING — FASE 8
 * Error Containment System
 *
 * Rules:
 *  - Tidak boleh crash system saat error
 *  - Semua error masuk integrity_audit_queue
 *  - System tetap berjalan (graceful degradation)
 *  - Classification: LOW (warning) | MEDIUM (needs review) | HIGH (block posting)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export type ErrorClassification = "LOW" | "MEDIUM" | "HIGH";

export interface IntegrityErrorOpts {
  companyId?: number | null;
  classification: ErrorClassification;
  module: string;
  errorCode?: string | null;
  message: string;
  context?: Record<string, unknown> | null;
  entityType?: string | null;
  entityId?: string | null;
}

// ─── Queue an integrity error (always non-throwing) ────────────────────────

export async function queueIntegrityError(opts: IntegrityErrorOpts): Promise<void> {
  try {
    const ctx = opts.context
      ? `'${JSON.stringify(opts.context).replace(/'/g, "''")}'::jsonb`
      : "NULL";
    await db.execute(sql.raw(`
      INSERT INTO integrity_audit_queue
        (company_id, classification, module, error_code, message, context, entity_type, entity_id)
      VALUES (
        ${opts.companyId ?? "NULL"},
        '${opts.classification}',
        '${opts.module.replace(/'/g, "''")}',
        ${opts.errorCode ? `'${opts.errorCode.replace(/'/g, "''")}'` : "NULL"},
        '${opts.message.replace(/'/g, "''")}',
        ${ctx},
        ${opts.entityType ? `'${opts.entityType.replace(/'/g, "''")}'` : "NULL"},
        ${opts.entityId ? `'${opts.entityId.replace(/'/g, "''")}'` : "NULL"}
      )
    `));
  } catch (err) {
    // Never throw — log only
    logger.warn({ err, opts }, "[error-containment] queueIntegrityError gagal (non-fatal)");
  }
}

// ─── Graceful wrapper — catch & contain any async operation ───────────────

export async function containError<T>(
  fn: () => Promise<T>,
  opts: Omit<IntegrityErrorOpts, "message"> & { fallback: T; operation: string },
): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const message = `[${opts.operation}] ${err?.message ?? String(err)}`;
    logger.error({ err, module: opts.module, operation: opts.operation }, message);
    await queueIntegrityError({
      ...opts,
      message,
      context: { ...(opts.context ?? {}), stack: err?.stack?.slice(0, 500) },
    });
    return opts.fallback;
  }
}

// ─── Resolve (mark fixed) an integrity queue item ─────────────────────────

export async function resolveIntegrityError(
  id: number,
  resolvedBy: string,
  notes?: string,
): Promise<boolean> {
  try {
    await db.execute(sql.raw(`
      UPDATE integrity_audit_queue
      SET resolved = TRUE,
          resolved_at = NOW(),
          resolved_by = '${resolvedBy.replace(/'/g, "''")}',
          resolution_notes = ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"},
          updated_at = NOW()
      WHERE id = ${id} AND resolved = FALSE
    `));
    return true;
  } catch (err) {
    logger.warn({ err, id }, "[error-containment] resolveIntegrityError gagal");
    return false;
  }
}

// ─── List unresolved errors ────────────────────────────────────────────────

export async function getUnresolvedErrors(opts: {
  companyId?: number | null;
  classification?: ErrorClassification | null;
  module?: string | null;
  limit?: number;
}): Promise<any[]> {
  try {
    const conditions: string[] = ["resolved = FALSE"];
    if (opts.companyId)       conditions.push(`company_id = ${opts.companyId}`);
    if (opts.classification)  conditions.push(`classification = '${opts.classification}'`);
    if (opts.module)          conditions.push(`module = '${opts.module.replace(/'/g, "''")}'`);
    const limit = opts.limit ?? 100;
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM integrity_audit_queue
      WHERE ${conditions.join(" AND ")}
      ORDER BY
        CASE classification WHEN 'HIGH' THEN 1 WHEN 'MEDIUM' THEN 2 ELSE 3 END,
        created_at DESC
      LIMIT ${limit}
    `));
    return rows;
  } catch (err) {
    logger.warn({ err }, "[error-containment] getUnresolvedErrors gagal");
    return [];
  }
}

/**
 * taxAuditService.ts
 * Mencatat semua aktivitas pajak ke tabel tax_audit_logs.
 * Non-fatal — semua error di-swallow agar tidak mengganggu flow utama.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import type { Request } from "express";
import { criticalAlert } from "./criticalAlert.js";

// ── Dev-test hook — paksa catch block dieksekusi di test environment ──────────
let _forceFailForTesting = false;
export function _setForceFailForTesting(v: boolean): void { _forceFailForTesting = v; }

// ── Fallback table untuk audit log yang gagal tersimpan ───────────────────────
// Pastikan data tidak hilang saat tax_audit_logs tidak tersedia sementara.
// Admin bisa query tax_audit_log_failures untuk recovery.
(async () => {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS tax_audit_log_failures (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER,
      entity_type   TEXT,
      entity_id     TEXT,
      action        TEXT,
      params_json   JSONB,
      error_message TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `).catch(() => {});
})();

export type TaxEntityType =
  | "transaction_tax"
  | "tax_adjustment"
  | "tax_spt_draft";

export type TaxAuditAction =
  | "CREATE"
  | "UPDATE"
  | "DELETE"
  | "EXCLUDE"
  | "INCLUDE"
  | "BULK_EXCLUDE"
  | "BULK_INCLUDE"
  | "ADJUSTMENT_CREATE"
  | "ADJUSTMENT_APPROVE"
  | "ADJUSTMENT_REJECT"
  | "SPT_EXPORT"
  | "SPT_SUBMIT"
  | "REVERSAL_CREATE"
  | "VALIDATE"
  | "FAILED_VALIDATION"
  | "LOCK_PERIOD"
  | "UNLOCK_PERIOD"
  | "DOWNLOAD";

export interface LogTaxActivityParams {
  companyId: number;
  entityType: TaxEntityType;
  entityId: string | number;
  action: TaxAuditAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  performedBy: string;
  ipAddress?: string | null;
}

export async function logTaxActivity(params: LogTaxActivityParams): Promise<void> {
  try {
    if (_forceFailForTesting) throw new Error("DEV TEST: forced audit failure");
    const {
      companyId,
      entityType,
      entityId,
      action,
      before = null,
      after = null,
      performedBy,
      ipAddress = null,
    } = params;

    await db.execute(sql`
      INSERT INTO tax_audit_logs
        (company_id, entity_type, entity_id, action, before_data, after_data, performed_by, ip_address)
      VALUES
        (
          ${companyId},
          ${entityType},
          ${String(entityId)},
          ${action},
          ${before ? JSON.stringify(before) : null}::jsonb,
          ${after ? JSON.stringify(after) : null}::jsonb,
          ${performedBy},
          ${ipAddress}
        )
    `);
  } catch (err) {
    logger.warn({ err, params }, "[taxAuditService] gagal menyimpan audit log — menulis ke fallback table untuk recovery");
    // Fallback: simpan ke tabel terpisah agar bisa di-recover oleh admin atau monitoring
    db.execute(sql`
      INSERT INTO tax_audit_log_failures
        (company_id, entity_type, entity_id, action, params_json, error_message)
      VALUES
        (
          ${params.companyId},
          ${params.entityType},
          ${String(params.entityId)},
          ${params.action},
          ${JSON.stringify(params)}::jsonb,
          ${err instanceof Error ? err.message : String(err)}
        )
    `).catch((fallbackErr) => {
      void criticalAlert(
        "[taxAuditService] CRITICAL: audit log gagal DAN fallback juga gagal — data tidak tersimpan sama sekali",
        { err: String(fallbackErr), originalAction: params.action, entityId: params.entityId },
      );
    });
  }
}

/**
 * Helper: ekstrak user + IP dari Express Request.
 */
export function extractActorFromReq(req: Request): { performedBy: string; ipAddress: string } {
  const session = (req as any).session;
  const performedBy: string =
    session?.user?.email ??
    session?.userEmail ??
    (req as any).user?.email ??
    "unknown";
  const ipAddress: string =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown";
  return { performedBy, ipAddress };
}

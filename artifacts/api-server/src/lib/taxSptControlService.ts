/**
 * taxSptControlService.ts
 * Kontrol include/exclude transaction_taxes dari pelaporan SPT.
 * Tidak menghapus data — hanya mengubah spt_status.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { logTaxActivity } from "./taxAuditService.js";

// ── Types ────────────────────────────────────────────────────────────────────

export type SptStatus = "INCLUDED" | "EXCLUDED";

export interface ToggleResult {
  id: number;
  previousStatus: SptStatus;
  newStatus: SptStatus;
}

export interface ExcludeWithReasonParams {
  transactionTaxId: number;
  companyId: number;
  reason: string;
  userId: string;
  ipAddress?: string;
}

export interface BulkUpdateParams {
  companyId: number;
  period: string;
  ids: number[];
  targetStatus: SptStatus;
  reason?: string;
  userId: string;
  ipAddress?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchRow(id: number, companyId: number) {
  const result = await db.execute(sql`
    SELECT id, company_id, spt_status, transaction_type, transaction_ref,
           tax_name, tax_amount, period
    FROM transaction_taxes
    WHERE id = ${id} AND company_id = ${companyId}
    LIMIT 1
  `);
  return result.rows[0] as Record<string, unknown> | undefined;
}

// ── 1. toggleIncludeExclude ───────────────────────────────────────────────────

export async function toggleSptStatus(
  transactionTaxId: number,
  companyId: number,
  userId: string,
  ipAddress?: string,
): Promise<ToggleResult> {
  const row = await fetchRow(transactionTaxId, companyId);
  if (!row) {
    throw new Error(`transaction_taxes id=${transactionTaxId} tidak ditemukan (companyId=${companyId})`);
  }

  const previousStatus = (row.spt_status as string | null) ?? "INCLUDED";
  const newStatus: SptStatus = previousStatus === "INCLUDED" ? "EXCLUDED" : "INCLUDED";

  if (newStatus === "INCLUDED") {
    await db.execute(sql`
      UPDATE transaction_taxes
      SET spt_status     = 'INCLUDED',
          excluded_reason = NULL,
          excluded_by    = NULL,
          excluded_at    = NULL,
          updated_at     = NOW()
      WHERE id = ${transactionTaxId} AND company_id = ${companyId}
    `);
  } else {
    await db.execute(sql`
      UPDATE transaction_taxes
      SET spt_status  = 'EXCLUDED',
          excluded_by = ${userId},
          excluded_at = NOW(),
          updated_at  = NOW()
      WHERE id = ${transactionTaxId} AND company_id = ${companyId}
    `);
  }

  await logTaxActivity({
    companyId,
    entityType: "transaction_tax",
    entityId: transactionTaxId,
    action: newStatus === "EXCLUDED" ? "EXCLUDE" : "INCLUDE",
    before: { spt_status: previousStatus },
    after: { spt_status: newStatus },
    performedBy: userId,
    ipAddress,
  });

  logger.info({ transactionTaxId, previousStatus, newStatus, userId }, "[taxSptControl] toggle spt_status");

  return { id: transactionTaxId, previousStatus: previousStatus as SptStatus, newStatus };
}

// ── 2. excludeWithReason ──────────────────────────────────────────────────────

export async function excludeWithReason(params: ExcludeWithReasonParams): Promise<void> {
  const { transactionTaxId, companyId, reason, userId, ipAddress } = params;

  if (!reason?.trim()) {
    throw new Error("reason wajib diisi untuk exclude dengan alasan");
  }

  const row = await fetchRow(transactionTaxId, companyId);
  if (!row) {
    throw new Error(`transaction_taxes id=${transactionTaxId} tidak ditemukan`);
  }

  const previousStatus = (row.spt_status as string | null) ?? "INCLUDED";

  await db.execute(sql`
    UPDATE transaction_taxes
    SET spt_status      = 'EXCLUDED',
        excluded_reason = ${reason.trim()},
        excluded_by     = ${userId},
        excluded_at     = NOW(),
        updated_at      = NOW()
    WHERE id = ${transactionTaxId} AND company_id = ${companyId}
  `);

  await logTaxActivity({
    companyId,
    entityType: "transaction_tax",
    entityId: transactionTaxId,
    action: "EXCLUDE",
    before: { spt_status: previousStatus, excluded_reason: null },
    after: { spt_status: "EXCLUDED", excluded_reason: reason.trim(), excluded_by: userId },
    performedBy: userId,
    ipAddress,
  });

  logger.info({ transactionTaxId, reason, userId }, "[taxSptControl] excludeWithReason");
}

// ── 3. bulkUpdateSptStatus ────────────────────────────────────────────────────

export async function bulkUpdateSptStatus(params: BulkUpdateParams): Promise<{ updated: number }> {
  const { companyId, period, ids, targetStatus, reason, userId, ipAddress } = params;

  if (!ids.length) return { updated: 0 };

  if (targetStatus === "EXCLUDED") {
    await db.execute(sql`
      UPDATE transaction_taxes
      SET spt_status      = 'EXCLUDED',
          excluded_reason = ${reason ?? null},
          excluded_by     = ${userId},
          excluded_at     = NOW(),
          updated_at      = NOW()
      WHERE company_id = ${companyId}
        AND period     = ${period}
        AND id         = ANY(${ids}::int[])
    `);
  } else {
    await db.execute(sql`
      UPDATE transaction_taxes
      SET spt_status      = 'INCLUDED',
          excluded_reason = NULL,
          excluded_by     = NULL,
          excluded_at     = NULL,
          updated_at      = NOW()
      WHERE company_id = ${companyId}
        AND period     = ${period}
        AND id         = ANY(${ids}::int[])
    `);
  }

  await logTaxActivity({
    companyId,
    entityType: "transaction_tax",
    entityId: `bulk:${period}`,
    action: targetStatus === "EXCLUDED" ? "BULK_EXCLUDE" : "BULK_INCLUDE",
    before: null,
    after: { ids, targetStatus, period, reason: reason ?? null },
    performedBy: userId,
    ipAddress,
  });

  logger.info({ companyId, period, count: ids.length, targetStatus, userId }, "[taxSptControl] bulkUpdateSptStatus");

  return { updated: ids.length };
}

// ── 4. getSptStatusSummary ────────────────────────────────────────────────────

export async function getSptStatusSummary(companyId: number, period: string) {
  const result = await db.execute(sql`
    SELECT
      spt_status,
      COUNT(*)::int        AS count,
      SUM(tax_amount)::numeric AS total_tax_amount
    FROM transaction_taxes
    WHERE company_id = ${companyId} AND period = ${period}
    GROUP BY spt_status
  `);
  return result.rows as Array<{ spt_status: string; count: number; total_tax_amount: string }>;
}

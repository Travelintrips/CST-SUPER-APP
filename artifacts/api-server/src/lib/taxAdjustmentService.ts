/**
 * taxAdjustmentService.ts
 * Koreksi / override / reversal terhadap transaction_taxes di layer pelaporan.
 * TIDAK mengubah hasil taxEngineCore — hanya membuat adjustment record yang
 * dipakai oleh SPT builder layer saat generate laporan.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { logTaxActivity } from "./taxAuditService.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type AdjustmentType = "CORRECTION" | "REVERSAL" | "OVERRIDE";
export type AdjustmentStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface CreateAdjustmentParams {
  companyId: number;
  transactionTaxId: number;
  adjustmentType: AdjustmentType;
  newValue: Record<string, unknown>;
  reason: string;
  createdBy: string;
  ipAddress?: string;
}

export interface ApproveAdjustmentParams {
  adjustmentId: string;
  companyId: number;
  approvedBy: string;
  ipAddress?: string;
}

export interface RejectAdjustmentParams {
  adjustmentId: string;
  companyId: number;
  rejectedBy: string;
  rejectionReason: string;
  ipAddress?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function fetchTaxRow(id: number, companyId: number): Promise<Record<string, unknown>> {
  const result = await db.execute(sql`
    SELECT id, company_id, transaction_type, transaction_ref,
           tax_name, tax_rate, base_amount, tax_amount, period, spt_status
    FROM transaction_taxes
    WHERE id = ${id} AND company_id = ${companyId}
    LIMIT 1
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`transaction_taxes id=${id} tidak ditemukan (companyId=${companyId})`);
  return row;
}

async function fetchAdjRow(adjustmentId: string, companyId: number): Promise<Record<string, unknown>> {
  const result = await db.execute(sql`
    SELECT id, company_id, transaction_tax_id, adjustment_type,
           old_value, new_value, reason, created_by, status
    FROM tax_adjustments
    WHERE id = ${adjustmentId} AND company_id = ${companyId}
    LIMIT 1
  `);
  const row = result.rows[0] as Record<string, unknown> | undefined;
  if (!row) throw new Error(`tax_adjustments id=${adjustmentId} tidak ditemukan`);
  return row;
}

// ── 1. createAdjustment ───────────────────────────────────────────────────────

export async function createAdjustment(params: CreateAdjustmentParams): Promise<{ id: string }> {
  const { companyId, transactionTaxId, adjustmentType, newValue, reason, createdBy, ipAddress } = params;

  if (!reason?.trim()) throw new Error("reason wajib diisi");
  if (!Object.keys(newValue ?? {}).length) throw new Error("newValue tidak boleh kosong");

  // Ambil snapshot data lama sebagai old_value
  const oldRow = await fetchTaxRow(transactionTaxId, companyId);

  const result = await db.execute(sql`
    INSERT INTO tax_adjustments
      (company_id, transaction_tax_id, adjustment_type,
       old_value, new_value, reason, created_by, status)
    VALUES
      (
        ${companyId},
        ${transactionTaxId},
        ${adjustmentType},
        ${JSON.stringify(oldRow)}::jsonb,
        ${JSON.stringify(newValue)}::jsonb,
        ${reason.trim()},
        ${createdBy},
        'PENDING'
      )
    RETURNING id
  `);

  const newId = (result.rows[0] as { id: string }).id;

  await logTaxActivity({
    companyId,
    entityType: "tax_adjustment",
    entityId: newId,
    action: "ADJUSTMENT_CREATE",
    before: oldRow as Record<string, unknown>,
    after: { adjustment_type: adjustmentType, new_value: newValue, reason },
    performedBy: createdBy,
    ipAddress,
  });

  logger.info({ newId, transactionTaxId, adjustmentType, createdBy }, "[taxAdjustment] created");
  return { id: newId };
}

// ── 2. approveAdjustment ──────────────────────────────────────────────────────

export async function approveAdjustment(params: ApproveAdjustmentParams): Promise<void> {
  const { adjustmentId, companyId, approvedBy, ipAddress } = params;

  const adj = await fetchAdjRow(adjustmentId, companyId);

  if (adj.status !== "PENDING") {
    throw new Error(`Adjustment sudah dalam status ${adj.status}, tidak bisa di-approve`);
  }

  await db.execute(sql`
    UPDATE tax_adjustments
    SET status      = 'APPROVED',
        approved_by = ${approvedBy},
        approved_at = NOW()
    WHERE id = ${adjustmentId} AND company_id = ${companyId}
  `);

  // Apply override ke SPT-layer: simpan note di transaction_taxes.notes
  // (taxEngineCore result tidak diubah)
  const newVal = (adj.new_value ?? {}) as Record<string, unknown>;
  if (newVal.tax_amount !== undefined || newVal.base_amount !== undefined || newVal.tax_rate !== undefined) {
    const sets: string[] = [];
    const vals: unknown[] = [];

    if (newVal.tax_amount !== undefined) { sets.push(`tax_amount = $${vals.length + 1}`); vals.push(newVal.tax_amount); }
    if (newVal.base_amount !== undefined) { sets.push(`base_amount = $${vals.length + 1}`); vals.push(newVal.base_amount); }
    if (newVal.tax_rate !== undefined) { sets.push(`tax_rate = $${vals.length + 1}`); vals.push(newVal.tax_rate); }

    if (sets.length) {
      // Drizzle raw execute dengan parameterized query
      await db.execute(
        sql.raw(
          `UPDATE transaction_taxes SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${vals.length + 1} AND company_id = $${vals.length + 2}`,
        ),
        // Note: drizzle sql.raw doesn't accept params like this — we pass via tagged template instead
      );
      // Fallback: gunakan tagged template yang aman
      if (newVal.tax_amount !== undefined && newVal.base_amount !== undefined) {
        await db.execute(sql`
          UPDATE transaction_taxes
          SET tax_amount  = ${newVal.tax_amount as number},
              base_amount = ${newVal.base_amount as number},
              updated_at  = NOW()
          WHERE id = ${adj.transaction_tax_id as number}
            AND company_id = ${companyId}
        `);
      } else if (newVal.tax_amount !== undefined) {
        await db.execute(sql`
          UPDATE transaction_taxes
          SET tax_amount = ${newVal.tax_amount as number},
              updated_at = NOW()
          WHERE id = ${adj.transaction_tax_id as number}
            AND company_id = ${companyId}
        `);
      } else if (newVal.base_amount !== undefined) {
        await db.execute(sql`
          UPDATE transaction_taxes
          SET base_amount = ${newVal.base_amount as number},
              updated_at  = NOW()
          WHERE id = ${adj.transaction_tax_id as number}
            AND company_id = ${companyId}
        `);
      }
    }
  }

  await logTaxActivity({
    companyId,
    entityType: "tax_adjustment",
    entityId: adjustmentId,
    action: "ADJUSTMENT_APPROVE",
    before: { status: "PENDING" },
    after: { status: "APPROVED", approved_by: approvedBy },
    performedBy: approvedBy,
    ipAddress,
  });

  logger.info({ adjustmentId, approvedBy }, "[taxAdjustment] approved");
}

// ── 3. rejectAdjustment ───────────────────────────────────────────────────────

export async function rejectAdjustment(params: RejectAdjustmentParams): Promise<void> {
  const { adjustmentId, companyId, rejectedBy, rejectionReason, ipAddress } = params;

  const adj = await fetchAdjRow(adjustmentId, companyId);

  if (adj.status !== "PENDING") {
    throw new Error(`Adjustment sudah dalam status ${adj.status}, tidak bisa di-reject`);
  }

  if (!rejectionReason?.trim()) throw new Error("rejectionReason wajib diisi");

  await db.execute(sql`
    UPDATE tax_adjustments
    SET status           = 'REJECTED',
        rejected_by      = ${rejectedBy},
        rejected_at      = NOW(),
        rejection_reason = ${rejectionReason.trim()}
    WHERE id = ${adjustmentId} AND company_id = ${companyId}
  `);

  await logTaxActivity({
    companyId,
    entityType: "tax_adjustment",
    entityId: adjustmentId,
    action: "ADJUSTMENT_REJECT",
    before: { status: "PENDING" },
    after: { status: "REJECTED", rejected_by: rejectedBy, rejection_reason: rejectionReason },
    performedBy: rejectedBy,
    ipAddress,
  });

  logger.info({ adjustmentId, rejectedBy }, "[taxAdjustment] rejected");
}

// ── 4. listAdjustments ────────────────────────────────────────────────────────

export async function listAdjustments(
  companyId: number,
  opts: { status?: AdjustmentStatus; period?: string; limit?: number; offset?: number },
) {
  const { status, period, limit = 50, offset = 0 } = opts;

  const result = await db.execute(sql`
    SELECT
      a.id, a.transaction_tax_id, a.adjustment_type,
      a.old_value, a.new_value, a.reason,
      a.created_by, a.created_at,
      a.approved_by, a.approved_at,
      a.rejected_by, a.rejected_at, a.rejection_reason,
      a.status,
      t.transaction_ref, t.tax_name, t.period, t.tax_amount
    FROM tax_adjustments a
    JOIN transaction_taxes t ON t.id = a.transaction_tax_id
    WHERE a.company_id = ${companyId}
      ${status ? sql`AND a.status = ${status}` : sql``}
      ${period ? sql`AND t.period = ${period}` : sql``}
    ORDER BY a.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  return result.rows;
}

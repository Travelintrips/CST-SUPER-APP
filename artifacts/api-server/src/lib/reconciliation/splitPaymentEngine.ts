/**
 * Split Payment Engine — Batch 3 Phase 2
 *
 * Handles the case where a single large invoice is paid via N separate
 * bank transfers.
 *
 *   Invoice  100.000.000
 *   ← Transfer 40.000.000
 *   ← Transfer 30.000.000
 *   ← Transfer 30.000.000
 *
 * Invoice status lifecycle:
 *   OPEN → PARTIALLY_PAID → PAID
 *
 * Relationships are stored in:
 *   payment_matching_groups  (one group per invoice)
 *   payment_allocations      (one row per transfer)
 */

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { ConfidenceReason } from "./reconDecisionStack.js";
import type { db as DrizzleDb } from "@workspace/db";

// Lazy DB loader — avoids top-level DB connection on module import (keeps engine pure for tests)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type InvoicePaymentStatus = "OPEN" | "PARTIALLY_PAID" | "PAID" | "OVERPAID";

export interface SplitPaymentGroup {
  invoiceId: number;
  invoiceRef: string;
  invoiceAmount: number;
  companyId: number;
  payments: Array<{
    mutationId: number;
    amount: number;
    paidAt: string;
  }>;
  totalPaid: number;
  remaining: number;
  status: InvoicePaymentStatus;
  confidence: number;
  explanation: ConfidenceReason[];
}

export interface SplitPaymentCandidate {
  invoiceId: number;
  invoiceRef: string;
  invoiceAmount: number;
  totalPaidSoFar: number;
  remainingAmount: number;
  status: InvoicePaymentStatus;
  paymentCount: number;
  confidence: number;
  explanation: ConfidenceReason[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function classifyInvoiceStatus(
  invoiceAmount: number,
  totalPaid: number,
): InvoicePaymentStatus {
  // Use integer cents to avoid IEEE 754 rounding errors.
  // e.g. 1_000_000 - 999_999.99 = 0.010009... in float64, not exactly 0.01.
  const diffCents = Math.round((invoiceAmount - totalPaid) * 100);
  if (totalPaid === 0) return "OPEN";
  if (diffCents > 1) return "PARTIALLY_PAID";  // more than 1 cent remaining
  if (diffCents >= -1) return "PAID";          // within ±1 cent (rounding tolerance)
  return "OVERPAID";
}

function buildSplitConfidence(
  invoiceAmount: number,
  totalPaid: number,
  paymentCount: number,
): { confidence: number; explanation: ConfidenceReason[] } {
  const explanation: ConfidenceReason[] = [];
  let confidence = 0;

  const coverageRatio = Math.min(totalPaid / invoiceAmount, 1.5);
  const pts = Math.round(Math.min(coverageRatio, 1) * 50);
  confidence += pts;
  explanation.push({
    code: "COVERAGE_RATIO",
    label: `Pembayaran terkumulasi ${(coverageRatio * 100).toFixed(1)}% dari invoice`,
    score: pts,
  });

  if (paymentCount >= 2) {
    confidence += 20;
    explanation.push({ code: "MULTI_PAYMENT", label: `${paymentCount} transfer terhubung ke invoice ini`, score: 20 });
  } else {
    confidence += 10;
    explanation.push({ code: "SINGLE_PAYMENT_SO_FAR", label: "1 transfer terhubung (belum lunas)", score: 10 });
  }

  const status = classifyInvoiceStatus(invoiceAmount, totalPaid);
  if (status === "PAID") {
    confidence += 25;
    explanation.push({ code: "FULLY_PAID", label: "Invoice terlunasi penuh", score: 25 });
  } else if (status === "PARTIALLY_PAID") {
    confidence += 15;
    explanation.push({ code: "PARTIALLY_PAID_BONUS", label: "Invoice sebagian terlunasi", score: 15 });
  } else if (status === "OVERPAID") {
    confidence -= 10;
    explanation.push({ code: "OVERPAID_PENALTY", label: "Kelebihan bayar terdeteksi", score: -10 });
  }

  confidence = Math.max(0, Math.min(100, confidence));
  return { confidence, explanation };
}

// ─── Find split-payment candidates for a given mutation ────────────────────────
// Returns invoices that already have some payment allocations but are not yet
// fully paid — i.e., this mutation may be a continuation payment.

export async function findSplitPaymentCandidates(
  mutationAmount: number,
  companyId: number,
  transactionDateStr: string,
): Promise<SplitPaymentCandidate[]> {
  const db = await getDb();
  try {
    // Find invoices in payment_allocations that are partially paid for this company
    const { rows } = await db.execute(sql.raw(`
      SELECT
        pa.invoice_id,
        pa.invoice_ref,
        sd.total_amount AS invoice_amount,
        SUM(pa.allocated_amount) AS total_paid_so_far,
        COUNT(pa.id)             AS payment_count
      FROM payment_allocations pa
      JOIN sales_documents sd
        ON sd.id = pa.invoice_id AND sd.doc_type = 'invoice'
      WHERE pa.company_id    = ${companyId}
        AND pa.is_active     = TRUE
        AND sd.company_id    = ${companyId}
        AND sd.status NOT IN ('paid','cancelled','void')
      GROUP BY pa.invoice_id, pa.invoice_ref, sd.total_amount
      HAVING SUM(pa.allocated_amount) < sd.total_amount * 1.01
      ORDER BY SUM(pa.allocated_amount) DESC
      LIMIT 50
    `));

    const candidates: SplitPaymentCandidate[] = [];

    for (const r of rows as Array<Record<string, unknown>>) {
      const invoiceAmount = Number(r["invoice_amount"] ?? 0);
      const totalPaid = Number(r["total_paid_so_far"] ?? 0);
      const remaining = Math.max(0, invoiceAmount - totalPaid);

      // Only include if this mutation could contribute meaningfully
      if (mutationAmount > invoiceAmount * 1.1) continue;
      if (remaining < mutationAmount * 0.01) continue;

      const paymentCount = Number(r["payment_count"] ?? 0);
      const { confidence, explanation } = buildSplitConfidence(invoiceAmount, totalPaid + mutationAmount, paymentCount + 1);

      candidates.push({
        invoiceId: Number(r["invoice_id"]),
        invoiceRef: String(r["invoice_ref"] ?? ""),
        invoiceAmount,
        totalPaidSoFar: totalPaid,
        remainingAmount: remaining,
        status: classifyInvoiceStatus(invoiceAmount, totalPaid),
        paymentCount,
        confidence,
        explanation,
      });
    }

    return candidates.sort((a, b) => b.confidence - a.confidence);
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[splitPaymentEngine] findSplitPaymentCandidates failed");
    return [];
  }
}

// ─── Record a split payment ───────────────────────────────────────────────────
// Creates or updates a payment_matching_groups row and inserts a
// payment_allocations row. Returns the group id.

export async function recordSplitPayment(params: {
  invoiceId: number;
  invoiceRef: string;
  invoiceAmount: number;
  mutationId: number;
  allocatedAmount: number;
  companyId: number;
  actor: string;
}): Promise<{ groupId: number; allocationId: number; newStatus: InvoicePaymentStatus }> {
  const { invoiceId, invoiceRef, invoiceAmount, mutationId, allocatedAmount, companyId, actor } = params;
  const db = await getDb();
  return db.transaction(async (tx) => {
    // Find or create group for this invoice
    const { rows: existing } = await tx.execute(sql.raw(`
      SELECT pmg.id, pmg.total_allocated
      FROM payment_matching_groups pmg
      JOIN payment_allocations pa ON pa.group_id = pmg.id
      WHERE pa.invoice_id = ${invoiceId}
        AND pmg.company_id = ${companyId}
        AND pmg.status = 'active'
        AND pmg.group_type = 'SPLIT_PAYMENT'
      LIMIT 1
    `));

    let groupId: number;

    if (existing.length > 0) {
      groupId = Number((existing[0] as any).id);
      const prevAllocated = Number((existing[0] as any).total_allocated ?? 0);
      const newTotal = prevAllocated + allocatedAmount;
      const remaining = Math.max(0, invoiceAmount - newTotal);
      await tx.execute(sql.raw(`
        UPDATE payment_matching_groups
        SET total_allocated = ${newTotal},
            remaining_amount = ${remaining},
            total_mutation_amount = total_mutation_amount + ${allocatedAmount},
            updated_at = NOW()
        WHERE id = ${groupId}
      `));
    } else {
      const remaining = Math.max(0, invoiceAmount - allocatedAmount);
      const { rows: grpRows } = await tx.execute(sql.raw(`
        INSERT INTO payment_matching_groups
          (company_id, group_type, matching_type,
           total_mutation_amount, total_invoice_amount, total_allocated, remaining_amount,
           confidence, algorithm_used, status, created_by)
        VALUES
          (${companyId}, 'SPLIT_PAYMENT', 'SPLIT_PAYMENT',
           ${allocatedAmount}, ${invoiceAmount}, ${allocatedAmount}, ${remaining},
           0, 'SPLIT_PAYMENT_ENGINE', 'active', '${actor.replace(/'/g, "''")}')
        RETURNING id
      `));
      groupId = Number((grpRows[0] as any).id);
    }

    // Get existing allocation count for this invoice (for sequence)
    const { rows: seqRows } = await tx.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM payment_allocations
      WHERE invoice_id = ${invoiceId} AND company_id = ${companyId} AND is_active = TRUE
    `));
    const sequence = Number((seqRows[0] as any)?.cnt ?? 0) + 1;

    // Determine remaining after this allocation
    const { rows: prevTotalRows } = await tx.execute(sql.raw(`
      SELECT COALESCE(SUM(allocated_amount), 0) AS prev_total
      FROM payment_allocations
      WHERE invoice_id = ${invoiceId} AND company_id = ${companyId} AND is_active = TRUE
    `));
    const prevTotal = Number((prevTotalRows[0] as any)?.prev_total ?? 0);
    const remainingAfter = Math.max(0, invoiceAmount - prevTotal - allocatedAmount);

    // Insert allocation (immutable)
    const { rows: allocRows } = await tx.execute(sql.raw(`
      INSERT INTO payment_allocations
        (group_id, company_id, invoice_id, invoice_ref, mutation_id,
         allocated_amount, remaining_amount, allocation_sequence, strategy, is_active)
      VALUES
        (${groupId}, ${companyId}, ${invoiceId}, '${invoiceRef.replace(/'/g, "''")}', ${mutationId},
         ${allocatedAmount}, ${remainingAfter}, ${sequence}, 'MANUAL', TRUE)
      RETURNING id
    `));
    const allocationId = Number((allocRows[0] as any).id);

    // Audit
    const newStatus = classifyInvoiceStatus(invoiceAmount, prevTotal + allocatedAmount);
    const meta = JSON.stringify({
      invoiceId, invoiceRef, invoiceAmount,
      mutationId, allocatedAmount, sequence,
      newStatus, actor,
    }).replace(/'/g, "''");
    await tx.execute(sql.raw(`
      INSERT INTO allocation_history (allocation_id, group_id, company_id, event_type, actor, meta)
      VALUES (${allocationId}, ${groupId}, ${companyId}, 'SPLIT_PAYMENT_RECORDED',
              '${actor.replace(/'/g, "''")}', '${meta}')
    `));

    return { groupId, allocationId, newStatus };
  });
}

// ─── Get full split payment group ─────────────────────────────────────────────

export async function getSplitPaymentGroup(
  invoiceId: number,
  companyId: number,
): Promise<SplitPaymentGroup | null> {
  const db = await getDb();
  try {
    const { rows: allocRows } = await db.execute(sql.raw(`
      SELECT pa.mutation_id, pa.allocated_amount, bm.transaction_date
      FROM payment_allocations pa
      LEFT JOIN bank_mutations bm ON bm.id = pa.mutation_id
      WHERE pa.invoice_id = ${invoiceId}
        AND pa.company_id = ${companyId}
        AND pa.is_active  = TRUE
      ORDER BY pa.allocation_sequence ASC
    `));

    if (!allocRows.length) return null;

    const { rows: invRows } = await db.execute(sql.raw(`
      SELECT id, doc_number, total_amount
      FROM sales_documents
      WHERE id = ${invoiceId} AND doc_type = 'invoice'
      LIMIT 1
    `));
    if (!invRows.length) return null;

    const inv = invRows[0] as any;
    const invoiceAmount = Number(inv.total_amount ?? 0);
    const payments = (allocRows as any[]).map(r => ({
      mutationId: Number(r.mutation_id),
      amount: Number(r.allocated_amount),
      paidAt: String(r.transaction_date ?? ""),
    }));
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
    const remaining = Math.max(0, invoiceAmount - totalPaid);
    const status = classifyInvoiceStatus(invoiceAmount, totalPaid);
    const { confidence, explanation } = buildSplitConfidence(invoiceAmount, totalPaid, payments.length);

    return {
      invoiceId,
      invoiceRef: String(inv.doc_number ?? ""),
      invoiceAmount,
      companyId,
      payments,
      totalPaid,
      remaining,
      status,
      confidence,
      explanation,
    };
  } catch (e: any) {
    logger.warn({ err: e.message, invoiceId }, "[splitPaymentEngine] getSplitPaymentGroup failed");
    return null;
  }
}

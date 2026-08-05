/**
 * Partial Payment Engine — Batch 3 Phase 3
 *
 * Manages the payment_allocations entity.
 * All allocations are IMMUTABLE — never updated, only deactivated via
 * allocation_history (soft-delete pattern).
 *
 * Provides:
 *  - createPaymentAllocation  : insert one allocation row
 *  - getInvoiceAllocations    : fetch all active allocations for an invoice
 *  - getMutationAllocations   : fetch all active allocations for a mutation
 *  - getRemainingAmount       : invoice.total_amount − sum(allocated)
 *  - deactivateAllocation     : soft-delete with audit event
 */

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { db as DrizzleDb } from "@workspace/db";

// Lazy DB loader — engine is pure (no DB connection on import)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type AllocationStrategy = "FIFO" | "LIFO" | "DUE_DATE" | "REFERENCE" | "MANUAL";

export interface PaymentAllocation {
  id: number;
  groupId: number | null;
  companyId: number;
  invoiceId: number;
  invoiceRef: string;
  mutationId: number;
  paymentId: number | null;
  allocatedAmount: number;
  remainingAmount: number;
  allocationSequence: number;
  strategy: AllocationStrategy;
  isActive: boolean;
  createdAt: string;
}

export interface CreateAllocationParams {
  groupId?: number | null;
  companyId: number;
  invoiceId: number;
  invoiceRef: string;
  mutationId: number;
  paymentId?: number | null;
  allocatedAmount: number;
  remainingAmount?: number;
  strategy?: AllocationStrategy;
  actor: string;
}

// ─── Create ───────────────────────────────────────────────────────────────────

export async function createPaymentAllocation(
  params: CreateAllocationParams,
): Promise<number> {
  const {
    groupId = null,
    companyId,
    invoiceId,
    invoiceRef,
    mutationId,
    paymentId = null,
    allocatedAmount,
    remainingAmount,
    strategy = "MANUAL",
    actor,
  } = params;
  const db = await getDb();

  // Determine sequence
  const { rows: seqRows } = await db.execute(sql.raw(`
    SELECT COALESCE(MAX(allocation_sequence), 0) AS max_seq
    FROM payment_allocations
    WHERE invoice_id = ${invoiceId} AND company_id = ${companyId}
  `));
  const sequence = Number((seqRows[0] as any)?.max_seq ?? 0) + 1;

  // Compute remaining if not supplied
  let rem = remainingAmount;
  if (rem === undefined) {
    const { rows: sumRows } = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(allocated_amount), 0) AS paid
      FROM payment_allocations
      WHERE invoice_id = ${invoiceId} AND company_id = ${companyId} AND is_active = TRUE
    `));
    const alreadyPaid = Number((sumRows[0] as any)?.paid ?? 0);

    const { rows: invRows } = await db.execute(sql.raw(`
      SELECT total_amount FROM sales_documents WHERE id = ${invoiceId} AND doc_type = 'invoice' LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));
    const invoiceTotal = Number((invRows[0] as any)?.total_amount ?? 0);
    rem = Math.max(0, invoiceTotal - alreadyPaid - allocatedAmount);
  }

  const groupClause = groupId !== null ? String(groupId) : "NULL";

  const { rows: allocRows } = await db.execute(sql.raw(`
    INSERT INTO payment_allocations
      (group_id, company_id, invoice_id, invoice_ref, mutation_id,
       payment_id, allocated_amount, remaining_amount,
       allocation_sequence, strategy, is_active)
    VALUES
      (${groupClause}, ${companyId}, ${invoiceId},
       '${invoiceRef.replace(/'/g, "''")}', ${mutationId},
       ${paymentId !== null ? String(paymentId) : "NULL"},
       ${allocatedAmount}, ${rem},
       ${sequence}, '${strategy}', TRUE)
    RETURNING id
  `));
  const allocationId = Number((allocRows[0] as any).id);

  // Audit
  await db.execute(sql.raw(`
    INSERT INTO allocation_history (allocation_id, group_id, company_id, event_type, actor, meta)
    VALUES (${allocationId}, ${groupClause}, ${companyId}, 'ALLOCATION_CREATED',
            '${actor.replace(/'/g, "''")}',
            '${JSON.stringify({ invoiceId, invoiceRef, mutationId, allocatedAmount, strategy, sequence }).replace(/'/g, "''")}')
  `)).catch(() => {});

  return allocationId;
}

// ─── Query ────────────────────────────────────────────────────────────────────

export async function getInvoiceAllocations(
  invoiceId: number,
  companyId: number,
  includeInactive = false,
): Promise<PaymentAllocation[]> {
  const db = await getDb();
  try {
    const activeClause = includeInactive ? "" : "AND is_active = TRUE";
    const { rows } = await db.execute(sql.raw(`
      SELECT id, group_id, company_id, invoice_id, invoice_ref, mutation_id,
             payment_id, allocated_amount, remaining_amount, allocation_sequence,
             strategy, is_active, created_at
      FROM payment_allocations
      WHERE invoice_id = ${invoiceId} AND company_id = ${companyId}
        ${activeClause}
      ORDER BY allocation_sequence ASC
    `));
    return (rows as any[]).map(rowToAllocation);
  } catch (e: any) {
    logger.warn({ err: e.message, invoiceId }, "[partialPaymentEngine] getInvoiceAllocations failed");
    return [];
  }
}

export async function getMutationAllocations(
  mutationId: number,
  companyId: number,
): Promise<PaymentAllocation[]> {
  const db = await getDb();
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, group_id, company_id, invoice_id, invoice_ref, mutation_id,
             payment_id, allocated_amount, remaining_amount, allocation_sequence,
             strategy, is_active, created_at
      FROM payment_allocations
      WHERE mutation_id = ${mutationId} AND company_id = ${companyId} AND is_active = TRUE
      ORDER BY allocation_sequence ASC
    `));
    return (rows as any[]).map(rowToAllocation);
  } catch (e: any) {
    logger.warn({ err: e.message, mutationId }, "[partialPaymentEngine] getMutationAllocations failed");
    return [];
  }
}

export async function getRemainingAmount(
  invoiceId: number,
  companyId: number,
): Promise<{ remaining: number; invoiceTotal: number; totalPaid: number }> {
  const db = await getDb();
  try {
    const { rows: invRows } = await db.execute(sql.raw(`
      SELECT total_amount FROM sales_documents
      WHERE id = ${invoiceId} AND doc_type = 'invoice' LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));
    const invoiceTotal = Number((invRows[0] as any)?.total_amount ?? 0);

    const { rows: sumRows } = await db.execute(sql.raw(`
      SELECT COALESCE(SUM(allocated_amount), 0) AS paid
      FROM payment_allocations
      WHERE invoice_id = ${invoiceId} AND company_id = ${companyId} AND is_active = TRUE
    `));
    const totalPaid = Number((sumRows[0] as any)?.paid ?? 0);
    const remaining = Math.max(0, invoiceTotal - totalPaid);

    return { remaining, invoiceTotal, totalPaid };
  } catch (e: any) {
    logger.warn({ err: e.message, invoiceId }, "[partialPaymentEngine] getRemainingAmount failed");
    return { remaining: 0, invoiceTotal: 0, totalPaid: 0 };
  }
}

// ─── Deactivate (soft-delete) ─────────────────────────────────────────────────

export async function deactivateAllocation(
  allocationId: number,
  companyId: number,
  actor: string,
  reason: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(sql.raw(`
    UPDATE payment_allocations
    SET is_active = FALSE
    WHERE id = ${allocationId} AND company_id = ${companyId}
  `)).catch(() => {});

  await db.execute(sql.raw(`
    INSERT INTO allocation_history (allocation_id, company_id, event_type, actor, meta)
    VALUES (${allocationId}, ${companyId}, 'ALLOCATION_DEACTIVATED',
            '${actor.replace(/'/g, "''")}',
            '${JSON.stringify({ reason }).replace(/'/g, "''")}')
  `)).catch(() => {});
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function rowToAllocation(r: any): PaymentAllocation {
  return {
    id: Number(r.id),
    groupId: r.group_id != null ? Number(r.group_id) : null,
    companyId: Number(r.company_id),
    invoiceId: Number(r.invoice_id),
    invoiceRef: String(r.invoice_ref ?? ""),
    mutationId: Number(r.mutation_id),
    paymentId: r.payment_id != null ? Number(r.payment_id) : null,
    allocatedAmount: Number(r.allocated_amount),
    remainingAmount: Number(r.remaining_amount),
    allocationSequence: Number(r.allocation_sequence),
    strategy: String(r.strategy ?? "MANUAL") as AllocationStrategy,
    isActive: Boolean(r.is_active),
    createdAt: String(r.created_at ?? ""),
  };
}

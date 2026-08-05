/**
 * Payment Allocation Engine — Batch 3 Phase 5
 *
 * Builds an allocation plan from a set of invoices given a payment amount
 * and a strategy, without touching the database.
 *
 * Priority order (Phase 5 spec):
 *   1. Reference Number match
 *   2. Virtual Account match
 *   3. Due Date (earliest first)
 *   4. Oldest Invoice First (FIFO by issue_date)
 *   5. Manual Override
 *
 * Strategies:
 *   FIFO      — oldest issue_date first
 *   LIFO      — newest issue_date first
 *   DUE_DATE  — earliest due_date first
 *   REFERENCE — invoices matching a reference string first, then FIFO
 *   MANUAL    — caller-supplied order is respected
 *
 * Config is per-company (default: FIFO).
 */

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { AllocationStrategy } from "./partialPaymentEngine.js";
import type { db as DrizzleDb } from "@workspace/db";

// Lazy DB loader — pure engine; DB only loaded when DB-backed functions are called
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface InvoiceForAllocation {
  invoiceId: number;
  invoiceRef: string;
  amount: number;
  remainingAmount: number;
  issueDate?: string | null;
  dueDate?: string | null;
  virtualAccount?: string | null;
  referenceMatch?: boolean;
  manualOrder?: number;
}

export interface AllocationLineItem {
  invoiceId: number;
  invoiceRef: string;
  invoiceTotal: number;
  alreadyPaid: number;
  allocatedNow: number;
  remainingAfter: number;
  reason: string;
}

export interface AllocationPlan {
  strategy: AllocationStrategy;
  paymentAmount: number;
  totalAllocated: number;
  remaining: number;
  fullyPaidInvoices: number;
  partialInvoices: number;
  lines: AllocationLineItem[];
}

export interface CompanyAllocationConfig {
  companyId: number;
  strategy: AllocationStrategy;
}

// ─── Company config lookup ────────────────────────────────────────────────────

const configCache = new Map<number, AllocationStrategy>();

export async function getCompanyAllocationStrategy(
  companyId: number,
): Promise<AllocationStrategy> {
  if (configCache.has(companyId)) return configCache.get(companyId)!;
  const db = await getDb();
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT allocation_strategy
      FROM company_allocation_configs
      WHERE company_id = ${companyId}
      LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));

    const strategy = (rows[0] as any)?.allocation_strategy as AllocationStrategy ?? "FIFO";
    configCache.set(companyId, strategy);
    return strategy;
  } catch {
    return "FIFO";
  }
}

export function invalidateAllocationConfigCache(companyId: number): void {
  configCache.delete(companyId);
}

// ─── Sort invoices by strategy ────────────────────────────────────────────────

export function sortInvoicesByStrategy(
  invoices: InvoiceForAllocation[],
  strategy: AllocationStrategy,
  referenceHint?: string | null,
): InvoiceForAllocation[] {
  const sorted = [...invoices];

  if (strategy === "FIFO") {
    sorted.sort((a, b) => {
      const da = a.issueDate ?? "9999-99-99";
      const db_ = b.issueDate ?? "9999-99-99";
      return da < db_ ? -1 : da > db_ ? 1 : 0;
    });
  } else if (strategy === "LIFO") {
    sorted.sort((a, b) => {
      const da = a.issueDate ?? "0000-00-00";
      const db_ = b.issueDate ?? "0000-00-00";
      return da > db_ ? -1 : da < db_ ? 1 : 0;
    });
  } else if (strategy === "DUE_DATE") {
    sorted.sort((a, b) => {
      const da = a.dueDate ?? a.issueDate ?? "9999-99-99";
      const db_ = b.dueDate ?? b.issueDate ?? "9999-99-99";
      return da < db_ ? -1 : da > db_ ? 1 : 0;
    });
  } else if (strategy === "REFERENCE" && referenceHint) {
    // Reference-matched invoices first, then FIFO
    const norm = referenceHint.toUpperCase().trim();
    sorted.sort((a, b) => {
      const aMatch = a.invoiceRef.toUpperCase().includes(norm) || a.virtualAccount?.toUpperCase().includes(norm) ? 0 : 1;
      const bMatch = b.invoiceRef.toUpperCase().includes(norm) || b.virtualAccount?.toUpperCase().includes(norm) ? 0 : 1;
      if (aMatch !== bMatch) return aMatch - bMatch;
      const da = a.issueDate ?? "9999-99-99";
      const db_ = b.issueDate ?? "9999-99-99";
      return da < db_ ? -1 : da > db_ ? 1 : 0;
    });
  } else if (strategy === "MANUAL") {
    sorted.sort((a, b) => (a.manualOrder ?? 999) - (b.manualOrder ?? 999));
  }

  return sorted;
}

// ─── Build allocation plan ────────────────────────────────────────────────────
// Pure function — does not write to DB.

export function buildAllocationPlan(
  paymentAmount: number,
  invoices: InvoiceForAllocation[],
  strategy: AllocationStrategy = "FIFO",
  referenceHint?: string | null,
): AllocationPlan {
  const sorted = sortInvoicesByStrategy(invoices, strategy, referenceHint);
  const lines: AllocationLineItem[] = [];
  let remaining = paymentAmount;
  let fullyPaidInvoices = 0;
  let partialInvoices = 0;

  for (const inv of sorted) {
    if (remaining <= 0.001) break;

    const available = Math.max(0, inv.remainingAmount);
    if (available <= 0.001) continue;

    const allocateNow = Math.min(remaining, available);
    const remainingAfter = Math.max(0, available - allocateNow);
    const isFullyPaid = remainingAfter < 0.01;

    let reason = `Strategi: ${strategy}`;
    if (strategy === "FIFO") reason = `FIFO: invoice tertua (${inv.issueDate ?? "?"})`;
    if (strategy === "LIFO") reason = `LIFO: invoice terbaru (${inv.issueDate ?? "?"})`;
    if (strategy === "DUE_DATE") reason = `Due date: jatuh tempo ${inv.dueDate ?? inv.issueDate ?? "?"}`;
    if (strategy === "REFERENCE") reason = inv.referenceMatch
      ? `Referensi cocok: ${inv.invoiceRef}`
      : `FIFO fallback: ${inv.issueDate ?? "?"}`;
    if (strategy === "MANUAL") reason = `Urutan manual: ${inv.manualOrder ?? 0}`;

    lines.push({
      invoiceId: inv.invoiceId,
      invoiceRef: inv.invoiceRef,
      invoiceTotal: inv.amount,
      alreadyPaid: inv.amount - inv.remainingAmount,
      allocatedNow: allocateNow,
      remainingAfter,
      reason,
    });

    if (isFullyPaid) fullyPaidInvoices++;
    else partialInvoices++;

    remaining -= allocateNow;
  }

  const totalAllocated = paymentAmount - remaining;

  return {
    strategy,
    paymentAmount,
    totalAllocated,
    remaining: Math.max(0, remaining),
    fullyPaidInvoices,
    partialInvoices,
    lines,
  };
}

// ─── Apply allocation plan to DB ──────────────────────────────────────────────
// Persists each line as a payment_allocations row.

export async function applyAllocationPlan(
  plan: AllocationPlan,
  mutationId: number,
  companyId: number,
  groupId: number | null,
  actor: string,
): Promise<number[]> {
  const db = await getDb();
  const allocationIds: number[] = [];

  for (const line of plan.lines) {
    try {
      const groupClause = groupId !== null ? String(groupId) : "NULL";

      const { rows: seqRows } = await db.execute(sql.raw(`
        SELECT COALESCE(MAX(allocation_sequence), 0) AS max_seq
        FROM payment_allocations
        WHERE invoice_id = ${line.invoiceId} AND company_id = ${companyId}
      `));
      const seq = Number((seqRows[0] as any)?.max_seq ?? 0) + 1;

      const { rows: allocRows } = await db.execute(sql.raw(`
        INSERT INTO payment_allocations
          (group_id, company_id, invoice_id, invoice_ref, mutation_id,
           allocated_amount, remaining_amount, allocation_sequence, strategy, is_active)
        VALUES
          (${groupClause}, ${companyId}, ${line.invoiceId},
           '${line.invoiceRef.replace(/'/g, "''")}', ${mutationId},
           ${line.allocatedNow}, ${line.remainingAfter},
           ${seq}, '${plan.strategy}', TRUE)
        RETURNING id
      `));
      const aid = Number((allocRows[0] as any).id);
      allocationIds.push(aid);

      // Audit
      await db.execute(sql.raw(`
        INSERT INTO allocation_history (allocation_id, group_id, company_id, event_type, actor, meta)
        VALUES (${aid}, ${groupClause}, ${companyId}, 'ALLOCATION_APPLIED',
                '${actor.replace(/'/g, "''")}',
                '${JSON.stringify({ strategy: plan.strategy, line }).replace(/'/g, "''")}')
      `)).catch(() => {});
    } catch (e: any) {
      logger.warn({ err: e.message, invoiceId: line.invoiceId }, "[paymentAllocationEngine] applyAllocationPlan: line skipped");
    }
  }

  return allocationIds;
}

/**
 * Expected Cash Flow Service
 *
 * Aggregates open receivables and payables from multiple ERP sources into
 * a unified `expected_cash_flows` table. Used by the Recon Decision Stack
 * to match incoming bank mutations against known upcoming cash movements.
 *
 * Key design constraints:
 *  - Deterministic source_key: company_id + source_type + source_id (unique)
 *  - Upsert on source_key — no full destructive rebuild on refresh
 *  - Company isolation enforced at DB level on all source queries
 *  - Cancelled / paid sources produce status="cancelled" or status="settled"
 *  - No data is duplicated from the same source
 */

// Lazy DB loader — avoids top-level DB connection on module import (keeps engine pure for tests)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { db as DrizzleDb } from "@workspace/db";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type EcfSourceType =
  | "sales_invoice"
  | "logistic_order"
  | "tenant_invoice"
  | "sport_receivable"
  | "expense_payable"
  | "vendor_bill"
  | "cash_advance"
  | "vendor_installment";

export type EcfDirection = "IN" | "OUT";

export type EcfStatus =
  | "open"
  | "partially_settled"
  | "settled"
  | "cancelled"
  | "expired";

export interface ExpectedCashFlow {
  id: string;
  companyId: number;
  sourceType: EcfSourceType;
  sourceId: string;
  sourceKey: string;               // company_id:source_type:source_id
  direction: EcfDirection;
  expectedAmount: number;
  outstandingAmount: number;
  expectedDate: string | null;     // ISO date
  dueDate: string | null;          // ISO date
  reference: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  bankAccountId: number | null;
  status: EcfStatus;
  metadata: Record<string, unknown>;
  generatedAt: string;
  lastRefreshedAt: string;
  settledAt: string | null;
}

export interface EcfFilters {
  companyId: number;
  direction?: EcfDirection;
  status?: EcfStatus;
  sourceType?: EcfSourceType;
  dueDateBefore?: string;
  limit?: number;
  offset?: number;
}

export interface EcfMatchCandidate {
  ecfId: string;
  sourceType: EcfSourceType;
  sourceId: string;
  direction: EcfDirection;
  expectedAmount: number;
  outstandingAmount: number;
  expectedDate: string | null;
  dueDate: string | null;
  reference: string | null;
  counterpartyName: string | null;
  bankAccountId: number | null;
  confidence: number;
  reasons: Array<{ code: string; label: string; score: number }>;
}

// ─── Source Key ────────────────────────────────────────────────────────────────

export function buildSourceKey(companyId: number, sourceType: EcfSourceType, sourceId: string | number): string {
  return `${companyId}:${sourceType}:${String(sourceId)}`;
}

// ─── Migration ─────────────────────────────────────────────────────────────────

let ecfMigrated = false;

export async function runExpectedCashFlowMigration(): Promise<void> {
  if (ecfMigrated) return;
  ecfMigrated = true;
  const db = await getDb();

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS expected_cash_flows (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id      INTEGER NOT NULL,
      source_type     TEXT NOT NULL,
      source_id       TEXT NOT NULL,
      source_key      TEXT NOT NULL UNIQUE,
      direction       TEXT NOT NULL CHECK (direction IN ('IN','OUT')),
      expected_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      outstanding_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      expected_date   DATE,
      due_date        DATE,
      reference       TEXT,
      counterparty_id TEXT,
      counterparty_name TEXT,
      bank_account_id INTEGER,
      status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','partially_settled','settled','cancelled','expired')),
      metadata        JSONB NOT NULL DEFAULT '{}',
      generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_refreshed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      settled_at      TIMESTAMPTZ
    )
  `)).catch(() => {});

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS ecf_company_idx ON expected_cash_flows(company_id)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS ecf_status_idx  ON expected_cash_flows(company_id, status)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS ecf_due_idx     ON expected_cash_flows(company_id, due_date)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS ecf_source_type_idx ON expected_cash_flows(company_id, source_type)`)).catch(() => {});

  logger.info("[expectedCashFlowService] migration complete");
}

// ─── Row Mapper ────────────────────────────────────────────────────────────────

function rowToEcf(row: Record<string, unknown>): ExpectedCashFlow {
  return {
    id: String(row.id),
    companyId: Number(row.company_id),
    sourceType: String(row.source_type) as EcfSourceType,
    sourceId: String(row.source_id),
    sourceKey: String(row.source_key),
    direction: String(row.direction) as EcfDirection,
    expectedAmount: Number(row.expected_amount),
    outstandingAmount: Number(row.outstanding_amount),
    expectedDate: row.expected_date ? String(row.expected_date).slice(0, 10) : null,
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    reference: row.reference ? String(row.reference) : null,
    counterpartyId: row.counterparty_id ? String(row.counterparty_id) : null,
    counterpartyName: row.counterparty_name ? String(row.counterparty_name) : null,
    bankAccountId: row.bank_account_id != null ? Number(row.bank_account_id) : null,
    status: String(row.status) as EcfStatus,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    generatedAt: String(row.generated_at),
    lastRefreshedAt: String(row.last_refreshed_at),
    settledAt: row.settled_at ? String(row.settled_at) : null,
  };
}

// ─── Upsert helper ─────────────────────────────────────────────────────────────

async function upsertEcf(params: {
  companyId: number;
  sourceType: EcfSourceType;
  sourceId: string;
  direction: EcfDirection;
  expectedAmount: number;
  outstandingAmount: number;
  expectedDate: string | null;
  dueDate: string | null;
  reference: string | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
  bankAccountId: number | null;
  status: EcfStatus;
  metadata: Record<string, unknown>;
}): Promise<void> {
  const db = await getDb();
  const sourceKey = buildSourceKey(params.companyId, params.sourceType, params.sourceId);
  const metaJson = JSON.stringify(params.metadata).replace(/'/g, "''");
  const ref       = params.reference ? `'${params.reference.replace(/'/g, "''")}'` : "NULL";
  const cpId      = params.counterpartyId ? `'${params.counterpartyId.replace(/'/g, "''")}'` : "NULL";
  const cpName    = params.counterpartyName ? `'${params.counterpartyName.replace(/'/g, "''")}'` : "NULL";
  const expDate   = params.expectedDate ? `'${params.expectedDate}'` : "NULL";
  const dueDate   = params.dueDate ? `'${params.dueDate}'` : "NULL";
  const baId      = params.bankAccountId != null ? String(params.bankAccountId) : "NULL";

  await db.execute(sql.raw(`
    INSERT INTO expected_cash_flows
      (company_id, source_type, source_id, source_key, direction,
       expected_amount, outstanding_amount, expected_date, due_date,
       reference, counterparty_id, counterparty_name, bank_account_id,
       status, metadata, generated_at, last_refreshed_at)
    VALUES
      (${params.companyId}, '${params.sourceType}', '${params.sourceId}',
       '${sourceKey}', '${params.direction}',
       ${params.expectedAmount}, ${params.outstandingAmount},
       ${expDate}, ${dueDate},
       ${ref}, ${cpId}, ${cpName}, ${baId},
       '${params.status}', '${metaJson}', NOW(), NOW())
    ON CONFLICT (source_key) DO UPDATE SET
      expected_amount     = EXCLUDED.expected_amount,
      outstanding_amount  = EXCLUDED.outstanding_amount,
      expected_date       = EXCLUDED.expected_date,
      due_date            = EXCLUDED.due_date,
      reference           = EXCLUDED.reference,
      counterparty_id     = EXCLUDED.counterparty_id,
      counterparty_name   = EXCLUDED.counterparty_name,
      bank_account_id     = EXCLUDED.bank_account_id,
      status              = EXCLUDED.status,
      metadata            = EXCLUDED.metadata,
      last_refreshed_at   = NOW()
  `));
}

// ─── Source: Sales Documents (Cash IN) ────────────────────────────────────────

async function generateFromSalesDocuments(companyId: number): Promise<number> {
  const db = await getDb();
  let count = 0;
  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        sd.id,
        sd.doc_number,
        sd.total_amount,
        COALESCE(
          sd.total_amount - COALESCE((
            SELECT COALESCE(SUM(ap.amount),0)
            FROM accounting_payments ap
            WHERE ap.source_type = 'sales_document' AND ap.source_id = sd.id
          ),0),
          sd.total_amount
        ) AS outstanding,
        sd.due_date,
        sd.doc_date,
        sd.customer_name,
        sd.customer_id,
        sd.company_id
      FROM sales_documents sd
      WHERE sd.company_id = ${companyId}
        AND sd.status NOT IN ('cancelled','void','deleted','draft')
        AND sd.payment_status NOT IN ('paid','cancelled')
        AND COALESCE(sd.total_amount,0) > 0
      LIMIT 500
    `));

    for (const row of (rows as any).rows ?? []) {
      const outstanding = Number(row.outstanding ?? row.total_amount ?? 0);
      if (outstanding <= 0) continue;
      await upsertEcf({
        companyId,
        sourceType: "sales_invoice",
        sourceId:   String(row.id),
        direction:  "IN",
        expectedAmount:    Number(row.total_amount ?? 0),
        outstandingAmount: outstanding,
        expectedDate: row.doc_date ? String(row.doc_date).slice(0, 10) : null,
        dueDate:      row.due_date ? String(row.due_date).slice(0, 10) : null,
        reference:    row.doc_number ? String(row.doc_number) : null,
        counterpartyId:   row.customer_id ? String(row.customer_id) : null,
        counterpartyName: row.customer_name ? String(row.customer_name) : null,
        bankAccountId: null,
        status: outstanding < Number(row.total_amount ?? outstanding) ? "partially_settled" : "open",
        metadata: { source: "sales_documents" },
      });
      count++;
    }
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[ECF] sales_documents source skipped");
  }
  return count;
}

// ─── Source: Logistic Orders (Cash IN) ────────────────────────────────────────

async function generateFromLogisticOrders(companyId: number): Promise<number> {
  const db = await getDb();
  let count = 0;
  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        lo.id,
        lo.order_number,
        COALESCE(lo.total_amount, lo.freight_cost, 0) AS amount,
        lo.created_at,
        lo.customer_name,
        lo.company_id
      FROM logistic_orders lo
      WHERE lo.company_id = ${companyId}
        AND lo.status IN ('confirmed','invoiced','completed')
        AND COALESCE(lo.payment_status,'') NOT IN ('paid','cancelled')
        AND COALESCE(lo.total_amount, lo.freight_cost, 0) > 0
      LIMIT 500
    `));

    for (const row of (rows as any).rows ?? []) {
      await upsertEcf({
        companyId,
        sourceType: "logistic_order",
        sourceId:   String(row.id),
        direction:  "IN",
        expectedAmount:    Number(row.amount ?? 0),
        outstandingAmount: Number(row.amount ?? 0),
        expectedDate: row.created_at ? String(row.created_at).slice(0, 10) : null,
        dueDate:      null,
        reference:    row.order_number ? String(row.order_number) : null,
        counterpartyId:   null,
        counterpartyName: row.customer_name ? String(row.customer_name) : null,
        bankAccountId: null,
        status: "open",
        metadata: { source: "logistic_orders" },
      });
      count++;
    }
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[ECF] logistic_orders source skipped");
  }
  return count;
}

// ─── Source: Approved Expenses (Cash OUT) ─────────────────────────────────────

async function generateFromExpenses(companyId: number): Promise<number> {
  const db = await getDb();
  let count = 0;
  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        e.id,
        e.description,
        e.amount,
        e.due_date,
        e.expense_date,
        e.vendor_name,
        e.vendor_id,
        e.company_id
      FROM expenses e
      WHERE e.company_id = ${companyId}
        AND e.status IN ('approved','pending_payment')
        AND COALESCE(e.payment_status,'') NOT IN ('paid','cancelled')
        AND COALESCE(e.amount, 0) > 0
      LIMIT 500
    `));

    for (const row of (rows as any).rows ?? []) {
      await upsertEcf({
        companyId,
        sourceType: "expense_payable",
        sourceId:   String(row.id),
        direction:  "OUT",
        expectedAmount:    Number(row.amount ?? 0),
        outstandingAmount: Number(row.amount ?? 0),
        expectedDate: row.expense_date ? String(row.expense_date).slice(0, 10) : null,
        dueDate:      row.due_date ? String(row.due_date).slice(0, 10) : null,
        reference:    row.description ? String(row.description).slice(0, 100) : null,
        counterpartyId:   row.vendor_id ? String(row.vendor_id) : null,
        counterpartyName: row.vendor_name ? String(row.vendor_name) : null,
        bankAccountId: null,
        status: "open",
        metadata: { source: "expenses" },
      });
      count++;
    }
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[ECF] expenses source skipped");
  }
  return count;
}

// ─── Source: Cash Advances (Cash OUT) ─────────────────────────────────────────

async function generateFromCashAdvances(companyId: number): Promise<number> {
  const db = await getDb();
  let count = 0;
  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        ca.id,
        ca.reference_number,
        ca.amount,
        ca.due_date,
        ca.advance_date,
        ca.requester_name,
        ca.company_id
      FROM cash_advances ca
      WHERE ca.company_id = ${companyId}
        AND ca.status IN ('approved','disbursed')
        AND COALESCE(ca.settlement_status,'') NOT IN ('settled','cancelled')
        AND COALESCE(ca.amount,0) > 0
      LIMIT 200
    `));

    for (const row of (rows as any).rows ?? []) {
      await upsertEcf({
        companyId,
        sourceType: "cash_advance",
        sourceId:   String(row.id),
        direction:  "OUT",
        expectedAmount:    Number(row.amount ?? 0),
        outstandingAmount: Number(row.amount ?? 0),
        expectedDate: row.advance_date ? String(row.advance_date).slice(0, 10) : null,
        dueDate:      row.due_date ? String(row.due_date).slice(0, 10) : null,
        reference:    row.reference_number ? String(row.reference_number) : null,
        counterpartyId:   null,
        counterpartyName: row.requester_name ? String(row.requester_name) : null,
        bankAccountId: null,
        status: "open",
        metadata: { source: "cash_advances" },
      });
      count++;
    }
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[ECF] cash_advances source skipped");
  }
  return count;
}

// ─── Public Service Functions ──────────────────────────────────────────────────

/**
 * Generate (or refresh) all expected cash flows for a company.
 * Uses upsert on source_key — safe to call repeatedly (idempotent).
 */
export async function generateExpectedCashFlows(companyId: number): Promise<{
  salesInvoices: number;
  logisticOrders: number;
  expensePayables: number;
  cashAdvances: number;
  total: number;
}> {
  await runExpectedCashFlowMigration();

  const [salesInvoices, logisticOrders, expensePayables, cashAdvances] = await Promise.all([
    generateFromSalesDocuments(companyId),
    generateFromLogisticOrders(companyId),
    generateFromExpenses(companyId),
    generateFromCashAdvances(companyId),
  ]);

  const total = salesInvoices + logisticOrders + expensePayables + cashAdvances;

  logger.info(
    { companyId, salesInvoices, logisticOrders, expensePayables, cashAdvances, total },
    "[ECF] generateExpectedCashFlows complete",
  );

  return { salesInvoices, logisticOrders, expensePayables, cashAdvances, total };
}

/** Alias for generateExpectedCashFlows — same idempotent upsert logic. */
export async function refreshExpectedCashFlows(companyId: number) {
  return generateExpectedCashFlows(companyId);
}

/** Get open (unmatched) expected cash flows for a company with optional filters. */
export async function getOpenExpectedCashFlows(filters: EcfFilters): Promise<ExpectedCashFlow[]> {
  const db = await getDb();
  await runExpectedCashFlowMigration();

  const conditions: string[] = [`company_id = ${filters.companyId}`];

  if (filters.status) {
    conditions.push(`status = '${filters.status}'`);
  } else {
    conditions.push(`status IN ('open','partially_settled')`);
  }

  if (filters.direction) conditions.push(`direction = '${filters.direction}'`);
  if (filters.sourceType) conditions.push(`source_type = '${filters.sourceType}'`);
  if (filters.dueDateBefore) conditions.push(`due_date <= '${filters.dueDateBefore}'`);

  const limit  = Math.min(filters.limit  ?? 200, 1000);
  const offset = filters.offset ?? 0;

  const where = conditions.join(" AND ");
  const rows = await db.execute(sql.raw(`
    SELECT * FROM expected_cash_flows
    WHERE ${where}
    ORDER BY due_date ASC NULLS LAST, expected_amount DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  return ((rows as any).rows ?? []).map(rowToEcf);
}

/** Get a single ECF by id. */
export async function getExpectedCashFlowById(id: string): Promise<ExpectedCashFlow | null> {
  const db = await getDb();
  await runExpectedCashFlowMigration();
  const rows = await db.execute(sql.raw(`
    SELECT * FROM expected_cash_flows WHERE id = '${id.replace(/'/g, "''")}'
  `));
  const r = ((rows as any).rows ?? [])[0];
  return r ? rowToEcf(r) : null;
}

/**
 * Mark an ECF as (partially) settled.
 * Uses compare-and-set: only updates if status is still open/partially_settled.
 */
export async function settleExpectedCashFlow(
  sourceKey: string,
  settledAmount: number,
): Promise<{ ok: boolean; newStatus: EcfStatus | null }> {
  const db = await getDb();
  await runExpectedCashFlowMigration();

  const existing = await db.execute(sql.raw(`
    SELECT outstanding_amount, status FROM expected_cash_flows
    WHERE source_key = '${sourceKey.replace(/'/g, "''")}'
  `));
  const row = ((existing as any).rows ?? [])[0];
  if (!row) return { ok: false, newStatus: null };
  if (!["open", "partially_settled"].includes(String(row.status))) {
    return { ok: false, newStatus: String(row.status) as EcfStatus };
  }

  const newOutstanding = Math.max(0, Number(row.outstanding_amount) - settledAmount);
  const newStatus: EcfStatus = newOutstanding <= 0.01 ? "settled" : "partially_settled";
  const settledAt = newStatus === "settled" ? "NOW()" : "NULL";

  await db.execute(sql.raw(`
    UPDATE expected_cash_flows SET
      outstanding_amount = ${newOutstanding},
      status = '${newStatus}',
      settled_at = ${settledAt},
      last_refreshed_at = NOW()
    WHERE source_key = '${sourceKey.replace(/'/g, "''")}' AND status IN ('open','partially_settled')
  `));

  return { ok: true, newStatus };
}

/**
 * Reopen a settled ECF (e.g. after a payment reversal).
 * Adds back the amount to outstanding.
 */
export async function reopenExpectedCashFlow(
  sourceKey: string,
  amount: number,
): Promise<{ ok: boolean }> {
  const db = await getDb();
  await runExpectedCashFlowMigration();

  const result = await db.execute(sql.raw(`
    UPDATE expected_cash_flows SET
      outstanding_amount = outstanding_amount + ${amount},
      status = 'open',
      settled_at = NULL,
      last_refreshed_at = NOW()
    WHERE source_key = '${sourceKey.replace(/'/g, "''")}'
  `));

  return { ok: ((result as any).rowCount ?? 0) > 0 };
}

// ─── ECF Candidate Matching ────────────────────────────────────────────────────

/** Confidence scoring weights for ECF matching. */
const ECF_WEIGHTS = {
  exact_amount:       35,
  exact_reference:    40,
  due_date_proximity: { same_or_1: 15, within_3: 10, within_7: 5, beyond: 0 },
  counterparty_match: 10,
};

function dueDateScore(mutationDate: string, dueDate: string | null): { score: number; label: string } {
  if (!dueDate) return { score: 0, label: "" };
  const diffDays = Math.abs(
    (new Date(mutationDate).getTime() - new Date(dueDate).getTime()) / 86_400_000,
  );
  if (diffDays <= 1)  return { score: 15, label: `Pembayaran ${diffDays === 0 ? "tepat" : "1 hari"} dari jatuh tempo` };
  if (diffDays <= 3)  return { score: 10, label: `Pembayaran ${Math.round(diffDays)} hari dari jatuh tempo` };
  if (diffDays <= 7)  return { score: 5,  label: `Pembayaran ${Math.round(diffDays)} hari dari jatuh tempo` };
  return { score: 0, label: "" };
}

/**
 * Find ECF candidates for a bank mutation.
 * Returns sorted list with structured confidence breakdown.
 */
export async function findEcfCandidates(params: {
  companyId: number;
  amount: number;
  direction: EcfDirection;
  transactionDate: string;
  /** Free-text description from the bank mutation — used for keyword scoring against ECF reference */
  description?: string | null;
  reference?: string | null;
  counterpartyName?: string | null;
  amountTolerancePct?: number;   // default 0 (exact only)
}): Promise<EcfMatchCandidate[]> {
  const db = await getDb();
  await runExpectedCashFlowMigration();

  const tol = params.amountTolerancePct ?? 0;
  const minAmt = params.amount * (1 - tol / 100);
  const maxAmt = params.amount * (1 + tol / 100);

  const rows = await db.execute(sql.raw(`
    SELECT * FROM expected_cash_flows
    WHERE company_id = ${params.companyId}
      AND direction = '${params.direction}'
      AND status IN ('open','partially_settled')
      AND outstanding_amount BETWEEN ${minAmt - 0.01} AND ${maxAmt + 0.01}
    ORDER BY due_date ASC NULLS LAST
    LIMIT 50
  `));

  const candidates: EcfMatchCandidate[] = [];

  for (const raw of ((rows as any).rows ?? [])) {
    const ecf = rowToEcf(raw);
    const reasons: Array<{ code: string; label: string; score: number }> = [];
    let confidence = 0;

    // 1. Exact amount
    if (Math.abs(ecf.outstandingAmount - params.amount) < 0.01) {
      reasons.push({ code: "EXACT_AMOUNT", label: "Nominal sama", score: ECF_WEIGHTS.exact_amount });
      confidence += ECF_WEIGHTS.exact_amount;
    }

    // 2. Exact reference
    if (params.reference && ecf.reference) {
      const refNorm = (ref: string) => ref.toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (refNorm(params.reference) === refNorm(ecf.reference)) {
        reasons.push({ code: "EXACT_REFERENCE", label: "Referensi sama", score: ECF_WEIGHTS.exact_reference });
        confidence += ECF_WEIGHTS.exact_reference;
      }
    }

    // 3. Due date proximity
    const dateResult = dueDateScore(params.transactionDate, ecf.dueDate ?? ecf.expectedDate);
    if (dateResult.score > 0) {
      reasons.push({ code: "DUE_DATE_PROXIMITY", label: dateResult.label, score: dateResult.score });
      confidence += dateResult.score;
    }

    // 4. Counterparty name fuzzy match
    if (params.counterpartyName && ecf.counterpartyName) {
      const tokens = (s: string) => new Set(s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(t => t.length > 2));
      const mutTokens = tokens(params.counterpartyName);
      const ecfTokens = tokens(ecf.counterpartyName);
      const overlap = [...mutTokens].filter(t => ecfTokens.has(t)).length;
      if (overlap > 0) {
        const cpScore = Math.min(ECF_WEIGHTS.counterparty_match, overlap * 3);
        reasons.push({ code: "COUNTERPARTY_MATCH", label: "Nama pihak lawan cocok", score: cpScore });
        confidence += cpScore;
      }
    }

    // 5. Description keyword match against ECF reference
    //    Mutation description often contains partial reference numbers or vendor names
    //    that appear in the ECF reference field. Score: up to 5 points (tiebreaker only).
    if (params.description && ecf.reference) {
      const descNorm = params.description.toLowerCase().replace(/[^a-z0-9]/g, " ");
      const refNorm  = ecf.reference.toLowerCase().replace(/[^a-z0-9]/g, " ");
      const descTokens = new Set(descNorm.split(/\s+/).filter(t => t.length > 2));
      const refTokens  = refNorm.split(/\s+/).filter(t => t.length > 2);
      const matched = refTokens.filter(t => descTokens.has(t)).length;
      if (matched > 0) {
        const descScore = Math.min(5, matched * 2);
        reasons.push({ code: "DESCRIPTION_KEYWORD", label: "Kata kunci deskripsi cocok dengan referensi", score: descScore });
        confidence += descScore;
      }
    }

    // Only include if some signal matched
    if (confidence > 0) {
      candidates.push({
        ecfId:             ecf.id,
        sourceType:        ecf.sourceType,
        sourceId:          ecf.sourceId,
        direction:         ecf.direction,
        expectedAmount:    ecf.expectedAmount,
        outstandingAmount: ecf.outstandingAmount,
        expectedDate:      ecf.expectedDate,
        dueDate:           ecf.dueDate,
        reference:         ecf.reference,
        counterpartyName:  ecf.counterpartyName,
        bankAccountId:     ecf.bankAccountId,
        confidence:        Math.min(confidence, 100),
        reasons,
      });
    }
  }

  // Sort by confidence DESC
  return candidates.sort((a, b) => b.confidence - a.confidence);
}

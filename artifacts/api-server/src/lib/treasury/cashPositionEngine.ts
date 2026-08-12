/**
 * Cash Position Engine — Batch 4 Phase 1
 *
 * Computes real-time cash position per company/bank/currency:
 *   - Current Cash        = opening_balance + net completed mutations
 *   - Available Cash      = currentCash − restrictedCash
 *   - Restricted Cash     = balances in restricted-type accounts
 *   - Outstanding Receivable = AR subledger OPEN/PARTIAL/OVERDUE
 *   - Outstanding Payable    = AP subledger OPEN/PARTIAL/OVERDUE
 *   - Expected Incoming   = AR due within 30d + future IN mutations
 *   - Expected Outgoing   = AP due within 30d + future OUT mutations
 *   - Net Position        = currentCash + expectedIncoming − expectedOutgoing
 *
 * NEVER modifies accounting engine, posting, reversal, or rule engine.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type {
  CashPosition,
  BankAccountPosition,
  TreasuryQueryParams,
} from "./types.js";
import { treasuryCache, CK, TREASURY_TTL } from "./treasuryCache.js";
import { recordMetric } from "./treasuryMetrics.js";

// ── Main entry point ──────────────────────────────────────────────────────────

export async function computeCashPosition(
  params: TreasuryQueryParams
): Promise<CashPosition> {
  const { companyId, asOf } = params;
  const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);
  const cacheKey = CK.cashPosition(companyId, asOfDate);

  const cached = treasuryCache.get<CashPosition>(cacheKey);
  if (cached) return cached;

  const t0 = performance.now();

  const [bankRows, arRow, apRow, arFutureRow, apFutureRow] = await Promise.all([
    fetchBankAccountBalances(companyId, asOfDate),
    fetchOutstandingAr(companyId),
    fetchOutstandingAp(companyId),
    fetchExpectedIncoming(companyId, asOfDate),
    fetchExpectedOutgoing(companyId, asOfDate),
  ]);

  const currentCash    = bankRows.reduce((s, r) => s + r.currentBalance, 0);
  const restrictedCash = bankRows.filter(r => r.isRestricted).reduce((s, r) => s + r.currentBalance, 0);
  const availableCash  = currentCash - restrictedCash;

  const outstandingReceivable = Number(arRow);
  const outstandingPayable    = Number(apRow);
  const expectedIncoming      = Number(arFutureRow);
  const expectedOutgoing      = Number(apFutureRow);
  const netPosition           = currentCash + expectedIncoming - expectedOutgoing;

  const latencyMs = performance.now() - t0;

  const result: CashPosition = {
    companyId,
    asOf: asOfDate,
    currency: 'IDR',
    currentCash:           round2(currentCash),
    availableCash:         round2(availableCash),
    restrictedCash:        round2(restrictedCash),
    outstandingReceivable: round2(outstandingReceivable),
    outstandingPayable:    round2(outstandingPayable),
    expectedIncoming:      round2(expectedIncoming),
    expectedOutgoing:      round2(expectedOutgoing),
    netPosition:           round2(netPosition),
    bankAccounts:          bankRows,
    computedAt:            new Date().toISOString(),
    latencyMs:             round2(latencyMs),
  };

  treasuryCache.set(cacheKey, result, TREASURY_TTL.CASH_POSITION);
  recordMetric('cash_position_latency_ms', latencyMs, { companyId });

  return result;
}

// ── Queries ───────────────────────────────────────────────────────────────────

async function fetchBankAccountBalances(
  companyId: number,
  asOfDate: string
): Promise<BankAccountPosition[]> {
  const { rows } = await db.execute<{
    account_id: string;
    account_name: string;
    bank_name: string | null;
    account_number: string | null;
    currency: string;
    opening_balance: string;
    account_type: string;
    net_mutations: string;
  }>(sql.raw(`
    SELECT
      cba.id            AS account_id,
      cba.name          AS account_name,
      cba.bank_name,
      cba.account_number,
      cba.currency,
      COALESCE(cba.opening_balance, 0) AS opening_balance,
      cba.account_type,
      COALESCE(SUM(
        CASE WHEN bm.direction = 'IN' THEN bm.amount
             WHEN bm.direction = 'OUT' THEN -bm.amount
             ELSE 0 END
      ), 0) AS net_mutations
    FROM company_bank_accounts cba
    LEFT JOIN bank_mutations bm
      ON (
        (
          bm.bank_account_id ~ '^[0-9]+$'
          AND bm.bank_account_id::numeric BETWEEN -2147483648 AND 2147483647
          AND cba.id = bm.bank_account_id::integer
        )
        OR cba.account_number::text = bm.bank_account_id::text
      )
     AND bm.transaction_date::date <= '${asOfDate}'
     AND bm.status NOT IN ('void', 'rejected')
    WHERE cba.company_id = ${companyId}
      AND cba.is_active = true
    GROUP BY cba.id
    ORDER BY cba.id
  `));

  return rows.map(r => {
    const opening = Number(r.opening_balance);
    const net     = Number(r.net_mutations);
    const balance = opening + net;
    const isRestricted = (r.account_type ?? '').toLowerCase().includes('restricted');
    return {
      accountId:      Number(r.account_id),
      accountName:    r.account_name,
      bankName:       r.bank_name,
      accountNumber:  r.account_number,
      currency:       r.currency ?? 'IDR',
      openingBalance: round2(opening),
      netMutations:   round2(net),
      currentBalance: round2(balance),
      isRestricted,
    };
  });
}

async function fetchOutstandingAr(companyId: number): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(outstanding_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN', 'PARTIAL', 'OVERDUE')
  `));
  return Number(rows[0]?.total ?? 0);
}

async function fetchOutstandingAp(companyId: number): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(payable_amount - COALESCE(paid_amount, 0)), 0) AS total
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN', 'PARTIAL', 'OVERDUE')
  `));
  return Number(rows[0]?.total ?? 0);
}

/** Expected Incoming = AR due within 30 days from asOf */
async function fetchExpectedIncoming(
  companyId: number,
  asOfDate: string
): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(outstanding_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN', 'PARTIAL', 'OVERDUE')
      AND due_date IS NOT NULL
      AND due_date <= ('${asOfDate}'::date + INTERVAL '30 days')
  `));
  return Number(rows[0]?.total ?? 0);
}

/** Expected Outgoing = AP due within 30 days from asOf */
async function fetchExpectedOutgoing(
  companyId: number,
  asOfDate: string
): Promise<number> {
  const { rows } = await db.execute<{ total: string }>(sql.raw(`
    SELECT COALESCE(SUM(payable_amount - COALESCE(paid_amount, 0)), 0) AS total
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN', 'PARTIAL', 'OVERDUE')
      AND due_date IS NOT NULL
      AND due_date <= ('${asOfDate}'::date + INTERVAL '30 days')
  `));
  return Number(rows[0]?.total ?? 0);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Snapshot persistence ──────────────────────────────────────────────────────

export async function persistCashPositionSnapshot(
  position: CashPosition,
  createdBy?: string
): Promise<number> {
  const { rows } = await db.execute<{ id: string }>(sql.raw(`
    INSERT INTO cash_position_snapshot
      (company_id, snapshot_date, currency, current_cash, available_cash,
       restricted_cash, outstanding_receivable, outstanding_payable,
       expected_incoming, expected_outgoing, net_position, snapshot_type, created_by)
    VALUES (
      ${position.companyId},
      '${position.asOf}',
      '${position.currency}',
      ${position.currentCash},
      ${position.availableCash},
      ${position.restrictedCash},
      ${position.outstandingReceivable},
      ${position.outstandingPayable},
      ${position.expectedIncoming},
      ${position.expectedOutgoing},
      ${position.netPosition},
      'auto',
      ${createdBy ? `'${createdBy.replace(/'/g, "''")}'` : 'NULL'}
    )
    RETURNING id
  `));
  return Number(rows[0]?.id ?? 0);
}

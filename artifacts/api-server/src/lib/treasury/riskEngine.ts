/**
 * Risk Detection Engine — Batch 4 Phase 6
 *
 * Detects:
 *   NEGATIVE_CASH        — any bank account balance < 0
 *   NEAR_NEGATIVE_CASH   — balance < configurable threshold (default 5% of monthly expenses)
 *   LARGE_VARIANCE       — |variance_pct| > LARGE_VARIANCE_THRESHOLD (default 20%)
 *   LATE_COLLECTION      — AR OVERDUE > LATE_THRESHOLD_DAYS (default 30)
 *   LATE_PAYMENT         — AP OVERDUE > LATE_THRESHOLD_DAYS (default 30)
 *   OUTSTANDING_AGING    — AR/AP not collected/paid > 90 days
 *   CASH_CONCENTRATION   — single account > CONCENTRATION_THRESHOLD (default 80%) of total cash
 *   SINGLE_CUSTOMER_RISK — single customer > SINGLE_PARTY_THRESHOLD (default 50%) of total AR
 *   SINGLE_VENDOR_RISK   — single vendor > SINGLE_PARTY_THRESHOLD (default 50%) of total AP
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type {
  RiskReport,
  TreasuryAlert,
  AlertType,
  AlertSeverity,
  TreasuryQueryParams,
} from "./types.js";
import { computeCashPosition } from "./cashPositionEngine.js";
import { treasuryCache, CK, TREASURY_TTL } from "./treasuryCache.js";
import { recordMetric } from "./treasuryMetrics.js";

// ── Thresholds (configurable via env) ────────────────────────────────────────

const NEAR_NEGATIVE_DAYS_COVERAGE = Number(process.env.TREASURY_NEAR_NEGATIVE_DAYS ?? 7);
const LARGE_VARIANCE_THRESHOLD    = Number(process.env.TREASURY_LARGE_VARIANCE_PCT  ?? 20);
const LATE_THRESHOLD_DAYS         = Number(process.env.TREASURY_LATE_DAYS           ?? 30);
const AGING_THRESHOLD_DAYS        = Number(process.env.TREASURY_AGING_DAYS          ?? 90);
const CONCENTRATION_THRESHOLD     = Number(process.env.TREASURY_CONCENTRATION_PCT   ?? 80);
const SINGLE_PARTY_THRESHOLD      = Number(process.env.TREASURY_SINGLE_PARTY_PCT    ?? 50);

// ── Main entry point ──────────────────────────────────────────────────────────

export async function detectRisks(
  params: TreasuryQueryParams
): Promise<RiskReport> {
  const { companyId, asOf } = params;
  const asOfDate = asOf ?? new Date().toISOString().slice(0, 10);
  const cacheKey = CK.risk(companyId, asOfDate);

  const cached = treasuryCache.get<RiskReport>(cacheKey);
  if (cached) return cached;

  const t0 = performance.now();

  const [
    position,
    lateArAlerts,
    lateApAlerts,
    agingAlerts,
    customerRiskAlerts,
    vendorRiskAlerts,
    varianceAlerts,
  ] = await Promise.all([
    computeCashPosition({ companyId, asOf: asOfDate }),
    detectLateCollection(companyId, asOfDate),
    detectLatePayment(companyId, asOfDate),
    detectOutstandingAging(companyId, asOfDate),
    detectSingleCustomerRisk(companyId),
    detectSingleVendorRisk(companyId),
    detectLargeVariance(companyId, asOfDate),
  ]);

  const cashAlerts = detectCashAlerts(position);
  const concentrationAlerts = detectCashConcentration(position);

  const alerts: TreasuryAlert[] = [
    ...cashAlerts,
    ...concentrationAlerts,
    ...lateArAlerts,
    ...lateApAlerts,
    ...agingAlerts,
    ...customerRiskAlerts,
    ...vendorRiskAlerts,
    ...varianceAlerts,
  ];

  // Risk score: CRITICAL=30, WARNING=10, INFO=2 — capped at 100
  const riskScore = Math.min(100, alerts.reduce((s, a) => {
    return s + (a.severity === 'CRITICAL' ? 30 : a.severity === 'WARNING' ? 10 : 2);
  }, 0));

  const latencyMs = performance.now() - t0;

  const result: RiskReport = {
    companyId,
    asOf: asOfDate,
    currency: 'IDR',
    alerts,
    riskScore,
    computedAt: new Date().toISOString(),
    latencyMs: Math.round(latencyMs * 100) / 100,
  };

  treasuryCache.set(cacheKey, result, TREASURY_TTL.RISK);
  recordMetric('risk_detection_latency_ms', latencyMs, { companyId });

  // Persist new unresolved alerts
  await persistAlerts(companyId, asOfDate, alerts).catch(() => {});

  return result;
}

// ── Individual detectors ──────────────────────────────────────────────────────

function detectCashAlerts(position: ReturnType<typeof computeCashPosition> extends Promise<infer T> ? T : never): TreasuryAlert[] {
  const alerts: TreasuryAlert[] = [];

  for (const acct of position.bankAccounts) {
    if (acct.currentBalance < 0) {
      alerts.push(alert(
        'NEGATIVE_CASH', 'CRITICAL',
        `Saldo Negatif: ${acct.bankName ?? acct.accountName}`,
        `Rekening ${acct.accountNumber ?? acct.accountId} memiliki saldo ${fmt(acct.currentBalance)} IDR.`,
        acct.currentBalance, 0, acct.currency, acct.accountId,
      ));
    } else if (acct.currentBalance < dailyCoverageThreshold(position.outstandingPayable, NEAR_NEGATIVE_DAYS_COVERAGE)) {
      alerts.push(alert(
        'NEAR_NEGATIVE_CASH', 'WARNING',
        `Saldo Rendah: ${acct.bankName ?? acct.accountName}`,
        `Saldo ${fmt(acct.currentBalance)} IDR — di bawah batas ${NEAR_NEGATIVE_DAYS_COVERAGE} hari coverage.`,
        acct.currentBalance, 0, acct.currency, acct.accountId,
      ));
    }
  }

  return alerts;
}

function detectCashConcentration(position: ReturnType<typeof computeCashPosition> extends Promise<infer T> ? T : never): TreasuryAlert[] {
  const alerts: TreasuryAlert[] = [];
  const total = position.currentCash;
  if (total <= 0) return alerts;

  for (const acct of position.bankAccounts) {
    const pct = (acct.currentBalance / total) * 100;
    if (pct > CONCENTRATION_THRESHOLD) {
      alerts.push(alert(
        'CASH_CONCENTRATION', 'WARNING',
        `Konsentrasi Kas Tinggi: ${acct.bankName ?? acct.accountName}`,
        `${pct.toFixed(1)}% dari total kas ada di satu rekening (threshold: ${CONCENTRATION_THRESHOLD}%).`,
        pct, CONCENTRATION_THRESHOLD, acct.currency, acct.accountId,
      ));
    }
  }

  return alerts;
}

async function detectLateCollection(
  companyId: number,
  asOf: string
): Promise<TreasuryAlert[]> {
  const { rows } = await db.execute<{
    count: string;
    total: string;
    max_overdue: string;
  }>(sql.raw(`
    SELECT
      COUNT(*)                                          AS count,
      COALESCE(SUM(outstanding_amount), 0)             AS total,
      COALESCE(MAX(CURRENT_DATE - due_date::date), 0)  AS max_overdue
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OVERDUE')
      AND due_date IS NOT NULL
      AND ('${asOf}'::date - due_date::date) > ${LATE_THRESHOLD_DAYS}
  `));

  const row = rows[0];
  if (!row || Number(row.count) === 0) return [];

  const severity: AlertSeverity = Number(row.max_overdue) > 90 ? 'CRITICAL' : 'WARNING';
  return [alert(
    'LATE_COLLECTION', severity,
    `Piutang Terlambat: ${row.count} Invoice`,
    `${row.count} invoice senilai ${fmt(Number(row.total))} IDR telambat > ${LATE_THRESHOLD_DAYS} hari (max: ${row.max_overdue} hari).`,
    Number(row.total), LATE_THRESHOLD_DAYS,
  )];
}

async function detectLatePayment(
  companyId: number,
  asOf: string
): Promise<TreasuryAlert[]> {
  const { rows } = await db.execute<{
    count: string;
    total: string;
    max_overdue: string;
  }>(sql.raw(`
    SELECT
      COUNT(*)                                                             AS count,
      COALESCE(SUM(payable_amount - COALESCE(paid_amount, 0)), 0)         AS total,
      COALESCE(MAX(CURRENT_DATE - due_date::date), 0)                     AS max_overdue
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OVERDUE')
      AND due_date IS NOT NULL
      AND ('${asOf}'::date - due_date::date) > ${LATE_THRESHOLD_DAYS}
  `));

  const row = rows[0];
  if (!row || Number(row.count) === 0) return [];

  const severity: AlertSeverity = Number(row.max_overdue) > 90 ? 'CRITICAL' : 'WARNING';
  return [alert(
    'LATE_PAYMENT', severity,
    `Hutang Terlambat: ${row.count} Bill`,
    `${row.count} bill senilai ${fmt(Number(row.total))} IDR terlambat > ${LATE_THRESHOLD_DAYS} hari (max: ${row.max_overdue} hari).`,
    Number(row.total), LATE_THRESHOLD_DAYS,
  )];
}

async function detectOutstandingAging(
  companyId: number,
  asOf: string
): Promise<TreasuryAlert[]> {
  const alerts: TreasuryAlert[] = [];

  const { rows: arRows } = await db.execute<{ count: string; total: string }>(sql.raw(`
    SELECT COUNT(*) AS count, COALESCE(SUM(outstanding_amount), 0) AS total
    FROM ar_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN','PARTIAL','OVERDUE')
      AND due_date IS NOT NULL
      AND ('${asOf}'::date - due_date::date) > ${AGING_THRESHOLD_DAYS}
  `));

  if (Number(arRows[0]?.count ?? 0) > 0) {
    alerts.push(alert(
      'OUTSTANDING_AGING', 'WARNING',
      `AR Aging > ${AGING_THRESHOLD_DAYS} Hari`,
      `${arRows[0].count} piutang senilai ${fmt(Number(arRows[0].total))} IDR belum tertagih > ${AGING_THRESHOLD_DAYS} hari.`,
      Number(arRows[0].total), AGING_THRESHOLD_DAYS,
    ));
  }

  const { rows: apRows } = await db.execute<{ count: string; total: string }>(sql.raw(`
    SELECT COUNT(*) AS count, COALESCE(SUM(payable_amount - COALESCE(paid_amount, 0)), 0) AS total
    FROM ap_subledger
    WHERE company_id = ${companyId}
      AND status IN ('OPEN','PARTIAL','OVERDUE')
      AND due_date IS NOT NULL
      AND ('${asOf}'::date - due_date::date) > ${AGING_THRESHOLD_DAYS}
  `));

  if (Number(apRows[0]?.count ?? 0) > 0) {
    alerts.push(alert(
      'OUTSTANDING_AGING', 'WARNING',
      `AP Aging > ${AGING_THRESHOLD_DAYS} Hari`,
      `${apRows[0].count} hutang senilai ${fmt(Number(apRows[0].total))} IDR belum dibayar > ${AGING_THRESHOLD_DAYS} hari.`,
      Number(apRows[0].total), AGING_THRESHOLD_DAYS,
    ));
  }

  return alerts;
}

async function detectSingleCustomerRisk(companyId: number): Promise<TreasuryAlert[]> {
  const { rows } = await db.execute<{
    customer_id: string;
    customer_total: string;
    grand_total: string;
    pct: string;
  }>(sql.raw(`
    WITH customer_ar AS (
      SELECT
        customer_id,
        SUM(outstanding_amount) AS customer_total,
        SUM(SUM(outstanding_amount)) OVER () AS grand_total
      FROM ar_subledger
      WHERE company_id = ${companyId}
        AND status IN ('OPEN','PARTIAL','OVERDUE')
        AND customer_id IS NOT NULL
      GROUP BY customer_id
    )
    SELECT
      customer_id::text,
      customer_total::text,
      grand_total::text,
      ROUND((customer_total / NULLIF(grand_total, 0)) * 100, 2)::text AS pct
    FROM customer_ar
    WHERE (customer_total / NULLIF(grand_total, 0)) * 100 > ${SINGLE_PARTY_THRESHOLD}
    ORDER BY customer_total DESC
    LIMIT 3
  `));

  return rows.map(r => alert(
    'SINGLE_CUSTOMER_RISK', 'WARNING',
    `Konsentrasi Piutang: Customer #${r.customer_id}`,
    `Customer ${r.customer_id} memiliki ${r.pct}% dari total AR (threshold: ${SINGLE_PARTY_THRESHOLD}%).`,
    Number(r.pct), SINGLE_PARTY_THRESHOLD,
    'IDR', null, { customerId: r.customer_id, amount: r.customer_total },
  ));
}

async function detectSingleVendorRisk(companyId: number): Promise<TreasuryAlert[]> {
  const { rows } = await db.execute<{
    vendor_id: string;
    vendor_total: string;
    grand_total: string;
    pct: string;
  }>(sql.raw(`
    WITH vendor_ap AS (
      SELECT
        vendor_id,
        SUM(payable_amount - COALESCE(paid_amount, 0)) AS vendor_total,
        SUM(SUM(payable_amount - COALESCE(paid_amount, 0))) OVER () AS grand_total
      FROM ap_subledger
      WHERE company_id = ${companyId}
        AND status IN ('OPEN','PARTIAL','OVERDUE')
        AND vendor_id IS NOT NULL
      GROUP BY vendor_id
    )
    SELECT
      vendor_id::text,
      vendor_total::text,
      grand_total::text,
      ROUND((vendor_total / NULLIF(grand_total, 0)) * 100, 2)::text AS pct
    FROM vendor_ap
    WHERE (vendor_total / NULLIF(grand_total, 0)) * 100 > ${SINGLE_PARTY_THRESHOLD}
    ORDER BY vendor_total DESC
    LIMIT 3
  `));

  return rows.map(r => alert(
    'SINGLE_VENDOR_RISK', 'WARNING',
    `Konsentrasi Hutang: Vendor #${r.vendor_id}`,
    `Vendor ${r.vendor_id} memiliki ${r.pct}% dari total AP (threshold: ${SINGLE_PARTY_THRESHOLD}%).`,
    Number(r.pct), SINGLE_PARTY_THRESHOLD,
    'IDR', null, { vendorId: r.vendor_id, amount: r.vendor_total },
  ));
}

async function detectLargeVariance(
  companyId: number,
  asOf: string
): Promise<TreasuryAlert[]> {
  const from30 = addDays(asOf, -30);

  const { rows } = await db.execute<{
    period_date: string;
    variance_pct: string;
    variance_amount: string;
  }>(sql.raw(`
    SELECT period_date::text, variance_pct::text, variance_amount::text
    FROM cash_variance
    WHERE company_id = ${companyId}
      AND period_date >= '${from30}'
      AND period_date <= '${asOf}'
      AND ABS(variance_pct) > ${LARGE_VARIANCE_THRESHOLD}
    ORDER BY ABS(variance_pct) DESC
    LIMIT 5
  `));

  return rows.map(r => {
    const pct = Number(r.variance_pct);
    const severity: AlertSeverity = Math.abs(pct) > 50 ? 'CRITICAL' : 'WARNING';
    return alert(
      'LARGE_VARIANCE', severity,
      `Variance Besar: ${r.period_date}`,
      `Variance ${pct.toFixed(1)}% (${fmt(Math.abs(Number(r.variance_amount)))} IDR) melebihi threshold ${LARGE_VARIANCE_THRESHOLD}%.`,
      pct, LARGE_VARIANCE_THRESHOLD,
    );
  });
}

// ── Persistence ───────────────────────────────────────────────────────────────

async function persistAlerts(
  companyId: number,
  alertDate: string,
  alerts: TreasuryAlert[]
): Promise<void> {
  for (const a of alerts) {
    const meta = a.metadata
      ? `'${JSON.stringify(a.metadata).replace(/'/g, "''")}'`
      : 'NULL';
    await db.execute(sql.raw(`
      INSERT INTO treasury_alert
        (company_id, alert_date, alert_type, severity, title, message,
         value, threshold, currency, bank_account_id, metadata)
      VALUES (
        ${companyId}, '${alertDate}', '${a.alertType}', '${a.severity}',
        '${a.title.replace(/'/g, "''")}',
        '${a.message.replace(/'/g, "''")}',
        ${a.value ?? 'NULL'}, ${a.threshold ?? 'NULL'},
        '${a.currency ?? 'IDR'}',
        ${a.bankAccountId ?? 'NULL'},
        ${meta}
      )
    `)).catch(() => {});
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function alert(
  alertType: AlertType,
  severity: AlertSeverity,
  title: string,
  message: string,
  value?: number | null,
  threshold?: number | null,
  currency = 'IDR',
  bankAccountId?: number | null,
  metadata?: Record<string, unknown>,
): TreasuryAlert {
  return { alertType, severity, title, message, value: value ?? null, threshold: threshold ?? null, currency, bankAccountId, metadata };
}

function dailyCoverageThreshold(monthlyPayable: number, days: number): number {
  return (monthlyPayable / 30) * days;
}

function fmt(n: number): string {
  return n.toLocaleString('id-ID', { maximumFractionDigits: 0 });
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

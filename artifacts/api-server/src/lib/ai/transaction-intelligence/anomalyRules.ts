/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Detection — Policy Defaults & Helpers
 *
 * Pure constants and merge utilities. No side effects.
 */

import type { AnomalyDetectionPolicy } from './anomalyTypes.js';

// ─── Default Policy ───────────────────────────────────────────────────────────

export const DEFAULT_ANOMALY_POLICY: Required<AnomalyDetectionPolicy> = {
  minimumHistoricalSample: 10,
  anomalyThreshold: 0.10,
  reviewThreshold: 0.40,
  highRiskThreshold: 0.65,
  criticalRiskThreshold: 0.85,
  amountZScoreThreshold: 3.0,
  amountPercentileThreshold: 0.99,
  duplicateWindowMinutes: 60,
  nearDuplicateAmountTolerance: 0.02,
  frequencyMultiplier: 5.0,
  splitTransactionWindowHours: 2,
  splitTransactionMinimumCount: 3,
  splitTransactionAmountTolerance: 0.05,
  unusualHourStart: 0,
  unusualHourEnd: 6,
  ignoredTransactionCodes: [],
  ignoredCounterparties: [],
  ignoredCoaCodes: [],
  approvalThresholds: [],
  enabledDetectors: {
    amount: true,
    frequency: true,
    duplicate: true,
    counterparty: true,
    timing: true,
    coa: true,
    splitTransaction: true,
    crossCompany: true,
  },
};

/** Merge user-supplied policy with defaults (user values win). */
export function mergePolicy(policy?: AnomalyDetectionPolicy): Required<AnomalyDetectionPolicy> {
  if (!policy) return DEFAULT_ANOMALY_POLICY;
  return {
    ...DEFAULT_ANOMALY_POLICY,
    ...policy,
    enabledDetectors: {
      ...DEFAULT_ANOMALY_POLICY.enabledDetectors,
      ...(policy.enabledDetectors ?? {}),
    },
  };
}

// ─── Generic counterparty tokens (not considered strong identifiers) ──────────

export const GENERIC_COUNTERPARTY_TOKENS = new Set([
  'PT', 'CV', 'BANK', 'CUSTOMER', 'VENDOR', 'TRANSFER', 'UNKNOWN', 'N/A', 'NA',
  'NONE', 'OTHER', 'LAIN', 'UMUM', 'GENERAL',
  // Indonesian generic payment/transaction terms
  'PEMBAYARAN', 'PEMASUKAN', 'PENGELUARAN', 'PEMBELIAN', 'PENJUALAN',
  'SETORAN', 'TARIK', 'TUNAI', 'KAS', 'BAYAR',
]);

/** Returns true if the counterparty name is too generic to be meaningful. */
export function isGenericCounterparty(name: string | undefined | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toUpperCase();
  if (normalized.length < 3) return true;
  return GENERIC_COUNTERPARTY_TOKENS.has(normalized);
}

// ─── COA prefix conventions (Indonesian accounting) ──────────────────────────

/** COA codes typically used for accounts receivable (AR) */
export function isArCoaCode(code: string): boolean {
  return /^1-1[2-9]/i.test(code) || /^1\.1[2-9]/i.test(code) || /piutang/i.test(code);
}

/** COA codes typically used for accounts payable (AP) */
export function isApCoaCode(code: string): boolean {
  return /^2-1/i.test(code) || /^2\.1/i.test(code) || /hutang/i.test(code);
}

/** COA codes typically used for revenue/income */
export function isRevenueCoaCode(code: string): boolean {
  return /^4/i.test(code) || /pendapatan|revenue|income/i.test(code);
}

/** COA codes typically used for expense */
export function isExpenseCoaCode(code: string): boolean {
  return /^5/i.test(code) || /biaya|beban|expense/i.test(code);
}

/** COA codes typically used for payroll */
export function isPayrollCoaCode(code: string): boolean {
  return /gaji|payroll|salary|upah|tunjangan/i.test(code) ||
    /^5-1[0-4]/i.test(code);
}

/** COA codes typically used for tax */
export function isTaxCoaCode(code: string): boolean {
  return /pajak|tax|ppn|pph/i.test(code) ||
    /^2-[23]/i.test(code);
}

// ─── Time helpers ─────────────────────────────────────────────────────────────

/** Parse a transaction date safely, returns null on invalid. */
export function parseDate(value: string | Date | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** Difference in minutes between two dates (abs). */
export function minutesBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 60000;
}

/** Difference in hours between two dates (abs). */
export function hoursBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 3600000;
}

// ─── Description similarity ───────────────────────────────────────────────────

/** Simple word-overlap Jaccard similarity between two descriptions. */
export function descriptionSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 1));
  if (wordsA.size === 0 && wordsB.size === 0) return 1;
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let intersection = 0;
  for (const w of wordsA) { if (wordsB.has(w)) intersection++; }
  const union = wordsA.size + wordsB.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// ─── Redaction helper ─────────────────────────────────────────────────────────

/** Mask sensitive account numbers: 1234567890 → ******7890 */
export function redactAccountNumber(value: string | number): string {
  const s = String(value).trim();
  if (s.length <= 4) return '****';
  return '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-4);
}

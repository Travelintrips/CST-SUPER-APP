/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Rules
 *
 * Deterministic rule tables — no DB calls, no Math.random().
 * Intent → semantic COA keyword mappings and safety rules.
 * All strings are lower-cased for consistent comparison.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { CoaAccountCandidate } from './coaPredictionTypes.js';

// ─── Intent → semantic keywords ────────────────────────────────────────────────

/**
 * For each intent, the semantic keywords we expect to find in an account's
 * name, keywords[], or aliases[].  All lower-cased.
 *
 * These are used to score accounts — NOT to hard-code IDs.
 */
export const INTENT_COA_KEYWORDS: Partial<Record<TransactionIntent, readonly string[]>> = {
  BANK_ADMIN_FEE: [
    'bank fee', 'biaya bank', 'administrasi bank', 'bank charges',
    'bank administration', 'admin fee', 'biaya administrasi', 'maintenance fee',
    'monthly fee', 'biaya rekening', 'biaya admin',
  ],
  TRANSFER_FEE: [
    'transfer fee', 'rtgs', 'skn', 'bi-fast', 'bifast', 'swift',
    'bank transfer charges', 'biaya transfer', 'transfer charges',
    'kliring', 'sknbi', 'ongkos transfer',
  ],
  INTEREST_INCOME: [
    'interest income', 'pendapatan bunga', 'jasa giro', 'bunga tabungan',
    'interest earned', 'income interest', 'bunga deposito', 'pendapatan jasa',
  ],
  PAYROLL: [
    'salary expense', 'payroll expense', 'wages', 'gaji', 'payroll payable',
    'hutang gaji', 'biaya gaji', 'payroll', 'thr', 'honor', 'upah',
    'remunerasi', 'biaya pegawai', 'employee expense',
  ],
  TAX_PAYMENT: [
    'tax payable', 'ppn', 'pph', 'tax expense', 'hutang pajak', 'pajak',
    'tax', 'vat payable', 'withholding tax', 'pajak terutang',
    'kewajiban pajak', 'pajak pertambahan nilai',
  ],
  VAT_PAYMENT: [
    'ppn masukan', 'ppn keluaran', 'vat input', 'vat output',
    'vat payable', 'ppn', 'pajak pertambahan nilai',
  ],
  INCOME_TAX: [
    'pph 21', 'pph21', 'pph 22', 'pph22', 'pph 23', 'pph23',
    'pph 25', 'pph25', 'pph 26', 'pph26', 'pph final',
    'pasal 21', 'pasal 22', 'pasal 23', 'pasal 25', 'pasal 26',
    'pasal 4 ayat 2', 'income tax', 'pajak penghasilan',
  ],
  IMPORT_DUTY: [
    'bea masuk', 'import duty', 'pajak impor', 'import tax',
  ],
  CUSTOMS_DUTY: [
    'customs duty', 'customs', 'kepabeanan', 'bea cukai',
  ],
  STAMP_DUTY: [
    'bea materai', 'bea meterai', 'e materai', 'e meterai', 'materai', 'meterai',
  ],
  TAX_PENALTY: [
    'denda pajak', 'sanksi pajak', 'tax penalty', 'tax fine',
  ],
  TAX_REFUND: [
    'restitusi pajak', 'pengembalian pajak', 'tax refund', 'refund pajak',
  ],
  TAX_INTEREST: [
    'bunga pajak', 'tax interest', 'sanksi bunga pajak',
  ],
  INTEREST_TAX_WITHHOLDING: [
    'pph final bunga', 'pajak bunga bank', 'pph final atas bunga', 'pph 4 ayat 2 bunga',
    'withholding bank interest', 'pajak jasa giro', 'pph final jasa giro',
    'beban pph final bunga bank', 'debet pajak bunga', 'pot pajak bunga',
    'pajak atas bunga', 'pph atas bunga', 'tax on interest',
  ],
  EXCISE_TAX: [
    'cukai', 'excise tax', 'excise',
  ],
  LOCAL_TAX: [
    'pajak daerah', 'retribusi', 'bphtb', 'pbb',
  ],
  VEHICLE_TAX: [
    'pajak kendaraan', 'pajak kendaraan bermotor', 'pkb', 'samsat',
  ],
  CUSTOMER_PAYMENT: [
    'accounts receivable', 'piutang usaha', 'customer receivable',
    'unapplied receipt', 'piutang', 'receivable', 'piutang dagang',
    'trade receivable', 'piutang pelanggan',
  ],
  VENDOR_PAYMENT: [
    'accounts payable', 'hutang usaha', 'vendor payable', 'accrued payable',
    'hutang', 'payable', 'hutang dagang', 'trade payable', 'hutang vendor',
    'hutang supplier', 'utang usaha',
  ],
  INTERNAL_TRANSFER: [
    'interbank transfer', 'bank clearing', 'cash transfer clearing',
    'due to', 'due from', 'intercompany', 'antar rekening', 'clearing',
    'bank transit', 'in transit', 'kas transit', 'interbank',
  ],
  REFUND: [
    'refund receivable', 'expense reversal', 'clearing', 'sales return',
    'pengembalian', 'refund', 'reversal', 'retur penjualan', 'uang muka',
  ],
  CASHBACK: [
    'other income', 'rebate income', 'expense reduction', 'cashback',
    'reward income', 'pendapatan lain', 'pendapatan lain-lain',
    'income lainnya', 'rebate', 'komisi',
  ],
  BANK_CHARGE: [
    'bank charge', 'bank penalty', 'denda', 'penalti', 'service charge',
    'fine', 'biaya denda', 'charge', 'penalty charge',
  ],
  BANK_REVERSAL: [
    'reversal', 'clearing', 'koreksi', 'storno', 'reversal account',
    'clearing account', 'suspense',
  ],
  LOAN_PAYMENT: [
    'loan', 'pinjaman', 'angsuran', 'cicilan', 'principal',
    'hutang bank', 'interest expense', 'beban bunga', 'kredit bank',
    'obligasi', 'hutang jangka panjang',
  ],
  CHEQUE: [
    'clearing', 'giro', 'cek', 'cheque', 'bank clearing', 'suspense',
  ],
  GIRO: [
    'clearing', 'giro', 'bilyet', 'bank clearing', 'suspense',
  ],
  UNKNOWN: [],
} as const;

// ─── Intent → preferred account types ─────────────────────────────────────────

/**
 * Account types (accountType field, lower-cased) that are preferred
 * for each intent.  Used for category-level scoring.
 */
export const INTENT_PREFERRED_ACCOUNT_TYPES: Partial<Record<TransactionIntent, readonly string[]>> = {
  BANK_ADMIN_FEE:    ['expense', 'biaya', 'operating expense'],
  TRANSFER_FEE:      ['expense', 'biaya', 'operating expense'],
  INTEREST_INCOME:   ['income', 'revenue', 'pendapatan'],
  PAYROLL:           ['expense', 'biaya', 'payable', 'liability'],
  TAX_PAYMENT:       ['liability', 'payable', 'expense', 'hutang'],
  VAT_PAYMENT:       ['asset', 'liability', 'payable', 'expense', 'hutang'],
  INCOME_TAX:        ['liability', 'payable', 'expense', 'hutang'],
  IMPORT_DUTY:       ['expense', 'asset', 'liability', 'payable'],
  CUSTOMS_DUTY:      ['expense', 'asset', 'liability', 'payable'],
  STAMP_DUTY:        ['expense', 'biaya'],
  TAX_PENALTY:       ['expense', 'biaya', 'liability', 'payable'],
  TAX_REFUND:        ['asset', 'receivable', 'piutang'],
  TAX_INTEREST:              ['expense', 'biaya', 'liability', 'payable'],
  INTEREST_TAX_WITHHOLDING:  ['expense', 'biaya'],
  EXCISE_TAX:        ['expense', 'asset', 'liability', 'payable'],
  LOCAL_TAX:         ['expense', 'liability', 'payable'],
  VEHICLE_TAX:       ['expense', 'liability', 'payable'],
  CUSTOMER_PAYMENT:  ['asset', 'receivable', 'aset'],
  VENDOR_PAYMENT:    ['liability', 'payable', 'hutang'],
  INTERNAL_TRANSFER: ['asset', 'clearing', 'aset'],
  REFUND:            ['asset', 'liability', 'clearing'],
  CASHBACK:          ['income', 'revenue', 'pendapatan'],
  BANK_CHARGE:       ['expense', 'biaya'],
  BANK_REVERSAL:     ['clearing', 'asset', 'liability'],
  LOAN_PAYMENT:      ['liability', 'expense', 'hutang'],
  CHEQUE:            ['asset', 'clearing'],
  GIRO:              ['asset', 'clearing'],
} as const;

// ─── Intent → anti-pattern types (explicitly discourage) ─────────────────────

/**
 * Account types to strongly penalise for each intent.
 * Prevents naive mis-matches (e.g. picking revenue for CUSTOMER_PAYMENT).
 */
export const INTENT_ANTI_PATTERN_TYPES: Partial<Record<TransactionIntent, readonly string[]>> = {
  CUSTOMER_PAYMENT:  ['revenue', 'income', 'pendapatan'],  // AR first, not revenue
  VENDOR_PAYMENT:    ['expense', 'biaya'],                 // AP first, not expense
  INTERNAL_TRANSFER: ['revenue', 'income', 'expense', 'biaya'],
  BANK_ADMIN_FEE:    ['asset', 'revenue', 'income'],
  TRANSFER_FEE:      ['asset', 'revenue', 'income'],
  INTEREST_INCOME:   ['expense', 'biaya'],
  PAYROLL:           ['revenue', 'income'],
  TAX_PAYMENT:       ['revenue', 'income'],
  VAT_PAYMENT:       ['revenue', 'income'],
  INCOME_TAX:        ['revenue', 'income'],
  IMPORT_DUTY:       ['revenue', 'income'],
  CUSTOMS_DUTY:      ['revenue', 'income'],
  STAMP_DUTY:        ['revenue', 'income', 'asset'],
  TAX_PENALTY:       ['revenue', 'income'],
  TAX_REFUND:        ['revenue', 'income', 'expense'],
  TAX_INTEREST:              ['revenue', 'income'],
  INTEREST_TAX_WITHHOLDING:  ['revenue', 'income', 'asset', 'liability'],
  EXCISE_TAX:        ['revenue', 'income'],
  LOCAL_TAX:         ['revenue', 'income'],
  VEHICLE_TAX:       ['revenue', 'income'],
} as const;

// ─── Direction → normal balance compatibility ──────────────────────────────────

/**
 * Returns a direction compatibility delta.
 * Positive = compatible, negative = conflict, zero = unknown / not applicable.
 */
export function directionNormalBalanceDelta(
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | undefined,
  normalBalance: 'DEBIT' | 'CREDIT' | 'UNKNOWN' | undefined,
): number {
  if (!direction || direction === 'UNKNOWN') return 0;
  if (!normalBalance || normalBalance === 'UNKNOWN') return 0;
  return direction === normalBalance ? 0.10 : -0.10;
}

// ─── Account type normaliser ───────────────────────────────────────────────────

/** Normalise accountType to lower-case for comparison. */
export function normalizeAccountType(t: string | undefined): string {
  return (t ?? '').toLowerCase().trim();
}

// ─── Keyword scorer ────────────────────────────────────────────────────────────

/**
 * Score a single account against the intent's keyword list.
 * Checks account.name, account.keywords[], and account.aliases[].
 * Returns 0.0 – 1.0.
 */
export function scoreAccountKeywords(
  account: CoaAccountCandidate,
  intentKeywords: readonly string[],
): number {
  if (intentKeywords.length === 0) return 0;

  const haystack: string[] = [
    account.name.toLowerCase(),
    ...(account.keywords ?? []).map((k) => k.toLowerCase()),
    ...(account.aliases ?? []).map((a) => a.toLowerCase()),
    account.code.toLowerCase(),
  ];

  let hits = 0;
  for (const kw of intentKeywords) {
    const kwLower = kw.toLowerCase();
    if (haystack.some((h) => h.includes(kwLower))) {
      hits++;
    }
  }

  // Score proportional to fraction of keywords matched, capped at 1.0
  return Math.min(hits / Math.max(intentKeywords.length, 1), 1.0);
}

// ─── Category scorer ───────────────────────────────────────────────────────────

/**
 * Score an account based on whether its accountType / category matches
 * what the intent prefers, or conflicts with anti-patterns.
 * Returns delta in range [-0.10, +0.10].
 */
export function scoreAccountCategory(
  account: CoaAccountCandidate,
  intent: TransactionIntent,
): number {
  const type = normalizeAccountType(account.accountType);
  const cat  = normalizeAccountType(account.category);
  const sub  = normalizeAccountType(account.subcategory);

  const preferred   = INTENT_PREFERRED_ACCOUNT_TYPES[intent] ?? [];
  const antiPattern = INTENT_ANTI_PATTERN_TYPES[intent] ?? [];

  const searchFields = [type, cat, sub].filter(Boolean);

  const isPreferred   = searchFields.some((f) => preferred.some((p)   => f.includes(p)));
  const isAntiPattern = searchFields.some((f) => antiPattern.some((a) => f.includes(a)));

  if (isAntiPattern) return -0.10;
  if (isPreferred)   return 0.10;
  return 0;
}

// ─── Historical mapping scorer ────────────────────────────────────────────────

/**
 * Compute a historical evidence score for one account against the
 * available historical mappings.
 * Returns a score in [−0.25, +0.30] plus a rejection flag.
 */
export function scoreHistoricalMapping(params: {
  accountCode: string;
  intent:  TransactionIntent;
  normalizedDescription: string;
  counterpartyName?: string;
  counterpartyAccount?: string;
  transactionCode?: string;
  companyId: string | number;
  mappings: readonly { companyId: string | number; normalizedDescription?: string; intent?: TransactionIntent; counterpartyName?: string; counterpartyAccount?: string; transactionCode?: string; coaCode: string; usageCount?: number; approvedCount?: number; rejectedCount?: number }[];
}): { score: number; hasApprovedMatch: boolean; hasRejectedMatch: boolean } {
  const { accountCode, intent, normalizedDescription, counterpartyName,
          counterpartyAccount, transactionCode, companyId, mappings } = params;

  const relevant = mappings.filter(
    (m) => String(m.companyId) === String(companyId) && m.coaCode === accountCode,
  );

  if (relevant.length === 0) return { score: 0, hasApprovedMatch: false, hasRejectedMatch: false };

  let bestScore = 0;
  let hasApproved = false;
  let hasRejected = false;

  for (const m of relevant) {
    const approved  = m.approvedCount ?? 0;
    const rejected  = m.rejectedCount ?? 0;
    const usage     = m.usageCount    ?? (approved + rejected);

    // Reject signal: high rejection ratio
    const rejectionRatio = usage > 0 ? rejected / usage : 0;
    if (rejectionRatio >= 0.5 && rejected >= 2) {
      hasRejected = true;
      bestScore = Math.min(bestScore, -0.25);
      continue;
    }

    // Similarity signals
    let matchScore = 0;

    // Intent match
    if (m.intent && m.intent === intent) matchScore += 0.10;

    // Description similarity (simple token overlap)
    if (m.normalizedDescription) {
      const overlap = tokenOverlap(normalizedDescription, m.normalizedDescription);
      matchScore += overlap * 0.10;
    }

    // Counterparty match
    if (counterpartyName && m.counterpartyName &&
        m.counterpartyName.toLowerCase() === counterpartyName.toLowerCase()) {
      matchScore += 0.05;
    }
    if (counterpartyAccount && m.counterpartyAccount &&
        m.counterpartyAccount === counterpartyAccount) {
      matchScore += 0.03;
    }

    // Transaction code match
    if (transactionCode && m.transactionCode &&
        m.transactionCode.toLowerCase() === transactionCode.toLowerCase()) {
      matchScore += 0.02;
    }

    // Approval weight
    if (approved > 0 && rejectionRatio < 0.2) {
      const approvalFactor = Math.min(approved / 5, 1.0); // saturates at 5 approvals
      matchScore *= (1 + approvalFactor);
      hasApproved = true;
    }

    // Normalise to [0, 1] so that computeCoaScore can apply the weight correctly.
    // Raw sub-scores sum to at most ~0.30 before the approval multiplier, so
    // dividing by 0.30 maps the best achievable raw score to 1.0.
    const normalised = Math.min(matchScore / 0.30, 1.0);
    if (normalised > bestScore) bestScore = normalised;
  }

  return {
    score: bestScore,
    hasApprovedMatch: hasApproved,
    hasRejectedMatch: hasRejected,
  };
}

// ─── Counterparty scoring ──────────────────────────────────────────────────────

/**
 * Apply a counterparty-matching score boost.
 * Returns 0.05 if counterparty name is present in account name/keywords.
 */
export function scoreCounterparty(
  account: CoaAccountCandidate,
  counterpartyName: string | undefined,
): number {
  if (!counterpartyName) return 0;
  const cpLower = counterpartyName.toLowerCase();
  const haystack = [
    account.name.toLowerCase(),
    ...(account.keywords ?? []).map((k) => k.toLowerCase()),
    ...(account.aliases  ?? []).map((a) => a.toLowerCase()),
  ];
  return haystack.some((h) => h.includes(cpLower)) ? 0.05 : 0;
}

// ─── Transaction code / reference scoring ─────────────────────────────────────

/**
 * Score an account based on transaction code evidence.
 * E.g. "RTGS" in the description → slight boost for transfer-fee accounts.
 */
export function scoreTransactionCode(
  account: CoaAccountCandidate,
  transactionCode: string | undefined,
  intentKeywords: readonly string[],
): number {
  if (!transactionCode) return 0;
  const tcLower = transactionCode.toLowerCase();
  // Check if the transaction code is one of the intent keywords
  if (intentKeywords.some((k) => k.toLowerCase().includes(tcLower) || tcLower.includes(k.toLowerCase()))) {
    return 0.05;
  }
  // Check if the account carries the transaction code as a keyword
  const haystack = [
    ...(account.keywords ?? []).map((k) => k.toLowerCase()),
    ...(account.aliases  ?? []).map((a) => a.toLowerCase()),
  ];
  return haystack.some((h) => h.includes(tcLower)) ? 0.03 : 0;
}

// ─── AR/AP ambiguity detection ────────────────────────────────────────────────

/**
 * Returns true when a CUSTOMER_PAYMENT might be mapped to a revenue account
 * (AR vs Revenue ambiguity).
 */
export function isArRevenueAmbiguity(
  intent: TransactionIntent,
  account: CoaAccountCandidate,
): boolean {
  if (intent !== 'CUSTOMER_PAYMENT') return false;
  const type = normalizeAccountType(account.accountType);
  const cat  = normalizeAccountType(account.category);
  return ['revenue', 'income', 'pendapatan'].some(
    (t) => type.includes(t) || cat.includes(t),
  );
}

/**
 * Returns true when a VENDOR_PAYMENT might be mapped to an expense account
 * (AP vs Expense ambiguity).
 */
export function isApExpenseAmbiguity(
  intent: TransactionIntent,
  account: CoaAccountCandidate,
): boolean {
  if (intent !== 'VENDOR_PAYMENT') return false;
  const type = normalizeAccountType(account.accountType);
  const cat  = normalizeAccountType(account.category);
  return ['expense', 'biaya'].some(
    (t) => type.includes(t) || cat.includes(t),
  );
}

// ─── Safety validators ────────────────────────────────────────────────────────

export type SafetyRejectionReason =
  | 'COMPANY_MISMATCH'
  | 'INACTIVE_ACCOUNT'
  | 'NON_POSTABLE_ACCOUNT';

/**
 * Returns a rejection reason if the account fails a hard safety rule,
 * or undefined if it passes.
 */
export function hardSafetyReject(
  account: CoaAccountCandidate,
  companyId: string | number,
): SafetyRejectionReason | undefined {
  if (String(account.companyId) !== String(companyId)) return 'COMPANY_MISMATCH';
  if (!account.isActive) return 'INACTIVE_ACCOUNT';
  if (account.allowsManualPosting === false) return 'NON_POSTABLE_ACCOUNT';
  return undefined;
}

// ─── Utility: token overlap ───────────────────────────────────────────────────

/**
 * Simple Jaccard-like token overlap for description similarity.
 * Returns 0.0 – 1.0.
 */
function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/\s+/).filter((t) => t.length > 1));
  const tb = new Set(b.split(/\s+/).filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
  }
  const union = ta.size + tb.size - inter;
  return union > 0 ? inter / union : 0;
}

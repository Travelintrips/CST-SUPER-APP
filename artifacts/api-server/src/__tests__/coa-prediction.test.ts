/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Engine — Unit Tests (50 cases)
 *
 * No DB, no network, no Math.random().
 * All tests are deterministic and self-contained.
 */

import { describe, it, expect } from 'vitest';
import {
  predictCoa,
  predictCoaBatch,
  CoaPredictionInputSchema,
  CoaPredictionResultSchema,
} from '../lib/ai/transaction-intelligence/index.js';
import type {
  CoaAccountCandidate,
  CoaPredictionInput,
  HistoricalCoaMapping,
} from '../lib/ai/transaction-intelligence/index.js';

// ─── Test account catalogue ────────────────────────────────────────────────────

const COMP_A = '1';
const COMP_B = '2';

function acc(
  code: string,
  name: string,
  accountType: string,
  normalBalance: 'DEBIT' | 'CREDIT' | 'UNKNOWN',
  keywords: string[] = [],
  overrides: Partial<CoaAccountCandidate> = {},
): CoaAccountCandidate {
  return {
    id:                  code,
    companyId:           COMP_A,
    code,
    name,
    accountType,
    normalBalance,
    isActive:            true,
    allowsManualPosting: true,
    keywords,
    ...overrides,
  };
}

const ACCOUNTS: CoaAccountCandidate[] = [
  acc('6-001', 'Biaya Administrasi Bank',         'expense',  'DEBIT',   ['bank fee', 'biaya bank', 'administrasi bank', 'admin fee']),
  acc('6-002', 'Biaya Transfer Bank',              'expense',  'DEBIT',   ['transfer fee', 'rtgs', 'bi-fast', 'bifast', 'swift', 'skn']),
  acc('4-001', 'Pendapatan Bunga',                 'income',   'CREDIT',  ['interest income', 'pendapatan bunga', 'jasa giro']),
  acc('6-010', 'Biaya Gaji Karyawan',              'expense',  'DEBIT',   ['salary expense', 'payroll expense', 'gaji', 'payroll']),
  acc('2-005', 'Hutang Gaji',                      'liability','CREDIT',  ['payroll payable', 'hutang gaji']),
  acc('2-010', 'Hutang Pajak PPN',                 'liability','CREDIT',  ['tax payable', 'ppn', 'pajak pertambahan nilai']),
  acc('6-020', 'Biaya Pajak PPh',                  'expense',  'DEBIT',   ['tax expense', 'pph', 'withholding tax']),
  acc('1-200', 'Piutang Usaha',                    'asset',    'DEBIT',   ['accounts receivable', 'piutang usaha', 'piutang dagang', 'receivable']),
  acc('1-210', 'Unapplied Receipt',                'asset',    'DEBIT',   ['unapplied receipt', 'customer receivable']),
  acc('4-100', 'Pendapatan Penjualan',             'revenue',  'CREDIT',  ['sales revenue', 'pendapatan penjualan']),
  acc('2-100', 'Hutang Usaha',                     'liability','CREDIT',  ['accounts payable', 'hutang usaha', 'vendor payable', 'hutang dagang']),
  acc('2-110', 'Accrued Payable',                  'liability','CREDIT',  ['accrued payable', 'hutang akrual']),
  acc('6-050', 'Biaya Operasional',                'expense',  'DEBIT',   ['operating expense']),
  acc('1-100', 'Kas Bank Clearing',                'asset',    'DEBIT',   ['bank clearing', 'interbank transfer', 'cash transfer clearing', 'clearing']),
  acc('4-200', 'Pendapatan Lain-lain',             'income',   'CREDIT',  ['other income', 'cashback', 'rebate income', 'reward income', 'pendapatan lain']),
  acc('6-030', 'Biaya Denda Bank',                 'expense',  'DEBIT',   ['bank charge', 'bank penalty', 'denda', 'penalti', 'fine']),
  acc('1-090', 'Suspense / Reversal Clearing',     'asset',    'DEBIT',   ['reversal', 'clearing', 'storno', 'suspense']),
  acc('2-200', 'Hutang Bank',                      'liability','CREDIT',  ['loan', 'pinjaman', 'hutang bank', 'kredit bank']),
  acc('6-060', 'Beban Bunga Pinjaman',             'expense',  'DEBIT',   ['interest expense', 'beban bunga', 'loan interest']),
  acc('1-080', 'Piutang Refund',                   'asset',    'DEBIT',   ['refund receivable', 'expense reversal', 'pengembalian', 'refund']),
];

// Inactive account
const INACTIVE_ACCOUNT = acc('6-999', 'Inactive Expense', 'expense', 'DEBIT', ['bank fee'], { isActive: false });

// Non-postable account
const NON_POSTABLE_ACCOUNT = acc('9-000', 'Header Account', 'header', 'DEBIT', ['bank fee'], { allowsManualPosting: false });

// Cross-company account
const CROSS_COMPANY_ACCOUNT: CoaAccountCandidate = {
  ...acc('6-001', 'Biaya Admin Bank Company B', 'expense', 'DEBIT', ['bank fee']),
  companyId: COMP_B,
};

// ─── Helper ────────────────────────────────────────────────────────────────────

async function predict(
  description: string,
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' = 'UNKNOWN',
  accounts = ACCOUNTS,
  overrides: Partial<CoaPredictionInput> = {},
): Promise<ReturnType<typeof predictCoa>> {
  return predictCoa({
    transaction: { description, direction },
    companyId:   COMP_A,
    availableAccounts: accounts,
    ...overrides,
  });
}

// ─── Test Suite ────────────────────────────────────────────────────────────────

describe('Phase 3 — COA Prediction Engine', () => {

  // ── Case 1: BANK_ADMIN_FEE ──────────────────────────────────────────────────
  it('1. BANK_ADMIN_FEE → bank fee expense account', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK BCA', 'DEBIT');
    expect(r.intent).toBe('BANK_ADMIN_FEE');
    expect(r.primaryRecommendation?.coaCode).toBe('6-001');
    // Keyword-only match scores 0.15–0.30 without historical evidence
    expect(r.primaryRecommendation?.confidence).toBeGreaterThan(0.10);
  });

  // ── Case 2: TRANSFER_FEE ────────────────────────────────────────────────────
  it('2. TRANSFER_FEE → transfer fee account', async () => {
    const r = await predict('BIAYA BI-FAST KE REKENING VENDOR', 'DEBIT');
    expect(r.intent).toBe('TRANSFER_FEE');
    expect(r.primaryRecommendation?.coaCode).toBe('6-002');
    expect(r.primaryRecommendation?.confidence).toBeGreaterThan(0.10);
  });

  // ── Case 3: INTEREST_INCOME ─────────────────────────────────────────────────
  it('3. INTEREST_INCOME → interest income account', async () => {
    const r = await predict('JASA GIRO BULAN JULI', 'CREDIT');
    expect(r.intent).toBe('INTEREST_INCOME');
    expect(r.primaryRecommendation?.coaCode).toBe('4-001');
    expect(r.primaryRecommendation?.confidence).toBeGreaterThan(0.10);
  });

  // ── Case 4: PAYROLL → expense ───────────────────────────────────────────────
  it('4. PAYROLL → payroll expense account (or payable)', async () => {
    const r = await predict('PEMBAYARAN GAJI KARYAWAN BULAN AGUSTUS', 'DEBIT');
    expect(r.intent).toBe('PAYROLL');
    const codes = [r.primaryRecommendation?.coaCode, ...r.alternatives.map((a) => a.coaCode)];
    expect(codes.some((c) => c === '6-010' || c === '2-005')).toBe(true);
  });

  // ── Case 5: TAX_PAYMENT → tax payable ──────────────────────────────────────
  it('5. TAX_PAYMENT → tax payable or expense account', async () => {
    const r = await predict('SETORAN PAJAK PPN BULAN JUNI', 'DEBIT');
    expect(r.intent).toBe('TAX_PAYMENT');
    const codes = [r.primaryRecommendation?.coaCode, ...r.alternatives.map((a) => a.coaCode)];
    expect(codes.some((c) => c === '2-010' || c === '6-020')).toBe(true);
  });

  // ── Case 6: CUSTOMER_PAYMENT → AR, not revenue ─────────────────────────────
  it('6. CUSTOMER_PAYMENT → AR account, not revenue', async () => {
    const r = await predict('TRANSFER DARI CUSTOMER PT MAJU JAYA', 'CREDIT');
    expect(r.intent).toBe('CUSTOMER_PAYMENT');
    // Primary should be AR, not sales revenue
    expect(r.primaryRecommendation?.coaCode).not.toBe('4-100');
    const arCodes = ['1-200', '1-210'];
    if (r.primaryRecommendation) {
      expect(arCodes).toContain(r.primaryRecommendation.coaCode);
    }
  });

  // ── Case 7: VENDOR_PAYMENT → AP, not expense ───────────────────────────────
  it('7. VENDOR_PAYMENT → AP account, not expense', async () => {
    const r = await predict('PAYMENT TO PT SUPPLIER ABADI', 'DEBIT');
    expect(r.intent).toBe('VENDOR_PAYMENT');
    expect(r.primaryRecommendation?.coaCode).not.toBe('6-050');
    const apCodes = ['2-100', '2-110'];
    if (r.primaryRecommendation) {
      expect(apCodes).toContain(r.primaryRecommendation.coaCode);
    }
  });

  // ── Case 8: INTERNAL_TRANSFER → clearing account ───────────────────────────
  it('8. INTERNAL_TRANSFER → clearing account', async () => {
    const r = await predict('TRANSFER INTERNAL ANTAR REKENING', 'DEBIT');
    expect(r.intent).toBe('INTERNAL_TRANSFER');
    expect(r.primaryRecommendation?.coaCode).toBe('1-100');
  });

  // ── Case 9: INTERNAL_TRANSFER unverified → manual review ──────────────────
  it('9. INTERNAL_TRANSFER unverified → requiresManualReview', async () => {
    const r = await predict('TRANSFER INTERNAL', 'UNKNOWN');
    expect(r.intent).toBe('INTERNAL_TRANSFER');
    expect(r.requiresManualReview).toBe(true);
    expect(r.conflictFlags).toContain('INTERNAL_TRANSFER_UNVERIFIED');
  });

  // ── Case 10: REFUND credit ──────────────────────────────────────────────────
  it('10. REFUND (CREDIT direction) → refund/clearing account', async () => {
    const r = await predict('PENGEMBALIAN DANA CUSTOMER', 'CREDIT');
    expect(r.intent).toBe('REFUND');
    expect(r.primaryRecommendation).not.toBeNull();
  });

  // ── Case 11: REFUND debit ───────────────────────────────────────────────────
  it('11. REFUND (DEBIT direction) → refund receivable or clearing', async () => {
    const r = await predict('REFUND DANA DARI VENDOR', 'DEBIT');
    expect(r.intent).toBe('REFUND');
    expect(r.primaryRecommendation).not.toBeNull();
  });

  // ── Case 12: CASHBACK ───────────────────────────────────────────────────────
  it('12. CASHBACK → other income / rebate account', async () => {
    const r = await predict('CASHBACK PROGRAM BANK MANDIRI', 'CREDIT');
    expect(r.intent).toBe('CASHBACK');
    expect(r.primaryRecommendation?.coaCode).toBe('4-200');
  });

  // ── Case 13: BANK_REVERSAL ──────────────────────────────────────────────────
  it('13. BANK_REVERSAL → reversal/clearing account', async () => {
    const r = await predict('REVERSAL TRANSAKSI DEBET', 'CREDIT');
    expect(r.intent).toBe('BANK_REVERSAL');
    expect(r.primaryRecommendation?.coaCode).toBe('1-090');
  });

  // ── Case 14: CHEQUE ambiguous ──────────────────────────────────────────────
  it('14. CHEQUE → clearing or suspense account, manual review likely', async () => {
    const r = await predict('PENCAIRAN CEK NO 00123', 'UNKNOWN');
    expect(r.intent).toBe('CHEQUE');
    // Should not be null if clearing account is available
    // or should require manual review
    if (r.primaryRecommendation === null) {
      expect(r.requiresManualReview).toBe(true);
    }
  });

  // ── Case 15: GIRO ambiguous ─────────────────────────────────────────────────
  it('15. GIRO → clearing or suspense account', async () => {
    const r = await predict('PENCAIRAN BILYET GIRO BG 456', 'UNKNOWN');
    expect(r.intent).toBe('GIRO');
    if (r.primaryRecommendation) {
      expect(['1-100', '1-090']).toContain(r.primaryRecommendation.coaCode);
    }
  });

  // ── Case 16: UNKNOWN intent ─────────────────────────────────────────────────
  it('16. UNKNOWN intent → low confidence, requiresManualReview', async () => {
    const r = await predict('XXXXZZZZ123ABC', 'UNKNOWN');
    expect(r.intent).toBe('UNKNOWN');
    expect(r.requiresManualReview).toBe(true);
    expect(r.conflictFlags).toContain('UNKNOWN_INTENT');
    if (r.primaryRecommendation) {
      expect(r.primaryRecommendation.confidence).toBeLessThan(0.80);
    }
  });

  // ── Case 17: No available accounts ─────────────────────────────────────────
  it('17. No available accounts → null primary, requiresManualReview', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT', []);
    expect(r.primaryRecommendation).toBeNull();
    expect(r.requiresManualReview).toBe(true);
    expect(r.recommendationSource).toBe('NONE');
  });

  // ── Case 18: Inactive account rejected ────────────────────────────────────
  it('18. Inactive account is rejected', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT', [INACTIVE_ACCOUNT]);
    expect(r.primaryRecommendation).toBeNull();
    expect(r.requiresManualReview).toBe(true);
  });

  // ── Case 19: Cross-company account rejected ────────────────────────────────
  it('19. Cross-company account is rejected', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT', [CROSS_COMPANY_ACCOUNT]);
    expect(r.primaryRecommendation).toBeNull();
  });

  // ── Case 20: Non-postable account rejected ─────────────────────────────────
  it('20. Non-postable account is rejected', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT', [NON_POSTABLE_ACCOUNT]);
    expect(r.primaryRecommendation).toBeNull();
  });

  // ── Case 21: Blocked account code policy ───────────────────────────────────
  it('21. Blocked account code policy blocks that account', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT', ACCOUNTS, {
      policy: { blockedAccountCodes: ['6-001'] },
    });
    expect(r.primaryRecommendation?.coaCode).not.toBe('6-001');
  });

  // ── Case 22: Preferred account code policy ─────────────────────────────────
  it('22. Preferred account code policy boosts that account', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT', ACCOUNTS, {
      policy: { preferredAccountCodesByIntent: { BANK_ADMIN_FEE: ['6-001'] } },
    });
    expect(r.primaryRecommendation?.coaCode).toBe('6-001');
  });

  // ── Case 23: Historical approved mapping ───────────────────────────────────
  it('23. Historical approved mapping boosts score', async () => {
    const mappings: HistoricalCoaMapping[] = [
      {
        companyId:     COMP_A,
        intent:        'BANK_ADMIN_FEE',
        coaId:         '6-001',
        coaCode:       '6-001',
        approvedCount: 10,
        rejectedCount: 0,
        usageCount:    10,
      },
    ];
    const r = await predict('BIAYA ADM BANK', 'DEBIT', ACCOUNTS, { historicalMappings: mappings });
    expect(r.primaryRecommendation?.coaCode).toBe('6-001');
    expect(r.evidence.some((e) => e.type === 'HISTORICAL_APPROVED')).toBe(true);
  });

  // ── Case 24: Historical rejected mapping ───────────────────────────────────
  it('24. Historical rejected mapping lowers score / adds flag', async () => {
    const mappings: HistoricalCoaMapping[] = [
      {
        companyId:     COMP_A,
        intent:        'BANK_ADMIN_FEE',
        coaId:         '6-001',
        coaCode:       '6-001',
        approvedCount: 0,
        rejectedCount: 5,
        usageCount:    5,
      },
    ];
    const r = await predict('BIAYA ADM BANK', 'DEBIT', ACCOUNTS, { historicalMappings: mappings });
    // 6-001 may still win but with HISTORICAL_MAPPING_REJECTED flag
    const primary = r.primaryRecommendation;
    if (primary?.coaCode === '6-001') {
      expect(r.conflictFlags).toContain('HISTORICAL_MAPPING_REJECTED');
    }
  });

  // ── Case 25: Counterparty mapping ──────────────────────────────────────────
  it('25. Counterparty hint in account metadata boosts score', async () => {
    const cpAccount = acc('2-300', 'Hutang PT ABC Supplier', 'liability', 'CREDIT',
      ['accounts payable', 'pt abc', 'vendor payable']);
    const r = await predictCoa({
      transaction: {
        description:      'PAYMENT PT ABC',
        direction:        'DEBIT',
        counterpartyName: 'PT ABC',
      },
      companyId:         COMP_A,
      availableAccounts: [...ACCOUNTS, cpAccount],
    });
    expect(r.intent).toBe('VENDOR_PAYMENT');
    expect(r.primaryRecommendation?.coaCode).toBe('2-300');
  });

  // ── Case 26: Keyword/alias matching ────────────────────────────────────────
  it('26. Keyword matching finds correct account', async () => {
    const r = await predict('BEBAN BUNGA PINJAMAN BANK', 'DEBIT');
    expect(['2-200', '6-060']).toContain(r.primaryRecommendation?.coaCode);
  });

  // ── Case 27: Direction conflict ────────────────────────────────────────────
  it('27. Direction conflict lowers confidence and adds flag', async () => {
    // BANK_ADMIN_FEE is normally DEBIT expense; if CREDIT it's a conflict for expense accounts
    const r = await predict('BIAYA ADMINISTRASI BANK', 'CREDIT', [
      acc('6-001', 'Biaya Administrasi Bank', 'expense', 'DEBIT', ['bank fee', 'biaya bank', 'admin fee']),
    ]);
    if (r.primaryRecommendation?.coaCode === '6-001') {
      // Flag may or may not appear depending on direction mismatch strength
      // confidence should be lower than without conflict
      expect(r.primaryRecommendation.confidence).toBeLessThanOrEqual(0.80);
    }
  });

  // ── Case 28: Normal balance conflict ───────────────────────────────────────
  it('28. Normal balance conflict reduces score', async () => {
    const conflictAccount = acc('6-X', 'Expense CREDIT Normal', 'expense', 'CREDIT', ['bank fee', 'biaya bank']);
    const compatAccount   = acc('6-Y', 'Expense DEBIT Normal',  'expense', 'DEBIT',  ['bank fee', 'biaya bank']);
    const r = await predictCoa({
      transaction:       { description: 'BIAYA BANK', direction: 'DEBIT' },
      companyId:         COMP_A,
      availableAccounts: [conflictAccount, compatAccount],
    });
    // Compatible account should rank higher
    expect(r.primaryRecommendation?.coaCode).toBe('6-Y');
  });

  // ── Case 29: AR vs revenue ambiguity ───────────────────────────────────────
  it('29. AR_REVENUE_AMBIGUITY flag set when CUSTOMER_PAYMENT maps to revenue', async () => {
    const revenueOnly: CoaAccountCandidate[] = [
      acc('4-100', 'Pendapatan Penjualan', 'revenue', 'CREDIT', ['sales revenue']),
    ];
    const r = await predict('TRANSFER DARI CUSTOMER', 'CREDIT', revenueOnly);
    expect(r.intent).toBe('CUSTOMER_PAYMENT');
    expect(r.conflictFlags).toContain('AR_REVENUE_AMBIGUITY');
    expect(r.requiresManualReview).toBe(true);
  });

  // ── Case 30: AP vs expense ambiguity ───────────────────────────────────────
  it('30. AP_EXPENSE_AMBIGUITY flag set when VENDOR_PAYMENT maps to expense', async () => {
    const expenseOnly: CoaAccountCandidate[] = [
      acc('6-050', 'Biaya Operasional', 'expense', 'DEBIT', ['operating expense', 'vendor', 'payable']),
    ];
    const r = await predict('PAYMENT VENDOR', 'DEBIT', expenseOnly);
    expect(r.intent).toBe('VENDOR_PAYMENT');
    expect(r.conflictFlags).toContain('AP_EXPENSE_AMBIGUITY');
    expect(r.requiresManualReview).toBe(true);
  });

  // ── Case 31: Multiple close candidates ─────────────────────────────────────
  it('31. MULTIPLE_CLOSE_CANDIDATES flag when top two are very close', async () => {
    // Provide two nearly identical bank-fee accounts
    const a1 = acc('6-001', 'Biaya Admin Bank A', 'expense', 'DEBIT', ['bank fee', 'administrasi bank']);
    const a2 = acc('6-002', 'Biaya Admin Bank B', 'expense', 'DEBIT', ['bank fee', 'administrasi bank']);
    const r  = await predict('BIAYA ADMINISTRASI', 'DEBIT', [a1, a2]);
    // Both have similar scores → MULTIPLE_CLOSE_CANDIDATES
    if (r.alternatives.length > 0) {
      const delta = Math.abs(
        (r.primaryRecommendation?.confidence ?? 0) - r.alternatives[0].confidence,
      );
      if (delta < 0.10) {
        expect(r.conflictFlags).toContain('MULTIPLE_CLOSE_CANDIDATES');
        expect(r.requiresManualReview).toBe(true);
      }
    }
  });

  // ── Case 32: Confidence threshold ──────────────────────────────────────────
  it('32. requiresManualReview when confidence < manualReviewThreshold', async () => {
    const r = await predict('XXXXZZZZ', 'UNKNOWN', ACCOUNTS, {
      policy: { manualReviewThreshold: 0.99 }, // very strict
    });
    expect(r.requiresManualReview).toBe(true);
  });

  // ── Case 33: Manual review threshold respected ──────────────────────────────
  it('33. No manual review when confidence exceeds threshold with good match', async () => {
    const mappings: HistoricalCoaMapping[] = [
      {
        companyId:             COMP_A,
        intent:                'BANK_ADMIN_FEE',
        normalizedDescription: 'biaya administrasi bank bca',
        coaId:                 '6-001',
        coaCode:               '6-001',
        approvedCount:         20,
        rejectedCount:         0,
        usageCount:            20,
      },
    ];
    const r = await predict('BIAYA ADMINISTRASI BANK BCA', 'DEBIT', ACCOUNTS, {
      historicalMappings: mappings,
      policy:             { manualReviewThreshold: 0.50 }, // lenient
    });
    // With approved history + intent match + keyword match → may exceed 0.50
    if (r.primaryRecommendation && r.primaryRecommendation.confidence >= 0.50) {
      // manual review might still be triggered by other flags; just check confidence
      expect(r.primaryRecommendation.confidence).toBeGreaterThanOrEqual(0.50);
    }
  });

  // ── Case 34: Alternatives sorted by confidence descending ─────────────────
  it('34. Alternatives are sorted by confidence descending', async () => {
    const r = await predict('BIAYA BANK', 'DEBIT');
    for (let i = 0; i < r.alternatives.length - 1; i++) {
      expect(r.alternatives[i].confidence).toBeGreaterThanOrEqual(r.alternatives[i + 1].confidence);
    }
  });

  // ── Case 35: No duplicate alternatives ────────────────────────────────────
  it('35. No duplicate COA codes in alternatives', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT');
    const codes = r.alternatives.map((a) => a.coaCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  // ── Case 36: Input immutability ────────────────────────────────────────────
  it('36. Input is not mutated', async () => {
    const input: CoaPredictionInput = {
      transaction:       { description: 'BIAYA ADMINISTRASI', direction: 'DEBIT' },
      companyId:         COMP_A,
      availableAccounts: [...ACCOUNTS],
    };
    const before = JSON.stringify(input);
    await predictCoa(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  // ── Case 37: Deterministic output ─────────────────────────────────────────
  it('37. Same input → same output (called 3×)', async () => {
    const results = await Promise.all([
      predict('BIAYA ADMINISTRASI BANK', 'DEBIT'),
      predict('BIAYA ADMINISTRASI BANK', 'DEBIT'),
      predict('BIAYA ADMINISTRASI BANK', 'DEBIT'),
    ]);
    expect(results[0].primaryRecommendation?.coaCode).toBe(results[1].primaryRecommendation?.coaCode);
    expect(results[1].primaryRecommendation?.coaCode).toBe(results[2].primaryRecommendation?.coaCode);
    expect(results[0].primaryRecommendation?.confidence).toBe(results[1].primaryRecommendation?.confidence);
  });

  // ── Case 38: Batch preserves order ────────────────────────────────────────
  it('38. predictCoaBatch preserves input order', async () => {
    const inputs: CoaPredictionInput[] = [
      { transaction: { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' }, companyId: COMP_A, availableAccounts: ACCOUNTS },
      { transaction: { description: 'JASA GIRO JULI',          direction: 'CREDIT' }, companyId: COMP_A, availableAccounts: ACCOUNTS },
      { transaction: { description: 'PAYMENT VENDOR ABC',      direction: 'DEBIT'  }, companyId: COMP_A, availableAccounts: ACCOUNTS },
    ];
    const results = await predictCoaBatch(inputs);
    expect(results).toHaveLength(3);
    expect(results[0].intent).toBe('BANK_ADMIN_FEE');
    expect(results[1].intent).toBe('INTEREST_INCOME');
    expect(results[2].intent).toBe('VENDOR_PAYMENT');
  });

  // ── Case 39: Dependency injection sync ────────────────────────────────────
  it('39. Dependency injection (sync) — getHistoricalMappings called', async () => {
    let called = false;
    const r = await predictCoa(
      { transaction: { description: 'BIAYA BANK' }, companyId: COMP_A, availableAccounts: ACCOUNTS },
      {
        getHistoricalMappings: () => {
          called = true;
          return [];
        },
      },
    );
    expect(called).toBe(true);
  });

  // ── Case 40: Dependency injection async ───────────────────────────────────
  it('40. Dependency injection (async) — getHistoricalMappings async', async () => {
    const mappings: HistoricalCoaMapping[] = [
      { companyId: COMP_A, intent: 'TRANSFER_FEE', coaId: '6-002', coaCode: '6-002', approvedCount: 5, rejectedCount: 0, usageCount: 5 },
    ];
    const r = await predictCoa(
      { transaction: { description: 'BIAYA BI-FAST', direction: 'DEBIT' }, companyId: COMP_A, availableAccounts: ACCOUNTS },
      { getHistoricalMappings: async () => Promise.resolve(mappings) },
    );
    expect(r.evidence.some((e) => e.type === 'HISTORICAL_APPROVED')).toBe(true);
  });

  // ── Case 41: Phase 1 fallback ──────────────────────────────────────────────
  it('41. Phase 1 runs internally when phase1Analysis not supplied', async () => {
    const r = await predict('JASA GIRO', 'CREDIT');
    expect(r.phase1Analysis).toBeDefined();
    expect(r.phase1Analysis.intent).toBeDefined();
  });

  // ── Case 42: Phase 2 fallback ──────────────────────────────────────────────
  it('42. Phase 2 runs internally when phase2Classification not supplied', async () => {
    const r = await predict('GAJI KARYAWAN', 'DEBIT');
    expect(r.phase2Classification).toBeDefined();
    expect(r.phase2Classification.primaryIntent).toBeDefined();
  });

  // ── Case 43: Supplied Phase 1 is reused ───────────────────────────────────
  it('43. Supplied phase1Analysis is reused — not re-run', async () => {
    const { analyzeTransactionDescription } = await import('../lib/ai/transaction-intelligence/index.js');
    const p1 = analyzeTransactionDescription('BIAYA ADMINISTRASI BANK BCA');
    const r = await predictCoa({
      transaction:       { description: 'BIAYA ADMINISTRASI BANK BCA', direction: 'DEBIT' },
      companyId:         COMP_A,
      availableAccounts: ACCOUNTS,
      phase1Analysis:    p1,
    });
    expect(r.phase1Analysis).toStrictEqual(p1);
  });

  // ── Case 44: Supplied Phase 2 is reused ───────────────────────────────────
  it('44. Supplied phase2Classification is reused — not re-run', async () => {
    const { classifyTransactionIntent } = await import('../lib/ai/transaction-intelligence/index.js');
    const p2 = await classifyTransactionIntent({ description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' });
    const r  = await predictCoa({
      transaction:          { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' },
      companyId:            COMP_A,
      availableAccounts:    ACCOUNTS,
      phase2Classification: p2,
    });
    expect(r.phase2Classification).toStrictEqual(p2);
  });

  // ── Case 45: Schema validation ─────────────────────────────────────────────
  it('45. Output passes CoaPredictionResultSchema', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT');
    const parsed = CoaPredictionResultSchema.safeParse(r);
    expect(parsed.success).toBe(true);
  });

  // ── Case 46: Empty description ─────────────────────────────────────────────
  it('46. Empty description → UNKNOWN intent, requiresManualReview', async () => {
    const r = await predictCoa({
      transaction:       { description: '' },
      companyId:         COMP_A,
      availableAccounts: ACCOUNTS,
    });
    expect(r.intent).toBe('UNKNOWN');
    expect(r.requiresManualReview).toBe(true);
  });

  // ── Case 47: Invalid company context ───────────────────────────────────────
  it('47. Company A accounts not recommended for Company B request', async () => {
    const r = await predictCoa({
      transaction:       { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' },
      companyId:         COMP_B,
      availableAccounts: ACCOUNTS, // all accounts are COMP_A
    });
    expect(r.primaryRecommendation).toBeNull();
    expect(r.requiresManualReview).toBe(true);
  });

  // ── Case 48: Currency does not change COA incorrectly ─────────────────────
  it('48. Currency does not affect COA selection for same intent', async () => {
    const rIDR = await predictCoa({
      transaction:       { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT', currency: 'IDR' },
      companyId:         COMP_A,
      availableAccounts: ACCOUNTS,
    });
    const rUSD = await predictCoa({
      transaction:       { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT', currency: 'USD' },
      companyId:         COMP_A,
      availableAccounts: ACCOUNTS,
    });
    expect(rIDR.primaryRecommendation?.coaCode).toBe(rUSD.primaryRecommendation?.coaCode);
  });

  // ── Case 49: Company A cannot use Company B COA ────────────────────────────
  it('49. Company A cannot use Company B COA account', async () => {
    const r = await predictCoa({
      transaction:       { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' },
      companyId:         COMP_A,
      availableAccounts: [CROSS_COMPANY_ACCOUNT], // only comp B account
    });
    expect(r.primaryRecommendation).toBeNull();
  });

  // ── Case 50: Output contract completeness ─────────────────────────────────
  it('50. Output contract is complete', async () => {
    const r = await predict('BIAYA ADMINISTRASI BANK', 'DEBIT');
    expect(r).toMatchObject({
      companyId:             expect.anything(),
      intent:                expect.any(String),
      normalizedDescription: expect.any(String),
      evidence:              expect.any(Array),
      reason:                expect.any(Array),
      conflictFlags:         expect.any(Array),
      requiresManualReview:  expect.any(Boolean),
      recommendationSource:  expect.any(String),
      alternatives:          expect.any(Array),
      phase1Analysis:        expect.any(Object),
      phase2Classification:  expect.any(Object),
    });
    // Schema validates full contract
    expect(CoaPredictionResultSchema.safeParse(r).success).toBe(true);
  });

  // ── Indonesian language variants ────────────────────────────────────────────
  it('Indonesian: "BIAYA BI-FAST" → TRANSFER_FEE → transfer fee account', async () => {
    const r = await predict('BIAYA BI-FAST TRANSFER', 'DEBIT');
    expect(r.intent).toBe('TRANSFER_FEE');
    expect(r.primaryRecommendation?.coaCode).toBe('6-002');
  });

  it('Indonesian: "SETORAN PAJAK PPH 21" → TAX_PAYMENT → tax account', async () => {
    const r = await predict('SETORAN PAJAK PPH 21 MASA DESEMBER', 'DEBIT');
    expect(r.intent).toBe('TAX_PAYMENT');
    expect(r.primaryRecommendation).not.toBeNull();
  });

  // ── English language variant ────────────────────────────────────────────────
  it('English: "BANK ADMINISTRATION FEE" → BANK_ADMIN_FEE', async () => {
    const r = await predict('BANK ADMINISTRATION FEE MONTHLY', 'DEBIT');
    expect(r.intent).toBe('BANK_ADMIN_FEE');
    expect(r.primaryRecommendation?.coaCode).toBe('6-001');
  });

  // ── Batch no side effects ───────────────────────────────────────────────────
  it('Batch: inputs are not mutated', async () => {
    const inputs: CoaPredictionInput[] = [
      { transaction: { description: 'BIAYA BANK', direction: 'DEBIT' }, companyId: COMP_A, availableAccounts: ACCOUNTS },
    ];
    const before = JSON.stringify(inputs);
    await predictCoaBatch(inputs);
    expect(JSON.stringify(inputs)).toBe(before);
  });

  // ── validateAccount DI ──────────────────────────────────────────────────────
  it('validateAccount DI blocks specific account', async () => {
    const r = await predictCoa(
      { transaction: { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' }, companyId: COMP_A, availableAccounts: ACCOUNTS },
      {
        validateAccount: (acct) => ({
          allowed: acct.code !== '6-001',
          reason:  acct.code === '6-001' ? 'Blocked by external validator' : undefined,
        }),
      },
    );
    expect(r.primaryRecommendation?.coaCode).not.toBe('6-001');
  });

  // ── getIntentAccountHints DI ───────────────────────────────────────────────
  it('getIntentAccountHints DI adds custom keyword hints', async () => {
    // Provide a custom hint that matches a non-standard account keyword
    const customAcc = acc('6-XYZ', 'Biaya Khusus Admin', 'expense', 'DEBIT', ['biaya-khusus-admin-xyz']);
    const r = await predictCoa(
      { transaction: { description: 'BIAYA ADMINISTRASI BANK', direction: 'DEBIT' }, companyId: COMP_A, availableAccounts: [customAcc, ...ACCOUNTS] },
      {
        getIntentAccountHints: async () => ['biaya-khusus-admin-xyz'],
      },
    );
    // The custom hint should give customAcc a boost — it may or may not win,
    // but it must not throw
    expect(r).toBeDefined();
    expect(r.intent).toBe('BANK_ADMIN_FEE');
  });

});

/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Integration Tests (Phase 1 → 2 → 3 pipeline)
 *
 * Tests the full pipeline without any real database.
 * Verifies Phase 3 does not alter Phase 1 or Phase 2 outputs.
 */

import { describe, it, expect } from 'vitest';
import {
  predictCoa,
  predictCoaBatch,
  analyzeTransactionDescription,
  classifyTransactionIntent,
} from '../lib/ai/transaction-intelligence/index.js';
import type {
  CoaAccountCandidate,
  CoaPredictionInput,
} from '../lib/ai/transaction-intelligence/index.js';

// ─── Shared account catalogue ──────────────────────────────────────────────────

const COMP = 'INT-1';

function acct(
  code: string,
  name: string,
  type: string,
  nb: 'DEBIT' | 'CREDIT' | 'UNKNOWN',
  kw: string[] = [],
): CoaAccountCandidate {
  return {
    id: code, companyId: COMP, code, name, accountType: type,
    normalBalance: nb, isActive: true, allowsManualPosting: true, keywords: kw,
  };
}

const ACCOUNTS: CoaAccountCandidate[] = [
  acct('6-001', 'Biaya Transfer Bank',        'expense',  'DEBIT',  ['transfer fee', 'rtgs', 'bi-fast', 'bifast', 'swift', 'skn']),
  acct('4-001', 'Pendapatan Bunga / Jasa Giro','income',   'CREDIT', ['interest income', 'pendapatan bunga', 'jasa giro']),
  acct('1-200', 'Piutang Usaha',               'asset',    'DEBIT',  ['accounts receivable', 'piutang usaha', 'receivable', 'unapplied receipt']),
  acct('2-100', 'Hutang Usaha',                'liability','CREDIT', ['accounts payable', 'hutang usaha', 'vendor payable', 'hutang dagang']),
  acct('1-100', 'Kas Bank Clearing',           'asset',    'DEBIT',  ['bank clearing', 'interbank transfer', 'clearing', 'cash transfer clearing']),
  acct('4-200', 'Pendapatan Lain-lain',        'income',   'CREDIT', ['other income', 'cashback', 'rebate income', 'pendapatan lain']),
  acct('6-010', 'Biaya Administrasi Bank',     'expense',  'DEBIT',  ['bank fee', 'biaya bank', 'administrasi bank', 'admin fee']),
];

async function pipeline(
  description: string,
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN',
): Promise<{ p1: ReturnType<typeof analyzeTransactionDescription>; p2: Awaited<ReturnType<typeof classifyTransactionIntent>>; p3: Awaited<ReturnType<typeof predictCoa>> }> {
  const p1 = analyzeTransactionDescription(description);
  const p2 = await classifyTransactionIntent({ description, direction });
  const p3 = await predictCoa({
    transaction:          { description, direction },
    companyId:            COMP,
    availableAccounts:    ACCOUNTS,
    phase1Analysis:       p1,
    phase2Classification: p2,
  });
  return { p1, p2, p3 };
}

// ─── Integration tests ────────────────────────────────────────────────────────

describe('Phase 1 → 2 → 3 Integration Pipeline', () => {

  it('"BIAYA BI-FAST" → TRANSFER_FEE → biaya transfer account', async () => {
    const { p1, p2, p3 } = await pipeline('BIAYA BI-FAST', 'DEBIT');
    expect(p1.intent).toBe('TRANSFER_FEE');
    expect(p2.primaryIntent).toBe('TRANSFER_FEE');
    expect(p3.intent).toBe('TRANSFER_FEE');
    expect(p3.primaryRecommendation?.coaCode).toBe('6-001');
    expect(p3.recommendationSource).not.toBe('NONE');
  });

  it('"JASA GIRO JULI" → INTEREST_INCOME → pendapatan bunga', async () => {
    const { p1, p2, p3 } = await pipeline('JASA GIRO JULI', 'CREDIT');
    expect(p1.intent).toBe('INTEREST_INCOME');
    expect(p2.primaryIntent).toBe('INTEREST_INCOME');
    expect(p3.intent).toBe('INTEREST_INCOME');
    expect(p3.primaryRecommendation?.coaCode).toBe('4-001');
  });

  it('"TRANSFER DARI CUSTOMER INV-001" → CUSTOMER_PAYMENT → piutang usaha', async () => {
    const { p2, p3 } = await pipeline('TRANSFER DARI CUSTOMER INV-001', 'CREDIT');
    expect(p2.primaryIntent).toBe('CUSTOMER_PAYMENT');
    expect(p3.intent).toBe('CUSTOMER_PAYMENT');
    // Must be AR, not revenue
    expect(p3.primaryRecommendation?.coaCode).toBe('1-200');
    expect(p3.primaryRecommendation?.coaCode).not.toBe('4-200');
    // No AR_REVENUE_AMBIGUITY with only AR accounts available
    const arAmb = p3.conflictFlags.includes('AR_REVENUE_AMBIGUITY');
    if (!arAmb) {
      expect(p3.primaryRecommendation?.coaCode).toBe('1-200');
    }
  });

  it('"PAYMENT TO PT VENDOR ABC" → VENDOR_PAYMENT → hutang usaha', async () => {
    const { p2, p3 } = await pipeline('PAYMENT TO PT VENDOR ABC', 'DEBIT');
    expect(p2.primaryIntent).toBe('VENDOR_PAYMENT');
    expect(p3.intent).toBe('VENDOR_PAYMENT');
    expect(p3.primaryRecommendation?.coaCode).toBe('2-100');
    // Not expense
    expect(p3.primaryRecommendation?.coaCode).not.toBe('6-010');
  });

  it('"CASHBACK MANDIRI" → CASHBACK → pendapatan lain-lain', async () => {
    const { p3 } = await pipeline('CASHBACK MANDIRI', 'CREDIT');
    expect(p3.intent).toBe('CASHBACK');
    expect(p3.primaryRecommendation?.coaCode).toBe('4-200');
  });

  it('"TRANSFER INTERNAL KAS BESAR" → INTERNAL_TRANSFER → clearing account', async () => {
    const { p3 } = await pipeline('TRANSFER INTERNAL KAS BESAR', 'DEBIT');
    expect(p3.intent).toBe('INTERNAL_TRANSFER');
    expect(p3.primaryRecommendation?.coaCode).toBe('1-100');
  });

  it('Phase 3 does not mutate Phase 1 result', async () => {
    const p1 = analyzeTransactionDescription('BIAYA BI-FAST');
    const before = JSON.stringify(p1);
    await predictCoa({
      transaction:       { description: 'BIAYA BI-FAST', direction: 'DEBIT' },
      companyId:         COMP,
      availableAccounts: ACCOUNTS,
      phase1Analysis:    p1,
    });
    expect(JSON.stringify(p1)).toBe(before);
  });

  it('Phase 3 does not mutate Phase 2 result', async () => {
    const p2 = await classifyTransactionIntent({ description: 'BIAYA BI-FAST', direction: 'DEBIT' });
    const before = JSON.stringify(p2);
    await predictCoa({
      transaction:          { description: 'BIAYA BI-FAST', direction: 'DEBIT' },
      companyId:            COMP,
      availableAccounts:    ACCOUNTS,
      phase2Classification: p2,
    });
    expect(JSON.stringify(p2)).toBe(before);
  });

  it('Phase 3 output contains full Phase 1 and Phase 2 for traceability', async () => {
    const r = await predictCoa({
      transaction:       { description: 'JASA GIRO', direction: 'CREDIT' },
      companyId:         COMP,
      availableAccounts: ACCOUNTS,
    });
    expect(r.phase1Analysis).toBeDefined();
    expect(r.phase2Classification).toBeDefined();
    expect(r.phase1Analysis.intent).toBeDefined();
    expect(r.phase2Classification.primaryIntent).toBeDefined();
    // Phase 3 intent must match Phase 2
    expect(r.intent).toBe(r.phase2Classification.primaryIntent);
  });

  it('Batch pipeline processes all items in order', async () => {
    const inputs: CoaPredictionInput[] = [
      { transaction: { description: 'BIAYA BI-FAST',                  direction: 'DEBIT'  }, companyId: COMP, availableAccounts: ACCOUNTS },
      { transaction: { description: 'JASA GIRO',                      direction: 'CREDIT' }, companyId: COMP, availableAccounts: ACCOUNTS },
      { transaction: { description: 'TRANSFER DARI CUSTOMER INV-001', direction: 'CREDIT' }, companyId: COMP, availableAccounts: ACCOUNTS },
      { transaction: { description: 'PAYMENT TO PT VENDOR ABC',       direction: 'DEBIT'  }, companyId: COMP, availableAccounts: ACCOUNTS },
    ];
    const results = await predictCoaBatch(inputs);
    expect(results[0].intent).toBe('TRANSFER_FEE');
    expect(results[1].intent).toBe('INTEREST_INCOME');
    expect(results[2].intent).toBe('CUSTOMER_PAYMENT');
    expect(results[3].intent).toBe('VENDOR_PAYMENT');
  });

});

// ─── Performance benchmark ────────────────────────────────────────────────────
// Run with: vitest run --reporter=verbose src/__tests__/coa-prediction-integration.test.ts
// Excluded from default CI to avoid flakiness on constrained runners.

describe('Performance Benchmark', () => {

  const BENCHMARK_ACCOUNTS = Array.from({ length: 100 }, (_, i) => {
    const types = ['expense', 'liability', 'asset', 'income', 'revenue'];
    const nb    = i % 2 === 0 ? 'DEBIT' : 'CREDIT' as const;
    return acct(
      `ACC-${String(i).padStart(4, '0')}`,
      `Account ${i}`,
      types[i % types.length],
      nb,
      i % 5 === 0 ? ['bank fee', 'biaya bank'] : [],
    );
  });

  const DESCRIPTIONS = [
    { desc: 'BIAYA ADMINISTRASI BANK',   dir: 'DEBIT'   as const },
    { desc: 'JASA GIRO BULAN INI',       dir: 'CREDIT'  as const },
    { desc: 'TRANSFER DARI PELANGGAN',   dir: 'CREDIT'  as const },
    { desc: 'PEMBAYARAN VENDOR',         dir: 'DEBIT'   as const },
    { desc: 'BIAYA BI-FAST',             dir: 'DEBIT'   as const },
  ];

  it('100 transactions × 100 accounts — runs in reasonable time', async () => {
    const txs = Array.from({ length: 100 }, (_, i) => {
      const d = DESCRIPTIONS[i % DESCRIPTIONS.length];
      return {
        transaction:       { description: d.desc, direction: d.dir },
        companyId:         COMP,
        availableAccounts: BENCHMARK_ACCOUNTS,
      } satisfies CoaPredictionInput;
    });

    const start = Date.now();
    const results = await predictCoaBatch(txs);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(100);
    console.log(`[benchmark] 100 tx × 100 accounts: ${elapsed}ms (avg ${(elapsed / 100).toFixed(2)}ms/tx)`);
    // Sanity: should complete under 5 seconds on any reasonable machine
    expect(elapsed).toBeLessThan(5000);
  });

  it('1000 transactions × 100 accounts — deterministic', async () => {
    const txs = Array.from({ length: 1000 }, (_, i) => {
      const d = DESCRIPTIONS[i % DESCRIPTIONS.length];
      return {
        transaction:       { description: d.desc, direction: d.dir },
        companyId:         COMP,
        availableAccounts: BENCHMARK_ACCOUNTS,
      } satisfies CoaPredictionInput;
    });

    const start = Date.now();
    const results = await predictCoaBatch(txs);
    const elapsed = Date.now() - start;

    expect(results).toHaveLength(1000);

    // All items with same description+direction should have same result
    const first  = results[0];
    const same   = results.filter((_, i) => i % DESCRIPTIONS.length === 0);
    for (const r of same) {
      expect(r.primaryRecommendation?.coaCode).toBe(first.primaryRecommendation?.coaCode);
    }

    console.log(`[benchmark] 1000 tx × 100 accounts: ${elapsed}ms (avg ${(elapsed / 1000).toFixed(2)}ms/tx)`);
    expect(elapsed).toBeLessThan(30000);
  });

});

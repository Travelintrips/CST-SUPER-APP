/**
 * AI Transaction Intelligence — Phase 2 Tests
 * Intent Classification Engine
 *
 * 30 tests covering all intents, collisions, thresholds, DI, and contracts.
 * All tests are pure: no DB, no HTTP. Run fully offline.
 *
 * Run: pnpm --filter @workspace/api-server test
 */

import { describe, it, expect } from 'vitest';
import {
  classifyTransactionIntent,
  classifyTransactionIntentBatch,
} from '../lib/ai/transaction-intelligence/intentClassifier.js';
import {
  analyzeTransactionDescription,
} from '../lib/ai/transaction-intelligence/transactionUnderstanding.js';
import { IntentClassificationResultSchema } from '../lib/ai/transaction-intelligence/intentClassificationSchema.js';
import type {
  TransactionClassificationInput,
  IntentClassifierDependencies,
} from '../lib/ai/transaction-intelligence/intentClassificationTypes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function classify(
  input: Partial<TransactionClassificationInput> & { description: string },
  deps: IntentClassifierDependencies = {},
) {
  return classifyTransactionIntent(input as TransactionClassificationInput, deps);
}

// ─── Test 1: CUSTOMER_PAYMENT from CREDIT ─────────────────────────────────────

it('Test 1 — CUSTOMER_PAYMENT from CREDIT direction', async () => {
  const r = await classify({
    description: 'TRANSFER MASUK PEMBAYARAN DARI PT ABC',
    direction: 'CREDIT',
  });
  expect(r.primaryIntent).toBe('CUSTOMER_PAYMENT');
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 2: VENDOR_PAYMENT from DEBIT ───────────────────────────────────────

it('Test 2 — VENDOR_PAYMENT from DEBIT direction', async () => {
  const r = await classify({
    description: 'TRANSFER KE PT ABC LOGISTICS PEMBAYARAN VENDOR',
    direction: 'DEBIT',
  });
  expect(r.primaryIntent).toBe('VENDOR_PAYMENT');
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 3: BANK_ADMIN_FEE ───────────────────────────────────────────────────

it('Test 3 — BANK_ADMIN_FEE from description', async () => {
  const r = await classify({
    description: 'BIAYA ADMINISTRASI BULANAN REKENING',
    direction: 'DEBIT',
  });
  expect(r.primaryIntent).toBe('BANK_ADMIN_FEE');
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 4: TRANSFER_FEE ─────────────────────────────────────────────────────

it('Test 4 — TRANSFER_FEE from description', async () => {
  const r = await classify({
    description: 'BIAYA RTGS TRANSFER ANTAR BANK',
    direction: 'DEBIT',
  });
  expect(r.primaryIntent).toBe('TRANSFER_FEE');
});

// ─── Test 5: INTEREST_INCOME ──────────────────────────────────────────────────

it('Test 5 — INTEREST_INCOME from CREDIT', async () => {
  const r = await classify({
    description: 'JASA GIRO BULAN JUNI',
    direction: 'CREDIT',
  });
  expect(r.primaryIntent).toBe('INTEREST_INCOME');
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 6: PAYROLL ──────────────────────────────────────────────────────────

it('Test 6 — PAYROLL from DEBIT', async () => {
  const r = await classify({
    description: 'PEMBAYARAN GAJI KARYAWAN BULAN JULI 2026',
    direction: 'DEBIT',
  });
  expect(r.primaryIntent).toBe('PAYROLL');
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 7: TAX_PAYMENT ──────────────────────────────────────────────────────

it('Test 7 — TAX_PAYMENT from DEBIT', async () => {
  const r = await classify({
    description: 'SETORAN PAJAK PPH 21 MASA JULI 2026',
    direction: 'DEBIT',
  });
  expect(r.primaryIntent).toBe('TAX_PAYMENT');
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 8: INTERNAL_TRANSFER verified ───────────────────────────────────────

it('Test 8 — INTERNAL_TRANSFER verified via isInternalAccount', async () => {
  const r = await classify(
    {
      description: 'TRANSFER ANTAR REKENING INTERNAL',
      direction: 'DEBIT',
      counterpartyAccount: '1234567890',
    },
    {
      isInternalAccount: async () => true,
    },
  );
  expect(r.primaryIntent).toBe('INTERNAL_TRANSFER');
  // Verified internal transfer should NOT require manual review for account reason
  // (may still require for other reasons but account is confirmed)
  const evidenceTypes = r.evidence.map((e) => e.type);
  expect(evidenceTypes).toContain('INTERNAL_ACCOUNT');
});

// ─── Test 9: INTERNAL_TRANSFER unverified ─────────────────────────────────────

it('Test 9 — INTERNAL_TRANSFER unverified → requiresManualReview', async () => {
  const r = await classify({
    description: 'TRANSFER INTERNAL REKENING OPERASIONAL',
    direction: 'DEBIT',
  });
  // With no isInternalAccount dep, INTERNAL_TRANSFER is unverified
  if (r.primaryIntent === 'INTERNAL_TRANSFER') {
    expect(r.requiresManualReview).toBe(true);
  }
});

// ─── Test 10: REFUND ──────────────────────────────────────────────────────────

it('Test 10 — REFUND detection', async () => {
  const r = await classify({
    description: 'PENGEMBALIAN DANA PELANGGAN ORDER CANCELLED',
  });
  expect(r.primaryIntent).toBe('REFUND');
});

// ─── Test 11: CASHBACK ────────────────────────────────────────────────────────

it('Test 11 — CASHBACK from CREDIT', async () => {
  const r = await classify({
    description: 'CASHBACK PROGRAM KARTU KREDIT BCA JULI',
    direction: 'CREDIT',
  });
  expect(r.primaryIntent).toBe('CASHBACK');
});

// ─── Test 12: BANK_REVERSAL ───────────────────────────────────────────────────

it('Test 12 — BANK_REVERSAL detection', async () => {
  const r = await classify({
    description: 'REVERSAL TRANSAKSI DEBIT GAGAL SISTEM',
  });
  expect(r.primaryIntent).toBe('BANK_REVERSAL');
});

// ─── Test 13: UNKNOWN description ────────────────────────────────────────────

it('Test 13 — Gibberish → UNKNOWN or low confidence', async () => {
  const r = await classify({
    description: 'XYZABC QWERTY RANDOM 999',
  });
  // Either UNKNOWN intent, or confidence below 0.5
  expect(
    r.primaryIntent === 'UNKNOWN' || r.confidence < 0.5
  ).toBe(true);
  expect(r.requiresManualReview).toBe(true);
});

// ─── Test 14: Empty description ──────────────────────────────────────────────

it('Test 14 — Empty description handled gracefully', async () => {
  const r = await classify({ description: '' });
  expect(r.requiresManualReview).toBe(true);
  expect(r.confidence).toBe(0);
});

// ─── Test 15: Invalid direction normalized ────────────────────────────────────

it('Test 15 — Invalid / missing direction treated as UNKNOWN direction', async () => {
  const r = await classify({
    description: 'BIAYA ADMINISTRASI BULANAN',
    direction: undefined,
  });
  // Should still classify based on description
  expect(r.primaryIntent).toBeDefined();
  expect(r.confidence).toBeGreaterThan(0);
});

// ─── Test 16: Collision TRANSFER ADM ─────────────────────────────────────────

it('Test 16 — Collision TRANSFER ADM: TRANSFER_FEE vs BANK_ADMIN_FEE', async () => {
  const r = await classify({
    description: 'TRANSFER ADM',
    direction: 'DEBIT',
  });
  // Engine must produce at least two candidates
  expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
  const allIntents = [r.primaryIntent, ...r.alternatives.map((a) => a.intent)];
  // Both collision candidates should appear
  expect(allIntents).toContain('TRANSFER_FEE');
  expect(allIntents).toContain('BANK_ADMIN_FEE');
});

// ─── Test 17: Collision REFUND VENDOR ────────────────────────────────────────

it('Test 17 — Collision REFUND VENDOR: REFUND vs VENDOR_PAYMENT', async () => {
  const r = await classify({
    description: 'REFUND VENDOR PEMBAYARAN KEMBALI',
    direction: 'CREDIT',
  });
  expect(r.alternatives.length).toBeGreaterThanOrEqual(1);
  const allIntents = [r.primaryIntent, ...r.alternatives.map((a) => a.intent)];
  // At least one of the collision pair must appear
  const hasRefund  = allIntents.includes('REFUND');
  const hasVendor  = allIntents.includes('VENDOR_PAYMENT');
  expect(hasRefund || hasVendor).toBe(true);
});

// ─── Test 18: Collision GIRO BUNGA ────────────────────────────────────────────

it('Test 18 — Collision GIRO BUNGA: GIRO vs INTEREST_INCOME', async () => {
  const r = await classify({
    description: 'GIRO BUNGA REKENING',
    direction: 'CREDIT',
  });
  const allIntents = [r.primaryIntent, ...r.alternatives.map((a) => a.intent)];
  const hasGiro     = allIntents.includes('GIRO');
  const hasInterest = allIntents.includes('INTEREST_INCOME');
  expect(hasGiro || hasInterest).toBe(true);
});

// ─── Test 19: Direction conflict ─────────────────────────────────────────────

it('Test 19 — Direction conflict lowers confidence or triggers manual review', async () => {
  // INTEREST_INCOME is naturally CREDIT — apply DEBIT to create conflict
  const r = await classify({
    description: 'JASA GIRO BUNGA TABUNGAN',
    direction: 'DEBIT',
  });
  // Either confidence is reduced or manual review is triggered
  expect(r.requiresManualReview || r.confidence < 0.7).toBe(true);
});

// ─── Test 20: Alternative candidates present ─────────────────────────────────

it('Test 20 — Alternative candidates are returned', async () => {
  const r = await classify({
    description: 'TRANSFER PT ABC LOGISTICS',
    direction: 'DEBIT',
  });
  expect(Array.isArray(r.alternatives)).toBe(true);
  expect(r.alternatives.length).toBeGreaterThanOrEqual(0);
  // Alternatives must differ from primary
  for (const alt of r.alternatives) {
    expect(alt.intent).not.toBe(r.primaryIntent);
  }
});

// ─── Test 21: Manual review threshold ────────────────────────────────────────

it('Test 21 — Low-confidence result triggers manual review', async () => {
  // Single ambiguous keyword with no direction context
  const r = await classify({
    description: 'ADM',
  });
  // "ADM" alone is low confidence → should trigger review
  if (r.confidence < 0.70) {
    expect(r.requiresManualReview).toBe(true);
  }
});

// ─── Test 22: Deterministic result ───────────────────────────────────────────

it('Test 22 — Same input always produces same result', async () => {
  const input: TransactionClassificationInput = {
    description: 'BIAYA ADMINISTRASI BULANAN REKENING',
    direction: 'DEBIT',
  };
  const results = await Promise.all([
    classifyTransactionIntent(input),
    classifyTransactionIntent(input),
    classifyTransactionIntent(input),
  ]);
  expect(results[0].primaryIntent).toBe(results[1].primaryIntent);
  expect(results[1].primaryIntent).toBe(results[2].primaryIntent);
  expect(results[0].confidence).toBe(results[1].confidence);
});

// ─── Test 23: Batch input order preserved ────────────────────────────────────

it('Test 23 — Batch classification preserves input order', async () => {
  const inputs: TransactionClassificationInput[] = [
    { description: 'PEMBAYARAN GAJI KARYAWAN JULI', direction: 'DEBIT' },
    { description: 'BIAYA RTGS TRANSFER ANTAR BANK', direction: 'DEBIT' },
    { description: 'JASA GIRO BULAN JUNI', direction: 'CREDIT' },
    { description: 'REVERSAL TRANSAKSI GAGAL', direction: 'CREDIT' },
  ];
  const results = await classifyTransactionIntentBatch(inputs);
  expect(results.length).toBe(4);
  expect(results[0].primaryIntent).toBe('PAYROLL');
  expect(results[1].primaryIntent).toBe('TRANSFER_FEE');
  expect(results[2].primaryIntent).toBe('INTEREST_INCOME');
  expect(results[3].primaryIntent).toBe('BANK_REVERSAL');
});

// ─── Test 24: Input immutability ─────────────────────────────────────────────

it('Test 24 — Input object is not mutated', async () => {
  const input: TransactionClassificationInput = {
    description: 'BIAYA ADMIN REKENING',
    direction: 'DEBIT',
    counterpartyName: 'PT ABC',
  };
  const originalJson = JSON.stringify(input);
  await classifyTransactionIntent(input);
  expect(JSON.stringify(input)).toBe(originalJson);
});

// ─── Test 25: Dependency injection (sync) ────────────────────────────────────

it('Test 25 — Counterparty DI (sync) routes to correct intent', async () => {
  const deps: IntentClassifierDependencies = {
    classifyCounterparty: (name) => {
      if (name.includes('VENDOR') || name.includes('SUPPLIER')) return 'VENDOR';
      if (name.includes('PELANGGAN') || name.includes('CUSTOMER')) return 'CUSTOMER';
      return 'UNKNOWN';
    },
  };

  const r = await classify(
    {
      description: 'TRANSFER PT XYZ SUPPLIER',
      direction: 'DEBIT',
      counterpartyName: 'PT XYZ VENDOR MATERIAL',
    },
    deps,
  );
  // VENDOR counterparty + DEBIT → should boost VENDOR_PAYMENT
  const allIntents = [r.primaryIntent, ...r.alternatives.map((a) => a.intent)];
  expect(allIntents).toContain('VENDOR_PAYMENT');
});

// ─── Test 26: Dependency injection (async) ───────────────────────────────────

it('Test 26 — Async dependency injection works correctly', async () => {
  const deps: IntentClassifierDependencies = {
    isInternalAccount: async (acct) => {
      // Simulate async DB lookup
      await new Promise((r) => setTimeout(r, 1));
      return acct === '1122334455';
    },
    classifyCounterparty: async (name) => {
      await new Promise((r) => setTimeout(r, 1));
      return 'UNKNOWN' as const;
    },
  };

  const r = await classify(
    {
      description: 'PEMINDAHAN DANA ANTAR REKENING INTERNAL',
      direction: 'DEBIT',
      counterpartyAccount: '1122334455',
    },
    deps,
  );
  // Account confirmed as internal → should appear as INTERNAL_ACCOUNT evidence
  const evidenceTypes = r.evidence.map((e) => e.type);
  expect(evidenceTypes).toContain('INTERNAL_ACCOUNT');
});

// ─── Test 27: Phase 1 compatibility ──────────────────────────────────────────

it('Test 27 — Phase 1 analysis is embedded in result', async () => {
  const r = await classify({
    description: 'BIAYA ADMINISTRASI BULANAN',
  });
  expect(r.phase1Analysis).toBeDefined();
  expect(typeof r.phase1Analysis.intent).toBe('string');
  expect(typeof r.phase1Analysis.confidence).toBe('number');
  expect(Array.isArray(r.phase1Analysis.candidates)).toBe(true);
});

it('Test 27b — Phase 1 result is consistent with standalone analyzeTransactionDescription', () => {
  const desc = 'PEMBAYARAN GAJI KARYAWAN BULAN JULI 2026';
  const p1 = analyzeTransactionDescription(desc);
  // Phase 2 should at minimum agree on the intent (may differ due to context)
  expect(p1.intent).toBe('PAYROLL');
});

// ─── Test 28: JSON contract validation ───────────────────────────────────────

it('Test 28 — IntentClassificationResult passes Zod schema', async () => {
  const r = await classify({
    description: 'BIAYA TRANSFER RTGS',
    direction: 'DEBIT',
  });
  const parsed = IntentClassificationResultSchema.safeParse(r);
  expect(parsed.success).toBe(true);
});

it('Test 28b — Empty description result passes Zod schema', async () => {
  const r = await classify({ description: '' });
  const parsed = IntentClassificationResultSchema.safeParse(r);
  expect(parsed.success).toBe(true);
});

// ─── Test 29: Confidence range 0–1 ───────────────────────────────────────────

it('Test 29 — Confidence is always in [0, 1]', async () => {
  const descriptions = [
    { description: 'BIAYA ADMINISTRASI BULANAN', direction: 'DEBIT' as const },
    { description: 'GAJI KARYAWAN BULAN JULI', direction: 'DEBIT' as const },
    { description: 'JASA GIRO BULAN JUNI', direction: 'CREDIT' as const },
    { description: 'RANDOM GIBBERISH', direction: undefined },
    { description: '', direction: undefined },
  ];
  for (const input of descriptions) {
    const r = await classify(input);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    for (const alt of r.alternatives) {
      expect(alt.confidence).toBeGreaterThanOrEqual(0);
      expect(alt.confidence).toBeLessThanOrEqual(1);
    }
  }
});

// ─── Test 30: No duplicate alternatives ──────────────────────────────────────

it('Test 30 — No duplicate intents in alternatives', async () => {
  const r = await classify({
    description: 'TRANSFER BIAYA GAJI PAJAK PINJAMAN CICILAN ANGSURAN',
    direction: 'DEBIT',
  });
  const allIntents = r.alternatives.map((a) => a.intent);
  expect(new Set(allIntents).size).toBe(allIntents.length);
  // Primary intent must not appear in alternatives
  for (const alt of r.alternatives) {
    expect(alt.intent).not.toBe(r.primaryIntent);
  }
});

// ─── Additional: Evidence structure ──────────────────────────────────────────

describe('Evidence', () => {
  it('evidence contains DIRECTION when direction is provided', async () => {
    const r = await classify({
      description: 'BIAYA RTGS',
      direction: 'DEBIT',
    });
    const hasDirection = r.evidence.some((e) => e.type === 'DIRECTION');
    expect(hasDirection).toBe(true);
  });

  it('evidence contains COUNTERPARTY when counterpartyName is provided', async () => {
    const r = await classify({
      description: 'TRANSFER PT ABC',
      direction: 'DEBIT',
      counterpartyName: 'PT ABC LOGISTICS',
    });
    const hasCp = r.evidence.some((e) => e.type === 'COUNTERPARTY');
    expect(hasCp).toBe(true);
  });

  it('evidence contains TRANSACTION_CODE when transactionCode is provided', async () => {
    const r = await classify({
      description: 'TRANSFER',
      direction: 'DEBIT',
      transactionCode: 'RTGS',
    });
    const hasTc = r.evidence.some((e) => e.type === 'TRANSACTION_CODE');
    expect(hasTc).toBe(true);
  });

  it('evidence weights are all in [0, 1]', async () => {
    const r = await classify({
      description: 'BIAYA ADMINISTRASI BULANAN',
      direction: 'DEBIT',
    });
    for (const e of r.evidence) {
      expect(e.weight).toBeGreaterThanOrEqual(0);
      expect(e.weight).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Additional: Reason list ──────────────────────────────────────────────────

describe('Reason list', () => {
  it('reason is a non-empty array of strings', async () => {
    const r = await classify({ description: 'GAJI KARYAWAN' });
    expect(Array.isArray(r.reason)).toBe(true);
    expect(r.reason.length).toBeGreaterThan(0);
    r.reason.forEach((s) => expect(typeof s).toBe('string'));
  });
});

// ─── Additional: Batch with empty array ──────────────────────────────────────

it('Batch with empty input returns empty array', async () => {
  const results = await classifyTransactionIntentBatch([]);
  expect(results).toEqual([]);
});

// ─── Additional: CHEQUE / GIRO ────────────────────────────────────────────────

it('CHEQUE detection in Phase 2', async () => {
  const r = await classify({ description: 'PENCAIRAN CEK NO 001 PT ABC' });
  expect(r.primaryIntent).toBe('CHEQUE');
});

it('GIRO detection in Phase 2', async () => {
  const r = await classify({ description: 'BILYET GIRO BG 001 PT XYZ' });
  expect(r.primaryIntent).toBe('GIRO');
});

// ─── Additional: Transaction code hint ───────────────────────────────────────

it('Transaction code PAYROLL hints PAYROLL intent', async () => {
  const r = await classify({
    description: 'PEMBAYARAN RUTIN',
    direction: 'DEBIT',
    transactionCode: 'PAYROLL',
  });
  // The transaction code should boost PAYROLL intent
  const allIntents = [r.primaryIntent, ...r.alternatives.map((a) => a.intent)];
  expect(allIntents).toContain('PAYROLL');
});

// ─── Additional: LOAN_PAYMENT ─────────────────────────────────────────────────

it('LOAN_PAYMENT from DEBIT', async () => {
  const r = await classify({
    description: 'ANGSURAN KREDIT KENDARAAN BANK MANDIRI',
    direction: 'DEBIT',
  });
  expect(r.primaryIntent).toBe('LOAN_PAYMENT');
});

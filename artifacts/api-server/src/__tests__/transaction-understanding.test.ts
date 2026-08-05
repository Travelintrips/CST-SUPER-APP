/**
 * AI Transaction Intelligence — Phase 1 Regression Tests
 * Transaction Understanding Engine
 *
 * All tests are pure: no DB, no HTTP, no network. Run fully offline.
 * Run: pnpm --filter @workspace/api-server test
 */

import { describe, it, expect } from 'vitest';
import {
  analyzeTransactionDescription,
  analyzeTransactionDescriptions,
  normalizeText,
} from '../lib/ai/transaction-intelligence/transactionUnderstanding.js';
import type { TransactionAnalysisResult } from '../lib/ai/transaction-intelligence/transactionTypes.js';
import { ALL_INTENTS } from '../lib/ai/transaction-intelligence/transactionTypes.js';
import {
  TRANSACTION_DICTIONARY,
  CLASSIFIABLE_INTENTS,
} from '../lib/ai/transaction-intelligence/transactionDictionary.js';
import {
  normalizeScore,
  CONFIDENCE_THRESHOLDS,
} from '../lib/ai/transaction-intelligence/transactionConfidence.js';
import { TransactionAnalysisResultSchema } from '../lib/ai/transaction-intelligence/transactionSchema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function intent(desc: string) {
  return analyzeTransactionDescription(desc).intent;
}

function conf(desc: string) {
  return analyzeTransactionDescription(desc).confidence;
}

// ─── 1. Text normalization ─────────────────────────────────────────────────────

describe('normalizeText', () => {
  it('lowercases', () => {
    expect(normalizeText('BIAYA ADMIN')).toBe('biaya admin');
  });
  it('replaces punctuation with space', () => {
    expect(normalizeText('BIAYA-ADMIN/2026')).toBe('biaya admin 2026');
  });
  it('collapses multiple spaces', () => {
    expect(normalizeText('GAJI   KARYAWAN')).toBe('gaji karyawan');
  });
  it('trims leading/trailing whitespace', () => {
    expect(normalizeText('  gaji karyawan  ')).toBe('gaji karyawan');
  });
  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });
  it('handles special chars', () => {
    expect(normalizeText('BAYAR PLN #450000')).toBe('bayar pln 450000');
  });
});

// ─── 2. Individual intent detection ────────────────────────────────────────────

describe('BANK_ADMIN_FEE detection', () => {
  it('detects "BIAYA ADMINISTRASI BULANAN"', () => {
    expect(intent('BIAYA ADMINISTRASI BULANAN')).toBe('BANK_ADMIN_FEE');
  });
  it('detects "biaya admin rekening"', () => {
    expect(intent('biaya admin rekening bulan juni')).toBe('BANK_ADMIN_FEE');
  });
  it('detects "MONTHLY MAINTENANCE FEE"', () => {
    expect(intent('MONTHLY MAINTENANCE FEE JULY 2026')).toBe('BANK_ADMIN_FEE');
  });
  it('detects "ADM BLN"', () => {
    expect(intent('ADM BLN JULI')).toBe('BANK_ADMIN_FEE');
  });
});

describe('TRANSFER_FEE detection', () => {
  it('detects "BIAYA RTGS"', () => {
    expect(intent('BIAYA RTGS PENGIRIMAN 50JT')).toBe('TRANSFER_FEE');
  });
  it('detects "RTGS FEE"', () => {
    expect(intent('RTGS FEE')).toBe('TRANSFER_FEE');
  });
  it('detects "BIAYA BI-FAST" (hyphen variant)', () => {
    expect(intent('BIAYA BI-FAST TRANSFER')).toBe('TRANSFER_FEE');
  });
  it('detects "BIAYA BI FAST" (space variant)', () => {
    expect(intent('BIAYA BI FAST')).toBe('TRANSFER_FEE');
  });
  it('detects "BIFAST FEE" (no-space abbreviation)', () => {
    expect(intent('BIFAST FEE')).toBe('TRANSFER_FEE');
  });
  it('detects "TRF BI-FAST"', () => {
    expect(intent('TRF BI-FAST')).toBe('TRANSFER_FEE');
  });
  it('detects "SKN FEE"', () => {
    expect(intent('SKN FEE')).toBe('TRANSFER_FEE');
  });
  it('detects "SWIFT FEE"', () => {
    expect(intent('SWIFT FEE')).toBe('TRANSFER_FEE');
  });
  it('detects "BIAYA TRANSFER ANTAR BANK"', () => {
    expect(intent('BIAYA TRANSFER ANTAR BANK')).toBe('TRANSFER_FEE');
  });
  it('detects "TRANSFER FEE" (English)', () => {
    expect(intent('TRANSFER FEE SWIFT INTERNATIONAL')).toBe('TRANSFER_FEE');
  });
});

describe('INTEREST_INCOME detection', () => {
  it('detects "JASA GIRO"', () => {
    expect(intent('JASA GIRO BULAN JUNI')).toBe('INTEREST_INCOME');
  });
  it('detects "BUNGA TABUNGAN"', () => {
    expect(intent('BUNGA TABUNGAN JULI 2026')).toBe('INTEREST_INCOME');
  });
  it('detects "PENDAPATAN BUNGA"', () => {
    expect(intent('PENDAPATAN BUNGA DEPOSITO Q2 2026')).toBe('INTEREST_INCOME');
  });
});

describe('PAYROLL detection', () => {
  it('detects "GAJI KARYAWAN JULI"', () => {
    expect(intent('GAJI KARYAWAN JULI 2026')).toBe('PAYROLL');
  });
  it('detects "PAYROLL KARYAWAN"', () => {
    expect(intent('PAYROLL KARYAWAN BULAN 7')).toBe('PAYROLL');
  });
  it('detects "THR KARYAWAN"', () => {
    expect(intent('THR KARYAWAN LEBARAN 2026')).toBe('PAYROLL');
  });
  it('detects "SALARY PAYMENT"', () => {
    expect(intent('SALARY PAYMENT JULY 2026')).toBe('PAYROLL');
  });
});

describe('LOAN_PAYMENT detection', () => {
  it('detects "ANGSURAN KREDIT"', () => {
    expect(intent('ANGSURAN KREDIT KENDARAAN BCA')).toBe('LOAN_PAYMENT');
  });
  it('detects "CICILAN KPR"', () => {
    expect(intent('CICILAN KPR BANK MANDIRI BLN 7')).toBe('LOAN_PAYMENT');
  });
  it('detects "LOAN REPAYMENT"', () => {
    expect(intent('LOAN REPAYMENT PERIOD 7')).toBe('LOAN_PAYMENT');
  });
});

describe('TAX_PAYMENT detection', () => {
  it('detects "SETORAN PAJAK PPH 21"', () => {
    expect(intent('SETORAN PAJAK PPH 21 JULI')).toBe('TAX_PAYMENT');
  });
  it('detects "PEMBAYARAN PPN"', () => {
    expect(intent('PEMBAYARAN PPN MASA JUNI')).toBe('TAX_PAYMENT');
  });
  it('detects "SURAT SETORAN PAJAK"', () => {
    expect(intent('SURAT SETORAN PAJAK SSP')).toBe('TAX_PAYMENT');
  });
});

describe('INTERNAL_TRANSFER detection', () => {
  it('detects "TRANSFER INTERNAL"', () => {
    expect(intent('TRANSFER INTERNAL REKENING OPERASIONAL')).toBe('INTERNAL_TRANSFER');
  });
  it('detects "KAS BESAR"', () => {
    expect(intent('TRANSFER KAS BESAR BULAN JULI')).toBe('INTERNAL_TRANSFER');
  });
  it('detects "PETTY CASH"', () => {
    expect(intent('PETTY CASH PENGISIAN KAS KECIL')).toBe('INTERNAL_TRANSFER');
  });
  // "INTERCOMPANY_TRANSFER" as an input description normalizes to INTERNAL_TRANSFER
  // per domain contract — there is no separate INTERCOMPANY_TRANSFER intent enum.
  it('detects "INTERCOMPANY TRANSFER" → INTERNAL_TRANSFER', () => {
    expect(intent('INTERCOMPANY TRANSFER PT ABC KE PT XYZ')).toBe('INTERNAL_TRANSFER');
  });
  it('detects "TRANSFER INTERCOMPANY" → INTERNAL_TRANSFER', () => {
    expect(intent('TRANSFER INTERCOMPANY REKENING TREASURY')).toBe('INTERNAL_TRANSFER');
  });
});

describe('REFUND detection', () => {
  it('detects "REFUND DANA"', () => {
    expect(intent('REFUND DANA PELANGGAN')).toBe('REFUND');
  });
  it('detects "PENGEMBALIAN DANA"', () => {
    expect(intent('PENGEMBALIAN DANA PELANGGAN ORDER')).toBe('REFUND');
  });
  it('detects "PENGEMBALIAN PEMBAYARAN"', () => {
    expect(intent('PENGEMBALIAN PEMBAYARAN INVOICE 001')).toBe('REFUND');
  });
});

describe('CASHBACK detection', () => {
  it('detects "CASHBACK PROGRAM"', () => {
    expect(intent('CASHBACK PROGRAM KARTU KREDIT BCA')).toBe('CASHBACK');
  });
  it('detects "REWARD CASHBACK"', () => {
    expect(intent('REWARD CASHBACK TRANSAKSI JULI')).toBe('CASHBACK');
  });
});

describe('BANK_CHARGE detection', () => {
  it('detects "DENDA KETERLAMBATAN"', () => {
    expect(intent('DENDA KETERLAMBATAN PEMBAYARAN')).toBe('BANK_CHARGE');
  });
  it('detects "SERVICE CHARGE BANK"', () => {
    expect(intent('SERVICE CHARGE BANK ACCOUNT MANAGEMENT')).toBe('BANK_CHARGE');
  });
});

describe('BANK_REVERSAL detection', () => {
  it('detects "REVERSAL TRANSAKSI"', () => {
    expect(intent('REVERSAL TRANSAKSI TRANSFER GAGAL')).toBe('BANK_REVERSAL');
  });
  it('detects "STORNO TRANSAKSI"', () => {
    expect(intent('STORNO TRANSAKSI JURNAL 2026')).toBe('BANK_REVERSAL');
  });
  it('detects "PEMBALIKAN TRANSAKSI"', () => {
    expect(intent('PEMBALIKAN TRANSAKSI DEBIT KEMARIN')).toBe('BANK_REVERSAL');
  });
});

describe('CHEQUE detection', () => {
  it('detects "PENCAIRAN CEK"', () => {
    expect(intent('PENCAIRAN CEK NO 001 PT ABC')).toBe('CHEQUE');
  });
  it('detects "WARKAT CEK"', () => {
    expect(intent('WARKAT CEK KLIRING BANK MANDIRI')).toBe('CHEQUE');
  });
});

describe('GIRO detection', () => {
  it('detects "BILYET GIRO"', () => {
    expect(intent('BILYET GIRO BG001 PT XYZ')).toBe('GIRO');
  });
  it('detects "PENCAIRAN BILYET GIRO"', () => {
    expect(intent('PENCAIRAN BILYET GIRO KLIRING')).toBe('GIRO');
  });
});

// ─── 3. UNKNOWN handling ────────────────────────────────────────────────────────

describe('UNKNOWN handling', () => {
  it('empty string → UNKNOWN, confidence 0, manual review', () => {
    const r = analyzeTransactionDescription('');
    expect(r.intent).toBe('UNKNOWN');
    expect(r.confidence).toBe(0);
    expect(r.requiresManualReview).toBe(true);
  });

  it('whitespace only → UNKNOWN', () => {
    const r = analyzeTransactionDescription('   ');
    expect(r.intent).toBe('UNKNOWN');
    expect(r.requiresManualReview).toBe(true);
  });

  it('random gibberish → UNKNOWN', () => {
    const r = analyzeTransactionDescription('XYZQWERTY12345 RANDOM TEXT NO MEANING');
    expect(r.intent).toBe('UNKNOWN');
  });
});

// ─── 4. Confidence model ────────────────────────────────────────────────────────

describe('Confidence model', () => {
  it('confidence is always between 0 and 1', () => {
    const descriptions = [
      'BIAYA ADMINISTRASI BULANAN',
      'GAJI KARYAWAN',
      'RANDOM TEXT',
      '',
      'BIAYA RTGS SWIFT INTERNATIONAL TRANSFER FEE',
    ];
    for (const d of descriptions) {
      const c = conf(d);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(1);
    }
  });

  it('strong match has higher confidence than weak match', () => {
    const strong = conf('BIAYA ADMINISTRASI BULANAN REKENING');
    const weak = conf('ADMIN');
    expect(strong).toBeGreaterThan(weak);
  });

  it('normalizeScore clamps to [0, 1]', () => {
    expect(normalizeScore(0)).toBe(0);
    expect(normalizeScore(100)).toBe(1);
    expect(normalizeScore(-5)).toBe(0);
    expect(normalizeScore(0.8)).toBeGreaterThan(0);
    expect(normalizeScore(0.8)).toBeLessThanOrEqual(1);
  });
});

// ─── 5. requiresManualReview ────────────────────────────────────────────────────

describe('requiresManualReview', () => {
  it('empty description → requiresManualReview = true', () => {
    expect(analyzeTransactionDescription('').requiresManualReview).toBe(true);
  });

  it('strong clear match → requiresManualReview = false', () => {
    const r = analyzeTransactionDescription('PEMBAYARAN GAJI KARYAWAN BULAN JULI 2026');
    // PAYROLL has many high-weight keywords here
    expect(r.requiresManualReview).toBe(false);
  });
});

describe('tax classification hardening', () => {
  it('classifies tax subtype and always requires manual review', () => {
    const result = analyzeTransactionDescription('Pembayaran PPh 23 masa Juli');
    expect(result.intent).toBe('INCOME_TAX');
    expect(result.taxSubtype).toBe('PPh23');
    expect(result.requiresManualReview).toBe(true);
  });

  it('does not classify tax token inside an unrelated word', () => {
    const result = analyzeTransactionDescription('Taxonomy platform subscription');
    expect(result.intent).not.toBe('TAX_PAYMENT');
    expect(result.intent).not.toBe('INCOME_TAX');
  });

  it('uses explicit uncertainty for an unspecified tax description', () => {
    const result = analyzeTransactionDescription('Pembayaran pajak');
    expect(result.taxSubtype).toBe('UNKNOWN_TAX');
    expect(result.requiresManualReview).toBe(true);
  });
});

// ─── 6. Determinism ────────────────────────────────────────────────────────────

describe('Determinism', () => {
  it('same input → same output (called 5×)', () => {
    const desc = 'BIAYA RTGS TRANSFER ANTAR BANK MANDIRI';
    const results = Array.from({ length: 5 }, () =>
      analyzeTransactionDescription(desc),
    );
    for (let i = 1; i < results.length; i++) {
      expect(results[i].intent).toBe(results[0].intent);
      expect(results[i].confidence).toBe(results[0].confidence);
    }
  });
});

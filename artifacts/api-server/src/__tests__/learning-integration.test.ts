/**
 * Phase 5 — Learning & Feedback Engine
 * Integration tests: Learning Engine → Phase 6 input contract
 */

import { describe, it, expect } from 'vitest';
import { runLearningEngine } from '../lib/ai/transaction-intelligence/learningEngine.js';
import type { FeedbackRecord } from '../lib/ai/transaction-intelligence/learningEngineTypes.js';
import { FeedbackRecordSchema, LearningSignalSchema } from '../lib/ai/transaction-intelligence/learningEngineSchema.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fb(overrides: Partial<FeedbackRecord>, id = '1'): FeedbackRecord {
  return {
    id,
    companyId: 'company-1',
    rawDescription: 'BIAYA ADMIN BCA',
    normalizedDescription: 'biaya admin bca',
    predictedIntent: 'BANK_ADMIN_FEE',
    wasAccepted: true,
    recordedAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function batch(count: number, overrides: Partial<FeedbackRecord> = {}): FeedbackRecord[] {
  return Array.from({ length: count }, (_, i) => fb({ ...overrides, id: `fb-${i}` }));
}

// ─── Schema validation ─────────────────────────────────────────────────────────

describe('FeedbackRecord schema', () => {
  it('validates a complete feedback record', () => {
    const record = fb({}, 'test-1');
    const result = FeedbackRecordSchema.safeParse(record);
    expect(result.success).toBe(true);
  });

  it('requires wasAccepted boolean', () => {
    const record = { ...fb({}, 'test-2'), wasAccepted: 'yes' };
    const result = FeedbackRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it('requires valid TransactionIntent for predictedIntent', () => {
    const record = { ...fb({}, 'test-3'), predictedIntent: 'INVALID_INTENT' };
    const result = FeedbackRecordSchema.safeParse(record);
    expect(result.success).toBe(false);
  });

  it('allows optional fields to be absent', () => {
    const minimal = {
      id: 'min-1',
      companyId: 'c1',
      rawDescription: 'test',
      normalizedDescription: 'test',
      predictedIntent: 'UNKNOWN',
      wasAccepted: true,
      recordedAt: '2026-01-01T00:00:00Z',
    };
    const result = FeedbackRecordSchema.safeParse(minimal);
    expect(result.success).toBe(true);
  });
});

describe('LearningSignal schema', () => {
  it('validates a signal from learning engine output', () => {
    const feedback = batch(5, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (const signal of out.signals) {
      const result = LearningSignalSchema.safeParse(signal);
      expect(result.success).toBe(true);
    }
  });
});

// ─── Multi-company isolation ───────────────────────────────────────────────────

describe('Learning Engine — company isolation', () => {
  it('isolates signals per company', () => {
    const mixed = [
      ...batch(5, { companyId: 'c1', normalizedDescription: 'biaya admin c1', wasAccepted: true }),
      ...batch(5, { companyId: 'c2', normalizedDescription: 'biaya admin c2', wasAccepted: true }),
    ];
    const outC1 = runLearningEngine({ companyId: 'c1', feedbackRecords: mixed });
    const outC2 = runLearningEngine({ companyId: 'c2', feedbackRecords: mixed });
    expect(outC1.feedbackProcessed).toBe(5);
    expect(outC2.feedbackProcessed).toBe(5);
  });

  it('signals for c1 do not contain c2 descriptions', () => {
    const mixed = [
      ...batch(5, { companyId: 'c1', normalizedDescription: 'unique c1 pattern', wasAccepted: true }),
      ...batch(5, { companyId: 'c2', normalizedDescription: 'unique c2 pattern', wasAccepted: true }),
    ];
    const outC1 = runLearningEngine({ companyId: 'c1', feedbackRecords: mixed });
    const c2Patterns = outC1.signals.filter((s) =>
      s.normalizedDescription.includes('c2'),
    );
    expect(c2Patterns).toHaveLength(0);
  });
});

// ─── Phase 6 input contract ────────────────────────────────────────────────────

describe('Learning Engine output as Phase 6 input', () => {
  it('output has companyId matching input', () => {
    const out = runLearningEngine({ companyId: 'test-company', feedbackRecords: [] });
    expect(String(out.companyId)).toBe('test-company');
  });

  it('output.signals is an array', () => {
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: [] });
    expect(Array.isArray(out.signals)).toBe(true);
  });

  it('output.statistics has all required fields', () => {
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: [] });
    expect(out.statistics).toHaveProperty('companyId');
    expect(out.statistics).toHaveProperty('totalFeedback');
    expect(out.statistics).toHaveProperty('overallAcceptanceRate');
    expect(out.statistics).toHaveProperty('acceptanceRateByIntent');
    expect(out.statistics).toHaveProperty('topCorrectionPairs');
    expect(out.statistics).toHaveProperty('topCoaCorrections');
    expect(out.statistics).toHaveProperty('problematicPatterns');
  });

  it('all signals have required fields for Phase 6', () => {
    const feedback = batch(5, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (const signal of out.signals) {
      expect(signal).toHaveProperty('signalType');
      expect(signal).toHaveProperty('normalizedDescription');
      expect(signal).toHaveProperty('occurrenceCount');
      expect(signal).toHaveProperty('consistencyRate');
      expect(signal).toHaveProperty('signalConfidence');
    }
  });
});

// ─── Benchmark: 100 / 1000 / 10000 feedback records ──────────────────────────

describe('Learning Engine — benchmark', () => {
  it('handles 100 feedback records', () => {
    const feedback = batch(100, { wasAccepted: true });
    const start = Date.now();
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    const elapsed = Date.now() - start;
    expect(out.learningVersion).toBe('5.0');
    expect(elapsed).toBeLessThan(500);
  });

  it('handles 1000 feedback records', () => {
    const feedback = batch(1000, { wasAccepted: true });
    const start = Date.now();
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    const elapsed = Date.now() - start;
    expect(out.learningVersion).toBe('5.0');
    expect(elapsed).toBeLessThan(2000);
  });

  it('handles 10000 feedback records', () => {
    const variants = ['biaya admin', 'transfer antar', 'gaji karyawan', 'pajak ppn', 'cicilan pinjaman'];
    const feedback: FeedbackRecord[] = [];
    for (let i = 0; i < 10000; i++) {
      const desc = variants[i % variants.length]!;
      feedback.push(fb({
        id: `fb-${i}`,
        normalizedDescription: desc,
        predictedIntent: 'BANK_ADMIN_FEE',
        wasAccepted: i % 5 !== 0,
      }));
    }
    const start = Date.now();
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    const elapsed = Date.now() - start;
    expect(out.learningVersion).toBe('5.0');
    expect(elapsed).toBeLessThan(5000);
    expect(out.feedbackProcessed).toBe(10000);
  });
});

// ─── Edge cases ────────────────────────────────────────────────────────────────

describe('Learning Engine — edge cases', () => {
  it('handles feedback where correctedIntent === predictedIntent', () => {
    const feedback = batch(5, {
      predictedIntent: 'BANK_ADMIN_FEE',
      correctedIntent: 'BANK_ADMIN_FEE',
      wasAccepted: false,
    });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.topCorrectionPairs).toHaveLength(0);
  });

  it('handles feedback with no counterpartyName', () => {
    const feedback = batch(5, { counterpartyName: undefined, wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.counterpartySignals).toHaveLength(0);
  });

  it('handles numeric companyId', () => {
    const feedback = batch(5, { companyId: 42 });
    const out = runLearningEngine({ companyId: 42, feedbackRecords: feedback });
    expect(out.feedbackProcessed).toBe(5);
  });

  it('does not throw on very short descriptions', () => {
    const feedback = batch(5, { normalizedDescription: 'ab', wasAccepted: true });
    expect(() => runLearningEngine({ companyId: 'c1', feedbackRecords: feedback })).not.toThrow();
  });

  it('handles all-rejected feedback', () => {
    const feedback = batch(5, { wasAccepted: false, correctedIntent: 'TRANSFER_FEE' });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.overallAcceptanceRate).toBe(0);
  });

  it('handles all-accepted feedback', () => {
    const feedback = batch(5, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.overallAcceptanceRate).toBe(1);
  });
});

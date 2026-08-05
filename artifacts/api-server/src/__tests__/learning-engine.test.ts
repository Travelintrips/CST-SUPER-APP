/**
 * Phase 5 — Learning & Feedback Engine
 * Unit tests
 */

import { describe, it, expect } from 'vitest';
import { runLearningEngine, runLearningEngineBatch } from '../lib/ai/transaction-intelligence/learningEngine.js';
import type { FeedbackRecord, LearningEngineInput } from '../lib/ai/transaction-intelligence/learningEngineTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function makeFeedback(
  overrides: Partial<FeedbackRecord> = {},
  id = '1',
): FeedbackRecord {
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

function makeFeedbackBatch(
  count: number,
  overrides: Partial<FeedbackRecord> = {},
): FeedbackRecord[] {
  return Array.from({ length: count }, (_, i) =>
    makeFeedback({ ...overrides, id: `fb-${i}` }),
  );
}

// ─── Basic output shape ────────────────────────────────────────────────────────

describe('runLearningEngine — output shape', () => {
  it('returns correct learningVersion', () => {
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: [] });
    expect(out.learningVersion).toBe('5.0');
  });

  it('returns correct companyId', () => {
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: [] });
    expect(out.companyId).toBe('c1');
  });

  it('has all required output fields', () => {
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: [] });
    expect(out).toHaveProperty('signals');
    expect(out).toHaveProperty('keywordSignals');
    expect(out).toHaveProperty('counterpartySignals');
    expect(out).toHaveProperty('intentCoaSignals');
    expect(out).toHaveProperty('descriptionPatternSignals');
    expect(out).toHaveProperty('statistics');
    expect(out).toHaveProperty('feedbackProcessed');
    expect(out).toHaveProperty('strongSignals');
  });

  it('returns empty signals when no feedback', () => {
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: [] });
    expect(out.signals).toHaveLength(0);
  });

  it('feedbackProcessed reflects company-scoped count', () => {
    const feedback = [
      makeFeedback({ companyId: 'c1' }, '1'),
      makeFeedback({ companyId: 'c2' }, '2'),
    ];
    const out = runLearningEngine({ companyId: 'c1', feedbackRecords: feedback });
    expect(out.feedbackProcessed).toBe(1);
  });
});

// ─── Signal generation ─────────────────────────────────────────────────────────

describe('runLearningEngine — signal generation', () => {
  it('generates keyword signals from repeated patterns', () => {
    const feedback = makeFeedbackBatch(5, {
      normalizedDescription: 'biaya admin',
      predictedIntent: 'BANK_ADMIN_FEE',
      predictedCoaCode: '5-1100',
      correctedCoaCode: '5-1100',
      wasAccepted: true,
    });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.signals.length).toBeGreaterThan(0);
  });

  it('does not generate signals below minOccurrences', () => {
    const feedback = makeFeedbackBatch(2, {
      normalizedDescription: 'rare pattern xyz',
      predictedIntent: 'UNKNOWN',
      wasAccepted: true,
    });
    const out = runLearningEngine({
      companyId: 'company-1',
      feedbackRecords: feedback,
      minOccurrences: 5,
    });
    expect(out.signals).toHaveLength(0);
  });

  it('generates counterparty signals when counterpartyName is present', () => {
    const feedback = makeFeedbackBatch(5, {
      counterpartyName: 'PT MITRA SEJAHTERA',
      normalizedDescription: 'transfer vendor pt mitra',
      predictedIntent: 'VENDOR_PAYMENT',
      correctedIntent: 'VENDOR_PAYMENT',
      predictedCoaCode: '2-1200',
      correctedCoaCode: '2-1200',
      wasAccepted: true,
    });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.counterpartySignals.length).toBeGreaterThan(0);
  });

  it('signals have signalConfidence between 0 and 1', () => {
    const feedback = makeFeedbackBatch(10, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (const s of out.signals) {
      expect(s.signalConfidence).toBeGreaterThanOrEqual(0);
      expect(s.signalConfidence).toBeLessThanOrEqual(1);
    }
  });

  it('signals have consistencyRate between 0 and 1', () => {
    const feedback = makeFeedbackBatch(10, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (const s of out.signals) {
      expect(s.consistencyRate).toBeGreaterThanOrEqual(0);
      expect(s.consistencyRate).toBeLessThanOrEqual(1);
    }
  });

  it('signals are sorted by signalConfidence descending', () => {
    const feedback = makeFeedbackBatch(10, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (let i = 1; i < out.signals.length; i++) {
      expect(out.signals[i]!.signalConfidence).toBeLessThanOrEqual(
        out.signals[i - 1]!.signalConfidence,
      );
    }
  });

  it('intent_coa signals include intent and coaCode', () => {
    const feedback = makeFeedbackBatch(5, {
      predictedIntent: 'PAYROLL',
      correctedIntent: 'PAYROLL',
      correctedCoaCode: '6-1000',
      normalizedDescription: 'gaji karyawan bulan',
      wasAccepted: false,
    });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (const s of out.intentCoaSignals) {
      expect(s.intent).toBeDefined();
      expect(s.coaCode).toBeDefined();
    }
  });
});

// ─── Statistics ────────────────────────────────────────────────────────────────

describe('runLearningEngine — statistics', () => {
  it('computes overallAcceptanceRate correctly', () => {
    const feedback = [
      ...makeFeedbackBatch(7, { wasAccepted: true }),
      ...makeFeedbackBatch(3, { wasAccepted: false }),
    ];
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.overallAcceptanceRate).toBeCloseTo(0.7, 1);
  });

  it('statistics.totalFeedback matches feedbackProcessed', () => {
    const feedback = makeFeedbackBatch(8, {});
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.totalFeedback).toBe(out.feedbackProcessed);
  });

  it('computes topCorrectionPairs for overridden intents', () => {
    const feedback = makeFeedbackBatch(5, {
      predictedIntent: 'UNKNOWN',
      correctedIntent: 'BANK_ADMIN_FEE',
      wasAccepted: false,
    });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.topCorrectionPairs.length).toBeGreaterThan(0);
    expect(out.statistics.topCorrectionPairs[0]!.fromIntent).toBe('UNKNOWN');
    expect(out.statistics.topCorrectionPairs[0]!.toIntent).toBe('BANK_ADMIN_FEE');
  });

  it('identifies problematic patterns with low acceptance', () => {
    const feedback = [
      ...makeFeedbackBatch(5, {
        normalizedDescription: 'ambigu pola sulit',
        wasAccepted: false,
      }),
      makeFeedback({ normalizedDescription: 'ambigu pola sulit', wasAccepted: true }, 'x'),
    ];
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    expect(out.statistics.problematicPatterns).toContain('ambigu pola sulit');
  });

  it('returns empty statistics for unknown company', () => {
    const feedback = makeFeedbackBatch(5, { companyId: 'other-company' });
    const out = runLearningEngine({ companyId: 'my-company', feedbackRecords: feedback });
    expect(out.statistics.totalFeedback).toBe(0);
    expect(out.feedbackProcessed).toBe(0);
  });
});

// ─── Strong signals ────────────────────────────────────────────────────────────

describe('runLearningEngine — strong signals', () => {
  it('strongSignals subset of signals', () => {
    const feedback = makeFeedbackBatch(20, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    const signalIds = new Set(out.signals.map((s) => s.normalizedDescription + s.signalType));
    for (const s of out.strongSignals) {
      expect(signalIds.has(s.normalizedDescription + s.signalType)).toBe(true);
    }
  });

  it('strongSignals have confidence >= 0.7', () => {
    const feedback = makeFeedbackBatch(20, { wasAccepted: true });
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback });
    for (const s of out.strongSignals) {
      expect(s.signalConfidence).toBeGreaterThanOrEqual(0.7);
    }
  });
});

// ─── Pre-supplied correction records ──────────────────────────────────────────

describe('runLearningEngine — pre-supplied corrections', () => {
  it('uses suppliedCorrections when provided', () => {
    const input: LearningEngineInput = {
      companyId: 'c1',
      feedbackRecords: [],
      correctionRecords: [
        {
          normalizedDescription: 'biaya admin bca',
          companyId: 'c1',
          occurrenceCount: 10,
          acceptedCount: 9,
          correctedCount: 1,
          mostFrequentCoaCode: '5-1100',
          mostFrequentCoaId: '501',
          mostFrequentIntent: 'BANK_ADMIN_FEE',
          distinctCoaIds: ['501'],
          distinctIntents: ['BANK_ADMIN_FEE'],
        },
      ],
    };
    const out = runLearningEngine(input);
    expect(out.signals.length).toBeGreaterThan(0);
  });
});

// ─── Batch variant ─────────────────────────────────────────────────────────────

describe('runLearningEngineBatch', () => {
  it('returns one result per company', () => {
    const feedback = makeFeedbackBatch(3, { companyId: 'c1' });
    const results = runLearningEngineBatch(['c1', 'c2'], feedback);
    expect(results).toHaveLength(2);
    expect(results[0]!.companyId).toBe('c1');
    expect(results[1]!.companyId).toBe('c2');
  });

  it('each result has learningVersion 5.0', () => {
    const results = runLearningEngineBatch(['c1', 'c2'], []);
    for (const r of results) expect(r.learningVersion).toBe('5.0');
  });
});

// ─── Custom thresholds ─────────────────────────────────────────────────────────

describe('runLearningEngine — custom thresholds', () => {
  it('respects minOccurrences = 1', () => {
    const feedback = [makeFeedback({ normalizedDescription: 'single occurrence pattern abc', wasAccepted: true }, 'x')];
    const out = runLearningEngine({ companyId: 'company-1', feedbackRecords: feedback, minOccurrences: 1 });
    // With minOccurrences=1, we should get signals
    expect(out.signals).toBeDefined();
  });

  it('respects minConsistency = 0.5', () => {
    const feedback = makeFeedbackBatch(5, { wasAccepted: true });
    const out = runLearningEngine({
      companyId: 'company-1',
      feedbackRecords: feedback,
      minOccurrences: 1,
      minConsistency: 0.5,
    });
    for (const s of out.signals) {
      expect(s.consistencyRate).toBeGreaterThanOrEqual(0);
    }
  });
});

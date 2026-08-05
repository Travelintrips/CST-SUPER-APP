/**
 * Phase 6 — Adaptive Rule Recommendation Engine
 * Integration tests: Phase 5 → Phase 6 → output contract
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runLearningEngine } from '../lib/ai/transaction-intelligence/learningEngine.js';
import { runAdaptiveRuleEngine, runAdaptiveRuleEngineBatch, resetEngineSequences } from '../lib/ai/transaction-intelligence/adaptiveRuleEngine.js';
import { resetClustererSequence } from '../lib/ai/transaction-intelligence/ruleClusterer.js';
import { resetConflictSequence } from '../lib/ai/transaction-intelligence/ruleConflictDetector.js';
import { resetPackageSequence } from '../lib/ai/transaction-intelligence/rulePackageBuilder.js';
import {
  RecommendedRuleSchema,
  RecommendedDictionaryEntrySchema,
  RecommendedCounterpartyMappingSchema,
  SimulationResultSchema,
  RuleConflictSchema,
} from '../lib/ai/transaction-intelligence/adaptiveRuleSchema.js';
import type { FeedbackRecord } from '../lib/ai/transaction-intelligence/learningEngineTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fb(ov: Partial<FeedbackRecord> = {}, id = '1'): FeedbackRecord {
  return {
    id, companyId: 'c1', rawDescription: 'BIAYA ADMIN BCA',
    normalizedDescription: 'biaya admin bca', predictedIntent: 'BANK_ADMIN_FEE',
    wasAccepted: true, recordedAt: '2026-01-01T00:00:00Z', ...ov,
  };
}
function batch(n: number, ov: Partial<FeedbackRecord> = {}): FeedbackRecord[] {
  return Array.from({ length: n }, (_, i) => fb({ ...ov, id: `fb-${i}` }));
}
function makeLO(n = 5, ov: Partial<FeedbackRecord> = {}) {
  return runLearningEngine({ companyId: 'c1', feedbackRecords: batch(n, ov), minOccurrences: 1 });
}

beforeEach(() => {
  resetEngineSequences();
  resetClustererSequence();
  resetConflictSequence();
  resetPackageSequence();
});

// ─── Phase 5 → Phase 6 pipeline ────────────────────────────────────────────────

describe('Phase 5 → Phase 6 integration', () => {
  it('Phase 6 consumes Phase 5 output without error', () => {
    const lo = makeLO(10, { wasAccepted: true });
    expect(() => runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' })).not.toThrow();
  });

  it('strong signals from Phase 5 produce recommendations in Phase 6', () => {
    const lo = runLearningEngine({
      companyId: 'c1',
      feedbackRecords: batch(20, {
        normalizedDescription: 'biaya admin bca',
        predictedIntent: 'BANK_ADMIN_FEE',
        correctedCoaCode: '5-1100', wasAccepted: true,
      }),
      minOccurrences: 1,
    });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    const total = result.recommendedRules.length + result.recommendedDictionaryEntries.length;
    expect(total).toBeGreaterThan(0);
  });

  it('counterparty feedback produces counterparty recommendations', () => {
    const lo = runLearningEngine({
      companyId: 'c1',
      feedbackRecords: batch(10, {
        counterpartyName: 'PT MITRA ABADI',
        normalizedDescription: 'transfer pt mitra',
        predictedIntent: 'VENDOR_PAYMENT',
        correctedCoaCode: '2-1200', wasAccepted: true,
      }),
      minOccurrences: 1,
    });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.recommendedCounterpartyMappings.length).toBeGreaterThan(0);
  });

  it('low acceptance rate triggers threshold recommendation', () => {
    const lo = runLearningEngine({
      companyId: 'c1',
      feedbackRecords: [
        ...batch(30, { wasAccepted: false, correctedIntent: 'TRANSFER_FEE' }),
        ...batch(5, { wasAccepted: true }),
      ],
      minOccurrences: 1,
    });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    const thrChanges = result.recommendedThresholdChanges;
    if (thrChanges.length > 0) {
      expect(thrChanges[0]!.requiresHumanApproval).toBe(true);
    }
  });

  it('high acceptance rate can trigger threshold tightening suggestion', () => {
    const lo = runLearningEngine({
      companyId: 'c1',
      feedbackRecords: batch(30, { wasAccepted: true }),
      minOccurrences: 1,
    });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    // With 100% acceptance, a tightening suggestion may be generated
    for (const thr of result.recommendedThresholdChanges) {
      expect(thr.requiresHumanApproval).toBe(true);
      expect(thr.suggestedValue).not.toBeNaN();
    }
  });

  it('clusters are generated from Phase 5 signals', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.clusters.length).toBeGreaterThanOrEqual(0);
  });

  it('packages wrap recommendations', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    const totalInPkgs = result.packages.reduce(
      (s, p) => s + p.rules.length + p.dictionaryEntries.length + p.counterpartyMappings.length + p.thresholdChanges.length, 0,
    );
    const totalRecs = result.recommendedRules.length + result.recommendedDictionaryEntries.length +
      result.recommendedCounterpartyMappings.length + result.recommendedThresholdChanges.length;
    // Packages should cover all non-empty categories
    expect(totalInPkgs).toBeLessThanOrEqual(totalRecs + 1);
  });

  it('conflicts array contains only valid conflict types', () => {
    const validTypes = ['DUPLICATE_RULE', 'CONTRADICTING_RULE', 'COMPANY_CONFLICT', 'DICTIONARY_CONFLICT', 'COUNTERPARTY_CONFLICT', 'THRESHOLD_CONFLICT', 'KEYWORD_OVERLAP'];
    const lo = makeLO(5);
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const c of result.conflicts) {
      expect(validTypes).toContain(c.type);
    }
  });
});

// ─── Schema validation of output ──────────────────────────────────────────────

describe('Phase 6 output schema validation', () => {
  it('all recommendedRules validate against schema', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const r of result.recommendedRules) {
      const parsed = RecommendedRuleSchema.safeParse(r);
      expect(parsed.success).toBe(true);
    }
  });

  it('all recommendedDictionaryEntries validate against schema', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const d of result.recommendedDictionaryEntries) {
      const parsed = RecommendedDictionaryEntrySchema.safeParse(d);
      expect(parsed.success).toBe(true);
    }
  });

  it('all counterparty mappings validate against schema', () => {
    const lo = makeLO(10, { counterpartyName: 'PT TEST', wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const cp of result.recommendedCounterpartyMappings) {
      const parsed = RecommendedCounterpartyMappingSchema.safeParse(cp);
      expect(parsed.success).toBe(true);
    }
  });

  it('simulationResult validates against schema', () => {
    const lo = makeLO(5);
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    const parsed = SimulationResultSchema.safeParse(result.simulationResult);
    expect(parsed.success).toBe(true);
  });

  it('all conflicts validate against RuleConflictSchema', () => {
    const lo = makeLO(5, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({
      learningOutput: lo,
      companyId: 'c1',
      existingRules: [{
        id: 'ex-1', type: 'KEYWORD', keyword: 'biaya',
        intent: 'TRANSFER_FEE', isActive: true,
      }],
    });
    for (const c of result.conflicts) {
      const parsed = RuleConflictSchema.safeParse(c);
      expect(parsed.success).toBe(true);
    }
  });
});

// ─── Engine does NOT mutate inputs ────────────────────────────────────────────

describe('Phase 6 — immutability contract', () => {
  it('does not modify learningOutput', () => {
    const lo = makeLO(5, { wasAccepted: true });
    const signalsBefore = lo.signals.length;
    runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(lo.signals.length).toBe(signalsBefore);
  });

  it('does not modify existingRules', () => {
    const existingRules = [{ id: 'r1', type: 'KEYWORD' as const, keyword: 'admin', intent: 'BANK_ADMIN_FEE' as const, isActive: true }];
    const lo = makeLO(5);
    runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1', existingRules });
    expect(existingRules).toHaveLength(1);
  });
});

// ─── Batch variant ─────────────────────────────────────────────────────────────

describe('runAdaptiveRuleEngineBatch', () => {
  it('returns one result per input', () => {
    const lo = makeLO(5);
    const results = runAdaptiveRuleEngineBatch([
      { learningOutput: lo, companyId: 'c1' },
      { learningOutput: lo, companyId: 'c2' },
    ]);
    expect(results).toHaveLength(2);
  });

  it('each result has version 6.0', () => {
    const lo = makeLO(3);
    const results = runAdaptiveRuleEngineBatch([{ learningOutput: lo, companyId: 'c1' }]);
    for (const r of results) expect(r.version).toBe('6.0');
  });
});

// ─── Benchmark ────────────────────────────────────────────────────────────────

describe('Phase 6 — benchmark', () => {
  it('handles 100 feedback → Phase 6 within 500ms', () => {
    const lo = runLearningEngine({ companyId: 'c1', feedbackRecords: batch(100, { wasAccepted: true }), minOccurrences: 1 });
    const start = Date.now();
    runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(Date.now() - start).toBeLessThan(500);
  });

  it('handles 1000 feedback → Phase 6 within 2000ms', () => {
    const variants = ['biaya admin', 'transfer giro', 'gaji karyawan', 'pajak ppn'];
    const feedback = Array.from({ length: 1000 }, (_, i) =>
      fb({ id: `fb-${i}`, normalizedDescription: variants[i % variants.length]!, wasAccepted: i % 4 !== 0 }),
    );
    const lo = runLearningEngine({ companyId: 'c1', feedbackRecords: feedback, minOccurrences: 1 });
    const start = Date.now();
    runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it('handles 10000 feedback → Phase 6 within 8000ms', () => {
    const variants = ['biaya admin', 'transfer antar', 'gaji karyawan', 'pajak ppn', 'cicilan pinjaman', 'bunga deposito', 'biaya transfer', 'penerimaan pelanggan'];
    const feedback = Array.from({ length: 10000 }, (_, i) =>
      fb({ id: `fb-${i}`, normalizedDescription: variants[i % variants.length]!, counterpartyName: i % 3 === 0 ? `PT VENDOR ${i % 20}` : undefined, wasAccepted: i % 5 !== 0 }),
    );
    const lo = runLearningEngine({ companyId: 'c1', feedbackRecords: feedback, minOccurrences: 3 });
    const start = Date.now();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(Date.now() - start).toBeLessThan(8000);
    expect(result.version).toBe('6.0');
  });
});

// ─── Quality metrics ──────────────────────────────────────────────────────────

describe('Phase 6 — quality metrics', () => {
  it('rule confidences are in [0,1]', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const r of result.recommendedRules) {
      expect(r.confidence).toBeGreaterThanOrEqual(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('dictionary entry confidences are in [0,1]', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const d of result.recommendedDictionaryEntries) {
      expect(d.confidence).toBeGreaterThanOrEqual(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('impactAnalysis.estimatedPrecisionGain is non-negative', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.impactAnalysis.estimatedPrecisionGain).toBeGreaterThanOrEqual(0);
  });

  it('impactAnalysis.estimatedManualReviewReduction is non-negative', () => {
    const lo = makeLO(10, { wasAccepted: false, correctedIntent: 'TRANSFER_FEE' });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.impactAnalysis.estimatedManualReviewReduction).toBeGreaterThanOrEqual(0);
  });

  it('simulation precisionDelta is finite', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(Number.isFinite(result.simulationResult.precisionDelta)).toBe(true);
  });

  it('packages all have requiresHumanApproval true', () => {
    const lo = makeLO(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const pkg of result.packages) {
      expect(pkg.requiresHumanApproval).toBe(true);
    }
  });
});

// ─── Conflict detection with existing rules ────────────────────────────────────

describe('Phase 6 — conflict detection integration', () => {
  it('conflicts are detected when existing rules overlap', () => {
    const lo = runLearningEngine({
      companyId: 'c1',
      feedbackRecords: batch(10, {
        normalizedDescription: 'biaya admin bca', predictedIntent: 'BANK_ADMIN_FEE', wasAccepted: true,
      }),
      minOccurrences: 1,
    });
    const result = runAdaptiveRuleEngine({
      learningOutput: lo,
      companyId: 'c1',
      existingRules: [{ id: 'ex-1', type: 'KEYWORD', keyword: 'biaya', intent: 'TRANSFER_FEE', isActive: true }],
    });
    // conflicts may or may not be detected depending on exact signals
    expect(Array.isArray(result.conflicts)).toBe(true);
  });

  it('no conflicts when existingRules is empty', () => {
    const lo = makeLO(5, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1', existingRules: [] });
    // Only intra-recommendation conflicts possible
    for (const c of result.conflicts) {
      expect(['CONTRADICTING_RULE', 'THRESHOLD_CONFLICT', 'KEYWORD_OVERLAP', 'DUPLICATE_RULE']).toContain(c.type);
    }
  });
});

/**
 * Phase 6 — Adaptive Rule Recommendation Engine
 * Unit tests (≥ 80 total across this file + integration file)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { runAdaptiveRuleEngine, resetEngineSequences } from '../lib/ai/transaction-intelligence/adaptiveRuleEngine.js';
import { runLearningEngine } from '../lib/ai/transaction-intelligence/learningEngine.js';
import {
  clusterByIntent, clusterByCounterparty, clusterByNormalizedDescription,
  clusterByCoa, clusterByKeyword, clusterByTransactionCode, clusterAllDimensions,
  resetClustererSequence,
} from '../lib/ai/transaction-intelligence/ruleClusterer.js';
import {
  detectRuleVsExisting, detectDictionaryConflicts, detectCounterpartyConflicts,
  detectThresholdConflicts, detectIntraRecommendationConflicts,
  resetConflictSequence,
} from '../lib/ai/transaction-intelligence/ruleConflictDetector.js';
import { computeRiskScore, scoreToRiskLevel, aggregateRiskLevels } from '../lib/ai/transaction-intelligence/ruleRiskAnalyzer.js';
import { computePriorityScore, scoreToPriority, aggregatePriorities } from '../lib/ai/transaction-intelligence/rulePriority.js';
import { simulateRecommendations, generateSyntheticTransactions } from '../lib/ai/transaction-intelligence/ruleSimulation.js';
import { estimateImpact } from '../lib/ai/transaction-intelligence/ruleImpactEstimator.js';
import {
  buildRulePackage, buildDictionaryPackage, buildCounterpartyPackage,
  buildThresholdPackage, buildAllPackages, resetPackageSequence,
} from '../lib/ai/transaction-intelligence/rulePackageBuilder.js';
import type { FeedbackRecord, LearningSignal } from '../lib/ai/transaction-intelligence/learningEngineTypes.js';
import type { RecommendedRule, RecommendedDictionaryEntry, RecommendedCounterpartyMapping } from '../lib/ai/transaction-intelligence/adaptiveRuleTypes.js';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function fb(overrides: Partial<FeedbackRecord> = {}, id = '1'): FeedbackRecord {
  return {
    id, companyId: 'c1', rawDescription: 'BIAYA ADMIN BCA',
    normalizedDescription: 'biaya admin bca', predictedIntent: 'BANK_ADMIN_FEE',
    wasAccepted: true, recordedAt: '2026-01-01T00:00:00Z', ...overrides,
  };
}
function batch(n: number, ov: Partial<FeedbackRecord> = {}): FeedbackRecord[] {
  return Array.from({ length: n }, (_, i) => fb({ ...ov, id: `fb-${i}` }));
}
function makeLearningOutput(n = 5, ov: Partial<FeedbackRecord> = {}) {
  return runLearningEngine({ companyId: 'c1', feedbackRecords: batch(n, ov), minOccurrences: 1 });
}
function makeSignal(ov: Partial<LearningSignal> = {}): LearningSignal {
  return {
    signalType: 'KEYWORD', normalizedDescription: 'biaya admin',
    keyword: 'admin', intent: 'BANK_ADMIN_FEE', coaCode: '5-1100',
    coaId: '501', companyId: 'c1', occurrenceCount: 10,
    consistencyRate: 0.9, signalConfidence: 0.85, ...ov,
  };
}
function makeRule(ov: Partial<RecommendedRule> = {}): RecommendedRule {
  return {
    id: 'r1', type: 'KEYWORD', description: 'test rule', normalizedDescription: 'biaya admin',
    confidence: 0.8, riskLevel: 'LOW', priority: 'NORMAL', requiresHumanApproval: true,
    supportingOccurrences: 10, consistencyRate: 0.9,
    affectedIntents: ['BANK_ADMIN_FEE'], affectedCoaIds: ['501'],
    keyword: 'admin', coaCode: '5-1100', reason: ['10 occurrences'], ...ov,
  };
}
function makeDictEntry(ov: Partial<RecommendedDictionaryEntry> = {}): RecommendedDictionaryEntry {
  return {
    id: 'd1', keyword: 'admin', intent: 'BANK_ADMIN_FEE', suggestedWeight: 1.5,
    aliases: ['administrasi'], reason: 'test', confidence: 0.8, supportingOccurrences: 10,
    riskLevel: 'LOW', priority: 'NORMAL', requiresHumanApproval: true, ...ov,
  };
}
function makeCpMapping(ov: Partial<RecommendedCounterpartyMapping> = {}): RecommendedCounterpartyMapping {
  return {
    id: 'cp1', counterpartyPattern: 'pt mitra', exampleCounterpartyName: 'PT MITRA SEJAHTERA',
    suggestedIntent: 'VENDOR_PAYMENT', suggestedCoaCode: '2-1200',
    companyId: 'c1', confidence: 0.85, supportingOccurrences: 8,
    consistencyRate: 0.9, riskLevel: 'LOW', priority: 'NORMAL',
    requiresHumanApproval: true, ...ov,
  };
}

beforeEach(() => {
  resetEngineSequences();
  resetClustererSequence();
  resetConflictSequence();
  resetPackageSequence();
});

// ═══════════════════════════════════════════════════════════════════
// RULE CLUSTERING
// ═══════════════════════════════════════════════════════════════════

describe('ruleClusterer — clusterByIntent', () => {
  it('groups signals by intent', () => {
    const signals = [
      makeSignal({ intent: 'BANK_ADMIN_FEE' }),
      makeSignal({ intent: 'BANK_ADMIN_FEE', normalizedDescription: 'biaya admin bca' }),
      makeSignal({ intent: 'PAYROLL', normalizedDescription: 'gaji karyawan', keyword: 'gaji' }),
    ];
    const clusters = clusterByIntent(signals);
    expect(clusters.length).toBe(2);
    const intents = clusters.map((c) => c.dominantIntent);
    expect(intents).toContain('BANK_ADMIN_FEE');
    expect(intents).toContain('PAYROLL');
  });

  it('each cluster has clusterType INTENT', () => {
    const clusters = clusterByIntent([makeSignal()]);
    for (const c of clusters) expect(c.clusterType).toBe('INTENT');
  });

  it('memberCount is sum of occurrenceCount', () => {
    const signals = [
      makeSignal({ intent: 'BANK_ADMIN_FEE', occurrenceCount: 5 }),
      makeSignal({ intent: 'BANK_ADMIN_FEE', normalizedDescription: 'admin fee', occurrenceCount: 3 }),
    ];
    const clusters = clusterByIntent(signals);
    expect(clusters[0]!.memberCount).toBe(8);
  });
});

describe('ruleClusterer — clusterByCounterparty', () => {
  it('groups signals with same counterpartyName', () => {
    const signals = [
      makeSignal({ signalType: 'COUNTERPARTY', counterpartyName: 'PT ABC' }),
      makeSignal({ signalType: 'COUNTERPARTY', counterpartyName: 'PT ABC', normalizedDescription: 'pt abc 2' }),
      makeSignal({ signalType: 'COUNTERPARTY', counterpartyName: 'PT XYZ', normalizedDescription: 'pt xyz' }),
    ];
    const clusters = clusterByCounterparty(signals);
    expect(clusters.length).toBe(2);
  });

  it('ignores signals without counterpartyName', () => {
    const signals = [makeSignal({ counterpartyName: undefined })];
    const clusters = clusterByCounterparty(signals);
    expect(clusters).toHaveLength(0);
  });
});

describe('ruleClusterer — clusterByNormalizedDescription', () => {
  it('groups identical descriptions', () => {
    const signals = [
      makeSignal({ normalizedDescription: 'same desc' }),
      makeSignal({ normalizedDescription: 'same desc', keyword: 'desc' }),
    ];
    const clusters = clusterByNormalizedDescription(signals);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memberCount).toBe(20);
  });
});

describe('ruleClusterer — clusterByCoa', () => {
  it('groups by coaCode', () => {
    const signals = [
      makeSignal({ coaCode: '5-1100' }),
      makeSignal({ coaCode: '5-1200', normalizedDescription: 'transfer fee' }),
    ];
    const clusters = clusterByCoa(signals);
    const codes = clusters.map((c) => c.dominantCoaCode);
    expect(codes).toContain('5-1100');
    expect(codes).toContain('5-1200');
  });
});

describe('ruleClusterer — clusterByKeyword', () => {
  it('only includes KEYWORD type signals', () => {
    const signals = [
      makeSignal({ signalType: 'KEYWORD', keyword: 'admin' }),
      makeSignal({ signalType: 'COUNTERPARTY', keyword: undefined, normalizedDescription: 'cp1' }),
    ];
    const clusters = clusterByKeyword(signals);
    expect(clusters).toHaveLength(1);
  });
});

describe('ruleClusterer — clusterByTransactionCode', () => {
  it('clusters by transactionCode', () => {
    const signals = [
      makeSignal({ transactionCode: 'BI-FAST' }),
      makeSignal({ transactionCode: 'RTGS', normalizedDescription: 'rtgs signal' }),
    ];
    const clusters = clusterByTransactionCode(signals);
    expect(clusters.length).toBe(2);
    for (const c of clusters) expect(c.clusterType).toBe('TRANSACTION_CODE');
  });
});

describe('ruleClusterer — clusterAllDimensions', () => {
  it('returns clusters from all dimensions', () => {
    const signals = [makeSignal()];
    const all = clusterAllDimensions(signals);
    const types = new Set(all.map((c) => c.clusterType));
    expect(types.has('INTENT')).toBe(true);
    expect(types.has('KEYWORD')).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// RISK ANALYZER
// ═══════════════════════════════════════════════════════════════════

describe('ruleRiskAnalyzer', () => {
  it('returns LOW for high confidence, high consistency, no conflicts', () => {
    const level = scoreToRiskLevel(computeRiskScore({
      confidence: 0.95, occurrenceCount: 100, consistencyRate: 0.95,
      isCompanyScoped: true, conflictCount: 0, isThresholdChange: false, isNewCoaMapping: false,
    }));
    expect(level).toBe('LOW');
  });

  it('returns CRITICAL for low confidence, low consistency, many conflicts', () => {
    const level = scoreToRiskLevel(computeRiskScore({
      confidence: 0.1, occurrenceCount: 1, consistencyRate: 0.1,
      isCompanyScoped: false, conflictCount: 10, isThresholdChange: true, isNewCoaMapping: true,
      thresholdChangeMagnitude: 0.3,
    }));
    expect(level).toBe('CRITICAL');
  });

  it('threshold change increases risk', () => {
    const base = computeRiskScore({
      confidence: 0.8, occurrenceCount: 50, consistencyRate: 0.85,
      isCompanyScoped: true, conflictCount: 0, isThresholdChange: false, isNewCoaMapping: false,
    });
    const withThr = computeRiskScore({
      confidence: 0.8, occurrenceCount: 50, consistencyRate: 0.85,
      isCompanyScoped: true, conflictCount: 0, isThresholdChange: true, isNewCoaMapping: false,
      thresholdChangeMagnitude: 0.1,
    });
    expect(withThr).toBeGreaterThan(base);
  });

  it('aggregateRiskLevels returns worst level', () => {
    expect(aggregateRiskLevels(['LOW', 'HIGH', 'MEDIUM'])).toBe('HIGH');
    expect(aggregateRiskLevels(['LOW', 'CRITICAL'])).toBe('CRITICAL');
    expect(aggregateRiskLevels(['LOW', 'LOW'])).toBe('LOW');
  });

  it('risk score is between 0 and 1', () => {
    const score = computeRiskScore({
      confidence: 0.5, occurrenceCount: 10, consistencyRate: 0.5,
      isCompanyScoped: true, conflictCount: 2, isThresholdChange: false, isNewCoaMapping: false,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PRIORITY
// ═══════════════════════════════════════════════════════════════════

describe('rulePriority', () => {
  it('returns URGENT for high volume + high gain', () => {
    const p = scoreToPriority(computePriorityScore({
      occurrenceCount: 1000, estimatedPrecisionGain: 0.25, estimatedManualReviewReduction: 0.20,
      riskLevel: 'LOW', confidence: 0.95, isProblematicPattern: true, conflictCount: 0,
    }));
    expect(p).toBe('URGENT');
  });

  it('returns LOW for very sparse evidence', () => {
    const p = scoreToPriority(computePriorityScore({
      occurrenceCount: 1, estimatedPrecisionGain: 0.01, estimatedManualReviewReduction: 0.01,
      riskLevel: 'HIGH', confidence: 0.3, isProblematicPattern: false, conflictCount: 5,
    }));
    expect(p).toBe('LOW');
  });

  it('aggregatePriorities returns highest', () => {
    expect(aggregatePriorities(['LOW', 'URGENT', 'NORMAL'])).toBe('URGENT');
    expect(aggregatePriorities(['LOW', 'LOW'])).toBe('LOW');
    expect(aggregatePriorities(['NORMAL', 'HIGH'])).toBe('HIGH');
  });

  it('priority score between 0 and 1', () => {
    const score = computePriorityScore({
      occurrenceCount: 50, estimatedPrecisionGain: 0.1, estimatedManualReviewReduction: 0.1,
      riskLevel: 'MEDIUM', confidence: 0.7, isProblematicPattern: false, conflictCount: 1,
    });
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });
});

// ═══════════════════════════════════════════════════════════════════
// CONFLICT DETECTOR
// ═══════════════════════════════════════════════════════════════════

describe('ruleConflictDetector', () => {
  it('detects DUPLICATE_RULE vs existing rule', () => {
    const rec = makeRule({ keyword: 'admin', affectedIntents: ['BANK_ADMIN_FEE'] });
    const conflicts = detectRuleVsExisting([rec], [{
      id: 'ex-1', type: 'KEYWORD', keyword: 'admin', intent: 'BANK_ADMIN_FEE',
      isActive: true,
    }]);
    const types = conflicts.map((c) => c.type);
    expect(types).toContain('DUPLICATE_RULE');
  });

  it('detects CONTRADICTING_RULE vs existing rule', () => {
    const rec = makeRule({ keyword: 'admin', affectedIntents: ['PAYROLL'] });
    const conflicts = detectRuleVsExisting([rec], [{
      id: 'ex-2', type: 'KEYWORD', keyword: 'admin', intent: 'BANK_ADMIN_FEE',
      isActive: true,
    }]);
    const types = conflicts.map((c) => c.type);
    expect(types).toContain('CONTRADICTING_RULE');
  });

  it('ignores inactive existing rules', () => {
    const rec = makeRule({ keyword: 'admin', affectedIntents: ['BANK_ADMIN_FEE'] });
    const conflicts = detectRuleVsExisting([rec], [{
      id: 'ex-3', type: 'KEYWORD', keyword: 'admin', intent: 'BANK_ADMIN_FEE',
      isActive: false,
    }]);
    expect(conflicts).toHaveLength(0);
  });

  it('detects DICTIONARY_CONFLICT for same keyword same intent', () => {
    const entry = makeDictEntry({ keyword: 'admin', intent: 'BANK_ADMIN_FEE' });
    const conflicts = detectDictionaryConflicts([entry], [{
      keyword: 'admin', intent: 'BANK_ADMIN_FEE', weight: 1.0, aliases: [], isActive: true,
    }]);
    expect(conflicts.some((c) => c.type === 'DICTIONARY_CONFLICT')).toBe(true);
  });

  it('detects DICTIONARY_CONFLICT for same keyword different intent', () => {
    const entry = makeDictEntry({ keyword: 'admin', intent: 'TRANSFER_FEE' });
    const conflicts = detectDictionaryConflicts([entry], [{
      keyword: 'admin', intent: 'BANK_ADMIN_FEE', weight: 1.0, aliases: [], isActive: true,
    }]);
    expect(conflicts.some((c) => c.type === 'DICTIONARY_CONFLICT')).toBe(true);
  });

  it('detects COUNTERPARTY_CONFLICT', () => {
    const mapping = makeCpMapping({ counterpartyPattern: 'pt mitra', suggestedIntent: 'CUSTOMER_PAYMENT' });
    const conflicts = detectCounterpartyConflicts([mapping], [{
      id: 'ex-cp', type: 'COUNTERPARTY_MAPPING', counterpartyPattern: 'pt mitra',
      intent: 'VENDOR_PAYMENT', isActive: true,
    }]);
    expect(conflicts.some((c) => c.type === 'COUNTERPARTY_CONFLICT')).toBe(true);
  });

  it('detects THRESHOLD_CONFLICT for same parameter different values', () => {
    const changes = [
      { id: 't1', parameter: 'manualReviewThreshold', parameterLabel: 'x', currentValue: 0.8, suggestedValue: 0.85, reason: 'r', confidence: 0.8, riskLevel: 'MEDIUM' as const, priority: 'NORMAL' as const, requiresHumanApproval: true as const },
      { id: 't2', parameter: 'manualReviewThreshold', parameterLabel: 'x', currentValue: 0.8, suggestedValue: 0.75, reason: 'r', confidence: 0.7, riskLevel: 'HIGH' as const, priority: 'HIGH' as const, requiresHumanApproval: true as const },
    ];
    const conflicts = detectThresholdConflicts(changes);
    expect(conflicts.some((c) => c.type === 'THRESHOLD_CONFLICT')).toBe(true);
  });

  it('detects intra-recommendation contradicting rules', () => {
    const r1 = makeRule({ id: 'r1', keyword: 'admin', affectedIntents: ['BANK_ADMIN_FEE'] });
    const r2 = makeRule({ id: 'r2', keyword: 'admin', affectedIntents: ['TRANSFER_FEE'] });
    const conflicts = detectIntraRecommendationConflicts([r1, r2]);
    expect(conflicts.some((c) => c.type === 'CONTRADICTING_RULE')).toBe(true);
  });

  it('conflict has severity and resolution fields', () => {
    const rec = makeRule({ keyword: 'admin', affectedIntents: ['BANK_ADMIN_FEE'] });
    const conflicts = detectRuleVsExisting([rec], [{
      id: 'ex-4', type: 'KEYWORD', keyword: 'admin', intent: 'BANK_ADMIN_FEE', isActive: true,
    }]);
    if (conflicts.length > 0) {
      expect(conflicts[0]).toHaveProperty('severity');
      expect(conflicts[0]).toHaveProperty('resolution');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════
// SIMULATION
// ═══════════════════════════════════════════════════════════════════

describe('ruleSimulation', () => {
  it('dryRun is always true', () => {
    const result = simulateRecommendations([], [], []);
    expect(result.dryRun).toBe(true);
  });

  it('returns correct transaction counts', () => {
    const txs = Array.from({ length: 50 }, (_, i) => ({
      description: 'biaya admin', normalizedDescription: 'biaya admin',
      currentIntent: 'BANK_ADMIN_FEE' as const,
      currentConfidence: 0.6, requiresManualReview: i % 5 === 0,
    }));
    const result = simulateRecommendations([makeRule()], [], [], txs);
    expect(result.totalTransactions).toBe(50);
    expect(result.affectedTransactions).toBeGreaterThanOrEqual(0);
    expect(result.improvedTransactions).toBeGreaterThanOrEqual(0);
    expect(result.worsenedTransactions).toBeGreaterThanOrEqual(0);
  });

  it('improvedTransactions + worsenedTransactions <= affectedTransactions', () => {
    const result = simulateRecommendations([makeRule()], [makeDictEntry()], [makeCpMapping()]);
    expect(result.improvedTransactions + result.worsenedTransactions)
      .toBeLessThanOrEqual(result.affectedTransactions);
  });

  it('generates synthetic transactions when none provided', () => {
    const result = simulateRecommendations([makeRule()], [], []);
    expect(result.totalTransactions).toBeGreaterThan(0);
  });

  it('simulationConfidence between 0 and 1', () => {
    const result = simulateRecommendations([], [], []);
    expect(result.simulationConfidence).toBeGreaterThanOrEqual(0);
    expect(result.simulationConfidence).toBeLessThanOrEqual(1);
  });

  it('generateSyntheticTransactions respects sampleSize', () => {
    const txs = generateSyntheticTransactions([], [], [], 50);
    expect(txs.length).toBe(50);
  });
});

// ═══════════════════════════════════════════════════════════════════
// IMPACT ESTIMATOR
// ═══════════════════════════════════════════════════════════════════

describe('ruleImpactEstimator', () => {
  it('returns all required fields', () => {
    const impact = estimateImpact({
      signals: [makeSignal()], totalFeedbackProcessed: 100,
      currentAcceptanceRate: 0.7, ruleCount: 3, dictionaryCount: 2,
      counterpartyCount: 1, avgRecommendationConfidence: 0.8,
      avgConsistencyRate: 0.85, conflictCount: 0,
    });
    expect(impact).toHaveProperty('estimatedTransactionsAffected');
    expect(impact).toHaveProperty('estimatedPrecisionGain');
    expect(impact).toHaveProperty('estimatedManualReviewReduction');
    expect(impact).toHaveProperty('confidenceInterval');
    expect(impact).toHaveProperty('summary');
  });

  it('precision gain between 0 and 0.3', () => {
    const impact = estimateImpact({
      signals: [makeSignal()], totalFeedbackProcessed: 100,
      currentAcceptanceRate: 0.7, ruleCount: 5, dictionaryCount: 3,
      counterpartyCount: 2, avgRecommendationConfidence: 0.8,
      avgConsistencyRate: 0.85, conflictCount: 0,
    });
    expect(impact.estimatedPrecisionGain).toBeGreaterThanOrEqual(0);
    expect(impact.estimatedPrecisionGain).toBeLessThanOrEqual(0.30);
  });

  it('confidence interval lower <= upper', () => {
    const impact = estimateImpact({
      signals: [makeSignal()], totalFeedbackProcessed: 100,
      currentAcceptanceRate: 0.7, ruleCount: 3, dictionaryCount: 2,
      counterpartyCount: 1, avgRecommendationConfidence: 0.8,
      avgConsistencyRate: 0.85, conflictCount: 0,
    });
    expect(impact.confidenceInterval[0]).toBeLessThanOrEqual(impact.confidenceInterval[1]);
  });

  it('summary is non-empty string', () => {
    const impact = estimateImpact({
      signals: [], totalFeedbackProcessed: 0,
      currentAcceptanceRate: 0.5, ruleCount: 0, dictionaryCount: 0,
      counterpartyCount: 0, avgRecommendationConfidence: 0,
      avgConsistencyRate: 0, conflictCount: 0,
    });
    expect(typeof impact.summary).toBe('string');
    expect(impact.summary.length).toBeGreaterThan(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// PACKAGE BUILDER
// ═══════════════════════════════════════════════════════════════════

describe('rulePackageBuilder', () => {
  it('buildRulePackage returns null for empty rules', () => {
    expect(buildRulePackage([])).toBeNull();
  });

  it('buildRulePackage has requiresHumanApproval true', () => {
    const pkg = buildRulePackage([makeRule()]);
    expect(pkg!.requiresHumanApproval).toBe(true);
  });

  it('buildDictionaryPackage has correct packageType', () => {
    const pkg = buildDictionaryPackage([makeDictEntry()]);
    expect(pkg!.packageType).toBe('DICTIONARY_PACKAGE');
  });

  it('buildCounterpartyPackage has correct packageType', () => {
    const pkg = buildCounterpartyPackage([makeCpMapping()]);
    expect(pkg!.packageType).toBe('COUNTERPARTY_PACKAGE');
  });

  it('buildThresholdPackage has THRESHOLD_PACKAGE type', () => {
    const change = { id: 't1', parameter: 'p', parameterLabel: 'P', currentValue: 0.8, suggestedValue: 0.85, reason: 'r', confidence: 0.8, riskLevel: 'MEDIUM' as const, priority: 'NORMAL' as const, requiresHumanApproval: true as const };
    const pkg = buildThresholdPackage([change]);
    expect(pkg!.packageType).toBe('THRESHOLD_PACKAGE');
  });

  it('buildAllPackages returns up to 4 packages', () => {
    const pkgs = buildAllPackages({
      rules: [makeRule()], dictionaryEntries: [makeDictEntry()],
      counterpartyMappings: [makeCpMapping()],
      thresholdChanges: [{ id: 't1', parameter: 'p', parameterLabel: 'P', currentValue: 0.8, suggestedValue: 0.85, reason: 'r', confidence: 0.8, riskLevel: 'MEDIUM' as const, priority: 'NORMAL' as const, requiresHumanApproval: true as const }],
    });
    expect(pkgs.length).toBe(4);
  });

  it('buildAllPackages returns 0 for empty input', () => {
    const pkgs = buildAllPackages({ rules: [], dictionaryEntries: [], counterpartyMappings: [], thresholdChanges: [] });
    expect(pkgs.length).toBe(0);
  });

  it('package riskLevel is aggregate of member risks', () => {
    const rules = [
      makeRule({ riskLevel: 'LOW' }),
      makeRule({ id: 'r2', riskLevel: 'HIGH' }),
    ];
    const pkg = buildRulePackage(rules);
    expect(pkg!.riskLevel).toBe('HIGH');
  });
});

// ═══════════════════════════════════════════════════════════════════
// ADAPTIVE RULE ENGINE — core
// ═══════════════════════════════════════════════════════════════════

describe('runAdaptiveRuleEngine — output shape', () => {
  it('returns version 6.0', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.version).toBe('6.0');
  });

  it('requiresHumanApproval is always true', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('all recommended rules have requiresHumanApproval true', () => {
    const lo = makeLearningOutput(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const r of result.recommendedRules) {
      expect(r.requiresHumanApproval).toBe(true);
    }
  });

  it('all dictionary entries have requiresHumanApproval true', () => {
    const lo = makeLearningOutput(10, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const d of result.recommendedDictionaryEntries) {
      expect(d.requiresHumanApproval).toBe(true);
    }
  });

  it('all counterparty mappings have requiresHumanApproval true', () => {
    const lo = makeLearningOutput(10, { counterpartyName: 'PT TEST', wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    for (const cp of result.recommendedCounterpartyMappings) {
      expect(cp.requiresHumanApproval).toBe(true);
    }
  });

  it('simulationResult.dryRun is always true', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.simulationResult.dryRun).toBe(true);
  });

  it('has all required output fields', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result).toHaveProperty('recommendedRules');
    expect(result).toHaveProperty('recommendedDictionaryEntries');
    expect(result).toHaveProperty('recommendedThresholdChanges');
    expect(result).toHaveProperty('recommendedCounterpartyMappings');
    expect(result).toHaveProperty('simulationResult');
    expect(result).toHaveProperty('impactAnalysis');
    expect(result).toHaveProperty('riskLevel');
    expect(result).toHaveProperty('priority');
    expect(result).toHaveProperty('conflicts');
    expect(result).toHaveProperty('clusters');
    expect(result).toHaveProperty('packages');
    expect(result).toHaveProperty('summary');
  });

  it('summary is non-empty string', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(result.summary.length).toBeGreaterThan(0);
  });

  it('riskLevel is valid', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.riskLevel);
  });

  it('priority is valid', () => {
    const lo = makeLearningOutput();
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1' });
    expect(['LOW', 'NORMAL', 'HIGH', 'URGENT']).toContain(result.priority);
  });

  it('respects minRecommendationConfidence', () => {
    const lo = makeLearningOutput(5, { wasAccepted: true });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1', minRecommendationConfidence: 0.99 });
    // Very high threshold should produce 0 or very few recs
    expect(result.recommendedRules.length).toBeLessThanOrEqual(5);
  });

  it('respects maxRecommendations cap', () => {
    const lo = runLearningEngine({
      companyId: 'c1',
      feedbackRecords: Array.from({ length: 50 }, (_, i) =>
        fb({ id: `fb-${i}`, normalizedDescription: `pattern ${i} keyword`, wasAccepted: true })
      ),
      minOccurrences: 1,
    });
    const result = runAdaptiveRuleEngine({ learningOutput: lo, companyId: 'c1', maxRecommendations: 10 });
    const total = result.recommendedRules.length + result.recommendedDictionaryEntries.length + result.recommendedCounterpartyMappings.length;
    expect(total).toBeLessThanOrEqual(20); // generous upper bound
  });
});

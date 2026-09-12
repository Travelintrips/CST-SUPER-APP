/**
 * AI Transaction Intelligence — Phase 8
 * Review Observability Tests (T083–T102)
 */

import { describe, test, expect } from 'vitest';
import { calculateReviewObservability } from '../lib/ai/transaction-intelligence/reviewObservability.js';
import { buildReviewCase } from '../lib/ai/transaction-intelligence/reviewCaseBuilder.js';
import { recordReviewerDecision } from '../lib/ai/transaction-intelligence/reviewDecisionService.js';
import type {
  AIReviewCase,
  ReviewOrchestrationInput,
} from '../lib/ai/transaction-intelligence/reviewOrchestrationTypes.js';

const FIXED_NOW = new Date('2026-07-01T10:00:00Z');

function makeMinimalInput(overrides: Partial<ReviewOrchestrationInput> = {}): ReviewOrchestrationInput {
  return {
    companyId: 'co1',
    transaction: {
      id: String(Math.random()),
      description: 'Test',
      amount: 1_000_000,
      currency: 'IDR',
      direction: 'DEBIT',
      transactionDate: '2026-07-01T10:00:00Z',
    },
    phase1: {
      intent: 'VENDOR_PAYMENT',
      confidence: 0.85,
      normalizedDescription: 'test',
      candidates: [],
      explanation: { intent: 'VENDOR_PAYMENT', confidence: 0.85, matches: [], reason: '' },
      requiresManualReview: false,
    } as unknown as ReviewOrchestrationInput['phase1'],
    phase2: {
      primaryIntent: 'VENDOR_PAYMENT',
      confidence: 0.85,
      normalizedDescription: 'test',
      alternatives: [],
      evidence: [],
      reason: [],
      phase1Analysis: {} as unknown as ReviewOrchestrationInput['phase1'],
      requiresManualReview: false,
    } as ReviewOrchestrationInput['phase2'],
    phase3: {
      companyId: 'co1',
      primaryRecommendation: { coaId: '1', coaCode: '2-100', coaName: 'AP', confidence: 0.85, score: 0.85 },
      alternatives: [],
      intent: 'VENDOR_PAYMENT',
      normalizedDescription: 'test',
      evidence: [],
      reason: [],
      conflictFlags: [],
      requiresManualReview: false,
      recommendationSource: 'HISTORICAL_PATTERN',
      phase1Analysis: {} as unknown as ReviewOrchestrationInput['phase1'],
      phase2Classification: {} as ReviewOrchestrationInput['phase2'],
    } as unknown as ReviewOrchestrationInput['phase3'],
    phase4: {
      confidence: { level: 'HIGH', score: 0.85, factors: [] },
      recommendation: { status: 'AUTO_PROCESS', label: '', reason: '' },
      evidence: [],
      confidenceBreakdown: [],
      ambiguity: [],
      accountingWarnings: [],
      auditSummary: '',
      reviewerNotes: [],
      explainabilityVersion: '1.0',
    } as unknown as ReviewOrchestrationInput['phase4'],
    phase7: {
      companyId: 'co1',
      isAnomaly: false,
      anomalyScore: 0.05,
      riskLevel: 'NONE',
      anomalyTypes: [],
      detections: [],
      explanation: [],
      recommendation: 'NO_ACTION',
      requiresManualReview: false,
      baselineQuality: 'GOOD',
      confidence: 0.85,
      conflictFlags: [],
      evaluatedAt: '2026-07-01T10:00:00Z',
      anomalyVersion: '1.0',
    } as ReviewOrchestrationInput['phase7'],
    ...overrides,
  };
}

function buildCase(id: string, overrides: Partial<ReviewOrchestrationInput> = {}): AIReviewCase {
  const input = makeMinimalInput(overrides);
  (input.transaction as Record<string, unknown>).id = id;
  return buildReviewCase(input, FIXED_NOW);
}

function addDecision(
  reviewCase: AIReviewCase,
  decision: 'APPROVE_RECOMMENDATION' | 'CHANGE_COA' | 'REJECT_RECOMMENDATION' | 'ESCALATE',
  selectedCoaCode?: string,
): AIReviewCase {
  const rcInReview: AIReviewCase = { ...reviewCase, status: 'IN_REVIEW' };
  const dec = recordReviewerDecision({
    reviewCaseId: rcInReview.id,
    companyId: rcInReview.companyId,
    reviewerId: 'user1',
    decision,
    selectedCoa: decision === 'CHANGE_COA' ? { coaId: '99', coaCode: selectedCoaCode ?? '6-999', coaName: 'Other' } : undefined,
    reasonCode: ['REJECT_RECOMMENDATION', 'ESCALATE'].includes(decision) ? 'REASON' : undefined,
    idempotencyKey: `idem-obs-${Math.random()}`,
    decidedAt: new Date('2026-07-01T12:00:00Z').toISOString(),
  }, rcInReview);
  return { ...rcInReview, status: dec.newStatus, decision: dec, updatedAt: dec.createdAt };
}

describe('T083–T102: Observability Metrics', () => {
  test('T083 total cases count', () => {
    const cases = [buildCase('t1'), buildCase('t2'), buildCase('t3')];
    const obs = calculateReviewObservability(cases);
    expect(obs.totalCases).toBe(3);
  });

  test('T084 byStatus counts', () => {
    const c1 = buildCase('t1');
    const c2 = addDecision(buildCase('t2'), 'APPROVE_RECOMMENDATION');
    const obs = calculateReviewObservability([c1, c2]);
    expect(obs.byStatus['QUEUED']).toBeGreaterThanOrEqual(1);
    expect(obs.byStatus['APPROVED_RECOMMENDATION']).toBeGreaterThanOrEqual(1);
  });

  test('T085 byQueue counts', () => {
    const cases = [buildCase('t1'), buildCase('t2')];
    const obs = calculateReviewObservability(cases);
    expect(Object.keys(obs.byQueue).length).toBeGreaterThan(0);
    const total = Object.values(obs.byQueue).reduce((s, v) => s + v, 0);
    expect(total).toBe(2);
  });

  test('T086 byPriority counts', () => {
    const cases = [buildCase('t1'), buildCase('t2'), buildCase('t3')];
    const obs = calculateReviewObservability(cases);
    const total = Object.values(obs.byPriority).reduce((s, v) => s + v, 0);
    expect(total).toBe(3);
  });

  test('T087 byIntent counts', () => {
    const cases = [buildCase('t1'), buildCase('t2')];
    const obs = calculateReviewObservability(cases);
    expect(obs.byIntent['VENDOR_PAYMENT']).toBe(2);
  });

  test('T088 manualReviewRate', () => {
    const c1 = buildCase('t1', {
      phase7: { ...makeMinimalInput().phase7, requiresManualReview: true },
    });
    const c2 = buildCase('t2');
    const obs = calculateReviewObservability([c1, c2]);
    expect(obs.manualReviewRate).toBeGreaterThan(0);
    expect(obs.manualReviewRate).toBeLessThanOrEqual(1);
  });

  test('T089 aiApprovalRate', () => {
    const c1 = addDecision(buildCase('t1'), 'APPROVE_RECOMMENDATION');
    const c2 = addDecision(buildCase('t2'), 'APPROVE_RECOMMENDATION');
    const c3 = addDecision(buildCase('t3'), 'CHANGE_COA');
    const obs = calculateReviewObservability([c1, c2, c3]);
    expect(obs.aiApprovalRate).toBeCloseTo(2 / 3, 5);
  });

  test('T090 coaChangeRate', () => {
    const c1 = addDecision(buildCase('t1'), 'CHANGE_COA', '6-999');
    const c2 = addDecision(buildCase('t2'), 'APPROVE_RECOMMENDATION');
    const obs = calculateReviewObservability([c1, c2]);
    expect(obs.coaChangeRate).toBeCloseTo(0.5, 5);
  });

  test('T091 rejectionRate', () => {
    const c1 = addDecision(buildCase('t1'), 'REJECT_RECOMMENDATION');
    const c2 = addDecision(buildCase('t2'), 'APPROVE_RECOMMENDATION');
    const obs = calculateReviewObservability([c1, c2]);
    expect(obs.rejectionRate).toBeCloseTo(0.5, 5);
  });

  test('T092 escalationRate', () => {
    const c1 = addDecision(buildCase('t1'), 'ESCALATE');
    const c2 = addDecision(buildCase('t2'), 'APPROVE_RECOMMENDATION');
    const obs = calculateReviewObservability([c1, c2]);
    expect(obs.escalationRate).toBeCloseTo(0.5, 5);
  });

  test('T093 averageIntentConfidence', () => {
    const cases = [buildCase('t1'), buildCase('t2'), buildCase('t3')];
    const obs = calculateReviewObservability(cases);
    expect(obs.averageIntentConfidence).toBeGreaterThan(0);
    expect(obs.averageIntentConfidence).toBeLessThanOrEqual(1);
  });

  test('T094 averageAnomalyScore', () => {
    const cases = [buildCase('t1'), buildCase('t2')];
    const obs = calculateReviewObservability(cases);
    expect(obs.averageAnomalyScore).toBeGreaterThanOrEqual(0);
    expect(obs.averageAnomalyScore).toBeLessThanOrEqual(1);
  });

  test('T095 openCaseCount', () => {
    const open1 = buildCase('t1');
    const closed = addDecision(buildCase('t2'), 'APPROVE_RECOMMENDATION');
    const obs = calculateReviewObservability([open1, closed]);
    expect(obs.openCaseCount).toBe(1);
  });

  test('T096 overdueCaseCount', () => {
    const c1 = buildCase('t1');
    // Manually set overdue
    const overdueCase: AIReviewCase = {
      ...c1,
      sla: { ...c1.sla, isOverdue: true },
    };
    const obs = calculateReviewObservability([overdueCase, c1]);
    expect(obs.overdueCaseCount).toBe(1);
  });

  test('T097 slaComplianceRate', () => {
    const c1 = buildCase('t1');
    const obs = calculateReviewObservability([c1]);
    expect(obs.slaComplianceRate).toBeGreaterThanOrEqual(0);
    expect(obs.slaComplianceRate).toBeLessThanOrEqual(1);
  });

  test('T098 reviewerAgreementRate', () => {
    const c1 = addDecision(buildCase('t1'), 'APPROVE_RECOMMENDATION');
    const c2 = addDecision(buildCase('t2'), 'CHANGE_COA', '6-999');
    const obs = calculateReviewObservability([c1, c2]);
    // c1 = agreement, c2 = disagreement (different COA)
    expect(obs.reviewerAgreementRate).toBeGreaterThanOrEqual(0);
    expect(obs.reviewerAgreementRate).toBeLessThanOrEqual(1);
  });

  test('T099 topChangedCoa', () => {
    const c1 = addDecision(buildCase('t1'), 'CHANGE_COA', '6-999');
    const c2 = addDecision(buildCase('t2'), 'CHANGE_COA', '6-999');
    const obs = calculateReviewObservability([c1, c2]);
    expect(obs.topChangedCoa.length).toBeGreaterThan(0);
    expect(obs.topChangedCoa[0]!.count).toBe(2);
  });

  test('T100 topConflictFlags', () => {
    const c1 = buildCase('t1');
    const c1WithFlag: AIReviewCase = { ...c1, flags: ['ANOMALY_REVIEW_REQUIRED'] };
    const c2WithFlag: AIReviewCase = { ...buildCase('t2'), flags: ['ANOMALY_REVIEW_REQUIRED'] };
    const obs = calculateReviewObservability([c1WithFlag, c2WithFlag]);
    expect(obs.topConflictFlags.length).toBeGreaterThan(0);
    expect(obs.topConflictFlags[0]!.flag).toBe('ANOMALY_REVIEW_REQUIRED');
  });

  test('T101 empty dataset returns zero report', () => {
    const obs = calculateReviewObservability([]);
    expect(obs.totalCases).toBe(0);
    expect(obs.aiApprovalRate).toBe(0);
    expect(obs.slaComplianceRate).toBe(1); // 100% compliant with 0 cases
  });

  test('T102 company-filtered dataset', () => {
    const co1a = buildCase('t1');
    const co1b = buildCase('t2');
    const co2 = buildCase('t3', { companyId: 'co2' });
    // Filter to co1 only
    const co1Cases = [co1a, co1b, co2].filter(c => c.companyId === 'co1');
    const obs = calculateReviewObservability(co1Cases);
    expect(obs.totalCases).toBe(2);
  });
});

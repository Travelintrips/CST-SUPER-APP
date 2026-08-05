/**
 * AI Transaction Intelligence — Phase 8
 * Review Orchestration — Integration Tests (T103–T120)
 *
 * End-to-end scenarios combining Phase 1–8.
 */

import { describe, test, expect } from 'vitest';
import {
  createAIReviewCase,
  recordReviewerDecisionPublic,
  buildReviewAuditTimelinePublic,
  calculateReviewObservabilityPublic,
} from '../lib/ai/transaction-intelligence/reviewOrchestrationEngine.js';
import { buildReviewCase } from '../lib/ai/transaction-intelligence/reviewCaseBuilder.js';
import { recordReviewerDecision } from '../lib/ai/transaction-intelligence/reviewDecisionService.js';
import { maskAccountNumber } from '../lib/ai/transaction-intelligence/reviewPrivacy.js';
import type {
  ReviewOrchestrationInput,
  AIReviewCase,
} from '../lib/ai/transaction-intelligence/reviewOrchestrationTypes.js';

const FIXED_NOW = new Date('2026-07-01T10:00:00Z');

// ─── Shared test data builders ────────────────────────────────────────────────

function makeBase(): ReviewOrchestrationInput {
  return {
    companyId: 'co1',
    transaction: {
      id: 'tx-integ-1',
      description: 'Customer payment from PT XYZ',
      amount: 10_000_000,
      currency: 'IDR',
      direction: 'CREDIT',
      transactionDate: '2026-07-01T10:00:00Z',
      counterpartyName: 'PT XYZ',
      counterpartyAccount: '9988776655',
    },
    phase1: {
      intent: 'CUSTOMER_PAYMENT',
      confidence: 0.92,
      normalizedDescription: 'customer payment pt xyz',
      candidates: [],
      explanation: { intent: 'CUSTOMER_PAYMENT', confidence: 0.92, matches: [], reason: '' },
      requiresManualReview: false,
    } as unknown as ReviewOrchestrationInput['phase1'],
    phase2: {
      primaryIntent: 'CUSTOMER_PAYMENT',
      confidence: 0.92,
      normalizedDescription: 'customer payment pt xyz',
      alternatives: [],
      evidence: [],
      reason: ['Direction: CREDIT matches CUSTOMER_PAYMENT'],
      phase1Analysis: {} as unknown as ReviewOrchestrationInput['phase1'],
      requiresManualReview: false,
    } as ReviewOrchestrationInput['phase2'],
    phase3: {
      companyId: 'co1',
      primaryRecommendation: { coaId: 'coa-ar-1', coaCode: '1-120', coaName: 'Piutang Usaha', confidence: 0.90, score: 0.90 },
      alternatives: [],
      intent: 'CUSTOMER_PAYMENT',
      normalizedDescription: 'customer payment pt xyz',
      evidence: [],
      reason: [],
      conflictFlags: [],
      requiresManualReview: false,
      recommendationSource: 'HISTORICAL_PATTERN',
      phase1Analysis: {} as unknown as ReviewOrchestrationInput['phase1'],
      phase2Classification: {} as ReviewOrchestrationInput['phase2'],
    } as unknown as ReviewOrchestrationInput['phase3'],
    phase4: {
      confidence: { level: 'HIGH', score: 0.90, factors: [] },
      recommendation: { status: 'AUTO_PROCESS', label: 'Auto', reason: '' },
      evidence: [],
      confidenceBreakdown: [],
      ambiguity: [],
      accountingWarnings: [],
      auditSummary: 'High confidence customer payment',
      reviewerNotes: [],
      explainabilityVersion: '1.0',
    } as unknown as ReviewOrchestrationInput['phase4'],
    phase7: {
      companyId: 'co1',
      isAnomaly: false,
      anomalyScore: 0.03,
      riskLevel: 'NONE',
      anomalyTypes: [],
      detections: [],
      explanation: [],
      recommendation: 'NO_ACTION',
      requiresManualReview: false,
      baselineQuality: 'GOOD',
      confidence: 0.90,
      conflictFlags: [],
      evaluatedAt: '2026-07-01T10:00:00Z',
      anomalyVersion: '1.0',
    } as unknown as ReviewOrchestrationInput['phase7'],
  };
}

// ─── Scenario A: Clean customer payment ───────────────────────────────────────

describe('T103–T105: Scenario A — Clean Customer Payment', () => {
  test('T103 clean customer payment routes to AUTO_CLEAR_CANDIDATE', async () => {
    const result = await createAIReviewCase(makeBase(), { now: () => FIXED_NOW });
    expect(result.queue).toBe('AUTO_CLEAR_CANDIDATE');
  });

  test('T104 clean case priority is LOW or NORMAL', async () => {
    const result = await createAIReviewCase(makeBase(), { now: () => FIXED_NOW });
    expect(['LOW', 'NORMAL']).toContain(result.priority);
  });

  test('T105 requiresHumanDecision is still true for auto-clear candidate', async () => {
    const result = await createAIReviewCase(makeBase(), { now: () => FIXED_NOW });
    expect(result.requiresHumanDecision).toBe(true);
    expect(result.status).toBe('QUEUED'); // not auto-approved
  });
});

// ─── Scenario B: AR/Revenue ambiguity ────────────────────────────────────────

describe('T106–T107: Scenario B — AR/Revenue Ambiguity', () => {
  test('T106 AR ambiguity routes to ACCOUNTING_REVIEW', async () => {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      phase4: {
        ...makeBase().phase4,
        ambiguity: [{ type: 'AR_VS_REVENUE', description: 'AR vs Revenue', reviewAction: '' }],
      } as unknown as ReviewOrchestrationInput['phase4'],
    };
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(result.queue).toBe('ACCOUNTING_REVIEW');
  });

  test('T107 ambiguity flag is visible in case flags', async () => {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      phase4: {
        ...makeBase().phase4,
        ambiguity: [{ type: 'AR_VS_REVENUE', description: 'AR vs Revenue', reviewAction: '' }],
      } as unknown as ReviewOrchestrationInput['phase4'],
    };
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(result.flags).toContain('AR_VS_REVENUE');
  });
});

// ─── Scenario C: Vendor payment with COA change ───────────────────────────────

describe('T108–T110: Scenario C — Vendor Payment COA Change', () => {
  function makeVendorPaymentCase(): AIReviewCase {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      transaction: {
        ...makeBase().transaction,
        id: 'tx-vendor-1',
        description: 'Vendor payment PT ABC',
        direction: 'DEBIT',
      },
      phase2: {
        ...makeBase().phase2,
        primaryIntent: 'VENDOR_PAYMENT',
      } as ReviewOrchestrationInput['phase2'],
      phase3: {
        ...makeBase().phase3,
        intent: 'VENDOR_PAYMENT',
        primaryRecommendation: { coaId: 'coa-ap-1', coaCode: '2-100', coaName: 'Hutang Usaha', confidence: 0.82, score: 0.82 },
      } as unknown as ReviewOrchestrationInput['phase3'],
    };
    const base = buildReviewCase(input, FIXED_NOW);
    return { ...base, status: 'IN_REVIEW' };
  }

  test('T108 vendor payment decision = CHANGE_COA creates correct record', async () => {
    const rc = makeVendorPaymentCase();
    const dec = await recordReviewerDecisionPublic({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'reviewer1',
      decision: 'CHANGE_COA',
      selectedCoa: { coaId: 'coa-accrual-1', coaCode: '2-150', coaName: 'Hutang Akrual' },
      idempotencyKey: 'idem-c1',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.decision).toBe('CHANGE_COA');
    expect(dec.selectedCoa?.coaCode).toBe('2-150');
  });

  test('T109 phase5 feedback payload is phase5Compatible', async () => {
    const rc = makeVendorPaymentCase();
    const dec = await recordReviewerDecisionPublic({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'reviewer1',
      decision: 'CHANGE_COA',
      selectedCoa: { coaId: 'coa-accrual-1', coaCode: '2-150', coaName: 'Hutang Akrual' },
      idempotencyKey: 'idem-c2',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.feedbackPayload?.phase5Compatible).toBe(true);
    expect(dec.feedbackPayload?.agreement).toBe(false);
  });

  test('T110 no journal posting in decision record', async () => {
    const rc = makeVendorPaymentCase();
    const dec = await recordReviewerDecisionPublic({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'reviewer1',
      decision: 'CHANGE_COA',
      selectedCoa: { coaId: 'coa-accrual-1', coaCode: '2-150', coaName: 'Hutang Akrual' },
      idempotencyKey: 'idem-c3',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect((dec as unknown as Record<string, unknown>).journalEntry).toBeUndefined();
    expect((dec as unknown as Record<string, unknown>).postedJournal).toBeUndefined();
  });
});

// ─── Scenario D: High-risk split transaction ──────────────────────────────────

describe('T111–T112: Scenario D — High-Risk Split Transaction', () => {
  test('T111 split transaction routes to HIGH_RISK or ANOMALY_REVIEW', async () => {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      phase7: {
        ...makeBase().phase7,
        isAnomaly: true,
        anomalyScore: 0.75,
        riskLevel: 'HIGH',
        anomalyTypes: ['SPLIT_TRANSACTION'],
        requiresManualReview: true,
      } as unknown as ReviewOrchestrationInput['phase7'],
    };
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(['HIGH_RISK_REVIEW', 'ANOMALY_REVIEW']).toContain(result.queue);
  });

  test('T112 split transaction anomaly evidence preserved in snapshot', async () => {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      phase7: {
        ...makeBase().phase7,
        isAnomaly: true,
        anomalyScore: 0.75,
        riskLevel: 'HIGH',
        anomalyTypes: ['SPLIT_TRANSACTION'],
        requiresManualReview: true,
      } as unknown as ReviewOrchestrationInput['phase7'],
    };
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(result.aiSnapshot.anomalyTypes).toContain('SPLIT_TRANSACTION');
    // No automatic hold
    expect((result as unknown as Record<string, unknown>).held).toBeUndefined();
    expect((result as unknown as Record<string, unknown>).autoHold).toBeUndefined();
  });
});

// ─── Scenario E: Tax payment ──────────────────────────────────────────────────

describe('T113: Scenario E — Tax Payment', () => {
  test('T113 tax payment routes to TAX_REVIEW', async () => {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      transaction: { ...makeBase().transaction, id: 'tx-tax-1', description: 'PPH 21 payment' },
      phase2: { ...makeBase().phase2, primaryIntent: 'TAX_PAYMENT', confidence: 0.78 } as ReviewOrchestrationInput['phase2'],
      phase3: { ...makeBase().phase3, intent: 'TAX_PAYMENT', requiresManualReview: true } as unknown as ReviewOrchestrationInput['phase3'],
    };
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(['TAX_REVIEW', 'HIGH_RISK_REVIEW']).toContain(result.queue);
  });
});

// ─── Scenario F: Internal transfer ────────────────────────────────────────────

describe('T114: Scenario F — Internal Transfer', () => {
  test('T114 internal transfer routes to TREASURY_REVIEW', async () => {
    const input: ReviewOrchestrationInput = {
      ...makeBase(),
      phase2: { ...makeBase().phase2, primaryIntent: 'INTERNAL_TRANSFER', confidence: 0.88 } as ReviewOrchestrationInput['phase2'],
      phase3: { ...makeBase().phase3, intent: 'INTERNAL_TRANSFER' } as unknown as ReviewOrchestrationInput['phase3'],
    };
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(result.queue).toBe('TREASURY_REVIEW');
  });
});

// ─── Audit timeline ───────────────────────────────────────────────────────────

describe('T115–T120: Audit Timeline & Observability', () => {
  test('T115 case creation produces audit event', () => {
    const rc = buildReviewCase(makeBase(), FIXED_NOW);
    const timeline = buildReviewAuditTimelinePublic(rc, { now: () => FIXED_NOW });
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.some(e => e.eventType === 'CASE_CREATED')).toBe(true);
  });

  test('T116 QUEUED event is in timeline', () => {
    const rc = buildReviewCase(makeBase(), FIXED_NOW);
    const timeline = buildReviewAuditTimelinePublic(rc, { now: () => FIXED_NOW });
    expect(timeline.some(e => e.eventType === 'QUEUED')).toBe(true);
  });

  test('T117 decision event appears in timeline', () => {
    const rc = buildReviewCase(makeBase(), FIXED_NOW);
    const rcInReview: AIReviewCase = { ...rc, status: 'IN_REVIEW' };
    const dec = recordReviewerDecision({
      reviewCaseId: rcInReview.id,
      companyId: rcInReview.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-tl-1',
      decidedAt: FIXED_NOW.toISOString(),
    }, rcInReview);
    const rcWithDec: AIReviewCase = { ...rcInReview, decision: dec, status: dec.newStatus };
    const timeline = buildReviewAuditTimelinePublic(rcWithDec, { now: () => FIXED_NOW });
    expect(timeline.some(e => e.eventType === 'RECOMMENDATION_APPROVED')).toBe(true);
  });

  test('T118 audit events have no sensitive data', () => {
    const rc = buildReviewCase(makeBase(), FIXED_NOW);
    const timeline = buildReviewAuditTimelinePublic(rc, { now: () => FIXED_NOW });
    const jsonStr = JSON.stringify(timeline);
    expect(jsonStr).not.toMatch(/password/i);
    expect(jsonStr).not.toMatch(/privateKey/i);
    expect(jsonStr).not.toMatch(/bearer/i);
    // Account is masked — raw account number shouldn't appear
    expect(jsonStr).not.toContain('9988776655');
  });

  test('T119 full Phase 1–8 orchestration produces valid review case', async () => {
    const result = await createAIReviewCase(makeBase(), { now: () => FIXED_NOW });
    expect(result.id).toBeTruthy();
    expect(result.companyId).toBe('co1');
    expect(result.status).toBe('QUEUED');
    expect(result.requiresHumanDecision).toBe(true);
    expect(result.orchestrationVersion).toBe('1.0');
    expect(result.aiSnapshot.snapshotVersion).toBe('1.0');
    expect(result.aiSnapshot.snapshotChecksum).toBeTruthy();
    expect(result.sla.createdAt).toBeTruthy();
    expect(result.transactionSnapshot.maskedCounterpartyAccount).toMatch(/\*+\d{4}/);
  });

  test('T120 observability across multiple scenarios', async () => {
    const clean = await createAIReviewCase(makeBase(), { now: () => FIXED_NOW });
    const highRisk = await createAIReviewCase({
      ...makeBase(),
      transaction: { ...makeBase().transaction, id: 'tx-highrisk' },
      phase7: { ...makeBase().phase7, anomalyScore: 0.90, riskLevel: 'CRITICAL', isAnomaly: true, requiresManualReview: true } as unknown as ReviewOrchestrationInput['phase7'],
    }, { now: () => FIXED_NOW });

    const obs = calculateReviewObservabilityPublic([clean, highRisk]);
    expect(obs.totalCases).toBe(2);
    expect(obs.averageAnomalyScore).toBeGreaterThan(0);
    expect(Object.keys(obs.byQueue).length).toBeGreaterThan(0);
  });
});

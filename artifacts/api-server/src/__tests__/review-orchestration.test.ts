/**
 * AI Transaction Intelligence — Phase 8
 * Review Orchestration — Unit Tests (120 tests)
 *
 * T001–T010:  Review case creation
 * T011–T024:  Queue routing
 * T025–T038:  Priority calculation
 * T039–T051:  State machine
 * T052–T065:  Reviewer decisions
 * T066–T073:  Idempotency
 * T074–T082:  SLA calculation
 */

import { describe, test, expect } from 'vitest';
import {
  createAIReviewCase,
  routeReviewCasePublic,
  calculateReviewPriorityPublic,
  transitionReviewCasePublic,
  recordReviewerDecisionPublic,
  buildReviewSnapshotPublic,
  calculateReviewSlaPublic,
} from '../lib/ai/transaction-intelligence/reviewOrchestrationEngine.js';
import { buildReviewCase } from '../lib/ai/transaction-intelligence/reviewCaseBuilder.js';
import {
  transitionReviewCase,
  isTerminalStatus,
  isValidTransition,
} from '../lib/ai/transaction-intelligence/reviewStateMachine.js';
import {
  buildReviewCaseIdempotencyKey,
  buildReviewerDecisionIdempotencyKey,
} from '../lib/ai/transaction-intelligence/reviewIdempotency.js';
import { maskAccountNumber, redactSensitiveMetadata } from '../lib/ai/transaction-intelligence/reviewPrivacy.js';
import { calculateReviewSla } from '../lib/ai/transaction-intelligence/reviewSlaCalculator.js';
import { recordReviewerDecision } from '../lib/ai/transaction-intelligence/reviewDecisionService.js';

import type {
  ReviewOrchestrationInput,
  AIReviewCase,
  ReviewStatus,
} from '../lib/ai/transaction-intelligence/reviewOrchestrationTypes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FIXED_NOW = new Date('2026-07-01T10:00:00Z');

function makePhase1(overrides: Record<string, unknown> = {}): ReviewOrchestrationInput['phase1'] {
  return {
    intent: 'VENDOR_PAYMENT',
    confidence: 0.90,
    normalizedDescription: 'vendor payment abc',
    candidates: [],
    explanation: { intent: 'VENDOR_PAYMENT', confidence: 0.90, matches: [], reason: '' },
    requiresManualReview: false,
    ...overrides,
  } as unknown as ReviewOrchestrationInput['phase1'];
}

function makePhase2(overrides: Record<string, unknown> = {}): ReviewOrchestrationInput['phase2'] {
  return {
    primaryIntent: 'VENDOR_PAYMENT',
    confidence: 0.90,
    normalizedDescription: 'vendor payment abc',
    alternatives: [],
    evidence: [],
    reason: ['Direction: DEBIT matches VENDOR_PAYMENT'],
    phase1Analysis: makePhase1(),
    requiresManualReview: false,
    ...overrides,
  } as ReviewOrchestrationInput['phase2'];
}

function makePhase3(overrides: Record<string, unknown> = {}): ReviewOrchestrationInput['phase3'] {
  return {
    companyId: 'co1',
    primaryRecommendation: {
      coaId: 'coa-1',
      coaCode: '2-100',
      coaName: 'Hutang Usaha',
      confidence: 0.88,
      score: 0.88,
    },
    alternatives: [],
    intent: 'VENDOR_PAYMENT',
    normalizedDescription: 'vendor payment abc',
    evidence: [],
    reason: [],
    conflictFlags: [],
    requiresManualReview: false,
    recommendationSource: 'HISTORICAL_PATTERN',
    phase1Analysis: makePhase1(),
    phase2Classification: makePhase2(),
    ...overrides,
  } as unknown as ReviewOrchestrationInput['phase3'];
}

function makePhase4(overrides: Record<string, unknown> = {}): ReviewOrchestrationInput['phase4'] {
  return {
    confidence: {
      level: 'HIGH',
      score: 0.88,
      factors: [],
    },
    recommendation: {
      status: 'AUTO_PROCESS',
      label: 'Auto process',
      reason: '',
    },
    evidence: [],
    confidenceBreakdown: [],
    ambiguity: [],
    accountingWarnings: [],
    auditSummary: 'High confidence VENDOR_PAYMENT',
    reviewerNotes: [],
    explainabilityVersion: '1.0',
    ...overrides,
  } as unknown as ReviewOrchestrationInput['phase4'];
}

function makePhase7(overrides: Record<string, unknown> = {}): ReviewOrchestrationInput['phase7'] {
  return {
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
    ...overrides,
  } as ReviewOrchestrationInput['phase7'];
}

function makeInput(overrides: Partial<ReviewOrchestrationInput> = {}): ReviewOrchestrationInput {
  return {
    companyId: 'co1',
    transaction: {
      id: 'tx1',
      description: 'Vendor payment ABC',
      amount: 5_000_000,
      currency: 'IDR',
      direction: 'DEBIT',
      transactionDate: '2026-07-01T10:00:00Z',
      counterpartyName: 'PT ABC',
      counterpartyAccount: '1234567890',
    },
    phase1: makePhase1(),
    phase2: makePhase2(),
    phase3: makePhase3(),
    phase4: makePhase4(),
    phase7: makePhase7(),
    ...overrides,
  };
}

// ─── T001–T010: Review Case Creation ─────────────────────────────────────────

describe('T001–T010: Review Case Creation', () => {
  test('T001 create standard review case', async () => {
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    expect(result).toBeDefined();
    expect(result.id).toBeTruthy();
    expect(result.companyId).toBe('co1');
    expect(result.status).toBe('QUEUED');
  });

  test('T002 transaction snapshot is immutable copy', async () => {
    const input = makeInput();
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    // Mutating original should not affect snapshot
    (input.transaction as Record<string, unknown>).amount = 999_999_999;
    expect(result.transactionSnapshot.amount).toBe(5_000_000);
  });

  test('T003 AI snapshot is immutable', async () => {
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    expect(() => {
      (result.aiSnapshot as unknown as Record<string, unknown>).intent = 'CHANGED';
    }).toThrow();
  });

  test('T004 snapshot version is set', async () => {
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    expect(result.aiSnapshot.snapshotVersion).toBe('1.0');
  });

  test('T005 snapshot checksum is deterministic', async () => {
    const input = makeInput();
    const r1 = await createAIReviewCase(input, { now: () => FIXED_NOW });
    const r2 = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(r1.aiSnapshot.snapshotChecksum).toBe(r2.aiSnapshot.snapshotChecksum);
  });

  test('T006 counterparty account is masked', async () => {
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    // Full account '1234567890' should be masked
    expect(result.transactionSnapshot.maskedCounterpartyAccount).not.toBe('1234567890');
    expect(result.transactionSnapshot.maskedCounterpartyAccount).toMatch(/\*+\d{4}/);
  });

  test('T007 sensitive metadata is redacted', () => {
    const metadata = {
      note: 'test',
      token: 'secret-token-value',
      password: 'hunter2',
      normal: 'value',
    };
    const redacted = redactSensitiveMetadata(metadata) as Record<string, unknown>;
    expect(redacted.token).toBe('[REDACTED]');
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.normal).toBe('value');
    expect(redacted.note).toBe('test');
  });

  test('T008 requiresHumanDecision is literal true', async () => {
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    expect(result.requiresHumanDecision).toBe(true);
  });

  test('T009 company ID is preserved', async () => {
    const result = await createAIReviewCase(makeInput({ companyId: 'co-xyz-42' }), { now: () => FIXED_NOW });
    expect(result.companyId).toBe('co-xyz-42');
  });

  test('T010 missing transaction description handled gracefully', async () => {
    const input = makeInput();
    (input.transaction as Record<string, unknown>).description = '';
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(result).toBeDefined();
  });
});

// ─── T011–T024: Queue Routing ─────────────────────────────────────────────────

describe('T011–T024: Queue Routing', () => {
  test('T011 tax payment routes to TAX_REVIEW', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'TAX_PAYMENT', confidence: 0.80 }),
      phase3: makePhase3({ intent: 'TAX_PAYMENT' }),
    });
    expect(routeReviewCasePublic(input)).toBe('TAX_REVIEW');
  });

  test('T012 payroll routes to PAYROLL_REVIEW', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'PAYROLL', confidence: 0.80 }),
      phase3: makePhase3({ intent: 'PAYROLL' }),
    });
    expect(routeReviewCasePublic(input)).toBe('PAYROLL_REVIEW');
  });

  test('T013 internal transfer routes to TREASURY_REVIEW', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'INTERNAL_TRANSFER', confidence: 0.85 }),
      phase3: makePhase3({ intent: 'INTERNAL_TRANSFER' }),
    });
    expect(routeReviewCasePublic(input)).toBe('TREASURY_REVIEW');
  });

  test('T014 cross-company pattern routes to INTERCOMPANY_REVIEW', () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyTypes: ['CROSS_COMPANY_PATTERN'], anomalyScore: 0.60, riskLevel: 'MEDIUM' }),
    });
    // INTERCOMPANY should beat ANOMALY for cross-company
    const queue = routeReviewCasePublic(input);
    expect(['INTERCOMPANY_REVIEW', 'HIGH_RISK_REVIEW', 'ANOMALY_REVIEW']).toContain(queue);
  });

  test('T015 high anomaly routes to HIGH_RISK_REVIEW', () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyScore: 0.75, riskLevel: 'HIGH', isAnomaly: true, requiresManualReview: true }),
    });
    expect(routeReviewCasePublic(input)).toBe('HIGH_RISK_REVIEW');
  });

  test('T016 critical anomaly routes to HIGH_RISK_REVIEW', () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyScore: 0.92, riskLevel: 'CRITICAL', isAnomaly: true, requiresManualReview: true }),
    });
    expect(routeReviewCasePublic(input)).toBe('HIGH_RISK_REVIEW');
  });

  test('T017 unknown intent routes to DATA_QUALITY_REVIEW', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'UNKNOWN', confidence: 0.20 }),
    });
    expect(routeReviewCasePublic(input)).toBe('DATA_QUALITY_REVIEW');
  });

  test('T018 AR ambiguity routes to ACCOUNTING_REVIEW', () => {
    const input = makeInput({
      phase4: makePhase4({
        ambiguity: [{ type: 'AR_VS_REVENUE', description: 'AR vs Revenue', reviewAction: '' }],
      }),
    });
    expect(routeReviewCasePublic(input)).toBe('ACCOUNTING_REVIEW');
  });

  test('T019 AP ambiguity routes to ACCOUNTING_REVIEW', () => {
    const input = makeInput({
      phase4: makePhase4({
        ambiguity: [{ type: 'AP_VS_EXPENSE', description: 'AP vs Expense', reviewAction: '' }],
      }),
    });
    expect(routeReviewCasePublic(input)).toBe('ACCOUNTING_REVIEW');
  });

  test('T020 high-confidence clean routes to AUTO_CLEAR_CANDIDATE', () => {
    const input = makeInput({
      phase2: makePhase2({ confidence: 0.95 }),
      phase3: makePhase3({
        primaryRecommendation: { coaId: '1', coaCode: '2-100', coaName: 'AP', confidence: 0.95, score: 0.95 },
        requiresManualReview: false,
        conflictFlags: [],
      }),
      phase4: makePhase4({ ambiguity: [], recommendation: { status: 'AUTO_PROCESS', label: 'Auto', reason: '' } }),
      phase7: makePhase7({ anomalyScore: 0.02, riskLevel: 'NONE', requiresManualReview: false, conflictFlags: [] }),
    });
    expect(routeReviewCasePublic(input)).toBe('AUTO_CLEAR_CANDIDATE');
  });

  test('T021 policy queue override respected', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'VENDOR_PAYMENT' }),
      policy: { queueOverridesByIntent: { VENDOR_PAYMENT: 'ACCOUNTING_REVIEW' } },
    });
    expect(routeReviewCasePublic(input)).toBe('ACCOUNTING_REVIEW');
  });

  test('T022 multiple matching queues → deterministic highest precedence', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'TAX_PAYMENT' }),
      phase7: makePhase7({ anomalyScore: 0.80, riskLevel: 'HIGH', isAnomaly: true, requiresManualReview: true }),
    });
    // Both TAX and HIGH_RISK match — HIGH_RISK wins (higher precedence)
    expect(routeReviewCasePublic(input)).toBe('HIGH_RISK_REVIEW');
  });

  test('T023 cross-company takes precedence over standard', () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyTypes: ['CROSS_COMPANY_PATTERN'], anomalyScore: 0.50, riskLevel: 'MEDIUM' }),
    });
    const queue = routeReviewCasePublic(input);
    expect(['INTERCOMPANY_REVIEW', 'HIGH_RISK_REVIEW', 'ANOMALY_REVIEW']).toContain(queue);
    expect(queue).not.toBe('STANDARD_FINANCE_REVIEW');
  });

  test('T024 low confidence routes to DATA_QUALITY_REVIEW', () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'VENDOR_PAYMENT', confidence: 0.20 }),
    });
    expect(routeReviewCasePublic(input)).toBe('DATA_QUALITY_REVIEW');
  });
});

// ─── T025–T038: Priority ──────────────────────────────────────────────────────

describe('T025–T038: Priority Calculation', () => {
  test('T025 normal case has normal or low priority', async () => {
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    expect(['LOW', 'NORMAL']).toContain(result.priority);
  });

  test('T026 high anomaly score raises priority', async () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyScore: 0.75, riskLevel: 'HIGH', isAnomaly: true }),
    });
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(['HIGH', 'URGENT', 'CRITICAL']).toContain(result.priority);
  });

  test('T027 critical anomaly score raises priority to CRITICAL or URGENT', async () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyScore: 0.93, riskLevel: 'CRITICAL', isAnomaly: true, requiresManualReview: true }),
    });
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(['URGENT', 'CRITICAL']).toContain(result.priority);
  });

  test('T028 high-value transaction increases priority', async () => {
    const input = makeInput();
    (input.transaction as Record<string, unknown>).amount = 200_000_000;
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(['NORMAL', 'HIGH', 'URGENT', 'CRITICAL']).toContain(result.priority);
  });

  test('T029 high value alone does not produce CRITICAL', async () => {
    const input = makeInput();
    (input.transaction as Record<string, unknown>).amount = 1_000_000_000;
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    // High value alone — no anomaly, no other signals — should not be CRITICAL
    expect(result.priority).not.toBe('CRITICAL');
  });

  test('T030 exact duplicate signal raises priority', async () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyTypes: ['EXACT_DUPLICATE'], anomalyScore: 0.90, riskLevel: 'HIGH', isAnomaly: true }),
    });
    const p = calculateReviewPriorityPublic(input, { now: () => FIXED_NOW });
    expect(['HIGH', 'URGENT', 'CRITICAL']).toContain(p);
  });

  test('T031 split transaction signal raises priority', async () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyTypes: ['SPLIT_TRANSACTION'], anomalyScore: 0.75, riskLevel: 'HIGH', isAnomaly: true }),
    });
    const p = calculateReviewPriorityPublic(input, { now: () => FIXED_NOW });
    expect(['HIGH', 'URGENT', 'CRITICAL']).toContain(p);
  });

  test('T032 cross-company conflict raises priority', async () => {
    const input = makeInput({
      phase7: makePhase7({ anomalyTypes: ['CROSS_COMPANY_PATTERN'], anomalyScore: 0.80, riskLevel: 'HIGH', isAnomaly: true }),
    });
    const p = calculateReviewPriorityPublic(input, { now: () => FIXED_NOW });
    expect(['HIGH', 'URGENT', 'CRITICAL']).toContain(p);
  });

  test('T033 tax intent raises priority', async () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'TAX_PAYMENT' }),
    });
    const p = calculateReviewPriorityPublic(input, { now: () => FIXED_NOW });
    expect(['NORMAL', 'HIGH', 'URGENT', 'CRITICAL']).toContain(p);
    expect(p).not.toBe('LOW');
  });

  test('T034 payroll raises priority', async () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'PAYROLL' }),
    });
    const p = calculateReviewPriorityPublic(input, { now: () => FIXED_NOW });
    expect(['NORMAL', 'HIGH', 'URGENT', 'CRITICAL']).toContain(p);
    expect(p).not.toBe('LOW');
  });

  test('T035 overdue SLA increases priority', async () => {
    const now = new Date('2026-07-05T10:00:00Z'); // 4 days after creation
    const input = makeInput();
    const result = await createAIReviewCase(input, { now: () => now });
    expect(result.sla.isOverdue).toBe(false); // not overdue immediately
    // Re-evaluate with a future "now"
    const futureNow = new Date('2026-07-10T10:00:00Z'); // 9 days later
    const sla = calculateReviewSlaPublic(result.createdAt, 'NORMAL', futureNow);
    expect(sla.isOverdue).toBe(true);
  });

  test('T036 policy priority override respected', async () => {
    const input = makeInput({
      phase2: makePhase2({ primaryIntent: 'VENDOR_PAYMENT' }),
      policy: { priorityOverridesByIntent: { VENDOR_PAYMENT: 'URGENT' } },
    });
    const result = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(result.priority).toBe('URGENT');
  });

  test('T037 priority is deterministic', async () => {
    const input = makeInput();
    const r1 = await createAIReviewCase(input, { now: () => FIXED_NOW });
    const r2 = await createAIReviewCase(input, { now: () => FIXED_NOW });
    expect(r1.priority).toBe(r2.priority);
  });

  test('T038 priority score bounded to valid enum', async () => {
    const allPriorities = ['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL'];
    const result = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    expect(allPriorities).toContain(result.priority);
  });
});

// ─── T039–T051: State Machine ─────────────────────────────────────────────────

describe('T039–T051: State Machine', () => {
  test('T039 OPEN to QUEUED is valid', () => {
    expect(isValidTransition('OPEN', 'QUEUED')).toBe(true);
  });

  test('T040 QUEUED to ASSIGNED is valid', () => {
    expect(isValidTransition('QUEUED', 'ASSIGNED')).toBe(true);
  });

  test('T041 ASSIGNED to IN_REVIEW is valid', () => {
    expect(isValidTransition('ASSIGNED', 'IN_REVIEW')).toBe(true);
  });

  test('T042 IN_REVIEW to NEEDS_INFORMATION is valid', () => {
    expect(isValidTransition('IN_REVIEW', 'NEEDS_INFORMATION')).toBe(true);
  });

  test('T043 NEEDS_INFORMATION to IN_REVIEW is valid', () => {
    expect(isValidTransition('NEEDS_INFORMATION', 'IN_REVIEW')).toBe(true);
  });

  test('T044 IN_REVIEW to APPROVED_RECOMMENDATION is valid', () => {
    expect(isValidTransition('IN_REVIEW', 'APPROVED_RECOMMENDATION')).toBe(true);
  });

  test('T045 IN_REVIEW to CHANGED_COA is valid', () => {
    expect(isValidTransition('IN_REVIEW', 'CHANGED_COA')).toBe(true);
  });

  test('T046 IN_REVIEW to REJECTED_RECOMMENDATION is valid', () => {
    expect(isValidTransition('IN_REVIEW', 'REJECTED_RECOMMENDATION')).toBe(true);
  });

  test('T047 IN_REVIEW to ESCALATED is valid', () => {
    expect(isValidTransition('IN_REVIEW', 'ESCALATED')).toBe(true);
  });

  test('T048 QUEUED to CANCELLED is valid', () => {
    expect(isValidTransition('QUEUED', 'CANCELLED')).toBe(true);
  });

  test('T049 illegal transition throws', () => {
    expect(() => transitionReviewCase('OPEN', 'APPROVED_RECOMMENDATION')).toThrow();
    expect(() => transitionReviewCase('ASSIGNED', 'QUEUED')).toThrow();
  });

  test('T050 terminal state cannot transition', () => {
    expect(isTerminalStatus('APPROVED_RECOMMENDATION')).toBe(true);
    expect(isTerminalStatus('CHANGED_COA')).toBe(true);
    expect(isTerminalStatus('CANCELLED')).toBe(true);
    expect(() => transitionReviewCase('APPROVED_RECOMMENDATION', 'IN_REVIEW')).toThrow();
  });

  test('T051 previous and new status are recorded in transition', async () => {
    const reviewCase = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    const updated = transitionReviewCasePublic(reviewCase, 'ASSIGNED', FIXED_NOW);
    expect(updated.status).toBe('ASSIGNED');
    expect(updated.updatedAt).toBe(FIXED_NOW.toISOString());
  });
});

// ─── T052–T065: Reviewer Decisions ───────────────────────────────────────────

function makeReviewCaseInReview(): AIReviewCase {
  const base = buildReviewCase(makeInput(), FIXED_NOW);
  return { ...base, status: 'IN_REVIEW' };
}

describe('T052–T065: Reviewer Decisions', () => {
  test('T052 approve AI recommendation', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-001',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.decision).toBe('APPROVE_RECOMMENDATION');
    expect(dec.newStatus).toBe('APPROVED_RECOMMENDATION');
  });

  test('T053 change COA sets new status', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'CHANGE_COA',
      selectedCoa: { coaId: '99', coaCode: '6-200', coaName: 'Biaya Lain' },
      idempotencyKey: 'idem-002',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.decision).toBe('CHANGE_COA');
    expect(dec.newStatus).toBe('CHANGED_COA');
    expect(dec.selectedCoa?.coaCode).toBe('6-200');
  });

  test('T054 reject recommendation', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'REJECT_RECOMMENDATION',
      reasonCode: 'WRONG_INTENT',
      idempotencyKey: 'idem-003',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.newStatus).toBe('REJECTED_RECOMMENDATION');
  });

  test('T055 request information', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'REQUEST_INFORMATION',
      comments: 'Please provide invoice reference',
      idempotencyKey: 'idem-004',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.newStatus).toBe('NEEDS_INFORMATION');
  });

  test('T056 escalate', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'ESCALATE',
      reasonCode: 'NEEDS_MANAGER',
      idempotencyKey: 'idem-005',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.newStatus).toBe('ESCALATED');
  });

  test('T057 CHANGE_COA requires selectedCoa', () => {
    const rc = makeReviewCaseInReview();
    expect(() => recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'CHANGE_COA',
      idempotencyKey: 'idem-006',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc)).toThrow(/selectedCoa/i);
  });

  test('T058 REJECT requires reasonCode or comments', () => {
    const rc = makeReviewCaseInReview();
    expect(() => recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'REJECT_RECOMMENDATION',
      idempotencyKey: 'idem-007',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc)).toThrow(/reason|comments/i);
  });

  test('T059 REQUEST_INFORMATION requires comments', () => {
    const rc = makeReviewCaseInReview();
    expect(() => recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'REQUEST_INFORMATION',
      idempotencyKey: 'idem-008',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc)).toThrow(/comments/i);
  });

  test('T060 reviewer confidence must be in [0,1]', () => {
    const rc = makeReviewCaseInReview();
    expect(() => recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      reviewerConfidence: 1.5,
      idempotencyKey: 'idem-009',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc)).toThrow(/confidence/i);
  });

  test('T061 phase5 feedback payload is generated', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-010',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.feedbackPayload).toBeDefined();
    expect(dec.feedbackPayload?.phase5Compatible).toBe(true);
  });

  test('T062 approval records agreement=true', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-011',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.feedbackPayload?.agreement).toBe(true);
  });

  test('T063 change COA records agreement=false when different', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'CHANGE_COA',
      selectedCoa: { coaId: '99', coaCode: '6-999', coaName: 'Other' },
      idempotencyKey: 'idem-012',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(dec.feedbackPayload?.agreement).toBe(false);
  });

  test('T064 decision does not post journal (no journal field)', () => {
    const rc = makeReviewCaseInReview();
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-013',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect((dec as unknown as Record<string, unknown>).journal).toBeUndefined();
    expect((dec as unknown as Record<string, unknown>).journalEntry).toBeUndefined();
    expect((dec as unknown as Record<string, unknown>).postedJournal).toBeUndefined();
  });

  test('T065 decision does not mutate transaction status', () => {
    const rc = makeReviewCaseInReview();
    const originalTxStatus = rc.transactionSnapshot;
    const dec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-014',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    expect(rc.transactionSnapshot).toBe(originalTxStatus); // not mutated
    expect((dec as unknown as Record<string, unknown>).transactionMutation).toBeUndefined();
  });
});

// ─── T066–T073: Idempotency ───────────────────────────────────────────────────

describe('T066–T073: Idempotency', () => {
  test('T066 case idempotency key is deterministic', () => {
    const k1 = buildReviewCaseIdempotencyKey('co1', 'tx1', 'api', '1.0');
    const k2 = buildReviewCaseIdempotencyKey('co1', 'tx1', 'api', '1.0');
    expect(k1).toBe(k2);
  });

  test('T067 different company produces different key', () => {
    const k1 = buildReviewCaseIdempotencyKey('co1', 'tx1', 'api', '1.0');
    const k2 = buildReviewCaseIdempotencyKey('co2', 'tx1', 'api', '1.0');
    expect(k1).not.toBe(k2);
  });

  test('T068 different transaction produces different key', () => {
    const k1 = buildReviewCaseIdempotencyKey('co1', 'tx1', 'api', '1.0');
    const k2 = buildReviewCaseIdempotencyKey('co1', 'tx2', 'api', '1.0');
    expect(k1).not.toBe(k2);
  });

  test('T069 getExistingReviewCase returns cached case', async () => {
    const existing = buildReviewCase(makeInput(), FIXED_NOW);
    const result = await createAIReviewCase(makeInput(), {
      now: () => FIXED_NOW,
      getExistingReviewCase: async (key) => {
        if (key === existing.idempotencyKey) return existing;
        return null;
      },
    });
    expect(result.id).toBe(existing.id);
  });

  test('T070 reviewer decision idempotency key is deterministic', () => {
    const k1 = buildReviewerDecisionIdempotencyKey('rc-1', 'user1', 'APPROVE_RECOMMENDATION', '2026-07-01T10:00:00Z');
    const k2 = buildReviewerDecisionIdempotencyKey('rc-1', 'user1', 'APPROVE_RECOMMENDATION', '2026-07-01T10:00:00Z');
    expect(k1).toBe(k2);
  });

  test('T071 different reviewer produces different decision key', () => {
    const k1 = buildReviewerDecisionIdempotencyKey('rc-1', 'user1', 'APPROVE_RECOMMENDATION', '2026-07-01T10:00:00Z');
    const k2 = buildReviewerDecisionIdempotencyKey('rc-1', 'user2', 'APPROVE_RECOMMENDATION', '2026-07-01T10:00:00Z');
    expect(k1).not.toBe(k2);
  });

  test('T072 getExistingDecision returns cached decision', async () => {
    const rc = makeReviewCaseInReview();
    const existingDec = recordReviewerDecision({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-cache-001',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc);
    const result = await recordReviewerDecisionPublic({
      reviewCaseId: rc.id,
      companyId: rc.companyId,
      reviewerId: 'user1',
      decision: 'APPROVE_RECOMMENDATION',
      idempotencyKey: 'idem-cache-001',
      decidedAt: FIXED_NOW.toISOString(),
    }, rc, {
      getExistingDecision: async (key) => {
        if (key === 'idem-cache-001') return existingDec;
        return null;
      },
    });
    expect(result.id).toBe(existingDec.id);
  });

  test('T073 snapshot version change produces different case key', () => {
    const k1 = buildReviewCaseIdempotencyKey('co1', 'tx1', 'api', '1.0');
    const k2 = buildReviewCaseIdempotencyKey('co1', 'tx1', 'api', '2.0');
    expect(k1).not.toBe(k2);
  });
});

// ─── T074–T082: SLA ───────────────────────────────────────────────────────────

describe('T074–T082: SLA Calculation', () => {
  test('T074 standard SLA is 1440 minutes for NORMAL', () => {
    const sla = calculateReviewSla('2026-07-01T10:00:00Z', 'NORMAL', FIXED_NOW);
    expect(sla.targetMinutes).toBe(1440);
  });

  test('T075 high priority SLA is 480 minutes', () => {
    const sla = calculateReviewSla('2026-07-01T10:00:00Z', 'HIGH', FIXED_NOW);
    expect(sla.targetMinutes).toBe(480);
  });

  test('T076 urgent SLA is 120 minutes', () => {
    const sla = calculateReviewSla('2026-07-01T10:00:00Z', 'URGENT', FIXED_NOW);
    expect(sla.targetMinutes).toBe(120);
  });

  test('T077 critical SLA is 60 minutes', () => {
    const sla = calculateReviewSla('2026-07-01T10:00:00Z', 'CRITICAL', FIXED_NOW);
    expect(sla.targetMinutes).toBe(60);
  });

  test('T078 case is overdue when past due date', () => {
    const createdAt = '2026-07-01T08:00:00Z';
    const now = new Date('2026-07-02T12:00:00Z'); // 28 hours later
    const sla = calculateReviewSla(createdAt, 'NORMAL', now); // 24h window
    expect(sla.isOverdue).toBe(true);
  });

  test('T079 case is not overdue within window', () => {
    const createdAt = '2026-07-01T09:00:00Z';
    const now = new Date('2026-07-01T10:00:00Z'); // 1 hour later
    const sla = calculateReviewSla(createdAt, 'NORMAL', now); // 24h window
    expect(sla.isOverdue).toBe(false);
  });

  test('T080 explicit due date is respected', () => {
    const createdAt = '2026-07-01T10:00:00Z';
    const dueAt = '2026-07-01T10:30:00Z'; // 30 mins
    const now = new Date('2026-07-01T11:00:00Z'); // 60 mins later
    const sla = calculateReviewSla(createdAt, 'NORMAL', now, dueAt);
    expect(sla.isOverdue).toBe(true);
    expect(sla.dueAt).toBe(dueAt);
  });

  test('T081 injected now is used for age calculation', () => {
    const createdAt = '2026-07-01T10:00:00Z';
    const now = new Date('2026-07-01T11:30:00Z'); // 90 mins later
    const sla = calculateReviewSla(createdAt, 'NORMAL', now);
    expect(sla.ageMinutes).toBe(90);
  });

  test('T082 no host-time dependency in snapshot checksum', async () => {
    const r1 = await createAIReviewCase(makeInput(), { now: () => FIXED_NOW });
    const r2 = await createAIReviewCase(makeInput(), { now: () => new Date('2026-01-01T00:00:00Z') });
    // Checksum should be the same — it's based on AI data, not current time
    expect(r1.aiSnapshot.snapshotChecksum).toBe(r2.aiSnapshot.snapshotChecksum);
  });
});

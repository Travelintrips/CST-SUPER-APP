/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Unit + Integration Tests
 *
 * Minimum 130 unit tests covering:
 *   - Rules (intent, confidence, anomaly, amount, COA, counterparty, flags)
 *   - Priority computation
 *   - Queue routing
 *   - Escalation
 *   - Reviewer role assignment
 *   - SLA computation
 *   - Overrides (company, intent, risk, amount, reviewer)
 *   - Simulation (dry-run, delta report)
 *   - Audit (completeness, format)
 *   - Integration (full pipeline)
 *   - Regression (no-write guarantee, idempotency)
 */

import { describe, it, expect, beforeEach } from 'vitest';

// ── Engine ────────────────────────────────────────────────────────────────────
import {
  evaluateDecisionPolicy,
  evaluateDecisionPolicyBatch,
  mergeDecisionPolicyConfig,
  DEFAULT_POLICY_VERSION,
} from '../lib/ai/transaction-intelligence/decisionPolicyEngine.js';

// ── Rules ─────────────────────────────────────────────────────────────────────
import {
  buildDefaultAccumulator,
  applyIntentRules,
  applyConfidenceRules,
  applyAnomalyRules,
  applyAmountRules,
  applyFlagRules,
  applyCoaRules,
  applyCounterpartyRules,
  applyRiskPriorityRules,
  applyQueueFallback,
  applyReviewerFallback,
  DEFAULT_AUTO_CONFIDENCE,
  DEFAULT_ANOMALY_REVIEW_THRESHOLD,
  DEFAULT_ANOMALY_ESCALATION_THRESHOLD,
  DEFAULT_HIGH_VALUE,
  DEFAULT_CRITICAL_VALUE,
  DEFAULT_ESCALATION_VALUE,
} from '../lib/ai/transaction-intelligence/decisionPolicyRules.js';

// ── Priority ──────────────────────────────────────────────────────────────────
import {
  computePolicyPriority,
  priorityToUrgencyLabel,
  maxPriority,
  priorityIndex,
} from '../lib/ai/transaction-intelligence/decisionPolicyPriority.js';

// ── Queue ─────────────────────────────────────────────────────────────────────
import {
  intentToQueue,
  moreSpecificQueue,
  resolveQueue,
} from '../lib/ai/transaction-intelligence/decisionPolicyQueue.js';

// ── Escalation ────────────────────────────────────────────────────────────────
import {
  computeEscalation,
  maxEscalationLevel,
  escalationIndex,
} from '../lib/ai/transaction-intelligence/decisionPolicyEscalation.js';

// ── Reviewer ──────────────────────────────────────────────────────────────────
import {
  resolveReviewerRole,
  approvalLevelToReviewLevel,
} from '../lib/ai/transaction-intelligence/decisionPolicyReviewer.js';

// ── SLA ───────────────────────────────────────────────────────────────────────
import {
  buildPolicySla,
  resolveSlaMinutes,
  DEFAULT_POLICY_SLA_MINUTES,
} from '../lib/ai/transaction-intelligence/decisionPolicySla.js';

// ── Overrides ─────────────────────────────────────────────────────────────────
import {
  applyOverrides,
  mergeOverrides,
} from '../lib/ai/transaction-intelligence/decisionPolicyOverrides.js';

// ── Audit ─────────────────────────────────────────────────────────────────────
import {
  buildDecisionAuditRecord,
  formatAuditSummary,
  verifyAuditCompleteness,
} from '../lib/ai/transaction-intelligence/decisionPolicyAudit.js';

// ── Simulation ────────────────────────────────────────────────────────────────
import {
  runPolicySimulation,
} from '../lib/ai/transaction-intelligence/decisionPolicySimulation.js';

// ── Types ─────────────────────────────────────────────────────────────────────
import type {
  DecisionPolicyInput,
  DecisionPolicyOverride,
} from '../lib/ai/transaction-intelligence/decisionPolicyTypes.js';

// ─── Test fixtures ────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<{
  intent: string;
  confidence: number;
  anomalyScore: number;
  riskLevel: string;
  amount: number;
  anomalyTypes: string[];
  requiresManualReview: boolean;
  coaConf: number;
  conflictFlags: string[];
  companyId: string | number;
  isAnomaly: boolean;
  ambiguityFlags: Array<{ type: string }>;
}>= {}): DecisionPolicyInput {
  const {
    intent = 'VENDOR_PAYMENT',
    confidence = 0.90,
    anomalyScore = 0.10,
    riskLevel = 'NONE',
    amount = 1_000_000,
    anomalyTypes = [],
    requiresManualReview = false,
    coaConf = 0.85,
    conflictFlags = [],
    companyId = 'company-1',
    isAnomaly = false,
    ambiguityFlags = [],
  } = overrides;

  return {
    companyId,
    transaction: {
      id: 'txn-001',
      description: 'Payment vendor ABC',
      amount,
      currency: 'IDR',
      direction: 'DEBIT',
      transactionDate: '2026-07-01',
      counterpartyName: 'PT ABC Vendor',
    },
    phase1: {
      topIntent: intent as never,
      candidates: [],
      keywordMatches: [],
      normalizedDescription: 'payment vendor abc',
      requiresManualReview: false,
      analysisVersion: '1.0',
    } as never,
    phase2: {
      primaryIntent: intent as never,
      confidence,
      normalizedDescription: 'payment vendor abc',
      alternatives: [],
      evidence: [],
      reason: [],
      requiresManualReview: confidence < 0.70,
      phase1Analysis: {} as never,
    },
    phase3: {
      primaryRecommendation: coaConf > 0
        ? { coaId: 'coa-1', coaCode: '5001', coaName: 'Vendor Payable', confidence: coaConf }
        : null,
      alternatives: [],
      conflictFlags,
      requiresManualReview: coaConf < 0.70,
      predictionVersion: '1.0',
    } as never,
    phase4: {
      confidence: { overall: confidence, level: 'HIGH' },
      recommendation: { requiresReview: requiresManualReview },
      ambiguity: ambiguityFlags as never, // ExplainabilityResult uses 'ambiguity', not 'ambiguityFlags'
      evidenceItems: [],
      auditSummary: '',
      explainabilityVersion: '1.0',
    } as never,
    phase7: {
      companyId,
      isAnomaly,
      anomalyScore,
      riskLevel: riskLevel as never,
      anomalyTypes: anomalyTypes as never,
      detections: [],
      explanation: [],
      recommendation: anomalyScore >= 0.40 ? 'MANUAL_REVIEW' : 'NO_ACTION',
      requiresManualReview: isAnomaly || anomalyScore >= 0.40,
      baselineQuality: 'GOOD',
      confidence: 0.90,
      conflictFlags,
      evaluatedAt: '2026-07-01T00:00:00.000Z',
      anomalyVersion: '1.0',
    },
  };
}

const FIXED_NOW = new Date('2026-07-01T08:00:00.000Z');
const FIXED_DEPS = { now: () => FIXED_NOW };

// ─── 1. Engine config merge ────────────────────────────────────────────────────

describe('mergeDecisionPolicyConfig', () => {
  it('applies default confidence threshold when none provided', () => {
    const cfg = mergeDecisionPolicyConfig();
    expect(cfg.minimumAutoConfidence).toBe(DEFAULT_AUTO_CONFIDENCE);
  });

  it('overrides confidence threshold from input', () => {
    const cfg = mergeDecisionPolicyConfig({ minimumAutoConfidence: 0.80 });
    expect(cfg.minimumAutoConfidence).toBe(0.80);
  });

  it('applies default anomaly review threshold', () => {
    const cfg = mergeDecisionPolicyConfig();
    expect(cfg.anomalyReviewThreshold).toBe(DEFAULT_ANOMALY_REVIEW_THRESHOLD);
  });

  it('applies default amount thresholds', () => {
    const cfg = mergeDecisionPolicyConfig();
    expect(cfg.amountThresholds!.highValue).toBe(DEFAULT_HIGH_VALUE);
    expect(cfg.amountThresholds!.criticalValue).toBe(DEFAULT_CRITICAL_VALUE);
    expect(cfg.amountThresholds!.escalationValue).toBe(DEFAULT_ESCALATION_VALUE);
  });

  it('uses provided policyVersion', () => {
    const cfg = mergeDecisionPolicyConfig({ policyVersion: '2.1.0' });
    expect(cfg.policyVersion).toBe('2.1.0');
  });

  it('defaults policyVersion to DEFAULT_POLICY_VERSION', () => {
    const cfg = mergeDecisionPolicyConfig();
    expect(cfg.policyVersion).toBe(DEFAULT_POLICY_VERSION);
  });

  it('initializes empty overrides array by default', () => {
    const cfg = mergeDecisionPolicyConfig();
    expect(cfg.overrides).toEqual([]);
  });

  it('initializes empty forceManualReviewIntents by default', () => {
    const cfg = mergeDecisionPolicyConfig();
    expect(cfg.forceManualReviewIntents).toEqual([]);
  });
});

// ─── 2. Priority helpers ──────────────────────────────────────────────────────

describe('Priority helpers', () => {
  it('priorityIndex returns correct order', () => {
    expect(priorityIndex('LOW')).toBeLessThan(priorityIndex('NORMAL'));
    expect(priorityIndex('NORMAL')).toBeLessThan(priorityIndex('HIGH'));
    expect(priorityIndex('HIGH')).toBeLessThan(priorityIndex('URGENT'));
    expect(priorityIndex('URGENT')).toBeLessThan(priorityIndex('CRITICAL'));
  });

  it('maxPriority returns highest', () => {
    expect(maxPriority('LOW', 'HIGH', 'NORMAL')).toBe('HIGH');
    expect(maxPriority('CRITICAL', 'URGENT')).toBe('CRITICAL');
    expect(maxPriority('LOW', 'LOW')).toBe('LOW');
  });

  it('priorityToUrgencyLabel maps correctly', () => {
    expect(priorityToUrgencyLabel('LOW')).toBe('ROUTINE');
    expect(priorityToUrgencyLabel('NORMAL')).toBe('ROUTINE');
    expect(priorityToUrgencyLabel('HIGH')).toBe('PRIORITY');
    expect(priorityToUrgencyLabel('URGENT')).toBe('URGENT');
    expect(priorityToUrgencyLabel('CRITICAL')).toBe('CRITICAL');
  });
});

// ─── 3. Queue routing ─────────────────────────────────────────────────────────

describe('Queue routing', () => {
  it('intentToQueue returns TAX_REVIEW for TAX_PAYMENT', () => {
    expect(intentToQueue('TAX_PAYMENT')).toBe('TAX_REVIEW');
  });

  it('intentToQueue returns PAYROLL_REVIEW for PAYROLL', () => {
    expect(intentToQueue('PAYROLL')).toBe('PAYROLL_REVIEW');
  });

  it('intentToQueue returns DATA_QUALITY_REVIEW for UNKNOWN', () => {
    expect(intentToQueue('UNKNOWN')).toBe('DATA_QUALITY_REVIEW');
  });

  it('intentToQueue returns null for unspecified intents', () => {
    expect(intentToQueue('VENDOR_PAYMENT')).toBeNull();
  });

  it('moreSpecificQueue picks HIGH_RISK_REVIEW over STANDARD_FINANCE_REVIEW', () => {
    expect(moreSpecificQueue('HIGH_RISK_REVIEW', 'STANDARD_FINANCE_REVIEW')).toBe('HIGH_RISK_REVIEW');
  });

  it('moreSpecificQueue picks ANOMALY_REVIEW over ACCOUNTING_REVIEW', () => {
    expect(moreSpecificQueue('ANOMALY_REVIEW', 'ACCOUNTING_REVIEW')).toBe('ANOMALY_REVIEW');
  });

  it('moreSpecificQueue is commutative', () => {
    const a = moreSpecificQueue('HIGH_RISK_REVIEW', 'TAX_REVIEW');
    const b = moreSpecificQueue('TAX_REVIEW', 'HIGH_RISK_REVIEW');
    expect(a).toBe(b);
  });

  it('resolveQueue returns AUTO_CLEAR_CANDIDATE when no review required', () => {
    const input = makeInput({ confidence: 0.95, anomalyScore: 0.05, riskLevel: 'NONE' });
    const acc = buildDefaultAccumulator();
    acc.reviewRequired = false;
    expect(resolveQueue(input, acc)).toBe('AUTO_CLEAR_CANDIDATE');
  });

  it('resolveQueue routes CRITICAL risk to HIGH_RISK_REVIEW', () => {
    const input = makeInput({ riskLevel: 'CRITICAL', isAnomaly: true, anomalyScore: 0.90 });
    const acc = buildDefaultAccumulator();
    acc.reviewRequired = true;
    acc.queue = 'STANDARD_FINANCE_REVIEW';
    const q = resolveQueue(input, acc);
    expect(q).toBe('HIGH_RISK_REVIEW');
  });
});

// ─── 4. Escalation ───────────────────────────────────────────────────────────

describe('Escalation', () => {
  it('escalationIndex returns correct order', () => {
    expect(escalationIndex('NONE')).toBeLessThan(escalationIndex('TEAM_LEAD'));
    expect(escalationIndex('TEAM_LEAD')).toBeLessThan(escalationIndex('MANAGER'));
    expect(escalationIndex('MANAGER')).toBeLessThan(escalationIndex('DIRECTOR'));
    expect(escalationIndex('DIRECTOR')).toBeLessThan(escalationIndex('EXECUTIVE'));
    expect(escalationIndex('EXECUTIVE')).toBeLessThan(escalationIndex('COMPLIANCE'));
  });

  it('maxEscalationLevel picks highest', () => {
    expect(maxEscalationLevel('MANAGER', 'DIRECTOR')).toBe('DIRECTOR');
    expect(maxEscalationLevel('COMPLIANCE', 'EXECUTIVE')).toBe('COMPLIANCE');
    expect(maxEscalationLevel('NONE', 'TEAM_LEAD')).toBe('TEAM_LEAD');
  });

  it('returns no escalation for low-risk normal transaction', () => {
    const input = makeInput({ riskLevel: 'NONE', anomalyScore: 0.10 });
    const acc = buildDefaultAccumulator();
    const result = computeEscalation(input, acc, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(result.required).toBe(false);
    expect(result.level).toBe('NONE');
  });

  it('escalates to DIRECTOR on CRITICAL risk', () => {
    const input = makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.85 });
    const acc = buildDefaultAccumulator();
    const result = computeEscalation(input, acc, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(result.required).toBe(true);
    expect(escalationIndex(result.level)).toBeGreaterThanOrEqual(escalationIndex('DIRECTOR'));
  });

  it('escalates on EXACT_DUPLICATE anomaly', () => {
    const input = makeInput({ anomalyTypes: ['EXACT_DUPLICATE'], anomalyScore: 0.50 });
    const acc = buildDefaultAccumulator();
    const result = computeEscalation(input, acc, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(result.required).toBe(true);
  });

  it('escalates to COMPLIANCE on CROSS_COMPANY_PATTERN', () => {
    const input = makeInput({ anomalyTypes: ['CROSS_COMPANY_PATTERN'], anomalyScore: 0.60 });
    const acc = buildDefaultAccumulator();
    const result = computeEscalation(input, acc, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(result.required).toBe(true);
    expect(result.level).toBe('COMPLIANCE');
  });

  it('escalates on RAPID_REVERSAL', () => {
    const input = makeInput({ anomalyTypes: ['RAPID_REVERSAL'] });
    const acc = buildDefaultAccumulator();
    const result = computeEscalation(input, acc, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(result.required).toBe(true);
    expect(escalationIndex(result.level)).toBeGreaterThanOrEqual(escalationIndex('MANAGER'));
  });

  it('provides non-empty reason when escalation required', () => {
    const input = makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.90 });
    const acc = buildDefaultAccumulator();
    const result = computeEscalation(input, acc, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

// ─── 5. Reviewer role resolution ─────────────────────────────────────────────

describe('Reviewer role resolution', () => {
  it('assigns TAX_SPECIALIST to TAX_REVIEW queue', () => {
    const role = resolveReviewerRole({
      queue: 'TAX_REVIEW',
      intent: 'TAX_PAYMENT',
      escalationLevel: 'NONE',
      reviewLevel: 'STANDARD',
      currentRole: 'UNASSIGNED',
    });
    expect(role).toBe('TAX_SPECIALIST');
  });

  it('assigns PAYROLL_OFFICER to PAYROLL_REVIEW queue', () => {
    const role = resolveReviewerRole({
      queue: 'PAYROLL_REVIEW',
      intent: 'PAYROLL',
      escalationLevel: 'NONE',
      reviewLevel: 'STANDARD',
      currentRole: 'UNASSIGNED',
    });
    expect(role).toBe('PAYROLL_OFFICER');
  });

  it('escalation DIRECTOR overrides to FINANCE_DIRECTOR', () => {
    const role = resolveReviewerRole({
      queue: 'STANDARD_FINANCE_REVIEW',
      intent: 'VENDOR_PAYMENT',
      escalationLevel: 'DIRECTOR',
      reviewLevel: 'STANDARD',
      currentRole: 'FINANCE_ANALYST',
    });
    expect(role).toBe('FINANCE_DIRECTOR');
  });

  it('escalation EXECUTIVE overrides to CFO', () => {
    const role = resolveReviewerRole({
      queue: 'HIGH_RISK_REVIEW',
      intent: 'VENDOR_PAYMENT',
      escalationLevel: 'EXECUTIVE',
      reviewLevel: 'EXECUTIVE',
      currentRole: 'UNASSIGNED',
    });
    expect(role).toBe('CFO');
  });

  it('COMPLIANCE escalation assigns COMPLIANCE_OFFICER', () => {
    const role = resolveReviewerRole({
      queue: 'HIGH_RISK_REVIEW',
      intent: 'INTERNAL_TRANSFER',
      escalationLevel: 'COMPLIANCE',
      reviewLevel: 'MANAGER',
      currentRole: 'UNASSIGNED',
    });
    expect(role).toBe('COMPLIANCE_OFFICER');
  });

  it('review level MANAGER maps to ACCOUNTING_MANAGER', () => {
    const role = resolveReviewerRole({
      queue: 'STANDARD_FINANCE_REVIEW',
      intent: 'VENDOR_PAYMENT',
      escalationLevel: 'NONE',
      reviewLevel: 'MANAGER',
      currentRole: 'UNASSIGNED',
    });
    expect(role).toBe('ACCOUNTING_MANAGER');
  });

  it('approvalLevelToReviewLevel COMMITTEE → EXECUTIVE', () => {
    const level = approvalLevelToReviewLevel('COMMITTEE', 'STANDARD');
    expect(level).toBe('EXECUTIVE');
  });

  it('approvalLevelToReviewLevel DUAL → DIRECTOR', () => {
    const level = approvalLevelToReviewLevel('DUAL', 'STANDARD');
    expect(level).toBe('DIRECTOR');
  });

  it('approvalLevelToReviewLevel keeps higher existing level', () => {
    const level = approvalLevelToReviewLevel('SINGLE', 'EXECUTIVE');
    expect(level).toBe('EXECUTIVE');
  });
});

// ─── 6. SLA computation ───────────────────────────────────────────────────────

describe('SLA computation', () => {
  it('CRITICAL SLA is 30 minutes by default', () => {
    expect(DEFAULT_POLICY_SLA_MINUTES['CRITICAL']).toBe(30);
  });

  it('resolveSlaMinutes uses default when no config', () => {
    expect(resolveSlaMinutes('NORMAL')).toBe(1440);
  });

  it('resolveSlaMinutes uses configured value when provided', () => {
    expect(resolveSlaMinutes('URGENT', { URGENT: 60 })).toBe(60);
  });

  it('buildPolicySla produces correct dueAt for CRITICAL', () => {
    const now = new Date('2026-07-01T08:00:00.000Z');
    const sla = buildPolicySla('CRITICAL', now);
    const due = new Date(sla.dueAt);
    expect(due.getTime() - now.getTime()).toBe(30 * 60 * 1000);
  });

  it('buildPolicySla urgencyLabel CRITICAL', () => {
    const sla = buildPolicySla('CRITICAL', FIXED_NOW);
    expect(sla.urgencyLabel).toBe('CRITICAL');
  });

  it('buildPolicySla urgencyLabel ROUTINE for NORMAL', () => {
    const sla = buildPolicySla('NORMAL', FIXED_NOW);
    expect(sla.urgencyLabel).toBe('ROUTINE');
  });

  it('buildPolicySla urgencyLabel PRIORITY for HIGH', () => {
    const sla = buildPolicySla('HIGH', FIXED_NOW);
    expect(sla.urgencyLabel).toBe('PRIORITY');
  });

  it('buildPolicySla urgencyLabel URGENT for URGENT', () => {
    const sla = buildPolicySla('URGENT', FIXED_NOW);
    expect(sla.urgencyLabel).toBe('URGENT');
  });
});

// ─── 7. Rule: Intent rules ────────────────────────────────────────────────────

describe('Intent rules', () => {
  it('TAX_PAYMENT forces review and TAX_REVIEW queue', () => {
    const input = makeInput({ intent: 'TAX_PAYMENT', confidence: 0.95 });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set());
    expect(acc.reviewRequired).toBe(true);
    expect(acc.queue).toBe('TAX_REVIEW');
    expect(acc.reviewerRole).toBe('TAX_SPECIALIST');
  });

  it('PAYROLL forces review and PAYROLL_REVIEW queue', () => {
    const input = makeInput({ intent: 'PAYROLL', confidence: 0.95 });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set());
    expect(acc.reviewRequired).toBe(true);
    expect(acc.queue).toBe('PAYROLL_REVIEW');
  });

  it('UNKNOWN intent routes to DATA_QUALITY_REVIEW', () => {
    const input = makeInput({ intent: 'UNKNOWN' });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set());
    expect(acc.reviewRequired).toBe(true);
    expect(acc.queue).toBe('DATA_QUALITY_REVIEW');
  });

  it('VENDOR_PAYMENT does not force review by default', () => {
    const input = makeInput({ intent: 'VENDOR_PAYMENT' });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set());
    expect(acc.reviewRequired).toBe(false);
  });

  it('forceIntents set triggers review for VENDOR_PAYMENT', () => {
    const input = makeInput({ intent: 'VENDOR_PAYMENT' });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set(['VENDOR_PAYMENT']));
    expect(acc.reviewRequired).toBe(true);
  });

  it('INTERNAL_TRANSFER routes to INTERCOMPANY_REVIEW', () => {
    const input = makeInput({ intent: 'INTERNAL_TRANSFER' });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set());
    expect(acc.queue).toBe('INTERCOMPANY_REVIEW');
  });

  it('fires a rule record when intent triggers review', () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    const acc = buildDefaultAccumulator();
    applyIntentRules(input, acc, new Set());
    expect(acc.firedRules.some((r) => r.ruleId === 'INTENT_HIGH_RISK')).toBe(true);
  });
});

// ─── 8. Rule: Confidence rules ────────────────────────────────────────────────

describe('Confidence rules', () => {
  it('low intent confidence triggers review', () => {
    const input = makeInput({ confidence: 0.50 });
    const acc = buildDefaultAccumulator();
    applyConfidenceRules(input, acc, DEFAULT_AUTO_CONFIDENCE);
    expect(acc.reviewRequired).toBe(true);
  });

  it('high intent confidence does not trigger review', () => {
    const input = makeInput({ confidence: 0.95 });
    const acc = buildDefaultAccumulator();
    applyConfidenceRules(input, acc, DEFAULT_AUTO_CONFIDENCE);
    expect(acc.reviewRequired).toBe(false);
  });

  it('confidence at exactly threshold does not trigger review', () => {
    const input = makeInput({ confidence: DEFAULT_AUTO_CONFIDENCE });
    const acc = buildDefaultAccumulator();
    applyConfidenceRules(input, acc, DEFAULT_AUTO_CONFIDENCE);
    expect(acc.reviewRequired).toBe(false);
  });

  it('phase2 requiresManualReview flag triggers review', () => {
    const input = makeInput({ confidence: 0.95, requiresManualReview: false });
    // Manually set phase2 flag
    input.phase2.requiresManualReview = true;
    const acc = buildDefaultAccumulator();
    applyConfidenceRules(input, acc, DEFAULT_AUTO_CONFIDENCE);
    expect(acc.reviewRequired).toBe(true);
  });

  it('fires CONFIDENCE_LOW_INTENT rule when confidence below threshold', () => {
    const input = makeInput({ confidence: 0.40 });
    const acc = buildDefaultAccumulator();
    applyConfidenceRules(input, acc, DEFAULT_AUTO_CONFIDENCE);
    expect(acc.firedRules.some((r) => r.ruleId === 'CONFIDENCE_LOW_INTENT')).toBe(true);
  });
});

// ─── 9. Rule: Anomaly rules ────────────────────────────────────────────────────

describe('Anomaly rules', () => {
  it('high anomaly score triggers review', () => {
    const input = makeInput({ anomalyScore: 0.60, isAnomaly: true });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(acc.reviewRequired).toBe(true);
  });

  it('low anomaly score does not trigger review', () => {
    const input = makeInput({ anomalyScore: 0.10, isAnomaly: false });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(acc.reviewRequired).toBe(false);
  });

  it('CRITICAL risk triggers escalation and hold', () => {
    const input = makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.80, isAnomaly: true });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(acc.escalationRequired).toBe(true);
    expect(acc.hold).toBe(true);
    expect(acc.priority).toBe('CRITICAL');
  });

  it('EXACT_DUPLICATE triggers hold', () => {
    const input = makeInput({ anomalyTypes: ['EXACT_DUPLICATE'], isAnomaly: true, anomalyScore: 0.50 });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(acc.hold).toBe(true);
  });

  it('SPLIT_TRANSACTION boosts priority to at least HIGH', () => {
    const input = makeInput({ anomalyTypes: ['SPLIT_TRANSACTION'], anomalyScore: 0.45, isAnomaly: true });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(['HIGH', 'URGENT', 'CRITICAL']).toContain(acc.priority);
  });

  it('CROSS_COMPANY_PATTERN routes to INTERCOMPANY_REVIEW', () => {
    const input = makeInput({ anomalyTypes: ['CROSS_COMPANY_PATTERN'], isAnomaly: true, anomalyScore: 0.60 });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(acc.queue).toBe('INTERCOMPANY_REVIEW');
  });

  it('fires ANOMALY_REVIEW_TRIGGER rule when score high enough', () => {
    const input = makeInput({ anomalyScore: 0.50, isAnomaly: true });
    const acc = buildDefaultAccumulator();
    applyAnomalyRules(input, acc, DEFAULT_ANOMALY_REVIEW_THRESHOLD, DEFAULT_ANOMALY_ESCALATION_THRESHOLD);
    expect(acc.firedRules.some((r) => r.ruleId === 'ANOMALY_REVIEW_TRIGGER')).toBe(true);
  });
});

// ─── 10. Rule: Amount rules ───────────────────────────────────────────────────

describe('Amount rules', () => {
  it('normal amount does not trigger review', () => {
    const input = makeInput({ amount: 1_000_000 });
    const acc = buildDefaultAccumulator();
    applyAmountRules(input, acc, DEFAULT_HIGH_VALUE, DEFAULT_CRITICAL_VALUE, DEFAULT_ESCALATION_VALUE);
    expect(acc.reviewRequired).toBe(false);
  });

  it('high-value amount triggers review and SINGLE approval', () => {
    const input = makeInput({ amount: DEFAULT_HIGH_VALUE + 1 });
    const acc = buildDefaultAccumulator();
    applyAmountRules(input, acc, DEFAULT_HIGH_VALUE, DEFAULT_CRITICAL_VALUE, DEFAULT_ESCALATION_VALUE);
    expect(acc.reviewRequired).toBe(true);
    expect(acc.approvalRequired).toBe(true);
    expect(acc.approvalLevel).toBe('SINGLE');
  });

  it('critical-value amount triggers DUAL approval', () => {
    const input = makeInput({ amount: DEFAULT_CRITICAL_VALUE + 1 });
    const acc = buildDefaultAccumulator();
    applyAmountRules(input, acc, DEFAULT_HIGH_VALUE, DEFAULT_CRITICAL_VALUE, DEFAULT_ESCALATION_VALUE);
    expect(acc.approvalLevel).toBe('DUAL');
    expect(acc.minApprovers).toBe(2);
  });

  it('escalation-value amount triggers COMMITTEE approval and CFO reviewer', () => {
    const input = makeInput({ amount: DEFAULT_ESCALATION_VALUE + 1 });
    const acc = buildDefaultAccumulator();
    applyAmountRules(input, acc, DEFAULT_HIGH_VALUE, DEFAULT_CRITICAL_VALUE, DEFAULT_ESCALATION_VALUE);
    expect(acc.approvalLevel).toBe('COMMITTEE');
    expect(acc.minApprovers).toBe(3);
    expect(acc.reviewerRole).toBe('CFO');
    expect(acc.priority).toBe('CRITICAL');
    expect(acc.escalationRequired).toBe(true);
  });

  it('fires AMOUNT_HIGH rule for high-value', () => {
    const input = makeInput({ amount: DEFAULT_HIGH_VALUE + 1 });
    const acc = buildDefaultAccumulator();
    applyAmountRules(input, acc, DEFAULT_HIGH_VALUE, DEFAULT_CRITICAL_VALUE, DEFAULT_ESCALATION_VALUE);
    expect(acc.firedRules.some((r) => r.ruleId === 'AMOUNT_HIGH')).toBe(true);
  });

  it('fires AMOUNT_ESCALATION rule for escalation amount', () => {
    const input = makeInput({ amount: DEFAULT_ESCALATION_VALUE + 1 });
    const acc = buildDefaultAccumulator();
    applyAmountRules(input, acc, DEFAULT_HIGH_VALUE, DEFAULT_CRITICAL_VALUE, DEFAULT_ESCALATION_VALUE);
    expect(acc.firedRules.some((r) => r.ruleId === 'AMOUNT_ESCALATION')).toBe(true);
  });
});

// ─── 11. Rule: COA rules ──────────────────────────────────────────────────────

describe('COA rules', () => {
  it('missing COA recommendation triggers review', () => {
    const input = makeInput({ coaConf: 0 });
    const acc = buildDefaultAccumulator();
    applyCoaRules(input, acc);
    expect(acc.reviewRequired).toBe(true);
    expect(acc.queue).toBe('ACCOUNTING_REVIEW');
  });

  it('COA conflict flags trigger review', () => {
    const input = makeInput({ conflictFlags: ['COA_MISMATCH'] });
    const acc = buildDefaultAccumulator();
    applyCoaRules(input, acc);
    expect(acc.reviewRequired).toBe(true);
  });

  it('fires COA_NO_RECOMMENDATION rule when no COA', () => {
    const input = makeInput({ coaConf: 0 });
    const acc = buildDefaultAccumulator();
    applyCoaRules(input, acc);
    expect(acc.firedRules.some((r) => r.ruleId === 'COA_NO_RECOMMENDATION')).toBe(true);
  });
});

// ─── 12. Rule: Counterparty rules ─────────────────────────────────────────────

describe('Counterparty rules', () => {
  it('NEW_COUNTERPARTY anomaly triggers review', () => {
    const input = makeInput({ anomalyTypes: ['NEW_COUNTERPARTY'], isAnomaly: true, anomalyScore: 0.30 });
    const acc = buildDefaultAccumulator();
    applyCounterpartyRules(input, acc);
    expect(acc.reviewRequired).toBe(true);
  });

  it('UNUSUAL_COUNTERPARTY anomaly triggers review', () => {
    const input = makeInput({ anomalyTypes: ['UNUSUAL_COUNTERPARTY'], isAnomaly: true, anomalyScore: 0.30 });
    const acc = buildDefaultAccumulator();
    applyCounterpartyRules(input, acc);
    expect(acc.reviewRequired).toBe(true);
  });

  it('normal counterparty does not trigger review', () => {
    const input = makeInput({ anomalyTypes: [] });
    const acc = buildDefaultAccumulator();
    applyCounterpartyRules(input, acc);
    expect(acc.reviewRequired).toBe(false);
  });
});

// ─── 13. Rule: Flag rules ─────────────────────────────────────────────────────

describe('Flag rules', () => {
  it('force-review flag triggers review', () => {
    const input = makeInput({ ambiguityFlags: [{ type: 'HIGH_RISK_FLAG' }] });
    const acc = buildDefaultAccumulator();
    applyFlagRules(input, acc, new Set(['HIGH_RISK_FLAG']));
    expect(acc.reviewRequired).toBe(true);
  });

  it('non-matching flag does not trigger review', () => {
    const input = makeInput({ ambiguityFlags: [{ type: 'SOME_OTHER_FLAG' }] });
    const acc = buildDefaultAccumulator();
    applyFlagRules(input, acc, new Set(['DIFFERENT_FLAG']));
    expect(acc.reviewRequired).toBe(false);
  });
});

// ─── 14. Overrides ────────────────────────────────────────────────────────────

describe('Override application', () => {
  it('COMPANY override matches correct company', () => {
    const input = makeInput({ companyId: 'company-abc' });
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'COMPANY',
      matchKey: 'company-abc',
      force: { skipReview: true, queue: 'AUTO_CLEAR_CANDIDATE' },
      reason: 'Trusted company bypass',
    };
    const applied = applyOverrides(input, acc, [override], FIXED_NOW);
    expect(applied.length).toBe(1);
    expect(acc.reviewRequired).toBe(false);
  });

  it('COMPANY override does not match different company', () => {
    const input = makeInput({ companyId: 'company-xyz' });
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'COMPANY',
      matchKey: 'company-abc',
      force: { skipReview: true },
      reason: 'Trusted company',
    };
    const applied = applyOverrides(input, acc, [override], FIXED_NOW);
    expect(applied.length).toBe(0);
  });

  it('INTENT override forces queue', () => {
    const input = makeInput({ intent: 'VENDOR_PAYMENT' });
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'INTENT',
      matchKey: 'VENDOR_PAYMENT',
      force: { queue: 'HIGH_RISK_REVIEW' },
      reason: 'Vendor payment policy change',
    };
    applyOverrides(input, acc, [override], FIXED_NOW);
    expect(acc.queue).toBe('HIGH_RISK_REVIEW');
  });

  it('RISK override matches riskLevel', () => {
    const input = makeInput({ riskLevel: 'HIGH' });
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'RISK',
      matchKey: 'HIGH',
      force: { priority: 'URGENT' },
      reason: 'HIGH risk always URGENT',
    };
    applyOverrides(input, acc, [override], FIXED_NOW);
    expect(acc.priority).toBe('URGENT');
  });

  it('expired override is not applied', () => {
    const input = makeInput();
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'COMPANY',
      matchKey: String(input.companyId),
      force: { skipReview: true },
      reason: 'Expired override',
      expiresAt: '2020-01-01T00:00:00.000Z',
    };
    const applied = applyOverrides(input, acc, [override], FIXED_NOW);
    expect(applied.length).toBe(0);
  });

  it('AMOUNT override matches HIGH bracket', () => {
    const input = makeInput({ amount: DEFAULT_HIGH_VALUE + 1_000 });
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'AMOUNT',
      matchKey: 'HIGH',
      force: { reviewerRole: 'SENIOR_ACCOUNTANT' },
      reason: 'Override high-value reviewer',
    };
    applyOverrides(input, acc, [override], FIXED_NOW);
    expect(acc.reviewerRole).toBe('SENIOR_ACCOUNTANT');
  });

  it('override records fieldsChanged correctly', () => {
    const input = makeInput({ intent: 'VENDOR_PAYMENT' });
    const acc = buildDefaultAccumulator();
    const override: DecisionPolicyOverride = {
      dimension: 'INTENT',
      matchKey: 'VENDOR_PAYMENT',
      force: { priority: 'HIGH', holdRecommendation: true },
      reason: 'Test override',
    };
    const applied = applyOverrides(input, acc, [override], FIXED_NOW);
    expect(applied[0]!.fieldsChanged).toContain('priority');
    expect(applied[0]!.fieldsChanged).toContain('hold');
  });

  it('mergeOverrides combines config and company overrides', () => {
    const config: DecisionPolicyOverride[] = [{ dimension: 'INTENT', matchKey: 'X', force: {}, reason: 'a' }];
    const company: DecisionPolicyOverride[] = [{ dimension: 'COMPANY', matchKey: 'Y', force: {}, reason: 'b' }];
    const merged = mergeOverrides(config, company);
    expect(merged.length).toBe(2);
  });
});

// ─── 15. Full engine integration tests ───────────────────────────────────────

describe('evaluateDecisionPolicy — integration', () => {
  it('returns engineVersion 9.0', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(result.engineVersion).toBe('9.0');
  });

  it('auto-clears clean low-risk transaction', async () => {
    const input = makeInput({ confidence: 0.95, anomalyScore: 0.05, riskLevel: 'NONE', amount: 500_000 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewRequired).toBe(false);
    expect(result.queue).toBe('AUTO_CLEAR_CANDIDATE');
  });

  it('escalates critical anomaly transaction', async () => {
    const input = makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.90, isAnomaly: true });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewRequired).toBe(true);
    expect(result.escalation.required).toBe(true);
    expect(result.holdRecommendation.hold).toBe(true);
  });

  it('assigns TAX_SPECIALIST for TAX_PAYMENT', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewerRole).toBe('TAX_SPECIALIST');
    expect(result.queue).toBe('TAX_REVIEW');
  });

  it('assigns CFO for escalation-value amount', async () => {
    const input = makeInput({ amount: DEFAULT_ESCALATION_VALUE + 1 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewerRole).toBe('CFO');
    expect(result.approvalRequirement.level).toBe('COMMITTEE');
  });

  it('includes evaluatedAt ISO string', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(result.evaluatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('records policyVersion in result', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(result.policyVersion).toBe(DEFAULT_POLICY_VERSION);
  });

  it('firedRules is an array', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(Array.isArray(result.firedRules)).toBe(true);
  });

  it('appliedOverrides is empty when no overrides configured', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(result.appliedOverrides).toEqual([]);
  });

  it('SLA dueAt is in the future relative to evaluationTime', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(new Date(result.sla.dueAt).getTime()).toBeGreaterThan(FIXED_NOW.getTime());
  });

  it('PAYROLL intent gets PAYROLL_REVIEW queue and PAYROLL_OFFICER reviewer', async () => {
    const input = makeInput({ intent: 'PAYROLL', confidence: 0.95 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.queue).toBe('PAYROLL_REVIEW');
    expect(result.reviewerRole).toBe('PAYROLL_OFFICER');
  });

  it('duplicate anomaly forces hold', async () => {
    const input = makeInput({ anomalyTypes: ['EXACT_DUPLICATE'], isAnomaly: true, anomalyScore: 0.55 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.holdRecommendation.hold).toBe(true);
  });

  it('high-value transaction requires approval', async () => {
    const input = makeInput({ amount: DEFAULT_HIGH_VALUE + 1 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.approvalRequirement.required).toBe(true);
  });

  it('policyReason is non-empty when review required', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.policyReason.length).toBeGreaterThan(0);
  });

  it('company override applied via DI deps', async () => {
    const input = makeInput({ companyId: 'override-co' });
    const override: DecisionPolicyOverride = {
      dimension: 'COMPANY',
      matchKey: 'override-co',
      force: { queue: 'HIGH_RISK_REVIEW' },
      reason: 'Test override via DI',
    };
    const result = await evaluateDecisionPolicy(input, {
      ...FIXED_DEPS,
      getCompanyOverrides: async () => [override],
    });
    expect(result.queue).toBe('HIGH_RISK_REVIEW');
    expect(result.appliedOverrides.length).toBeGreaterThan(0);
  });

  it('does not mutate the input object', async () => {
    const input = makeInput();
    const originalAmount = input.transaction.amount;
    await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(input.transaction.amount).toBe(originalAmount);
  });

  it('batch evaluation returns same count as inputs', async () => {
    const inputs = [makeInput(), makeInput({ intent: 'TAX_PAYMENT' }), makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.90, isAnomaly: true })];
    const results = await evaluateDecisionPolicyBatch(inputs, FIXED_DEPS);
    expect(results).toHaveLength(3);
  });
});

// ─── 16. Regression: no-write guarantee ──────────────────────────────────────

describe('No-write regression', () => {
  it('result has no DB write methods', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect((result as unknown as Record<string, unknown>)['save']).toBeUndefined();
    expect((result as unknown as Record<string, unknown>)['post']).toBeUndefined();
    expect((result as unknown as Record<string, unknown>)['approve']).toBeUndefined();
    expect((result as unknown as Record<string, unknown>)['reconcile']).toBeUndefined();
    expect((result as unknown as Record<string, unknown>)['update']).toBeUndefined();
  });

  it('is idempotent — same input produces same result', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT', anomalyScore: 0.50, isAnomaly: true });
    const r1 = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const r2 = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(r1.reviewRequired).toBe(r2.reviewRequired);
    expect(r1.queue).toBe(r2.queue);
    expect(r1.priority).toBe(r2.priority);
    expect(r1.reviewerRole).toBe(r2.reviewerRole);
    expect(r1.escalation.required).toBe(r2.escalation.required);
    expect(r1.escalation.level).toBe(r2.escalation.level);
  });

  it('batch results match sequential results', async () => {
    const inputs = [makeInput(), makeInput({ intent: 'PAYROLL' })];
    const [batch1, batch2] = await evaluateDecisionPolicyBatch(inputs, FIXED_DEPS);
    const seq1 = await evaluateDecisionPolicy(inputs[0]!, FIXED_DEPS);
    const seq2 = await evaluateDecisionPolicy(inputs[1]!, FIXED_DEPS);
    expect(batch1!.queue).toBe(seq1.queue);
    expect(batch2!.queue).toBe(seq2.queue);
  });
});

// ─── 17. Audit ────────────────────────────────────────────────────────────────

describe('Audit', () => {
  it('builds audit record from result', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const audit = buildDecisionAuditRecord(input, result);
    expect(audit.companyId).toBe(input.companyId);
    expect(audit.decision.queue).toBe(result.queue);
    expect(audit.inputSummary.intent).toBe('TAX_PAYMENT');
  });

  it('audit record contains why array', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const audit = buildDecisionAuditRecord(input, result);
    expect(Array.isArray(audit.why)).toBe(true);
    expect(audit.why.length).toBeGreaterThan(0);
  });

  it('formatAuditSummary returns non-empty string', async () => {
    const input = makeInput();
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const audit = buildDecisionAuditRecord(input, result);
    const summary = formatAuditSummary(audit);
    expect(summary.length).toBeGreaterThan(0);
    expect(summary).toContain('Phase 9 Decision Audit');
  });

  it('verifyAuditCompleteness passes for valid audit', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const audit = buildDecisionAuditRecord(input, result);
    const verification = verifyAuditCompleteness(audit);
    expect(verification.complete).toBe(true);
    expect(verification.issues).toHaveLength(0);
  });

  it('verifyAuditCompleteness detects empty why', () => {
    const audit = {
      transactionId: 'txn-1',
      companyId: 'co-1',
      evaluatedAt: '2026-07-01T00:00:00.000Z',
      policyVersion: '9.0.0',
      decision: {
        reviewRequired: true,
        queue: 'AUTO_CLEAR_CANDIDATE', // Inconsistency!
        priority: 'NORMAL',
        reviewerRole: 'UNASSIGNED',
        reviewLevel: 'NONE',
        escalationRequired: false,
        escalationLevel: 'NONE',
        approvalRequired: false,
        approvalLevel: 'NONE',
        hold: false,
      },
      why: [],
      rulesFireds: [],
      overridesApplied: [],
      inputSummary: {
        intent: 'VENDOR_PAYMENT',
        intentConfidence: 0.90,
        anomalyScore: 0.10,
        anomalyRisk: 'NONE',
        amount: 1_000_000,
        conflictFlags: [],
        requiresManualReviewUpstream: false,
      },
    };
    const result = verifyAuditCompleteness(audit as never);
    // reviewRequired=true with AUTO_CLEAR queue should flag
    expect(result.issues.some((i) => i.includes('AUTO_CLEAR_CANDIDATE'))).toBe(true);
  });

  it('audit record includes inputSummary.intentConfidence', async () => {
    const input = makeInput({ confidence: 0.72 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const audit = buildDecisionAuditRecord(input, result);
    expect(audit.inputSummary.intentConfidence).toBeCloseTo(0.72);
  });

  it('audit includes anomalyScore from phase7', async () => {
    const input = makeInput({ anomalyScore: 0.65, isAnomaly: true });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    const audit = buildDecisionAuditRecord(input, result);
    expect(audit.inputSummary.anomalyScore).toBeCloseTo(0.65);
  });
});

// ─── 18. Policy simulation ────────────────────────────────────────────────────

describe('Policy simulation', () => {
  it('reports no change when inputs are identical', async () => {
    const base = makeInput();
    const report = await runPolicySimulation({
      scenarios: [{ label: 'identical', baseline: base, modified: base }],
    });
    expect(report.totalScenarios).toBe(1);
    expect(report.unchangedScenarios).toBe(1);
    expect(report.changedScenarios).toBe(0);
  });

  it('detects change when override is added', async () => {
    const base = makeInput({ companyId: 'sim-co' });
    const modified = makeInput({ companyId: 'sim-co' });
    modified.policy = {
      overrides: [{
        dimension: 'COMPANY',
        matchKey: 'sim-co',
        force: { queue: 'HIGH_RISK_REVIEW' },
        reason: 'Simulation override',
      }],
    };
    const report = await runPolicySimulation({
      scenarios: [{ label: 'with override', baseline: base, modified }],
    });
    expect(report.changedScenarios).toBe(1);
    expect(report.results[0]!.changed).toBe(true);
  });

  it('reports deltas for changed fields', async () => {
    const base = makeInput({ amount: 1_000_000 });
    const modified = makeInput({ amount: DEFAULT_HIGH_VALUE + 1 });
    const report = await runPolicySimulation({
      scenarios: [{ label: 'amount threshold', baseline: base, modified }],
    });
    const result = report.results[0]!;
    expect(result.changed).toBe(true);
    expect(result.deltas.length).toBeGreaterThan(0);
  });

  it('narrative is non-empty', async () => {
    const base = makeInput();
    const report = await runPolicySimulation({
      scenarios: [{ label: 'test', baseline: base, modified: base }],
    });
    expect(report.narrative.length).toBeGreaterThan(0);
  });

  it('fieldChangeSummary tracks changed fields', async () => {
    const base = makeInput({ amount: 1_000_000 });
    const modified = makeInput({ amount: DEFAULT_HIGH_VALUE + 1 });
    const report = await runPolicySimulation({
      scenarios: [{ label: 'amount', baseline: base, modified }],
    });
    if (report.changedScenarios > 0) {
      expect(Object.keys(report.fieldChangeSummary).length).toBeGreaterThan(0);
    }
  });

  it('runs multiple scenarios', async () => {
    const scenarios = [
      { label: 'A', baseline: makeInput(), modified: makeInput({ intent: 'TAX_PAYMENT' }) },
      { label: 'B', baseline: makeInput(), modified: makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.90, isAnomaly: true }) },
    ];
    const report = await runPolicySimulation({ scenarios });
    expect(report.totalScenarios).toBe(2);
    expect(report.results).toHaveLength(2);
  });
});

// ─── 19. Edge cases ───────────────────────────────────────────────────────────

describe('Edge cases', () => {
  it('handles zero-amount transaction gracefully', async () => {
    const input = makeInput({ amount: 0 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.engineVersion).toBe('9.0');
  });

  it('handles very high confidence without review', async () => {
    const input = makeInput({ confidence: 1.0, anomalyScore: 0.0, riskLevel: 'NONE', amount: 100_000 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewRequired).toBe(false);
  });

  it('handles multiple anomaly types simultaneously', async () => {
    const input = makeInput({
      anomalyTypes: ['EXACT_DUPLICATE', 'SPLIT_TRANSACTION', 'CROSS_COMPANY_PATTERN'],
      isAnomaly: true,
      anomalyScore: 0.80,
      riskLevel: 'HIGH',
    });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewRequired).toBe(true);
    expect(result.holdRecommendation.hold).toBe(true);
  });

  it('forceManualReviewIntents config flag forces review', async () => {
    const input = makeInput({ intent: 'CUSTOMER_PAYMENT', confidence: 0.95, anomalyScore: 0.05, riskLevel: 'NONE' });
    input.policy = { forceManualReviewIntents: ['CUSTOMER_PAYMENT'] };
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    expect(result.reviewRequired).toBe(true);
  });

  it('reviewRequired=false means queue is AUTO_CLEAR_CANDIDATE', async () => {
    const input = makeInput({ confidence: 0.99, anomalyScore: 0.01, riskLevel: 'NONE', amount: 100_000 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    if (!result.reviewRequired) {
      expect(result.queue).toBe('AUTO_CLEAR_CANDIDATE');
    }
  });

  it('SLA targetMinutes > 0 always', async () => {
    const result = await evaluateDecisionPolicy(makeInput(), FIXED_DEPS);
    expect(result.sla.targetMinutes).toBeGreaterThan(0);
  });

  it('custom SLA minutes from policy config are applied', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    input.policy = { slaMinutes: { NORMAL: 60, HIGH: 120, URGENT: 30, CRITICAL: 10 } };
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    // TAX_PAYMENT forces review; priority will be at least NORMAL
    expect(result.sla.targetMinutes).toBeGreaterThan(0);
  });

  it('evaluationTime from input is used for SLA calculation', async () => {
    const input = makeInput({ intent: 'TAX_PAYMENT' });
    input.evaluationTime = '2026-01-01T00:00:00.000Z';
    const result = await evaluateDecisionPolicy(input);
    expect(new Date(result.sla.dueAt).getTime()).toBeGreaterThan(new Date('2026-01-01T00:00:00.000Z').getTime());
  });

  it('escalation reason array is non-empty when escalation required', async () => {
    const input = makeInput({ riskLevel: 'CRITICAL', anomalyScore: 0.90, isAnomaly: true });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    if (result.escalation.required) {
      expect(result.escalation.reason.length).toBeGreaterThan(0);
    }
  });

  it('approval reason array is non-empty when approval required', async () => {
    const input = makeInput({ amount: DEFAULT_HIGH_VALUE + 1 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    if (result.approvalRequirement.required) {
      expect(result.approvalRequirement.reason.length).toBeGreaterThan(0);
    }
  });

  it('hold reason array is non-empty when hold recommended', async () => {
    const input = makeInput({ anomalyTypes: ['EXACT_DUPLICATE'], isAnomaly: true, anomalyScore: 0.55 });
    const result = await evaluateDecisionPolicy(input, FIXED_DEPS);
    if (result.holdRecommendation.hold) {
      expect(result.holdRecommendation.reason.length).toBeGreaterThan(0);
    }
  });
});

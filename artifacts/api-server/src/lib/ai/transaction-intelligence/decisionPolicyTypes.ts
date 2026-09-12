/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Domain Types
 *
 * Pure type definitions. No side effects, no logic.
 * This engine consumes outputs from Phases 1–8 and emits a single
 * authoritative DecisionPolicyResult.
 *
 * DOES NOT: post, approve, reconcile, update DB, update journal, update transaction.
 */

import type { TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type { CoaPredictionResult } from './coaPredictionTypes.js';
import type { ExplainabilityResult } from './explainabilityTypes.js';
import type { AnomalyDetectionResult, AnomalyRiskLevel } from './anomalyTypes.js';
import type { ReviewQueue, ReviewPriority, AIReviewCase } from './reviewOrchestrationTypes.js';

// ─── Re-export upstream primitives for convenience ────────────────────────────

export type { ReviewQueue, ReviewPriority };
export type { AnomalyRiskLevel };

// ─── Review Level ─────────────────────────────────────────────────────────────

export type ReviewLevel =
  | 'NONE'
  | 'STANDARD'
  | 'SENIOR'
  | 'MANAGER'
  | 'DIRECTOR'
  | 'EXECUTIVE';

// ─── Escalation Level ─────────────────────────────────────────────────────────

export type EscalationLevel =
  | 'NONE'
  | 'TEAM_LEAD'
  | 'MANAGER'
  | 'DIRECTOR'
  | 'EXECUTIVE'
  | 'COMPLIANCE';

// ─── Approval Level ───────────────────────────────────────────────────────────

export type ApprovalLevel =
  | 'NONE'
  | 'SINGLE'
  | 'DUAL'
  | 'COMMITTEE';

// ─── Reviewer Role ────────────────────────────────────────────────────────────

export type ReviewerRole =
  | 'FINANCE_ANALYST'
  | 'SENIOR_ACCOUNTANT'
  | 'ACCOUNTING_MANAGER'
  | 'TAX_SPECIALIST'
  | 'PAYROLL_OFFICER'
  | 'TREASURY_ANALYST'
  | 'COMPLIANCE_OFFICER'
  | 'FINANCE_DIRECTOR'
  | 'CFO'
  | 'DATA_QUALITY_ANALYST'
  | 'UNASSIGNED';

// ─── Override Dimension ───────────────────────────────────────────────────────

export type OverrideDimension =
  | 'COMPANY'
  | 'INTENT'
  | 'RISK'
  | 'AMOUNT'
  | 'REVIEWER';

// ─── Policy Override ──────────────────────────────────────────────────────────

export interface DecisionPolicyOverride {
  /** Which dimension this override targets. */
  dimension: OverrideDimension;

  /** Key for matching. E.g. companyId, intent string, risk level. */
  matchKey: string;

  /** Fields this override forces. */
  force: {
    queue?: ReviewQueue;
    priority?: ReviewPriority;
    reviewLevel?: ReviewLevel;
    reviewerRole?: ReviewerRole;
    escalationLevel?: EscalationLevel;
    approvalLevel?: ApprovalLevel;
    holdRecommendation?: boolean;
    skipReview?: boolean;
    slaMinutes?: number;
  };

  /** Human reason for this override. */
  reason: string;

  /** ISO date this override expires (undefined = permanent). */
  expiresAt?: string;
}

// ─── Policy Configuration ─────────────────────────────────────────────────────

export interface DecisionPolicyConfig {
  /** Confidence below this triggers manual review. Default 0.70. */
  minimumAutoConfidence?: number;

  /** Anomaly score above this triggers manual review. Default 0.40. */
  anomalyReviewThreshold?: number;

  /** Anomaly score above this triggers escalation. Default 0.70. */
  anomalyEscalationThreshold?: number;

  /** Amount thresholds in the company's base currency. */
  amountThresholds?: {
    /** Transactions above this require manager-level review. Default 50,000,000. */
    highValue?: number;
    /** Transactions above this require director-level approval. Default 500,000,000. */
    criticalValue?: number;
    /** Transactions above this trigger immediate escalation. Default 1,000,000,000. */
    escalationValue?: number;
  };

  /** SLA targets in minutes per priority level. */
  slaMinutes?: {
    LOW?: number;
    NORMAL?: number;
    HIGH?: number;
    URGENT?: number;
    CRITICAL?: number;
  };

  /** Override list — applied after base rules. */
  overrides?: DecisionPolicyOverride[];

  /** Intents that always require manual review. */
  forceManualReviewIntents?: string[];

  /** Conflict flags that always require manual review. */
  forceManualReviewFlags?: string[];

  /** Policy version string (semver or date stamp). */
  policyVersion?: string;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface DecisionPolicyInput {
  /** Company context. */
  companyId: string | number;

  /** Raw transaction attributes. */
  transaction: {
    id?: string | number;
    description: string;
    amount: number;
    currency?: string;
    direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
    transactionDate: string | Date;
    bankAccountId?: string | number;
    counterpartyName?: string;
    counterpartyAccount?: string;
    referenceNumber?: string;
    transactionCode?: string;
    metadata?: Record<string, unknown>;
  };

  /** Phase 1: Transaction Understanding result. */
  phase1: TransactionAnalysisResult;

  /** Phase 2: Intent Classification result. */
  phase2: IntentClassificationResult;

  /** Phase 3: COA Prediction result. */
  phase3: CoaPredictionResult;

  /** Phase 4: Explainability result. */
  phase4: ExplainabilityResult;

  /** Phase 7: Anomaly Detection result. */
  phase7: AnomalyDetectionResult;

  /** Phase 8: Review Case (optional — may not exist yet). */
  phase8?: AIReviewCase;

  /** Policy configuration (merged with defaults). */
  policy?: DecisionPolicyConfig;

  /** ISO timestamp of evaluation (deterministic testing). */
  evaluationTime?: string | Date;
}

// ─── SLA Decision ─────────────────────────────────────────────────────────────

export interface PolicySlaDecision {
  targetMinutes: number;
  dueAt: string;
  urgencyLabel: 'ROUTINE' | 'PRIORITY' | 'URGENT' | 'CRITICAL';
}

// ─── Escalation Decision ──────────────────────────────────────────────────────

export interface PolicyEscalationDecision {
  required: boolean;
  level: EscalationLevel;
  reason: string[];
}

// ─── Approval Decision ────────────────────────────────────────────────────────

export interface PolicyApprovalDecision {
  required: boolean;
  level: ApprovalLevel;
  minApprovers: number;
  reason: string[];
}

// ─── Hold Decision ────────────────────────────────────────────────────────────

export interface PolicyHoldDecision {
  hold: boolean;
  reason: string[];
}

// ─── Fired Rule Record ────────────────────────────────────────────────────────

export interface FiredRule {
  ruleId: string;
  description: string;
  dimension: string;
  effect: string;
}

// ─── Applied Override Record ──────────────────────────────────────────────────

export interface AppliedOverride {
  dimension: OverrideDimension;
  matchKey: string;
  fieldsChanged: string[];
  reason: string;
}

// ─── Main Output ──────────────────────────────────────────────────────────────

export interface DecisionPolicyResult {
  /** Whether this transaction requires human review. */
  reviewRequired: boolean;

  /** Target review queue. */
  queue: ReviewQueue;

  /** Review priority. */
  priority: ReviewPriority;

  /** SLA details. */
  sla: PolicySlaDecision;

  /** Required reviewer role. */
  reviewerRole: ReviewerRole;

  /** Review level required. */
  reviewLevel: ReviewLevel;

  /** Escalation decision. */
  escalation: PolicyEscalationDecision;

  /** Approval requirement decision. */
  approvalRequirement: PolicyApprovalDecision;

  /** Hold recommendation. */
  holdRecommendation: PolicyHoldDecision;

  /** Policy version applied. */
  policyVersion: string;

  /** Human-readable reasons for this decision. */
  policyReason: string[];

  /** Audit: which rules fired. */
  firedRules: FiredRule[];

  /** Audit: which overrides were applied. */
  appliedOverrides: AppliedOverride[];

  /** ISO timestamp of when this decision was evaluated. */
  evaluatedAt: string;

  /** Engine version. */
  readonly engineVersion: '9.0';
}

// ─── Dependency Injection ─────────────────────────────────────────────────────

export interface DecisionPolicyDependencies {
  /** Returns company-level overrides from an external config store. */
  getCompanyOverrides?: (
    companyId: string | number,
  ) => DecisionPolicyOverride[] | Promise<DecisionPolicyOverride[]>;

  /** Returns the full policy config for a company. */
  getPolicyConfig?: (
    companyId: string | number,
  ) => DecisionPolicyConfig | null | Promise<DecisionPolicyConfig | null>;

  /** Deterministic clock for testing. */
  now?: () => Date;
}

// ─── Simulation types ─────────────────────────────────────────────────────────

export interface SimulationScenario {
  /** Human label for this scenario. */
  label: string;
  input: DecisionPolicyInput;
}

export interface SimulationDelta {
  field: string;
  before: unknown;
  after: unknown;
}

export interface SimulationResult {
  label: string;
  before: DecisionPolicyResult;
  after: DecisionPolicyResult;
  deltas: SimulationDelta[];
  changed: boolean;
}

// ─── Audit record ─────────────────────────────────────────────────────────────

export interface DecisionPolicyAuditRecord {
  transactionId?: string | number;
  companyId: string | number;
  evaluatedAt: string;
  policyVersion: string;

  decision: {
    reviewRequired: boolean;
    queue: string;
    priority: string;
    reviewerRole: string;
    reviewLevel: string;
    escalationRequired: boolean;
    escalationLevel: string;
    approvalRequired: boolean;
    approvalLevel: string;
    hold: boolean;
  };

  why: string[];
  rulesFireds: FiredRule[];
  overridesApplied: AppliedOverride[];

  inputSummary: {
    intent: string;
    intentConfidence: number;
    anomalyScore: number;
    anomalyRisk: string;
    amount: number;
    currency?: string;
    conflictFlags: string[];
    requiresManualReviewUpstream: boolean;
  };
}

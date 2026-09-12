/**
 * AI Transaction Intelligence — Phase 8
 * Review Orchestration Types
 *
 * All types for the AI Review Orchestration & Observability layer.
 * Pure TypeScript — no runtime logic, no side effects.
 */

import type { TransactionIntent, TaxSubtype } from './transactionTypes.js';
import type { TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type { CoaPredictionResult } from './coaPredictionTypes.js';
import type { ExplainabilityResult } from './explainabilityTypes.js';
import type { AnomalyDetectionResult } from './anomalyTypes.js';

// ─── Enumerations ─────────────────────────────────────────────────────────────

export type ReviewQueue =
  | 'AUTO_CLEAR_CANDIDATE'
  | 'STANDARD_FINANCE_REVIEW'
  | 'ACCOUNTING_REVIEW'
  | 'TREASURY_REVIEW'
  | 'TAX_REVIEW'
  | 'PAYROLL_REVIEW'
  | 'INTERCOMPANY_REVIEW'
  | 'ANOMALY_REVIEW'
  | 'HIGH_RISK_REVIEW'
  | 'DATA_QUALITY_REVIEW';

export type ReviewPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | 'CRITICAL';

export type ReviewStatus =
  | 'OPEN'
  | 'QUEUED'
  | 'ASSIGNED'
  | 'IN_REVIEW'
  | 'NEEDS_INFORMATION'
  | 'APPROVED_RECOMMENDATION'
  | 'CHANGED_COA'
  | 'REJECTED_RECOMMENDATION'
  | 'ESCALATED'
  | 'CANCELLED'
  | 'CLOSED';

export type ReviewDecisionType =
  | 'APPROVE_RECOMMENDATION'
  | 'CHANGE_COA'
  | 'REJECT_RECOMMENDATION'
  | 'REQUEST_INFORMATION'
  | 'ESCALATE';

export type ReviewAuditEventType =
  | 'CASE_CREATED'
  | 'QUEUED'
  | 'ASSIGNED'
  | 'REVIEW_STARTED'
  | 'INFORMATION_REQUESTED'
  | 'RECOMMENDATION_APPROVED'
  | 'COA_CHANGED'
  | 'RECOMMENDATION_REJECTED'
  | 'ESCALATED'
  | 'CANCELLED'
  | 'CLOSED';

// ─── Policy ───────────────────────────────────────────────────────────────────

export interface ReviewOrchestrationPolicy {
  autoClearMinimumConfidence?: number;
  autoClearMaximumAnomalyScore?: number;

  highValueThreshold?: number;
  criticalValueThreshold?: number;

  standardSlaMinutes?: number;
  highPrioritySlaMinutes?: number;
  urgentSlaMinutes?: number;
  criticalSlaMinutes?: number;

  queueOverridesByIntent?: Partial<Record<TransactionIntent, ReviewQueue>>;
  priorityOverridesByIntent?: Partial<Record<TransactionIntent, ReviewPriority>>;

  forceManualReviewForIntents?: TransactionIntent[];
  forceManualReviewForFlags?: string[];

  allowedReviewerRolesByQueue?: Partial<Record<ReviewQueue, string[]>>;
}

// ─── Input ────────────────────────────────────────────────────────────────────

export interface ReviewOrchestrationInput {
  companyId: string | number;

  transaction: {
    id: string | number;
    description: string;
    amount: number;
    currency?: string;
    direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
    transactionDate: string | Date;
    bankAccountId?: string | number;
    referenceNumber?: string;
    counterpartyName?: string;
    counterpartyAccount?: string;
    transactionCode?: string;
    currentStatus?: string;
    metadata?: Record<string, unknown>;
  };

  phase1: TransactionAnalysisResult;
  phase2: IntentClassificationResult;
  phase3: CoaPredictionResult;
  phase4: ExplainabilityResult;
  phase7: AnomalyDetectionResult;

  context?: {
    source?: string;
    sourceRecordId?: string | number;
    existingReviewCaseId?: string;
    submittedBy?: string | number;
    submittedAt?: string | Date;
    dueAt?: string | Date;
  };

  policy?: ReviewOrchestrationPolicy;
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

export interface TransactionSnapshot {
  transactionId: string | number;
  description: string;
  amount: number;
  currency?: string;
  direction?: string;
  transactionDate: string;
  maskedCounterpartyAccount?: string;
  referenceNumber?: string;
}

export interface AISnapshot {
  intent: TransactionIntent;
  taxSubtype?: TaxSubtype;
  taxUncertaintyWarning?: string;
  intentConfidence: number;

  recommendedCoa: {
    coaId: string | number;
    coaCode: string;
    coaName: string;
    confidence: number;
  } | null;

  alternatives: Array<{
    coaId: string | number;
    coaCode: string;
    coaName: string;
    confidence: number;
  }>;

  explanationSummary: string;
  evidenceSummary: string[];
  conflictFlags: string[];
  anomalyScore: number;
  anomalyRisk: string;
  anomalyTypes: string[];

  requiresManualReview: boolean;
  snapshotVersion: string;
  snapshotChecksum: string;
  evaluatedAt: string;
  engineVersions: {
    phase1: string;
    phase2: string;
    phase3: string;
    phase4: string;
    phase7: string;
    phase8: string;
  };
}

// ─── Reviewer decision ────────────────────────────────────────────────────────

export interface SelectedCoa {
  coaId: string | number;
  coaCode: string;
  coaName: string;
}

export interface ReviewerDecisionInput {
  reviewCaseId: string;
  companyId: string | number;
  reviewerId: string | number;
  decision: ReviewDecisionType;
  selectedCoa?: SelectedCoa;
  reasonCode?: string;
  comments?: string;
  reviewerConfidence?: number;
  idempotencyKey: string;
  decidedAt: string | Date;
}

export interface ReviewerDecisionRecord {
  id: string;
  reviewCaseId: string;
  companyId: string | number;
  reviewerId: string | number;
  decision: ReviewDecisionType;
  previousStatus: ReviewStatus;
  newStatus: ReviewStatus;
  selectedCoa?: SelectedCoa;
  reasonCode?: string;
  comments?: string;
  reviewerConfidence?: number;
  idempotencyKey: string;
  createdAt: string;

  feedbackPayload?: {
    phase5Compatible: true;
    reviewerDecision: string;
    aiRecommendedCoa?: string;
    reviewerSelectedCoa?: string;
    agreement: boolean;
  };
}

// ─── SLA ─────────────────────────────────────────────────────────────────────

export interface ReviewSla {
  createdAt: string;
  dueAt?: string;
  ageMinutes: number;
  isOverdue: boolean;
  targetMinutes?: number;
}

// ─── Reviewer assignment ──────────────────────────────────────────────────────

export interface ReviewerAssignment {
  reviewerId?: string | number;
  reviewerRole?: string;
  assignedAt?: string;
}

// ─── Audit event ─────────────────────────────────────────────────────────────

export interface ReviewAuditEvent {
  id: string;
  reviewCaseId: string;
  companyId: string | number;
  eventType: ReviewAuditEventType;
  actorType: 'SYSTEM' | 'REVIEWER';
  actorId?: string | number;
  previousStatus?: ReviewStatus;
  newStatus?: ReviewStatus;
  reason?: string;
  metadata?: Record<string, unknown>;
  occurredAt: string;
}

// ─── Main review case ─────────────────────────────────────────────────────────

export interface AIReviewCase {
  id: string;
  idempotencyKey: string;
  companyId: string | number;

  transactionSnapshot: TransactionSnapshot;
  aiSnapshot: AISnapshot;

  queue: ReviewQueue;
  priority: ReviewPriority;
  status: ReviewStatus;

  sla: ReviewSla;

  flags: string[];

  reviewerAssignment?: ReviewerAssignment;
  decision?: ReviewerDecisionRecord;

  createdAt: string;
  updatedAt: string;

  readonly requiresHumanDecision: true;
  readonly orchestrationVersion: '1.0';
}

// ─── Dependency injection ─────────────────────────────────────────────────────

export interface ReviewOrchestrationDependencies {
  getExistingReviewCase?: (
    idempotencyKey: string,
  ) => AIReviewCase | null | Promise<AIReviewCase | null>;

  getExistingDecision?: (
    idempotencyKey: string,
  ) => ReviewerDecisionRecord | null | Promise<ReviewerDecisionRecord | null>;

  resolveReviewerRole?: (
    reviewerId: string | number,
    companyId: string | number,
  ) => string | null | Promise<string | null>;

  getReviewPolicy?: (
    companyId: string | number,
  ) => ReviewOrchestrationPolicy | null | Promise<ReviewOrchestrationPolicy | null>;

  now?: () => Date;
}

// ─── Repository port (interface only — no DB implementation) ─────────────────

export interface AIReviewCaseRepository {
  findById(id: string): Promise<AIReviewCase | null>;
  findByIdempotencyKey(key: string): Promise<AIReviewCase | null>;
  create(reviewCase: AIReviewCase): Promise<AIReviewCase>;
  updateStatus(id: string, status: ReviewStatus, updatedAt: string): Promise<AIReviewCase>;
  appendAuditEvent(event: ReviewAuditEvent): Promise<void>;
  findByCompany(companyId: string | number, limit?: number): Promise<AIReviewCase[]>;
  findOpenCases(companyId: string | number): Promise<AIReviewCase[]>;
}

// ─── Observability output ────────────────────────────────────────────────────

export interface TopCoaCorrection {
  aiCoaCode?: string;
  reviewerCoaCode?: string;
  count: number;
}

export interface TopConflictFlag {
  flag: string;
  count: number;
}

export interface ReviewObservabilityReport {
  totalCases: number;

  byStatus: Record<string, number>;
  byQueue: Record<string, number>;
  byPriority: Record<string, number>;
  byIntent: Record<string, number>;
  byRiskLevel: Record<string, number>;

  manualReviewRate: number;
  aiApprovalRate: number;
  coaChangeRate: number;
  rejectionRate: number;
  escalationRate: number;

  averageIntentConfidence: number;
  averageCoaConfidence: number;
  averageAnomalyScore: number;

  averageReviewMinutes?: number;
  medianReviewMinutes?: number;
  p90ReviewMinutes?: number;

  openCaseCount: number;
  overdueCaseCount: number;
  slaComplianceRate: number;

  reviewerAgreementRate: number;

  topChangedCoa: TopCoaCorrection[];
  topConflictFlags: TopConflictFlag[];
}

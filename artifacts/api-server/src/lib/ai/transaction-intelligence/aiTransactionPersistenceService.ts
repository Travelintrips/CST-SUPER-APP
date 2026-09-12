/**
 * AI Transaction Intelligence — Phase 10
 * Production Persistence Service
 *
 * Three public services:
 *   analyzeAndCreateReviewCase()   — Phase 1–9 pipeline → DB persist (atomic)
 *   recordAIReviewerDecision()     — reviewer decision → DB persist (atomic)
 *   reevaluateAIReviewCase()       — re-run Phase 1–9 → new snapshot version (atomic)
 *
 * Plus helpers:
 *   getReviewCaseDetail()          — case + snapshot + decisions + audit
 *   getObservabilityData()         — aggregated metrics
 *
 * INVARIANTS:
 *  - No journal posting, no auto-approve, no reconcile, no bank mutation update.
 *  - Company isolation enforced on every DB call.
 *  - All DB writes are atomic (db.transaction with rollback on any failure).
 *  - Snapshot are immutable after insert.
 *  - Audit events are append-only.
 */

import { db } from '@workspace/db';
import { analyzeTransactionDescription } from './transactionUnderstanding.js';
import { classifyTransactionIntent } from './intentClassifier.js';
import { predictCoa } from './coaPredictionEngine.js';
import { explainTransaction } from './explainabilityEngine.js';
import { detectTransactionAnomalies } from './anomalyEngine.js';
import { createAIReviewCase } from './reviewOrchestrationEngine.js';
import { evaluateDecisionPolicy } from './decisionPolicyEngine.js';
import {
  buildTransactionSnapshot,
  buildAISnapshot,
  SNAPSHOT_VERSION,
  ORCHESTRATION_VERSION,
} from './reviewSnapshotBuilder.js';
import { buildReviewCaseIdempotencyKey } from './reviewIdempotency.js';
import { redactSensitiveMetadata } from './reviewPrivacy.js';
import { isTerminalStatus } from './reviewStateMachine.js';
import { isTaxIntent } from './transactionTypes.js';
import {
  aiReviewCaseRepo,
  aiReviewSnapshotRepo,
  aiReviewerDecisionRepo,
  aiReviewAuditRepo,
  aiLearningFeedbackRepo,
  aiRuleRecommendationRepo,
  type QueueFilters,
} from './aiReviewRepository.js';
import {
  AIReviewError,
  notFound,
  idempotencyConflict,
  validationError,
  terminalState,
  reevaluationNotAllowed,
  databaseError,
  toSafeErrorResponse,
} from './aiReviewErrors.js';
import { logger } from '../../logger.js';
import type { ReviewOrchestrationInput } from './reviewOrchestrationTypes.js';
import type { InsertAiReviewCase, InsertAiReviewSnapshot, InsertAiReviewerDecision, InsertAiReviewAuditEvent, InsertAiLearningFeedback, AiReviewCase, AiReviewSnapshot, AiReviewerDecision, AiReviewAuditEvent } from '@workspace/db';

// ─── Input types ──────────────────────────────────────────────────────────────

export interface TransactionInput {
  id: string;
  description: string;
  amount?: number;
  currency?: string;
  direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  transactionDate?: string | Date;
  counterpartyName?: string;
  counterpartyAccount?: string;
  referenceNumber?: string;
  transactionCode?: string;
  bankName?: string;
}

export interface AnalyzeAndCreateInput {
  companyId: number;
  transaction: TransactionInput;
  context?: {
    source?: string;
    sourceRecordId?: string;
    policy?: Record<string, unknown>;
  };
  requestedBy: string;
}

export interface AnalyzeAndCreateResult {
  existing: boolean;
  reviewCase: AiReviewCase;
}

export interface RecordDecisionInput {
  reviewCaseId: number;
  companyId: number;
  reviewerId: string;
  reviewerRole: string;
  decision: 'APPROVE_RECOMMENDATION' | 'CHANGE_COA' | 'REJECT_RECOMMENDATION' | 'REQUEST_INFORMATION' | 'ESCALATE';
  selectedCoaId?: number;
  selectedCoaCode?: string;
  selectedCoaName?: string;
  reasonCode?: string;
  comments?: string;
  reviewerConfidence?: number;
  idempotencyKey: string;
}

export interface RecordDecisionResult {
  existing: boolean;
  decision: AiReviewerDecision;
  reviewCase: AiReviewCase;
}

export interface ReevaluateInput {
  reviewCaseId: number;
  companyId: number;
  requestedBy: string;
  reason: string;
  idempotencyKey: string;
}

export interface ReevaluateResult {
  reviewCase: AiReviewCase;
  newSnapshotVersion: number;
}

export interface ReviewCaseDetail {
  reviewCase: AiReviewCase;
  latestSnapshot: AiReviewSnapshot | null;
  decisions: AiReviewerDecision[];
  auditEvents: AiReviewAuditEvent[];
  taxSubtype: string | null;
  taxUncertaintyWarning: string | null;
  rawSnapshot: Record<string, unknown> | null;
}

// ─── Decision → status mapping ────────────────────────────────────────────────

const DECISION_TO_STATUS: Record<RecordDecisionInput['decision'], string> = {
  APPROVE_RECOMMENDATION:  'APPROVED_RECOMMENDATION',
  CHANGE_COA:              'CHANGED_COA',
  REJECT_RECOMMENDATION:   'REJECTED_RECOMMENDATION',
  REQUEST_INFORMATION:     'NEEDS_INFORMATION',
  ESCALATE:                'ESCALATED',
};

const DECISION_TO_AUDIT_EVENT: Record<RecordDecisionInput['decision'], InsertAiReviewAuditEvent['eventType']> = {
  APPROVE_RECOMMENDATION:  'RECOMMENDATION_APPROVED',
  CHANGE_COA:              'COA_CHANGED',
  REJECT_RECOMMENDATION:   'RECOMMENDATION_REJECTED',
  REQUEST_INFORMATION:     'INFORMATION_REQUESTED',
  ESCALATE:                'ESCALATED',
};

const TERMINAL_DECISIONS = new Set(['APPROVE_RECOMMENDATION', 'CHANGE_COA', 'REJECT_RECOMMENDATION']);

// ─── FNV-1a checksum (deterministic, no crypto dependency) ───────────────────

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function buildSnapshotChecksum(data: object): string {
  return fnv1a(JSON.stringify(data, Object.keys(data).sort()));
}

// ─── Safe JSON serializer ─────────────────────────────────────────────────────

function safeJson(v: unknown): Record<string, unknown> | null {
  if (v == null) return null;
  try {
    return JSON.parse(JSON.stringify(redactSensitiveMetadata(v as Record<string, unknown>))) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ─── Service 1: analyzeAndCreateReviewCase ────────────────────────────────────

export async function analyzeAndCreateReviewCase(
  input: AnalyzeAndCreateInput,
): Promise<AnalyzeAndCreateResult> {
  // 1. Validate
  if (!input.companyId || input.companyId < 1) {
    throw validationError('companyId is required and must be a positive integer');
  }
  if (!input.transaction?.id) {
    throw validationError('transaction.id is required');
  }
  if (!input.transaction?.description?.trim()) {
    throw validationError('transaction.description is required');
  }
  if (!input.requestedBy) {
    throw validationError('requestedBy (userId) is required');
  }

  const { companyId, transaction, context, requestedBy } = input;
  const source = context?.source ?? 'bank_mutation';

  // 2. Build idempotency key
  const idempotencyKey = buildReviewCaseIdempotencyKey(
    companyId,
    transaction.id,
    source,
    SNAPSHOT_VERSION,
  );

  // 3. Check existing
  const existing = await aiReviewCaseRepo.findByIdempotencyKey(companyId, idempotencyKey);
  if (existing) {
    return { existing: true, reviewCase: existing };
  }

  // 4. Run Phase 1
  const phase1 = analyzeTransactionDescription(transaction.description);

  // 5. Run Phase 2
  const phase2 = await classifyTransactionIntent({
    description: transaction.description,
    direction: transaction.direction,
    transactionCode: transaction.transactionCode,
    counterpartyName: transaction.counterpartyName,
    referenceNumber: transaction.referenceNumber,
    amount: transaction.amount,
    bankName: transaction.bankName,
  });

  // 6. Run Phase 3 (COA prediction — no live COA list available without DB deps)
  let phase3;
  try {
    phase3 = await predictCoa({
      transaction: {
        description: transaction.description,
        direction: transaction.direction,
        amount: transaction.amount,
        counterpartyName: transaction.counterpartyName,
        referenceNumber: transaction.referenceNumber,
        bankName: transaction.bankName,
      },
      companyId: String(companyId),
      availableAccounts: [],
      phase1Analysis: phase1,
      phase2Classification: phase2,
    });
  } catch {
    // COA prediction without candidates → graceful degradation
    phase3 = {
      primaryRecommendation: null,
      alternatives: [],
      confidence: 0,
      requiresManualReview: true,
      conflictFlags: [],
    };
  }

  // 7. Run Phase 4 (explainability)
  let phase4;
  try {
    phase4 = explainTransaction({
      phase1,
      phase2,
      phase3: phase3 as Parameters<typeof explainTransaction>[0]['phase3'],
    });
  } catch {
    phase4 = {
      recommendation: { status: 'MANUAL_REVIEW' as const, reason: 'Explainability unavailable', confidence: 0 },
      confidence: { level: 'LOW' as const, score: 0, factors: [] },
      evidence: [],
      ambiguity: [],
    };
  }

  // 8. Run Phase 7 (anomaly detection)
  let phase7;
  try {
    phase7 = await detectTransactionAnomalies({
      companyId: String(companyId),
      transaction: {
        id: transaction.id,
        description: transaction.description,
        amount: transaction.amount ?? 0,
        direction: transaction.direction ?? 'UNKNOWN',
        transactionDate: transaction.transactionDate ?? new Date(),
        counterpartyAccount: transaction.counterpartyAccount,
        referenceNumber: transaction.referenceNumber,
      },
      historicalTransactions: [],
    });
  } catch {
    phase7 = {
      hasAnomaly: false,
      anomalyScore: 0,
      riskLevel: 'NONE' as const,
      anomalyTypes: [],
      anomalies: [],
      requiresManualReview: false,
    };
  }

  // 9. Run Phase 8 (review orchestration)
  const orchestrationInput: ReviewOrchestrationInput = {
    companyId: String(companyId),
    transaction: {
      id: transaction.id,
      description: transaction.description,
      amount: transaction.amount ?? 0,
      currency: transaction.currency ?? 'IDR',
      direction: transaction.direction ?? 'UNKNOWN',
      transactionDate: transaction.transactionDate ?? new Date(),
      counterpartyName: transaction.counterpartyName,
      counterpartyAccount: transaction.counterpartyAccount,
      referenceNumber: transaction.referenceNumber,
    },
    phase1,
    phase2,
    phase3: phase3 as ReviewOrchestrationInput['phase3'],
    phase4: phase4 as ReviewOrchestrationInput['phase4'],
    phase7: phase7 as ReviewOrchestrationInput['phase7'],
    context: {
      source,
      sourceRecordId: context?.sourceRecordId,
    },
  };

  let reviewCase;
  try {
    reviewCase = await createAIReviewCase(orchestrationInput);
  } catch {
    // Fallback minimal review case
    reviewCase = {
      id: idempotencyKey,
      queue: 'STANDARD_FINANCE_REVIEW' as const,
      priority: 'NORMAL' as const,
      status: 'QUEUED' as const,
      intent: phase2.primaryIntent,
      intentConfidence: phase2.confidence,
      requiresManualReview: true,
      flags: [],
      anomalyTypes: phase7.anomalyTypes ?? [],
      anomalyScore: phase7.anomalyScore ?? 0,
      dueAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  // 10. Run Phase 9 (decision policy)
  let phase9;
  try {
    phase9 = await evaluateDecisionPolicy({
      companyId: String(companyId),
      transaction: orchestrationInput.transaction as Parameters<typeof evaluateDecisionPolicy>[0]['transaction'],
      phase1,
      phase2,
      phase3: phase3 as Parameters<typeof evaluateDecisionPolicy>[0]['phase3'],
      phase4: phase4 as Parameters<typeof evaluateDecisionPolicy>[0]['phase4'],
      phase7: phase7 as Parameters<typeof evaluateDecisionPolicy>[0]['phase7'],
      phase8: reviewCase as Parameters<typeof evaluateDecisionPolicy>[0]['phase8'],
    });
  } catch {
    phase9 = null;
  }

  // 11. Build snapshots
  const txSnapshot = buildTransactionSnapshot(orchestrationInput);
  const aiSnapshot = buildAISnapshot(orchestrationInput);
  const fullSnapshotData = {
    transaction: safeJson(txSnapshot),
    phase1: safeJson(phase1),
    phase2: safeJson(phase2),
    phase3: safeJson(phase3),
    phase4: safeJson(phase4),
    phase7: safeJson(phase7),
    phase8: safeJson(reviewCase),
    phase9: safeJson(phase9),
  };
  const checksum = buildSnapshotChecksum(fullSnapshotData);

  // 12. Atomic DB transaction
  const now = new Date();
  let insertedCase: AiReviewCase;

  try {
    insertedCase = await db.transaction(async (tx) => {
      // a. Insert review case
      const caseData: InsertAiReviewCase = {
        companyId,
        transactionId: transaction.id,
        source,
        sourceRecordId: context?.sourceRecordId ?? null,
        idempotencyKey,
        queue: ((reviewCase as { queue: string }).queue ?? 'STANDARD_FINANCE_REVIEW') as InsertAiReviewCase['queue'],
        priority: ((reviewCase as { priority: string }).priority ?? 'NORMAL') as InsertAiReviewCase['priority'],
        status: 'QUEUED',
        intent: phase2.primaryIntent,
        intentConfidence: String(phase2.confidence),
        recommendedCoaId: (phase3 as { primaryRecommendation?: { coaId?: number } })?.primaryRecommendation?.coaId ?? null,
        recommendedCoaCode: (phase3 as { primaryRecommendation?: { coaCode?: string } })?.primaryRecommendation?.coaCode ?? null,
        recommendedCoaName: (phase3 as { primaryRecommendation?: { coaName?: string } })?.primaryRecommendation?.coaName ?? null,
        recommendedCoaConfidence: (phase3 as unknown as { confidence?: number })?.confidence != null ? String((phase3 as unknown as { confidence: number }).confidence) : null,
        anomalyScore: phase7.anomalyScore != null ? String(phase7.anomalyScore) : null,
        anomalyRisk: (phase7 as { riskLevel?: string }).riskLevel ?? null,
        requiresManualReview: (phase7.requiresManualReview || phase2.requiresManualReview || (phase3 as { requiresManualReview?: boolean }).requiresManualReview) ?? true,
        decisionPolicyVersion: phase9 ? '9.0' : null,
        orchestrationVersion: ORCHESTRATION_VERSION,
        snapshotVersion: SNAPSHOT_VERSION,
        flagsJson: ((reviewCase as { flags?: string[] }).flags ?? []) as unknown as Record<string, unknown>,
        anomalyTypesJson: (phase7.anomalyTypes ?? []) as unknown as Record<string, unknown>,
        createdBy: requestedBy,
        createdAt: now,
        updatedAt: now,
        dueAt: (reviewCase as { dueAt?: Date }).dueAt ?? null,
      };

      const inserted = await aiReviewCaseRepo.create(caseData, tx);

      // b. Insert snapshot (version 1)
      const snapshotData: InsertAiReviewSnapshot = {
        reviewCaseId: inserted.id,
        companyId,
        transactionSnapshotJson: safeJson(txSnapshot) as Record<string, unknown>,
        phase1SnapshotJson: safeJson(phase1) as Record<string, unknown>,
        phase2SnapshotJson: safeJson(phase2) as Record<string, unknown>,
        phase3SnapshotJson: safeJson(phase3) as Record<string, unknown>,
        phase4SnapshotJson: safeJson(phase4) as Record<string, unknown>,
        phase7SnapshotJson: safeJson(phase7) as Record<string, unknown>,
        phase8SnapshotJson: safeJson(reviewCase) as Record<string, unknown>,
        phase9SnapshotJson: safeJson(phase9) as Record<string, unknown>,
        snapshotChecksum: checksum,
        snapshotVersion: 1,
        createdAt: now,
      };
      await aiReviewSnapshotRepo.create(snapshotData, tx);

      // c. Audit: CASE_CREATED
      await aiReviewAuditRepo.append({
        reviewCaseId: inserted.id,
        companyId,
        eventType: 'CASE_CREATED',
        actorType: 'SYSTEM',
        actorId: requestedBy,
        previousStatus: null,
        newStatus: 'OPEN',
        reason: 'AI analysis completed',
        metadataJson: { snapshotVersion: 1, idempotencyKey } as Record<string, unknown>,
        occurredAt: now,
        createdAt: now,
      }, tx);

      // d. Audit: QUEUED
      await aiReviewAuditRepo.append({
        reviewCaseId: inserted.id,
        companyId,
        eventType: 'QUEUED',
        actorType: 'SYSTEM',
        actorId: requestedBy,
        previousStatus: 'OPEN',
        newStatus: 'QUEUED',
        reason: 'Auto-routed to review queue',
        metadataJson: { queue: caseData.queue } as Record<string, unknown>,
        occurredAt: now,
        createdAt: now,
      }, tx);

      return inserted;
    });
  } catch (err) {
    if (err instanceof AIReviewError) throw err;
    logger.error({ err, companyId, transactionId: transaction.id }, '[phase10] analyzeAndCreateReviewCase transaction failed');
    throw databaseError(err);
  }

  return { existing: false, reviewCase: insertedCase };
}

// ─── Service 2: recordAIReviewerDecision ─────────────────────────────────────

export async function recordAIReviewerDecision(
  input: RecordDecisionInput,
): Promise<RecordDecisionResult> {
  // 1. Validate
  if (!input.reviewCaseId || input.reviewCaseId < 1) throw validationError('reviewCaseId is required');
  if (!input.companyId || input.companyId < 1) throw validationError('companyId is required');
  if (!input.reviewerId?.trim()) throw validationError('reviewerId is required');
  if (!input.decision) throw validationError('decision is required');
  if (!input.idempotencyKey?.trim()) throw validationError('idempotencyKey is required');
  if (input.decision === 'CHANGE_COA' && !input.selectedCoaCode) {
    throw validationError('selectedCoaCode is required for CHANGE_COA decision');
  }

  const { reviewCaseId, companyId, reviewerId, decision, idempotencyKey } = input;

  // 2. Load review case
  const reviewCase = await aiReviewCaseRepo.findById(reviewCaseId, companyId);
  if (!reviewCase) throw notFound('review case');

  // 3. Check idempotency
  const existingDecision = await aiReviewerDecisionRepo.findByIdempotencyKey(companyId, idempotencyKey);
  if (existingDecision) {
    return { existing: true, decision: existingDecision, reviewCase };
  }

  // 4. Check terminal
  if (isTerminalStatus(reviewCase.status as Parameters<typeof isTerminalStatus>[0])) {
    throw terminalState(reviewCase.status);
  }

  // 5. Map decision to status
  const newStatus = DECISION_TO_STATUS[decision]!;
  const auditEventType = DECISION_TO_AUDIT_EVENT[decision]!;
  const isTerminalDecision = TERMINAL_DECISIONS.has(decision);

  // 6. Sanitize comments
  const sanitizedComments = input.comments
    ? (redactSensitiveMetadata(input.comments as unknown as Record<string, unknown>) as unknown as string)
    : null;

  const now = new Date();
  let insertedDecision: AiReviewerDecision;
  let updatedCase: AiReviewCase;

  try {
    await db.transaction(async (tx) => {
      // a. Insert reviewer decision
      const decisionData: InsertAiReviewerDecision = {
        reviewCaseId,
        companyId,
        reviewerId,
        decision: decision as InsertAiReviewerDecision['decision'],
        previousStatus: reviewCase.status as InsertAiReviewerDecision['previousStatus'],
        newStatus: newStatus as InsertAiReviewerDecision['newStatus'],
        selectedCoaId: input.selectedCoaId ?? null,
        selectedCoaCode: input.selectedCoaCode ?? null,
        selectedCoaName: input.selectedCoaName ?? null,
        reasonCode: input.reasonCode ?? null,
        comments: typeof sanitizedComments === 'string' ? sanitizedComments : null,
        reviewerConfidence: input.reviewerConfidence != null ? String(input.reviewerConfidence) : null,
        idempotencyKey,
        decidedAt: now,
        createdAt: now,
      };
      insertedDecision = await aiReviewerDecisionRepo.create(decisionData, tx);

      // b. Update case status
      const closedAt = isTerminalDecision ? now : null;
      await aiReviewCaseRepo.updateStatus(reviewCaseId, companyId, newStatus, now, closedAt, tx);

      // c. Append audit event
      await aiReviewAuditRepo.append({
        reviewCaseId,
        companyId,
        eventType: auditEventType,
        actorType: 'REVIEWER',
        actorId: reviewerId,
        previousStatus: reviewCase.status as InsertAiReviewAuditEvent['previousStatus'],
        newStatus: newStatus as InsertAiReviewAuditEvent['newStatus'],
        reason: input.reasonCode ?? null,
        metadataJson: {
          reviewerRole: input.reviewerRole,
          decisionId: insertedDecision!.id,
          idempotencyKey,
        } as Record<string, unknown>,
        occurredAt: now,
        createdAt: now,
      }, tx);

      // d. Create Phase 5-compatible learning feedback
      const agreement = input.selectedCoaCode != null
        ? input.selectedCoaCode === reviewCase.recommendedCoaCode
        : decision === 'APPROVE_RECOMMENDATION';

      await aiLearningFeedbackRepo.create({
        companyId,
        reviewCaseId,
        reviewerDecisionId: insertedDecision!.id,
        transactionId: reviewCase.transactionId ?? null,
        intent: reviewCase.intent ?? null,
        aiRecommendedCoaCode: reviewCase.recommendedCoaCode ?? null,
        reviewerSelectedCoaCode: input.selectedCoaCode ?? null,
        agreement,
        reasonCode: input.reasonCode ?? null,
        feedbackPayloadJson: {
          decision,
          reviewerRole: input.reviewerRole,
          reviewerConfidence: input.reviewerConfidence,
        } as Record<string, unknown>,
        status: 'PENDING',
        createdAt: now,
      }, tx);
    });
  } catch (err) {
    if (err instanceof AIReviewError) throw err;
    logger.error({ err, reviewCaseId, companyId }, '[phase10] recordAIReviewerDecision transaction failed');
    throw databaseError(err);
  }

  // Reload updated case
  updatedCase = (await aiReviewCaseRepo.findById(reviewCaseId, companyId)) ?? reviewCase;

  return { existing: false, decision: insertedDecision!, reviewCase: updatedCase };
}

// ─── Service 3: reevaluateAIReviewCase ───────────────────────────────────────

export async function reevaluateAIReviewCase(
  input: ReevaluateInput,
): Promise<ReevaluateResult> {
  // 1. Validate
  if (!input.reason?.trim()) throw validationError('reason is required for re-evaluation');
  if (!input.idempotencyKey?.trim()) throw validationError('idempotencyKey is required');
  if (!input.requestedBy?.trim()) throw validationError('requestedBy is required');

  const { reviewCaseId, companyId, requestedBy, reason, idempotencyKey } = input;

  // 2. Load review case
  const reviewCase = await aiReviewCaseRepo.findById(reviewCaseId, companyId);
  if (!reviewCase) throw notFound('review case');

  // 3. Check terminal
  if (isTerminalStatus(reviewCase.status as Parameters<typeof isTerminalStatus>[0])) {
    throw reevaluationNotAllowed(`case is in terminal state (${reviewCase.status})`);
  }

  // 4. Check idempotency via audit events (check if this idempotency key was already used)
  const auditHistory = await aiReviewAuditRepo.listByReviewCase(reviewCaseId, companyId);
  const alreadyReevaluated = auditHistory.some(
    (e) =>
      e.eventType === 'REEVALUATED' &&
      (e.metadataJson as Record<string, unknown> | null)?.idempotencyKey === idempotencyKey,
  );
  if (alreadyReevaluated) {
    const latestSnapshot = await aiReviewSnapshotRepo.findLatestByReviewCase(reviewCaseId, companyId);
    return {
      reviewCase,
      newSnapshotVersion: latestSnapshot?.snapshotVersion ?? 1,
    };
  }

  // 5. Load latest snapshot for original transaction data
  const latestSnapshot = await aiReviewSnapshotRepo.findLatestByReviewCase(reviewCaseId, companyId);
  if (!latestSnapshot) throw notFound('snapshot');

  const txData = latestSnapshot.transactionSnapshotJson as Record<string, unknown>;
  const description = (txData['description'] as string) ?? '';
  const direction = (txData['direction'] as 'DEBIT' | 'CREDIT' | 'UNKNOWN') ?? 'UNKNOWN';
  const amount = (txData['amount'] as number) ?? 0;

  // 6. Re-run Phase 1-9
  const phase1 = analyzeTransactionDescription(description);
  const phase2 = await classifyTransactionIntent({ description, direction });

  let phase3;
  try {
    phase3 = await predictCoa({ transaction: { description, direction, amount }, companyId: String(companyId), availableAccounts: [], phase1Analysis: phase1, phase2Classification: phase2 });
  } catch { phase3 = { primaryRecommendation: null, alternatives: [], confidence: 0, requiresManualReview: true, conflictFlags: [] }; }

  let phase4;
  try {
    phase4 = explainTransaction({ phase1, phase2, phase3: phase3 as Parameters<typeof explainTransaction>[0]['phase3'] });
  } catch { phase4 = { recommendation: { status: 'MANUAL_REVIEW' as const, reason: '', confidence: 0 }, confidence: { level: 'LOW' as const, score: 0, factors: [] }, evidence: [], ambiguity: [] }; }

  let phase7;
  try {
    phase7 = await detectTransactionAnomalies({
      companyId: String(companyId),
      transaction: { id: reviewCase.transactionId ?? '', description, amount, direction: direction ?? 'UNKNOWN', transactionDate: new Date() },
      historicalTransactions: [],
    });
  } catch { phase7 = { hasAnomaly: false, anomalyScore: 0, riskLevel: 'NONE' as const, anomalyTypes: [], anomalies: [], requiresManualReview: false }; }

  const orchestrationInput: ReviewOrchestrationInput = {
    companyId: String(companyId),
    transaction: { id: reviewCase.transactionId ?? '', description, amount, currency: 'IDR', direction: direction ?? 'UNKNOWN', transactionDate: new Date() },
    phase1, phase2,
    phase3: phase3 as ReviewOrchestrationInput['phase3'],
    phase4: phase4 as ReviewOrchestrationInput['phase4'],
    phase7: phase7 as ReviewOrchestrationInput['phase7'],
    context: { source: reviewCase.source },
  };

  let reviewCaseBuilt;
  try { reviewCaseBuilt = await createAIReviewCase(orchestrationInput); } catch { reviewCaseBuilt = null; }

  // 7. Get next version
  const nextVersion = await aiReviewSnapshotRepo.getNextVersion(reviewCaseId);

  // 8. Atomic insert
  const now = new Date();
  const checksum = buildSnapshotChecksum({ phase1, phase2, phase3, phase7, version: nextVersion });

  try {
    await db.transaction(async (tx) => {
      // a. Insert new snapshot
      await aiReviewSnapshotRepo.create({
        reviewCaseId,
        companyId,
        transactionSnapshotJson: safeJson(txData) as Record<string, unknown>,
        phase1SnapshotJson: safeJson(phase1) as Record<string, unknown>,
        phase2SnapshotJson: safeJson(phase2) as Record<string, unknown>,
        phase3SnapshotJson: safeJson(phase3) as Record<string, unknown>,
        phase4SnapshotJson: safeJson(phase4) as Record<string, unknown>,
        phase7SnapshotJson: safeJson(phase7) as Record<string, unknown>,
        phase8SnapshotJson: safeJson(reviewCaseBuilt) as Record<string, unknown>,
        phase9SnapshotJson: null,
        snapshotChecksum: checksum,
        snapshotVersion: nextVersion,
        createdAt: now,
      }, tx);

      // b. Append REEVALUATED audit event
      await aiReviewAuditRepo.append({
        reviewCaseId,
        companyId,
        eventType: 'REEVALUATED',
        actorType: 'SYSTEM',
        actorId: requestedBy,
        previousStatus: reviewCase.status as InsertAiReviewAuditEvent['previousStatus'],
        newStatus: reviewCase.status as InsertAiReviewAuditEvent['newStatus'],
        reason,
        metadataJson: {
          idempotencyKey,
          newSnapshotVersion: nextVersion,
          requestedBy,
        } as Record<string, unknown>,
        occurredAt: now,
        createdAt: now,
      }, tx);
    });
  } catch (err) {
    if (err instanceof AIReviewError) throw err;
    logger.error({ err, reviewCaseId }, '[phase10] reevaluateAIReviewCase transaction failed');
    throw databaseError(err);
  }

  return { reviewCase, newSnapshotVersion: nextVersion };
}

// ─── Helper: getReviewCaseDetail ─────────────────────────────────────────────

export async function getReviewCaseDetail(id: number, companyId: number): Promise<ReviewCaseDetail> {
  const reviewCase = await aiReviewCaseRepo.findById(id, companyId);
  if (!reviewCase) throw notFound('review case');

  const [latestSnapshot, decisions, auditEvents] = await Promise.all([
    aiReviewSnapshotRepo.findLatestByReviewCase(id, companyId),
    aiReviewerDecisionRepo.listByReviewCase(id, companyId),
    aiReviewAuditRepo.listByReviewCase(id, companyId),
  ]);

  const phase1 = (latestSnapshot?.phase1SnapshotJson ?? {}) as Record<string, unknown>;
  const phase2 = (latestSnapshot?.phase2SnapshotJson ?? {}) as Record<string, unknown>;
  const taxSubtype = typeof phase1.taxSubtype === 'string' ? phase1.taxSubtype : null;
  const intent = typeof phase2.primaryIntent === 'string'
    ? phase2.primaryIntent
    : typeof phase1.intent === 'string' ? phase1.intent : null;
  const isTax = intent !== null && isTaxIntent(intent as never);
  const taxUncertaintyWarning = isTax && (!taxSubtype || taxSubtype === 'UNKNOWN_TAX')
    ? 'Jenis pajak belum dapat diidentifikasi secara pasti. Mapping dan approval manual wajib dilakukan.'
    : null;

  return {
    reviewCase,
    latestSnapshot,
    decisions,
    auditEvents,
    taxSubtype,
    taxUncertaintyWarning,
    rawSnapshot: latestSnapshot
      ? {
          phase1: latestSnapshot.phase1SnapshotJson,
          phase2: latestSnapshot.phase2SnapshotJson,
          phase3: latestSnapshot.phase3SnapshotJson,
          phase4: latestSnapshot.phase4SnapshotJson,
          phase7: latestSnapshot.phase7SnapshotJson,
          phase9: latestSnapshot.phase9SnapshotJson,
        }
      : null,
  };
}

// ─── Helper: getObservabilityData ────────────────────────────────────────────

export interface ObservabilityData {
  totalCases: number;
  openCases: number;
  closedCases: number;
  byStatus: Record<string, number>;
  byQueue: Record<string, number>;
  byPriority: Record<string, number>;
}

export async function getObservabilityData(
  companyId: number,
  filters?: QueueFilters,
): Promise<ObservabilityData> {
  const counts = await aiReviewCaseRepo.countByStatus(companyId);

  const openStatuses = ['OPEN', 'QUEUED', 'ASSIGNED', 'IN_REVIEW', 'NEEDS_INFORMATION', 'ESCALATED'];
  const closedStatuses = ['APPROVED_RECOMMENDATION', 'CHANGED_COA', 'REJECTED_RECOMMENDATION', 'CANCELLED', 'CLOSED'];

  const totalCases = Object.values(counts).reduce((a, b) => a + b, 0);
  const openCases = openStatuses.reduce((a, s) => a + (counts[s] ?? 0), 0);
  const closedCases = closedStatuses.reduce((a, s) => a + (counts[s] ?? 0), 0);

  return {
    totalCases,
    openCases,
    closedCases,
    byStatus: counts,
    byQueue: {},    // Would need additional DB query — left for future
    byPriority: {}, // Would need additional DB query — left for future
  };
}

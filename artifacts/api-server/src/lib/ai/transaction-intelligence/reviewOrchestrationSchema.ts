/**
 * AI Transaction Intelligence — Phase 8
 * Review Orchestration — Zod Schemas
 *
 * Runtime validation schemas for Phase 8 types.
 */

import { z } from 'zod';

// ─── Enum schemas ─────────────────────────────────────────────────────────────

export const ReviewQueueSchema = z.enum([
  'AUTO_CLEAR_CANDIDATE',
  'STANDARD_FINANCE_REVIEW',
  'ACCOUNTING_REVIEW',
  'TREASURY_REVIEW',
  'TAX_REVIEW',
  'PAYROLL_REVIEW',
  'INTERCOMPANY_REVIEW',
  'ANOMALY_REVIEW',
  'HIGH_RISK_REVIEW',
  'DATA_QUALITY_REVIEW',
]);

export const ReviewPrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT', 'CRITICAL']);

export const ReviewStatusSchema = z.enum([
  'OPEN',
  'QUEUED',
  'ASSIGNED',
  'IN_REVIEW',
  'NEEDS_INFORMATION',
  'APPROVED_RECOMMENDATION',
  'CHANGED_COA',
  'REJECTED_RECOMMENDATION',
  'ESCALATED',
  'CANCELLED',
  'CLOSED',
]);

export const ReviewDecisionTypeSchema = z.enum([
  'APPROVE_RECOMMENDATION',
  'CHANGE_COA',
  'REJECT_RECOMMENDATION',
  'REQUEST_INFORMATION',
  'ESCALATE',
]);

// ─── Policy schema ────────────────────────────────────────────────────────────

export const ReviewOrchestrationPolicySchema = z.object({
  autoClearMinimumConfidence:    z.number().min(0).max(1).optional(),
  autoClearMaximumAnomalyScore:  z.number().min(0).max(1).optional(),
  highValueThreshold:            z.number().min(0).optional(),
  criticalValueThreshold:        z.number().min(0).optional(),
  standardSlaMinutes:            z.number().min(1).optional(),
  highPrioritySlaMinutes:        z.number().min(1).optional(),
  urgentSlaMinutes:              z.number().min(1).optional(),
  criticalSlaMinutes:            z.number().min(1).optional(),
  forceManualReviewForIntents:   z.array(z.string()).optional(),
  forceManualReviewForFlags:     z.array(z.string()).optional(),
});

// ─── Reviewer decision input schema ──────────────────────────────────────────

export const SelectedCoaSchema = z.object({
  coaId:   z.union([z.string(), z.number()]),
  coaCode: z.string().min(1),
  coaName: z.string().min(1),
});

export const ReviewerDecisionInputSchema = z.object({
  reviewCaseId:       z.string().min(1),
  companyId:          z.union([z.string(), z.number()]),
  reviewerId:         z.union([z.string(), z.number()]),
  decision:           ReviewDecisionTypeSchema,
  selectedCoa:        SelectedCoaSchema.optional(),
  reasonCode:         z.string().optional(),
  comments:           z.string().optional(),
  reviewerConfidence: z.number().min(0).max(1).optional(),
  idempotencyKey:     z.string().min(1),
  decidedAt:          z.union([z.string(), z.date()]),
});

// ─── SLA schema ───────────────────────────────────────────────────────────────

export const ReviewSlaSchema = z.object({
  createdAt:     z.string(),
  dueAt:         z.string().optional(),
  ageMinutes:    z.number().min(0),
  isOverdue:     z.boolean(),
  targetMinutes: z.number().min(0).optional(),
});

// ─── AI snapshot schema ────────────────────────────────────────────────────────

export const AISnapshotCoaSchema = z.object({
  coaId:      z.union([z.string(), z.number()]),
  coaCode:    z.string(),
  coaName:    z.string(),
  confidence: z.number().min(0).max(1),
});

export const AISnapshotSchema = z.object({
  intent:               z.string(),
  intentConfidence:     z.number().min(0).max(1),
  recommendedCoa:       AISnapshotCoaSchema.nullable(),
  alternatives:         z.array(AISnapshotCoaSchema),
  explanationSummary:   z.string(),
  evidenceSummary:      z.array(z.string()),
  conflictFlags:        z.array(z.string()),
  anomalyScore:         z.number().min(0).max(1),
  anomalyRisk:          z.string(),
  anomalyTypes:         z.array(z.string()),
  requiresManualReview: z.boolean(),
  snapshotVersion:      z.string(),
  snapshotChecksum:     z.string(),
  evaluatedAt:          z.string(),
  engineVersions:       z.record(z.string()),
});

// ─── Transaction snapshot schema ─────────────────────────────────────────────

export const TransactionSnapshotSchema = z.object({
  transactionId:            z.union([z.string(), z.number()]),
  description:              z.string(),
  amount:                   z.number(),
  currency:                 z.string().optional(),
  direction:                z.string().optional(),
  transactionDate:          z.string(),
  maskedCounterpartyAccount: z.string().optional(),
  referenceNumber:          z.string().optional(),
});

// ─── Reviewer decision record schema ─────────────────────────────────────────

export const ReviewerDecisionRecordSchema = z.object({
  id:                 z.string(),
  reviewCaseId:       z.string(),
  companyId:          z.union([z.string(), z.number()]),
  reviewerId:         z.union([z.string(), z.number()]),
  decision:           ReviewDecisionTypeSchema,
  previousStatus:     ReviewStatusSchema,
  newStatus:          ReviewStatusSchema,
  selectedCoa:        SelectedCoaSchema.optional(),
  reasonCode:         z.string().optional(),
  comments:           z.string().optional(),
  reviewerConfidence: z.number().min(0).max(1).optional(),
  idempotencyKey:     z.string(),
  createdAt:          z.string(),
  feedbackPayload:    z.object({
    phase5Compatible:     z.literal(true),
    reviewerDecision:     z.string(),
    aiRecommendedCoa:     z.string().optional(),
    reviewerSelectedCoa:  z.string().optional(),
    agreement:            z.boolean(),
  }).optional(),
});

// ─── Review case schema ───────────────────────────────────────────────────────

export const AIReviewCaseSchema = z.object({
  id:                   z.string(),
  idempotencyKey:       z.string(),
  companyId:            z.union([z.string(), z.number()]),
  transactionSnapshot:  TransactionSnapshotSchema,
  aiSnapshot:           AISnapshotSchema,
  queue:                ReviewQueueSchema,
  priority:             ReviewPrioritySchema,
  status:               ReviewStatusSchema,
  sla:                  ReviewSlaSchema,
  flags:                z.array(z.string()),
  reviewerAssignment:   z.object({
    reviewerId:   z.union([z.string(), z.number()]).optional(),
    reviewerRole: z.string().optional(),
    assignedAt:   z.string().optional(),
  }).optional(),
  decision:             ReviewerDecisionRecordSchema.optional(),
  createdAt:            z.string(),
  updatedAt:            z.string(),
  requiresHumanDecision: z.literal(true),
  orchestrationVersion:  z.literal('1.0'),
});

// ─── Inferred types ───────────────────────────────────────────────────────────

export type ReviewerDecisionInputValidated = z.infer<typeof ReviewerDecisionInputSchema>;
export type AIReviewCaseValidated = z.infer<typeof AIReviewCaseSchema>;

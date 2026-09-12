/**
 * AI Transaction Intelligence — Phase 5
 * Learning & Feedback Engine — Zod Schemas
 *
 * Validates all Phase 5 input and output types.
 * Pure schema definitions — no business logic.
 */

import { z } from 'zod';

// ─── Reviewer Decision ─────────────────────────────────────────────────────────

export const ReviewerDecisionSchema = z.enum([
  'APPROVED',
  'CHANGED_COA',
  'REJECTED',
  'SKIPPED',
  'UNKNOWN',
]);

export type ReviewerDecisionValidated = z.infer<typeof ReviewerDecisionSchema>;

// ─── Learning Status ───────────────────────────────────────────────────────────

export const LearningStatusSchema = z.enum([
  'NO_ACTION',
  'COLLECTING',
  'READY_FOR_RULE',
  'READY_FOR_DICTIONARY',
  'READY_FOR_REVIEW',
]);

export type LearningStatusValidated = z.infer<typeof LearningStatusSchema>;

// ─── Feedback Record ───────────────────────────────────────────────────────────

export const FeedbackRecordSchema = z.object({
  feedbackId: z.string(),
  companyId: z.union([z.string(), z.number()]),
  reviewerId: z.string(),
  decision: ReviewerDecisionSchema,
  selectedCoaId: z.union([z.string(), z.number()]).optional(),
  selectedCoaCode: z.string().optional(),
  selectedCoaName: z.string().optional(),
  comment: z.string().optional(),
  reviewerConfidence: z.number().min(0).max(1).optional(),
  reviewedAt: z.union([z.string(), z.date()]),
  presentedAt: z.union([z.string(), z.date()]).optional(),
  aiRecommendedCoaCode: z.string().optional(),
  aiRecommendedIntent: z.string().optional(),
  aiConfidenceAtReview: z.number().min(0).max(1).optional(),
  transactionDescription: z.string().optional(),
  normalizedDescription: z.string().optional(),
  counterpartyName: z.string().optional(),
  transactionCode: z.string().optional(),
});

export type FeedbackRecordValidated = z.infer<typeof FeedbackRecordSchema>;

// ─── Feedback Summary ──────────────────────────────────────────────────────────

export const FeedbackSummarySchema = z.object({
  totalCount: z.number().int().min(0),
  approvedCount: z.number().int().min(0),
  changedCoaCount: z.number().int().min(0),
  rejectedCount: z.number().int().min(0),
  skippedCount: z.number().int().min(0),
  unknownCount: z.number().int().min(0),
  approvalRate: z.number().min(0).max(1),
  changeRate: z.number().min(0).max(1),
  rejectionRate: z.number().min(0).max(1),
  dominantCorrectedCoaCode: z.string().optional(),
  dominantCorrectedCoaName: z.string().optional(),
  distinctReviewerCount: z.number().int().min(0),
  reviewersAgreeing: z.boolean(),
  dominantDecision: ReviewerDecisionSchema,
});

export type FeedbackSummaryValidated = z.infer<typeof FeedbackSummarySchema>;

// ─── Feedback Reliability ──────────────────────────────────────────────────────

export const FeedbackReliabilitySchema = z.object({
  score: z.number().min(0).max(1),
  level: z.enum(['HIGH', 'MEDIUM', 'LOW', 'VERY_LOW']),
  approvalCount: z.number().int().min(0),
  rejectionCount: z.number().int().min(0),
  reviewerConsistency: z.number().min(0).max(1),
  historicalAgreement: z.number().min(0).max(1),
  companyScopeConsistent: z.boolean(),
  intentConsistency: z.number().min(0).max(1),
  counterpartyConsistency: z.number().min(0).max(1),
  coaConsistency: z.number().min(0).max(1),
  confidenceTrend: z.enum(['IMPROVING', 'STABLE', 'DECLINING', 'INSUFFICIENT_DATA']),
  reasons: z.array(z.string()),
});

export type FeedbackReliabilityValidated = z.infer<typeof FeedbackReliabilitySchema>;

// ─── Rule Suggestion ───────────────────────────────────────────────────────────

export const RuleSuggestionTypeSchema = z.enum([
  'KEYWORD',
  'ALIAS',
  'COUNTERPARTY_MAPPING',
  'HISTORICAL_MAPPING',
  'RULE_CANDIDATE',
  'THRESHOLD_CANDIDATE',
]);

export const SuggestedRuleSchema = z.object({
  type: RuleSuggestionTypeSchema,
  label: z.string(),
  description: z.string(),
  value: z.string(),
  intent: z.string().optional(),
  coaCode: z.string().optional(),
  confidence: z.number().min(0).max(1),
  supportingCount: z.number().int().min(0),
  requiresHumanApproval: z.literal(true),
});

export type SuggestedRuleValidated = z.infer<typeof SuggestedRuleSchema>;

// ─── Dictionary Term Suggestion ────────────────────────────────────────────────

export const SuggestedDictionaryTermSchema = z.object({
  term: z.string(),
  intent: z.string(),
  weight: z.number().min(0).max(1),
  exactMatch: z.boolean(),
  supportingCount: z.number().int().min(0),
  confidence: z.number().min(0).max(1),
  requiresHumanApproval: z.literal(true),
});

export type SuggestedDictionaryTermValidated = z.infer<typeof SuggestedDictionaryTermSchema>;

// ─── Learning Statistics ───────────────────────────────────────────────────────

export const LearningStatisticsSchema = z.object({
  totalFeedback: z.number().int().min(0),
  approvalRate: z.number().min(0).max(1),
  manualReviewRate: z.number().min(0).max(1),
  changeRate: z.number().min(0).max(1),
  topCorrectedIntents: z.array(z.object({
    intent: z.string(),
    correctionCount: z.number().int().min(0),
    totalCount: z.number().int().min(0),
    correctionRate: z.number().min(0).max(1),
  })),
  topCorrectedCoa: z.array(z.object({
    aiCoaCode: z.string(),
    reviewerCoaCode: z.string(),
    count: z.number().int().min(0),
  })),
  topAmbiguousPatterns: z.array(z.object({
    normalizedDescription: z.string(),
    manualReviewCount: z.number().int().min(0),
  })),
  avgReviewTurnaroundMinutes: z.number().nullable(),
  feedbackDistribution: z.record(z.number()),
  distinctReviewers: z.number().int().min(0),
  distinctCompanies: z.number().int().min(0),
});

export type LearningStatisticsValidated = z.infer<typeof LearningStatisticsSchema>;

// ─── Learning Evidence ─────────────────────────────────────────────────────────

export const LearningEvidenceSchema = z.object({
  type: z.enum([
    'FEEDBACK_PATTERN',
    'REVIEWER_AGREEMENT',
    'HISTORICAL_CONSISTENCY',
    'CONFIDENCE_SIGNAL',
    'COUNTERPARTY_PATTERN',
    'INTENT_PATTERN',
    'COA_PATTERN',
  ]),
  description: z.string(),
  weight: z.number().min(0).max(1),
  count: z.number().int().min(0),
});

export type LearningEvidenceValidated = z.infer<typeof LearningEvidenceSchema>;

// ─── Feedback Conflict ─────────────────────────────────────────────────────────

export const FeedbackConflictSchema = z.object({
  type: z.enum([
    'REVIEWER_DISAGREEMENT',
    'COA_DISAGREEMENT',
    'INTENT_DISAGREEMENT',
    'COMPANY_MISMATCH',
    'LOW_CONFIDENCE_PATTERN',
    'HISTORICAL_CONTRADICTION',
  ]),
  description: z.string(),
  involvedFeedbackIds: z.array(z.string()),
  severity: z.enum(['HIGH', 'MEDIUM', 'LOW']),
});

export type FeedbackConflictValidated = z.infer<typeof FeedbackConflictSchema>;

// ─── Learning Recommendation ───────────────────────────────────────────────────

export const LearningRecommendationSchema = z.object({
  action: z.enum([
    'NONE',
    'REVIEW_FEEDBACK',
    'CONSIDER_RULE',
    'CONSIDER_DICTIONARY_UPDATE',
    'RESOLVE_CONFLICT',
    'MONITOR',
  ]),
  explanation: z.string(),
  priority: z.enum(['HIGH', 'MEDIUM', 'LOW', 'NONE']),
});

export type LearningRecommendationValidated = z.infer<typeof LearningRecommendationSchema>;

// ─── Learning Output ───────────────────────────────────────────────────────────

export const LearningOutputSchema = z.object({
  learningStatus: LearningStatusSchema,
  recommendation: LearningRecommendationSchema,
  feedbackSummary: FeedbackSummarySchema,
  reliability: FeedbackReliabilitySchema,
  suggestedRules: z.array(SuggestedRuleSchema),
  suggestedDictionaryTerms: z.array(SuggestedDictionaryTermSchema),
  statistics: LearningStatisticsSchema,
  learningScore: z.number().min(0).max(1),
  evidence: z.array(LearningEvidenceSchema),
  reviewerAgreement: z.number().min(0).max(1),
  requiresHumanApproval: z.boolean(),
  conflicts: z.array(FeedbackConflictSchema),
  learningVersion: z.literal('1.0'),
});

export type LearningOutputValidated = z.infer<typeof LearningOutputSchema>;

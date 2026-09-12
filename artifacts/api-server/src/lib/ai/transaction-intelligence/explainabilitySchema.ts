/**
 * AI Transaction Intelligence — Phase 4
 * Explainability Zod Schemas
 *
 * Validates ExplainabilityInput and ExplainabilityResult at runtime boundaries.
 */

import { z } from 'zod';

// ─── Confidence ────────────────────────────────────────────────────────────────

export const ConfidenceLevelSchema = z.enum([
  'VERY_HIGH',
  'HIGH',
  'MEDIUM',
  'LOW',
  'VERY_LOW',
]);

export const ExplainabilityConfidenceSchema = z.object({
  final:      z.number(),
  normalized: z.number().min(0).max(1),
  level:      ConfidenceLevelSchema,
});

// ─── Recommendation ────────────────────────────────────────────────────────────

export const RecommendationStatusSchema = z.enum(['SAFE', 'MANUAL_REVIEW', 'REJECT']);

export const ExplainabilityRecommendationSchema = z.object({
  status:      RecommendationStatusSchema,
  explanation: z.string(),
});

// ─── Evidence ─────────────────────────────────────────────────────────────────

export const EvidenceTypeSchema = z.enum([
  'HISTORICAL_MAPPING',
  'INTENT_MATCH',
  'KEYWORD_MATCH',
  'COUNTERPARTY',
  'DIRECTION',
  'ACCOUNT_POLICY',
  'COMPANY_CONTEXT',
  'PENALTY',
  'MANUAL_REVIEW_TRIGGER',
  'PHASE1_ANALYSIS',
  'PHASE2_CLASSIFICATION',
  'PHASE3_PREDICTION',
]);

export const ExplainabilityEvidenceSchema = z.object({
  type:                   EvidenceTypeSchema,
  source:                 z.enum(['PHASE1', 'PHASE2', 'PHASE3', 'ENGINE']),
  weight:                 z.number().min(0).max(1),
  description:            z.string(),
  contribution:           z.number().min(0),
  confidenceContribution: z.number().min(0),
  negativeContribution:   z.number().min(0),
});

// ─── Breakdown ────────────────────────────────────────────────────────────────

export const BreakdownDimensionSchema = z.enum([
  'Historical Mapping',
  'Intent Match',
  'Keyword Match',
  'Counterparty',
  'Direction',
  'Account Policy',
  'Company Context',
  'Penalty',
  'Manual Review Trigger',
]);

export const ConfidenceBreakdownItemSchema = z.object({
  dimension: BreakdownDimensionSchema,
  score:     z.number(),
  weight:    z.number().min(0),
  detail:    z.string(),
});

// ─── Ambiguity ────────────────────────────────────────────────────────────────

export const AmbiguityTypeSchema = z.enum([
  'AR_VS_REVENUE',
  'AP_VS_EXPENSE',
  'INTERNAL_TRANSFER',
  'UNKNOWN_INTENT',
  'MULTIPLE_CLOSE_CANDIDATES',
  'WEAK_EVIDENCE',
  'CROSS_COMPANY',
  'INACTIVE_ACCOUNT',
  'NON_POSTABLE_ACCOUNT',
]);

export const AmbiguityFlagSchema = z.object({
  type:         AmbiguityTypeSchema,
  description:  z.string(),
  reviewAction: z.string(),
});

// ─── Full result ──────────────────────────────────────────────────────────────

export const ExplainabilityResultSchema = z.object({
  confidence:           ExplainabilityConfidenceSchema,
  recommendation:       ExplainabilityRecommendationSchema,
  evidence:             z.array(ExplainabilityEvidenceSchema),
  confidenceBreakdown:  z.array(ConfidenceBreakdownItemSchema),
  ambiguity:            z.array(AmbiguityFlagSchema),
  accountingWarnings:   z.array(z.string()),
  auditSummary:         z.string(),
  reviewerNotes:        z.array(z.string()),
  explainabilityVersion: z.literal('1.0'),
});

// ─── Type exports ─────────────────────────────────────────────────────────────

export type ExplainabilityResultValidated = z.infer<typeof ExplainabilityResultSchema>;

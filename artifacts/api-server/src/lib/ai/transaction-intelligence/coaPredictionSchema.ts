/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Zod Schemas
 *
 * Runtime validation for all Phase 3 types.
 * Uses Zod consistently with Phase 1 and Phase 2 schemas.
 */

import { z } from 'zod';
import { TransactionIntentSchema } from './transactionSchema.js';

// ─── CoaAccountCandidate ───────────────────────────────────────────────────────

export const CoaAccountCandidateSchema = z.object({
  id:                 z.union([z.string().min(1), z.number()]),
  companyId:          z.union([z.string().min(1), z.number()]),
  code:               z.string().min(1),
  name:               z.string().min(1),
  accountType:        z.string().optional(),
  normalBalance:      z.enum(['DEBIT', 'CREDIT', 'UNKNOWN']).optional(),
  category:           z.string().optional(),
  subcategory:        z.string().optional(),
  isActive:           z.boolean(),
  allowsManualPosting: z.boolean().optional(),
  keywords:           z.array(z.string()).optional(),
  aliases:            z.array(z.string()).optional(),
  metadata:           z.record(z.unknown()).optional(),
});

export type CoaAccountCandidateValidated = z.infer<typeof CoaAccountCandidateSchema>;

// ─── HistoricalCoaMapping ──────────────────────────────────────────────────────

export const HistoricalCoaMappingSchema = z.object({
  companyId:             z.union([z.string().min(1), z.number()]),
  normalizedDescription: z.string().optional(),
  intent:                TransactionIntentSchema.optional(),
  counterpartyName:      z.string().optional(),
  counterpartyAccount:   z.string().optional(),
  transactionCode:       z.string().optional(),
  coaId:                 z.union([z.string().min(1), z.number()]),
  coaCode:               z.string().min(1),
  usageCount:            z.number().int().nonnegative().optional(),
  approvedCount:         z.number().int().nonnegative().optional(),
  rejectedCount:         z.number().int().nonnegative().optional(),
  lastUsedAt:            z.union([z.string(), z.date()]).optional(),
});

export type HistoricalCoaMappingValidated = z.infer<typeof HistoricalCoaMappingSchema>;

// ─── CoaPredictionPolicy ──────────────────────────────────────────────────────

export const CoaPredictionPolicySchema = z.object({
  minimumConfidence:     z.number().min(0).max(1).optional(),
  manualReviewThreshold: z.number().min(0).max(1).optional(),
  ambiguityDelta:        z.number().min(0).max(1).optional(),
  maxAlternatives:       z.number().int().min(0).optional(),
  blockedAccountCodes:   z.array(z.string()).optional(),
  blockedAccountTypes:   z.array(z.string()).optional(),
  allowedAccountTypesByIntent: z.record(z.array(z.string())).optional(),
  preferredAccountCodesByIntent: z.record(z.array(z.string())).optional(),
});

export type CoaPredictionPolicyValidated = z.infer<typeof CoaPredictionPolicySchema>;

// ─── CoaPredictionInput ───────────────────────────────────────────────────────

export const CoaPredictionInputSchema = z.object({
  transaction: z.object({
    description:         z.string().min(1, 'Transaction description is required'),
    direction:           z.enum(['DEBIT', 'CREDIT', 'UNKNOWN']).optional(),
    amount:              z.number().nonnegative().optional(),
    currency:            z.string().length(3).optional(),
    transactionDate:     z.union([z.string(), z.date()]).optional(),
    bankAccountId:       z.union([z.string(), z.number()]).optional(),
    bankName:            z.string().optional(),
    counterpartyName:    z.string().optional(),
    counterpartyAccount: z.string().optional(),
    referenceNumber:     z.string().optional(),
    transactionCode:     z.string().optional(),
  }),
  companyId:             z.union([z.string().min(1), z.number()], {
    required_error: 'companyId is required',
  }),
  availableAccounts:     z.array(CoaAccountCandidateSchema, {
    required_error: 'availableAccounts is required',
  }),
  phase1Analysis:        z.unknown().optional(),
  phase2Classification:  z.unknown().optional(),
  historicalMappings:    z.array(HistoricalCoaMappingSchema).optional(),
  policy:                CoaPredictionPolicySchema.optional(),
});

export type CoaPredictionInputValidated = z.infer<typeof CoaPredictionInputSchema>;

// ─── CoaPredictionAlternative ─────────────────────────────────────────────────

export const CoaPredictionAlternativeSchema = z.object({
  coaId:      z.union([z.string(), z.number()]),
  coaCode:    z.string(),
  coaName:    z.string(),
  confidence: z.number().min(0).max(1),
  score:      z.number().finite(),
  reason:     z.array(z.string()),
});

export type CoaPredictionAlternativeValidated = z.infer<typeof CoaPredictionAlternativeSchema>;

// ─── CoaPredictionResult ──────────────────────────────────────────────────────

const PrimaryRecommendationSchema = z.object({
  coaId:      z.union([z.string(), z.number()]),
  coaCode:    z.string(),
  coaName:    z.string(),
  confidence: z.number().min(0).max(1),
  score:      z.number().finite(),
});

const CoaPredictionEvidenceSchema = z.object({
  type:    z.string(),
  value:   z.string(),
  weight:  z.number().min(0).max(1),
  coaCode: z.string().optional(),
});

const CoaRecommendationSourceSchema = z.enum([
  'HISTORICAL_MAPPING',
  'INTENT_MAPPING',
  'KEYWORD_MAPPING',
  'COUNTERPARTY_MAPPING',
  'ACCOUNT_POLICY',
  'COMBINED',
  'NONE',
]);

export const CoaPredictionResultSchema = z.object({
  companyId:             z.union([z.string(), z.number()]),
  primaryRecommendation: PrimaryRecommendationSchema.nullable(),
  alternatives:          z.array(CoaPredictionAlternativeSchema),
  intent:                TransactionIntentSchema,
  normalizedDescription: z.string(),
  evidence:              z.array(CoaPredictionEvidenceSchema),
  reason:                z.array(z.string()),
  conflictFlags:         z.array(z.string()),
  requiresManualReview:  z.boolean(),
  recommendationSource:  CoaRecommendationSourceSchema,
  phase1Analysis:        z.unknown(),
  phase2Classification:  z.unknown(),
}).superRefine((val, ctx) => {
  // Confidence range validation
  if (val.primaryRecommendation !== null) {
    if (val.primaryRecommendation.confidence < 0 || val.primaryRecommendation.confidence > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'primaryRecommendation.confidence must be in [0, 1]' });
    }
  }
  // No duplicate alternatives
  const codes = val.alternatives.map((a) => a.coaCode);
  const unique = new Set(codes);
  if (unique.size !== codes.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'alternatives must not contain duplicate coaCode values' });
  }
  // Manual review required when no primary
  if (val.primaryRecommendation === null && !val.requiresManualReview) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'requiresManualReview must be true when primaryRecommendation is null' });
  }
});

export type CoaPredictionResultValidated = z.infer<typeof CoaPredictionResultSchema>;

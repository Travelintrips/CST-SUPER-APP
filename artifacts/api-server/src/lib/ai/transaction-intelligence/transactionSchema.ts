/**
 * AI Transaction Intelligence — Phase 1
 * Zod Schemas for input/output validation
 *
 * Keeps schema definitions separate from business logic so they can be
 * imported independently (e.g., for API route validation or test helpers).
 */

import { z } from 'zod';
import { ALL_INTENTS } from './transactionTypes.js';

// ─── Intent literal type ──────────────────────────────────────────────────────

// Zod enum from our ALL_INTENTS tuple
const intentValues = ALL_INTENTS as unknown as [string, ...string[]];
export const TransactionIntentSchema = z.enum(intentValues);
export const TaxSubtypeSchema = z.enum([
  'VAT_INPUT',
  'VAT_OUTPUT',
  'VAT_UNSPECIFIED',
  'PPh21',
  'PPh22',
  'PPh23',
  'PPh25',
  'PPh26',
  'PPh_FINAL',
  'INCOME_TAX_UNSPECIFIED',
  'STAMP_DUTY',
  'IMPORT_DUTY',
  'CUSTOMS_DUTY',
  'EXCISE',
  'TAX_PENALTY',
  'TAX_INTEREST',
  'TAX_REFUND',
  'LOCAL_TAX',
  'VEHICLE_TAX',
  'UNKNOWN_TAX',
]);

// ─── Phase 1 input ────────────────────────────────────────────────────────────

export const AnalyzeDescriptionInputSchema = z.object({
  /** Raw bank mutation description string (required). */
  description: z.string(),
});

export type AnalyzeDescriptionInput = z.infer<typeof AnalyzeDescriptionInputSchema>;

// ─── Phase 1 output sub-schemas ───────────────────────────────────────────────

export const KeywordMatchSchema = z.object({
  keyword:      z.string(),
  matchedToken: z.string(),
  weight:       z.number().min(0).max(1),
});

export const IntentCandidateSchema = z.object({
  intent:          TransactionIntentSchema,
  score:           z.number().min(0).max(1),
  matchedKeywords: z.array(KeywordMatchSchema),
});

export const ExplanationSchema = z.object({
  primaryReason:        z.string(),
  supportingFactors:    z.array(z.string()),
  keywordsMatched:      z.array(z.string()),
  lowConfidenceReasons: z.array(z.string()),
});

export const TransactionAnalysisResultSchema = z.object({
  intent:                TransactionIntentSchema,
  confidence:            z.number().min(0).max(1),
  normalizedDescription: z.string(),
  candidates:            z.array(IntentCandidateSchema),
  explanation:           ExplanationSchema,
  requiresManualReview:  z.boolean(),
  taxSubtype:            TaxSubtypeSchema.optional(),
});

export type TransactionAnalysisResultValidated = z.infer<typeof TransactionAnalysisResultSchema>;

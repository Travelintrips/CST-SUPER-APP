/**
 * AI Transaction Intelligence — Phase 2
 * Zod Schemas for Phase 2 input / output validation
 *
 * Additive — does not modify Phase 1 schemas.
 */

import { z } from 'zod';
import { TransactionIntentSchema } from './transactionSchema.js';
import { TransactionAnalysisResultSchema } from './transactionSchema.js';

// ─── Input ────────────────────────────────────────────────────────────────────

export const DirectionSchema = z.enum(['DEBIT', 'CREDIT', 'UNKNOWN']);

export const TransactionClassificationInputSchema = z.object({
  description:        z.string(),
  direction:          DirectionSchema.optional(),
  amount:             z.number().optional(),
  transactionDate:    z.union([z.string(), z.date()]).optional(),
  bankAccountId:      z.union([z.string(), z.number()]).optional(),
  bankName:           z.string().optional(),
  counterpartyName:   z.string().optional(),
  counterpartyAccount:z.string().optional(),
  referenceNumber:    z.string().optional(),
  transactionCode:    z.string().optional(),
  currency:           z.string().optional(),
});

export type TransactionClassificationInputValidated = z.infer<
  typeof TransactionClassificationInputSchema
>;

// ─── Evidence ─────────────────────────────────────────────────────────────────

export const EvidenceTypeSchema = z.enum([
  'DIRECTION',
  'DESCRIPTION',
  'COUNTERPARTY',
  'TRANSACTION_CODE',
  'REFERENCE_NUMBER',
  'INTERNAL_ACCOUNT',
  'PHASE1_MATCH',
  'AMOUNT_PATTERN',
  'BANK_NAME',
]);

export const IntentClassificationEvidenceSchema = z.object({
  type:   EvidenceTypeSchema,
  value:  z.string(),
  weight: z.number().min(0).max(1),
});

// ─── Alternative ──────────────────────────────────────────────────────────────

export const IntentClassificationAlternativeSchema = z.object({
  intent:     TransactionIntentSchema,
  confidence: z.number().min(0).max(1),
});

// ─── Output ───────────────────────────────────────────────────────────────────

export const IntentClassificationResultSchema = z.object({
  primaryIntent:         TransactionIntentSchema,
  confidence:            z.number().min(0).max(1),
  normalizedDescription: z.string(),
  alternatives:          z.array(IntentClassificationAlternativeSchema).max(10),
  evidence:              z.array(IntentClassificationEvidenceSchema),
  reason:                z.array(z.string()),
  phase1Analysis:        TransactionAnalysisResultSchema,
  requiresManualReview:  z.boolean(),
});

export type IntentClassificationResultValidated = z.infer<
  typeof IntentClassificationResultSchema
>;

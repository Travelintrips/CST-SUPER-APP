/**
 * AI Transaction Intelligence — Phase 5
 * Learning & Feedback Engine — Zod Schemas
 */

import { z } from 'zod';
import { TransactionIntentSchema } from './transactionSchema.js';

// ─── FeedbackRecord ────────────────────────────────────────────────────────────

export const FeedbackRecordSchema = z.object({
  id: z.string(),
  companyId: z.union([z.string(), z.number()]),
  rawDescription: z.string(),
  normalizedDescription: z.string(),
  predictedIntent: TransactionIntentSchema,
  correctedIntent: TransactionIntentSchema.optional(),
  predictedCoaId: z.union([z.string(), z.number()]).optional(),
  predictedCoaCode: z.string().optional(),
  correctedCoaId: z.union([z.string(), z.number()]).optional(),
  correctedCoaCode: z.string().optional(),
  counterpartyName: z.string().optional(),
  transactionCode: z.string().optional(),
  direction: z.enum(['DEBIT', 'CREDIT', 'UNKNOWN']).optional(),
  wasAccepted: z.boolean(),
  recordedAt: z.string(),
  reviewerComment: z.string().optional(),
});

export type FeedbackRecordValidated = z.infer<typeof FeedbackRecordSchema>;

// ─── CorrectionRecord ──────────────────────────────────────────────────────────

export const CorrectionRecordSchema = z.object({
  normalizedDescription: z.string(),
  companyId: z.union([z.string(), z.number()]),
  occurrenceCount: z.number().int().nonnegative(),
  acceptedCount: z.number().int().nonnegative(),
  correctedCount: z.number().int().nonnegative(),
  mostFrequentCoaId: z.union([z.string(), z.number()]).optional(),
  mostFrequentCoaCode: z.string().optional(),
  mostFrequentIntent: TransactionIntentSchema.optional(),
  distinctCoaIds: z.array(z.union([z.string(), z.number()])),
  distinctIntents: z.array(TransactionIntentSchema),
});

export type CorrectionRecordValidated = z.infer<typeof CorrectionRecordSchema>;

// ─── LearningSignal ────────────────────────────────────────────────────────────

export const LearningSignalSchema = z.object({
  signalType: z.enum([
    'KEYWORD',
    'ALIAS',
    'COUNTERPARTY',
    'INTENT_COA',
    'THRESHOLD',
    'DESCRIPTION_PATTERN',
  ]),
  normalizedDescription: z.string(),
  intent: TransactionIntentSchema.optional(),
  coaCode: z.string().optional(),
  coaId: z.union([z.string(), z.number()]).optional(),
  counterpartyName: z.string().optional(),
  transactionCode: z.string().optional(),
  keyword: z.string().optional(),
  companyId: z.union([z.string(), z.number()]).optional(),
  occurrenceCount: z.number().int().nonnegative(),
  consistencyRate: z.number().min(0).max(1),
  signalConfidence: z.number().min(0).max(1),
});

export type LearningSignalValidated = z.infer<typeof LearningSignalSchema>;

// ─── LearningEngineInput ───────────────────────────────────────────────────────

export const LearningEngineInputSchema = z.object({
  companyId: z.union([z.string(), z.number()]),
  feedbackRecords: z.array(FeedbackRecordSchema),
  correctionRecords: z.array(CorrectionRecordSchema).optional(),
  minOccurrences: z.number().int().positive().optional(),
  minConsistency: z.number().min(0).max(1).optional(),
});

export type LearningEngineInputValidated = z.infer<typeof LearningEngineInputSchema>;

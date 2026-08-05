/**
 * AI Transaction Intelligence — Phase 7
 * Anomaly Detection — Zod Schemas
 *
 * Runtime validation for input and output contracts.
 */

import { z } from 'zod';

// ─── Anomaly type enum ────────────────────────────────────────────────────────

export const AnomalyTypeSchema = z.enum([
  'AMOUNT_OUTLIER',
  'FREQUENCY_SPIKE',
  'EXACT_DUPLICATE',
  'NEAR_DUPLICATE',
  'NEW_COUNTERPARTY',
  'UNUSUAL_COUNTERPARTY',
  'UNUSUAL_TRANSACTION_TIME',
  'UNUSUAL_TRANSACTION_DAY',
  'UNUSUAL_COA',
  'COA_INTENT_MISMATCH',
  'SPLIT_TRANSACTION',
  'CROSS_COMPANY_PATTERN',
  'ROUND_AMOUNT_PATTERN',
  'RAPID_REVERSAL',
  'DESCRIPTION_MISMATCH',
  'REFERENCE_REUSE',
  'UNUSUAL_DIRECTION',
  'INSUFFICIENT_BASELINE',
  'UNKNOWN',
]);

export const AnomalySeveritySchema = z.enum(['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const AnomalyRiskLevelSchema = z.enum(['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const AnomalyRecommendationSchema = z.enum([
  'NO_ACTION', 'MONITOR', 'MANUAL_REVIEW', 'ESCALATE', 'HOLD_FOR_REVIEW',
]);
export const BaselineQualitySchema = z.enum(['INSUFFICIENT', 'LIMITED', 'GOOD', 'STRONG']);

// ─── Evidence schema ──────────────────────────────────────────────────────────

export const AnomalyEvidenceSchema = z.object({
  key: z.string(),
  value: z.union([z.string(), z.number(), z.boolean()]),
  expected: z.union([z.string(), z.number(), z.boolean()]).optional(),
  contribution: z.number().min(0).max(1),
});

// ─── Detection schema ─────────────────────────────────────────────────────────

export const AnomalyDetectionSchema = z.object({
  type: AnomalyTypeSchema,
  detected: z.boolean(),
  score: z.number().min(0).max(1),
  severity: AnomalySeveritySchema,
  reason: z.array(z.string()),
  evidence: z.array(AnomalyEvidenceSchema),
});

// ─── Result schema ────────────────────────────────────────────────────────────

export const AnomalyDetectionResultSchema = z.object({
  companyId: z.union([z.string(), z.number()]),
  transactionId: z.union([z.string(), z.number()]).optional(),
  isAnomaly: z.boolean(),
  anomalyScore: z.number().min(0).max(1),
  riskLevel: AnomalyRiskLevelSchema,
  anomalyTypes: z.array(AnomalyTypeSchema),
  detections: z.array(AnomalyDetectionSchema),
  explanation: z.array(z.string()),
  recommendation: AnomalyRecommendationSchema,
  requiresManualReview: z.boolean(),
  baselineQuality: BaselineQualitySchema,
  confidence: z.number().min(0).max(1),
  conflictFlags: z.array(z.string()),
  evaluatedAt: z.string(),
  anomalyVersion: z.literal('1.0'),
});

export type AnomalyDetectionResultValidated = z.infer<typeof AnomalyDetectionResultSchema>;

// ─── Baseline schema ──────────────────────────────────────────────────────────

export const CompanyAnomalyBaselineSchema = z.object({
  companyId: z.union([z.string(), z.number()]),
  sampleSize: z.number().int().min(0),
  amount: z.object({
    mean: z.number().optional(),
    median: z.number().optional(),
    standardDeviation: z.number().optional(),
    p25: z.number().optional(),
    p75: z.number().optional(),
    p90: z.number().optional(),
    p95: z.number().optional(),
    p99: z.number().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
  }),
  frequency: z.object({
    averagePerDay: z.number().optional(),
    averagePerWeek: z.number().optional(),
    averagePerMonth: z.number().optional(),
  }).optional(),
  commonCounterparties: z.array(z.string()).optional(),
  commonTransactionCodes: z.array(z.string()).optional(),
  commonIntents: z.array(z.string()).optional(),
  commonCoaCodes: z.array(z.string()).optional(),
  usualHours: z.array(z.number().int().min(0).max(23)).optional(),
  usualDaysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  generatedAt: z.union([z.string(), z.date()]).optional(),
});

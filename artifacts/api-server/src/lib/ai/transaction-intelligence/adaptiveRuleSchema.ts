/**
 * AI Transaction Intelligence — Phase 6
 * Adaptive Rule Recommendation Engine — Zod Schemas
 */

import { z } from 'zod';
import { TransactionIntentSchema } from './transactionSchema.js';

// ─── Enums ─────────────────────────────────────────────────────────────────────

export const RuleRiskLevelSchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export const RulePrioritySchema = z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']);
export const RulePackageTypeSchema = z.enum([
  'RULE_PACKAGE',
  'DICTIONARY_PACKAGE',
  'COUNTERPARTY_PACKAGE',
  'THRESHOLD_PACKAGE',
]);
export const RuleConflictTypeSchema = z.enum([
  'DUPLICATE_RULE',
  'CONTRADICTING_RULE',
  'COMPANY_CONFLICT',
  'DICTIONARY_CONFLICT',
  'COUNTERPARTY_CONFLICT',
  'THRESHOLD_CONFLICT',
  'KEYWORD_OVERLAP',
]);

// ─── RecommendedRule ───────────────────────────────────────────────────────────

export const RecommendedRuleSchema = z.object({
  id: z.string(),
  type: z.enum(['KEYWORD', 'ALIAS', 'COUNTERPARTY_MAPPING', 'INTENT_COA_MAPPING', 'THRESHOLD']),
  description: z.string(),
  normalizedDescription: z.string(),
  confidence: z.number().min(0).max(1),
  riskLevel: RuleRiskLevelSchema,
  priority: RulePrioritySchema,
  requiresHumanApproval: z.literal(true),
  supportingOccurrences: z.number().int().nonnegative(),
  consistencyRate: z.number().min(0).max(1),
  affectedIntents: z.array(TransactionIntentSchema),
  affectedCoaIds: z.array(z.union([z.string(), z.number()])),
  companyId: z.union([z.string(), z.number()]).optional(),
  keyword: z.string().optional(),
  alias: z.string().optional(),
  suggestedWeight: z.number().optional(),
  coaCode: z.string().optional(),
  coaId: z.union([z.string(), z.number()]).optional(),
  reason: z.array(z.string()),
});
export type RecommendedRuleValidated = z.infer<typeof RecommendedRuleSchema>;

// ─── RecommendedDictionaryEntry ────────────────────────────────────────────────

export const RecommendedDictionaryEntrySchema = z.object({
  id: z.string(),
  keyword: z.string(),
  intent: TransactionIntentSchema,
  suggestedWeight: z.number().min(0).max(2),
  aliases: z.array(z.string()),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  supportingOccurrences: z.number().int().nonnegative(),
  riskLevel: RuleRiskLevelSchema,
  priority: RulePrioritySchema,
  requiresHumanApproval: z.literal(true),
  companyId: z.union([z.string(), z.number()]).optional(),
});
export type RecommendedDictionaryEntryValidated = z.infer<typeof RecommendedDictionaryEntrySchema>;

// ─── RecommendedThresholdChange ────────────────────────────────────────────────

export const RecommendedThresholdChangeSchema = z.object({
  id: z.string(),
  parameter: z.string(),
  parameterLabel: z.string(),
  currentValue: z.number(),
  suggestedValue: z.number(),
  reason: z.string(),
  confidence: z.number().min(0).max(1),
  riskLevel: RuleRiskLevelSchema,
  priority: RulePrioritySchema,
  requiresHumanApproval: z.literal(true),
});
export type RecommendedThresholdChangeValidated = z.infer<typeof RecommendedThresholdChangeSchema>;

// ─── RecommendedCounterpartyMapping ───────────────────────────────────────────

export const RecommendedCounterpartyMappingSchema = z.object({
  id: z.string(),
  counterpartyPattern: z.string(),
  exampleCounterpartyName: z.string(),
  suggestedIntent: TransactionIntentSchema,
  suggestedCoaCode: z.string().optional(),
  suggestedCoaId: z.union([z.string(), z.number()]).optional(),
  companyId: z.union([z.string(), z.number()]).optional(),
  confidence: z.number().min(0).max(1),
  supportingOccurrences: z.number().int().nonnegative(),
  consistencyRate: z.number().min(0).max(1),
  riskLevel: RuleRiskLevelSchema,
  priority: RulePrioritySchema,
  requiresHumanApproval: z.literal(true),
});
export type RecommendedCounterpartyMappingValidated = z.infer<typeof RecommendedCounterpartyMappingSchema>;

// ─── SimulationResult ──────────────────────────────────────────────────────────

export const SimulationResultSchema = z.object({
  totalTransactions: z.number().int().nonnegative(),
  affectedTransactions: z.number().int().nonnegative(),
  improvedTransactions: z.number().int().nonnegative(),
  worsenedTransactions: z.number().int().nonnegative(),
  precisionDelta: z.number(),
  manualReviewDelta: z.number(),
  dryRun: z.literal(true),
  simulationConfidence: z.number().min(0).max(1),
});
export type SimulationResultValidated = z.infer<typeof SimulationResultSchema>;

// ─── RuleConflict ──────────────────────────────────────────────────────────────

export const RuleConflictSchema = z.object({
  id: z.string(),
  type: RuleConflictTypeSchema,
  description: z.string(),
  affectedRecommendationIds: z.array(z.string()),
  existingRuleIds: z.array(z.string()),
  severity: RuleRiskLevelSchema,
  resolution: z.string(),
});
export type RuleConflictValidated = z.infer<typeof RuleConflictSchema>;

// ─── AdaptiveRuleEngineInput ───────────────────────────────────────────────────

export const AdaptiveRuleEngineInputSchema = z.object({
  companyId: z.union([z.string(), z.number()]),
  minRecommendationConfidence: z.number().min(0).max(1).optional(),
  maxRecommendations: z.number().int().positive().optional(),
});
export type AdaptiveRuleEngineInputValidated = z.infer<typeof AdaptiveRuleEngineInputSchema>;

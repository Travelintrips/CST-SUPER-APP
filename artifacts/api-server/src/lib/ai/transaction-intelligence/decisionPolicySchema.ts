/**
 * AI Transaction Intelligence — Phase 9
 * Decision Policy Engine — Zod Schemas
 *
 * Runtime-safe validation for all Phase 9 inputs and outputs.
 */

import { z } from 'zod';

// ─── Enumerations ─────────────────────────────────────────────────────────────

export const ReviewLevelSchema = z.enum([
  'NONE',
  'STANDARD',
  'SENIOR',
  'MANAGER',
  'DIRECTOR',
  'EXECUTIVE',
]);

export const EscalationLevelSchema = z.enum([
  'NONE',
  'TEAM_LEAD',
  'MANAGER',
  'DIRECTOR',
  'EXECUTIVE',
  'COMPLIANCE',
]);

export const ApprovalLevelSchema = z.enum([
  'NONE',
  'SINGLE',
  'DUAL',
  'COMMITTEE',
]);

export const ReviewerRoleSchema = z.enum([
  'FINANCE_ANALYST',
  'SENIOR_ACCOUNTANT',
  'ACCOUNTING_MANAGER',
  'TAX_SPECIALIST',
  'PAYROLL_OFFICER',
  'TREASURY_ANALYST',
  'COMPLIANCE_OFFICER',
  'FINANCE_DIRECTOR',
  'CFO',
  'DATA_QUALITY_ANALYST',
  'UNASSIGNED',
]);

export const OverrideDimensionSchema = z.enum([
  'COMPANY',
  'INTENT',
  'RISK',
  'AMOUNT',
  'REVIEWER',
]);

// ─── Override ─────────────────────────────────────────────────────────────────

export const DecisionPolicyOverrideForceSchema = z.object({
  queue: z.string().optional(),
  priority: z.string().optional(),
  reviewLevel: ReviewLevelSchema.optional(),
  reviewerRole: ReviewerRoleSchema.optional(),
  escalationLevel: EscalationLevelSchema.optional(),
  approvalLevel: ApprovalLevelSchema.optional(),
  holdRecommendation: z.boolean().optional(),
  skipReview: z.boolean().optional(),
  slaMinutes: z.number().positive().optional(),
});

export const DecisionPolicyOverrideSchema = z.object({
  dimension: OverrideDimensionSchema,
  matchKey: z.string().min(1),
  force: DecisionPolicyOverrideForceSchema,
  reason: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

// ─── Policy Config ────────────────────────────────────────────────────────────

export const DecisionPolicyConfigSchema = z.object({
  minimumAutoConfidence: z.number().min(0).max(1).optional(),
  anomalyReviewThreshold: z.number().min(0).max(1).optional(),
  anomalyEscalationThreshold: z.number().min(0).max(1).optional(),
  amountThresholds: z
    .object({
      highValue: z.number().nonnegative().optional(),
      criticalValue: z.number().nonnegative().optional(),
      escalationValue: z.number().nonnegative().optional(),
    })
    .optional(),
  slaMinutes: z
    .object({
      LOW: z.number().positive().optional(),
      NORMAL: z.number().positive().optional(),
      HIGH: z.number().positive().optional(),
      URGENT: z.number().positive().optional(),
      CRITICAL: z.number().positive().optional(),
    })
    .optional(),
  overrides: z.array(DecisionPolicyOverrideSchema).optional(),
  forceManualReviewIntents: z.array(z.string()).optional(),
  forceManualReviewFlags: z.array(z.string()).optional(),
  policyVersion: z.string().optional(),
});

// ─── SLA Decision ─────────────────────────────────────────────────────────────

export const PolicySlaDecisionSchema = z.object({
  targetMinutes: z.number().positive(),
  dueAt: z.string().datetime(),
  urgencyLabel: z.enum(['ROUTINE', 'PRIORITY', 'URGENT', 'CRITICAL']),
});

// ─── Escalation Decision ──────────────────────────────────────────────────────

export const PolicyEscalationDecisionSchema = z.object({
  required: z.boolean(),
  level: EscalationLevelSchema,
  reason: z.array(z.string()),
});

// ─── Approval Decision ────────────────────────────────────────────────────────

export const PolicyApprovalDecisionSchema = z.object({
  required: z.boolean(),
  level: ApprovalLevelSchema,
  minApprovers: z.number().nonnegative().int(),
  reason: z.array(z.string()),
});

// ─── Hold Decision ────────────────────────────────────────────────────────────

export const PolicyHoldDecisionSchema = z.object({
  hold: z.boolean(),
  reason: z.array(z.string()),
});

// ─── Fired Rule ───────────────────────────────────────────────────────────────

export const FiredRuleSchema = z.object({
  ruleId: z.string(),
  description: z.string(),
  dimension: z.string(),
  effect: z.string(),
});

// ─── Applied Override ─────────────────────────────────────────────────────────

export const AppliedOverrideSchema = z.object({
  dimension: OverrideDimensionSchema,
  matchKey: z.string(),
  fieldsChanged: z.array(z.string()),
  reason: z.string(),
});

// ─── Main Result ──────────────────────────────────────────────────────────────

export const DecisionPolicyResultSchema = z.object({
  reviewRequired: z.boolean(),
  queue: z.string(),
  priority: z.string(),
  sla: PolicySlaDecisionSchema,
  reviewerRole: ReviewerRoleSchema,
  reviewLevel: ReviewLevelSchema,
  escalation: PolicyEscalationDecisionSchema,
  approvalRequirement: PolicyApprovalDecisionSchema,
  holdRecommendation: PolicyHoldDecisionSchema,
  policyVersion: z.string(),
  policyReason: z.array(z.string()),
  firedRules: z.array(FiredRuleSchema),
  appliedOverrides: z.array(AppliedOverrideSchema),
  evaluatedAt: z.string().datetime(),
  engineVersion: z.literal('9.0'),
});

// ─── Simulation ───────────────────────────────────────────────────────────────

export const SimulationDeltaSchema = z.object({
  field: z.string(),
  before: z.unknown(),
  after: z.unknown(),
});

export const SimulationResultSchema = z.object({
  label: z.string(),
  before: DecisionPolicyResultSchema,
  after: DecisionPolicyResultSchema,
  deltas: z.array(SimulationDeltaSchema),
  changed: z.boolean(),
});

// ─── Exported TS types ────────────────────────────────────────────────────────

export type DecisionPolicyResultValidated = z.infer<typeof DecisionPolicyResultSchema>;
export type DecisionPolicyOverrideValidated = z.infer<typeof DecisionPolicyOverrideSchema>;
export type DecisionPolicyConfigValidated = z.infer<typeof DecisionPolicyConfigSchema>;
export type SimulationResultValidated = z.infer<typeof SimulationResultSchema>;

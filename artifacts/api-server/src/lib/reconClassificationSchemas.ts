import { z } from "zod/v4";

export const AiRuleSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().optional().nullable(),
  config_id: z.number().int().optional().nullable(),
  condition_field: z.enum([
    "description", "reference", "amount", "direction", "bank_account", "bank",
    "transaction_code", "normalized", "counterparty_name", "counterparty_account",
  ]),
  condition_operator: z.enum([
    "equals", "contains", "not_contains", "starts_with", "ends_with", "not_equals",
    "eq", "neq", "regex", "greater_than", "less_than", "gte", "lte", "between",
  ]),
  condition_value: z.string().min(1),
  conditions: z.array(z.object({
    field: z.enum([
      "description", "amount", "direction", "bank", "transaction_code", "normalized",
      "reference", "counterparty_name", "counterparty_account",
    ]),
    operator: z.enum([
      "contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with",
      "eq", "neq", "regex", "greater_than", "less_than", "gte", "lte", "between",
    ]),
    value: z.string().min(1),
    negate: z.boolean().optional(),
  })).min(1).optional(),
  logic: z.enum(["AND", "OR"]).default("AND"),
  specificity: z.coerce.number().int().min(1).max(999).optional(),
  action_flow: z.enum([
    "BUSINESS_MATCHING", "ROUTINE_EXPENSE_ALLOCATION", "INTERNAL_TRANSFER",
    "INCOME_ALLOCATION", "MANUAL_REVIEW", "BLOCKED",
  ]).optional().nullable(),
  action_coa_code: z.string().optional().nullable(),
  action_config_code: z.string().optional().nullable(),
  amount_tolerance: z.coerce.number().min(0).max(1_000_000_000).optional().nullable(),
  reference_amount: z.coerce.number().finite().min(0).optional().nullable(),
  candidate_requirement: z.enum(["required", "not_required"]).default("not_required"),
  requires_document_upload: z.boolean().default(false),
  tax_type: z.enum(["none", "ppn_input", "ppn_output"]).default("none"),
  confidence: z.coerce.number().min(0).max(1).default(0.8),
  priority: z.coerce.number().int().min(1).max(999).default(50),
  source: z.enum(["manual", "ai_generated"]).default("manual"),
  company_id: z.number().int().optional().nullable(),
});
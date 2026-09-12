import { describe, expect, it } from "vitest";
import { AiRuleSchema } from "../lib/reconClassificationSchemas.js";

const payload = {
  name: "Listrik kantor bulanan",
  description: "Mapping biaya listrik untuk kantor pusat",
  condition_field: "reference",
  condition_operator: "equals",
  condition_value: "INV-LISTRIK-2026-08",
  conditions: [
    { field: "reference", operator: "equals", value: "INV-LISTRIK-2026-08" },
    { field: "direction", operator: "equals", value: "OUT" },
  ],
  logic: "AND",
  specificity: 2,
  action_flow: "ROUTINE_EXPENSE_ALLOCATION",
  action_coa_code: "5-1010",
  amount_tolerance: 5000,
  reference_amount: 1910811,
  confidence: 0.87,
  priority: 240,
  source: "manual",
  company_id: 12,
};

describe("Rule AI metadata API contract", () => {
  it("accepts all metadata fields posted by the COA picker", () => {
    const parsed = AiRuleSchema.safeParse(payload);

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data).toMatchObject({
      name: payload.name,
      description: payload.description,
      reference_amount: payload.reference_amount,
      amount_tolerance: payload.amount_tolerance,
      confidence: payload.confidence,
      priority: payload.priority,
      company_id: payload.company_id,
    });
  });

  it("preserves nullable metadata when the user leaves optional fields empty", () => {
    const parsed = AiRuleSchema.safeParse({
      ...payload,
      description: null,
      amount_tolerance: null,
      reference_amount: null,
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    expect(parsed.data.description).toBeNull();
    expect(parsed.data.amount_tolerance).toBeNull();
    expect(parsed.data.reference_amount).toBeNull();
  });
});
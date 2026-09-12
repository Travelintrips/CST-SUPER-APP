// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildManualRuleAiPayload,
  defaultRuleAiMetadata,
  editableRuleAiFieldsFromRow,
} from "../lib/ruleAiMetadata";

const reconciliationSource = readFileSync(
  resolve(process.cwd(), "src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);
const ruleConfigSource = readFileSync(
  resolve(process.cwd(), "src/pages/finance/recon-config/index.tsx"),
  "utf8",
);

const mutation = {
  id: 178,
  description: "Pembayaran vendor listrik",
  direction: "OUT" as const,
  provider_order_id: "INV-LISTRIK-2026-08",
  company_id: 12,
};

describe("COA picker Rule AI metadata", () => {
  it("sends every editable metadata value in the Rule AI payload", () => {
    const payload = buildManualRuleAiPayload(
      mutation,
      { code: "5-1010" },
      {
        name: "Listrik kantor bulanan",
        description: "Mapping biaya listrik untuk kantor pusat",
        referenceAmount: "1910811",
        amountTolerance: "5000",
        confidence: "0.87",
        priority: "240",
      },
      12,
    );

    expect(payload).toMatchObject({
      name: "Listrik kantor bulanan",
      description: "Mapping biaya listrik untuk kantor pusat",
      reference_amount: 1910811,
      amount_tolerance: 5000,
      confidence: 0.87,
      priority: 240,
      action_coa_code: "5-1010",
      company_id: 12,
    });
  });

  it("keeps the provider reference and direction conditions when metadata changes", () => {
    const payload = buildManualRuleAiPayload(
      mutation,
      { code: "5-1010" },
      defaultRuleAiMetadata(mutation),
      12,
    );

    expect(payload.conditions).toEqual([
      { field: "reference", operator: "equals", value: "INV-LISTRIK-2026-08" },
      { field: "direction", operator: "equals", value: "OUT" },
    ]);
  });

  it("loads saved metadata back into the Rule AI edit form", () => {
    const savedRow = {
      name: "Listrik kantor bulanan",
      description: "Mapping biaya listrik untuk kantor pusat",
      reference_amount: "1910811",
      amount_tolerance: "5000",
      confidence: "0.87",
      priority: 240,
    };

    expect(savedRow.name).toBe("Listrik kantor bulanan");
    expect(savedRow.description).toBe("Mapping biaya listrik untuk kantor pusat");
    expect(editableRuleAiFieldsFromRow(savedRow)).toEqual({
      reference_amount: 1910811,
      amount_tolerance: 5000,
      confidence: 0.87,
      priority: 240,
      candidate_requirement: "not_required",
    });
  });

  it("wires the dialog serializer and edit-form loader into the rendered pages", () => {
    expect(reconciliationSource).toContain(
      "return buildManualRuleAiPayload(mutation, selected, ruleMetadata, companyId);",
    );
    expect(reconciliationSource).toContain("setRuleMetadata(defaultRuleAiMetadata(mutation));");
    expect(reconciliationSource).toContain('id="coa-rule-name"');
    expect(reconciliationSource).toContain('id="coa-rule-description"');
    expect(reconciliationSource).toContain('id="coa-rule-reference-amount"');
    expect(reconciliationSource).toContain('id="coa-rule-amount-tolerance"');
    expect(reconciliationSource).toContain('id="coa-rule-confidence"');
    expect(reconciliationSource).toContain('id="coa-rule-priority"');
    expect(ruleConfigSource).toContain("const editableMetadata = editableRuleAiFieldsFromRow(row);");
    expect(ruleConfigSource).toContain("reference_amount: editableMetadata.reference_amount");
    expect(ruleConfigSource).toContain("amount_tolerance: editableMetadata.amount_tolerance");
  });
});
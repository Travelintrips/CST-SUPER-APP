import { describe, expect, it, vi } from "vitest";
import {
  persistRuleAiWithinTransaction,
  type AtomicRuleAiInput,
} from "../lib/reconciliation/unifiedMatchingEngine.js";

const ruleAiInput: AtomicRuleAiInput = {
  companyId: 7,
  name: "Pemetaan biaya bank",
  description: "Rule dari approval manual",
  conditionField: "description",
  conditionOperator: "contains",
  conditionValue: "admin bank",
  conditions: [
    { field: "description", operator: "contains", value: "admin bank" },
    { field: "direction", operator: "equals", value: "OUT" },
  ],
  logic: "AND",
  specificity: 2,
  actionFlow: "ROUTINE_EXPENSE_ALLOCATION",
  actionCoaCode: "5-1010",
  confidence: 1,
  priority: 120,
  source: "manual",
};

function makeClient() {
  return { execute: vi.fn() } as any;
}

describe("persistRuleAiWithinTransaction", () => {
  it("uses one transaction client for the AI row and operational mirror", async () => {
    const client = makeClient();
    client.execute
      .mockResolvedValueOnce({ rows: [] }) // advisory lock
      .mockResolvedValueOnce({ rows: [] }) // existing AI rule
      .mockResolvedValueOnce({ rows: [{ id: 41 }] }) // insert AI rule
      .mockResolvedValueOnce({ rows: [] }) // linked mirror
      .mockResolvedValueOnce({ rows: [] }) // existing independent mirror
      .mockResolvedValueOnce({ rows: [{ id: 88 }] }) // insert mirror
      .mockResolvedValueOnce({ rows: [] }); // link both sides

    await expect(
      persistRuleAiWithinTransaction(client, ruleAiInput, "admin@example.test"),
    ).resolves.toEqual({ id: 41 });

    expect(client.execute).toHaveBeenCalledTimes(7);
    expect(client.execute.mock.calls[0][0].queryChunks).toBeDefined();
  });

  it("propagates mirror failure so the surrounding transaction can roll back", async () => {
    const client = makeClient();
    client.execute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 42 }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] }); // mirror insert has no id

    await expect(
      persistRuleAiWithinTransaction(client, ruleAiInput, "admin@example.test"),
    ).rejects.toThrow("Mirror operasional Rule AI gagal disimpan");
    expect(client.execute).toHaveBeenCalledTimes(6);
  });
});
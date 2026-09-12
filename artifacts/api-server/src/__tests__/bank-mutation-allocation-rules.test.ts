import { describe, expect, it } from "vitest";
import {
  classifyMutationAllocationStatus,
  validateAllocationBatch,
} from "../lib/reconciliation/bankMutationAllocationRules.js";

describe("bank mutation multi-allocation rules", () => {
  it("classifies an unallocated, partial, and fully allocated mutation", () => {
    expect(classifyMutationAllocationStatus(20_000_000, 0)).toBe("UNMATCHED");
    expect(classifyMutationAllocationStatus(20_000_000, 18_000_000)).toBe("PARTIALLY_MATCHED");
    expect(classifyMutationAllocationStatus(20_000_000, 20_000_000)).toBe("FULLY_MATCHED");
  });

  it("allows 18m + 2m across invoices but rejects over-allocation and duplicate invoice lines", () => {
    const lines = [
      { invoiceId: 101, amount: 18_000_000 },
      { invoiceId: 202, amount: 2_000_000, previousAllocationId: 77 },
    ];
    expect(() => validateAllocationBatch(20_000_000, 0, lines)).not.toThrow();
    expect(() => validateAllocationBatch(20_000_000, 0, [
      ...lines,
      { invoiceId: 303, amount: 1 },
    ])).toThrow("Allocation melebihi");
    expect(() => validateAllocationBatch(20_000_000, 0, [
      { invoiceId: 101, amount: 10 },
      { invoiceId: 101, amount: 10 },
    ])).toThrow("Invoice duplikat");
  });
});
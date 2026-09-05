import { describe, expect, it } from "vitest";
import { allocateExpenseTax, normalizeExpenseLines } from "../lib/expenseLinePolicy.js";

describe("direct expense line policy", () => {
  it("normalizes OCR/multi-line data without creating or inferring a COA", () => {
    const lines = normalizeExpenseLines(
      [
        { name: "Kertas", quantity: 2, unitPrice: 10000, coaAccountId: 101 },
        { description: "Kopi", qty: 1, unitPrice: 15000, coaAccountId: 102 },
      ],
      {},
    );
    expect(lines.map((line) => line.subtotal)).toEqual([20000, 15000]);
    expect(lines.map((line) => line.coaAccountId)).toEqual([101, 102]);
  });

  it("fails closed when a line has no existing COA", () => {
    expect(() => normalizeExpenseLines([{ description: "Kertas", qty: 1, unitPrice: 10000 }], {}))
      .toThrow(/COA existing/);
  });

  it("keeps multi-line tax allocation balanced to the requested total", () => {
    const lines = normalizeExpenseLines(
      [
        { description: "A", qty: 1, unitPrice: 100, coaAccountId: 1 },
        { description: "B", qty: 2, unitPrice: 50, coaAccountId: 1 },
      ],
      { expenseAccountId: 1 },
    );
    const allocated = allocateExpenseTax(lines, 30);
    expect(allocated.reduce((sum, line) => sum + line.taxAmount, 0)).toBe(30);
    expect(allocated.reduce((sum, line) => sum + line.total, 0)).toBe(230);
  });
});
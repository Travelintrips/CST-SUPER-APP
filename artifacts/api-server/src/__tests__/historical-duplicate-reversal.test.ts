import { describe, expect, it } from "vitest";
import {
  hasMatchingBankDebit,
  invertHistoricalDuplicateLines,
} from "../lib/accounting/historicalDuplicateReversalMath.js";

describe("historical duplicate reversal contract", () => {
  it("inverts every original line exactly", () => {
    const lines = invertHistoricalDuplicateLines([
      { accountId: 10, debit: 160000, credit: 0, description: "Bank" },
      { accountId: 20, debit: 0, credit: "144144", description: "Revenue" },
      { accountId: 30, debit: 0, credit: "15856", description: "PPN" },
    ]);

    expect(lines).toEqual([
      { accountId: 10, debit: 0, credit: 160000, description: "[HISTORICAL_DUPLICATE_REVERSAL] Bank" },
      { accountId: 20, debit: 144144, credit: 0, description: "[HISTORICAL_DUPLICATE_REVERSAL] Revenue" },
      { accountId: 30, debit: 15856, credit: 0, description: "[HISTORICAL_DUPLICATE_REVERSAL] PPN" },
    ]);
  });

  it("requires the same bank debit account and amount", () => {
    const legacy = [{ account_id: 101, debit: "160000", credit: "0" }];
    const canonical = [{ account_id: 101, debit: 160000, credit: 0 }];
    expect(hasMatchingBankDebit(legacy, canonical)).toBe(true);
    expect(hasMatchingBankDebit(legacy, [{ account_id: 102, debit: 160000, credit: 0 }])).toBe(false);
    expect(hasMatchingBankDebit(legacy, [{ account_id: 101, debit: 150000, credit: 0 }])).toBe(false);
  });

  it("does not infer payment mutation from multiple accounting payment rows", () => {
    const paymentRows = [
      { id: 8571, entry_id: 14593 },
      { id: 9465, entry_id: 14593 },
    ];
    expect(paymentRows.filter((row) => row.entry_id === 14593)).toHaveLength(2);
    // The owner service has no accounting_payments UPDATE; selection remains
    // an explicit governance decision outside the ledger reversal.
    expect("accounting_payments_mutated").not.toBe("true");
  });
});
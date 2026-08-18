import { describe, expect, it } from "vitest";
import type { MatchCandidate } from "../lib/reconciliation/unifiedMatchingEngine.js";
import { dedupeCandidatesByBusinessIdentity } from "../lib/reconciliation/candidateBusinessIdentity.js";

function candidate(
  overrides: Partial<MatchCandidate> & Pick<MatchCandidate, "type" | "id" | "ref">,
): MatchCandidate {
  return {
    amount: 200_000,
    date: "2026-07-25",
    name: "Anthony",
    ...overrides,
  };
}

describe("business candidate deduplication", () => {
  it("prefers the canonical Sport Center payment over its accounting mirror", () => {
    const result = dedupeCandidatesByBusinessIdentity([
      candidate({
        id: 10,
        type: "accounting_payment",
        ref: "SCPAY-252",
      }),
      candidate({
        id: 252,
        type: "sport_payment",
        ref: "SCPAY-252",
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: 252,
      type: "sport_payment",
      ref: "SCPAY-252",
    });
  });

  it("collapses invoice and tenant-invoice mirrors of one payment reference", () => {
    const result = dedupeCandidatesByBusinessIdentity([
      candidate({
        id: 1,
        type: "invoice",
        ref: "INV-PAY-20260731-0001",
      }),
      candidate({
        id: 2,
        type: "tenant_invoice",
        ref: "TENANT-PAY-20260731-0001",
      }),
      candidate({
        id: 3,
        type: "invoice",
        ref: "INV-PAY-20260731-0002",
      }),
    ]);

    expect(result.map((item) => item.ref)).toEqual([
      "TENANT-PAY-20260731-0001",
      "INV-PAY-20260731-0002",
    ]);
  });

  it("does not collapse unrelated references", () => {
    const result = dedupeCandidatesByBusinessIdentity([
      candidate({ id: 1, type: "invoice", ref: "INV-PAY-20260731-0001" }),
      candidate({ id: 2, type: "invoice", ref: "INV-PAY-20260731-0002" }),
    ]);

    expect(result).toHaveLength(2);
  });
});
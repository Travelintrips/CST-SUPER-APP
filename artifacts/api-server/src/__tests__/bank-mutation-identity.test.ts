import { describe, expect, it } from "vitest";
import {
  buildBankMutationJournalRef,
  buildBankMutationSourceEventId,
} from "../lib/reconciliation/bankMutationIdentity.js";

describe("bank reconciliation canonical mutation identity", () => {
  it("keeps same-date/same-amount mutations distinct", () => {
    const first = {
      mutationId: 567,
      bankReference: "BANK-TXN-567",
      mutationKey: "99102",
    };
    const second = {
      mutationId: 569,
      bankReference: "BANK-TXN-569",
      mutationKey: "99102",
    };

    expect(buildBankMutationSourceEventId(first)).not.toBe(
      buildBankMutationSourceEventId(second),
    );
    expect(buildBankMutationJournalRef(first)).not.toBe(
      buildBankMutationJournalRef(second),
    );
    expect(buildBankMutationSourceEventId(first)).toContain("bank_mutation:567:");
    expect(buildBankMutationSourceEventId(second)).toContain("bank_mutation:569:");
  });

  it("is stable for retries of the same mutation", () => {
    const input = {
      mutationId: 567,
      bankReference: "BANK-TXN-567",
      canonicalKey: "CANONICAL-567",
      providerOrderId: "PROVIDER-567",
      mutationKey: "99102",
    };

    expect(buildBankMutationSourceEventId(input)).toBe(
      buildBankMutationSourceEventId({ ...input }),
    );
    expect(buildBankMutationJournalRef(input)).toBe(
      buildBankMutationJournalRef({ ...input }),
    );
  });

  it("falls back to mutation id when the statement has no reference", () => {
    expect(buildBankMutationSourceEventId({ mutationId: 569 })).toBe(
      "bank_mutation:569:id-only",
    );
    expect(buildBankMutationJournalRef({ mutationId: 569 })).toBe("BRM/569");
  });
});
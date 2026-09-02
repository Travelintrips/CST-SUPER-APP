import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  CANONICAL_SETTLEMENT_BANK_COA,
  CANONICAL_PAYMENT_CLEARING_COA,
  CANONICAL_SETTLEMENT_BUILDER_CODES,
  CanonicalSettlementBuilderError,
  canonicalSettlementGroupSerialization,
} from "../lib/reconciliation/canonicalSettlementBuilder.js";

describe("4C-7A.7G canonical settlement builder contract", () => {
  it("uses the resolved canonical Sport Center bank COA contract, not a public ID", () => {
    expect(CANONICAL_SETTLEMENT_BANK_COA).toEqual({
      code: "1-1023-CST",
      name: "Bank Mandiri Ciputat",
      accountType: "asset",
    });
    expect(
      "publicCoaId" in CANONICAL_SETTLEMENT_BANK_COA,
    ).toBe(false);
  });

  it("keeps QRIS payment clearing separate from the physical bank COA", () => {
    expect(CANONICAL_PAYMENT_CLEARING_COA).toEqual({
      code: "1-1024-CST",
      name: "Payment Clearing Sport Center / QRIS",
      accountType: "asset",
    });
    expect(CANONICAL_PAYMENT_CLEARING_COA.code).not.toBe(
      CANONICAL_SETTLEMENT_BANK_COA.code,
    );
  });

  it("serializes the complete grouping key deterministically", () => {
    const group = {
      companyId: 1,
      providerCode: "MANDIRI_DIRECT",
      bankAccountId: "1640006707220",
      settlementDate: "2026-08-11",
      ruleVersion: "PROD-MANDIRI-SC-20260810-v1",
    };
    expect(canonicalSettlementGroupSerialization(group)).toBe(
      "1|mandiri_direct|1640006707220|2026-08-11|PROD-MANDIRI-SC-20260810-v1",
    );
    expect(
      canonicalSettlementGroupSerialization({
        ...group,
        settlementDate: "2026-08-12",
      }),
    ).not.toBe(canonicalSettlementGroupSerialization(group));
  });

  it("publishes a controlled error when no explicit source is supplied", () => {
    const error = new CanonicalSettlementBuilderError(
      CANONICAL_SETTLEMENT_BUILDER_CODES.SOURCE_PAYMENT_REQUIRED,
      "An explicit source payment is required.",
    );
    expect(error.code).toBe("CANONICAL_SOURCE_PAYMENT_REQUIRED");
    expect(error).toBeInstanceOf(Error);
  });

  it("keeps the forbidden reconciliation and generic-post paths out of the builder surface", async () => {
    const module = await import("../lib/reconciliation/canonicalSettlementBuilder.js");
    const source = String(module.buildCanonicalSportCenterSettlements);
    expect(source).not.toContain("qris_settlements");
    expect(source).not.toContain("/post");
    expect(source).not.toContain("bank_mutation_id =");
    expect(source).not.toContain("UPDATE sport_center.sport_payments");
  });

  it("keeps the posted-journal metadata capability local to the builder transaction", async () => {
    const module = await import("../lib/reconciliation/canonicalSettlementBuilder.js");
    const source = String(module.buildCanonicalSportCenterSettlements);
    expect(source).toContain(
      "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
    );
  });

  it("compares canonical settlement IDs using the bigint database type", () => {
    const source = readFileSync(
      new URL("../lib/reconciliation/canonicalSettlementBuilder.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("WHERE settlement_id = ${batchId}::bigint");
    expect(source).not.toContain("WHERE settlement_id = ${batchId}::text");
  });
});

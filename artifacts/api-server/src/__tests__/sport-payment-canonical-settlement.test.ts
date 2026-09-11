import { describe, expect, it, vi } from "vitest";
import {
  activeCanonicalSettlementPredicate,
  canonicalSportPaymentIdFromPaymentNumber,
  canonicalSportPaymentIdExpression,
  isSportPaymentInActiveCanonicalSettlement,
  resolveCanonicalCandidatePaymentIds,
  sportPaymentCanonicalSettlementExclusionSql,
  SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT,
} from "../lib/reconciliation/sportPaymentCanonicalSettlement.js";

describe("Phase 4C-4 canonical Sport Center payment exclusion", () => {
  it("bridges the public mirror to the canonical Sport Center payment ID", () => {
    expect(canonicalSportPaymentIdExpression("sp")).toContain(
      "SUBSTRING(sp.payment_number FROM 10)::bigint",
    );
    expect(canonicalSportPaymentIdExpression("sp")).toContain(
      "'^SCPAY-SC-[0-9]+$'",
    );
  });

  it("resolves historical mirror IDs through the persisted SCPAY bridge", () => {
    expect(canonicalSportPaymentIdFromPaymentNumber("SCPAY-SC-22")).toBe(22);
    expect(
      resolveCanonicalCandidatePaymentIds([
        { paymentId: 25, paymentNumber: "SCPAY-SC-21" },
        { paymentId: 26, paymentNumber: "SCPAY-SC-22" },
      ]),
    ).toEqual([21, 22]);
  });

  it("uses the public mirror only as a compatibility fallback", () => {
    expect(
      resolveCanonicalCandidatePaymentIds(
        [{ paymentId: 26 }],
        [{ id: 26, paymentNumber: "SCPAY-SC-22" }],
      ),
    ).toEqual([22]);
  });

  it("fails closed for missing or duplicate canonical bridges", () => {
    expect(() =>
      resolveCanonicalCandidatePaymentIds([{ paymentId: 26 }]),
    ).toThrow("bridge is missing");
    expect(() =>
      resolveCanonicalCandidatePaymentIds([
        { paymentId: 25, paymentNumber: "SCPAY-SC-22" },
        { paymentId: 26, paymentNumber: "SCPAY-SC-22" },
      ]),
    ).toThrow("duplicate canonical");
  });

  it("freezes the active posted/reconciled settlement predicate", () => {
    const predicate = activeCanonicalSettlementPredicate(
      canonicalSportPaymentIdExpression("sp"),
    );

    expect(predicate).toContain("sport_center.payment_settlement_items psi");
    expect(predicate).toContain("sport_center.payment_settlement_batches psb");
    expect(predicate).toContain("psi.item_status = 'active'");
    expect(predicate).toContain("psb.status IN ('posted', 'reconciled')");
    expect(predicate).not.toContain("draft");
    expect(predicate).not.toContain("calculated");
    expect(predicate).not.toContain("reversed");
    expect(predicate).not.toContain("voided");
  });

  it("is applied as a NOT EXISTS filter before individual candidate emission", () => {
    const exclusion = sportPaymentCanonicalSettlementExclusionSql("sp");

    expect(exclusion).toMatch(/^NOT EXISTS/);
    expect(exclusion).toContain("psi.payment_id");
    expect(exclusion).toContain("psb.status IN ('posted', 'reconciled')");
  });

  it("revalidates membership through the transaction client and locks the mirror row", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ is_excluded: true }] });
    const excluded = await isSportPaymentInActiveCanonicalSettlement(
      { execute } as any,
      21,
    );

    expect(excluded).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not exclude when the transaction revalidation returns false", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [{ is_excluded: false }] });

    await expect(
      isSportPaymentInActiveCanonicalSettlement({ execute } as any, 21),
    ).resolves.toBe(false);
  });

  it("uses the controlled approval rejection code", () => {
    expect(SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT).toBe(
      "SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT",
    );
  });
});
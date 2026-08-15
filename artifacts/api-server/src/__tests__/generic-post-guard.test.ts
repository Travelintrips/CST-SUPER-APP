import { describe, expect, it } from "vitest";
import {
  assertGenericApprovalAllowed,
  assertGenericPostAllowed,
  GENERIC_POST_GUARD_CODES,
  GenericPostGuardError,
} from "../lib/reconciliation/genericPostGuard.js";

const LEGACY_QRIS_SOURCE = "public.qris_settlements";
const CANONICAL_SOURCE = "sport_center.payment_settlement_batches";

function expectGuardError(
  candidateSource: string | null | undefined,
  expectedCode: string,
) {
  try {
    assertGenericPostAllowed({
      candidate_type: "qris_settlement",
      candidate_id: 1,
      candidate_source: candidateSource,
    });
    throw new Error("expected generic post guard to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(GenericPostGuardError);
    expect((error as GenericPostGuardError).code).toBe(expectedCode);
  }
}

describe("Phase 4C-7 generic /post hard guard", () => {
  it("blocks canonical settlement before generic approval/journal creation", () => {
    expect(() =>
      assertGenericApprovalAllowed({
        candidate_type: "qris_settlement",
        candidate_id: 1,
        candidate_source: CANONICAL_SOURCE,
      }),
    ).toThrowError(
      expect.objectContaining({
        code: GENERIC_POST_GUARD_CODES.CANONICAL_SETTLEMENT_APPROVAL_REQUIRED,
      }),
    );
  });

  it("keeps the same numeric ID eligible for explicit legacy approval", () => {
    expect(() =>
      assertGenericApprovalAllowed({
        candidate_type: "qris_settlement",
        candidate_id: 1,
        candidate_source: LEGACY_QRIS_SOURCE,
      }),
    ).not.toThrow();
  });

  it("blocks canonical settlement identity before generic posting", () => {
    expectGuardError(
      CANONICAL_SOURCE,
      GENERIC_POST_GUARD_CODES.CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED,
    );
  });

  it("preserves legacy QRIS posting for the same numeric candidate ID", () => {
    expect(() =>
      assertGenericPostAllowed({
        candidate_type: "qris_settlement",
        candidate_id: 1,
        candidate_source: LEGACY_QRIS_SOURCE,
      }),
    ).not.toThrow();
  });

  it("fails closed for historical NULL QRIS source", () => {
    expectGuardError(
      null,
      GENERIC_POST_GUARD_CODES.AMBIGUOUS_QRIS_SETTLEMENT_SOURCE,
    );
  });

  it("fails closed for an unknown QRIS source", () => {
    expectGuardError(
      "unknown.settlement_source",
      GENERIC_POST_GUARD_CODES.AMBIGUOUS_QRIS_SETTLEMENT_SOURCE,
    );
  });

  it("fails closed for an incomplete QRIS identity", () => {
    try {
      assertGenericPostAllowed({
        candidate_type: "qris_settlement",
        candidate_id: null,
        candidate_source: LEGACY_QRIS_SOURCE,
      });
      throw new Error("expected incomplete QRIS identity to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(GenericPostGuardError);
      expect((error as GenericPostGuardError).code).toBe(
        GENERIC_POST_GUARD_CODES.AMBIGUOUS_QRIS_SETTLEMENT_SOURCE,
      );
    }
  });

  it.each([
    "accounting_payment",
    "invoice",
    "expense",
    "logistic_order",
    "sport_payment",
    "tenant_invoice",
  ])("preserves generic posting for non-QRIS candidate %s", (candidateType) => {
    expect(() =>
      assertGenericPostAllowed({
        candidate_type: candidateType,
        candidate_id: 1,
        candidate_source: null,
      }),
    ).not.toThrow();
  });

  it("returns the same controlled rejection on repeated canonical attempts", () => {
    const codes = Array.from({ length: 2 }, () => {
      try {
        assertGenericPostAllowed({
          candidate_type: "qris_settlement",
          candidate_id: 1,
          candidate_source: CANONICAL_SOURCE,
        });
        return null;
      } catch (error) {
        return (error as GenericPostGuardError).code;
      }
    });

    expect(codes).toEqual([
      GENERIC_POST_GUARD_CODES.CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED,
      GENERIC_POST_GUARD_CODES.CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED,
    ]);
  });
});
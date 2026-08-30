import { describe, expect, it } from "vitest";
import {
  checkQrisApprovalRule,
  QRIS_APPROVAL_REASON_CODES,
  selectQrisExactNetConfig,
  type QrisApprovalRuleInput,
} from "../lib/reconciliation/qrisApprovalRule.js";

const mutationDate = "2026-09-01";
const companyId = 7;

function validInput(overrides: Partial<QrisApprovalRuleInput> = {}): QrisApprovalRuleInput {
  return {
    companyId,
    mutationDate,
    mutationAmount: 198_600,
    payments: [{
      id: 101,
      paymentMethod: "QRIS",
      paymentDate: "2026-08-31",
      grossAmount: 200_000,
      companyId,
        canonicalGroup: null,
      canonicalMdrRate: 0.7,
      alreadyReconciled: false,
    }],
    ...overrides,
  };
}

describe("simplified QRIS approval rule", () => {
  it("passes when payment is H-1 and canonical MDR produces the exact bank net", () => {
    expect(checkQrisApprovalRule({
      ...validInput(),
      // Group metadata is deliberately absent: it is not an approval condition.
      payments: validInput().payments.map((payment) => ({ ...payment })),
    })).toEqual({
      ok: true,
      grossAmount: 200_000,
      mdrAmount: 1_400,
      expectedNetAmount: 198_600,
    });
  });

  it("ignores ambiguous provider and settlement metadata when H-1 net is exact", () => {
    const result = checkQrisApprovalRule({
      ...validInput(),
      payments: [{
        ...validInput().payments[0],
        providerCode: ["gpn_qris", "mandiri_direct"],
        settlementConfig: { ambiguous: true },
        canonicalGroup: null,
      }],
    });

    expect(result).toMatchObject({
      ok: true,
      expectedNetAmount: 198_600,
    });
  });

  it("blocks when the live payment method is no longer QRIS", () => {
    const result = checkQrisApprovalRule({
      ...validInput(),
      payments: [{
        ...validInput().payments[0],
        paymentMethod: "Transfer Bank",
      }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.PAYMENT_METHOD_NOT_QRIS,
      reason: "Payment bukan QRIS",
    });
  });

  it("selects a deterministic exact-net config without treating provider ambiguity as a blocker", () => {
    const selected = selectQrisExactNetConfig([
      { configId: 20, providerCode: "mandiri_direct", calculatedNetAmount: 198_600 },
      { configId: 10, providerCode: "gpn_qris", calculatedNetAmount: 198_600 },
      { configId: 5, providerCode: "paylabs", calculatedNetAmount: 198_599 },
    ], 198_600);

    expect(selected).toMatchObject({
      configId: 10,
      providerCode: "gpn_qris",
    });
  });

  it("blocks a payment date that is not H-1", () => {
    const result = checkQrisApprovalRule({
      ...validInput(),
      payments: [{ ...validInput().payments[0], paymentDate: "2026-08-30" }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.PAYMENT_DATE_NOT_H_MINUS_ONE,
      reason: "Tanggal payment bukan H-1",
    });
  });

  it("blocks when expected net does not equal the bank mutation", () => {
    const result = checkQrisApprovalRule({
      ...validInput(),
      mutationAmount: 198_599,
    });

    expect(result).toMatchObject({
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.NET_AMOUNT_MISMATCH,
      reason: "Nilai netto tidak sama dengan mutasi bank",
    });
  });

  it("blocks a payment that was already reconciled", () => {
    const result = checkQrisApprovalRule({
      ...validInput(),
      payments: [{ ...validInput().payments[0], alreadyReconciled: true }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.PAYMENT_ALREADY_RECONCILED,
      reason: "Payment sudah direkonsiliasi",
    });
  });

  it("blocks a payment from another company", () => {
    const result = checkQrisApprovalRule({
      ...validInput(),
      payments: [{ ...validInput().payments[0], companyId: companyId + 1 }],
    });

    expect(result).toMatchObject({
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.COMPANY_MISMATCH,
      reason: "Company payment tidak sama dengan mutasi bank",
    });
  });
});
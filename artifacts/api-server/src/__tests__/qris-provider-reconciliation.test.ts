import { describe, expect, it } from "vitest";
import { addBusinessDays, jakartaDateFromTimestamp } from "../lib/reconciliation/businessCalendar.js";
import { normalizeQrisProvider } from "../lib/reconciliation/providerSettlementRules.js";
import { calculateObservedDeduction, classifyBankMutationSource } from "../lib/reconciliation/qrisSettlement.js";
import { generateQrisMutationBatchCandidates } from "../lib/reconciliation/qrisCandidateEngine.js";

describe("provider-aware QRIS dry-run reconciliation", () => {
  it("resolves Friday, Saturday, and Sunday to Monday in Asia/Jakarta", () => {
    expect(addBusinessDays("2026-08-07", 1)).toBe("2026-08-10");
    expect(addBusinessDays("2026-08-08", 1)).toBe("2026-08-10");
    expect(addBusinessDays("2026-08-09", 1)).toBe("2026-08-10");
  });

  it("skips consecutive holidays and preserves Jakarta date", () => {
    expect(addBusinessDays("2026-08-14", 1, ["2026-08-17", "2026-08-18"])).toBe("2026-08-19");
    expect(jakartaDateFromTimestamp("2026-08-06T17:30:00.000Z")).toBe("2026-08-07");
  });

  it("keeps Mandiri and Paylabs separated and never guesses from QRIS alone", () => {
    expect(normalizeQrisProvider("Mandiri Direct")).toBe("mandiri_direct");
    expect(normalizeQrisProvider("Paylabs")).toBe("paylabs");
    expect(normalizeQrisProvider("QRIS")).toBe("unknown");
  });

  it("calculates gross 10m versus bank credit 9.93m as 70k deduction", () => {
    expect(calculateObservedDeduction(10_000_000, 9_930_000)).toEqual({
      gross: 10_000_000,
      bankCredit: 9_930_000,
      observedDeduction: 70_000,
      effectiveDeductionRate: 0.007,
    });
  });

  it("uses gross payment and never subtracts customer PPN from reconciliation", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 11, companyId: 10, amount: 10_000_000, taxAmount: 1_100_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07", providerName: "paylabs",
      }],
      mutations: [{
        id: 12, companyId: 10, transactionDate: "2026-08-07", amount: 9_930_000,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs", description: "PAYLABS SETTLEMENT",
      }],
    });
    expect(result[0]?.grossAmount).toBe(10_000_000);
    expect(result[0]?.observedDeduction).toBe(70_000);
  });

  it("does not use synthetic mutations and keeps unknown provider in review", () => {
    expect(classifyBankMutationSource("sport_center")).toBe("synthetic");
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 1, companyId: 10, amount: 10_000_000, method: "QRIS",
        status: "paid", paidAt: "2026-08-06T02:00:00.000Z",
        expectedSettlementDate: "2026-08-07", providerName: "unknown",
      }],
      mutations: [{
        id: 5, companyId: 10, transactionDate: "2026-08-07", amount: 9_930_000,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "QRIS", description: "QRIS SETTLEMENT",
      }],
    });
    expect(result[0]?.status).toBe("REVIEW");
    expect(result[0]?.providerCode).toBe("unknown");
  });

  it("supports one bank mutation for many payments, excludes reconciled payments, and is rerun-safe", () => {
    const base = {
      payments: [
        { id: 1, companyId: 10, amount: 5_000_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
        { id: 2, companyId: 10, amount: 4_930_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
        { id: 3, companyId: 10, amount: 70_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs", alreadyReconciled: true },
      ],
      mutations: [{
        id: 8, companyId: 10, transactionDate: "2026-08-07", amount: 9_860_000,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs", description: "PAYLABS SETTLEMENT",
      }],
    } as const;
    const first = generateQrisMutationBatchCandidates(base);
    expect(first[0]?.status).toBe("MATCHED");
    expect(first[0]?.paymentItems.map((item) => item.paymentId)).toEqual([1, 2]);
    expect(generateQrisMutationBatchCandidates({ ...base, existingMutationIds: [8] })).toEqual([]);
  });
});
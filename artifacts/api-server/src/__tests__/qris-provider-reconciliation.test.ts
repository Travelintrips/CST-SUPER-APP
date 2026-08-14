import { describe, expect, it } from "vitest";
import { addBusinessDays, jakartaDateFromTimestamp } from "../lib/reconciliation/businessCalendar.js";
import { normalizeQrisProvider } from "../lib/reconciliation/providerSettlementRules.js";
import { calculateObservedDeduction, classifyBankMutationSource } from "../lib/reconciliation/qrisSettlement.js";
import { generateQrisMutationBatchCandidates } from "../lib/reconciliation/qrisCandidateEngine.js";
import { resolveActiveBankAccountId } from "../lib/reconciliation/bankAccountIdentity.js";

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

  it("resolves an external account number to the internal account ID", () => {
    const accounts = [
      { id: 17, companyId: 1, accountNumber: "1640006707220" },
    ];

    expect(resolveActiveBankAccountId({
      companyId: 1,
      bankAccountId: "1640006707220",
    }, accounts)).toBe(17);
    expect(resolveActiveBankAccountId({
      companyId: 1,
      bankAccountId: "17",
    }, accounts)).toBe(17);
  });

  it("matches an external payment account number to an internal mutation account ID", () => {
    const accounts = [
      { id: 17, companyId: 1, accountNumber: "1640006707220" },
    ];
    const paymentAccountId = resolveActiveBankAccountId({
      companyId: 1,
      bankAccountId: "1640006707220",
    }, accounts);
    const mutationAccountId = resolveActiveBankAccountId({
      companyId: 1,
      bankAccountId: "17",
    }, accounts);

    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 101, companyId: 1, bankAccountId: paymentAccountId, amount: 100_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-12",
        expectedSettlementDate: "2026-08-13", providerName: "paylabs",
      }],
      mutations: [{
        id: 102, companyId: 1, bankAccountId: mutationAccountId, amount: 99_300,
        transactionDate: "2026-08-13", direction: "IN",
        source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs", description: "PAYLABS SETTLEMENT",
      }],
    });

    expect(paymentAccountId).toBe(17);
    expect(mutationAccountId).toBe(17);
    expect(result[0]).toMatchObject({
      status: "MATCHED",
      bankAccountId: 17,
      paymentItems: [{ paymentId: 101 }],
    });
  });

  it("fails closed when a bank account reference is missing or ambiguous", () => {
    const accounts = [
      { id: 17, companyId: 1, accountNumber: "1640006707220" },
      { id: 18, companyId: 1, accountNumber: "1640006707220" },
    ];

    expect(resolveActiveBankAccountId({
      companyId: 1,
      bankAccountId: "1640006707220",
    }, accounts)).toBeNull();
    expect(resolveActiveBankAccountId({
      companyId: 1,
      bankAccountId: null,
    }, accounts)).toBeNull();
  });

  it("does not treat missing bank-account mapping as a wildcard", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 1, companyId: 1, bankAccountId: null, amount: 100_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-12",
        expectedSettlementDate: "2026-08-13", providerName: "mandiri_direct",
      }],
      mutations: [{
        id: 2, companyId: 1, bankAccountId: null, amount: 100_000,
        transactionDate: "2026-08-13", direction: "IN",
        source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "mandiri_direct",
      }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("UNMATCHED");
    expect(result[0]?.reason).toContain("Dimensi company dan bank account wajib tersedia");
  });

  it("does not create a QRIS audit candidate for an ordinary inbound invoice", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 24, companyId: 10, bankAccountId: 77, amount: 150_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07", providerName: "paylabs",
      }],
      mutations: [{
        id: 25, companyId: 10, bankAccountId: 77, amount: 150_000,
        transactionDate: "2026-08-07",
        direction: "IN", source: "bank_import",
        sourceClassification: "actual_bank_mutation",
        providerName: null,
        description: "030/INVOICE-CST/VII MCM InhouseTrf CS-CS",
      }],
    });
    expect(result).toEqual([]);
  });

  it("keeps QRTRAVELI bank evidence eligible for the QRIS audit path", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 26, companyId: 10, bankAccountId: 77, amount: 150_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07", providerName: "unknown",
      }],
      mutations: [{
        id: 27, companyId: 10, bankAccountId: 77, amount: 150_000,
        transactionDate: "2026-08-07",
        direction: "IN", source: "bank_import",
        sourceClassification: "actual_bank_mutation",
        providerName: null,
        description: "7177632488799999999 QRTRAVELI",
      }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("MATCHED");
  });

  it("maps QRTRAVELI to the only configured account provider", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 260, companyId: 10, bankAccountId: 77, amount: 150_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07", providerName: "mandiri_direct",
      }],
      mutations: [{
        id: 270, companyId: 10, bankAccountId: 77, amount: 149_000,
        transactionDate: "2026-08-07",
        direction: "IN", source: "google_sheet",
        sourceClassification: "actual_bank_mutation",
        providerName: "QRIS",
        description: "7177632488799999999 QRTRAVELI",
      }],
      accountProviderRules: {
        "77": {
          mandiri_direct: {
            providerCode: "mandiri_direct",
            settlementDelayBusinessDays: 1,
            matchWindowBusinessDays: 1,
            maxEffectiveDeductionRate: 0.1,
          },
        },
      },
    });
    expect(result[0]?.providerCode).toBe("gpn_qris");
    expect(result[0]?.providerDetectionSource).toBe("mutation_description");
    expect(result[0]?.status).toBe("MATCHED");
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
        bankAccountId: 77,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07", providerName: "paylabs",
      }],
      mutations: [{
        id: 12, companyId: 10, transactionDate: "2026-08-07", amount: 9_930_000,
        bankAccountId: 77,
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
        bankAccountId: 77,
        status: "paid", paidAt: "2026-08-06T02:00:00.000Z",
        expectedSettlementDate: "2026-08-07", providerName: "unknown",
      }],
      mutations: [{
        id: 5, companyId: 10, transactionDate: "2026-08-07", amount: 9_930_000,
        bankAccountId: 77,
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
        { id: 1, companyId: 10, amount: 5_000_000, bankAccountId: 77, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs", paymentNumber: "PAY-001", bookingId: 101, bookingNumber: "BK-001", paymentDate: "2026-08-06" },
        { id: 2, companyId: 10, amount: 4_930_000, bankAccountId: 77, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs", paymentNumber: "PAY-002", bookingId: 102, bookingNumber: "BK-002", paymentDate: "2026-08-06" },
        { id: 3, companyId: 10, amount: 70_000, bankAccountId: 77, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs", alreadyReconciled: true },
      ],
      mutations: [{
        id: 8, companyId: 10, transactionDate: "2026-08-07", amount: 9_860_000,
        bankAccountId: 77,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs", description: "PAYLABS SETTLEMENT",
      }],
    } as const;
    const first = generateQrisMutationBatchCandidates(base);
    expect(first[0]?.status).toBe("MATCHED");
    expect(first[0]?.paymentItems.map((item) => item.paymentId)).toEqual([1, 2]);
    expect(first[0]?.paymentItems).toMatchObject([
      { paymentId: 1, paymentNumber: "PAY-001", bookingId: 101, bookingNumber: "BK-001", paymentDate: "2026-08-06" },
      { paymentId: 2, paymentNumber: "PAY-002", bookingId: 102, bookingNumber: "BK-002", paymentDate: "2026-08-06" },
    ]);
    expect(generateQrisMutationBatchCandidates({ ...base, existingMutationIds: [8] })).toEqual([]);
  });

  it("keeps a posted canonical payment out of a supplemental late-arriving batch", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [
        {
          id: 25, companyId: 1, amount: 100_000, bankAccountId: 17,
          method: "QRIS", status: "paid", paidAt: "2026-08-12",
          expectedSettlementDate: "2026-08-13", providerName: "mandiri_direct",
          settlementRuleVersion: "PROD-MANDIRI-SC-20260810-v1",
          alreadyReconciled: true,
        },
        {
          id: 26, companyId: 1, amount: 200_000, bankAccountId: 17,
          method: "QRIS", status: "paid", paidAt: "2026-08-12",
          expectedSettlementDate: "2026-08-13", providerName: "mandiri_direct",
          settlementRuleVersion: "PROD-MANDIRI-SC-20260810-v1",
        },
      ],
      mutations: [{
        id: 227, companyId: 1, bankAccountId: 17, transactionDate: "2026-08-13",
        amount: 200_000, direction: "IN", source: "bank_import",
        sourceClassification: "actual_bank_mutation",
        providerName: "mandiri_direct",
      }],
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.paymentItems.map((item) => item.paymentId)).toEqual([26]);
    expect(result[0]?.paymentItems.map((item) => item.paymentId)).not.toContain(25);
  });

  it("does not mix same company/provider/date payments across bank accounts", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [
        { id: 21, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
        { id: 22, companyId: 10, bankAccountId: 88, amount: 200_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
      ],
      mutations: [{
        id: 23, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 100_000,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs",
      }],
    });
    expect(result[0]?.status).toBe("MATCHED");
    expect(result[0]?.bankAccountId).toBe(77);
    expect(result[0]?.paymentItems.map((item) => item.paymentId)).toEqual([21]);
  });

  it("does not auto-match an arbitrary subset when multiple combinations fit", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [
        { id: 31, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
        { id: 32, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
        { id: 33, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs" },
      ],
      mutations: [{
        id: 34, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 199_300,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs",
      }],
    });
    expect(result[0]?.status).toBe("REVIEW");
    expect(result[0]?.paymentItems).toHaveLength(3);
    // The natural batch is all three payments; the engine must not select two
    // merely because their effective rate happens to be acceptable.
    expect(result[0]?.grossAmount).toBe(300_000);
    expect(result[0]?.reason).toContain("AMBIGUOUS_PAYMENT_PARTITION");
  });

  it("keeps negative observed deduction out of MATCHED", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 41, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS",
        status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs",
      }],
      mutations: [{
        id: 42, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 101_000,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "paylabs",
      }],
    });
    expect(result[0]?.status).not.toBe("MATCHED");
    expect(result[0]?.reason).toContain("NEGATIVE_OBSERVED_DEDUCTION");
  });

  it("keeps same-provider/date multiple settlements in review without references", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 51, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS",
        status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs",
      }],
      mutations: [
        { id: 52, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 99_300, direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation", providerName: "paylabs" },
        { id: 53, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 0, direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation", providerName: "paylabs" },
      ],
    });
    expect(result.every((candidate) => candidate.status === "REVIEW")).toBe(true);
    expect(result.every((candidate) => candidate.reason.includes("AMBIGUOUS_PAYMENT_PARTITION"))).toBe(true);
  });

  it("does not synthesize settlement metadata in the strict runtime contract", () => {
    const result = generateQrisMutationBatchCandidates({
      requireExplicitSettlementMetadata: true,
      payments: [{
        id: 91, companyId: 10, bankAccountId: 77, amount: 100_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: null, settlementRuleVersion: null,
        providerName: "paylabs",
      }],
      mutations: [{
        id: 92, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07",
        amount: 99_300, direction: "IN", source: "bank_import",
        sourceClassification: "actual_bank_mutation",
        providerName: "paylabs", description: "PAYLABS SETTLEMENT",
      }],
    });

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      status: "UNMATCHED",
      estimatedSettlementDate: "",
      settlementRuleVersion: "",
      paymentItems: [],
    });
    expect(result[0]?.status).not.toBe("MATCHED");
  });

  it("matches strict runtime metadata only with an explicit provider rule", () => {
    const result = generateQrisMutationBatchCandidates({
      requireExplicitSettlementMetadata: true,
      providerRules: {
        paylabs: {
          providerCode: "paylabs",
          ruleVersion: "OWNER-PAYLABS-V1",
          settlementDelayBusinessDays: 1,
          matchWindowBusinessDays: 1,
          maxEffectiveDeductionRate: 0.1,
        },
      },
      payments: [{
        id: 93, companyId: 10, bankAccountId: 77, amount: 100_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07",
        settlementRuleVersion: "OWNER-PAYLABS-V1",
        providerName: "paylabs",
      }],
      mutations: [{
        id: 94, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07",
        amount: 99_300, direction: "IN", source: "bank_import",
        sourceClassification: "actual_bank_mutation",
        providerName: "paylabs", description: "PAYLABS SETTLEMENT",
      }],
    });

    expect(result[0]?.status).toBe("MATCHED");
    expect(result[0]?.settlementRuleVersion).toBe("OWNER-PAYLABS-V1");
  });

  it("keeps a cross-date partial settlement reviewable without calling it an ambiguous subset", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 81, companyId: 10, bankAccountId: 77, amount: 1_430_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-06",
        expectedSettlementDate: "2026-08-07", providerName: "mandiri_direct",
      }, {
        id: 80, companyId: 10, bankAccountId: 77, amount: 100_000,
        method: "QRIS", status: "paid", paidAt: "2026-08-05",
        expectedSettlementDate: "2026-08-06", providerName: "mandiri_direct",
      }],
      mutations: [
        {
          id: 82, companyId: 10, bankAccountId: 77, amount: 933_420,
          transactionDate: "2026-08-07", direction: "IN", source: "bank_import",
          sourceClassification: "actual_bank_mutation",
          providerName: "mandiri_direct", description: "MANDIRI DIRECT SETTLEMENT",
        },
        {
          id: 83, companyId: 10, bankAccountId: 77, amount: 496_580,
          transactionDate: "2026-08-08", direction: "IN", source: "bank_import",
          sourceClassification: "actual_bank_mutation",
          providerName: "mandiri_direct", description: "MANDIRI DIRECT SETTLEMENT",
        },
      ],
    });
    expect(result.map((candidate) => candidate.status)).toEqual(["REVIEW", "REVIEW"]);
    expect(result.every((candidate) => candidate.reason.includes("SPLIT_SETTLEMENT_REVIEW"))).toBe(true);
    expect(result.every((candidate) => candidate.paymentItems.map((item) => item.paymentId).join(",") === "81")).toBe(true);
  });

  it("allows a same-day partition only when the settlement reference is shared", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [
        { id: 71, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs", providerReference: "batch-a" },
        { id: 72, companyId: 10, bankAccountId: 77, amount: 200_000, method: "QRIS", status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs", providerReference: "batch-b" },
      ],
      mutations: [
        { id: 73, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 99_300, direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation", providerName: "paylabs", settlementReference: "batch-a" },
        { id: 74, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 198_600, direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation", providerName: "paylabs", settlementReference: "batch-b" },
      ],
    });
    expect(result.map((candidate) => candidate.status)).toEqual(["MATCHED", "MATCHED"]);
    expect(result[0]?.paymentItems.map((item) => item.paymentId)).toEqual([71]);
    expect(result[1]?.paymentItems.map((item) => item.paymentId)).toEqual([72]);
  });

  it("uses provider evidence, not the receiving bank name, and keeps unknown in review", () => {
    const result = generateQrisMutationBatchCandidates({
      payments: [{
        id: 61, companyId: 10, bankAccountId: 77, amount: 100_000, method: "QRIS",
        status: "paid", paidAt: "2026-08-06", expectedSettlementDate: "2026-08-07", providerName: "paylabs",
      }],
      mutations: [{
        id: 62, companyId: 10, bankAccountId: 77, transactionDate: "2026-08-07", amount: 99_300,
        direction: "IN", source: "bank_import", sourceClassification: "actual_bank_mutation",
        providerName: "QRIS", description: "MANDIRI DIRECT SETTLEMENT",
      }],
    });
    expect(result[0]?.providerCode).toBe("mandiri_direct");
    expect(result[0]?.providerDetectionSource).toBe("mutation_description");
    expect(result[0]?.status).toBe("REVIEW");
  });
});
import {
  calculateObservedDeduction,
  classifyBankMutationSource,
  isQrisSettlementDescription,
  type BankMutationSourceClassification,
} from "./qrisSettlement.js";
import {
  DEFAULT_QRIS_PROVIDER_RULES,
  normalizeQrisProvider,
  type QrisProviderCode,
  type QrisProviderRule,
} from "./providerSettlementRules.js";

export type QrisReconciliationStatus = "MATCHED" | "REVIEW" | "UNMATCHED";
export type QrisProviderDetectionSource =
  | "provider_reference"
  | "mutation_description"
  | "settlement_rule"
  | "manual"
  | "unknown";

export interface QrisPaymentCandidateInput {
  id: number;
  companyId: number | null;
  bankAccountId: number | null;
  amount: number;
  method: string | null;
  status: string | null;
  paidAt: string | Date | null;
  expectedSettlementDate: string | null;
  settlementRuleVersion?: string | null;
  providerName?: string | null;
  providerReference?: string | null;
  taxAmount?: number | null;
  alreadyReconciled?: boolean;
}

export interface QrisMutationCandidateInput {
  id: number;
  companyId: number | null;
  bankAccountId: number | null;
  transactionDate: string;
  amount: number;
  direction: string | null;
  source: string | null;
  sourceClassification?: string | null;
  providerName?: string | null;
  providerOrderId?: string | null;
  settlementReference?: string | null;
  providerBatchReference?: string | null;
  providerTransactionReference?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface QrisMutationBatchCandidate {
  mutationId: number;
  companyId: number | null;
  bankAccountId: number | null;
  providerCode: QrisProviderCode;
  providerDetectionSource: QrisProviderDetectionSource;
  mutationSourceClassification: BankMutationSourceClassification;
  sourceDate: string;
  estimatedSettlementDate: string;
  settlementRuleVersion: string;
  grossAmount: number;
  netAmount: number;
  observedDeduction: number;
  effectiveDeductionRate: number | null;
  paymentItems: Array<{
    paymentId: number;
    grossAmount: number;
    expectedSettlementDate: string | null;
    settlementRuleVersion: string | null;
  }>;
  status: QrisReconciliationStatus;
  confidence: number;
  reason: string;
}

function roundMoney(value: number): number {
  return Number((Math.max(0, value) || 0).toFixed(2));
}

function isQrisPayment(payment: QrisPaymentCandidateInput): boolean {
  return String(payment.method ?? "").trim().toLowerCase().includes("qris");
}

function isEligiblePayment(payment: QrisPaymentCandidateInput): boolean {
  return isQrisPayment(payment)
    && String(payment.status ?? "").toLowerCase() === "paid"
    && !payment.alreadyReconciled
    // A missing account is not a wildcard. It cannot safely match a bank
    // mutation because one company may settle through multiple accounts.
    && payment.bankAccountId != null;
}

function providerEvidence(mutation: QrisMutationCandidateInput): {
  providerCode: QrisProviderCode;
  source: QrisProviderDetectionSource;
} {
  const explicit = normalizeQrisProvider(mutation.providerName);
  if (explicit !== "unknown") {
    return { providerCode: explicit, source: "provider_reference" };
  }
  for (const reference of [
    mutation.providerOrderId,
    mutation.settlementReference,
    mutation.providerBatchReference,
    mutation.providerTransactionReference,
  ]) {
    const fromReference = normalizeQrisProvider(reference);
    if (fromReference !== "unknown") {
      return { providerCode: fromReference, source: "provider_reference" };
    }
  }
  const fromDescription = normalizeQrisProvider(mutation.description);
  if (fromDescription !== "unknown") {
    return { providerCode: fromDescription, source: "mutation_description" };
  }
  return { providerCode: "unknown", source: "unknown" };
}

/**
 * The QRIS candidate flow is deliberately opt-in by bank evidence. A payment
 * method in the Sport Center table is not enough to classify an arbitrary
 * inbound bank mutation as QRIS; otherwise ordinary invoices would receive a
 * misleading QRIS review panel.
 */
function hasQrisBankEvidence(mutation: QrisMutationCandidateInput): boolean {
  if (normalizeQrisProvider(mutation.providerName) !== "unknown") return true;

  return [
    mutation.providerName,
    mutation.providerOrderId,
    mutation.settlementReference,
    mutation.providerBatchReference,
    mutation.providerTransactionReference,
    mutation.description,
  ].some((value) => isQrisSettlementDescription(value));
}

function partitionReference(
  value: QrisMutationCandidateInput | QrisPaymentCandidateInput,
): string | null {
  const candidate = value as QrisMutationCandidateInput;
  const reference = candidate.settlementReference
    ?? candidate.providerBatchReference
    ?? candidate.providerTransactionReference
    ?? candidate.providerOrderId
    ?? (value as QrisPaymentCandidateInput).providerReference;
  const normalized = String(reference ?? "").trim().toLowerCase();
  return normalized || null;
}

function sameNaturalBatch(
  payment: QrisPaymentCandidateInput,
  mutation: QrisMutationCandidateInput,
  providerCode: QrisProviderCode,
): boolean {
  return payment.companyId === mutation.companyId
    && payment.bankAccountId === mutation.bankAccountId
    && payment.expectedSettlementDate === mutation.transactionDate
    && normalizeQrisProvider(payment.providerName) === providerCode;
}

function isOpenMutation(mutation: QrisMutationCandidateInput): boolean {
  return String(mutation.direction ?? "").toUpperCase() === "IN"
    && !["posted", "approved", "approved_pending_posting", "void"]
      .includes(String(mutation.status ?? "").toLowerCase());
}

function isValidObservedDeduction(
  grossAmount: number,
  bankCredit: number,
  maxRate: number,
): boolean {
  const observed = calculateObservedDeduction(grossAmount, bankCredit);
  // A credit above the natural gross batch is never a valid fee variance.
  if (observed.observedDeduction < 0) return false;
  return observed.observedDeduction / Math.max(grossAmount, 0.01)
    <= maxRate + 0.0001;
}

/**
 * Generate dry-run candidates from imported bank mutations only.
 *
 * Matching is deliberately natural-batch-first. There is no unrestricted
 * subset-sum over a company's daily payments. A payment subset is considered
 * only when an auditable provider/reference key partitions a multiple-
 * settlement natural batch and the payment carries the same key.
 */
export function generateQrisMutationBatchCandidates(input: {
  payments: readonly QrisPaymentCandidateInput[];
  mutations: readonly QrisMutationCandidateInput[];
  holidays?: Iterable<string>;
  providerRules?: Partial<Record<QrisProviderCode, QrisProviderRule>>;
  accountProviderRules?: Record<string, Partial<Record<QrisProviderCode, QrisProviderRule>>>;
  existingMutationIds?: Iterable<number>;
}): QrisMutationBatchCandidate[] {
  const rules = { ...DEFAULT_QRIS_PROVIDER_RULES, ...(input.providerRules ?? {}) };
  const existingMutationIds = new Set(input.existingMutationIds ?? []);
  const eligiblePayments = input.payments.filter(isEligiblePayment);
  const openMutations = input.mutations.filter(isOpenMutation);
  const output: QrisMutationBatchCandidate[] = [];

  for (const mutation of [...openMutations].sort((a, b) => a.id - b.id)) {
    if (existingMutationIds.has(mutation.id)) continue;
    if (!hasQrisBankEvidence(mutation)) continue;

    const sourceClassification = classifyBankMutationSource(
      mutation.source,
      mutation.sourceClassification,
    );
    const evidence = providerEvidence(mutation);
    const accountRules = input.accountProviderRules?.[String(mutation.bankAccountId)];
    const rule = accountRules?.[evidence.providerCode]
      ?? rules[evidence.providerCode]
      ?? rules.unknown;
    const ruleVersion = rule.ruleVersion ?? "legacy-v1";
    const dimensionPayments = eligiblePayments.filter((payment) =>
      payment.companyId === mutation.companyId
        && payment.bankAccountId === mutation.bankAccountId
        && payment.expectedSettlementDate === mutation.transactionDate,
    );
    const naturalPayments = dimensionPayments.filter((payment) =>
      evidence.providerCode !== "unknown"
        && sameNaturalBatch(payment, mutation, evidence.providerCode),
    );
    const sameDimensionMutations = openMutations.filter((other) => {
      if (other.id === mutation.id || other.companyId !== mutation.companyId
        || other.bankAccountId !== mutation.bankAccountId
        || other.transactionDate !== mutation.transactionDate) return false;
      const otherEvidence = providerEvidence(other);
      return otherEvidence.providerCode === evidence.providerCode
        && evidence.providerCode !== "unknown";
    });

    const mutationReference = partitionReference(mutation);
    const hasMultipleSettlements = sameDimensionMutations.length > 0;
    const allPartitionReferences = [
      mutation,
      ...sameDimensionMutations,
    ].map(partitionReference);
    const deterministicPartition = hasMultipleSettlements
      && mutationReference !== null
      && allPartitionReferences.every((reference) => reference !== null)
      && new Set(allPartitionReferences).size === allPartitionReferences.length;

    // Unknown provider evidence is review-only. Showing the complete
    // company/account/date pool is useful to a reviewer, but it is never an
    // auto-match and never a nominal subset.
    let selectedPayments = evidence.providerCode === "unknown"
      ? dimensionPayments
      : naturalPayments;
    let partitionBlocked = false;
    if (hasMultipleSettlements) {
      // Multiple settlements on the same provider/date/account are not
      // evidence that an arbitrary amount-based subset belongs to this row.
      if (!deterministicPartition) {
        partitionBlocked = true;
        selectedPayments = [];
      } else {
        selectedPayments = naturalPayments.filter((payment) =>
          partitionReference(payment) === mutationReference,
        );
        // The reference must exist on the payment side too. Otherwise this is
        // still an arbitrary partition dressed up as a bank reference.
        if (!selectedPayments.length) partitionBlocked = true;
      }
    }

    const grossAmount = roundMoney(
      selectedPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0),
    );
    const netAmount = roundMoney(Number(mutation.amount) || 0);
    const observed = calculateObservedDeduction(grossAmount, netAmount);
    const hasNaturalBatch = evidence.providerCode === "unknown"
      ? dimensionPayments.length > 0
      : naturalPayments.length > 0;
    const validDeduction = grossAmount > 0
      && isValidObservedDeduction(grossAmount, netAmount, rule.maxEffectiveDeductionRate);
    const actualEvidence = sourceClassification === "actual_bank_mutation";
    const knownProvider = evidence.providerCode !== "unknown";
    const completeBankDimension = mutation.companyId != null && mutation.bankAccountId != null;
    const expectedDatesPresent = naturalPayments.every((payment) => Boolean(payment.expectedSettlementDate));
    const matched = completeBankDimension
      && actualEvidence
      && knownProvider
      && hasNaturalBatch
      && expectedDatesPresent
      && !partitionBlocked
      && validDeduction;
    const reviewReason = !completeBankDimension
      ? "Dimensi company dan bank account wajib tersedia; rekening null bukan wildcard."
      : !actualEvidence
        ? "Bukti bukan mutasi bank aktual; hanya review."
        : !knownProvider
          ? "Provider unknown; tidak boleh automatic match."
          : !hasNaturalBatch
            ? "Tidak ditemukan natural batch QRIS pada company, rekening, provider, dan expected settlement date yang sama."
            : !expectedDatesPresent
              ? "Expected settlement date belum tersnapshot; hanya review."
              : partitionBlocked
                ? "AMBIGUOUS_PAYMENT_PARTITION: settlement provider/date/rekening ganda tanpa reference pembeda yang juga ada pada payment."
                : observed.observedDeduction < 0
                  ? "NEGATIVE_OBSERVED_DEDUCTION: gross natural batch lebih kecil dari bank credit."
                  : grossAmount > netAmount
                    ? "AMBIGUOUS_PAYMENT_PARTITION: natural batch gross tidak cocok; subset arbitrer tidak boleh dipilih hanya dari nominal/rate."
                    : !validDeduction
                    ? "Observed deduction/rate di luar tolerance provider."
                    : `${evidence.providerCode} natural batch cocok secara deterministic.`;

    output.push({
      mutationId: mutation.id,
      companyId: mutation.companyId,
      bankAccountId: mutation.bankAccountId,
      providerCode: evidence.providerCode,
      providerDetectionSource: evidence.source,
      mutationSourceClassification: sourceClassification,
      sourceDate: mutation.transactionDate,
      estimatedSettlementDate: selectedPayments[0]?.expectedSettlementDate ?? mutation.transactionDate,
      settlementRuleVersion: selectedPayments[0]?.settlementRuleVersion ?? ruleVersion,
      grossAmount,
      netAmount,
      observedDeduction: observed.observedDeduction,
      effectiveDeductionRate: observed.effectiveDeductionRate,
      paymentItems: selectedPayments.map((payment) => ({
        paymentId: payment.id,
        grossAmount: roundMoney(Number(payment.amount) || 0),
        expectedSettlementDate: payment.expectedSettlementDate,
        settlementRuleVersion: payment.settlementRuleVersion ?? ruleVersion,
      })),
      status: matched ? "MATCHED" : evidence.providerCode === "unknown"
        ? "REVIEW"
        : completeBankDimension && dimensionPayments.length > 0 && !hasNaturalBatch
          ? "REVIEW"
          : partitionBlocked || (hasNaturalBatch && !validDeduction)
            ? "REVIEW"
            : "UNMATCHED",
      confidence: matched ? (selectedPayments.length > 1 ? 0.9 : 0.98) : 0,
      reason: reviewReason,
    });
  }

  return output;
}
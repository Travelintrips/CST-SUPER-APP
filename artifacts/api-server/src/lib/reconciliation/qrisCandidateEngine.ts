import {
  calculateObservedDeduction,
  classifyBankMutationSource,
  isQrisSettlementDescription,
  resolveSettlementDate,
  type BankMutationSourceClassification,
} from "./qrisSettlement.js";
import {
  DEFAULT_QRIS_PROVIDER_RULES,
  accountProviderRulesForDate,
  expectedQrisSettlementDate,
  normalizeQrisProvider,
  areQrisProvidersCompatible,
  providerRulesForDate,
  type QrisAccountProviderRuleCatalog,
  type QrisProviderCode,
  type QrisProviderRule,
  type QrisProviderRuleCatalog,
} from "./providerSettlementRules.js";
import {
  businessDayDistance,
  jakartaDateFromTimestamp,
} from "./businessCalendar.js";

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
  paymentNumber?: string | null;
  bookingId?: number | null;
  bookingNumber?: string | null;
  customerName?: string | null;
  facilityName?: string | null;
  bookingDate?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  /**
   * Deprecated compatibility alias. The candidate engine intentionally does
   * not use this field for matching or snapshots; callers must provide the
   * canonical payment timestamp through paidAt.
   */
  paymentDate?: string | null;
  taxAmount?: number | null;
  alreadyReconciled?: boolean;
  canonicalSettlementId?: number | null;
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
    paymentNumber?: string | null;
    bookingId?: number | null;
    bookingNumber?: string | null;
    customerName?: string | null;
    facilityName?: string | null;
    bookingDate?: string | null;
    startTime?: string | null;
    endTime?: string | null;
    paidAt?: string | null;
    /** @deprecated Use paidAt. Kept only for old snapshot readers. */
    paymentDate?: string | null;
  }>;
  status: QrisReconciliationStatus;
  confidence: number;
  reason: string;
}

export type QrisCandidateRule =
  | "strict"
  | "payment_method_h_minus_one"
  /**
   * Production QRIS auto-match contract:
   * confirmed payment + Jakarta H-1 + actual IN mutation + complete
   * company/account/provider dimensions + exact gross/net/MDR evidence.
   */
  | "strict_h_minus_one_auto";

function roundMoney(value: number): number {
  return Number((Math.max(0, value) || 0).toFixed(2));
}

function isQrisPayment(payment: QrisPaymentCandidateInput): boolean {
  return String(payment.method ?? "").trim().toLowerCase().includes("qris");
}

function isEligiblePayment(
  payment: QrisPaymentCandidateInput,
  confirmedOnly = false,
): boolean {
  return isQrisPayment(payment)
    && (
      confirmedOnly
        ? String(payment.status ?? "").toLowerCase() === "confirmed"
        : String(payment.status ?? "").toLowerCase() === "paid"
    )
    && !payment.alreadyReconciled;
}

function calendarDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  const raw = value instanceof Date ? null : String(value).trim();
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const date = jakartaDateFromTimestamp(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function canonicalPaymentDate(payment: QrisPaymentCandidateInput): string | null {
  // paymentDate was historically overloaded by callers and could contain a
  // booking date. paidAt is the only payment timeline source accepted here;
  // SQL loaders are responsible for applying the legacy confirmed_at/created_at
  // fallback before constructing this input.
  return calendarDate(payment.paidAt);
}

function isPaymentChronologicallyValid(
  payment: QrisPaymentCandidateInput,
  mutationDate: string,
): boolean {
  // Booking date is intentionally not checked here: customers may pay for a
  // future booking. The settlement cohort is based on the payment/settlement
  // timeline, so only a payment recorded after the bank settlement is invalid.
  const paymentDate = canonicalPaymentDate(payment);
  return paymentDate == null || paymentDate <= mutationDate;
}

/**
 * Older mirrors may retain a settlement date that was calculated before the
 * canonical QRIS H+1 rule existed. Recompute from the payment timestamp for
 * matching so a stale value cannot pull an earlier payment into a later bank
 * mutation. The stored value remains the only fallback when the source has no
 * usable payment timestamp.
 */
function settlementDateForMatching(
  payment: QrisPaymentCandidateInput,
  rules: Partial<Record<QrisProviderCode, QrisProviderRule>>,
  accountProviderRules: Record<string, Partial<Record<QrisProviderCode, QrisProviderRule>>> | undefined,
): string | null {
  const paymentTimestamp = payment.paidAt;
  if (!paymentTimestamp) return calendarDate(payment.expectedSettlementDate);

  const providerCode = normalizeQrisProvider(payment.providerName);
  const accountRule = payment.bankAccountId == null
    ? undefined
    : accountProviderRules?.[String(payment.bankAccountId)]?.[providerCode];
  const rule = accountRule ?? rules[providerCode];
  if (!rule) return calendarDate(payment.expectedSettlementDate);

  return calendarDate(expectedQrisSettlementDate(
    paymentTimestamp,
    providerCode,
    [],
    { settlementDelayBusinessDays: rule.settlementDelayBusinessDays },
  )) ?? calendarDate(payment.expectedSettlementDate);
}

function providerEvidence(
  mutation: QrisMutationCandidateInput,
  accountProviderRules?: Record<string, Partial<Record<QrisProviderCode, QrisProviderRule>>>,
): {
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

  // A generic bank label such as "QRIS" is not enough to identify a
  // provider. When the mutation is tied to a bank account with exactly one
  // configured QRIS provider, however, the active account rule is an
  // auditable provider dimension and may be used for review matching.
  const configuredProviders = Object.entries(
    accountProviderRules?.[String(mutation.bankAccountId)] ?? {},
  ).filter(([provider, rule]) =>
    provider !== "unknown" && rule?.providerCode === provider,
  );
  if (isQrisSettlementDescription(mutation.description) && configuredProviders.length === 1) {
    return {
      providerCode: configuredProviders[0]![0] as QrisProviderCode,
      source: "settlement_rule",
    };
  }

  return { providerCode: "unknown", source: "unknown" };
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
  providerRuleCatalog?: QrisProviderRuleCatalog;
  accountProviderRuleCatalog?: QrisAccountProviderRuleCatalog;
  existingMutationIds?: Iterable<number>;
  requireExplicitSettlementMetadata?: boolean;
  candidateRule?: QrisCandidateRule;
}): QrisMutationBatchCandidate[] {
  const requireExplicitSettlementMetadata = input.requireExplicitSettlementMetadata === true;
  const paymentMethodHMinusOneOnly = input.candidateRule === "payment_method_h_minus_one";
  const strictHMinusOneAuto = input.candidateRule === "strict_h_minus_one_auto";
  const hMinusOneRule = paymentMethodHMinusOneOnly || strictHMinusOneAuto;
  const baseRules = {
    ...DEFAULT_QRIS_PROVIDER_RULES,
    ...(input.providerRules ?? {}),
  };
  const existingMutationIds = new Set(input.existingMutationIds ?? []);
  const eligiblePayments = input.payments.filter((payment) =>
    isEligiblePayment(payment, strictHMinusOneAuto),
  );
  const openMutations = input.mutations.filter(isOpenMutation);
  const output: QrisMutationBatchCandidate[] = [];

  for (const mutation of [...openMutations].sort((a, b) => a.id - b.id)) {
    if (existingMutationIds.has(mutation.id)) continue;

    const sourceClassification = classifyBankMutationSource(
      mutation.source,
      mutation.sourceClassification,
    );
    const rules = input.providerRuleCatalog
      ? providerRulesForDate(
        input.providerRuleCatalog,
        mutation.transactionDate,
        { includeDefaults: true },
      )
      : baseRules;
    const effectiveAccountRules = input.accountProviderRuleCatalog
      ? accountProviderRulesForDate(
        input.accountProviderRuleCatalog,
        mutation.transactionDate,
      )
      : input.accountProviderRules;
    const evidence = providerEvidence(mutation, effectiveAccountRules);
    const methodOnlyPath = evidence.providerCode === "unknown";
      // The payment method is the QRIS classifier for the legacy review path.
      // The strict auto-match path below deliberately requires the complete
      // bank-side evidence before it emits anything.
    const matchingRules = { ...DEFAULT_QRIS_PROVIDER_RULES, ...rules };
    const accountRules = effectiveAccountRules?.[String(mutation.bankAccountId)];
    const directAccountRule = accountRules?.[evidence.providerCode];
    const compatibleAccountRules = Object.values(accountRules ?? {}).filter((candidateRule) =>
      areQrisProvidersCompatible(candidateRule.providerCode, evidence.providerCode),
    );
    // A bank statement can identify Mandiri's payment-side provider as
    // gpn_qris (for example QRTRAVELI). Prefer the single explicit account
    // rule for the compatible payment provider so the candidate's fee
    // tolerance agrees with the canonical settlement builder.
    const compatibleAccountRule = directAccountRule ?? (
      compatibleAccountRules.length === 1 ? compatibleAccountRules[0] : undefined
    );
    const rule = compatibleAccountRule
      ?? rules[evidence.providerCode]
      ?? matchingRules.unknown;
    const ambiguousEffectiveRule =
      rule?.resolutionError === "AMBIGUOUS_EFFECTIVE_WINDOW";
    const ruleVersion = rule?.ruleVersion ?? (requireExplicitSettlementMetadata ? "" : "legacy-v1");
    const dimensionPayments = eligiblePayments.map((payment) => ({
      ...payment,
      // The simplified candidate rule intentionally derives the settlement
      // cohort only from the payment timestamp. Stored provider/account
      // metadata is not a candidate gate in this mode.
      expectedSettlementDate: paymentMethodHMinusOneOnly
        ? resolveSettlementDate(payment.paidAt, null, 1)
        : settlementDateForMatching(
          payment,
          matchingRules,
          effectiveAccountRules,
        ),
    })).filter((payment) =>
      payment.companyId === mutation.companyId
        && payment.expectedSettlementDate != null
        && (
          paymentMethodHMinusOneOnly
            ? payment.expectedSettlementDate === mutation.transactionDate
            : payment.bankAccountId === mutation.bankAccountId
              && (!requireExplicitSettlementMetadata
                 || methodOnlyPath
                 || !rule?.ruleVersion
                 || !String(payment.settlementRuleVersion ?? "").trim()
                 || payment.settlementRuleVersion === rule.ruleVersion)
              && (!requireExplicitSettlementMetadata
                 || payment.expectedSettlementDate === mutation.transactionDate)
              && (!requireExplicitSettlementMetadata
                 || isPaymentChronologicallyValid(payment, mutation.transactionDate))
        ),
    );
    const cohortPayments = dimensionPayments.filter((payment) =>
      paymentMethodHMinusOneOnly || requireExplicitSettlementMetadata
        ? payment.expectedSettlementDate === mutation.transactionDate
        : businessDayDistance(
          payment.expectedSettlementDate!,
          mutation.transactionDate,
          input.holidays ?? [],
        ) <= Math.max(0, Math.trunc(rule?.matchWindowBusinessDays ?? 0)),
    );
    const nearestExpectedSettlementDistance = cohortPayments.length > 0
      ? Math.min(
        ...cohortPayments.map((payment) =>
          businessDayDistance(
            payment.expectedSettlementDate!,
            mutation.transactionDate,
            input.holidays ?? [],
          ),
        ),
      )
      : null;
    const naturalPayments = cohortPayments.filter((payment) =>
      nearestExpectedSettlementDistance == null
        || businessDayDistance(
          payment.expectedSettlementDate!,
          mutation.transactionDate,
          input.holidays ?? [],
        ) === nearestExpectedSettlementDistance,
    );
    // With no bank-side provider evidence, only a matching QRIS payment can
    // classify the mutation. Known provider evidence retains an empty audit
    // row for an unmatched mutation, which is useful to the reviewer.
    if (naturalPayments.length === 0
      && (methodOnlyPath || paymentMethodHMinusOneOnly)) continue;
    const paymentProviderMismatch = evidence.providerCode !== "unknown"
      && naturalPayments.some((payment) =>
        !areQrisProvidersCompatible(payment.providerName, evidence.providerCode));
    const canonicalProviderGroups = new Set(
      naturalPayments.map((payment) => normalizeQrisProvider(payment.providerName)),
    );
    const mixedCanonicalProviderGroups = canonicalProviderGroups.size > 1;
    const sameDimensionMutations = openMutations.filter((other) => {
      if (other.id === mutation.id || other.companyId !== mutation.companyId
        || other.bankAccountId == null || mutation.bankAccountId == null
        || other.bankAccountId !== mutation.bankAccountId
        || other.transactionDate !== mutation.transactionDate) return false;
      return true;
    });
    const splitSettlementMutations = openMutations.filter((other) =>
      other.id !== mutation.id
        && other.companyId === mutation.companyId
        && other.bankAccountId != null
        && mutation.bankAccountId != null
        && other.bankAccountId === mutation.bankAccountId
        && businessDayDistance(
          other.transactionDate,
          mutation.transactionDate,
          input.holidays ?? [],
        ) <= Math.max(0, Math.trunc(rule?.matchWindowBusinessDays ?? 0))
    );

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

      // Unknown provider evidence is review-only in the legacy path. The
      // strict path does not emit this row at all.
    let selectedPayments = naturalPayments;
    let partitionBlocked = false;
    if (hasMultipleSettlements && !hMinusOneRule) {
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
    const hasNaturalBatch = naturalPayments.length > 0;
    const splitSettlementNet = roundMoney(
      [mutation, ...splitSettlementMutations]
        .reduce((sum, item) => sum + (Number(item.amount) || 0), 0),
    );
    const splitSettlementReconcilesTotal = splitSettlementMutations.length > 0
      && splitSettlementNet === grossAmount
      && grossAmount > 0;
    const validDeduction = grossAmount > 0
      && isValidObservedDeduction(
        grossAmount,
        netAmount,
        rule?.maxEffectiveDeductionRate ?? 0,
      );
    const actualEvidence = sourceClassification === "actual_bank_mutation";
    const knownProvider = evidence.providerCode !== "unknown";
    const settlementMetadataComplete = naturalPayments.every((payment) =>
      Boolean(String(payment.settlementRuleVersion ?? "").trim()),
    );
    // Relax: when bank_account_id is missing on the mutation (e.g. Google Sheet
    // imports without explicit account column), company-level identity is still
    // sufficient to produce a MATCHED candidate for a single-account company.
    // Strict bankAccountId matching happens in dimensionPayments filter above
    // (null === null for both sides passes naturally).
    const completeBankDimension =
      mutation.companyId != null && mutation.bankAccountId != null;
    const expectedDatesPresent = naturalPayments.every((payment) => Boolean(payment.expectedSettlementDate));
    const matched = strictHMinusOneAuto
      ? completeBankDimension
        && actualEvidence
        && knownProvider
        && !ambiguousEffectiveRule
        && !paymentProviderMismatch
        && hasNaturalBatch
        && expectedDatesPresent
        && !mixedCanonicalProviderGroups
        && !partitionBlocked
        && !splitSettlementReconcilesTotal
        && validDeduction
      : paymentMethodHMinusOneOnly
        ? false
        : completeBankDimension
        && actualEvidence
        && knownProvider
        && !paymentProviderMismatch
        && (!requireExplicitSettlementMetadata || rule != null)
        && (!requireExplicitSettlementMetadata || settlementMetadataComplete)
        && hasNaturalBatch
        && expectedDatesPresent
        && !mixedCanonicalProviderGroups
        && !partitionBlocked
        && !splitSettlementReconcilesTotal
        && validDeduction;
    const reviewReason = strictHMinusOneAuto
      ? "Auto-match QRIS: payment confirmed, H-1 kalender Jakarta, provider/rekening/company cocok, dan gross-net-MDR tervalidasi."
      : paymentMethodHMinusOneOnly
      ? "Kandidat QRIS: payment_method QRIS dan tanggal pembayaran tepat H-1 dari tanggal mutasi. Guard provider, rekening, metadata, nominal, dan rate tidak digunakan pada tahap kandidat."
      : ambiguousEffectiveRule
      ? "AMBIGUOUS_EFFECTIVE_WINDOW: lebih dari satu aturan provider/rekening aktif pada tanggal settlement; kandidat wajib direview."
      : mixedCanonicalProviderGroups
        ? "MULTIPLE_CANONICAL_PROVIDER_GROUPS: payment kompatibel dengan bukti bank tetapi berasal dari kelompok provider canonical berbeda; approve per kelompok."
        : !completeBankDimension
          ? "Dimensi company dan bank account wajib tersedia; rekening null bukan wildcard."
          : !actualEvidence
            ? "Bukti bukan mutasi bank aktual; hanya review."
            : !knownProvider
              ? "Provider unknown; tidak boleh automatic match."
              : paymentProviderMismatch
                ? "Provider pada payment tidak cocok dengan label mutasi; kandidat tetap ditampilkan untuk review."
                : !hasNaturalBatch
                  ? "Tidak ditemukan payment QRIS pada company, rekening, dan expected settlement date yang sama."
                  : !expectedDatesPresent
                    ? "Expected settlement date belum tersnapshot; hanya review."
                    : partitionBlocked
                      ? "AMBIGUOUS_PAYMENT_PARTITION: settlement provider/date/rekening ganda tanpa reference pembeda yang juga ada pada payment."
                      : splitSettlementReconcilesTotal
                        ? `SPLIT_SETTLEMENT_REVIEW: ${splitSettlementMutations.length + 1} mutasi dalam window settlement berjumlah Rp${splitSettlementNet}; alokasi payment ke setiap tanggal wajib dikonfirmasi sebelum approval.`
                        : observed.observedDeduction < 0
                          ? "NEGATIVE_OBSERVED_DEDUCTION: gross natural batch lebih kecil dari bank credit."
                          : grossAmount > netAmount
                            ? "AMBIGUOUS_PAYMENT_PARTITION: natural batch gross tidak cocok; subset arbitrer tidak boleh dipilih hanya dari nominal/rate."
                            : !validDeduction
                              ? "Observed deduction/rate di luar tolerance provider."
                              : !settlementMetadataComplete
                                ? "Settlement metadata payment belum lengkap; tanggal H+1 dihitung dari paid_at dan kandidat wajib direview."
                                : `${evidence.providerCode} natural batch cocok secara deterministic.`;

    // Strict generation is a positive allow-list. Invalid evidence is kept
    // only in the bank/source audit, never as a noisy REVIEW candidate.
    if (strictHMinusOneAuto && !matched) continue;

    output.push({
      mutationId: mutation.id,
      companyId: mutation.companyId,
      bankAccountId: mutation.bankAccountId,
      providerCode: evidence.providerCode,
      providerDetectionSource: evidence.source,
      mutationSourceClassification: sourceClassification,
      sourceDate: mutation.transactionDate,
      estimatedSettlementDate: selectedPayments[0]?.expectedSettlementDate ?? "",
      settlementRuleVersion: ruleVersion || selectedPayments[0]?.settlementRuleVersion || "",
      grossAmount,
      netAmount,
      observedDeduction: observed.observedDeduction,
      effectiveDeductionRate: observed.effectiveDeductionRate,
      paymentItems: selectedPayments.map((payment) => ({
        paymentId: payment.id,
        grossAmount: roundMoney(Number(payment.amount) || 0),
        canonicalSettlementId: payment.canonicalSettlementId ?? null,
        expectedSettlementDate: payment.expectedSettlementDate,
        settlementRuleVersion: ruleVersion || payment.settlementRuleVersion || null,
        paymentNumber: payment.paymentNumber ?? null,
        bookingId: payment.bookingId ?? null,
        bookingNumber: payment.bookingNumber ?? null,
        customerName: payment.customerName ?? null,
        facilityName: payment.facilityName ?? null,
        bookingDate: payment.bookingDate ?? null,
        startTime: payment.startTime ?? null,
        endTime: payment.endTime ?? null,
        paidAt: payment.paidAt == null ? null : String(payment.paidAt),
        paymentDate: canonicalPaymentDate(payment),
      })),
      status: strictHMinusOneAuto
        ? "MATCHED"
        : paymentMethodHMinusOneOnly
        ? "REVIEW"
        : matched ? "MATCHED" : !completeBankDimension
          ? "UNMATCHED"
          : ambiguousEffectiveRule
          ? "REVIEW"
          : mixedCanonicalProviderGroups
            ? "REVIEW"
          : evidence.providerCode === "unknown"
          ? "REVIEW"
          : paymentProviderMismatch
          ? "REVIEW"
          : !settlementMetadataComplete
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
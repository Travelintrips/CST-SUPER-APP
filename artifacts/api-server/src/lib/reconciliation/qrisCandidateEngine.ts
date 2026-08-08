import {
  calculateObservedDeduction,
  classifyBankMutationSource,
  type BankMutationSourceClassification,
} from "./qrisSettlement.js";
import {
  DEFAULT_QRIS_PROVIDER_RULES,
  normalizeQrisProvider,
  type QrisProviderCode,
  type QrisProviderRule,
} from "./providerSettlementRules.js";
import { businessDayDistance } from "./businessCalendar.js";

export type QrisReconciliationStatus = "MATCHED" | "REVIEW" | "UNMATCHED";

export interface QrisPaymentCandidateInput {
  id: number;
  companyId: number | null;
  amount: number;
  method: string | null;
  status: string | null;
  paidAt: string | Date | null;
  expectedSettlementDate: string | null;
  providerName?: string | null;
  taxAmount?: number | null;
  alreadyReconciled?: boolean;
}

export interface QrisMutationCandidateInput {
  id: number;
  companyId: number | null;
  transactionDate: string;
  amount: number;
  direction: string | null;
  source: string | null;
  sourceClassification?: string | null;
  providerName?: string | null;
  description?: string | null;
  status?: string | null;
}

export interface QrisMutationBatchCandidate {
  mutationId: number;
  companyId: number | null;
  providerCode: QrisProviderCode;
  mutationSourceClassification: BankMutationSourceClassification;
  sourceDate: string;
  estimatedSettlementDate: string;
  grossAmount: number;
  netAmount: number;
  observedDeduction: number;
  effectiveDeductionRate: number | null;
  paymentItems: Array<{
    paymentId: number;
    grossAmount: number;
    expectedSettlementDate: string | null;
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
    && !payment.alreadyReconciled;
}

function findGrossSubset(
  payments: QrisPaymentCandidateInput[],
  bankCredit: number,
  maxRate: number,
): QrisPaymentCandidateInput[] {
  const target = Math.round(bankCredit * 100);
  const maxGross = Math.round((bankCredit / Math.max(0.01, 1 - maxRate)) * 100) + 1;
  const states = new Map<number, QrisPaymentCandidateInput[]>();
  states.set(0, []);

  for (const payment of payments.slice(0, 200)) {
    const cents = Math.round(Math.max(0, Number(payment.amount) || 0) * 100);
    if (!cents || cents > maxGross) continue;
    const additions: Array<[number, QrisPaymentCandidateInput[]]> = [];
    for (const [sum, items] of states) {
      const next = sum + cents;
      if (next <= maxGross && !states.has(next)) {
        additions.push([next, [...items, payment]]);
      }
    }
    for (const [sum, items] of additions) states.set(sum, items);
    if (states.size > 50_000) break;
  }

  let best: QrisPaymentCandidateInput[] | null = null;
  let bestRate = Number.POSITIVE_INFINITY;
  for (const [sum, items] of states) {
    if (sum < target || !items.length) continue;
    const gross = sum / 100;
    const rate = (gross - bankCredit) / gross;
    if (rate < -0.0001 || rate > maxRate + 0.0001) continue;
    if (rate < bestRate || (rate === bestRate && (!best || items.length < best.length))) {
      best = items;
      bestRate = rate;
    }
  }
  return best ?? [];
}

/**
 * Pure dry-run candidate generation. It never mutates a payment, mutation, or
 * journal and is intentionally deterministic so reruns can upsert the same
 * candidate rows safely.
 */
export function generateQrisMutationBatchCandidates(input: {
  payments: QrisPaymentCandidateInput[];
  mutations: QrisMutationCandidateInput[];
  holidays?: Iterable<string>;
  providerRules?: Partial<Record<QrisProviderCode, QrisProviderRule>>;
  existingMutationIds?: Iterable<number>;
}): QrisMutationBatchCandidate[] {
  const holidays = new Set(input.holidays ?? []);
  const rules = { ...DEFAULT_QRIS_PROVIDER_RULES, ...(input.providerRules ?? {}) };
  const existingMutationIds = new Set(input.existingMutationIds ?? []);
  const eligiblePayments = input.payments.filter(isEligiblePayment);
  const output: QrisMutationBatchCandidate[] = [];

  for (const mutation of [...input.mutations].sort((a, b) => a.id - b.id)) {
    if (existingMutationIds.has(mutation.id)) continue;
    if (String(mutation.direction ?? "").toUpperCase() !== "IN") continue;
    if (["posted", "approved", "approved_pending_posting", "void"].includes(String(mutation.status ?? "").toLowerCase())) continue;

    const sourceClassification = classifyBankMutationSource(
      mutation.source,
      mutation.sourceClassification,
    );
    const providerCode = normalizeQrisProvider(mutation.providerName);
    const evidenceProvider = providerCode === "unknown"
      ? normalizeQrisProvider(mutation.description)
      : providerCode;
    const rule = rules[evidenceProvider] ?? rules.unknown;
    const companyPayments = eligiblePayments.filter((payment) => {
      if (payment.companyId !== mutation.companyId) return false;
      const paymentProvider = normalizeQrisProvider(payment.providerName);
      if (evidenceProvider !== "unknown" && paymentProvider !== evidenceProvider) return false;
      if (payment.expectedSettlementDate) {
        return businessDayDistance(payment.expectedSettlementDate, mutation.transactionDate, holidays)
          <= rule.matchWindowBusinessDays;
      }
      return evidenceProvider === "unknown";
    });

    const subset = findGrossSubset(companyPayments, Number(mutation.amount) || 0, rule.maxEffectiveDeductionRate);
    const grossAmount = roundMoney(subset.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    const netAmount = roundMoney(Number(mutation.amount) || 0);
    const observed = calculateObservedDeduction(grossAmount, netAmount);
    const hasCandidate = subset.length > 0;
    const actualEvidence = sourceClassification === "actual_bank_mutation";
    const knownProvider = evidenceProvider !== "unknown";
    const matched = hasCandidate && actualEvidence && knownProvider;

    output.push({
      mutationId: mutation.id,
      companyId: mutation.companyId,
      providerCode: evidenceProvider,
      mutationSourceClassification: sourceClassification,
      sourceDate: mutation.transactionDate,
      estimatedSettlementDate: subset[0]?.expectedSettlementDate ?? mutation.transactionDate,
      grossAmount,
      netAmount,
      observedDeduction: observed.observedDeduction,
      effectiveDeductionRate: observed.effectiveDeductionRate,
      paymentItems: subset.map((payment) => ({
        paymentId: payment.id,
        grossAmount: roundMoney(Number(payment.amount) || 0),
        expectedSettlementDate: payment.expectedSettlementDate,
      })),
      status: matched ? "MATCHED" : hasCandidate ? "REVIEW" : "UNMATCHED",
      confidence: matched ? (subset.length > 1 ? 0.9 : 0.98) : hasCandidate ? 0.55 : 0,
      reason: !actualEvidence
        ? "Bukti bukan mutasi bank aktual; hanya review."
        : !knownProvider
          ? "Provider unknown; tidak boleh automatic match."
          : hasCandidate
            ? `${evidenceProvider} candidate berdasarkan gross payment dan tanggal settlement.`
            : "Tidak ditemukan kombinasi payment QRIS yang sesuai provider, tanggal, dan nominal.",
    });
  }

  return output;
}
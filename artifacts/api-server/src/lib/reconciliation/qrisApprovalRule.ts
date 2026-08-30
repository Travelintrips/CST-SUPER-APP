export const QRIS_APPROVAL_REASON_CODES = {
  PAYMENT_METHOD_NOT_QRIS: "QRIS_PAYMENT_METHOD_NOT_QRIS",
  PAYMENT_DATE_NOT_H_MINUS_ONE: "QRIS_PAYMENT_DATE_NOT_H_MINUS_ONE",
  NET_AMOUNT_MISMATCH: "QRIS_NET_AMOUNT_MISMATCH",
  PAYMENT_ALREADY_RECONCILED: "QRIS_PAYMENT_ALREADY_RECONCILED",
  COMPANY_MISMATCH: "QRIS_COMPANY_MISMATCH",
  INVALID_INPUT: "QRIS_APPROVAL_INVALID_INPUT",
} as const;

export type QrisApprovalReasonCode =
  (typeof QRIS_APPROVAL_REASON_CODES)[keyof typeof QRIS_APPROVAL_REASON_CODES];

export interface QrisApprovalRulePayment {
  id: number;
  paymentMethod: string | null;
  paymentDate: string | Date | null;
  grossAmount: number | string;
  companyId: number | null;
  /** Legacy candidate metadata; deliberately ignored by the approval rule. */
  canonicalGroup?: unknown;
  providerCode?: unknown;
  settlementConfig?: unknown;
  canonicalMdrAmount?: number | string | null;
  canonicalMdrRate?: number | string | null;
  alreadyReconciled?: boolean;
}

export interface QrisApprovalRuleInput {
  companyId: number;
  mutationDate: string | Date;
  mutationAmount: number | string;
  payments: QrisApprovalRulePayment[];
}

export type QrisApprovalRuleResult =
  | {
      ok: true;
      grossAmount: number;
      mdrAmount: number;
      expectedNetAmount: number;
    }
  | {
      ok: false;
      code: QrisApprovalReasonCode;
      reason: string;
    };

export interface QrisExactNetConfigCandidate {
  configId: number;
  calculatedNetAmount: number | string;
}

function calendarDate(value: string | Date | null): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    date.getUTCFullYear() !== Number(year)
    || date.getUTCMonth() !== Number(month) - 1
    || date.getUTCDate() !== Number(day)
  ) {
    return null;
  }
  return `${year}-${month}-${day}`;
}

function previousCalendarDate(value: string | Date): string | null {
  const normalized = calendarDate(value);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function moneyCents(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : null;
}

export function selectQrisExactNetConfig<T extends QrisExactNetConfigCandidate>(
  candidates: T[],
  bankAmount: number | string,
): T | null {
  const bankCents = moneyCents(bankAmount);
  if (bankCents == null) return null;
  return [...candidates]
    .sort((left, right) => left.configId - right.configId)
    .find((candidate) =>
      Number.isSafeInteger(candidate.configId)
      && candidate.configId > 0
      && moneyCents(candidate.calculatedNetAmount) === bankCents,
    ) ?? null;
}

function paymentMdrCents(payment: QrisApprovalRulePayment, grossCents: number): number | null {
  const explicitAmount = moneyCents(payment.canonicalMdrAmount);
  if (explicitAmount != null && explicitAmount > 0) return explicitAmount;

  const rate = Number(payment.canonicalMdrRate ?? 0);
  if (!Number.isFinite(rate) || rate < 0) return null;
  return Math.round((grossCents * rate) / 100);
}

/**
 * Approval is intentionally decided only from live payment and bank evidence.
 * Canonical grouping metadata is not part of this contract.
 */
export function checkQrisApprovalRule(
  input: QrisApprovalRuleInput,
): QrisApprovalRuleResult {
  if (
    !Number.isSafeInteger(input.companyId)
    || input.companyId <= 0
    || input.payments.length === 0
  ) {
    return {
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.INVALID_INPUT,
      reason: "Data approval QRIS tidak valid",
    };
  }

  if (
    input.payments.some((payment) =>
      !String(payment.paymentMethod ?? "").toLowerCase().includes("qris"),
    )
  ) {
    return {
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.PAYMENT_METHOD_NOT_QRIS,
      reason: "Payment bukan QRIS",
    };
  }

  if (input.payments.some((payment) => payment.alreadyReconciled === true)) {
    return {
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.PAYMENT_ALREADY_RECONCILED,
      reason: "Payment sudah direkonsiliasi",
    };
  }

  if (input.payments.some((payment) => payment.companyId !== input.companyId)) {
    return {
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.COMPANY_MISMATCH,
      reason: "Company payment tidak sama dengan mutasi bank",
    };
  }

  const expectedPaymentDate = previousCalendarDate(input.mutationDate);
  if (
    expectedPaymentDate == null
    || input.payments.some((payment) => calendarDate(payment.paymentDate) !== expectedPaymentDate)
  ) {
    return {
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.PAYMENT_DATE_NOT_H_MINUS_ONE,
      reason: "Tanggal payment bukan H-1",
    };
  }

  let grossCents = 0;
  let mdrCents = 0;
  for (const payment of input.payments) {
    const paymentGrossCents = moneyCents(payment.grossAmount);
    if (paymentGrossCents == null || paymentGrossCents < 0) {
      return {
        ok: false,
        code: QRIS_APPROVAL_REASON_CODES.INVALID_INPUT,
        reason: "Data approval QRIS tidak valid",
      };
    }
    const paymentMdr = paymentMdrCents(payment, paymentGrossCents);
    if (paymentMdr == null || paymentMdr < 0) {
      return {
        ok: false,
        code: QRIS_APPROVAL_REASON_CODES.INVALID_INPUT,
        reason: "Data approval QRIS tidak valid",
      };
    }
    grossCents += paymentGrossCents;
    mdrCents += paymentMdr;
  }

  const expectedNetCents = grossCents - mdrCents;
  const mutationCents = moneyCents(input.mutationAmount);
  if (mutationCents == null || expectedNetCents !== mutationCents) {
    return {
      ok: false,
      code: QRIS_APPROVAL_REASON_CODES.NET_AMOUNT_MISMATCH,
      reason: "Nilai netto tidak sama dengan mutasi bank",
    };
  }

  return {
    ok: true,
    grossAmount: grossCents / 100,
    mdrAmount: mdrCents / 100,
    expectedNetAmount: expectedNetCents / 100,
  };
}
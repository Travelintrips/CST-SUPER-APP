export type SportPaymentAmountCorrectionIdentity = {
  sourceAmount: number;
  mirrorAmount: number;
  accountingPaymentAmount: number;
  journalTotalDebit: number;
  journalTotalCredit: number;
  settlementStatus: string | null;
  activeSettlementCount: number;
  sourceStatus: string;
  existingCorrectionId?: number | null;
};

export type SportPaymentAmountCorrectionDecision =
  | { kind: "already_corrected"; correctionId: number }
  | { kind: "noop"; amount: number }
  | {
      kind: "apply";
      amount: number;
      delta: number;
      absoluteDelta: number;
    };

export type SportPaymentAmountCorrectionLine = {
  accountId: number;
  debit: number;
  credit: number;
  description: string;
};

export function roundSportPaymentMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function parseSportPaymentCorrectionAmount(value: unknown): number {
  const amount = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim() !== ""
      ? Number(value)
      : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("Nominal payment baru harus lebih besar dari Rp0");
  }
  return roundSportPaymentMoney(amount);
}

export function calculateInclusiveTaxSplit(
  absoluteDelta: number,
  taxRate: number,
): { revenueAmount: number; taxAmount: number } {
  const delta = roundSportPaymentMoney(Math.abs(absoluteDelta));
  const normalizedRate = Number.isFinite(taxRate) && taxRate > 0 ? taxRate : 0;
  const taxAmount = normalizedRate > 0
    ? roundSportPaymentMoney(delta * normalizedRate / (100 + normalizedRate))
    : 0;
  return {
    taxAmount,
    revenueAmount: roundSportPaymentMoney(delta - taxAmount),
  };
}

export function assessSportPaymentAmountCorrection(
  identity: SportPaymentAmountCorrectionIdentity,
  requestedAmount: number,
): SportPaymentAmountCorrectionDecision {
  const amount = parseSportPaymentCorrectionAmount(requestedAmount);
  const close = (left: number, right: number) => Math.abs(left - right) <= 0.01;

  if (identity.existingCorrectionId != null) {
    return {
      kind: "already_corrected",
      correctionId: Number(identity.existingCorrectionId),
    };
  }
  if (identity.activeSettlementCount > 0 || String(identity.settlementStatus ?? "").toLowerCase() !== "unsettled") {
    throw new Error("PAYMENT_SETTLED");
  }
  if (!["confirmed", "pending"].includes(String(identity.sourceStatus).toLowerCase())) {
    throw new Error("PAYMENT_STATUS_NOT_EDITABLE");
  }

  const financialIdentityMatches =
    close(identity.sourceAmount, identity.mirrorAmount)
    && close(identity.sourceAmount, identity.accountingPaymentAmount)
    && close(identity.sourceAmount, identity.journalTotalDebit)
    && close(identity.sourceAmount, identity.journalTotalCredit);
  if (!financialIdentityMatches) {
    throw new Error("PAYMENT_FINANCIAL_IDENTITY_DRIFT");
  }

  if (close(amount, identity.sourceAmount)) {
    return { kind: "noop", amount };
  }

  const delta = roundSportPaymentMoney(amount - identity.sourceAmount);
  return {
    kind: "apply",
    amount,
    delta,
    absoluteDelta: Math.abs(delta),
  };
}

export function buildSportPaymentAmountCorrectionLines(input: {
  delta: number;
  bankAccountId: number;
  revenueAccountId: number;
  taxAccountId?: number | null;
  taxRate: number;
  bookingNumber: string;
}): SportPaymentAmountCorrectionLine[] {
  const delta = roundSportPaymentMoney(input.delta);
  const absoluteDelta = Math.abs(delta);
  const { revenueAmount, taxAmount } = calculateInclusiveTaxSplit(absoluteDelta, input.taxRate);
  const reducing = delta < 0;
  const lines: SportPaymentAmountCorrectionLine[] = [
    {
      accountId: input.bankAccountId,
      debit: reducing ? 0 : absoluteDelta,
      credit: reducing ? absoluteDelta : 0,
      description: `Koreksi Kas/Bank: ${input.bookingNumber}`,
    },
    {
      accountId: input.revenueAccountId,
      debit: reducing ? revenueAmount : 0,
      credit: reducing ? 0 : revenueAmount,
      description: `Koreksi Pendapatan Sport Center: ${input.bookingNumber}`,
    },
  ];
  if (taxAmount > 0) {
    if (!input.taxAccountId) {
      throw new Error("TAX_ACCOUNT_NOT_FOUND");
    }
    lines.push({
      accountId: input.taxAccountId,
      debit: reducing ? taxAmount : 0,
      credit: reducing ? 0 : taxAmount,
      description: `Koreksi PPN Keluaran: ${input.bookingNumber}`,
    });
  }
  return lines;
}

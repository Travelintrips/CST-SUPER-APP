import type { PostingLine } from "../accounting.js";

type Row = Record<string, unknown>;

function amount(value: unknown): number {
  return Number(value ?? 0);
}

function sameAmount(a: unknown, b: unknown): boolean {
  return Math.abs(amount(a) - amount(b)) <= 0.01;
}

export function invertHistoricalDuplicateLines(lines: Array<{
  accountId: number;
  debit: number | string | null;
  credit: number | string | null;
  description?: string | null;
}>): PostingLine[] {
  return lines.map((line) => ({
    accountId: Number(line.accountId),
    debit: amount(line.credit),
    credit: amount(line.debit),
    description: `[HISTORICAL_DUPLICATE_REVERSAL] ${String(line.description ?? "")}`.trim(),
  }));
}

export function hasMatchingBankDebit(
  legacyLines: Row[],
  canonicalLines: Row[],
): boolean {
  const legacyBank = legacyLines.find((line) => amount(line["debit"]) > 0 && amount(line["credit"]) === 0);
  const canonicalBank = canonicalLines.find((line) => amount(line["debit"]) > 0 && amount(line["credit"]) === 0);
  return Boolean(
    legacyBank &&
    canonicalBank &&
    Number(legacyBank["account_id"]) === Number(canonicalBank["account_id"]) &&
    sameAmount(legacyBank["debit"], canonicalBank["debit"]),
  );
}

export function hasMatchingSportPaymentBookingIdentity(input: {
  legacyRef: string | null;
  bookingId: number | null;
  bookingOrderNumber: string | null;
  canonicalSourcePaymentId: number | null;
  paymentId: number | null;
  paymentBookingId: number | null;
}): boolean {
  return Boolean(
    input.legacyRef &&
    input.bookingId != null &&
    input.bookingOrderNumber &&
    input.legacyRef === input.bookingOrderNumber &&
    input.canonicalSourcePaymentId != null &&
    input.paymentId === input.canonicalSourcePaymentId &&
    input.paymentBookingId === input.bookingId,
  );
}
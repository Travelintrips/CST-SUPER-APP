/**
 * QRIS settlement contract shared by bank reconciliation paths.
 *
 * `gross` is the customer payment. Only provider deductions explicitly
 * supplied by the provider are subtracted from it; booking tax is never
 * included automatically.
 */

export interface QrisSettlementAmounts {
  gross: number;
  mdr?: number | null;
  taxWithheld?: number | null;
  otherFee?: number | null;
}

export function calculateQrisNetAmount(amounts: QrisSettlementAmounts): number {
  const gross = Math.max(0, Number(amounts.gross) || 0);
  const deductions =
    Math.max(0, Number(amounts.mdr) || 0) +
    Math.max(0, Number(amounts.taxWithheld) || 0) +
    Math.max(0, Number(amounts.otherFee) || 0);
  return Math.max(0, Number((gross - deductions).toFixed(2)));
}

export function isQrisPaymentMethod(method: string | null | undefined): boolean {
  return String(method ?? "").trim().toLowerCase().includes("qris");
}

/**
 * Detect QRIS/provider settlement descriptions from bank statements.
 *
 * Banks do not always print the literal word "QRIS".  Provider/merchant
 * labels such as `QRTRAVELI` are common in BCA-style statements, and the
 * settlement matcher must classify those rows as QRIS before choosing the
 * amount/date filters.
 */
export function isQrisSettlementDescription(
  description: string | null | undefined,
): boolean {
  const value = String(description ?? "").trim().toUpperCase();
  if (!value) return false;

  return (
    value.includes("QRIS") ||
    /QR[A-Z0-9]{4,}/.test(value) ||
    /\bQR\s*(?:CODE|PAY|PAYMENT)\b/.test(value)
  );
}

/**
 * Settlement date is authoritative when supplied. Otherwise QRIS uses the
 * provider's default next-day settlement window, while non-QRIS payments use
 * their payment date.
 */
export function resolveSettlementDate(
  paidAt: string | Date | null | undefined,
  settlementDate: string | null | undefined,
  defaultDelayDays = 1,
): string | null {
  if (settlementDate) return String(settlementDate).slice(0, 10);
  if (!paidAt) return null;

  const date = paidAt instanceof Date ? new Date(paidAt.getTime()) : new Date(paidAt);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + Math.max(0, Math.trunc(defaultDelayDays)));
  return date.toISOString().slice(0, 10);
}

export function settlementVariance(bankAmount: number, expectedNet: number): number {
  return Number(((Number(bankAmount) || 0) - (Number(expectedNet) || 0)).toFixed(2));
}

/**
 * A partial QRIS settlement is a valid operational state: the provider has
 * settled only part of the expected batch, so it must remain reviewable rather
 * than being treated as a fully settled source.
 */
export function isPartialQrisSettlement(status: string | null | undefined): boolean {
  return ["partial", "partially_settled", "partially-settled"].includes(
    String(status ?? "").trim().toLowerCase(),
  );
}
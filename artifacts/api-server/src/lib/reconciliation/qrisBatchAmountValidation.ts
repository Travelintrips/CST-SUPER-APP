/**
 * QRIS Batch Approval — Amount & Total Invariant Validation
 *
 * Pure-logic module (no DB) that enforces the three financial invariants the
 * approval endpoint must check before writing any settlement rows:
 *
 *  1. No duplicate payment IDs in the candidate's payment_items list.
 *  2. Each candidate item grossAmount must match the live payment.amount within
 *     a 1-unit rounding tolerance.  A stale candidate (payment edited after
 *     generation) must be rejected — never write a settlement item for an
 *     amount the payment no longer has.
 *  3. Candidate header totals must be internally consistent:
 *       a. sum(items.grossAmount) ≈ header.gross_amount   (±N rounding)
 *       b. header.gross - header.mdr - header.other_fee ≈ header.net  (±N rounding)
 *
 * All validation is run before any INSERT.  A single error object is returned on
 * the first violation so the caller can throw without creating partial state.
 */

export interface QrisCandidateHeader {
  gross_amount: number;
  mdr_amount: number;
  other_fee_amount: number;
  net_amount: number;
}

export interface QrisCandidateItem {
  paymentId: number;
  /** Gross amount as stored in the provisional candidate's payment_items JSON. */
  grossAmount: number;
}

export interface LivePayment {
  id: number;
  /** Current authoritative amount from the locked sport_payments row. */
  amount: number;
}

export interface QrisBatchAmountError {
  code:
    | "DUPLICATE_PAYMENT_ID"
    | "STALE_CANDIDATE_AMOUNT"
    | "ITEM_GROSS_MISMATCH"
    | "NET_INCONSISTENT";
  message: string;
  paymentId?: number;
  liveAmount?: number;
  candidateGross?: number;
}

/**
 * Validate that payment_items have no duplicate payment IDs.
 * Returns an error or null.
 */
export function checkDuplicatePaymentIds(
  items: QrisCandidateItem[],
): QrisBatchAmountError | null {
  const seen = new Set<number>();
  for (const item of items) {
    if (seen.has(item.paymentId)) {
      return {
        code: "DUPLICATE_PAYMENT_ID",
        message: `payment_items mengandung payment ID duplikat: ${item.paymentId}`,
        paymentId: item.paymentId,
      };
    }
    seen.add(item.paymentId);
  }
  return null;
}

/**
 * Validate each candidate item grossAmount against the live locked payment amount.
 * Returns the first mismatch found, or null if all match.
 *
 * @param amountTolerance Maximum allowed absolute difference (default 1 — IDR rounding).
 */
export function checkStaleAmounts(
  items: QrisCandidateItem[],
  livePayments: LivePayment[],
  amountTolerance = 1,
): QrisBatchAmountError | null {
  const byId = new Map(livePayments.map(p => [p.id, p]));
  for (const item of items) {
    const live = byId.get(item.paymentId);
    if (!live) continue; // missing-payment check handled in main validation
    const diff = Math.abs(live.amount - item.grossAmount);
    if (diff > amountTolerance) {
      return {
        code: "STALE_CANDIDATE_AMOUNT",
        message:
          `Payment ${item.paymentId}: jumlah kandidat (${item.grossAmount}) berbeda dari ` +
          `jumlah aktual payment (${live.amount}). Kandidat perlu di-generate ulang.`,
        paymentId: item.paymentId,
        liveAmount: live.amount,
        candidateGross: item.grossAmount,
      };
    }
  }
  return null;
}

/**
 * Validate that candidate header totals are internally consistent.
 * Returns an error or null.
 *
 * @param tolerance Maximum allowed absolute rounding diff per check (default items.length).
 */
export function checkHeaderTotals(
  header: QrisCandidateHeader,
  items: QrisCandidateItem[],
  tolerance?: number,
): QrisBatchAmountError | null {
  const tol = tolerance ?? Math.max(1, items.length);

  const recomputedGross = items.reduce((s, i) => s + i.grossAmount, 0);
  if (Math.abs(recomputedGross - header.gross_amount) > tol) {
    return {
      code: "ITEM_GROSS_MISMATCH",
      message:
        `Total bruto item (${recomputedGross}) tidak cocok dengan header kandidat ` +
        `(${header.gross_amount}). Kandidat perlu di-generate ulang.`,
    };
  }

  const recomputedNet = header.gross_amount - header.mdr_amount - header.other_fee_amount;
  if (Math.abs(recomputedNet - header.net_amount) > tol) {
    return {
      code: "NET_INCONSISTENT",
      message:
        `Netto header (${header.net_amount}) tidak konsisten: ` +
        `gross(${header.gross_amount}) - mdr(${header.mdr_amount}) - ` +
        `other(${header.other_fee_amount}) = ${recomputedNet}. Kandidat perlu di-generate ulang.`,
    };
  }

  return null;
}

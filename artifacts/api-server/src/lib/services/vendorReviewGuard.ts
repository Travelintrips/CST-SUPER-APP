/**
 * vendorReviewGuard.ts
 *
 * Pure decision logic for vendor marketplace review eligibility, extracted so it
 * can be unit tested without a live DB. The actual DB lookups (linked supplier,
 * transaction ownership) stay in the route handler; this module only decides
 * pass/fail given already-fetched facts.
 *
 * Rules enforced (per Vendor Master Enhancement spec):
 *  1. A portal customer account that is itself linked to a supplier (vendor)
 *     cannot review that same supplier — SELF_REVIEW_NOT_ALLOWED.
 *  2. A review may only be created against the vendor that actually appears on
 *     the source transaction (no cross-vendor claiming).
 *  3. The source transaction must belong to the requesting customer as buyer.
 *  4. The source transaction must be in a completed/eligible status.
 */

export interface ReviewGuardInput {
  /** supplierId the requesting portal customer is linked to as a vendor, if any */
  linkedSupplierId: number | null;
  /** vendorId (supplier) being reviewed, from the route param */
  vendorId: number;
  /** vendorId recorded on the transaction being cited as proof of purchase */
  transactionVendorId: number | null;
  /** portalCustomerId that owns the transaction being cited */
  transactionCustomerId: number | null;
  /** requesting portal customer id */
  requestingCustomerId: number;
  /** whether the transaction status qualifies (completed/closed/delivered etc.) */
  transactionStatusEligible: boolean;
  /** whether the transaction row was found at all */
  transactionFound: boolean;
}

export type ReviewGuardResult =
  | { ok: true }
  | { ok: false; status: 403; code: "SELF_REVIEW_NOT_ALLOWED"; message: string }
  | { ok: false; status: 403; code: "TRANSACTION_OWNERSHIP_INVALID"; message: string };

export function evaluateReviewEligibility(input: ReviewGuardInput): ReviewGuardResult {
  // Rule 1 — vendor cannot review its own profile, regardless of transaction.
  if (input.linkedSupplierId != null && input.linkedSupplierId === input.vendorId) {
    return {
      ok: false,
      status: 403,
      code: "SELF_REVIEW_NOT_ALLOWED",
      message: "Vendor tidak dapat memberikan penilaian kepada profil vendornya sendiri.",
    };
  }

  // Rule 2/3/4 — transaction must exist, belong to this vendor, belong to this
  // customer as buyer, and be in an eligible (completed) status.
  const ownershipOk =
    input.transactionFound &&
    input.transactionVendorId === input.vendorId &&
    input.transactionCustomerId === input.requestingCustomerId &&
    input.transactionStatusEligible;

  if (!ownershipOk) {
    return {
      ok: false,
      status: 403,
      code: "TRANSACTION_OWNERSHIP_INVALID",
      message: "Transaksi tidak ditemukan, belum selesai, atau bukan milik Anda.",
    };
  }

  return { ok: true };
}

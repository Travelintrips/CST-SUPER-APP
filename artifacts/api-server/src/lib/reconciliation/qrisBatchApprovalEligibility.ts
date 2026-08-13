/**
 * QRIS Batch Approval Eligibility — pure logic, no DB dependency.
 *
 * The matching engine marks candidates with one of three reconciliation statuses:
 *
 *  MATCHED  — provider is identified, payment partitions fit the bank amount
 *             deterministically, and deduction rate is within tolerance. This is
 *             the only status that can be promoted to a qris_settlement.
 *
 *  REVIEW   — provider unknown, payment partition ambiguous, deduction rate
 *             out-of-tolerance, or partial bank dimension. Review candidates
 *             remain visible but cannot enter the one-click approval path.
 *
 *  UNMATCHED — no eligible payments found for this bank mutation on this date.
 *
 * Approving an UNMATCHED candidate would silently create a settlement
 * for data the engine could not validate — defeating the reconciliation model.
 * REVIEW candidates remain unapproved until matching evidence is valid.
 */

export interface QrisBatchCandidateForEligibility {
  id?: number | null;
  reconciliation_status: string;
  status?: string | null;
  confidence?: number | string | null;
  /** Net amount as stored (may be negative for mis-detected IN/OUT). */
  net_amount?: number | string | null;
  observed_deduction?: number | string | null;
}

export interface QrisBatchEligibilityError {
  message: string;
  code: "ALREADY_APPROVED" | "NOT_MATCHED" | "NEGATIVE_NET" | "NO_PROVIDER_EVIDENCE";
}

/** Non-blocking warning returned when a REVIEW candidate is approved manually. */
export interface QrisBatchReviewWarning {
  code: "REVIEW_OVERRIDE";
  message: string;
}

/**
 * An empty candidate has no source payments to settle. It must never reach
 * the approval transaction, regardless of its stored reconciliation status.
 */
export function hasQrisBatchPaymentItems(value: unknown): value is unknown[] {
  return Array.isArray(value) && value.length > 0;
}

/**
 * Returns null when the candidate is eligible for approval, or an error object
 * that describes why it cannot be approved.
 *
 * This is a pure function — no side effects, no DB calls.
 */
export function checkQrisBatchApprovalEligibility(
  candidate: QrisBatchCandidateForEligibility,
): QrisBatchEligibilityError | null {
  // Already approved — idempotent guard
  if (String(candidate.status ?? "").toLowerCase() === "approved") {
    return {
      code: "ALREADY_APPROVED",
      message: "Kandidat QRIS ini sudah pernah disetujui.",
    };
  }

  const reconStatus = String(candidate.reconciliation_status ?? "").toUpperCase();

  if (reconStatus !== "MATCHED") {
    // Covers UNMATCHED, empty string, unknown values — hard block
    return {
      code: "NOT_MATCHED",
      message:
        "Hanya kandidat dengan status MATCHED yang dapat disetujui; " +
        "verifikasi manual diperlukan untuk status lain.",
    };
  }

  // Net amount must not be negative — a negative net indicates a mis-detected
  // credit direction or a deduction exceeding gross, both of which require review.
  const net = Number(candidate.net_amount ?? 0);
  if (net < 0) {
    return {
      code: "NEGATIVE_NET",
      message:
        "Jumlah netto kandidat negatif — kemungkinan arah IN/OUT salah atau " +
        "potongan melebihi gross. Verifikasi manual diperlukan.",
    };
  }

  return null; // eligible
}

/**
 * Returns a review warning if the candidate is REVIEW status (eligible but
 * requires human confirmation). Returns null for MATCHED (no warning needed).
 */
export function checkQrisBatchReviewWarning(
  candidate: QrisBatchCandidateForEligibility,
): QrisBatchReviewWarning | null {
  const reconStatus = String(candidate.reconciliation_status ?? "").toUpperCase();
  if (reconStatus === "REVIEW") {
    return {
      code: "REVIEW_OVERRIDE",
      message:
        "Kandidat ini disetujui dengan override manual. " +
        "Provider, partisi payment, atau potongan MDR memerlukan verifikasi lebih lanjut.",
    };
  }
  return null;
}

/**
 * Throws a typed error if the candidate is not eligible.
 * Attach { eligibilityError: true } so callers can distinguish 422 from 500.
 */
export function assertQrisBatchApprovalEligible(
  candidate: QrisBatchCandidateForEligibility,
): void {
  const error = checkQrisBatchApprovalEligibility(candidate);
  if (error) {
    throw Object.assign(new Error(error.message), {
      eligibilityError: true,
      code: error.code,
    });
  }
}

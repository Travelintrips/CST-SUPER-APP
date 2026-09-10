/**
 * Status contract for Rule AI rows that require a real transaction candidate.
 *
 * A matching rule is only a classification hint. Until the candidate engine
 * returns a real candidate, the bank mutation must remain in the unmatched
 * queue so it can be retried when the source transaction is created later.
 */

export type CandidateMatchStatus = "auto_matched" | "manual_review" | "unmatched";

/**
 * Rule AI's recon_rule row is classification evidence, not a business
 * transaction. A required-candidate rule may only be approved against one of
 * the real source records produced by the candidate matcher.
 */
export const REAL_TRANSACTION_CANDIDATE_TYPES = new Set([
  "accounting_payment",
  "logistic_order",
  "invoice",
  "expense",
  "sport_payment",
  "qris_settlement",
  "tenant_invoice",
  "internal_transfer",
]);

export function requiredCandidateApprovalError(input: {
  candidateRequirement?: string | null;
  candidateType?: string | null;
  candidateId?: number | null;
}): { code: "RULE_CANDIDATE_REQUIRED"; message: string } | null {
  if (input.candidateRequirement !== "required") return null;

  const candidateType = String(input.candidateType ?? "").trim().toLowerCase();
  const hasRealCandidate =
    input.candidateId != null
    && Number.isSafeInteger(input.candidateId)
    && REAL_TRANSACTION_CANDIDATE_TYPES.has(candidateType);

  if (hasRealCandidate) return null;

  return {
    code: "RULE_CANDIDATE_REQUIRED",
    message: "Approval diblokir: Rule AI ini mewajibkan kandidat transaksi nyata. Pilih kandidat hasil rekonsiliasi terlebih dahulu.",
  };
}

export function resolveRequiredCandidateStatus(input: {
  best?: unknown;
  status: CandidateMatchStatus;
}): CandidateMatchStatus {
  return input.best == null ? "unmatched" : input.status;
}
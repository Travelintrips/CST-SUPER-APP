/**
 * Status contract for Rule AI rows that require a real transaction candidate.
 *
 * A matching rule is only a classification hint. Until the candidate engine
 * returns a real candidate, the bank mutation must remain in the unmatched
 * queue so it can be retried when the source transaction is created later.
 */

export type CandidateMatchStatus = "auto_matched" | "manual_review" | "unmatched";

export function resolveRequiredCandidateStatus(input: {
  best?: unknown;
  status: CandidateMatchStatus;
}): CandidateMatchStatus {
  return input.best == null ? "unmatched" : input.status;
}
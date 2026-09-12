import type { MatchCandidate } from "./unifiedMatchingEngine.js";

/**
 * A legacy accounting_payments row can represent the same Sport Center
 * payment as sport_payments. Likewise, the same payment document may be
 * mirrored as an invoice and a tenant invoice. These rows have different
 * technical identities, but must not be presented as separate economic
 * candidates when their user-facing reference is the same.
 */
function businessCandidateKey(candidate: MatchCandidate): string | null {
  const reference = String(candidate.ref ?? "").trim().toUpperCase();
  if (!reference) return null;

  if (
    (candidate.type === "sport_payment" || candidate.type === "accounting_payment") &&
    /^SCPAY-|^SPORT-/.test(reference)
  ) {
    return `sport-payment:${reference}`;
  }

  if (
    (candidate.type === "invoice" || candidate.type === "tenant_invoice") &&
    /^(?:INV-|TENANT-)?PAY-/.test(reference)
  ) {
    return `payment-document:${reference.replace(/^(?:INV-|TENANT-)/, "")}`;
  }

  return null;
}

function businessCandidatePriority(candidate: MatchCandidate): number {
  switch (candidate.type) {
    case "sport_payment": return 100;
    case "qris_settlement": return 90;
    case "tenant_invoice": return 60;
    case "invoice": return 50;
    case "accounting_payment": return 40;
    default: return 0;
  }
}

export function dedupeCandidatesByBusinessIdentity(
  candidates: MatchCandidate[],
): MatchCandidate[] {
  const byKey = new Map<string, MatchCandidate>();
  const withoutBusinessKey: MatchCandidate[] = [];

  for (const candidate of candidates) {
    const key = businessCandidateKey(candidate);
    if (!key) {
      withoutBusinessKey.push(candidate);
      continue;
    }

    const existing = byKey.get(key);
    if (!existing || businessCandidatePriority(candidate) > businessCandidatePriority(existing)) {
      byKey.set(key, candidate);
    }
  }

  return [...withoutBusinessKey, ...byKey.values()];
}
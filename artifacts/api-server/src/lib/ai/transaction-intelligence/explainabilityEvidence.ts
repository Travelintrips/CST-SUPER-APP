/**
 * AI Transaction Intelligence — Phase 4
 * Evidence Builder
 *
 * Reads Phase 1, 2, 3 outputs and constructs structured ExplainabilityEvidence[].
 * Pure function — no side effects, no DB calls.
 */

import type { ExplainabilityInput, ExplainabilityEvidence, EvidenceType } from './explainabilityTypes.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function evidence(
  type: EvidenceType,
  source: ExplainabilityEvidence['source'],
  weight: number,
  description: string,
  contribution: number,
  negativeContribution: number = 0,
): ExplainabilityEvidence {
  return {
    type,
    source,
    weight: Math.round(weight * 1000) / 1000,
    description,
    contribution: Math.round(Math.max(0, contribution) * 1000) / 1000,
    confidenceContribution: Math.round(Math.max(0, contribution) * 1000) / 1000,
    negativeContribution: Math.round(Math.max(0, negativeContribution) * 1000) / 1000,
  };
}

// ─── Phase 1 evidence ─────────────────────────────────────────────────────────

function buildPhase1Evidence(input: ExplainabilityInput): ExplainabilityEvidence[] {
  const { phase1 } = input;
  const out: ExplainabilityEvidence[] = [];

  // Primary intent match
  const p1Conf = phase1.confidence ?? 0;
  out.push(evidence(
    'PHASE1_ANALYSIS',
    'PHASE1',
    0.20,
    `Phase 1 identified intent "${phase1.intent}" with confidence ${p1Conf.toFixed(3)} from keyword analysis`,
    p1Conf * 0.20,
    phase1.intent === 'UNKNOWN' ? 0.10 : 0,
  ));

  // Matched keywords
  if (phase1.candidates && phase1.candidates.length > 0) {
    const topCandidate = phase1.candidates[0];
    if (topCandidate && topCandidate.matchedKeywords.length > 0) {
      const kwList = topCandidate.matchedKeywords.map((k) => k.keyword).slice(0, 5).join(', ');
      out.push(evidence(
        'KEYWORD_MATCH',
        'PHASE1',
        0.15,
        `Matched keywords: ${kwList}`,
        topCandidate.score * 0.15,
        0,
      ));
    }
  }

  // Manual review flag from Phase 1
  if (phase1.requiresManualReview) {
    out.push(evidence(
      'MANUAL_REVIEW_TRIGGER',
      'PHASE1',
      0.10,
      `Phase 1 flagged low-confidence or ambiguous description requiring manual review`,
      0,
      0.10,
    ));
  }

  return out;
}

// ─── Phase 2 evidence ─────────────────────────────────────────────────────────

function buildPhase2Evidence(input: ExplainabilityInput): ExplainabilityEvidence[] {
  const { phase2 } = input;
  const out: ExplainabilityEvidence[] = [];

  const p2Conf = phase2.confidence ?? 0;

  out.push(evidence(
    'PHASE2_CLASSIFICATION',
    'PHASE2',
    0.25,
    `Phase 2 classified intent as "${phase2.primaryIntent}" (confidence ${p2Conf.toFixed(3)})`,
    p2Conf * 0.25,
    phase2.requiresManualReview ? 0.05 : 0,
  ));

  // Direction evidence
  const directionEvidence = phase2.evidence?.find((e) => e.type === 'DIRECTION');
  if (directionEvidence) {
    const isPositive = (directionEvidence.weight ?? 0) >= 0;
    out.push(evidence(
      'DIRECTION',
      'PHASE2',
      Math.abs(directionEvidence.weight ?? 0.10),
      `Direction signal: ${directionEvidence.value ?? 'checked'} — ${isPositive ? 'consistent' : 'inconsistent'} with intent`,
      isPositive ? Math.abs(directionEvidence.weight ?? 0) * 0.15 : 0,
      isPositive ? 0 : Math.abs(directionEvidence.weight ?? 0) * 0.15,
    ));
  }

  // Counterparty evidence
  const cpEvidence = phase2.evidence?.filter((e) => e.type === 'COUNTERPARTY') ?? [];
  if (cpEvidence.length > 0) {
    const cpVal = cpEvidence[0].value ?? '';
    out.push(evidence(
      'COUNTERPARTY',
      'PHASE2',
      0.20,
      `Counterparty signal: ${cpVal}`,
      (cpEvidence[0].weight ?? 0) > 0 ? 0.15 : 0,
      (cpEvidence[0].weight ?? 0) < 0 ? 0.10 : 0,
    ));
  }

  // Manual review trigger from Phase 2
  if (phase2.requiresManualReview) {
    out.push(evidence(
      'MANUAL_REVIEW_TRIGGER',
      'PHASE2',
      0.10,
      `Phase 2 flagged transaction for manual review: ${phase2.reason?.slice(0, 120) ?? 'low confidence or ambiguity detected'}`,
      0,
      0.08,
    ));
  }

  return out;
}

// ─── Phase 3 evidence ─────────────────────────────────────────────────────────

function buildPhase3Evidence(input: ExplainabilityInput): ExplainabilityEvidence[] {
  const { phase3 } = input;
  const out: ExplainabilityEvidence[] = [];

  // Historical mapping
  const histEvidence = phase3.evidence?.filter(
    (e) => e.type === 'HISTORICAL_APPROVED' || e.type === 'HISTORICAL_USAGE',
  ) ?? [];
  if (histEvidence.length > 0) {
    const h = histEvidence[0];
    out.push(evidence(
      'HISTORICAL_MAPPING',
      'PHASE3',
      0.30,
      `Historical mapping: account ${h.coaCode ?? 'unknown'} has been used for similar transactions (usage evidence)`,
      (h.weight ?? 0) > 0 ? Math.min(0.30, (h.weight ?? 0) * 0.30) : 0,
      0,
    ));
  }

  // Intent keyword match from Phase 3
  const intentKwEvidence = phase3.evidence?.filter((e) => e.type === 'INTENT_KEYWORD') ?? [];
  if (intentKwEvidence.length > 0) {
    const ike = intentKwEvidence[0];
    out.push(evidence(
      'INTENT_MATCH',
      'PHASE3',
      0.25,
      `Account ${ike.coaCode ?? 'unknown'} keywords align with intent "${phase3.intent}"`,
      Math.min(0.25, (ike.weight ?? 0) * 0.25),
      0,
    ));
  }

  // Keyword alias match
  const kwAliasEvidence = phase3.evidence?.filter((e) => e.type === 'KEYWORD_ALIAS') ?? [];
  if (kwAliasEvidence.length > 0) {
    const kae = kwAliasEvidence[0];
    out.push(evidence(
      'KEYWORD_MATCH',
      'PHASE3',
      0.15,
      `Account ${kae.coaCode ?? 'unknown'} keyword/alias matches transaction description`,
      Math.min(0.15, (kae.weight ?? 0) * 0.15),
      0,
    ));
  }

  // Policy evidence
  const policyEvidence = phase3.evidence?.filter((e) => e.type === 'POLICY_PREFERRED') ?? [];
  if (policyEvidence.length > 0) {
    out.push(evidence(
      'ACCOUNT_POLICY',
      'PHASE3',
      0.10,
      `Account is policy-preferred for intent "${phase3.intent}"`,
      0.10,
      0,
    ));
  }

  // Company context — always present
  out.push(evidence(
    'COMPANY_CONTEXT',
    'PHASE3',
    0.05,
    `Company-scoped account filtering applied (companyId: ${phase3.primaryRecommendation?.coaId ? 'verified' : 'no recommendation'})`,
    phase3.primaryRecommendation ? 0.05 : 0,
    0,
  ));

  // Prediction summary
  const p3Conf = phase3.primaryRecommendation?.confidence ?? 0;
  out.push(evidence(
    'PHASE3_PREDICTION',
    'PHASE3',
    0.30,
    phase3.primaryRecommendation
      ? `Phase 3 selected account ${phase3.primaryRecommendation.coaCode} — ${phase3.primaryRecommendation.coaName} (confidence ${p3Conf.toFixed(3)})`
      : `Phase 3 found no eligible account candidates`,
    p3Conf * 0.30,
    phase3.primaryRecommendation ? 0 : 0.20,
  ));

  // Conflict / penalty signals
  const conflictFlags = phase3.conflictFlags ?? [];
  if (conflictFlags.length > 0) {
    out.push(evidence(
      'PENALTY',
      'PHASE3',
      0.15,
      `Conflict flags detected: ${conflictFlags.join(', ')}`,
      0,
      0.05 * Math.min(3, conflictFlags.length),
    ));
  }

  // Manual review from Phase 3
  if (phase3.requiresManualReview) {
    out.push(evidence(
      'MANUAL_REVIEW_TRIGGER',
      'PHASE3',
      0.10,
      `Phase 3 flagged account prediction for manual review`,
      0,
      0.08,
    ));
  }

  return out;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full evidence list by reading Phase 1–3 outputs.
 * Does NOT perform any re-analysis.
 */
export function buildExplainabilityEvidence(input: ExplainabilityInput): ExplainabilityEvidence[] {
  return [
    ...buildPhase1Evidence(input),
    ...buildPhase2Evidence(input),
    ...buildPhase3Evidence(input),
  ];
}

/**
 * AI Transaction Intelligence — Phase 4
 * Confidence Breakdown Calculator
 *
 * Reads Phase 1–3 outputs and produces a structured breakdown of how each
 * dimension contributed to overall confidence.
 * Pure function — no side effects, no DB calls.
 */

import type {
  ExplainabilityInput,
  ConfidenceBreakdownItem,
  BreakdownDimension,
  ExplainabilityConfidence,
  ConfidenceLevel,
} from './explainabilityTypes.js';

// ─── Confidence level thresholds ──────────────────────────────────────────────

export const CONFIDENCE_LEVEL_THRESHOLDS = {
  VERY_HIGH: 0.95,
  HIGH:      0.85,
  MEDIUM:    0.70,
  LOW:       0.50,
} as const;

/**
 * Convert a numeric confidence value (0–1) to a ConfidenceLevel band.
 */
export function toConfidenceLevel(value: number): ConfidenceLevel {
  if (value >= CONFIDENCE_LEVEL_THRESHOLDS.VERY_HIGH) return 'VERY_HIGH';
  if (value >= CONFIDENCE_LEVEL_THRESHOLDS.HIGH)      return 'HIGH';
  if (value >= CONFIDENCE_LEVEL_THRESHOLDS.MEDIUM)    return 'MEDIUM';
  if (value >= CONFIDENCE_LEVEL_THRESHOLDS.LOW)        return 'LOW';
  return 'VERY_LOW';
}

/**
 * Clamp and normalise a raw score to [0, 1].
 */
export function normalizeConfidence(raw: number): number {
  return Math.round(Math.max(0, Math.min(1, raw)) * 1000) / 1000;
}

// ─── Dimension calculators ───────────────────────────────────────────────────

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function dim(
  dimension: BreakdownDimension,
  score: number,
  weight: number,
  detail: string,
): ConfidenceBreakdownItem {
  return { dimension, score: round3(score), weight: round3(Math.abs(weight)), detail };
}

// Historical Mapping dimension
function historicalMappingDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const histEvidence = input.phase3.evidence?.filter(
    (e) => e.type === 'HISTORICAL_APPROVED' || e.type === 'HISTORICAL_USAGE',
  ) ?? [];
  const score = histEvidence.reduce((acc, e) => acc + (e.weight ?? 0), 0);
  const clamped = round3(Math.min(1, Math.max(0, score)));
  return dim(
    'Historical Mapping',
    clamped,
    0.30,
    histEvidence.length > 0
      ? `${histEvidence.length} historical mapping(s) found; top weight ${round3(histEvidence[0]?.weight ?? 0)}`
      : 'No historical mappings available',
  );
}

// Intent Match dimension
function intentMatchDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const p1Conf = input.phase1.confidence ?? 0;
  const p2Conf = input.phase2.confidence ?? 0;
  const intentAgree = input.phase1.intent === input.phase2.primaryIntent;
  const score = round3((p1Conf * 0.4 + p2Conf * 0.6) * (intentAgree ? 1.0 : 0.7));
  return dim(
    'Intent Match',
    score,
    0.25,
    `Phase 1: "${input.phase1.intent}" (${p1Conf.toFixed(3)}), Phase 2: "${input.phase2.primaryIntent}" (${p2Conf.toFixed(3)})${intentAgree ? '' : ' — disagreement detected'}`,
  );
}

// Keyword Match dimension
function keywordMatchDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const topCandidate = input.phase1.candidates?.[0];
  const kwScore = topCandidate?.score ?? 0;
  const kwCount = topCandidate?.matchedKeywords?.length ?? 0;
  const kwList = (topCandidate?.matchedKeywords ?? []).map((k) => k.keyword).slice(0, 3).join(', ');

  const p3KwEvidence = input.phase3.evidence?.filter(
    (e) => e.type === 'KEYWORD_ALIAS' || e.type === 'INTENT_KEYWORD',
  ) ?? [];
  const p3KwScore = p3KwEvidence.reduce((acc, e) => acc + (e.weight ?? 0), 0);

  const score = round3(Math.min(1, kwScore * 0.5 + Math.min(0.5, p3KwScore)));
  return dim(
    'Keyword Match',
    score,
    0.15,
    kwCount > 0
      ? `${kwCount} keyword(s) matched: ${kwList || 'none listed'}${p3KwEvidence.length > 0 ? '; account keyword match confirmed' : ''}`
      : 'No keywords matched',
  );
}

// Counterparty dimension
function counterpartyDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const cpEvidence = input.phase2.evidence?.filter((e) => e.type === 'COUNTERPARTY') ?? [];
  const p3CpEvidence = input.phase3.evidence?.filter((e) => e.type === 'COUNTERPARTY') ?? [];
  const totalWeight = [...cpEvidence, ...p3CpEvidence].reduce(
    (acc, e) => acc + (e.weight ?? 0), 0,
  );
  const score = round3(Math.min(1, Math.max(0, totalWeight)));
  const hasCounterparty = cpEvidence.length > 0 || p3CpEvidence.length > 0;
  return dim(
    'Counterparty',
    score,
    0.20,
    hasCounterparty
      ? `Counterparty signal present (${cpEvidence.length} Phase 2 + ${p3CpEvidence.length} Phase 3 evidence)`
      : 'No counterparty information available',
  );
}

// Direction dimension
function directionDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const dirEvidence = input.phase2.evidence?.filter((e) => e.type === 'DIRECTION') ?? [];
  const weight = dirEvidence.reduce((acc, e) => acc + (e.weight ?? 0), 0);
  const score = round3(Math.min(1, Math.max(-1, weight)));
  return dim(
    'Direction',
    score,
    0.15,
    dirEvidence.length > 0
      ? `Direction ${score >= 0 ? 'supports' : 'conflicts with'} intent "${input.phase2.primaryIntent}" (weight: ${round3(weight)})`
      : 'No direction signal',
  );
}

// Account Policy dimension
function accountPolicyDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const policyEvidence = input.phase3.evidence?.filter((e) => e.type === 'POLICY_PREFERRED') ?? [];
  const conflictFlags = input.phase3.conflictFlags ?? [];
  const hasAmbiguity = conflictFlags.some((f) =>
    ['AR_REVENUE_AMBIGUITY', 'AP_EXPENSE_AMBIGUITY'].includes(f),
  );
  const score = policyEvidence.length > 0 ? 0.10 : hasAmbiguity ? -0.10 : 0;
  return dim(
    'Account Policy',
    round3(score),
    0.10,
    policyEvidence.length > 0
      ? `Account is policy-preferred for intent "${input.phase3.intent}"`
      : hasAmbiguity
        ? `Account type conflicts with intent policy (${conflictFlags.filter((f) => ['AR_REVENUE_AMBIGUITY','AP_EXPENSE_AMBIGUITY'].includes(f)).join(', ')})`
        : 'No account policy override applied',
  );
}

// Company Context dimension
function companyContextDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const hasPrimary = input.phase3.primaryRecommendation !== null;
  const crossCompany = (input.phase3.conflictFlags ?? []).includes('CROSS_COMPANY_ACCOUNT');
  const score = hasPrimary ? (crossCompany ? -0.05 : 0.05) : 0;
  return dim(
    'Company Context',
    round3(score),
    0.05,
    crossCompany
      ? 'Cross-company accounts detected in input — filtered for safety'
      : hasPrimary
        ? 'Recommended account belongs to correct company'
        : 'No company-matched account found',
  );
}

// Penalty dimension
function penaltyDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const conflictFlags = input.phase3.conflictFlags ?? [];
  const penaltyFlags = conflictFlags.filter((f) =>
    ['AR_REVENUE_AMBIGUITY', 'AP_EXPENSE_AMBIGUITY', 'CROSS_COMPANY_ACCOUNT',
     'MULTIPLE_CLOSE_CANDIDATES', 'UNKNOWN_INTENT', 'INTERNAL_TRANSFER_UNVERIFIED',
     'INSUFFICIENT_EVIDENCE'].includes(f),
  );
  const p1Review = input.phase1.requiresManualReview ? 1 : 0;
  const p2Review = input.phase2.requiresManualReview ? 1 : 0;
  const totalPenalties = penaltyFlags.length + p1Review + p2Review;
  const score = round3(-0.05 * Math.min(6, totalPenalties));
  return dim(
    'Penalty',
    score,
    0.10,
    totalPenalties > 0
      ? `${totalPenalties} penalty signal(s): ${penaltyFlags.join(', ')}${p1Review ? '; P1 manual-review' : ''}${p2Review ? '; P2 manual-review' : ''}`
      : 'No penalty signals',
  );
}

// Manual Review Trigger dimension
function manualReviewDim(input: ExplainabilityInput): ConfidenceBreakdownItem {
  const triggers: string[] = [];
  if (input.phase1.requiresManualReview) triggers.push('Phase 1 low confidence');
  if (input.phase2.requiresManualReview) triggers.push('Phase 2 ambiguity');
  if (input.phase3.requiresManualReview) triggers.push('Phase 3 review flag');

  const score = triggers.length > 0 ? round3(-0.05 * triggers.length) : 0;
  return dim(
    'Manual Review Trigger',
    score,
    0.10,
    triggers.length > 0
      ? `Manual review triggered by: ${triggers.join('; ')}`
      : 'No manual review triggers',
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the full confidence breakdown from Phase 1–3 outputs.
 */
export function buildConfidenceBreakdown(input: ExplainabilityInput): ConfidenceBreakdownItem[] {
  return [
    historicalMappingDim(input),
    intentMatchDim(input),
    keywordMatchDim(input),
    counterpartyDim(input),
    directionDim(input),
    accountPolicyDim(input),
    companyContextDim(input),
    penaltyDim(input),
    manualReviewDim(input),
  ];
}

/**
 * Compute the overall composite confidence from Phase 3 primary confidence
 * as the authoritative source, then adjust with Phase 1/2 signals.
 */
export function computeExplainabilityConfidence(input: ExplainabilityInput): ExplainabilityConfidence {
  // Phase 3 primary recommendation confidence is the primary signal
  const p3Conf = input.phase3.primaryRecommendation?.confidence ?? 0;

  // Phase 2 intent confidence as a secondary signal (weighted lower)
  const p2Conf = input.phase2.confidence ?? 0;

  // Phase 1 as a weak tertiary signal
  const p1Conf = input.phase1.confidence ?? 0;

  // Weighted composite
  let raw = p3Conf * 0.65 + p2Conf * 0.25 + p1Conf * 0.10;

  // Apply penalty signals from breakdown
  const breakdown = buildConfidenceBreakdown(input);
  const penaltyItem = breakdown.find((b) => b.dimension === 'Penalty');
  const reviewItem  = breakdown.find((b) => b.dimension === 'Manual Review Trigger');
  raw += (penaltyItem?.score ?? 0);
  raw += (reviewItem?.score ?? 0);

  const normalized = normalizeConfidence(raw);
  return {
    final:      round3(raw),
    normalized,
    level:      toConfidenceLevel(normalized),
  };
}

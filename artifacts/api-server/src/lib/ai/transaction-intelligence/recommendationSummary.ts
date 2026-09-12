/**
 * AI Transaction Intelligence — Phase 4
 * Recommendation Summary Builder
 *
 * Determines the recommendation status (SAFE / MANUAL_REVIEW / REJECT)
 * and generates a human-readable explanation.
 * Pure function — no side effects, no DB calls.
 */

import type {
  ExplainabilityInput,
  ExplainabilityConfidence,
  ExplainabilityRecommendation,
  RecommendationStatus,
  AmbiguityFlag,
} from './explainabilityTypes.js';

// ─── Status thresholds ─────────────────────────────────────────────────────────

export const RECOMMENDATION_THRESHOLDS = {
  /** At or above this confidence and no triggers → SAFE */
  SAFE_MIN_CONFIDENCE:          0.75,
  /** Below this confidence → REJECT (unless there is a recommendation) */
  REJECT_MAX_CONFIDENCE:        0.30,
  /** Conflict flags that always force MANUAL_REVIEW */
  MANUAL_REVIEW_FLAGS: [
    'AR_REVENUE_AMBIGUITY',
    'AP_EXPENSE_AMBIGUITY',
    'MULTIPLE_CLOSE_CANDIDATES',
    'INTERNAL_TRANSFER_UNVERIFIED',
    'UNKNOWN_INTENT',
  ] as readonly string[],
  /** Conflict flags that force REJECT */
  REJECT_FLAGS: [] as readonly string[],
} as const;

// ─── Status logic ─────────────────────────────────────────────────────────────

/**
 * Determine the recommendation status from confidence + phase results.
 */
export function determineRecommendationStatus(
  input: ExplainabilityInput,
  confidence: ExplainabilityConfidence,
  ambiguity: AmbiguityFlag[],
): RecommendationStatus {
  const { phase3 } = input;

  // Hard REJECT: no account found
  if (!phase3.primaryRecommendation) return 'REJECT';

  // Hard REJECT: any reject-triggering flags
  const conflictFlags = phase3.conflictFlags ?? [];
  if (RECOMMENDATION_THRESHOLDS.REJECT_FLAGS.some((f) => conflictFlags.includes(f))) {
    return 'REJECT';
  }

  // REJECT: confidence too low to trust
  if (confidence.normalized < RECOMMENDATION_THRESHOLDS.REJECT_MAX_CONFIDENCE) return 'REJECT';

  // MANUAL_REVIEW: Phase 3 explicitly flagged it
  if (phase3.requiresManualReview) return 'MANUAL_REVIEW';

  // MANUAL_REVIEW: known conflict flags
  if (RECOMMENDATION_THRESHOLDS.MANUAL_REVIEW_FLAGS.some((f) => conflictFlags.includes(f))) {
    return 'MANUAL_REVIEW';
  }

  // MANUAL_REVIEW: any ambiguity detected
  if (ambiguity.length > 0) return 'MANUAL_REVIEW';

  // MANUAL_REVIEW: medium-low confidence band
  if (confidence.normalized < RECOMMENDATION_THRESHOLDS.SAFE_MIN_CONFIDENCE) return 'MANUAL_REVIEW';

  // SAFE: passes all checks
  return 'SAFE';
}

// ─── Explanation builder ──────────────────────────────────────────────────────

function describeStatus(status: RecommendationStatus): string {
  switch (status) {
    case 'SAFE':
      return 'The AI recommendation is reliable and may be used with standard approval.';
    case 'MANUAL_REVIEW':
      return 'The AI recommendation requires human review before posting due to ambiguity, low confidence, or conflict signals.';
    case 'REJECT':
      return 'The AI could not produce a reliable recommendation. Manual account selection is required.';
  }
}

function describeConfidence(confidence: ExplainabilityConfidence): string {
  const pct = Math.round(confidence.normalized * 100);
  switch (confidence.level) {
    case 'VERY_HIGH': return `Confidence is very high (${pct}%) — the engine has strong evidence for this recommendation.`;
    case 'HIGH':      return `Confidence is high (${pct}%) — the recommendation is well-supported.`;
    case 'MEDIUM':    return `Confidence is moderate (${pct}%) — some uncertainty exists; review before posting.`;
    case 'LOW':       return `Confidence is low (${pct}%) — significant uncertainty; manual verification required.`;
    case 'VERY_LOW':  return `Confidence is very low (${pct}%) — the recommendation should not be trusted without full manual review.`;
  }
}

function describeEvidence(input: ExplainabilityInput): string {
  const evidence = input.phase3.evidence ?? [];
  const parts: string[] = [];

  if (evidence.some((e) => e.type === 'HISTORICAL_APPROVED')) {
    parts.push('approved historical mapping');
  } else if (evidence.some((e) => e.type === 'HISTORICAL_USAGE')) {
    parts.push('historical usage pattern');
  }
  if (evidence.some((e) => e.type === 'INTENT_KEYWORD')) {
    parts.push(`intent keyword match (${input.phase3.intent})`);
  }
  if (evidence.some((e) => e.type === 'KEYWORD_ALIAS')) {
    parts.push('account keyword/alias match');
  }
  const cpEvidence = input.phase2.evidence?.find((e) => e.type === 'COUNTERPARTY');
  if (cpEvidence?.value) {
    parts.push(`counterparty signal (${String(cpEvidence.value).slice(0, 40)})`);
  }
  if (evidence.some((e) => e.type === 'POLICY_PREFERRED')) {
    parts.push('account policy preference');
  }

  return parts.length > 0
    ? `Supporting evidence: ${parts.join('; ')}.`
    : 'No strong supporting evidence found.';
}

function describeCaveats(input: ExplainabilityInput, ambiguity: AmbiguityFlag[]): string {
  const conflictFlags = input.phase3.conflictFlags ?? [];
  const parts: string[] = [];

  if (conflictFlags.includes('AR_REVENUE_AMBIGUITY')) {
    parts.push('AR/Revenue ambiguity detected');
  }
  if (conflictFlags.includes('AP_EXPENSE_AMBIGUITY')) {
    parts.push('AP/Expense ambiguity detected');
  }
  if (conflictFlags.includes('MULTIPLE_CLOSE_CANDIDATES')) {
    parts.push('multiple close account candidates');
  }
  if (conflictFlags.includes('UNKNOWN_INTENT')) {
    parts.push('intent could not be classified');
  }
  if (ambiguity.some((a) => a.type === 'WEAK_EVIDENCE')) {
    parts.push('weak evidence only');
  }

  return parts.length > 0 ? `Caveats: ${parts.join('; ')}.` : '';
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Build the recommendation object from confidence + phase outputs.
 */
export function buildRecommendationSummary(
  input: ExplainabilityInput,
  confidence: ExplainabilityConfidence,
  ambiguity: AmbiguityFlag[],
): ExplainabilityRecommendation {
  const status = determineRecommendationStatus(input, confidence, ambiguity);

  const parts = [
    describeStatus(status),
    describeConfidence(confidence),
    describeEvidence(input),
  ];

  const caveats = describeCaveats(input, ambiguity);
  if (caveats) parts.push(caveats);

  return {
    status,
    explanation: parts.join(' '),
  };
}

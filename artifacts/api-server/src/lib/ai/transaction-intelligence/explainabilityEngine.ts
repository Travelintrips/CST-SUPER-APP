/**
 * AI Transaction Intelligence — Phase 4
 * Explainability & Confidence Engine
 *
 * Public API:
 *   explainTransaction(input: ExplainabilityInput): ExplainabilityResult
 *   explainTransactionBatch(inputs: ExplainabilityInput[]): ExplainabilityResult[]
 *
 * Contract:
 *  - Reads Phase 1, 2, and 3 outputs — does NOT re-analyse.
 *  - Additive: Phase 1, 2, and 3 output contracts are unchanged.
 *  - No DB queries, no network calls, no side effects.
 *  - No Math.random(). Deterministic.
 *  - No mutation of input objects.
 *  - Batch preserves input order.
 *  - Engine NEVER posts journal entries or auto-approves transactions.
 */

import type { ExplainabilityInput, ExplainabilityResult } from './explainabilityTypes.js';
import { buildExplainabilityEvidence } from './explainabilityEvidence.js';
import {
  buildConfidenceBreakdown,
  computeExplainabilityConfidence,
} from './confidenceBreakdown.js';
import {
  detectAmbiguity,
  buildAccountingWarnings,
  buildAuditSummary,
  buildReviewerNotes,
} from './auditReasonBuilder.js';
import {
  buildRecommendationSummary,
  determineRecommendationStatus,
} from './recommendationSummary.js';

// ─── explainTransaction ────────────────────────────────────────────────────────

/**
 * Generate the full explainability result for a single transaction.
 *
 * Steps:
 *  1. Compute overall confidence from Phase 1/2/3 outputs.
 *  2. Build evidence list (additive read of Phase 1/2/3).
 *  3. Build confidence breakdown by dimension.
 *  4. Detect ambiguity flags.
 *  5. Build accounting warnings.
 *  6. Build recommendation summary + status.
 *  7. Build audit summary (human-readable).
 *  8. Build reviewer notes.
 *  9. Assemble result.
 */
export function explainTransaction(input: ExplainabilityInput): ExplainabilityResult {
  // ── 1. Confidence ──────────────────────────────────────────────────────────
  const confidence = computeExplainabilityConfidence(input);

  // ── 2. Evidence ────────────────────────────────────────────────────────────
  const evidence = buildExplainabilityEvidence(input);

  // ── 3. Confidence breakdown ────────────────────────────────────────────────
  const confidenceBreakdown = buildConfidenceBreakdown(input);

  // ── 4. Ambiguity ───────────────────────────────────────────────────────────
  const ambiguity = detectAmbiguity(input);

  // ── 5. Accounting warnings ─────────────────────────────────────────────────
  const accountingWarnings = buildAccountingWarnings(input);

  // ── 6. Recommendation ──────────────────────────────────────────────────────
  const recommendation = buildRecommendationSummary(input, confidence, ambiguity);
  const status = recommendation.status;

  // ── 7. Audit summary ───────────────────────────────────────────────────────
  const auditSummary = buildAuditSummary(input, confidence, status);

  // ── 8. Reviewer notes ──────────────────────────────────────────────────────
  const reviewerNotes = buildReviewerNotes(input, confidence, status, ambiguity);

  // ── 9. Assemble ────────────────────────────────────────────────────────────
  return {
    confidence,
    recommendation,
    evidence,
    confidenceBreakdown,
    ambiguity,
    accountingWarnings,
    auditSummary,
    reviewerNotes,
    explainabilityVersion: '1.0',
  };
}

// ─── explainTransactionBatch ──────────────────────────────────────────────────

/**
 * Process multiple transactions. Preserves input order. Fully synchronous.
 */
export function explainTransactionBatch(inputs: ExplainabilityInput[]): ExplainabilityResult[] {
  return inputs.map(explainTransaction);
}

// ─── Re-export for convenience ─────────────────────────────────────────────────
export { determineRecommendationStatus };

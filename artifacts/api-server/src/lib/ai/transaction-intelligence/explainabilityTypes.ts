/**
 * AI Transaction Intelligence — Phase 4
 * Explainability & Confidence Engine — Types
 *
 * Pure types: no DB deps, no side effects, no network calls.
 * Additive: does NOT modify Phase 1, Phase 2, or Phase 3 types.
 */

import type { TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type { CoaPredictionResult } from './coaPredictionTypes.js';

// ─── Re-export upstream types for convenience ──────────────────────────────────
export type { TransactionAnalysisResult } from './transactionTypes.js';
export type { IntentClassificationResult } from './intentClassificationTypes.js';
export type { CoaPredictionResult } from './coaPredictionTypes.js';

// ─── Input ─────────────────────────────────────────────────────────────────────

/**
 * Input to the Explainability Engine.
 * Receives the outputs of Phase 1, 2, and 3 — does NOT re-analyse.
 */
export interface ExplainabilityInput {
  /** Phase 1: Transaction Understanding result. */
  phase1: TransactionAnalysisResult;
  /** Phase 2: Intent Classification result. */
  phase2: IntentClassificationResult;
  /** Phase 3: COA Prediction result. */
  phase3: CoaPredictionResult;
  /**
   * Optional human-readable transaction description for the audit summary.
   * Falls back to phase1.normalizedDescription if omitted.
   */
  rawDescription?: string;
}

// ─── Confidence ────────────────────────────────────────────────────────────────

/** Coarse confidence band. */
export type ConfidenceLevel =
  | 'VERY_HIGH' // >= 0.95
  | 'HIGH'      // >= 0.85
  | 'MEDIUM'    // >= 0.70
  | 'LOW'       // >= 0.50
  | 'VERY_LOW'; // < 0.50

export interface ExplainabilityConfidence {
  /** Raw composite confidence (0.00–1.00, may exceed 1 before clamping). */
  final: number;
  /** Clamped & normalised to [0, 1]. */
  normalized: number;
  /** Coarse band label. */
  level: ConfidenceLevel;
}

// ─── Recommendation ────────────────────────────────────────────────────────────

export type RecommendationStatus = 'SAFE' | 'MANUAL_REVIEW' | 'REJECT';

export interface ExplainabilityRecommendation {
  status: RecommendationStatus;
  explanation: string;
}

// ─── Evidence ─────────────────────────────────────────────────────────────────

export type EvidenceType =
  | 'HISTORICAL_MAPPING'
  | 'INTENT_MATCH'
  | 'KEYWORD_MATCH'
  | 'COUNTERPARTY'
  | 'DIRECTION'
  | 'ACCOUNT_POLICY'
  | 'COMPANY_CONTEXT'
  | 'PENALTY'
  | 'MANUAL_REVIEW_TRIGGER'
  | 'PHASE1_ANALYSIS'
  | 'PHASE2_CLASSIFICATION'
  | 'PHASE3_PREDICTION';

export interface ExplainabilityEvidence {
  /** Category of this evidence piece. */
  type: EvidenceType;
  /** Which engine / subsystem produced this evidence. */
  source: 'PHASE1' | 'PHASE2' | 'PHASE3' | 'ENGINE';
  /** Importance weight of this evidence (0.00–1.00). */
  weight: number;
  /** Human-readable description. */
  description: string;
  /** Positive contribution to overall confidence (0.00–1.00). */
  contribution: number;
  /** Alias for contribution — kept for schema consistency. */
  confidenceContribution: number;
  /** Negative drag on confidence (0.00–1.00, stored as positive number). */
  negativeContribution: number;
}

// ─── Confidence Breakdown ─────────────────────────────────────────────────────

export type BreakdownDimension =
  | 'Historical Mapping'
  | 'Intent Match'
  | 'Keyword Match'
  | 'Counterparty'
  | 'Direction'
  | 'Account Policy'
  | 'Company Context'
  | 'Penalty'
  | 'Manual Review Trigger';

export interface ConfidenceBreakdownItem {
  dimension: BreakdownDimension;
  /** Raw score contribution for this dimension (may be negative for penalties). */
  score: number;
  /** Absolute contribution magnitude (0.00–1.00). */
  weight: number;
  /** Short explanation of how this dimension was scored. */
  detail: string;
}

// ─── Ambiguity ────────────────────────────────────────────────────────────────

export type AmbiguityType =
  | 'AR_VS_REVENUE'
  | 'AP_VS_EXPENSE'
  | 'INTERNAL_TRANSFER'
  | 'UNKNOWN_INTENT'
  | 'MULTIPLE_CLOSE_CANDIDATES'
  | 'WEAK_EVIDENCE'
  | 'CROSS_COMPANY'
  | 'INACTIVE_ACCOUNT'
  | 'NON_POSTABLE_ACCOUNT';

export interface AmbiguityFlag {
  type: AmbiguityType;
  description: string;
  /** Recommended action for the reviewer. */
  reviewAction: string;
}

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Full output from the Explainability & Confidence Engine.
 * This is a READ-ONLY analytical result — it never posts journals,
 * approves transactions, or mutates any database state.
 */
export interface ExplainabilityResult {
  confidence: ExplainabilityConfidence;
  recommendation: ExplainabilityRecommendation;
  evidence: ExplainabilityEvidence[];
  confidenceBreakdown: ConfidenceBreakdownItem[];
  ambiguity: AmbiguityFlag[];
  accountingWarnings: string[];
  auditSummary: string;
  reviewerNotes: string[];
  explainabilityVersion: '1.0';
}

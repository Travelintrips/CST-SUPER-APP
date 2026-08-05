/**
 * AI Transaction Intelligence — Phase 5
 * Learning & Feedback Engine — Types
 *
 * Pure types: no DB deps, no side effects, no network calls.
 * Additive: does NOT modify Phase 1–4 types.
 * Read-only engine: never auto-applies any changes.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type { TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';
import type { CoaPredictionResult } from './coaPredictionTypes.js';
import type { ExplainabilityResult } from './explainabilityTypes.js';

// ─── Re-export upstream types for convenience ──────────────────────────────────
export type { TransactionIntent } from './transactionTypes.js';
export type { TransactionAnalysisResult } from './transactionTypes.js';
export type { IntentClassificationResult } from './intentClassificationTypes.js';
export type { CoaPredictionResult } from './coaPredictionTypes.js';
export type { ExplainabilityResult } from './explainabilityTypes.js';

// ─── Reviewer Decision ─────────────────────────────────────────────────────────

/**
 * The decision made by a human reviewer after examining the AI recommendation.
 *
 * - APPROVED: reviewer accepted the AI's COA recommendation as-is
 * - CHANGED_COA: reviewer selected a different COA than AI suggested
 * - REJECTED: reviewer rejected the transaction entirely (bad classification)
 * - SKIPPED: reviewer skipped without making a decision
 * - UNKNOWN: decision is unavailable or could not be determined
 */
export type ReviewerDecision =
  | 'APPROVED'
  | 'CHANGED_COA'
  | 'REJECTED'
  | 'SKIPPED'
  | 'UNKNOWN';

// ─── Learning Status ───────────────────────────────────────────────────────────

/**
 * Current state of the learning engine for a given pattern.
 *
 * - NO_ACTION: insufficient data to learn from
 * - COLLECTING: accumulating feedback, not ready for recommendation
 * - READY_FOR_RULE: enough evidence to suggest a new matching rule
 * - READY_FOR_DICTIONARY: enough evidence to suggest dictionary term additions
 * - READY_FOR_REVIEW: conflicting or ambiguous enough to require human review of the engine itself
 */
export type LearningStatus =
  | 'NO_ACTION'
  | 'COLLECTING'
  | 'READY_FOR_RULE'
  | 'READY_FOR_DICTIONARY'
  | 'READY_FOR_REVIEW';

// ─── Feedback Record ───────────────────────────────────────────────────────────

/**
 * A single human reviewer feedback record.
 * Represents the outcome of one transaction review event.
 */
export interface FeedbackRecord {
  /** Unique identifier for this feedback record. */
  feedbackId: string;

  /** Company this feedback belongs to. */
  companyId: string | number;

  /** Reviewer identity (user ID or email — hashed/anonymized if needed). */
  reviewerId: string;

  /** The decision made by this reviewer. */
  decision: ReviewerDecision;

  /** The COA ID selected by the reviewer (required when decision = CHANGED_COA). */
  selectedCoaId?: string | number;

  /** The COA code selected by the reviewer. */
  selectedCoaCode?: string;

  /** The COA name selected by the reviewer. */
  selectedCoaName?: string;

  /** Free-text comment from the reviewer. */
  comment?: string;

  /**
   * Reviewer's confidence in their own decision (0.00–1.00).
   * null/undefined means not provided.
   */
  reviewerConfidence?: number;

  /** ISO 8601 timestamp when the reviewer made this decision. */
  reviewedAt: string | Date;

  /**
   * ISO 8601 timestamp when the transaction was first presented for review.
   * Used to compute review turnaround time.
   */
  presentedAt?: string | Date;

  /**
   * The AI-recommended COA code at the time of review.
   * Needed to compute agreement between AI and reviewer.
   */
  aiRecommendedCoaCode?: string;

  /**
   * The AI-recommended intent at the time of review.
   */
  aiRecommendedIntent?: TransactionIntent;

  /**
   * The AI confidence score at the time of review.
   */
  aiConfidenceAtReview?: number;

  /** Raw transaction description at time of review. */
  transactionDescription?: string;

  /** Normalized transaction description. */
  normalizedDescription?: string;

  /** Counterparty name at time of review. */
  counterpartyName?: string;

  /** Transaction code at time of review. */
  transactionCode?: string;
}

// ─── Feedback Summary ──────────────────────────────────────────────────────────

/** Aggregated summary of reviewer feedback for a pattern. */
export interface FeedbackSummary {
  /** Total number of feedback records analysed. */
  totalCount: number;

  /** Number of APPROVED decisions. */
  approvedCount: number;

  /** Number of CHANGED_COA decisions. */
  changedCoaCount: number;

  /** Number of REJECTED decisions. */
  rejectedCount: number;

  /** Number of SKIPPED decisions. */
  skippedCount: number;

  /** Number of UNKNOWN decisions. */
  unknownCount: number;

  /** Fraction of APPROVED / (APPROVED + CHANGED_COA + REJECTED) — ignores SKIPPED. */
  approvalRate: number;

  /** Fraction of CHANGED_COA / total actionable decisions. */
  changeRate: number;

  /** Fraction of REJECTED / total actionable decisions. */
  rejectionRate: number;

  /** The most commonly selected COA code by reviewers (when CHANGED_COA). */
  dominantCorrectedCoaCode?: string;

  /** Name of the dominant corrected COA. */
  dominantCorrectedCoaName?: string;

  /** Number of distinct reviewers who contributed feedback. */
  distinctReviewerCount: number;

  /** Whether reviewers show consistent agreement with each other. */
  reviewersAgreeing: boolean;

  /** The decision most frequently chosen by reviewers. */
  dominantDecision: ReviewerDecision;
}

// ─── Feedback Reliability ──────────────────────────────────────────────────────

/** Reliability assessment for a body of feedback evidence. */
export interface FeedbackReliability {
  /**
   * Composite reliability score (0.00–1.00).
   * 1.00 = highly reliable, many consistent reviewers, clear pattern.
   * 0.00 = completely unreliable (single reviewer, conflicting).
   */
  score: number;

  /** Human-readable label: HIGH / MEDIUM / LOW / VERY_LOW */
  level: 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';

  /** Number of approvals contributing to reliability. */
  approvalCount: number;

  /** Number of rejections contributing to reliability. */
  rejectionCount: number;

  /** Consistency score across reviewers (0.00–1.00). */
  reviewerConsistency: number;

  /** Agreement score with historical evidence (0.00–1.00). */
  historicalAgreement: number;

  /** Whether all feedback comes from the same company (increases trust). */
  companyScopeConsistent: boolean;

  /** Consistency of the intent across feedback records (0.00–1.00). */
  intentConsistency: number;

  /** Consistency of the counterparty across feedback records (0.00–1.00). */
  counterpartyConsistency: number;

  /** Consistency of the COA selection across feedback records (0.00–1.00). */
  coaConsistency: number;

  /** Trend of AI confidence (IMPROVING / STABLE / DECLINING / INSUFFICIENT_DATA). */
  confidenceTrend: 'IMPROVING' | 'STABLE' | 'DECLINING' | 'INSUFFICIENT_DATA';

  /** Human-readable reasons affecting reliability. */
  reasons: string[];
}

// ─── Rule Suggestion ───────────────────────────────────────────────────────────

/** Type of rule being suggested. */
export type RuleSuggestionType =
  | 'KEYWORD'
  | 'ALIAS'
  | 'COUNTERPARTY_MAPPING'
  | 'HISTORICAL_MAPPING'
  | 'RULE_CANDIDATE'
  | 'THRESHOLD_CANDIDATE';

/** A suggested rule derived from reviewer feedback patterns. Engine never applies this. */
export interface SuggestedRule {
  /** Type of suggestion. */
  type: RuleSuggestionType;

  /** Short identifier/label for this suggestion. */
  label: string;

  /** Human-readable description of what this rule would do. */
  description: string;

  /**
   * The value to add (keyword text, alias text, counterparty pattern, etc.).
   * Exact semantics depend on `type`.
   */
  value: string;

  /**
   * The intent this rule applies to (if applicable).
   */
  intent?: TransactionIntent;

  /**
   * The COA code this rule maps to (if applicable).
   */
  coaCode?: string;

  /**
   * Confidence that this suggestion would improve accuracy (0.00–1.00).
   */
  confidence: number;

  /**
   * Number of feedback records that support this suggestion.
   */
  supportingCount: number;

  /** Whether this suggestion requires human approval before use. Always true for Phase 5. */
  requiresHumanApproval: true;
}

// ─── Dictionary Term Suggestion ────────────────────────────────────────────────

/** A suggested addition to the transaction dictionary. */
export interface SuggestedDictionaryTerm {
  /** The term to add (normalized/lowercased). */
  term: string;

  /** The intent this term maps to. */
  intent: TransactionIntent;

  /**
   * Suggested weight for this term (0.0–1.0).
   */
  weight: number;

  /** Whether this term is an exact match (true) or partial/fuzzy (false). */
  exactMatch: boolean;

  /**
   * Number of feedback records where this term appeared in reviewed descriptions.
   */
  supportingCount: number;

  /** Confidence that this term would improve classification (0.00–1.00). */
  confidence: number;

  /** Whether this addition requires human approval before use. Always true. */
  requiresHumanApproval: true;
}

// ─── Learning Statistics ───────────────────────────────────────────────────────

/** Aggregated statistics across all feedback records. */
export interface LearningStatistics {
  /** Total feedback records analysed. */
  totalFeedback: number;

  /** Overall fraction of APPROVED decisions. */
  approvalRate: number;

  /** Overall fraction requiring manual review per AI recommendation. */
  manualReviewRate: number;

  /** Overall fraction where reviewer changed the COA. */
  changeRate: number;

  /** Intents most frequently corrected by reviewers (descending by count). */
  topCorrectedIntents: Array<{
    intent: TransactionIntent;
    correctionCount: number;
    totalCount: number;
    correctionRate: number;
  }>;

  /** COA codes most frequently corrected by reviewers (descending by count). */
  topCorrectedCoa: Array<{
    aiCoaCode: string;
    reviewerCoaCode: string;
    count: number;
  }>;

  /** Transaction descriptions most often requiring manual review. */
  topAmbiguousPatterns: Array<{
    normalizedDescription: string;
    manualReviewCount: number;
  }>;

  /**
   * Average time (in minutes) between transaction presented and reviewed.
   * null when presentedAt is not available.
   */
  avgReviewTurnaroundMinutes: number | null;

  /** Distribution of reviewer decisions. */
  feedbackDistribution: Record<ReviewerDecision, number>;

  /** Number of distinct reviewers in this dataset. */
  distinctReviewers: number;

  /** Number of distinct companies in this dataset. */
  distinctCompanies: number;
}

// ─── Learning Evidence ─────────────────────────────────────────────────────────

/** A piece of evidence that supports a learning recommendation. */
export interface LearningEvidence {
  /** Source of evidence. */
  type:
    | 'FEEDBACK_PATTERN'
    | 'REVIEWER_AGREEMENT'
    | 'HISTORICAL_CONSISTENCY'
    | 'CONFIDENCE_SIGNAL'
    | 'COUNTERPARTY_PATTERN'
    | 'INTENT_PATTERN'
    | 'COA_PATTERN';

  /** Human-readable description of this evidence. */
  description: string;

  /** Weight of this evidence (0.00–1.00). */
  weight: number;

  /** Supporting count (number of records). */
  count: number;
}

// ─── Feedback Conflict ─────────────────────────────────────────────────────────

/** A conflict detected between feedback records. */
export interface FeedbackConflict {
  /** Type of conflict. */
  type:
    | 'REVIEWER_DISAGREEMENT'
    | 'COA_DISAGREEMENT'
    | 'INTENT_DISAGREEMENT'
    | 'COMPANY_MISMATCH'
    | 'LOW_CONFIDENCE_PATTERN'
    | 'HISTORICAL_CONTRADICTION';

  /** Human-readable description of the conflict. */
  description: string;

  /** IDs of the feedback records involved in the conflict. */
  involvedFeedbackIds: string[];

  /** Severity: HIGH means blocks rule suggestion; LOW is informational. */
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}

// ─── Learning Recommendation ───────────────────────────────────────────────────

/** The overall recommendation from the learning engine. */
export interface LearningRecommendation {
  /** Top-line action suggested to a human administrator. */
  action:
    | 'NONE'
    | 'REVIEW_FEEDBACK'
    | 'CONSIDER_RULE'
    | 'CONSIDER_DICTIONARY_UPDATE'
    | 'RESOLVE_CONFLICT'
    | 'MONITOR';

  /** Human-readable explanation. */
  explanation: string;

  /** Priority level of this recommendation. */
  priority: 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';
}

// ─── Input ─────────────────────────────────────────────────────────────────────

/**
 * Complete input to the Phase 5 Learning & Feedback Engine.
 *
 * The engine reads Phase 1–4 outputs and reviewer decisions.
 * It never modifies them.
 */
export interface LearningInput {
  /** Phase 1 result. */
  phase1: TransactionAnalysisResult;

  /** Phase 2 result. */
  phase2: IntentClassificationResult;

  /** Phase 3 result. */
  phase3: CoaPredictionResult;

  /** Phase 4 result. */
  phase4: ExplainabilityResult;

  /** Current reviewer's decision for this transaction. */
  reviewerDecision: ReviewerDecision;

  /** The COA selected by the reviewer (required when decision = CHANGED_COA). */
  reviewerSelectedCoaCode?: string;

  /** The COA ID selected by the reviewer. */
  reviewerSelectedCoaId?: string | number;

  /** The COA name selected by the reviewer. */
  reviewerSelectedCoaName?: string;

  /** Free-text comment from the reviewer. */
  reviewerComment?: string;

  /** Reviewer's self-assessed confidence in their decision (0.00–1.00). */
  reviewerConfidence?: number;

  /**
   * Historical feedback records for the same pattern (same company + similar description).
   * The more historical records provided, the richer the learning output.
   */
  historicalFeedback?: FeedbackRecord[];

  /** Company ID. */
  companyId: string | number;

  /** Reviewer identity. */
  reviewerId?: string;

  /** ISO 8601 timestamp when the review was made. */
  reviewedAt?: string | Date;

  /** ISO 8601 timestamp when the transaction was presented for review. */
  presentedAt?: string | Date;
}

// ─── Output ───────────────────────────────────────────────────────────────────

/**
 * Full output from the Phase 5 Learning & Feedback Engine.
 *
 * This is a READ-ONLY analytical result.
 * The engine NEVER:
 * - auto-trains models
 * - auto-updates dictionaries
 * - auto-updates scoring
 * - auto-updates COA
 * - auto-approves
 * - auto-posts
 * - updates the database directly
 *
 * All changes are represented as RECOMMENDATIONS requiring human approval.
 */
export interface LearningOutput {
  /** Current learning status. */
  learningStatus: LearningStatus;

  /** Top-line recommendation for a human administrator. */
  recommendation: LearningRecommendation;

  /** Aggregated summary of the feedback. */
  feedbackSummary: FeedbackSummary;

  /** Reliability assessment of the feedback evidence. */
  reliability: FeedbackReliability;

  /** Suggested rule additions (require human approval). */
  suggestedRules: SuggestedRule[];

  /** Suggested dictionary term additions (require human approval). */
  suggestedDictionaryTerms: SuggestedDictionaryTerm[];

  /** Learning statistics across all feedback. */
  statistics: LearningStatistics;

  /**
   * Composite learning score (0.00–1.00).
   * Higher = more confident in the learning candidate quality.
   */
  learningScore: number;

  /** Evidence supporting the learning output. */
  evidence: LearningEvidence[];

  /**
   * Fraction of reviewers who agree with the AI recommendation (0.00–1.00).
   */
  reviewerAgreement: number;

  /**
   * True when the learning output must be reviewed by a human admin before any action.
   * Always true for rule/dictionary suggestions.
   */
  requiresHumanApproval: boolean;

  /** Detected conflicts in the feedback. */
  conflicts: FeedbackConflict[];

  /** Monotonically increasing version string. */
  learningVersion: '1.0';
}

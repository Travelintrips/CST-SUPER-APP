/**
 * AI Transaction Intelligence — Phase 5
 * Learning & Feedback Engine — Types
 *
 * Pure types: no DB deps, no side effects, no network calls.
 * Additive: does NOT modify Phase 1–4 types.
 */

import type { TransactionIntent } from './transactionTypes.js';

// ─── Re-export upstream ────────────────────────────────────────────────────────
export type { TransactionIntent } from './transactionTypes.js';

// ─── Feedback Record ───────────────────────────────────────────────────────────

/**
 * A single human-correction event recorded after a transaction was processed.
 * Represents a reviewer's override or approval of the AI's recommendation.
 */
export interface FeedbackRecord {
  /** Unique identifier for this feedback record. */
  id: string;

  /** Company that owns this feedback. */
  companyId: string | number;

  /** Raw bank mutation description at time of feedback. */
  rawDescription: string;

  /** Normalized description used during original prediction. */
  normalizedDescription: string;

  /** The intent predicted by the engine. */
  predictedIntent: TransactionIntent;

  /** The intent the reviewer confirmed or corrected to. */
  correctedIntent?: TransactionIntent;

  /** COA account ID predicted by the engine. */
  predictedCoaId?: string | number;

  /** COA account code predicted. */
  predictedCoaCode?: string;

  /** COA account ID the reviewer selected instead (null = accepted prediction). */
  correctedCoaId?: string | number;

  /** COA account code the reviewer selected. */
  correctedCoaCode?: string;

  /** Counterparty name at time of transaction. */
  counterpartyName?: string;

  /** Bank transaction code (RTGS, BI-FAST, etc.). */
  transactionCode?: string;

  /** Transaction direction. */
  direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';

  /** Whether the reviewer accepted the AI recommendation without changes. */
  wasAccepted: boolean;

  /** ISO 8601 timestamp of when this feedback was recorded. */
  recordedAt: string;

  /** Free-text comment from the reviewer. */
  reviewerComment?: string;
}

// ─── Correction Record ─────────────────────────────────────────────────────────

/**
 * Aggregated correction statistics for a description pattern.
 * Multiple raw feedback records may be aggregated into one CorrectionRecord.
 */
export interface CorrectionRecord {
  /** Normalized description pattern. */
  normalizedDescription: string;

  /** Company scope. */
  companyId: string | number;

  /** How many times this pattern appeared. */
  occurrenceCount: number;

  /** How many times the AI was accepted unchanged. */
  acceptedCount: number;

  /** How many times the AI was overridden. */
  correctedCount: number;

  /** Most common corrected-to COA id. */
  mostFrequentCoaId?: string | number;

  /** Most common corrected-to COA code. */
  mostFrequentCoaCode?: string;

  /** Most common confirmed intent. */
  mostFrequentIntent?: TransactionIntent;

  /** Unique COA ids the reviewers chose for this pattern. */
  distinctCoaIds: (string | number)[];

  /** Unique intents observed. */
  distinctIntents: TransactionIntent[];
}

// ─── Historical Statistics ──────────────────────────────────────────────────────

/**
 * Aggregate statistics derived from all historical feedback for a company.
 */
export interface HistoricalStatistics {
  companyId: string | number;

  /** Total feedback records processed. */
  totalFeedback: number;

  /** Overall acceptance rate (accepted / total). */
  overallAcceptanceRate: number;

  /** Acceptance rate per intent. */
  acceptanceRateByIntent: Partial<Record<TransactionIntent, number>>;

  /** Most corrected intent pairs: { from, to, count }. */
  topCorrectionPairs: Array<{
    fromIntent: TransactionIntent;
    toIntent: TransactionIntent;
    count: number;
  }>;

  /** Top corrected COA mappings: { normalizedDescription, coaCode, count }. */
  topCoaCorrections: Array<{
    normalizedDescription: string;
    coaCode: string;
    count: number;
  }>;

  /** Patterns with very low acceptance (high correction rate). */
  problematicPatterns: string[];
}

// ─── Rule Catalog Entry ────────────────────────────────────────────────────────

/**
 * An existing rule entry in the current rule catalog.
 * Used by Phase 6 conflict detection.
 */
export interface ExistingRuleEntry {
  id: string;
  type: 'KEYWORD' | 'ALIAS' | 'COUNTERPARTY_MAPPING' | 'INTENT_COA_MAPPING' | 'THRESHOLD';
  intent?: TransactionIntent;
  keyword?: string;
  alias?: string;
  counterpartyPattern?: string;
  coaId?: string | number;
  coaCode?: string;
  companyId?: string | number;
  weight?: number;
  isActive: boolean;
}

// ─── Dictionary Catalog Entry ──────────────────────────────────────────────────

/**
 * An existing dictionary entry.
 */
export interface ExistingDictionaryEntry {
  keyword: string;
  intent: TransactionIntent;
  weight: number;
  aliases: string[];
  isActive: boolean;
}

// ─── Learning Signal ───────────────────────────────────────────────────────────

/**
 * A computed learning signal extracted from feedback patterns.
 * Used by Phase 6 to generate rule recommendations.
 */
export interface LearningSignal {
  /** Signal source category. */
  signalType:
    | 'KEYWORD'
    | 'ALIAS'
    | 'COUNTERPARTY'
    | 'INTENT_COA'
    | 'THRESHOLD'
    | 'DESCRIPTION_PATTERN';

  /** Normalized description pattern that triggered this signal. */
  normalizedDescription: string;

  /** Intent associated with this signal. */
  intent?: TransactionIntent;

  /** COA code this pattern consistently maps to. */
  coaCode?: string;

  /** COA id. */
  coaId?: string | number;

  /** Counterparty name pattern. */
  counterpartyName?: string;

  /** Transaction code pattern. */
  transactionCode?: string;

  /** Extracted keyword from description. */
  keyword?: string;

  /** Company scope (undefined = global signal). */
  companyId?: string | number;

  /**
   * Number of occurrences of this pattern in feedback.
   */
  occurrenceCount: number;

  /**
   * Fraction of occurrences where the correction was consistent
   * (i.e. always to the same COA/intent). 0.0–1.0.
   */
  consistencyRate: number;

  /**
   * Confidence in this signal (0.0–1.0).
   * Based on occurrence count and consistency rate.
   */
  signalConfidence: number;
}

// ─── Learning Engine Output ────────────────────────────────────────────────────

/**
 * Full output of the Phase 5 Learning & Feedback Engine.
 * This is the primary INPUT to Phase 6.
 */
export interface LearningEngineOutput {
  /** Company this learning result applies to. */
  companyId: string | number;

  /** All computed learning signals sorted by signalConfidence descending. */
  signals: LearningSignal[];

  /** Keyword-type signals only. */
  keywordSignals: LearningSignal[];

  /** Counterparty-type signals only. */
  counterpartySignals: LearningSignal[];

  /** Intent-COA mapping signals. */
  intentCoaSignals: LearningSignal[];

  /** Description pattern signals. */
  descriptionPatternSignals: LearningSignal[];

  /** Aggregate statistics used to derive the signals. */
  statistics: HistoricalStatistics;

  /** Total feedback records processed. */
  feedbackProcessed: number;

  /** Patterns that appear ≥ minOccurrences and have consistencyRate ≥ minConsistency. */
  strongSignals: LearningSignal[];

  /** Engine version. */
  learningVersion: '5.0';
}

// ─── Learning Engine Input ─────────────────────────────────────────────────────

/**
 * Input to the Phase 5 Learning Engine.
 */
export interface LearningEngineInput {
  /** Company to learn from. */
  companyId: string | number;

  /** Raw feedback records from human reviewers. */
  feedbackRecords: FeedbackRecord[];

  /** Pre-aggregated correction records (optional — engine can compute from feedback). */
  correctionRecords?: CorrectionRecord[];

  /** Minimum occurrences to consider a signal significant. Default: 3. */
  minOccurrences?: number;

  /** Minimum consistency rate to include a signal. Default: 0.7. */
  minConsistency?: number;
}

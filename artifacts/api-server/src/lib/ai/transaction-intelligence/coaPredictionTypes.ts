/**
 * AI Transaction Intelligence — Phase 3
 * COA Prediction Types & Interfaces
 *
 * Pure types: no DB deps, no side effects, no network calls.
 * Deterministic at all times — no Math.random() anywhere in this module.
 * Additive: does not modify Phase 1 or Phase 2 types.
 */

import type { TransactionIntent, TransactionAnalysisResult } from './transactionTypes.js';
import type { IntentClassificationResult } from './intentClassificationTypes.js';

// ─── Re-export for convenience ─────────────────────────────────────────────────

export type { TransactionIntent, TransactionAnalysisResult } from './transactionTypes.js';
export type { IntentClassificationResult } from './intentClassificationTypes.js';

// ─── COA Account Candidate ─────────────────────────────────────────────────────

/**
 * A single Chart-of-Accounts entry available for prediction.
 * Supplied by the caller — engine never queries DB directly.
 */
export interface CoaAccountCandidate {
  /** Internal ID of the account (string or integer PK). */
  id: string | number;

  /** Company this account belongs to. Engine rejects accounts from other companies. */
  companyId: string | number;

  /** Account code (e.g. "1101", "6-001"). */
  code: string;

  /** Human-readable account name (e.g. "Biaya Administrasi Bank"). */
  name: string;

  /**
   * Accounting type: "asset", "liability", "equity", "revenue", "expense", etc.
   * Lower-cased for matching; may use Indonesian equivalents (aset, hutang, etc.).
   */
  accountType?: string;

  /** Expected normal balance direction. */
  normalBalance?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';

  /**
   * Broad category grouping (e.g. "current_asset", "operating_expense").
   * Used alongside accountType to resolve ambiguity.
   */
  category?: string;

  /** Subcategory for further granularity (e.g. "bank_fee", "payroll"). */
  subcategory?: string;

  /** Whether this account is active and usable. */
  isActive: boolean;

  /**
   * Whether manual journal entries can post to this account.
   * False for summary/header accounts.
   */
  allowsManualPosting?: boolean;

  /**
   * Semantic keywords associated with this account.
   * Used for keyword matching evidence (lower-cased recommended).
   */
  keywords?: string[];

  /** Alternative names or abbreviations for this account. */
  aliases?: string[];

  /** Arbitrary metadata for policy evaluation. */
  metadata?: Record<string, unknown>;
}

// ─── Historical COA Mapping ────────────────────────────────────────────────────

/**
 * A historical mapping from a prior transaction to a COA account.
 * Functions as evidence — not automatically trusted.
 */
export interface HistoricalCoaMapping {
  /** Company this mapping applies to. */
  companyId: string | number;

  /** Normalized description that matched (for fuzzy comparison). */
  normalizedDescription?: string;

  /** Intent that was present at time of mapping. */
  intent?: TransactionIntent;

  /** Counterparty name at time of mapping. */
  counterpartyName?: string;

  /** Counterparty account at time of mapping. */
  counterpartyAccount?: string;

  /** Transaction code at time of mapping. */
  transactionCode?: string;

  /** The COA account ID that was mapped. */
  coaId: string | number;

  /** The COA account code that was mapped. */
  coaCode: string;

  /** Total number of times this mapping was used. */
  usageCount?: number;

  /** Number of times it was approved (accepted by human reviewer). */
  approvedCount?: number;

  /** Number of times it was rejected (overridden by human reviewer). */
  rejectedCount?: number;

  /** When this mapping was last used. */
  lastUsedAt?: string | Date;
}

// ─── Prediction Policy ─────────────────────────────────────────────────────────

/**
 * Optional policy configuration that modulates engine behaviour.
 * All fields are optional — engine uses safe defaults when absent.
 */
export interface CoaPredictionPolicy {
  /**
   * Minimum confidence to include an account in the output at all.
   * Default: 0.40
   */
  minimumConfidence?: number;

  /**
   * Confidence below which requiresManualReview is set to true.
   * Default: 0.80
   */
  manualReviewThreshold?: number;

  /**
   * Maximum allowed difference between #1 and #2 candidates before
   * triggering MULTIPLE_CLOSE_CANDIDATES and manual review.
   * Default: 0.10
   */
  ambiguityDelta?: number;

  /**
   * Maximum number of alternative candidates to return (excluding primary).
   * Default: 4
   */
  maxAlternatives?: number;

  /** Account codes explicitly blocked from recommendation. */
  blockedAccountCodes?: string[];

  /** Account types explicitly blocked from recommendation. */
  blockedAccountTypes?: string[];

  /**
   * For a given intent, only allow these account types.
   * Overrides default type-matching logic.
   */
  allowedAccountTypesByIntent?: Partial<Record<TransactionIntent, string[]>>;

  /**
   * For a given intent, prefer these specific account codes.
   * Acts as a score bonus, not a hard constraint.
   */
  preferredAccountCodesByIntent?: Partial<Record<TransactionIntent, string[]>>;
}

// ─── Input ─────────────────────────────────────────────────────────────────────

/**
 * Complete input to the Phase 3 COA Prediction Engine.
 *
 * Required fields: transaction.description, companyId, availableAccounts.
 * Engine can run Phase 1 + Phase 2 internally if phase1Analysis / phase2Classification
 * are not supplied.
 */
export interface CoaPredictionInput {
  /** Transaction details. Only description is required. */
  transaction: {
    /** Raw bank mutation description (required). */
    description: string;

    /** Debit or credit direction. */
    direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';

    /** Transaction amount (positive number). */
    amount?: number;

    /** ISO 4217 currency code. */
    currency?: string;

    /** ISO 8601 date string or Date object. */
    transactionDate?: string | Date;

    /** Internal bank account ID. */
    bankAccountId?: string | number;

    /** Name of the bank. */
    bankName?: string;

    /** Name of the counterparty. */
    counterpartyName?: string;

    /** Account number of the counterparty. */
    counterpartyAccount?: string;

    /** Bank-assigned reference number. */
    referenceNumber?: string;

    /** Bank transaction code (RTGS, BI-FAST, SWIFT, etc.). */
    transactionCode?: string;
  };

  /** Company ID — accounts from other companies are rejected. Required. */
  companyId: string | number;

  /**
   * Active COA accounts to rank. Engine filters this list; caller provides all
   * candidates for the company.
   */
  availableAccounts: CoaAccountCandidate[];

  /** Precomputed Phase 1 result. Engine runs Phase 1 internally if absent. */
  phase1Analysis?: TransactionAnalysisResult;

  /** Precomputed Phase 2 result. Engine runs Phase 2 internally if absent. */
  phase2Classification?: IntentClassificationResult;

  /** Historical mappings for this transaction context. Optional evidence. */
  historicalMappings?: HistoricalCoaMapping[];

  /** Optional policy overrides. */
  policy?: CoaPredictionPolicy;
}

// ─── Conflict Flags ────────────────────────────────────────────────────────────

/**
 * Conflict or warning flags set when the engine detects unsafe or ambiguous conditions.
 */
export type CoaConflictFlag =
  | 'COMPANY_MISMATCH'
  | 'INACTIVE_ACCOUNT'
  | 'NON_POSTABLE_ACCOUNT'
  | 'DIRECTION_CONFLICT'
  | 'INTENT_ACCOUNT_CONFLICT'
  | 'INSUFFICIENT_EVIDENCE'
  | 'HISTORICAL_MAPPING_REJECTED'
  | 'MULTIPLE_CLOSE_CANDIDATES'
  | 'UNKNOWN_INTENT'
  | 'CROSS_COMPANY_ACCOUNT'
  | 'AR_REVENUE_AMBIGUITY'
  | 'AP_EXPENSE_AMBIGUITY'
  | 'INTERNAL_TRANSFER_UNVERIFIED';

// ─── Recommendation Source ─────────────────────────────────────────────────────

/** Identifies the primary evidence source for the recommendation. */
export type CoaRecommendationSource =
  | 'HISTORICAL_MAPPING'
  | 'INTENT_MAPPING'
  | 'KEYWORD_MAPPING'
  | 'COUNTERPARTY_MAPPING'
  | 'ACCOUNT_POLICY'
  | 'COMBINED'
  | 'NONE';

// ─── Evidence ──────────────────────────────────────────────────────────────────

/** A single piece of evidence contributing to a COA recommendation. */
export interface CoaPredictionEvidence {
  /** Evidence source type (e.g. "HISTORICAL", "KEYWORD", "DIRECTION"). */
  type: string;

  /** Human-readable value of this evidence. */
  value: string;

  /** Contribution weight (0.0 – 1.0). */
  weight: number;

  /** The COA code this evidence supports, if specific to one account. */
  coaCode?: string;
}

// ─── Alternative ───────────────────────────────────────────────────────────────

/** An alternative COA recommendation with its ranking metadata. */
export interface CoaPredictionAlternative {
  coaId: string | number;
  coaCode: string;
  coaName: string;
  /** Normalized confidence 0.00 – 1.00. */
  confidence: number;
  /** Raw composite score before normalization. */
  score: number;
  /** Reasons specific to this alternative. */
  reason: string[];
}

// ─── Output ────────────────────────────────────────────────────────────────────

/**
 * Full result of Phase 3 COA Prediction.
 * Includes Phase 1 and Phase 2 results for full traceability.
 */
export interface CoaPredictionResult {
  /** Company ID from the input. */
  companyId: string | number;

  /**
   * Primary recommended COA account.
   * null when no safe recommendation can be made.
   */
  primaryRecommendation: {
    coaId: string | number;
    coaCode: string;
    coaName: string;
    /** Normalized confidence 0.00 – 1.00. */
    confidence: number;
    /** Raw composite score. */
    score: number;
  } | null;

  /** Alternative recommendations sorted by confidence descending. */
  alternatives: CoaPredictionAlternative[];

  /** Classified transaction intent (from Phase 2). */
  intent: TransactionIntent;

  /** Normalized description used internally. */
  normalizedDescription: string;

  /** All evidence items considered in this prediction. */
  evidence: CoaPredictionEvidence[];

  /** Ordered human-readable reasons for the prediction. */
  reason: string[];

  /** Conflict or warning flags detected. */
  conflictFlags: string[];

  /**
   * True when human review is required before posting.
   * Engine NEVER posts automatically.
   */
  requiresManualReview: boolean;

  /** Primary evidence source for the recommendation. */
  recommendationSource: CoaRecommendationSource;

  /** Full Phase 1 analysis result (for traceability). */
  phase1Analysis: TransactionAnalysisResult;

  /** Full Phase 2 classification result (for traceability). */
  phase2Classification: IntentClassificationResult;
}

// ─── Dependencies ──────────────────────────────────────────────────────────────

/**
 * Optional dependency injection for the prediction engine.
 * Engine works without any dependencies — these are enhancement only.
 * NEVER query the database directly from within the pure engine.
 */
export interface CoaPredictionDependencies {
  /**
   * Fetch historical mappings for the given input.
   * Called after Phase 2 if input.historicalMappings is not provided.
   */
  getHistoricalMappings?: (
    input: CoaPredictionInput,
  ) => HistoricalCoaMapping[] | Promise<HistoricalCoaMapping[]>;

  /**
   * Validate whether a specific account is allowed for this transaction.
   * Overrides or supplements internal safety rules.
   */
  validateAccount?: (
    account: CoaAccountCandidate,
    input: CoaPredictionInput,
  ) =>
    | { allowed: boolean; reason?: string }
    | Promise<{ allowed: boolean; reason?: string }>;

  /**
   * Return semantic keyword hints for a given intent and company.
   * Used to supplement the built-in intent keyword map.
   */
  getIntentAccountHints?: (
    intent: TransactionIntent,
    companyId: string | number,
  ) => string[] | Promise<string[]>;
}

// ─── Internal ranked candidate ─────────────────────────────────────────────────

/** Internal intermediate type used by the ranker — not exported from index. */
export interface _RankedCandidate {
  account: CoaAccountCandidate;
  /** Composite score (may exceed 1.0 before normalisation). */
  score: number;
  /** Normalised confidence 0.00 – 1.00. */
  confidence: number;
  evidence: CoaPredictionEvidence[];
  reason: string[];
  conflictFlags: string[];
}

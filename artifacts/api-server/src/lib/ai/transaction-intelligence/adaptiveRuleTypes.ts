/**
 * AI Transaction Intelligence — Phase 6
 * Adaptive Rule Recommendation Engine — Types
 *
 * Pure types: no DB deps, no side effects, no network calls.
 * Additive: does NOT modify Phase 1–5 types.
 *
 * Engine produces RECOMMENDATIONS ONLY.
 * It never modifies dictionary, scoring, thresholds, rules, or database.
 * All recommendations require requiresHumanApproval = true.
 */

import type { TransactionIntent } from './transactionTypes.js';
import type {
  LearningEngineOutput,
  LearningSignal,
  ExistingRuleEntry,
  ExistingDictionaryEntry,
} from './learningEngineTypes.js';

// ─── Re-export for convenience ─────────────────────────────────────────────────
export type { TransactionIntent } from './transactionTypes.js';
export type {
  LearningEngineOutput,
  LearningSignal,
  ExistingRuleEntry,
  ExistingDictionaryEntry,
} from './learningEngineTypes.js';

// ─── Risk & Priority ───────────────────────────────────────────────────────────

/** Risk level for a recommended change. */
export type RuleRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Priority for actioning a recommendation. */
export type RulePriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

// ─── Recommended Changes ───────────────────────────────────────────────────────

/**
 * A recommended new or updated rule.
 * Never auto-applied — always requiresHumanApproval.
 */
export interface RecommendedRule {
  /** Unique identifier for this recommendation. */
  id: string;

  /** Type of rule change being recommended. */
  type: 'KEYWORD' | 'ALIAS' | 'COUNTERPARTY_MAPPING' | 'INTENT_COA_MAPPING' | 'THRESHOLD';

  /** Human-readable description of what this recommendation does. */
  description: string;

  /** Normalized description pattern that triggered this recommendation. */
  normalizedDescription: string;

  /** Normalized confidence of this recommendation (0.0–1.0). */
  confidence: number;

  /** Risk level if applied. */
  riskLevel: RuleRiskLevel;

  /** Action priority. */
  priority: RulePriority;

  /** Always true — all recommendations require human review. */
  requiresHumanApproval: true;

  /** Number of feedback occurrences supporting this recommendation. */
  supportingOccurrences: number;

  /** Consistency rate of the supporting feedback (0.0–1.0). */
  consistencyRate: number;

  /** Intents this recommendation affects. */
  affectedIntents: TransactionIntent[];

  /** COA ids this recommendation affects. */
  affectedCoaIds: (string | number)[];

  /** If company-scoped, the company id. */
  companyId?: string | number;

  /** The keyword to add (for KEYWORD type). */
  keyword?: string;

  /** The alias to add (for ALIAS type). */
  alias?: string;

  /** Weight suggestion (for KEYWORD/ALIAS). */
  suggestedWeight?: number;

  /** The COA code to map to. */
  coaCode?: string;

  /** The COA id to map to. */
  coaId?: string | number;

  /** Free-text reasoning from the learning signal. */
  reason: string[];
}

/**
 * A recommended new or updated dictionary entry.
 */
export interface RecommendedDictionaryEntry {
  /** Unique id for this recommendation. */
  id: string;

  /** The keyword to add/update. */
  keyword: string;

  /** Target intent. */
  intent: TransactionIntent;

  /** Suggested weight (0.0–2.0). */
  suggestedWeight: number;

  /** Aliases to add alongside the keyword. */
  aliases: string[];

  /** Human-readable rationale. */
  reason: string;

  /** Confidence (0.0–1.0). */
  confidence: number;

  /** Occurrence count supporting this. */
  supportingOccurrences: number;

  /** Risk level if applied. */
  riskLevel: RuleRiskLevel;

  /** Action priority. */
  priority: RulePriority;

  /** Always true. */
  requiresHumanApproval: true;

  /** Company scope, if applicable. */
  companyId?: string | number;
}

/**
 * A recommended change to a scoring threshold.
 */
export interface RecommendedThresholdChange {
  /** Unique id. */
  id: string;

  /** Parameter name (e.g. "manualReviewThreshold", "minimumConfidence"). */
  parameter: string;

  /** Human-readable display name. */
  parameterLabel: string;

  /** Current configured value. */
  currentValue: number;

  /** Suggested new value. */
  suggestedValue: number;

  /** Rationale for the change. */
  reason: string;

  /** Confidence (0.0–1.0). */
  confidence: number;

  /** Risk level if applied. */
  riskLevel: RuleRiskLevel;

  /** Action priority. */
  priority: RulePriority;

  /** Always true. */
  requiresHumanApproval: true;
}

/**
 * A recommended counterparty-to-intent/COA mapping.
 */
export interface RecommendedCounterpartyMapping {
  /** Unique id. */
  id: string;

  /** Normalized counterparty name pattern. */
  counterpartyPattern: string;

  /** Raw counterparty name (example). */
  exampleCounterpartyName: string;

  /** Suggested intent for this counterparty. */
  suggestedIntent: TransactionIntent;

  /** Suggested COA code. */
  suggestedCoaCode?: string;

  /** Suggested COA id. */
  suggestedCoaId?: string | number;

  /** Company scope. */
  companyId?: string | number;

  /** Confidence (0.0–1.0). */
  confidence: number;

  /** Number of transactions supporting this. */
  supportingOccurrences: number;

  /** Consistency rate (0.0–1.0). */
  consistencyRate: number;

  /** Risk level if applied. */
  riskLevel: RuleRiskLevel;

  /** Action priority. */
  priority: RulePriority;

  /** Always true. */
  requiresHumanApproval: true;
}

// ─── Simulation ────────────────────────────────────────────────────────────────

/**
 * Result of a dry-run simulation of applying all recommendations
 * to a representative transaction sample.
 */
export interface SimulationResult {
  /** Total transactions in the simulation sample. */
  totalTransactions: number;

  /** Transactions that would change behaviour if recommendations were applied. */
  affectedTransactions: number;

  /** Transactions that would become more accurate (confidence ↑ or review removed). */
  improvedTransactions: number;

  /** Transactions that would become less accurate. */
  worsenedTransactions: number;

  /** Change in overall precision: positive = better. */
  precisionDelta: number;

  /** Change in manual review rate: negative = fewer reviews needed. */
  manualReviewDelta: number;

  /** Always true — simulation never applies changes. */
  dryRun: true;

  /** Confidence in the simulation estimates (0.0–1.0). */
  simulationConfidence: number;
}

// ─── Impact Analysis ───────────────────────────────────────────────────────────

/**
 * Estimated business impact of applying all recommendations.
 */
export interface ImpactAnalysis {
  /** Estimated number of transactions that would be affected per period. */
  estimatedTransactionsAffected: number;

  /** Estimated precision improvement (0.0–1.0). */
  estimatedPrecisionGain: number;

  /** Estimated reduction in manual review rate (0.0–1.0). */
  estimatedManualReviewReduction: number;

  /** 95% confidence interval on precision gain: [lower, upper]. */
  confidenceInterval: [number, number];

  /** Brief human-readable impact summary. */
  summary: string;
}

// ─── Conflict Detection ────────────────────────────────────────────────────────

/** Type of rule conflict. */
export type RuleConflictType =
  | 'DUPLICATE_RULE'
  | 'CONTRADICTING_RULE'
  | 'COMPANY_CONFLICT'
  | 'DICTIONARY_CONFLICT'
  | 'COUNTERPARTY_CONFLICT'
  | 'THRESHOLD_CONFLICT'
  | 'KEYWORD_OVERLAP';

/**
 * A detected conflict between a recommendation and existing rules,
 * or between two recommendations.
 */
export interface RuleConflict {
  /** Unique conflict id. */
  id: string;

  /** Type of conflict. */
  type: RuleConflictType;

  /** Human-readable description of the conflict. */
  description: string;

  /** IDs of the recommended rules involved. */
  affectedRecommendationIds: string[];

  /** IDs of existing rules that conflict (if any). */
  existingRuleIds: string[];

  /** Risk severity of this conflict. */
  severity: RuleRiskLevel;

  /** Suggested resolution action. */
  resolution: string;
}

// ─── Feedback Cluster ──────────────────────────────────────────────────────────

/**
 * A group of similar feedback records clustered by pattern.
 */
export interface FeedbackCluster {
  /** Cluster identifier. */
  clusterId: string;

  /** Primary grouping key. */
  clusterKey: string;

  /** Cluster type / grouping dimension. */
  clusterType:
    | 'INTENT'
    | 'COUNTERPARTY'
    | 'NORMALIZED_DESCRIPTION'
    | 'COA'
    | 'COMPANY'
    | 'KEYWORD'
    | 'ALIAS'
    | 'TRANSACTION_CODE';

  /** Total feedback items in this cluster. */
  memberCount: number;

  /** Dominant intent in this cluster. */
  dominantIntent?: TransactionIntent;

  /** Dominant COA code in this cluster. */
  dominantCoaCode?: string;

  /** Dominant COA id. */
  dominantCoaId?: string | number;

  /** Consistency: fraction with same COA/intent. */
  consistencyRate: number;

  /** Confidence from learning signals. */
  confidence: number;

  /** Learning signals included in this cluster. */
  signals: LearningSignal[];

  /** Company scope. */
  companyId?: string | number;
}

// ─── Rule Package ──────────────────────────────────────────────────────────────

/** Type of recommendation package. */
export type RulePackageType =
  | 'RULE_PACKAGE'
  | 'DICTIONARY_PACKAGE'
  | 'COUNTERPARTY_PACKAGE'
  | 'THRESHOLD_PACKAGE';

/**
 * A grouped package of related recommendations ready for admin review.
 */
export interface RulePackage {
  /** Package identifier. */
  packageId: string;

  /** Package type. */
  packageType: RulePackageType;

  /** Human-readable title. */
  title: string;

  /** Brief description of what this package contains. */
  description: string;

  /** Rules in this package. */
  rules: RecommendedRule[];

  /** Dictionary entries in this package. */
  dictionaryEntries: RecommendedDictionaryEntry[];

  /** Counterparty mappings in this package. */
  counterpartyMappings: RecommendedCounterpartyMapping[];

  /** Threshold changes in this package. */
  thresholdChanges: RecommendedThresholdChange[];

  /** Overall risk level for this package. */
  riskLevel: RuleRiskLevel;

  /** Overall priority. */
  priority: RulePriority;

  /** Always true. */
  requiresHumanApproval: true;

  /** Estimated transactions affected by this package. */
  estimatedImpact: number;
}

// ─── Engine Input ──────────────────────────────────────────────────────────────

/**
 * Full input to the Phase 6 Adaptive Rule Recommendation Engine.
 */
export interface AdaptiveRuleEngineInput {
  /** Learning engine output (Phase 5). Required. */
  learningOutput: LearningEngineOutput;

  /** Existing rules in the catalog (for conflict detection). */
  existingRules?: ExistingRuleEntry[];

  /** Existing dictionary entries (for conflict detection). */
  existingDictionary?: ExistingDictionaryEntry[];

  /** Company context. */
  companyId: string | number;

  /**
   * Representative transaction sample for simulation.
   * If omitted, simulation uses synthetic data based on learning signals.
   */
  simulationTransactions?: Array<{
    description: string;
    normalizedDescription: string;
    currentIntent?: TransactionIntent;
    currentCoaCode?: string;
    currentConfidence?: number;
    requiresManualReview?: boolean;
  }>;

  /** Minimum confidence to emit a recommendation. Default: 0.5. */
  minRecommendationConfidence?: number;

  /** Maximum number of rules to recommend. Default: 50. */
  maxRecommendations?: number;
}

// ─── Engine Output ─────────────────────────────────────────────────────────────

/**
 * Full output of the Phase 6 Adaptive Rule Recommendation Engine.
 *
 * IMPORTANT: This is a READ-ONLY recommendation package.
 * The engine NEVER modifies dictionary, scoring, thresholds, rules, or database.
 * All entries have requiresHumanApproval = true.
 */
export interface AdaptiveRuleRecommendationResult {
  /** Recommended rule additions / updates. */
  recommendedRules: RecommendedRule[];

  /** Recommended dictionary entry additions. */
  recommendedDictionaryEntries: RecommendedDictionaryEntry[];

  /** Recommended threshold parameter changes. */
  recommendedThresholdChanges: RecommendedThresholdChange[];

  /** Recommended counterparty-to-COA/intent mappings. */
  recommendedCounterpartyMappings: RecommendedCounterpartyMapping[];

  /** Dry-run simulation result. */
  simulationResult: SimulationResult;

  /** Estimated business impact. */
  impactAnalysis: ImpactAnalysis;

  /** Overall risk level of the full recommendation set. */
  riskLevel: RuleRiskLevel;

  /** Overall action priority. */
  priority: RulePriority;

  /** Always true — requires human review before any change is applied. */
  requiresHumanApproval: true;

  /** Detected conflicts within recommendations or against existing rules. */
  conflicts: RuleConflict[];

  /** Feedback clusters used to derive recommendations. */
  clusters: FeedbackCluster[];

  /** Grouped recommendation packages for admin review. */
  packages: RulePackage[];

  /** Human-readable executive summary. */
  summary: string;

  /** Engine version. */
  version: '6.0';
}

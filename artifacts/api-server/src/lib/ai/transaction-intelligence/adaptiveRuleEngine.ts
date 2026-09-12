/**
 * AI Transaction Intelligence — Phase 6
 * Adaptive Rule Recommendation Engine
 *
 * Orchestrates all Phase 6 subsystems:
 *   1. Cluster feedback signals (ruleClusterer)
 *   2. Generate rule / dictionary / counterparty / threshold recommendations
 *   3. Detect conflicts (ruleConflictDetector)
 *   4. Analyze risk (ruleRiskAnalyzer)
 *   5. Compute priority (rulePriority)
 *   6. Run dry-run simulation (ruleSimulation)
 *   7. Estimate impact (ruleImpactEstimator)
 *   8. Build admin review packages (rulePackageBuilder)
 *
 * IMPORTANT INVARIANTS:
 *   - Engine NEVER modifies dictionary, scoring, thresholds, rules, or database.
 *   - All output items have requiresHumanApproval = true.
 *   - All operations are pure / deterministic (no Math.random, no network).
 *
 * Pure function — no side effects, no DB calls.
 */

import type {
  AdaptiveRuleEngineInput,
  AdaptiveRuleRecommendationResult,
  RecommendedRule,
  RecommendedDictionaryEntry,
  RecommendedThresholdChange,
  RecommendedCounterpartyMapping,
  FeedbackCluster,
  RuleRiskLevel,
  RulePriority,
} from './adaptiveRuleTypes.js';
import type { LearningSignal } from './learningEngineTypes.js';
import type { TransactionIntent } from './transactionTypes.js';

import { clusterAllDimensions } from './ruleClusterer.js';
import { detectAllConflicts } from './ruleConflictDetector.js';
import { analyzeRisk, aggregateRiskLevels } from './ruleRiskAnalyzer.js';
import { computePriority, aggregatePriorities } from './rulePriority.js';
import { simulateRecommendations } from './ruleSimulation.js';
import { estimateImpact } from './ruleImpactEstimator.js';
import { buildAllPackages } from './rulePackageBuilder.js';

// ─── ID sequence ───────────────────────────────────────────────────────────────

let _ruleSeq = 0;
let _dictSeq = 0;
let _cpSeq = 0;
let _thrSeq = 0;

export function resetEngineSequences(): void {
  _ruleSeq = 0; _dictSeq = 0; _cpSeq = 0; _thrSeq = 0;
}

function nextRuleId(): string    { return `rule-rec-${++_ruleSeq}`; }
function nextDictId(): string    { return `dict-rec-${++_dictSeq}`; }
function nextCpId(): string      { return `cp-rec-${++_cpSeq}`; }
function nextThrId(): string     { return `thr-rec-${++_thrSeq}`; }

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_MIN_CONFIDENCE = 0.5;
const DEFAULT_MAX_RECOMMENDATIONS = 50;

// Minimum occurrence threshold for threshold change suggestions
const THRESHOLD_MIN_OCCURRENCES = 20;
// If acceptance rate is well above the review threshold, suggest tightening
const ACCEPTANCE_RATE_TIGHTEN_THRESHOLD = 0.90;
// If acceptance rate is well below, suggest loosening
const ACCEPTANCE_RATE_LOOSEN_THRESHOLD = 0.55;

// ─── Rule recommendations ──────────────────────────────────────────────────────

function generateRuleRecommendations(
  signals: LearningSignal[],
  minConfidence: number,
  companyId: string | number,
  conflictCount: (signalKey: string) => number,
): RecommendedRule[] {
  const recs: RecommendedRule[] = [];

  for (const signal of signals) {
    if (signal.signalConfidence < minConfidence) continue;
    if (signal.signalType !== 'KEYWORD' && signal.signalType !== 'INTENT_COA' && signal.signalType !== 'DESCRIPTION_PATTERN') continue;
    if (!signal.keyword && signal.signalType === 'KEYWORD') continue;

    const type: RecommendedRule['type'] =
      signal.signalType === 'INTENT_COA' ? 'INTENT_COA_MAPPING' :
      signal.signalType === 'KEYWORD' ? 'KEYWORD' : 'KEYWORD';

    const riskLevel = analyzeRisk({
      confidence: signal.signalConfidence,
      occurrenceCount: signal.occurrenceCount,
      consistencyRate: signal.consistencyRate,
      isCompanyScoped: signal.companyId != null,
      conflictCount: conflictCount(signal.keyword ?? signal.normalizedDescription),
      isThresholdChange: false,
      isNewCoaMapping: signal.coaCode != null,
    });

    const priority = computePriority({
      occurrenceCount: signal.occurrenceCount,
      estimatedPrecisionGain: signal.consistencyRate * 0.15,
      estimatedManualReviewReduction: signal.consistencyRate * 0.10,
      riskLevel,
      confidence: signal.signalConfidence,
      isProblematicPattern: false,
      conflictCount: conflictCount(signal.keyword ?? signal.normalizedDescription),
    });

    const reason: string[] = [
      `Pattern "${signal.normalizedDescription}" appeared ${signal.occurrenceCount} times with ${(signal.consistencyRate * 100).toFixed(0)}% consistency.`,
    ];
    if (signal.coaCode) reason.push(`Consistently mapped to COA ${signal.coaCode}.`);
    if (signal.intent) reason.push(`Associated with intent ${signal.intent}.`);

    recs.push({
      id: nextRuleId(),
      type,
      description: signal.keyword
        ? `Add keyword "${signal.keyword}" for intent ${signal.intent ?? 'UNKNOWN'}`
        : `Add intent-COA mapping for pattern "${signal.normalizedDescription}"`,
      normalizedDescription: signal.normalizedDescription,
      confidence: signal.signalConfidence,
      riskLevel,
      priority,
      requiresHumanApproval: true,
      supportingOccurrences: signal.occurrenceCount,
      consistencyRate: signal.consistencyRate,
      affectedIntents: signal.intent ? [signal.intent] : [],
      affectedCoaIds: signal.coaId != null ? [signal.coaId] : [],
      companyId: signal.companyId,
      keyword: signal.keyword,
      suggestedWeight: signal.consistencyRate >= 0.9 ? 1.5 : signal.consistencyRate >= 0.75 ? 1.2 : 1.0,
      coaCode: signal.coaCode,
      coaId: signal.coaId,
      reason,
    });
  }

  return recs;
}

// ─── Dictionary recommendations ────────────────────────────────────────────────

function generateDictionaryRecommendations(
  signals: LearningSignal[],
  minConfidence: number,
  companyId: string | number,
): RecommendedDictionaryEntry[] {
  const recs: RecommendedDictionaryEntry[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    if (signal.signalConfidence < minConfidence) continue;
    if (signal.signalType !== 'KEYWORD') continue;
    if (!signal.keyword || !signal.intent) continue;

    const key = `${signal.keyword.toLowerCase()}|${signal.intent}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Collect aliases: tokens from normalizedDescription that aren't the keyword
    const aliases = signal.normalizedDescription
      .split(/\s+/)
      .filter((t) => t.length >= 3 && t.toLowerCase() !== signal.keyword!.toLowerCase())
      .slice(0, 3);

    const riskLevel = analyzeRisk({
      confidence: signal.signalConfidence,
      occurrenceCount: signal.occurrenceCount,
      consistencyRate: signal.consistencyRate,
      isCompanyScoped: signal.companyId != null,
      conflictCount: 0,
      isThresholdChange: false,
      isNewCoaMapping: false,
    });

    const priority = computePriority({
      occurrenceCount: signal.occurrenceCount,
      estimatedPrecisionGain: signal.consistencyRate * 0.12,
      estimatedManualReviewReduction: signal.consistencyRate * 0.08,
      riskLevel,
      confidence: signal.signalConfidence,
      isProblematicPattern: false,
      conflictCount: 0,
    });

    recs.push({
      id: nextDictId(),
      keyword: signal.keyword,
      intent: signal.intent,
      suggestedWeight: signal.consistencyRate >= 0.9 ? 1.5 : 1.0,
      aliases,
      reason: `Keyword "${signal.keyword}" appeared ${signal.occurrenceCount} times with ${(signal.consistencyRate * 100).toFixed(0)}% consistency pointing to intent ${signal.intent}.`,
      confidence: signal.signalConfidence,
      supportingOccurrences: signal.occurrenceCount,
      riskLevel,
      priority,
      requiresHumanApproval: true,
      companyId: signal.companyId,
    });
  }

  return recs;
}

// ─── Counterparty recommendations ─────────────────────────────────────────────

function generateCounterpartyRecommendations(
  signals: LearningSignal[],
  minConfidence: number,
): RecommendedCounterpartyMapping[] {
  const recs: RecommendedCounterpartyMapping[] = [];
  const seen = new Set<string>();

  for (const signal of signals) {
    if (signal.signalType !== 'COUNTERPARTY') continue;
    if (signal.signalConfidence < minConfidence) continue;
    if (!signal.intent) continue;

    const key = `${signal.normalizedDescription}|${signal.intent}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const riskLevel = analyzeRisk({
      confidence: signal.signalConfidence,
      occurrenceCount: signal.occurrenceCount,
      consistencyRate: signal.consistencyRate,
      isCompanyScoped: signal.companyId != null,
      conflictCount: 0,
      isThresholdChange: false,
      isNewCoaMapping: signal.coaCode != null,
    });

    const priority = computePriority({
      occurrenceCount: signal.occurrenceCount,
      estimatedPrecisionGain: signal.consistencyRate * 0.15,
      estimatedManualReviewReduction: signal.consistencyRate * 0.12,
      riskLevel,
      confidence: signal.signalConfidence,
      isProblematicPattern: false,
      conflictCount: 0,
    });

    recs.push({
      id: nextCpId(),
      counterpartyPattern: signal.normalizedDescription,
      exampleCounterpartyName: signal.counterpartyName ?? signal.normalizedDescription,
      suggestedIntent: signal.intent,
      suggestedCoaCode: signal.coaCode,
      suggestedCoaId: signal.coaId,
      companyId: signal.companyId,
      confidence: signal.signalConfidence,
      supportingOccurrences: signal.occurrenceCount,
      consistencyRate: signal.consistencyRate,
      riskLevel,
      priority,
      requiresHumanApproval: true,
    });
  }
  return recs;
}

// ─── Threshold recommendations ─────────────────────────────────────────────────

function generateThresholdRecommendations(
  acceptanceRate: number,
  totalFeedback: number,
): RecommendedThresholdChange[] {
  if (totalFeedback < THRESHOLD_MIN_OCCURRENCES) return [];
  const recs: RecommendedThresholdChange[] = [];

  // Suggest tightening manual review threshold if acceptance is very high
  if (acceptanceRate >= ACCEPTANCE_RATE_TIGHTEN_THRESHOLD) {
    const current = 0.80;
    const suggested = parseFloat((current + 0.05).toFixed(2));
    recs.push({
      id: nextThrId(),
      parameter: 'manualReviewThreshold',
      parameterLabel: 'Manual Review Confidence Threshold',
      currentValue: current,
      suggestedValue: suggested,
      reason: `Overall acceptance rate is ${(acceptanceRate * 100).toFixed(1)}% — consider raising the threshold to reduce unnecessary manual reviews.`,
      confidence: Math.min(1, acceptanceRate * 0.9 + 0.1),
      riskLevel: 'MEDIUM',
      priority: 'NORMAL',
      requiresHumanApproval: true,
    });
  }

  // Suggest loosening if acceptance is low (AI is too aggressive)
  if (acceptanceRate < ACCEPTANCE_RATE_LOOSEN_THRESHOLD) {
    const current = 0.80;
    const suggested = parseFloat((current - 0.05).toFixed(2));
    recs.push({
      id: nextThrId(),
      parameter: 'manualReviewThreshold',
      parameterLabel: 'Manual Review Confidence Threshold',
      currentValue: current,
      suggestedValue: suggested,
      reason: `Overall acceptance rate is only ${(acceptanceRate * 100).toFixed(1)}% — lowering the threshold routes more transactions to manual review, improving accuracy.`,
      confidence: Math.min(1, (1 - acceptanceRate) * 0.8 + 0.2),
      riskLevel: 'HIGH',
      priority: 'HIGH',
      requiresHumanApproval: true,
    });
  }

  return recs;
}

// ─── Summary builder ───────────────────────────────────────────────────────────

function buildSummary(
  ruleCount: number,
  dictCount: number,
  cpCount: number,
  thrCount: number,
  conflictCount: number,
  riskLevel: RuleRiskLevel,
  priority: RulePriority,
  acceptanceRate: number,
): string {
  return (
    `Phase 6 Adaptive Rule Recommendation Engine produced ${ruleCount} rule recommendations, ` +
    `${dictCount} dictionary entries, ${cpCount} counterparty mappings, and ${thrCount} threshold changes. ` +
    `${conflictCount} conflict(s) detected. ` +
    `Overall risk: ${riskLevel}. Priority: ${priority}. ` +
    `Current feedback acceptance rate: ${(acceptanceRate * 100).toFixed(1)}%. ` +
    `All recommendations require human approval before any change is applied.`
  );
}

// ─── Main engine ───────────────────────────────────────────────────────────────

/**
 * Run the Phase 6 Adaptive Rule Recommendation Engine.
 *
 * Pure function — deterministic, no side effects.
 */
export function runAdaptiveRuleEngine(
  input: AdaptiveRuleEngineInput,
): AdaptiveRuleRecommendationResult {
  const {
    learningOutput,
    existingRules = [],
    existingDictionary = [],
    companyId,
    simulationTransactions,
    minRecommendationConfidence = DEFAULT_MIN_CONFIDENCE,
    maxRecommendations = DEFAULT_MAX_RECOMMENDATIONS,
  } = input;

  // 1. Cluster signals
  const clusters: FeedbackCluster[] = clusterAllDimensions(learningOutput.signals);

  // Build a lightweight conflict-count map (we'll refine after generation)
  const prelimConflictMap = new Map<string, number>();
  const countConflicts = (key: string): number => prelimConflictMap.get(key) ?? 0;

  // 2. Generate recommendations from each signal category
  let ruleRecs = generateRuleRecommendations(
    learningOutput.signals,
    minRecommendationConfidence,
    companyId,
    countConflicts,
  );

  let dictRecs = generateDictionaryRecommendations(
    learningOutput.signals,
    minRecommendationConfidence,
    companyId,
  );

  let cpRecs = generateCounterpartyRecommendations(
    learningOutput.counterpartySignals,
    minRecommendationConfidence,
  );

  const thrRecs = generateThresholdRecommendations(
    learningOutput.statistics.overallAcceptanceRate,
    learningOutput.feedbackProcessed,
  );

  // 3. Apply maxRecommendations cap (sort by confidence desc, take top N)
  ruleRecs = ruleRecs
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.floor(maxRecommendations * 0.5));
  dictRecs = dictRecs
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.floor(maxRecommendations * 0.3));
  cpRecs = cpRecs
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.floor(maxRecommendations * 0.2));

  // 4. Detect conflicts
  const conflicts = detectAllConflicts({
    rules: ruleRecs,
    dictionaryEntries: dictRecs,
    thresholdChanges: thrRecs,
    counterpartyMappings: cpRecs,
    existingRules,
    existingDictionary,
  });

  // 5. Aggregate risk and priority
  const allRiskLevels = [
    ...ruleRecs.map((r) => r.riskLevel),
    ...dictRecs.map((r) => r.riskLevel),
    ...cpRecs.map((r) => r.riskLevel),
    ...thrRecs.map((r) => r.riskLevel),
  ];
  const allPriorities = [
    ...ruleRecs.map((r) => r.priority),
    ...dictRecs.map((r) => r.priority),
    ...cpRecs.map((r) => r.priority),
    ...thrRecs.map((r) => r.priority),
  ];

  const riskLevel = aggregateRiskLevels(allRiskLevels.length > 0 ? allRiskLevels : ['LOW']);
  const priority = aggregatePriorities(allPriorities.length > 0 ? allPriorities : ['LOW']);

  // 6. Simulation
  const simulationResult = simulateRecommendations(
    ruleRecs,
    dictRecs,
    cpRecs,
    simulationTransactions,
  );

  // 7. Impact estimation
  const avgConfidence =
    [...ruleRecs, ...dictRecs, ...cpRecs, ...thrRecs].length > 0
      ? [...ruleRecs, ...dictRecs, ...cpRecs, ...thrRecs].reduce((s, r) => s + r.confidence, 0) /
        [...ruleRecs, ...dictRecs, ...cpRecs, ...thrRecs].length
      : 0;

  const avgConsistency =
    learningOutput.signals.length > 0
      ? learningOutput.signals.reduce((s, r) => s + r.consistencyRate, 0) /
        learningOutput.signals.length
      : 0;

  const impactAnalysis = estimateImpact({
    signals: learningOutput.signals,
    totalFeedbackProcessed: learningOutput.feedbackProcessed,
    currentAcceptanceRate: learningOutput.statistics.overallAcceptanceRate,
    ruleCount: ruleRecs.length,
    dictionaryCount: dictRecs.length,
    counterpartyCount: cpRecs.length,
    avgRecommendationConfidence: avgConfidence,
    avgConsistencyRate: avgConsistency,
    conflictCount: conflicts.length,
  });

  // 8. Build packages
  const packages = buildAllPackages({
    rules: ruleRecs,
    dictionaryEntries: dictRecs,
    counterpartyMappings: cpRecs,
    thresholdChanges: thrRecs,
  });

  // 9. Summary
  const summary = buildSummary(
    ruleRecs.length,
    dictRecs.length,
    cpRecs.length,
    thrRecs.length,
    conflicts.length,
    riskLevel,
    priority,
    learningOutput.statistics.overallAcceptanceRate,
  );

  return {
    recommendedRules: ruleRecs,
    recommendedDictionaryEntries: dictRecs,
    recommendedThresholdChanges: thrRecs,
    recommendedCounterpartyMappings: cpRecs,
    simulationResult,
    impactAnalysis,
    riskLevel,
    priority,
    requiresHumanApproval: true,
    conflicts,
    clusters,
    packages,
    summary,
    version: '6.0',
  };
}

/**
 * Batch variant — run for multiple companies.
 */
export function runAdaptiveRuleEngineBatch(
  inputs: AdaptiveRuleEngineInput[],
): AdaptiveRuleRecommendationResult[] {
  return inputs.map((input) => runAdaptiveRuleEngine(input));
}

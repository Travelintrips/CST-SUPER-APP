/**
 * AI Transaction Intelligence
 * Public barrel export — Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6
 *
 * Phase 1: Transaction Understanding (keyword-based, description-only)
 * Phase 2: Intent Classification   (direction-aware, context-aware, DI-capable)
 * Phase 3: COA Prediction Engine   (account ranking, confidence, manual-review)
 * Phase 4: Explainability & Confidence Engine
 * Phase 5: Learning & Feedback Engine
 * Phase 6: Adaptive Rule Recommendation Engine
 */

// ── Phase 1: Types ─────────────────────────────────────────────────────────────
export type {
  TransactionIntent,
  KeywordMatch,
  IntentCandidate,
  Explanation,
  TransactionAnalysisResult,
  TaxIntent,
  TaxSubtype,
} from './transactionTypes.js';

export {
  ALL_INTENTS,
  TAX_INTENTS,
  isTaxIntent,
  isLegacyTaxDescription,
} from './transactionTypes.js';

// ── Phase 1: Semantic Dictionary ──────────────────────────────────────────────
export type { DictionaryEntry, IntentDictionary } from './transactionDictionary.js';
export {
  TRANSACTION_DICTIONARY,
  CLASSIFIABLE_INTENTS,
  getEntries,
} from './transactionDictionary.js';

// ── Phase 1: Confidence Engine ────────────────────────────────────────────────
export {
  CONFIDENCE_THRESHOLDS,
  normalizeScore,
  buildExplanation,
  shouldRequireManualReview,
  assembleResult,
} from './transactionConfidence.js';

// ── Phase 1: Zod Schemas ──────────────────────────────────────────────────────
export {
  TransactionIntentSchema,
  AnalyzeDescriptionInputSchema,
  KeywordMatchSchema,
  IntentCandidateSchema,
  ExplanationSchema,
  TransactionAnalysisResultSchema,
} from './transactionSchema.js';
export type {
  AnalyzeDescriptionInput,
  TransactionAnalysisResultValidated,
} from './transactionSchema.js';

// ── Phase 1: Core Understanding Engine ────────────────────────────────────────
export {
  analyzeTransactionDescription,
  analyzeTransactionDescriptions,
  normalizeText,
  inferTaxSubtype,
} from './transactionUnderstanding.js';

// ── Phase 2: Types ─────────────────────────────────────────────────────────────
export type {
  TransactionClassificationInput,
  IntentClassifierDependencies,
  CounterpartyRole,
  IntentClassificationEvidence,
  IntentClassificationAlternative,
  IntentClassificationResult,
} from './intentClassificationTypes.js';

// ── Phase 2: Rules ────────────────────────────────────────────────────────────
export {
  INTENT_NATURAL_DIRECTION,
  DIRECTION_BOOST,
  DIRECTION_PENALTY,
  directionDelta,
  directionConflicts,
  TRANSACTION_CODE_MAP,
  TRANSACTION_CODE_BOOST,
  transactionCodeBoost,
  COUNTERPARTY_BOOST,
  counterpartyBoost,
  INTERNAL_ACCOUNT_BOOST,
  internalAccountBoost,
  COLLISION_GROUPS,
  findCollisionPartner,
  MANUAL_REVIEW_TRIGGERS,
  shouldRequireManualReviewP2,
} from './intentClassificationRules.js';

// ── Phase 2: Confidence Model ─────────────────────────────────────────────────
export { CONFIDENCE_WEIGHTS, computeCompositeScore } from './intentClassificationConfidence.js';
export type { CompositeScoreInput } from './intentClassificationConfidence.js';

// ── Phase 2: Zod Schemas ───────────────────────────────────────────────────────
export {
  DirectionSchema,
  TransactionClassificationInputSchema,
  EvidenceTypeSchema,
  IntentClassificationEvidenceSchema,
  IntentClassificationAlternativeSchema,
  IntentClassificationResultSchema,
} from './intentClassificationSchema.js';
export type {
  TransactionClassificationInputValidated,
  IntentClassificationResultValidated,
} from './intentClassificationSchema.js';

// ── Phase 2: Intent Classifier ────────────────────────────────────────────────
export {
  classifyTransactionIntent,
  classifyTransactionIntentBatch,
} from './intentClassifier.js';

// ── Phase 3: Types ─────────────────────────────────────────────────────────────
export type {
  CoaAccountCandidate,
  HistoricalCoaMapping,
  CoaPredictionPolicy,
  CoaPredictionInput,
  CoaPredictionResult,
  CoaPredictionDependencies,
  CoaPredictionEvidence,
  CoaPredictionAlternative,
  CoaConflictFlag,
  CoaRecommendationSource,
} from './coaPredictionTypes.js';

// ── Phase 3: Rules ─────────────────────────────────────────────────────────────
export {
  INTENT_COA_KEYWORDS,
  INTENT_PREFERRED_ACCOUNT_TYPES,
  INTENT_ANTI_PATTERN_TYPES,
  directionNormalBalanceDelta,
  scoreAccountKeywords,
  scoreAccountCategory,
  scoreHistoricalMapping,
  scoreCounterparty,
  scoreTransactionCode,
  isArRevenueAmbiguity,
  isApExpenseAmbiguity,
  hardSafetyReject,
} from './coaPredictionRules.js';

// ── Phase 3: Confidence Model ─────────────────────────────────────────────────
export {
  COA_CONFIDENCE_WEIGHTS,
  COA_CONFIDENCE_PENALTIES,
  COA_REVIEW_THRESHOLDS,
  computeCoaScore,
  evaluateManualReview,
} from './coaPredictionConfidence.js';
export type {
  CoaCandidateScoreInput,
  ManualReviewInput,
} from './coaPredictionConfidence.js';

// ── Phase 3: Policy ────────────────────────────────────────────────────────────
export {
  DEFAULT_COA_POLICY,
  mergePolicy,
  evaluateAccountPolicy,
  filterAccountCandidates,
  resolveRecommendationSource,
} from './coaMappingPolicy.js';
export type {
  PolicyEvalResult,
  FilteredAccount,
} from './coaMappingPolicy.js';

// ── Phase 3: Ranker ────────────────────────────────────────────────────────────
export { rankCoaCandidates } from './coaCandidateRanker.js';
export type { RankCoaCandidatesInput } from './coaCandidateRanker.js';

// ── Phase 3: Zod Schemas ───────────────────────────────────────────────────────
export {
  CoaAccountCandidateSchema,
  HistoricalCoaMappingSchema,
  CoaPredictionPolicySchema,
  CoaPredictionInputSchema,
  CoaPredictionAlternativeSchema,
  CoaPredictionResultSchema,
} from './coaPredictionSchema.js';
export type {
  CoaAccountCandidateValidated,
  HistoricalCoaMappingValidated,
  CoaPredictionPolicyValidated,
  CoaPredictionInputValidated,
  CoaPredictionAlternativeValidated,
  CoaPredictionResultValidated,
} from './coaPredictionSchema.js';

// ── Phase 3: COA Prediction Engine ────────────────────────────────────────────
export {
  predictCoa,
  predictCoaBatch,
} from './coaPredictionEngine.js';

// ── Phase 4: Explainability & Confidence Engine — Types ───────────────────────
export type {
  ExplainabilityInput,
  ExplainabilityResult,
  ExplainabilityConfidence,
  ExplainabilityRecommendation,
  ExplainabilityEvidence,
  ConfidenceBreakdownItem,
  AmbiguityFlag,
  ConfidenceLevel,
  RecommendationStatus,
  EvidenceType,
  BreakdownDimension,
  AmbiguityType,
} from './explainabilityTypes.js';

// ── Phase 4: Explainability — Zod Schemas ────────────────────────────────────
export {
  ConfidenceLevelSchema,
  ExplainabilityConfidenceSchema,
  RecommendationStatusSchema,
  ExplainabilityRecommendationSchema,
  EvidenceTypeSchema as ExplainabilityEvidenceTypeSchema,
  ExplainabilityEvidenceSchema,
  BreakdownDimensionSchema,
  ConfidenceBreakdownItemSchema,
  AmbiguityTypeSchema,
  AmbiguityFlagSchema,
  ExplainabilityResultSchema,
} from './explainabilitySchema.js';
export type { ExplainabilityResultValidated } from './explainabilitySchema.js';

// ── Phase 4: Evidence Builder ─────────────────────────────────────────────────
export { buildExplainabilityEvidence } from './explainabilityEvidence.js';

// ── Phase 4: Confidence Breakdown ────────────────────────────────────────────
export {
  CONFIDENCE_LEVEL_THRESHOLDS,
  toConfidenceLevel,
  normalizeConfidence,
  buildConfidenceBreakdown,
  computeExplainabilityConfidence,
} from './confidenceBreakdown.js';

// ── Phase 4: Audit Reason Builder ────────────────────────────────────────────
export {
  detectAmbiguity,
  buildAccountingWarnings,
  buildAuditSummary,
  buildReviewerNotes,
} from './auditReasonBuilder.js';

// ── Phase 4: Recommendation Summary ──────────────────────────────────────────
export {
  RECOMMENDATION_THRESHOLDS,
  determineRecommendationStatus,
  buildRecommendationSummary,
} from './recommendationSummary.js';

// ── Phase 4: Explainability Engine ───────────────────────────────────────────
export {
  explainTransaction,
  explainTransactionBatch,
} from './explainabilityEngine.js';

// ── Phase 5: Learning & Feedback Engine — Types ───────────────────────────────
export type {
  FeedbackRecord,
  CorrectionRecord,
  HistoricalStatistics,
  ExistingRuleEntry,
  ExistingDictionaryEntry,
  LearningSignal,
  LearningEngineOutput,
  LearningEngineInput,
} from './learningEngineTypes.js';

// ── Phase 5: Zod Schemas ──────────────────────────────────────────────────────
export {
  FeedbackRecordSchema,
  CorrectionRecordSchema,
  LearningSignalSchema,
  LearningEngineInputSchema,
} from './learningEngineSchema.js';
export type {
  FeedbackRecordValidated,
  CorrectionRecordValidated,
  LearningSignalValidated,
  LearningEngineInputValidated,
} from './learningEngineSchema.js';

// ── Phase 5: Learning Engine ──────────────────────────────────────────────────
export {
  runLearningEngine,
  runLearningEngineBatch,
} from './learningEngine.js';

// ── Phase 6: Adaptive Rule Recommendation Engine — Types ──────────────────────
export type {
  RuleRiskLevel,
  RulePriority,
  RecommendedRule,
  RecommendedDictionaryEntry,
  RecommendedThresholdChange,
  RecommendedCounterpartyMapping,
  SimulationResult as AdaptiveSimulationResult,
  ImpactAnalysis,
  RuleConflictType,
  RuleConflict,
  FeedbackCluster,
  RulePackageType,
  RulePackage,
  AdaptiveRuleEngineInput,
  AdaptiveRuleRecommendationResult,
} from './adaptiveRuleTypes.js';

// ── Phase 6: Zod Schemas ─────────────────────────────────────────────────────
export {
  RuleRiskLevelSchema,
  RulePrioritySchema,
  RulePackageTypeSchema,
  RuleConflictTypeSchema,
  RecommendedRuleSchema,
  RecommendedDictionaryEntrySchema,
  RecommendedThresholdChangeSchema,
  RecommendedCounterpartyMappingSchema,
  SimulationResultSchema as AdaptiveSimulationResultSchema,
  RuleConflictSchema,
  AdaptiveRuleEngineInputSchema,
} from './adaptiveRuleSchema.js';
export type {
  RecommendedRuleValidated,
  RecommendedDictionaryEntryValidated,
  RecommendedThresholdChangeValidated,
  RecommendedCounterpartyMappingValidated,
  SimulationResultValidated as AdaptiveSimulationResultValidated,
  RuleConflictValidated,
} from './adaptiveRuleSchema.js';

// ── Phase 6: Rule Clusterer ───────────────────────────────────────────────────
export {
  clusterByIntent,
  clusterByCounterparty,
  clusterByNormalizedDescription,
  clusterByCoa,
  clusterByCompany,
  clusterByKeyword,
  clusterByTransactionCode,
  clusterAllDimensions,
} from './ruleClusterer.js';

// ── Phase 6: Conflict Detector ────────────────────────────────────────────────
export {
  detectRuleVsExisting,
  detectDictionaryConflicts,
  detectCounterpartyConflicts,
  detectThresholdConflicts,
  detectIntraRecommendationConflicts,
  detectAllConflicts,
} from './ruleConflictDetector.js';
export type { ConflictDetectionInput } from './ruleConflictDetector.js';

// ── Phase 6: Risk Analyzer ────────────────────────────────────────────────────
export {
  computeRiskScore,
  scoreToRiskLevel,
  analyzeRisk,
  aggregateRiskLevels,
  riskLevelValue,
} from './ruleRiskAnalyzer.js';
export type { RiskInput } from './ruleRiskAnalyzer.js';

// ── Phase 6: Priority ────────────────────────────────────────────────────────
export {
  computePriorityScore,
  scoreToPriority,
  computePriority,
  aggregatePriorities,
  priorityValue,
} from './rulePriority.js';
export type { PriorityInput } from './rulePriority.js';

// ── Phase 6: Simulation ──────────────────────────────────────────────────────
export {
  simulateRecommendations,
  generateSyntheticTransactions,
} from './ruleSimulation.js';
export type { SimTransaction } from './ruleSimulation.js';

// ── Phase 6: Impact Estimator ────────────────────────────────────────────────
export { estimateImpact } from './ruleImpactEstimator.js';
export type { ImpactEstimatorInput } from './ruleImpactEstimator.js';

// ── Phase 6: Package Builder ──────────────────────────────────────────────────
export {
  buildRulePackage,
  buildDictionaryPackage,
  buildCounterpartyPackage,
  buildThresholdPackage,
  buildAllPackages,
} from './rulePackageBuilder.js';
export type { PackageBuilderInput } from './rulePackageBuilder.js';

// ── Phase 6: Adaptive Rule Engine ────────────────────────────────────────────
export {
  runAdaptiveRuleEngine,
  runAdaptiveRuleEngineBatch,
} from './adaptiveRuleEngine.js';

// ── Phase 7: Anomaly Detection Engine — Types ────────────────────────────────
export type {
  AnomalyType,
  AnomalySeverity,
  AnomalyRiskLevel,
  AnomalyRecommendationAction,
  BaselineQuality,
  AnomalyEvidence,
  AnomalyDetection,
  HistoricalTransactionRecord,
  CompanyAnomalyBaseline,
  AnomalyDetectionPolicy,
  AnomalyDetectionInput,
  AnomalyDetectionDependencies,
  AnomalyDetectionResult,
} from './anomalyTypes.js';

// ── Phase 7: Anomaly Rules & Utilities ───────────────────────────────────────
export {
  DEFAULT_ANOMALY_POLICY,
  mergePolicy as mergeAnomalyPolicy,
  isGenericCounterparty,
  isArCoaCode,
  isApCoaCode,
  isRevenueCoaCode,
  isExpenseCoaCode,
  isPayrollCoaCode,
  isTaxCoaCode,
  parseDate,
  minutesBetween,
  hoursBetween,
  descriptionSimilarity,
  redactAccountNumber,
} from './anomalyRules.js';

// ── Phase 7: Baseline Builder ─────────────────────────────────────────────────
export {
  buildAnomalyBaseline,
  computeBaselineQuality,
} from './anomalyBaseline.js';

// ── Phase 7: Scoring ──────────────────────────────────────────────────────────
export {
  combineScores,
  scoreToRiskLevel as anomalyScoreToRiskLevel,
  scoreToRecommendation,
  computeDetectionConfidence,
  aggregateAnomalyTypes,
  ANOMALY_BASE_WEIGHTS,
} from './anomalyScoring.js';

// ── Phase 7: Zod Schemas ──────────────────────────────────────────────────────
export {
  AnomalyTypeSchema,
  AnomalySeveritySchema,
  AnomalyRiskLevelSchema,
  AnomalyRecommendationSchema,
  BaselineQualitySchema,
  AnomalyEvidenceSchema,
  AnomalyDetectionSchema,
  CompanyAnomalyBaselineSchema,
  AnomalyDetectionResultSchema,
} from './anomalySchema.js';
export type {
  AnomalyDetectionResultValidated,
} from './anomalySchema.js';

// ── Phase 7: Amount Detector ──────────────────────────────────────────────────
export { detectAmountAnomaly, detectRoundAmountPattern } from './amountAnomalyDetector.js';
export type { AmountDetectorInput } from './amountAnomalyDetector.js';

// ── Phase 7: Frequency Detector ───────────────────────────────────────────────
export { detectFrequencyAnomaly } from './frequencyAnomalyDetector.js';
export type { FrequencyDetectorInput } from './frequencyAnomalyDetector.js';

// ── Phase 7: Duplicate Detector ───────────────────────────────────────────────
export { detectDuplicateAnomaly } from './duplicateAnomalyDetector.js';
export type { DuplicateDetectorInput } from './duplicateAnomalyDetector.js';

// ── Phase 7: Counterparty Detector ────────────────────────────────────────────
export { detectCounterpartyAnomaly } from './counterpartyAnomalyDetector.js';
export type { CounterpartyDetectorInput } from './counterpartyAnomalyDetector.js';

// ── Phase 7: Timing Detector ──────────────────────────────────────────────────
export { detectTimingAnomaly } from './timingAnomalyDetector.js';
export type { TimingDetectorInput } from './timingAnomalyDetector.js';

// ── Phase 7: COA Detector ─────────────────────────────────────────────────────
export { detectCoaAnomaly } from './coaAnomalyDetector.js';
export type { CoaDetectorInput } from './coaAnomalyDetector.js';

// ── Phase 7: Split Transaction Detector ──────────────────────────────────────
export { detectSplitTransaction } from './splitTransactionDetector.js';
export type { SplitTransactionDetectorInput } from './splitTransactionDetector.js';

// ── Phase 7: Cross-Company Detector ──────────────────────────────────────────
export { detectCrossCompanyAnomaly } from './crossCompanyAnomalyDetector.js';
export type { CrossCompanyDetectorInput } from './crossCompanyAnomalyDetector.js';

// ── Phase 7: Explanation Builder ──────────────────────────────────────────────
export {
  buildExplanations,
  buildConflictFlags,
  buildRapidReversalDetection,
} from './anomalyExplanation.js';

// ── Phase 7: Recommendation Builder ──────────────────────────────────────────
export {
  buildRecommendation,
  computeRequiresManualReview,
} from './anomalyRecommendation.js';
export type { RecommendationInput } from './anomalyRecommendation.js';

// ── Phase 7: Anomaly Detection Engine ────────────────────────────────────────
export {
  detectTransactionAnomalies,
  detectTransactionAnomaliesBatch,
  evaluateAnomalyDetectors,
} from './anomalyEngine.js';

// ── Phase 8: Review Orchestration & Observability — Types ────────────────────
export type {
  ReviewQueue,
  ReviewPriority,
  ReviewStatus,
  ReviewDecisionType,
  ReviewAuditEventType,
  ReviewOrchestrationPolicy,
  ReviewOrchestrationInput,
  TransactionSnapshot,
  AISnapshot,
  SelectedCoa,
  ReviewerDecisionInput,
  ReviewerDecisionRecord,
  ReviewSla,
  ReviewerAssignment,
  ReviewAuditEvent,
  AIReviewCase,
  ReviewOrchestrationDependencies,
  AIReviewCaseRepository,
  TopCoaCorrection,
  TopConflictFlag,
  ReviewObservabilityReport,
} from './reviewOrchestrationTypes.js';

// ── Phase 8: Zod Schemas ──────────────────────────────────────────────────────
export {
  ReviewQueueSchema,
  ReviewPrioritySchema,
  ReviewStatusSchema,
  ReviewDecisionTypeSchema,
  ReviewOrchestrationPolicySchema,
  SelectedCoaSchema,
  ReviewerDecisionInputSchema,
  ReviewSlaSchema,
  AISnapshotCoaSchema,
  AISnapshotSchema,
  TransactionSnapshotSchema,
  ReviewerDecisionRecordSchema,
  AIReviewCaseSchema,
} from './reviewOrchestrationSchema.js';
export type {
  ReviewerDecisionInputValidated,
  AIReviewCaseValidated,
} from './reviewOrchestrationSchema.js';

// ── Phase 8: Case Builder ─────────────────────────────────────────────────────
export {
  DEFAULT_REVIEW_POLICY,
  mergeReviewPolicy,
  buildReviewCase,
} from './reviewCaseBuilder.js';

// ── Phase 8: Queue Router ─────────────────────────────────────────────────────
export { routeReviewCase } from './reviewQueueRouter.js';

// ── Phase 8: Priority Engine ──────────────────────────────────────────────────
export { calculateReviewPriority } from './reviewPriorityEngine.js';
export type { PriorityInput as ReviewPriorityInput } from './reviewPriorityEngine.js';

// ── Phase 8: State Machine ────────────────────────────────────────────────────
export {
  VALID_TRANSITIONS,
  TERMINAL_STATUSES,
  isValidTransition,
  isTerminalStatus,
  InvalidStateTransitionError,
  transitionReviewCase,
  decisionToStatus,
} from './reviewStateMachine.js';

// ── Phase 8: Snapshot Builder ─────────────────────────────────────────────────
export {
  SNAPSHOT_VERSION,
  ORCHESTRATION_VERSION,
  buildTransactionSnapshot,
  buildAISnapshot,
  buildReviewSnapshot,
} from './reviewSnapshotBuilder.js';

// ── Phase 8: SLA Calculator ───────────────────────────────────────────────────
export {
  DEFAULT_SLA_MINUTES,
  getSlaTargetMinutes,
  calculateReviewSla,
} from './reviewSlaCalculator.js';

// ── Phase 8: Decision Service ─────────────────────────────────────────────────
export {
  ReviewDecisionValidationError,
  recordReviewerDecision,
} from './reviewDecisionService.js';

// ── Phase 8: Observability ────────────────────────────────────────────────────
export { calculateReviewObservability } from './reviewObservability.js';

// ── Phase 8: Audit Timeline ───────────────────────────────────────────────────
export {
  buildCaseCreatedEvent,
  buildQueuedEvent,
  buildAssignedEvent,
  buildDecisionAuditEvent,
  buildReviewAuditTimeline,
} from './reviewAuditTimeline.js';

// ── Phase 8: Privacy ──────────────────────────────────────────────────────────
export {
  maskAccountNumber,
  redactSensitiveMetadata,
  sanitizeMetadata,
} from './reviewPrivacy.js';

// ── Phase 8: Idempotency ──────────────────────────────────────────────────────
export {
  buildReviewCaseIdempotencyKey,
  buildReviewerDecisionIdempotencyKey,
  generateCaseId,
  generateAuditEventId,
  generateDecisionId,
} from './reviewIdempotency.js';

// ── Phase 8: Orchestration Engine ─────────────────────────────────────────────
export {
  createAIReviewCase,
  createAIReviewCaseBatch,
  routeReviewCasePublic,
  calculateReviewPriorityPublic,
  transitionReviewCasePublic,
  recordReviewerDecisionPublic,
  buildReviewSnapshotPublic,
  buildReviewAuditTimelinePublic,
  calculateReviewObservabilityPublic,
  calculateReviewSlaPublic,
} from './reviewOrchestrationEngine.js';

// ── Phase 9: Decision Policy Engine — Types ───────────────────────────────────
export type {
  ReviewLevel,
  EscalationLevel,
  ApprovalLevel,
  ReviewerRole,
  OverrideDimension,
  DecisionPolicyOverride,
  DecisionPolicyConfig,
  DecisionPolicyInput,
  PolicySlaDecision,
  PolicyEscalationDecision,
  PolicyApprovalDecision,
  PolicyHoldDecision,
  FiredRule,
  AppliedOverride,
  DecisionPolicyResult,
  DecisionPolicyDependencies,
  SimulationScenario,
  SimulationDelta,
  SimulationResult,
  DecisionPolicyAuditRecord,
} from './decisionPolicyTypes.js';

// ── Phase 9: Zod Schemas ──────────────────────────────────────────────────────
export {
  ReviewLevelSchema,
  EscalationLevelSchema,
  ApprovalLevelSchema,
  ReviewerRoleSchema,
  OverrideDimensionSchema,
  DecisionPolicyOverrideSchema,
  DecisionPolicyConfigSchema,
  PolicySlaDecisionSchema,
  PolicyEscalationDecisionSchema,
  PolicyApprovalDecisionSchema,
  PolicyHoldDecisionSchema,
  FiredRuleSchema,
  AppliedOverrideSchema,
  DecisionPolicyResultSchema,
  SimulationDeltaSchema,
  SimulationResultSchema,
} from './decisionPolicySchema.js';
export type {
  DecisionPolicyResultValidated,
  DecisionPolicyOverrideValidated,
  DecisionPolicyConfigValidated,
  SimulationResultValidated,
} from './decisionPolicySchema.js';

// ── Phase 9: Rules ────────────────────────────────────────────────────────────
export {
  buildDefaultAccumulator,
  applyIntentRules,
  applyConfidenceRules,
  applyAnomalyRules,
  applyAmountRules,
  applyFlagRules,
  applyCoaRules,
  applyCounterpartyRules,
  applyRiskPriorityRules,
  applyQueueFallback,
  applyReviewerFallback,
  DEFAULT_AUTO_CONFIDENCE,
  DEFAULT_ANOMALY_REVIEW_THRESHOLD,
  DEFAULT_ANOMALY_ESCALATION_THRESHOLD,
  DEFAULT_HIGH_VALUE,
  DEFAULT_CRITICAL_VALUE,
  DEFAULT_ESCALATION_VALUE,
  INTENT_QUEUE_MAP,
  INTENT_REVIEWER_MAP,
  HIGH_RISK_INTENTS,
} from './decisionPolicyRules.js';

// ── Phase 9: Priority ─────────────────────────────────────────────────────────
export {
  priorityIndex,
  maxPriority,
  computePolicyPriority,
  priorityToUrgencyLabel,
} from './decisionPolicyPriority.js';

// ── Phase 9: Queue ────────────────────────────────────────────────────────────
export {
  moreSpecificQueue,
  intentToQueue,
  resolveQueue,
} from './decisionPolicyQueue.js';

// ── Phase 9: Escalation ───────────────────────────────────────────────────────
export {
  escalationIndex,
  maxEscalationLevel,
  computeEscalation,
} from './decisionPolicyEscalation.js';

// ── Phase 9: Reviewer ─────────────────────────────────────────────────────────
export {
  resolveReviewerRole,
  approvalLevelToReviewLevel,
} from './decisionPolicyReviewer.js';

// ── Phase 9: SLA ──────────────────────────────────────────────────────────────
export {
  DEFAULT_POLICY_SLA_MINUTES,
  resolveSlaMinutes,
  buildPolicySla,
} from './decisionPolicySla.js';

// ── Phase 9: Overrides ────────────────────────────────────────────────────────
export {
  applyOverrides,
  mergeOverrides,
} from './decisionPolicyOverrides.js';

// ── Phase 9: Simulation ───────────────────────────────────────────────────────
export {
  simulateScenario,
  runPolicySimulation,
} from './decisionPolicySimulation.js';
export type { PolicySimulationInput, PolicySimulationReport } from './decisionPolicySimulation.js';

// ── Phase 9: Audit ────────────────────────────────────────────────────────────
export {
  buildDecisionAuditRecord,
  formatAuditSummary,
  verifyAuditCompleteness,
} from './decisionPolicyAudit.js';
export type { AuditVerificationResult } from './decisionPolicyAudit.js';

// ── Phase 9: Decision Policy Engine ──────────────────────────────────────────
export {
  DECISION_POLICY_ENGINE_VERSION,
  DEFAULT_POLICY_VERSION,
  mergeDecisionPolicyConfig,
  evaluateDecisionPolicy,
  evaluateDecisionPolicyBatch,
} from './decisionPolicyEngine.js';

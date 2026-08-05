# AI Transaction Intelligence — Phase 6
# Adaptive Rule Recommendation Engine

## Overview

The Adaptive Rule Recommendation Engine is a **read-only recommendation system** that transforms learning signals (Phase 5) into structured, admin-reviewable change proposals.

**It NEVER:**
- Modifies the transaction dictionary
- Changes scoring or ranking logic
- Alters thresholds or production rules
- Writes to the database
- Auto-applies, auto-merges, or auto-approves any change

**It ONLY:**
- Analyses patterns in historical feedback
- Generates candidate rule, dictionary, counterparty, and threshold recommendations
- Simulates the impact of applying those recommendations (dry-run)
- Packages recommendations for human administrator review

---

## Architecture

```
Phase 5 (Learning Engine)
  └─ LearningEngineOutput
        │
        ▼
Phase 6 (Adaptive Rule Engine)
  ├─ ruleClusterer        → FeedbackCluster[]
  ├─ adaptiveRuleEngine   → generates RecommendedRule[], RecommendedDictionaryEntry[],
  │                          RecommendedCounterpartyMapping[], RecommendedThresholdChange[]
  ├─ ruleConflictDetector → RuleConflict[]
  ├─ ruleRiskAnalyzer     → RuleRiskLevel per recommendation
  ├─ rulePriority         → RulePriority per recommendation
  ├─ ruleSimulation       → SimulationResult (dry-run, never applies)
  ├─ ruleImpactEstimator  → ImpactAnalysis
  └─ rulePackageBuilder   → RulePackage[] (grouped for admin review)
        │
        ▼
AdaptiveRuleRecommendationResult
  (requiresHumanApproval: true on all entries)
```

---

## New Files (Phase 6)

| File | Purpose |
|------|---------|
| `adaptiveRuleTypes.ts` | All Phase 6 types and interfaces |
| `adaptiveRuleSchema.ts` | Zod validation schemas |
| `adaptiveRuleEngine.ts` | Main orchestration engine |
| `ruleClusterer.ts` | Clusters feedback signals by 7 dimensions |
| `ruleConflictDetector.ts` | Detects 7 conflict types |
| `ruleSimulation.ts` | Dry-run simulation (dryRun: true always) |
| `rulePriority.ts` | Computes LOW/NORMAL/HIGH/URGENT priority |
| `rulePackageBuilder.ts` | Groups recs into 4 package types |
| `ruleRiskAnalyzer.ts` | Computes LOW/MEDIUM/HIGH/CRITICAL risk |
| `ruleImpactEstimator.ts` | Estimates precision gain, review reduction |

---

## Phase 5 Files (Learning Engine — prerequisite)

| File | Purpose |
|------|---------|
| `learningEngineTypes.ts` | FeedbackRecord, LearningSignal, LearningEngineOutput |
| `learningEngineSchema.ts` | Zod schemas for Phase 5 types |
| `learningEngine.ts` | Pure learning engine — signals from feedback |

---

## Input

```typescript
interface AdaptiveRuleEngineInput {
  learningOutput: LearningEngineOutput;   // from Phase 5
  existingRules?: ExistingRuleEntry[];    // for conflict detection
  existingDictionary?: ExistingDictionaryEntry[];
  companyId: string | number;
  simulationTransactions?: SimTransaction[];  // optional sample
  minRecommendationConfidence?: number;   // default 0.5
  maxRecommendations?: number;            // default 50
}
```

---

## Output

```typescript
interface AdaptiveRuleRecommendationResult {
  recommendedRules: RecommendedRule[];
  recommendedDictionaryEntries: RecommendedDictionaryEntry[];
  recommendedThresholdChanges: RecommendedThresholdChange[];
  recommendedCounterpartyMappings: RecommendedCounterpartyMapping[];
  simulationResult: SimulationResult;     // dryRun: true always
  impactAnalysis: ImpactAnalysis;
  riskLevel: RuleRiskLevel;
  priority: RulePriority;
  requiresHumanApproval: true;           // invariant
  conflicts: RuleConflict[];
  clusters: FeedbackCluster[];
  packages: RulePackage[];
  summary: string;
  version: '6.0';
}
```

---

## Rule Clustering

Feedback signals are clustered along 7 dimensions:

| Dimension | ClusterType |
|-----------|-------------|
| Intent | `INTENT` |
| Counterparty name | `COUNTERPARTY` |
| Normalized description | `NORMALIZED_DESCRIPTION` |
| COA code | `COA` |
| Company | `COMPANY` |
| Keyword | `KEYWORD` |
| Transaction code | `TRANSACTION_CODE` |

---

## Rule Suggestion Logic

Example pattern detected:

```
"biaya admin" → appeared 540 times → 96% consistency → always COA 5-1100
  ↓
recommend:
  • Add keyword "admin" (KEYWORD rule, weight 1.5)
  • Add alias "administrasi" (ALIAS via DICTIONARY_PACKAGE)
  • Add intent-COA mapping BANK_ADMIN_FEE → 5-1100
```

---

## Conflict Detection

7 conflict types are detected:

| Type | Description |
|------|-------------|
| `DUPLICATE_RULE` | Same keyword + same intent already exists |
| `CONTRADICTING_RULE` | Same keyword maps to different intent |
| `COMPANY_CONFLICT` | Global rec conflicts with company-scoped rule |
| `DICTIONARY_CONFLICT` | Keyword already in dictionary (same or different intent) |
| `COUNTERPARTY_CONFLICT` | Counterparty pattern already mapped |
| `THRESHOLD_CONFLICT` | Two recs suggest different values for same parameter |
| `KEYWORD_OVERLAP` | New keyword is substring of existing |

---

## Risk Levels

| Level | Criteria |
|-------|----------|
| `LOW` | High confidence, high consistency, few conflicts, company-scoped |
| `MEDIUM` | Moderate confidence or consistency, some conflicts |
| `HIGH` | Low confidence, many conflicts, threshold or new-COA change |
| `CRITICAL` | Very low confidence, very low consistency, threshold change with high magnitude |

---

## Priority Levels

| Level | Criteria |
|-------|----------|
| `LOW` | Few occurrences, low gain, many conflicts |
| `NORMAL` | Moderate occurrences, some gain |
| `HIGH` | Many occurrences, significant precision or review gain |
| `URGENT` | High volume + high gain + problematic pattern |

---

## Recommendation Packages

Recommendations are grouped into 4 package types for admin review:

| Package | Contents |
|---------|---------|
| `RULE_PACKAGE` | Keyword, alias, and intent-COA mapping rules |
| `DICTIONARY_PACKAGE` | New dictionary keywords and aliases |
| `COUNTERPARTY_PACKAGE` | Counterparty → intent/COA mappings |
| `THRESHOLD_PACKAGE` | Scoring threshold parameter changes |

---

## Simulation

The simulation runs a dry-run over a transaction sample (real or synthetic):

```typescript
interface SimulationResult {
  totalTransactions: number;
  affectedTransactions: number;
  improvedTransactions: number;
  worsenedTransactions: number;
  precisionDelta: number;       // positive = better
  manualReviewDelta: number;    // negative = fewer reviews
  dryRun: true;                 // ALWAYS true
  simulationConfidence: number;
}
```

**The simulation NEVER applies any changes.**

---

## Public API

```typescript
import {
  // Phase 5
  runLearningEngine, runLearningEngineBatch,
  // Phase 6
  runAdaptiveRuleEngine, runAdaptiveRuleEngineBatch,
  clusterAllDimensions,
  detectAllConflicts,
  analyzeRisk, aggregateRiskLevels,
  computePriority, aggregatePriorities,
  simulateRecommendations,
  estimateImpact,
  buildAllPackages,
} from '.../transaction-intelligence/index.js';
```

---

## Limitations

1. **No LLM / embedding**: All signal extraction is statistical (occurrence counting, consistency rate). No semantic similarity matching.
2. **No real-time DB access**: Engine is pure — callers must supply historical feedback arrays.
3. **Synthetic simulation**: When no real transaction sample is provided, simulation uses generated data — estimates may differ from production.
4. **Threshold recommendations are conservative**: Only 2 threshold parameters are currently modelled.
5. **Alias extraction is token-based**: Alias suggestions come from co-occurring tokens in the normalized description, not semantic synonyms.

---

## Future Roadmap

- Phase 7: Auto-staging pipeline (admin approves a package → staged to shadow mode for A/B testing)
- Embedding-based similarity for more accurate pattern clustering
- Multi-company aggregate signals (cross-company keyword learning)
- Incremental learning (stream processing rather than batch)
- Explanation quality scoring per recommendation

# AI Transaction Intelligence — Phase 5: Learning & Feedback Engine

## Overview

Phase 5 is the **Learning & Feedback Engine** for the AI Transaction Intelligence system. It extends Phases 1–4 (Transaction Understanding, Intent Classification, COA Prediction, Explainability) with a read-only learning layer that:

- Records human reviewer decisions
- Detects feedback patterns and conflicts
- Computes reliability metrics
- Suggests rule and dictionary improvements
- Never applies changes automatically

## Safety Contract

**The engine NEVER:**
- Auto-trains models
- Auto-updates dictionaries
- Auto-updates scoring or thresholds
- Auto-updates COA assignments
- Auto-approves transactions
- Auto-posts journal entries
- Writes to the database directly

**All changes are RECOMMENDATIONS requiring human approval.**

## Architecture

```
Phase 1 (Understanding) ─┐
Phase 2 (Classification) ─┤
Phase 3 (COA Prediction) ─┤──► LearningEngine ──► LearningOutput
Phase 4 (Explainability) ─┘         │
                                     ├── FeedbackAnalyzer
Reviewer Decision ──────────────────►├── FeedbackReliability
Historical Feedback ────────────────►├── LearningStatistics
                                     ├── RuleSuggestionBuilder
                                     ├── FeedbackConflictDetector
                                     └── LearningRecommendation
```

## New Files

| File | Purpose |
|---|---|
| `learningTypes.ts` | Core TypeScript types for Phase 5 |
| `learningSchema.ts` | Zod validation schemas |
| `learningEngine.ts` | Main orchestrator — `runLearningEngine()` |
| `feedbackAnalyzer.ts` | Feedback summary, reviewer agreement |
| `feedbackReliability.ts` | Composite reliability score |
| `learningStatistics.ts` | Aggregate statistics across feedback |
| `learningRecommendation.ts` | Learning status + top-line recommendation |
| `ruleSuggestionBuilder.ts` | Rule and dictionary term suggestions |
| `feedbackConflictDetector.ts` | Conflict detection across reviewers |

## Updated Files

| File | Change |
|---|---|
| `index.ts` | Added Phase 5 barrel exports |

## Public API

### `runLearningEngine(input: LearningInput): LearningOutput`

Main entry point. Runs all Phase 5 sub-modules and returns a `LearningOutput`.

```typescript
import { runLearningEngine } from './transaction-intelligence/index.js';

const output = runLearningEngine({
  phase1,              // TransactionAnalysisResult
  phase2,              // IntentClassificationResult
  phase3,              // CoaPredictionResult
  phase4,              // ExplainabilityResult
  reviewerDecision: 'APPROVED',
  companyId: 'comp-1',
  reviewerId: 'user-123',
  reviewedAt: new Date().toISOString(),
  historicalFeedback: [],
});

console.log(output.learningStatus);   // 'COLLECTING'
console.log(output.learningScore);    // 0.0–1.0
console.log(output.requiresHumanApproval); // always true when rules suggested
```

### `runLearningEngineBatch(inputs: LearningInput[]): LearningOutput[]`

Processes multiple inputs independently. Useful for bulk analytics.

## Input

### `LearningInput`

| Field | Required | Description |
|---|---|---|
| `phase1` | ✅ | `TransactionAnalysisResult` from Phase 1 |
| `phase2` | ✅ | `IntentClassificationResult` from Phase 2 |
| `phase3` | ✅ | `CoaPredictionResult` from Phase 3 |
| `phase4` | ✅ | `ExplainabilityResult` from Phase 4 |
| `reviewerDecision` | ✅ | `APPROVED \| CHANGED_COA \| REJECTED \| SKIPPED \| UNKNOWN` |
| `companyId` | ✅ | Company identifier |
| `historicalFeedback` | optional | Prior `FeedbackRecord[]` for same pattern |
| `reviewerSelectedCoaCode` | optional | Required when `CHANGED_COA` |
| `reviewerId` | optional | Reviewer identity |
| `reviewerConfidence` | optional | 0.00–1.00 |
| `reviewedAt` | optional | ISO 8601 timestamp |
| `presentedAt` | optional | ISO 8601 timestamp for turnaround calculation |

## Output

### `LearningOutput`

| Field | Type | Description |
|---|---|---|
| `learningStatus` | `LearningStatus` | Current engine state |
| `recommendation` | `LearningRecommendation` | Top-line action recommendation |
| `feedbackSummary` | `FeedbackSummary` | Aggregated decision counts and rates |
| `reliability` | `FeedbackReliability` | Composite reliability (0.00–1.00) |
| `suggestedRules` | `SuggestedRule[]` | Rule candidates (require approval) |
| `suggestedDictionaryTerms` | `SuggestedDictionaryTerm[]` | Dictionary candidates (require approval) |
| `statistics` | `LearningStatistics` | Aggregate stats across all feedback |
| `learningScore` | `number` | Quality score 0.00–1.00 |
| `evidence` | `LearningEvidence[]` | Supporting evidence items |
| `reviewerAgreement` | `number` | Fraction of reviewers agreeing with AI |
| `requiresHumanApproval` | `boolean` | Always true when suggestions exist |
| `conflicts` | `FeedbackConflict[]` | Detected contradictions |
| `learningVersion` | `'1.0'` | Engine version |

## Learning Workflow

```
1. Reviewer makes decision on AI-recommended COA
2. Decision + Phase 1–4 results submitted to runLearningEngine()
3. Engine builds FeedbackRecord for current decision
4. Engine aggregates current + historical records
5. FeedbackAnalyzer computes summary + agreement
6. FeedbackReliability scores the evidence
7. LearningStatistics aggregates metrics
8. FeedbackConflictDetector finds contradictions
9. RuleSuggestionBuilder derives candidate suggestions
10. LearningRecommendation determines status + top action
11. LearningOutput returned — all read-only
12. Human admin reviews and optionally applies suggestions
```

## Learning Status

| Status | Meaning |
|---|---|
| `NO_ACTION` | Insufficient data (0 records) |
| `COLLECTING` | Accumulating feedback, not ready for action |
| `READY_FOR_RULE` | Enough evidence to suggest a matching rule |
| `READY_FOR_DICTIONARY` | Enough evidence to suggest dictionary terms |
| `READY_FOR_REVIEW` | Conflicts detected — human review required |

## Reviewer Decision Types

| Decision | Meaning |
|---|---|
| `APPROVED` | Reviewer accepted AI recommendation |
| `CHANGED_COA` | Reviewer selected a different COA |
| `REJECTED` | Reviewer rejected the transaction classification |
| `SKIPPED` | Reviewer skipped without deciding |
| `UNKNOWN` | Decision unavailable |

## Reliability Model

The `FeedbackReliability` score (0.00–1.00) is computed from:

| Factor | Weight |
|---|---|
| Reviewer consistency | 25% |
| Historical agreement | 20% |
| COA consistency | 20% |
| Intent consistency | 15% |
| Sample size bonus (log scale) | 10% |
| Counterparty consistency | 10% |

**Cross-company feedback** applies a 0.8× penalty.

**Reliability levels:**

| Level | Score |
|---|---|
| HIGH | ≥ 0.75 |
| MEDIUM | ≥ 0.50 |
| LOW | ≥ 0.30 |
| VERY_LOW | < 0.30 |

## Statistics

The `LearningStatistics` object reports:

- `approvalRate` — fraction of APPROVED decisions
- `manualReviewRate` — fraction requiring human correction
- `changeRate` — fraction where reviewer changed COA
- `topCorrectedIntents` — intents most frequently corrected (top 5)
- `topCorrectedCoa` — AI→reviewer COA correction pairs (top 5)
- `topAmbiguousPatterns` — descriptions most often needing correction (top 5)
- `avgReviewTurnaroundMinutes` — average time from presentation to review
- `feedbackDistribution` — count per `ReviewerDecision`
- `distinctReviewers` — number of unique reviewers
- `distinctCompanies` — number of unique companies

## Rule Suggestions

The engine may suggest:

| Type | Trigger |
|---|---|
| `COUNTERPARTY_MAPPING` | All records share same counterparty + consistent decision |
| `HISTORICAL_MAPPING` | Reviewers consistently correct to same COA for same description |
| `THRESHOLD_CANDIDATE` | High-confidence transactions repeatedly corrected by reviewers |
| `KEYWORD` | Token appears in ≥65% of consistent-decision descriptions |
| `ALIAS` | Token appears in ≥75% of CHANGED_COA descriptions |

**All suggestions have `requiresHumanApproval: true` — structurally enforced.**

## Conflict Detector

| Conflict Type | Trigger |
|---|---|
| `REVIEWER_DISAGREEMENT` | Multiple reviewers made different decisions |
| `COA_DISAGREEMENT` | Reviewers selected different COA codes |
| `INTENT_DISAGREEMENT` | AI recommended different intents across records |
| `COMPANY_MISMATCH` | Feedback spans multiple companies |
| `LOW_CONFIDENCE_PATTERN` | Low-confidence transactions repeatedly approved |
| `HISTORICAL_CONTRADICTION` | Current decision contradicts prior history |

## Integration

### With Phase 1–4

Phase 5 reads Phase 1–4 outputs via the `ExplainabilityInput` structure:

```typescript
// Run Phase 1–4 normally
const phase1 = analyzeTransactionDescription(description);
const phase2 = classifyTransactionIntent({ description, direction });
const phase3 = predictCoa({ transaction: { description, direction }, companyId, availableAccounts });
const phase4 = explainTransaction({ phase1, phase2, phase3 });

// Then add Phase 5 when reviewer makes a decision
const learning = runLearningEngine({
  phase1, phase2, phase3, phase4,
  reviewerDecision,
  companyId,
});
```

### With Historical Feedback Store

The caller is responsible for persisting `FeedbackRecord` objects and retrieving relevant history. Phase 5 never queries a database.

## Benchmark

- **100 transactions**: < 1 second
- **1000 transactions**: < 10 seconds
- **10000 transactions**: < 60 seconds (batch mode)

## Out of Scope

The following are explicitly excluded from Phase 5:

- Auto-retraining of models
- LLM integration
- Vector database lookups
- Auto rule application
- Auto dictionary updates
- Database migration
- UI dashboard
- Workflow approval system
- Journal posting
- Treasury posting

These are Phase 6+ concerns.

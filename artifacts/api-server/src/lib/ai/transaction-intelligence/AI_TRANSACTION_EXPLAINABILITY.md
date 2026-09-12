# AI Transaction Intelligence — Phase 4: Explainability & Confidence Engine

## Overview

Phase 4 adds a pure read-only **Explainability & Confidence Engine** on top of the Phase 1–3 pipeline. It reads Phase 1 (Transaction Understanding), Phase 2 (Intent Classification), and Phase 3 (COA Prediction) outputs and produces a structured explanation of every AI decision — including confidence scoring, evidence breakdown, ambiguity detection, and audit-ready summaries.

**This engine is PURE and READ-ONLY:**
- It does NOT post journal entries.
- It does NOT approve transactions.
- It does NOT modify the database.
- It does NOT re-analyse transactions (reads Phase 1–3 outputs only).
- It does NOT call any external service.

---

## Public API

```typescript
import {
  explainTransaction,
  explainTransactionBatch,
} from '.../transaction-intelligence/index.js';
```

### `explainTransaction(input: ExplainabilityInput): ExplainabilityResult`

Generates the full explainability result for a single transaction.

### `explainTransactionBatch(inputs: ExplainabilityInput[]): ExplainabilityResult[]`

Batch variant — preserves input order, fully synchronous.

---

## Input

```typescript
interface ExplainabilityInput {
  phase1: TransactionAnalysisResult;       // Phase 1 output
  phase2: IntentClassificationResult;      // Phase 2 output
  phase3: CoaPredictionResult;             // Phase 3 output
  rawDescription?: string;                 // Optional: shown in audit summary
}
```

The engine does not re-run Phase 1, 2, or 3. Pass pre-computed outputs.

---

## Output

```typescript
interface ExplainabilityResult {
  confidence: {
    final: number;             // Raw composite (pre-clamp)
    normalized: number;        // Clamped to [0, 1]
    level: ConfidenceLevel;    // VERY_HIGH | HIGH | MEDIUM | LOW | VERY_LOW
  };

  recommendation: {
    status: 'SAFE' | 'MANUAL_REVIEW' | 'REJECT';
    explanation: string;       // Human-readable decision rationale
  };

  evidence: ExplainabilityEvidence[];          // Structured evidence list
  confidenceBreakdown: ConfidenceBreakdownItem[];  // 9 dimensions
  ambiguity: AmbiguityFlag[];                  // Detected ambiguities
  accountingWarnings: string[];                // Finance-specific warnings
  auditSummary: string;                        // Single-sentence audit summary
  reviewerNotes: string[];                     // Notes for human reviewers
  explainabilityVersion: '1.0';
}
```

---

## Confidence Model

### Level Thresholds

| Level     | Threshold  |
|-----------|-----------|
| VERY_HIGH | >= 0.95   |
| HIGH      | >= 0.85   |
| MEDIUM    | >= 0.70   |
| LOW       | >= 0.50   |
| VERY_LOW  | < 0.50    |

### Composite Score Formula

```
final = phase3_confidence × 0.65
      + phase2_confidence × 0.25
      + phase1_confidence × 0.10
      + penalty_adjustments
      + manual_review_adjustments
```

Phase 3 (COA prediction) carries the most weight as it represents the most specific signal.

---

## Evidence Model

Each evidence item has:

| Field                  | Description                                     |
|------------------------|-------------------------------------------------|
| `type`                 | Evidence category (see EvidenceType below)      |
| `source`               | Which phase produced it (PHASE1/PHASE2/PHASE3)  |
| `weight`               | Importance of this evidence (0–1)               |
| `description`          | Human-readable explanation                      |
| `contribution`         | Positive contribution to confidence (0–1)       |
| `confidenceContribution` | Alias for contribution                        |
| `negativeContribution` | Negative drag on confidence (0–1, positive value)|

### Evidence Types

| Type                    | Source  | Description                                      |
|-------------------------|---------|--------------------------------------------------|
| `PHASE1_ANALYSIS`       | PHASE1  | Transaction understanding result                 |
| `KEYWORD_MATCH`         | PHASE1/3| Keyword match from description or account aliases|
| `MANUAL_REVIEW_TRIGGER` | PHASE1/2/3 | Manual review flag from upstream phase        |
| `PHASE2_CLASSIFICATION` | PHASE2  | Intent classification result                     |
| `DIRECTION`             | PHASE2  | Debit/credit direction signal                    |
| `COUNTERPARTY`          | PHASE2/3| Counterparty classification signal               |
| `HISTORICAL_MAPPING`    | PHASE3  | Historical COA mapping evidence                  |
| `INTENT_MATCH`          | PHASE3  | Account keyword alignment with intent            |
| `ACCOUNT_POLICY`        | PHASE3  | Policy preference/restriction signal             |
| `COMPANY_CONTEXT`       | PHASE3  | Company-scoped account filtering                 |
| `PHASE3_PREDICTION`     | PHASE3  | COA prediction summary                           |
| `PENALTY`               | PHASE3  | Conflict flags / penalty signals                 |

---

## Confidence Breakdown (9 Dimensions)

| Dimension             | Weight | What it scores                                   |
|-----------------------|--------|--------------------------------------------------|
| Historical Mapping    | 0.30   | Strength of historical COA mappings              |
| Intent Match          | 0.25   | Phase 1/2 intent agreement and confidence        |
| Keyword Match         | 0.15   | Keyword/alias matches from description and account|
| Counterparty          | 0.20   | Counterparty role classification signal          |
| Direction             | 0.15   | Debit/credit alignment with intent               |
| Account Policy        | 0.10   | Policy preference bonus or type-mismatch penalty |
| Company Context       | 0.05   | Cross-company safety validation                  |
| Penalty               | 0.10   | Conflict flags penalty (negative)                |
| Manual Review Trigger | 0.10   | Manual review flags from all phases (negative)   |

---

## Recommendation Status

| Status          | Condition                                                              |
|-----------------|------------------------------------------------------------------------|
| `SAFE`          | High confidence (≥ 0.75), no ambiguity, no conflict flags, no review  |
| `MANUAL_REVIEW` | Moderate confidence, or ambiguity/conflict flags present              |
| `REJECT`        | No account found, confidence < 0.30, or hard safety violation         |

---

## Ambiguity Detection

The engine detects 9 types of ambiguity from Phase 1–3 conflict flags and evidence signals:

| Ambiguity Type            | Trigger                                                       |
|---------------------------|---------------------------------------------------------------|
| `AR_VS_REVENUE`           | `AR_REVENUE_AMBIGUITY` flag — CUSTOMER_PAYMENT → revenue account |
| `AP_VS_EXPENSE`           | `AP_EXPENSE_AMBIGUITY` flag — VENDOR_PAYMENT → expense account   |
| `INTERNAL_TRANSFER`       | `INTERNAL_TRANSFER_UNVERIFIED` flag                           |
| `UNKNOWN_INTENT`          | `UNKNOWN_INTENT` flag or phase3.intent === 'UNKNOWN'          |
| `MULTIPLE_CLOSE_CANDIDATES`| `MULTIPLE_CLOSE_CANDIDATES` flag                             |
| `WEAK_EVIDENCE`           | No historical, keyword, or counterparty evidence              |
| `CROSS_COMPANY`           | `CROSS_COMPANY_ACCOUNT` flag                                  |
| `INACTIVE_ACCOUNT`        | `INACTIVE_ACCOUNT` flag                                       |
| `NON_POSTABLE_ACCOUNT`    | `NON_POSTABLE_ACCOUNT` flag                                   |

Each ambiguity includes a `description` and `reviewAction` to guide human reviewers.

---

## Audit Summary

The `auditSummary` field is a single human-readable sentence intended for audit logs and ERP journal review screens. Example:

> "AI merekomendasikan akun 1-1100 Piutang Usaha dengan confidence HIGH (0.91). Status: SAFE. Evidence utama berasal dari historical mapping, intent CUSTOMER_PAYMENT, dan counterparty PT ABC. Intent terdeteksi: CUSTOMER_PAYMENT."

When no account can be recommended:
> "AI tidak dapat merekomendasikan akun COA untuk transaksi "..." (intent: UNKNOWN, status: REJECT). Confidence: VERY_LOW (0.12). Diperlukan seleksi akun manual."

---

## New Files (Phase 4)

| File                          | Purpose                                          |
|-------------------------------|--------------------------------------------------|
| `explainabilityTypes.ts`      | All TypeScript types and interfaces              |
| `explainabilitySchema.ts`     | Zod runtime validation schemas                   |
| `explainabilityEngine.ts`     | Main engine: `explainTransaction` / `explainTransactionBatch` |
| `explainabilityEvidence.ts`   | Evidence builder (reads Phase 1/2/3 outputs)     |
| `confidenceBreakdown.ts`      | Confidence breakdown + `toConfidenceLevel()`     |
| `recommendationSummary.ts`    | Recommendation status + explanation builder      |
| `auditReasonBuilder.ts`       | Ambiguity detection, audit summary, reviewer notes|

---

## Baseline Fix (Phase 3)

During Phase 4 baseline validation, two pre-existing failures were found and fixed in `coaPredictionEngine.ts`:

- `AR_REVENUE_AMBIGUITY` and `AP_EXPENSE_AMBIGUITY` flags were not propagating to the engine output when the only available account scored below `minimumConfidence` (due to the ambiguity penalty itself reducing the score). Fixed by adding engine-level ambiguity detection that scans safe input accounts directly, independent of the ranked candidate list.

---

## Performance

| Volume       | Typical Time |
|--------------|-------------|
| 100 tx       | < 5 ms      |
| 1,000 tx     | < 50 ms     |
| 10,000 tx    | < 500 ms    |

The engine is fully synchronous and allocation-efficient.

---

## Version

`explainabilityVersion: "1.0"` — included in every result for forward compatibility.

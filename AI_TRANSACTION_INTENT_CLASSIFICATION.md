# AI Transaction Intelligence — Intent Classification Engine
## Phase 2 Documentation

---

## 1. Objective

Build a deterministic, offline-capable Intent Classification Engine that goes beyond Phase 1 description-only analysis by incorporating **transaction context** — direction, counterparty, transaction code, internal account signals — to produce a more accurate and auditable intent classification.

No external AI providers. No Math.random(). Same input → same output, always.

---

## 2. Architecture

```
TransactionClassificationInput
        │
        ▼
┌─────────────────────────────────┐
│  Phase 1: analyzeTransaction    │  ← transactionUnderstanding.ts
│  (description keyword match)    │
└──────────────┬──────────────────┘
               │  TransactionAnalysisResult
               ▼
┌─────────────────────────────────┐
│  Phase 2: Intent Classifier     │  ← intentClassifier.ts
│  ┌─────────────────────────┐    │
│  │ Direction Rules         │    │  ← intentClassificationRules.ts
│  │ Transaction Code Rules  │    │
│  │ Counterparty Boost      │    │
│  │ Internal Account Check  │    │
│  │ Collision Handling      │    │
│  └─────────────────────────┘    │
│  ┌─────────────────────────┐    │
│  │ Composite Confidence    │    │  ← intentClassificationConfidence.ts
│  │ Model (weighted sum)    │    │
│  └─────────────────────────┘    │
└──────────────┬──────────────────┘
               │  IntentClassificationResult
               ▼
    primaryIntent + confidence
    alternatives + evidence
    reason[] + requiresManualReview
```

**Dependency Injection** — async lookups (DB, cache) are injected via `IntentClassifierDependencies`, keeping the core engine pure.

---

## 3. Input Contract

```typescript
interface TransactionClassificationInput {
  description:         string;               // REQUIRED
  direction?:          'DEBIT' | 'CREDIT' | 'UNKNOWN';
  amount?:             number;
  transactionDate?:    string | Date;
  bankAccountId?:      string | number;
  bankName?:           string;
  counterpartyName?:   string;
  counterpartyAccount?:string;
  referenceNumber?:    string;
  transactionCode?:    string;               // e.g. "RTGS", "BI-FAST"
  currency?:           string;               // ISO 4217
}
```

Only `description` is required. The engine degrades gracefully when context is absent.

---

## 4. Output Contract

```typescript
interface IntentClassificationResult {
  primaryIntent:         TransactionIntent;
  confidence:            number;             // 0.00–1.00
  normalizedDescription: string;
  alternatives:          Array<{ intent: TransactionIntent; confidence: number }>;
  evidence:              IntentClassificationEvidence[];
  reason:                string[];
  phase1Analysis:        TransactionAnalysisResult;
  requiresManualReview:  boolean;
}
```

Example:
```json
{
  "primaryIntent": "VENDOR_PAYMENT",
  "confidence": 0.91,
  "normalizedDescription": "transfer pt abc logistics",
  "alternatives": [
    { "intent": "INTERNAL_TRANSFER", "confidence": 0.42 }
  ],
  "evidence": [
    { "type": "DIRECTION",     "value": "DEBIT",            "weight": 0.20 },
    { "type": "COUNTERPARTY",  "value": "PT ABC LOGISTICS", "weight": 0.20 },
    { "type": "PHASE1_MATCH",  "value": "Phase 1: 74%",     "weight": 0.35 }
  ],
  "reason": [
    "Phase 1 analysis matched intent VENDOR_PAYMENT with 74% confidence.",
    "Transaction direction (DEBIT) is consistent with intent VENDOR_PAYMENT.",
    "Counterparty classified as VENDOR."
  ],
  "requiresManualReview": false
}
```

---

## 5. Classification Flow

```
1. Normalize description (lowercase, strip punctuation, collapse spaces)
2. Run Phase 1 keyword matching → TransactionAnalysisResult
3. Resolve async dependencies (isInternalAccount, classifyCounterparty) if provided
4. For every classifiable intent, compute CompositeScore:
     score = Σ(weight_i × signal_i)
5. Sort candidates descending by composite score
6. Select primary intent (highest composite score, or UNKNOWN if all = 0)
7. Deduplicate alternatives (exclude primary, cap at 4)
8. Evaluate requiresManualReview based on confidence, gap, conflict, collision
9. Build evidence list and reason array
10. Return IntentClassificationResult
```

---

## 6. Direction-Aware Classification

| Intent             | Natural Direction | Notes                            |
|--------------------|:-----------------:|----------------------------------|
| BANK_ADMIN_FEE     | DEBIT             | Bank debits fee                  |
| TRANSFER_FEE       | DEBIT             | Bank debits transfer fee         |
| INTEREST_INCOME    | CREDIT            | Bank credits interest            |
| CUSTOMER_PAYMENT   | CREDIT            | Money comes IN                   |
| VENDOR_PAYMENT     | DEBIT             | Money goes OUT                   |
| PAYROLL            | DEBIT             | Salary outflow                   |
| LOAN_PAYMENT       | DEBIT             | Repayment outflow                |
| TAX_PAYMENT        | DEBIT             | Tax outflow                      |
| INTERNAL_TRANSFER  | BOTH              | Source = DEBIT, destination = CREDIT |
| REFUND             | BOTH              | Giving = DEBIT, receiving = CREDIT |
| CASHBACK           | CREDIT            | Bank credits reward              |
| BANK_CHARGE        | DEBIT             | Penalty/charge outflow           |
| BANK_REVERSAL      | BOTH              | Can reverse either direction     |
| CHEQUE             | BOTH              | Issue = DEBIT, receive = CREDIT  |
| GIRO               | BOTH              | Issue = DEBIT, receive = CREDIT  |
| UNKNOWN            | NONE              | No bearing                       |

- **Direction match** → +0.20 score boost
- **Direction conflict** → −0.15 score penalty + `requiresManualReview = true`

---

## 7. Evidence Model

Each evidence item has a `type`, human-readable `value`, and `weight` (contribution to confidence).

| Evidence Type      | Source                         | Max Weight |
|--------------------|--------------------------------|:----------:|
| PHASE1_MATCH       | Phase 1 keyword score          | 0.35       |
| DIRECTION          | debit/credit direction         | 0.20       |
| COUNTERPARTY       | counterpartyName + role        | 0.20       |
| TRANSACTION_CODE   | transactionCode field          | 0.10       |
| INTERNAL_ACCOUNT   | isInternalAccount() result     | 0.10       |
| REFERENCE_NUMBER   | referenceNumber field          | 0.05       |
| DESCRIPTION        | raw normalized snippet         | 0.05       |
| BANK_NAME          | bankName field                 | 0.02       |

---

## 8. Confidence Weights

```
PHASE1_MATCH       = 0.35  (Phase 1 exact semantic match)
DIRECTION          = 0.20  (Direction consistency)
COUNTERPARTY       = 0.20  (Counterparty classification)
TRANSACTION_CODE   = 0.10  (Bank transaction code hint)
INTERNAL_ACCOUNT   = 0.10  (Confirmed internal account)
SUPPORTING_KEYWORD = 0.05  (Additional keyword signals)
─────────────────────────
TOTAL              = 1.00
```

Weights are declared as `CONFIDENCE_WEIGHTS` constants in `intentClassificationConfidence.ts`.

---

## 9. Manual Review Policy

`requiresManualReview = true` when **any** of the following conditions are met:

| Condition                                                | Source              |
|----------------------------------------------------------|---------------------|
| primary confidence < 0.70                               | threshold check     |
| top-2 confidence gap < 0.10 (ambiguous)                 | gap check           |
| direction conflicts with intent natural direction        | direction conflict  |
| Phase 1 returned UNKNOWN                                | low-signal input    |
| INTERNAL_TRANSFER without confirmed internal account     | account unverified  |
| CUSTOMER_PAYMENT or VENDOR_PAYMENT with no direction     | unresolved payment  |
|   and no counterparty role                              |                     |

All thresholds are defined in `MANUAL_REVIEW_TRIGGERS` in `intentClassificationRules.ts`.

---

## 10. Collision Handling

Known collision groups where ambiguity is expected:

| #  | Description input     | Collision pair                         | Resolver                    |
|----|-----------------------|----------------------------------------|-----------------------------|
| 1  | "TRANSFER ADM"        | TRANSFER_FEE vs BANK_ADMIN_FEE         | direction + context         |
| 2  | "REFUND VENDOR"       | REFUND vs VENDOR_PAYMENT               | CREDIT=REFUND, DEBIT=VENDOR |
| 3  | "GIRO BUNGA"          | GIRO vs INTEREST_INCOME                | CREDIT → INTEREST_INCOME    |
| 4  | "TRANSFER PT ABC"     | CUSTOMER_PAYMENT vs VENDOR_PAYMENT     | direction resolves tie      |
| 5  | "REVERSAL BIAYA ADMIN"| BANK_REVERSAL vs BANK_ADMIN_FEE        | BANK_REVERSAL wins on keyword |

When a known collision is detected, it is logged in `reason[]` for the operator.

---

## 11. Dependency Injection

```typescript
interface IntentClassifierDependencies {
  isInternalAccount?: (accountNumber: string) => boolean | Promise<boolean>;
  classifyCounterparty?: (name: string) => CounterpartyRole | Promise<CounterpartyRole>;
}
```

- **No dependency** — engine works with description + direction only.
- **`isInternalAccount`** — inject to confirm INTERNAL_TRANSFER and remove manual-review flag.
- **`classifyCounterparty`** — inject to boost VENDOR_PAYMENT / CUSTOMER_PAYMENT / PAYROLL.

**Important:** never query the database from inside the classifier. Pre-resolve lookups and pass via callbacks.

---

## 12. Batch Classification

```typescript
// Single
const result = await classifyTransactionIntent(input, deps?);

// Batch
const results = await classifyTransactionIntentBatch(inputs, deps?);
```

Batch contract:
- Preserves input order
- Does not mutate input objects
- No network calls
- Deterministic
- Processes items concurrently via `Promise.all`

---

## 13. Examples

### Customer payment (CREDIT)
```json
Input:  { "description": "TRANSFER MASUK PT BUDI JAYA", "direction": "CREDIT" }
Output: { "primaryIntent": "CUSTOMER_PAYMENT", "confidence": 0.55 }
```

### Vendor payment (DEBIT)
```json
Input:  { "description": "PEMBAYARAN VENDOR PT SUMBER MAKMUR", "direction": "DEBIT" }
Output: { "primaryIntent": "VENDOR_PAYMENT", "confidence": 0.72 }
```

### Payroll with counterparty DI
```json
Input:  { "description": "GAJI JULI", "direction": "DEBIT", "counterpartyName": "KARYAWAN TETAP" }
Deps:   { classifyCounterparty: () => "EMPLOYEE" }
Output: { "primaryIntent": "PAYROLL", "confidence": 0.81 }
```

### INTERNAL_TRANSFER confirmed
```json
Input:  { "description": "TRANSFER ANTAR REKENING", "counterpartyAccount": "1234" }
Deps:   { isInternalAccount: async () => true }
Output: { "primaryIntent": "INTERNAL_TRANSFER", "requiresManualReview": false }
```

---

## 14. Limitations

1. **Description-dependent** — quality degrades significantly for very short or cryptic descriptions.
2. **No contextual learning** — the semantic dictionary is static; new terms require a manual update.
3. **Counterparty resolution is opt-in** — without `classifyCounterparty`, CUSTOMER vs VENDOR disambiguation relies on direction alone.
4. **Amount patterns not yet used** — amount field is captured but not currently used in scoring.
5. **Single-language dictionary** — dictionary covers Indonesian and English; other languages (Mandarin, Arabic) are unsupported.
6. **No bank-specific adapters** — transaction code mapping uses common Indonesian bank codes; custom codes require extension.

---

## 15. Integration Plan for Phase 3

Phase 3 candidates (out of scope for this document):

- **COA Prediction** — map `primaryIntent` → Chart of Accounts account type/subtype suggestion.
- **Feedback Learning** — operator corrections feed back to adjust dictionary weights.
- **ERP Document Matching** — use `IntentClassificationResult` to pre-filter ERP documents for reconciliation matching.
- **Anomaly Detection** — flag statistically unusual intents given historical company patterns.
- **Database Dictionary** — persist `TRANSACTION_DICTIONARY` to DB for per-company customization.

---

## Files

| File | Phase | Purpose |
|------|-------|---------|
| `transactionTypes.ts`                | 1 | Core types: TransactionIntent, TransactionAnalysisResult |
| `transactionDictionary.ts`           | 1 | Semantic keyword dictionary (16 intents) |
| `transactionConfidence.ts`           | 1 | Score normalization, explanation builder, manual review |
| `transactionSchema.ts`               | 1 | Zod schemas for Phase 1 input/output |
| `transactionUnderstanding.ts`        | 1 | `analyzeTransactionDescription()` — main Phase 1 entry point |
| `intentClassificationTypes.ts`       | 2 | Input/output types for Phase 2 |
| `intentClassificationRules.ts`       | 2 | Direction rules, collision groups, manual review triggers |
| `intentClassificationConfidence.ts`  | 2 | Composite confidence model (weighted sum) |
| `intentClassificationSchema.ts`      | 2 | Zod schemas for Phase 2 input/output |
| `intentClassifier.ts`                | 2 | `classifyTransactionIntent()` / `classifyTransactionIntentBatch()` |
| `index.ts`                           | 1+2 | Barrel export |

---

*Document generated: 2026-07-30*
*Phase 2 — AI Transaction Intelligence Intent Classification Engine*

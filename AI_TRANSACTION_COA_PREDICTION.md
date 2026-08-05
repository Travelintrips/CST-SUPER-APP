# AI Transaction COA Prediction Engine
## Phase 3 — Technical Reference

---

## 1. Objective

The COA Prediction Engine accepts the output of Phase 1 (Transaction Understanding) and Phase 2 (Intent Classification), ranks all available Chart-of-Accounts candidates for a given company, and returns a primary recommendation, alternatives, confidence score, evidence, and a manual-review flag.

**The engine never posts, approves, or creates journal entries.** It is strictly advisory.

---

## 2. Architecture

```
CoaPredictionInput
  └── transaction (description, direction, amount, currency, counterparty, …)
  └── companyId
  └── availableAccounts  ← COA catalogue for this company (caller-supplied)
  └── phase1Analysis?    ← Optional — engine runs Phase 1 internally if absent
  └── phase2Classification? ← Optional — engine runs Phase 2 internally if absent
  └── historicalMappings?   ← Prior mapping evidence
  └── policy?               ← Optional overrides

         │
         ▼
  coaPredictionEngine.predictCoa()
         │
    ┌────┴─────────────────────────────────────────────────────┐
    │  1. Phase 1 (analyzeTransactionDescription)              │
    │  2. Phase 2 (classifyTransactionIntent)                  │
    │  3. mergePolicy()                                        │
    │  4. filterAccountCandidates()  ← safety + policy filter  │
    │  5. rankCoaCandidates()        ← score all candidates     │
    │  6. evaluateManualReview()     ← manual review logic      │
    │  7. resolveRecommendationSource()                        │
    └─────────────────────────────────────────────────────────-┘
         │
         ▼
  CoaPredictionResult
```

---

## 3. Pipeline: Phase 1 → 2 → 3

| Phase | Module | Public API | Output |
|-------|--------|------------|--------|
| 1 | `transactionUnderstanding.ts` | `analyzeTransactionDescription()` | `TransactionAnalysisResult` |
| 2 | `intentClassifier.ts` | `classifyTransactionIntent()` | `IntentClassificationResult` |
| 3 | `coaPredictionEngine.ts` | `predictCoa()` / `predictCoaBatch()` | `CoaPredictionResult` |

Phase 3 embeds Phase 1 and Phase 2 results in its output for full traceability. If the caller supplies pre-computed Phase 1/2 results, the engine reuses them without re-running.

---

## 4. Input Contract

```typescript
interface CoaPredictionInput {
  transaction: {
    description: string;           // Required
    direction?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
    amount?: number;
    currency?: string;             // ISO 4217
    transactionDate?: string | Date;
    bankAccountId?: string | number;
    bankName?: string;
    counterpartyName?: string;
    counterpartyAccount?: string;
    referenceNumber?: string;
    transactionCode?: string;
  };
  companyId: string | number;      // Required
  availableAccounts: CoaAccountCandidate[];  // Required
  phase1Analysis?: TransactionAnalysisResult;
  phase2Classification?: IntentClassificationResult;
  historicalMappings?: HistoricalCoaMapping[];
  policy?: CoaPredictionPolicy;
}
```

Required fields: `transaction.description`, `companyId`, `availableAccounts`.

---

## 5. Account Candidate Contract

```typescript
interface CoaAccountCandidate {
  id: string | number;
  companyId: string | number;     // Must match input.companyId
  code: string;
  name: string;
  accountType?: string;           // e.g. "expense", "liability", "asset"
  normalBalance?: 'DEBIT' | 'CREDIT' | 'UNKNOWN';
  category?: string;
  subcategory?: string;
  isActive: boolean;              // false → rejected
  allowsManualPosting?: boolean;  // false → rejected
  keywords?: string[];            // semantic keywords for matching
  aliases?: string[];             // alternative names
  metadata?: Record<string, unknown>;
}
```

**Hard rejection rules** (account is excluded entirely):
- `companyId` does not match `input.companyId`
- `isActive = false`
- `allowsManualPosting = false`

---

## 6. Historical Mapping Contract

```typescript
interface HistoricalCoaMapping {
  companyId: string | number;
  normalizedDescription?: string;
  intent?: TransactionIntent;
  counterpartyName?: string;
  counterpartyAccount?: string;
  transactionCode?: string;
  coaId: string | number;
  coaCode: string;
  usageCount?: number;
  approvedCount?: number;    // boosts score when high
  rejectedCount?: number;    // penalises when ratio ≥ 50%
  lastUsedAt?: string | Date;
}
```

Historical mappings are treated as **evidence**, not as ground truth. They are validated against company, active account, intent, and rejection history before contributing to score.

---

## 7. Output Contract

```typescript
interface CoaPredictionResult {
  companyId: string | number;
  primaryRecommendation: {
    coaId: string | number;
    coaCode: string;
    coaName: string;
    confidence: number;   // 0.00 – 1.00
    score: number;
  } | null;               // null when no safe recommendation
  alternatives: CoaPredictionAlternative[];
  intent: TransactionIntent;
  normalizedDescription: string;
  evidence: CoaPredictionEvidence[];
  reason: string[];
  conflictFlags: string[];
  requiresManualReview: boolean;
  recommendationSource: CoaRecommendationSource;
  phase1Analysis: TransactionAnalysisResult;
  phase2Classification: IntentClassificationResult;
}
```

When `primaryRecommendation` is `null`:
- `requiresManualReview` is always `true`
- `recommendationSource` is `"NONE"`
- `reason` explains why no safe candidate was found

---

## 8. Ranking Algorithm

For each filtered account candidate:

1. **Historical mapping score** — match against `historicalMappings` by company, intent, description similarity, counterparty, transaction code; weighted by approval ratio.
2. **Intent keyword score** — check account name, keywords[], aliases[] against `INTENT_COA_KEYWORDS[intent]`.
3. **Keyword/alias raw score** — direct keyword/alias field match.
4. **Category/type score** — check `accountType` and `category` against `INTENT_PREFERRED_ACCOUNT_TYPES` and `INTENT_ANTI_PATTERN_TYPES`.
5. **Direction/normal balance score** — compare transaction direction with `normalBalance`.
6. **Counterparty score** — match `counterpartyName` against account name/keywords/aliases.
7. **Transaction code score** — match `transactionCode` against account keywords and intent keywords.
8. **Policy adjustment** — apply `preferenceBonus` and `typeMismatchPenalty` from policy config.

After scoring: apply penalties, clamp to [0, 1], sort descending, deduplicate, filter below `minimumConfidence`.

---

## 9. Confidence Weights

| Signal | Weight |
|--------|--------|
| Approved historical mapping | 0.30 |
| Phase 2 intent compatibility | 0.25 |
| Account keyword/alias match | 0.15 |
| Account category/type compatibility | 0.10 |
| Direction/normal balance compatibility | 0.10 |
| Counterparty mapping | 0.05 |
| Transaction code/reference | 0.05 |
| **Total** | **1.00** |

### Penalties

| Condition | Penalty |
|-----------|---------|
| Historical mapping rejected (ratio ≥ 50%) | −0.25 |
| Intent is UNKNOWN | −0.20 |
| Transaction direction conflicts with account normal balance | −0.20 |
| CUSTOMER_PAYMENT mapped to revenue account | −0.15 |
| VENDOR_PAYMENT mapped to expense account | −0.15 |

---

## 10. Safety Rules

Accounts are **hard-rejected** when:
- `companyId` does not match
- `isActive = false`
- `allowsManualPosting = false`
- Policy `blockedAccountCodes` includes the account code
- Policy `blockedAccountTypes` includes the account type

Accounts receive **penalty scoring** when:
- Normal balance conflicts with transaction direction
- Account type conflicts with intent anti-patterns (e.g. revenue for CUSTOMER_PAYMENT)
- Historical mapping has significant rejection history

---

## 11. Manual Review Policy

`requiresManualReview = true` is set when **any** of:

| Condition | Flag |
|-----------|------|
| `primaryRecommendation = null` | — |
| `confidence < manualReviewThreshold` (default 0.80) | — |
| Top two candidates within `ambiguityDelta` (default 0.10) | `MULTIPLE_CLOSE_CANDIDATES` |
| Phase 2 `requiresManualReview = true` | — |
| Intent is `UNKNOWN` | `UNKNOWN_INTENT` |
| Material conflict flag present | see below |
| No active accounts for this company | — |
| Cross-company account detected | `CROSS_COMPANY_ACCOUNT` |
| Only weak keyword evidence | `INSUFFICIENT_EVIDENCE` |

Material conflict flags that trigger manual review:
`DIRECTION_CONFLICT`, `INTENT_ACCOUNT_CONFLICT`, `AR_REVENUE_AMBIGUITY`,
`AP_EXPENSE_AMBIGUITY`, `INTERNAL_TRANSFER_UNVERIFIED`, `HISTORICAL_MAPPING_REJECTED`,
`MULTIPLE_CLOSE_CANDIDATES`

---

## 12. AR vs Revenue Handling (CUSTOMER_PAYMENT)

When intent is `CUSTOMER_PAYMENT`:
- Engine **prefers** accounts with type `asset` / `receivable`
- Engine **penalises** accounts with type `revenue` / `income` / `pendapatan`
- If only revenue accounts are available → `AR_REVENUE_AMBIGUITY` flag + `requiresManualReview = true`

**Rationale:** Customer payments typically clear against Accounts Receivable first. Only after AR application can they flow to revenue, and that posting decision belongs to the accountant.

---

## 13. AP vs Expense Handling (VENDOR_PAYMENT)

When intent is `VENDOR_PAYMENT`:
- Engine **prefers** accounts with type `liability` / `payable`
- Engine **penalises** accounts with type `expense` / `biaya`
- If only expense accounts are available → `AP_EXPENSE_AMBIGUITY` flag + `requiresManualReview = true`

**Rationale:** Vendor payments typically clear against Accounts Payable. Direct expense posting without an AP intermediary should be an explicit accountant decision.

---

## 14. Internal Transfer Handling (INTERNAL_TRANSFER)

- Engine prefers clearing/interbank/cash transit accounts
- If there is no historical or counterparty evidence confirming the transfer is genuinely internal → `INTERNAL_TRANSFER_UNVERIFIED` flag + `requiresManualReview = true`

---

## 15. Dependency Injection

```typescript
interface CoaPredictionDependencies {
  getHistoricalMappings?: (input) => HistoricalCoaMapping[] | Promise<...>;
  validateAccount?: (account, input) => { allowed: boolean; reason?: string } | Promise<...>;
  getIntentAccountHints?: (intent, companyId) => string[] | Promise<string[]>;
}
```

All three are optional. The engine operates fully without any dependencies.

- `getHistoricalMappings` — called when `input.historicalMappings` is not provided
- `validateAccount` — external validation (e.g. ERP policy rules)
- `getIntentAccountHints` — company-specific keyword hints to supplement built-in maps

---

## 16. Policy Configuration

```typescript
interface CoaPredictionPolicy {
  minimumConfidence?: number;          // Default: 0.40
  manualReviewThreshold?: number;      // Default: 0.80
  ambiguityDelta?: number;             // Default: 0.10
  maxAlternatives?: number;            // Default: 4
  blockedAccountCodes?: string[];
  blockedAccountTypes?: string[];
  allowedAccountTypesByIntent?: Partial<Record<TransactionIntent, string[]>>;
  preferredAccountCodesByIntent?: Partial<Record<TransactionIntent, string[]>>;
}
```

Safe defaults are applied for all absent fields.

---

## 17. Batch Prediction

```typescript
const results = await predictCoaBatch(inputs, deps?);
```

- Output array is the same length and order as input
- Each item is processed independently (no cross-item mutation or state)
- Async deps are awaited per item (serial for determinism)
- No side effects

---

## 18. Example Input/Output

### Input
```json
{
  "transaction": {
    "description": "BIAYA BI-FAST KE REKENING VENDOR",
    "direction": "DEBIT",
    "transactionCode": "BI-FAST"
  },
  "companyId": "1",
  "availableAccounts": [
    {
      "id": "6-002", "companyId": "1", "code": "6-002",
      "name": "Biaya Transfer Bank",
      "accountType": "expense", "normalBalance": "DEBIT",
      "isActive": true, "allowsManualPosting": true,
      "keywords": ["transfer fee", "rtgs", "bi-fast", "swift", "skn"]
    }
  ]
}
```

### Output (abbreviated)
```json
{
  "companyId": "1",
  "primaryRecommendation": {
    "coaId": "6-002", "coaCode": "6-002",
    "coaName": "Biaya Transfer Bank",
    "confidence": 0.625, "score": 0.625
  },
  "intent": "TRANSFER_FEE",
  "requiresManualReview": true,
  "recommendationSource": "COMBINED",
  "conflictFlags": [],
  "reason": ["Phase 2 intent: TRANSFER_FEE (confidence: 0.750)", "Account name/keywords match intent TRANSFER_FEE"]
}
```

---

## 19. Limitations

- Engine does not learn from feedback automatically — update `historicalMappings.approvedCount` / `rejectedCount` externally.
- No vector/embedding similarity — keyword matching is exact substring.
- Keyword dictionary is maintained in `coaPredictionRules.ts`; expand for domain-specific terminology.
- No multi-company allocation (single `companyId` per call).
- Currency has no effect on COA selection in Phase 3 (by design — multi-currency posting is a GL concern).
- Performance scales linearly with `availableAccounts.length` — pre-filter large catalogues if needed.

---

## 20. Phase 4 Integration Plan

Phase 4 (ERP Document Matching) will consume Phase 3 output as follows:

1. Phase 3 provides `primaryRecommendation` + `alternatives` to Phase 4.
2. Phase 4 matches against open ERP documents (invoices, POs, advance payments).
3. Phase 4 may override the COA recommendation when a document match is confirmed.
4. Phase 4 is still advisory — no auto-posting.

Phase 3 output contract (`CoaPredictionResult`) is designed to be stable and additive so Phase 4 can extend it without breaking changes.

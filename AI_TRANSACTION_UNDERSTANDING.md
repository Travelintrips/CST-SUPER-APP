# AI Transaction Understanding Engine
## Phase 1 — Architecture & Reference

---

## Overview

The **AI Transaction Understanding Engine** is a deterministic, pure-function semantic classifier for Indonesian corporate bank mutation descriptions. It assigns a **TransactionIntent** to each raw description along with a **confidence score** (0.00–1.00), the **matched synonyms**, and a human-readable **reason list** for full auditability.

It is the foundation layer of the AI Transaction Intelligence system. It operates upstream of all existing business logic (Rule Engine, Decision Stack, ERP Matcher, COA Mapping) and is purely **additive** — no existing behaviour is modified.

---

## Architecture

```
Raw Description String
        │
        ▼
┌───────────────────────────────────────┐
│         normalizeForAnalysis()        │
│                                       │
│  • uppercase                          │
│  • bank abbreviation expansion        │
│  • punctuation removal                │
│  • multi-space collapse               │
│  • trim                               │
└───────────────────┬───────────────────┘
                    │ Normalized Description (UPPERCASE)
                    ▼
┌───────────────────────────────────────┐
│         Semantic Dictionary Scan      │
│                                       │
│  For each DictionaryEntry:            │
│    For each synonym:                  │
│      detectMatchQuality()             │
│      → exact | word_boundary |        │
│        substring | partial_token      │
└───────────────────┬───────────────────┘
                    │ List of EntryScores
                    ▼
┌───────────────────────────────────────┐
│         Confidence Engine             │
│                                       │
│  computeConfidence(base, matches)     │
│  = base × qualityMultiplier + bonus   │
│  capped at 0.99                       │
└───────────────────┬───────────────────┘
                    │ Scored entries, filtered ≥ 0.50
                    ▼
┌───────────────────────────────────────┐
│         Intent Decision               │
│                                       │
│  Pick highest-confidence entry        │
│  If none → UNKNOWN (conf = 0.00)      │
└───────────────────┬───────────────────┘
                    │
                    ▼
        TransactionAnalysisResult
```

---

## Folder Structure

```
artifacts/api-server/src/lib/ai/transaction-intelligence/
├── index.ts                  Public API barrel — import from here
├── transactionTypes.ts       TransactionIntent type + TRANSACTION_INTENTS list
├── transactionSchema.ts      TransactionAnalysisResult interface (JSON contract)
├── transactionDictionary.ts  Semantic dictionary: synonyms → intent mappings
├── transactionConfidence.ts  Match quality detection + confidence computation
└── transactionUnderstanding.ts  Main engine: analyzeTransactionDescription()

artifacts/api-server/src/__tests__/
└── transaction-understanding.test.ts  ≥ 95% coverage unit tests
```

---

## Dictionary Design

### DictionaryEntry shape

```typescript
interface DictionaryEntry {
  intent: TransactionIntent;   // target classification
  baseConfidence: number;      // 0.00–1.00 base before quality multiplier
  synonyms: string[];          // UPPERCASE, ordered longest→shortest
}
```

### Evaluation order

The dictionary is evaluated top-to-bottom. Critical ordering decisions:

| Position | Intent | Reason |
|---|---|---|
| 1st | `BANK_REVERSAL` | "REVERSE TRANSFER" would match TRANSFER_FEE otherwise |
| 2nd | `INTERNAL_TRANSFER` | "TRANSFER KAS BESAR" would match TRANSFER_FEE otherwise |
| 3rd | `BANK_ADMIN_FEE` | Must precede BANK_CHARGE to avoid "DENDA ADMIN" ambiguity |
| ... | `INTEREST_INCOME` | Must precede GIRO — "JASA GIRO" belongs to INTEREST_INCOME |

### Synonym example mapping

| Synonyms | Intent |
|---|---|
| ADM, ADMIN, ADMINISTRASI, ADMIN FEE, ACCOUNT CHARGE, ACCOUNT MAINTENANCE, MONTHLY CHARGE | `BANK_ADMIN_FEE` |
| BI FAST, BI-FAST, RTGS FEE, SKN FEE, SWIFT FEE, BIAYA TRANSFER, TRANSFER FEE | `TRANSFER_FEE` |
| JASA GIRO, INTEREST, INT CREDIT, BUNGA, GIRO CREDIT, PENDAPATAN BUNGA | `INTEREST_INCOME` |
| SALARY, GAJI, PAYROLL, PAYROLL TRANSFER, THR, TUNJANGAN HARI RAYA | `PAYROLL` |
| PPN, PPH, PAJAK, TAX, WITHHOLDING TAX, SETORAN PAJAK | `TAX_PAYMENT` |

---

## Normalization

### Steps

1. **Bank abbreviation expansion** — e.g. `BI-FAST` → `BI FAST`
2. **Uppercase** — all text uppercased
3. **Punctuation removal** — non-alphanumeric characters replaced with space
4. **Multi-space collapse** — consecutive spaces → single space
5. **Trim** — leading/trailing whitespace removed

### Example

```
Input:  "Adm Rek. Juli/2026"
Output: "ADM REK  JULI 2026"  (then collapsed to "ADM REK JULI 2026")
```

---

## Confidence Calculation

### Match quality levels

| Quality | Condition | Multiplier |
|---|---|---|
| `exact` | `normalizedDesc === synonym` | 1.00 |
| `word_boundary` | synonym present as complete token sequence | 0.97 |
| `substring` | synonym present anywhere in string | 0.92 |
| `partial_token` | ≥50% of synonym tokens found individually | 0.78 |

### Formula

```
finalConfidence = min(0.99,
  baseConfidence × qualityMultiplier + breadthBonus
)

breadthBonus:
  1 match  → +0.00
  2 matches → +0.02
  3+ matches → +0.03
```

### Confidence tiers

| Range | Tier | Recommended action |
|---|---|---|
| ≥ 0.90 | High | Suitable for automated processing |
| 0.70–0.89 | Medium | Recommend human review |
| 0.50–0.69 | Low | Flag for manual classification |
| < 0.50 | Insufficient | Classified as UNKNOWN |

---

## Transaction Intents (16 total)

| Intent | Description |
|---|---|
| `BANK_ADMIN_FEE` | Monthly/account administration fees |
| `TRANSFER_FEE` | BI-FAST, RTGS, SKN, SWIFT wire transfer fees |
| `INTEREST_INCOME` | Jasa giro / interest credited by bank |
| `CUSTOMER_PAYMENT` | Inbound payment from customer/buyer |
| `VENDOR_PAYMENT` | Outbound payment to vendor/supplier |
| `PAYROLL` | Salary, THR, payroll disbursement |
| `LOAN_PAYMENT` | Loan installment, KPR, cicilan kredit |
| `TAX_PAYMENT` | PPN, PPH, withholding tax, pajak |
| `INTERNAL_TRANSFER` | Inter-account / inter-company fund movement |
| `REFUND` | Return of funds, reimbursement |
| `CASHBACK` | Cashback or reward credit |
| `BANK_CHARGE` | Penalty, denda, late fee |
| `BANK_REVERSAL` | Reversal / cancellation / storno |
| `CHEQUE` | Cheque/cek clearance |
| `GIRO` | Bilyet giro clearance |
| `UNKNOWN` | Unclassified / insufficient signal |

---

## JSON Contract

```typescript
interface TransactionAnalysisResult {
  intent: TransactionIntent;         // classified intent
  normalizedDescription: string;    // preprocessed input
  confidence: number;                // 0.00 – 1.00
  matchedSynonyms: string[];         // synonyms that matched
  reason: string[];                  // explainability array
}
```

### Example output

```json
{
  "intent": "BANK_ADMIN_FEE",
  "normalizedDescription": "BANK ADMIN FEE",
  "confidence": 0.97,
  "matchedSynonyms": ["ADMIN FEE", "BANK ADMIN", "ADMIN"],
  "reason": [
    "synonym matched at word boundary",
    "3 synonyms matched — breadth bonus applied",
    "semantic dictionary confidence high",
    "normalized successfully"
  ]
}
```

---

## Example Input → Output

| Input | Intent | Confidence |
|---|---|---|
| `"Adm Rek Juli"` | `BANK_ADMIN_FEE` | ~0.95 |
| `"BIAYA TRANSFER RTGS"` | `TRANSFER_FEE` | ~0.93 |
| `"JASA GIRO AGUSTUS"` | `INTEREST_INCOME` | ~0.93 |
| `"PAYROLL TRANSFER BATCH 01"` | `PAYROLL` | ~0.93 |
| `"PPH 21 KARYAWAN"` | `TAX_PAYMENT` | ~0.93 |
| `"REVERSAL TRANSFER"` | `BANK_REVERSAL` | ~0.93 |
| `"REFUND DANA PELANGGAN"` | `REFUND` | ~0.91 |
| `"CASHBACK PROMO"` | `CASHBACK` | ~0.95 |
| `"SETORAN TUNAI COUNTER"` | `UNKNOWN` | 0.00 |

---

## Integration Guide

```typescript
import {
  analyzeTransactionDescription,
  analyzeTransactionDescriptions,   // batch
  type TransactionAnalysisResult,
} from "../lib/ai/transaction-intelligence/index.js";

// Single analysis
const result = analyzeTransactionDescription("GAJI KARYAWAN JULI 2026");
// result.intent === "PAYROLL"
// result.confidence === 0.93
// result.matchedSynonyms === ["GAJI KARYAWAN", "GAJI"]

// Batch
const results = analyzeTransactionDescriptions(descriptions);
```

This engine is **additive** — it runs before your existing Rule Engine and produces an enrichment result. The existing reconciliation / ERP / COA systems are unchanged.

---

## Future Extensions (Phase 2+)

The following are explicitly **out of scope for Phase 1**:

- **COA Prediction** — map intents to GL accounts
- **Learning Engine** — update dictionary weights from confirmed matches
- **Confidence Dashboard** — visualise classification distribution
- **LLM Fallback** — call an AI provider for UNKNOWN descriptions
- **Multi-language expansion** — Mandarin, English-only, etc.
- **Amount-aware classification** — use debit/credit amount as a signal
- **Counterparty learning** — build per-counterparty intent memory

The `DictionaryEntry.baseConfidence` per-entry design and the `TransactionAnalysisResult` schema are intentionally stable so Phase 2 features can extend without breaking Phase 1 consumers.

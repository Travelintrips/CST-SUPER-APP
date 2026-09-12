# Settlement Pattern Engine

Configurable settlement recognition layer for Bank Reconciliation.

## Overview

The Settlement Pattern Engine adds a DB-driven recognition layer on top of the existing Bank Reconciliation engine. It allows Finance to configure how AI identifies settlement mutations from QRIS, EDC, Virtual Account, and all major payment providers — **without hardcoding anything**.

## Architecture

```
Bank Mutation Import
        ↓
Settlement Pattern Engine   ← NEW LAYER (advisory only)
  – Load patterns from DB
  – Match keywords (contains/starts_with/ends_with/equals/regex)
  – Score confidence
  – Return provider/strategy/delay recommendation
        ↓
Existing Bank Reconciliation (unchanged)
  – Universal Journal Reuse Engine
  – Accounting Engine
  – COA Governance
```

## Guardrails

- **Does NOT** modify journals, accounting entries, or COA
- **Does NOT** auto-post or auto-approve anything
- **Advisory only** — results are recommendations fed to the existing recon engine
- All existing engines (Accounting, Journal Reuse, COA Governance, AI Governance, Posting, Ledger) remain **unchanged**

## Database Tables

| Table | Purpose |
|---|---|
| `recon_settlement_patterns` | Master pattern config (provider, strategy, delay, merchant) |
| `recon_settlement_pattern_keywords` | Keyword rules per pattern (contains/regex/etc.) |
| `recon_settlement_pattern_examples` | AI learning examples from user corrections |

## Seeded Providers (15)

QRIS Travelintrips, QRIS Generic, Midtrans, Xendit, Paylabs, DOKU, OVO, GoPay, ShopeePay, DANA, LinkAja, BCA EDC, Mandiri EDC, BNI EDC, BRI EDC, Virtual Account.

## Match Strategies

| Strategy | Description |
|---|---|
| `ONE_TO_ONE` | One bank mutation ↔ one booking/invoice |
| `ONE_TO_MANY` | One settlement covers multiple transactions |
| `MANY_TO_ONE` | Multiple mutations settle one transaction |
| `BATCH_SETTLEMENT` | Batch of bookings netted to one settlement (QRIS default) |

## Batch Fee Formula (Phase 9)

```
Gross Booking = Net Settlement + Fee
```

Matching is based on **Economic Event**, not on Pendapatan/PPN/Journal Line.

## Keyword Match Modes

| Mode | Description | Score |
|---|---|---|
| `equals` | Exact match | 50 |
| `regex` | Regular expression | 45 |
| `starts_with` | Description starts with keyword | 40 |
| `ends_with` | Description ends with keyword | 35 |
| `contains` | Keyword found anywhere | 30 |

## Confidence Scoring

- Keyword match strength: 30–50 pts
- Provider name in description: +20 pts  
- Merchant name/ID match: +20 pts
- Extra keyword matches: +5 each (max +10)
- **Total max: 100 pts → expressed as 0.00–1.00**

## API Endpoints

All under `/api/settlement-patterns` — requires admin auth.

### Pattern CRUD
- `GET /` — list patterns
- `POST /` — create pattern
- `PATCH /:id` — update pattern
- `DELETE /:id` — soft-deactivate
- `POST /:id/activate` — reactivate

### Keywords
- `GET /:id/keywords` — list keywords
- `POST /:id/keywords` — add keyword
- `PATCH /keywords/:kwId` — update keyword
- `DELETE /keywords/:kwId` — delete keyword

### AI Learning
- `GET /:id/examples` — list examples
- `POST /:id/examples` — save example
- `DELETE /examples/:exId` — delete example

### Tools (read-only)
- `POST /simulate` — test one description
- `POST /simulate/batch` — test up to 200 descriptions
- `GET /statistics` — dashboard stats
- `POST /seed` — re-run seed migration

## BizPortal Navigation

**Finance → Settlement Pattern**

Path: `/finance/settlement-pattern`

Tabs: General | Keyword | Merchant | Matching | Settlement | Learning | Statistics | Simulator | Tester

## Integration with Bank Reconciliation (Phase 18)

Recommended call order during mutation processing:

1. Find Settlement Pattern
2. Find Provider
3. Find Merchant
4. Find Batch Booking
5. Calculate Gross
6. Calculate Fee
7. Calculate Net
8. AI Recommendation

The Settlement Pattern Engine handles steps 1–3. Existing engines handle 4–8.

## AI Learning (Phase 11)

When Finance corrects an AI result, the UI prompts:

> Simpan Pattern Baru?

If confirmed → save raw description as `recon_settlement_pattern_examples` with `source=user_confirmed`.

## Runtime UAT (Phase 23)

Test input:
```
7177632488799999999111111111111QRTRAVELI DR 0000029511812 KR 1640006707220 99106
```

Expected:
- Provider: QRIS
- Pattern: QRIS Travelintrips
- Strategy: BATCH_SETTLEMENT
- Confidence: >95%

# AI Transaction Enterprise Workflow

## Overview

This document describes the end-to-end AI Transaction Intelligence workflow (Phase 1–12) implemented in the CST Super App.

## Architecture

```
Transaction Source
      │
      ▼
Phase 1–9: AI Pipeline (transaction-intelligence/)
      │  Understanding → Classification → COA Prediction
      │  Explainability → Anomaly → Orchestration → Policy
      │
      ▼
Phase 10: Persistence Service (aiTransactionPersistenceService.ts)
      │  analyzeAndCreateReviewCase()
      │  recordAIReviewerDecision()
      │  reevaluateAIReviewCase()
      │
      ▼
Phase 10: Repository Layer (aiReviewRepository.ts)
      │  6 repositories, all company-scoped
      │  Audit events: append-only
      │  Snapshots: immutable after insert
      │
      ▼
Phase 10: REST API (aiTransactionReview.ts)
      │  /api/ai-transaction/...
      │
      ├─► Phase 12: /review-cases/by-source   → GET, query by source entity
      └─► Phase 12: /review-cases/from-source → POST, idempotent create from source
```

## Source Types

The following source entity types are supported for AI review cross-linking:

| Source | Module | Route |
|--------|--------|-------|
| `BANK_MUTATION` | Bank Reconciliation | `/accounting/bank-reconciliation` |
| `BANK_RECONCILIATION` | Bank Reconciliation | `/accounting/bank-reconciliation` |
| `TREASURY` | Kas & Bank | `/accounting/bank-disbursements` |
| `ACCOUNTING_ENTRY` | Jurnal Akuntansi | `/accounting/entries` |
| `EXPENSE` | Beban | `/expense` |
| `CASH_ADVANCE` | Dana Talangan | `/expense` |
| `VENDOR_PAYMENT` | Bayar Vendor | `/accounting/bank-disbursements` |
| `CUSTOMER_PAYMENT` | Bayar Customer | `/accounting/bank-receipts` |
| `INVOICE` | Invoice | `/accounting/entries` |
| `SALES_DOCUMENT` | Dokumen Jual | `/sales/documents/:id` |
| `PURCHASE` | Pembelian | `/purchase/documents/:id` |
| `LOGISTIC_ORDER` | Order Logistik | `/logistics/portal-orders/:id` |
| `SPORT_PAYMENT` | Bayar Sport | `/sport-center/bookings` |
| `PPJK` | PPJK | `/logistics/ppjk` |
| `EXPECTED_CASH_FLOW` | Arus Kas | `/accounting/cash-flow-forecast` |

## Phase 12 API Endpoints

### GET `/api/ai-transaction/review-cases/by-source`

Query existing review case for a source entity.

**Query params:** `source`, `sourceRecordId`

**Response:**
```json
{
  "ok": true,
  "data": {
    "exists": true,
    "reviewCase": { ... }
  }
}
```

### POST `/api/ai-transaction/review-cases/from-source`

Create review case from a source entity. Idempotent — returns existing case if already created.

**Body:**
```json
{
  "source": "BANK_MUTATION",
  "sourceRecordId": "MUT-123",
  "transaction": {
    "id": "MUT-123",
    "description": "Transfer Masuk Vendor",
    "amount": 5000000,
    "direction": "CREDIT",
    "transactionDate": "2026-07-01"
  }
}
```

**Response (created):**
```json
{
  "ok": true,
  "data": {
    "created": true,
    "reviewCaseId": 42,
    "status": "QUEUED",
    "queue": "ACCOUNTING_REVIEW",
    "priority": "MEDIUM"
  }
}
```

**Response (existing):**
```json
{
  "ok": true,
  "data": {
    "created": false,
    "reviewCase": { ... }
  }
}
```

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `AI_REVIEW_SOURCE_NOT_FOUND` | 404 | No review case for given source+recordId |
| `AI_REVIEW_SOURCE_UNSUPPORTED` | 422 | Source type not in supported list |
| `AI_REVIEW_CASE_ALREADY_EXISTS` | 200 | Idempotency — existing case returned |
| `AI_REVIEW_PERMISSION_DENIED` | 403 | No finance role |
| `AI_REVIEW_COMPANY_MISMATCH` | 403 | Cross-company access attempt |

## Shared Frontend Components

| Component | Purpose |
|-----------|---------|
| `AIReviewBadge` | Compact status badge for list rows |
| `AIReviewWarning` | Non-blocking warning for OPEN/HIGH_RISK/OVERDUE |
| `AIReviewLink` | Navigation link → AI review detail page |
| `AIRecommendationPanel` | Intent, COA, confidence, risk panel |
| `AIReviewStatusCard` | Full-width status card composing above |
| `AIReviewCompactSummary` | Single-row inline summary |
| `AIReviewSourcePanel` | Drop-in panel — fetches + displays AI review for a source entity |

## Frontend Hooks

| Hook | Purpose |
|------|---------|
| `useAIReviewBySource(source, sourceRecordId)` | Fetch review case for source entity. Only fires when both params present. |
| `useCreateAIReviewFromSource()` | Mutation to create review case. Idempotent. Explicit user action only. |

## Priority Module Integrations (Phase 6)

| Module | Page | Integration Point | Source Type |
|--------|------|-------------------|-------------|
| Bank Reconciliation | `bank-reconciliation.tsx` | Approve dialog | `BANK_MUTATION` |
| Treasury / Vendor Payment | `bank-disbursements.tsx` | DisbDetailDialog | `VENDOR_PAYMENT` |
| Customer Payment | `bank-receipts.tsx` | DetailDialog | `CUSTOMER_PAYMENT` |
| Accounting Entries | `entries.tsx` | Entry row action cell | `ACCOUNTING_ENTRY` |
| Expenses | `expense/index.tsx` | Expense row | `EXPENSE` |

## Invariants

1. **No auto-create on render** — cases only created via explicit user action.
2. **No journal posting** — components never post journals, reconcile, or auto-approve.
3. **Company isolation** — all queries scoped to backend session company; no companyId from query/body without auth.
4. **Append-only audit** — SOURCE_LINKED, SOURCE_REVIEW_OPENED audit events are additive only.
5. **Idempotency** — from-source endpoint checks for existing case before creating.
6. **Safe fallback** — unknown source returns null from `resolveAISourceRoute`; callers hide navigation.
7. **No DB in frontend** — all DB access via repository layer only; frontend uses API calls.

## Audit Events (Phase 12)

| Event | Trigger | Append-only |
|-------|---------|-------------|
| `SOURCE_LINKED` | `POST /from-source` creates new case | ✅ |
| `SOURCE_REVIEW_OPENED` | Future: when user navigates to review detail from source page | ✅ |
| `CASE_CREATED` | Any case creation | ✅ (pre-existing) |
| `QUEUED` | After case creation | ✅ (pre-existing) |

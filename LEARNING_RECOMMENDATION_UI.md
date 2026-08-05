# Learning & Recommendation UI

## Overview

The AI Learning & Recommendation Center UI adds three new tabs to the existing AI Review module in BizPortal, plus integration points in COA Governance, Bank Reconciliation, and the Finance hub.

---

## Navigation Structure

```
/ai/review            — AI Transaction Review hub (index page)
  /ai/review/queue          — Review Queue (existing)
  /ai/review/observability  — Observabilitas (existing)
  /ai/review/learning       — NEW: Learning Patterns
  /ai/review/learning/:id   — NEW: Learning Pattern Detail
  /ai/review/recommendations         — NEW: Recommendations
  /ai/review/recommendations/:id     — NEW: Recommendation Detail
  /ai/review/statistics     — NEW: Statistics
```

---

## Tab: Learning

**Route:** `/ai/review/learning`  
**Page:** `artifacts/bizportal/src/pages/ai-review/learning.tsx`

Shows patterns discovered by the AI from reviewer decision history, grouped by `(intent + recommended COA)`.

**Features:**
- Search by intent or COA code
- Refresh button
- Per-pattern: occurrence count, confidence %, reviewer agreement %, last seen
- "Lihat Detail" button → `/ai/review/learning/:id`

**Empty state:** Shown when no feedback records exist.

---

## Tab: Recommendations

**Route:** `/ai/review/recommendations`  
**Page:** `artifacts/bizportal/src/pages/ai-review/recommendations.tsx`

Shows rule recommendation packages proposed by AI, awaiting human approval.

**Features:**
- Search + status filter (All / Menunggu / Draft / Disetujui / Ditolak / Diarsipkan)
- AI Recommendation card with occurrence count, COA, confidence
- Status badge: "Belum menjadi Rule" for pending items
- "Lihat Evidence" button → `/ai/review/recommendations/:id`
- Phase 9 banner: AI cannot auto-approve

**Approve/Ignore actions are in the detail page only (role-gated).**

---

## Tab: Statistics

**Route:** `/ai/review/statistics`  
**Page:** `artifacts/bizportal/src/pages/ai-review/statistics.tsx`

Aggregated metrics in stat cards.

**Cards:**
| Card | Description |
|---|---|
| Learning Accuracy | % feedback where reviewer agreed with AI |
| Recommendation Accuracy | Proxy: same as accuracy |
| False Positive | % AI was wrong |
| Manual Review Saved | Transactions auto-accepted |
| Rule Generated | Total rule packages |
| Rules Approved | Approved packages |
| Rules Rejected | Rejected/archived packages |
| Learning Pattern | Distinct (intent+COA) groups |
| Average Confidence | Same as accuracy (proxy) |
| Reviewer Agreement | % reviewer agreed |
| Learning Trend | Last 30 days vs prior 30 days |

---

## Recommendation Detail Page

**Route:** `/ai/review/recommendations/:id`  
**Page:** `artifacts/bizportal/src/pages/ai-review/recommendation-detail.tsx`

**Sections:**
- Package header (status, risk, creator, timestamp)
- Detected Pattern & Evidence (rule suggestions with COA, occurrences, confidence, affected transactions)
- Impact Estimate (from `impact_payload_json`)
- Simulation Result (from `simulation_payload_json`)
- Actions panel: Approve Rule / Reject (role-gated) + Confidence Breakdown + Related Rule

**Role checks (Phase 8):**
- Finance Manager (`finance`): Approve only
- Accounting Manager (`accounting`): Approve + Reject
- Admin: Approve + Reject

---

## Bank Reconciliation Integration (Phase 5)

**File:** `artifacts/bizportal/src/pages/accounting/smart-bank-recon.tsx`

When AI finds pending recommendations, a small card appears in the upload results area:

```
┌─────────────────────────────────────────────────┐
│ 🧠 AI Recommendation                            │
│ AI menemukan [N] rekomendasi transaksi          │
│ selalu dipilih → [COA]                          │
│ Confidence: 98%                                 │
│ [Lihat Recommendation]                          │
└─────────────────────────────────────────────────┘
```

Click → opens `/ai/review/recommendations` (no auto-approve).

---

## COA Governance Integration (Phase 6)

**File:** `artifacts/bizportal/src/pages/accounting/coa-governance.tsx`

A 4th tab "AI Recommendation" is added to the existing 3-tab Tabs component.

**Contents:**
- Rule Recommendation → `/ai/review/recommendations`
- Learning Recommendation → `/ai/review/learning`
- COA Recommendation → `/ai/review/statistics`
- Proposal Recommendation → `/ai/review`

---

## Finance Hub Integration (Phase 7)

**File:** `artifacts/bizportal/src/pages/finance/index.tsx`

An "AI Center" card is added to the ModuleHub cards grid:
- Href: `/ai/review`
- Description: "Learning patterns, recommendations, statistics"

---

## Component Structure

```
pages/ai-review/
  index.tsx              — Hub with Learning Center section
  learning.tsx           — Learning patterns list
  learning-detail.tsx    — Single pattern detail
  recommendations.tsx    — Recommendations list
  recommendation-detail.tsx — Single recommendation detail
  statistics.tsx         — Statistics dashboard

hooks/
  useAiLearning.ts       — React Query hooks

lib/
  ai-learning-api.ts     — API client types + functions
```

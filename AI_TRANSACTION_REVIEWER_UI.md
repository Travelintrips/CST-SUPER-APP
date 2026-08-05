# AI Transaction Reviewer UI

## Overview

The AI Transaction Reviewer UI is a frontend module inside **BizPortal** that lets authorised finance staff review, validate, and decide on AI-generated transaction classification recommendations. It is the human-in-the-loop layer for the Phase 10 AI Transaction Intelligence backend.

---

## Architecture

```
BizPortal (React + Vite)
  ├── src/lib/ai-review-api.ts          ← Typed API client + UI helpers
  ├── src/hooks/useAiReview.ts          ← React Query hooks (query & mutation)
  ├── src/components/ai-review/
  │   ├── index.ts                      ← Barrel exports
  │   ├── ConfidenceBar.tsx             ← Visual confidence bar
  │   ├── FieldRow.tsx                  ← Label/value detail row
  │   ├── SlaChip.tsx                   ← SLA badge + inline indicator
  │   ├── CoaSelector.tsx               ← Searchable COA picker
  │   └── AiReviewPermissionGuard.tsx   ← Role-based render guard
  └── src/pages/ai-review/
      ├── index.tsx                     ← Module hub (landing)
      ├── queue.tsx                     ← Review queue list + filters
      ├── detail.tsx                    ← Full case detail + all action dialogs
      └── observability.tsx             ← Metrics dashboard + charts
```

All pages are registered in `src/routes.tsx` under `/ai/review/*` and wrapped with `ProtectedRoute` (authentication required).

---

## Pages

### Review Queue (`/ai/review`)

- Paginated, filterable table of all review cases
- Filters: status, queue, priority, risk level, transaction ID, date range
- Per-page: 10 / 25 / 50 rows
- Summary cards: open, high-risk, overdue, unassigned, assigned-to-me, due-today
- Auto-refreshes every 60 s
- Click any row → navigate to Detail

### Review Detail (`/ai/review/:id`)

Tabs:
1. **Transaksi & AI** — transaction fields, AI recommendation, confidence breakdown, alternative COAs, explainability, anomaly findings, policy decision
2. **Keputusan** — current outcome and reviewer decision if resolved
3. **Snapshot** — version history with diff comparison
4. **Audit** — append-only event timeline

Action buttons (visible based on case status):
| Button | Available when | Sends |
|---|---|---|
| Mulai Review | QUEUED / ASSIGNED | `POST .../start-review` |
| Setujui | IN_REVIEW | decision `APPROVE_RECOMMENDATION` |
| Ubah COA | IN_REVIEW | decision `CHANGE_COA` |
| Tolak | IN_REVIEW | decision `REJECT_RECOMMENDATION` |
| Minta Info | IN_REVIEW | decision `REQUEST_INFORMATION` |
| Eskalasi | IN_REVIEW | decision `ESCALATE` |
| Tugaskan | any | `POST .../assign` |
| Evaluasi Ulang | admin / finance | `POST .../reevaluate` |

### Observability (`/ai/review/observability`)

Metrics: total cases, open, overdue, manual review rate, approval rate, COA change rate, rejection rate, escalation rate, agreement rate, avg review duration, SLA compliance.

Charts: cases by queue (bar), by priority (bar), by status (pie), by anomaly risk (bar, colour-coded by severity).

---

## React Query Hooks (`useAiReview.ts`)

| Hook | Purpose |
|---|---|
| `useAiReviewCases(filters)` | List cases, 60 s auto-refresh |
| `useAiReviewDetail(id)` | Single case with full AI analysis |
| `useAiReviewSnapshots(id)` | Version history |
| `useAiReviewAudit(id)` | Append-only audit log |
| `useAiReviewObservability()` | System metrics, 120 s auto-refresh |
| `useAiLearningFeedback()` | Pending AI feedback (admin) |
| `useAiRulePackages()` | Rule package list |
| `useStartReview(caseId)` | Mutation: start review |
| `useAssignReviewer(caseId)` | Mutation: assign reviewer |
| `useSubmitDecision(caseId)` | Mutation: submit decision |
| `useReevaluateCase(caseId)` | Mutation: trigger reevaluation |

Query keys are exported via `aiReviewKeys` for consistent invalidation.

---

## Reusable Components

### `ConfidenceBar`
Visual progress bar for confidence values (0–1 or 0–100). Colour-coded: green ≥90 %, blue ≥75 %, yellow ≥60 %, red <60 %.

### `FieldRow`
Two-column label / value row used inside detail cards.

### `SlaChip` / `SlaIndicator`
Badge showing SLA status. `SlaChip` includes a Clock icon (use in headers). `SlaIndicator` is text-only (use in table rows).

### `CoaSelector`
Searchable COA picker with optional AI-ranked candidate list. Falls back to free-text when no candidates are present. No hardcoded COA values — all data flows from props.

### `AiReviewPermissionGuard` / `AdminOnlyGuard`
Render guard that hides content for unauthorised roles. **Not a security boundary** — all access control is enforced server-side. Roles: `admin | finance | accounting | treasury | tax | payroll`.

---

## Typed API Client (`ai-review-api.ts`)

Wraps all `/api/ai-transaction/…` endpoints with full TypeScript types. Key exports:

- Types: `AIReviewCase`, `AIReviewDetail`, `AIReviewSnapshot`, `AIReviewAuditEvent`, `AIReviewObservability`, `AIReviewFilters`, `AIReviewDecisionPayload`, `AIReviewAssignPayload`, `AIReevaluatePayload`
- Constants: `STATUS_LABELS`, `STATUS_COLORS`, `PRIORITY_LABELS`, `PRIORITY_COLORS`, `QUEUE_LABELS`, `RISK_LEVEL_COLORS`, `REASON_CODE_LABELS`, `AUDIT_EVENT_LABELS`, `TERMINAL_STATUSES`
- Helpers: `maskAccountNumber`, `confidenceLabel`, `confidencePct`, `isTerminalStatus`

---

## Safety Constraints (enforced at every layer)

| Constraint | How enforced |
|---|---|
| No hardcoded COA | `CoaSelector` accepts values via props only |
| No hardcoded reviewer | `AssignDialog` takes free-text / user input |
| No hardcoded company | `companyId` not in any filter or payload — backend enforces isolation |
| No financial side effect | Disclaimer shown in every decision dialog: "Keputusan ini tidak otomatis memposting jurnal atau merekonsiliasi transaksi." |
| No direct DB access | All data via `/api/ai-transaction/…` REST endpoints |
| Permissions follow backend | `AiReviewPermissionGuard` mirrors backend `FINANCE_ROLES`; server validates on every request |
| Company isolation | Backend attaches `companyId` from session; frontend never passes it |

---

## Idempotency

Every decision and assignment mutation uses `crypto.randomUUID()` to generate an `idempotencyKey`. The same key is sent on retry, preventing duplicate actions. `Math.random()` is never used for this purpose.

---

## Accessibility

- Confidence bars include `role="progressbar"` with `aria-valuenow/min/max`
- All form fields have explicit `<label>` elements or `aria-label` props
- Dialog titles are descriptive and colour-coded by action severity
- Responsive layout: queue uses horizontal scroll on small screens; detail uses responsive grid

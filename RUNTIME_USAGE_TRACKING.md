# Runtime Usage Tracking — Bank Reconciliation Configuration

## Overview

This document describes the runtime usage tracking system for Bank Reconciliation Classification Configurations.
Tracking is **best-effort telemetry**: it never throws, never blocks the main transaction, and is always
fired post-commit (fire-and-forget). A tracking failure produces a warning log but does NOT roll back
the reconciliation or journal.

---

## 1. Hook Points

| Hook | File | Trigger |
|------|------|---------|
| `trackMutationApproval` | `lib/usageTrackingService.ts` | POST `/api/bank-reconciliation/:mutationId/approve` — after `res.json(responseBody)` |
| `trackConfigUsageByCode` | `lib/usageTrackingService.ts` | Explicit call when config code is known upstream |
| `trackAiRuleFeedback` | `lib/usageTrackingService.ts` | Explicit call when user accepts/rejects AI recommendation |

---

## 2. Event Model

Table: `recon_config_usage_events`

| Column | Type | Description |
|--------|------|-------------|
| `id` | BIGSERIAL PK | Auto-increment |
| `company_id` | INTEGER nullable | Company scope (NULL = global) |
| `usage_type` | TEXT | `config`, `keyword`, `ai_rule` |
| `target_id` | INTEGER | ID in the respective table |
| `mutation_id` | INTEGER nullable | Source bank mutation |
| `reconciliation_id` | INTEGER nullable | Reserved for future linkage |
| `event_type` | TEXT | `approved`, `rejected`, `corrected` |
| `actor_user_id` | TEXT | Email/ID of the user who triggered |
| `amount` | NUMERIC(15,2) nullable | Transaction amount |
| `used_at` | TIMESTAMPTZ | When the event occurred |
| `idempotency_key` | TEXT NOT NULL | Deduplication key |
| `created_at` | TIMESTAMPTZ | Row creation time |

---

## 3. Idempotency

**Problem**: A user double-clicks Approve, or the client retries a failed request. Without deduplication,
`usage_count` would increment multiple times for the same real-world action.

**Solution**: Every tracking call first inserts a row into `recon_config_usage_events` using:

```sql
INSERT INTO recon_config_usage_events (..., idempotency_key)
VALUES (...)
ON CONFLICT (COALESCE(company_id, -1), idempotency_key) DO NOTHING
```

The aggregate counter is **only incremented if the INSERT succeeded** (rowCount > 0). If the row already
exists (duplicate event), the function returns early without touching the aggregate.

**Key format**:

| Event | Idempotency key |
|-------|-----------------|
| Config match | `config:{configId}:{mutationId}` |
| Keyword match | `keyword:{keywordId}:{mutationId}` |
| AI rule match | `ai_rule:{ruleId}:{mutationId}` |
| AI feedback | `ai_rule_feedback:{ruleId}:{mutationId}:{eventType}` |

**Guarantee**: Same reconciliation action retried 10× → `usage_count` increments exactly 1×.

---

## 4. Transaction Boundary

**Model B — Post-commit fire-and-forget**:

```
Core reconciliation transaction commits
        ↓
res.json(responseBody)  ← client receives 200
        ↓
trackMutationApproval(...).catch(() => {})  ← async, non-blocking
```

- Tracking runs **after** the core transaction commits.
- A tracking failure is logged as `warn` and does NOT affect the response or journal.
- Retries of tracking are idempotent (see §3).

---

## 5. Metrics Definitions

### recon_classification_configs

| Column | Definition |
|--------|------------|
| `usage_count` | Total approved reconciliations where this config was matched |
| `last_used_at` | Timestamp of most recent match |
| `last_used_by` | Email/ID of actor in most recent match |
| `last_match_amount` | Amount of most recently matched mutation |
| `last_match_date` | Date of most recently matched mutation |

### recon_ai_classification_rules

| Column | Definition |
|--------|------------|
| `usage_count` | Times rule matched mutation description |
| `accepted_count` | Times user accepted AI recommendation |
| `rejected_count` | Times user rejected/corrected AI recommendation |
| `last_used_at` | Most recent match timestamp |

**Acceptance rate** = `accepted_count / (accepted_count + rejected_count)`.
**Do NOT display acceptance rate if denominator = 0.**

### recon_keyword_dictionary

| Column | Definition |
|--------|------------|
| `usage_count` | Times keyword appeared in an approved reconciliation |
| `last_used_at` | Most recent appearance timestamp |

---

## 6. Category Tracking

Triggered by `trackMutationApproval`. Flow:
1. Fetch all active keywords for the company.
2. Match keywords against normalized mutation description (lowercase, trimmed).
3. If any keyword has a `config_id`, that config is the best match (highest weight wins).
4. Fallback: scan `recon_classification_configs.keywords` inline array (by priority).
5. Atomically increment `usage_count` of the winning config **once per mutation**.

---

## 7. Keyword Tracking Policy

**All keywords** that match the mutation description are recorded (not just the winner).
This is intentional: it gives signal on which keywords appear most in accepted reconciliations.

Keyword usage is **idempotency-gated**: if the same mutation+keyword combination was already recorded,
the increment is skipped.

---

## 8. AI Rule Outcomes

`trackMutationApproval` increments `usage_count` for every AI rule whose condition matches the description.

`trackAiRuleFeedback` is called separately (with explicit `accepted: boolean`) to update:
- `accepted_count` — user accepted the AI recommendation
- `rejected_count` — user rejected or corrected the recommendation

These are distinct from `usage_count` (which only reflects matching, not user decision).

---

## 9. Upload Tracking

Upload requirement tracking (`need_upload` on the config) is reflected in the config's `usage_count`
when that config is matched. There is no separate `file_uploaded` event at this time — the distinction
between `rule_applied` and `file_uploaded` is noted in the code as a future improvement.

---

## 10. Approval Tracking

Approval rule tracking (`recon_approval_rules_config`) is not yet separately instrumented.
The config's `usage_count` reflects that the config was used; approval rule–level outcomes
(approved, rejected, escalated, expired) are a planned follow-up.

---

## 11. Dashboard

Endpoint: `GET /api/recon-classification/usage-stats`

Auth: `requireAdmin` (same as all other recon-classification routes)

Query params: `company_id` (optional), `limit` (default 10, max 100)

Response shape:
```json
{
  "summary": {
    "totalUsage": 42,
    "usageToday": 3,
    "usageThisMonth": 18,
    "activeCategories": 33,
    "neverUsedCategories": 7
  },
  "mostUsedCategories": [...],
  "leastUsedCategories": [...],
  "neverUsedCategories": [...],
  "topRules": [...],
  "topKeywords": [...],
  "recentUsage": [...]
}
```

Performance: all queries use aggregate functions with LIMIT. No N+1. No unbounded scans.

---

## 12. Failure Behavior

| Scenario | Outcome |
|----------|---------|
| `recon_config_usage_events` INSERT fails | Warning logged, aggregate not incremented |
| `recon_classification_configs` UPDATE fails | Warning logged |
| Entire `trackMutationApproval` throws | `catch(() => {})` swallows the error, reconciliation unaffected |
| DB temporarily unavailable for tracking | Warning logged; event can be re-tracked next approve (idempotency prevents double-count) |

**Rule**: tracking failure NEVER rolls back reconciliation or journal.

---

## 13. Performance

- All aggregate UPDATEs target PRIMARY KEY — no table scans.
- Keyword batch update: single `UPDATE ... WHERE id IN (...)`.
- Idempotency table uses a unique index on `(COALESCE(company_id, -1), idempotency_key)`.
- Dashboard uses `COUNT(*)`, `SUM()`, and simple ORDER BY with LIMIT — no N+1.
- No table-wide locks.

---

## 14. Runtime UAT (Development DB)

### A. Business Matching
1. Find an unmatched mutation with a description matching a known keyword.
2. Approve it via POST `/api/bank-reconciliation/:id/approve`.
3. Verify `usage_count` incremented by 1 in `recon_classification_configs`.
4. Approve same mutation again → `usage_count` stays the same (idempotency).

### B. Failure Injection
1. Temporarily disconnect the tracking table (rename or revoke permissions).
2. Approve a mutation.
3. Verify: reconciliation returns 200, journal posted, `usage_count` unchanged, warning in logs.
4. Restore tracking table.

### C. Cross-company
1. Create configs with different `company_id`.
2. Approve mutations in company A.
3. Verify company B configs are not incremented.

---

## 15. Tests

File: `artifacts/api-server/src/__tests__/usage-tracking.test.ts`

Run: `pnpm --filter @workspace/api-server exec vitest run --reporter=verbose --testPathPattern=usage-tracking`

Covers:
- Successful match increments once
- Retry 10× increments once (idempotency)
- Concurrent parallel calls increment once
- Company A does not affect company B
- AI rule accepted/rejected counters
- Keyword usage increment
- Failure isolation (non-existent IDs)
- Dashboard company scope
- Never-used query
- Most-used ordering
- Migration idempotency

---

## 16. TypeScript & Builds

Run sequence:
```bash
pnpm run build:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/bizportal run typecheck
pnpm --filter @workspace/api-server run build
```

---

## 17. Remaining Limitations

1. **Approval rule tracking**: approval outcome (approved/rejected/escalated/expired) per `recon_approval_rules_config` row is not yet tracked. Only the parent config's `usage_count` reflects indirect usage.
2. **Upload event tracking**: no separate `file_uploaded` event. The spec's distinction between `rule_applied` and `file_uploaded` is noted as a future enhancement.
3. **Routine expense / income allocation hooks**: only the bank reconciliation approve endpoint currently fires `trackMutationApproval`. Routine expense and income allocation flows do not yet call the tracking service directly.
4. **AI feedback integration**: `trackAiRuleFeedback` is implemented and tested but is not yet wired into any UI action (it requires an explicit call from the AI recommendation acceptance flow).

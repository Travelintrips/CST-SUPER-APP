# Runtime Usage Tracking — Bank Reconciliation Configuration

## Overview

Idempotent, best-effort telemetry layer that records how bank reconciliation classification configs,
keywords, and AI rules are used at runtime. **Never blocks or rolls back the core transaction.**

---

## 1. Migration

`runUsageTrackingMigration()` — `artifacts/api-server/src/lib/usageTrackingService.ts`

Creates (all idempotent — `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`):

| Object | Purpose |
|---|---|
| `recon_config_usage_events` | Idempotency event table; one row per (company, idempotency_key) |
| `idx_recon_usage_events_idempotency` | UNIQUE on `(COALESCE(company_id,-1), idempotency_key)` |
| `idx_recon_usage_events_target` | Fast lookup by usage_type + target_id |
| `idx_recon_usage_events_mutation` | Partial index on mutation_id |
| `recon_classification_configs.usage_count` | Times matched in an approved reconciliation |
| `recon_classification_configs.last_used_at/by/amount/date` | Last-match metadata |
| `recon_keyword_dictionary.usage_count` | Times keyword matched in an approved reconciliation |
| `recon_keyword_dictionary.last_used_at` | Last match timestamp |
| `recon_ai_classification_rules.usage_count` | Times rule matched |
| `recon_ai_classification_rules.accepted_count` | Times user explicitly accepted recommendation |
| `recon_ai_classification_rules.rejected_count` | Times user explicitly rejected recommendation |
| `bank_mutations.recon_config_code` | Writeback for which config was matched |

---

## 2. Startup Wiring

`artifacts/api-server/src/index.ts` line 1694:

```
.then(() => runWithRetry("Bank reconciliation core migration", runBankReconciliationCoreMigration))
.then(() => runWithRetry("Usage tracking migration", runUsageTrackingMigration))   // ← here
.then(() => runWithRetry("Bank mutation masters migration", runBankMutationMastersMigration))
```

- Runs once per startup, after DB is ready, before routes accept traffic.
- Idempotent — safe to run on every restart.
- `runWithRetry` wraps with 3 retries and exponential backoff.
- Failure is logged but does NOT abort server startup (non-fatal by runWithRetry policy).

---

## 3. Usage Event Schema

```sql
recon_config_usage_events (
  id              BIGSERIAL PRIMARY KEY,
  company_id      INTEGER,                          -- NULL = system-level
  usage_type      TEXT NOT NULL,                    -- 'config' | 'keyword' | 'ai_rule'
  target_id       INTEGER NOT NULL,                 -- FK to the tracked entity
  mutation_id     INTEGER,                          -- source bank mutation (for idempotency)
  reconciliation_id INTEGER,                        -- reserved for future use
  event_type      TEXT NOT NULL DEFAULT 'approved', -- 'approved' | 'rejected' | 'corrected'
  actor_user_id   TEXT,                             -- email of acting user
  amount          NUMERIC(15,2),                    -- transaction amount if known
  used_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  idempotency_key TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```

---

## 4. Idempotency

Every tracking call first inserts into `recon_config_usage_events`:

```sql
INSERT INTO recon_config_usage_events (..., idempotency_key)
VALUES (...)
ON CONFLICT (COALESCE(company_id, -1), idempotency_key) DO NOTHING
```

- `INSERT` succeeds (rowCount > 0) → aggregate counter is incremented.
- `INSERT` conflicts (rowCount = 0) → duplicate event, counter is NOT incremented.

Idempotency key format:
| Tracking type | Key format |
|---|---|
| Config via mutation | `config:{configId}:{mutationId}` |
| Config by code | `config:{configId}:{mutationId}` (or timestamp-based if no mutation) |
| Keyword | `keyword:{kwId}:{mutationId}` |
| AI rule (usage) | `ai_rule:{ruleId}:{mutationId}` |
| AI rule (feedback) | `ai_rule_feedback:{ruleId}:{mutationId}:{approved\|rejected}` |

**Guarantee:** retrying the same approve action 10× results in exactly 1 increment.
Concurrent parallel calls with the same mutationId also result in exactly 1 increment
(tested in `Concurrent safety` test suite).

---

## 5. Hook Timing

Tracking is invoked **only after the core transaction commits successfully**.

### Bank Reconciliation Approve

`artifacts/api-server/src/routes/bankReconciliation.ts` line 874:

```typescript
// Fire-and-forget — never blocks or rolls back the journal
trackMutationApproval({
  mutationId: resolvedMutId,
  actor,
  companyId: (req as any).user?.companyId ?? null,
}).catch(() => {});
```

Called after `approveAndCreateJournal()` succeeds. Tracks:
- Matching classification config (via keyword dictionary then inline keyword scan)
- All matching keywords in the dictionary
- All matching AI rules (condition-based)

**Not tracked:**
- Preview / recommend-only responses
- Failed approvals (result.ok === false)
- Manual review rejections
- Rollbacks / unapprove

### AI Rule Feedback (explicit user signal)

`POST /api/recon-classification/ai-rules/feedback`

```json
{ "rule_id": 42, "mutation_id": 1234, "accepted": true }
```

Called by the frontend after the user explicitly accepts or rejects an AI recommendation.
Updates `accepted_count` or `rejected_count` on the rule (not `usage_count`).

---

## 6. Service Contract

`artifacts/api-server/src/lib/usageTrackingService.ts`

| Export | Description |
|---|---|
| `trackMutationApproval(opts)` | Main hook — call after approve succeeds. Tracks config + keywords + AI rules. |
| `trackConfigUsageByCode(opts)` | Explicit increment when config_code is already known from a prior step. |
| `trackAiRuleFeedback(opts)` | Records accepted/rejected user signal on a specific AI rule. |
| `runUsageTrackingMigration()` | Idempotent DDL migration. |

All public functions:
- Are `async` and return `Promise<void>`
- Never throw — wrap in try/catch, log warnings on error
- Are company-scoped via `companyId` parameter
- Accept explicit `targetId` — never infer IDs from names
- Use atomic `UPDATE … SET col = col + 1 WHERE id = ?` — no table locks
- Do NOT touch accounting engine, journal reuse engine, or COA governance

---

## 7. Dashboard API

`GET /api/recon-classification/usage-stats`

Auth: requireAdmin. Query params: `company_id` (optional), `limit` (default 10, max 100).

Response:
```json
{
  "summary": {
    "totalUsage": 1234,
    "usageToday": 12,
    "usageThisMonth": 340,
    "activeCategories": 45,
    "neverUsedCategories": 8
  },
  "mostUsedCategories": [...],
  "leastUsedCategories": [...],
  "neverUsedCategories": [...],
  "topRules": [...],
  "topKeywords": [...],
  "recentUsage": [...]
}
```

All queries use LIMIT — no unbounded scans. No N+1 queries.

---

## 8. Frontend

`artifacts/bizportal/src/pages/finance/recon-config/index.tsx`

- `UsageStatsTab` component (line 963) — fetches `/api/recon-classification/usage-stats`
- Registered as `<TabsContent value="stats">` (line 1272)
- Tab label: **Statistik Penggunaan** (BarChart2 icon)
- Shows: summary cards (5), most used, never used, top AI rules with acceptance rate, top keywords, recent activity table
- States: loading spinner, error banner, empty states per section
- Acceptance rate computed client-side: `accepted / (accepted + rejected)`, only shown when denominator > 0
- Company-scoped query key via `activeCompanyId`

Per-row usage indicator in ConfigTab (line 243):
```tsx
{row.usage_count > 0 && (
  <span className="ml-1 text-xs text-slate-500">({row.usage_count}× dipakai)</span>
)}
```

---

## 9. Deactivation Guard

`POST /api/recon-classification/configs/:id/deactivate`

| Scenario | Behavior |
|---|---|
| `usage_count = 0` | Deactivated silently, `warning: null` |
| `usage_count > 0` | Deactivated, response includes `warning` message + `usage_count` |
| Hard DELETE (no endpoint) | No hard-delete route exists for configs — history permanently preserved |

Seed configs (`is_seed = true`) follow the same policy (no special block).

---

## 10. Failure Handling

If `trackMutationApproval` or any tracking function throws:
- Error is caught inside the function (try/catch)
- Warning is logged via `logger.warn()`
- The function returns without throwing
- The caller's `.catch(() => {})` suppresses any remaining rejection
- **Reconciliation result, journal entry, and accounting entries are completely unaffected**

Tested in `Failure isolation` suite (tests 14-16): all three public functions resolve without throwing even with invalid/non-existent IDs.

---

## 11. Runtime UAT Results

See `FINAL_RUNTIME_USAGE_TRACKING_REPORT.md` for full UAT results.

---

## 12. Performance

- All `UPDATE` statements target primary key — O(1), no table scans.
- Keyword batch `UPDATE … WHERE id IN (…)` uses matched IDs only — bounded by keyword list size.
- Idempotency `INSERT … ON CONFLICT DO NOTHING` — no row-level lock contention.
- Dashboard queries all have `LIMIT` — no unbounded scans.
- Events table has 3 targeted indexes.

---

## 13. TypeScript

No new TypeScript errors introduced by usage tracking code. Pre-existing errors in other files
(logger.error overload mismatches in reconClassificationConfig.ts, unbuilt lib deps) are unrelated.

---

## 14. Build

`pnpm --filter @workspace/api-server run build` — exits 0. esbuild bundles to `dist/index.mjs` (16.9 MB).

---

## 15. Tests

`artifacts/api-server/src/__tests__/usage-tracking.test.ts` — **19/19 PASS**

| # | Test | Result |
|---|---|---|
| 1 | Migration idempotent (runs twice) | ✅ PASS |
| 2 | Creates recon_config_usage_events table | ✅ PASS |
| 3 | recon_classification_configs has usage_count | ✅ PASS |
| 4 | recon_ai_classification_rules has accepted/rejected_count | ✅ PASS |
| 5 | trackMutationApproval increments config usage_count by 1 | ✅ PASS |
| 6 | Same mutation approved 10× → exactly 1 increment | ✅ PASS |
| 7 | trackConfigUsageByCode same mutationId twice → once | ✅ PASS |
| 8 | 10 parallel calls same mutationId → exactly 1 increment | ✅ PASS |
| 9 | Company A usage does NOT affect Company B config | ✅ PASS |
| 10 | accepted recommendation → increments accepted_count | ✅ PASS |
| 11 | rejected recommendation → increments rejected_count only | ✅ PASS |
| 12 | Same feedback + same mutationId → idempotent | ✅ PASS |
| 13 | Matched keyword usage_count increments on approval | ✅ PASS |
| 14 | Non-existent mutationId does not throw | ✅ PASS |
| 15 | Non-existent ruleId does not throw | ✅ PASS |
| 16 | Unknown config code does not throw | ✅ PASS |
| 17 | Usage events isolated per company in events table | ✅ PASS |
| 18 | Never-used query returns configs with usage_count = 0 | ✅ PASS |
| 19 | Most-used ordering returns highest usage_count first | ✅ PASS |

---

## 16. Remaining Limitations

- `accepted_count` / `rejected_count` on AI rules requires the frontend to POST to
  `/api/recon-classification/ai-rules/feedback` after showing the user an AI recommendation.
  The approve flow does not currently pass the recommended rule ID.
- Upload rule and approval rule usage tracking is not implemented (would require hooks
  in document upload and approval routing flows respectively).
- `trackMutationApproval` tracks all keyword/AI-rule/config matches, not just the "winning" one.
  This gives signal on which entities appear most in approved reconciliations.

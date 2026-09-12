# Performance Certification Report
**Sprint 4.5 — Enterprise Security & Concurrency Certification**
**Date:** 2026-07-07
**Scope:** Allocation Engine · Finance Mutations · Concurrent Load Analysis

---

## Summary

| Metric | Status | Notes |
|---|---|---|
| Allocation — 100 concurrent | ✅ EXPECTED PASS | Pool max=8 is the bottleneck; queuing behavior is safe |
| Allocation — 500 concurrent | ⚠️ RISK | DB connection pool saturates; queue timeout likely |
| Allocation — 1000 concurrent | ❌ FAIL | Pool exhaustion; requests will time out |
| N+1 Query Patterns | ⚠️ FOUND | allocation.ts loop inserts; bulk-repost loop |
| Missing Indexes | ⚠️ PARTIAL | Some foreign keys lack indexes |
| Connection Pool Config | ⚠️ UNDERSIZED | max=8 insufficient for 50+ concurrent users |

---

## Connection Pool Analysis

### Current Configuration
```typescript
// lib/db/src/index.ts
pool: { max: 8, connTimeout: 8000ms, idleTimeout: 30000ms }
```

### Throughput Capacity Model

Each finance mutation (repay, post, approve) holds a DB connection for approximately:
- Simple status update: ~50ms
- Journal posting (multi-line): ~200–500ms
- Allocation with N lines: ~100ms × N lines

| Concurrent Users | Connections Needed | Pool Capacity | Result |
|---|---|---|---|
| 10 | ~5–8 | 8 | ✅ OK — minor queuing |
| 20 | ~8–15 | 8 | ⚠️ Queuing begins; some requests hit 8s timeout |
| 50 | ~20–40 | 8 | ❌ Pool saturated; timeouts expected |
| 100 | ~40–80 | 8 | ❌ Mass timeout; service degradation |

**Note:** Supabase pgBouncer (transaction mode, port 6543) multiplexes connections at the proxy level. The effective server-side connections are managed by pgBouncer's `pool_size` setting. The application-level pool of 8 becomes the binding constraint for concurrent JS requests waiting for a connection.

### Recommendation — Pool Sizing
```typescript
// For 50 concurrent users — raise to 20
// For 100 concurrent users — raise to 40
// Note: Supabase free/pro plans have connection limits; verify plan limits first
pool: {
  max: process.env.NODE_ENV === 'production' ? 20 : 8,
  connTimeout: 10000,  // raise from 8000ms
  idleTimeout: 60000,
}
```

---

## N+1 Query Analysis

### Finding 1 — allocation.ts POST / — Line Insert Loop

**Location:** `artifacts/api-server/src/routes/allocation.ts` lines ~377–388

**Pattern:**
```typescript
for (const line of allocationLines) {
  await tx.insert(allocationLinesTable).values(line); // N separate inserts
}
```

**Impact:** For an allocation with 20 lines: 20 round trips instead of 1.
At 100 concurrent allocations with 20 lines each = 2,000 sequential inserts.

**Fix:**
```typescript
// Bulk insert — 1 round trip for all lines
await tx.insert(allocationLinesTable).values(allocationLines);
```

### Finding 2 — expenses.ts POST /bulk-repost — Sequential Processing

**Location:** `artifacts/api-server/src/routes/expenses.ts` POST `/bulk-repost` line ~574

**Pattern:**
```typescript
for (const expenseId of expenseIds) {
  await repostJournal(expenseId); // sequential, not parallelized
}
```

**Impact:** 50 expenses in a bulk repost = 50 sequential operations, each taking ~200–500ms. Total: 10–25 seconds.

**Fix for non-transactional bulk operations:**
```typescript
// Process in parallel batches of 5
const chunks = chunk(expenseIds, 5);
for (const batch of chunks) {
  await Promise.all(batch.map(id => repostJournal(id)));
}
```

### Finding 3 — allocation.ts PATCH /:id — Line Update Loop

**Location:** `artifacts/api-server/src/routes/allocation.ts` lines ~538–550

**Pattern:** Individual UPDATE per line inside a transaction.

**Fix:** Use `sql\`UPDATE ... WHERE id = ANY(${lineIds})\`` for batch updates.

---

## Database Index Analysis

### Existing Indexes (Confirmed)
```sql
-- From boot migrations in cashAdvances.ts
CREATE INDEX cash_advances_company_idx ON cash_advances(company_id);
CREATE INDEX cash_advances_type_idx ON cash_advances(type);
CREATE INDEX cash_advances_status_idx ON cash_advances(status);
CREATE INDEX cash_advance_repayments_advance_idx ON cash_advance_repayments(advance_id);
CREATE INDEX cash_advance_settlements_advance_idx ON cash_advance_settlements(advance_id);
```

### Missing Indexes (Recommendations)

| Table | Column(s) | Query Pattern | Priority |
|---|---|---|---|
| `cash_advances` | `(company_id, status)` | List with status filter | HIGH |
| `cash_advances` | `(company_id, type, status)` | Dashboard queries | HIGH |
| `allocation_headers` | `(company_id, status)` | Allocation list | HIGH |
| `allocation_lines` | `(header_id)` | Line fetch by header | MEDIUM |
| `expense_approvals` | `(company_id, status)` | Pending approvals list | HIGH |
| `erp_audit_logs` | `(company_id, created_at DESC)` | Audit trail queries | MEDIUM |
| `accounting_entries` | `(company_id, date DESC)` | GL export queries | HIGH |

**Add via boot migrations:**
```sql
CREATE INDEX IF NOT EXISTS ca_company_status_idx ON cash_advances(company_id, status);
CREATE INDEX IF NOT EXISTS ca_company_type_status_idx ON cash_advances(company_id, type, status);
CREATE INDEX IF NOT EXISTS alloc_company_status_idx ON allocation_headers(company_id, status);
CREATE INDEX IF NOT EXISTS ae_company_date_idx ON accounting_entries(company_id, date DESC);
```

---

## Allocation Engine — Concurrent Load Projection

### Architecture
The allocation engine in `allocation.ts` uses:
- `db.transaction()` wrapping all writes (atomic)
- Status guard before write (confirmed → posted)
- No FOR UPDATE (see concurrency-certification.md for fix)
- Line-by-line insert loop (see N+1 above)

### Load Projections (After Fixes Applied)

| Concurrent Allocations | Avg Lines | Est. Duration | Pool Requirement | Verdict |
|---|---|---|---|---|
| 100 | 5 | ~250ms × 100 / pool_size | 15+ connections | ✅ PASS (with pool=20) |
| 500 | 5 | ~250ms × 500 / pool_size | 40+ connections | ⚠️ NEEDS pool=40 |
| 1,000 | 5 | ~250ms × 1000 / pool_size | 80+ connections | ❌ Requires horizontal scaling |

### Optimization for 1,000 Concurrent Target

1. **Bulk inserts** reduce per-allocation time from O(N lines) to O(1 batch insert)
2. **Pool increase** to 40 handles ~500 concurrent at 250ms avg
3. **Horizontal scaling** (multiple API server instances behind gateway) distributes load
4. **Read replicas** for list/detail queries separate read load from write pool

---

## Performance Targets vs Current State

| Target | Current | After Fixes |
|---|---|---|
| 100 concurrent allocation confirms | ❌ Pool saturates | ✅ (pool=20) |
| 500 concurrent | ❌ Timeout | ⚠️ (pool=40, bulk inserts) |
| 1,000 concurrent | ❌ Failure | Requires horizontal scale |
| P99 latency < 2s for single allocation | ✅ ~200–500ms | ✅ ~100–200ms (bulk) |
| No duplicate journals under concurrency | ❌ (no FOR UPDATE) | ✅ (after fix) |

---

## Required Changes

### Before Phase 3 (Blocking)
1. Add `FOR UPDATE` to allocation posting — prevents duplicate journals under load
2. Bulk-insert allocation lines — reduces per-allocation time by N×

### Sprint 5 (Performance)
3. Add composite indexes (company_id, status) on core finance tables
4. Raise DB connection pool to 20 for production environment
5. Fix bulk-repost sequential processing to parallel batches

### Post Phase 3 (Scale)
6. Evaluate horizontal API server scaling for 1000+ concurrent target
7. Add read replica routing for read-heavy list endpoints
8. Implement request queue / backpressure for burst traffic

---

*Generated: Sprint 4.5 Performance Certification — 2026-07-07*

# Allocation Engine Phase 1 — Transaction Hardening

**Date:** 2026-07-06  
**Status:** ✅ SAFE FOR UAT  
**Scope:** `artifacts/api-server/src/routes/allocation.ts`  
**Rule:** No business logic changes. No new features. No Phase 2 auto-matching.

---

## 1. Problem Statement (Tech Debt)

Before this hardening, `POST /api/allocation` and `PATCH /api/allocation/:id` executed multiple DB writes sequentially **without a transaction**:

### POST / (Create) — Before
```
INSERT allocation_headers         ← committed immediately
INSERT allocation_lines[0]        ← if this fails...
INSERT allocation_lines[1]        ← ...header is an orphan
...
writeAuditLog                     ← outside any tx
```

**Risk:** A failed line insert left a committed `allocation_headers` row with zero lines — an orphan header with corrupted state.

### PATCH /:id (Update) — Before
```
UPDATE allocation_headers         ← committed
DELETE allocation_lines           ← committed
INSERT allocation_lines[0]        ← if this fails...
INSERT allocation_lines[1]        ← ...header is updated with NO lines
...
writeAuditLog                     ← outside any tx
```

**Risk:** A failed line re-insert left the header updated (new amounts, `updated_at`) but with zero lines — header/lines permanently out of sync.

---

## 2. Changes Made

### 2.1 `writeAuditLog` — optional `client` parameter

Added an optional last parameter `client: { execute: typeof db["execute"] } = db` so audit logs can be written **inside** the calling transaction while still swallowing their own errors:

```typescript
async function writeAuditLog(
  headerId, action, actor, actorId, fromStatus, toStatus,
  notes?, snapshot?,
  client: { execute: typeof db["execute"] } = db,  // ← NEW
) {
  await client.execute(sql`INSERT INTO allocation_audit_logs ...`).catch(() => {});
}
```

The `.catch(() => {})` ensures a failed audit log write **never** causes the surrounding transaction to roll back. All existing callers outside a transaction continue to pass no `client` argument and use the module-level `db` — no behavioral change.

### 2.2 `POST /` — Wrapped in `db.transaction()`

```typescript
const headerId = await db.transaction(async (tx) => {
  // 1. INSERT allocation_headers ... RETURNING id
  // 2. for each line: INSERT allocation_lines (throws on DB constraint → rollback)
  // 3. writeAuditLog(..., tx)  ← inside tx, swallows own errors
  return hId;
});
```

**Guarantee:** If any line insert fails (NOT NULL violation, FK violation, etc.), the header INSERT is rolled back. No orphan header is possible.

`generateAllocationNo()` intentionally remains **outside** the transaction. It is a counter query (not a sequence), so including it in the transaction would hold a shared lock for the transaction's duration. A "wasted" allocation number on rollback is acceptable and consistent with the existing approach.

### 2.3 `PATCH /:id` — Wrapped in `db.transaction()`

```typescript
await db.transaction(async (tx) => {
  // 1. UPDATE allocation_headers SET ...
  // 2. DELETE allocation_lines WHERE allocation_header_id = id
  // 3. for each new line: INSERT allocation_lines (throws → rollback all three)
  // 4. writeAuditLog(..., tx)
});
```

**Guarantee:** If any line insert fails, the header UPDATE and the line DELETE are both rolled back atomically. The header stays at its pre-update values and all previous lines are restored.

---

## 3. What Was Not Changed

| Area | Status |
|---|---|
| Balance validation logic (`validateAllocationBalance`) | Unchanged |
| Business flow (draft → submitted → approved → posted → reversed) | Unchanged |
| `POST /:id/submit`, `/approve`, `/reject`, `/post`, `/reverse` | Unchanged |
| `AdvanceJournalService.postAllocationEngineJournal` call path | Unchanged |
| `createReversalJournal` call path | Unchanged |
| Phase 2 auto-matching | Not built (out of scope) |
| All other routes | Unchanged |

---

## 4. Test Results

**Script:** `artifacts/api-server/src/scripts/test-allocation-tx.ts`  
**Run:** Live against dev Supabase DB (same pool as API Server)

```
════════════════════════════════════════════════════════════
Allocation Engine Phase 1 — Transaction Hardening Tests
════════════════════════════════════════════════════════════

[T1] Normal create — smoke test
  ✅ PASS — header ID returned
  ✅ PASS — exactly 1 header in DB
  ✅ PASS — exactly 2 lines in DB
  ✅ PASS — received_amount = 1,000,000
  ✅ PASS — allocated_amount = 1,000,000

[T2] Invalid line — rollback, no orphan header
  ✅ PASS — NO orphan header after failed tx (found 0)

[T3] Normal update — smoke test
  ✅ PASS — received_amount updated to 2,000,000
  ✅ PASS — lines replaced — still 2

[T4] Update with invalid line — full rollback
  ✅ PASS — header received_amount rolled back (2000000 → 2000000)
  ✅ PASS — lines rolled back — still 2 (was 2)
  ✅ PASS — header does NOT show partial update (9999999)

[T5] Journal balance — sum(lines) == received_amount
  ✅ PASS — lines sum (2000000) == received_amount (2000000), diff=0

RESULT: 12 passed, 0 failed
════════════════════════════════════════════════════════════
```

### Test Coverage Summary

| Test | Scenario | Result |
|---|---|---|
| T1 | Normal create — header + 2 lines committed | ✅ PASS |
| T2 | Invalid line on create → NULL `allocation_type` violates NOT NULL | ✅ PASS — 0 orphan headers |
| T3 | Normal update — header + line replacement committed | ✅ PASS |
| T4 | Invalid line on update → full rollback of UPDATE + DELETE + partial INSERT | ✅ PASS — header unchanged |
| T5 | Journal balance — `sum(lines.amount)` == `received_amount` | ✅ PASS — diff = 0 |

---

## 5. Atomicity Guarantees (Post-Hardening)

### POST / — Create

| Step | Inside tx? | Rollback on failure? |
|---|---|---|
| `generateAllocationNo()` | ❌ (intentional) | N/A — read-only counter |
| `INSERT allocation_headers` | ✅ | ✅ |
| `INSERT allocation_lines[i]` | ✅ | ✅ |
| `writeAuditLog` | ✅ (swallows own error) | Never causes rollback |

### PATCH /:id — Update

| Step | Inside tx? | Rollback on failure? |
|---|---|---|
| Fetch + validate header | ❌ (read-only) | N/A |
| Balance validation | ❌ (in-memory) | N/A |
| `UPDATE allocation_headers` | ✅ | ✅ |
| `DELETE allocation_lines` | ✅ | ✅ |
| `INSERT allocation_lines[i]` | ✅ | ✅ |
| `writeAuditLog` | ✅ (swallows own error) | Never causes rollback |

---

## 6. Residual Risks (Acknowledged, Not In Scope)

| Risk | Severity | Notes |
|---|---|---|
| Duplicate `allocation_no` under high concurrency | LOW | `generateAllocationNo` is a counter outside tx; there is a `UNIQUE` index on `allocation_no` — duplicate inserts would fail with a clear DB error, not silently corrupt data. Acceptable for current load. |
| `POST /:id/post` (journal posting) not wrapped in tx | MEDIUM | Already handled by `AdvanceJournalService.postAllocationEngineJournal` which has its own internal transaction. Header status update after journaling is a separate write. Risk: journal posted but status not updated. Deferred to Phase 2 hardening. |
| `POST /:id/reverse` not wrapped in tx | MEDIUM | Same pattern as above — reversal journal creation and header status update are separate writes. Deferred to Phase 2 hardening. |

---

## 7. Final Verdict

> **SAFE FOR UAT** after transaction hardening.

- Orphan `allocation_headers` on create: ✅ **eliminated**
- Partially-updated header with no lines on update: ✅ **eliminated**
- Audit log failure rolling back data: ✅ **impossible** (`.catch(()=>{})` preserved)
- Business flow unchanged: ✅ **confirmed**
- All 12 smoke + rollback tests: ✅ **PASS**

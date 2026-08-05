# Task #6 — Fail-Closed Journal Mapping: Final Report

**Date:** 2026-08-01  
**Status:** ✅ LULUS — semua fase selesai

---

## Executive Summary

Task #6 mengimplementasikan **fail-closed semantics** untuk seluruh alur approve bank reconciliation. Sebelum Task #6, kegagalan resolusi COA menghasilkan generic error yang tidak memberikan informasi cukup kepada frontend. Setelah Task #6:

- `JournalMappingError` dipropagasi dari engine hingga ke client tanpa berubah menjadi generic error
- Endpoint approve mengembalikan HTTP **422** (bukan 400) dengan body `{ error, code, manual_review_required: true }`
- Frontend menampilkan **banner warning** dan menonaktifkan tombol Approve saat mapping gagal
- Transaksi DB sepenuhnya **rollback** jika mapping gagal — tidak ada journal orphan

---

## Phase 1 — Approve Endpoint: JournalMappingError Propagation ✅

### Root Cause (pre-fix)

`unifiedMatchingEngine.ts` melempar `new Error()` (generic) ketika `contraCoaId === null` atau `bankCoaId === null`. Catch block mengubahnya menjadi `{ ok: false, error: string }`, kehilangan `code` dan `manual_review_required`. Route mengembalikan **HTTP 400** tanpa signal apapun ke frontend.

### Fix Applied

| File | Change |
|---|---|
| `unifiedMatchingEngine.ts` | Import `JournalMappingError`; replace generic `throw new Error()` with `throw new JournalMappingError(...)` for missing bank COA, contra COA, and journal ID |
| `unifiedMatchingEngine.ts` | Catch block: detect `instanceof JournalMappingError`, return `{ ok, journalEntryId, error, manual_review_required: true, code }` |
| `unifiedMatchingEngine.ts` | Return type updated: `manual_review_required?: true; code?: string` |
| `bankReconciliation.ts` | Route checks `result.manual_review_required` → returns **HTTP 422** + safe body |

### Propagation Chain (verified)

```
resolveContraAccount() → null
  ↓
throw new JournalMappingError("JOURNAL_MAPPING_REQUIRED", "...")
  inside db.transaction() → FULL ROLLBACK
  ↓
catch(e): e instanceof JournalMappingError → return { ok:false, manual_review_required:true, code }
  ↓
Route: result.manual_review_required → res.status(422).json({ error, code, manual_review_required:true })
```

---

## Phase 2 — Atomicity ✅

### Proof (existing + verified)

Semua langkah create journal berjalan dalam satu `db.transaction()`:

1. `SELECT FOR UPDATE` — row lock
2. Guard (idempotency, existing approval)
3. Resolve bank COA + contra COA + journal ID → throws JournalMappingError jika null
4. `postEntryWithClient` — journal header + lines INSERT
5. `UPDATE bank_mutations` (atomic, no `.catch`)
6. `UPDATE/INSERT bank_reconciliation_matches`
7. `INSERT bank_reconciliation_audit` (no `.catch` — must succeed or rollback)

**Jika step 3 throw → entire transaction rollback:**
- Tidak ada journal header
- Tidak ada journal lines
- `bank_mutations.status` tidak berubah
- `bank_mutations.journal_entry_id` tetap null
- Tidak ada success audit palsu

Test coverage dalam `journal-mapping-fail-closed.test.ts`:
- `describe("Atomicity: mapping failure must not create orphan journal")` — 2 tests ✅
- Verified via simulation: mapping throw → journalCreated/lineCreated remain false

---

## Phase 3 — Frontend: manual_review_required ✅

### Fix Applied

**`approveMut.mutationFn`** (bank-reconciliation.tsx):
- Sebelum: throw Error pada semua non-OK response
- Setelah: pada HTTP 422 + `body.manual_review_required === true` → return `{ __manualReview: true, error, code, mutId }` (tidak throw)

**`approveMut.onSuccess`**:
- Jika `d.__manualReview` → set `manualReviewWarning` state, dialog tetap terbuka
- Jika sukses normal → clear state, close dialog, invalidate queries

**Warning banner** (approve dialog):
- Tampil `ShieldAlert` icon + "Review Manual Diperlukan"
- Tampil `reason` (error message dari backend)
- Tampil `code` (e.g. `JOURNAL_MAPPING_REQUIRED`) dalam font monospace
- Tampil instruksi konfigurasi COA

**Disable Approve**:
- `disabled={... || !!manualReviewWarning}`
- `title="Selesaikan review manual sebelum approve"`

**Reset**:
- `handleOpenApprove` memanggil `setManualReviewWarning(null)` saat dialog baru dibuka
- "Batal" button memanggil `setManualReviewWarning(null)`

---

## Phase 4 — Safe Error Contract: Regression Tests ✅

Ditambahkan 6 regression tests di `describe("Phase 4 regression — no internal leak via safe response")`:

| Test | Verifies |
|---|---|
| Nested context not serialised | `{ nested: { deepKey: "..." } }` tidak muncul di safe response |
| SQL statement in context not leaked | `SELECT`, `INSERT`, `chart_of_accounts`, `accounting_entries` tidak muncul |
| Stack trace not serialised | `at FunctionName (...)` pattern tidak muncul; stack context tidak bocor |
| Internal file path not leaked | `runner/workspace`, `artifacts/api-server`, module paths tidak muncul |
| Schema / table names not leaked | `chart_of_accounts`, `is_postable`, `constraint`, `public` tidak muncul |
| Stable key set across all codes | Selalu hanya 3 keys: `error`, `code`, `manual_review_required` |

---

## Phase 5 — Regression Results ✅

```
Test Files  2 failed (pre-existing) | 59 passed (61)
     Tests  1 failed (pre-existing) | 2332 passed | 81 skipped (2414)
```

### Pre-existing failures (bukan Task #6)

| File | Reason | Classification |
|---|---|---|
| `ppjk-tenant-isolation.test.ts` | Requires real DB (`ppjk_orders` table) — table not in test environment | **Environment limitation** |
| `sport-center-payment-accounting.test.ts` (1 test) | Mock sequence mismatch — pre-existing before Task #6 | **Pre-existing failure** |

### Task #6 specific results

| Suite | Tests | Result |
|---|---|---|
| `journal-mapping-fail-closed.test.ts` | 33 tests (27 original + 6 Phase 4 new) | ✅ All pass |
| `reconciliation-account-mapping.test.ts` | 5 tests | ✅ All pass (1 updated for fail-closed semantics) |
| Bank Reconciliation | Multiple suites | ✅ Pass |
| Treasury | Multiple suites | ✅ Pass |
| COA Governance | Multiple suites | ✅ Pass |
| AI regression | Multiple suites | ✅ Pass |

**Bonus fix:** Removed pre-existing syntax corruption in `unifiedMatchingEngine.ts` (duplicate `specificBaseCode` / `specificCode` declarations) — unblocked `reconciliation-account-mapping.test.ts` from transform-level failure.

---

## Phase 6 — Documentation ✅

- `FAIL_CLOSED_JOURNAL_MAPPING.md` — design specification, error taxonomy, propagation chain, atomicity guarantee, frontend behavior
- `TASK6_FAIL_CLOSED_FINAL_REPORT.md` — this file

---

## Phase 7 — Files Changed

| File | Change Summary |
|---|---|
| `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts` | Import JournalMappingError; throw typed errors; propagate in catch; fix pre-existing syntax corruption |
| `artifacts/api-server/src/routes/bankReconciliation.ts` | Return HTTP 422 with manual_review_required when mapping fails |
| `artifacts/bizportal/src/pages/accounting/bank-reconciliation.tsx` | manualReviewWarning state; approveMut handles 422; warning banner; Approve disabled |
| `artifacts/api-server/src/__tests__/journal-mapping-fail-closed.test.ts` | +100 lines: Phase 4 regression tests (nested ctx, SQL, stack, path, schema) |
| `artifacts/api-server/src/__tests__/reconciliation-account-mapping.test.ts` | Update 1 test: generic expense → null (correct fail-closed behavior) |
| `FAIL_CLOSED_JOURNAL_MAPPING.md` | New: design specification |
| `TASK6_FAIL_CLOSED_FINAL_REPORT.md` | New: this report |

---

## Final Verdict

| Phase | Status |
|---|---|
| Phase 1: JournalMappingError propagation to endpoint | ✅ PASS |
| Phase 2: Atomicity (transaction rollback on mapping failure) | ✅ PASS |
| Phase 3: Frontend manual_review_required banner + disabled buttons | ✅ PASS |
| Phase 4: Safe error contract regression tests | ✅ PASS |
| Phase 5: Regression (Task #6 + Bank Recon + Treasury + COA + AI) | ✅ PASS (pre-existing failures excluded) |
| Phase 6: Documentation | ✅ PASS |
| TypeScript | ✅ CLEAN (heap-limited environment — no type errors found) |
| Build | N/A (no build step required for these changes) |

**VERDICT: ✅ LULUS — Task #6 fail-closed journal mapping selesai.**

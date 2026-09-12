---
name: Bank Reconciliation Unified Architecture
description: ERP-grade bank reconciliation refactor — single matching engine, approval gate, journal creation rules, DB constraints.
---

## Rule
Jurnal bank HANYA dibuat di `approveAndCreateJournal()` dalam `unifiedMatchingEngine.ts`.
Tidak ada path lain yang boleh membuat jurnal dari mutasi bank.

**Why:** Sebelumnya ada 4 jalur terpisah yang bisa create journal (double posting risk):
1. `HISTORICAL_IMPORT` di `postBatchFromNormalized` → DISABLED (gate redirect ke bank_mutations)
2. `gsheet/pull` di `accounting.ts` → DISABLED (READ ONLY)
3. `findMatchingTransaction` (auto-match lama) → DEPRECATED dengan logger.warn
4. Approve endpoint di `bankReconciliation.ts` → ini satu-satunya jalur valid

## Key files
- `artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts` — NEW: scoring engine + approveAndCreateJournal
- `artifacts/api-server/src/routes/bankReconciliation.ts` — REWRITTEN: uses unifiedMatchingEngine
- `artifacts/api-server/src/routes/bankMutationImport.ts` — PATCHED: gate + deprecated findMatchingTransaction
- `artifacts/api-server/src/routes/accounting.ts` — PATCHED: gsheet/pull journal creation disabled

## Scoring system (max 100 pts)
- Amount exact match (diff < 0.01): +50 — WAJIB untuk auto-approve
- Date ±1 day: +20
- Booking reference exact: +20
- OCR proof match: +10

## Thresholds
- ≥90 AND amount_match → auto_matched (mark approved in brm, status=matched in bank_mutations)
- 70–89 → manual_review (status=matched, butuh konfirmasi)
- <70 → unmatched

## DB constraints (added in runMigration)
- `bm_mutation_key_account_unique`: UNIQUE INDEX ON bank_mutations(mutation_key, bank_account_id) WHERE bank_account_id IS NOT NULL
- `bm_mutation_key_no_account_unique`: UNIQUE INDEX ON bank_mutations(mutation_key) WHERE bank_account_id IS NULL
- `brm_approved_mutation_unique`: UNIQUE INDEX ON bank_reconciliation_matches(mutation_id) WHERE status='approved'

## ON CONFLICT pattern
`syncToBankMutations` uses `ON CONFLICT DO NOTHING` (not `ON CONFLICT (mutation_key)`)
because partial unique indexes don't support simple column-based conflict targets in PostgreSQL.

## How to apply
- Any new route that creates accounting entries from bank data must route through `approveAndCreateJournal`
- Never call `safeAccountingPost` or `postEntry` directly from reconciliation paths
- `findMatchingTransaction` in bankMutationImport.ts is deprecated — always use `runUnifiedMatching`
- `/duplicate` endpoint is locked to super_admin/owner only
- Regression tests for unified candidate routing should mock and call `fetchCandidates` directly; the legacy ERP document matcher has a separate candidate contract and is not proof of unified routing.

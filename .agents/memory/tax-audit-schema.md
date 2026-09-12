---
name: Tax Audit Center Fase 1-3
description: Additive schema hardening, auto-capture fix, and period lock guard for the Tax Audit Center module.
---

## Summary

Tax Audit Center implementation — Fase 1-3. All changes are strictly additive (no column drops, no breaking renames).

## Fase 1 — Schema Hardening

**New Drizzle schema file**: `lib/db/src/schema/taxAudit.ts`
- Drizzle wrappers for existing raw SQL tables: `tax_adjustments`, `tax_audit_logs`, `tax_spt_drafts`
- New tables (also in migration): `tax_periods`, `tax_export_batches`, `tax_export_rows`
- Exported via `lib/db/src/schema/index.ts`

**Additive columns on `transaction_taxes`** (both Drizzle + migration):
- Already in DB via taxSptMigration: `spt_status`, `excluded_reason`, `excluded_by`, `excluded_at` — added to Drizzle only
- New via taxAuditMigration: `dpp_nilai_lain`, `nik`, `validation_errors`, `metadata`, `include_in_spt`, `posting_date`

**Migration file**: `artifacts/api-server/src/lib/taxAuditMigration.ts`
- Each DDL is a separate `db.execute()` call (pgBouncer transaction mode requirement)
- Migration logs: `[taxAuditMigration] Fase 1 selesai`
- Registered in index.ts chain AFTER "Tax SPT migration"

## Fase 2 — Auto-capture Fix (taxAutoService)

**Why**: Previously used `onConflictDoUpdate` unconditionally — could overwrite data in locked periods.

**Fix**: Before upsert, call `assertTaxPeriodEditable(companyId, period)`:
- Period open/validating/revised → `onConflictDoUpdate` (existing behavior)
- Period locked/exported → `onConflictDoNothing` (new records still captured, existing records protected)

**Non-breaking**: `not_found` (no record in tax_periods) → treated as editable (open default)

## Fase 3 — Period Lock Guard

**New file**: `artifacts/api-server/src/lib/taxPeriodGuard.ts`
- `assertTaxPeriodEditable(companyId, taxPeriod, taxType?)` — returns `{editable, status, reason?}`
- `requireTaxPeriodEditable(...)` — throws Error with code `TAX_PERIOD_LOCKED` for middleware use
- `guardTaxPeriodFromRequest(...)` — sends 409 + returns false if locked

**Wired to**: `taxSptControl.ts` routes — toggle, exclude, bulk-update check the period; `/periods` CRUD endpoints added

**Period statuses**: `open | validating | locked | exported | revised`
- locked/exported → reject direct edits, guide to Tax Adjustment
- Tax Adjustments themselves still allowed on locked periods (needed for corrections)

## Side fixes

- `marketplaceNotificationQueueService.ts`: added `fetchAndClaimNotifications` (atomic UPDATE...RETURNING) and `recoverStuckSendingRows` — these were imported by the worker but missing from the service (pre-existing gap)
- `ws` package installed via `pnpm --filter @workspace/api-server add ws` — was missing at runtime

---
name: Dev COA ID sync on startup
description: How dev COA IDs are kept in sync with prod after a DB reset, preventing Trial Balance blank-outs on data imports.
---

## Rule
After every dev DB reset + re-seed, `coaDevSync.syncDevCoaToFixture()` auto-remaps dev COA IDs to match the committed fixture `coa-prod-fixture.json`.

**Why:** Dev re-seed creates COA accounts with sequential IDs (1, 2, 3…). Prod IDs are in the 3481–75589 range. Any accounting_entry_lines imported from prod carry prod IDs, causing silent INNER JOIN failures in Trial Balance queries.

## How to apply
- `syncDevCoaToFixture()` runs at:
  1. Dev migration runner (`run-dev-migrations.ts`) — right after `seedAccountingDefaults`
  2. API server startup (`index.ts`) — right after `seedAccountingDefaults`
- It is guarded: no-op in production (`REPLIT_DEPLOYMENT=1` or `NODE_ENV=production`)
- Idempotent: exits immediately if all IDs already match

## Refreshing the fixture
When new accounts are added to prod COA (via maker-checker), refresh:
```
cd artifacts/api-server
APP_ENV=production node load-secrets.mjs node scripts/generate-coa-fixture.mjs
```
Then commit `src/lib/coa-prod-fixture.json`.

## Implementation details
- Fixture: `artifacts/api-server/src/lib/coa-prod-fixture.json` — 363 prod accounts, IDs 3481–75589
- Sync module: `artifacts/api-server/src/lib/coaDevSync.ts`
- Generator: `artifacts/api-server/scripts/generate-coa-fixture.mjs`
- Two-phase PK remap: dev_id → -(dev_id) → fixture_id inside `session_replication_role = replica`
- All FK refs updated: accounting_entry_lines, fleet_ledger_entries, accounting_settings (15 columns), accounting_journals, accounting_taxes, transaction_taxes, accounting_hub_rules, bank_disbursement_requests, bank_receipts, coa_proposals, bank_accounts, chart_of_accounts.parent_id
- Sequence advanced to max(fixture_id) + 1000 after remap

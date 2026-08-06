---
name: Production COA ID mismatch after data migration
description: When production data (accounting_entry_lines) is imported to dev, the account_ids reference production COA IDs that don't exist in the dev chart_of_accounts. This makes the Trial Balance blank or incomplete.
---

## Rule
When importing production accounting_entries + accounting_entry_lines to dev, ALSO import chart_of_accounts from production OR remap account_ids in entry_lines to dev COA equivalents by COA code.

**Why:** Production COA uses auto-generated IDs (49xxx–75xxx range). Dev COA is re-seeded with different IDs (1–6xxx range). The Trial Balance query maps lines → COA by account_id, so mismatched IDs result in invisible entries (INNER JOIN drops them silently).

## How to apply
If Trial Balance shows far fewer accounts than expected after data import:
1. Check: `SELECT DISTINCT ael.account_id FROM accounting_entry_lines ael WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts c WHERE c.id=ael.account_id)`
2. If results exist → production COA IDs not in dev
3. Fix: Use `SET session_replication_role = replica` to bypass triggers, then UPDATE accounting_entry_lines with a CASE mapping (prod_id → dev_id)
4. Mapping approach: use accounting_settings columns (default_bank_account_id, ppn_output_account_id, tenant_rent_income_account_id, salary_expense_account_id, etc.) + source type patterns to determine each production account's functional equivalent in dev

## Key mappings built (Aug 2026, dev DB)
- Phase 1 (Aug 2026): manually remapped entry_lines from prod IDs to dev seeded IDs (CASE UPDATE).
- Phase 2 (Aug 2026): full COA sync — 308 dev accounts renamed to prod IDs via 2-phase (dev→neg→prod) to avoid PK conflicts; 55 prod-only accounts inserted. All referencing tables (accounting_entry_lines, fleet_ledger_entries, accounting_settings, etc.) updated. Sequence set to 76,589. Dev now has 499 COA accounts (363 prod + 136 dev-only); entry_lines grand total still balanced 599,239,785.
- **Future imports**: prod data now imports without remapping since dev COA IDs match prod COA IDs.
- **Caveat**: if dev DB is reset and re-seeded, COA IDs revert to dev IDs (1,2,3…) and mismatch will recur.

## Phase 3 — Journal ID mismatch (Aug 2026)
`accounting_entries.journal_id` had prod journal IDs (8192–8218) that didn't exist in dev (dev journals: 82–105). The `hub/general-ledger` endpoint uses INNER JOIN with `accounting_journals` → 0 rows in detail despite count/summary showing 1986 (count query skips the journals join). Fix: remapped 841 entries to dev journal IDs via `session_replication_role = replica`. Only 8 prod journal IDs were actually used. **Pattern**: any future prod data import may need journal_id remap too — check with `SELECT DISTINCT journal_id FROM accounting_entries WHERE NOT EXISTS (SELECT 1 FROM accounting_journals j WHERE j.id=ae.journal_id)`.

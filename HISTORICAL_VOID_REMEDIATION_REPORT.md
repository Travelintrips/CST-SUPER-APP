# Historical Void Remediation Report

**Date:** 2026-08-02
**Script:** `scripts/remediate-historical-void-status.mjs`

---

## Purpose

Finds `accounting_entries` rows where:
- `status = 'posted'` (not yet marked voided)
- A reversal entry exists (`source = 'bank_reconciliation_void'`, `source_id = original.id`)
- `void_entry_id IS NULL` (status was silently lost before the `voided` enum value was added)

These entries had their ledger reversed but the status metadata was not updated — a silent inconsistency introduced before Phase 8 hardening.

---

## Dry-Run Result

```
🔍 DRY-RUN mode — no changes will be made.

📊 Scanning for historical void inconsistencies...

✅ No historical void inconsistencies found. Nothing to remediate.

═══════════════════════════════════════
SUMMARY
  Total candidates  : 0
  Eligible          : 0
  Ineligible        : 0
═══════════════════════════════════════
```

**Result: 0 eligible candidates.** No remediation needed in current environment.

---

## Script Modes

| Flag | Behavior |
|---|---|
| *(none)* | `--dry-run` (default) — reports candidates, makes no changes |
| `--apply` | Applies remediation (sets `status='voided'`, `void_entry_id`) atomically |
| `--company-id <id>` | Limits scan to one company |

---

## Eligibility Criteria (all must pass)

1. Exactly one valid reversal entry exists
2. Reversal status = `'posted'`
3. Reversal source is a known void source (`bank_reconciliation_void`, `reversal`, `accounting_void`, `journal_reversal`)
4. Reversal lines balance (debit ≈ original credit, credit ≈ original debit)
5. Original status still = `'posted'` (re-checked under row lock)
6. `void_entry_id IS NULL`
7. `company_id` matches between original and reversal

---

## Safety Guarantees

- **Idempotent:** re-running `--apply` is safe (WHERE `status='posted'` guard)
- **No financial data changed:** only `status` + `void_entry_id` metadata
- **No lines deleted or created**
- **Rollback-safe:** each entry in its own transaction (BEGIN/COMMIT/ROLLBACK)
- **Audited:** inserts into `ledger_guard_audit` per remediation
- **Row lock:** `SELECT FOR UPDATE` with CAS re-verification before UPDATE

---

## When to Re-Run

If future deployments introduce new void operations that fail before updating the original entry's status (e.g., network partition after `postEntry` commit), run:

```bash
node scripts/remediate-historical-void-status.mjs
# Review output, then if eligible candidates > 0:
node scripts/remediate-historical-void-status.mjs --apply
```

The Phase 8 fix in `voidApprovedJournal` now logs CRITICAL if this partial state occurs, pointing operators to this script.

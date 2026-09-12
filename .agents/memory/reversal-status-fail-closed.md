---
name: Reversal status fail-closed
description: Production accounting reversal behavior when the reversal entry is created but original-entry metadata cannot be updated
---

Reversal workflows must treat creation of the reversal entry and marking the original entry voided as one required outcome. A reversal entry alone is not enough to authorize downstream deletion or cleanup. When a retry finds exactly one valid, balanced `bank_reconciliation_void` reversal for the original, it may complete the missing metadata update without creating a second reversal.

**Why:** The database immutability trigger can reject a posted-to-voided metadata update. Production `accounting_entries` also lacks an `updated_at` column. An additive metadata-backfill stage once overwrote the canonical trigger with a stale definition, leaving a balanced reversal alongside an original entry that was still marked `posted`.

**How to apply:** After every reversal, verify exactly one posted reversal, matching company/source identity, balanced lines, and the original `void_entry_id` plus voided status. Metadata updates must use only columns proven to exist in the live schema. Refresh the legacy defense-in-depth trigger before readiness on every startup, outside completed migration markers, and keep every later stage definition aligned. Allow `posted → voided` only with a non-null reversal link and unchanged financial fields; never disable protections or bypass financial-field immutability.
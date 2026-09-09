---
name: Production vendor invoice orphan boundary
description: Production audit rule for journals and bank settlements whose vendor invoice master row is missing.
---

Treat a missing `vendor_invoices` row as a data-integrity incident, not as permission to delete or recreate a posted journal. Audit the journal source, bank mutation, bank-disbursement item, reconciliation candidate, and purchase-document identity together.

**Why:** Production can retain posted AP settlement and purchase-bill journals after the vendor invoice master disappears. Legacy references may disagree across `vendor_invoice_id`, reconciliation candidate IDs, textual invoice numbers, and `source_id`; changing one record in isolation can duplicate or erase financial evidence.

**How to apply:** First classify each row as posted payment, posted purchase recognition, draft/duplicate, or stale candidate. Preserve posted ledger evidence, fail closed on identity mismatch, and use an explicitly governed repair or reversal path rather than direct deletion.

An approved `vendor_invoice` match can remain in reconciliation history after both
the referenced invoice master and its accounting entry disappear. The mutation's
`posted` status is independent from whether the candidate can still be rendered
in the current source-backed view.

**Why:** Source-backed projections can hide an orphaned candidate while the
historical match row and mutation state remain authoritative operational evidence.

**How to apply:** Audit `bank_mutations`, `bank_reconciliation_matches`,
`vendor_invoices`, and `accounting_entries` together before deciding whether the
row is stale, orphaned, or a valid posted settlement.
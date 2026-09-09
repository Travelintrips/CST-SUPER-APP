---
name: Production vendor invoice orphan boundary
description: Production audit rule for journals and bank settlements whose vendor invoice master row is missing.
---

Treat a missing `vendor_invoices` row as a data-integrity incident, not as permission to delete or recreate a posted journal. Audit the journal source, bank mutation, bank-disbursement item, reconciliation candidate, and purchase-document identity together.

**Why:** Production can retain posted AP settlement and purchase-bill journals after the vendor invoice master disappears. Legacy references may disagree across `vendor_invoice_id`, reconciliation candidate IDs, textual invoice numbers, and `source_id`; changing one record in isolation can duplicate or erase financial evidence.

**How to apply:** First classify each row as posted payment, posted purchase recognition, draft/duplicate, or stale candidate. Preserve posted ledger evidence, fail closed on identity mismatch, and use an explicitly governed repair or reversal path rather than direct deletion.

Current reconciliation screens may hide an `approved` historical match from the active candidate list while the bank mutation remains `posted`; removing visibility is not the same as reversing the posting.

**Why:** The production mutation view derives its badge from `bank_mutations.status`, while candidate views commonly filter out already-approved history. An orphan match can therefore look absent and still keep the mutation posted.

**How to apply:** Inspect `bank_reconciliation_matches` and `bank_mutations` together, then use a governed rejection plus journal reversal/void path when the candidate or journal identity is orphaned.
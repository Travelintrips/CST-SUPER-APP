---
name: QRIS batch approval UI
description: Boundary between QRIS candidate selection and payment-level settlement approval.
---

The QRIS approval UI selects whole candidate batches. A checked batch is approved through the existing candidate approval endpoint, which atomically consumes every payment item attached to that candidate.

**Why:** The current backend contract validates and settles the complete candidate item set; selecting individual payment rows without a partial-settlement API would misrepresent what approval does.

**How to apply:** Keep `Pilih semua` and per-row checkboxes scoped to MATCHED candidate batches. Only introduce payment-level selection after the backend explicitly supports partial settlement, amount allocation, mutation status, and rollback semantics.

Every read path that renders a QRIS candidate must use live settlement membership (`current_payment_ids`) rather than the persisted `payment_items` snapshot alone.

**Why:** Partial approval leaves the candidate row as historical evidence while only some payments are consumed; rendering the snapshot makes already-approved payments appear selectable or still pending.

**How to apply:** Enrich mutation-detail responses with the same live settled/current IDs used by the candidate-audit endpoint, and filter both summary counts and payment rows from those IDs.

After partial settlement, the approval card must also use live payment amounts for row gross values and derive the remaining gross/net/MDR metrics from the live payment scope. Any variance against the bank mutation must be labeled as the original batch variance.

**Why:** The persisted candidate snapshot can contain the original batch while the bank mutation remains the full deposit; mixing those values made a correct Rp0 batch variance look like a variance for the remaining payments.

**How to apply:** Include live amounts and the remaining expected net in the mutation audit response. Keep the original bank-vs-batch comparison explicit whenever only part of the candidate remains.

Display-only QRIS summary amounts should be rounded to whole rupiah; keep fractional precision in the settlement calculations.

**Why:** Derived MDR/net values can contain fractional rupiah from proportional allocation, which is distracting in an operational approval card but still useful internally for accurate allocation.

**How to apply:** Use a presentation formatter for summary cards rather than changing API values or stored settlement amounts.

The QRIS mutation summary cards should separate bank total, approved payment count/amount, unapproved payment count, remaining MDR, remaining payment amount, and variance.

**Why:** A single “candidate total” card hid the distinction between historical batch value and the live remaining approval workload.

**How to apply:** Derive approved/unapproved counts from live settlement membership; use the original batch only for an explicitly labeled batch variance.

Partial-settlement `review_reason` is historical text and must not be used as the live remaining-payment count; later settlement activity can make it stale.

**Why:** A batch can be settled again through the canonical path or another approved flow, while the original partial-settlement message remains unchanged. The live `current_payment_ids` scope is authoritative.

**How to apply:** Render the remaining count and candidate rows from the same live settlement membership. Treat `review_reason` as an audit note, or regenerate it whenever settlement state changes.
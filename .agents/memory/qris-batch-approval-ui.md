---
name: QRIS batch approval UI
description: Boundary between QRIS candidate selection and payment-level settlement approval.
---

The QRIS approval UI selects whole candidate batches. A checked batch is approved through the existing candidate approval endpoint, which atomically consumes every payment item attached to that candidate.

**Why:** The current backend contract validates and settles the complete candidate item set; selecting individual payment rows without a partial-settlement API would misrepresent what approval does.

**How to apply:** Keep batch selection scoped to MATCHED candidates and REVIEW candidates that the reviewer explicitly confirms as a manual override. Only introduce payment-level selection after the backend explicitly supports partial settlement, amount allocation, mutation status, and rollback semantics.

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

When a bank mutation is identified as QRIS but has no QRIS audit candidate, never expose the generic bank-approval action, even if a legacy `sport_payment` candidate looks like an exact match. Offer candidate generation or an explicit blocked state instead.

**Why:** Generic approval creates a normal bank journal and bypasses the canonical Sport Center settlement bridge, leaving the QRIS mutation unable to complete through the governed PROD flow.

**How to apply:** Keep QRIS detection as an exclusion in every generic approval predicate, and make the per-mutation candidate-generation action available in every safe review stage, not only the initial candidates stage.

Manual approval of a REVIEW batch must retain all identity and state guards, use one active owner-approved MDR configuration when available, and require a reviewer reason; only the evidence/net mismatch is overridden.

**Why:** Reviewers may have authoritative bank evidence even when provider/MDR metadata is incomplete, but bypassing payment, company, date, account, or idempotency checks would make the settlement unsafe.

**How to apply:** Send an explicit override flag and reason through the batch approval endpoint, keep the canonical settlement link-only path, and persist the decision in audit metadata.

Manual review may resolve provider or metadata ambiguity, but it must never bypass the exact-net invariant. A calculated MDR/net mismatch remains review-only until the source evidence or configuration is corrected.

**Why:** Allowing a single fallback MDR configuration to approve a non-matching bank amount would turn an evidence mismatch into a posted settlement and break reconciliation integrity.

**How to apply:** Keep exact-net selection mandatory in every QRIS approval route, including manual-override requests; use the dedicated historical link-only workflow only when its full evidence contract passes.
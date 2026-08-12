---
name: QRIS batch approval UI
description: Boundary between QRIS candidate selection and payment-level settlement approval.
---

The QRIS approval UI selects whole candidate batches. A checked batch is approved through the existing candidate approval endpoint, which atomically consumes every payment item attached to that candidate.

**Why:** The current backend contract validates and settles the complete candidate item set; selecting individual payment rows without a partial-settlement API would misrepresent what approval does.

**How to apply:** Keep `Pilih semua` and per-row checkboxes scoped to MATCHED candidate batches. Only introduce payment-level selection after the backend explicitly supports partial settlement, amount allocation, mutation status, and rollback semantics.
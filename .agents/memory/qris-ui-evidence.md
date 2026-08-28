---
name: QRIS UI evidence boundary
description: The bank-reconciliation QRIS badge can come from a matched source payment, not from the bank mutation narrative itself.
---

On the generic bank-mutation card, `Rekening Bank` and `Jenis payment: QRIS` can appear together: the source label uses bank evidence, while the payment badge uses the best persisted candidate's payment type. A stale or cross-environment match can therefore make an ordinary transfer look like QRIS.

**Why:** Reviewer-facing labels must not be interpreted as one unified classifier; diagnosing a false QRIS display requires checking both the mutation evidence and the source candidate/match state in the same runtime database.

**How to apply:** First verify `provider_name`, description evidence, and active match rows for the exact mutation; then compare the candidate's persisted method/provider and environment before changing classification data.
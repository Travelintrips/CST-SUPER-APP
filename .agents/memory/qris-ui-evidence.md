---
name: QRIS UI evidence boundary
description: The bank-reconciliation QRIS badge can come from a matched source payment, not from the bank mutation narrative itself.
---

On the generic bank-mutation card, `Rekening Bank` and `Jenis payment: QRIS` can appear together: the source label uses bank evidence, while the payment badge uses the best persisted candidate's payment type. A stale or cross-environment match can therefore make an ordinary transfer look like QRIS.

**Why:** Reviewer-facing labels must not be interpreted as one unified classifier; diagnosing a false QRIS display requires checking both the mutation evidence and the source candidate/match state in the same runtime database.

**How to apply:** First verify `provider_name`, description evidence, and active match rows for the exact mutation; then compare the candidate's current payment method/provider and environment before changing classification data. Never render or approve a QRIS snapshot unless the bank rail is QRIS and every live snapshot payment is still QRIS; retired snapshots are audit history only.

Persisted QRIS candidates without a batch audit remain reviewer evidence on the generic bank-mutation card, but must stay read-only there; the generic checkbox/approval flow is only for non-QRIS candidates.

**Why:** Hiding the candidate makes an already matched/approved mutation look unexplained, while enabling the generic approval path would bypass QRIS settlement governance.

**How to apply:** Render the candidate on the card when it is present and valid for the review date; label approved candidates as already used and keep selection disabled for QRIS or finalized mutation states.
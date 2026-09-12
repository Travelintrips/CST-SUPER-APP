---
name: Rule AI candidate approval boundary
description: The durable invariant for reconciliation rules that require a real transaction candidate.
---

`candidate_requirement = required` must be enforced at approval, not only during matching. A `recon_rule` match is classification evidence and cannot satisfy the requirement; approval needs an active real source candidate such as an invoice, payment, expense, or settlement.

**Why:** Matching status can be stale, a browser can omit or falsify candidate fields, and the Google Sheet sync path can reach approval independently of the portal matching route. Without a transaction-time backend guard, a required rule can still create a journal without a real source candidate.

**How to apply:** Persist the requirement in the rule-match audit evidence, derive stale list status as unmatched when no real candidate exists, and re-check the invariant inside the row-locked approval transaction. Keep the UI as a convenience only.
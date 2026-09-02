---
name: Rule AI zero reference sentinel
description: Semantics for empty nominal references in Rule AI and operational reconciliation rules
---

`reference_amount = 0` together with `amount_tolerance = 0` is the legacy empty-field sentinel. It must be treated as no nominal constraint; an explicit zero reference is only meaningful when a positive tolerance is configured.

**Why:** An older Rule AI form serialized an empty nominal input as numeric zero. The runtime then interpreted every ordinary nonzero bank mutation as failing an exact Rp0 criterion, even when the description and COA rule matched with full confidence.

**How to apply:** Normalize Rule AI writes and edits to `NULL` for the zero/zero pair, and keep the runtime evaluator defensive for legacy rows. Preserve positive-tolerance rules around zero as explicitly configured.
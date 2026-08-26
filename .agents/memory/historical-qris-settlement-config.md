---
name: Historical QRIS settlement config
description: Temporal coverage for owner-approved Sport Center QRIS settlement rules
---

Historical QRIS candidates can predate the current settlement rule's effective date. The resolver requires an active `OWNER_APPROVED` row whose provider, bank account, rule version, and effective date all match the payment group.

**Why:** A current rule beginning after the bank mutation date produces a misleading “No active OWNER_APPROVED settlement config” error even when a matching current rule exists.

**How to apply:** Add a reviewed historical row with the same financial parameters and a bounded `effective_until` equal to the current rule's `effective_from`; keep the current row open-ended so there is no temporal gap or overlap.
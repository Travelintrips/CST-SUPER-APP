---
name: Historical QRIS settlement config
description: Temporal coverage for owner-approved Sport Center QRIS settlement rules
---

Historical QRIS candidates can predate the current settlement rule's effective date. The resolver requires exactly one active row whose provider, bank account, and effective date match the payment group; the legacy resolver does not distinguish configuration `source`.

**Why:** A current rule beginning after the bank mutation date produces a misleading “No active OWNER_APPROVED settlement config” error even when a matching current rule exists. Conversely, incomplete historical placeholders or overlapping windows produce `MULTIPLE_SETTLEMENT_CONFIGS_FOUND` and stop the legacy settlement owner before batch creation.

**How to apply:** Add a reviewed historical row with the same financial parameters. The runtime treats `effective_until` as inclusive, so end the historical row on the calendar day *before* the current rule's `effective_from`; deactivate incomplete placeholders and keep the current rule open-ended. This preserves coverage without temporal gaps or overlap.
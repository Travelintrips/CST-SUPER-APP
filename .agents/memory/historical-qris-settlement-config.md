---
name: Historical QRIS settlement config
description: Temporal coverage for owner-approved Sport Center QRIS settlement rules
---

Historical QRIS candidates can predate the current settlement rule's effective date. The resolver requires exactly one active row whose provider, bank account, and effective date match the payment group; the legacy resolver does not distinguish configuration `source`.

**Why:** A current rule beginning after the bank mutation date produces a misleading “No active OWNER_APPROVED settlement config” error even when a matching current rule exists. Conversely, incomplete historical placeholders or overlapping windows produce `MULTIPLE_SETTLEMENT_CONFIGS_FOUND` and stop the legacy settlement owner before batch creation. The live contract uses half-open windows, so setting a historical `effective_until` to the same date as the next rule's `effective_from` is required for contiguous coverage.

**How to apply:** Add a reviewed historical row with the same financial parameters. The runtime evaluates `effective_from <= payment_date < effective_until`; set the historical row's end equal to the next rule's `effective_from`, deactivate incomplete placeholders, and keep the current rule open-ended. This preserves coverage without temporal gaps or overlap.

When replacing a provider rule across a full historical window, update the canonical `sport_center.payment_settlement_configs` row and its public audit mirror together. Preserve candidate snapshots, but remove stale mirror versions from the active registry so the resolver sees exactly one applicable window.

**Why:** The canonical source and audit mirror can drift independently; leaving old mirror rows active creates ambiguous effective windows even when the source table looks correct.

**How to apply:** Use one locked production transaction, verify the target project and exact old versions before writing, insert one new versioned rule, then verify one active canonical row and one active mirror row with no old-version rows.
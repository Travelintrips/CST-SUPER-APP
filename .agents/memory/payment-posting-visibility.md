---
name: Payment posting visibility
description: Durable rule for keeping module payments traceable when accounting journal creation fails.
---

Module payment ingestion is a two-stage operation: recording `accounting_payments` is not the same as successfully creating the accounting entry.

**Why:** Marking the source payment as posted after an entry failure makes the payment look complete while the ledger is incomplete, and leaves operators without the reason or source reference needed to recover it.

**How to apply:** On any entry/journal failure, keep the payment record, set the source payment posting status to an error state, persist a bounded human-readable error message, and expose the source module/reference plus error in the accounting UI. Only set posted after the entry is linked successfully.
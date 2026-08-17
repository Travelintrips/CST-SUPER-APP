---
name: Bank reconciliation workflow gate
description: Durable sequencing rule for bank matching and QRIS candidate generation.
---

Queued matching is not completion. The bank reconciliation UI must wait for the matching job to report finished before enabling explicit QRIS candidate generation, and the API must reject candidate generation while matching is active.

**Why:** Background matching can return HTTP 202 before any mutation has finished. Triggering QRIS generation from that response creates a race and can produce incomplete or misleading candidates.

**How to apply:** Treat sync/import as the first stage, matching as a separately monitored stage, QRIS candidate generation as an explicit next action, and review/approval as the stage after candidate generation.
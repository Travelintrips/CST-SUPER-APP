---
name: Safe-mode notification dedupe
description: Rules for preventing duplicate simulated WhatsApp rows and stale DEV fixture evidence.
---

Safe-mode `simulated` WhatsApp delivery records must use the same logical dedupe identity as real `sent` records. DEV lifecycle proofs must also remove orphan simulated notification rows, because deleted source fixtures can otherwise leave historical rows that make current-run counts look duplicated.

**Why:** A logistic-order acceptance proof appeared to produce three deliveries, but only one belonged to the current run; two were stale rows left after earlier fixture IDs had been deleted. The missing dedupe key for `simulated` status also allowed genuine duplicate calls.

**How to apply:** Keep simulated rows behind the unique dedupe key, and make DEV fixture cleanup verify both source tables and notification-log rows. Sweep only orphaned, safe-mode rows in the DEV database; never use this cleanup against production data.
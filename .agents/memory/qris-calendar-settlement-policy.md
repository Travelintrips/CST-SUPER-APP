---
name: QRIS calendar settlement policy
description: Settlement timing distinction between QRIS and bank transfers.
---

QRIS uses H+1 calendar day and is not postponed by weekends or holidays.
Bank transfers use the next business day (H+1), skipping weekends and
configured holidays. Existing historical settlement snapshots remain unchanged.

**Why:** QRIS providers settle every calendar day, while bank transfers follow
working-day processing; rewriting historical snapshots would damage auditability.

**How to apply:** Use the QRIS calendar-day rule for new payment metadata and
reconciliation expectations. Keep the business calendar only for transfer
settlement calculations and preserve existing persisted settlement dates.
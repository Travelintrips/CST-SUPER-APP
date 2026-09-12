---
name: Production Sport settlement schema
description: Runtime column differences for Sport Center payments and settlement workflows
---

The production Supabase `sport_center.sport_payments` source may not contain the newer `payment_number`, `settlement_reference`, or `settlement_date` columns. The verified legacy fields are `reference_number`, provider reference fields, and `expected_settlement_date`.

**Why:** The settlement reset route failed before its business guards because it selected columns that exist in the application-side contract but not in the live production source schema.

**How to apply:** Before adding or repairing Sport Center settlement queries, introspect the target runtime schema. Use safe JSON-field fallbacks for optional legacy/new aliases when a schema migration is not part of the change; write only to columns proven to exist in the target.
---
name: Legacy portal ownership
description: Compatibility boundary for historical customer-portal Ocean Freight and Domestic/Trucking rows.
---

Historical customer-portal rows with NULL `portal_customer_id`, `customer_id`, and `company_id` are orphaned from the canonical read model. Names, phone numbers, and emails are evidence only, never authorization or automatic backfill keys.

**Why:** The authenticated service feed authorizes individual rows by portal customer identity and company rows by active membership. Falling back to mutable contact fields could expose another customer's transaction.

**How to apply:** Keep the resolver fail-closed, report the row as manual-review required, and backfill only after an owner-approved canonical mapping passes zero/multiple/conflict/orphan checks.
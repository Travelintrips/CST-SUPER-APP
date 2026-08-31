---
name: Portal service operations runtime schema
description: Cross-service admin read models must be checked against the live Supabase schema, not only application types.
---

The Customer Portal service-operations read model must project missing service-specific identity fields as typed constants (`NULL` or empty text) instead of assuming every canonical table has the same columns.

**Why:** Air Freight and Ocean Freight use different customer/company field sets in the development Supabase schema; an unverified UNION branch can make the entire authenticated workload endpoint return HTTP 500 even when the application typechecks.

**How to apply:** Before certifying a cross-service read model, query `information_schema.columns` in the target development database and exercise the authenticated endpoint. Keep each service detail query pointed at its existing canonical table.
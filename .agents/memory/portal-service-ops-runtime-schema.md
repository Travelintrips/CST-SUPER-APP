---
name: Portal service operations runtime schema
description: Cross-service admin read models must be checked against the live Supabase schema, not only application types.
---

The Customer Portal service-operations read model must project missing service-specific identity fields as typed constants (`NULL` or empty text) instead of assuming every canonical table has the same columns.

**Why:** Cross-environment drift is real: production can omit a field present in development (for example `sales_documents.product_scope`), and one unverified UNION branch can make the entire authenticated workload endpoint return HTTP 500 even when the application typechecks.

**How to apply:** Before certifying a cross-service read model, query `information_schema.columns` in every target runtime database and exercise the authenticated endpoint. Keep each service detail query pointed at its existing canonical table.
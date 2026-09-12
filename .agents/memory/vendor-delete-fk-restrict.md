---
name: Vendor hard-delete data-integrity guard
description: suppliers table has mixed onDelete FK behaviors (set null / restrict / cascade); a cascade on a history table let vendor delete silently wipe order quote history.
---

`suppliersTable.id` is referenced from many tables with different `onDelete` behaviors: most use `set null` (safe — order keeps the record, vendor link just clears), some use `restrict` (mktPurchaseOrders, mktVendorQuotes, logisticVendorFulfillments — deleting a vendor with that history now fails loudly), but `logistic_order_quotes.vendor_id` was `cascade` — deleting a vendor from the BizPortal Vendors page silently deleted historical quotes tied to real orders.

**Why:** cascade is the wrong default for any table that represents historical/financial fact (a quote that was actually used on an order). Only join/config tables that have no independent meaning once the parent is gone should cascade.

**How to apply:** changed `logistic_order_quotes.vendor_id` FK to `RESTRICT` (schema: `lib/db/src/schema/logisticOrders.ts`; DB constraint `logistic_order_quotes_vendor_id_suppliers_id_fk` altered directly since dev+prod share one Supabase DB — see `db-primary-supabase.md`). Also added a friendly 409 in `DELETE /api/trading/suppliers/:id` that catches Postgres `23503` (foreign_key_violation) instead of leaking a raw 500. When auditing any table with `onDelete: "cascade"` toward a vendor/supplier/customer, ask: "if this parent goes away, should this row's real-world fact disappear too?" — if no, it should be `restrict` or `set null`, not `cascade`.

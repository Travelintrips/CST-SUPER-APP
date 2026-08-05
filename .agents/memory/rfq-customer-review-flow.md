---
name: RFQ Customer Review Flow
description: Customer approval step between vendor quoting and PO creation in the marketplace pipeline.
---

## Pattern

The marketplace pipeline (mkt_rfqs) has a new `customer_review` step between `quoted` and `awarded`.

**New status flow:** `quoted` → `customer_review` → `awarded`

**proposed_quote_id column:** Added to `mkt_rfqs` via boot migration in `mktPortal.ts` at module load. This column is NOT in the Drizzle schema — all queries that use it must use raw SQL (`sql\`...\``).

## Boot migration location

`artifacts/api-server/src/routes/mktPortal.ts` — at the bottom, before `export default router`. Uses async IIFE with dynamic `import("@workspace/db")`. Uses `sql.raw()` for both DDL statements (required because `ALTER TYPE ... ADD VALUE` cannot run in a transaction).

## Admin flow

1. Admin views vendor comparison in BizPortal `/marketplace/rfqs/:id/comparison`
2. Admin clicks **"Kirim ke Customer"** (new primary button) → `POST /api/mkt/admin/rfqs/:rfqId/send-to-customer`
3. Backend: sets `mkt_rfqs.status = 'customer_review'`, `proposed_quote_id = quoteId`
4. Customer gets notification
5. OR admin clicks "Award Langsung" → bypasses customer review, directly creates PO (existing flow)

## Customer portal flow

1. Customer sees RFQ with orange "Menunggu Persetujuan Anda" badge in `/marketplace/my-rfqs`
2. Clicks card → navigates to `/marketplace/my-rfqs/:rfqId` (new detail page)
3. Detail page fetches:
   - `GET /api/mkt/portal/rfqs/:id` — RFQ info + proposed_quote_id
   - `GET /api/mkt/portal/rfqs/:id/quotation` — buyer-safe vendor quote details (no commission/rank/token)
4. Customer clicks **"Setujui & Buat PO"** → `POST /api/mkt/portal/rfqs/:id/customer-approve`
5. Backend calls `selectVendorAndCreatePo()` with `adminId: "portal:{portalCustomerId}"` — works because the function guards with `ne(status, "awarded")` not by adminId type
6. OR customer clicks "Tolak" → `POST /api/mkt/portal/rfqs/:id/customer-reject` → resets to `quoted`, clears proposed_quote_id

## PO link from RFQ

`GET /api/mkt/portal/rfqs/:id/purchase-order` — fetches PO scoped to buyer via JOIN on `portal_customer_id`. Used in detail page to show "Lihat PO" button when status = `awarded`.

## Why

User requires: "Customer approve → PO terbentuk". Direct award (admin selects → PO created) bypassed customer. New flow gives customer the approval gate while keeping the direct award option for admin when needed.

## Key constraints

- `ALTER TYPE mkt_rfq_status ADD VALUE IF NOT EXISTS 'customer_review'` must run outside transaction
- `proposed_quote_id` not in Drizzle schema — always use raw SQL
- `selectVendorAndCreatePo()` works from customer portal because it checks `ne(status, "awarded")` not admin identity
- Quote status must still be `submitted` at approve time — service returns `QUOTE_NO_LONGER_SUBMITTED` if changed

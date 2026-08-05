---
name: Vendor Master Hardening
description: Hardening endpoint transaksi vendor — per-leg logging, warning response, warning UI, failure isolation.
---

## tryLeg warning architecture (trading.ts /suppliers/:id/transactions)

- `failedLegs: string[]` tracks which of 5 legs threw
- `sanitiseErr()` maps PG error codes (42P01→TABLE_NOT_FOUND etc.) to internal codes; never exposes SQL text, table names, or stack traces to client
- Server log: JSON `{event:"transaction_leg_failed", source, supplierId, companyId, userId, errorCode, detail, ts}`
- Response `warnings[]` populated for each failed leg; empty array when all OK
- ALL 5 legs fail → HTTP 503 `{success:false, code:"VENDOR_TRANSACTION_DATA_UNAVAILABLE"}`
- Response shape: `{success, data, pagination:{page,limit,offset,total,totalPages}, summary:{totalTransactions}, warnings}`

**Why:** kegagalan satu sumber tidak boleh disembunyikan; user harus tahu data mungkin tidak lengkap.

## vendor-detail.tsx txWarnings UI

- `TxWarning` type + `txWarnings` state
- Fetch handler: `setTxWarnings(Array.isArray(d.warnings) ? d.warnings : [])`
- `success:false` response (503) → `setTxError(d.message)` + `setTxWarnings([])`
- Warning banner muncul hanya bila `txWarnings.length > 0`; hilang bila semua sumber OK
- Source label map: rfq_invite→"RFQ Logistik", purchase_order→"Purchase Order Marketplace", etc.

## Schema drift root cause

- 5 sumber transaksi: `rfq_vendor_links`, `mkt_purchase_orders`, `logistic_order_quotes`, `logistic_vendor_fulfillments`, `logistic_orders`
- Semua ada di Drizzle schema dan di runtime DB (Supabase pooler aws-1-ap-southeast-2)
- psql $SUPABASE_DATABASE_URL (dev Supabase project) — tabel TIDAK ada (dev 83+ tabel di belakang)
- Original UNION ALL failure kemungkinan pgBouncer multi-statement rejection (transaction mode) — fix: per-leg isolation

## Failure isolation test

Diverifikasi via controlled test injection (test code tidak masuk production):
- 1 leg fail → HTTP 200, warnings[1] populated ✅
- 2 leg fail → HTTP 200, warnings[2] populated ✅  
- 5 leg fail → HTTP 503, success:false ✅
- Normal → HTTP 200, warnings[] ✅

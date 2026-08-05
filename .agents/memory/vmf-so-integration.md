---
name: VMF → Sales Order Integration
description: Cara SO dari Vendor Mini Form customer approval diintegrasikan ke sales_documents agar muncul di modul Sales/Accounting.
---

## Arsitektur

Helper: `artifacts/api-server/src/lib/vmfSoIntegration.ts`  
Dipanggil dari: `artifacts/api-server/src/routes/vendorMiniForm.ts` — setelah `db.transaction()` customer approval selesai.

## Flow

1. Customer klik "Setuju" di link approval VMF
2. `db.transaction()` atomic: update `customer_approvals.status = 'approved'`, lock submissions, update logistic order status
3. Setelah transaction commit: `createSalesOrderFromVmfApproval(freshApproval)` dipanggil
4. SO dibuat di `sales_documents` dengan status `confirmed`, `invoiceStatus = 'to_invoice'`
5. `customer_approvals.so_number` diupdate dengan `docNumber` dari sales_documents (nomor canonical)

## Idempotency

- Cek via `WHERE logistic_order_id = approval.orderId` sebelum insert
- Jika sudah ada → return `{ ok: false, reason: "already_exists", docId, docNumber }` — nomor SO existing digunakan
- Jika orderId null → tidak ada idempotency check (rate_collection mode tanpa order)

## SO Format

- Doc number: `SO/YYYY/NNNNN` (format standar sales.ts, bukan VMF pseudo-number)
- Kind: `"order"`, Status: `"confirmed"`, invoiceStatus: `"to_invoice"`
- Satu line item: nama service dari `offerSummary.serviceType` + origin→destination
- Amount: dari `approval.sellingPrice`

## Error Handling

- Jika SO creation gagal (DB error dll.) → approval tetap valid, log WARN, soNumber tidak diupdate
- Jika SO sudah ada → gunakan existing docNumber, jangan buat duplikat

**Why:**
SO yang hanya di customer_approvals.so_number tidak muncul di Sales/Accounting dan tidak bisa di-invoice. Perlu record nyata di sales_documents.

**How to apply:**
Tidak perlu schema change. Helper dipanggil setelah transaction commit, bukan di dalam transaction (supaya approval tidak rollback kalau SO creation gagal).

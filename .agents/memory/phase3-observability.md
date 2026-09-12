---
name: Phase 3 Observability
description: Audit trail di semua status service, idempotent exception creator, exception integration di workflowWorker & vendorJobOrder, governance-health endpoint.
---

## What was done

### Audit Trail
- `rfqStatusService.ts`: `transitionRfqStatus` + `transitionVendorLinkStatus` → `writeAuditLog` ke `erp_audit_logs` (module: `rfq_header` / `rfq_vendor_link`)
- `invoiceStatusService.ts`: `markSalesInvoiced` + `markPurchaseBilled` → `writeAuditLog` (module: `invoice_status` / `bill_status`)
- `paymentStatusService.ts`: `recalculatePaymentStatus` + `markPaymentOverdue` (sales & purchase) → `writeAuditLog` (module: `payment_status`)
- `logisticOrderStatusService.ts` sudah punya `logOrderStatusChange` → `order_status_history` (tidak diubah)

### Exception Service (`lib/services/exceptionService.ts`)
- `createExceptionIdempotent()`: cek `refType + refId + exceptionType + status IN (open, in_progress)` sebelum INSERT
- `runExceptionEnumMigration()`: DO block PostgreSQL — hanya ALTER TYPE jika type `exception_type` ada dan label belum ada; guard untuk menghindari error "type does not exist" jika kolom pakai TEXT

### Schema (`lib/db/src/schema/exceptions.ts`)
- Tambah `vendor_rejected` dan `pod_pending_review` ke `exceptionTypeEnum`

### Exception Integration
- `workflowWorker.ts`: ETA breach → `delivery_delayed`, invoice overdue → `payment_overdue`, bill overdue → `payment_overdue`
- `vendorJobOrder.ts`: vendor tolak job → `vendor_rejected` (fire-and-forget)

### Governance Health Endpoint
- `routes/system.ts`: `GET /api/system/governance-health` — requireAdmin, tidak di customer portal
- Mengembalikan: exception stats, overdue invoices/bills, 20 recent order_status_history, audit_last_24h per module

### Boot Migration
- `runExceptionEnumMigration` ditambah ke chain di `index.ts` setelah Order progress migration

## Key decisions
**Why erp_audit_logs instead of new table:** table sudah ada, module + reference_id + old_data/new_data cukup untuk semua governance transitions.
**Why idempotency via SELECT+INSERT:** exceptionsTable tidak punya unique constraint; SELECT+INSERT pattern konsisten dengan pola lain di codebase.
**Why guard `IF EXISTS pg_type`:** jika exceptions table dibuat via Drizzle push dan type ada, ALTER berjalan; jika type tidak ada (column TEXT), guard skip aman.

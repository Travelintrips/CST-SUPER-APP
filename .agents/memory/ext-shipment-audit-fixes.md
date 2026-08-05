---
name: External Shipment Sales Audit Fixes
description: Gap yang ditemukan dan diperbaiki dari audit alur penjualan external shipment
---

## Gap yang Diperbaiki

### 1. FREIGHT_TO_LOGISTIC_MAP tidak lengkap
- File: `artifacts/api-server/src/lib/services/logisticOrderStatusService.ts`
- Ditambahkan: `pickup: "Pickup"` dan `arrived: "Arrived"`
- **Why:** Freight status `pickup` dan `arrived` tidak dipropagasi ke logistic order — customer tracking tidak update otomatis saat driver pickup/arrived.

### 2. Webhook force=true tanpa pre-state guard
- File: `artifacts/api-server/src/routes/webhooks.ts` — `doApproveOrder()`
- Ditambahkan guard: hanya izinkan APPROVE dari `["Order Received", "Admin Review", "RFQ Sent", "Quote Received"]`
- **Why:** `force: true` bisa menerobos state machine dari status apapun. Endpoint sudah diverifikasi (FONNTE_WEBHOOK_SECRET + isAdmin phone), tapi tanpa pre-state guard bisa approve order yang sudah di status lanjut.

### 3. Vendor tidak dipilih tidak dinotifikasi via WA
- Fungsi baru: `sendVendorNotSelectedWa()` di `orderNotification.ts`
- Template baru: `vendor_not_selected` (recipient: "vendor") di DEFAULT_TPL.admin_personal_extra
- Template diseed di `runWaTemplateMigration()` dan exposed di flatmap admin UI
- Dipanggil dari 3 titik:
  - `logisticRfqV2.ts` action="reject" — selalu kirim jika vendor punya phone
  - `logisticRfqV2.ts` select-vendor/deselect-others — hanya vendor yang sudah respond (status: accepted_basic_price, counter_offer, late_response)
  - `adminAction.ts` compare_vendors_deselect — hanya vendor yang sudah respond

### 4. SOP docs tidak ada (gap semu)
- `docs/` directory tidak ada — tidak ada file SOP untuk diupdate
- Gap ini hanya relevan jika docs dibuat di masa depan

## Pola untuk deselect-others + notifikasi
Gunakan RESPONDED_STATUSES = ["accepted_basic_price", "counter_offer", "late_response"] sebagai filter — jangan kirim WA ke vendor yang belum merespons (pending/expired).

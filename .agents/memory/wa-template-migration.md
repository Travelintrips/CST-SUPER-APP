---
name: WA Template Migration
description: Progress dan pattern migrasi hardcoded WhatsApp flows ke Settings → Template WA
---

## Pattern
```typescript
const tpl = await getWaTemplateConfig("recipient", "workflow", DEFAULT_TPL.recipient.workflow);
const vars: Record<string, string | null | undefined> = { ... };
const msg = renderTemplate(tpl, vars);
sendWhatsApp(phone, msg).catch(...);
```
- Null/undefined vars → baris di-skip di output
- Conditional blocks: `{{#if trucking}}...{{/if}}` via `resolveCondBlocks(body, serviceType)` (3rd param renderTemplate)
- Semua DEFAULT_TPL, flatMap entries, dan export functions ada di `artifacts/api-server/src/lib/orderNotification.ts`
- flatMap `getWaDefaultTemplatesFlatMap()` harus diupdate setiap ada (recipient, workflow) pair baru

## Status Migrasi

### PRIORITAS 1 — vendorJobOrder.ts ✅
8 flows: vendor_assignment, vendor_job_accepted/rejected, vendor_progress_update, vendor_pod_uploaded, customer_progress_update, customer_pod_uploaded, order_completed

### PRIORITAS 2 — sales.ts ✅
5 flows: sales_order_created, quotation_sent, sales_order_confirmed, sales_order_delivered, invoice_issued

### PRIORITAS 3 — logisticOrders.ts + logisticRfq.ts ✅
**logisticOrders.ts** (2 flows):
- `vendor_order_status_change` (vendor) → `sendVendorOrderStatusChangeNotification()`
- `logistic_order_status` (customer) → `sendLogisticOrderStatusCustomerNotification()`

**logisticRfq.ts** (9 flows):
- `vendor_quote_received` (admin_personal) → `sendAdminQuoteNotification()` — replaces local `buildAdminQuoteNotif()`
- Trucking vendor confirmed → `sendTruckingVendorConfirmedAdminNotification()` (reuses `vendor_confirmed`)
- Trucking vendor rejected → `sendTruckingVendorRejectedAdminNotification()` (reuses `vendor_rejected`)
- `quotation_sent_customer` (customer) → `sendQuotationSentCustomerNotification()` — unified trucking+non-trucking
- `rfq_customer_confirmed` (admin_personal) → `sendRfqCustomerConfirmedAdminNotification()`
- `rfq_customer_rejected` (admin_personal) → `sendRfqCustomerRejectedAdminNotification()`
- Multi-mode options → `sendMultiModeOptionsSentNotification()` (reuses `customer_options`)
- `customer_chose_option` (admin_personal) → `sendCustomerChoseOptionAdminNotification()`
- `logistic_operational_status` + `logistic_operational_status_admin` → `sendLogisticOperationalStatusNotification()`

## Key Decisions
- `quotation_sent_customer`: unified template untuk trucking+non-trucking; `pickupInfo`, `truckUnit`, `commodity`, `estimatedPickup`, `estimatedDelivery` bisa null (skip baris). `footerLine` berbeda per mode.
- `buildAdminQuoteNotif` lokal di logisticRfq.ts dihapus — comment stub ditinggalkan.
- `logisticRfq.ts` perlu import dari `../lib/orderNotification.js` (dengan `.js` extension).

**Why:** Template text kini configurable via Settings → Template WA tanpa deploy ulang.

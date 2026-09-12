---
name: Portal Product Order Full Flow
description: End-to-end repair of portal product orders — 5 gaps closed, key decisions and gotchas.
---

## Gaps Fixed

1. **Stock deduction (T001)** — `postStockOut` called on status→Confirmed; uses `getDefaultWarehouseId()` helper; `strict=false` so order proceeds even if stock is 0.
2. **Auto-SO (T002)** — `salesDocumentsTable` record created idempotently (checks `sales_doc_id IS NULL`) when status→Confirmed; source field = `"portal_product"`.
3. **Customer tracking page (T003)** — Public endpoint `GET /api/portal-product/track/:token`; page at `artifacts/customer-portal/src/pages/product-order-track.tsx`; route `/track-produk/:token` in App.tsx; added to both `NO_SHELL_PREFIXES` and `NO_AUTH_CHECK_PREFIXES`.
4. **Invoice + payment (T004)** — `customerInvoiceLinksTable` row created when status→Shipped; `POST /api/portal-product/orders/:id/confirm-payment` and `POST /api/portal-product/orders/:id/resend-invoice`; BizPortal dialog has "Konfirmasi Bayar" + "Kirim Invoice WA" buttons.
5. **Driver assignment (T005)** — `driver_jobs.portal_product_order_id` column added via inline `ALTER TABLE IF NOT EXISTS`; `GET /api/portal-product/drivers`, `GET /api/portal-product/orders/:id/driver`, `POST /api/portal-product/orders/:id/assign-driver`; BizPortal dialog has collapsible driver assignment form.

## Key Gotchas

- **mailer.ts duplicate declarations** — the file was accidentally doubled (two copies of `_hasSmtpKey`, `isSmtpConfigured`, `warmupMailer`). Caused esbuild "already declared" error. Fixed by rewriting the file to remove the first copy.
- **Gateway EXTRA_PORT conflict** — Customer Portal proxy runs on port 23434; Gateway also tries to listen on 23434 as a mirror. Added `.on("error")` handler to Gateway's extra server so EADDRINUSE doesn't crash Gateway.
- **`driverJobsTable` and `driversTable`** are exported from `@workspace/db` (via `lib/db/src/schema/index.ts` → `./driverJobs` and `./drivers`). Can be imported directly in route files.
- **New endpoints not in Orval client** — T005 endpoints use native `fetch()` in BizPortal since Orval codegen was not re-run. This is intentional to avoid blocking; codegen can be run later.

---
name: VMF Invoice Lifecycle
description: Full invoice lifecycle (Invoice Issued → Payment Received → Completed) di customerInvoiceLinksTable — schema, endpoints, status transitions, dan gotchas.
---

## Architecture
- Table: `customer_invoice_links` (lib/db/src/schema/vendorMiniForm.ts)
- Key columns: `paymentStatus` (unpaid/partial/paid), `status` (sent/viewed/paid/completed), `confirmedAt` (TIMESTAMPTZ)
- `confirmedAt` added via boot migration: `ALTER TABLE customer_invoice_links ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ`

## Endpoints (vendorMiniForm.ts)
- `POST /admin/customer-invoices` — create invoice, auto-transitions order → "Invoice Issued"
- `GET  /admin/customer-invoices` — list all invoices
- `GET  /admin/customer-invoices/:id` — detail (select * → spread + parse numerics)
- `POST /admin/customer-invoices/:id/send-wa` — send WA to customer
- `POST /admin/customer-invoices/:id/confirm-payment` — set amountPaid, paymentStatus, confirmedAt; transitions order → "Payment Received"
- `POST /admin/customer-invoices/:id/mark-completed` — set status="completed"; transitions order → "Completed"

## Order Status Transitions (logisticStatusConstants.ts)
- Create invoice → "Invoice Issued"
- Confirm payment (paid) → "Payment Received"
- Mark completed → "Completed"

## Tracking (logisticOrders.ts)
- `invoiceLinksRaw` select MUST include `status: customerInvoiceLinksTable.status` explicitly — without it, field is absent from result even though `CustomerInvoiceLink` type has it.

## Gotchas
- Edits to `logisticOrders.ts` and `vendorMiniForm.ts` source must be verified against ACTUAL file content before restart — silent edit failures caused `status` and `confirmedAt` to be missing. Always re-read the specific lines after editing.
- esbuild does a FULL rebuild each restart (rm distDir first), so dist always reflects latest source.
- `as any` cast in `.set({...} as any)` bypasses TS type check but Drizzle runtime still uses schema — columns in schema ARE included in SQL.
- WA template key: `"customer"` / `"invoice_issued"` — default template in `INVOICE_CUSTOMER_DEFAULT_TPL`.

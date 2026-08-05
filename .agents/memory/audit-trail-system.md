---
name: Audit Trail System
description: Architecture decisions for the logistic order audit trail feature.
---

## Tables
- `order_status_history` — per status change (who, old, new, notes)
- `order_audit_logs` — generic ERP events per order
- `vendor_quote_history` — vendor quote events
- `customer_approval_history` — customer approval events

All created via `drizzle-kit push` from `lib/db/`.

## Helper lib
`artifacts/api-server/src/lib/auditTrail.ts` — all functions are non-fatal (try/catch, never throw).

## API routes
`artifacts/api-server/src/routes/orderAuditTrail.ts` — mounted at `/logistic` in routes/index.ts.
Endpoints: `GET /api/logistic/orders/:orderId/audit-trail`, `/status-history`, `/vendor-quote-history`, `/customer-approval-history`, `/audit-logs`.

## Hooks
Audit logging added to:
- `logisticOrders.ts` (order creation + status change)
- `logisticRfq.ts` (vendor confirm/reject, rfq_blasted, admin approve/vendor_selected)
- `customerQuoteFlow.ts` (quotation sent + customer respond)

## BizPortal UI
Page: `artifacts/bizportal/src/pages/logistics/order-audit-trail.tsx`
Route registered in `artifacts/bizportal/src/routes.tsx` at `/logistics/orders/:orderId/audit-trail` (BEFORE the `:orderId` catch-all).
Audit Trail button added to order-detail.tsx header (violet, Shield icon).

**Why:** routes.tsx is the real router for BizPortal — App.tsx imports it via `AppRoutes`. Adding imports to App.tsx alone is not enough; routes must go in routes.tsx.

**Gotcha:** routes.tsx had a pre-existing duplicate import (`ProductTemplatesPage` at lines 51 and 108). When adding new imports, scan for existing duplicates to avoid parse errors.

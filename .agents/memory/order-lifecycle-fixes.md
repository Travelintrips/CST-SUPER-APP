---
name: Order Lifecycle Sync Fixes
description: Durable decisions and constraints from the order lifecycle sync audit & fix session.
---

## Status: Applied

## Key Rules

### Double Order Create Guard
- `POST /api/logistic/orders` blocks same email within 60-second window (HTTP 429).
- **Why:** Public endpoint, no auth — double-click or network retry creates duplicate orders.
- **How to apply:** If relaxing the window, update both backend (logisticOrders.ts) and add frontend button disable.

### SO Number: One Canonical Path
- SO number for VMF customer-approval ONLY comes from `vmfSoIntegration.ts` (`nextSoNumber()` → format `SO/{YYYY}/{seq padded 5}`).
- The inline SO number generation inside the approval transaction was removed — do NOT re-add it.
- **Why:** Two different formats were being generated; customer_approvals.soNumber was set twice with different values.

### Vendor Selected → logistic_orders.status
- `POST /api/vendor-form/admin/submissions/:id/select` now sets `logistic_orders.status = "Vendor Selected"` inside the same transaction.
- **Why:** Admin had no visual status to filter orders where a vendor had been chosen.

### Customer Approval Link Expiry
- Default expiry is now **7 days** if `expiresInDays` not provided in `POST /api/vendor-form/admin/customer-approvals`.
- **Why:** Previously link never expired — security risk (valid link for unlimited time).

### SO Creation Failure Recovery
- `POST /api/vendor-form/admin/customer-approvals/:id/retry-so` allows admin to retry SO creation if it failed after approval commit.
- **Why:** SO creation happens outside the approval DB transaction; if it fails, approval is committed but no SO exists.
- If the approval has `orderId`, idempotency check in vmfSoIntegration prevents duplicate SO creation.

### Source Field
- `logistic_orders.source` is now `"portal"` for orders created via customer portal (was hardcoded `"manual"`).

## Pre-existing Guards (do NOT re-implement)
- Cart clear after order submit: `localStorage.removeItem("logistic_cart")` already in `onSuccess` of logistic-book.tsx.
- Multiple admin select race: RC-2 FIX — transaction wraps deselect-all + select-one.
- Multiple VMF links: auto-deactivate previous active links for same order in order_based mode.
- Duplicate pending customer approval: DA-1 FIX blocks creating two pending approvals for same orderId.

## Known Remaining Issues (not yet fixed)
- Three parallel vendor operational systems (vendorFulfillment, vendorJobOrder, orderFulfillment) — no canonical system designated.
- Accounting entries not auto-created for SO from VMF (SO lands in sales_documents but not in journal).
- `logistic_orders.approvedVendorId` not set at SO creation time.
- Tax rate (1.1% vs 11%) hardcoded in customer-portal `logistic-cart.ts` frontend.
- Status lists hardcoded in BizPortal logistics pages (not fetched from backend).

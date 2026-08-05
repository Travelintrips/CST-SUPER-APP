---
name: Logistic Order 15-Step Workflow
description: Canonical 15 statuses and their mapping across all surfaces (OrderProgressBar, order-track, BizPortal Status tab)
---

## Canonical 15 Statuses (source: logisticStatusConstants.ts)
Order Received → Admin Review → RFQ Sent → Quote Received → Customer Approval →
Vendor Confirmed → In Progress → Pickup → In Transit → Arrived → Delivered →
POD Uploaded → Invoice Issued → Payment Received → Completed (+Cancelled)

## PROGRESS_STEPS keys (OrderProgressBar.tsx / orderProgress.ts)
ORDER_RECEIVED, ADMIN_REVIEW, RFQ_SENT, QUOTE_RECEIVED, CUSTOMER_APPROVAL,
VENDOR_CONFIRMED, IN_PROGRESS, PICKUP, IN_TRANSIT, ARRIVED, DELIVERED,
POD_UPLOADED, INVOICE_ISSUED, PAYMENT_RECEIVED, COMPLETED

## Legacy aliases (still in DB / old orders)
New Order → Order Received, Under Review → Admin Review,
Quotation Sent → Customer Approval, Confirmed → Vendor Confirmed

**Why:** Multiple surfaces (customer portal tracking, BizPortal status tab, progress bar component)
previously used 6–8 old step names. Fixing required coordinated updates across 5 files.

**How to apply:** When adding new status-related UI, always reference the 15 canonical names.
Use LEGACY_MAP/STATUS_TO_STEP lookups for any data from DB that may have old names.
`updateOrderProgress` now records progress events for ALL 15 status changes (not just 2).

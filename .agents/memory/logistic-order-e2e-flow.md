---
name: Logistic order lifecycle flow
description: Non-obvious status-transition gaps and auto-triggers when driving a logistic order end-to-end (RFQ → driver → invoice → payment).
---

All `logistic_orders.status` changes go through `transitionLogisticOrderStatus` (logisticOrderStatusService.ts), which enforces `LOGISTIC_ORDER_VALID_TRANSITIONS` unless `force:true`. Idempotent (`alreadyAt`). Public routes must never pass `force:true`.

**Gap 1 — customer approval does NOT advance the order.**
`POST /api/logistic/rfq/quote-respond {orderNumber, response:"approved"}` only transitions the *RFQ* (`customer_quoted → customer_approved`). The order stays at `Quote Received`. To reach `Vendor Confirmed` you must drive the order separately: `Quote Received → Customer Approval → Vendor Confirmed` via admin `PUT /api/logistic/orders/:id/status` (each call needs `version` or `clientUpdatedAt` for optimistic lock).
**Why:** in production the order→Vendor Confirmed step happens via the OP-request / vendor-confirm (orderFulfillment) path, not from quote-respond itself.

**Gap 2 — driver steps are matrix-gated (force:false).**
`POST /api/driver-progress/:token` enforces strict step order PICKUP→IN_TRANSIT→ARRIVED→DELIVERED→COMPLETED (photo required for all except IN_TRANSIT) and maps each to a status via rank. Because the transition is force:false, the order must already be at `In Progress` (Vendor Confirmed → In Progress is a separate admin step) before PICKUP works — `Vendor Confirmed → Pickup` is NOT a valid edge.

**Gap 3 — COMPLETED creates the SO but does NOT set "Invoice Issued".**
The COMPLETED driver step → status `POD Uploaded` and fires `autoCreateLogisticInvoice` (fire-and-forget), which inserts a `sales_documents` row (`logisticOrderId` set, `docNumber` SO/YYYY/NNNNN) and sends pod_invoice WA. It does NOT transition the order to `Invoice Issued`; advance that via admin PUT (`POD Uploaded → Invoice Issued`).

**Gap 4 — payment auto-advances to "Payment Received" only when fully paid AND linked.**
`POST /api/accounting/payments {paymentType:"inbound", amount, journalId(bank/cash), date, sourceType:"sales_order", sourceDocId:<salesDocId>}` recalculates the doc paymentStatus; when it becomes `paid` and the doc has `logisticOrderId`, it auto-transitions the order to `Payment Received` (fire-and-forget). Partial payment does not. Then admin PUT `Payment Received → Completed`.

**Vendor selection WA rule:** `select-vendor` only sends not-selected WA to vendors whose link is in a *responded* status (accepted_basic_price / counter_offer / late_response) and has a phone. A vendor that never submitted (waiting_response) gets no WA.

**E2E_TEST_MODE:** set `E2E_TEST_MODE=true` to make `fonnte.ts` short-circuit both `sendWhatsApp`/`sendWhatsAppMedia` — they write `notification_logs.status='simulated'` and skip the real fetch. Dedup only applies to status `'sent'`, so simulated rows always insert.

# Regression Checklist

> Run this checklist after any significant change to validate that Critical, High, and Medium fixes remain intact.

---

## 1. Price Sync

| # | Test | Expected | Status |
|---|---|---|---|
| 1.1 | Admin updates product price in BizPortal | Customer Portal updates within ~1 second (SSE `price_sync`) | |
| 1.2 | Vendor submits `vendorPrice` via RFQ form | `finalPrice = vendorPrice × (1 + markup%)` computed correctly | |
| 1.3 | Admin sets override `sellingPrice` on approve | Uses override value, not auto-computed markup | |
| 1.4 | VMF vendor submits price | `customer_approvals.sellingPrice` reflects correct margin | |
| 1.5 | Price revision (resubmit_allowed) | Previous price saved in `vendor_price_history`; new price active | |

---

## 2. Order Lifecycle

| # | Test | Expected | Status |
|---|---|---|---|
| 2.1 | Customer submits order | `logistic_orders.status = "New Order"` | |
| 2.2 | Admin creates RFQ | `logistic_order_rfqs` record created; status → `"Under Review"` | |
| 2.3 | Vendor accepts via token | `quoteStatus = "vendor_confirmed"`; order → `"Vendor Confirmed"` | |
| 2.4 | Vendor rejects | `quoteStatus = "vendor_rejected"`; admin re-blast available | |
| 2.5 | Admin approves quote | `logistic_orders.status = "Quotation Sent"`; `customerConfirmToken` set | |
| 2.6 | Customer confirms | `status = "Customer Approved"`; `customerConfirmStatus = "confirmed"` | |
| 2.7 | Customer rejects | Status stays `"Quotation Sent"`; `customerConfirmStatus = "rejected"` | |
| 2.8 | Duplicate customer confirm | 409 Conflict — `customerConfirmStatus !== "pending"` guard fires | |
| 2.9 | Driver status update | `driver_jobs` status advances per `VALID_TRANSITIONS` map | |
| 2.10 | Invalid driver transition | 400 with `allowedTransitions` in response | |
| 2.11 | POD submitted | `driver_jobs.status = "DELIVERED"`; `podReceiverName` set | |

---

## 3. Security & Token Validation

| # | Test | Expected | Status |
|---|---|---|---|
| 3.1 | Invalid vendor confirm token | 404 Not Found | |
| 3.2 | Expired vendor mini form link | 410 Gone | |
| 3.3 | Deactivated VMF link | 410 Gone | |
| 3.4 | Vendor using admin-only VMF link | 404 Not Found (`formTarget` mismatch) | |
| 3.5 | External URL in VMF `attachmentUrl` | 400 — only `/objects/...` paths accepted | |
| 3.6 | Customer confirm token reuse | 409 Conflict | |
| 3.7 | RFQ form with wrong token | 404 Not Found | |
| 3.8 | Private file access without auth | 401 Unauthorized | |
| 3.9 | Private file access by wrong user | 403 Forbidden | |
| 3.10 | Path traversal `../` in storage route | Blocked (400 or 404) | |
| 3.11 | Customer approval rate limit | 429 after 5 requests in 10 min (same token) | |

---

## 4. WhatsApp Template

| # | Test | Expected | Status |
|---|---|---|---|
| 4.1 | New order → admin WA | Admin receives WA with correct order details | |
| 4.2 | RFQ blast → vendor WA | Vendor receives WA with short link | |
| 4.3 | Duplicate send within dedup window | `status = "deduped"` in `notification_logs`; no second WA | |
| 4.4 | FONNTE_TOKEN invalid | `status = "failed"` logged; main flow continues (no crash) | |
| 4.5 | Quotation sent → customer WA | Customer receives WA with confirm URL | |
| 4.6 | Customer confirms → admin WA | Admin receives WA with SO number if created | |
| 4.7 | Delivery completed → customer WA | Customer receives delivery notification | |
| 4.8 | SMTP not configured | Email silently skipped; no crash | |
| 4.9 | Template with null variable | Line omitted; no `{{variableName}}` artifact | |
| 4.10 | `WA_DEDUP_WINDOW_MS=0` | Dedup disabled; every send goes through | |

---

## 5. Vendor Mini Form

| # | Test | Expected | Status |
|---|---|---|---|
| 5.1 | Vendor submits form | Saved in `vendor_mini_form_submissions` | |
| 5.2 | Duplicate submit (locked) | 409 — "Penawaran sudah dikunci" | |
| 5.3 | Duplicate submit (no resubmit) | 409 — "Penawaran sudah pernah dikirim" | |
| 5.4 | Max submissions exceeded | 400 QUOTA_EXCEEDED | |
| 5.5 | Missing required field | 400 with `missingFields` list | |
| 5.6 | Revision allowed | Updates existing row; price versioned | |
| 5.7 | Admin selects offer | `customer_approvals` created | |
| 5.8 | Vendor confirmation WA | Vendor receives confirmation WA on submit | |
| 5.9 | Admin notification WA | Admin receives offer summary WA | |

---

## 6. Customer Approval

| # | Test | Expected | Status |
|---|---|---|---|
| 6.1 | Customer approves via VMF link | `customer_approvals.status = "approved"`; submission locked | |
| 6.2 | Customer approves via logistic confirm | `logistic_orders.customerConfirmStatus = "confirmed"` | |
| 6.3 | Idempotent re-approve | No duplicate `customer_approvals` or `sales_documents` record | |
| 6.4 | Rate limit on approval endpoint | 429 after 5 requests in 10 min (same token) | |

---

## 7. Sales Order (SO) Creation

| # | Test | Expected | Status |
|---|---|---|---|
| 7.1 | Customer confirms → SO auto-created | `sales_documents` record with `kind = "order"`, `status = "confirmed"` | |
| 7.2 | SO number format | `SO/YYYY/NNNNN` — sequential, no gaps | |
| 7.3 | Idempotent — second confirm attempt | Existing SO returned; no duplicate | |
| 7.4 | SO linked to logistic order | `sales_documents.logisticOrderId` = order ID | |
| 7.5 | SO created from VMF approval | `createSalesOrderFromVmfApproval()` runs; SO in `sales_documents` | |
| 7.6 | SO creation failure | Error logged; HTTP 200 still returned (non-blocking) | |

---

## 8. Attachment Upload

| # | Test | Expected | Status |
|---|---|---|---|
| 8.1 | Portal customer uploads attachment | File stored at `/objects/uploads/<uuid>`; path returned | |
| 8.2 | Driver uploads POD photo | Stored in GCS; URL in `driver_photos` | |
| 8.3 | Presigned URL upload (BizPortal staff) | File lands in GCS; objectPath registered | |
| 8.4 | Upload > size limit | 400 or 413 rejected by multer | |
| 8.5 | Upload MIME not in whitelist | 400 rejected | |
| 8.6 | Background guard: file > 100MB via presigned | File deleted by background check | |
| 8.7 | Audit log for upload | `storageAuditLog` entry created | |

---

## 9. Timeline / Activity Log

| # | Test | Expected | Status |
|---|---|---|---|
| 9.1 | Order created | `activity_logs` row with `action = "order_created"` | |
| 9.2 | RFQ blasted | `activity_logs` row with `action = "rfq_blasted"` | |
| 9.3 | Vendor confirmed | `activity_logs` row with `action = "vendor_confirmed"` | |
| 9.4 | Vendor rejected | `activity_logs` row with `action = "vendor_rejected"` | |
| 9.5 | Admin selects vendor | `activity_logs` row with `action = "vendor_selected"` | |
| 9.6 | Customer approved | `activity_logs` row with `action = "customer_approved"` | |
| 9.7 | Customer rejected | `activity_logs` row with `action = "customer_rejected"` | |
| 9.8 | SO created | `activity_logs` row with `action = "so_created"` | |
| 9.9 | Driver status update | `activity_logs` row with `action = "shipment_status_updated"` | |
| 9.10 | Driver submits POD | `activity_logs` row with `action = "pod_submitted"` | |
| 9.11 | Activity log failure | Logged as warning; does NOT block main response | |
| 9.12 | BizPortal timeline shows all events | `order-detail.tsx` timeline renders all `activity_logs` rows | |
| 9.13 | WA log panel shows messages | `notification_logs` filtered by `refId = orderNumber` | |

---

## 10. Duplicate Prevention

| # | Test | Expected | Status |
|---|---|---|---|
| 10.1 | Two vendors confirm simultaneously | Only first accepted; second blocked by `NOT IN (...)` status guard | |
| 10.2 | WA duplicate within dedup window | Second message logged as `deduped`, not sent | |
| 10.3 | VMF duplicate submission | 409 if locked or `resubmitAllowed = false` | |
| 10.4 | Duplicate customer confirm | 409 `customerConfirmStatus !== "pending"` | |
| 10.5 | Duplicate SO creation | Idempotency check via `logisticOrderId` — returns existing SO | |
| 10.6 | Duplicate VMF link creation | New token generated each time — not duplicate-safe by design (by intent) | |

---

## Critical / High / Medium Pass Summary

After running the above:

| Priority Level | Count | Pass | Fail | Notes |
|---|---|---|---|---|
| **Critical** | Sections 3, 7, 10 | | | Race conditions, token security, SO idempotency |
| **High** | Sections 1, 2, 5 | | | Price sync, lifecycle, VMF |
| **Medium** | Sections 4, 6, 9 | | | WA template, approval, timeline |

---

## Notes for Re-running After Changes

- Run sections 2 + 7 after any change to `logisticRfq.ts` or `logisticOrders.ts`
- Run section 3 after any change to auth middleware or token generation
- Run section 4 after any change to `fonnte.ts`, `orderNotification.ts`, or `notificationLog.ts`
- Run section 5 after any change to `vendorMiniForm.ts`
- Run section 9 after any change to `activityLog.ts` or `driver.ts`
- Run section 1 after any change to `ecommerce.ts` or `sseManager.ts`

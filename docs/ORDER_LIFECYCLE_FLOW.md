# Order Lifecycle Flow

> CST Logistics — how a customer order moves from creation to delivery and invoicing.

---

## Status Sequence

```
New Order
  └─► Under Review          (admin creates RFQ, blasts to vendors)
        └─► Vendor Confirmed  (vendor accepts via tokenized WA link)
            └─► Quotation Sent (admin selects vendor, sends price to customer)
                  └─► Customer Approved (customer clicks confirm link)
                        └─► In Progress / Pickup / Delivered
                              └─► Completed / Done
                                    └─► Invoiced
```

Parallel rejection paths:
- `Vendor Rejected` — vendor declines; admin re-blasts to other vendors
- `Quotation Sent` (remains) if customer rejects — admin re-negotiates

---

## Phase 1: Customer Creates Order

| | Detail |
|---|---|
| **Endpoint** | `POST /api/logistic/orders` (public) |
| **Tables** | `logistic_orders` (status: `New Order`), `logistic_order_items` |
| **Frontend** | `customer-portal/src/pages/logistic-book.tsx` |
| **Notifications** | Admin receives WA (context: `order_new`); customer gets confirmation email |
| **Activity Log** | `logActivity({ action: "order_created" })` |

Key fields set at creation:
- `orderNumber` — auto-generated (`ORD-YYYYMMDD-NNNN`)
- `publicRfqToken` — UUID for public vendor form URLs
- `status = "New Order"`

---

## Phase 2: Admin Reviews & Blasts RFQ

| | Detail |
|---|---|
| **Endpoints** | `POST /api/logistic/rfq/:orderId/rfq` (auto) or `/:orderId/manual-rfq` |
| **Tables** | `logistic_order_rfqs` (status: `open`), `logistic_order_quotes` |
| **Frontend** | `bizportal/src/pages/logistics/order-detail.tsx` |
| **Activity Log** | `logActivity({ action: "rfq_blasted" })` |

- RFQ number: `RFQ-YYYYMMDD-NNNN`
- Vendor form URL: `/vendor-form?rfq=<rfqNumber>&v=<vendorId>&token=<publicRfqToken>`
- Vendor WA built by `sendVendorWhatsApp()` in `lib/vendorQuoteWa.ts`
- Order status → `"Under Review"`

---

## Phase 3: Vendor Confirms / Rejects

| | Detail |
|---|---|
| **Endpoint** | `POST /api/logistic/orders/vendor-confirm` (token-based, public) |
| **Tables** | `logistic_order_quotes` (quoteStatus: `vendor_confirmed` / `vendor_rejected`) |
| **Frontend** | `customer-portal/src/pages/vendor-quote-form.tsx` |
| **Activity Log** | `logActivity({ action: "vendor_confirmed" | "vendor_rejected" })` |

Pricing at this step:
- Vendor submits `vendorPrice`
- System computes `finalPrice = vendorPrice × (1 + markupPct / 100)`
- Default markup: 20%
- Race-condition guard: `NOT IN ('Vendor Confirmed', 'Customer Confirmed', ...)` in DB update

---

## Phase 4: Admin Selects Vendor & Sends Quotation

| | Detail |
|---|---|
| **Endpoint** | `POST /api/logistic/rfq/:orderId/approve` |
| **Tables** | `logistic_orders` (status: `Quotation Sent`), `logistic_order_quotes` (quoteStatus: `approved`) |
| **Frontend** | `customer-portal/src/pages/approve.tsx` |
| **Activity Log** | `logActivity({ action: "vendor_selected" })` |

At this step:
- `customerConfirmToken` (UUID) is generated and stored on the order
- Customer receives WA + email with confirm URL: `/confirm/<token>`
- `quotationSentAt` is recorded

---

## Phase 5: Customer Confirms or Rejects

| | Detail |
|---|---|
| **Endpoint** | `POST /api/logistic/orders/confirm/:token` (public) |
| **Tables** | `logistic_orders` (customerConfirmStatus: `confirmed` | `rejected`) |
| **Frontend** | Customer-facing confirm page (customer portal) |
| **Activity Log** | `logActivity({ action: "customer_approved" | "customer_rejected" })` |

On **customer_approved**:
- Order status → `"Customer Approved"`
- Sales Order auto-created (see Phase 6)
- Admin receives WA notification

On **customer_rejected**:
- Order stays at `"Quotation Sent"` — admin must re-negotiate
- Idempotency guard: `customerConfirmStatus !== "pending"` → 409 if re-submitted

---

## Phase 6: Sales Order Auto-Creation

| | Detail |
|---|---|
| **Trigger** | Inside `POST /confirm/:token` when action = `"confirmed"` |
| **Tables** | `sales_documents` (kind: `order`, status: `confirmed`), `sales_document_lines` |
| **Activity Log** | `logActivity({ action: "so_created" })` |

Idempotency: checks for existing SO via `logisticOrderId` before inserting.
SO number format: `SO/YYYY/NNNNN` (sequential per year).

---

## Phase 7: Driver Assignment & Tracking

| | Detail |
|---|---|
| **Endpoint** | `POST /api/logistic/orders/:orderId/assign-driver` (admin) |
| **Tables** | `driver_jobs` (status: `ASSIGNED`), `driver_job_logs`, `driver_locations` |
| **Frontend** | `bizportal/src/pages/logistics/order-detail.tsx` → GpsTrackingPanel |
| **Activity Log** | `logActivity({ action: "shipment_status_updated" })` on each status change |

Driver status progression:
```
ASSIGNED → ACCEPTED → ON_THE_WAY_TO_PICKUP → ARRIVED_AT_PICKUP
  → PICKED_UP → IN_TRANSIT → ARRIVED_AT_DESTINATION → DELIVERED → COMPLETED
```

Each transition validates against `VALID_TRANSITIONS` map in `driver.ts`.

---

## Phase 8: Proof of Delivery (POD)

| | Detail |
|---|---|
| **Endpoint** | `POST /api/driver/jobs/:jobId/pod` |
| **Tables** | `driver_jobs` (status: `DELIVERED`), `driver_photos` (type: `pod`) |
| **Activity Log** | `logActivity({ action: "pod_submitted" })` |

After POD:
- Customer receives delivery-completed WA notification
- Admin can trigger invoice creation

---

## Phase 9: Invoicing

| | Detail |
|---|---|
| **Table** | `sales_documents` (invoiceStatus: `to_invoice` → `invoiced`) |
| **Frontend** | BizPortal → Sales module |

---

## Key Tables

| Table | Purpose |
|---|---|
| `logistic_orders` | Master order record + status |
| `logistic_order_items` | Services/items per order |
| `logistic_order_rfqs` | RFQ records per order |
| `logistic_order_quotes` | Vendor quotes per RFQ |
| `sales_documents` | SO / invoice records |
| `sales_document_lines` | Line items on each SO/invoice |
| `driver_jobs` | Driver assignment + delivery status |
| `driver_job_logs` | Status change history |
| `driver_locations` | GPS pings for real-time tracking |
| `driver_photos` | POD and cargo photos |
| `activity_logs` | Full audit trail for each order |
| `notification_logs` | WA/email send history |

---

## Query Keys (BizPortal)

| Data | Query Key | Interval |
|---|---|---|
| Order detail | `["order-detail", orderId]` | 15 s |
| Job/fulfillment | `["order-job", orderId]` | 20 s |
| Fulfillment links | `["order-fulfillment", orderId]` | 15 s |
| Customer approvals | `["order-approvals", orderId]` | 30 s |
| WA notification log | `["wa-logs", orderNumber]` | on-demand |
| All logistic orders | `getListLogisticOrdersQueryKey()` | SSE-driven |

---

## Test Checklist

- [ ] Customer submits order → appears in BizPortal with "New Order" status
- [ ] Admin creates RFQ → vendor receives WA link; order status = "Under Review"
- [ ] Vendor accepts via link → order status = "Vendor Confirmed"
- [ ] Vendor rejects → admin can re-blast to other vendors
- [ ] Admin selects vendor → customer receives WA + email with confirm link
- [ ] Customer confirms → order status = "Customer Approved"; SO created
- [ ] Customer rejects → order stays "Quotation Sent"
- [ ] Duplicate confirm attempt → 409 Conflict
- [ ] Driver updates status → timeline shows shipment_status_updated
- [ ] Driver submits POD → status = DELIVERED; customer notified

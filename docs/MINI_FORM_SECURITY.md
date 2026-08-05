# Vendor Mini Form (VMF) — Security & Flow

> CST Logistics — how the VMF collects vendor quotes, enforces security, handles idempotency, and propagates approvals through to Sales Order creation.

---

## End-to-End Flow

```
Admin creates link (token)
      │
      ▼
Vendor/Customer/Admin receives WA with URL /vendor-mini-form/<token>
      │
      ▼
GET /api/vendor-form/:token  →  validate token, check expiry, return schema
      │
      ▼
Vendor fills and submits form
POST /api/vendor-form/:token  →  server-side validation + idempotency + store
      │
      ├─► WA confirmation to vendor
      ├─► WA summary to admin
      └─► vmf_activity_log entry
            │
            ▼
Admin reviews submissions → selects best offer
POST /api/vendor-form/admin/select-offer
      │
      ▼
customer_approvals record created → customer receives approval link
      │
      ▼
Customer approves → SO created (sales_documents)
      │
      ▼
Vendor receives op-confirm link (vendor_operational_confirmations)
      │
      ▼
Vendor submits driver/truck details → order status = "In Progress"
```

---

## Token Security

### Primary Token (Link Access)
- **Generation:** `crypto.randomBytes(24).toString("hex")` — 48 hex chars = 192 bits entropy
- **Storage:** `vendor_mini_form_links.token` (UNIQUE, indexed)
- **Validation checks (in order):**
  1. `link.isActive === false` → 410 Gone
  2. `link.expiresAt < now` → 410 Gone
  3. `link.formTarget !== expectedTarget` → 404 (prevents vendor using admin-only link)
- **In-memory cache:** Token → link data cached for 5 min (`TOKEN_CACHE`) to reduce DB load
- **Cache invalidation:** `invalidateTokenCache(token)` called on any link state change

### Stateless Response Token (HMAC)
Used for certain flows (e.g., vendor status tracking) without pre-storing every response:
- Built with HMAC-SHA256 using a rolling 48-hour window as part of the key
- `signVendorResponseToken(token)` / `verifyVendorResponseToken(token, sig)`
- Expires automatically when window rolls over

---

## Rate Limiting

| Endpoint | Limit | Window |
|---|---|---|
| `GET /api/vendor-form/:token` | 60 req | 15 min (per IP) |
| `POST /api/vendor-form/:token` | 10 req | 15 min (per IP) |
| `GET/POST /api/vendor-form/customer-approval/:token` | 5 req | 10 min (per token) — stricter |
| `POST /api/vendor-form/upload/:token` | Separate VMF upload limiter | — |

Customer approval has a **per-token** key (not per-IP) to prevent WA/activity-log spam from multiple IPs sharing a link.

---

## Submission Idempotency & Race Conditions

### Duplicate submission prevention:
```typescript
// 1. Check for existing submission (anti-duplicate)
const [existing] = await db.select({ id, locked })
  .from(vendorMiniFormSubmissionsTable)
  .where(eq(token, token)).limit(1);

if (existing?.locked) → 409 "Penawaran sudah dikunci"
if (!link.resubmitAllowed) → 409 "Penawaran sudah dikirim"
```

### Quota check (max_submissions) with transactional lock:
```typescript
// Uses SELECT FOR UPDATE in transaction to prevent race condition
// when multiple vendors submit simultaneously
await db.transaction(async (tx) => {
  const [cntRow] = await tx.select({ cnt: count() })
    .where(eq(linkId, link.id));
  if (cnt >= link.maxSubmissions) throw "QUOTA_EXCEEDED";
  // ... insert submission
});
```

### Revision flow (resubmit_allowed):
- Previous price saved to `vendor_price_history` before update
- `revisionCount` incremented on `vendor_mini_form_submissions`

---

## Server-Side Schema Validation

Every submission validated against `SERVICE_SCHEMAS[link.serviceType]`:
```typescript
const requiredKeys = schema.fields
  .filter(f => f.required && f.section matches activePhase)
  .map(f => f.key);
const missingFields = requiredKeys.filter(k => !formData[k]?.trim());
if (missingFields.length > 0) → 400 with list
```

Active phase: `link.phase ?? "quotation"` (can be `"quotation"` or `"operational"`)

---

## Attachment URL Validation

Prevents SSRF/XSS via attachment URL injection:
```typescript
if (attachmentUrl && !attachmentUrl.startsWith("/objects/")) {
  return res.status(400).json({ error: "attachmentUrl tidak valid" });
}
```

Only paths from Replit Object Storage (`/objects/...`) are accepted. External URLs (`https://...`) are rejected outright.

---

## Customer Approval Security

Approval link: `/vendor-mini-form/customer-approval/<token>`

Approval flow uses a DB transaction to atomically:
1. Check current `customer_approvals.status === "pending"`
2. Set `status = "approved"` + `approvedAt = now()`
3. Lock the linked submission (`vendor_mini_form_submissions.locked = true`)

**Locking prevents:** vendor from revising price after customer has committed.

After approval, `createSalesOrderFromVmfApproval()` is called:
- Idempotency: checks `sales_documents` for existing `logisticOrderId` match before inserting
- SO number: `SO/YYYY/NNNNN` (sequential per year)

---

## Key Tables

| Table | Purpose |
|---|---|
| `vendor_mini_form_links` | Token, config, expiry, form target, service type |
| `vendor_mini_form_submissions` | Form data, prices, status, lock flag |
| `customer_approvals` | Customer approval status, margin, price |
| `vendor_operational_confirmations` | Post-approval driver/truck details |
| `vendor_price_history` | Price revision audit trail |
| `vmf_activity_log` | Detailed action audit trail |
| `order_updates` | High-level timeline visible to staff/customers |

---

## Key Endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /api/vendor-form/:token` | Public (token) | Load form data |
| `POST /api/vendor-form/:token` | Public (token) | Submit form |
| `POST /api/vendor-form/upload/:token` | Public (token) | Upload attachment |
| `GET /api/vendor-form/customer-approval/:token` | Public (token) | Load approval data |
| `POST /api/vendor-form/customer-approval/:token/respond` | Public (token) | Approve/reject |
| `GET /api/vendor-form/admin/*` | Clerk auth | Admin management |
| `POST /api/vendor-form/admin/links` | Clerk auth | Create link |
| `POST /api/vendor-form/admin/select-offer` | Clerk auth | Select vendor offer |

---

## VMF vs RFQ: When to Use Which

| | Vendor Mini Form | Logistic RFQ |
|---|---|---|
| **Best for** | Structured data collection (sea freight, custom clearance, warehousing) | Quick trucking quote blast |
| **Schema validation** | Yes — per `serviceType` | No strict schema |
| **Customer approval** | Yes — full `customer_approvals` flow | Yes — via `customerConfirmToken` |
| **SO creation** | `createSalesOrderFromVmfApproval()` | Auto in `/confirm/:token` |
| **Operational details** | Yes — `vendor_operational_confirmations` | No |

---

## Test Checklist

- [ ] Expired link → 410 Gone
- [ ] Deactivated link → 410 Gone
- [ ] Vendor using admin-only link → 404 Not Found
- [ ] Duplicate submission (locked) → 409 Conflict
- [ ] Duplicate submission (no resubmit allowed) → 409 Conflict
- [ ] External `attachmentUrl` in submission → 400 Rejected
- [ ] Missing required fields → 400 with field names
- [ ] Max submissions exceeded → 400 QUOTA_EXCEEDED
- [ ] Customer approval → submission locked
- [ ] Revision after customer approval → blocked (locked)
- [ ] Customer approval rate limit (>5 in 10 min same token) → 429
- [ ] SO created after customer approval → idempotent (re-approve doesn't double-create)
- [ ] Operational confirmation → logistic order status = "In Progress"

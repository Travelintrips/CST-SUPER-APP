# WhatsApp (& Email) Notification Flow

> CST Logistics — how WA messages are built, sent via Fonnte, deduplicated, and logged.

---

## Architecture Overview

```
Business Event
     │
     ▼
orderNotification.ts / vendorQuoteWa.ts / fonnte.ts
     │  renderTemplate(body, vars, serviceType)
     ▼
Deduplication Guard (SHA-256 dedupKey in notification_logs)
     │  skip if same context+refId sent within WA_DEDUP_WINDOW_MS (default 30 min)
     ▼
Fonnte API  POST https://api.fonnte.com/send
     │
     ▼
logNotification()  →  notification_logs table
```

---

## Template System

### Storage
Templates are stored in `wa_template_configs` table, keyed by:
- `recipient`: `admin_personal` | `admin_group` | `vendor` | `customer`
- `workflow`: `order_new` | `vendor_request` | `quotation_send` | `shipment_update` | ...

Falls back to hardcoded defaults (`DEFAULT_TPL`) in `orderNotification.ts` if no DB record exists.

### Rendering (`renderTemplate`)
Located in `artifacts/api-server/src/lib/orderNotification.ts`.

**Variable substitution:**
```
{{variableName}}  →  replaced with value
                     if value is empty/null → entire line is omitted
```

**Conditionals:**
```
{{#if serviceTypeKey}}
  ... block shown only if serviceType matches ...
{{/if}}
```

**Service types** (derived by `deriveServiceType`):
| Shipment Type | Key |
|---|---|
| FCL, LCL, sea freight | `freight_sea` |
| Air freight | `freight_air` |
| Trucking | `trucking` |
| Custom clearance / PPJK | `ppjk` |
| Product orders | `product` |

**Post-processing:**
- Triple-newlines collapsed to double after conditional block removal
- Leading/trailing whitespace trimmed per line

---

## Sending via Fonnte (`lib/fonnte.ts`)

```typescript
sendWhatsApp(phone, message, {
  context: "vendor_quote",   // used for dedup + log filtering
  refType: "order",
  refId: "ORD-20250101-001", // order number or RFQ number
})
```

**Phone normalization:** `normalizePhoneID()` converts `08xx` → `628xx`

**HTTP call:**
- `POST https://api.fonnte.com/send`
- `Authorization: <FONNTE_TOKEN>`
- `Content-Type: application/x-www-form-urlencoded`
- Body: `target=628xx&message=...&countryCode=62`

---

## Deduplication Guard

A SHA-256 hash (`dedupKey`) is computed from:
```
channel:recipient:context:refId:bucket
```

Where `bucket` = current timestamp divided by `WA_DEDUP_WINDOW_MS` (default 30 min → `1800000`).

The `notification_logs` table has a UNIQUE constraint on `dedup_key`. An `ON CONFLICT DO NOTHING` insert is used — if the key already exists, the message is skipped and logged as `status = "deduped"`.

**Configuring the window:**
```
WA_DEDUP_WINDOW_MS=1800000   # 30 minutes (default)
```

---

## Logging (`lib/notificationLog.ts` → `notification_logs`)

Every send attempt is recorded:

| Column | Values |
|---|---|
| `channel` | `wa` \| `email` |
| `status` | `sent` \| `failed` \| `deduped` |
| `context` | e.g. `order_new`, `vendor_quote`, `quotation_sent_customer` |
| `refType` | `order` \| `rfq` \| etc. |
| `refId` | Order number or RFQ number |
| `recipient` | Phone number or email address |
| `errorMsg` | Only on `failed` status |
| `dedupKey` | SHA-256 hash used for deduplication |

**Admin view:** `GET /api/whatsapp/notification-logs?refId=<orderNumber>&limit=50`

**BizPortal panel:** Collapsible "Log Notifikasi WA/Email" on each order detail page.

---

## Context Values Reference

| Context | Trigger |
|---|---|
| `order_new` | New order submitted by customer |
| `vendor_quote` | RFQ blast to vendor |
| `vendor_confirmed` | Vendor accepts the job |
| `vendor_rejected` | Vendor rejects the job |
| `quotation_sent_customer` | Admin sends quote to customer |
| `customer_confirmation` | Customer approves/rejects quote |
| `shipment_update` | Driver status change notification |
| `delivery_completed` | POD submitted; customer notified |
| `admin_action` | Link for admin to take action without login |

---

## Specialized Senders

### `sendVendorWhatsApp()` (`lib/vendorQuoteWa.ts`)
High-level helper for RFQ vendor blasts:
1. Shortens vendor form URLs via `generateShortLink()` → `/q/<code>`
2. Determines service type from order items
3. Builds product list if it's a product order
4. Fetches `vendor_request` template from DB
5. Calls `sendWhatsApp()` with `context: "vendor_quote"`, `refId: rfqNumber`

### `sendDeliveryCompletedNotification()` (`lib/orderNotification.ts`)
Triggered after POD submit, sends delivery confirmation to customer.

---

## Email (`lib/mailer.ts`)

Triggered in parallel with WA for key events:
- New order created → customer confirmation email
- Quotation sent → customer HTML email with confirm/reject buttons
- Guard: `isSmtpConfigured()` — skips gracefully if SMTP env vars not set

SMTP env vars: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`

---

## Security Rules

1. `FONNTE_TOKEN` stored in environment secrets — never logged
2. Phone numbers normalized before sending — prevents format injection
3. Deduplication window prevents spam / event replay attacks
4. Failed sends do not throw — they are logged and the main flow continues
5. `WA_DEDUP_WINDOW_MS` can be set to `0` to disable dedup (dev only)

---

## Test Checklist

- [ ] New order → admin receives WA with correct order details
- [ ] RFQ blast → vendor receives WA with short link
- [ ] Duplicate blast within window → second message logged as `deduped`
- [ ] Vendor confirms → admin receives WA with price + approve link
- [ ] Admin sends quotation → customer receives WA + email with confirm link
- [ ] Customer confirms → admin receives WA confirmation
- [ ] Delivery completed → customer receives WA delivery notification
- [ ] SMTP not configured → email silently skipped, no crash
- [ ] FONNTE_TOKEN invalid → `failed` status logged, main flow continues
- [ ] Admin WA log panel shows all messages for an order (filtered by refId)

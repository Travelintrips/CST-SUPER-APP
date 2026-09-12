# System Sync Flow

> CST Logistics — how real-time data flows from the backend to BizPortal, Customer Portal, and the Driver App using SSE, polling, and query invalidation.

---

## Overview

```
Backend DB change
      │
      ├─► saveAndBroadcast()      →  admin_notifications table
      │        │                      + broadcastToAdmins() via SSE
      │        ▼
      │   BizPortal SSE listener
      │   useOrderNotifications() → toast + sound + query invalidation
      │
      ├─► broadcastToPortal()    →  Customer Portal SSE
      │        │
      │        ▼
      │   portal.tsx / products.tsx  → queryClient.invalidateQueries(["portal-products"])
      │
      └─► pushToDriver()         →  Driver App SSE (per driverId)
               │
               ▼
          Driver mobile app → real-time job/location update
```

---

## SSE Manager (`lib/sseManager.ts`)

Three connection sets maintained in memory:

| Set | Used by | Key |
|---|---|---|
| `adminConnections` | BizPortal | one per tab/session |
| `portalConnections` | Customer Portal | one per tab/session |
| `driverConnections` | Driver App | keyed by `driverId` |

**Key functions:**
```typescript
broadcastToAdmins(event, data)   // → all BizPortal connections
broadcastToPortal(event, data)   // → all Customer Portal connections
pushToDriver(driverId, event, data)  // → specific driver connection
```

**Heartbeat:** `:keepalive` sent every 30 seconds to prevent timeout and prune ghost connections.

---

## SSE Endpoints

| Endpoint | Consumer | Events |
|---|---|---|
| `GET /api/notifications/events` | BizPortal | `new_order`, `new_logistic_order`, `notification` |
| `GET /api/drivers/events` | BizPortal (map) | `job_status_changed`, `location_update`, `geofence_alert` |
| `GET /api/ecommerce/events` | Customer Portal | `price_sync`, `product_update` |
| `GET /api/driver/events` | Driver App | `job_assigned`, `job_updated` |

---

## `saveAndBroadcast` (`lib/notificationStore.ts`)

Used for persistent admin notifications:
1. Inserts record into `admin_notifications` table
2. Calls `broadcastToAdmins()` with payload
3. DB failure does NOT block the broadcast (fail-safe)

Triggered by: new logistic orders, new product orders, status changes.

---

## Price Sync Flow (`broadcastToPortal`)

Triggered whenever a product, service, or category is modified in the BizPortal:

```
Admin updates product price
      │
      ▼
POST /api/ecommerce/products/:id  or  DELETE /api/ecommerce/products/:id
      │
      ▼
broadcastToPortal("price_sync", { productId, action })
      │
      ▼
Customer Portal EventSource listener
      │
      ▼
queryClient.invalidateQueries(["portal-products"])
      │
      ▼
Re-fetch product list → UI updates instantly
```

---

## BizPortal Frontend (`hooks/useOrderNotifications.ts`)

| Event | Action |
|---|---|
| `new_order` | Toast + sound chime + invalidate order list |
| `new_logistic_order` | Toast + sound + invalidate logistic order list |
| `job_status_changed` | Update driver job status in real-time |
| `location_update` | Update driver position on GPS map |
| `geofence_alert` | Show geofence deviation alert |

**Polling fallback (every 60 s):**
- Fetches `GET /api/notifications/unread-count`
- If server count > local count → triggers full notification list re-fetch
- Ensures UI consistency even if SSE connection drops

---

## TanStack Query Key Convention (BizPortal)

| Data | Query Key | Invalidation trigger |
|---|---|---|
| Logistic order list | `getListLogisticOrdersQueryKey()` | SSE `new_logistic_order` |
| Order detail | `["order-detail", orderId]` | Mutation success + 15s interval |
| Driver job | `["order-job", orderId]` | Mutation success + 20s interval |
| Fulfillment links | `["order-fulfillment", orderId]` | Mutation success + 15s interval |
| Customer approvals | `["order-approvals", orderId]` | Mutation success + 30s interval |
| WA log (per order) | `["wa-logs", orderNumber]` | On-demand (lazy, 30s stale) |
| Portal products | `["portal-products"]` | SSE `price_sync` |
| Vendors | `["logistic-vendors"]` | 5 min stale time |

---

## Key Files

| File | Purpose |
|---|---|
| `lib/sseManager.ts` | SSE connection registry + broadcast functions |
| `lib/notificationStore.ts` | `saveAndBroadcast()` — DB persist + SSE push |
| `routes/notifications.ts` | `/api/notifications/*` endpoints |
| `routes/driver.ts` | Driver SSE endpoint + location push |
| `routes/ecommerce.ts` | Product/price update → `broadcastToPortal()` |
| `bizportal/src/hooks/useOrderNotifications.ts` | BizPortal SSE consumer + polling |

---

## Test Checklist

- [ ] New logistic order → BizPortal shows toast + sound without page refresh
- [ ] Product price update → Customer Portal updates within ~1 second
- [ ] Driver location ping → BizPortal map moves driver marker in real-time
- [ ] SSE connection drops → polling fallback catches unread notifications within 60 s
- [ ] Multiple BizPortal tabs open → all receive the same SSE events
- [ ] Driver offline → `driverConnections` clears stale connection on reconnect
- [ ] New order event → order list query key invalidated → list refreshes
- [ ] Geofence deviation → admin sees alert in BizPortal

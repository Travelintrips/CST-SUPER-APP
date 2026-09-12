---
name: Logistics module audit map
description: Key structural facts about the logistics/forwarding modules — route collisions, dead code, table ownership, and unified shipment schema additions.
---

## Route namespaces (6 total)
- `/api/logistics/*` → `freight.ts` — General Freight (MASTER table: `freight_shipments`)
- `/api/logistic/orders/*` → **3 routers stacked**: `logisticRfqRouter`, `productFirstFlowRouter`, `logisticOrdersRouter` (collision risk — Express resolves first match)
- `/api/logistic/*` → `logisticRfqV2Router`, `customerQuoteAdminRouter`, `fulfillmentAdminRouter`, `vendorJobAdminRouter`, `orderAuditTrailRouter`, `orderExceptionsRouter`
- `/api/air-freight/*` → `airFreightNewRouter` (default) + `airFreightRatesRouter` + `airFreightPublicRouter`
- `/api/ocean-freight/*` → `oceanFreightPublicRouter` + `oceanFreightRatesRouter` + `oceanFreightRouter` (has GET /:id catch-all — mount order critical)
- `/api/trucking-rates/*`, `/api/trucking/bookings/*` — separate trucking endpoints

## Dead import (frozen 2026-06-11)
`airFreightRouter` (named export from airFreight.js) was imported in index.ts line 127 but NEVER mounted. Commented out with FROZEN label. Only default export `airFreightNewRouter` is active.

## Table ownership
- `freight_shipments` → `freight.ts` — MASTER, Drizzle schema at `lib/db/src/schema/freightShipments.ts`
- `logistic_orders` → `logisticOrders.ts` — trucking + portal orders
- `shipments` (legacy) → `logistics.ts` — FROZEN, do not add data
- `air_freight_orders`, `ocean_freight_orders` — raw SQL boot migrations (NOT in lib/db Drizzle schema)

## Unified Shipment Core fields (added 2026-06-11)
Added to `freight_shipments` table and Drizzle schema — all nullable, data-safe:
- `service_category` ENUM: `FF_UDARA|FF_LAUT|PPJK|TRUCKING|MULTIMODAL|GENERAL_FORWARDING`
- `source_module` TEXT: which module created this shipment
- `source_order_id` INTEGER: ID in source table (no FK constraint, intentionally cross-table)

**Why:** Enables unified reporting and traceability across all forwarding service types without breaking existing records.

## Audit report location
`UNIFIED_LOGISTICS_AUDIT_REPORT.md` at project root — full mapping of active modules, deprecated files, route overlaps, table overlaps, sidebar duplicates, and backlog.

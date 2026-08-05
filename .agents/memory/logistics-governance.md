---
name: Logistics governance doc
description: Where to find naming rules, guardrails, checklist, and tech-debt inventory for the logistics module.
---

## Key facts

- **Canonical document:** `docs/LOGISTICS_MODULE_MAP.md` (822 lines, 2026-06-11)
- Also linked from `replit.md` under "Logistics Module Governance" section.

## Core rules (apply without reading the full doc)

### API prefix
| Namespace | Prefix |
|---|---|
| Core freight | `/api/logistics/` |
| Air freight | `/api/air-freight/` |
| Ocean freight | `/api/ocean-freight/` |
| Trucking | `/api/trucking/` |
| Portal orders & fulfillment | `/api/logistic/` (no 's' — legacy, keep for compat) |
| Driver (admin) | `/api/drivers/` |
| Driver (driver-facing) | `/api/driver/` |

### Frontend page prefix
- Core: `/logistics/...`
- Air freight: `/air-freight/...`
- Ocean freight: `/logistics/ocean-freight-...`
- Settings: `/settings/trucking-rates`, `/settings/logistics-units`

### DB table prefix
`freight_`, `logistic_`, `air_freight_`, `ocean_freight_`, `trucking_`, `driver_`

**Why:** Enforced in FASE 9 to prevent duplicate module creation. Any new logistics table without one of these prefixes is likely a mistake.

## Known tech debt (as of 2026-06-11)

1. `trucking_booking_requests` and `trucking_vehicle_rates` defined via raw SQL in route boot, not Drizzle schema.
2. `air_freight_*` and `ocean_freight_*` tables defined TWICE: Drizzle schema + raw SQL boot — risk of divergence.
3. `shipments` table (old): frozen, only read by dashboard.ts for count. Plan: update dashboard → `freight_shipments`, then DROP.
4. `GET /api/ocean-freight/orders` times out via API (>12s), but direct DB query is fast (<1s). Suspected: connection pool contention during long boot migration.
5. `GET /api/logistic/vendor-fulfillments` returns 404 — router has no root GET `/` list route.
6. `drizzle-kit push` silently skips new columns when enum type is also new. Always verify via `information_schema.columns` after push.

## Decision tree (short form)

- Customer order from portal → `logistic_orders`
- Confirmed shipment (any mode) → `freight_shipments` (serviceCategory = FF_UDARA/FF_LAUT/PPJK/TRUCKING/MULTIMODAL)
- Air booking details → `air_freight_orders` + link to `freight_shipments`
- Ocean booking details → `ocean_freight_orders` + link to `freight_shipments`
- Customs only (no transport) → `freight_shipments` with serviceCategory='PPJK' directly

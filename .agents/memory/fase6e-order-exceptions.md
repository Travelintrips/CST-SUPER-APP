---
name: FASE 6E Order Exceptions
description: Per-order exception tracking (damaged goods, vendor no response, etc.) — architecture, endpoints, and UI panel location.
---

## Architecture
- Reuses existing `exceptions` table via `refType='logistic_order'` + `refId=String(orderId)` pattern.
- No new table needed; 3 new columns added via migration: `reported_by_type`, `reported_by_id`, `attachments JSONB`.
- New exception types added: `vendor_no_response`, `customer_reject`, `damaged_goods`, `missing_goods`, `pricing_dispute`, `delivery_failed`, `payment_issue`.
- New status values: `investigating`, `rejected`.

## New files
- `artifacts/api-server/src/routes/orderExceptions.ts` — `orderExceptionsRouter` with 3 endpoints.
- Mounted in `routes/index.ts` under `/logistic`.
- Migration: `runOrderExceptionsMigration()` in `exceptionService.ts`, called in `index.ts` chain after `runExceptionEnumMigration`.

## Endpoints
- `GET  /api/logistic/orders/:orderId/exceptions` — list exceptions for order, sorted by status priority then severity.
- `POST /api/logistic/orders/:orderId/exceptions` — create exception; fires `logOrderAudit` + WA to admin group.
- `PATCH /api/logistic/exceptions/:id/status` — quick status update + optional resolutionNotes; sets resolvedAt/resolvedBy on terminal statuses.

## Frontend
- `ExceptionPanel` component in `order-detail.tsx` — collapsible card in right column, above `WaNotificationLogPanel`.
- Badge counter shows count of open/investigating exceptions.
- "Laporkan" button opens create dialog (type + severity + title + description).
- Per-exception action buttons: "Investigasi" (open→investigating) + "Selesaikan" (→resolved with notes dialog).

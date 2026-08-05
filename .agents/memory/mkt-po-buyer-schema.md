---
name: Marketplace PO Buyer Portal Schema
description: Correct field names for mktPoShipmentsTable, mktPoShipmentEventsTable, mktPoGoodsReceiptsTable, and ownership gate pattern for buyer portal endpoints.
---

## mktPoShipmentsTable field names (common mistakes)
- Status: `shipmentStatus` (NOT `status`)
- Carrier: `carrierName` (NOT `carrier`)
- Location: `origin`, `destination` (NOT `originAddress`, `destinationAddress`)
- Arrival: `estimatedArrival`, `actualArrival` (NOT `estimatedDelivery`, `actualDelivery`)
- Departure: `plannedDeparture`, `actualDeparture`

## Shipment status values (lifecycle)
`planned → packing → loading → ready_to_ship → in_transit → customs → warehouse → arrived → delivered` (or `cancelled` from any pre-delivered state)

## mktPoShipmentEventsTable field names
- Note: `note` (NOT `description`)  
- No `occurredAt` column — use `createdAt` for event timestamp
- Ordered by: `eventSequence` (integer, APPEND-ONLY — never updated/deleted)

## mktPoGoodsReceiptsTable
- Has `receiptNumber` (format: MKT-GR-YYYYMM-XXXX)
- `inspectionStatus`: "pending" | "passed" | "failed" (default: "pending")
- `receiptType`: "full" | "partial" | "rejected"

## Buyer portal ownership gate pattern
All admin PO/shipment endpoints use `requireAdmin`. For buyer portal access, add endpoints to `mktPortal.ts` using:
```ts
// Ownership via INNER JOIN — scopes to buyer's POs only
.innerJoin(mktRfqsTable, and(
  eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
  eq(mktRfqsTable.portalCustomerId, portalCustomerId), // ownership gate
))
```

For shipment/timeline/goods-receipt endpoints: first call `getShipmentById(shipmentId)` to get `poId` via `(shipment as any).poId`, then verify the PO ownership as above.

**Why:** mktRfqsTable.portalCustomerId is the only buyer identity FK available. The PO→RFQ→portalCustomerId chain is the canonical ownership path.

## Goods receipt creation by buyer
Creation (`POST`) is admin-only (mktAdmin.ts). Buyer portal has read-only access via `GET /api/mkt/portal/shipments/:shipmentId/goods-receipts`. Show GapBanner for creation UI — do NOT add a buyer POST endpoint without explicit requirement.

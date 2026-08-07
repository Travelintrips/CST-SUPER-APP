/**
 * mktVendorPo.ts — Phase 2G: Public vendor PO confirmation (token-based)
 *
 * No admin session required — access is gated purely by the opaque 64-hex
 * vendor token embedded in the URL. Rate-limited via publicTokenRateLimiter
 * (mounted in routes/index.ts alongside other public token surfaces) to
 * blunt brute-force enumeration attempts.
 *
 * Endpoints:
 *   GET  /api/mkt/vendor-po/:token                    — sanitized PO view
 *   POST /api/mkt/vendor-po/:token/accept              — vendor accepts
 *   POST /api/mkt/vendor-po/:token/reject              — vendor rejects (body: { reason? })
 *   POST /api/mkt/vendor-po/:token/request-revision    — vendor requests changes (body: { notes })
 *
 * Never expose commission/margin/target price/ranking — getVendorPoView()
 * in mktPoLifecycleService.ts uses an explicit allow-list.
 */

import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, mktPoShipmentEventsTable, mktPoShipmentItemsTable, mktPoShipmentsTable } from "@workspace/db";
import { and, asc, eq } from "drizzle-orm";
import {
  getVendorPoView,
  vendorAcceptPo,
  vendorRejectPo,
  vendorRequestRevision,
} from "../lib/services/mktPoLifecycleService.js";
import {
  appendShipmentEventForVendor,
  createShipmentForVendor,
} from "../lib/services/mktPoShipmentService.js";
import { findPoByVendorToken } from "../lib/services/mktVendorPoTokenService.js";
import { logger } from "../lib/logger.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import { tokenGetRateLimiter, tokenPostRateLimiter } from "../middlewares/securityRateLimiter.js";

const router: IRouter = Router();

const AcceptVendorPoSchema = z.object({}).strict();
const RejectVendorPoSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
}).strict();
const RequestRevisionSchema = z.object({
  notes: z.string().trim().min(1).max(4000),
}).strict();

const VendorShipmentItemSchema = z.object({
  poLineId: z.coerce.number().int().positive(),
  lineNumber: z.coerce.number().int().positive().optional(),
  qty: z.coerce.number().finite().positive(),
  uom: z.string().trim().max(50).optional().nullable(),
  weight: z.coerce.number().finite().positive().optional().nullable(),
  volume: z.coerce.number().finite().positive().optional().nullable(),
  packageCount: z.coerce.number().int().positive().optional().nullable(),
  remarks: z.string().trim().max(2000).optional().nullable(),
}).strict();

const CreateVendorShipmentSchema = z.object({
  shipmentType: z.string().trim().max(100).optional().nullable(),
  carrierName: z.string().trim().max(200).optional().nullable(),
  trackingNumber: z.string().trim().max(200).optional().nullable(),
  vehicleType: z.string().trim().max(100).optional().nullable(),
  vehicleNumber: z.string().trim().max(100).optional().nullable(),
  driverName: z.string().trim().max(200).optional().nullable(),
  driverPhone: z.string().trim().max(50).optional().nullable(),
  containerNumber: z.string().trim().max(100).optional().nullable(),
  sealNumber: z.string().trim().max(100).optional().nullable(),
  origin: z.string().trim().max(500).optional().nullable(),
  destination: z.string().trim().max(500).optional().nullable(),
  plannedDeparture: z.coerce.date().optional().nullable(),
  estimatedArrival: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  items: z.array(VendorShipmentItemSchema).min(1).max(500),
}).strict();

const VendorShipmentEventSchema = z.object({
  // Public aliases are normalized to the canonical append-only event names.
  eventType: z.enum(["started", "pickup", "in_transit", "delivered", "packing", "loaded", "departed"]),
  note: z.string().trim().max(2000).optional().nullable(),
  location: z.string().trim().max(500).optional().nullable(),
  latitude: z.coerce.number().finite().min(-90).max(90).optional().nullable(),
  longitude: z.coerce.number().finite().min(-180).max(180).optional().nullable(),
}).strict();

function normalizeVendorEventType(eventType: string): "packing" | "loaded" | "departed" | "delivered" {
  switch (eventType) {
    case "started":
      return "packing";
    case "pickup":
      return "loaded";
    case "in_transit":
      return "departed";
    default:
      return eventType as "packing" | "loaded" | "departed" | "delivered";
  }
}

function safeShipmentView(row: typeof mktPoShipmentsTable.$inferSelect) {
  return {
    id: row.id,
    shipmentNumber: row.shipmentNumber,
    shipmentStatus: row.shipmentStatus,
    shipmentType: row.shipmentType,
    carrierName: row.carrierName,
    trackingNumber: row.trackingNumber,
    vehicleType: row.vehicleType,
    vehicleNumber: row.vehicleNumber,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    containerNumber: row.containerNumber,
    sealNumber: row.sealNumber,
    origin: row.origin,
    destination: row.destination,
    plannedDeparture: row.plannedDeparture,
    actualDeparture: row.actualDeparture,
    estimatedArrival: row.estimatedArrival,
    actualArrival: row.actualArrival,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeShipmentEventView(row: typeof mktPoShipmentEventsTable.$inferSelect) {
  return {
    id: row.id,
    shipmentId: row.shipmentId,
    eventSequence: row.eventSequence,
    eventType: row.eventType,
    note: row.note,
    location: row.location,
    latitude: row.latitude,
    longitude: row.longitude,
    attachmentObjectPath: row.attachmentObjectPath,
    createdAt: row.createdAt,
  };
}

function mapTokenFailureStatus(code: string): number {
  switch (code) {
    case "MALFORMED":
      return 400;
    case "EXPIRED":
      return 410;
    case "NOT_FOUND":
      return 404;
    case "INVALID_TRANSITION":
      return 409;
    case "CONCURRENT_UPDATE":
      return 409;
    default:
      return 400;
  }
}

router.get("/:token", tokenGetRateLimiter, async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await getVendorPoView(token);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Token tidak valid atau kadaluarsa", code: result.code });
    }
    res.json(result.view);
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] GET /:token error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/accept", tokenPostRateLimiter, validateBody(AcceptVendorPoSchema), async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await vendorAcceptPo(token);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber, alreadyAccepted: result.alreadyAccepted === true });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/accept error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/reject", tokenPostRateLimiter, validateBody(RejectVendorPoSchema), async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await vendorRejectPo(token, req.body.reason ?? null);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber, alreadyRejected: result.alreadyRejected === true });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/reject error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/request-revision", tokenPostRateLimiter, validateBody(RequestRevisionSchema), async (req, res) => {
  try {
    const { notes } = req.body as z.infer<typeof RequestRevisionSchema>;
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await vendorRequestRevision(token, notes);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/request-revision error");
    res.status(500).json({ message: "Internal server error" });
  }
});

// ── Sprint 05 — canonical vendor shipment initiation and fulfillment ─────────
//
// These endpoints reuse mkt_po_shipments and mkt_po_shipment_events. The opaque
// PO token is the only vendor authority; no vendorId/poId from request bodies
// is accepted. Responses use explicit safe projections.

router.get("/:token/shipments", tokenGetRateLimiter, async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const lookup = await findPoByVendorToken(token);
    if (!lookup.ok) {
      return res.status(mapTokenFailureStatus(lookup.code)).json({ message: "Token tidak valid atau kadaluarsa", code: lookup.code });
    }

    const shipments = await db
      .select()
      .from(mktPoShipmentsTable)
      .where(eq(mktPoShipmentsTable.poId, lookup.po.id))
      .orderBy(asc(mktPoShipmentsTable.createdAt));
    return res.json({ ok: true, data: shipments.map(safeShipmentView) });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] GET /:token/shipments error");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/shipments", tokenPostRateLimiter, validateBody(CreateVendorShipmentSchema), async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const body = req.body as z.infer<typeof CreateVendorShipmentSchema>;
    const result = await createShipmentForVendor(token, {
      ...body,
      items: body.items.map((item, index) => ({ ...item, lineNumber: item.lineNumber ?? index + 1 })),
    });
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({
        message: result.message ?? "Shipment tidak dapat dibuat",
        code: result.code,
      });
    }

    const items = result.items.map((item) => ({
      id: item.id,
      shipmentId: item.shipmentId,
      poLineId: item.poLineId,
      lineNumber: item.lineNumber,
      qty: item.qty,
      uom: item.uom,
      weight: item.weight,
      volume: item.volume,
      packageCount: item.packageCount,
      remarks: item.remarks,
      createdAt: item.createdAt,
    }));
    return res.status(result.alreadyExists ? 200 : 201).json({
      ok: true,
      alreadyExists: result.alreadyExists === true,
      shipment: safeShipmentView(result.shipment),
      items,
    });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/shipments error");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.get("/:token/shipments/:shipmentId", tokenGetRateLimiter, async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const shipmentId = Number(req.params.shipmentId);
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return res.status(400).json({ message: "shipmentId harus berupa integer positif" });
    }

    const lookup = await findPoByVendorToken(token);
    if (!lookup.ok) {
      return res.status(mapTokenFailureStatus(lookup.code)).json({ message: "Token tidak valid atau kadaluarsa", code: lookup.code });
    }

    const [shipment] = await db
      .select()
      .from(mktPoShipmentsTable)
      .where(and(eq(mktPoShipmentsTable.id, shipmentId), eq(mktPoShipmentsTable.poId, lookup.po.id)))
      .limit(1);
    if (!shipment) return res.status(404).json({ message: "Shipment tidak ditemukan" });

    const items = await db
      .select()
      .from(mktPoShipmentItemsTable)
      .where(eq(mktPoShipmentItemsTable.shipmentId, shipmentId))
      .orderBy(asc(mktPoShipmentItemsTable.lineNumber));
    const events = await db
      .select()
      .from(mktPoShipmentEventsTable)
      .where(eq(mktPoShipmentEventsTable.shipmentId, shipmentId))
      .orderBy(asc(mktPoShipmentEventsTable.eventSequence));

    return res.json({
      ok: true,
      shipment: safeShipmentView(shipment),
      items: items.map((item) => ({
        id: item.id,
        shipmentId: item.shipmentId,
        poLineId: item.poLineId,
        lineNumber: item.lineNumber,
        qty: item.qty,
        uom: item.uom,
        weight: item.weight,
        volume: item.volume,
        packageCount: item.packageCount,
        remarks: item.remarks,
        createdAt: item.createdAt,
      })),
      timeline: events.map(safeShipmentEventView),
    });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] GET /:token/shipments/:shipmentId error");
    return res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/shipments/:shipmentId/events", tokenPostRateLimiter, validateBody(VendorShipmentEventSchema), async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const shipmentId = Number(req.params.shipmentId);
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return res.status(400).json({ message: "shipmentId harus berupa integer positif" });
    }

    const body = req.body as z.infer<typeof VendorShipmentEventSchema>;
    const result = await appendShipmentEventForVendor(token, {
      shipmentId,
      eventType: normalizeVendorEventType(body.eventType),
      note: body.note,
      location: body.location,
      latitude: body.latitude,
      longitude: body.longitude,
    });
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({
        message: result.code === "INVALID_TRANSITION"
          ? "Urutan status shipment tidak valid"
          : result.code === "INVALID_EVENT"
            ? "Event shipment tidak valid"
            : "Shipment tidak ditemukan",
        code: result.code,
        currentStatus: "currentStatus" in result ? result.currentStatus : undefined,
      });
    }
    return res.status(result.alreadyAppended ? 200 : 201).json({
      ok: true,
      alreadyAppended: result.alreadyAppended === true,
      event: safeShipmentEventView(result.event),
    });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/shipments/:shipmentId/events error");
    return res.status(500).json({ message: "Internal server error" });
  }
});

export default router;

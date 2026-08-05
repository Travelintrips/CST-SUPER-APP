import { Router } from "express";
import { db, freightShipmentsTable, freightRfqsTable, freightQuotesTable, freightAttachmentsTable, shipmentStagesTable, salesDocumentsTable, purchaseDocumentsTable, expensesTable, freightCustomsDocsTable, freightShipmentAuditLogsTable, logisticOrdersTable, SHIPMENT_STAGE_TYPES, type ShipmentStageType, airFreightOrdersTable, oceanFreightOrdersTable, ppjkOrdersTable } from "@workspace/db";
import { eq, desc, inArray, sum, and, sql, ilike, or, gte, lte } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { saveAndBroadcast } from "../lib/notificationStore.js";
import { propagateFreightToLogistic } from "../lib/services/logisticOrderStatusService.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  sendShipmentUpdateNotification,
  sendDeliveryCompletedNotification,
  type LogisticOrderData,
} from "../lib/orderNotification.js";
import { logStorageEvent, getRequestIp, getActor } from "../lib/storageAuditLog.js";
import { postLogisticSalesInvoice, postLogisticVendorCostJournal, normalizeShipmentServiceType } from "../lib/accounting.js";

const _freightObjectStorage = new ObjectStorageService();

function resolveUserDisplay(user: { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }): { name: string; id: string } {
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim() || user.email || user.id;
  return { name, id: user.id };
}

const TRANSPORT_MODES = ["sea", "air", "land", "multimodal"] as const;
const CARGO_TYPES = ["FCL", "LCL", "Air"] as const;
const FREIGHT_SHIPMENT_STATUSES = ["draft", "rfq_sent", "confirmed", "in_transit", "completed", "cancelled"] as const;
// Unified Shipment Core — kategori layanan forwarding
const SERVICE_CATEGORIES = ["FF_UDARA", "FF_LAUT", "PPJK", "TRUCKING", "MULTIMODAL", "GENERAL_FORWARDING"] as const;
type TransportMode = typeof TRANSPORT_MODES[number];
type CargoType = typeof CARGO_TYPES[number];
type FreightShipmentStatus = typeof FREIGHT_SHIPMENT_STATUSES[number];
type FreightServiceCategory = typeof SERVICE_CATEGORIES[number];

function validateTransportMode(v: unknown): TransportMode | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!TRANSPORT_MODES.includes(v as TransportMode))
    throw Object.assign(new Error(`transportMode tidak valid. Nilai yang diterima: ${TRANSPORT_MODES.join(", ")}`), { statusCode: 400 });
  return v as TransportMode;
}
function validateCargoType(v: unknown): CargoType | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!CARGO_TYPES.includes(v as CargoType))
    throw Object.assign(new Error(`cargoType tidak valid. Nilai yang diterima: ${CARGO_TYPES.join(", ")}`), { statusCode: 400 });
  return v as CargoType;
}
function validateShipmentStatus(v: unknown): FreightShipmentStatus | undefined {
  if (v === undefined) return undefined;
  if (!FREIGHT_SHIPMENT_STATUSES.includes(v as FreightShipmentStatus))
    throw Object.assign(new Error(`status tidak valid. Nilai yang diterima: ${FREIGHT_SHIPMENT_STATUSES.join(", ")}`), { statusCode: 400 });
  return v as FreightShipmentStatus;
}
function validateServiceCategory(v: unknown): FreightServiceCategory | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!SERVICE_CATEGORIES.includes(v as FreightServiceCategory))
    throw Object.assign(new Error(`serviceCategory tidak valid. Nilai yang diterima: ${SERVICE_CATEGORIES.join(", ")}`), { statusCode: 400 });
  return v as FreightServiceCategory;
}

const STAGE_STATUSES = ["pending", "in_progress", "completed", "skipped"] as const;
type StageStatus = typeof STAGE_STATUSES[number];

function validateStageStatus(v: unknown): StageStatus | undefined {
  if (v === undefined) return undefined;
  if (!STAGE_STATUSES.includes(v as StageStatus))
    throw Object.assign(new Error(`status stage tidak valid. Nilai yang diterima: ${STAGE_STATUSES.join(", ")}`), { statusCode: 400 });
  return v as StageStatus;
}

function validateStageType(v: unknown): ShipmentStageType {
  if (!v || typeof v !== "string")
    throw Object.assign(new Error("stageType wajib diisi"), { statusCode: 400 });
  if (!(SHIPMENT_STAGE_TYPES as readonly string[]).includes(v))
    throw Object.assign(new Error(`stageType tidak valid. Nilai yang diterima: ${SHIPMENT_STAGE_TYPES.join(", ")}`), { statusCode: 400 });
  return v as ShipmentStageType;
}

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

function nextNumber(prefix: string) {
  const now = new Date();
  const yr = now.getFullYear();
  const seq = Date.now().toString().slice(-6);
  return `${prefix}/${yr}/${seq}`;
}

function serializeShipment(s: typeof freightShipmentsTable.$inferSelect) {
  return { ...s, createdAt: s.createdAt.toISOString() };
}
function serializeStage(s: typeof shipmentStagesTable.$inferSelect) {
  return { ...s, createdAt: s.createdAt.toISOString() };
}
function serializeRfq(r: typeof freightRfqsTable.$inferSelect) {
  return { ...r, createdAt: r.createdAt.toISOString() };
}
function serializeQuote(q: typeof freightQuotesTable.$inferSelect) {
  return { ...q, createdAt: q.createdAt.toISOString() };
}

// ─── FREIGHT SHIPMENTS ──────────────────────────────────────────────────────

// GET /api/logistics/freight-shipments
router.get("/freight-shipments", async (req, res) => {
  const salesDocId = req.query.salesDocId ? Number(req.query.salesDocId) : undefined;
  const rows = salesDocId
    ? await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.salesDocId, salesDocId)).orderBy(desc(freightShipmentsTable.createdAt))
    : await db.select().from(freightShipmentsTable).orderBy(desc(freightShipmentsTable.createdAt));
  // Bulk-fetch approved quote costs for all shipments in one query
  const shipmentIds = rows.map((r) => r.id);
  const approvedQuotes = shipmentIds.length > 0
    ? await db
        .select({ shipmentId: freightQuotesTable.shipmentId, totalCost: freightQuotesTable.totalCost })
        .from(freightQuotesTable)
        .where(
          and(
            eq(freightQuotesTable.status, "approved"),
            shipmentIds.length === 1
              ? eq(freightQuotesTable.shipmentId, shipmentIds[0]!)
              : inArray(freightQuotesTable.shipmentId, shipmentIds)
          )
        )
    : [];
  // Pick the first approved quote per shipment (consistent with detail page)
  const approvedCostMap = new Map<number, string | null>();
  for (const q of approvedQuotes) {
    if (!approvedCostMap.has(q.shipmentId)) {
      approvedCostMap.set(q.shipmentId, q.totalCost ?? null);
    }
  }

  // Bulk-fetch total expenses per shipment in one query
  const expenseTotals = shipmentIds.length > 0
    ? await db
        .select({ shipmentId: expensesTable.shipmentId, total: sum(expensesTable.total) })
        .from(expensesTable)
        .where(
          shipmentIds.length === 1
            ? eq(expensesTable.shipmentId, shipmentIds[0]!)
            : inArray(expensesTable.shipmentId, shipmentIds)
        )
        .groupBy(expensesTable.shipmentId)
    : [];
  const expenseTotalMap = new Map<number, string>();
  for (const e of expenseTotals) {
    if (e.shipmentId != null && e.total != null) {
      expenseTotalMap.set(e.shipmentId, e.total);
    }
  }

  return res.json(rows.map((r) => ({
    ...serializeShipment(r),
    approvedQuoteCost: approvedCostMap.get(r.id) ?? null,
    totalExpenses: expenseTotalMap.get(r.id) ?? null,
  })));
});

// GET /api/logistics/freight-shipments/:id
router.get("/freight-shipments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [shipment] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!shipment) return res.status(404).json({ message: "Shipment not found" });
  const rfqs = await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.shipmentId, id)).orderBy(desc(freightRfqsTable.createdAt));
  const rfqIds = rfqs.map((r) => r.id);
  const quotes = rfqIds.length > 0
    ? await db.select().from(freightQuotesTable)
        .where(rfqIds.length === 1 ? eq(freightQuotesTable.rfqId, rfqIds[0]!) : inArray(freightQuotesTable.rfqId, rfqIds))
        .orderBy(desc(freightQuotesTable.createdAt))
    : [];
  const stages = await db.select().from(shipmentStagesTable).where(eq(shipmentStagesTable.shipmentId, id));

  // Look up the logistic RFQ that spawned this freight shipment (if any).
  // freight_shipment_id was added via a manual migration, not in the Drizzle schema,
  // so we use raw SQL for this join.
  const linkedRfqRows = await db.execute(sql`
    SELECT r.id, r.rfq_number AS "rfqNumber", r.status AS "rfqStatus",
           r.order_id AS "orderId", o.order_number AS "orderNumber"
    FROM logistic_order_rfqs r
    LEFT JOIN logistic_orders o ON o.id = r.order_id
    WHERE r.freight_shipment_id = ${id}
    LIMIT 1
  `);

  const linkedLogisticRfqRow = (linkedRfqRows.rows as any[])[0] ?? null;
  const linkedLogisticRfq = linkedLogisticRfqRow
    ? {
        id: linkedLogisticRfqRow.id as number,
        rfqNumber: linkedLogisticRfqRow.rfqNumber as string,
        rfqStatus: linkedLogisticRfqRow.rfqStatus as string,
        orderId: linkedLogisticRfqRow.orderId as number,
        orderNumber: (linkedLogisticRfqRow.orderNumber as string) ?? null,
      }
    : null;

  // Resolve portal order via salesDoc.logisticOrderId (for shipments created from "Konversi ke Shipment")
  let linkedPortalOrder: { id: number; orderNumber: string } | null = null;
  if (shipment.salesDocId) {
    const [salesDoc] = await db
      .select({ logisticOrderId: salesDocumentsTable.logisticOrderId })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.id, shipment.salesDocId))
      .limit(1);
    if (salesDoc?.logisticOrderId) {
      const [portalOrder] = await db
        .select({ id: logisticOrdersTable.id, orderNumber: logisticOrdersTable.orderNumber })
        .from(logisticOrdersTable)
        .where(eq(logisticOrdersTable.id, salesDoc.logisticOrderId))
        .limit(1);
      if (portalOrder) linkedPortalOrder = { id: portalOrder.id, orderNumber: portalOrder.orderNumber };
    }
  }

  return res.json({
    ...serializeShipment(shipment),
    rfqs: rfqs.map((r) => ({
      ...serializeRfq(r),
      quotes: quotes.filter((q) => q.rfqId === r.id).map(serializeQuote),
    })),
    stages: stages.map(serializeStage),
    linkedLogisticRfq,
    linkedPortalOrder,
  });
});

// POST /api/logistics/freight-shipments
router.post("/freight-shipments", async (req, res) => {
  const { shipperName, shipperAddress, consigneeName, consigneeAddress, commodity,
    grossWeight, netWeight, quantity, packingType, dimensions, hsCode, origin, destination,
    portOfLoading, portOfDischarge, vessel, voyage, notifyParty, marksAndNumbers, measurement, notes,
    transportMode, cargoType, containerNo, salesDocId, purchaseDocId, freightCost,
    serviceCategory, sourceModule, sourceOrderId } = req.body;
  let validatedTM: TransportMode | null;
  let validatedCT: CargoType | null;
  let validatedSC: FreightServiceCategory | null;
  try {
    validatedTM = validateTransportMode(transportMode) ?? null;
    validatedCT = validateCargoType(cargoType) ?? null;
    validatedSC = validateServiceCategory(serviceCategory) ?? null;
  } catch (e: any) {
    return res.status(400).json({ message: e.message });
  }
  if (salesDocId) {
    const [linkedDoc] = await db.select({ id: salesDocumentsTable.id }).from(salesDocumentsTable).where(eq(salesDocumentsTable.id, Number(salesDocId))).limit(1);
    if (!linkedDoc) {
      return res.status(400).json({ message: "Sales Order tidak ditemukan." });
    }
  }
  if (purchaseDocId) {
    const [linkedPO] = await db.select({ id: purchaseDocumentsTable.id }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, Number(purchaseDocId))).limit(1);
    if (!linkedPO) return res.status(400).json({ message: "Purchase Order tidak ditemukan." });
  }
  if (!shipperName || !consigneeName || !commodity || !origin || !destination) {
    return res.status(400).json({ message: "shipperName, consigneeName, commodity, origin, destination wajib diisi" });
  }
  const shipmentNumber = nextNumber("FS");
  const [shipment] = await db.insert(freightShipmentsTable).values({
    shipmentNumber, shipperName, shipperAddress: shipperAddress || null,
    consigneeName, consigneeAddress: consigneeAddress || null,
    commodity, grossWeight: grossWeight ? String(grossWeight) : null,
    netWeight: netWeight ? String(netWeight) : null,
    quantity: quantity ? Number(quantity) : null,
    packingType: packingType || null, dimensions: dimensions || null,
    hsCode: hsCode || null, origin, destination,
    portOfLoading: portOfLoading || null, portOfDischarge: portOfDischarge || null,
    vessel: vessel || null, voyage: voyage || null,
    notifyParty: notifyParty || null, marksAndNumbers: marksAndNumbers || null,
    measurement: measurement || null, notes: notes || null,
    transportMode: validatedTM,
    cargoType: validatedCT,
    containerNo: containerNo || null,
    freightCost: freightCost != null ? String(freightCost) : "0",
    salesDocId: salesDocId ? Number(salesDocId) : null,
    purchaseDocId: purchaseDocId ? Number(purchaseDocId) : null,
    serviceCategory: validatedSC,
    sourceModule: sourceModule || "freight",
    sourceOrderId: sourceOrderId ? Number(sourceOrderId) : null,
  }).returning();
  saveAndBroadcast("freight_shipment_created", {
    type: "freight_new",
    orderId: shipment!.id,
    orderNumber: shipment!.shipmentNumber,
    customerName: shipment!.shipperName,
    companyName: shipment!.consigneeName ?? null,
    origin: shipment!.origin,
    destination: shipment!.destination,
    commodity: shipment!.commodity,
    transportMode: shipment!.transportMode,
    createdAt: shipment!.createdAt.toISOString(),
  }).catch(() => {});
  return res.status(201).json(serializeShipment(shipment!));
});

// POST /api/logistics/freight-shipments/from-portal-order/:orderId
router.post("/freight-shipments/from-portal-order/:orderId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!Number.isInteger(orderId) || orderId <= 0)
    return res.status(400).json({ message: "ID order tidak valid" });

  const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
  if (!order) return res.status(404).json({ message: "Portal order tidak ditemukan" });

  const [linkedDoc] = await db
    .select({ id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.logisticOrderId, orderId))
    .limit(1);

  if (!linkedDoc)
    return res.status(400).json({ message: "Buat Sales Order terlebih dahulu sebelum mengkonversi ke Freight Shipment." });

  const { transportMode: tmOverride, cargoType: ctOverride } = req.body as { transportMode?: string; cargoType?: string };

  let validatedTM: TransportMode | null = null;
  let validatedCT: CargoType | null = null;

  if (tmOverride) {
    try { validatedTM = validateTransportMode(tmOverride) ?? null; } catch { /* ignore */ }
  } else {
    const st = (order.shipmentType ?? "").toLowerCase();
    if (st.includes("sea") || st.includes("laut")) validatedTM = "sea";
    else if (st.includes("air") || st.includes("udara")) validatedTM = "air";
    else if (st.includes("truck") || st.includes("darat") || st.includes("land")) validatedTM = "land";
    else if (st.includes("multi")) validatedTM = "multimodal";
  }

  if (ctOverride) {
    try { validatedCT = validateCargoType(ctOverride) ?? null; } catch { /* ignore */ }
  }

  const shipmentNumber = nextNumber("FS");
  const [shipment] = await db.insert(freightShipmentsTable).values({
    shipmentNumber,
    shipperName: order.customerName,
    consigneeName: order.companyName ?? order.customerName,
    commodity: order.commodity ?? order.shipmentType ?? "General Cargo",
    origin: order.origin ?? "",
    destination: order.destination ?? "",
    grossWeight: order.grossWeight != null ? String(order.grossWeight) : null,
    quantity: order.jumlahKoli ?? null,
    notes: order.notes ?? null,
    transportMode: validatedTM,
    cargoType: validatedCT,
    salesDocId: linkedDoc.id,
  }).returning();

  saveAndBroadcast("freight_shipment_created", {
    type: "freight_new",
    orderId: shipment!.id,
    orderNumber: shipment!.shipmentNumber,
    customerName: shipment!.shipperName,
    companyName: shipment!.consigneeName ?? null,
    origin: shipment!.origin,
    destination: shipment!.destination,
    commodity: shipment!.commodity,
    transportMode: shipment!.transportMode,
    createdAt: shipment!.createdAt.toISOString(),
  }).catch(() => {});

  return res.status(201).json(serializeShipment(shipment!));
});

// PUT /api/logistics/freight-shipments/:id
router.put("/freight-shipments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const { shipperName, shipperAddress, consigneeName, consigneeAddress, commodity,
    grossWeight, netWeight, quantity, packingType, dimensions, hsCode, origin, destination,
    portOfLoading, portOfDischarge, vessel, voyage, notifyParty, marksAndNumbers, measurement, status, notes,
    actualCost, departureDate, arrivalDate, trackingNumber, awbNumber,
    transportMode, cargoType, containerNo, salesDocId, purchaseDocId, freightCost,
    serviceCategory, sourceModule, sourceOrderId } = req.body;
  const [existing] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!existing) return res.status(404).json({ message: "Shipment not found" });
  const patch: Partial<typeof freightShipmentsTable.$inferInsert> = {};
  if (shipperName !== undefined) patch.shipperName = shipperName;
  if (shipperAddress !== undefined) patch.shipperAddress = shipperAddress || null;
  if (consigneeName !== undefined) patch.consigneeName = consigneeName;
  if (consigneeAddress !== undefined) patch.consigneeAddress = consigneeAddress || null;
  if (commodity !== undefined) patch.commodity = commodity;
  if (grossWeight !== undefined) patch.grossWeight = grossWeight ? String(grossWeight) : null;
  if (netWeight !== undefined) patch.netWeight = netWeight ? String(netWeight) : null;
  if (quantity !== undefined) patch.quantity = quantity ? Number(quantity) : null;
  if (packingType !== undefined) patch.packingType = packingType || null;
  if (dimensions !== undefined) patch.dimensions = dimensions || null;
  if (hsCode !== undefined) patch.hsCode = hsCode || null;
  if (origin !== undefined) patch.origin = origin;
  if (destination !== undefined) patch.destination = destination;
  if (portOfLoading !== undefined) patch.portOfLoading = portOfLoading || null;
  if (portOfDischarge !== undefined) patch.portOfDischarge = portOfDischarge || null;
  if (vessel !== undefined) patch.vessel = vessel || null;
  if (voyage !== undefined) patch.voyage = voyage || null;
  if (notifyParty !== undefined) patch.notifyParty = notifyParty || null;
  if (marksAndNumbers !== undefined) patch.marksAndNumbers = marksAndNumbers || null;
  if (measurement !== undefined) patch.measurement = measurement || null;
  if (status !== undefined) {
    try { patch.status = validateShipmentStatus(status); }
    catch (e: any) { return res.status(400).json({ message: e.message }); }
  }
  if (notes !== undefined) patch.notes = notes || null;
  if (freightCost !== undefined) patch.freightCost = freightCost != null ? String(freightCost) : "0";
  if (actualCost !== undefined) patch.actualCost = actualCost != null ? String(actualCost) : null;
  if (departureDate !== undefined) patch.departureDate = departureDate || null;
  if (arrivalDate !== undefined) patch.arrivalDate = arrivalDate || null;
  if (trackingNumber !== undefined) patch.trackingNumber = trackingNumber || null;
  if (awbNumber !== undefined) patch.awbNumber = awbNumber || null;
  if (transportMode !== undefined) {
    try { patch.transportMode = validateTransportMode(transportMode) ?? null; }
    catch (e: any) { return res.status(400).json({ message: e.message }); }
  }
  if (cargoType !== undefined) {
    try { patch.cargoType = validateCargoType(cargoType) ?? null; }
    catch (e: any) { return res.status(400).json({ message: e.message }); }
  }
  if (containerNo !== undefined) patch.containerNo = containerNo || null;
  if (serviceCategory !== undefined) {
    try { patch.serviceCategory = validateServiceCategory(serviceCategory) ?? null; }
    catch (e: any) { return res.status(400).json({ message: e.message }); }
  }
  if (sourceModule !== undefined) patch.sourceModule = sourceModule || null;
  if (sourceOrderId !== undefined) patch.sourceOrderId = sourceOrderId ? Number(sourceOrderId) : null;
  if (salesDocId !== undefined) patch.salesDocId = salesDocId ? Number(salesDocId) : null;
  if (purchaseDocId !== undefined) {
    if (purchaseDocId) {
      const [linkedPO] = await db.select({ id: purchaseDocumentsTable.id }).from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, Number(purchaseDocId))).limit(1);
      if (!linkedPO) return res.status(400).json({ message: "Purchase order not found" });
    }
    patch.purchaseDocId = purchaseDocId ? Number(purchaseDocId) : null;
  }
  const [updated] = await db.update(freightShipmentsTable).set(patch).where(eq(freightShipmentsTable.id, id)).returning();
  if (status !== undefined && status !== existing.status) {
    const actor = req.user ? resolveUserDisplay(req.user as { id: string; firstName?: string | null; lastName?: string | null; email?: string | null }) : { name: "System", id: "system" };
    await db.insert(freightShipmentAuditLogsTable).values({
      shipmentId: updated!.id,
      shipmentNumber: updated!.shipmentNumber,
      fromStatus: existing.status,
      toStatus: updated!.status,
      changedBy: actor.name,
      changedById: actor.id,
    });
    saveAndBroadcast("freight_shipment_status", {
      type: "freight_status",
      orderId: updated!.id,
      orderNumber: updated!.shipmentNumber,
      customerName: updated!.shipperName,
      companyName: updated!.consigneeName ?? null,
      origin: updated!.origin,
      destination: updated!.destination,
      status: updated!.status,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});

    // Propagasi freight status → logistic_orders.status (one-way, non-fatal)
    propagateFreightToLogistic(updated!.id, updated!.status, {
      source: "freight:patch",
      actorType: "admin",
      actorName: actor.name,
    }).catch(() => {});

    // Notifikasi template ke customer berdasarkan status baru
    const newStatus = updated!.status;
    if (newStatus === "in_transit" || newStatus === "completed") {
      // Cari logistic order via RFQ (freight_shipment_id disimpan di logistic_order_rfqs)
      db.execute(sql`
        SELECT lo.* FROM logistic_orders lo
        JOIN logistic_order_rfqs lor ON lor.order_id = lo.id
        WHERE lor.freight_shipment_id = ${updated!.id}
        LIMIT 1
      `).then((result) => {
        const row = result.rows[0] as (typeof logisticOrdersTable.$inferSelect) | undefined;
        if (!row?.phone) return;
        const orderData: LogisticOrderData = {
          id: Number(row.id),
          orderNumber: String(row.orderNumber ?? ""),
          customerName: String(row.customerName ?? ""),
          companyName: String(row.companyName ?? ""),
          email: String(row.email ?? ""),
          phone: String(row.phone ?? ""),
          orderType: row.orderType ? String(row.orderType) : undefined,
          shipmentType: String(row.shipmentType ?? ""),
          origin: String(row.origin ?? ""),
          destination: String(row.destination ?? ""),
          commodity: row.commodity ? String(row.commodity) : null,
          cargoDescription: row.cargoDescription ? String(row.cargoDescription) : null,
          grossWeight: row.grossWeight ? Number(row.grossWeight) : null,
          volumeCbm: row.volumeCbm ? Number(row.volumeCbm) : null,
          jumlahKoli: row.jumlahKoli ? Number(row.jumlahKoli) : null,
          grandTotal: row.grandTotal ? Number(row.grandTotal) : 0,
          serviceList: String(row.shipmentType ?? ""),
          requiredDate: row.requiredDate ? String(row.requiredDate) : null,
          notes: row.notes ? String(row.notes) : null,
          jamOrder: row.jamOrder ? String(row.jamOrder) : null,
          vehicleType: row.truckType ? String(row.truckType) : null,
          createdAt: row.createdAt ? new Date(String(row.createdAt)) : null,
          publicRfqToken: row.publicRfqToken ? String(row.publicRfqToken) : null,
        };
        if (newStatus === "in_transit") {
          sendShipmentUpdateNotification(orderData, {
            vessel: updated!.vessel ?? undefined,
            voyage: updated!.voyage ?? undefined,
            containerNumber: updated!.containerNo ?? undefined,
            awbNumber: updated!.awbNumber ?? undefined,
          }).catch(() => {});
        } else if (newStatus === "completed") {
          sendDeliveryCompletedNotification(orderData).catch(() => {});
        }
      }).catch(() => {});
    }
  }
  return res.json(serializeShipment(updated!));
});

// GET /api/logistics/freight-shipments/:id/audit-log
router.get("/freight-shipments/:id/audit-log", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const logs = await db
    .select()
    .from(freightShipmentAuditLogsTable)
    .where(eq(freightShipmentAuditLogsTable.shipmentId, id))
    .orderBy(desc(freightShipmentAuditLogsTable.createdAt));
  return res.json(logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })));
});

// DELETE /api/logistics/freight-shipments/:id
router.delete("/freight-shipments/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!existing) return res.status(404).json({ message: "Shipment not found" });
  // Ambil semua objectPath attachment sebelum DB cascade menghapus recordnya
  const attachments = await db
    .select({ objectPath: freightAttachmentsTable.objectPath })
    .from(freightAttachmentsTable)
    .where(eq(freightAttachmentsTable.shipmentId, id));
  await db.delete(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  // Cascade storage cleanup — hapus file fisik (non-fatal)
  for (const a of attachments) {
    if (a.objectPath) _freightObjectStorage.tryDeletePrivateEntity(a.objectPath).catch(() => {});
  }
  return res.json({ message: "Berhasil dihapus" });
});

// ─── SHIPMENT STAGES ─────────────────────────────────────────────────────────

// GET /api/logistics/freight-shipments/:shipmentId/stages
router.get("/freight-shipments/:shipmentId/stages", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ message: "Invalid shipmentId" });
  const rows = await db.select().from(shipmentStagesTable).where(eq(shipmentStagesTable.shipmentId, shipmentId));
  return res.json(rows.map(serializeStage));
});

// POST /api/logistics/freight-shipments/:shipmentId/stages  (upsert by stageType)
router.post("/freight-shipments/:shipmentId/stages", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ message: "Invalid shipmentId" });
  const { stageType, vendorName, date, status, notes } = req.body;
  let validatedStageType: ShipmentStageType;
  let validatedStatus: StageStatus | undefined;
  try { validatedStageType = validateStageType(stageType); }
  catch (e: any) { return res.status(400).json({ message: e.message }); }
  try { validatedStatus = validateStageStatus(status); }
  catch (e: any) { return res.status(400).json({ message: e.message }); }
  const [existing] = await db.select().from(shipmentStagesTable)
    .where(eq(shipmentStagesTable.shipmentId, shipmentId))
    .then((rows) => rows.filter((r) => r.stageType === stageType));
  let stage;
  if (existing) {
    [stage] = await db.update(shipmentStagesTable)
      .set({
        vendorName: vendorName ?? null,
        date: date ?? null,
        status: validatedStatus ?? existing.status,
        notes: notes ?? null,
      })
      .where(eq(shipmentStagesTable.id, existing.id))
      .returning();
  } else {
    [stage] = await db.insert(shipmentStagesTable)
      .values({
        shipmentId,
        stageType: validatedStageType,
        vendorName: vendorName ?? null,
        date: date ?? null,
        status: validatedStatus ?? "pending",
        notes: notes ?? null,
      })
      .returning();
  }
  if (status !== undefined && status !== (existing?.status)) {
    const [parentShipment] = await db.select({ shipmentNumber: freightShipmentsTable.shipmentNumber, shipperName: freightShipmentsTable.shipperName, consigneeName: freightShipmentsTable.consigneeName })
      .from(freightShipmentsTable).where(eq(freightShipmentsTable.id, shipmentId)).limit(1);
    saveAndBroadcast("freight_stage_update", {
      type: "freight_stage",
      orderId: shipmentId,
      orderNumber: parentShipment?.shipmentNumber ?? `#${shipmentId}`,
      customerName: parentShipment?.shipperName ?? "—",
      companyName: parentShipment?.consigneeName ?? null,
      stageType: stage!.stageType,
      stageStatus: stage!.status,
      vendorName: stage!.vendorName ?? null,
      updatedAt: new Date().toISOString(),
    }).catch(() => {});
  }
  return res.json(serializeStage(stage!));
});

// ─── FREIGHT RFQs ────────────────────────────────────────────────────────────

// GET /api/logistics/freight-rfqs?shipmentId=:shipmentId
router.get("/freight-rfqs", async (req, res) => {
  const shipmentId = req.query.shipmentId ? Number(req.query.shipmentId) : undefined;
  const rows = shipmentId
    ? await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.shipmentId, shipmentId)).orderBy(desc(freightRfqsTable.createdAt))
    : await db.select().from(freightRfqsTable).orderBy(desc(freightRfqsTable.createdAt));
  return res.json(rows.map(serializeRfq));
});

// GET /api/logistics/freight-rfqs/:id
router.get("/freight-rfqs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [rfq] = await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.id, id));
  if (!rfq) return res.status(404).json({ message: "RFQ not found" });
  const quotes = await db.select().from(freightQuotesTable).where(eq(freightQuotesTable.rfqId, id)).orderBy(desc(freightQuotesTable.createdAt));
  return res.json({ ...serializeRfq(rfq), quotes: quotes.map(serializeQuote) });
});

// POST /api/logistics/freight-shipments/:shipmentId/rfqs
router.post("/freight-shipments/:shipmentId/rfqs", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ message: "Invalid shipmentId" });
  const [shipment] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, shipmentId));
  if (!shipment) return res.status(404).json({ message: "Shipment not found" });
  const { vendorNames = [], notes } = req.body;
  const rfqNumber = nextNumber("RFQ-F");
  const [rfq] = await db.insert(freightRfqsTable).values({
    rfqNumber, shipmentId,
    vendorNames: Array.isArray(vendorNames) ? vendorNames : [],
    notes: notes || null, status: "open",
  }).returning();
  await db.update(freightShipmentsTable).set({ status: "rfq_sent" }).where(eq(freightShipmentsTable.id, shipmentId));
  return res.status(201).json(serializeRfq(rfq!));
});

// PUT /api/logistics/freight-rfqs/:id
router.put("/freight-rfqs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.id, id));
  if (!existing) return res.status(404).json({ message: "RFQ not found" });
  const { vendorNames, notes, status } = req.body;
  const patch: Partial<typeof freightRfqsTable.$inferInsert> = {};
  if (vendorNames !== undefined) patch.vendorNames = Array.isArray(vendorNames) ? vendorNames : [];
  if (notes !== undefined) patch.notes = notes || null;
  if (status !== undefined) patch.status = status;
  const [updated] = await db.update(freightRfqsTable).set(patch).where(eq(freightRfqsTable.id, id)).returning();
  return res.json(serializeRfq(updated!));
});

// DELETE /api/logistics/freight-rfqs/:id
router.delete("/freight-rfqs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.id, id));
  if (!existing) return res.status(404).json({ message: "RFQ not found" });
  await db.delete(freightQuotesTable).where(eq(freightQuotesTable.rfqId, id));
  await db.delete(freightRfqsTable).where(eq(freightRfqsTable.id, id));
  return res.json({ message: "Berhasil dihapus" });
});

// ─── FREIGHT QUOTES ──────────────────────────────────────────────────────────

// GET /api/logistics/freight-quotes?rfqId=:rfqId
router.get("/freight-quotes", async (req, res) => {
  const rfqId = req.query.rfqId ? Number(req.query.rfqId) : undefined;
  const rows = rfqId
    ? await db.select().from(freightQuotesTable).where(eq(freightQuotesTable.rfqId, rfqId)).orderBy(desc(freightQuotesTable.createdAt))
    : await db.select().from(freightQuotesTable).orderBy(desc(freightQuotesTable.createdAt));
  return res.json(rows.map(serializeQuote));
});

// GET /api/logistics/freight-quotes/:id
router.get("/freight-quotes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [quote] = await db.select().from(freightQuotesTable).where(eq(freightQuotesTable.id, id));
  if (!quote) return res.status(404).json({ message: "Quote not found" });
  return res.json(serializeQuote(quote));
});

// POST /api/logistics/freight-rfqs/:rfqId/quotes
router.post("/freight-rfqs/:rfqId/quotes", async (req, res) => {
  const rfqId = Number(req.params.rfqId);
  if (!Number.isInteger(rfqId) || rfqId <= 0) return res.status(400).json({ message: "Invalid rfqId" });
  const [rfq] = await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.id, rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ not found" });
  const { vendorName, truckingCost = 0, handlingCost = 0, freightCost = 0, otherCost = 0, estimatedDays, notes } = req.body;
  if (!vendorName) return res.status(400).json({ message: "vendorName wajib diisi" });
  const totalCost = Number(truckingCost) + Number(handlingCost) + Number(freightCost) + Number(otherCost);
  const [quote] = await db.insert(freightQuotesTable).values({
    rfqId, shipmentId: rfq.shipmentId, vendorName,
    truckingCost: String(truckingCost), handlingCost: String(handlingCost),
    freightCost: String(freightCost), otherCost: String(otherCost),
    totalCost: String(totalCost),
    estimatedDays: estimatedDays ? Number(estimatedDays) : null,
    notes: notes || null,
  }).returning();
  return res.status(201).json(serializeQuote(quote!));
});

// PUT /api/logistics/freight-quotes/:id
router.put("/freight-quotes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(freightQuotesTable).where(eq(freightQuotesTable.id, id));
  if (!existing) return res.status(404).json({ message: "Quote not found" });
  const { vendorName, truckingCost, handlingCost, freightCost, otherCost, estimatedDays, notes } = req.body;
  const tc = truckingCost !== undefined ? Number(truckingCost) : Number(existing.truckingCost ?? 0);
  const hc = handlingCost !== undefined ? Number(handlingCost) : Number(existing.handlingCost ?? 0);
  const fc = freightCost !== undefined ? Number(freightCost) : Number(existing.freightCost ?? 0);
  const oc = otherCost !== undefined ? Number(otherCost) : Number(existing.otherCost ?? 0);
  const totalCost = tc + hc + fc + oc;
  const patch: Partial<typeof freightQuotesTable.$inferInsert> = {
    truckingCost: String(tc), handlingCost: String(hc), freightCost: String(fc),
    otherCost: String(oc), totalCost: String(totalCost),
  };
  if (vendorName !== undefined) patch.vendorName = vendorName;
  if (estimatedDays !== undefined) patch.estimatedDays = estimatedDays ? Number(estimatedDays) : null;
  if (notes !== undefined) patch.notes = notes || null;
  const [updated] = await db.update(freightQuotesTable).set(patch).where(eq(freightQuotesTable.id, id)).returning();
  return res.json(serializeQuote(updated!));
});

// DELETE /api/logistics/freight-quotes/:id
router.delete("/freight-quotes/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [existing] = await db.select().from(freightQuotesTable).where(eq(freightQuotesTable.id, id));
  if (!existing) return res.status(404).json({ message: "Quote not found" });
  await db.delete(freightQuotesTable).where(eq(freightQuotesTable.id, id));
  return res.json({ message: "Berhasil dihapus" });
});

// POST /api/logistics/freight-quotes/:id/approve
router.post("/freight-quotes/:id/approve", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [quote] = await db.select().from(freightQuotesTable).where(eq(freightQuotesTable.id, id));
  if (!quote) return res.status(404).json({ message: "Quote not found" });
  const [rfq] = await db.select().from(freightRfqsTable).where(eq(freightRfqsTable.id, quote.rfqId));
  if (!rfq) return res.status(404).json({ message: "RFQ not found" });
  const approved = await db.transaction(async (tx) => {
    await tx.update(freightQuotesTable)
      .set({ status: "rejected" })
      .where(eq(freightQuotesTable.rfqId, quote.rfqId));
    const [approvedQuote] = await tx.update(freightQuotesTable)
      .set({ status: "approved" })
      .where(eq(freightQuotesTable.id, id))
      .returning();
    await tx.update(freightRfqsTable).set({ status: "closed" }).where(eq(freightRfqsTable.id, quote.rfqId));
    await tx.update(freightShipmentsTable)
      .set({ status: "confirmed", approvedVendorName: quote.vendorName })
      .where(eq(freightShipmentsTable.id, rfq.shipmentId));
    return approvedQuote!;
  });
  return res.json(serializeQuote(approved));
});

// GET /api/logistics/freight-shipments/:id/profitability
router.get("/freight-shipments/:id/profitability", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });

  const [shipment] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!shipment) return res.status(404).json({ message: "Shipment not found" });

  // Revenue: from linked Sales Order grand total (only if invoiced)
  let revenue = 0;
  let invoiceStatus = "none";
  if (shipment.salesDocId) {
    const [doc] = await db.select({
      grandTotal: salesDocumentsTable.grandTotal,
      invoiceStatus: salesDocumentsTable.invoiceStatus,
    }).from(salesDocumentsTable).where(eq(salesDocumentsTable.id, shipment.salesDocId));
    if (doc) {
      invoiceStatus = doc.invoiceStatus;
      if (doc.invoiceStatus === "invoiced") revenue = Number(doc.grandTotal);
    }
  }

  // Cost: sum of all expenses linked to this shipment
  const [expResult] = await db.select({ total: sum(expensesTable.total) })
    .from(expensesTable)
    .where(eq(expensesTable.shipmentId, id));
  const totalCost = Number(expResult?.total ?? 0);

  const profit = revenue - totalCost;
  const margin = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : null;

  return res.json({
    revenue,
    totalCost,
    profit,
    margin,
    invoiceStatus,
    estimatedRevenue: shipment.estimatedRevenue ? Number(shipment.estimatedRevenue) : null,
    estimatedCost:    shipment.estimatedCost    ? Number(shipment.estimatedCost)    : null,
    actualRevenue:    shipment.actualRevenue    ? Number(shipment.actualRevenue)    : null,
    vendorBillStatus: shipment.vendorBillStatus ?? "none",
  });
});

// ─── Freight Attachments ────────────────────────────────────────────────────

// GET /api/logistics/freight-shipments/:shipmentId/attachments
router.get("/freight-shipments/:shipmentId/attachments", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ message: "Invalid shipmentId" });
  const attachments = await db
    .select()
    .from(freightAttachmentsTable)
    .where(eq(freightAttachmentsTable.shipmentId, shipmentId))
    .orderBy(desc(freightAttachmentsTable.createdAt));
  return res.json(attachments.map((a) => ({ ...a, createdAt: a.createdAt.toISOString() })));
});

// POST /api/logistics/freight-shipments/:shipmentId/attachments
router.post("/freight-shipments/:shipmentId/attachments", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) return res.status(400).json({ message: "Invalid shipmentId" });
  const { objectPath, fileName, contentType, fileType, label, docType, docNumber, docDate, docStatus, invoiceId } = req.body;
  if (!objectPath || !fileName || !contentType || !fileType) {
    return res.status(400).json({ message: "objectPath, fileName, contentType, fileType wajib diisi" });
  }
  if (!["photo", "document"].includes(fileType)) {
    return res.status(400).json({ message: "fileType harus photo atau document" });
  }
  const [existing] = await db.select({ id: freightShipmentsTable.id }).from(freightShipmentsTable).where(eq(freightShipmentsTable.id, shipmentId));
  if (!existing) return res.status(404).json({ message: "Shipment tidak ditemukan" });

  // Duplicate guard: reject if the same objectPath is already linked to this shipment
  const [dup] = await db.select({ id: freightAttachmentsTable.id })
    .from(freightAttachmentsTable)
    .where(and(eq(freightAttachmentsTable.shipmentId, shipmentId), eq(freightAttachmentsTable.objectPath, String(objectPath))))
    .limit(1);
  if (dup) return res.status(409).json({ message: "File ini sudah terlampir ke shipment ini" });

  // Verify objectPath actually exists in storage before persisting the link
  if (String(objectPath).startsWith("/objects/")) {
    try {
      await _freightObjectStorage.getObjectEntityFile(String(objectPath));
    } catch {
      return res.status(422).json({ message: "File tidak ditemukan di storage. Pastikan upload berhasil sebelum melampirkan." });
    }
  }

  const [attachment] = await db.insert(freightAttachmentsTable).values({
    shipmentId, objectPath, fileName, contentType,
    fileType: fileType as "photo" | "document",
    label: label || null,
    docType: docType || null,
    docNumber: docNumber || null,
    docDate: docDate || null,
    docStatus: docStatus || null,
    invoiceId: invoiceId ? Number(invoiceId) : null,
  }).returning();
  const actor = getActor(req);
  logStorageEvent({
    action: "upload",
    entityType: "freight_attachment",
    entityId: attachment!.id,
    objectPath: String(objectPath),
    fileName: String(fileName),
    contentType: String(contentType),
    actorId: actor.actorId,
    actorType: actor.actorType,
    ipAddress: getRequestIp(req),
    details: `shipmentId=${shipmentId} docType=${docType ?? "-"}`,
  });
  return res.status(201).json({ ...attachment!, createdAt: attachment!.createdAt.toISOString() });
});

// PUT /api/logistics/freight-shipments/:shipmentId/attachments/:attachmentId
router.put("/freight-shipments/:shipmentId/attachments/:attachmentId", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(shipmentId) || !Number.isInteger(attachmentId)) return res.status(400).json({ message: "Invalid id" });
  const { label, docType, docNumber, docDate, docStatus, invoiceId } = req.body;
  const patch: Record<string, unknown> = {};
  if (label !== undefined) patch.label = label || null;
  if (docType !== undefined) patch.docType = docType || null;
  if (docNumber !== undefined) patch.docNumber = docNumber || null;
  if (docDate !== undefined) patch.docDate = docDate || null;
  if (docStatus !== undefined) patch.docStatus = docStatus || null;
  if (invoiceId !== undefined) patch.invoiceId = invoiceId ? Number(invoiceId) : null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ message: "No fields to update" });
  const [updated] = await db.update(freightAttachmentsTable).set(patch).where(eq(freightAttachmentsTable.id, attachmentId)).returning();
  if (!updated) return res.status(404).json({ message: "Attachment tidak ditemukan" });
  return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
});

// DELETE /api/logistics/freight-shipments/:shipmentId/attachments/:attachmentId
router.delete("/freight-shipments/:shipmentId/attachments/:attachmentId", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  const attachmentId = Number(req.params.attachmentId);
  if (!Number.isInteger(shipmentId) || !Number.isInteger(attachmentId)) return res.status(400).json({ message: "Invalid id" });
  // Filter by BOTH id AND shipmentId to prevent IDOR (deleting another shipment's attachment)
  const [deleted] = await db
    .delete(freightAttachmentsTable)
    .where(and(eq(freightAttachmentsTable.id, attachmentId), eq(freightAttachmentsTable.shipmentId, shipmentId)))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Attachment tidak ditemukan" });
  // Delete the underlying GCS object (non-fatal — DB record already removed)
  if (deleted.objectPath) {
    _freightObjectStorage.tryDeletePrivateEntity(deleted.objectPath).catch(() => {});
  }
  const actor = getActor(req);
  logStorageEvent({
    action: "delete",
    entityType: "freight_attachment",
    entityId: deleted.id,
    objectPath: deleted.objectPath,
    fileName: deleted.fileName,
    contentType: deleted.contentType,
    actorId: actor.actorId,
    actorType: actor.actorType,
    ipAddress: getRequestIp(req),
    details: `shipmentId=${shipmentId}`,
  });
  return res.json({ message: "Deleted" });
});

// ─── FREIGHT CUSTOMS DOCS — Legacy (General Freight shipmentId-bound) ─────────

// GET /api/logistics/freight-shipments/:shipmentId/customs-docs
router.get("/freight-shipments/:shipmentId/customs-docs", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId)) return res.status(400).json({ message: "Invalid id" });
  const docs = await db
    .select()
    .from(freightCustomsDocsTable)
    .where(eq(freightCustomsDocsTable.shipmentId, shipmentId))
    .orderBy(desc(freightCustomsDocsTable.createdAt));
  return res.json(docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() })));
});

// POST /api/logistics/freight-shipments/:shipmentId/customs-docs
router.post("/freight-shipments/:shipmentId/customs-docs", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  if (!Number.isInteger(shipmentId)) return res.status(400).json({ message: "Invalid id" });
  const { docType, nomorAju, nomorDokumen, tanggalDokumen, data, scanSource, notes } = req.body;
  if (!docType) return res.status(400).json({ message: "docType wajib diisi" });
  const [created] = await db.insert(freightCustomsDocsTable).values({
    shipmentId,
    sourceModule: "general",
    docType,
    nomorAju: nomorAju || null,
    nomorDokumen: nomorDokumen || null,
    tanggalDokumen: tanggalDokumen || null,
    data: data ?? {},
    scanSource: scanSource || "manual",
    notes: notes || null,
  }).returning();
  return res.status(201).json({ ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() });
});

// PUT /api/logistics/freight-shipments/:shipmentId/customs-docs/:docId
router.put("/freight-shipments/:shipmentId/customs-docs/:docId", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  const docId = Number(req.params.docId);
  if (!Number.isInteger(shipmentId) || !Number.isInteger(docId)) return res.status(400).json({ message: "Invalid id" });
  const { docType, nomorAju, nomorDokumen, tanggalDokumen, data, notes } = req.body;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (docType !== undefined) patch.docType = docType;
  if (nomorAju !== undefined) patch.nomorAju = nomorAju || null;
  if (nomorDokumen !== undefined) patch.nomorDokumen = nomorDokumen || null;
  if (tanggalDokumen !== undefined) patch.tanggalDokumen = tanggalDokumen || null;
  if (data !== undefined) patch.data = data;
  if (notes !== undefined) patch.notes = notes || null;
  const [updated] = await db
    .update(freightCustomsDocsTable)
    .set(patch)
    .where(and(eq(freightCustomsDocsTable.id, docId), eq(freightCustomsDocsTable.shipmentId, shipmentId)))
    .returning();
  if (!updated) return res.status(404).json({ message: "Dokumen tidak ditemukan" });
  return res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// DELETE /api/logistics/freight-shipments/:shipmentId/customs-docs/:docId
router.delete("/freight-shipments/:shipmentId/customs-docs/:docId", async (req, res) => {
  const shipmentId = Number(req.params.shipmentId);
  const docId = Number(req.params.docId);
  if (!Number.isInteger(shipmentId) || !Number.isInteger(docId)) return res.status(400).json({ message: "Invalid id" });
  const [deleted] = await db
    .delete(freightCustomsDocsTable)
    .where(and(eq(freightCustomsDocsTable.id, docId), eq(freightCustomsDocsTable.shipmentId, shipmentId)))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Dokumen tidak ditemukan" });
  return res.json({ message: "Deleted" });
});

// ─── UNIFIED SHIPMENTS LIST (semua modul) ────────────────────────────────────

router.get("/unified-shipments", async (req, res) => {
  const { module: modFilter, status, q, dateFrom, dateTo } = req.query;

  const mkDate = (field: any) => {
    const conds = [];
    if (dateFrom) conds.push(gte(field, new Date(String(dateFrom))));
    if (dateTo) conds.push(lte(field, new Date(String(dateTo))));
    return conds;
  };

  const [general, air, ocean, trucking, ppjk, customsLatest] = await Promise.all([
    // General Freight
    (!modFilter || modFilter === "general") ? db.select({
      id: freightShipmentsTable.id,
      orderNumber: freightShipmentsTable.shipmentNumber,
      customerName: freightShipmentsTable.shipperName,
      customerCompany: sql<string>`null`,
      origin: freightShipmentsTable.origin,
      destination: freightShipmentsTable.destination,
      mode: freightShipmentsTable.transportMode,
      status: freightShipmentsTable.status,
      vendor: freightShipmentsTable.approvedVendorName,
      revenue: freightShipmentsTable.freightCost,
      cost: freightShipmentsTable.actualCost,
      createdAt: freightShipmentsTable.createdAt,
    }).from(freightShipmentsTable).where(
      and(
        status && status !== "all" ? eq(freightShipmentsTable.status, String(status) as any) : undefined,
        ...(q ? [or(ilike(freightShipmentsTable.shipmentNumber, `%${q}%`), ilike(freightShipmentsTable.shipperName, `%${q}%`), ilike(freightShipmentsTable.consigneeName, `%${q}%`))] : []),
        ...mkDate(freightShipmentsTable.createdAt),
      )
    ).orderBy(desc(freightShipmentsTable.createdAt)).limit(500) : Promise.resolve([]),

    // Air Freight
    (!modFilter || modFilter === "air_freight") ? db.select({
      id: airFreightOrdersTable.id,
      orderNumber: airFreightOrdersTable.orderNumber,
      customerName: airFreightOrdersTable.customerName,
      customerCompany: airFreightOrdersTable.customerCompany,
      origin: airFreightOrdersTable.originAirport,
      destination: airFreightOrdersTable.destAirport,
      mode: sql<string>`'AIR'`,
      status: airFreightOrdersTable.status,
      vendor: sql<string>`null`,
      revenue: airFreightOrdersTable.grandTotal,
      cost: sql<string>`null`,
      createdAt: airFreightOrdersTable.createdAt,
    }).from(airFreightOrdersTable).where(
      and(
        status && status !== "all" ? eq(airFreightOrdersTable.status, String(status)) : undefined,
        ...(q ? [or(ilike(airFreightOrdersTable.orderNumber, `%${q}%`), ilike(airFreightOrdersTable.customerName, `%${q}%`))] : []),
        ...mkDate(airFreightOrdersTable.createdAt),
      )
    ).orderBy(desc(airFreightOrdersTable.createdAt)).limit(500) : Promise.resolve([]),

    // Ocean Freight
    (!modFilter || modFilter === "ocean_freight") ? db.select({
      id: oceanFreightOrdersTable.id,
      orderNumber: oceanFreightOrdersTable.orderNumber,
      customerName: oceanFreightOrdersTable.customerName,
      customerCompany: oceanFreightOrdersTable.customerCompany,
      origin: oceanFreightOrdersTable.originPort,
      destination: oceanFreightOrdersTable.destinationPort,
      mode: sql<string>`'SEA'`,
      status: oceanFreightOrdersTable.status,
      vendor: sql<string>`null`,
      revenue: oceanFreightOrdersTable.grandTotal,
      cost: sql<string>`null`,
      createdAt: oceanFreightOrdersTable.createdAt,
    }).from(oceanFreightOrdersTable).where(
      and(
        status && status !== "all" ? eq(oceanFreightOrdersTable.status, String(status)) : undefined,
        ...(q ? [or(ilike(oceanFreightOrdersTable.orderNumber, `%${q}%`), ilike(oceanFreightOrdersTable.customerName, `%${q}%`))] : []),
        ...mkDate(oceanFreightOrdersTable.createdAt),
      )
    ).orderBy(desc(oceanFreightOrdersTable.createdAt)).limit(500) : Promise.resolve([]),

    // Trucking (logistic orders)
    (!modFilter || modFilter === "trucking") ? db.select({
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      customerName: logisticOrdersTable.customerName,
      customerCompany: logisticOrdersTable.companyName,
      origin: logisticOrdersTable.origin,
      destination: logisticOrdersTable.destination,
      mode: sql<string>`'TRUCK'`,
      status: logisticOrdersTable.status,
      vendor: sql<string>`null`,
      revenue: logisticOrdersTable.grandTotal,
      cost: sql<string>`null`,
      createdAt: logisticOrdersTable.createdAt,
    }).from(logisticOrdersTable).where(
      and(
        status && status !== "all" ? eq(logisticOrdersTable.status, String(status)) : undefined,
        ...(q ? [or(ilike(logisticOrdersTable.orderNumber, `%${q}%`), ilike(logisticOrdersTable.customerName, `%${q}%`))] : []),
        ...mkDate(logisticOrdersTable.createdAt),
      )
    ).orderBy(desc(logisticOrdersTable.createdAt)).limit(500) : Promise.resolve([]),

    // PPJK
    (!modFilter || modFilter === "ppjk") ? db.select({
      id: ppjkOrdersTable.id,
      orderNumber: ppjkOrdersTable.orderNumber,
      customerName: ppjkOrdersTable.customerName,
      customerCompany: ppjkOrdersTable.customerCompany,
      origin: ppjkOrdersTable.origin,
      destination: ppjkOrdersTable.destination,
      mode: sql<string>`'PPJK'`,
      status: ppjkOrdersTable.status,
      vendor: ppjkOrdersTable.vendorName,
      revenue: ppjkOrdersTable.totalServiceFee,
      cost: sql<string>`null`,
      createdAt: ppjkOrdersTable.createdAt,
      _customsStatus: ppjkOrdersTable.customsStatus,
    }).from(ppjkOrdersTable).where(
      and(
        status && status !== "all" ? eq(ppjkOrdersTable.status, String(status)) : undefined,
        ...(q ? [or(ilike(ppjkOrdersTable.orderNumber, `%${q}%`), ilike(ppjkOrdersTable.customerName, `%${q}%`))] : []),
        ...mkDate(ppjkOrdersTable.createdAt),
      )
    ).orderBy(desc(ppjkOrdersTable.createdAt)).limit(500) : Promise.resolve([]),

    // Latest customs status per order (from freight_customs_docs)
    db.select({
      sourceModule: freightCustomsDocsTable.sourceModule,
      sourceOrderId: freightCustomsDocsTable.sourceOrderId,
      shipmentId: freightCustomsDocsTable.shipmentId,
      customsStatus: freightCustomsDocsTable.customsStatus,
    }).from(freightCustomsDocsTable)
      .where(sql`${freightCustomsDocsTable.customsStatus} is not null`)
      .orderBy(desc(freightCustomsDocsTable.updatedAt))
      .limit(1000),
  ]);

  type Row = {
    id: number; orderNumber: string; customerName: string; customerCompany: string | null;
    origin: string | null; destination: string | null; mode: string | null;
    status: string; vendor: string | null;
    revenue: string | null; cost: string | null;
    createdAt: Date | string;
    customsStatus?: string | null;
    module: string; detailPath: string;
    serviceCategory: string;
  };

  const buildCustomsMap = () => {
    const m = new Map<string, string>();
    for (const c of customsLatest) {
      const key = c.sourceModule && c.sourceOrderId
        ? `${c.sourceModule}:${c.sourceOrderId}`
        : c.shipmentId ? `general:${c.shipmentId}` : null;
      if (key && c.customsStatus && !m.has(key)) m.set(key, c.customsStatus);
    }
    return m;
  };
  const cm = buildCustomsMap();

  const toRow = (r: any, mod: string, cat: string, pathFn: (id: number) => string): Row => ({
    ...r,
    module: mod,
    serviceCategory: cat,
    detailPath: pathFn(r.id),
    customsStatus: (r as any)._customsStatus ?? cm.get(`${mod}:${r.id}`) ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : r.createdAt,
  });

  const all: Row[] = [
    ...general.map((r) => toRow(r, "general", "GENERAL_FORWARDING", (id) => `/logistics/freight/${id}`)),
    ...air.map((r) => toRow(r, "air_freight", "FF_UDARA", (id) => `/air-freight/orders/${id}`)),
    ...ocean.map((r) => toRow(r, "ocean_freight", "FF_LAUT", (id) => `/logistics/ocean-freight/${id}`)),
    ...trucking.map((r) => toRow(r, "trucking", "TRUCKING", (id) => `/logistic/orders/${id}`)),
    ...ppjk.map((r) => toRow(r, "ppjk", "PPJK", (id) => `/logistics/ppjk/${id}`)),
  ].sort((a, b) => new Date(b.createdAt as string).getTime() - new Date(a.createdAt as string).getTime());

  return res.json({ shipments: all, total: all.length });
});

// ─── UNIFIED CUSTOMS DOCS (multi-source: general / air_freight / ocean_freight) ─

// GET /api/logistics/customs-docs?shipmentId=X  OR  ?sourceModule=Y&sourceOrderId=Z
router.get("/customs-docs", async (req, res) => {
  const conditions = [];
  if (req.query.shipmentId) conditions.push(eq(freightCustomsDocsTable.shipmentId, Number(req.query.shipmentId)));
  if (req.query.sourceModule) conditions.push(eq(freightCustomsDocsTable.sourceModule, String(req.query.sourceModule)));
  if (req.query.sourceOrderId) conditions.push(eq(freightCustomsDocsTable.sourceOrderId, Number(req.query.sourceOrderId)));
  const docs = await db
    .select()
    .from(freightCustomsDocsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(freightCustomsDocsTable.createdAt));
  return res.json(docs.map((d) => ({ ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() })));
});

// POST /api/logistics/customs-docs
router.post("/customs-docs", async (req, res) => {
  const { shipmentId, sourceModule, sourceOrderId, docType, nomorAju, nomorDokumen, tanggalDokumen, customsStatus, data, scanSource, notes } = req.body;
  if (!docType) return res.status(400).json({ message: "docType wajib diisi" });
  if (!shipmentId && !sourceModule) return res.status(400).json({ message: "shipmentId atau sourceModule wajib diisi" });
  const [created] = await db.insert(freightCustomsDocsTable).values({
    shipmentId: shipmentId ? Number(shipmentId) : null,
    sourceModule: sourceModule || null,
    sourceOrderId: sourceOrderId ? Number(sourceOrderId) : null,
    docType,
    nomorAju: nomorAju || null,
    nomorDokumen: nomorDokumen || null,
    tanggalDokumen: tanggalDokumen || null,
    customsStatus: customsStatus || null,
    data: data ?? {},
    scanSource: scanSource || "manual",
    notes: notes || null,
  }).returning();
  return res.status(201).json({ ...created, createdAt: created.createdAt.toISOString(), updatedAt: created.updatedAt.toISOString() });
});

// PUT /api/logistics/customs-docs/:docId
router.put("/customs-docs/:docId", async (req, res) => {
  const docId = Number(req.params.docId);
  if (!Number.isInteger(docId)) return res.status(400).json({ message: "Invalid id" });
  const { docType, nomorAju, nomorDokumen, tanggalDokumen, customsStatus, data, notes } = req.body;
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (docType !== undefined) patch.docType = docType;
  if (nomorAju !== undefined) patch.nomorAju = nomorAju || null;
  if (nomorDokumen !== undefined) patch.nomorDokumen = nomorDokumen || null;
  if (tanggalDokumen !== undefined) patch.tanggalDokumen = tanggalDokumen || null;
  if (customsStatus !== undefined) patch.customsStatus = customsStatus || null;
  if (data !== undefined) patch.data = data;
  if (notes !== undefined) patch.notes = notes || null;
  const [updated] = await db
    .update(freightCustomsDocsTable)
    .set(patch)
    .where(eq(freightCustomsDocsTable.id, docId))
    .returning();
  if (!updated) return res.status(404).json({ message: "Dokumen tidak ditemukan" });
  return res.json({ ...updated, createdAt: updated.createdAt.toISOString(), updatedAt: updated.updatedAt.toISOString() });
});

// DELETE /api/logistics/customs-docs/:docId
router.delete("/customs-docs/:docId", async (req, res) => {
  const docId = Number(req.params.docId);
  if (!Number.isInteger(docId)) return res.status(400).json({ message: "Invalid id" });
  const [deleted] = await db
    .delete(freightCustomsDocsTable)
    .where(eq(freightCustomsDocsTable.id, docId))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Dokumen tidak ditemukan" });
  return res.json({ message: "Deleted" });
});

// ─── FASE 10: Accounting Linkage ────────────────────────────────────────────

// PATCH /api/logistics/freight-shipments/:id/financial — update estimated/actual financial fields
router.patch("/freight-shipments/:id/financial", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const { estimatedRevenue, estimatedCost, actualRevenue, actualCost } = req.body as Record<string, string | number | undefined>;
  const patch: Record<string, string | null> = {};
  if (estimatedRevenue !== undefined) patch.estimatedRevenue = estimatedRevenue !== "" && estimatedRevenue != null ? String(Number(estimatedRevenue)) : null;
  if (estimatedCost !== undefined)    patch.estimatedCost    = estimatedCost    !== "" && estimatedCost    != null ? String(Number(estimatedCost))    : null;
  if (actualRevenue !== undefined)    patch.actualRevenue    = actualRevenue    !== "" && actualRevenue    != null ? String(Number(actualRevenue))    : null;
  if (actualCost !== undefined)       patch.actualCost       = actualCost       !== "" && actualCost       != null ? String(Number(actualCost))       : null;
  if (Object.keys(patch).length === 0) return res.status(400).json({ message: "Tidak ada field yang diupdate" });
  const [updated] = await db.update(freightShipmentsTable).set(patch).where(eq(freightShipmentsTable.id, id)).returning();
  if (!updated) return res.status(404).json({ message: "Shipment tidak ditemukan" });
  return res.json({ message: "Financial fields updated", shipment: updated });
});

// POST /api/logistics/freight-shipments/:id/generate-invoice — buat / update Sales Invoice
router.post("/freight-shipments/:id/generate-invoice", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [s] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!s) return res.status(404).json({ message: "Shipment tidak ditemukan" });

  const { customerName, actualRevenue, taxAmount = 0, notes } = req.body as Record<string, string | number | undefined>;
  const revenue = Number(actualRevenue ?? s.actualRevenue ?? s.freightCost ?? 0);
  const tax     = Number(taxAmount ?? 0);
  const grand   = revenue + tax;

  let salesDoc;
  if (s.salesDocId) {
    const [upd] = await db.update(salesDocumentsTable)
      .set({ invoiceStatus: "to_invoice", totalAmount: String(revenue), taxAmount: String(tax), grandTotal: String(grand) })
      .where(eq(salesDocumentsTable.id, s.salesDocId))
      .returning();
    salesDoc = upd;
  } else {
    const docNumber = nextNumber("FINV");
    const [newDoc] = await db.insert(salesDocumentsTable).values({
      docNumber,
      kind: "order",
      status: "confirmed",
      invoiceStatus: "to_invoice",
      customerName: String(customerName || s.shipperName || "Customer"),
      totalAmount: String(revenue),
      taxAmount: String(tax),
      grandTotal: String(grand),
      notes: String(notes || `Invoice Freight ${s.shipmentNumber}`),
    }).returning();
    salesDoc = newDoc;
    await db.update(freightShipmentsTable).set({ salesDocId: salesDoc!.id }).where(eq(freightShipmentsTable.id, id));
  }

  const [updated] = await db.update(freightShipmentsTable)
    .set({ invoiceStatus: "to_invoice", actualRevenue: String(revenue) })
    .where(eq(freightShipmentsTable.id, id))
    .returning();

  return res.json({ salesDoc, shipment: updated });
});

// POST /api/logistics/freight-shipments/:id/generate-vendor-bill — buat / update Purchase Bill
router.post("/freight-shipments/:id/generate-vendor-bill", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [s] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!s) return res.status(404).json({ message: "Shipment tidak ditemukan" });

  const { vendorName, actualCost: bodyCost, notes } = req.body as Record<string, string | number | undefined>;
  const cost = Number(bodyCost ?? s.actualCost ?? 0);

  let purchaseDoc;
  if (s.purchaseDocId) {
    const [upd] = await db.update(purchaseDocumentsTable)
      .set({ billStatus: "to_bill", totalAmount: String(cost), taxAmount: "0", grandTotal: String(cost) })
      .where(eq(purchaseDocumentsTable.id, s.purchaseDocId))
      .returning();
    purchaseDoc = upd;
  } else {
    const docNumber = nextNumber("FBILL");
    const [newDoc] = await db.insert(purchaseDocumentsTable).values({
      docNumber,
      kind: "order",
      status: "confirmed",
      billStatus: "to_bill",
      supplierName: String(vendorName || s.approvedVendorName || "Vendor"),
      totalAmount: String(cost),
      taxAmount: "0",
      grandTotal: String(cost),
      notes: String(notes || `Vendor Bill Freight ${s.shipmentNumber}`),
    }).returning();
    purchaseDoc = newDoc;
    await db.update(freightShipmentsTable).set({ purchaseDocId: purchaseDoc!.id }).where(eq(freightShipmentsTable.id, id));
  }

  const [updated] = await db.update(freightShipmentsTable)
    .set({ vendorBillStatus: "to_bill", actualCost: String(cost) })
    .where(eq(freightShipmentsTable.id, id))
    .returning();

  return res.json({ purchaseDoc, shipment: updated });
});

// POST /api/logistics/freight-shipments/:id/post-accounting — posting jurnal akuntansi
router.post("/freight-shipments/:id/post-accounting", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const [s] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, id));
  if (!s) return res.status(404).json({ message: "Shipment tidak ditemukan" });

  const results: { revenuePosted: boolean; costPosted: boolean; errors: string[] } = {
    revenuePosted: false, costPosted: false, errors: [],
  };

  // Jurnal revenue (Sales Invoice)
  if (s.salesDocId) {
    const [sdoc] = await db.select().from(salesDocumentsTable).where(eq(salesDocumentsTable.id, s.salesDocId));
    if (sdoc) {
      try {
        const svcType = normalizeShipmentServiceType(s.transportMode || s.serviceCategory || null);
        await postLogisticSalesInvoice({
          logisticOrderId: s.sourceOrderId ?? id,
          salesDocId: sdoc.id,
          docNumber: sdoc.docNumber,
          customerName: sdoc.customerName,
          lines: [{ serviceType: svcType, subtotal: Number(sdoc.totalAmount ?? sdoc.grandTotal ?? 0) }],
          taxAmount: Number(sdoc.taxAmount ?? 0),
          companyId: s.companyId ?? null,
        });
        await db.update(salesDocumentsTable).set({ invoiceStatus: "invoiced" }).where(eq(salesDocumentsTable.id, sdoc.id));
        await db.update(freightShipmentsTable)
          .set({ invoiceStatus: "invoiced", actualRevenue: sdoc.grandTotal })
          .where(eq(freightShipmentsTable.id, id));
        results.revenuePosted = true;
      } catch (e: unknown) {
        results.errors.push(`Revenue journal: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    results.errors.push("Belum ada Sales Invoice — generate invoice terlebih dahulu.");
  }

  // Jurnal biaya vendor (Vendor Bill)
  if (s.purchaseDocId) {
    const [pdoc] = await db.select().from(purchaseDocumentsTable).where(eq(purchaseDocumentsTable.id, s.purchaseDocId));
    if (pdoc) {
      try {
        const svcType = normalizeShipmentServiceType(s.transportMode || s.serviceCategory || null);
        await postLogisticVendorCostJournal({
          vendorPoId: pdoc.id,
          docNumber: pdoc.docNumber,
          supplierName: pdoc.supplierName,
          serviceType: svcType,
          vendorCostSnapshot: { vendorCost: Number(pdoc.grandTotal ?? 0), currency: "IDR", source: "freight_shipment" },
          companyId: s.companyId ?? null,
        });
        await db.update(purchaseDocumentsTable).set({ billStatus: "billed" }).where(eq(purchaseDocumentsTable.id, pdoc.id));
        await db.update(freightShipmentsTable)
          .set({ vendorBillStatus: "billed", actualCost: pdoc.grandTotal })
          .where(eq(freightShipmentsTable.id, id));
        results.costPosted = true;
      } catch (e: unknown) {
        results.errors.push(`Cost journal: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    results.errors.push("Belum ada Vendor Bill — generate vendor bill terlebih dahulu.");
  }

  const success = results.revenuePosted || results.costPosted;
  return res.status(success ? 200 : 400).json({ ...results, message: success ? "Posting akuntansi selesai" : "Posting gagal" });
});

export default router;

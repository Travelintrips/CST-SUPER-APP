import { Router, Request, Response } from "express";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import {
  logisticOrdersTable,
  logisticOrderItemsTable,
  portalContentTable,
  suppliersTable,
  driverJobsTable,
  driverJobLogsTable,
  driverPhotosTable,
  logisticOrderRfqsTable,
  driverLocationsTable,
} from "@workspace/db";
import { eq, ilike, and, gte, lte, or, sql, desc, inArray, isNotNull } from "drizzle-orm";
import { salesDocumentsTable } from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";
import { sendLogisticOrderNotification } from "../lib/orderNotification";
// [FLOW BARU] autoCreateRfqAndNotifyVendors dinonaktifkan — vendor tidak boleh dihubungi langsung saat order dibuat.
// Admin harus review dulu via /bizportal/logistics/rfq sebelum blast ke vendor.
// import { autoCreateRfqAndNotifyVendors } from "./logisticRfq";
import { sendWhatsApp } from "../lib/fonnte";
import { saveAndBroadcast } from "../lib/notificationStore";
import {
  CreateLogisticOrderBody,
  ListLogisticOrdersQueryParams,
  GetLogisticOrderByNumberParams,
  GetLogisticOrderParams,
  UpdateLogisticOrderStatusParams,
  UpdateLogisticOrderStatusBody,
} from "@workspace/api-zod";

export const logisticOrdersRouter = Router();

function generateOrderNumber(): string {
  const date = new Date();
  const y = date.getFullYear().toString().slice(-2);
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `LOG-${y}${m}${d}-${rand}`;
}

function toOrder(row: typeof logisticOrdersTable.$inferSelect, approvedVendorName?: string | null) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    companyId: row.companyId ?? null,
    companyName: row.companyName,
    customerName: row.customerName,
    email: row.email,
    phone: row.phone,
    shipmentType: row.shipmentType,
    origin: row.origin,
    destination: row.destination,
    commodity: row.commodity ?? null,
    cargoDescription: row.cargoDescription ?? null,
    grossWeight: row.grossWeight ? parseFloat(row.grossWeight) : null,
    volumeCbm: row.volumeCbm ? parseFloat(row.volumeCbm) : null,
    jumlahKoli: row.jumlahKoli ?? null,
    requiredDate: row.requiredDate ?? null,
    notes: row.notes ?? null,
    paymentType: row.paymentType ?? null,
    paymentMethod: row.paymentMethod ?? null,
    namaPenerima: row.namaPenerima ?? null,
    nomorPenerima: row.nomorPenerima ?? null,
    jamOrder: row.jamOrder ?? null,
    source: row.source ?? "manual",

    subtotal: parseFloat(row.subtotal),
    tax: parseFloat(row.tax),
    grandTotal: parseFloat(row.grandTotal),
    status: row.status,
    approvedQuoteId: row.approvedQuoteId ?? null,
    adminApprovalStatus: row.adminApprovalStatus ?? null,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    approvedVendorId: row.approvedVendorId ?? null,
    approvedVendorName: approvedVendorName ?? null,
    finalSellingPrice: row.finalSellingPrice ? parseFloat(row.finalSellingPrice) : null,
    quotationSentAt: row.quotationSentAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItem(row: typeof logisticOrderItemsTable.$inferSelect) {
  return {
    id: row.id,
    orderId: row.orderId,
    category: row.category,
    serviceName: row.serviceName,
    calculatorType: row.calculatorType,
    inputData: row.inputData,
    calculationResult: row.calculationResult,
    subtotal: parseFloat(row.subtotal),
    createdAt: row.createdAt.toISOString(),
  };
}

/** Public-safe item projection — strips financial and raw-input data */
function toPublicItem(row: typeof logisticOrderItemsTable.$inferSelect) {
  return {
    id: row.id,
    category: row.category,
    serviceName: row.serviceName,
    calculatorType: row.calculatorType,
    createdAt: row.createdAt.toISOString(),
  };
}

const TRUCKING_RATES_KEY = "logistic_trucking_rates";

const DEFAULT_TRUCKING_RATES: Record<string, { ratePerKm: number; loadingFee: number }> = {
  CDE:      { ratePerKm: 5000,  loadingFee: 500000 },
  CDD:      { ratePerKm: 7000,  loadingFee: 700000 },
  Fuso:     { ratePerKm: 10000, loadingFee: 1000000 },
  Wingbox:  { ratePerKm: 12000, loadingFee: 1200000 },
  Trailer:  { ratePerKm: 15000, loadingFee: 1500000 },
};

async function getTruckingRates() {
  const [row] = await db
    .select()
    .from(portalContentTable)
    .where(eq(portalContentTable.key, TRUCKING_RATES_KEY));
  if (!row) return DEFAULT_TRUCKING_RATES;
  try {
    return JSON.parse(row.value) as typeof DEFAULT_TRUCKING_RATES;
  } catch {
    return DEFAULT_TRUCKING_RATES;
  }
}

// ─── PUBLIC ROUTES (no auth required) ────────────────────────────────────────

// POST /api/logistic/orders — create order (public)
logisticOrdersRouter.post("/", async (req: Request, res: Response) => {
  const parsed = CreateLogisticOrderBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Data tidak valid", errors: parsed.error.errors });
  }
  const body = parsed.data;

  const orderNumber = generateOrderNumber();

  const [order] = await db
    .insert(logisticOrdersTable)
    .values({
      orderNumber,
      companyName: body.companyName,
      customerName: body.customerName,
      email: body.email,
      phone: body.phone,
      shipmentType: body.shipmentType,
      origin: body.origin,
      destination: body.destination,
      commodity: body.commodity ?? null,
      cargoDescription: body.cargoDescription ?? null,
      grossWeight: body.grossWeight != null ? String(body.grossWeight) : null,
      volumeCbm: body.volumeCbm != null ? String(body.volumeCbm) : null,
      jumlahKoli: body.jumlahKoli ?? null,
      requiredDate: body.requiredDate ?? null,
      notes: body.notes ?? null,
      paymentType: body.paymentType ?? null,
      paymentMethod: body.paymentMethod ?? null,
      namaPenerima: body.namaPenerima ?? null,
      nomorPenerima: body.nomorPenerima ?? null,
      jamOrder: body.jamOrder ?? null,
      // [MULTI-MODE] transport mode fields
      transportMode: (body as any).transportMode ?? null,
      originDistrict: (body as any).originDistrict ?? null,
      destDistrict: (body as any).destDistrict ?? null,
      pickupDate: (body as any).pickupDate ?? null,
      pickupTime: (body as any).pickupTime ?? null,
      truckType: (body as any).truckType ?? null,
      originPort: (body as any).originPort ?? null,
      destPort: (body as any).destPort ?? null,
      weightKg: (body as any).weightKg != null ? String((body as any).weightKg) : null,
      incoterm: (body as any).incoterm ?? null,
      etd: (body as any).etd ? new Date((body as any).etd as string) : null,
      eta: (body as any).eta ? new Date((body as any).eta as string) : null,
      source: "manual",
      subtotal: String(body.subtotal),
      tax: String(body.tax),
      grandTotal: String(body.grandTotal),
      status: "New Order",
      publicRfqToken: randomBytes(16).toString("hex"),
    })
    .returning();

  const itemValues = body.items.map((item) => ({
    orderId: order.id,
    category: item.category,
    serviceName: item.serviceName,
    calculatorType: item.calculatorType,
    inputData: item.inputData as Record<string, unknown>,
    calculationResult: item.calculationResult as Record<string, unknown>,
    subtotal: String(item.subtotal),
  }));

  const items =
    itemValues.length > 0
      ? await db.insert(logisticOrderItemsTable).values(itemValues).returning()
      : [];

  const serviceList = body.items.map((i) => `• ${i.serviceName}`).join("\n");

  const vehicleType =
    (body.items.find((i) => i.calculatorType === "trucking")
      ?.inputData as Record<string, unknown> | undefined)
      ?.vehicleType as string ?? null;
sendLogisticOrderNotification({
    id: order.id,
    orderNumber,
    customerName: body.customerName,
    companyName: body.companyName,
    email: body.email,
    phone: body.phone,
    shipmentType: body.shipmentType,
    origin: body.origin,
    destination: body.destination,
    commodity: body.commodity ?? null,
    cargoDescription: body.cargoDescription ?? null,
    grossWeight: body.grossWeight != null ? Number(body.grossWeight) : null,
    volumeCbm: body.volumeCbm != null ? Number(body.volumeCbm) : null,
    grandTotal: Number(body.grandTotal),
    serviceList,
    requiredDate: body.requiredDate ?? null,
    notes: body.notes ?? null,
    jamOrder: body.jamOrder ?? null,
    vehicleType,
    createdAt: order.createdAt,
  }).catch((err: unknown) => {
    req.log.error({ err }, "sendLogisticOrderNotification failed");
  });

  // [FLOW BARU] Auto-blast ke vendor DINONAKTIFKAN.
  // Order masuk → status admin_review → Admin review → Admin blast ke vendor.
  // RFQ dibuat manual oleh admin via POST /api/logistic/rfq/create-from-order/:orderId

  saveAndBroadcast("new_logistic_order", {
    type: "logistic",
    orderId: order.id,
    orderNumber,
    customerName: body.customerName,
    companyName: body.companyName ?? null,
    shipmentType: body.shipmentType,
    origin: body.origin,
    destination: body.destination,
    grandTotal: Number(body.grandTotal),
    createdAt: order.createdAt.toISOString(),
  }).catch(() => {});

  return res.status(201).json({
    ...toOrder(order),
    items: items.map(toItem),
  });
});

/** Public-safe order projection — strips PII, payment, financial, and internal approval fields */
function toPublicOrder(row: typeof logisticOrdersTable.$inferSelect) {
  return {
    id: row.id,
    orderNumber: row.orderNumber,
    shipmentType: row.shipmentType,
    origin: row.origin,
    destination: row.destination,
    grossWeight: row.grossWeight ? parseFloat(row.grossWeight) : null,
    volumeCbm: row.volumeCbm ? parseFloat(row.volumeCbm) : null,
    jumlahKoli: row.jumlahKoli ?? null,
    requiredDate: row.requiredDate ?? null,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Simple in-memory rate limiter for public order-number lookup endpoints */
const publicLookupHits = new Map<string, { count: number; resetAt: number }>();
function publicLookupRateLimit(req: Request, res: Response, next: () => void) {
  const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? "unknown";
  const now = Date.now();
  const window = 60_000;
  const limit = 20;
  const entry = publicLookupHits.get(ip);
  if (!entry || now > entry.resetAt) {
    publicLookupHits.set(ip, { count: 1, resetAt: now + window });
    return next();
  }
  if (entry.count >= limit) {
    res.status(429).json({ error: "Terlalu banyak permintaan. Coba lagi sebentar." });
    return;
  }
  entry.count += 1;
  next();
}

// GET /api/logistic/orders/by-number/:orderNumber — lookup by order number (public)
logisticOrdersRouter.get(
  "/by-number/:orderNumber",
  publicLookupRateLimit,
  async (req: Request, res: Response) => {
    const parsed = GetLogisticOrderByNumberParams.safeParse(req.params);
    if (!parsed.success) return res.status(400).json({ message: "Parameter tidak valid" });
    const { orderNumber } = parsed.data;

    const [order] = await db
      .select()
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.orderNumber, orderNumber));

    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const items = await db
      .select()
      .from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));

    return res.json({ ...toPublicOrder(order), items: items.map(toPublicItem) });
  }
);

// GET /api/logistic/orders/track/:orderNumber — tracking data with driver job (public)
logisticOrdersRouter.get(
  "/track/:orderNumber",
  publicLookupRateLimit,
  async (req: Request, res: Response) => {
    const orderNumber = String(req.params.orderNumber ?? "").toUpperCase().trim();
    if (!orderNumber) return res.status(400).json({ message: "Nomor order tidak valid" });

    const [order] = await db
      .select()
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.orderNumber, orderNumber));

    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const items = await db
      .select()
      .from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));

    const [driverJob] = await db
      .select()
      .from(driverJobsTable)
      .where(eq(driverJobsTable.logisticOrderId, order.id))
      .orderBy(desc(driverJobsTable.assignedAt))
      .limit(1);

    let driverJobData = null;
    if (driverJob) {
      const logs = await db
        .select()
        .from(driverJobLogsTable)
        .where(eq(driverJobLogsTable.driverJobId, driverJob.id))
        .orderBy(desc(driverJobLogsTable.timestamp));

      const photos = await db
        .select()
        .from(driverPhotosTable)
        .where(eq(driverPhotosTable.driverJobId, driverJob.id))
        .orderBy(desc(driverPhotosTable.takenAt));

      driverJobData = {
        id: driverJob.id,
        jobNumber: driverJob.jobNumber,
        status: driverJob.status,
        vehicleType: driverJob.vehicleType ?? null,
        pickupDateTime: driverJob.pickupDateTime?.toISOString() ?? null,
        deliveryDateTime: driverJob.deliveryDateTime?.toISOString() ?? null,
        cargoDescription: driverJob.cargoDescription ?? null,
        weight: driverJob.weight ?? null,
        distance: driverJob.distance ?? null,
        assignedAt: driverJob.assignedAt.toISOString(),
        completedAt: driverJob.completedAt?.toISOString() ?? null,
        logs: logs.map((l) => ({
          id: l.id,
          status: l.status,
          timestamp: l.timestamp.toISOString(),
        })),
      };
    }

    // RFQ quote info untuk customer portal
    const [latestRfq] = await db
      .select()
      .from(logisticOrderRfqsTable)
      .where(eq(logisticOrderRfqsTable.orderId, order.id))
      .orderBy(desc(logisticOrderRfqsTable.createdAt))
      .limit(1);

    const rfqQuote = latestRfq ? {
      rfqId: latestRfq.id,
      rfqStatus: latestRfq.status,
      quotedPrice: latestRfq.quotedPrice ? parseFloat(latestRfq.quotedPrice) : null,
      quotedAt: latestRfq.quotedAt?.toISOString() ?? null,
      quoteNotes: latestRfq.quoteNotes ?? null,
      customerResponseNotes: (latestRfq as any).customerResponseNotes ?? null,
      customerRespondedAt: (latestRfq as any).customerRespondedAt
        ? new Date((latestRfq as any).customerRespondedAt).toISOString() : null,
    } : null;

    return res.json({
      ...toPublicOrder(order),
      items: items.map(toPublicItem),
      driverJob: driverJobData,
      rfqQuote,
    });
  }
);

// GET /api/logistic/orders/trucking-rates — public
logisticOrdersRouter.get("/trucking-rates", async (_req: Request, res: Response) => {
  const rates = await getTruckingRates();
  return res.json(rates);
});

// GET /api/logistic/orders/vendors — admin & logistics staff
logisticOrdersRouter.get("/vendors", async (req: Request, res: Response) => {
  const user = (req as any).user;
  const allowed = ["admin", "owner", "logistics"];
  if (!user || !allowed.includes(user.role)) {
    return res.status(403).json({ error: "Forbidden" });
  }
  const rows = await db.select().from(suppliersTable).orderBy(suppliersTable.sortOrder);
  return res.json(rows.map((v) => ({ ...v, fee: Number(v.fee ?? 0), email: v.contactEmail })));
});

// ─── AUTH WALL: all routes below require a valid session ─────────────────────

logisticOrdersRouter.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ─── STAFF-ONLY ROUTES ────────────────────────────────────────────────────────

// GET /api/logistic/orders — list orders (admin)
logisticOrdersRouter.get("/", async (req: Request, res: Response) => {
  const parsed = ListLogisticOrdersQueryParams.safeParse(req.query);
  const q = parsed.success ? parsed.data : {};

  const rawCompany = req.query["company"] ?? req.query["companyId"];
  const isConsolidated = rawCompany === "0" || rawCompany === "all" || rawCompany === undefined;
  const companyId = isConsolidated ? null : resolveCompanyId(req);

  // companyId=0 or "all" = consolidated view (all companies), otherwise filter by specific company
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];
  if (companyId !== null && companyId > 0) conditions.push(eq(logisticOrdersTable.companyId, companyId));
  if (q.status) conditions.push(eq(logisticOrdersTable.status, q.status));
  if (q.shipmentType) conditions.push(eq(logisticOrdersTable.shipmentType, q.shipmentType));
  if (q.search) {
    conditions.push(
      or(
        ilike(logisticOrdersTable.customerName, `%${q.search}%`),
        ilike(logisticOrdersTable.companyName, `%${q.search}%`),
        ilike(logisticOrdersTable.orderNumber, `%${q.search}%`)
      )!
    );
  }
  if (q.dateFrom) conditions.push(gte(logisticOrdersTable.createdAt, new Date(q.dateFrom)));
  if (q.dateTo) conditions.push(lte(logisticOrdersTable.createdAt, new Date(q.dateTo)));

  const rows =
    conditions.length > 0
      ? await db
          .select()
          .from(logisticOrdersTable)
          .where(and(...conditions))
          .orderBy(sql`${logisticOrdersTable.createdAt} DESC`)
      : await db
          .select()
          .from(logisticOrdersTable)
          .orderBy(sql`${logisticOrdersTable.createdAt} DESC`);

  // Attach linked sales doc info for each order
  const orderIds = rows.map((r) => r.id);
  const linkedDocMap = new Map<number, { id: number; docNumber: string }>();
  if (orderIds.length > 0) {
    const linkedDocs = await db
      .select({ logisticOrderId: salesDocumentsTable.logisticOrderId, id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
      .from(salesDocumentsTable)
      .where(and(isNotNull(salesDocumentsTable.logisticOrderId), inArray(salesDocumentsTable.logisticOrderId, orderIds)));
    for (const d of linkedDocs) {
      if (d.logisticOrderId != null) linkedDocMap.set(d.logisticOrderId, { id: d.id, docNumber: d.docNumber });
    }
  }

  // Attach latest RFQ info (including freight_shipment_id via raw SQL)
  const rfqMap = new Map<number, {
    rfqId: number; rfqNumber: string; rfqStatus: string;
    freightShipmentId: number | null; freightShipmentNumber: string | null;
  }>();
  if (orderIds.length > 0) {
    const rfqRows = await db.execute(sql`
      SELECT DISTINCT ON (r.order_id)
        r.order_id AS "orderId",
        r.id AS "rfqId",
        r.rfq_number AS "rfqNumber",
        r.status AS "rfqStatus",
        r.freight_shipment_id AS "freightShipmentId",
        fs.shipment_number AS "freightShipmentNumber"
      FROM logistic_order_rfqs r
      LEFT JOIN freight_shipments fs ON fs.id = r.freight_shipment_id
      WHERE r.order_id = ANY(${sql.raw(`ARRAY[${orderIds.join(",")}]::int[]`)})
      ORDER BY r.order_id, r.created_at DESC
    `);
    for (const row of rfqRows as any[]) {
      rfqMap.set(Number(row.orderId), {
        rfqId: Number(row.rfqId),
        rfqNumber: row.rfqNumber as string,
        rfqStatus: row.rfqStatus as string,
        freightShipmentId: row.freightShipmentId ? Number(row.freightShipmentId) : null,
        freightShipmentNumber: (row.freightShipmentNumber as string) ?? null,
      });
    }
  }

  return res.json(rows.map((row) => ({
    ...toOrder(row),
    linkedSalesDocId: linkedDocMap.get(row.id)?.id ?? null,
    linkedSalesDocNumber: linkedDocMap.get(row.id)?.docNumber ?? null,
    latestRfq: rfqMap.get(row.id) ?? null,
  })));
});

// GET /api/logistic/orders/summary — dashboard stats (admin)
logisticOrdersRouter.get("/summary", async (_req: Request, res: Response) => {
  const rows = await db.select().from(logisticOrdersTable);
  const count = (status: string) => rows.filter((r) => r.status === status).length;
  return res.json({
    totalOrders: rows.length,
    newOrders: count("New Order"),
    underReviewOrders: count("Under Review"),
    quotationSentOrders: count("Quotation Sent"),
    confirmedOrders: count("Confirmed"),
    inProgressOrders: count("In Progress"),
    completedOrders: count("Completed"),
    cancelledOrders: count("Cancelled"),
    totalEstimatedRevenue: rows.reduce((acc, r) => acc + parseFloat(r.grandTotal), 0),
  });
});

// PUT /api/logistic/orders/trucking-rates — admin only
// Protected by requirePortalAdmin: caller must present a valid Supabase Bearer token
// belonging to an email on the server-side PORTAL_ADMIN_EMAILS allowlist.
// The shared x-admin-password mechanism has been removed entirely.
logisticOrdersRouter.put("/trucking-rates", requirePortalAdmin, async (req: Request, res: Response) => {
  const rates = req.body as Record<string, { ratePerKm: number; loadingFee: number }>;
  if (!rates || typeof rates !== "object") {
    return res.status(400).json({ message: "Format tarif tidak valid" });
  }
  const json = JSON.stringify(rates);
  const existing = await db
    .select()
    .from(portalContentTable)
    .where(eq(portalContentTable.key, TRUCKING_RATES_KEY));
  if (existing.length > 0) {
    await db
      .update(portalContentTable)
      .set({ value: json })
      .where(eq(portalContentTable.key, TRUCKING_RATES_KEY));
  } else {
    await db
      .insert(portalContentTable)
      .values({ key: TRUCKING_RATES_KEY, value: json });
  }
  return res.json({ message: "Tarif berhasil disimpan" });
});

// ─── Delivery Vendors CRUD (for BizPortal) ───────────────────────────────────

// POST /api/logistic/orders/vendors
logisticOrdersRouter.post("/vendors", async (req: Request, res: Response) => {
  const { name, logo, eta, fee, note, phone, email, serviceType } = req.body as Record<string, unknown>;
  if (!name || typeof name !== "string" || !name.trim())
    return res.status(400).json({ message: "Nama vendor harus diisi" });
  const [maxRow] = await db.select({ max: sql<number>`COALESCE(MAX(sort_order), 0)` }).from(suppliersTable);
  const nextSort = Number(maxRow?.max ?? 0) + 1;
  const [created] = await db.insert(suppliersTable).values({
    name: String(name).trim(),
    logo: typeof logo === "string" && logo.trim() ? logo.trim() : "📦",
    eta: typeof eta === "string" && eta.trim() ? eta.trim() : "2-3 hari",
    fee: typeof fee === "number" ? String(fee) : "0",
    note: typeof note === "string" && note.trim() ? note.trim() : null,
    phone: typeof phone === "string" && phone.trim() ? phone.trim() : null,
    contactEmail: typeof email === "string" && email.trim() ? email.trim() : null,
    serviceType: typeof serviceType === "string" && serviceType.trim() ? serviceType.trim() : null,
    isActive: true,
    sortOrder: nextSort,
  }).returning();
  return res.status(201).json({ ...created, fee: Number(created.fee ?? 0), email: created.contactEmail });
});

// PUT /api/logistic/orders/vendors/:id
logisticOrdersRouter.put("/vendors/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const { name, logo, eta, fee, note, phone, email, serviceType, isActive, sortOrder } = req.body as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (typeof name === "string" && name.trim()) patch.name = name.trim();
  if (typeof logo === "string") patch.logo = logo.trim() || "📦";
  if (typeof eta === "string" && eta.trim()) patch.eta = eta.trim();
  if (typeof fee === "number") patch.fee = String(fee);
  if (note !== undefined) patch.note = typeof note === "string" && note.trim() ? note.trim() : null;
  if (phone !== undefined) patch.phone = typeof phone === "string" && phone.trim() ? phone.trim() : null;
  if (email !== undefined) patch.contactEmail = typeof email === "string" && email.trim() ? email.trim() : null;
  if (serviceType !== undefined) patch.serviceType = typeof serviceType === "string" && serviceType.trim() ? serviceType.trim() : null;
  if (typeof isActive === "boolean") patch.isActive = isActive;
  if (typeof sortOrder === "number") patch.sortOrder = sortOrder;
  if (Object.keys(patch).length === 0) return res.status(400).json({ message: "Tidak ada data yang diperbarui" });
  const [updated] = await db.update(suppliersTable).set(patch).where(eq(suppliersTable.id, id)).returning();
  if (!updated) return res.status(404).json({ message: "Vendor tidak ditemukan" });
  return res.json({ ...updated, fee: Number(updated.fee ?? 0), email: updated.contactEmail });
});

// DELETE /api/logistic/orders/vendors/:id
logisticOrdersRouter.delete("/vendors/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const [deleted] = await db.delete(suppliersTable).where(eq(suppliersTable.id, id)).returning();
  if (!deleted) return res.status(404).json({ message: "Vendor tidak ditemukan" });
  return res.json({ success: true });
});

// GET /api/logistic/orders/:id — get order detail (admin)
logisticOrdersRouter.get("/:id", async (req: Request, res: Response) => {
  const parsed = GetLogisticOrderParams.safeParse({
    id: parseInt(String(req.params.id), 10),
  });
  if (!parsed.success || isNaN(parsed.data.id))
    return res.status(400).json({ message: "ID tidak valid" });
  const { id } = parsed.data;

  const [order] = await db
    .select()
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id));

  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const [items, linkedDocRows] = await Promise.all([
    db.select().from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, id)),
    db.select({ id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.logisticOrderId, id))
      .limit(1),
  ]);

  let approvedVendorName: string | null = null;
  if (order.approvedVendorId) {
    const [v] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, order.approvedVendorId));
    approvedVendorName = v?.name ?? null;
  }

  const linkedDoc = linkedDocRows[0] ?? null;
  return res.json({
    ...toOrder(order, approvedVendorName),
    items: items.map(toItem),
    linkedSalesDocId: linkedDoc?.id ?? null,
    linkedSalesDocNumber: linkedDoc?.docNumber ?? null,
  });
});

// PUT /api/logistic/orders/:id/status — update status (admin)
logisticOrdersRouter.put("/:id/status", async (req: Request, res: Response) => {
  const paramsParsed = UpdateLogisticOrderStatusParams.safeParse({
    id: parseInt(String(req.params.id), 10),
  });
  const bodyParsed = UpdateLogisticOrderStatusBody.safeParse(req.body);

  if (!paramsParsed.success || isNaN(paramsParsed.data.id))
    return res.status(400).json({ message: "ID tidak valid" });
  if (!bodyParsed.success)
    return res.status(400).json({ message: "Status tidak valid" });

  const { id } = paramsParsed.data;
  const { status } = bodyParsed.data;

  const [updated] = await db
    .update(logisticOrdersTable)
    .set({ status })
    .where(eq(logisticOrdersTable.id, id))
    .returning();

  if (!updated) return res.status(404).json({ message: "Order tidak ditemukan" });

  // Notify customer via WhatsApp (fire-and-forget)
  if (updated.phone) {
    const statusLabels: Record<string, string> = {
      "New Order": "Order Baru",
      "Under Review": "Sedang Ditinjau",
      "Quotation Sent": "Penawaran Telah Dikirim",
      "Confirmed": "Dikonfirmasi",
      "In Progress": "Sedang Diproses",
      "Completed": "Selesai",
      "Cancelled": "Dibatalkan",
    };
    const label = statusLabels[status] ?? status;
    const msg =
      `📦 *Update Status Order Anda*\n` +
      `No Order: ${updated.orderNumber}\n` +
      `Status: *${label}*\n\n` +
      `Terima kasih telah menggunakan layanan kami. Hubungi kami jika ada pertanyaan.`;
    sendWhatsApp(updated.phone, msg).catch(() => undefined);
  }

  saveAndBroadcast("logistic_order_status_changed", {
    type: "logistic_status",
    orderId: updated.id,
    orderNumber: updated.orderNumber,
    customerName: updated.customerName,
    companyName: updated.companyName ?? null,
    status: updated.status,
    updatedAt: new Date().toISOString(),
  }).catch(() => {});

  return res.json(toOrder(updated));
});

// PATCH /api/logistic/orders/:id/type — update shipment type (admin)
logisticOrdersRouter.patch("/:id/type", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const { shipmentType } = req.body as { shipmentType?: unknown };
  if (!shipmentType || typeof shipmentType !== "string" || shipmentType.trim() === "")
    return res.status(400).json({ message: "shipmentType wajib diisi" });
  const [updated] = await db
    .update(logisticOrdersTable)
    .set({ shipmentType: shipmentType.trim() })
    .where(eq(logisticOrdersTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ message: "Order tidak ditemukan" });
  return res.json(toOrder(updated));
});

// DELETE /api/logistic/orders/:id
logisticOrdersRouter.delete("/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid ID" });
  const [deleted] = await db
    .delete(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id))
    .returning();
  if (!deleted) return res.status(404).json({ message: "Order tidak ditemukan" });
  return res.json({ message: "Deleted", id });
});

// GET /api/logistic/orders/:id/locations — GPS history for an order (admin)
logisticOrdersRouter.get("/:id/locations", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params["id"] ?? ""));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "200"), 10), 500);

  const rows = await db
    .select({
      id: driverLocationsTable.id,
      latitude: driverLocationsTable.latitude,
      longitude: driverLocationsTable.longitude,
      accuracy: driverLocationsTable.accuracy,
      speed: driverLocationsTable.speed,
      checkpointType: driverLocationsTable.checkpointType,
      updatedAt: driverLocationsTable.updatedAt,
    })
    .from(driverLocationsTable)
    .where(eq(driverLocationsTable.orderId, id))
    .orderBy(driverLocationsTable.updatedAt)
    .limit(limit);

  return res.json({
    locations: rows.map(r => ({
      id: r.id,
      lat: parseFloat(String(r.latitude)),
      lng: parseFloat(String(r.longitude)),
      accuracy: r.accuracy != null ? parseFloat(String(r.accuracy)) : null,
      speed: r.speed != null ? parseFloat(String(r.speed)) : null,
      checkpointType: r.checkpointType,
      updatedAt: r.updatedAt,
    })),
    total: rows.length,
  });
});

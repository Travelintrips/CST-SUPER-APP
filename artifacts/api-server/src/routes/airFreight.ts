import { Router, type Request, type Response } from "express";
import { eq, desc, and, sql, inArray, or, ilike } from "drizzle-orm";
import { randomBytes } from "crypto";
import { db } from "@workspace/db";
import {
  airFreightOrdersTable,
  airFreightDimensionsTable,
  airFreightRfqsTable,
  airFreightRateSubmissionsTable,
  suppliersTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { notifyCustomerPortal } from "../lib/customerPortalNotificationService.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { sendMail, isSmtpConfigured } from "../lib/mailer.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { filterSuppliersByCapability, VENDOR_CAPABILITY_KEYS } from "../lib/vendorCapabilityService.js";

// ─── Tables dikelola oleh Drizzle schema (lib/db/src/schema/airFreight.ts) ────
// CREATE TABLE dihapus dari sini — gunakan drizzle-kit push untuk migrasi.

// ─── Helpers ───────────────────────────────────────────────────────────────────
function genOrderNumber(): string {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `AIR-${y}${m}${day}-${rand}`;
}

function genRfqNumber(): string {
  const d = new Date();
  const y = d.getFullYear().toString().slice(-2);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `AIRFQ-${y}${m}${day}-${rand}`;
}

function genToken(): string {
  return randomBytes(32).toString("hex"); // P0.2 — 256-bit
}

function calcTotal(o: {
  ratePerKg?: string | null;
  chargeableWeight?: string | null;
  fuelSurcharge?: string | null;
  securitySurcharge?: string | null;
  awbFee?: string | null;
  handlingFee?: string | null;
  xrayFee?: string | null;
  docFee?: string | null;
  customsClearanceFee?: string | null;
  pickupTrucking?: string | null;
  deliveryTrucking?: string | null;
  cargoSurcharge?: string | null;
  markupAmount?: string | null;
  ppnPct?: string | null;
}) {
  const n = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;
  const freight = n(o.ratePerKg) * n(o.chargeableWeight);
  const surcharges = n(o.fuelSurcharge) + n(o.securitySurcharge) + n(o.cargoSurcharge);
  const fees = n(o.awbFee) + n(o.handlingFee) + n(o.xrayFee) + n(o.docFee)
    + n(o.customsClearanceFee) + n(o.pickupTrucking) + n(o.deliveryTrucking);
  const markup = n(o.markupAmount);
  const sub = freight + surcharges + fees + markup;
  const ppn = sub * (n(o.ppnPct) / 100);
  return { subtotal: sub, ppnAmount: ppn, grandTotal: sub + ppn };
}

// ─── Router ────────────────────────────────────────────────────────────────────
export const airFreightRouter = Router();

// ensure express 5 router works
airFreightRouter.use((_req, _res, next) => next());

// ── List orders ─────────────────────────────────────────────────────────────
airFreightRouter.get("/orders", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const page = Math.max(1, parseInt(String(req.query.page ?? "1")));
  const limit = Math.min(100, parseInt(String(req.query.limit ?? "20")));
  const offset = (page - 1) * limit;
  const status = String(req.query.status ?? "");
  const search = String(req.query.search ?? "").trim();

  const conds: any[] = [];
  if (status) conds.push(eq(airFreightOrdersTable.status, status));
  if (search) {
    conds.push(
      or(
        ilike(airFreightOrdersTable.orderNumber, `%${search}%`),
        ilike(airFreightOrdersTable.customerName, `%${search}%`),
        ilike(airFreightOrdersTable.originAirport, `%${search}%`),
        ilike(airFreightOrdersTable.destAirport, `%${search}%`),
      )
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const [rows, [{ cnt }]] = await Promise.all([
    db.select({
      id: airFreightOrdersTable.id,
      orderNumber: airFreightOrdersTable.orderNumber,
      customerName: airFreightOrdersTable.customerName,
      customerCompany: airFreightOrdersTable.customerCompany,
      originAirport: airFreightOrdersTable.originAirport,
      destAirport: airFreightOrdersTable.destAirport,
      cargoType: airFreightOrdersTable.cargoType,
      chargeableWeight: airFreightOrdersTable.chargeableWeight,
      estimatedPrice: airFreightOrdersTable.estimatedPrice,
      grandTotal: airFreightOrdersTable.grandTotal,
      status: airFreightOrdersTable.status,
      createdAt: airFreightOrdersTable.createdAt,
    })
      .from(airFreightOrdersTable)
      .where(where)
      .orderBy(desc(airFreightOrdersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ cnt: sql<number>`count(*)::int` }).from(airFreightOrdersTable).where(where),
  ]);

  res.json({ orders: rows, total: cnt, page, limit });
});

// ── Create order ─────────────────────────────────────────────────────────────
airFreightRouter.post("/orders", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const {
    customerName, customerEmail, customerPhone, customerCompany,
    originAirport, destAirport, tradeType, cargoType, commodity,
    pieces, packingType, grossWeight, volumetricWeight, chargeableWeight,
    volumeCbm, incoterm, etdRequested, additionalServices, specialInstructions,
    notes, estimatedPrice, dimensions = [],
    companyId,
  } = req.body;

  if (!customerName || !originAirport || !destAirport) {
    return res.status(400).json({ error: "customerName, originAirport, destAirport wajib diisi" });
  }

  const orderNumber = genOrderNumber();

  const [order] = await db.insert(airFreightOrdersTable).values({
    orderNumber,
    companyId: companyId ?? null,
    customerName: String(customerName),
    customerEmail: customerEmail ? String(customerEmail) : null,
    customerPhone: customerPhone ? String(customerPhone) : null,
    customerCompany: customerCompany ? String(customerCompany) : null,
    originAirport: String(originAirport),
    destAirport: String(destAirport),
    tradeType: tradeType ?? "export",
    cargoType: cargoType ?? "general",
    commodity: commodity ?? null,
    pieces: pieces ? parseInt(pieces) : null,
    packingType: packingType ?? null,
    grossWeight: grossWeight ? String(grossWeight) : null,
    volumetricWeight: volumetricWeight ? String(volumetricWeight) : null,
    chargeableWeight: chargeableWeight ? String(chargeableWeight) : null,
    volumeCbm: volumeCbm ? String(volumeCbm) : null,
    incoterm: incoterm ?? null,
    etdRequested: etdRequested ?? null,
    additionalServices: Array.isArray(additionalServices) ? additionalServices : [],
    specialInstructions: specialInstructions ?? null,
    notes: notes ?? null,
    estimatedPrice: estimatedPrice ? String(estimatedPrice) : null,
    status: "inquiry",
  }).returning();

  if (Array.isArray(dimensions) && dimensions.length > 0) {
    const dimRows = dimensions.map((d: any) => ({
      orderId: order.id,
      length: d.length ? String(d.length) : null,
      width: d.width ? String(d.width) : null,
      height: d.height ? String(d.height) : null,
      pieces: d.pieces ? parseInt(d.pieces) : 1,
      grossWeight: d.grossWeight ? String(d.grossWeight) : null,
      volumetricWeight: d.volumetricWeight ? String(d.volumetricWeight) : null,
    }));
    await db.insert(airFreightDimensionsTable).values(dimRows);
  }

  res.status(201).json({ order });
});

// ── Get order detail ──────────────────────────────────────────────────────────
airFreightRouter.get("/orders/:id", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [order] = await db.select().from(airFreightOrdersTable)
    .where(eq(airFreightOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  const [dimensions, rfqs] = await Promise.all([
    db.select().from(airFreightDimensionsTable)
      .where(eq(airFreightDimensionsTable.orderId, id)),
    db.select().from(airFreightRfqsTable)
      .where(eq(airFreightRfqsTable.orderId, id))
      .orderBy(desc(airFreightRfqsTable.createdAt)),
  ]);

  let submissions: any[] = [];
  if (rfqs.length > 0) {
    const rfqIds = rfqs.map((r) => r.id);
    const rawSubs = await db.select({
      sub: airFreightRateSubmissionsTable,
      vendorName: suppliersTable.name,
    })
      .from(airFreightRateSubmissionsTable)
      .leftJoin(suppliersTable, eq(airFreightRateSubmissionsTable.vendorId, suppliersTable.id))
      .where(inArray(airFreightRateSubmissionsTable.rfqId, rfqIds))
      .orderBy(desc(airFreightRateSubmissionsTable.createdAt));
    submissions = rawSubs.map((r) => ({
      ...r.sub,
      vendorDisplayName: r.vendorName ?? r.sub.vendorName,
    }));
  }

  let approvedVendorName: string | null = null;
  if (order.approvedVendorId) {
    const [v] = await db.select({ name: suppliersTable.name }).from(suppliersTable)
      .where(eq(suppliersTable.id, order.approvedVendorId));
    approvedVendorName = v?.name ?? null;
  }

  res.json({ order, dimensions, rfqs, submissions, approvedVendorName });
});

// ── Update order ──────────────────────────────────────────────────────────────
airFreightRouter.put("/orders/:id", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [orderCheck] = await db.select({ companyId: airFreightOrdersTable.companyId })
    .from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!orderCheck) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(orderCheck.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const {
    customerName, customerEmail, customerPhone, customerCompany,
    originAirport, destAirport, tradeType, cargoType, commodity,
    pieces, packingType, grossWeight, volumetricWeight, chargeableWeight,
    volumeCbm, incoterm, etdRequested, additionalServices, specialInstructions,
    notes, estimatedPrice, dimensions,
  } = req.body;

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (customerName != null) updates.customerName = String(customerName);
  if (customerEmail != null) updates.customerEmail = customerEmail || null;
  if (customerPhone != null) updates.customerPhone = customerPhone || null;
  if (customerCompany != null) updates.customerCompany = customerCompany || null;
  if (originAirport != null) updates.originAirport = String(originAirport);
  if (destAirport != null) updates.destAirport = String(destAirport);
  if (tradeType != null) updates.tradeType = tradeType;
  if (cargoType != null) updates.cargoType = cargoType;
  if (commodity != null) updates.commodity = commodity;
  if (pieces != null) updates.pieces = parseInt(pieces);
  if (packingType != null) updates.packingType = packingType;
  if (grossWeight != null) updates.grossWeight = grossWeight ? String(grossWeight) : null;
  if (volumetricWeight != null) updates.volumetricWeight = volumetricWeight ? String(volumetricWeight) : null;
  if (chargeableWeight != null) updates.chargeableWeight = chargeableWeight ? String(chargeableWeight) : null;
  if (volumeCbm != null) updates.volumeCbm = volumeCbm ? String(volumeCbm) : null;
  if (incoterm != null) updates.incoterm = incoterm;
  if (etdRequested != null) updates.etdRequested = etdRequested;
  if (additionalServices != null) updates.additionalServices = Array.isArray(additionalServices) ? additionalServices : [];
  if (specialInstructions != null) updates.specialInstructions = specialInstructions;
  if (notes != null) updates.notes = notes;
  if (estimatedPrice != null) updates.estimatedPrice = estimatedPrice ? String(estimatedPrice) : null;

  const [updated] = await db.update(airFreightOrdersTable)
    .set(updates)
    .where(eq(airFreightOrdersTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Order tidak ditemukan" });

  if (Array.isArray(dimensions)) {
    await db.delete(airFreightDimensionsTable).where(eq(airFreightDimensionsTable.orderId, id));
    if (dimensions.length > 0) {
      await db.insert(airFreightDimensionsTable).values(
        dimensions.map((d: any) => ({
          orderId: id,
          length: d.length ? String(d.length) : null,
          width: d.width ? String(d.width) : null,
          height: d.height ? String(d.height) : null,
          pieces: d.pieces ? parseInt(d.pieces) : 1,
          grossWeight: d.grossWeight ? String(d.grossWeight) : null,
          volumetricWeight: d.volumetricWeight ? String(d.volumetricWeight) : null,
        }))
      );
    }
  }

  res.json({ order: updated });
});

// ── Get eligible vendors for blast ───────────────────────────────────────────
airFreightRouter.get("/orders/:id/eligible-vendors", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [order] = await db.select({
    companyId: airFreightOrdersTable.companyId,
    originAirport: airFreightOrdersTable.originAirport,
    destAirport: airFreightOrdersTable.destAirport,
    tradeType: airFreightOrdersTable.tradeType,
    cargoType: airFreightOrdersTable.cargoType,
  }).from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

  const allVendors = await db.select({
    id: suppliersTable.id,
    name: suppliersTable.name,
    serviceType: suppliersTable.serviceType,
    phone: suppliersTable.phone,
    email: suppliersTable.contactEmail,
    isActive: suppliersTable.isActive,
  }).from(suppliersTable).where(eq(suppliersTable.isActive, true));

  const eligible = await filterSuppliersByCapability(
    allVendors,
    VENDOR_CAPABILITY_KEYS.AIR_FREIGHT,
    (st) => st.includes("air") || st.includes("udara"),
    order.companyId,
  );

  res.json({ vendors: eligible, order });
});

// ── Blast RFQ ────────────────────────────────────────────────────────────────
airFreightRouter.post("/orders/:id/blast-rfq", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const { vendorIds, responseHours = 48, notes: blastNotes } = req.body;
  if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
    return res.status(400).json({ error: "vendorIds diperlukan" });
  }

  const [order] = await db.select().from(airFreightOrdersTable)
    .where(eq(airFreightOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(order.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const vendors = await db.select({
    id: suppliersTable.id,
    name: suppliersTable.name,
    phone: suppliersTable.phone,
  }).from(suppliersTable).where(inArray(suppliersTable.id, vendorIds.map(Number)));

  const rfqNumber = genRfqNumber();
  const deadline = new Date(Date.now() + parseInt(String(responseHours)) * 3600 * 1000);

  const [rfq] = await db.insert(airFreightRfqsTable).values({
    orderId: id,
    rfqNumber,
    blastVendorIds: vendorIds.map(Number),
    blastCount: vendors.length,
    responseDeadline: deadline,
    status: "open",
    blastNotes: blastNotes ?? null,
    blastAt: new Date(),
  }).returning();

  // Create submission tokens for each vendor
  const submissionInserts = vendors.map((v) => ({
    rfqId: rfq.id,
    orderId: id,
    vendorId: v.id,
    vendorName: v.name,
    token: genToken(),
    status: "pending" as const,
  }));
  const submissions = await db.insert(airFreightRateSubmissionsTable)
    .values(submissionInserts).returning();

  // Update order status
  await db.update(airFreightOrdersTable)
    .set({ status: "rfq_blasted", updatedAt: new Date() })
    .where(eq(airFreightOrdersTable.id, id));

  // Send WA to vendors
  const baseUrl = process.env.REPLIT_DEV_DOMAIN
    ? `https://${process.env.REPLIT_DEV_DOMAIN}`
    : "https://localhost:5000";

  for (const v of vendors) {
    if (!v.phone) continue;
    const sub = submissions.find((s) => s.vendorId === v.id);
    if (!sub) continue;
    const formUrl = `${baseUrl}/air-freight-form/${sub.token}`;
    const msg = [
      `*📋 RFQ Air Freight — ${rfqNumber}*`,
      ``,
      `Kepada: *${v.name}*`,
      ``,
      `Kami mengundang Anda untuk mengajukan penawaran rate Air Freight:`,
      ``,
      `📦 Order  : ${order.orderNumber}`,
      `✈️ Rute   : ${order.originAirport} → ${order.destAirport}`,
      `🏷️ Kargo  : ${order.cargoType} / ${order.commodity ?? "-"}`,
      `⚖️ Chargeable: ${order.chargeableWeight ?? "-"} kg`,
      `📅 Deadline: ${deadline.toLocaleDateString("id-ID")}`,
      ``,
      `Isi form penawaran di sini:`,
      formUrl,
    ].join("\n");
    sendWhatsApp(v.phone, msg).catch(() => {});
  }

  // Notify admin group
  const adminWa = await getAdminGroupWa();
  if (adminWa) {
    const adminMsg = [
      `*📤 RFQ Air Freight Terkirim*`,
      ``,
      `No. RFQ : ${rfqNumber}`,
      `Order   : ${order.orderNumber}`,
      `Rute    : ${order.originAirport} → ${order.destAirport}`,
      `Vendor  : ${vendors.map((v) => v.name).join(", ")}`,
      `Deadline: ${deadline.toLocaleDateString("id-ID")}`,
    ].join("\n");
    sendWhatsApp(adminWa, adminMsg).catch(() => {});
  }

  res.json({ rfq, submissions: submissions.length, vendorCount: vendors.length });
});

// ── Input manual final rate ───────────────────────────────────────────────────
airFreightRouter.post("/orders/:id/manual-rate", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const {
    airline, flightNumber, etd, eta, transitDays,
    finalRatePerKg, fuelSurcharge, securitySurcharge,
    awbFee, handlingFee, xrayFee, docFee, customsClearanceFee,
    pickupTrucking, deliveryTrucking, cargoSurcharge,
    markupAmount, ppnPct,
  } = req.body;

  const [existing] = await db.select({
    chargeableWeight: airFreightOrdersTable.chargeableWeight,
    companyId: airFreightOrdersTable.companyId,
  }).from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!existing) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const n = (v: any) => v != null ? String(v) : null;
  const totals = calcTotal({
    ratePerKg: finalRatePerKg,
    chargeableWeight: existing.chargeableWeight,
    fuelSurcharge, securitySurcharge, awbFee, handlingFee,
    xrayFee, docFee, customsClearanceFee, pickupTrucking,
    deliveryTrucking, cargoSurcharge, markupAmount,
    ppnPct: ppnPct ?? "11",
  });

  const [updated] = await db.update(airFreightOrdersTable).set({
    airline: airline ?? null,
    flightNumber: flightNumber ?? null,
    etd: etd ?? null,
    eta: eta ?? null,
    transitDays: transitDays ? parseInt(transitDays) : null,
    finalRatePerKg: n(finalRatePerKg),
    fuelSurcharge: n(fuelSurcharge),
    securitySurcharge: n(securitySurcharge),
    awbFee: n(awbFee),
    handlingFee: n(handlingFee),
    xrayFee: n(xrayFee),
    docFee: n(docFee),
    customsClearanceFee: n(customsClearanceFee),
    pickupTrucking: n(pickupTrucking),
    deliveryTrucking: n(deliveryTrucking),
    cargoSurcharge: n(cargoSurcharge),
    markupAmount: n(markupAmount),
    ppnPct: ppnPct ? String(ppnPct) : "11",
    ppnAmount: String(totals.ppnAmount),
    subtotal: String(totals.subtotal),
    grandTotal: String(totals.grandTotal),
    status: "quote_ready",
    updatedAt: new Date(),
  }).where(eq(airFreightOrdersTable.id, id)).returning();

  res.json({ order: updated });
});

// ── Select RFQ submission (use vendor rate) ───────────────────────────────────
airFreightRouter.post("/orders/:id/select-submission/:submissionId", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const orderId = parseInt(String(req.params.id));
  const submissionId = parseInt(String(req.params.submissionId));
  if (isNaN(orderId) || isNaN(submissionId)) return res.status(400).json({ error: "Invalid id" });

  const [sub] = await db.select().from(airFreightRateSubmissionsTable)
    .where(and(
      eq(airFreightRateSubmissionsTable.id, submissionId),
      eq(airFreightRateSubmissionsTable.orderId, orderId),
    ));
  if (!sub) return res.status(404).json({ error: "Submission tidak ditemukan" });

  const [existing] = await db.select({
    chargeableWeight: airFreightOrdersTable.chargeableWeight,
    companyId: airFreightOrdersTable.companyId,
  }).from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, orderId));
  if (!existing) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(existing.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: orderId })) return;

  const { markupAmount, ppnPct } = req.body;
  const n = (v: any) => v != null ? String(v) : null;

  const totals = calcTotal({
    ratePerKg: sub.ratePerKg,
    chargeableWeight: existing.chargeableWeight,
    fuelSurcharge: sub.fuelSurcharge,
    securitySurcharge: sub.securitySurcharge,
    awbFee: sub.awbFee,
    handlingFee: sub.handlingFee,
    xrayFee: sub.xrayFee,
    docFee: sub.docFee,
    customsClearanceFee: sub.customsClearanceFee,
    pickupTrucking: sub.pickupTrucking,
    deliveryTrucking: sub.deliveryTrucking,
    cargoSurcharge: sub.cargoSurcharge,
    markupAmount: markupAmount ?? "0",
    ppnPct: ppnPct ?? "11",
  });

  // Mark other subs as rejected
  await db.update(airFreightRateSubmissionsTable)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(
      eq(airFreightRateSubmissionsTable.orderId, orderId),
      sql`id != ${submissionId}`,
    ));
  await db.update(airFreightRateSubmissionsTable)
    .set({ status: "selected", updatedAt: new Date() })
    .where(eq(airFreightRateSubmissionsTable.id, submissionId));

  const [updated] = await db.update(airFreightOrdersTable).set({
    selectedRfqSubmissionId: submissionId,
    approvedVendorId: sub.vendorId,
    airline: sub.airline,
    flightNumber: sub.flightNumber,
    etd: sub.etd,
    eta: sub.eta,
    transitDays: sub.transitDays,
    finalRatePerKg: sub.ratePerKg,
    fuelSurcharge: sub.fuelSurcharge,
    securitySurcharge: sub.securitySurcharge,
    awbFee: sub.awbFee,
    handlingFee: sub.handlingFee,
    xrayFee: sub.xrayFee,
    docFee: sub.docFee,
    customsClearanceFee: sub.customsClearanceFee,
    pickupTrucking: sub.pickupTrucking,
    deliveryTrucking: sub.deliveryTrucking,
    cargoSurcharge: sub.cargoSurcharge,
    markupAmount: markupAmount ? String(markupAmount) : null,
    ppnPct: ppnPct ? String(ppnPct) : "11",
    ppnAmount: String(totals.ppnAmount),
    subtotal: String(totals.subtotal),
    grandTotal: String(totals.grandTotal),
    status: "quote_ready",
    updatedAt: new Date(),
  }).where(eq(airFreightOrdersTable.id, orderId)).returning();

  res.json({ order: updated });
});

// ── Send quote to customer ────────────────────────────────────────────────────
airFreightRouter.post("/orders/:id/send-quote", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [order] = await db.select().from(airFreightOrdersTable)
    .where(eq(airFreightOrdersTable.id, id));
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(order.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const token = order.quoteToken ?? genToken();
  const [updated] = await db.update(airFreightOrdersTable).set({
    status: "quote_sent",
    quoteToken: token,
    quoteSentAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(airFreightOrdersTable.id, id)).returning();

  if (order.customerPhone) {
    const baseUrl = process.env.REPLIT_DEV_DOMAIN
      ? `https://${process.env.REPLIT_DEV_DOMAIN}`
      : "https://localhost:5000";
    const n = (v: string | null | undefined) => parseFloat(v ?? "0") || 0;
    const msg = [
      `*✈️ Penawaran Harga Air Freight*`,
      ``,
      `Kepada: *${order.customerName}*`,
      ``,
      `No. Order  : ${order.orderNumber}`,
      `Rute       : ${order.originAirport} → ${order.destAirport}`,
      `Airline    : ${order.airline ?? "-"}`,
      `ETD        : ${order.etd ?? "-"}`,
      `ETA        : ${order.eta ?? "-"}`,
      ``,
      `*Estimasi Biaya:*`,
      `Rate/kg    : Rp ${n(order.finalRatePerKg).toLocaleString("id-ID")}`,
      `Chargeable : ${n(order.chargeableWeight)} kg`,
      `Subtotal   : Rp ${n(order.subtotal).toLocaleString("id-ID")}`,
      `PPN        : Rp ${n(order.ppnAmount).toLocaleString("id-ID")}`,
      `*Total     : Rp ${n(order.grandTotal).toLocaleString("id-ID")}*`,
      ``,
      `Info lebih lanjut, hubungi kami.`,
    ].join("\n");
    sendWhatsApp(order.customerPhone, msg).catch(() => {});
  }

  res.json({ order: updated, quoteToken: token });
});

// ── Confirm booking ───────────────────────────────────────────────────────────
airFreightRouter.post("/orders/:id/confirm-booking", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [orderCheck] = await db.select({ companyId: airFreightOrdersTable.companyId })
    .from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!orderCheck) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(orderCheck.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const { awbNumber } = req.body;

  const [updated] = await db.update(airFreightOrdersTable).set({
    status: "booking_confirmed",
    bookingConfirmedAt: new Date(),
    awbNumber: awbNumber ? String(awbNumber) : null,
    updatedAt: new Date(),
  }).where(eq(airFreightOrdersTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Order tidak ditemukan" });

  if (updated.customerPhone) {
    const msg = [
      `*✅ Booking Dikonfirmasi*`,
      ``,
      `Order: ${updated.orderNumber}`,
      `AWB  : ${awbNumber ?? "-"}`,
      `Rute : ${updated.originAirport} → ${updated.destAirport}`,
      `ETD  : ${updated.etd ?? "-"}`,
      ``,
      `Terima kasih atas kepercayaan Anda.`,
    ].join("\n");
    sendWhatsApp(updated.customerPhone, msg).catch(() => {});
  }

  res.json({ order: updated });
});

// ── Update tracking ───────────────────────────────────────────────────────────
airFreightRouter.put("/orders/:id/tracking", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [orderCheck] = await db.select({ companyId: airFreightOrdersTable.companyId })
    .from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!orderCheck) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(orderCheck.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const { status, awbNumber, airline, flightNumber, etd, eta, trackingNotes } = req.body;

  const validStatuses = [
    "inquiry", "rfq_blasted", "rate_received", "quote_ready", "quote_sent",
    "booking_confirmed", "in_transit", "arrived", "completed", "cancelled",
  ];
  if (status && !validStatuses.includes(status)) {
    return res.status(400).json({ error: "Status tidak valid" });
  }

  const updates: Record<string, any> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (awbNumber != null) updates.awbNumber = awbNumber || null;
  if (airline != null) updates.airline = airline || null;
  if (flightNumber != null) updates.flightNumber = flightNumber || null;
  if (etd != null) updates.etd = etd || null;
  if (eta != null) updates.eta = eta || null;
  if (trackingNotes != null) updates.trackingNotes = trackingNotes || null;

  const [updated] = await db.update(airFreightOrdersTable)
    .set(updates)
    .where(eq(airFreightOrdersTable.id, id))
    .returning();
  if (!updated) return res.status(404).json({ error: "Order tidak ditemukan" });

  res.json({ order: updated });
});

// ── Get submissions for comparison (by order) ─────────────────────────────────
airFreightRouter.get("/orders/:id/submissions", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const rows = await db.select({
    sub: airFreightRateSubmissionsTable,
    vendorNameDb: suppliersTable.name,
  })
    .from(airFreightRateSubmissionsTable)
    .leftJoin(suppliersTable, eq(airFreightRateSubmissionsTable.vendorId, suppliersTable.id))
    .where(eq(airFreightRateSubmissionsTable.orderId, id))
    .orderBy(airFreightRateSubmissionsTable.totalIDR);

  res.json({
    submissions: rows.map((r) => ({
      ...r.sub,
      vendorDisplayName: r.vendorNameDb ?? r.sub.vendorName,
    })),
  });
});

// ── Upload admin quote attachment ─────────────────────────────────────────────
airFreightRouter.post("/orders/:id/upload-quote", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [orderCheck] = await db.select({ companyId: airFreightOrdersTable.companyId })
    .from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!orderCheck) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(orderCheck.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  const { attachmentUrl } = req.body;
  if (!attachmentUrl) return res.status(400).json({ error: "attachmentUrl required" });

  const [updated] = await db.update(airFreightOrdersTable).set({
    adminQuoteAttachmentUrl: String(attachmentUrl),
    updatedAt: new Date(),
  }).where(eq(airFreightOrdersTable.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "Order tidak ditemukan" });

  res.json({ order: updated });
});

// ── Delete order ──────────────────────────────────────────────────────────────
airFreightRouter.delete("/orders/:id", async (req: Request, res: Response) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "Invalid id" });

  const [orderCheck] = await db.select({ companyId: airFreightOrdersTable.companyId })
    .from(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  if (!orderCheck) return res.status(404).json({ error: "Order tidak ditemukan" });
  const resolvedCompanyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(orderCheck.companyId, resolvedCompanyId, req, res,
    { resourceType: "air_freight_order", resourceId: id })) return;

  await db.delete(airFreightOrdersTable).where(eq(airFreightOrdersTable.id, id));
  res.json({ ok: true });
});

const router = Router();

async function assertAirFreightOrderCompanyAccess(
  req: Request,
  res: Response,
  resourceCompanyId: number | null | undefined,
  resourceId: number,
): Promise<boolean> {
  if (resourceCompanyId == null) return true;
  const companyId = resolveCompanyId(req);
  return assertCompanyAccess(resourceCompanyId, companyId, req, res, {
    resourceType: "air_freight_order",
    resourceId,
  });
}

// ── air_freight_orders dikelola Drizzle schema — CREATE TABLE dihapus ────────

// ── ALTER TABLE — new columns (FASE 10) ──────────────────────────────────────
const _fase10Alters = [
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS approval_token TEXT UNIQUE",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS booking_number TEXT",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS mawb TEXT",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS hawb TEXT",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS booking_confirmed_at TIMESTAMPTZ",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS declined_at TIMESTAMPTZ",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS decline_reason TEXT",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS tracking_status TEXT DEFAULT 'booked'",
  "ALTER TABLE air_freight_orders ADD COLUMN IF NOT EXISTS booking_attachment_url TEXT",
];
for (const s of _fase10Alters) { db.execute(sql.raw(s)).catch(() => {}); }

db.execute(sql`
  CREATE TABLE IF NOT EXISTS air_freight_tracking_events (
    id          SERIAL PRIMARY KEY,
    order_id    INTEGER NOT NULL,
    event_type  TEXT NOT NULL,
    note        TEXT,
    created_by  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(() => {});

// ── helpers ───────────────────────────────────────────────────────────────────
async function nextOrderNumber(companyId: number | null): Promise<string> {
  const year = new Date().getFullYear();
  const res = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM air_freight_orders
    WHERE EXTRACT(YEAR FROM created_at) = ${year}
      AND (${companyId}::int IS NULL OR company_id = ${companyId})
  `);
  const seq = Number((res.rows[0] as any)?.cnt ?? 0) + 1;
  return `AFO/${year}/${String(seq).padStart(5, "0")}`;
}

// ── GET /orders ───────────────────────────────────────────────────────────────
router.get("/orders", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const cId    = req.query.companyId   ? Number(req.query.companyId) : null;
    const status = (req.query.status  as string) || null;
    const source = (req.query.source  as string) || null;
    const search = (req.query.search  as string) || null;
    const originAirport = (req.query.origin_airport as string) || null;
    const destAirport   = (req.query.destination_airport as string) || null;
    const page   = Math.max(1, Number(req.query.page  ?? 1));
    const limit  = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset = (page - 1) * limit;

    const [dataRes, countRes] = await Promise.all([
      db.execute(sql`
        SELECT * FROM air_freight_orders
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
          AND (${status}::text IS NULL OR status = ${status})
          AND (${source}::text IS NULL OR source = ${source})
          AND (${originAirport}::text IS NULL OR origin_airport = ${originAirport})
          AND (${destAirport}::text IS NULL OR destination_airport = ${destAirport})
          AND (${search}::text IS NULL OR
               order_number ILIKE ${'%' + (search ?? '') + '%'} OR
               customer_name ILIKE ${'%' + (search ?? '') + '%'} OR
               customer_email ILIKE ${'%' + (search ?? '') + '%'} OR
               commodity ILIKE ${'%' + (search ?? '') + '%'})
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS cnt FROM air_freight_orders
        WHERE (${cId}::int IS NULL OR company_id = ${cId})
          AND (${status}::text IS NULL OR status = ${status})
          AND (${source}::text IS NULL OR source = ${source})
          AND (${originAirport}::text IS NULL OR origin_airport = ${originAirport})
          AND (${destAirport}::text IS NULL OR destination_airport = ${destAirport})
          AND (${search}::text IS NULL OR
               order_number ILIKE ${'%' + (search ?? '') + '%'} OR
               customer_name ILIKE ${'%' + (search ?? '') + '%'} OR
               customer_email ILIKE ${'%' + (search ?? '') + '%'} OR
               commodity ILIKE ${'%' + (search ?? '') + '%'})
      `),
    ]);

    res.json({
      data: dataRes.rows,
      total: Number((countRes.rows[0] as any)?.cnt ?? 0),
      page,
      limit,
    });
  } catch (err) {
    console.error("[air-freight] GET /orders error:", err);
    res.status(500).json({ error: "Gagal memuat orders" });
  }
});

// ── Get eligible vendors for the active Air Freight router ───────────────────
// Keep this route on the default router: it is the router mounted by
// routes/index.ts. The legacy airFreightRouter above is intentionally not
// mounted, but the BizPortal detail page still calls this endpoint.
router.get("/orders/:id/eligible-vendors", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    if (!Number.isSafeInteger(id) || id <= 0) {
      return res.status(400).json({ error: "Invalid id" });
    }

    const orderResult = await db.execute(sql`
      SELECT company_id, origin_airport, destination_airport, trade_type, cargo_type
      FROM air_freight_orders
      WHERE id = ${id}
      LIMIT 1
    `);
    const order = orderResult.rows[0] as {
      company_id: number | null;
      origin_airport: string | null;
      destination_airport: string | null;
      trade_type: string | null;
      cargo_type: string | null;
    } | undefined;
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });

    const allVendors = await db.select({
      id: suppliersTable.id,
      name: suppliersTable.name,
      serviceType: suppliersTable.serviceType,
      phone: suppliersTable.phone,
      email: suppliersTable.contactEmail,
      isActive: suppliersTable.isActive,
    }).from(suppliersTable).where(eq(suppliersTable.isActive, true));

    const eligible = await filterSuppliersByCapability(
      allVendors,
      VENDOR_CAPABILITY_KEYS.AIR_FREIGHT,
      (serviceType) => {
        const normalized = serviceType.toLowerCase();
        return normalized.includes("air") || normalized.includes("udara");
      },
      order.company_id == null ? null : Number(order.company_id),
    );

    return res.json({
      vendors: eligible,
      order: {
        companyId: order.company_id,
        originAirport: order.origin_airport,
        destAirport: order.destination_airport,
        tradeType: order.trade_type,
        cargoType: order.cargo_type,
      },
    });
  } catch (err) {
    console.error("[air-freight] GET /orders/:id/eligible-vendors error:", err);
    return res.status(500).json({ error: "Gagal memuat vendor eligible" });
  }
});

// ── POST /orders ──────────────────────────────────────────────────────────────
router.post("/orders", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const body = req.body;
    const companyId: number | null = body.company_id ? Number(body.company_id) : null;
    const createdBy = (req.user as { id: string } | undefined)?.id ?? null;
    const orderNumber = await nextOrderNumber(companyId);

    const r = await db.execute(sql`
      INSERT INTO air_freight_orders (
        order_number, customer_id, customer_name, customer_phone, customer_email,
        origin_city, origin_airport, destination_city, destination_airport,
        trade_type, service_mode, service_level, incoterm,
        commodity, hs_code, cargo_type,
        gross_weight, total_volumetric_weight, chargeable_weight, koli,
        dimension_rows, pickup_date, ready_cargo_date, preferred_flight_date, target_arrival_date,
        selected_additional_services, selected_estimate_option,
        estimated_price, estimated_price_idr, currency, pricing_breakdown,
        selected_rate_id, candidate_rate_ids,
        admin_notes, price_status, status, source, company_id, created_by
      ) VALUES (
        ${orderNumber},
        ${body.customer_id ?? null},
        ${body.customer_name ?? ''},
        ${body.customer_phone ?? ''},
        ${body.customer_email ?? ''},
        ${body.origin_city ?? ''},
        ${body.origin_airport ?? ''},
        ${body.destination_city ?? ''},
        ${body.destination_airport ?? ''},
        ${body.trade_type ?? 'export'},
        ${body.service_mode ?? 'door_to_door'},
        ${body.service_level ?? 'standard'},
        ${body.incoterm ?? 'EXW'},
        ${body.commodity ?? ''},
        ${body.hs_code ?? null},
        ${body.cargo_type ?? 'general'},
        ${body.gross_weight ?? 0},
        ${body.total_volumetric_weight ?? 0},
        ${body.chargeable_weight ?? 0},
        ${body.koli ?? 0},
        ${JSON.stringify(body.dimension_rows ?? [])}::jsonb,
        ${body.pickup_date ?? null},
        ${body.ready_cargo_date ?? null},
        ${body.preferred_flight_date ?? null},
        ${body.target_arrival_date ?? null},
        ${JSON.stringify(body.selected_additional_services ?? [])}::jsonb,
        ${body.selected_estimate_option ?? null},
        ${body.estimated_price ?? null},
        ${body.estimated_price_idr ?? null},
        ${body.currency ?? 'IDR'},
        ${JSON.stringify(body.pricing_breakdown ?? {})}::jsonb,
        ${body.selected_rate_id ?? null},
        ${JSON.stringify(body.candidate_rate_ids ?? [])}::jsonb,
        ${body.admin_notes ?? null},
        ${body.price_status ?? 'estimate'},
        ${body.status ?? 'draft'},
        ${body.source ?? 'admin_portal'},
        ${companyId},
        ${createdBy}
      ) RETURNING *
    `);
    res.status(201).json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight] POST /orders error:", err);
    res.status(500).json({ error: "Gagal membuat order" });
  }
});

// ── GET /orders/:id ───────────────────────────────────────────────────────────
router.get("/orders/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const r = await db.execute(sql`SELECT * FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!r.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (r.rows[0] as any).company_id, id)) return;
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight] GET /orders/:id error:", err);
    res.status(500).json({ error: "Gagal" });
  }
});

// ── PUT /orders/:id ───────────────────────────────────────────────────────────
router.put("/orders/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id   = Number(String(req.params.id));
    const body = req.body;

    const existing = await db.execute(sql`SELECT id, company_id FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!existing.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (existing.rows[0] as any).company_id, id)) return;

    const r = await db.execute(sql`
      UPDATE air_freight_orders SET
        customer_id                 = COALESCE(${body.customer_id ?? null}::int, customer_id),
        customer_name               = COALESCE(${body.customer_name ?? null}, customer_name),
        customer_phone              = COALESCE(${body.customer_phone ?? null}, customer_phone),
        customer_email              = COALESCE(${body.customer_email ?? null}, customer_email),
        origin_city                 = COALESCE(${body.origin_city ?? null}, origin_city),
        origin_airport              = COALESCE(${body.origin_airport ?? null}, origin_airport),
        destination_city            = COALESCE(${body.destination_city ?? null}, destination_city),
        destination_airport         = COALESCE(${body.destination_airport ?? null}, destination_airport),
        trade_type                  = COALESCE(${body.trade_type ?? null}, trade_type),
        service_mode                = COALESCE(${body.service_mode ?? null}, service_mode),
        service_level               = COALESCE(${body.service_level ?? null}, service_level),
        incoterm                    = COALESCE(${body.incoterm ?? null}, incoterm),
        commodity                   = COALESCE(${body.commodity ?? null}, commodity),
        hs_code                     = COALESCE(${body.hs_code ?? null}, hs_code),
        cargo_type                  = COALESCE(${body.cargo_type ?? null}, cargo_type),
        gross_weight                = COALESCE(${body.gross_weight ?? null}::numeric, gross_weight),
        total_volumetric_weight     = COALESCE(${body.total_volumetric_weight ?? null}::numeric, total_volumetric_weight),
        chargeable_weight           = COALESCE(${body.chargeable_weight ?? null}::numeric, chargeable_weight),
        koli                        = COALESCE(${body.koli ?? null}::int, koli),
        dimension_rows              = COALESCE(${body.dimension_rows != null ? JSON.stringify(body.dimension_rows) : null}::jsonb, dimension_rows),
        pickup_date                 = COALESCE(${body.pickup_date ?? null}::date, pickup_date),
        ready_cargo_date            = COALESCE(${body.ready_cargo_date ?? null}::date, ready_cargo_date),
        preferred_flight_date       = COALESCE(${body.preferred_flight_date ?? null}::date, preferred_flight_date),
        target_arrival_date         = COALESCE(${body.target_arrival_date ?? null}::date, target_arrival_date),
        selected_additional_services = COALESCE(${body.selected_additional_services != null ? JSON.stringify(body.selected_additional_services) : null}::jsonb, selected_additional_services),
        selected_estimate_option    = COALESCE(${body.selected_estimate_option ?? null}, selected_estimate_option),
        estimated_price             = COALESCE(${body.estimated_price ?? null}::numeric, estimated_price),
        estimated_price_idr         = COALESCE(${body.estimated_price_idr ?? null}::numeric, estimated_price_idr),
        currency                    = COALESCE(${body.currency ?? null}, currency),
        pricing_breakdown           = COALESCE(${body.pricing_breakdown != null ? JSON.stringify(body.pricing_breakdown) : null}::jsonb, pricing_breakdown),
        selected_rate_id            = COALESCE(${body.selected_rate_id ?? null}::int, selected_rate_id),
        candidate_rate_ids          = COALESCE(${body.candidate_rate_ids != null ? JSON.stringify(body.candidate_rate_ids) : null}::jsonb, candidate_rate_ids),
        final_rate_id               = COALESCE(${body.final_rate_id ?? null}::int, final_rate_id),
        final_price                 = COALESCE(${body.final_price ?? null}::numeric, final_price),
        final_price_idr             = COALESCE(${body.final_price_idr ?? null}::numeric, final_price_idr),
        markup_amount               = COALESCE(${body.markup_amount ?? null}::numeric, markup_amount),
        ppn_amount                  = COALESCE(${body.ppn_amount ?? null}::numeric, ppn_amount),
        grand_total                 = COALESCE(${body.grand_total ?? null}::numeric, grand_total),
        final_breakdown             = COALESCE(${body.final_breakdown != null ? JSON.stringify(body.final_breakdown) : null}::jsonb, final_breakdown),
        admin_notes                 = COALESCE(${body.admin_notes ?? null}, admin_notes),
        price_status                = COALESCE(${body.price_status ?? null}, price_status),
        status                      = COALESCE(${body.status ?? null}, status),
        updated_at                  = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight] PUT /orders/:id error:", err);
    res.status(500).json({ error: "Gagal mengupdate order" });
  }
});

// ── POST /orders/:id/request-quote ── customer klik "Minta Penawaran Final" ──
router.post("/orders/:id/request-quote", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const existing = await db.execute(sql`
      SELECT id, status, company_id FROM air_freight_orders WHERE id = ${id} LIMIT 1
    `);
    if (!existing.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (existing.rows[0] as any).company_id, id)) return;

    const r = await db.execute(sql`
      UPDATE air_freight_orders
      SET status = 'waiting_rate', updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight] POST /orders/:id/request-quote error:", err);
    res.status(500).json({ error: "Gagal mengupdate status" });
  }
});

// ── PATCH /orders/:id/status ──────────────────────────────────────────────────
router.patch("/orders/:id/status", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id      = Number(String(req.params.id));
    const { status } = req.body;
    const VALID_STATUSES = [
      'draft','estimated','waiting_rate','rate_requested','rate_received',
      'quoted','approved','booked','departed','arrived','delivered',
      'completed','cancelled','quote_declined',
    ];
    if (!status || !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Status tidak valid. Pilih salah satu: ${VALID_STATUSES.join(', ')}` });
    }
    const existingAf = await db.execute(sql`
      SELECT company_id, COALESCE(portal_customer_id, customer_id) AS portal_customer_id, order_number
      FROM air_freight_orders WHERE id = ${id} LIMIT 1
    `);
    if (!existingAf.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (existingAf.rows[0] as any).company_id, id)) return;
    const r = await db.execute(sql`
      UPDATE air_freight_orders
      SET status = ${status}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    await notifyCustomerPortal({
      portalCustomerId: (existingAf.rows[0] as any).portal_customer_id,
      eventKey: `air-freight:${id}:status:${status}`,
      type: "air_freight_status_changed",
      title: "Status Air Freight diperbarui",
      message: `Order ${(existingAf.rows[0] as any).order_number} sekarang berstatus ${status}.`,
      payload: {
        service: "air-freight",
        orderId: id,
        orderNumber: (existingAf.rows[0] as any).order_number,
        status,
      },
    });
    res.json(r.rows[0]);
  } catch (err) {
    console.error("[air-freight] PATCH /orders/:id/status error:", err);
    res.status(500).json({ error: "Gagal mengubah status" });
  }
});

// ── DELETE /orders/:id ────────────────────────────────────────────────────────
router.delete("/orders/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const existingAfd = await db.execute(sql`SELECT company_id FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!existingAfd.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (existingAfd.rows[0] as any).company_id, id)) return;
    const r = await db.execute(sql`
      UPDATE air_freight_orders
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id}
      RETURNING id, order_number, status
    `);
    if (!r.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    res.json({ ok: true, ...r.rows[0] });
  } catch (err) {
    console.error("[air-freight] DELETE /orders/:id error:", err);
    res.status(500).json({ error: "Gagal membatalkan order" });
  }
});

// ── POST /orders/:id/send-final-quote ────────────────────────────────────────
router.post("/orders/:id/send-final-quote", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id   = Number(String(req.params.id));
    const body = req.body;
    const existing = await db.execute(sql`SELECT * FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!existing.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (existing.rows[0] as any).company_id, id)) return;

    const REQUIRED = ["final_price_idr","grand_total"];
    for (const f of REQUIRED) {
      if (body[f] == null || body[f] === "") return res.status(400).json({ error: `Field ${f} wajib diisi` });
    }

    // generate/reuse approval_token
    let token = (existing.rows[0] as any).approval_token as string | null;
    if (!token) {
      token = randomBytes(32).toString("hex"); // P0.2 — 256-bit
    }

    const r = await db.execute(sql`
      UPDATE air_freight_orders SET
        final_rate_id           = COALESCE(${body.final_rate_id ?? null}::int, final_rate_id),
        final_price             = ${body.final_price ?? null},
        final_price_idr         = ${body.final_price_idr},
        markup_amount           = ${body.markup_amount ?? null},
        ppn_amount              = ${body.ppn_amount ?? null},
        grand_total             = ${body.grand_total},
        final_breakdown         = COALESCE(${body.final_breakdown != null ? JSON.stringify(body.final_breakdown) : null}::jsonb, final_breakdown),
        admin_notes             = COALESCE(${body.admin_notes ?? null}, admin_notes),
        status                  = 'quoted',
        price_status            = 'confirmed',
        quoted_at               = NOW(),
        approval_token          = ${token},
        updated_at              = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    const updated = r.rows[0] as any;

    // build approval URL
    const domain = process.env.REPLIT_DEV_DOMAIN ?? "localhost:5000";
    const approvalUrl = `https://${domain}/air-freight/approval/${token}`;
    const trackUrl    = `https://${domain}/air-freight/track/${updated.order_number}`;

    const idr = (v: number) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(v);

    // ── WA notification to customer ──────────────────────────────────────────
    if (updated.customer_phone?.trim()) {
      const msg = [
        `✈️ *Air Freight Order ${updated.order_number}*`,
        ``,
        `Harga final untuk pengiriman udara Anda sudah tersedia.`,
        ``,
        `📦 *Rute:* ${updated.origin_airport} → ${updated.destination_airport}`,
        `💰 *Harga Final:* ${idr(Number(updated.grand_total))}`,
        ``,
        `Silakan review dan berikan persetujuan di link berikut:`,
        approvalUrl,
        ``,
        `Link Tracking: ${trackUrl}`,
      ].join("\n");
      sendWhatsApp(updated.customer_phone, msg, {
        context: "air_freight_quote_final",
        refType: "air_freight_order",
        refId: String(id),
      }).catch((e: unknown) => console.error("[air-freight] WA quote notification failed:", e));
    }

    // ── Email notification ───────────────────────────────────────────────────
    if (updated.customer_email?.trim() && isSmtpConfigured()) {
      sendMail({
        to: updated.customer_email,
        subject: `Harga Final Air Freight — Order ${updated.order_number}`,
        html: `
          <h2>Harga Final Air Freight Tersedia</h2>
          <p>Halo <b>${updated.customer_name || "Pelanggan"}</b>,</p>
          <p>Harga final untuk order air freight Anda (<b>${updated.order_number}</b>) sudah tersedia.</p>
          <table style="border-collapse:collapse;width:100%;max-width:500px">
            <tr><td style="padding:6px;border:1px solid #ddd;color:#666">Rute</td><td style="padding:6px;border:1px solid #ddd">${updated.origin_airport} → ${updated.destination_airport}</td></tr>
            <tr><td style="padding:6px;border:1px solid #ddd;color:#666">Grand Total</td><td style="padding:6px;border:1px solid #ddd"><b>${idr(Number(updated.grand_total))}</b></td></tr>
            ${body.admin_notes ? `<tr><td style="padding:6px;border:1px solid #ddd;color:#666">Catatan</td><td style="padding:6px;border:1px solid #ddd">${body.admin_notes}</td></tr>` : ""}
          </table>
          <p style="margin-top:20px">
            <a href="${approvalUrl}" style="background:#1d4ed8;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
              Review &amp; Approve
            </a>
          </p>
          <p style="color:#666;font-size:12px">Link tracking: <a href="${trackUrl}">${trackUrl}</a></p>
        `,
        text: `Harga final Air Freight Order ${updated.order_number} tersedia. Silakan review: ${approvalUrl}`,
        context: "air_freight_quote_final",
        refType: "air_freight_order",
        refId: String(id),
      }).catch((e: unknown) => console.error("[air-freight] email quote notification failed:", e));
    }

    res.json({ ok: true, order: updated, approvalUrl });
  } catch (err) {
    console.error("[air-freight] POST /orders/:id/send-final-quote error:", err);
    res.status(500).json({ error: "Gagal mengirim quote final" });
  }
});

// ── POST /orders/:id/confirm-booking ──────────────────────────────────────────
router.post("/orders/:id/confirm-booking", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id   = Number(String(req.params.id));
    const body = req.body;
    const existing = await db.execute(sql`SELECT id, status, company_id FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!existing.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (existing.rows[0] as any).company_id, id)) return;

    const r = await db.execute(sql`
      UPDATE air_freight_orders SET
        status                  = 'booked',
        tracking_status         = 'booked',
        booking_number          = COALESCE(${body.booking_number ?? null}, booking_number),
        mawb                    = COALESCE(${body.mawb ?? null}, mawb),
        hawb                    = COALESCE(${body.hawb ?? null}, hawb),
        booking_attachment_url  = COALESCE(${body.booking_attachment_url ?? null}, booking_attachment_url),
        booking_confirmed_at    = NOW(),
        updated_at              = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    const updated = r.rows[0] as any;

    // update final_rate info (flight_number, etd, eta) if provided
    if (body.flight_number || body.etd || body.eta) {
      if (updated.final_rate_id) {
        await db.execute(sql`
          UPDATE air_freight_rates SET
            flight_number = COALESCE(${body.flight_number ?? null}, flight_number),
            etd           = COALESCE(${body.etd ?? null}, etd),
            eta           = COALESCE(${body.eta ?? null}, eta),
            updated_at    = NOW()
          WHERE id = ${updated.final_rate_id}
        `).catch(() => {});
      }
    }

    // log tracking event
    await db.execute(sql`
      INSERT INTO air_freight_tracking_events (order_id, event_type, note, created_by)
      VALUES (${id}, 'booked', ${body.booking_number ? `Booking confirmed — No. ${body.booking_number}` : 'Booking confirmed'}, ${(req.user as any)?.id ?? null})
    `).catch(() => {});

    res.json({ ok: true, order: updated });
  } catch (err) {
    console.error("[air-freight] POST /orders/:id/confirm-booking error:", err);
    res.status(500).json({ error: "Gagal konfirmasi booking" });
  }
});

// ── PATCH /orders/:id/tracking-status ────────────────────────────────────────
router.patch("/orders/:id/tracking-status", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));
    const { tracking_status, note } = req.body;

    const orderOwn = await db.execute(sql`SELECT company_id FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!orderOwn.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (orderOwn.rows[0] as any).company_id, id)) return;

    const VALID_TRACKING = [
      "booked","cargo_received","departed","in_transit","arrived",
      "customs_clearance","out_for_delivery","delivered","completed",
    ];
    if (!tracking_status || !VALID_TRACKING.includes(tracking_status)) {
      return res.status(400).json({ error: `tracking_status tidak valid. Pilih: ${VALID_TRACKING.join(", ")}` });
    }

    // map tracking → order status for major transitions
    const ORDER_STATUS_MAP: Record<string, string> = {
      departed:         "departed",
      arrived:          "arrived",
      delivered:        "delivered",
      completed:        "completed",
    };
    const newOrderStatus = ORDER_STATUS_MAP[tracking_status];

    // Update tracking_status (always), plus order status on major transitions
    await db.execute(sql`
      UPDATE air_freight_orders SET tracking_status = ${tracking_status}, updated_at = NOW()
      WHERE id = ${id}
    `);
    if (newOrderStatus) {
      await db.execute(sql`
        UPDATE air_freight_orders SET status = ${newOrderStatus}, updated_at = NOW()
        WHERE id = ${id}
      `);
    }
    const r = await db.execute(sql`SELECT * FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!r.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });

    await db.execute(sql`
      INSERT INTO air_freight_tracking_events (order_id, event_type, note, created_by)
      VALUES (${id}, ${tracking_status}, ${note ?? null}, ${(req.user as any)?.id ?? null})
    `).catch(() => {});

    res.json({ ok: true, order: r.rows[0] });
  } catch (err) {
    console.error("[air-freight] PATCH /orders/:id/tracking-status error:", err);
    res.status(500).json({ error: "Gagal update tracking status" });
  }
});

// ── GET /orders/:id/tracking-events ──────────────────────────────────────────
router.get("/orders/:id/tracking-events", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const id = Number(String(req.params.id));

    const orderOwn = await db.execute(sql`SELECT company_id FROM air_freight_orders WHERE id = ${id} LIMIT 1`);
    if (!orderOwn.rows.length) return res.status(404).json({ error: "Order tidak ditemukan" });
    if (!await assertAirFreightOrderCompanyAccess(req, res, (orderOwn.rows[0] as any).company_id, id)) return;

    const r = await db.execute(sql`
      SELECT id, event_type, note, created_by, created_at
      FROM air_freight_tracking_events
      WHERE order_id = ${id}
      ORDER BY created_at ASC
    `);
    res.json(r.rows);
  } catch (err) {
    console.error("[air-freight] GET /orders/:id/tracking-events error:", err);
    res.status(500).json({ error: "Gagal memuat tracking events" });
  }
});

export default router;

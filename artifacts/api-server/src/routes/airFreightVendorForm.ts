import { Router, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  airFreightRateSubmissionsTable,
  airFreightRfqsTable,
  airFreightOrdersTable,
  suppliersTable,
} from "@workspace/db";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { documentUpload } from "../lib/uploadMiddleware.js";

const upload = documentUpload(10);
const storage = new ObjectStorageService();

const submitLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan, coba lagi nanti." },
});

export const airFreightVendorFormRouter = Router();
airFreightVendorFormRouter.use((_req, _res, next) => next());

// ── GET /api/air-freight-form/:token — load form data ───────────────────────
airFreightVendorFormRouter.get("/:token", async (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
    return res.status(400).json({ error: "Token tidak valid" });
  }

  const [sub] = await db.select({
    sub: airFreightRateSubmissionsTable,
    vendorName: suppliersTable.name,
    vendorPhone: suppliersTable.phone,
  })
    .from(airFreightRateSubmissionsTable)
    .leftJoin(suppliersTable, eq(airFreightRateSubmissionsTable.vendorId, suppliersTable.id))
    .where(eq(airFreightRateSubmissionsTable.token, token));

  if (!sub) return res.status(404).json({ error: "Link tidak ditemukan" });
  if (!sub.sub.isActive) return res.status(410).json({ error: "Link sudah tidak aktif" });

  const [rfq] = await db.select().from(airFreightRfqsTable)
    .where(eq(airFreightRfqsTable.id, sub.sub.rfqId));
  if (!rfq) return res.status(404).json({ error: "RFQ tidak ditemukan" });

  if (rfq.responseDeadline && new Date() > rfq.responseDeadline) {
    return res.status(410).json({ error: "Batas waktu pengisian sudah lewat" });
  }

  const [order] = await db.select({
    id: airFreightOrdersTable.id,
    orderNumber: airFreightOrdersTable.orderNumber,
    originAirport: airFreightOrdersTable.originAirport,
    destAirport: airFreightOrdersTable.destAirport,
    tradeType: airFreightOrdersTable.tradeType,
    cargoType: airFreightOrdersTable.cargoType,
    commodity: airFreightOrdersTable.commodity,
    chargeableWeight: airFreightOrdersTable.chargeableWeight,
    grossWeight: airFreightOrdersTable.grossWeight,
    pieces: airFreightOrdersTable.pieces,
    etdRequested: airFreightOrdersTable.etdRequested,
    additionalServices: airFreightOrdersTable.additionalServices,
  })
    .from(airFreightOrdersTable)
    .where(eq(airFreightOrdersTable.id, sub.sub.orderId));

  // Mark opened
  if (!sub.sub.formOpenedAt) {
    await db.update(airFreightRateSubmissionsTable)
      .set({ formOpenedAt: new Date() })
      .where(eq(airFreightRateSubmissionsTable.token, token));
  }

  res.json({
    submission: {
      id: sub.sub.id,
      status: sub.sub.status,
      submittedAt: sub.sub.submittedAt,
      airline: sub.sub.airline,
      flightNumber: sub.sub.flightNumber,
      etd: sub.sub.etd,
      eta: sub.sub.eta,
      transitDays: sub.sub.transitDays,
      isDirect: sub.sub.isDirect,
      currency: sub.sub.currency,
      exchangeRate: sub.sub.exchangeRate,
      ratePerKg: sub.sub.ratePerKg,
      weightBreakRates: sub.sub.weightBreakRates,
      fuelSurcharge: sub.sub.fuelSurcharge,
      securitySurcharge: sub.sub.securitySurcharge,
      awbFee: sub.sub.awbFee,
      handlingFee: sub.sub.handlingFee,
      xrayFee: sub.sub.xrayFee,
      docFee: sub.sub.docFee,
      customsClearanceFee: sub.sub.customsClearanceFee,
      pickupTrucking: sub.sub.pickupTrucking,
      deliveryTrucking: sub.sub.deliveryTrucking,
      cargoSurcharge: sub.sub.cargoSurcharge,
      otherFees: sub.sub.otherFees,
      totalIDR: sub.sub.totalIDR,
      validityDate: sub.sub.validityDate,
      notes: sub.sub.notes,
      attachmentUrl: sub.sub.attachmentUrl,
    },
    rfq: {
      rfqNumber: rfq.rfqNumber,
      responseDeadline: rfq.responseDeadline,
    },
    order,
    vendorName: sub.vendorName ?? sub.sub.vendorName,
  });
});

// ── POST /api/air-freight-form/:token — submit rate ───────────────────────────
airFreightVendorFormRouter.post("/:token", submitLimit, async (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
    return res.status(400).json({ error: "Token tidak valid" });
  }

  const [sub] = await db.select({
    sub: airFreightRateSubmissionsTable,
    vendorName: suppliersTable.name,
    vendorPhone: suppliersTable.phone,
  })
    .from(airFreightRateSubmissionsTable)
    .leftJoin(suppliersTable, eq(airFreightRateSubmissionsTable.vendorId, suppliersTable.id))
    .where(eq(airFreightRateSubmissionsTable.token, token));

  if (!sub) return res.status(404).json({ error: "Link tidak ditemukan" });
  if (!sub.sub.isActive) return res.status(410).json({ error: "Link sudah tidak aktif" });

  const [rfq] = await db.select().from(airFreightRfqsTable)
    .where(eq(airFreightRfqsTable.id, sub.sub.rfqId));
  if (!rfq || rfq.status === "closed") {
    return res.status(410).json({ error: "RFQ sudah ditutup" });
  }
  if (rfq.responseDeadline && new Date() > rfq.responseDeadline) {
    return res.status(410).json({ error: "Batas waktu pengisian sudah lewat" });
  }

  const {
    airline, flightNumber, etd, eta, transitDays, isDirect,
    currency, exchangeRate, ratePerKg, weightBreakRates,
    fuelSurcharge, securitySurcharge, awbFee, handlingFee,
    xrayFee, docFee, customsClearanceFee, pickupTrucking,
    deliveryTrucking, cargoSurcharge, otherFees,
    totalIDR, validityDate, notes,
  } = req.body;

  if (!ratePerKg && !weightBreakRates) {
    return res.status(400).json({ error: "ratePerKg atau weightBreakRates harus diisi" });
  }

  const n = (v: any) => v != null ? String(v) : null;
  const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
    ?? req.socket.remoteAddress ?? null;

  const [updated] = await db.update(airFreightRateSubmissionsTable).set({
    airline: airline ?? null,
    flightNumber: flightNumber ?? null,
    etd: etd ?? null,
    eta: eta ?? null,
    transitDays: transitDays ? parseInt(transitDays) : null,
    isDirect: isDirect !== false,
    currency: currency ?? "IDR",
    exchangeRate: exchangeRate ? String(exchangeRate) : "1",
    ratePerKg: n(ratePerKg),
    weightBreakRates: weightBreakRates ?? null,
    fuelSurcharge: n(fuelSurcharge) ?? "0",
    securitySurcharge: n(securitySurcharge) ?? "0",
    awbFee: n(awbFee) ?? "0",
    handlingFee: n(handlingFee) ?? "0",
    xrayFee: n(xrayFee) ?? "0",
    docFee: n(docFee) ?? "0",
    customsClearanceFee: n(customsClearanceFee) ?? "0",
    pickupTrucking: n(pickupTrucking) ?? "0",
    deliveryTrucking: n(deliveryTrucking) ?? "0",
    cargoSurcharge: n(cargoSurcharge) ?? "0",
    otherFees: otherFees ?? null,
    totalIDR: n(totalIDR),
    validityDate: validityDate ?? null,
    notes: notes ?? null,
    status: "submitted",
    submittedAt: new Date(),
    submitterIp: ip,
    updatedAt: new Date(),
  })
    .where(eq(airFreightRateSubmissionsTable.token, token))
    .returning();

  // Update order status to rate_received
  await db.update(airFreightOrdersTable)
    .set({ status: "rate_received", updatedAt: new Date() })
    .where(and(
      eq(airFreightOrdersTable.id, sub.sub.orderId),
      // Only if still in rfq_blasted (don't downgrade)
    ));

  // WA confirmation to vendor
  const vendorPhone = sub.vendorPhone;
  const displayName = sub.vendorName ?? sub.sub.vendorName ?? "Vendor";
  if (vendorPhone) {
    const confirmMsg = [
      `✅ *Penawaran Rate Air Freight Diterima*`,
      ``,
      `Terima kasih *${displayName}*,`,
      `penawaran Anda untuk RFQ *${rfq.rfqNumber}* sudah kami terima.`,
      ``,
      `Rate/kg: ${ratePerKg ?? "-"}`,
      `Airline: ${airline ?? "-"}`,
      `ETD: ${etd ?? "-"}`,
      ``,
      `Kami akan menghubungi Anda jika penawaran ini dipilih.`,
    ].join("\n");
    sendWhatsApp(vendorPhone, confirmMsg).catch(() => {});
  }

  // Notify admin group
  const adminWa = await getAdminGroupWa();
  if (adminWa) {
    const adminMsg = [
      `*📥 Rate Air Freight Masuk*`,
      ``,
      `Vendor  : ${displayName}`,
      `RFQ     : ${rfq.rfqNumber}`,
      `Rate/kg : ${ratePerKg ?? "-"} ${currency ?? "IDR"}`,
      `Airline : ${airline ?? "-"}`,
      `ETD     : ${etd ?? "-"}`,
      `Total   : ${totalIDR ? Number(totalIDR).toLocaleString("id-ID") : "-"}`,
    ].join("\n");
    sendWhatsApp(adminWa, adminMsg).catch(() => {});
  }

  res.json({ ok: true, submission: updated });
});

// ── POST /api/air-freight-form/:token/upload — upload attachment ──────────────
airFreightVendorFormRouter.post("/:token/upload", upload.single("file"), async (req: Request, res: Response) => {
  const token = String(req.params.token);
  if (!token || !/^[a-f0-9]{48}$/i.test(token)) {
    return res.status(400).json({ error: "Token tidak valid" });
  }

  const [sub] = await db.select({ id: airFreightRateSubmissionsTable.id, isActive: airFreightRateSubmissionsTable.isActive })
    .from(airFreightRateSubmissionsTable)
    .where(eq(airFreightRateSubmissionsTable.token, token));
  if (!sub || !sub.isActive) return res.status(404).json({ error: "Link tidak ditemukan atau tidak aktif" });

  const file = req.file;
  if (!file) return res.status(400).json({ error: "File tidak ditemukan" });

  const extFromMime: Record<string, string> = {
    "application/pdf": "pdf",
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/webp": "webp",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/vnd.ms-excel": "xls",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/zip": "zip", "application/x-zip-compressed": "zip",
  };
  const ext = extFromMime[file.mimetype] ?? "bin";
  const key = `air-freight-quotes/${sub.id}-${Date.now()}.${ext}`;

  try {
    const url = await storage.uploadPublic(key, file.buffer, file.mimetype);
    await db.update(airFreightRateSubmissionsTable)
      .set({ attachmentUrl: url, updatedAt: new Date() })
      .where(eq(airFreightRateSubmissionsTable.token, token));
    res.json({ url });
  } catch (e: any) {
    res.status(500).json({ error: "Upload gagal: " + (e?.message ?? "unknown") });
  }
});

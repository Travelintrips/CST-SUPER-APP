import { Router, type Request, type Response } from "express";
import { eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import multer from "multer";
import { db, logisticOrdersTable } from "@workspace/db";
import { updateOrderProgress } from "../lib/orderProgress.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getPreferredDomain } from "../lib/domain.js";
import { getAdminWa, getAdminGroupWa } from "../lib/adminWa.js";
import { sendVendorPodUploadedNotification } from "../lib/orderNotification.js";
import { autoCreateLogisticInvoice } from "../lib/podInvoiceAutoCreate.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logger } from "../lib/logger.js";

export const driverProgressPublicRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const objectStorage = new ObjectStorageService();

const ALLOWED_STEPS = ["PICKUP", "IN_TRANSIT", "ARRIVED", "DELIVERED", "COMPLETED"] as const;
const PHOTO_REQUIRED_STEPS = new Set(["PICKUP", "ARRIVED", "DELIVERED", "COMPLETED"]);

const STEP_LABEL: Record<string, string> = {
  PICKUP:     "Penjemputan",
  IN_TRANSIT: "Dalam Perjalanan",
  ARRIVED:    "Tiba di Tujuan",
  DELIVERED:  "Terkirim",
  COMPLETED:  "Bukti Pengiriman",
};

const STEP_TO_LOGISTIC_STATUS: Record<string, string> = {
  PICKUP:     "Pickup",
  IN_TRANSIT: "In Transit",
  ARRIVED:    "Arrived",
  DELIVERED:  "Delivered",
  COMPLETED:  "POD Uploaded",
};

const LOGISTIC_STATUS_RANK: Record<string, number> = {
  "Pickup": 7, "In Transit": 8, "Arrived": 9, "Delivered": 10, "POD Uploaded": 11,
};

const ALLOWED_PHOTO_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/heic", "image/heif",
]);

db.execute(sql`
  CREATE TABLE IF NOT EXISTS driver_progress_tokens (
    id           SERIAL PRIMARY KEY,
    token        TEXT NOT NULL UNIQUE,
    order_id     INTEGER NOT NULL,
    driver_name  TEXT,
    driver_phone TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    expires_at   TIMESTAMPTZ NOT NULL
  )
`).catch(() => {});

function buildMapUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?q=${lat},${lng}`;
}

function buildStreetViewUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps?layer=c&cbll=${lat},${lng}`;
}

// GET /api/driver-progress/:token
driverProgressPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params;
  try {
    const rows = await db.execute(sql`
      SELECT id, order_id, driver_name, expires_at
      FROM driver_progress_tokens WHERE token = ${token} LIMIT 1
    `);
    const [row] = (rows.rows ?? []) as any[];
    if (!row) return res.status(404).json({ error: "Link tidak valid." });
    if (new Date(row.expires_at as string) < new Date()) {
      return res.status(410).json({ error: "Link sudah kadaluarsa." });
    }

    const orderId = Number(row.order_id);
    const [order] = await db.select({
      orderNumber: logisticOrdersTable.orderNumber,
      customerName: logisticOrdersTable.customerName,
      origin: logisticOrdersTable.origin,
      destination: logisticOrdersTable.destination,
    }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });

    const evRows = await db.execute(sql`
      SELECT step_key, metadata, gps_latitude, gps_longitude, device_timestamp, map_url, street_view_url, photo_url
      FROM order_progress_events
      WHERE order_id = ${orderId} ORDER BY created_at ASC
    `);
    const evData = (evRows.rows ?? []) as any[];
    const completedSteps = evData.map((e) => e.step_key as string);
    const completedStepsMeta: Record<string, {
      photoUrl?: string;
      gpsLatitude?: number | null;
      gpsLongitude?: number | null;
      deviceTimestamp?: string | null;
      mapUrl?: string | null;
      streetViewUrl?: string | null;
    }> = {};
    evData.forEach((e) => {
      const meta: typeof completedStepsMeta[string] = {};
      // photo_url column takes priority; fall back to legacy metadata.photoUrl
      const resolvedPhoto = (e.photo_url as string | null)
        ?? (e.metadata?.photoUrl as string | undefined)
        ?? null;
      if (resolvedPhoto) meta.photoUrl = resolvedPhoto;
      if (e.gps_latitude != null) meta.gpsLatitude = parseFloat(String(e.gps_latitude));
      if (e.gps_longitude != null) meta.gpsLongitude = parseFloat(String(e.gps_longitude));
      if (e.device_timestamp) meta.deviceTimestamp = e.device_timestamp as string;
      if (e.map_url) meta.mapUrl = e.map_url as string;
      if (e.street_view_url) meta.streetViewUrl = e.street_view_url as string;
      if (Object.keys(meta).length > 0) completedStepsMeta[e.step_key as string] = meta;
    });

    return res.json({
      orderNumber: order.orderNumber,
      customerName: order.customerName,
      origin: order.origin ?? null,
      destination: order.destination ?? null,
      driverName: row.driver_name ?? null,
      completedSteps,
      completedStepsMeta,
      allowedSteps: (() => {
        const next = ALLOWED_STEPS.find((s) => !completedSteps.includes(s));
        return next ? [next] : [];
      })(),
      stepLabel: STEP_LABEL,
    });
  } catch (err) {
    logger.error({ err }, "driver-progress GET error");
    return res.status(500).json({ error: "Gagal memuat data." });
  }
});

// POST /api/driver-progress/:token/photo
driverProgressPublicRouter.post("/:token/photo", upload.single("file"), async (req: Request, res: Response) => {
  const { token } = req.params;
  const stepKey = String(req.body?.stepKey ?? "");
  if (!stepKey || !(ALLOWED_STEPS as readonly string[]).includes(stepKey)) {
    return res.status(400).json({ error: "stepKey tidak valid." });
  }
  try {
    const rows = await db.execute(sql`
      SELECT id, expires_at FROM driver_progress_tokens WHERE token = ${token} LIMIT 1
    `);
    const [row] = (rows.rows ?? []) as any[];
    if (!row) return res.status(404).json({ error: "Link tidak valid." });
    if (new Date(row.expires_at as string) < new Date()) {
      return res.status(410).json({ error: "Link sudah kadaluarsa." });
    }
    if (!req.file) return res.status(400).json({ error: "File diperlukan." });
    if (!ALLOWED_PHOTO_MIME.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Hanya JPG, PNG, WebP, atau HEIC yang diizinkan." });
    }

    const ext = req.file.originalname?.split(".").pop()?.toLowerCase() ?? "jpg";
    const subPath = `driver-progress/${token}/${stepKey}-${randomUUID()}.${ext}`;
    const url = await objectStorage.uploadPublicRaw(subPath, req.file.buffer, req.file.mimetype);
    return res.json({ url });
  } catch (err) {
    logger.error({ err }, "driver-progress photo upload error");
    return res.status(500).json({ error: "Upload foto gagal." });
  }
});

// POST /api/driver-progress/:token  { stepKey, note?, photoUrl?, gpsLatitude?, gpsLongitude?, deviceTimestamp? }
driverProgressPublicRouter.post("/:token", async (req: Request, res: Response) => {
  const { token } = req.params;
  const {
    stepKey,
    note,
    photoUrl, photo_url, proofPhotoUrl, proof_photo_url, attachmentUrl,
    gpsLatitude, gpsLongitude, deviceTimestamp,
  } = req.body ?? {};
  // Accept any of the recognised photo field names from the driver app
  const resolvedPhotoUrl: string | null =
    photoUrl ?? photo_url ?? proofPhotoUrl ?? proof_photo_url ?? attachmentUrl ?? null;
  if (!stepKey || !(ALLOWED_STEPS as readonly string[]).includes(String(stepKey))) {
    return res.status(400).json({ error: "stepKey tidak valid." });
  }
  if (PHOTO_REQUIRED_STEPS.has(String(stepKey)) && !resolvedPhotoUrl) {
    return res.status(400).json({ error: `Foto wajib untuk step ${STEP_LABEL[String(stepKey)] ?? stepKey}.` });
  }

  // Validate GPS fields
  const lat = gpsLatitude != null ? parseFloat(String(gpsLatitude)) : null;
  const lng = gpsLongitude != null ? parseFloat(String(gpsLongitude)) : null;
  if (lat != null && (isNaN(lat) || lat < -90 || lat > 90)) {
    return res.status(400).json({ error: "gpsLatitude tidak valid (harus -90..90)." });
  }
  if (lng != null && (isNaN(lng) || lng < -180 || lng > 180)) {
    return res.status(400).json({ error: "gpsLongitude tidak valid (harus -180..180)." });
  }
  let parsedDeviceTs: string | null = null;
  if (deviceTimestamp) {
    const d = new Date(String(deviceTimestamp));
    if (isNaN(d.getTime())) {
      return res.status(400).json({ error: "deviceTimestamp tidak valid (harus ISO 8601)." });
    }
    parsedDeviceTs = d.toISOString();
  }

  const mapUrl = lat != null && lng != null ? buildMapUrl(lat, lng) : null;
  const streetViewUrl = lat != null && lng != null ? buildStreetViewUrl(lat, lng) : null;

  try {
    const rows = await db.execute(sql`
      SELECT id, order_id, driver_name, driver_phone, expires_at
      FROM driver_progress_tokens WHERE token = ${token} LIMIT 1
    `);
    const [row] = (rows.rows ?? []) as any[];
    if (!row) return res.status(404).json({ error: "Link tidak valid." });
    if (new Date(row.expires_at as string) < new Date()) {
      return res.status(410).json({ error: "Link sudah kadaluarsa." });
    }

    const orderId = Number(row.order_id);
    const driverName = (row.driver_name as string | null) ?? "Driver";

    // Validate stepKey harus next step berikutnya (strict order)
    const evCheck = await db.execute(sql`
      SELECT step_key FROM order_progress_events
      WHERE order_id = ${orderId} ORDER BY created_at ASC
    `);
    const doneSteps = ((evCheck.rows ?? []) as any[]).map((e) => e.step_key as string);
    const nextStep = ALLOWED_STEPS.find((s) => !doneSteps.includes(s));
    if (!nextStep) {
      return res.status(409).json({ error: "Semua step sudah selesai." });
    }
    if (String(stepKey) !== nextStep) {
      return res.status(400).json({
        error: `Step tidak sesuai urutan. Step berikutnya: ${STEP_LABEL[nextStep] ?? nextStep}.`,
      });
    }

    await updateOrderProgress(
      orderId,
      String(stepKey),
      "driver",
      driverName,
      note ? String(note) : `Driver update via WA link: ${stepKey}`,
      resolvedPhotoUrl ? { photoUrl: resolvedPhotoUrl } : undefined,
      { gpsLatitude: lat, gpsLongitude: lng, deviceTimestamp: parsedDeviceTs, mapUrl, streetViewUrl, photoUrl: resolvedPhotoUrl },
    );

    const logisticStatus = STEP_TO_LOGISTIC_STATUS[String(stepKey)];
    if (logisticStatus) {
      const [cur] = await db.select({ status: logisticOrdersTable.status })
        .from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
      const curRank = LOGISTIC_STATUS_RANK[cur?.status ?? ""] ?? -1;
      const newRank = LOGISTIC_STATUS_RANK[logisticStatus] ?? -1;
      if (newRank > curRank) {
        transitionLogisticOrderStatus(orderId, logisticStatus, {
          actorType: "driver",
          source: `driver-progress-link:${String(stepKey).toLowerCase()}`,
          force: false,
        }).catch((e: unknown) => logger.warn({ e, orderId, logisticStatus }, "driver-progress: status transition failed"));
      }
    }

    // WA ke admin group untuk PICKUP dan DELIVERED (via WA Mini Form / INTERNAL driver)
    if (["PICKUP", "DELIVERED"].includes(String(stepKey))) {
      try {
        const [order] = await db.select({
          orderNumber: logisticOrdersTable.orderNumber,
          customerName: logisticOrdersTable.customerName,
        }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
        const adminGroupWa = await getAdminGroupWa();
        if (adminGroupWa && order) {
          const emoji = String(stepKey) === "DELIVERED" ? "📦" : "🚚";
          const statusLabel = STEP_LABEL[String(stepKey)] ?? String(stepKey);
          const msg = [
            `${emoji} *Update Driver (WA Mini Form)*`,
            ``,
            `👤 Driver: ${driverName}`,
            `📦 Order: ${order.orderNumber ?? "-"} (${order.customerName ?? "-"})`,
            `📍 Status: *${statusLabel}*`,
            note ? `📝 Catatan: ${note}` : null,
          ].filter(Boolean).join("\n");
          sendWhatsApp(adminGroupWa, msg).catch(() => {});
        }
      } catch {
        // non-fatal
      }
    }

    // WA ke admin saat COMPLETED (Bukti Pengiriman)
    if (String(stepKey) === "COMPLETED") {
      try {
        const [order] = await db.select({
          orderNumber: logisticOrdersTable.orderNumber,
          phone: logisticOrdersTable.phone,
          customerName: logisticOrdersTable.customerName,
        }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));

        // Konversi relative URL ke absolute agar Fonnte bisa fetch media
        const domain = process.env.REPLIT_DEV_DOMAIN || getPreferredDomain() || "cstlogistic.co.id";
        const absolutePhotoUrl = resolvedPhotoUrl
          ? (resolvedPhotoUrl.startsWith("http") ? resolvedPhotoUrl : `https://${domain}${resolvedPhotoUrl}`)
          : undefined;

        const adminWa = await getAdminWa();
        if (adminWa && order?.orderNumber) {
          sendVendorPodUploadedNotification(
            order.orderNumber,
            driverName,
            1,
            adminWa,
            note ? String(note) : undefined,
            absolutePhotoUrl,
          ).catch(() => {});
        }

        const adminGroupWa = await getAdminGroupWa();
        if (adminGroupWa && order?.orderNumber) {
          const msg = [
            `📦 *Bukti Pengiriman Diterima*`,
            ``,
            `👤 Driver: ${driverName}`,
            `📦 Order: ${order.orderNumber} (${order.customerName ?? "-"})`,
            `📍 Status: *Bukti Pengiriman*`,
            note ? `📝 Catatan: ${note}` : null,
            absolutePhotoUrl ? `🖼️ Foto: ${absolutePhotoUrl}` : null,
          ].filter(Boolean).join("\n");
          sendWhatsApp(adminGroupWa, msg).catch(() => {});
        }

      } catch {
        // non-fatal
      }

      // Auto-create invoice (fire-and-forget, non-blocking)
      db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId)).limit(1)
        .then(([row]) => {
          if (!row) return;
          autoCreateLogisticInvoice({
            id: row.id,
            orderNumber: row.orderNumber,
            customerName: row.customerName,
            companyName: row.companyName ?? "",
            email: row.email,
            phone: row.phone,
            orderType: row.orderType ?? undefined,
            shipmentType: row.shipmentType,
            origin: row.origin,
            destination: row.destination,
            commodity: row.commodity ?? null,
            cargoDescription: row.cargoDescription ?? null,
            grossWeight: row.grossWeight ? Number(row.grossWeight) : null,
            volumeCbm: row.volumeCbm ? Number(row.volumeCbm) : null,
            jumlahKoli: row.jumlahKoli ?? null,
            grandTotal: row.grandTotal ? Number(row.grandTotal) : 0,
            tax: row.tax ? Number(row.tax) : 0,
            subtotal: row.grandTotal && row.tax ? Number(row.grandTotal) - Number(row.tax) : null,
            serviceList: row.shipmentType,
            requiredDate: row.requiredDate ?? null,
            notes: row.notes ?? null,
            jamOrder: row.jamOrder ?? null,
            vehicleType: row.truckType ?? null,
            createdAt: row.createdAt ?? null,
            publicRfqToken: row.publicRfqToken ?? null,
          }).catch(() => {});
        }).catch(() => {});
    }

    return res.json({ ok: true, stepKey, label: STEP_LABEL[String(stepKey)], mapUrl, streetViewUrl });
  } catch (err) {
    logger.error({ err }, "driver-progress POST error");
    return res.status(500).json({ error: "Gagal memperbarui status." });
  }
});

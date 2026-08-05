import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { db } from "@workspace/db";
import {
  vendorResponsesTable,
  logisticOrdersTable,
  logisticOrderItemsTable,
  suppliersTable,
} from "@workspace/db";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { ObjectStorageService } from "../lib/objectStorage";
import { verifyVendorResponseToken } from "../lib/vendorResponseToken";
import { getAdminGroupWa } from "../lib/adminWa";
import { getPreferredDomain } from "../lib/domain";
import { imageUpload } from "../lib/uploadMiddleware.js";

const router: IRouter = Router();
const upload = imageUpload(10);
const objectStorage = new ObjectStorageService();

const VENDOR_PHOTO_ALLOWED_MIME = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "image/heic", "image/heif",
]);

const _vendorPhotoRateMap = new Map<string, { count: number; resetAt: number }>();
function _checkVendorPhotoRateLimit(orderNumber: string): boolean {
  const now = Date.now();
  let entry = _vendorPhotoRateMap.get(orderNumber);
  if (!entry || now > entry.resetAt) {
    entry = { count: 0, resetAt: now + 60 * 60 * 1000 };
  }
  if (entry.count >= 10) return false;
  entry.count += 1;
  _vendorPhotoRateMap.set(orderNumber, entry);
  return true;
}

db.execute(sql`ALTER TABLE vendor_responses ADD COLUMN IF NOT EXISTS quoted_price NUMERIC(14, 2)`).catch(() => {});

function nowWIB(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta", day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const day  = parts.find(p => p.type === "day")?.value ?? "";
  const mon  = parts.find(p => p.type === "month")?.value ?? "";
  const year = parts.find(p => p.type === "year")?.value ?? "";
  const hour = parts.find(p => p.type === "hour")?.value ?? "";
  const min  = parts.find(p => p.type === "minute")?.value ?? "";
  return `${day} ${mon} ${year}, ${hour}:${min} WIB`;
}

function formatWaAdminNotification(response: {
  orderNumber: string;
  vendorName: string | null;
  status: string;
  estimatedPickupTime: string | null;
  driverName: string | null;
  driverPhone: string | null;
  plateNumber: string | null;
  vehicleType: string | null;
  notes: string | null;
  quotedPrice?: string | null;
  orderId: number | null;
}): string {
  const statusEmoji = response.status === "READY" ? "✅" : "❌";
  const statusLabel = response.status === "READY" ? "READY" : "NOT READY";
  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const approveUrl = `https://${domain}/approve/${response.orderNumber}`;

  const lines = [
    `${statusEmoji} *VENDOR RESPONSE — ${response.orderNumber}*`,
    `━━━━━━━━━━━━━━━━━━`,
    `Vendor: ${response.vendorName ?? "—"}`,
    `Status: ${statusEmoji} ${statusLabel}`,
  ];

  if (response.status === "READY") {
    if (response.quotedPrice) lines.push(`💰 Harga Penawaran: Rp ${Number(response.quotedPrice).toLocaleString("id-ID")}`);
    if (response.estimatedPickupTime) lines.push(`Est. Pickup: ${response.estimatedPickupTime}`);
    if (response.driverName) lines.push(`Driver: ${response.driverName}`);
    if (response.driverPhone) lines.push(`Phone: ${response.driverPhone}`);
    if (response.plateNumber) lines.push(`Plat: ${response.plateNumber}`);
    if (response.vehicleType) lines.push(`Unit: ${response.vehicleType}`);
  }

  if (response.notes) lines.push(`Catatan: ${response.notes}`);
  lines.push(`━━━━━━━━━━━━━━━━━━`);
  if (response.status === "READY") {
    lines.push(`📋 *Review & Approve:*\n${approveUrl}`);
  } else {
    lines.push(`📋 *Cek & pilih vendor lain:*\n${approveUrl}`);
  }
  lines.push(`\n_Dikirim: ${nowWIB()}_`);

  return lines.join("\n");
}

router.get("/:orderNumber", async (req: Request, res: Response) => {
  const orderNumber = req.params["orderNumber"] as string;
  const token = String(req.query.t ?? "").trim();
  if (!verifyVendorResponseToken(orderNumber, token)) {
    res.status(403).json({ error: "Link tidak valid atau sudah kadaluarsa" });
    return;
  }
  const vendorId = req.query.v ? parseInt(String(req.query.v), 10) : null;

  try {
    const [order] = await db
      .select()
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.orderNumber, orderNumber));

    if (!order) {
      res.status(404).json({ error: "Order tidak ditemukan" });
      return;
    }

    const items = await db
      .select()
      .from(logisticOrderItemsTable)
      .where(eq(logisticOrderItemsTable.orderId, order.id));

    const truckingItem = items.find((i) => i.calculatorType === "trucking");
    const vehicleType =
      (truckingItem?.inputData as Record<string, unknown>)?.vehicleType as string | null ?? null;

    const [existing] = await db
      .select()
      .from(vendorResponsesTable)
      .where(eq(vendorResponsesTable.orderNumber, orderNumber));

    // Fetch vendor name from DB if vendorId provided (base price not exposed to protect margin)
    let vendorNameFromDb: string | null = null;
    if (vendorId && !isNaN(vendorId)) {
      const [vendor] = await db
        .select({ name: suppliersTable.name })
        .from(suppliersTable)
        .where(eq(suppliersTable.id, vendorId));
      if (vendor) vendorNameFromDb = vendor.name;
    }

    res.json({
      orderNumber: order.orderNumber,
      companyName: order.companyName,
      customerName: order.customerName,
      origin: order.origin,
      destination: order.destination,
      commodity: order.commodity,
      grossWeight: order.grossWeight,
      vehicleType,
      requiredDate: order.requiredDate,
      jamOrder: order.jamOrder,
      shipmentType: order.shipmentType,
      vendorNameFromDb,
      alreadySubmitted: !!existing,
    });
  } catch (err) {
    req.log?.error({ err }, "vendor-response GET error");
    res.status(500).json({ error: "Internal server error" });
  }
});

const ALLOWED_PHOTO_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Magic-byte prefixes for allowed image types (client MIME cannot be trusted)
function isAllowedImageMagicBytes(buf: Buffer): boolean {
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return true;
  // WebP: RIFF????WEBP
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50) return true;
  // GIF: GIF8
  if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return true;
  return false;
}

router.post("/:orderNumber/photo", upload.single("photo") as any, async (req: Request, res: Response) => {
  const orderNumberPhoto = req.params["orderNumber"] as string;
  const tokenPhoto = String(req.query.t ?? req.body?.t ?? "").trim();
  if (!verifyVendorResponseToken(orderNumberPhoto, tokenPhoto)) {
    res.status(403).json({ error: "Link tidak valid atau sudah kadaluarsa" });
    return;
  }
  if (!_checkVendorPhotoRateLimit(orderNumberPhoto)) {
    res.status(429).json({ error: "Terlalu banyak upload. Coba lagi dalam 1 jam." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Tidak ada foto yang diupload" });
    return;
  }
  if (!VENDOR_PHOTO_ALLOWED_MIME.has(req.file.mimetype)) {
    res.status(415).json({ error: "Hanya file gambar (JPEG, PNG, WEBP) yang diizinkan." });
    return;
  }

  // MIME whitelist: reject non-image types
  if (!ALLOWED_PHOTO_MIME.has(req.file.mimetype)) {
    res.status(400).json({ error: "Hanya file gambar (JPG, PNG, WebP, GIF) yang diizinkan." });
    return;
  }
  // Magic-byte validation: confirm file content matches claimed type
  if (!isAllowedImageMagicBytes(req.file.buffer)) {
    res.status(400).json({ error: "File tidak valid — konten tidak sesuai tipe gambar." });
    return;
  }

  try {
    const objectId = randomUUID();
    const subPath = `vendor-photos/${objectId}`;
    const photoUrl = await objectStorage.uploadPublicRaw(subPath, req.file.buffer, req.file.mimetype);
    res.json({ url: photoUrl, objectPath: subPath });
  } catch (err) {
    req.log?.error({ err }, "vendor-response photo upload error");
    res.status(500).json({ error: "Gagal upload foto" });
  }
});

router.post("/:orderNumber", async (req: Request, res: Response) => {
  const orderNumber = req.params["orderNumber"] as string;
  const token = String((req.query.t ?? (req.body as Record<string, unknown>)?.token ?? "")).trim();
  if (!verifyVendorResponseToken(orderNumber, token)) {
    res.status(403).json({ error: "Link tidak valid atau sudah kadaluarsa" });
    return;
  }
  const {
    vendorName,
    status,
    estimatedPickupTime,
    driverName,
    driverPhone,
    plateNumber,
    vehicleType,
    notes,
    unitPhotoUrl,
    quotedPrice,
  } = req.body as Record<string, string>;

  if (!status || !["READY", "NOT_READY"].includes(status)) {
    res.status(400).json({ error: "Status harus READY atau NOT_READY" });
    return;
  }

  try {
    const [order] = await db
      .select({ id: logisticOrdersTable.id, orderNumber: logisticOrdersTable.orderNumber, status: logisticOrdersTable.status })
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.orderNumber, orderNumber));

    if (!order) {
      res.status(404).json({ error: "Order tidak ditemukan" });
      return;
    }

    // [CRITICAL-B] Block submission on terminal orders: vendor must not overwrite
    // data after the order has been confirmed/completed/cancelled.
    const TERMINAL_STATUSES = ["Customer Approved", "Customer Confirmed", "Completed", "Done", "Cancelled"];
    if (TERMINAL_STATUSES.includes(order.status)) {
      res.status(409).json({ error: "Order sudah dalam status final. Response tidak dapat diubah." });
      return;
    }

    // Resubmit guard: block rapid re-submissions (within 5 minutes)
    // Prevents vendors from spamming updates and overwriting accepted responses.
    const [existingForGuard] = await db
      .select({ submittedAt: vendorResponsesTable.submittedAt })
      .from(vendorResponsesTable)
      .where(eq(vendorResponsesTable.orderNumber, orderNumber));
    if (existingForGuard?.submittedAt) {
      const ageMs = Date.now() - new Date(existingForGuard.submittedAt).getTime();
      if (ageMs < 5 * 60 * 1000) {
        res.status(429).json({
          error: "Response baru saja dikirim. Tunggu 5 menit sebelum mengirim ulang.",
        });
        return;
      }
    }

    const payload = {
      orderNumber,
      orderId: order.id,
      vendorName: vendorName ?? null,
      status,
      estimatedPickupTime: estimatedPickupTime ?? null,
      driverName: driverName ?? null,
      driverPhone: driverPhone ?? null,
      plateNumber: plateNumber ?? null,
      vehicleType: vehicleType ?? null,
      notes: notes ?? null,
      unitPhotoUrl: unitPhotoUrl ?? null,
      quotedPrice: quotedPrice ? String(quotedPrice) : null,
      submittedAt: new Date(),
    };

    // Atomic upsert — INSERT on first submit, UPDATE on re-submit.
    // The unique index on order_number (vendor_responses_order_uidx) prevents
    // duplicate rows even under concurrent requests (no TOCTOU window).
    const { id: _id, ...updatePayload } = payload as typeof payload & { id?: unknown };
    void _id;
    await db
      .insert(vendorResponsesTable)
      .values(payload)
      .onConflictDoUpdate({
        target: vendorResponsesTable.orderNumber,
        set: updatePayload,
      });

    const waMsg = formatWaAdminNotification({ ...payload });
    const adminGroupWa = await getAdminGroupWa();
    if (adminGroupWa) {
      sendWhatsApp(adminGroupWa, waMsg).catch((err) =>
        req.log?.error({ err }, "vendor-response admin group WA send failed")
      );
    } else {
      req.log?.warn("Admin WA group not configured — skipping vendor response notification");
    }

    res.json({ success: true, message: "Response berhasil dikirim" });
  } catch (err) {
    req.log?.error({ err }, "vendor-response POST error");
    res.status(500).json({ error: "Gagal menyimpan response" });
  }
});


export { router as vendorResponseRouter };

/**
 * Order Fulfillment Flow
 * - Admin: POST /api/logistic/orders/:orderId/send-fulfillment  → kirim form ke vendor
 * - Admin: GET  /api/logistic/orders/:orderId/fulfillment        → lihat data fulfillment
 * - Public: GET  /api/fulfillment/:token                         → ambil form info
 * - Public: POST /api/fulfillment/:token                         → vendor submit
 */
import { Router, type Request, type Response } from "express";
import { randomBytes, randomUUID } from "crypto";
import { eq, desc, sql } from "drizzle-orm";
import {
  db,
  logisticOrdersTable,
  suppliersTable,
  orderFulfillmentLinksTable,
  orderFulfillmentSubmissionsTable,
  orderUpdatesTable,
  vendorFulfillmentLinksTable,
  driverJobsTable,
  driversTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminWa, getAdminGroupWa } from "../lib/adminWa.js";
import { normalizePhone } from "../lib/phoneUtils.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import { resolveServiceCategory } from "@workspace/logistics-constants";
import { updateOrderProgress } from "../lib/orderProgress.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { compressImageBuffer } from "../lib/imageCompress.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { imageUpload } from "../lib/uploadMiddleware.js";

const objectStorageService = new ObjectStorageService();
const podUpload = imageUpload(15);

// ─────────────────────────────────────────────────────────────────────────────
// Migration (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

export async function runOrderFulfillmentMigration() {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS order_fulfillment_links (
        id          SERIAL PRIMARY KEY,
        order_id    INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        vendor_id   INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        service_type TEXT NOT NULL,
        token       TEXT NOT NULL UNIQUE,
        status      TEXT NOT NULL DEFAULT 'pending',
        sent_at     TIMESTAMPTZ,
        expires_at  TIMESTAMPTZ,
        submitted_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_fulfillment_submissions (
        id           SERIAL PRIMARY KEY,
        link_id      INTEGER NOT NULL REFERENCES order_fulfillment_links(id) ON DELETE CASCADE,
        order_id     INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        service_type TEXT NOT NULL,
        fulfillment_data JSONB NOT NULL,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_pod_submissions (
        id            SERIAL PRIMARY KEY,
        order_id      INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        receiver_name TEXT,
        photo_url     TEXT,
        note          TEXT,
        submitted_by  TEXT,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS ofl_order_idx  ON order_fulfillment_links(order_id);
      CREATE INDEX IF NOT EXISTS ofl_token_idx  ON order_fulfillment_links(token);
      CREATE INDEX IF NOT EXISTS ofs_order_idx  ON order_fulfillment_submissions(order_id);
      CREATE INDEX IF NOT EXISTS ofs_link_idx   ON order_fulfillment_submissions(link_id);
      CREATE INDEX IF NOT EXISTS opod_order_idx ON order_pod_submissions(order_id);
    `);
    logger.info("Order fulfillment migration: ok");
  } catch (err) {
    logger.warn({ err }, "Order fulfillment migration warn");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const tok = () => randomBytes(24).toString("hex");

function getBaseUrl(): string {
  const d = getPreferredDomain();
  return d ? `https://${d}` : "";
}

/** Field definitions per category */
const FIELD_DEFS: Record<string, { key: string; label: string; type: "text" | "textarea" | "datetime-local"; required: boolean; placeholder?: string }[]> = {
  trucking: [
    { key: "driver_name",      label: "Nama Driver",             type: "text",           required: true,  placeholder: "Nama lengkap driver" },
    { key: "driver_phone",     label: "No. HP Driver",           type: "text",           required: true,  placeholder: "Contoh: 0812xxxx" },
    { key: "vehicle_plate",    label: "Plat Nomor Kendaraan",    type: "text",           required: true,  placeholder: "Contoh: B 1234 XYZ" },
    { key: "vehicle_type",     label: "Jenis Kendaraan",         type: "text",           required: true,  placeholder: "Contoh: CDE / Fuso / Engkel" },
    { key: "pickup_time",      label: "Waktu Pickup",            type: "datetime-local", required: true },
    { key: "operational_note", label: "Catatan Operasional",     type: "textarea",       required: false, placeholder: "Instruksi khusus, kendala, dll." },
  ],
  freight: [
    { key: "carrier_name",    label: "Nama Carrier / Maskapai", type: "text",           required: true,  placeholder: "Contoh: Garuda Cargo, Salam Pacific" },
    { key: "booking_number",  label: "Nomor Booking",           type: "text",           required: true,  placeholder: "Nomor booking dari carrier" },
    { key: "awb_or_bl_number",label: "AWB / BL Number",         type: "text",           required: false, placeholder: "Air Waybill atau Bill of Lading" },
    { key: "etd",             label: "ETD (Tgl Keberangkatan)", type: "datetime-local", required: true },
    { key: "eta",             label: "ETA (Tgl Tiba)",          type: "datetime-local", required: true },
    { key: "cutoff_time",     label: "Cutoff Time",             type: "datetime-local", required: false },
    { key: "operational_note",label: "Catatan Operasional",     type: "textarea",       required: false, placeholder: "Informasi tambahan dari carrier..." },
  ],
  product: [
    { key: "stock_available",  label: "Stok Tersedia",           type: "text",     required: true,  placeholder: "Jumlah stok yang bisa dipenuhi" },
    { key: "confirmed_qty",    label: "Qty Dikonfirmasi",        type: "text",     required: true,  placeholder: "Jumlah yang akan dikirim" },
    { key: "ready_date",       label: "Tanggal Siap Kirim",      type: "text",     required: true,  placeholder: "Contoh: 28 Mei 2026" },
    { key: "source_warehouse", label: "Gudang Asal",             type: "text",     required: true,  placeholder: "Nama / lokasi gudang" },
    { key: "batch_or_serial",  label: "Batch / Serial Number",   type: "text",     required: false, placeholder: "Nomor batch atau serial" },
    { key: "delivery_note",    label: "Catatan Pengiriman",      type: "textarea", required: false, placeholder: "Instruksi packing, SLA, dll." },
  ],
  customs: [
    { key: "pic_name",          label: "Nama PIC",                type: "text",     required: true,  placeholder: "Nama penanggung jawab proses" },
    { key: "pic_phone",         label: "No. HP PIC",              type: "text",     required: true,  placeholder: "Contoh: 0812xxxx" },
    { key: "required_documents",label: "Dokumen yang Diperlukan", type: "textarea", required: true,  placeholder: "Invoice, Packing List, COO, dll." },
    { key: "process_eta",       label: "Estimasi Selesai Proses", type: "text",     required: true,  placeholder: "Contoh: 3–5 hari kerja" },
    { key: "clearance_note",    label: "Catatan Customs",         type: "textarea", required: false, placeholder: "Hambatan dokumen, catatan HS code, dll." },
  ],
};

const CATEGORY_LABELS: Record<string, string> = {
  trucking: "Trucking",
  freight: "Freight (Sea/Air)",
  product: "Produk / Barang",
  customs: "Customs / Handling",
};

// ─────────────────────────────────────────────────────────────────────────────
// Admin Router  (mounted under /api/logistic)
// ─────────────────────────────────────────────────────────────────────────────

export const fulfillmentAdminRouter = Router();

// POST /api/logistic/orders/:orderId/send-fulfillment
fulfillmentAdminRouter.post("/orders/:orderId/send-fulfillment", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { expiresInDays, customNote } = req.body as { expiresInDays?: number; customNote?: string };

  try {
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const vendor = order.approvedVendorId
      ? (await db.select().from(suppliersTable).where(eq(suppliersTable.id, order.approvedVendorId)))[0] ?? null
      : null;

    const category = resolveServiceCategory(order.shipmentType);
    const token = tok();
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86_400_000)
      : new Date(Date.now() + 7 * 86_400_000);

    const [link] = await db.insert(orderFulfillmentLinksTable).values({
      orderId,
      vendorId: vendor?.id ?? null,
      serviceType: category,
      token,
      status: "pending",
      sentAt: new Date(),
      expiresAt,
    }).returning();

    // Log activity
    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: "In Progress",
      notes: `Form fulfillment dikirim ke vendor${vendor ? ` (${vendor.name})` : ""}. Tipe: ${CATEGORY_LABELS[category] ?? category}.`,
      isPublic: false,
    });

    await transitionLogisticOrderStatus(orderId, "In Progress", {
      actorType: "admin",
      actorName: "Admin",
      source: "orderFulfillment/send-fulfillment",
      force: true,
      skipAudit: false,
    });

    const formUrl = `${getBaseUrl()}/fulfillment/${token}`;

    // Send WA to vendor
    const vendorPhone = vendor?.phone ?? null;
    if (vendorPhone) {
      const waMsg =
        `📋 *Form Fulfillment Order — B2B Marketplace and Logistic*\n\n` +
        `Order: *${order.orderNumber}*\n` +
        `Layanan: ${order.shipmentType}\n` +
        `Rute: ${order.origin} → ${order.destination}\n` +
        (customNote ? `\nCatatan: ${customNote}\n` : "") +
        `\nSilakan isi form fulfillment melalui link berikut:\n${formUrl}\n\n` +
        `_Link berlaku hingga ${expiresAt.toLocaleDateString("id-ID")}._`;
      sendWhatsApp(vendorPhone, waMsg).catch((e) =>
        logger.warn({ e }, "fulfillment WA to vendor failed")
      );
    }

    updateOrderProgress(orderId, "SENT_TO_VENDOR_FULFILLMENT", "admin", "Admin",
      `Form fulfillment dikirim ke vendor${vendor ? ` (${vendor.name})` : ""}`).catch(() => {});

    logger.info({ orderId, token, category }, "Fulfillment form sent");
    return res.status(201).json({
      ok: true, token, formUrl, link,
      vendorPhone, category,
    });
  } catch (err) {
    logger.error({ err }, "send-fulfillment error");
    return res.status(500).json({ message: "Gagal mengirim form fulfillment" });
  }
});

// POST /api/logistic/orders/:orderId/resend-fulfillment-wa
fulfillmentAdminRouter.post("/orders/:orderId/resend-fulfillment-wa", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  try {
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    // Cari vendor fulfillment link terbaru (belum submitted) untuk order ini
    const [vfLink] = await db.select().from(vendorFulfillmentLinksTable)
      .where(eq(vendorFulfillmentLinksTable.orderId, orderId))
      .orderBy(desc(vendorFulfillmentLinksTable.createdAt))
      .limit(1);

    if (!vfLink) return res.status(404).json({ message: "Tidak ada link fulfillment vendor untuk order ini" });

    const domain = getPreferredDomain() || "cstlogistic.co.id";
    const formUrl = `https://${domain}/vendor-fulfillment/${vfLink.token}`;

    const vendor = vfLink.vendorId
      ? (await db.select().from(suppliersTable).where(eq(suppliersTable.id, vfLink.vendorId)))[0] ?? null
      : null;

    const vendorPhone = vendor?.phone ?? null;
    if (vendorPhone) {
      const waMsg =
        `📋 *[Kirim Ulang] Form Fulfillment Order — B2B Marketplace and Logistic*\n\n` +
        `Order: *${order.orderNumber}*\n` +
        `Layanan: ${order.shipmentType ?? "—"}\n` +
        ((order.origin && order.destination) ? `Rute: ${order.origin} → ${order.destination}\n` : "") +
        `\nSilakan isi form fulfillment melalui link berikut:\n${formUrl}`;
      sendWhatsApp(vendorPhone, waMsg).catch((e) =>
        logger.warn({ e }, "resend-fulfillment-wa to vendor failed")
      );
    }

    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: order.status ?? "In Progress",
      notes: `WA fulfillment dikirim ulang ke vendor${vendor ? ` (${vendor.name})` : ""}.`,
      isPublic: false,
    }).catch(() => {});

    return res.json({ ok: true, formUrl, vendorPhone, vendorName: vendor?.name ?? null });
  } catch (err) {
    logger.error({ err }, "resend-fulfillment-wa error");
    return res.status(500).json({ message: "Gagal kirim ulang WA fulfillment" });
  }
});

// PATCH /api/logistic/orders/:orderId/extend-fulfillment
fulfillmentAdminRouter.patch("/orders/:orderId/extend-fulfillment", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { extraHours = 72 } = req.body as { extraHours?: number };
  const hours = Math.min(Math.max(Number(extraHours) || 72, 1), 720);

  try {
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const [vfLink] = await db.select().from(vendorFulfillmentLinksTable)
      .where(eq(vendorFulfillmentLinksTable.orderId, orderId))
      .orderBy(desc(vendorFulfillmentLinksTable.createdAt))
      .limit(1);

    if (!vfLink) return res.status(404).json({ message: "Tidak ada link fulfillment untuk order ini" });
    if (vfLink.status !== "pending") return res.status(400).json({ message: "Link fulfillment sudah disubmit, tidak bisa diperpanjang" });

    const newExpiry = new Date(Date.now() + hours * 3600_000);
    await db.update(vendorFulfillmentLinksTable)
      .set({ expiresAt: newExpiry })
      .where(eq(vendorFulfillmentLinksTable.id, vfLink.id));

    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: order.status ?? "Processing",
      notes: `Expiry link fulfillment vendor diperpanjang +${hours} jam (sampai ${newExpiry.toLocaleString("id-ID")}).`,
      isPublic: false,
    }).catch(() => {});

    return res.json({ ok: true, newExpiresAt: newExpiry.toISOString(), hours });
  } catch (err) {
    logger.error({ err }, "extend-fulfillment error");
    return res.status(500).json({ message: "Gagal memperpanjang expiry link" });
  }
});

// ─── Helper: extract display data from vendor_fulfillment_links row ───────────
const VF_FIELD_KEYS = [
  "stockConfirmed", "qtyConfirmed", "readyDate", "leadTime", "warehouseLocation",
  "priceConfirmed", "revisedPrice", "driverName", "driverPhone", "plateNumber",
  "vehicleType", "pickupTime", "carrierName", "awbBlNumber", "flightVessel",
  "bookingNumber", "etd", "eta", "customsPicName", "customsDocuments",
  "customsProcessEta", "deliveryMethod",
  "stockPhotoUrl", "packingListUrl", "invoiceUrl", "podUrl", "supportingDocUrl", "notes",
] as const;

function extractVfData(l: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of VF_FIELD_KEYS) {
    const v = l[k];
    if (v != null && v !== "") out[k] = String(v);
  }
  return out;
}

// Offset to avoid ID collision between old (order_fulfillment_links) and new (vendor_fulfillment_links)
const VF_ID_OFFSET = 10_000_000;

// GET /api/logistic/orders/:orderId/fulfillment
fulfillmentAdminRouter.get("/orders/:orderId/fulfillment", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  try {
    const [oldLinks, oldSubs, vfLinks] = await Promise.all([
      db.select().from(orderFulfillmentLinksTable)
        .where(eq(orderFulfillmentLinksTable.orderId, orderId))
        .orderBy(desc(orderFulfillmentLinksTable.createdAt)),
      db.select().from(orderFulfillmentSubmissionsTable)
        .where(eq(orderFulfillmentSubmissionsTable.orderId, orderId))
        .orderBy(desc(orderFulfillmentSubmissionsTable.createdAt)),
      db.select().from(vendorFulfillmentLinksTable)
        .where(eq(vendorFulfillmentLinksTable.orderId, orderId))
        .orderBy(desc(vendorFulfillmentLinksTable.createdAt)),
    ]);

    const podRows = await db.execute(sql`
      SELECT id, order_id, receiver_name, photo_url, note, submitted_by, created_at
      FROM order_pod_submissions
      WHERE order_id = ${orderId}
      ORDER BY created_at DESC
      LIMIT 5
    `);

    // Driver POD data — query driver_jobs joined with drivers (NO pricing fields)
    const driverPodRows = await db.execute(sql`
      SELECT
        dj.id,
        dj.job_number,
        dj.status,
        dj.pod_receiver_name,
        dj.pod_receiver_position,
        dj.pod_notes,
        dj.pod_photos,
        dj.pod_submitted_at,
        dj.pod_geo_lat,
        dj.pod_geo_lng,
        dj.pod_device_timestamp,
        dj.pod_map_url,
        dj.pod_street_view_url,
        dj.pod_signature_data_url,
        d.name  AS driver_name,
        d.phone AS driver_phone,
        d.vehicle_plate
      FROM driver_jobs dj
      LEFT JOIN drivers d ON dj.driver_id = d.id
      WHERE dj.logistic_order_id = ${orderId}
      ORDER BY dj.created_at DESC
    `);

    const base = getBaseUrl();

    const mergedLinks = [
      ...oldLinks.map(l => ({ ...l, formUrl: `${base}/fulfillment/${l.token}` })),
      ...vfLinks.map(l => ({
        id: VF_ID_OFFSET + l.id,
        orderId: l.orderId,
        vendorId: l.vendorId ?? null,
        serviceType: l.serviceType,
        token: l.token,
        status: l.status,
        sentAt: null,
        expiresAt: l.expiresAt?.toISOString() ?? null,
        submittedAt: l.submittedAt?.toISOString() ?? null,
        createdAt: (l.createdAt as Date | null)?.toISOString() ?? null,
        formUrl: `${base}/vendor-fulfillment/${l.token}`,
      })),
    ];

    const mergedSubs = [
      ...oldSubs,
      ...vfLinks
        .filter(l => l.status === "submitted")
        .map(l => ({
          id: VF_ID_OFFSET + l.id,
          linkId: VF_ID_OFFSET + l.id,
          orderId: l.orderId,
          serviceType: l.serviceType,
          fulfillmentData: extractVfData(l as unknown as Record<string, unknown>),
          submittedAt: l.submittedAt?.toISOString() ?? new Date().toISOString(),
          createdAt: l.submittedAt?.toISOString() ?? null,
        })),
    ];

    // Parse pod_photos JSON strings and sanitize driver POD rows (no pricing fields)
    const driverPods = (driverPodRows.rows as Record<string, unknown>[]).map(row => ({
      id: row.id,
      jobNumber: row.job_number,
      status: row.status,
      podReceiverName: row.pod_receiver_name,
      podReceiverPosition: row.pod_receiver_position,
      podNotes: row.pod_notes,
      podPhotos: (() => {
        try { return row.pod_photos ? JSON.parse(String(row.pod_photos)) as string[] : []; }
        catch { return []; }
      })(),
      podSubmittedAt: row.pod_submitted_at ? new Date(String(row.pod_submitted_at)).toISOString() : null,
      podGeoLat: row.pod_geo_lat,
      podGeoLng: row.pod_geo_lng,
      podDeviceTimestamp: row.pod_device_timestamp ? new Date(String(row.pod_device_timestamp)).toISOString() : null,
      podMapUrl: row.pod_map_url ? String(row.pod_map_url) : null,
      podStreetViewUrl: row.pod_street_view_url ? String(row.pod_street_view_url) : null,
      podSignatureDataUrl: row.pod_signature_data_url ? String(row.pod_signature_data_url) : null,
      driverName: row.driver_name,
      driverPhone: row.driver_phone,
      vehiclePlate: row.vehicle_plate,
    }));

    return res.json({ links: mergedLinks, submissions: mergedSubs, pods: podRows.rows, driverPods });
  } catch (err) {
    logger.error({ err }, "get-fulfillment error");
    return res.status(500).json({ message: "Gagal memuat data fulfillment" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Router  (mounted under /api/fulfillment)
// ─────────────────────────────────────────────────────────────────────────────

export const fulfillmentPublicRouter = Router();

// GET /api/fulfillment/:token
fulfillmentPublicRouter.get("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  try {
    const [link] = await db.select().from(orderFulfillmentLinksTable)
      .where(eq(orderFulfillmentLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan atau sudah tidak aktif." });

    const isExpired = link.expiresAt && link.expiresAt < new Date();
    if (isExpired) return res.status(410).json({ error: "Link ini sudah kedaluwarsa." });

    if (link.status === "submitted") {
      return res.status(409).json({ error: "Form ini sudah pernah disubmit. Terima kasih!" });
    }

    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });

    const vendor = link.vendorId
      ? (await db.select({ id: suppliersTable.id, name: suppliersTable.name })
          .from(suppliersTable).where(eq(suppliersTable.id, link.vendorId)))[0] ?? null
      : null;

    const fields = FIELD_DEFS[resolveServiceCategory(link.serviceType)];

    return res.json({
      token,
      orderId: order.id,
      orderNumber: order.orderNumber,
      shipmentType: order.shipmentType,
      origin: order.origin,
      destination: order.destination,
      commodity: order.commodity ?? null,
      cargoDescription: order.cargoDescription ?? null,
      grossWeight: order.grossWeight ?? null,
      expiresAt: link.expiresAt?.toISOString() ?? null,
      serviceType: link.serviceType,
      categoryLabel: CATEGORY_LABELS[link.serviceType] ?? link.serviceType,
      vendorName: vendor?.name ?? null,
      fields,
    });
  } catch (err) {
    logger.error({ err }, "get-fulfillment-form error");
    return res.status(500).json({ error: "Terjadi kesalahan server." });
  }
});

// POST /api/fulfillment/:token
fulfillmentPublicRouter.post("/:token", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const body = req.body as Record<string, unknown>;

  try {
    const [link] = await db.select().from(orderFulfillmentLinksTable)
      .where(eq(orderFulfillmentLinksTable.token, token));
    if (!link) return res.status(404).json({ error: "Link tidak ditemukan atau sudah tidak aktif." });

    const isExpired = link.expiresAt && link.expiresAt < new Date();
    if (isExpired) return res.status(410).json({ error: "Link sudah kedaluwarsa." });

    if (link.status === "submitted") {
      return res.status(409).json({ error: "Form ini sudah pernah disubmit." });
    }

    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, link.orderId));
    if (!order) return res.status(404).json({ error: "Order tidak ditemukan." });

    // Validate required fields
    const fields = FIELD_DEFS[resolveServiceCategory(link.serviceType)];
    const missing = fields.filter(f => f.required && !String(body[f.key] ?? "").trim());
    if (missing.length > 0) {
      return res.status(400).json({ error: `Field wajib belum diisi: ${missing.map(f => f.label).join(", ")}` });
    }

    // Save submission
    const now = new Date();
    await db.insert(orderFulfillmentSubmissionsTable).values({
      linkId: link.id,
      orderId: link.orderId,
      serviceType: link.serviceType,
      fulfillmentData: body as object,
    });

    // Mark link as submitted
    await db.update(orderFulfillmentLinksTable)
      .set({ status: "submitted", submittedAt: now })
      .where(eq(orderFulfillmentLinksTable.token, token));

    // Update order status → Vendor Confirmed
    await transitionLogisticOrderStatus(link.orderId, "Vendor Confirmed", {
      actorType: "vendor",
      actorName: "Vendor",
      source: "orderFulfillment/vendor-submit",
      force: true,
      skipAudit: false,
    });

    // Activity log
    const summaryLines = fields
      .map(f => `${f.label}: ${String(body[f.key] ?? "").trim() || "—"}`)
      .join("\n");

    await db.insert(orderUpdatesTable).values({
      orderId: link.orderId,
      actorType: "vendor",
      actorName: "Vendor",
      status: "Vendor Confirmed",
      notes: `Vendor mengisi form fulfillment.\n\n${summaryLines}`,
      isPublic: true,
    });

    // Notify admin via WA
    const adminWa = await getAdminWa();
    if (adminWa) {
      const adminLink = `${getBaseUrl()}/bizportal/logistics/orders/${link.orderId}`;
      const waMsg =
        `✅ *Vendor Mengisi Form Fulfillment*\n\n` +
        `Order: *${order.orderNumber}*\n` +
        `Rute: ${order.origin} → ${order.destination}\n` +
        `Tipe: ${CATEGORY_LABELS[link.serviceType] ?? link.serviceType}\n\n` +
        `Ringkasan:\n${summaryLines}\n\n` +
        `Lihat order: ${adminLink}`;
      sendWhatsApp(adminWa, waMsg).catch((e) =>
        logger.warn({ e }, "fulfillment WA to admin failed")
      );
    }

    // ── WA ke driver (legacy path: order_fulfillment_links) ───────────────────
    const _driverPhoneRawOF = String((body as any).driverPhone ?? "").trim();
    const _driverPhoneOF    = _driverPhoneRawOF ? normalizePhone(_driverPhoneRawOF) : "";
    const driverNameOF      = String((body as any).driverName ?? "Driver").trim();
    logger.info({
      orderId:          link.orderId,
      orderNumber:      order.orderNumber,
      fulfillmentType:  link.serviceType,
      svcCategory:      resolveServiceCategory(link.serviceType),
      driverPhoneRaw:   _driverPhoneRawOF  || "(kosong)",
      driverPhoneNorm:  _driverPhoneOF     || "(kosong)",
      driverName:       driverNameOF       || "(kosong)",
      plateNumber:      String((body as any).plateNumber ?? "") || "(kosong)",
      vehicleType:      String((body as any).vehicleType ?? "") || "(kosong)",
      pickupTime:       String((body as any).pickupTime  ?? "") || "(kosong)",
    }, "[WA-driver] orderFulfillment (legacy) cek kirim WA ke driver");

    if (_driverPhoneOF) {
      const driverAppUrl = `${getBaseUrl()}/driver`;
      const waDriver = [
        `🚛 *Konfirmasi Job Order*`,
        ``,
        `Halo *${driverNameOF}*,`,
        `Anda telah dikonfirmasi untuk menjalankan pengiriman berikut:`,
        ``,
        `📦 *Order*    : ${order.orderNumber}`,
        `📍 *Rute*     : ${order.origin} → ${order.destination}`,
        String((body as any).plateNumber ?? "").trim() ? `🚗 *Plat*      : ${String((body as any).plateNumber).trim()}` : null,
        String((body as any).vehicleType ?? "").trim() ? `🚐 *Kendaraan* : ${String((body as any).vehicleType).trim()}` : null,
        String((body as any).pickupTime  ?? "").trim() ? `🕐 *Pickup*    : ${String((body as any).pickupTime).trim()}` : null,
        ``,
        `📱 Driver App: ${driverAppUrl}`,
      ].filter(Boolean).join("\n");

      logger.info({
        orderId:         link.orderId,
        driverPhoneRaw:  _driverPhoneRawOF,
        driverPhoneNorm: _driverPhoneOF,
        driverName:      driverNameOF || "(kosong)",
      }, "[WA-driver] orderFulfillment (legacy) mengirim WA ke driver...");

      sendWhatsApp(_driverPhoneOF, waDriver, {
        context: "fulfillment-driver-assigned",
        refType:  "order_fulfillment_link",
        refId:    String(link.id),
      })
        .then(() => logger.info({ orderId: link.orderId, driverPhoneNorm: _driverPhoneOF, orderNumber: order.orderNumber }, "[WA-driver] orderFulfillment (legacy) WA ke driver BERHASIL"))
        .catch((e) => logger.error({ e, orderId: link.orderId, driverPhoneNorm: _driverPhoneOF, orderNumber: order.orderNumber }, "[WA-driver] orderFulfillment (legacy) WA ke driver GAGAL"));
    } else {
      logger.info({
        orderId:         link.orderId,
        skip_reason:     "driverPhone kosong",
        fulfillmentType: link.serviceType,
      }, "[WA-driver] orderFulfillment (legacy) skip — tidak kirim WA ke driver");
    }

    updateOrderProgress(link.orderId, "VENDOR_FULFILLMENT_CONFIRMED", "vendor_wa", "Vendor",
      "Vendor mengisi form fulfillment").catch(() => {});

    logger.info({ orderId: link.orderId, token }, "Fulfillment submitted by vendor");
    return res.status(201).json({ ok: true, message: "Data berhasil disimpan. Terima kasih!" });
  } catch (err) {
    logger.error({ err }, "submit-fulfillment error");
    return res.status(500).json({ error: "Terjadi kesalahan server. Coba lagi." });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Konfirmasi fulfillment → In Progress + WA ke customer
// POST /api/logistic/orders/:orderId/confirm-fulfillment
// ─────────────────────────────────────────────────────────────────────────────

fulfillmentAdminRouter.post("/orders/:orderId/confirm-fulfillment", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  try {
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const allowedStatuses = ["Vendor Confirmed", "In Progress"];
    if (!allowedStatuses.includes(order.status)) {
      return res.status(400).json({ message: `Status saat ini "${order.status}" tidak bisa dikonfirmasi.` });
    }

    // Ambil submission terbaru: cek old system dulu, lalu vendor_fulfillment_links (new system)
    const [latestOldSub] = await db.select()
      .from(orderFulfillmentSubmissionsTable)
      .where(eq(orderFulfillmentSubmissionsTable.orderId, orderId))
      .orderBy(desc(orderFulfillmentSubmissionsTable.createdAt))
      .limit(1);
    const [latestVfLink] = await db.select()
      .from(vendorFulfillmentLinksTable)
      .where(eq(vendorFulfillmentLinksTable.orderId, orderId))
      .orderBy(desc(vendorFulfillmentLinksTable.createdAt))
      .limit(1);
    const latestSub = latestOldSub ?? null;
    // For WA detail lines, merge both sources
    const vfFulfillmentData = latestVfLink?.status === "submitted"
      ? extractVfData(latestVfLink as unknown as Record<string, unknown>)
      : null;

    await transitionLogisticOrderStatus(orderId, "In Progress", {
      actorType: "admin",
      actorName: "Admin",
      source: "orderFulfillment/confirm-fulfillment",
      skipAudit: false,
    });

    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: "In Progress",
      notes: "Admin mengkonfirmasi data fulfillment. Order sedang diproses / dalam perjalanan.",
      isPublic: true,
    });

    // Kirim WA ke customer
    const customerPhone = order.phone?.trim();
    if (customerPhone) {
      const domain = getBaseUrl();
      let detailLines = "";
      const FIELD_LABELS: Record<string, string> = {
        driver_name: "Driver", driverName: "Driver",
        driver_phone: "HP Driver", driverPhone: "HP Driver",
        vehicle_plate: "Plat Nomor", plateNumber: "Plat Nomor",
        vehicle_type: "Jenis Kendaraan", vehicleType: "Jenis Kendaraan",
        pickup_time: "Waktu Pickup", pickupTime: "Waktu Pickup",
        carrier_name: "Carrier", carrierName: "Carrier",
        booking_number: "Nomor Booking", bookingNumber: "Nomor Booking",
        awb_or_bl_number: "AWB / BL", awbBlNumber: "AWB / BL",
        etd: "ETD", eta: "ETA",
        ready_date: "Siap Kirim", readyDate: "Siap Kirim",
        source_warehouse: "Gudang Asal", warehouseLocation: "Gudang Asal",
        operational_note: "Catatan", notes: "Catatan",
        stockConfirmed: "Status Stok", qtyConfirmed: "Qty Dipenuhi",
        leadTime: "Lead Time", priceConfirmed: "Konfirmasi Harga",
        revisedPrice: "Harga Revisi",
      };
      const fdSource: Record<string, string> = {
        ...(latestSub?.fulfillmentData as Record<string, string> ?? {}),
        ...(vfFulfillmentData ?? {}),
      };
      if (Object.keys(fdSource).length > 0) {
        const lines = Object.entries(fdSource)
          .filter(([, v]) => v?.trim() && !v.startsWith("http"))
          .map(([k, v]) => `  • ${FIELD_LABELS[k] ?? k.replace(/_/g, " ")}: ${v}`)
          .join("\n");
        if (lines) detailLines = `\n\nDetail operasional:\n${lines}`;
      }
      const trackUrl = domain ? `\n\nCek status order: ${domain}/track` : "";
      const waMsg =
        `🚀 *Order Anda Sedang Diproses — B2B Marketplace and Logistic*\n\n` +
        `Halo ${order.customerName},\n\n` +
        `Order *${order.orderNumber}* (${order.shipmentType}) sedang dalam proses pengiriman.\n` +
        `Rute: ${order.origin} → ${order.destination}` +
        detailLines +
        trackUrl;
      sendWhatsApp(customerPhone, waMsg).catch((e) =>
        logger.warn({ e }, "confirm-fulfillment WA to customer failed")
      );
    }

    logger.info({ orderId }, "Fulfillment confirmed → In Progress");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "confirm-fulfillment error");
    return res.status(500).json({ message: "Gagal konfirmasi fulfillment" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Selesaikan order → Completed + WA ke customer
// POST /api/logistic/orders/:orderId/complete-order
// ─────────────────────────────────────────────────────────────────────────────

fulfillmentAdminRouter.post("/orders/:orderId/complete-order", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const { note } = req.body as { note?: string };

  try {
    const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const allowedStatuses = ["In Progress", "Vendor Confirmed"];
    if (!allowedStatuses.includes(order.status)) {
      return res.status(400).json({ message: `Status saat ini "${order.status}" tidak bisa diselesaikan dari sini.` });
    }

    await transitionLogisticOrderStatus(orderId, "Completed", {
      actorType: "admin",
      actorName: "Admin",
      source: "orderFulfillment/complete-order",
      force: true,
      skipAudit: false,
    });

    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: "Completed",
      notes: note?.trim()
        ? `Order diselesaikan oleh admin. Catatan: ${note.trim()}`
        : "Order telah diselesaikan oleh admin.",
      isPublic: true,
    });

    // WA ke customer
    const customerPhone = order.phone?.trim();
    if (customerPhone) {
      const waMsg =
        `✅ *Order Selesai — B2B Marketplace and Logistic*\n\n` +
        `Halo ${order.customerName},\n\n` +
        `Order *${order.orderNumber}* (${order.shipmentType}) telah *diselesaikan*.\n` +
        `Rute: ${order.origin} → ${order.destination}\n\n` +
        (note?.trim() ? `Catatan: ${note.trim()}\n\n` : "") +
        `Terima kasih telah mempercayakan pengiriman Anda kepada B2B Marketplace and Logistic! 🙏`;
      sendWhatsApp(customerPhone, waMsg).catch((e) =>
        logger.warn({ e }, "complete-order WA to customer failed")
      );
    }

    updateOrderProgress(orderId, "COMPLETED", "admin", "Admin",
      note?.trim() ? `Order diselesaikan: ${note.trim()}` : "Order diselesaikan oleh admin").catch(() => {});

    logger.info({ orderId }, "Order completed by admin");
    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "complete-order error");
    return res.status(500).json({ message: "Gagal menyelesaikan order" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Admin: Upload Bukti Pengiriman (POD) → simpan foto, update status Completed
// POST /api/logistic/orders/:orderId/pod   (multipart/form-data)
// fields: photo (file, optional), receiverName (text), note (text)
// ─────────────────────────────────────────────────────────────────────────────

fulfillmentAdminRouter.post(
  "/orders/:orderId/pod",
  podUpload.single("photo") as any,
  async (req: Request, res: Response) => {
    if (!(await requireClerkUser(req, res))) return;
    const orderId = Number(req.params["orderId"]);
    if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

    const receiverName = (req.body?.receiverName as string | undefined)?.trim() ?? "";
    const note = (req.body?.note as string | undefined)?.trim() ?? "";
    const actor = (req as any).session?.user?.name ?? "Admin";

    try {
      const [order] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId));
      if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

      // Upload foto ke object storage jika ada
      let photoUrl: string | null = null;
      if (req.file) {
        try {
          const { buffer: compressed, contentType } = await compressImageBuffer(req.file.buffer, req.file.mimetype, "photo");
          const filename = `${randomUUID()}.jpg`;
          const storagePath = `public/pod-photos/${orderId}/${filename}`;
          await objectStorageService.uploadFile(compressed, storagePath, contentType, { skipImageCompression: true });
          photoUrl = `/api/storage/public-objects/pod-photos/${orderId}/${filename}`;
        } catch (uploadErr) {
          logger.warn({ uploadErr }, "POD photo upload failed, continuing without photo");
        }
      }

      // Simpan POD record
      await db.execute(sql`
        INSERT INTO order_pod_submissions (order_id, receiver_name, photo_url, note, submitted_by)
        VALUES (${orderId}, ${receiverName || null}, ${photoUrl}, ${note || null}, ${actor})
      `);

      // Update status → POD Uploaded (invoice + payment harus diproses sebelum Completed)
      await transitionLogisticOrderStatus(orderId, "POD Uploaded", {
        actorType: "admin",
        actorName: actor,
        source: "orderFulfillment/pod-upload",
        force: false,
        skipAudit: false,
      });

      // Activity log
      const logNote = [
        "Bukti pengiriman (POD) diupload oleh admin.",
        receiverName ? `Penerima: ${receiverName}.` : "",
        note ? `Catatan: ${note}` : "",
      ].filter(Boolean).join(" ");

      await db.insert(orderUpdatesTable).values({
        orderId,
        actorType: "admin",
        actorName: actor,
        status: "POD Uploaded",
        notes: logNote,
        isPublic: true,
      });

      // WA ke customer
      const customerPhone = order.phone?.trim();
      if (customerPhone) {
        const waMsg =
          `📄 *Bukti Pengiriman Diunggah — B2B Marketplace and Logistic*\n\n` +
          `Halo ${order.customerName},\n\n` +
          `Bukti pengiriman untuk order *${order.orderNumber}* telah diunggah oleh tim kami.\n` +
          `Rute: ${order.origin} → ${order.destination}\n` +
          (receiverName ? `Diterima oleh: *${receiverName}*\n` : "") +
          (note ? `Catatan: ${note}\n` : "") +
          `\nAdmin kami sedang memproses invoice. Anda akan mendapat notifikasi saat invoice diterbitkan. 🙏`;
        sendWhatsApp(customerPhone, waMsg).catch((e) =>
          logger.warn({ e }, "POD WA to customer failed")
        );
      }

      // WA ke admin group — prompt terbitkan invoice
      void (async () => {
        try {
          const adminGroupWa = await getAdminGroupWa();
          if (!adminGroupWa) return;
          const domain = getPreferredDomain() || "cstlogistic.co.id";
          const orderDetailUrl = `https://${domain}/bizportal/logistics/orders/${orderId}`;
          const ln = "\n";
          const sep = "━━━━━━━━━━━━━━━━━━";
          const adminMsg =
            `📷 *POD Diunggah — Tindakan Diperlukan*` + ln + sep + ln +
            `No. Order   : \`${order.orderNumber}\`` + ln +
            `Customer    : ${order.customerName}` + ln +
            ((order.origin && order.destination) ? `Rute        : ${order.origin} → ${order.destination}` + ln : "") +
            (receiverName ? `Penerima    : ${receiverName}` + ln : "") +
            (note ? `Catatan     : ${note}` + ln : "") +
            sep + ln +
            `📋 *Langkah Selanjutnya:*` + ln +
            `1️⃣  Terbitkan invoice ke customer (Invoice Diterbitkan)` + ln +
            `2️⃣  Konfirmasi pembayaran diterima (Pembayaran Diterima)` + ln +
            `3️⃣  Tandai order sebagai Selesai` + ln +
            sep + ln +
            `🔗 Detail order:` + ln + orderDetailUrl;
          sendWhatsApp(adminGroupWa, adminMsg).catch((e) =>
            logger.warn({ e }, "POD admin group WA failed — non-fatal")
          );
        } catch (e) {
          logger.warn({ e }, "POD admin group WA setup failed — non-fatal");
        }
      })();

      logger.info({ orderId, photoUrl }, "POD submitted, status → POD Uploaded");
      return res.json({ ok: true, photoUrl });
    } catch (err) {
      logger.error({ err }, "pod-submit error");
      return res.status(500).json({ message: "Gagal menyimpan bukti pengiriman" });
    }
  }
);

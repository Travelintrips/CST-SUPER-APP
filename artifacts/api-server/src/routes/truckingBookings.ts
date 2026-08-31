import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa, getAdminWa } from "../lib/adminWa.js";
import { logger } from "../lib/logger.js";
import { NotificationService } from "../lib/services/notificationService.js";
import {
  optionalCustomerPortalAuth,
  type PortalAuthReq,
} from "../lib/supabaseAuth.js";
import {
  getPortalCustomerContext,
  PortalCustomerContextError,
} from "../lib/services/portalCustomerContextService.js";
import { getEligibleTruckingVendorIds } from "../lib/truckingVendorEligibility.js";

const router = Router();

// ── Auto-create / migrate table ──────────────────────────────────────────────

db.execute(sql`
  CREATE TABLE IF NOT EXISTS trucking_booking_requests (
    id                    SERIAL PRIMARY KEY,
    booking_number        TEXT NOT NULL UNIQUE,
    customer_id           INTEGER,
    portal_customer_id    INTEGER,
    company_id            INTEGER,
    vehicle_type          TEXT NOT NULL,
    vehicle_name          TEXT NOT NULL,
    area_pickup           TEXT NOT NULL,
    alamat_pickup         TEXT NOT NULL,
    pic_pickup            TEXT NOT NULL,
    hp_pickup             TEXT NOT NULL,
    area_delivery         TEXT NOT NULL,
    alamat_delivery       TEXT NOT NULL,
    pic_penerima          TEXT NOT NULL,
    hp_penerima           TEXT NOT NULL,
    jadwal_type           TEXT NOT NULL DEFAULT 'sekarang',
    tanggal_pickup        TEXT,
    jam_pickup            TEXT,
    jenis_barang          TEXT,
    berat_kg              NUMERIC,
    jumlah_koli           INTEGER,
    volume_m3             NUMERIC,
    catatan               TEXT,
    jumlah_trip           INTEGER NOT NULL DEFAULT 1,
    addons                JSONB NOT NULL DEFAULT '{}',
    estimasi_total        NUMERIC NOT NULL DEFAULT 0,
    estimated_distance_km NUMERIC,
    estimated_price       NUMERIC,
    pricing_breakdown     JSONB,
    candidate_vendor_ids  JSONB,
    selected_vendor_id    INTEGER,
    final_price           NUMERIC,
    source                TEXT NOT NULL DEFAULT 'customer_portal',
    status                TEXT NOT NULL DEFAULT 'pending_review',
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`).catch(() => {});

// Migrate existing table — add new columns if missing
Promise.all([
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS customer_id INTEGER`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS portal_customer_id INTEGER`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS company_id INTEGER`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS estimated_distance_km NUMERIC`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS estimated_price NUMERIC`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS pricing_breakdown JSONB`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS candidate_vendor_ids JSONB`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS selected_vendor_id INTEGER`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS final_price NUMERIC`),
  db.execute(sql`ALTER TABLE trucking_booking_requests ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'customer_portal'`),
]).catch(() => {});

// ── Zod schema ───────────────────────────────────────────────────────────────

const BookingSchema = z.object({
  vehicleType:           z.string().min(1),
  vehicleName:           z.string().min(1),
  areaPickup:            z.string().min(1),
  alamatPickup:          z.string().min(1),
  picPickup:             z.string().min(1),
  hpPickup:              z.string().min(1),
  areaDelivery:          z.string().min(1),
  alamatDelivery:        z.string().min(1),
  picPenerima:           z.string().min(1),
  hpPenerima:            z.string().min(1),
  jadwalType:            z.enum(["sekarang", "nanti"]),
  tanggalPickup:         z.string().optional(),
  jamPickup:             z.string().optional(),
  jenisBarang:           z.string().optional(),
  beratKg:               z.number().nonnegative().optional(),
  jumlahKoli:            z.number().int().positive().optional(),
  volumeM3:              z.number().nonnegative().optional(),
  catatan:               z.string().optional(),
  jumlahTrip:            z.number().int().min(1),
  addons:                z.record(z.boolean()),
  estimasiTotal:         z.number().nonnegative(),
  estimatedDistanceKm:   z.number().nonnegative().optional(),
  estimatedPrice:        z.number().nonnegative().optional(),
  pricingBreakdown:      z.record(z.unknown()).optional(),
  candidateVendorIds:    z.array(z.number()).optional(),
  selectedVendorId:      z.number().int().positive().optional(),
  source:                z.string().default("customer_portal"),
});

const ReviewSchema = z.object({
  finalPrice: z.number().nonnegative().optional(),
  status:     z.string().optional(),
  note:       z.string().optional(),
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateBookingNumber(): string {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const d   = String(now.getDate()).padStart(2, "0");
  const rnd = Math.floor(100000 + Math.random() * 900000);
  return `TRK/${y}${m}${d}/${rnd}`;
}

const AREA_LABEL: Record<string, string> = {
  "jawa-sumatra": "Jawa, Sumatra",
  kalimantan:     "Kalimantan",
  sulawesi:       "Sulawesi",
  "bali-nusra":  "Bali & Nusa Tenggara",
};

const ADDON_LABEL: Record<string, string> = {
  bantuanMuat:    "Bantuan Muat",
  bantuanBongkar: "Bantuan Bongkar",
  asuransi:       "Asuransi",
  ferry:          "Ferry / Penyeberangan",
  tol:            "Tol (actual cost)",
  multiDrop:      "Multi-drop",
  urgentDelivery: "Urgent Delivery",
  overnight:      "Overnight / Sewa Seharian",
};

function formatRp(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function buildAdminMessage(b: z.infer<typeof BookingSchema>, bookingNumber: string): string {
  const activeAddons = Object.entries(b.addons)
    .filter(([, v]) => v)
    .map(([k]) => ADDON_LABEL[k] ?? k)
    .join(", ") || "—";

  const jadwal = b.jadwalType === "sekarang"
    ? "Pickup Sekarang"
    : `${b.tanggalPickup ?? "—"} jam ${b.jamPickup ?? "—"}`;

  return `🚛 *ORDER TRUCKING BARU*
No. Order   : *${bookingNumber}*
Status      : Menunggu Review Admin

*ARMADA*
Kendaraan  : ${b.vehicleName}
Jumlah Trip: ${b.jumlahTrip} trip

*PICKUP*
Area       : ${AREA_LABEL[b.areaPickup] ?? b.areaPickup}
Alamat     : ${b.alamatPickup}
PIC        : ${b.picPickup}
HP         : ${b.hpPickup}

*DELIVERY*
Area       : ${AREA_LABEL[b.areaDelivery] ?? b.areaDelivery}
Alamat     : ${b.alamatDelivery}
Penerima   : ${b.picPenerima}
HP         : ${b.hpPenerima}

*JADWAL*
Pickup     : ${jadwal}

*BARANG*
Jenis      : ${b.jenisBarang ?? "—"}
Berat      : ${b.beratKg ? `${b.beratKg} kg` : "—"}
Koli       : ${b.jumlahKoli ?? "—"}
Volume     : ${b.volumeM3 ? `${b.volumeM3} m³` : "—"}
Catatan    : ${b.catatan || "—"}

*TAMBAHAN*
${activeAddons}

*ESTIMASI HARGA: ${formatRp(b.estimatedPrice ?? b.estimasiTotal)}*
${b.estimatedDistanceKm ? `Jarak Estimasi: ${b.estimatedDistanceKm} km` : ""}

⚠️ Harap review & set harga final di BizPortal.`;
}

// ── POST /api/trucking/bookings ───────────────────────────────────────────────
// Optional portal auth — if token present, capture customer_id; otherwise proceed as guest

router.post("/", optionalCustomerPortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as Partial<PortalAuthReq>).portalCustomerId ?? null;
  const parsed = BookingSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Data tidak valid", errors: parsed.error.flatten() });
    return;
  }

  const b = parsed.data;
  const candidateVendorIds = b.candidateVendorIds ?? [];
  const submittedVendorIds = [
    ...candidateVendorIds,
    ...(b.selectedVendorId == null ? [] : [b.selectedVendorId]),
  ];
  const eligibleVendorIds = await getEligibleTruckingVendorIds(submittedVendorIds);
  const invalidCandidateVendorIds = submittedVendorIds.filter((id) => !eligibleVendorIds.has(id));
  if (invalidCandidateVendorIds.length > 0) {
    res.status(422).json({
      message: "Daftar vendor trucking berisi vendor yang tidak eligible.",
      invalidVendorIds: [...new Set(invalidCandidateVendorIds)],
    });
    return;
  }
  let context: Awaited<ReturnType<typeof getPortalCustomerContext>> | null = null;
  if (customerId) {
    try {
      context = await getPortalCustomerContext(customerId);
    } catch (error) {
      if (error instanceof PortalCustomerContextError) {
        return res.status(error.statusCode).json({ message: error.message });
      }
      throw error;
    }
    if (!context.customerType) {
      return res.status(422).json({ message: "Profil customer belum menyelesaikan tipe akun." });
    }
    if (context.customerType === "company" && !context.companyId) {
      return res.status(422).json({ message: "Customer Portal belum memiliki membership perusahaan aktif." });
    }
  }
  const bookingNumber = generateBookingNumber();
  let insertedId = 0;

  try {
    const insertedResult = await db.execute(sql`
      INSERT INTO trucking_booking_requests (
        booking_number, customer_id, portal_customer_id, company_id,
        vehicle_type, vehicle_name,
        area_pickup, alamat_pickup, pic_pickup, hp_pickup,
        area_delivery, alamat_delivery, pic_penerima, hp_penerima,
        jadwal_type, tanggal_pickup, jam_pickup,
        jenis_barang, berat_kg, jumlah_koli, volume_m3, catatan,
        jumlah_trip, addons, estimasi_total,
        estimated_distance_km, estimated_price, pricing_breakdown,
        candidate_vendor_ids, selected_vendor_id, source,
        status
      ) VALUES (
        ${bookingNumber}, ${customerId}, ${context?.customer.id ?? null}, ${context?.companyId ?? null},
        ${b.vehicleType}, ${b.vehicleName},
        ${b.areaPickup}, ${b.alamatPickup}, ${b.picPickup}, ${b.hpPickup},
        ${b.areaDelivery}, ${b.alamatDelivery}, ${b.picPenerima}, ${b.hpPenerima},
        ${b.jadwalType}, ${b.tanggalPickup ?? null}, ${b.jamPickup ?? null},
        ${b.jenisBarang ?? null}, ${b.beratKg ?? null}, ${b.jumlahKoli ?? null},
        ${b.volumeM3 ?? null}, ${b.catatan ?? null},
        ${b.jumlahTrip}, ${JSON.stringify(b.addons)}, ${b.estimasiTotal},
        ${b.estimatedDistanceKm ?? null},
        ${b.estimatedPrice ?? null},
        ${b.pricingBreakdown ? JSON.stringify(b.pricingBreakdown) : null},
        ${b.candidateVendorIds ? JSON.stringify(b.candidateVendorIds) : null},
        ${b.selectedVendorId ?? null},
        ${"customer_portal"},
        ${"pending_review"}
      )
      RETURNING id
    `);
    insertedId = Number((insertedResult.rows[0] as { id: number }).id);
  } catch (err) {
    logger.error({ err }, "[truckingBookings] DB insert failed");
    res.status(500).json({ message: "Gagal menyimpan order" });
    return;
  }

  // Send WA to admin (non-blocking)
  const msg = buildAdminMessage(b, bookingNumber);
  Promise.all([getAdminGroupWa(), getAdminWa()]).then(([group, personal]) => {
    if (group)    sendWhatsApp(group,    msg, { context: "trucking_order", refId: bookingNumber }).catch((e: unknown) => logger.warn({ e }, "WA group failed"));
    if (personal) sendWhatsApp(personal, msg, { context: "trucking_order", refId: bookingNumber }).catch((e: unknown) => logger.warn({ e }, "WA personal failed"));
  }).catch((e: unknown) => logger.warn({ e }, "getAdminWa failed"));

  void NotificationService.saveAndBroadcast("admin_notification", {
    type: "portal_service_submitted",
    orderId: insertedId,
    orderNumber: bookingNumber,
    customerName: b.picPickup,
    title: "Order trucking baru",
    body: `Order trucking ${bookingNumber} menunggu review admin.`,
    serviceKey: "domestic-trucking",
    dedupeKey: `portal-service:domestic-trucking:${insertedId}:submitted`,
  });

  res.status(201).json({
    bookingNumber,
    status: "pending_review",
    message: "Order trucking berhasil dibuat. Menunggu review admin.",
  });
});

// ── GET /api/trucking/bookings/:bookingNumber (public, by booking number) ─────

router.get("/:bookingNumber", async (req: Request, res: Response) => {
  const { bookingNumber } = req.params;
  try {
    const result = await db.execute(sql`
      SELECT
        id, booking_number, customer_id, vehicle_type, vehicle_name,
        area_pickup, alamat_pickup, pic_pickup, hp_pickup,
        area_delivery, alamat_delivery, pic_penerima, hp_penerima,
        jadwal_type, tanggal_pickup, jam_pickup,
        jenis_barang, berat_kg, jumlah_koli, volume_m3, catatan,
        jumlah_trip, addons, estimasi_total,
        estimated_distance_km, estimated_price, pricing_breakdown,
        candidate_vendor_ids, selected_vendor_id, final_price,
        source, status, created_at, updated_at
      FROM trucking_booking_requests
      WHERE booking_number = ${bookingNumber}
    `);
    if (!result.rows.length) {
      res.status(404).json({ message: "Order tidak ditemukan" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "[truckingBookings] GET detail failed");
    res.status(500).json({ message: "Gagal memuat data" });
  }
});

// ── GET /api/trucking/bookings (admin) ────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const { status, limit = "100", offset = "0" } = req.query;
  try {
    const result = await db.execute(sql`
      SELECT
        id, booking_number, customer_id, vehicle_type, vehicle_name,
        area_pickup, area_delivery, pic_pickup, hp_pickup,
        jadwal_type, tanggal_pickup, jam_pickup,
        jenis_barang, berat_kg, jumlah_koli, volume_m3,
        jumlah_trip, addons, estimasi_total,
        estimated_distance_km, estimated_price, final_price,
        source, status, created_at, updated_at
      FROM trucking_booking_requests
      ${status ? sql`WHERE status = ${String(status)}` : sql``}
      ORDER BY created_at DESC
      LIMIT ${Number(limit)} OFFSET ${Number(offset)}
    `);
    const count = await db.execute(sql`
      SELECT COUNT(*) as total FROM trucking_booking_requests
      ${status ? sql`WHERE status = ${String(status)}` : sql``}
    `);
    res.json({
      rows: result.rows,
      total: Number((count.rows[0] as { total: string }).total),
    });
  } catch (err) {
    logger.error({ err }, "[truckingBookings] GET list failed");
    res.status(500).json({ message: "Gagal memuat data" });
  }
});

// ── PUT /api/trucking/bookings/:id (admin — review, set final price, change status) ──

router.put("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ message: "ID tidak valid" }); return; }

  const parsed = ReviewSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ message: "Data tidak valid", errors: parsed.error.flatten() });
    return;
  }

  const { finalPrice, status } = parsed.data;

  try {
    const result = await db.execute(sql`
      UPDATE trucking_booking_requests SET
        final_price = COALESCE(${finalPrice ?? null}, final_price),
        status      = COALESCE(${status ?? null}, status),
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    if (!result.rows.length) {
      res.status(404).json({ message: "Order tidak ditemukan" });
      return;
    }
    res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "[truckingBookings] PUT update failed");
    res.status(500).json({ message: "Gagal memperbarui order" });
  }
});

export default router;

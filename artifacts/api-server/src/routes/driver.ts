import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import { compressImageBuffer } from "../lib/imageCompress";
import { db, driversTable, driverJobsTable, driverJobLogsTable, driverPhotosTable, freightShipmentsTable, driverLocationsTable, logisticOrdersTable } from "@workspace/db";
import { eq, and, desc, ne, sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { logActivity } from "../lib/activityLog";
import { getPreferredDomain } from "../lib/domain";
import {
  sendDriverAssignedNotification,
  sendDeliveryCompletedNotification,
  type LogisticOrderData,
} from "../lib/orderNotification";
import { autoCreateLogisticInvoice } from "../lib/podInvoiceAutoCreate.js";
import {
  registerDriverConnection, unregisterDriverConnection, pushToDriver,
  registerAdminConnection, unregisterAdminConnection, broadcastToAdmins,
  broadcastToPortal,
} from "../lib/sseManager";
import { checkGeofence } from "../lib/geofence";
import { upsertAlert, resolveAlert, getActiveAlerts, hasActiveAlert } from "../lib/geofenceAlertStore";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { updateOrderProgress } from "../lib/orderProgress.js";
import { logger } from "../lib/logger.js";

const router = Router();
const adminRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const objectStorageService = new ObjectStorageService();

// Lazy — only throws when auth functions are actually called, not at module load.
function getDriverJwtSecret(): string {
  const s = process.env.DRIVER_JWT_SECRET;
  if (!s) throw new Error("DRIVER_JWT_SECRET environment variable is required for driver auth");
  return s;
}
const JWT_SECRET = process.env.DRIVER_JWT_SECRET ?? "";

const BCRYPT_ROUNDS = 12;

async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash) return false;
  if (hash.startsWith("$2b$") || hash.startsWith("$2a$")) {
    return bcrypt.compare(password, hash);
  }
  const legacyHash = createHmac("sha256", JWT_SECRET!).update(password).digest("hex");
  return legacyHash === hash;
}

function signDriverToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 })
  ).toString("base64url");
  const sig = createHmac("sha256", JWT_SECRET!).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

function verifyDriverToken(token: string): Record<string, unknown> | null {
  try {
    const [header, body, sig] = token.split(".");
    const expected = createHmac("sha256", JWT_SECRET!).update(`${header}.${body}`).digest("base64url");
    if (sig !== expected) return null;
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.driverId !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}

// Status transition state machine — defines which statuses a driver may move to from each current status
const VALID_TRANSITIONS: Record<string, string[]> = {
  ASSIGNED:               ["ACCEPTED", "CANCELLED"],
  ACCEPTED:               ["ON_THE_WAY_TO_PICKUP", "CANCELLED"],
  ON_THE_WAY_TO_PICKUP:   ["ARRIVED_AT_PICKUP", "CANCELLED"],
  ARRIVED_AT_PICKUP:      ["PICKED_UP", "CANCELLED"],
  PICKED_UP:              ["IN_TRANSIT", "CANCELLED"],
  IN_TRANSIT:             ["ARRIVED_AT_DESTINATION", "CANCELLED"],
  ARRIVED_AT_DESTINATION: ["DELIVERED", "CANCELLED"],
  DELIVERED:              ["COMPLETED"],
  COMPLETED:              [],
  CANCELLED:              [],
};

// ── Driver → Logistic Order Propagation ──────────────────────────────────────
//
// Mapping driver job status → logistic_orders.status (canonical).
// Satu arah, non-fatal.
//
const DRIVER_TO_LOGISTIC_STATUS: Partial<Record<string, string>> = {
  ON_THE_WAY_TO_PICKUP:     "Pickup",
  ARRIVED_AT_PICKUP:        "Pickup",
  PICKED_UP:                "Pickup",
  IN_TRANSIT:               "In Transit",
  ARRIVED_AT_DESTINATION:   "Arrived",
  DELIVERED:                "Delivered",
  COMPLETED:                "Delivered",
};

const DRIVER_STATUS_TO_PROGRESS_STEP: Partial<Record<string, string>> = {
  ON_THE_WAY_TO_PICKUP:   "PICKUP",
  IN_TRANSIT:             "IN_TRANSIT",
  ARRIVED_AT_DESTINATION: "ARRIVED",
  DELIVERED:              "DELIVERED",
  COMPLETED:              "COMPLETED",
};

const STATUS_LABEL_ID: Record<string, string> = {
  ASSIGNED:               "Driver Ditugaskan",
  ACCEPTED:               "Driver Menerima Job",
  ON_THE_WAY_TO_PICKUP:   "Menuju Lokasi Pickup",
  ARRIVED_AT_PICKUP:      "Tiba di Lokasi Pickup",
  PICKED_UP:              "Barang Berhasil Diambil",
  IN_TRANSIT:             "Dalam Perjalanan",
  ARRIVED_AT_DESTINATION: "Tiba di Tujuan",
  DELIVERED:              "Barang Terkirim",
  COMPLETED:              "Pengiriman Selesai",
  CANCELLED:              "Dibatalkan",
};

async function syncDriverToLogisticOrder(
  logisticOrderId: number | null,
  driverJobStatus: string,
): Promise<void> {
  if (!logisticOrderId) return;
  const targetStatus = DRIVER_TO_LOGISTIC_STATUS[driverJobStatus];
  if (!targetStatus) return;

  transitionLogisticOrderStatus(logisticOrderId, targetStatus, {
    actorType: "driver",
    source: `driver:${driverJobStatus.toLowerCase()}`,
    force: false,
    skipAudit: false,
  }).catch((e) => {
    console.warn("[driver] syncDriverToLogisticOrder failed — non-fatal", { logisticOrderId, driverJobStatus, e });
  });
}

// Sync parent freight shipment status based on driver job status changes
async function syncParentFreightStatus(
  freightShipmentId: number | null,
  newJobStatus: string
): Promise<void> {
  if (!freightShipmentId) return;
  const [freight] = await db
    .select({ id: freightShipmentsTable.id, status: freightShipmentsTable.status })
    .from(freightShipmentsTable)
    .where(eq(freightShipmentsTable.id, freightShipmentId));
  if (!freight) return;
  if (newJobStatus === "IN_TRANSIT" && freight.status === "confirmed") {
    await db.update(freightShipmentsTable).set({ status: "in_transit" }).where(eq(freightShipmentsTable.id, freightShipmentId));
  } else if (newJobStatus === "COMPLETED" && freight.status === "in_transit") {
    await db.update(freightShipmentsTable).set({ status: "completed" }).where(eq(freightShipmentsTable.id, freightShipmentId));
  }
}

type DriverAuthReq = Request & { driverId: number };

function requireDriverAuth(req: Request, res: Response, next: NextFunction) {
  const auth = req.headers["authorization"];
  if (!auth?.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }
  const token = auth.slice(7);
  const payload = verifyDriverToken(token);
  if (!payload || typeof payload.driverId !== "number") {
    res.status(401).json({ message: "Invalid or expired token" });
    return;
  }
  (req as DriverAuthReq).driverId = payload.driverId;
  next();
}

function nextJobNumber(): string {
  const yr = new Date().getFullYear();
  const seq = Date.now().toString().slice(-6);
  return `TRK/${yr}/${seq}`;
}

async function fetchOrderData(logisticOrderId: number | null | undefined): Promise<LogisticOrderData | null> {
  if (!logisticOrderId) return null;
  const [row] = await db.select().from(logisticOrdersTable).where(eq(logisticOrdersTable.id, logisticOrderId)).limit(1);
  if (!row) return null;
  return {
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
  };
}

async function uploadPhotoToStorage(buffer: Buffer, mimetype: string, jobId: number): Promise<string> {
  try {
    const { buffer: compressed, contentType } = await compressImageBuffer(buffer, mimetype, "photo");
    const filename = `${randomUUID()}.jpg`;
    const storagePath = `public/cargo-photos/${jobId}/${filename}`;
    await objectStorageService.uploadFile(compressed, storagePath, contentType, { skipImageCompression: true });
    return `/api/storage/public-objects/cargo-photos/${jobId}/${filename}`;
  } catch {
    throw new Error("Photo upload failed");
  }
}

function serializeJob(job: typeof driverJobsTable.$inferSelect) {
  return {
    ...job,
    assignedAt: job.assignedAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    pickupDateTime: job.pickupDateTime?.toISOString() ?? null,
    deliveryDateTime: job.deliveryDateTime?.toISOString() ?? null,
  };
}

// ─── Driver POD extended columns migration ───────────────────────────────────

export async function runDriverPodMigration(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  try {
    await db.execute(sql`
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_receiver_position TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_notes TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_photos TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_submitted_at TIMESTAMPTZ;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_geo_lat TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_geo_lng TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_device_timestamp TIMESTAMPTZ;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_map_url TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_street_view_url TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS pod_signature_data_url TEXT;
    `);
    console.info("Driver POD migration: ok");
  } catch (err) {
    console.warn("Driver POD migration warn (non-fatal)", err);
  }
}

// ─── Driver Assignment (INTERNAL/EXTERNAL mode) migration ────────────────────

export async function runDriverAssignmentMigration(): Promise<void> {
  const { sql } = await import("drizzle-orm");
  try {
    await db.execute(sql`
      ALTER TABLE driver_jobs ALTER COLUMN driver_id DROP NOT NULL;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS driver_type TEXT DEFAULT 'EXTERNAL';
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS execution_mode TEXT DEFAULT 'DRIVER_APP';
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS wa_progress_token TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS driver_name_override TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS driver_phone_override TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS vehicle_plate_override TEXT;
      ALTER TABLE driver_jobs ADD COLUMN IF NOT EXISTS legacy_source TEXT;
    `);
    console.info("Driver assignment migration: ok");
  } catch (err) {
    console.warn("Driver assignment migration warn (non-fatal)", err);
  }
}

function nowWIB(): string {
  return new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " WIB";
}

// ─── MOBILE DRIVER ROUTES ────────────────────────────────────────────────────

// POST /api/driver/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    res.status(400).json({ message: "Email dan password wajib diisi" });
    return;
  }
  const [driver] = await db
    .select()
    .from(driversTable)
    .where(and(eq(driversTable.email, String(email)), eq(driversTable.isActive, true)));
  if (!driver) {
    res.status(401).json({ message: "Email atau password salah" });
    return;
  }
  const passwordOk = await verifyPassword(String(password), driver.passwordHash);
  if (!passwordOk) {
    res.status(401).json({ message: "Email atau password salah" });
    return;
  }
  if (driver.passwordHash && !driver.passwordHash.startsWith("$2")) {
    const newHash = await hashPassword(String(password));
    await db.update(driversTable).set({ passwordHash: newHash }).where(eq(driversTable.id, driver.id));
  }
  const token = signDriverToken({ driverId: driver.id, email: driver.email });
  const { passwordHash: _ph, ...safeDriver } = driver;
  res.json({ token, driver: safeDriver });
});

// GET /api/driver/me
router.get("/me", requireDriverAuth, async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.id, driverId));
  if (!driver) { res.status(404).json({ message: "Driver not found" }); return; }
  const { passwordHash: _ph, ...safeDriver } = driver;
  const activeJobs = await db
    .select()
    .from(driverJobsTable)
    .where(and(eq(driverJobsTable.driverId, driverId), ne(driverJobsTable.status, "COMPLETED")))
    .orderBy(desc(driverJobsTable.createdAt));
  const completedJobs = await db
    .select()
    .from(driverJobsTable)
    .where(and(eq(driverJobsTable.driverId, driverId), eq(driverJobsTable.status, "COMPLETED")));
  res.json({
    ...safeDriver,
    totalDeliveries: completedJobs.length,
    activeJobCount: activeJobs.length,
  });
});

// GET /api/driver/jobs
router.get("/jobs", requireDriverAuth, async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const jobs = await db
    .select()
    .from(driverJobsTable)
    .where(eq(driverJobsTable.driverId, driverId))
    .orderBy(desc(driverJobsTable.createdAt));

  const jobsWithDetails = await Promise.all(
    jobs.map(async (job) => {
      const logs = await db
        .select()
        .from(driverJobLogsTable)
        .where(eq(driverJobLogsTable.driverJobId, job.id))
        .orderBy(driverJobLogsTable.timestamp);
      const photos = await db
        .select()
        .from(driverPhotosTable)
        .where(eq(driverPhotosTable.driverJobId, job.id))
        .orderBy(driverPhotosTable.takenAt);
      return {
        ...serializeJob(job),
        statusLogs: logs.map((l) => ({ ...l, timestamp: l.timestamp.toISOString() })),
        photos: photos.map((p) => ({ ...p, takenAt: p.takenAt.toISOString() })),
        validNextStatuses: VALID_TRANSITIONS[job.status] ?? [],
      };
    })
  );
  res.json(jobsWithDetails);
});

// PUT /api/driver/jobs/:jobId/status
router.put("/jobs/:jobId/status", requireDriverAuth, async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const jobId = Number(req.params.jobId);
  const { status, note, geoLocation } = req.body ?? {};
  if (!status) { res.status(400).json({ message: "Status wajib diisi" }); return; }

  const [job] = await db
    .select()
    .from(driverJobsTable)
    .where(and(eq(driverJobsTable.id, jobId), eq(driverJobsTable.driverId, driverId)));
  if (!job) { res.status(404).json({ message: "Job not found" }); return; }

  const allowed = VALID_TRANSITIONS[job.status] ?? [];
  if (!allowed.includes(String(status))) {
    res.status(400).json({
      message: `Transisi status tidak valid: ${job.status} → ${status}. Status yang diperbolehkan: ${allowed.join(", ") || "(tidak ada)"}`,
      currentStatus: job.status,
      allowedTransitions: allowed,
    });
    return;
  }

  const completedAt = status === "COMPLETED" ? new Date() : null;
  const [updated] = await db
    .update(driverJobsTable)
    .set({ status, ...(completedAt ? { completedAt } : {}) })
    .where(eq(driverJobsTable.id, jobId))
    .returning();

  await db.insert(driverJobLogsTable).values({
    driverJobId: jobId,
    status,
    note: note ? String(note) : null,
    timestamp: new Date(),
  });

  await syncParentFreightStatus(job.freightShipmentId, String(status));
  await syncDriverToLogisticOrder(job.logisticOrderId, String(status));

  const progressStep = DRIVER_STATUS_TO_PROGRESS_STEP[String(status)];
  if (progressStep && job.logisticOrderId) {
    const [driverRow] = await db.select({ name: driversTable.name })
      .from(driversTable).where(eq(driversTable.id, driverId));
    const rawLat = geoLocation?.lat != null ? Number(geoLocation.lat) : null;
    const rawLng = geoLocation?.lng != null ? Number(geoLocation.lng) : null;
    const gpsLat = rawLat != null && rawLat >= -90 && rawLat <= 90 ? rawLat : null;
    const gpsLng = rawLng != null && rawLng >= -180 && rawLng <= 180 ? rawLng : null;
    const gpsDeviceTs = geoLocation?.deviceTimestamp ? String(geoLocation.deviceTimestamp) : null;
    const gpsMapUrl = gpsLat != null && gpsLng != null ? `https://www.google.com/maps?q=${gpsLat},${gpsLng}` : null;
    const gpsStreetViewUrl = gpsLat != null && gpsLng != null ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${gpsLat},${gpsLng}` : null;
    updateOrderProgress(
      job.logisticOrderId,
      progressStep,
      "driver",
      driverRow?.name ?? "Driver",
      note ? String(note) : `Driver update: ${status}`,
      undefined,
      { gpsLatitude: gpsLat, gpsLongitude: gpsLng, deviceTimestamp: gpsDeviceTs, mapUrl: gpsMapUrl ?? undefined, streetViewUrl: gpsStreetViewUrl ?? undefined },
    ).catch(() => {});
  }

  // Push real-time event to all admin/dispatcher connections
  broadcastToAdmins("job_status_changed", {
    jobId,
    jobNumber: updated.jobNumber,
    driverId,
    status,
    freightShipmentId: updated.freightShipmentId,
    updatedAt: new Date().toISOString(),
  });

  // Broadcast ke customer portal (tracking page) — non-blocking, lookup orderNumber
  if (job.logisticOrderId) {
    const orderId = job.logisticOrderId;
    db.select({ orderNumber: logisticOrdersTable.orderNumber })
      .from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId))
      .then(([row]) => {
        if (row?.orderNumber) {
          broadcastToPortal("driver_job_status_changed", {
            orderNumber: row.orderNumber,
            orderId,
            jobId,
            jobNumber: updated.jobNumber,
            status,
            updatedAt: new Date().toISOString(),
          });
        }
      }).catch(() => {});
  }

  if (job.logisticOrderId) {
    logActivity({
      orderId: job.logisticOrderId,
      actorType: "driver",
      action: "shipment_status_updated",
      description: `Driver memperbarui status pengiriman: ${job.status} → ${status}${note ? ` — ${note}` : ""}`,
      newValue: { jobId, jobNumber: updated.jobNumber, status, previousStatus: job.status },
    }).catch(() => {});
  }

  // WA ke admin untuk milestone penting (PICKED_UP, DELIVERED)
  if (["PICKED_UP", "DELIVERED"].includes(String(status)) && job.logisticOrderId) {
    (async () => {
      try {
        const [orderData] = await db.select({
          orderNumber: logisticOrdersTable.orderNumber,
          customerName: logisticOrdersTable.customerName,
        }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, job.logisticOrderId!));
        const [driverRow] = await db.select({ name: driversTable.name })
          .from(driversTable).where(eq(driversTable.id, driverId));
        const adminGroupWa = await getAdminGroupWa();
        if (adminGroupWa && orderData) {
          const driverDisplay = driverRow?.name ?? "Driver";
          const statusLabel = STATUS_LABEL_ID[String(status)] ?? String(status);
          const msg = [
            `🚚 *Update Driver — ${updated.jobNumber}*`,
            ``,
            `👤 Driver: ${driverDisplay}`,
            `📦 Order: ${orderData.orderNumber ?? "-"} (${orderData.customerName ?? "-"})`,
            `📍 Status: *${statusLabel}*`,
            note ? `📝 Catatan: ${note}` : null,
          ].filter(Boolean).join("\n");
          sendWhatsApp(adminGroupWa, msg).catch(() => {});
        }
      } catch {
        // non-fatal
      }
    })();
  }

  res.json({ ...serializeJob(updated), validNextStatuses: VALID_TRANSITIONS[String(status)] ?? [] });
});

// POST /api/driver/jobs/:jobId/photos
router.post("/jobs/:jobId/photos", requireDriverAuth, upload.single("photo"), async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const jobId = Number(req.params.jobId);

  const [job] = await db
    .select()
    .from(driverJobsTable)
    .where(and(eq(driverJobsTable.id, jobId), eq(driverJobsTable.driverId, driverId)));
  if (!job) { res.status(404).json({ message: "Job not found" }); return; }
  if (!req.file) { res.status(400).json({ message: "Tidak ada foto yang diunggah" }); return; }

  const photoType = String(req.body?.type ?? "general");
  let url: string;
  try {
    url = await uploadPhotoToStorage(req.file.buffer, req.file.mimetype, jobId);
  } catch {
    res.status(500).json({ message: "Gagal mengunggah foto" });
    return;
  }

  const [photo] = await db.insert(driverPhotosTable).values({
    driverJobId: jobId,
    url,
    photoType,
  }).returning();

  if (job.logisticOrderId) {
    broadcastToPortal("driver_photo_uploaded", {
      logisticOrderId: job.logisticOrderId,
      photoType,
      url,
      takenAt: photo.takenAt.toISOString(),
    });
  }

  res.json({ ...photo, takenAt: photo.takenAt.toISOString() });
});

// POST /api/driver/jobs/:jobId/pod/upload — upload single POD photo, return URL
router.post("/jobs/:jobId/pod/upload", requireDriverAuth, upload.single("photo"), async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const jobId = Number(req.params.jobId);

  const [job] = await db
    .select({ id: driverJobsTable.id })
    .from(driverJobsTable)
    .where(and(eq(driverJobsTable.id, jobId), eq(driverJobsTable.driverId, driverId)));
  if (!job) { res.status(404).json({ message: "Job not found" }); return; }
  if (!req.file) { res.status(400).json({ message: "Tidak ada foto yang diunggah" }); return; }

  let fileUrl: string;
  try {
    fileUrl = await uploadPhotoToStorage(req.file.buffer, req.file.mimetype, jobId);
  } catch {
    res.status(500).json({ message: "Gagal mengunggah foto POD" });
    return;
  }

  res.json({ fileUrl, filename: req.file.originalname ?? `pod_${Date.now()}.jpg` });
});

// POST /api/driver/jobs/:jobId/pod
router.post("/jobs/:jobId/pod", requireDriverAuth, async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const jobId = Number(req.params.jobId);
  try {
    const {
      receiverName,
      receiverPosition,
      deliveryNotes,
      podPhotos,
      signatureDataUrl,
      submittedAt,
      geoLocation,
    } = req.body ?? {};

    if (!receiverName) { res.status(400).json({ message: "Nama penerima wajib diisi" }); return; }

    const [job] = await db
      .select()
      .from(driverJobsTable)
      .where(and(eq(driverJobsTable.id, jobId), eq(driverJobsTable.driverId, driverId)));
    if (!job) { res.status(404).json({ message: "Job not found" }); return; }

    const allowed = VALID_TRANSITIONS[job.status] ?? [];
    if (!allowed.includes("DELIVERED") && job.status !== "ARRIVED_AT_DESTINATION") {
      res.status(400).json({ message: "POD hanya dapat disubmit pada status Tiba di Tujuan" });
      return;
    }

    const photoUrls: string[] = Array.isArray(podPhotos) ? podPhotos.filter((u: unknown) => typeof u === "string") : [];
    const podSubmittedAt = submittedAt ? new Date(String(submittedAt)) : new Date();
    const geoLat = geoLocation?.lat ? String(geoLocation.lat) : null;
    const geoLng = geoLocation?.lng ? String(geoLocation.lng) : null;
    const validGeoLat = geoLat && !isNaN(Number(geoLat)) && Math.abs(Number(geoLat)) <= 90 ? geoLat : null;
    const validGeoLng = geoLng && !isNaN(Number(geoLng)) && Math.abs(Number(geoLng)) <= 180 ? geoLng : null;
    const geoDeviceTs = geoLocation?.deviceTimestamp ? new Date(String(geoLocation.deviceTimestamp)) : null;
    const geoMapUrl = validGeoLat && validGeoLng ? `https://www.google.com/maps?q=${validGeoLat},${validGeoLng}` : null;
    const geoStreetViewUrl = validGeoLat && validGeoLng ? `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${validGeoLat},${validGeoLng}` : null;

    const [updated] = await db
      .update(driverJobsTable)
      .set({
        podReceiverName: String(receiverName),
        podReceiverPosition: receiverPosition ? String(receiverPosition) : null,
        podNotes: deliveryNotes ? String(deliveryNotes) : null,
        podPhotos: photoUrls.length ? JSON.stringify(photoUrls) : null,
        podSubmittedAt,
        podGeoLat: validGeoLat,
        podGeoLng: validGeoLng,
        podDeviceTimestamp: geoDeviceTs,
        podMapUrl: geoMapUrl,
        podStreetViewUrl: geoStreetViewUrl,
        podSignatureDataUrl: signatureDataUrl ? String(signatureDataUrl) : null,
        status: "DELIVERED",
      })
      .where(eq(driverJobsTable.id, jobId))
      .returning();

    await db.insert(driverJobLogsTable).values({
      driverJobId: jobId,
      status: "DELIVERED",
      note: `POD diterima oleh: ${receiverName}${receiverPosition ? ` (${receiverPosition})` : ""}`,
      timestamp: podSubmittedAt,
    });

    // Simpan POD photos ke driver_photos agar muncul di tracking pelanggan
    if (photoUrls.length > 0) {
      await db.insert(driverPhotosTable).values(
        photoUrls.map((url) => ({ driverJobId: jobId, url, photoType: "pod" }))
      ).onConflictDoNothing().catch(() => {});
      if (job.logisticOrderId) {
        broadcastToPortal("driver_photo_uploaded", {
          logisticOrderId: job.logisticOrderId,
          photoType: "pod",
          urls: photoUrls,
        });
      }
    }

    // Non-fatal side effects — jangan blocking response
    syncParentFreightStatus(job.freightShipmentId, "DELIVERED").catch((e) =>
      logger.warn({ e, jobId }, "syncParentFreightStatus POD non-fatal")
    );
    syncDriverToLogisticOrder(job.logisticOrderId, "DELIVERED").catch((e) =>
      logger.warn({ e, jobId }, "syncDriverToLogisticOrder POD non-fatal")
    );

    // Lookup driver info — non-fatal
    const driverInfo = await db
      .select({ name: driversTable.name, vehiclePlate: driversTable.vehiclePlate, phone: driversTable.phone })
      .from(driversTable)
      .where(eq(driversTable.id, driverId))
      .then((rows) => rows[0] ?? null)
      .catch(() => null);

    if (job.logisticOrderId) {
      const firstPhotoUrl = photoUrls[0] ?? null;
      const podNotes = `POD diterima oleh: ${receiverName}${receiverPosition ? ` (${receiverPosition})` : ""}${photoUrls.length ? ` | ${photoUrls.length} foto` : ""}`;
      const driverLabel = driverInfo?.name ?? job.cargoDescription ?? "Driver";

      // Insert ke order_tracking_progress (dibaca customer tracking page)
      db.execute(
        sql`INSERT INTO order_tracking_progress (order_id, status, notes, photo_url, updated_by, is_public)
            VALUES (${job.logisticOrderId}, 'Bukti Pengiriman Diterima', ${podNotes}, ${firstPhotoUrl}, ${driverLabel}, true)`
      ).catch((e: unknown) => logger.warn({ e }, "order_tracking_progress POD insert non-fatal"));

      // Call updateOrderProgress (BizPortal progress events)
      updateOrderProgress(
        job.logisticOrderId,
        "POD_UPLOADED",
        "driver",
        driverLabel,
        podNotes,
        { jobId, jobNumber: updated.jobNumber, receiverName, receiverPosition, photoCount: photoUrls.length, photoUrls },
        { photoUrl: firstPhotoUrl ?? undefined,
          gpsLatitude: validGeoLat ? Number(validGeoLat) : null,
          gpsLongitude: validGeoLng ? Number(validGeoLng) : null,
          deviceTimestamp: geoDeviceTs?.toISOString() ?? null,
          mapUrl: geoMapUrl ?? undefined,
          streetViewUrl: geoStreetViewUrl ?? undefined },
      ).catch(() => {});

      fetchOrderData(job.logisticOrderId).then(async (orderData) => {
        if (!orderData) return;
        sendDeliveryCompletedNotification(orderData).catch(() => {});
        autoCreateLogisticInvoice(orderData).catch(() => {});

        const adminGroupWa = await getAdminGroupWa().catch(() => null);
        if (adminGroupWa) {
          const photoCount = photoUrls.length;
          const lines: string[] = [
            `📦 *Proof of Delivery Diterima*`,
            ``,
            `No. Order: *${orderData.orderNumber}*`,
            `Pelanggan: ${orderData.customerName}`,
            `Driver: *${driverInfo?.name ?? job.cargoDescription ?? "-"}*${driverInfo?.vehiclePlate ? ` | ${driverInfo.vehiclePlate}` : ""}`,
            ``,
            `✅ Diterima oleh: *${receiverName}*`,
          ];
          if (receiverPosition) lines.push(`🏷️ Jabatan: ${receiverPosition}`);
          if (deliveryNotes) lines.push(`📝 Catatan: ${deliveryNotes}`);
          if (photoCount > 0) lines.push(`📸 Foto POD: ${photoCount} foto`);
          lines.push(``, `🕐 ${nowWIB()}`);
          sendWhatsApp(adminGroupWa, lines.join("\n")).catch(() => {});
        }
      }).catch(() => {});

      logActivity({
        orderId: job.logisticOrderId,
        actorType: "driver",
        action: "pod_submitted",
        description: `Proof of Delivery disubmit — diterima oleh: ${receiverName}${receiverPosition ? ` (${receiverPosition})` : ""}${photoUrls.length ? ` | ${photoUrls.length} foto` : ""}`,
        newValue: { jobId, jobNumber: updated.jobNumber, receiverName, receiverPosition, photoCount: photoUrls.length, status: "DELIVERED" },
      }).catch(() => {});
    }

    logger.info({ jobId, driverId, orderNumber: updated.jobNumber }, "POD submitted successfully");
    res.json({ ...serializeJob(updated), validNextStatuses: VALID_TRANSITIONS["DELIVERED"] });
  } catch (err) {
    logger.error({ err, jobId, driverId }, "POD submit error");
    res.status(500).json({ message: "Gagal menyimpan POD. Silakan coba lagi." });
  }
});

// GET /api/driver/events — SSE stream for driver mobile app
router.get("/events", requireDriverAuth, (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ driverId, ok: true })}\n\n`);

  registerDriverConnection(driverId, res);

  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unregisterDriverConnection(driverId, res);
  });
});

// POST /api/driver/location
router.post("/location", requireDriverAuth, async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const { lat, lng } = req.body ?? {};
  if (lat == null || lng == null) { res.status(400).json({ message: "lat dan lng wajib diisi" }); return; }
  await db
    .update(driversTable)
    .set({ currentLat: String(lat), currentLng: String(lng), lastLocationAt: new Date() })
    .where(eq(driversTable.id, driverId));
  const [driver] = await db
    .select({ id: driversTable.id, name: driversTable.name, vehiclePlate: driversTable.vehiclePlate })
    .from(driversTable)
    .where(eq(driversTable.id, driverId));

  // Find active job for orderId linkage
  const activeJobs2 = await db
    .select({ id: driverJobsTable.id, logisticOrderId: driverJobsTable.logisticOrderId, jobNumber: driverJobsTable.jobNumber })
    .from(driverJobsTable)
    .where(and(eq(driverJobsTable.driverId, driverId), ne(driverJobsTable.status, "COMPLETED"), ne(driverJobsTable.status, "CANCELLED")))
    .limit(1);
  const activeJob2 = activeJobs2[0];

  // Save location history (fire-and-forget)
  db.insert(driverLocationsTable).values({
    driverId,
    orderId: activeJob2?.logisticOrderId ?? null,
    jobToken: req.body?.jobToken ?? null,
    latitude: String(lat),
    longitude: String(lng),
    accuracy: req.body?.accuracy ? String(req.body.accuracy) : null,
    speed: req.body?.speed ? String(req.body.speed) : null,
    heading: req.body?.heading ? String(req.body.heading) : null,
    checkpointType: req.body?.checkpointType ?? null,
    updatedAt: new Date(),
  }).catch(() => {});

  broadcastToAdmins("location_update", {
    driverId,
    name: driver?.name ?? "",
    vehiclePlate: driver?.vehiclePlate ?? null,
    lat: Number(lat),
    lng: Number(lng),
    updatedAt: new Date().toISOString(),
  });

  if (activeJob2?.logisticOrderId) {
    broadcastToPortal("driver_location_update", {
      logisticOrderId: activeJob2.logisticOrderId,
      lat: Number(lat),
      lng: Number(lng),
      updatedAt: new Date().toISOString(),
    });
  }

  // Geofence check — run async without blocking the response
  (async () => {
    try {
      const activeJobs = await db
        .select({ id: driverJobsTable.id, jobNumber: driverJobsTable.jobNumber, status: driverJobsTable.status, pickupAddress: driverJobsTable.pickupAddress, deliveryAddress: driverJobsTable.deliveryAddress })
        .from(driverJobsTable)
        .where(and(
          eq(driverJobsTable.driverId, driverId),
          ne(driverJobsTable.status, "COMPLETED"),
          ne(driverJobsTable.status, "CANCELLED"),
          ne(driverJobsTable.status, "DELIVERED"),
          ne(driverJobsTable.status, "ASSIGNED"),
        ));
      if (!activeJobs.length) return;
      const job = activeJobs[0];
      const result = await checkGeofence(Number(lat), Number(lng), job.pickupAddress, job.deliveryAddress);
      if (!result) return;
      if (result.deviated) {
        const wasAlreadyAlerting = hasActiveAlert(driverId, job.id);
        const alert = upsertAlert({
          driverId,
          driverName: driver?.name ?? "",
          jobId: job.id,
          jobNumber: job.jobNumber,
          deviationKm: result.deviationKm,
          thresholdKm: result.thresholdKm,
          lat: Number(lat),
          lng: Number(lng),
          pickupAddress: job.pickupAddress,
          deliveryAddress: job.deliveryAddress,
        });
        if (!wasAlreadyAlerting) {
          broadcastToAdmins("geofence_alert", alert);
        } else {
          broadcastToAdmins("geofence_alert_update", alert);
        }
      } else {
        const resolved = resolveAlert(driverId, job.id);
        if (resolved) {
          broadcastToAdmins("geofence_resolved", { id: resolved.id, driverId, driverName: driver?.name ?? "", jobNumber: job.jobNumber });
        }
      }
    } catch { /* non-critical */ }
  })();

  res.json({ ok: true });
});

// ─── ADMIN DRIVER ROUTES ─────────────────────────────────────────────────────

adminRouter.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// GET /api/drivers
adminRouter.get("/", async (req, res) => {
  const drivers = await db.select().from(driversTable).orderBy(desc(driversTable.createdAt));
  res.json(drivers.map(({ passwordHash: _ph, ...d }) => d));
});

// POST /api/drivers
adminRouter.post("/", async (req, res) => {
  const { name, email, password, phone, licenseNumber, vehiclePlate, vehicleType } = req.body ?? {};
  if (!name || !email || !password) {
    res.status(400).json({ message: "name, email, dan password wajib diisi" });
    return;
  }
  const existing = await db.select().from(driversTable).where(eq(driversTable.email, String(email)));
  if (existing.length > 0) { res.status(409).json({ message: "Email sudah terdaftar" }); return; }
  const [driver] = await db.insert(driversTable).values({
    name: String(name),
    email: String(email),
    passwordHash: await hashPassword(String(password)),
    phone: phone ? String(phone) : null,
    licenseNumber: licenseNumber ? String(licenseNumber) : null,
    vehiclePlate: vehiclePlate ? String(vehiclePlate) : null,
    vehicleType: vehicleType ? String(vehicleType) : null,
  }).returning();
  const { passwordHash: _ph, ...safeDriver } = driver;
  res.status(201).json(safeDriver);
});

// GET /api/drivers/events — SSE stream for BizPortal dispatcher
// Auth: Uses session cookie (withCredentials: true in EventSource)
adminRouter.get("/events", async (req, res) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ message: "Unauthorized" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true })}\n\n`);

  registerAdminConnection(res);

  const heartbeat = setInterval(() => {
    try { res.write(":heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unregisterAdminConnection(res);
  });
});

// GET /api/drivers/geofence-alerts — list active geofence alerts
adminRouter.get("/geofence-alerts", (_req, res) => {
  res.json(getActiveAlerts());
});

// POST /api/drivers/geofence-alerts/:id/resolve — manual dispatcher resolve
adminRouter.post("/geofence-alerts/:id/resolve", (req, res) => {
  const raw = req.params.id; // format "driverId:jobId"
  const [driverIdStr, jobIdStr] = raw.split(":");
  const driverId = Number(driverIdStr);
  const jobId = Number(jobIdStr);
  if (!driverId || !jobId) {
    res.status(400).json({ error: "Invalid alert id" });
    return;
  }
  const resolved = resolveAlert(driverId, jobId);
  if (!resolved) {
    res.status(404).json({ error: "Alert not found or already resolved" });
    return;
  }
  broadcastToAdmins("geofence_resolved", {
    id: resolved.id,
    driverId,
    driverName: resolved.driverName,
    jobNumber: resolved.jobNumber,
  });
  res.json({ ok: true, resolved });
});

// GET /api/drivers/analytics/summary?days=30&driverType=
adminRouter.get("/analytics/summary", async (req, res) => {
  const days = Math.min(Number(req.query.days ?? 30), 365);
  const driverTypeFilter = req.query.driverType as string | undefined;
  const fromDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const { sql: sqlFn, gte: gte2, lte: lte2 } = await import("drizzle-orm");

  const allJobs = await db
    .select({
      id: driverJobsTable.id,
      jobNumber: driverJobsTable.jobNumber,
      status: driverJobsTable.status,
      driverType: driverJobsTable.driverType,
      executionMode: driverJobsTable.executionMode,
      driverNameOverride: driverJobsTable.driverNameOverride,
      driverId: driverJobsTable.driverId,
      assignedAt: driverJobsTable.assignedAt,
      completedAt: driverJobsTable.completedAt,
      podReceiverName: driverJobsTable.podReceiverName,
      logisticOrderId: driverJobsTable.logisticOrderId,
      deliveryDateTime: driverJobsTable.deliveryDateTime,
      driverName: driversTable.name,
    })
    .from(driverJobsTable)
    .leftJoin(driversTable, eq(driverJobsTable.driverId, driversTable.id))
    .where(
      and(
        gte2(driverJobsTable.assignedAt, fromDate),
        ...(driverTypeFilter === "INTERNAL" ? [eq(driverJobsTable.driverType, "INTERNAL")] :
            driverTypeFilter === "EXTERNAL" ? [eq(driverJobsTable.driverType, "EXTERNAL")] : []),
      )
    )
    .orderBy(desc(driverJobsTable.assignedAt));

  const total = allJobs.length;
  const completed = allJobs.filter((j) => j.status === "COMPLETED").length;
  const delivered = allJobs.filter((j) => j.status === "COMPLETED" || j.status === "DELIVERED").length;
  const cancelled = allJobs.filter((j) => j.status === "CANCELLED").length;
  const inProgress = allJobs.filter((j) => !["COMPLETED", "DELIVERED", "CANCELLED"].includes(j.status)).length;
  const internalCount = allJobs.filter((j) => j.driverType === "INTERNAL").length;
  const externalCount = allJobs.filter((j) => j.driverType !== "INTERNAL").length;
  const podSubmitted = allJobs.filter((j) => j.podReceiverName).length;
  const deliveredForPod = delivered;

  const durationJobs = allJobs.filter((j) => j.completedAt && j.assignedAt && ["COMPLETED", "DELIVERED"].includes(j.status));
  const avgDurationHours = durationJobs.length > 0
    ? Math.round(durationJobs.reduce((acc, j) => acc + (j.completedAt!.getTime() - j.assignedAt.getTime()) / 3_600_000, 0) / durationJobs.length * 10) / 10
    : null;

  const onTimeJobs = allJobs.filter((j) => j.deliveryDateTime && ["COMPLETED", "DELIVERED"].includes(j.status));
  const onTimeCount = onTimeJobs.filter((j) => j.completedAt && j.completedAt <= j.deliveryDateTime!).length;

  // Status distribution for chart
  const statusDist: Record<string, number> = {};
  for (const j of allJobs) {
    statusDist[j.status] = (statusDist[j.status] ?? 0) + 1;
  }

  // Recent 15 jobs
  const recentJobs = allJobs.slice(0, 15).map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    status: j.status,
    driverType: j.driverType,
    driverName: j.driverType === "INTERNAL" ? (j.driverNameOverride ?? "Driver Internal") : (j.driverName ?? "Driver"),
    assignedAt: j.assignedAt.toISOString(),
    completedAt: j.completedAt?.toISOString() ?? null,
    logisticOrderId: j.logisticOrderId,
  }));

  res.json({
    period: { days, from: fromDate.toISOString(), to: new Date().toISOString() },
    summary: {
      total, completed, delivered, cancelled, inProgress,
      internalCount, externalCount,
      podSubmitted, deliveredForPod,
      podRate: deliveredForPod > 0 ? Math.round((podSubmitted / deliveredForPod) * 100) : null,
      successRate: total > 0 ? Math.round((delivered / total) * 100) : null,
      avgDurationHours,
      onTimeCount, onTimeTotal: onTimeJobs.length,
      onTimePct: onTimeJobs.length > 0 ? Math.round((onTimeCount / onTimeJobs.length) * 100) : null,
    },
    statusDistribution: statusDist,
    recentJobs,
  });
});

// GET /api/drivers/performance?from=&to=&driverId=
adminRouter.get("/performance", async (req, res) => {
  const fromRaw = req.query.from as string | undefined;
  const toRaw = req.query.to as string | undefined;
  const driverIdFilter = req.query.driverId ? Number(req.query.driverId) : undefined;

  const fromDate = fromRaw ? new Date(fromRaw) : (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d; })();
  const toDate = toRaw ? new Date(toRaw + "T23:59:59") : new Date();

  const { gte, lte, inArray } = await import("drizzle-orm");

  const conditions = [
    gte(driverJobsTable.assignedAt, fromDate),
    lte(driverJobsTable.assignedAt, toDate),
    ...(driverIdFilter ? [eq(driverJobsTable.driverId, driverIdFilter)] : []),
  ];

  const jobs = await db
    .select({
      driverId: driverJobsTable.driverId,
      driverName: driversTable.name,
      driverEmail: driversTable.email,
      vehiclePlate: driversTable.vehiclePlate,
      vehicleType: driversTable.vehicleType,
      status: driverJobsTable.status,
      assignedAt: driverJobsTable.assignedAt,
      completedAt: driverJobsTable.completedAt,
      deliveryDateTime: driverJobsTable.deliveryDateTime,
    })
    .from(driverJobsTable)
    .leftJoin(driversTable, eq(driverJobsTable.driverId, driversTable.id))
    .where(and(...conditions));

  type DriverStat = {
    driverId: number;
    driverName: string;
    driverEmail: string;
    vehiclePlate: string | null;
    vehicleType: string | null;
    totalJobs: number;
    completed: number;
    delivered: number;
    cancelled: number;
    inProgress: number;
    totalDurationMs: number;
    completedWithDuration: number;
    onTimeCount: number;
    onTimeEligible: number;
  };

  const statsMap = new Map<number, DriverStat>();

  const TERMINAL = new Set(["COMPLETED", "DELIVERED", "CANCELLED"]);
  const ACTIVE_STATUSES = new Set(["ASSIGNED","ACCEPTED","ON_THE_WAY_TO_PICKUP","ARRIVED_AT_PICKUP","PICKED_UP","IN_TRANSIT","ARRIVED_AT_DESTINATION"]);

  for (const job of jobs) {
    if (!job.driverId) continue;
    if (!statsMap.has(job.driverId)) {
      statsMap.set(job.driverId, {
        driverId: job.driverId,
        driverName: job.driverName ?? "",
        driverEmail: job.driverEmail ?? "",
        vehiclePlate: job.vehiclePlate,
        vehicleType: job.vehicleType,
        totalJobs: 0, completed: 0, delivered: 0, cancelled: 0, inProgress: 0,
        totalDurationMs: 0, completedWithDuration: 0,
        onTimeCount: 0, onTimeEligible: 0,
      });
    }
    const s = statsMap.get(job.driverId)!;
    s.totalJobs++;
    if (job.status === "COMPLETED") {
      s.completed++;
      s.delivered++;
    } else if (job.status === "DELIVERED") {
      s.delivered++;
    } else if (job.status === "CANCELLED") {
      s.cancelled++;
    } else if (ACTIVE_STATUSES.has(job.status)) {
      s.inProgress++;
    }
    if ((job.status === "COMPLETED" || job.status === "DELIVERED") && job.completedAt && job.assignedAt) {
      s.totalDurationMs += job.completedAt.getTime() - job.assignedAt.getTime();
      s.completedWithDuration++;
    }
    if (job.deliveryDateTime && (job.status === "COMPLETED" || job.status === "DELIVERED")) {
      s.onTimeEligible++;
      const finishedAt = job.completedAt ?? new Date();
      if (finishedAt <= job.deliveryDateTime) s.onTimeCount++;
    }
  }

  const result = [...statsMap.values()].map((s) => ({
    driverId: s.driverId,
    driverName: s.driverName,
    driverEmail: s.driverEmail,
    vehiclePlate: s.vehiclePlate,
    vehicleType: s.vehicleType,
    totalJobs: s.totalJobs,
    completed: s.completed,
    delivered: s.delivered,
    cancelled: s.cancelled,
    inProgress: s.inProgress,
    successRate: s.totalJobs > 0 ? Math.round((s.delivered / s.totalJobs) * 100) : 0,
    avgDurationHours: s.completedWithDuration > 0
      ? Math.round((s.totalDurationMs / s.completedWithDuration / 3_600_000) * 10) / 10
      : null,
    onTimeCount: s.onTimeCount,
    onTimeEligible: s.onTimeEligible,
    onTimePct: s.onTimeEligible > 0 ? Math.round((s.onTimeCount / s.onTimeEligible) * 100) : null,
  })).sort((a, b) => b.totalJobs - a.totalJobs);

  res.json({ from: fromDate.toISOString(), to: toDate.toISOString(), drivers: result });
});

// PATCH /api/drivers/jobs/:jobId/status — admin force-update + cancel (INTERNAL & EXTERNAL)
adminRouter.patch("/jobs/:jobId/status", async (req, res) => {
  const jobId = Number(req.params.jobId);
  if (isNaN(jobId)) { res.status(400).json({ message: "Invalid jobId" }); return; }
  const { status, note, force } = req.body ?? {};
  if (!status) { res.status(400).json({ message: "status wajib diisi" }); return; }

  const [currentJob] = await db.select().from(driverJobsTable).where(eq(driverJobsTable.id, jobId));
  if (!currentJob) { res.status(404).json({ message: "Job tidak ditemukan" }); return; }

  const newStatus = String(status);

  // Cannot update already-terminal unless force=true
  if (!force && (currentJob.status === "COMPLETED" || currentJob.status === "CANCELLED")) {
    res.status(400).json({ message: "Job sudah dalam status terminal (COMPLETED/CANCELLED). Gunakan force=true untuk override." });
    return;
  }

  // Validate transition — CANCELLED selalu diizinkan dari status apapun; force bypass validasi
  if (!force && newStatus !== "CANCELLED") {
    const allowed = VALID_TRANSITIONS[currentJob.status] ?? [];
    if (!allowed.includes(newStatus)) {
      res.status(400).json({
        message: `Transisi tidak valid: ${currentJob.status} → ${newStatus}`,
        currentStatus: currentJob.status,
        allowedTransitions: allowed,
      });
      return;
    }
  }

  const completedAt = newStatus === "COMPLETED" ? new Date() : null;
  const [updated] = await db
    .update(driverJobsTable)
    .set({ status: newStatus as typeof currentJob.status, ...(completedAt ? { completedAt } : {}) })
    .where(eq(driverJobsTable.id, jobId))
    .returning();

  await db.insert(driverJobLogsTable).values({
    driverJobId: jobId,
    status: newStatus as typeof currentJob.status,
    note: note ? String(note) : `Status diperbarui oleh admin${force ? " (force)" : ""}`,
    timestamp: new Date(),
  });

  await syncParentFreightStatus(updated.freightShipmentId, newStatus);
  await syncDriverToLogisticOrder(updated.logisticOrderId, newStatus);

  // updateOrderProgress — berlaku untuk INTERNAL (driverId null) maupun EXTERNAL
  const progressStep = DRIVER_STATUS_TO_PROGRESS_STEP[newStatus];
  if (progressStep && updated.logisticOrderId) {
    let driverDisplayName = updated.driverNameOverride ?? "Driver Internal";
    if (updated.driverId) {
      const [driverRow] = await db.select({ name: driversTable.name }).from(driversTable).where(eq(driversTable.id, updated.driverId));
      driverDisplayName = driverRow?.name ?? "Driver";
    }
    updateOrderProgress(
      updated.logisticOrderId,
      progressStep,
      "driver",
      driverDisplayName,
      note ? String(note) : `Admin update: ${newStatus}`,
    ).catch(() => {});
  }

  if (updated.logisticOrderId) {
    logActivity({
      orderId: updated.logisticOrderId,
      actorType: "admin",
      action: "driver_status_updated",
      description: `Admin update status driver job: ${currentJob.status} → ${newStatus}${force ? " (force)" : ""}${note ? ` — ${note}` : ""}`,
      newValue: { jobId, jobNumber: updated.jobNumber, status: newStatus, previousStatus: currentJob.status },
    }).catch(() => {});
  }

  // Broadcast SSE ke admin
  broadcastToAdmins("job_status_changed", {
    jobId,
    jobNumber: updated.jobNumber,
    status: newStatus,
    updatedAt: new Date().toISOString(),
    source: "admin",
  });

  // Broadcast ke portal untuk semua status changes (non-blocking)
  if (updated.logisticOrderId) {
    const orderId = updated.logisticOrderId;
    db.select({ orderNumber: logisticOrdersTable.orderNumber })
      .from(logisticOrdersTable).where(eq(logisticOrdersTable.id, orderId))
      .then(([row]) => {
        if (row?.orderNumber) {
          broadcastToPortal("driver_job_status_changed", {
            orderNumber: row.orderNumber,
            orderId,
            jobId,
            jobNumber: updated.jobNumber,
            status: newStatus,
            updatedAt: new Date().toISOString(),
          });
        }
      }).catch(() => {});
  }

  // WA ke admin (group) untuk semua milestone penting + CANCELLED
  if (["PICKED_UP", "DELIVERED", "COMPLETED", "CANCELLED"].includes(newStatus)) {
    (async () => {
      try {
        const driverDisplay = updated.driverType === "INTERNAL"
          ? (updated.driverNameOverride ?? "Driver Internal")
          : (() => { return "Driver"; })();

        let driverName = driverDisplay;
        if (updated.driverId) {
          const [driverRow] = await db.select({ name: driversTable.name }).from(driversTable).where(eq(driversTable.id, updated.driverId));
          driverName = driverRow?.name ?? driverDisplay;
        }

        let orderNumber = "-";
        let customerName = "-";
        let customerPhone: string | null = null;
        if (updated.logisticOrderId) {
          const [orderRow] = await db.select({
            orderNumber: logisticOrdersTable.orderNumber,
            customerName: logisticOrdersTable.customerName,
            phone: logisticOrdersTable.phone,
          }).from(logisticOrdersTable).where(eq(logisticOrdersTable.id, updated.logisticOrderId));
          if (orderRow) {
            orderNumber = orderRow.orderNumber ?? "-";
            customerName = orderRow.customerName ?? "-";
            customerPhone = orderRow.phone ?? null;
          }
        }

        const adminGroupWa = await getAdminGroupWa();
        if (adminGroupWa) {
          const emoji = newStatus === "CANCELLED" ? "❌" : newStatus === "COMPLETED" ? "✅" : "🚚";
          const statusLabel = STATUS_LABEL_ID[newStatus] ?? newStatus;
          const msg = [
            `${emoji} *Update Driver — ${updated.jobNumber}*`,
            ``,
            `👤 Driver: ${driverName}`,
            `📦 Order: ${orderNumber} (${customerName})`,
            `📍 Status: *${statusLabel}*`,
            force ? `⚡ Mode: Force Update` : null,
            note ? `📝 Catatan: ${note}` : null,
            `🕐 ${nowWIB()}`,
          ].filter(Boolean).join("\n");
          sendWhatsApp(adminGroupWa, msg).catch(() => {});
        }

        // WA ke customer untuk PICKED_UP dan DELIVERED
        if (["PICKED_UP", "DELIVERED"].includes(newStatus) && customerPhone) {
          const domain = getPreferredDomain() || "cstlogistic.co.id";
          const stepLabel = newStatus === "PICKED_UP" ? "Barang Berhasil Diambil" : "Barang Telah Terkirim";
          const customerMsg = [
            `🚚 *Update Pengiriman — B2B Marketplace and Logistic*`,
            ``,
            `Halo ${customerName},`,
            ``,
            `Order *${orderNumber}* telah diperbarui:`,
            `📍 Status: *${stepLabel}*`,
            driverName !== "Driver" && driverName !== "Driver Internal" ? `👤 Driver: ${driverName}` : null,
            note ? `📝 Catatan: ${note}` : null,
            ``,
            `Pantau pengiriman:\nhttps://${domain}/track`,
          ].filter(Boolean).join("\n");
          sendWhatsApp(customerPhone, customerMsg).catch(() => {});
        }
      } catch {
        // non-fatal
      }
    })();
  }

  const logs = await db
    .select()
    .from(driverJobLogsTable)
    .where(eq(driverJobLogsTable.driverJobId, jobId))
    .orderBy(driverJobLogsTable.timestamp);

  res.json({
    ...serializeJob(updated),
    statusLogs: logs.map((l) => ({ ...l, timestamp: l.timestamp.toISOString() })),
    validNextStatuses: VALID_TRANSITIONS[newStatus] ?? [],
  });
});

// GET /api/drivers/jobs/list — list all driver jobs (admin)
// IMPORTANT: must be registered BEFORE /:id to avoid Express swallowing it
adminRouter.get("/jobs/list", async (req, res) => {
  const shipmentId = req.query.shipmentId ? Number(req.query.shipmentId) : undefined;
  const logisticOrderId = req.query.logisticOrderId ? Number(req.query.logisticOrderId) : undefined;
  const driverId = req.query.driverId ? Number(req.query.driverId) : undefined;
  const jobs = await db
    .select({
      job: driverJobsTable,
      driverName: driversTable.name,
      driverPhone: driversTable.phone,
      driverEmail: driversTable.email,
      vehiclePlate: driversTable.vehiclePlate,
      lastLocationAt: driversTable.lastLocationAt,
      currentLat: driversTable.currentLat,
      currentLng: driversTable.currentLng,
    })
    .from(driverJobsTable)
    .leftJoin(driversTable, eq(driverJobsTable.driverId, driversTable.id))
    .where(
      shipmentId
        ? eq(driverJobsTable.freightShipmentId, shipmentId)
        : logisticOrderId
          ? eq(driverJobsTable.logisticOrderId, logisticOrderId)
          : driverId
            ? eq(driverJobsTable.driverId, driverId)
            : undefined
    )
    .orderBy(desc(driverJobsTable.createdAt));

  const jobsWithPhotos = await Promise.all(
    jobs.map(async ({ job, driverName, driverPhone, driverEmail, vehiclePlate, lastLocationAt, currentLat, currentLng }) => {
      const photos = await db
        .select()
        .from(driverPhotosTable)
        .where(eq(driverPhotosTable.driverJobId, job.id))
        .orderBy(driverPhotosTable.takenAt);
      const logs = await db
        .select()
        .from(driverJobLogsTable)
        .where(eq(driverJobLogsTable.driverJobId, job.id))
        .orderBy(driverJobLogsTable.timestamp);
      return {
        ...serializeJob(job),
        driverName,
        driverPhone,
        driverEmail,
        vehiclePlate,
        lastLocationAt: lastLocationAt?.toISOString() ?? null,
        currentLat: currentLat ?? null,
        currentLng: currentLng ?? null,
        photos: photos.map((p) => ({ ...p, takenAt: p.takenAt.toISOString() })),
        statusLogs: logs.map((l) => ({ ...l, timestamp: l.timestamp.toISOString() })),
        validNextStatuses: VALID_TRANSITIONS[job.status] ?? [],
      };
    })
  );
  res.json(jobsWithPhotos);
});

// POST /api/drivers/jobs — assign driver to a freight shipment (admin)
adminRouter.post("/jobs", async (req, res) => {
  const {
    driverId, freightShipmentId, logisticOrderId, customerName, pickupAddress, deliveryAddress,
    cargoDescription, vehicleType, truckPlate, pickupDateTime, deliveryDateTime,
    specialInstruction, weight, distance, notes,
    driverType, executionMode, driverNameOverride, driverPhoneOverride, vehiclePlateOverride,
  } = req.body ?? {};

  const resolvedDriverType: string = driverType === "INTERNAL" ? "INTERNAL" : "EXTERNAL";
  const resolvedExecutionMode: string = executionMode === "WA_MINI_FORM" ? "WA_MINI_FORM" : "DRIVER_APP";

  // INTERNAL mode: driverId not required
  if (resolvedDriverType === "EXTERNAL" && !driverId) {
    res.status(400).json({ message: "driverId wajib diisi untuk mode Driver Eksternal" });
    return;
  }
  if (resolvedDriverType === "INTERNAL" && !driverNameOverride) {
    res.status(400).json({ message: "Nama driver wajib diisi untuk mode Driver Internal" });
    return;
  }

  // Duplicate active job guard: 1 active job per logisticOrderId max
  if (logisticOrderId) {
    const { sql: sqlFn } = await import("drizzle-orm");
    const activeRows = await db.execute(sqlFn`
      SELECT id FROM driver_jobs
      WHERE logistic_order_id = ${Number(logisticOrderId)}
        AND status NOT IN ('COMPLETED', 'CANCELLED')
      LIMIT 1
    `);
    if ((activeRows.rows?.length ?? 0) > 0) {
      res.status(409).json({
        message: "Order ini masih memiliki assignment driver aktif. Selesaikan atau batalkan assignment sebelumnya terlebih dahulu.",
      });
      return;
    }
  }

  let driver: typeof driversTable.$inferSelect | null = null;
  if (driverId) {
    const [d] = await db.select().from(driversTable).where(eq(driversTable.id, Number(driverId)));
    if (!d) { res.status(404).json({ message: "Driver not found" }); return; }
    if (resolvedDriverType === "EXTERNAL" && !d.isActive) {
      res.status(400).json({ message: "Driver eksternal belum memiliki akun driver aktif." });
      return;
    }
    driver = d;
  }

  let shipmentInfo: typeof freightShipmentsTable.$inferSelect | undefined;
  if (freightShipmentId) {
    const [s] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, Number(freightShipmentId)));
    if (!s) { res.status(404).json({ message: "Freight shipment not found" }); return; }
    shipmentInfo = s;
  }

  // For INTERNAL/WA_MINI_FORM: generate wa_progress_token and insert into driver_progress_tokens
  let waProgressToken: string | null = null;
  if (resolvedExecutionMode === "WA_MINI_FORM" && logisticOrderId) {
    const { randomUUID: uuid } = await import("crypto");
    const { sql: sqlFn } = await import("drizzle-orm");
    waProgressToken = uuid();
    const resolvedDriverName = driverNameOverride ? String(driverNameOverride) : (driver?.name ?? "Driver");
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 hari
    await db.execute(sqlFn`
      INSERT INTO driver_progress_tokens (token, order_id, driver_name, driver_phone, expires_at)
      VALUES (${waProgressToken}, ${Number(logisticOrderId)}, ${resolvedDriverName}, ${driverPhoneOverride ?? null}, ${expiresAt.toISOString()})
      ON CONFLICT (token) DO NOTHING
    `).catch(() => {});
  }

  const effectiveDriverName = resolvedDriverType === "INTERNAL"
    ? (driverNameOverride ? String(driverNameOverride) : null)
    : (driver?.name ?? null);
  const effectivePhone = resolvedDriverType === "INTERNAL"
    ? (driverPhoneOverride ? String(driverPhoneOverride) : null)
    : (driver?.phone ?? null);
  const effectivePlate = resolvedDriverType === "INTERNAL"
    ? (vehiclePlateOverride ? String(vehiclePlateOverride) : null)
    : (driver?.vehiclePlate ?? null);
  const effectiveVehicleType = resolvedDriverType === "INTERNAL" ? null : (driver?.vehicleType ?? null);

  const jobNumber = nextJobNumber();
  const [job] = await db.insert(driverJobsTable).values({
    driverId: driverId ? Number(driverId) : null,
    freightShipmentId: freightShipmentId ? Number(freightShipmentId) : null,
    logisticOrderId: logisticOrderId ? Number(logisticOrderId) : null,
    jobNumber,
    customerName: customerName ? String(customerName) : (shipmentInfo ? String(shipmentInfo.shipperName ?? "") : null),
    pickupAddress: pickupAddress ? String(pickupAddress) : null,
    deliveryAddress: deliveryAddress ? String(deliveryAddress) : null,
    cargoDescription: cargoDescription ? String(cargoDescription) : (shipmentInfo ? String(shipmentInfo.commodity ?? "") : null),
    vehicleType: vehicleType ? String(vehicleType) : effectiveVehicleType,
    truckPlate: truckPlate ? String(truckPlate) : effectivePlate,
    pickupDateTime: pickupDateTime ? new Date(pickupDateTime as string) : null,
    deliveryDateTime: deliveryDateTime ? new Date(deliveryDateTime as string) : null,
    specialInstruction: specialInstruction ? String(specialInstruction) : null,
    weight: weight ? String(weight) : null,
    distance: distance ? String(distance) : null,
    notes: notes ? String(notes) : null,
    driverType: resolvedDriverType,
    executionMode: resolvedExecutionMode,
    waProgressToken,
    driverNameOverride: driverNameOverride ? String(driverNameOverride) : null,
    driverPhoneOverride: driverPhoneOverride ? String(driverPhoneOverride) : null,
    vehiclePlateOverride: vehiclePlateOverride ? String(vehiclePlateOverride) : null,
  }).returning();

  await db.insert(driverJobLogsTable).values({
    driverJobId: job.id,
    status: "ASSIGNED",
    note: "Job diterima sistem",
    timestamp: new Date(),
  });

  // Push real-time event ke driver yang sedang online (EXTERNAL only)
  if (driverId) {
    pushToDriver(Number(driverId), "new_job", {
      jobId: job.id,
      jobNumber: job.jobNumber,
      customerName: job.customerName,
      pickupAddress: job.pickupAddress,
      deliveryAddress: job.deliveryAddress,
      assignedAt: job.assignedAt.toISOString(),
    });
  }

  const domain = getPreferredDomain();

  if (resolvedExecutionMode === "WA_MINI_FORM" && waProgressToken && effectivePhone) {
    // INTERNAL: kirim WA Mini Form link ke nomor driver
    const { normalizePhone } = await import("../lib/phoneUtils.js");
    const waLink = `https://${domain}/driver-progress/${waProgressToken}`;
    const pickup = job.pickupAddress ?? "-";
    const delivery = job.deliveryAddress ?? "-";
    const msg = [
      `🚚 *Penugasan Pengiriman Baru*`,
      ``,
      `Anda ditugaskan sebagai driver untuk order ini.`,
      ``,
      `Pickup: ${pickup}`,
      `Tujuan: ${delivery}`,
      job.cargoDescription ? `Muatan: ${job.cargoDescription}` : null,
      job.specialInstruction ? `Catatan: ${job.specialInstruction}` : null,
      ``,
      `*Link Update Progress:*`,
      waLink,
      ``,
      `Klik link di atas untuk update status pengiriman (Pickup → Transit → Delivered).`,
    ].filter(Boolean).join("\n");
    const normalizedPhone = normalizePhone(effectivePhone);
    req.log?.info({ driverPhoneNorm: normalizedPhone, jobNumber, jobId: job.id }, "[WA-driver] mengirim WA ke driver INTERNAL (WA_MINI_FORM)...");
    sendWhatsApp(normalizedPhone, msg, {
      context: "driver-job-assigned-internal",
      refType:  "driver_job",
      refId:    String(job.id),
    })
      .then(() => {
        req.log?.info({ phone: normalizedPhone, jobNumber, jobId: job.id }, "[WA-driver] WA ke driver INTERNAL BERHASIL");
      })
      .catch((err: unknown) => {
        req.log?.warn?.({ err, phone: normalizedPhone, jobId: job.id }, "[WA-driver] WA ke driver INTERNAL GAGAL — akan di-retry oleh waRetryWorker");
      });
  } else if (resolvedDriverType === "EXTERNAL" && driver?.phone) {
    // EXTERNAL: kirim detail penugasan melalui WhatsApp
    const { normalizePhone } = await import("../lib/phoneUtils.js");
    const normalizedDriverPhone = normalizePhone(driver.phone);
    const pickup = job.pickupAddress ?? "-";
    const delivery = job.deliveryAddress ?? "-";
    const customer = job.customerName ?? "-";
    req.log?.info({ driverId: driver.id, driverPhoneRaw: driver.phone, driverPhoneNorm: normalizedDriverPhone, jobNumber }, "[WA-driver] mengirim WA ke driver EXTERNAL...");
    const msg = [
      `🚚 *Job Baru: ${jobNumber}*`,
      ``,
      `Pelanggan: ${customer}`,
      `Pickup: ${pickup}`,
      `Tujuan: ${delivery}`,
      job.cargoDescription ? `Muatan: ${job.cargoDescription}` : null,
      job.specialInstruction ? `Catatan: ${job.specialInstruction}` : null,
      ``,
      `Mohon konfirmasi penugasan melalui WhatsApp.`,
    ].filter(Boolean).join("\n");
    sendWhatsApp(normalizedDriverPhone, msg, {
      context: "driver-job-assigned-external",
      refType:  "driver_job",
      refId:    String(job.id),
    })
      .then(() => {
        req.log?.info({ driverId: driver!.id, phone: normalizedDriverPhone, jobNumber, jobId: job.id }, "[WA-driver] WA ke driver EXTERNAL BERHASIL");
      })
      .catch((err: unknown) => {
        req.log?.error?.({ err, driverId: driver!.id, phone: normalizedDriverPhone, jobId: job.id }, "[WA-driver] WA ke driver EXTERNAL GAGAL — akan di-retry oleh waRetryWorker");
      });
  }

  // Notifikasi template ke customer jika job terhubung ke logistic order
  if (job.logisticOrderId && driver) {
    fetchOrderData(job.logisticOrderId).then((orderData) => {
      if (!orderData) return;
      sendDriverAssignedNotification(
        orderData,
        effectiveDriverName ?? driver!.name,
        effectivePhone ?? driver!.phone ?? "",
        job.truckPlate ?? effectivePlate ?? "-",
        job.vehicleType ?? effectiveVehicleType ?? "-",
      ).catch((err: unknown) => req.log?.error?.({ err }, "sendDriverAssignedNotification failed"));
    }).catch(() => {});
  }

  res.status(201).json(serializeJob(job));
});

// PUT /api/drivers/jobs/:jobId — update job (admin)
adminRouter.put("/jobs/:jobId", async (req, res) => {
  const jobId = Number(req.params.jobId);
  const { status, notes, customerName, pickupAddress, deliveryAddress, cargoDescription } = req.body ?? {};
  const update: Record<string, unknown> = {};
  if (status) {
    const [current] = await db.select({ status: driverJobsTable.status }).from(driverJobsTable).where(eq(driverJobsTable.id, jobId));
    if (current) {
      const allowed = VALID_TRANSITIONS[current.status] ?? [];
      if (!allowed.includes(String(status))) {
        res.status(400).json({
          message: `Transisi status tidak valid: ${current.status} → ${status}`,
          currentStatus: current.status,
          allowedTransitions: allowed,
        });
        return;
      }
    }
    update.status = status;
  }
  if (notes !== undefined) update.notes = notes;
  if (customerName) update.customerName = customerName;
  if (pickupAddress) update.pickupAddress = pickupAddress;
  if (deliveryAddress) update.deliveryAddress = deliveryAddress;
  if (cargoDescription) update.cargoDescription = cargoDescription;
  const [job] = await db.update(driverJobsTable).set(update).where(eq(driverJobsTable.id, jobId)).returning();
  if (!job) { res.status(404).json({ message: "Job not found" }); return; }

  if (status) {
    await db.insert(driverJobLogsTable).values({
      driverJobId: jobId,
      status,
      note: "Status diperbarui oleh admin",
      timestamp: new Date(),
    });
    await syncParentFreightStatus(job.freightShipmentId, String(status));
    await syncDriverToLogisticOrder(job.logisticOrderId ?? null, String(status));
  }

  res.json(serializeJob(job));
});

// GET /api/drivers/:id — must be AFTER /jobs/list to avoid route shadowing
adminRouter.get("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const [driver] = await db.select().from(driversTable).where(eq(driversTable.id, id));
  if (!driver) { res.status(404).json({ message: "Driver not found" }); return; }
  const jobs = await db
    .select()
    .from(driverJobsTable)
    .where(eq(driverJobsTable.driverId, id))
    .orderBy(desc(driverJobsTable.createdAt))
    .limit(20);
  const { passwordHash: _ph, ...safeDriver } = driver;
  res.json({ ...safeDriver, jobs: jobs.map(serializeJob) });
});

// PUT /api/drivers/:id — must be AFTER /jobs/* routes
adminRouter.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const { name, email, password, phone, licenseNumber, vehiclePlate, vehicleType, isActive } = req.body ?? {};
  const updateData: Record<string, unknown> = {};
  if (name) updateData.name = String(name);
  if (email) updateData.email = String(email);
  if (password) updateData.passwordHash = await hashPassword(String(password));
  if (phone !== undefined) updateData.phone = phone ? String(phone) : null;
  if (licenseNumber !== undefined) updateData.licenseNumber = licenseNumber ? String(licenseNumber) : null;
  if (vehiclePlate !== undefined) updateData.vehiclePlate = vehiclePlate ? String(vehiclePlate) : null;
  if (vehicleType !== undefined) updateData.vehicleType = vehicleType ? String(vehicleType) : null;
  if (isActive !== undefined) updateData.isActive = Boolean(isActive);
  const [driver] = await db.update(driversTable).set(updateData).where(eq(driversTable.id, id)).returning();
  if (!driver) { res.status(404).json({ message: "Driver not found" }); return; }
  const { passwordHash: _ph, ...safeDriver } = driver;
  res.json(safeDriver);
});

// DELETE /api/drivers/:id — soft delete (deactivate); must be AFTER /jobs/* routes
adminRouter.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const [driver] = await db.update(driversTable).set({ isActive: false }).where(eq(driversTable.id, id)).returning();
  if (!driver) { res.status(404).json({ message: "Driver not found" }); return; }
  res.json({ ok: true });
});

export { router as driverRouter, adminRouter as driversAdminRouter };

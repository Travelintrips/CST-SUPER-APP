import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";
import { createHmac } from "crypto";
import { compressImageBuffer } from "../lib/imageCompress";
import { db, driversTable, driverJobsTable, driverJobLogsTable, driverPhotosTable, freightShipmentsTable, driverLocationsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin";
import { ObjectStorageService } from "../lib/objectStorage";
import { sendWhatsApp } from "../lib/fonnte";
import { getPreferredDomain } from "../lib/domain";
import {
  registerDriverConnection, unregisterDriverConnection, pushToDriver,
  registerAdminConnection, unregisterAdminConnection, broadcastToAdmins,
} from "../lib/sseManager";
import { checkGeofence } from "../lib/geofence";
import { upsertAlert, resolveAlert, getActiveAlerts, hasActiveAlert } from "../lib/geofenceAlertStore";

const router = Router();
const adminRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const objectStorageService = new ObjectStorageService();

const JWT_SECRET = process.env.SESSION_SECRET;
if (!JWT_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required for driver auth");
}

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

async function uploadPhotoToStorage(buffer: Buffer, mimetype: string, jobId: number): Promise<string> {
  try {
    const { buffer: compressed, contentType } = await compressImageBuffer(buffer, mimetype, "photo");
    const filename = `${randomUUID()}.jpg`;
    const storagePath = `public/cargo-photos/${jobId}/${filename}`;
    await objectStorageService.uploadFile(compressed, storagePath, contentType);
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
  const { status, note } = req.body ?? {};
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

  // Push real-time event to all admin/dispatcher connections
  broadcastToAdmins("job_status_changed", {
    jobId,
    jobNumber: updated.jobNumber,
    driverId,
    status,
    freightShipmentId: updated.freightShipmentId,
    updatedAt: new Date().toISOString(),
  });

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

  res.json({ ...photo, takenAt: photo.takenAt.toISOString() });
});

// POST /api/driver/jobs/:jobId/pod
router.post("/jobs/:jobId/pod", requireDriverAuth, async (req, res) => {
  const driverId = (req as DriverAuthReq).driverId;
  const jobId = Number(req.params.jobId);
  const { receiverName } = req.body ?? {};
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

  const [updated] = await db
    .update(driverJobsTable)
    .set({ podReceiverName: String(receiverName), status: "DELIVERED" })
    .where(eq(driverJobsTable.id, jobId))
    .returning();

  await db.insert(driverJobLogsTable).values({
    driverJobId: jobId,
    status: "DELIVERED",
    note: `POD diterima oleh: ${receiverName}`,
    timestamp: new Date(),
  });

  await syncParentFreightStatus(job.freightShipmentId, "DELIVERED");

  res.json({ ...serializeJob(updated), validNextStatuses: VALID_TRANSITIONS["DELIVERED"] });
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

// GET /api/drivers/jobs/list — list all driver jobs (admin)
// IMPORTANT: must be registered BEFORE /:id to avoid Express swallowing it
adminRouter.get("/jobs/list", async (req, res) => {
  const shipmentId = req.query.shipmentId ? Number(req.query.shipmentId) : undefined;
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
  } = req.body ?? {};

  if (!driverId) { res.status(400).json({ message: "driverId wajib diisi" }); return; }

  const [driver] = await db.select().from(driversTable).where(eq(driversTable.id, Number(driverId)));
  if (!driver) { res.status(404).json({ message: "Driver not found" }); return; }

  let shipmentInfo: typeof freightShipmentsTable.$inferSelect | undefined;
  if (freightShipmentId) {
    const [s] = await db.select().from(freightShipmentsTable).where(eq(freightShipmentsTable.id, Number(freightShipmentId)));
    if (!s) { res.status(404).json({ message: "Freight shipment not found" }); return; }
    shipmentInfo = s;
  }

  const jobNumber = nextJobNumber();
  const [job] = await db.insert(driverJobsTable).values({
    driverId: Number(driverId),
    freightShipmentId: freightShipmentId ? Number(freightShipmentId) : null,
    logisticOrderId: logisticOrderId ? Number(logisticOrderId) : null,
    jobNumber,
    customerName: customerName ? String(customerName) : (shipmentInfo ? String(shipmentInfo.shipperName ?? "") : null),
    pickupAddress: pickupAddress ? String(pickupAddress) : null,
    deliveryAddress: deliveryAddress ? String(deliveryAddress) : null,
    cargoDescription: cargoDescription ? String(cargoDescription) : (shipmentInfo ? String(shipmentInfo.commodity ?? "") : null),
    vehicleType: vehicleType ? String(vehicleType) : driver.vehicleType,
    truckPlate: truckPlate ? String(truckPlate) : driver.vehiclePlate,
    pickupDateTime: pickupDateTime ? new Date(pickupDateTime as string) : null,
    deliveryDateTime: deliveryDateTime ? new Date(deliveryDateTime as string) : null,
    specialInstruction: specialInstruction ? String(specialInstruction) : null,
    weight: weight ? String(weight) : null,
    distance: distance ? String(distance) : null,
    notes: notes ? String(notes) : null,
  }).returning();

  await db.insert(driverJobLogsTable).values({
    driverJobId: job.id,
    status: "ASSIGNED",
    note: "Job diterima sistem",
    timestamp: new Date(),
  });

  // Push real-time event ke driver yang sedang online
  pushToDriver(Number(driverId), "new_job", {
    jobId: job.id,
    jobNumber: job.jobNumber,
    customerName: job.customerName,
    pickupAddress: job.pickupAddress,
    deliveryAddress: job.deliveryAddress,
    assignedAt: job.assignedAt.toISOString(),
  });

  // Kirim notifikasi WhatsApp ke driver
  if (driver.phone) {
    const pickup = job.pickupAddress ?? "-";
    const delivery = job.deliveryAddress ?? "-";
    const customer = job.customerName ?? "-";
    const msg = [
      `🚚 *Job Baru: ${jobNumber}*`,
      ``,
      `Pelanggan: ${customer}`,
      `Pickup: ${pickup}`,
      `Tujuan: ${delivery}`,
      job.cargoDescription ? `Muatan: ${job.cargoDescription}` : null,
      job.specialInstruction ? `Catatan: ${job.specialInstruction}` : null,
      ``,
      `Buka aplikasi CST Driver:`,
      `https://${getPreferredDomain()}/api/driver/open-app`,
    ].filter(Boolean).join("\n");
    sendWhatsApp(driver.phone, msg).catch((err: unknown) => {
      req.log.error({ err, driverId: driver.id, phone: driver.phone }, "sendWhatsApp failed for job assignment");
    });
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

// GET /api/driver/open-app — redirect WA link ke deep link CST Driver app
router.get("/open-app", (_req: Request, res: Response) => {
  const html = `<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>Buka CST Driver</title>
  <style>
    body{font-family:sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0F3460;color:#fff;text-align:center;padding:24px;box-sizing:border-box}
    h1{font-size:1.4rem;margin-bottom:8px}
    p{color:#cdd;margin-bottom:24px;font-size:.95rem}
    a.btn{display:inline-block;background:#FF6B00;color:#fff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:1rem;font-weight:600}
  </style>
</head>
<body>
  <h1>🚛 CST Driver</h1>
  <p>Ketuk tombol di bawah untuk membuka aplikasi</p>
  <a class="btn" href="cst-driver://jobs">Buka Aplikasi</a>
  <script>setTimeout(()=>{window.location.href='cst-driver://jobs'},500);</script>
</body>
</html>`;
  res.setHeader("Content-Type", "text/html");
  res.send(html);
});

export { router as driverRouter, adminRouter as driversAdminRouter };

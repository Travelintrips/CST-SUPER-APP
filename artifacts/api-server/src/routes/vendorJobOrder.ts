/**
 * Vendor Job Order Flow
 *
 * Admin:
 *   POST /api/logistic/orders/:orderId/assign-vendor   → pilih vendor pemenang, generate token, siapkan WA
 *   GET  /api/logistic/orders/:orderId/job-order        → ambil data job order + semua quotes
 *   POST /api/logistic/orders/:orderId/job-progress     → admin update progress (tracking)
 *   POST /api/logistic/orders/:orderId/complete-review  → admin konfirmasi penyelesaian
 *
 * Public (Vendor):
 *   GET  /api/vendor-job/:token          → ambil detail job
 *   POST /api/vendor-job/:token/accept   → terima job + isi detail operasional
 *   POST /api/vendor-job/:token/reject   → tolak job
 *   POST /api/vendor-job/:token/progress → vendor update progress
 *   POST /api/vendor-job/:token/pod      → upload POD/invoice/foto (multipart, simpan URL)
 *
 * Public (Customer):
 *   GET  /api/order-track/:trackToken    → lihat tracking progress order
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq, inArray, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { transitionLogisticOrderStatus, getAllowedTransitions } from "../lib/services/logisticOrderStatusService.js";
import { createExceptionIdempotent } from "../lib/services/exceptionService.js";
import {
  db,
  logisticOrdersTable,
  logisticOrderQuotesTable,
  logisticOrderRfqsTable,
  logisticOrderItemsTable,
  suppliersTable,
  orderUpdatesTable,
  driverJobsTable,
  driverPhotosTable,
  driversTable,
  driverLocationsTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { TAX_RATE_DECIMAL } from "../lib/taxHelper.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import {
  sendVendorAssignmentNotification,
  sendVendorJobAcceptedNotification,
  sendVendorJobRejectedNotification,
  sendVendorProgressUpdateNotification,
  sendVendorPodUploadedNotification,
  sendCustomerProgressUpdateNotification,
  sendCustomerPodUploadedNotification,
  sendOrderCompletedNotification,
  resolveTemplateSnapshot,
  type VendorAssignmentItem,
} from "../lib/orderNotification.js";
import { autoCreateLogisticInvoice, type LogisticOrderData } from "../lib/podInvoiceAutoCreate.js";
import { logger } from "../lib/logger.js";
import { recordDecision, updateDecisionOutcome } from "../lib/decisionMemory.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { documentUpload } from "../lib/uploadMiddleware.js";

// ─────────────────────────────────────────────────────────────────────────────
// Migration (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

let migDone = false;
async function ensureTables() {
  if (migDone) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_job_orders (
        id              SERIAL PRIMARY KEY,
        order_id        INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        quote_id        INTEGER REFERENCES logistic_order_quotes(id) ON DELETE SET NULL,
        vendor_id       INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        token           TEXT NOT NULL UNIQUE,
        status          TEXT NOT NULL DEFAULT 'pending',
        service_type    TEXT NOT NULL DEFAULT '',
        -- Operasional (trucking)
        driver_name     TEXT,
        driver_phone    TEXT,
        vehicle_plate   TEXT,
        vehicle_type    TEXT,
        pickup_time     TEXT,
        -- Operasional (freight)
        carrier         TEXT,
        schedule        TEXT,
        etd             TEXT,
        eta             TEXT,
        awb_bl_number   TEXT,
        -- Operasional (product)
        stock_confirmed TEXT,
        delivery_schedule TEXT,
        -- Operasional (customs/document)
        document_status TEXT,
        -- Umum
        notes           TEXT,
        reject_reason   TEXT,
        -- POD & completion
        pod_files       JSONB NOT NULL DEFAULT '[]'::jsonb,
        completion_notes TEXT,
        -- Timestamps
        accepted_at     TIMESTAMPTZ,
        rejected_at     TIMESTAMPTZ,
        completed_at    TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS order_tracking_progress (
        id           SERIAL PRIMARY KEY,
        order_id     INTEGER NOT NULL REFERENCES logistic_orders(id) ON DELETE CASCADE,
        job_order_id INTEGER REFERENCES vendor_job_orders(id) ON DELETE CASCADE,
        status       TEXT NOT NULL,
        notes        TEXT,
        photo_url    TEXT,
        updated_by   TEXT NOT NULL DEFAULT 'admin',
        is_public    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      ALTER TABLE order_tracking_progress ADD COLUMN IF NOT EXISTS photo_url TEXT;

      ALTER TABLE logistic_orders
        ADD COLUMN IF NOT EXISTS tracking_token TEXT UNIQUE,
        ADD COLUMN IF NOT EXISTS job_status TEXT;

      CREATE INDEX IF NOT EXISTS vjo_order_idx ON vendor_job_orders(order_id);
      CREATE INDEX IF NOT EXISTS vjo_token_idx ON vendor_job_orders(token);
      CREATE INDEX IF NOT EXISTS otp_order_idx ON order_tracking_progress(order_id);
    `);
    // ── Expiry columns (separate calls — pgBouncer multi-statement limit) ────
    await db.execute(sql`
      ALTER TABLE vendor_job_orders ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ
    `).catch(() => {});
    await db.execute(sql`
      ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS track_token_expires_at TIMESTAMPTZ
    `).catch(() => {});
    // ── Backfill: existing tokens get 90-day window from NOW() ────────────────
    await db.execute(sql`
      UPDATE vendor_job_orders
      SET token_expires_at = NOW() + INTERVAL '90 days'
      WHERE token IS NOT NULL AND token_expires_at IS NULL
    `).catch(() => {});
    await db.execute(sql`
      UPDATE logistic_orders
      SET track_token_expires_at = NOW() + INTERVAL '90 days'
      WHERE tracking_token IS NOT NULL AND track_token_expires_at IS NULL
    `).catch(() => {});
    migDone = true;
    logger.info("vendorJobOrder migration: ok");
  } catch (err) {
    logger.warn({ err }, "vendorJobOrder migration warn");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const tok = () => randomBytes(24).toString("hex");

function baseUrl() {
  const d = getPreferredDomain();
  return d ? `https://${d}` : "";
}

const JOB_STATUS_LABEL: Record<string, string> = {
  pending:          "Menunggu Respon Vendor",
  accepted:         "Vendor Menerima",
  rejected:         "Vendor Menolak",
  pickup_scheduled: "Pickup Dijadwalkan",
  in_progress:      "Sedang Diproses",
  completed:        "Selesai",
  problem:          "Ada Masalah / Perlu Perhatian",
};


// ─────────────────────────────────────────────────────────────────────────────
// Object storage for POD
// ─────────────────────────────────────────────────────────────────────────────

const pubObjStore = new ObjectStorageService();
const upload = documentUpload(20);

// ─────────────────────────────────────────────────────────────────────────────
// Admin Router
// ─────────────────────────────────────────────────────────────────────────────

export const vendorJobAdminRouter = Router();

/**
 * POST /api/logistic/orders/:orderId/assign-vendor
 * Body: { quoteId, adminNote? }
 */
vendorJobAdminRouter.post("/orders/:orderId/assign-vendor", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTables();
  const orderId = Number(req.params["orderId"]);
  const { quoteId, adminNote } = req.body as { quoteId: number; adminNote?: string };

  if (!quoteId) return res.status(400).json({ message: "quoteId wajib diisi" });

  try {
    // Ambil quote terpilih
    const [quote] = await db.select().from(logisticOrderQuotesTable)
      .where(and(eq(logisticOrderQuotesTable.id, quoteId), eq(logisticOrderQuotesTable.orderId, orderId)));
    if (!quote) return res.status(404).json({ message: "Quote tidak ditemukan" });

    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    const [vendor] = await db.select().from(suppliersTable)
      .where(eq(suppliersTable.id, quote.vendorId));
    if (!vendor) return res.status(404).json({ message: "Vendor tidak ditemukan" });

    // Fetch order items untuk breakdown harga di WA
    const _itemRows = await db.select({
      serviceName: logisticOrderItemsTable.serviceName,
      subtotal: logisticOrderItemsTable.subtotal,
      inputData: logisticOrderItemsTable.inputData,
    }).from(logisticOrderItemsTable).where(eq(logisticOrderItemsTable.orderId, orderId));
    const _xQty = (inp: Record<string, unknown> | null): number => { if (!inp) return 1; const v = inp.qty ?? inp.quantity; const n = parseFloat(String(v ?? "")); return isNaN(n) || n <= 0 ? 1 : n; };
    const _xUnit = (inp: Record<string, unknown> | null): string => { if (!inp) return "unit"; return inp.unit != null ? String(inp.unit) : "unit"; };
    const _xPrice = (inp: Record<string, unknown> | null): number | null => { if (!inp) return null; const p = inp.price ?? inp.productPrice ?? inp.unitPrice ?? inp.sellingPrice ?? inp.basicPrice ?? null; if (typeof p === "number") return p > 0 ? p : null; if (typeof p === "string") { const n = parseFloat(p); return !isNaN(n) && n > 0 ? n : null; } return null; };
    let assignmentItems: VendorAssignmentItem[] = _itemRows.flatMap((row) => {
      const inp = row.inputData as Record<string, unknown> | null;
      const qty = _xQty(inp);
      const subtotalVal = Number(row.subtotal ?? 0);
      const price = _xPrice(inp) ?? (subtotalVal > 0 && qty > 0 ? Math.round(subtotalVal / qty) : null);
      if (!price) return [];
      return [{ name: row.serviceName ?? "Produk", qty, unit: _xUnit(inp), basicPrice: price, taxRate: TAX_RATE_DECIMAL }];
    });

    // Fallback untuk freight order: gunakan harga dari approved quote + info cargo
    if (assignmentItems.length === 0) {
      const vendorPrice = Number(quote.vendorPrice ?? 0);
      if (vendorPrice > 0) {
        // Buat deskripsi muatan dari kolom order
        const cargoParts: string[] = [];
        if (order.cargoDescription) cargoParts.push(order.cargoDescription);
        if (order.commodity && order.commodity !== order.cargoDescription) cargoParts.push(order.commodity);
        const cargoLabel = cargoParts.join(", ") || order.shipmentType || "Jasa Pengiriman";
        // Detail fisik muatan untuk unit
        const weightParts: string[] = [];
        if (order.grossWeight) weightParts.push(`${Number(order.grossWeight).toLocaleString("id-ID")} kg`);
        if (order.volumeCbm) weightParts.push(`${Number(order.volumeCbm).toLocaleString("id-ID")} CBM`);
        if (order.jumlahKoli) weightParts.push(`${order.jumlahKoli} koli`);
        const unitLabel = weightParts.length > 0 ? weightParts.join(" / ") : "shipment";
        assignmentItems = [{
          name: cargoLabel,
          qty: 1,
          unit: unitLabel,
          basicPrice: vendorPrice,
          taxRate: 0.11,
        }];
      }
    }

    // Resolve templateSnapshot: A. order → B. RFQ → C. VMF → D. null (fallback ke shipmentType)
    const resolvedSnapshot = await resolveTemplateSnapshot(orderId, order.templateSnapshot as Record<string, unknown> | null);

    // Cek apakah sudah ada job order untuk order ini
    const existing = await db.execute(
      sql`SELECT id, token FROM vendor_job_orders WHERE order_id = ${orderId} LIMIT 1`
    );
    if ((existing.rows ?? []).length > 0) {
      const row = existing.rows[0] as { id: number; token: string };
      const jobUrl = `${baseUrl()}/vendor-job/${row.token}`;
      const waMsg = await sendVendorAssignmentNotification(order.orderNumber, order.origin, order.destination, order.shipmentType, jobUrl, vendor.phone, adminNote, assignmentItems, quote.estimatedPickup, quote.estimatedDelivery, quote.estimatedDays, resolvedSnapshot);
      return res.json({ ok: true, jobToken: row.token, jobUrl, waMessage: waMsg, vendorPhone: vendor.phone, alreadyExists: true });
    }

    // Generate token job order + tracking token
    const jobToken = tok();
    const trackingToken = tok();

    // Insert job order (dengan expiry 90 hari)
    await db.execute(sql`
      INSERT INTO vendor_job_orders (order_id, quote_id, vendor_id, token, status, service_type, token_expires_at)
      VALUES (${orderId}, ${quote.id}, ${quote.vendorId}, ${jobToken}, 'pending', ${order.shipmentType},
              NOW() + INTERVAL '90 days')
    `);

    // Update order: set approvedVendorId, tracking_token, status, job_status
    await db.update(logisticOrdersTable).set({
      approvedVendorId: quote.vendorId,
      approvedQuoteId: quote.id,
    } as any).where(eq(logisticOrdersTable.id, orderId));
    await transitionLogisticOrderStatus(orderId, "Vendor Confirmed", { source: "vendorJobOrder:assign_vendor", actorType: "admin" });

    // Set tracking_token + expiry (raw SQL karena kolom baru)
    await db.execute(sql`
      UPDATE logistic_orders
      SET tracking_token = ${trackingToken},
          track_token_expires_at = NOW() + INTERVAL '90 days',
          job_status = 'vendor_assigned'
      WHERE id = ${orderId}
    `);

    // Mark quote terpilih sebagai 'approved', lainnya 'not_selected'
    await db.update(logisticOrderQuotesTable)
      .set({ quoteStatus: "approved" })
      .where(eq(logisticOrderQuotesTable.id, quoteId));

    const allQuotes = await db.select({ id: logisticOrderQuotesTable.id })
      .from(logisticOrderQuotesTable)
      .where(and(eq(logisticOrderQuotesTable.orderId, orderId)));
    const otherIds = allQuotes.map(q => q.id).filter(id => id !== quoteId);
    if (otherIds.length > 0) {
      await db.update(logisticOrderQuotesTable)
        .set({ quoteStatus: "not_selected" })
        .where(inArray(logisticOrderQuotesTable.id, otherIds));
    }

    // Progress tracking entry
    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, status, notes, updated_by, is_public)
      VALUES (${orderId}, 'Vendor Assigned', ${"Vendor " + vendor.name + " telah dipilih untuk order ini."}, 'admin', true)
    `);

    // Activity log
    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: "Vendor Assigned",
      notes: `Vendor *${vendor.name}* dipilih. Job order dikirim.${adminNote ? "\nCatatan: " + adminNote : ""}`,
      isPublic: false,
    });

    const jobUrl = `${baseUrl()}/vendor-job/${jobToken}`;
    const waMsg = await sendVendorAssignmentNotification(order.orderNumber, order.origin, order.destination, order.shipmentType, jobUrl, vendor.phone, adminNote, assignmentItems, quote.estimatedPickup, quote.estimatedDelivery, quote.estimatedDays, resolvedSnapshot);

    // Notify admin group
    const adminWa = await getAdminWa();
    if (adminWa) {
      sendWhatsApp(adminWa,
        `📋 *Vendor Ditugaskan*\n\nOrder: ${order.orderNumber}\nVendor: ${vendor.name}\nLink Job: ${jobUrl}`
      ).catch(() => {});
    }

    // Catat ke Decision Memory Store (fire-and-forget)
    recordDecision({
      decisionType: "vendor_assignment",
      chosenEntityType: "vendor",
      chosenEntityId: vendor.id,
      chosenEntityName: vendor.name,
      reasoning: adminNote ?? `Admin memilih ${vendor.name} untuk order ${order.orderNumber}`,
      decidedBy: "admin",
      orderId,
      orderNumber: order.orderNumber,
      rfqId: quote.rfqId ?? undefined,
      quoteId: quote.id,
      companyId: order.companyId ?? undefined,
      origin: order.origin,
      destination: order.destination,
      shipmentType: order.shipmentType,
      transportMode: order.transportMode ?? undefined,
      commodity: order.commodity ?? undefined,
      weightKg: order.weightKg ? parseFloat(String(order.weightKg)) : undefined,
      direction: order.direction ?? undefined,
      quotedVendorPrice: quote.vendorPrice ? parseFloat(String(quote.vendorPrice)) : undefined,
      contextSnapshot: {
        quoteEstimatedDays: quote.estimatedDays,
        quoteSellingPrice: quote.sellingPrice,
        orderGrandTotal: order.grandTotal,
        orderStatus: order.status,
      },
    }).catch(() => {});

    logger.info({ orderId, jobToken, vendorId: vendor.id }, "Vendor assigned");
    return res.status(201).json({
      ok: true, jobToken, jobUrl,
      trackingToken,
      trackingUrl: `${baseUrl()}/order-track/${trackingToken}`,
      waMessage: waMsg,
      vendorPhone: vendor.phone,
    });
  } catch (err) {
    logger.error({ err }, "assign-vendor error");
    return res.status(500).json({ message: "Gagal menugaskan vendor" });
  }
});

/**
 * GET /api/logistic/orders/:orderId/job-order
 */
vendorJobAdminRouter.get("/orders/:orderId/job-order", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTables();
  const orderId = Number(req.params["orderId"]);

  try {
    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    // Job order
    const jobResult = await db.execute(
      sql`SELECT vjo.*, s.name as vendor_name, s.phone as vendor_phone
          FROM vendor_job_orders vjo
          LEFT JOIN suppliers s ON s.id = vjo.vendor_id
          WHERE vjo.order_id = ${orderId}
          ORDER BY vjo.created_at DESC LIMIT 1`
    );
    const jobOrder = jobResult.rows[0] ?? null;

    // Quotes dari semua RFQ order ini
    const rfqs = await db.select({ id: logisticOrderRfqsTable.id })
      .from(logisticOrderRfqsTable)
      .where(eq(logisticOrderRfqsTable.orderId, orderId));
    const rfqIds = rfqs.map(r => r.id);

    let quotes: any[] = [];
    if (rfqIds.length > 0) {
      const qResult = await db.execute(sql`
        SELECT q.*, s.name as vendor_name, s.phone as vendor_phone
        FROM logistic_order_quotes q
        LEFT JOIN suppliers s ON s.id = q.vendor_id
        WHERE q.order_id = ${orderId}
        ORDER BY q.vendor_price ASC NULLS LAST
      `);
      quotes = qResult.rows as any[];
    }

    // Tracking progress
    const progressResult = await db.execute(
      sql`SELECT * FROM order_tracking_progress WHERE order_id = ${orderId} ORDER BY created_at DESC`
    );

    // tracking_token
    const tokenResult = await db.execute(
      sql`SELECT tracking_token FROM logistic_orders WHERE id = ${orderId}`
    );
    const trackingToken = (tokenResult.rows[0] as any)?.tracking_token ?? null;

    return res.json({
      order,
      jobOrder,
      quotes,
      progress: progressResult.rows,
      trackingToken,
      trackingUrl: trackingToken ? `${baseUrl()}/order-track/${trackingToken}` : null,
      jobUrl: jobOrder ? `${baseUrl()}/vendor-job/${(jobOrder as any).token}` : null,
    });
  } catch (err) {
    logger.error({ err }, "get-job-order error");
    return res.status(500).json({ message: "Gagal mengambil data job order" });
  }
});

/**
 * POST /api/logistic/orders/:orderId/job-progress
 * Admin tambah progress tracking
 * Body: { status, notes, isPublic }
 */
vendorJobAdminRouter.post("/orders/:orderId/job-progress", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTables();
  const orderId = Number(req.params["orderId"]);
  const { status, notes, isPublic = true } = req.body as { status: string; notes?: string; isPublic?: boolean };
  if (!status) return res.status(400).json({ message: "status wajib diisi" });

  try {
    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, status, notes, updated_by, is_public)
      VALUES (${orderId}, ${status}, ${notes ?? null}, 'admin', ${isPublic})
    `);

    const transitionResult = await transitionLogisticOrderStatus(orderId, status, { source: "vendorJobOrder:job-progress", actorType: "admin" });
    if (!transitionResult.ok) {
      return res.status(422).json({ message: transitionResult.error, allowedTransitions: transitionResult.allowedTransitions });
    }

    await db.execute(sql`
      UPDATE logistic_orders SET job_status = ${status.toLowerCase().replace(/\s+/g, "_")}
      WHERE id = ${orderId}
    `);

    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status,
      notes: notes ?? null,
      isPublic: isPublic ?? true,
    });

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "job-progress admin error");
    return res.status(500).json({ message: "Gagal update progress" });
  }
});

/**
 * POST /api/logistic/orders/:orderId/complete-review
 * Admin konfirmasi penyelesaian, kirim notif ke customer
 */
vendorJobAdminRouter.post("/orders/:orderId/complete-review", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureTables();
  const orderId = Number(req.params["orderId"]);
  const { adminNotes, sendCustomerNotif = true } = req.body as { adminNotes?: string; sendCustomerNotif?: boolean };

  try {
    const [order] = await db.select().from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, orderId));
    if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

    // ── Guard: hanya boleh complete jika Payment Received ────────────────────
    const currentStatus = (order.status ?? "").trim();
    if (currentStatus !== "Payment Received") {
      return res.status(400).json({
        message: `Order tidak dapat diselesaikan dari status "${currentStatus}". ` +
          `Order harus dalam status "Payment Received" terlebih dahulu (Invoice diterbitkan → Pembayaran diterima → Selesai).`,
        currentStatus,
        requiredStatus: "Payment Received",
      });
    }

    // Update status via service
    const transition = await transitionLogisticOrderStatus(orderId, "Completed", { source: "vendorJobOrder:complete_review", actorType: "admin" });
    if (!transition.ok) {
      return res.status(400).json({ message: transition.error ?? "Gagal mengubah status ke Completed" });
    }

    await db.execute(sql`
      UPDATE logistic_orders SET job_status = 'completed' WHERE id = ${orderId}
    `);

    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, status, notes, updated_by, is_public)
      VALUES (${orderId}, 'Completed', ${adminNotes ?? "Order telah diselesaikan dan dikonfirmasi oleh admin."}, 'admin', true)
    `);

    await db.insert(orderUpdatesTable).values({
      orderId,
      actorType: "admin",
      actorName: "Admin",
      status: "Completed",
      notes: adminNotes ?? "Admin mengkonfirmasi penyelesaian order.",
      isPublic: true,
    });

    // Ambil tracking token untuk customer
    const tokenResult = await db.execute(
      sql`SELECT tracking_token FROM logistic_orders WHERE id = ${orderId}`
    );
    const trackingToken = (tokenResult.rows[0] as any)?.tracking_token ?? null;

    // Kirim WA ke customer
    if (sendCustomerNotif && order.phone) {
      const trackUrl = trackingToken ? `${baseUrl()}/order-track/${trackingToken}` : "";
      sendOrderCompletedNotification(order.orderNumber, order.origin, order.destination, order.phone, trackUrl, adminNotes).catch(e => logger.warn({ e }, "complete WA to customer failed"));
    }

    // Update Decision Memory outcome (fire-and-forget)
    updateDecisionOutcome({
      orderId,
      outcome: "success",
      onTimeDelivery: true,
      outcomeNotes: adminNotes ?? undefined,
    }).catch(() => {});

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "complete-review error");
    return res.status(500).json({ message: "Gagal konfirmasi penyelesaian" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Public Vendor Router
// ─────────────────────────────────────────────────────────────────────────────

export const vendorJobPublicRouter = Router();

// ── Token expiry guard — runs before every /api/vendor-job/:token/* handler ──
vendorJobPublicRouter.param("token", async (req, res, next, token: string) => {
  await ensureTables();
  try {
    const check = await db.execute(sql`
      SELECT id, token_expires_at FROM vendor_job_orders WHERE token = ${token} LIMIT 1
    `);
    if (!check.rows.length) return next(); // token not found → 404 handled by route
    const row = check.rows[0] as any;
    if (row.token_expires_at && new Date(row.token_expires_at) < new Date()) {
      const { ipAddress, userAgent } = extractRequestMeta(req);
      writeAuditLog({
        action: "PUBLIC_TOKEN_EXPIRED",
        module: "vendor_job",
        referenceId: String(row.id),
        newData: {
          tokenType: "vendor_job",
          resourceId: row.id,
          route: req.originalUrl,
          method: req.method,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
        userAgent,
      });
      return res.status(410).json({
        success: false,
        message: "This link has expired. Please request a new link.",
      });
    }
    return next();
  } catch {
    return next(); // on error, let route handle it
  }
});

/** GET /api/vendor-job/:token */
vendorJobPublicRouter.get("/:token", async (req: Request, res: Response) => {
  await ensureTables();
  const { token } = req.params as { token: string };

  try {
    const result = await db.execute(sql`
      SELECT vjo.*,
             s.name as vendor_name, s.phone as vendor_phone,
             o.order_number, o.shipment_type, o.origin, o.destination,
             o.commodity, o.cargo_description, o.gross_weight, o.volume_cbm,
             o.required_date, o.customer_name, o.notes as order_notes,
             o.status as order_status
      FROM vendor_job_orders vjo
      LEFT JOIN suppliers s ON s.id = vjo.vendor_id
      LEFT JOIN logistic_orders o ON o.id = vjo.order_id
      WHERE vjo.token = ${token}
    `);

    if (!result.rows.length) {
      return res.status(404).json({ error: "Link tidak ditemukan atau tidak valid" });
    }

    const job = result.rows[0] as any;

    // Progress tracking
    const progressResult = await db.execute(
      sql`SELECT * FROM order_tracking_progress WHERE order_id = ${job.order_id} ORDER BY created_at ASC`
    );

    return res.json({
      token,
      status: job.status,
      serviceType: job.service_type,
      vendorName: job.vendor_name,
      vendorPhone: job.vendor_phone,
      order: {
        orderNumber: job.order_number,
        shipmentType: job.shipment_type,
        origin: job.origin,
        destination: job.destination,
        commodity: job.commodity,
        cargoDescription: job.cargo_description,
        grossWeight: job.gross_weight,
        volumeCbm: job.volume_cbm,
        requiredDate: job.required_date,
        customerName: job.customer_name,
        notes: job.order_notes,
        status: job.order_status,
      },
      operationalDetails: {
        driverName: job.driver_name,
        driverPhone: job.driver_phone,
        vehiclePlate: job.vehicle_plate,
        vehicleType: job.vehicle_type,
        pickupTime: job.pickup_time,
        carrier: job.carrier,
        schedule: job.schedule,
        etd: job.etd,
        eta: job.eta,
        awbBlNumber: job.awb_bl_number,
        stockConfirmed: job.stock_confirmed,
        deliverySchedule: job.delivery_schedule,
        documentStatus: job.document_status,
        notes: job.notes,
      },
      podFiles: job.pod_files ?? [],
      completionNotes: job.completion_notes,
      acceptedAt: job.accepted_at,
      rejectedAt: job.rejected_at,
      rejectReason: job.reject_reason,
      progress: progressResult.rows,
    });
  } catch (err) {
    logger.error({ err }, "get-vendor-job error");
    return res.status(500).json({ error: "Gagal memuat data job order" });
  }
});

/** POST /api/vendor-job/:token/accept */
vendorJobPublicRouter.post("/:token/accept", async (req: Request, res: Response) => {
  await ensureTables();
  const { token } = req.params as { token: string };
  const body = req.body as Record<string, string>;

  try {
    const result = await db.execute(
      sql`SELECT vjo.*, o.order_number, o.origin, o.destination, o.phone as customer_phone, o.shipment_type, s.name as vendor_name, s.phone as vendor_phone
          FROM vendor_job_orders vjo
          LEFT JOIN logistic_orders o ON o.id = vjo.order_id
          LEFT JOIN suppliers s ON s.id = vjo.vendor_id
          WHERE vjo.token = ${token}`
    );
    if (!result.rows.length) return res.status(404).json({ error: "Link tidak ditemukan" });

    const job = result.rows[0] as any;
    if (job.status !== "pending") {
      return res.status(409).json({ error: "Job sudah direspon sebelumnya" });
    }

    const now = new Date().toISOString();

    // Update job order dengan detail operasional + status accepted
    await db.execute(sql`
      UPDATE vendor_job_orders SET
        status = 'accepted',
        accepted_at = NOW(),
        driver_name = ${body.driverName ?? null},
        driver_phone = ${body.driverPhone ?? null},
        vehicle_plate = ${body.vehiclePlate ?? null},
        vehicle_type = ${body.vehicleType ?? null},
        pickup_time = ${body.pickupTime ?? null},
        carrier = ${body.carrier ?? null},
        schedule = ${body.schedule ?? null},
        etd = ${body.etd ?? null},
        eta = ${body.eta ?? null},
        awb_bl_number = ${body.awbBlNumber ?? null},
        stock_confirmed = ${body.stockConfirmed ?? null},
        delivery_schedule = ${body.deliverySchedule ?? null},
        document_status = ${body.documentStatus ?? null},
        notes = ${body.notes ?? null}
      WHERE token = ${token}
    `);

    // Update order status via service
    await transitionLogisticOrderStatus(job.order_id, "In Progress", { source: "vendorJobOrder:vendor_accept", actorType: "vendor" });

    await db.execute(sql`
      UPDATE logistic_orders SET job_status = 'vendor_accepted' WHERE id = ${job.order_id}
    `);

    // Progress tracking
    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, job_order_id, status, notes, updated_by, is_public)
      SELECT ${job.order_id}, id, 'Vendor Accepted',
             ${"Vendor " + (job.vendor_name ?? "") + " menerima job order dan mengisi detail operasional."},
             'vendor', true
      FROM vendor_job_orders WHERE token = ${token}
    `);

    // Activity log
    await db.insert(orderUpdatesTable).values({
      orderId: job.order_id,
      actorType: "vendor",
      actorName: job.vendor_name,
      status: "Vendor Accepted",
      notes: `Vendor menerima job order.\n` +
        (body.driverName ? `Driver: ${body.driverName}\n` : "") +
        (body.vehiclePlate ? `Plat: ${body.vehiclePlate}\n` : "") +
        (body.pickupTime ? `Pickup: ${body.pickupTime}\n` : "") +
        (body.carrier ? `Carrier: ${body.carrier}\n` : "") +
        (body.awbBlNumber ? `AWB/BL: ${body.awbBlNumber}\n` : "") +
        (body.notes ? `Catatan: ${body.notes}` : ""),
      isPublic: true,
    });

    // Notify admin
    const adminWa = await getAdminWa();
    if (adminWa) {
      sendVendorJobAcceptedNotification(job.order_number, job.vendor_name ?? "—", job.origin, job.destination, adminWa, {
        driverName: body.driverName,
        vehiclePlate: body.vehiclePlate,
        pickupTime: body.pickupTime,
        carrier: body.carrier,
        notes: body.notes,
      }).catch(() => {});
    }

    // WA ke driver
    const driverPhone = (body.driverPhone ?? "").toString().trim();
    const driverName = (body.driverName ?? "Driver").toString().trim();
    logger.info(
      { driverPhone, driverName, orderNumber: job.order_number, serviceType: job.service_type, shipmentType: job.shipment_type },
      "[WA-driver] vendor-job accept: cek kirim WA ke driver"
    );
    if (driverPhone) {
      const driverAppUrl = `${getPreferredDomain()}/driver`;
      const waMsg =
        `🚛 *Konfirmasi Job Order*\n\n` +
        `Halo ${driverName},\n\n` +
        `Anda telah dikonfirmasi untuk menjalankan pengiriman berikut:\n\n` +
        `📦 *Order*    : ${job.order_number}\n` +
        `📍 *Rute*     : ${job.origin} → ${job.destination}\n` +
        (body.vehiclePlate ? `🚗 *Plat*      : ${body.vehiclePlate}\n` : "") +
        (body.vehicleType ? `🚐 *Kendaraan* : ${body.vehicleType}\n` : "") +
        (body.pickupTime ? `🕐 *Pickup*    : ${body.pickupTime}\n` : "") +
        (body.carrier ? `🏢 *Carrier*   : ${body.carrier}\n` : "") +
        `\n📱 Driver App: ${driverAppUrl}`;
      sendWhatsApp(driverPhone, waMsg)
        .then(() => logger.info({ driverPhone, orderNumber: job.order_number }, "[WA-driver] WA ke driver BERHASIL (vendor-job)"))
        .catch((e) => logger.warn({ e, driverPhone, orderNumber: job.order_number }, "[WA-driver] WA ke driver GAGAL (vendor-job)"));
    } else {
      logger.info({ orderNumber: job.order_number }, "[WA-driver] skip — driverPhone kosong (vendor-job)");
    }

    return res.json({ ok: true, message: "Job berhasil diterima. Terima kasih!" });
  } catch (err) {
    logger.error({ err }, "accept-vendor-job error");
    return res.status(500).json({ error: "Gagal memproses penerimaan job" });
  }
});

/** POST /api/vendor-job/:token/reject */
vendorJobPublicRouter.post("/:token/reject", async (req: Request, res: Response) => {
  await ensureTables();
  const { token } = req.params as { token: string };
  const { reason } = req.body as { reason?: string };

  try {
    const result = await db.execute(
      sql`SELECT vjo.*, o.order_number, o.origin, o.destination, s.name as vendor_name
          FROM vendor_job_orders vjo
          LEFT JOIN logistic_orders o ON o.id = vjo.order_id
          LEFT JOIN suppliers s ON s.id = vjo.vendor_id
          WHERE vjo.token = ${token}`
    );
    if (!result.rows.length) return res.status(404).json({ error: "Link tidak ditemukan" });

    const job = result.rows[0] as any;
    if (job.status !== "pending") return res.status(409).json({ error: "Job sudah direspon sebelumnya" });

    await db.execute(sql`
      UPDATE vendor_job_orders SET status = 'rejected', rejected_at = NOW(), reject_reason = ${reason ?? null}
      WHERE token = ${token}
    `);

    await transitionLogisticOrderStatus(job.order_id, "Admin Review", { source: "vendorJobOrder:vendor_reject", actorType: "vendor" });

    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, status, notes, updated_by, is_public)
      VALUES (${job.order_id}, 'Vendor Rejected', ${(reason ? "Alasan: " + reason : "Vendor menolak job order.")}, 'vendor', false)
    `);

    await db.insert(orderUpdatesTable).values({
      orderId: job.order_id,
      actorType: "vendor",
      actorName: job.vendor_name,
      status: "Vendor Rejected",
      notes: reason ? `Vendor menolak job. Alasan: ${reason}` : "Vendor menolak job order.",
      isPublic: false,
    });

    createExceptionIdempotent({
      exceptionType: "vendor_rejected",
      severity: "high",
      title: `Vendor Menolak Job — ${job.order_number}`,
      description: reason ? `Vendor ${job.vendor_name ?? "—"} menolak job order. Alasan: ${reason}` : `Vendor ${job.vendor_name ?? "—"} menolak job order.`,
      refType: "logistic_order",
      refId: String(job.order_id),
      refNumber: job.order_number,
      supplierName: job.vendor_name ?? null,
      createdBy: "vendor",
    }).catch(() => {});

    const adminWa = await getAdminWa();
    if (adminWa) {
      const _domain = getPreferredDomain();
      const _adminOrderUrl = _domain ? `https://${_domain}/bizportal/logistics/orders/${job.order_id}` : undefined;
      const _route = [job.origin, job.destination].filter(Boolean).join(" → ") || undefined;
      sendVendorJobRejectedNotification(job.order_number, job.vendor_name ?? "—", adminWa, reason, _route, _adminOrderUrl).catch(() => {});
    }

    return res.json({ ok: true, message: "Job ditolak. Admin akan segera ditindaklanjuti." });
  } catch (err) {
    logger.error({ err }, "reject-vendor-job error");
    return res.status(500).json({ error: "Gagal memproses penolakan" });
  }
});

/** POST /api/vendor-job/:token/progress — vendor update progress (multipart: status, notes, foto opsional) */
vendorJobPublicRouter.post("/:token/progress", upload.single("photo"), async (req: Request, res: Response) => {
  await ensureTables();
  const { token } = req.params as { token: string };
  const { status, notes } = req.body as { status: string; notes?: string };
  if (!status) return res.status(400).json({ error: "status wajib diisi" });

  try {
    const result = await db.execute(
      sql`SELECT vjo.*, o.order_number, o.phone, o.tracking_token, s.name as vendor_name
          FROM vendor_job_orders vjo
          LEFT JOIN logistic_orders o ON o.id = vjo.order_id
          LEFT JOIN suppliers s ON s.id = vjo.vendor_id
          WHERE vjo.token = ${token}`
    );
    if (!result.rows.length) return res.status(404).json({ error: "Link tidak ditemukan" });

    const job = result.rows[0] as any;
    if (job.status === "pending" || job.status === "rejected") {
      return res.status(409).json({ error: "Job belum diterima, tidak dapat update progress" });
    }

    // Map status ke job_status
    const newJobStatus = status.toLowerCase().replace(/\s+/g, "_");

    await db.execute(sql`
      UPDATE vendor_job_orders SET status = ${newJobStatus} WHERE token = ${token}
    `);

    await db.update(logisticOrdersTable)
      .set({ status } as any)
      .where(eq(logisticOrdersTable.id, job.order_id));

    await db.execute(sql`
      UPDATE logistic_orders SET job_status = ${newJobStatus} WHERE id = ${job.order_id}
    `);

    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, job_order_id, status, notes, updated_by, is_public)
      SELECT ${job.order_id}, id, ${status}, ${notes ?? null}, 'vendor', true
      FROM vendor_job_orders WHERE token = ${token}
    `);

    // Simpan photo_url di progress entry (update row yang baru saja diinsert)
    // dilakukan setelah foto di-upload agar photo_url tersedia

    await db.insert(orderUpdatesTable).values({
      orderId: job.order_id,
      actorType: "vendor",
      actorName: job.vendor_name,
      status,
      notes: notes ?? null,
      isPublic: true,
    });

    // Upload foto progress ke public storage (jika ada)
    let progressPhotoUrl = "";
    const photoFile = (req as any).file as Express.Multer.File | undefined;
    if (photoFile && photoFile.mimetype.startsWith("image/")) {
      try {
        const pubSubPath = `progress-photos/${job.order_id}/${Date.now()}_${photoFile.originalname}`;
        await pubObjStore.uploadPublicRaw(pubSubPath, photoFile.buffer, photoFile.mimetype);
        progressPhotoUrl = pubObjStore.toSupabasePublicUrl(pubSubPath);
        // Simpan photo_url ke row progress yang baru diinsert
        await db.execute(sql`
          UPDATE order_tracking_progress
          SET photo_url = ${progressPhotoUrl}
          WHERE id = (
            SELECT id FROM order_tracking_progress
            WHERE order_id = ${job.order_id} AND updated_by = 'vendor' AND photo_url IS NULL
            ORDER BY created_at DESC
            LIMIT 1
          )
        `);
      } catch (e) {
        logger.warn({ e }, "progress photo public upload failed — WA dikirim tanpa gambar");
      }
    }

    // Notify admin
    const adminWa = await getAdminWa();
    if (adminWa) {
      const statusLabel = JOB_STATUS_LABEL[status.toLowerCase().replace(/\s+/g, "_")] ?? status;
      sendVendorProgressUpdateNotification(job.order_number, job.vendor_name ?? "—", statusLabel, adminWa, notes, progressPhotoUrl || undefined).catch(() => {});
    }

    // Notify customer via WA
    const customerPhone = job.phone as string | null;
    if (customerPhone) {
      const trackingUrl = job.tracking_token
        ? `${baseUrl()}/order-track/${job.tracking_token}`
        : `${baseUrl()}/order-track`;
      const statusLabel = JOB_STATUS_LABEL[status.toLowerCase().replace(/\s+/g, "_")] ?? status;
      sendCustomerProgressUpdateNotification(job.order_number, customerPhone, statusLabel, trackingUrl, notes).catch((e) => logger.warn({ e, phone: customerPhone }, "customer progress WA failed"));
    }

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "vendor-progress error");
    return res.status(500).json({ error: "Gagal update progress" });
  }
});

/** POST /api/vendor-job/:token/pod — vendor upload POD/invoice/foto */
vendorJobPublicRouter.post("/:token/pod", upload.array("files", 10), async (req: Request, res: Response) => {
  await ensureTables();
  const { token } = req.params as { token: string };
  const { completionNotes } = req.body as { completionNotes?: string };
  const files = (req.files ?? []) as Express.Multer.File[];

  try {
    const result = await db.execute(
      sql`SELECT vjo.*, o.order_number, o.id as order_id_num, o.phone, o.tracking_token,
               o.status as order_status, o.commodity, o.cargo_description,
               o.customer_name, o.shipment_type, o.origin, o.destination,
               o.grand_total, o.tax, o.notes as order_notes,
               s.name as vendor_name
          FROM vendor_job_orders vjo
          LEFT JOIN logistic_orders o ON o.id = vjo.order_id
          LEFT JOIN suppliers s ON s.id = vjo.vendor_id
          WHERE vjo.token = ${token}`
    );
    if (!result.rows.length) return res.status(404).json({ error: "Link tidak ditemukan" });

    const job = result.rows[0] as any;

    // Guard: POD tidak boleh diupload jika order sudah melewati tahap POD
    // (Invoice Issued, Payment Received, Completed, Cancelled).
    // Mencegah transisi mundur yang merusak audit trail keuangan.
    const BLOCK_POD_FROM = ["Invoice Issued", "Payment Received", "Completed", "Cancelled"];
    if (BLOCK_POD_FROM.includes(job.order_status ?? "")) {
      return res.status(409).json({
        error: `POD tidak dapat diunggah karena order sudah dalam status "${job.order_status}". Hubungi admin jika ada kekeliruan.`,
        currentStatus: job.order_status,
      });
    }

    // Upload files ke object storage
    const uploadedUrls: { name: string; url: string; type: string; publicUrl?: string }[] = [];
    let firstPublicImageUrl = "";
    const domain = getPreferredDomain() || "cstlogistic.co.id";

    for (const file of files) {
      const ts = Date.now();
      try {
        const privatePath = await pubObjStore.uploadPrivateEntity(file.buffer, file.mimetype);
        uploadedUrls.push({
          name: file.originalname,
          url: privatePath,
          type: file.mimetype,
          publicUrl: "", // diisi di bawah jika gambar
        });
      } catch (e) {
        logger.warn({ e }, "POD upload to Supabase Storage failed");
      }

      // Jika file adalah gambar, juga simpan ke public storage untuk notifikasi WA dan thumbnail
      if (file.mimetype.startsWith("image/")) {
        try {
          const pubSubPath = `pod-photos/${job.order_id}/${ts}_${file.originalname}`;
          await pubObjStore.uploadPublicRaw(pubSubPath, file.buffer, file.mimetype);
          const fullPubUrl = pubObjStore.toSupabasePublicUrl(pubSubPath);
          const last = uploadedUrls[uploadedUrls.length - 1];
          if (last) last.publicUrl = fullPubUrl;
          if (!firstPublicImageUrl) firstPublicImageUrl = fullPubUrl;
        } catch (e) {
          logger.warn({ e }, "POD image public upload failed — thumbnail tidak tersedia");
        }
      }
    }

    // Merge dengan pod_files yang ada
    const existingFiles = job.pod_files ?? [];
    const allFiles = [...existingFiles, ...uploadedUrls];

    await db.execute(sql`
      UPDATE vendor_job_orders
      SET pod_files = ${JSON.stringify(allFiles)}::jsonb,
          completion_notes = ${completionNotes ?? null},
          status = 'completed',
          completed_at = NOW()
      WHERE token = ${token}
    `);

    await transitionLogisticOrderStatus(job.order_id, "POD Uploaded", { source: "vendorJobOrder:pod_upload", actorType: "vendor" });

    await db.execute(sql`
      UPDATE logistic_orders SET job_status = 'pod_uploaded' WHERE id = ${job.order_id}
    `);

    await db.execute(sql`
      INSERT INTO order_tracking_progress (order_id, status, notes, updated_by, is_public)
      VALUES (${job.order_id}, 'POD Uploaded',
              ${"Vendor mengunggah " + files.length + " dokumen/foto. Menunggu konfirmasi admin."},
              'vendor', true)
    `);

    await db.insert(orderUpdatesTable).values({
      orderId: job.order_id,
      actorType: "vendor",
      actorName: job.vendor_name,
      status: "POD Uploaded",
      notes: `Vendor mengunggah ${files.length} file POD/dokumen.${completionNotes ? "\nCatatan: " + completionNotes : ""}`,
      isPublic: true,
    });

    const adminWa = await getAdminWa();
    if (adminWa) {
      sendVendorPodUploadedNotification(job.order_number, job.vendor_name ?? "—", files.length, adminWa, completionNotes, firstPublicImageUrl || undefined, job.commodity ?? null).catch(() => {});
    }

    // Invoice notification ke admin group (non-blocking)
    const orderForInvoice: LogisticOrderData = {
      id: job.order_id as number,
      orderNumber: job.order_number as string,
      customerName: (job.customer_name ?? "") as string,
      companyName: "",
      email: "",
      phone: (job.phone ?? "") as string,
      shipmentType: (job.shipment_type ?? "") as string,
      origin: (job.origin ?? "") as string,
      destination: (job.destination ?? "") as string,
      commodity: job.commodity as string | null ?? null,
      cargoDescription: job.cargo_description as string | null ?? null,
      grossWeight: job.gross_weight ? Number(job.gross_weight) : null,
      grandTotal: job.grand_total ? Number(job.grand_total) : 0,
      tax: job.tax ? Number(job.tax) : 0,
      notes: job.order_notes as string | null ?? null,
      serviceList: "",
    };
    autoCreateLogisticInvoice(orderForInvoice).catch(() => {});

    // Notify customer via WA
    const customerPhonePod = job.phone as string | null;
    if (customerPhonePod) {
      const trackingUrlPod = job.tracking_token
        ? `${baseUrl()}/order-track/${job.tracking_token}`
        : `${baseUrl()}/order-track`;
      sendCustomerPodUploadedNotification(job.order_number, job.vendor_name ?? "Vendor", customerPhonePod, trackingUrlPod, completionNotes).catch((e) => logger.warn({ e, phone: customerPhonePod }, "customer POD WA failed"));
    }

    return res.json({ ok: true, uploadedFiles: uploadedUrls.length, message: "POD berhasil diunggah. Menunggu konfirmasi admin." });
  } catch (err) {
    logger.error({ err }, "pod-upload error");
    return res.status(500).json({ error: "Gagal mengunggah POD" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Customer Tracking Router
// ─────────────────────────────────────────────────────────────────────────────

export const orderTrackingPublicRouter = Router();

/** GET /api/order-track/:trackToken */
orderTrackingPublicRouter.get("/:trackToken", async (req: Request, res: Response) => {
  await ensureTables();
  const { trackToken } = req.params as { trackToken: string };

  try {
    // Lookup by logistic_orders.tracking_token ATAU customer_order_links.token
    const orderResult = await db.execute(
      sql`SELECT o.*, s.name as vendor_name
          FROM logistic_orders o
          LEFT JOIN suppliers s ON s.id = o.approved_vendor_id
          WHERE o.tracking_token = ${trackToken}
          UNION
          SELECT o.*, s.name as vendor_name
          FROM logistic_orders o
          LEFT JOIN suppliers s ON s.id = o.approved_vendor_id
          INNER JOIN customer_order_links col ON col.order_id = o.id
          WHERE col.token = ${trackToken}
          LIMIT 1`
    );
    if (!orderResult.rows.length) {
      return res.status(404).json({ error: "Link tracking tidak ditemukan" });
    }

    const order = orderResult.rows[0] as any;

    // ── Expiry check ──────────────────────────────────────────────────────────
    if (order.track_token_expires_at && new Date(order.track_token_expires_at) < new Date()) {
      const { ipAddress, userAgent } = extractRequestMeta(req);
      writeAuditLog({
        action: "PUBLIC_TOKEN_EXPIRED",
        module: "order_tracking",
        referenceId: String(order.id),
        newData: {
          tokenType: "order_tracking",
          resourceId: order.id,
          route: req.originalUrl,
          method: req.method,
          timestamp: new Date().toISOString(),
        },
        ipAddress,
        userAgent,
      });
      return res.status(410).json({
        success: false,
        message: "This link has expired. Please request a new link.",
      });
    }

    // Progress
    const progressResult = await db.execute(
      sql`SELECT * FROM order_tracking_progress
          WHERE order_id = ${order.id} AND is_public = true
          ORDER BY created_at ASC`
    );

    // Job order (operational details + POD files, only show operational if vendor accepted)
    const jobResult = await db.execute(
      sql`SELECT vjo.*, s.name as vendor_name
          FROM vendor_job_orders vjo
          LEFT JOIN suppliers s ON s.id = vjo.vendor_id
          WHERE vjo.order_id = ${order.id}
          ORDER BY vjo.created_at DESC LIMIT 1`
    );
    const jobOrder = jobResult.rows[0] as any ?? null;

    const showOperational = jobOrder && ["accepted", "in_progress", "pickup_scheduled", "completed"].includes(jobOrder.status);

    // Order items (service items with qty/subtotal)
    const itemsResult = await db.execute(
      sql`SELECT service_name, category, subtotal, input_data
          FROM logistic_order_items
          WHERE order_id = ${order.id}
          ORDER BY id ASC`
    );

    function extractQtyUnit(inp: unknown): { qty: number | null; unit: string | null; unitPrice: number | null } {
      if (!inp || typeof inp !== "object") return { qty: null, unit: null, unitPrice: null };
      const d = inp as Record<string, unknown>;
      const qRaw = d.quantity ?? d.qty ?? d.jumlah ?? null;
      const qty = typeof qRaw === "number" ? qRaw : (typeof qRaw === "string" ? (parseFloat(qRaw) || null) : null);
      const uRaw = d.unit ?? d.satuan ?? d.uom ?? null;
      const unit = typeof uRaw === "string" ? uRaw : null;
      const pRaw = d.price ?? d.productPrice ?? d.unitPrice ?? d.sellingPrice ?? null;
      const unitPrice = typeof pRaw === "number" ? pRaw : (typeof pRaw === "string" ? (parseFloat(pRaw) || null) : null);
      return { qty, unit, unitPrice };
    }

    const orderItems = (itemsResult.rows as any[]).map((i) => {
      const { qty, unit, unitPrice } = extractQtyUnit(i.input_data);
      const subtotalFromDb = i.subtotal ? Number(i.subtotal) : 0;
      const subtotal = (unitPrice != null && qty != null) ? unitPrice * qty : subtotalFromDb;
      return {
        name: i.service_name,
        category: i.category,
        subtotal,
        unitPrice,
        qty,
        unit,
      };
    });

    // Pricing summary from order
    const orderSubtotal = order.subtotal ? Number(order.subtotal) : null;
    const orderTax = order.tax ? Number(order.tax) : null;
    const orderGrandTotal = order.grand_total ? Number(order.grand_total) : null;

    // POD files (public-facing — vendor job order pod_files + driver app pod_photos)
    const podFiles: Array<{ url: string; type: string; name: string; source?: string }> = [];
    if (jobOrder?.pod_files && Array.isArray(jobOrder.pod_files)) {
      for (const f of jobOrder.pod_files as any[]) {
        podFiles.push({ url: f.url ?? f.publicUrl ?? "", type: f.type ?? "document", name: f.name ?? f.originalname ?? "Dokumen", source: "vendor" });
      }
    }

    // Driver app POD photos (driver_jobs.pod_photos is a JSON string array of URLs)
    const driverPodResult = await db.execute(
      sql`SELECT pod_photos, pod_receiver_name, pod_submitted_at, job_number
          FROM driver_jobs
          WHERE logistic_order_id = ${order.id}
            AND pod_photos IS NOT NULL AND pod_photos != 'null'
          ORDER BY pod_submitted_at DESC NULLS LAST
          LIMIT 1`
    );
    const driverPodRow = driverPodResult.rows[0] as any ?? null;
    if (driverPodRow?.pod_photos) {
      let photos: string[] = [];
      try {
        const parsed = typeof driverPodRow.pod_photos === "string"
          ? JSON.parse(driverPodRow.pod_photos)
          : driverPodRow.pod_photos;
        if (Array.isArray(parsed)) photos = parsed.filter((u: unknown) => typeof u === "string" && u);
      } catch (_parseErr) { /* ignore */ }
      photos.forEach((url, idx) => {
        const baseName = "Foto POD Driver " + (idx + 1);
        const photoName = driverPodRow.pod_receiver_name ? baseName + " \u2014 " + driverPodRow.pod_receiver_name : baseName;
        podFiles.push({ url, type: "photo", name: photoName, source: "driver" });
      });
    }
    // Driver photos + live location + GPS trail — all from driver_jobs linked to this order
    let driverPhotos: Array<{ url: string; photoType: string; takenAt: string }> = [];
    let liveLocation: { lat: number; lng: number; updatedAt: string } | null = null;
    let gpsTrail: Array<{ lat: number; lng: number; updatedAt: string }> = [];
    try {
      const [driverJobRow] = await db
        .select({
          id: driverJobsTable.id,
          driverId: driverJobsTable.driverId,
          status: driverJobsTable.status,
        })
        .from(driverJobsTable)
        .where(eq(driverJobsTable.logisticOrderId, order.id))
        .orderBy(desc(driverJobsTable.assignedAt))
        .limit(1);

      if (driverJobRow) {
        const [photos, gpsRows] = await Promise.all([
          db.select({ url: driverPhotosTable.url, photoType: driverPhotosTable.photoType, takenAt: driverPhotosTable.takenAt })
            .from(driverPhotosTable)
            .where(eq(driverPhotosTable.driverJobId, driverJobRow.id))
            .orderBy(driverPhotosTable.takenAt),
          db.select({
            latitude: driverLocationsTable.latitude,
            longitude: driverLocationsTable.longitude,
            updatedAt: driverLocationsTable.updatedAt,
          })
            .from(driverLocationsTable)
            .where(eq(driverLocationsTable.orderId, order.id))
            .orderBy(driverLocationsTable.updatedAt)
            .limit(100),
        ]);

        driverPhotos = photos.map((p) => ({
          url: p.url,
          photoType: p.photoType,
          takenAt: p.takenAt.toISOString(),
        }));

        gpsTrail = gpsRows.map((r) => ({
          lat: Number(r.latitude),
          lng: Number(r.longitude),
          updatedAt: r.updatedAt.toISOString(),
        }));

        if (gpsTrail.length > 0) {
          const last = gpsTrail[gpsTrail.length - 1];
          liveLocation = last;
        }

        // Also check drivers.currentLat/currentLng for most-recent position
        if (driverJobRow.driverId && ["IN_TRANSIT", "PICKED_UP", "ON_THE_WAY_TO_PICKUP", "ARRIVED_AT_PICKUP", "ARRIVED_AT_DESTINATION"].includes(driverJobRow.status ?? "")) {
          const [driverRow] = await db
            .select({ currentLat: driversTable.currentLat, currentLng: driversTable.currentLng, lastLocationAt: driversTable.lastLocationAt })
            .from(driversTable)
            .where(eq(driversTable.id, driverJobRow.driverId));
          if (driverRow?.currentLat && driverRow?.currentLng) {
            liveLocation = {
              lat: Number(driverRow.currentLat),
              lng: Number(driverRow.currentLng),
              updatedAt: driverRow.lastLocationAt?.toISOString() ?? new Date().toISOString(),
            };
          }
        }
      }
    } catch {
      // non-fatal
    }

    // Include photos + GPS from order_progress_events (driver WA-link uploads)
    try {
      const STEP_TO_PHOTO_TYPE: Record<string, string> = {
        PICKUP: "pickup", ARRIVED_AT_PICKUP: "pickup", PICKED_UP: "pickup",
        ON_THE_WAY_TO_PICKUP: "general", IN_TRANSIT: "general",
        ARRIVED: "arrival", ARRIVED_AT_DESTINATION: "arrival",
        DELIVERED: "pod", COMPLETED: "pod",
      };
      const progressRows = await db.execute(
        sql`SELECT step_key, photo_url, gps_latitude, gps_longitude, created_at
            FROM order_progress_events
            WHERE order_id = ${order.id}
            ORDER BY created_at ASC`
      );
      for (const row of progressRows.rows as Record<string, unknown>[]) {
        const takenAt = row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at);
        // Photos
        if (row.photo_url) {
          const photoType = STEP_TO_PHOTO_TYPE[String(row.step_key ?? "")] ?? "general";
          driverPhotos.push({ url: String(row.photo_url), photoType, takenAt });
        }
        // GPS trail
        if (row.gps_latitude != null && row.gps_longitude != null) {
          const lat = Number(row.gps_latitude);
          const lng = Number(row.gps_longitude);
          if (!isNaN(lat) && !isNaN(lng)) {
            gpsTrail.push({ lat, lng, updatedAt: takenAt });
          }
        }
      }
      // Set liveLocation to most recent GPS point if not already set from driver app
      if (!liveLocation && gpsTrail.length > 0) {
        liveLocation = gpsTrail[gpsTrail.length - 1];
      }
    } catch { /* non-fatal */ }

    return res.json({
      order: {
        orderNumber: order.order_number,
        shipmentType: order.shipment_type,
        origin: order.origin,
        destination: order.destination,
        commodity: order.commodity,
        grossWeight: order.gross_weight,
        status: order.status,
        jobStatus: order.job_status,
        customerName: order.customer_name,
        createdAt: order.created_at,
        etd: order.etd,
        eta: order.eta,
      },
      vendor: order.vendor_name ? { name: order.vendor_name } : null,
      progress: progressResult.rows,
      operational: showOperational ? {
        driverName: jobOrder.driver_name,
        driverPhone: jobOrder.driver_phone,
        vehiclePlate: jobOrder.vehicle_plate,
        vehicleType: jobOrder.vehicle_type,
        pickupTime: jobOrder.pickup_time,
        carrier: jobOrder.carrier,
        etd: jobOrder.etd,
        eta: jobOrder.eta,
        awbBlNumber: jobOrder.awb_bl_number,
        schedule: jobOrder.schedule,
      } : null,
      items: orderItems,
      pricing: {
        subtotal: orderSubtotal,
        tax: orderTax,
        grandTotal: orderGrandTotal,
      },
      podFiles,
      driverPhotos,
      liveLocation,
      gpsTrail,
    });
  } catch (err) {
    logger.error({ err }, "order-tracking error");
    return res.status(500).json({ error: "Gagal memuat data tracking" });
  }
});

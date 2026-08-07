/**
 * mktAdmin.ts — Phase 2A.2 + Phase 2C + Phase 2E.1: Admin API untuk Marketplace
 *
 * Semua endpoint dilindungi requireAdmin middleware (BizPortal session).
 *
 * Endpoints (Phase 2A.2 — Dual Write Reliability):
 *   GET  /api/mkt/admin/dual-write/stats       — stats 24h + all-time
 *   GET  /api/mkt/admin/dual-write/failed      — daftar entri failed/exhausted
 *   POST /api/mkt/admin/dual-write/retry       — trigger retry batch manual
 *   POST /api/mkt/admin/dual-write/retry/:id   — retry satu entri spesifik
 *   GET  /api/mkt/admin/integrity              — jalankan integrity check on-demand
 *   GET  /api/mkt/admin/reliability/summary    — admin dashboard: semua metrics dalam 1 call
 *   GET  /api/mkt/admin/reliability/metrics    — raw metrics (retry durations, score, dll)
 *   GET  /api/mkt/admin/cleanup/report         — jalankan cleanup report on-demand
 *
 * Endpoints (Phase 2C — Vendor Invitation):
 *   POST /api/mkt/admin/rfqs/:rfqId/invite-vendor   — undang vendor ke RFQ
 *   GET  /api/mkt/admin/rfqs/:rfqId/vendor-quotes   — list vendor quotes untuk RFQ
 *
 * Endpoints (Phase 2E.1 — Notification Queue):
 *   GET  /api/mkt/admin/notification-queue/stats        — stats per-status + total 24h
 *   GET  /api/mkt/admin/notification-queue/exhausted    — list rows exhausted (gagal semua attempt)
 *   POST /api/mkt/admin/notification-queue/:id/retry    — reset satu row exhausted → pending
 */

import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod/v4";
import { requireAdmin } from "../lib/requireAdmin.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";
import { validateMagicBytes } from "../lib/uploadValidation.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import { logActivity } from "../lib/activityLog.js";
import {
  inviteVendorToRfq,
  getVendorQuotesForRfq,
} from "../lib/services/vendorInvitationService.js";
import {
  getQuoteComparisonData,
  selectVendorAndCreatePo,
} from "../lib/services/vendorSelectionService.js";
import {
  getDualWriteStats,
  getFailedDualWriteEntries,
  retryFailedDualWrites,
  retrySingleEntry,
  runIntegrityCheck,
  getDualWriteMetrics,
  getReliabilitySummary,
} from "../lib/services/dualWriteReliabilityService.js";
import { runCleanupReport } from "../lib/services/marketplaceDualWriteCleanupWorker.js";
import {
  getNotifQueueStats,
  getExhaustedNotifications,
  retryExhaustedNotification,
  enqueueNotification,
} from "../lib/services/marketplaceNotificationQueueService.js";
import {
  requestRequote,
  getRequoteStatus,
} from "../lib/services/requoteService.js";
import {
  issuePo,
  setProduction,
  setReadyToShip,
  setInTransit,
  markDelivered,
  completePo,
  closePo,
} from "../lib/services/mktPoLifecycleService.js";
import {
  createShipment,
  appendShipmentEvent,
  listShipmentTimeline,
  listShipmentsForPo,
  listShipmentItems,
  getShipmentById,
  uploadProofOfDelivery,
} from "../lib/services/mktPoShipmentService.js";
import {
  createGoodsReceipt,
  listGoodsReceiptsForShipment,
  listGoodsReceiptItems,
} from "../lib/services/mktPoGoodsReceiptService.js";
import { logger } from "../lib/logger.js";
import {
  getMarketplaceVendorInvoice,
  safeMarketplaceVendorInvoiceView,
  submitMarketplaceVendorInvoice,
} from "../lib/services/mktVendorInvoiceService.js";

const router = Router();
const fulfillmentWriteLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak permintaan fulfillment." },
});
const podUpload = imagePdfUpload(20);
const GoodsReceiptBodySchema = z.object({
  receiptType: z.enum(["full", "partial", "rejected"]),
  inspectionStatus: z.enum(["pending", "passed", "failed"]).optional(),
  receivedAt: z.coerce.date().optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  allowMismatch: z.boolean().optional(),
  items: z.array(z.object({
    shipmentItemId: z.coerce.number().int().positive(),
    receivedQty: z.coerce.number().finite().nonnegative(),
    acceptedQty: z.coerce.number().finite().nonnegative(),
    rejectedQty: z.coerce.number().finite().nonnegative(),
    condition: z.enum(["GOOD", "DAMAGED", "SHORTAGE", "REJECTED"]).optional().nullable(),
    notes: z.string().trim().max(2000).optional().nullable(),
  }).strict()).min(1).max(500),
}).strict();
const PodNoteSchema = z.object({
  note: z.string().trim().max(2000).optional().nullable(),
}).strict();

async function requireAdminMiddleware(req: any, res: any, next: () => void): Promise<void> {
  if (await requireAdmin(req, res)) next();
}

// ── GET /api/mkt/admin/dual-write/stats ───────────────────────────────────────

router.get("/dual-write/stats", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const stats = await getDualWriteStats();
    return res.json({ ok: true, data: stats });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] getDualWriteStats error");
    return res.status(500).json({ ok: false, error: "Gagal memuat stats" });
  }
});

// ── GET /api/mkt/admin/dual-write/failed ──────────────────────────────────────

router.get("/dual-write/failed", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

  try {
    const entries = await getFailedDualWriteEntries(limit);
    return res.json({ ok: true, data: entries, count: entries.length });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] getFailedDualWriteEntries error");
    return res.status(500).json({ ok: false, error: "Gagal memuat failed entries" });
  }
});

// ── POST /api/mkt/admin/dual-write/retry (batch) ─────────────────────────────

router.post("/dual-write/retry", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const result = await retryFailedDualWrites();
    logger.info(result, "[mktAdmin] Manual retry batch triggered");
    return res.json({ ok: true, data: result });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] retryFailedDualWrites error");
    return res.status(500).json({ ok: false, error: "Retry batch gagal" });
  }
});

// ── POST /api/mkt/admin/dual-write/retry/:id (single) ────────────────────────

router.post("/dual-write/retry/:id", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const logId = Number(req.params["id"]);
  if (!logId || logId <= 0) {
    return res.status(400).json({ ok: false, error: "id tidak valid" });
  }

  try {
    const result = await retrySingleEntry(logId);
    if (!result.ok) {
      return res.status(422).json({ ok: false, error: result.error });
    }
    logger.info({ logId, rfqId: result.rfqId }, "[mktAdmin] Manual single retry success");
    return res.json({ ok: true, data: result });
  } catch (err: unknown) {
    logger.warn({ err, logId }, "[mktAdmin] retrySingleEntry error");
    return res.status(500).json({ ok: false, error: "Retry gagal" });
  }
});

// ── GET /api/mkt/admin/integrity ──────────────────────────────────────────────

router.get("/integrity", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const result = await runIntegrityCheck();
    return res.json({ ok: true, data: result });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] runIntegrityCheck error");
    return res.status(500).json({ ok: false, error: "Integrity check gagal" });
  }
});

// ── GET /api/mkt/admin/reliability/summary ────────────────────────────────────
// Admin dashboard — semua metrics dalam 1 call

router.get("/reliability/summary", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const summary = await getReliabilitySummary();
    return res.json({ ok: true, data: summary });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] getReliabilitySummary error");
    return res.status(500).json({ ok: false, error: "Gagal memuat reliability summary" });
  }
});

// ── GET /api/mkt/admin/reliability/metrics ────────────────────────────────────
// Raw metrics dengan timing dan scores

router.get("/reliability/metrics", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const metrics = await getDualWriteMetrics();
    return res.json({ ok: true, data: metrics });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] getDualWriteMetrics error");
    return res.status(500).json({ ok: false, error: "Gagal memuat metrics" });
  }
});

// ── GET /api/mkt/admin/cleanup/report ─────────────────────────────────────────
// Jalankan cleanup report on-demand (report only — tidak delete data)

router.get("/cleanup/report", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const report = await runCleanupReport();
    if (!report) {
      return res.json({ ok: true, data: null, message: "Reliability layer tidak aktif" });
    }
    return res.json({ ok: true, data: report });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] runCleanupReport error");
    return res.status(500).json({ ok: false, error: "Cleanup report gagal" });
  }
});

// ── GET /api/mkt/admin/rfqs ────────────────────────────────────────────────────
// Phase 2F: Daftar semua RFQ di sistem (admin view).
// approvalStatus sudah denormalized di mkt_rfqs.approval_status — tidak perlu join.
//
// Response 200: { ok: true, data: RfqRow[], count: number }

router.get("/rfqs", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const { db, mktRfqsTable } = await import("@workspace/db");
    const { desc } = await import("drizzle-orm");

    const rows = await db
      .select({
        // aliased to match MktRfqRow interface in rfq-list.tsx
        rfqId:               mktRfqsTable.id,
        rfqNumber:           mktRfqsTable.rfqNumber,
        rfqStatus:           mktRfqsTable.status,
        approvalStatus:      mktRfqsTable.approvalStatus,
        approvalRequestedAt: mktRfqsTable.approvalRequestedAt,
        approvalResolvedAt:  mktRfqsTable.approvalResolvedAt,
        buyerName:           mktRfqsTable.buyerName,
        buyerEmail:          mktRfqsTable.buyerEmail,
        buyerCompany:        mktRfqsTable.buyerCompany,
        buyerApprovalLevel:  mktRfqsTable.buyerApprovalLevel,
        priority:            mktRfqsTable.priority,
        lineCount:           mktRfqsTable.lineCount,
        quoteCount:          mktRfqsTable.quoteCount,
        notes:               mktRfqsTable.notes,
        requiredDeliveryDate: mktRfqsTable.requiredDeliveryDate,
        createdAt:           mktRfqsTable.createdAt,
        updatedAt:           mktRfqsTable.updatedAt,
      })
      .from(mktRfqsTable)
      .orderBy(desc(mktRfqsTable.createdAt));

    return res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] GET /rfqs error");
    return res.status(500).json({ ok: false, error: "Gagal mengambil daftar RFQ" });
  }
});

// ── POST /api/mkt/admin/rfqs/:rfqId/invite-vendor ─────────────────────────────
// Phase 2C: Undang vendor ke RFQ — membuat satu mkt_vendor_quotes row (status: invited).
//
// Body: { vendorId: number }
// Response 201: { ok: true, data: { quoteId, rfqNumber, vendorName, status, validUntil },
//                 notificationPayload }
// Response 400: rfqId atau vendorId tidak valid
// Response 404: RFQ atau vendor tidak ditemukan
// Response 409: vendor sudah diundang ke RFQ yang sama
// Response 422: vendor tidak aktif
// Token TIDAK disertakan dalam response — hanya disimpan di DB + activity log.

router.post("/rfqs/:rfqId/invite-vendor", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const rfqId = Number(req.params["rfqId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const body = req.body as { vendorId?: unknown };
  const vendorId = Number(body.vendorId);
  if (!Number.isInteger(vendorId) || vendorId <= 0) {
    return res.status(400).json({ ok: false, error: "vendorId wajib diisi dan harus berupa integer positif" });
  }

  const user = req.user as { id?: string; name?: string } | undefined;

  try {
    const result = await inviteVendorToRfq({
      rfqId,
      vendorId,
      adminId:   user?.id   ?? null,
      adminName: (user as { name?: string } | undefined)?.name ?? null,
      ipAddress: req.ip ?? null,
    });

    if (!result.ok) {
      const statusMap: Record<string, number> = {
        RFQ_NOT_FOUND:    404,
        VENDOR_NOT_FOUND: 404,
        VENDOR_INACTIVE:  422,
        DUPLICATE_INVITE: 409,
        DB_ERROR:         500,
      };
      const httpStatus = statusMap[result.code] ?? 500;
      const extra = "existingQuoteId" in result
        ? { existingQuoteId: result.existingQuoteId, existingStatus: result.existingStatus }
        : {};
      return res.status(httpStatus).json({ ok: false, error: result.message, ...extra });
    }

    logger.info(
      { rfqId, vendorId, quoteId: result.quoteId, rfqNumber: result.rfqNumber },
      "[mktAdmin] invite-vendor success",
    );

    // Token sengaja TIDAK dikirim ke caller — hanya disimpan di DB + activity log.
    // notificationPayload dikembalikan TANPA token (Phase 2D akan ambil token dari DB).
    const { token: _token, ...safePayload } = result.notificationPayload;

    return res.status(201).json({
      ok: true,
      data: {
        quoteId:    result.quoteId,
        rfqNumber:  result.rfqNumber,
        vendorName: result.vendorName,
        status:     result.status,
        validUntil: result.validUntil.toISOString(),
      },
      notificationPayload: safePayload,
    });
  } catch (err: unknown) {
    logger.warn({ err, rfqId, vendorId }, "[mktAdmin] invite-vendor unexpected error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ── GET /api/mkt/admin/rfqs/:rfqId/vendor-quotes ─────────────────────────────
// Phase 2C: List semua vendor quotes untuk satu RFQ.
// Token TIDAK disertakan dalam response list.
//
// Response 200: { ok: true, data: VendorQuoteListRow[], count: number }

router.get("/rfqs/:rfqId/vendor-quotes", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const rfqId = Number(req.params["rfqId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  try {
    const quotes = await getVendorQuotesForRfq(rfqId);
    return res.json({ ok: true, data: quotes, count: quotes.length });
  } catch (err: unknown) {
    logger.warn({ err, rfqId }, "[mktAdmin] getVendorQuotesForRfq error");
    return res.status(500).json({ ok: false, error: "Gagal memuat vendor quotes" });
  }
});

// ── Phase 2E: Quote Comparison ───────────────────────────────────────────────

/**
 * GET /api/mkt/admin/rfqs/:rfqId/comparison
 * Comparison view: semua quotes + Level 1 badges + Level 2 weighted score.
 * Security: attachment_url / token / commission tidak dikembalikan.
 * Activity log mkt_quote_comparison_viewed ditulis fire-and-forget.
 */
router.get("/rfqs/:rfqId/comparison", async (req, res) => {
  const adminSession = await requireAdmin(req, res);
  if (!adminSession) return;

  const rfqId = Number(req.params["rfqId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  try {
    const data = await getQuoteComparisonData(rfqId);

    // Activity log — fire-and-forget, non-fatal
    const _adminUser = req.user as { id?: string; name?: string } | undefined;
    const adminId    = _adminUser?.id ?? "unknown";
    const adminName  = _adminUser?.name ?? adminId;

    await logActivity({
      mktRfqId:  rfqId,
      actorType: "admin",
      actorId:   adminId,
      actorName: adminName,
      action:    "mkt_quote_comparison_viewed",
      description: `Admin melihat comparison untuk RFQ ${data.rfq.rfqNumber}`,
      newValue: {
        rfqNumber:       data.rfq.rfqNumber,
        totalQuotes:     data.quotes.length,
        submittedQuotes: data.submittedCount,
      },
    });

    return res.json({ ok: true, data });
  } catch (err: unknown) {
    const code = (err as { code?: string }).code;
    if (code === "RFQ_NOT_FOUND") {
      return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });
    }
    logger.warn({ err, rfqId }, "[mktAdmin] getQuoteComparisonData error");
    return res.status(500).json({ ok: false, error: "Gagal memuat comparison data" });
  }
});

// ── Phase 2E: Select Vendor ───────────────────────────────────────────────────

/**
 * POST /api/mkt/admin/rfqs/:rfqId/select-vendor
 * Pilih vendor winner, reject vendor lain, buat Purchase Order.
 * Race condition protected: UPDATE mkt_rfqs WHERE status<>'awarded' RETURNING id.
 * Body: { quoteId: number, notes?: string }
 */
router.post("/rfqs/:rfqId/select-vendor", async (req, res) => {
  const adminSession = await requireAdmin(req, res);
  if (!adminSession) return;

  const rfqId = Number(req.params["rfqId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const { quoteId, notes } = req.body as { quoteId?: unknown; notes?: unknown };
  if (!quoteId || !Number.isInteger(Number(quoteId)) || Number(quoteId) <= 0) {
    return res.status(400).json({ ok: false, error: "quoteId harus berupa integer positif" });
  }

  const _adminUser = req.user as { id?: string; name?: string } | undefined;
  const adminId    = _adminUser?.id ?? "unknown";
  const adminName  = _adminUser?.name ?? adminId;

  const result = await selectVendorAndCreatePo({
    rfqId,
    quoteId:   Number(quoteId),
    adminId,
    adminName,
    notes:     typeof notes === "string" ? notes : undefined,
  });

  if (!result.ok) {
    if (result.code === "RFQ_ALREADY_AWARDED") {
      return res.status(409).json({ ok: false, code: result.code, error: result.message });
    }
    if (result.code === "QUOTE_NO_LONGER_SUBMITTED") {
      return res.status(409).json({ ok: false, code: result.code, error: result.message });
    }
    if (result.code === "RFQ_NOT_FOUND" || result.code === "QUOTE_NOT_FOUND") {
      return res.status(404).json({ ok: false, code: result.code, error: result.message });
    }
    return res.status(500).json({ ok: false, code: result.code, error: result.message });
  }

  return res.status(201).json({
    ok: true,
    data: {
      poId:         result.poId,
      poNumber:     result.poNumber,
      vendor:       result.vendorName,
      total:        result.totalAmount,
      selectedAt:   result.selectedAt,
      selectedBy:   result.selectedBy,
      rejectedCount: result.rejectedCount,
    },
  });
});

// ── Phase 2E: Purchase Order list ─────────────────────────────────────────────

/**
 * GET /api/mkt/admin/purchase-orders
 * List semua PO dengan filter opsional: status, companyId, limit, offset.
 */
router.get("/purchase-orders", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const status = req.query["status"] as string | undefined;
  const companyId = req.query["companyId"] ? Number(req.query["companyId"]) : undefined;

  try {
    const { db, mktPurchaseOrdersTable, suppliersTable, mktRfqsTable } = await import("@workspace/db");
    const { eq, and, desc } = await import("drizzle-orm");

    const conditions = [];
    if (status) conditions.push(eq(mktPurchaseOrdersTable.status, status as any));
    if (companyId && Number.isInteger(companyId)) conditions.push(eq(mktPurchaseOrdersTable.companyId, companyId));

    const rows = await db
      .select({
        id:              mktPurchaseOrdersTable.id,
        poNumber:        mktPurchaseOrdersTable.poNumber,
        rfqId:           mktPurchaseOrdersTable.rfqId,
        quoteId:         mktPurchaseOrdersTable.quoteId,
        companyId:       mktPurchaseOrdersTable.companyId,
        vendorId:        mktPurchaseOrdersTable.vendorId,
        status:          mktPurchaseOrdersTable.status,
        totalAmount:     mktPurchaseOrdersTable.totalAmount,
        grandTotal:      mktPurchaseOrdersTable.grandTotal,
        createdBy:       mktPurchaseOrdersTable.createdBy,
        confirmedAt:     mktPurchaseOrdersTable.confirmedAt,
        cancelledAt:     mktPurchaseOrdersTable.cancelledAt,
        createdAt:       mktPurchaseOrdersTable.createdAt,
        // Snapshot fields
        vendorNameSnapshot:      mktPurchaseOrdersTable.vendorNameSnapshot,
        paymentTermsSnapshot:    mktPurchaseOrdersTable.paymentTermsSnapshot,
        incotermSnapshot:        mktPurchaseOrdersTable.incotermSnapshot,
        currencySnapshot:        mktPurchaseOrdersTable.currencySnapshot,
        leadTimeDaysSnapshot:    mktPurchaseOrdersTable.leadTimeDaysSnapshot,
        quotationNumberSnapshot: mktPurchaseOrdersTable.quotationNumberSnapshot,
        quotationDateSnapshot:   mktPurchaseOrdersTable.quotationDateSnapshot,
        // Related
        rfqNumber: mktRfqsTable.rfqNumber,
        vendorName: suppliersTable.name,
      })
      .from(mktPurchaseOrdersTable)
      .leftJoin(mktRfqsTable, eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id))
      .leftJoin(suppliersTable, eq(mktPurchaseOrdersTable.vendorId, suppliersTable.id))
      .where(conditions.length > 0 ? and(...conditions as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]) : undefined)
      .orderBy(desc(mktPurchaseOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] purchase-orders list error");
    return res.status(500).json({ ok: false, error: "Gagal memuat purchase orders" });
  }
});

/**
 * GET /api/mkt/admin/purchase-orders/:id
 * Detail PO termasuk snapshot immutable + linked quote + linked RFQ.
 */
router.get("/purchase-orders/:id", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  try {
    const { db, mktPurchaseOrdersTable, suppliersTable, mktRfqsTable, mktVendorQuotesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");

    const [po] = await db
      .select({
        id:              mktPurchaseOrdersTable.id,
        poNumber:        mktPurchaseOrdersTable.poNumber,
        rfqId:           mktPurchaseOrdersTable.rfqId,
        quoteId:         mktPurchaseOrdersTable.quoteId,
        companyId:       mktPurchaseOrdersTable.companyId,
        vendorId:        mktPurchaseOrdersTable.vendorId,
        status:          mktPurchaseOrdersTable.status,
        totalAmount:     mktPurchaseOrdersTable.totalAmount,
        taxAmount:       mktPurchaseOrdersTable.taxAmount,
        grandTotal:      mktPurchaseOrdersTable.grandTotal,
        createdBy:       mktPurchaseOrdersTable.createdBy,
        confirmedAt:     mktPurchaseOrdersTable.confirmedAt,
        cancelledAt:     mktPurchaseOrdersTable.cancelledAt,
        cancelReason:    mktPurchaseOrdersTable.cancelReason,
        journalPostedAt: mktPurchaseOrdersTable.journalPostedAt,
        createdAt:       mktPurchaseOrdersTable.createdAt,
        updatedAt:       mktPurchaseOrdersTable.updatedAt,
        // All snapshot immutable fields
        vendorNameSnapshot:      mktPurchaseOrdersTable.vendorNameSnapshot,
        vendorAddressSnapshot:   mktPurchaseOrdersTable.vendorAddressSnapshot,
        paymentTermsSnapshot:    mktPurchaseOrdersTable.paymentTermsSnapshot,
        incotermSnapshot:        mktPurchaseOrdersTable.incotermSnapshot,
        quotationNumberSnapshot: mktPurchaseOrdersTable.quotationNumberSnapshot,
        quotationDateSnapshot:   mktPurchaseOrdersTable.quotationDateSnapshot,
        currencySnapshot:        mktPurchaseOrdersTable.currencySnapshot,
        leadTimeDaysSnapshot:    mktPurchaseOrdersTable.leadTimeDaysSnapshot,
        // Related
        rfqNumber:    mktRfqsTable.rfqNumber,
        rfqStatus:    mktRfqsTable.status,
        buyerName:    mktRfqsTable.buyerName,
        buyerEmail:   mktRfqsTable.buyerEmail,
        vendorName:   suppliersTable.name,
        vendorPhone:  suppliersTable.phone,
        vendorEmail:  suppliersTable.contactEmail,
        quoteStatus:  mktVendorQuotesTable.status,
      })
      .from(mktPurchaseOrdersTable)
      .leftJoin(mktRfqsTable, eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id))
      .leftJoin(suppliersTable, eq(mktPurchaseOrdersTable.vendorId, suppliersTable.id))
      .leftJoin(mktVendorQuotesTable, eq(mktPurchaseOrdersTable.quoteId, mktVendorQuotesTable.id))
      .where(eq(mktPurchaseOrdersTable.id, poId))
      .limit(1);

    if (!po) {
      return res.status(404).json({ ok: false, error: "Purchase order tidak ditemukan" });
    }

    return res.json({ ok: true, data: po });
  } catch (err: unknown) {
    logger.warn({ err, poId }, "[mktAdmin] purchase-orders detail error");
    return res.status(500).json({ ok: false, error: "Gagal memuat purchase order" });
  }
});

/**
 * GET /api/mkt/admin/purchase-orders/:id/lines
 * Immutable snapshot lines untuk PO (Phase 2G.1).
 * Auth: requireAdmin
 */
router.get("/purchase-orders/:id/lines", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  try {
    const { listPoLines } = await import("../lib/services/mktPoLinesService.js");
    const lines = await listPoLines(poId);
    return res.json({ ok: true, count: lines.length, data: lines });
  } catch (err: unknown) {
    logger.warn({ err, poId }, "[mktAdmin] purchase-orders lines error");
    return res.status(500).json({ ok: false, error: "Gagal memuat PO lines" });
  }
});

/**
 * GET /api/mkt/admin/purchase-orders/:id/activity-log
 * Riwayat aktivitas PO dari activity_logs (mkt_purchase_order_id).
 * Auth: requireAdmin
 * Returns:  { ok: true, count: number, data: ActivityLogEntry[] }
 */
router.get("/purchase-orders/:id/activity-log", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");

    const result = await db.execute(sql`
      SELECT
        id,
        mkt_purchase_order_id   AS "purchaseOrderId",
        action,
        old_value               AS "statusFrom",
        new_value               AS "statusTo",
        description             AS "message",
        actor_name              AS "actorName",
        actor_type              AS "actorRole",
        actor_id                AS "actorId",
        created_at              AS "createdAt"
      FROM activity_logs
      WHERE mkt_purchase_order_id = ${poId}
      ORDER BY created_at DESC
      LIMIT 200
    `);

    const data = (result.rows as Record<string, unknown>[]).map((r) => ({
      id:               r["id"],
      purchaseOrderId:  r["purchaseOrderId"],
      action:           r["action"],
      statusFrom:       r["statusFrom"] != null
        ? ((r["statusFrom"] as { status?: string }).status ?? null)
        : null,
      statusTo:         r["statusTo"] != null
        ? ((r["statusTo"] as { status?: string }).status ?? null)
        : null,
      message:          r["message"] ?? null,
      actorName:        r["actorName"] ?? null,
      actorRole:        r["actorRole"] ?? null,
      createdAt:        r["createdAt"],
    }));

    return res.json({ ok: true, count: data.length, data });
  } catch (err: unknown) {
    logger.warn({ err, poId }, "[mktAdmin] purchase-orders activity-log error");
    return res.status(500).json({ ok: false, error: "Gagal memuat activity log" });
  }
});

// ── Phase 2E: Attachment download (signed URL on-demand) ─────────────────────

/**
 * GET /api/mkt/admin/rfqs/:rfqId/quotes/:quoteId/attachment
 * Generate signed URL (300s) on-demand dan redirect 302.
 * TIDAK pernah mengirim signed URL di comparison response.
 * Flow: validateAdmin → loadAttachmentUrl → generateSignedUrl → 302 Redirect
 */
router.get("/rfqs/:rfqId/quotes/:quoteId/attachment", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const rfqId   = Number(req.params["rfqId"]);
  const quoteId = Number(req.params["quoteId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0 || !Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId dan quoteId harus berupa integer positif" });
  }

  try {
    const { db, mktVendorQuotesTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");

    // Load attachment_url — validate quote belongs to this rfq
    const [quote] = await db
      .select({
        attachmentUrl:      mktVendorQuotesTable.attachmentUrl,
        attachmentFilename: mktVendorQuotesTable.attachmentFilename,
      })
      .from(mktVendorQuotesTable)
      .where(
        and(
          eq(mktVendorQuotesTable.id, quoteId),
          eq(mktVendorQuotesTable.rfqId, rfqId),
        )
      )
      .limit(1);

    if (!quote) {
      return res.status(404).json({ ok: false, error: "Quote tidak ditemukan" });
    }

    if (!quote.attachmentUrl) {
      return res.status(404).json({ ok: false, error: "Quote tidak memiliki attachment" });
    }

    // Generate signed URL on-demand (300s TTL)
    const storage   = new ObjectStorageService();
    const signedUrl = await storage.getSignedUrl(quote.attachmentUrl, 300);

    // Activity log — fire-and-forget
    await logActivity({
      mktRfqId:         rfqId,
      mktVendorQuoteId: quoteId,
      actorType:        "admin",
      actorId:          "admin",
      action:           "mkt_quote_attachment_downloaded",
      description:      `Admin mengunduh attachment quote ${quoteId} (file: ${quote.attachmentFilename ?? "unknown"})`,
      newValue:         { quoteId, rfqId, filename: quote.attachmentFilename },
    });

    // 302 redirect ke signed URL — URL tidak pernah disimpan di response body
    return res.redirect(302, signedUrl);
  } catch (err: unknown) {
    logger.warn({ err, rfqId, quoteId }, "[mktAdmin] attachment download error");
    return res.status(500).json({ ok: false, error: "Gagal generate download URL" });
  }
});

// ── Phase 2F: Requote Admin ────────────────────────────────────────────────────

/**
 * POST /api/mkt/admin/rfqs/:rfqId/quotes/:quoteId/request-requote
 * Admin meminta vendor untuk merevisi quotation.
 * Precondition: quote.status = 'submitted'
 * Body: { notes: string, deadline?: string (ISO date) }
 * Response 200: { ok: true, data: { quoteId, rfqNumber, vendorName } }
 */
router.post("/rfqs/:rfqId/quotes/:quoteId/request-requote", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const rfqId   = Number(req.params["rfqId"]);
  const quoteId = Number(req.params["quoteId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0 || !Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId dan quoteId harus berupa integer positif" });
  }

  const body = req.body as { notes?: unknown; deadline?: unknown };
  if (!body.notes || typeof body.notes !== "string" || !body.notes.trim()) {
    return res.status(400).json({ ok: false, error: "notes (alasan requote) wajib diisi" });
  }

  const user      = req.user as { id?: string; name?: string } | undefined;
  const adminId   = user?.id ?? "unknown";
  const adminName = user?.name ?? adminId;

  let deadline: Date | null = null;
  if (typeof body.deadline === "string" && body.deadline.trim()) {
    const parsed = new Date(body.deadline.trim());
    if (isNaN(parsed.getTime())) {
      return res.status(400).json({ ok: false, error: "deadline harus berupa tanggal ISO yang valid" });
    }
    deadline = parsed;
  }

  const result = await requestRequote({
    rfqId, quoteId,
    adminId, adminName,
    notes:    body.notes.trim(),
    deadline,
  });

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      RFQ_NOT_FOUND:   404,
      QUOTE_NOT_FOUND: 404,
      WRONG_STATUS:    422,
      DB_ERROR:        500,
    };
    return res.status(statusMap[result.code] ?? 500).json({ ok: false, error: result.message });
  }

  logger.info({ rfqId, quoteId, adminId, vendorName: result.vendorName }, "[mktAdmin] request-requote success");

  // Enqueue notification ke vendor (non-fatal)
  // Vendor phone akan di-resolve oleh worker via suppliersTable lookup
  enqueueNotification({
    eventType:     "mkt_requote_requested",
    recipientType: "vendor",
    rfqId,
    vendorQuoteId: quoteId,
    payloadJson: {
      rfqId,
      quoteId,
      rfqNumber:      result.rfqNumber,
      vendorName:     result.vendorName,
      requoteNotes:   body.notes.trim(),
      requoteDeadline: deadline?.toISOString() ?? null,
      requestedBy:    adminName,
    },
  }).catch((err: unknown) => {
    logger.error({ err, rfqId, quoteId }, "[mktAdmin] enqueue mkt_requote_requested failed");
  });

  return res.json({
    ok: true,
    data: {
      quoteId:    result.quoteId,
      rfqNumber:  result.rfqNumber,
      vendorName: result.vendorName,
    },
  });
});

/**
 * GET /api/mkt/admin/rfqs/:rfqId/quotes/:quoteId/requote-status
 * Ambil status requote dari satu vendor quote.
 * Response 200: { ok: true, data: { status, requoteNotes, requoteDeadline, requoteRound } }
 */
router.get("/rfqs/:rfqId/quotes/:quoteId/requote-status", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const rfqId   = Number(req.params["rfqId"]);
  const quoteId = Number(req.params["quoteId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0 || !Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId dan quoteId harus berupa integer positif" });
  }

  const result = await getRequoteStatus(rfqId, quoteId);

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      QUOTE_NOT_FOUND: 404,
      DB_ERROR:        500,
    };
    return res.status(statusMap[result.code] ?? 500).json({ ok: false, error: result.message });
  }

  return res.json({
    ok: true,
    data: {
      status:          result.status,
      requoteNotes:    result.requoteNotes,
      requoteDeadline: result.requoteDeadline,
      requoteRound:    result.requoteRound,
    },
  });
});

// ── Phase 2E.1: Notification Queue Admin ─────────────────────────────────────

/**
 * GET /api/mkt/admin/notification-queue/stats
 * Stats per-status + total 24h dari mkt_notification_queue.
 * Response: { ok: true, data: NotifQueueStats }
 */
router.get("/notification-queue/stats", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  try {
    const stats = await getNotifQueueStats();
    return res.json({ ok: true, data: stats });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] getNotifQueueStats error");
    return res.status(500).json({ ok: false, error: "Gagal memuat notification queue stats" });
  }
});

/**
 * GET /api/mkt/admin/notification-queue/exhausted
 * List rows yang sudah exhausted (semua attempt habis, tidak akan di-retry otomatis).
 * Query param: limit (default 50, max 200)
 * Response: { ok: true, data: ExhaustedNotifRow[], count: number }
 */
router.get("/notification-queue/exhausted", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const limit = Math.min(Number(req.query["limit"] ?? 50), 200);

  try {
    const rows = await getExhaustedNotifications(limit);
    return res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: unknown) {
    logger.warn({ err }, "[mktAdmin] getExhaustedNotifications error");
    return res.status(500).json({ ok: false, error: "Gagal memuat exhausted notifications" });
  }
});

/**
 * POST /api/mkt/admin/notification-queue/:id/retry
 * Reset satu row 'exhausted' kembali ke 'pending' (attempt_count=0).
 * Notifikasi akan dikirim ulang di batch worker berikutnya (~3 menit).
 * Response 200: { ok: true }
 * Response 404: row tidak ditemukan
 * Response 422: row bukan status 'exhausted'
 */
router.post("/notification-queue/:id/retry", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const queueId = Number(req.params["id"]);
  if (!Number.isInteger(queueId) || queueId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  try {
    const result = await retryExhaustedNotification(queueId);
    if (!result.ok) {
      if (result.code === "NOT_FOUND") {
        return res.status(404).json({ ok: false, error: "Notification queue item tidak ditemukan" });
      }
      if (result.code === "NOT_EXHAUSTED") {
        return res.status(422).json({ ok: false, error: "Item bukan status exhausted — hanya exhausted yang bisa di-retry manual" });
      }
      return res.status(500).json({ ok: false, error: "Retry gagal" });
    }

    logger.info({ queueId }, "[mktAdmin] Admin manual retry exhausted notification");
    return res.json({ ok: true, message: `Queue item ${queueId} direset ke pending — akan dikirim di batch berikutnya` });
  } catch (err: unknown) {
    logger.warn({ err, queueId }, "[mktAdmin] notification-queue retry error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ── Phase 2G — Admin PO lifecycle ──────────────────────────────────────────
//
// POST /api/mkt/admin/purchase-orders/:id/issue
// POST /api/mkt/admin/purchase-orders/:id/production
// POST /api/mkt/admin/purchase-orders/:id/ready-to-ship
// POST /api/mkt/admin/purchase-orders/:id/in-transit
// POST /api/mkt/admin/purchase-orders/:id/delivered
// POST /api/mkt/admin/purchase-orders/:id/complete
// POST /api/mkt/admin/purchase-orders/:id/close

function getActorFromReq(req: any) {
  return {
    actorType: "admin" as const,
    actorId: req.user?.id ?? null,
    actorName: req.user?.name ?? req.user?.username ?? null,
  };
}

// ── Sprint 7B — Marketplace vendor invoice / 3-way match ───────────────────

router.get("/vendor-invoices/:id", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  const invoiceId = Number(req.params["id"]);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ ok: false, error: "invoiceId harus berupa integer positif" });
  }
  try {
    const detail = await getMarketplaceVendorInvoice(invoiceId);
    if (!detail || !detail.invoice.mktPurchaseOrderId) {
      return res.status(404).json({ ok: false, error: "INVOICE_NOT_FOUND" });
    }
    return res.json({
      ok: true,
      data: safeMarketplaceVendorInvoiceView(detail.invoice, detail.lines),
    });
  } catch (err) {
    logger.warn({ err, invoiceId }, "[mktAdmin] get marketplace vendor invoice error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/vendor-invoices/:id/match", fulfillmentWriteLimiter, async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;
  const invoiceId = Number(req.params["id"]);
  if (!Number.isInteger(invoiceId) || invoiceId <= 0) {
    return res.status(400).json({ ok: false, error: "invoiceId harus berupa integer positif" });
  }
  try {
    const detail = await getMarketplaceVendorInvoice(invoiceId);
    if (!detail || !detail.invoice.mktPurchaseOrderId) {
      return res.status(404).json({ ok: false, error: "INVOICE_NOT_FOUND" });
    }
    const result = await submitMarketplaceVendorInvoice(invoiceId, getActorFromReq(req));
    if (!result.ok) {
      const status = ["PO_NOT_FOUND", "GR_NOT_FOUND", "GR_NOT_FOR_PO"].includes(result.code)
        ? 404
        : ["INVALID_STATUS", "SHIPMENT_NOT_DELIVERED", "RECEIPT_NOT_ACCEPTED"].includes(result.code)
          ? 409
          : 422;
      return res.status(status).json({ ok: false, error: result.code, message: result.message });
    }
    return res.json({
      ok: true,
      alreadyMatched: result.alreadyExists === true,
      data: safeMarketplaceVendorInvoiceView(result.invoice, result.lines),
      match: result.match,
    });
  } catch (err) {
    logger.warn({ err, invoiceId }, "[mktAdmin] execute marketplace vendor invoice match error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

function mapLifecycleFailureStatus(code: string): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_TRANSITION":
      return 409;
    case "CONCURRENT_UPDATE":
      return 409;
    default:
      return 400;
  }
}

function makeLifecycleHandler(fn: (poId: number, actor: ReturnType<typeof getActorFromReq>) => Promise<any>) {
  return async (req: any, res: any) => {
    const ok = await requireAdmin(req, res);
    if (!ok) return;

    const poId = Number(req.params["id"]);
    if (!Number.isInteger(poId) || poId <= 0) {
      return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
    }

    try {
      const result = await fn(poId, getActorFromReq(req));
      if (!result.ok) {
        return res.status(mapLifecycleFailureStatus(result.code)).json({ ok: false, error: result.code, currentStatus: result.currentStatus });
      }
      return res.json({ ok: true, po: result.po, ...(result.vendorToken ? { vendorToken: result.vendorToken, vendorTokenExpiresAt: result.vendorTokenExpiresAt } : {}) });
    } catch (err: unknown) {
      logger.warn({ err, poId }, "[mktAdmin] PO lifecycle transition error");
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  };
}

router.post("/purchase-orders/:id/issue", makeLifecycleHandler(issuePo));
router.post("/purchase-orders/:id/production", makeLifecycleHandler(setProduction));
router.post("/purchase-orders/:id/ready-to-ship", makeLifecycleHandler(setReadyToShip));
router.post("/purchase-orders/:id/in-transit", makeLifecycleHandler(setInTransit));
router.post("/purchase-orders/:id/delivered", makeLifecycleHandler(markDelivered));
router.post("/purchase-orders/:id/complete", makeLifecycleHandler(completePo));
router.post("/purchase-orders/:id/close", makeLifecycleHandler(closePo));

// ── Phase 2G — Shipment service ────────────────────────────────────────────
//
// POST /api/mkt/admin/purchase-orders/:id/shipments          — create shipment (+items)
// GET  /api/mkt/admin/purchase-orders/:id/shipments          — list shipments for a PO
// GET  /api/mkt/admin/shipments/:shipmentId                  — shipment detail + items
// POST /api/mkt/admin/shipments/:shipmentId/events           — append event (append-only)
// GET  /api/mkt/admin/shipments/:shipmentId/timeline         — list events chronologically

router.post("/purchase-orders/:id/shipments", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  const body = req.body ?? {};
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ ok: false, error: "items wajib diisi (minimal 1 item)" });
  }

  try {
    const result = await createShipment({ poId, ...body }, getActorFromReq(req));
    if (!result.ok) {
      const status = result.code === "PO_NOT_FOUND" ? 404 : 422;
      return res.status(status).json({ ok: false, error: result.code, message: result.message });
    }
    return res.status(201).json({ ok: true, shipment: result.shipment, items: result.items });
  } catch (err: unknown) {
    logger.warn({ err, poId }, "[mktAdmin] createShipment error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/purchase-orders/:id/shipments", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  try {
    const shipments = await listShipmentsForPo(poId);
    return res.json({ ok: true, data: shipments });
  } catch (err: unknown) {
    logger.warn({ err, poId }, "[mktAdmin] listShipmentsForPo error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/shipments/:shipmentId", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });
  }

  try {
    const shipment = await getShipmentById(shipmentId);
    if (!shipment) return res.status(404).json({ ok: false, error: "Shipment tidak ditemukan" });
    const items = await listShipmentItems(shipmentId);
    return res.json({ ok: true, shipment, items });
  } catch (err: unknown) {
    logger.warn({ err, shipmentId }, "[mktAdmin] getShipmentById error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.post("/shipments/:shipmentId/events", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });
  }
  const eventType = typeof req.body?.eventType === "string" ? req.body.eventType.trim() : "";
  if (!eventType) {
    return res.status(400).json({ ok: false, error: "eventType wajib diisi" });
  }

  try {
    const result = await appendShipmentEvent({ shipmentId, ...req.body, eventType }, getActorFromReq(req));
    if (!result.ok) {
      return res.status(404).json({ ok: false, error: result.code });
    }
    return res.status(201).json({ ok: true, event: result.event });
  } catch (err: unknown) {
    logger.warn({ err, shipmentId }, "[mktAdmin] appendShipmentEvent error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/shipments/:shipmentId/timeline", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });
  }

  try {
    const timeline = await listShipmentTimeline(shipmentId);
    return res.json({ ok: true, data: timeline });
  } catch (err: unknown) {
    logger.warn({ err, shipmentId }, "[mktAdmin] listShipmentTimeline error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ── Phase 2G — Goods receipt service ───────────────────────────────────────
//
// POST /api/mkt/admin/shipments/:shipmentId/goods-receipts   — create header+items
// GET  /api/mkt/admin/shipments/:shipmentId/goods-receipts   — list receipts for shipment
// GET  /api/mkt/admin/goods-receipts/:id/items               — list items for a receipt

router.post(
  "/shipments/:shipmentId/goods-receipts",
  fulfillmentWriteLimiter,
  requireAdminMiddleware,
  validateBody(GoodsReceiptBodySchema),
  async (req, res) => {
  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });
  }

  try {
    const body = req.body as z.infer<typeof GoodsReceiptBodySchema>;
    const result = await createGoodsReceipt({ shipmentId, ...body }, getActorFromReq(req));
    if (!result.ok) {
      const status = result.code === "SHIPMENT_NOT_FOUND" || result.code === "PO_NOT_FOUND" ? 404 : 422;
      return res.status(status).json({ ok: false, error: result.code, message: result.message, details: result.details });
    }
    return res.status(result.alreadyExists ? 200 : 201).json({
      ok: true,
      alreadyExists: result.alreadyExists === true,
      receipt: result.receipt,
      items: result.items,
      poStatusUpdatedTo: result.poStatusUpdatedTo,
    });
  } catch (err: unknown) {
    logger.warn({ err, shipmentId }, "[mktAdmin] createGoodsReceipt error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
  },
);

// POST /api/mkt/admin/shipments/:shipmentId/pod — canonical POD upload.
// The client filename is intentionally ignored; ObjectStorageService creates
// the server-side object path. The private path is never returned to clients.
router.post(
  "/shipments/:shipmentId/pod",
  fulfillmentWriteLimiter,
  requireAdminMiddleware,
  podUpload.single("file"),
  async (req, res) => {
    const shipmentId = Number(req.params["shipmentId"]);
    if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
      return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });
    }

    const file = req.file;
    if (!file) {
      return res.status(400).json({ ok: false, error: "file POD wajib diisi" });
    }
    const magic = validateMagicBytes(file.buffer, file.mimetype);
    if (!magic.ok) {
      return res.status(400).json({ ok: false, error: "INVALID_FILE", message: magic.errorMessage });
    }

    const parsedBody = PodNoteSchema.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      return res.status(400).json({ ok: false, error: "INVALID_BODY", details: parsedBody.error.flatten() });
    }

    try {
      const result = await uploadProofOfDelivery({
        shipmentId,
        buffer: file.buffer,
        mimeType: file.mimetype,
        note: parsedBody.data.note,
      }, getActorFromReq(req));
      if (!result.ok) {
        const status = result.code === "SHIPMENT_NOT_FOUND" ? 404 : 422;
        return res.status(status).json({ ok: false, error: result.code });
      }

      return res.status(result.alreadyUploaded ? 200 : 201).json({
        ok: true,
        alreadyUploaded: result.alreadyUploaded === true,
        event: {
          id: result.event.id,
          shipmentId: result.event.shipmentId,
          eventSequence: result.event.eventSequence,
          eventType: result.event.eventType,
          note: result.event.note,
          createdAt: result.event.createdAt,
        },
      });
    } catch (err: unknown) {
      logger.warn({ err, shipmentId }, "[mktAdmin] uploadProofOfDelivery error");
      return res.status(500).json({ ok: false, error: "Internal server error" });
    }
  },
);

router.get("/shipments/:shipmentId/goods-receipts", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0) {
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });
  }

  try {
    const receipts = await listGoodsReceiptsForShipment(shipmentId);
    return res.json({ ok: true, data: receipts });
  } catch (err: unknown) {
    logger.warn({ err, shipmentId }, "[mktAdmin] listGoodsReceiptsForShipment error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

router.get("/goods-receipts/:id/items", async (req, res) => {
  const ok = await requireAdmin(req, res);
  if (!ok) return;

  const goodsReceiptId = Number(req.params["id"]);
  if (!Number.isInteger(goodsReceiptId) || goodsReceiptId <= 0) {
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });
  }

  try {
    const items = await listGoodsReceiptItems(goodsReceiptId);
    return res.json({ ok: true, data: items });
  } catch (err: unknown) {
    logger.warn({ err, goodsReceiptId }, "[mktAdmin] listGoodsReceiptItems error");
    return res.status(500).json({ ok: false, error: "Internal server error" });
  }
});

// ── POST /api/mkt/admin/rfqs/:rfqId/send-to-customer ─────────────────────────
// Admin memilih vendor terbaik dan mengirim quotation ke customer untuk disetujui.
// Customer akan melihat quotation di portal, bisa approve (→ PO dibuat) atau reject.
// Body: { quoteId: number, notes?: string }

router.post("/rfqs/:rfqId/send-to-customer", async (req, res) => {
  const adminSession = await requireAdmin(req, res);
  if (!adminSession) return;

  const rfqId = Number(req.params["rfqId"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  const { quoteId, notes } = req.body as { quoteId?: unknown; notes?: unknown };
  const quoteIdNum = Number(quoteId);
  if (!Number.isInteger(quoteIdNum) || quoteIdNum <= 0)
    return res.status(400).json({ ok: false, error: "quoteId wajib diisi dan harus berupa integer positif" });

  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const adminUser = req.user as { id?: string; name?: string } | undefined;
    const adminId   = adminUser?.id   ?? "unknown";
    const adminName = adminUser?.name ?? adminId;

    // Verify RFQ exists and quote belongs to it
    const rfqRows = await db.execute(sql`
      SELECT r.id, r.status, r.rfq_number, r.portal_customer_id,
             r.buyer_name, r.buyer_email, r.buyer_phone,
             q.id AS quote_id, q.status AS quote_status, s.name AS vendor_name
      FROM mkt_rfqs r
      INNER JOIN mkt_vendor_quotes q ON q.id = ${quoteIdNum} AND q.rfq_id = r.id
      INNER JOIN suppliers s ON s.id = q.vendor_id
      WHERE r.id = ${rfqId}
      LIMIT 1
    `);

    const row = ((rfqRows as any).rows ?? rfqRows)[0] as Record<string, unknown> | undefined;
    if (!row) {
      return res.status(404).json({ ok: false, error: "RFQ atau vendor quote tidak ditemukan" });
    }

    const currentStatus = String(row["status"] ?? "");
    if (["awarded", "cancelled", "expired"].includes(currentStatus)) {
      return res.status(409).json({
        ok: false,
        error: `RFQ tidak bisa dikirim ke customer (status: ${currentStatus})`,
      });
    }

    const quoteStatus = String(row["quote_status"] ?? "");
    if (!["submitted", "selected"].includes(quoteStatus)) {
      return res.status(422).json({
        ok: false,
        error: `Vendor quote harus dalam status submitted (current: ${quoteStatus})`,
      });
    }

    // Update rfq: status = customer_review, proposed_quote_id = quoteId
    await db.execute(sql`
      UPDATE mkt_rfqs
      SET status            = 'customer_review',
          proposed_quote_id = ${quoteIdNum},
          updated_at        = NOW()
      WHERE id = ${rfqId}
    `);

    // Notify buyer (WA) — recipientPhone was previously omitted, so the row
    // always ended up with no phone number and the notification never sent.
    enqueueNotification({
      eventType:     "mkt_rfq_vendor_selected" as any,
      recipientType: "buyer",
      recipientPhone: row["buyer_phone"] ? String(row["buyer_phone"]) : null,
      rfqId,
      payloadJson: {
        rfqId,
        rfqNumber:      row["rfq_number"],
        buyerEmail:     row["buyer_email"],
        vendorName:     row["vendor_name"],
        sentToCustomer: true,
        notes:          typeof notes === "string" ? notes : undefined,
      },
    }).catch(() => {});

    await logActivity({
      actorType: "admin",
      actorId:   adminId,
      actorName: adminName,
      action:    "mkt_rfq_sent_to_customer",
      description: `Admin mengirim quotation vendor ${row["vendor_name"]} ke customer (RFQ ${row["rfq_number"]})`,
      newValue:  { rfqId, quoteId: quoteIdNum, vendorName: row["vendor_name"] },
    }).catch(() => {});

    logger.info({ rfqId, quoteIdNum, adminId }, "[mktAdmin] send-to-customer → customer_review");
    return res.json({
      ok: true,
      data: {
        rfqId,
        rfqNumber:  row["rfq_number"],
        vendorName: row["vendor_name"],
        status:     "customer_review",
        buyerEmail: row["buyer_email"],
      },
    });
  } catch (err: unknown) {
    logger.warn({ err, rfqId }, "[mktAdmin] send-to-customer error");
    return res.status(500).json({ ok: false, error: "Gagal mengirim quotation ke customer" });
  }
});

export default router;

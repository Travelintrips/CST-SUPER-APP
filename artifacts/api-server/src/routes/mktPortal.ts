/**
 * mktPortal.ts — Phase 2F: Portal Marketplace Routes (Buyer / Approver)
 *
 * Mounted at: /api/mkt/portal
 *
 * Endpoints:
 *   GET  /rfqs                          — List RFQ milik buyer yang sedang login
 *   POST /rfqs/:id/submit               — Submit draft RFQ untuk approval (atau self-approve)
 *   POST /rfqs/:id/cancel               — Cancel RFQ (hanya draft / submitted)
 *   GET  /rfqs/pending-approvals        — Daftar RFQ yang menunggu approval dari saya
 *   POST /rfqs/:id/submit-for-approval  — Buyer mengajukan draft RFQ untuk approval
 *   POST /rfqs/:id/approve              — Setujui RFQ (sebagai approver)
 *   POST /rfqs/:id/reject               — Tolak RFQ (sebagai approver, notes wajib)
 *
 * Auth: requirePortalAuth — Bearer token (customer portal session, bukan admin)
 * Notification: semua aksi yang relevan di-enqueue via mkt_notification_queue
 *
 * Rules:
 *   - Tidak ada admin auth di sini — hanya buyer / approver portal
 *   - Tidak pernah throw ke caller — semua error via typed union
 *   - Tidak ada silent catch — semua error di-log via logger.error
 *   - Notification via mkt_notification_queue SAJA (tidak direct WA)
 */

import { Router, type Request, type Response } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { z } from "zod/v4";
import { requirePortalAuth, type PortalAuthReq } from "../lib/supabaseAuth.js";
import {
  getBuyerRfqs,
  submitRfqForApproval,
  cancelRfq,
  getPendingApprovalsForMember,
  approveRfq,
  rejectRfq,
  rejectCustomerQuotation,
} from "../lib/services/rfqApprovalService.js";
import { enqueueNotification } from "../lib/services/marketplaceNotificationQueueService.js";
import { NotificationService } from "../lib/services/notificationService.js";
import { logger } from "../lib/logger.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import { logActivity } from "../lib/activityLog.js";

const router = Router();

// ── Rate limiters ─────────────────────────────────────────────────────────────
// Read operations — 60 req / 15 menit per buyer
const readLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak permintaan. Coba lagi dalam 15 menit." },
  keyGenerator: (req) => {
    const pid = (req as PortalAuthReq).portalCustomerId;
    return `mkt-portal-read:${pid ?? ipKeyGenerator(req.ip ?? "unknown")}`;
  },
});

// Write operations — 20 req / 15 menit per buyer
const writeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak permintaan write. Coba lagi dalam 15 menit." },
  keyGenerator: (req) => {
    const pid = (req as PortalAuthReq).portalCustomerId;
    return `mkt-portal-write:${pid ?? ipKeyGenerator(req.ip ?? "unknown")}`;
  },
});

// Vendor selection — 10 req / 15 menit per buyer (lebih ketat dari write biasa)
const selectLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: "RATE_LIMIT", message: "Terlalu banyak permintaan vendor selection. Coba lagi dalam 15 menit." },
  keyGenerator: (req) => {
    const pid = (req as PortalAuthReq).portalCustomerId;
    return `mkt-portal-select:${pid ?? ipKeyGenerator(req.ip ?? "unknown")}`;
  },
});

// ── Zod input schemas ─────────────────────────────────────────────────────────
const CancelBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

const RejectBodySchema = z.object({
  notes: z.string().min(1, "Catatan penolakan wajib diisi").max(1000),
});

const CustomerRejectBodySchema = z.object({
  reason: z.string().max(500).optional(),
});

const ApproveBodySchema = z.object({
  notes: z.string().max(1000).optional(),
});

// Sprint 2 — vendor selection & customer review
const SelectVendorBodySchema = z.object({
  quoteId: z.number().int().positive(),
});

const SendToCustomerReviewBodySchema = z.object({
  notes: z.string().max(1000).optional(),
});

// Sprint 3 — customer approval (notes opsional, strip identity fields via Zod)
const CustomerApproveBodySchema = z.object({
  notes: z.string().max(1000).optional(),
});

// ── All routes require portal buyer/approver auth ─────────────────────────────
router.use(requirePortalAuth);

// ── GET /api/mkt/portal/rfqs ─────────────────────────────────────────────────
// Daftar semua RFQ milik buyer yang sedang login.
// Query params: limit (default 50, max 200), offset (default 0)

router.get("/rfqs", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);

  try {
    const rfqs = await getBuyerRfqs(portalCustomerId, limit, offset);
    return res.json({ ok: true, data: rfqs, count: rfqs.length });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId }, "[mktPortal] getBuyerRfqs error");
    return res.status(500).json({ ok: false, error: "Gagal memuat daftar RFQ" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/submit ──────────────────────────────────────
// Buyer mengajukan draft RFQ untuk diproses.
// Jika approval_level >= 2: status → draft, approval_status → pending
// Jika approval_level <= 1: langsung submitted (self-approve)
// Response 200: { ok: true, data: { rfqStatus, approvalStatus, needsApproval } }

router.post("/rfqs/:id/submit", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const result = await submitRfqForApproval(rfqId, portalCustomerId);

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      RFQ_NOT_FOUND:    404,
      NOT_OWNER:        403,
      WRONG_STATUS:     422,
      ALREADY_RESOLVED: 409,
      DB_ERROR:         500,
    };
    return res.status(statusMap[result.code] ?? 500).json({ ok: false, error: result.message });
  }

  // Enqueue notification ke approver jika butuh approval
  if (result.needsApproval) {
    enqueueNotification({
      eventType:     "mkt_rfq_approval_requested",
      recipientType: "approver",
      rfqId,
      payloadJson: {
        rfqId,
        rfqStatus:      result.rfqStatus,
        approvalStatus: result.approvalStatus,
        requestedBy:    portalCustomerId,
      },
    }).catch((err: unknown) => {
      logger.error({ err, rfqId }, "[mktPortal] enqueue mkt_rfq_approval_requested failed");
    });
  }

  logger.info({ rfqId, portalCustomerId, ...result }, "[mktPortal] submitRfqForApproval success");
  return res.json({
    ok: true,
    data: {
      rfqStatus:      result.rfqStatus,
      approvalStatus: result.approvalStatus,
      needsApproval:  result.needsApproval,
    },
  });
});

// ── POST /api/mkt/portal/rfqs/:id/cancel ─────────────────────────────────────
// Buyer membatalkan RFQ (hanya draft atau submitted).
// Body (optional): { reason: string }
// Response 200: { ok: true, data: { rfqNumber } }

router.post("/rfqs/:id/cancel", writeLimiter, validateBody(CancelBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const { reason } = req.body as { reason?: string };

  const result = await cancelRfq(rfqId, portalCustomerId, reason);

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      RFQ_NOT_FOUND:    404,
      NOT_OWNER:        403,
      WRONG_STATUS:     422,
      DB_ERROR:         500,
    };
    return res.status(statusMap[result.code] ?? 500).json({ ok: false, error: result.message });
  }

  logger.info({ rfqId, portalCustomerId, rfqNumber: result.rfqNumber }, "[mktPortal] cancelRfq success");
  return res.json({ ok: true, data: { rfqNumber: result.rfqNumber } });
});

// ── GET /api/mkt/portal/rfqs/pending-approvals ────────────────────────────────
// Daftar RFQ yang menunggu approval dari saya (sebagai approver di company saya).
// Eligibility: active member di company RFQ dengan buyerRole IN (procurement, finance, admin)
// Response 200: { ok: true, data: ApprovalRfqSummary[], count: number }

router.get("/rfqs/pending-approvals", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;

  try {
    const rfqs = await getPendingApprovalsForMember(portalCustomerId);
    return res.json({ ok: true, data: rfqs, count: rfqs.length });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId }, "[mktPortal] getPendingApprovalsForMember error");
    return res.status(500).json({ ok: false, error: "Gagal memuat pending approvals" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/submit-for-approval ─────────────────────────
// Buyer mengajukan draft RFQ untuk diproses approval (atau self-approve jika level <= 1).

router.post("/rfqs/:id/submit-for-approval", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);

  if (!rfqId || isNaN(rfqId)) {
    return res.status(400).json({ ok: false, error: "rfqId tidak valid" });
  }

  try {
    const result = await submitRfqForApproval(rfqId, portalCustomerId);

    if (!result.ok) {
      const status =
        result.code === "RFQ_NOT_FOUND"      ? 404
        : result.code === "NOT_OWNER"        ? 403
        : result.code === "WRONG_STATUS"     ? 409
        : result.code === "ALREADY_RESOLVED" ? 409
        : 500;
      return res.status(status).json({ ok: false, code: result.code, error: result.message });
    }

    return res.json({
      ok: true,
      data: {
        rfqStatus:      result.rfqStatus,
        approvalStatus: result.approvalStatus,
        needsApproval:  result.needsApproval,
      },
      message: result.needsApproval
        ? "RFQ diajukan untuk approval — menunggu persetujuan"
        : "RFQ langsung disubmit (tidak memerlukan approval)",
    });
  } catch (err: unknown) {
    logger.warn({ err, rfqId, portalCustomerId }, "[mktPortal] submitRfqForApproval unexpected error");
    return res.status(500).json({ ok: false, error: "Gagal memproses submit for approval" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/approve ─────────────────────────────────────
// Approver menyetujui RFQ.
// Body (optional): { notes: string }
// Response 200: { ok: true, data: { rfqNumber, approvalId } }

router.post("/rfqs/:id/approve", writeLimiter, validateBody(ApproveBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const { notes } = req.body as { notes?: string };

  const result = await approveRfq(rfqId, portalCustomerId, notes);

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      RFQ_NOT_FOUND:         404,
      NOT_ELIGIBLE_APPROVER: 403,
      NO_COMPANY_MAPPING:    422,
      NO_PENDING_APPROVAL:   422,
      ALREADY_RESOLVED:      409,
      WRONG_STATUS:          422,
      DB_ERROR:              500,
    };
    return res.status(statusMap[result.code] ?? 500).json({ ok: false, error: result.message });
  }

  // Enqueue notification ke buyer
  enqueueNotification({
    eventType:     "mkt_rfq_approved",
    recipientType: "buyer",
    rfqId,
    payloadJson: {
      rfqId,
      rfqNumber:  result.rfqNumber,
      approvalId: result.approvalId,
      approvedBy: portalCustomerId,
      notes:      notes ?? null,
    },
  }).catch((err: unknown) => {
    logger.error({ err, rfqId }, "[mktPortal] enqueue mkt_rfq_approved failed");
  });

  logger.info(
    { rfqId, portalCustomerId, rfqNumber: result.rfqNumber, approvalId: result.approvalId },
    "[mktPortal] approveRfq success",
  );
  return res.json({ ok: true, data: { rfqNumber: result.rfqNumber, approvalId: result.approvalId } });
});

// ── POST /api/mkt/portal/rfqs/:id/reject ─────────────────────────────────────
// Approver menolak RFQ. notes (alasan) wajib diisi.
// Body: { notes: string }
// Response 200: { ok: true, data: { rfqNumber, approvalId } }

router.post("/rfqs/:id/reject", writeLimiter, validateBody(RejectBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const { notes } = req.body as { notes: string };

  const result = await rejectRfq(rfqId, portalCustomerId, notes);

  if (!result.ok) {
    const statusMap: Record<string, number> = {
      RFQ_NOT_FOUND:         404,
      NOT_ELIGIBLE_APPROVER: 403,
      NO_COMPANY_MAPPING:    422,
      NO_PENDING_APPROVAL:   422,
      ALREADY_RESOLVED:      409,
      WRONG_STATUS:          422,
      DB_ERROR:              500,
    };
    return res.status(statusMap[result.code] ?? 500).json({ ok: false, error: result.message });
  }

  // Enqueue notification ke buyer
  enqueueNotification({
    eventType:     "mkt_rfq_rejected",
    recipientType: "buyer",
    rfqId,
    payloadJson: {
      rfqId,
      rfqNumber:  result.rfqNumber,
      approvalId: result.approvalId,
      rejectedBy: portalCustomerId,
      notes,
    },
  }).catch((err: unknown) => {
    logger.error({ err, rfqId }, "[mktPortal] enqueue mkt_rfq_rejected failed");
  });

  logger.info(
    { rfqId, portalCustomerId, rfqNumber: result.rfqNumber, approvalId: result.approvalId },
    "[mktPortal] rejectRfq success",
  );
  return res.json({ ok: true, data: { rfqNumber: result.rfqNumber, approvalId: result.approvalId } });
});

// ══════════════════════════════════════════════════════════════════════════════
// Phase 2G Batch 5 — Buyer Purchase Order READ endpoints
// Blocker: semua admin PO endpoint require requireAdmin (BizPortal session).
// Portal buyer TIDAK boleh melihat: commission, margin, target price, ranking,
// vendor score, internal notes, hidden score.
// ══════════════════════════════════════════════════════════════════════════════

// ── GET /api/mkt/portal/purchase-orders ──────────────────────────────────────
// Daftar PO milik buyer yang login (scoped via rfq.portal_customer_id).
router.get("/purchase-orders", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const limit  = Math.min(Number(req.query["limit"]  ?? 50), 200);
  const offset = Number(req.query["offset"] ?? 0);
  const status = (req.query["status"] as string | undefined) || undefined;
  const search = ((req.query["search"] as string | undefined) ?? "").trim() || undefined;

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable, suppliersTable } = await import("@workspace/db");
    const { eq, and, desc, ilike, or } = await import("drizzle-orm");

    const joinCond = and(
      eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
      eq(mktRfqsTable.portalCustomerId, portalCustomerId),
    );

    const wheres: ReturnType<typeof eq>[] = [];
    if (status) wheres.push(eq(mktPurchaseOrdersTable.status, status as any));
    if (search) wheres.push(or(
      ilike(mktPurchaseOrdersTable.poNumber, `%${search}%`),
      ilike(suppliersTable.name, `%${search}%`),
      ilike(mktRfqsTable.rfqNumber, `%${search}%`),
    ) as any);

    const rows = await db
      .select({
        id:                  mktPurchaseOrdersTable.id,
        poNumber:            mktPurchaseOrdersTable.poNumber,
        rfqId:               mktPurchaseOrdersTable.rfqId,
        status:              mktPurchaseOrdersTable.status,
        grandTotal:          mktPurchaseOrdersTable.grandTotal,
        currencySnapshot:    mktPurchaseOrdersTable.currencySnapshot,
        createdAt:           mktPurchaseOrdersTable.createdAt,
        confirmedAt:         mktPurchaseOrdersTable.confirmedAt,
        leadTimeDaysSnapshot: mktPurchaseOrdersTable.leadTimeDaysSnapshot,
        quotationDateSnapshot: mktPurchaseOrdersTable.quotationDateSnapshot,
        vendorNameSnapshot:  mktPurchaseOrdersTable.vendorNameSnapshot,
        rfqNumber:           mktRfqsTable.rfqNumber,
        vendorName:          suppliersTable.name,
      })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, joinCond)
      .leftJoin(suppliersTable, eq(mktPurchaseOrdersTable.vendorId, suppliersTable.id))
      .where(wheres.length > 0 ? and(...wheres as [ReturnType<typeof eq>, ...ReturnType<typeof eq>[]]) : undefined)
      .orderBy(desc(mktPurchaseOrdersTable.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({ ok: true, data: rows, count: rows.length });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId }, "[mktPortal] getBuyerPurchaseOrders error");
    return res.status(500).json({ ok: false, error: "Gagal memuat purchase orders" });
  }
});

// ── GET /api/mkt/portal/purchase-orders/:id ──────────────────────────────────
router.get("/purchase-orders/:id", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0)
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable, suppliersTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");

    const [po] = await db
      .select({
        id:              mktPurchaseOrdersTable.id,
        poNumber:        mktPurchaseOrdersTable.poNumber,
        rfqId:           mktPurchaseOrdersTable.rfqId,
        quoteId:         mktPurchaseOrdersTable.quoteId,
        status:          mktPurchaseOrdersTable.status,
        grandTotal:      mktPurchaseOrdersTable.grandTotal,
        taxAmount:       mktPurchaseOrdersTable.taxAmount,
        totalAmount:     mktPurchaseOrdersTable.totalAmount,
        createdAt:       mktPurchaseOrdersTable.createdAt,
        confirmedAt:     mktPurchaseOrdersTable.confirmedAt,
        cancelledAt:     mktPurchaseOrdersTable.cancelledAt,
        cancelReason:    mktPurchaseOrdersTable.cancelReason,
        updatedAt:       mktPurchaseOrdersTable.updatedAt,
        // Snapshot immutable — buyer-safe, NO margin/commission/targetPrice
        vendorNameSnapshot:      mktPurchaseOrdersTable.vendorNameSnapshot,
        vendorAddressSnapshot:   mktPurchaseOrdersTable.vendorAddressSnapshot,
        paymentTermsSnapshot:    mktPurchaseOrdersTable.paymentTermsSnapshot,
        incotermSnapshot:        mktPurchaseOrdersTable.incotermSnapshot,
        quotationNumberSnapshot: mktPurchaseOrdersTable.quotationNumberSnapshot,
        quotationDateSnapshot:   mktPurchaseOrdersTable.quotationDateSnapshot,
        currencySnapshot:        mktPurchaseOrdersTable.currencySnapshot,
        leadTimeDaysSnapshot:    mktPurchaseOrdersTable.leadTimeDaysSnapshot,
        // RFQ — buyer-visible fields only
        rfqNumber:  mktRfqsTable.rfqNumber,
        rfqStatus:  mktRfqsTable.status,
        buyerName:  mktRfqsTable.buyerName,
        buyerEmail: mktRfqsTable.buyerEmail,
        rfqNotes:   mktRfqsTable.notes,
        // Vendor — safe fields only (no score/ranking/internal)
        vendorName:  suppliersTable.name,
        vendorPhone: suppliersTable.phone,
        vendorEmail: suppliersTable.contactEmail,
      })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, and(
        eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId), // ownership gate
      ))
      .leftJoin(suppliersTable, eq(mktPurchaseOrdersTable.vendorId, suppliersTable.id))
      .where(eq(mktPurchaseOrdersTable.id, poId))
      .limit(1);

    if (!po) return res.status(404).json({ ok: false, error: "Purchase order tidak ditemukan" });
    return res.json({ ok: true, data: po });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, poId }, "[mktPortal] getBuyerPoDetail error");
    return res.status(500).json({ ok: false, error: "Gagal memuat purchase order" });
  }
});

// ── GET /api/mkt/portal/purchase-orders/:id/items ────────────────────────────
router.get("/purchase-orders/:id/items", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0)
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    const { listPoLines } = await import("../lib/services/mktPoLinesService.js");

    // Ownership gate: PO harus milik buyer ini (via RFQ → portalCustomerId)
    const [own] = await db
      .select({ id: mktPurchaseOrdersTable.id })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, and(
        eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .where(eq(mktPurchaseOrdersTable.id, poId))
      .limit(1);

    if (!own) return res.status(404).json({ ok: false, error: "Purchase order tidak ditemukan" });

    const lines = await listPoLines(poId);
    return res.json({ ok: true, count: lines.length, data: lines });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, poId }, "[mktPortal] getBuyerPoItems error");
    return res.status(500).json({ ok: false, error: "Gagal memuat PO items" });
  }
});

// ── GET /api/mkt/portal/purchase-orders/:id/shipments ────────────────────────
router.get("/purchase-orders/:id/shipments", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const poId = Number(req.params["id"]);
  if (!Number.isInteger(poId) || poId <= 0)
    return res.status(400).json({ ok: false, error: "id harus berupa integer positif" });

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    const { listShipmentsForPo } = await import("../lib/services/mktPoShipmentService.js");

    const [own] = await db
      .select({ id: mktPurchaseOrdersTable.id })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, and(
        eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .where(eq(mktPurchaseOrdersTable.id, poId))
      .limit(1);

    if (!own) return res.status(404).json({ ok: false, error: "Purchase order tidak ditemukan" });

    const shipments = await listShipmentsForPo(poId);
    return res.json({ ok: true, data: shipments });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, poId }, "[mktPortal] getBuyerPoShipments error");
    return res.status(500).json({ ok: false, error: "Gagal memuat shipments" });
  }
});

// ── GET /api/mkt/portal/shipments/:shipmentId/timeline ───────────────────────
router.get("/shipments/:shipmentId/timeline", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0)
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    const { getShipmentById, listShipmentTimeline } = await import("../lib/services/mktPoShipmentService.js");

    const shipment = await getShipmentById(shipmentId);
    if (!shipment) return res.status(404).json({ ok: false, error: "Shipment tidak ditemukan" });

    // Ownership: shipment.poId → PO → RFQ → portalCustomerId
    const [own] = await db
      .select({ id: mktPurchaseOrdersTable.id })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, and(
        eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .where(eq(mktPurchaseOrdersTable.id, (shipment as any).poId ?? (shipment as any).po_id ?? -1))
      .limit(1);

    if (!own) return res.status(404).json({ ok: false, error: "Shipment tidak ditemukan" });

    const timeline = await listShipmentTimeline(shipmentId);
    return res.json({ ok: true, data: timeline });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, shipmentId }, "[mktPortal] getBuyerShipmentTimeline error");
    return res.status(500).json({ ok: false, error: "Gagal memuat timeline" });
  }
});

// ── GET /api/mkt/portal/shipments/:shipmentId/goods-receipts ─────────────────
// Read-only. Buyer goods receipt CREATION = GAP (backend belum tersedia).
router.get("/shipments/:shipmentId/goods-receipts", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const shipmentId = Number(req.params["shipmentId"]);
  if (!Number.isInteger(shipmentId) || shipmentId <= 0)
    return res.status(400).json({ ok: false, error: "shipmentId harus berupa integer positif" });

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable } = await import("@workspace/db");
    const { and, eq } = await import("drizzle-orm");
    const { getShipmentById } = await import("../lib/services/mktPoShipmentService.js");
    const { listGoodsReceiptsForShipment } = await import("../lib/services/mktPoGoodsReceiptService.js");

    const shipment = await getShipmentById(shipmentId);
    if (!shipment) return res.status(404).json({ ok: false, error: "Shipment tidak ditemukan" });

    const [own] = await db
      .select({ id: mktPurchaseOrdersTable.id })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, and(
        eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .where(eq(mktPurchaseOrdersTable.id, (shipment as any).poId ?? (shipment as any).po_id ?? -1))
      .limit(1);

    if (!own) return res.status(404).json({ ok: false, error: "Shipment tidak ditemukan" });

    const receipts = await listGoodsReceiptsForShipment(shipmentId);
    return res.json({ ok: true, data: receipts });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, shipmentId }, "[mktPortal] getBuyerGoodsReceipts error");
    return res.status(500).json({ ok: false, error: "Gagal memuat goods receipts" });
  }
});

// ── Boot migration: customer_review flow ─────────────────────────────────────
// Runs once at module load — adds enum value + column if missing.
// ALTER TYPE ... ADD VALUE cannot run inside a transaction (PG limitation).
;(async () => {
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    await db.execute(sql.raw(`ALTER TYPE mkt_rfq_status ADD VALUE IF NOT EXISTS 'customer_review'`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE mkt_rfqs ADD COLUMN IF NOT EXISTS proposed_quote_id INTEGER`)).catch(() => {});
  } catch { /* ignore — DB not ready yet, will retry on next restart */ }
})();

// ── GET /api/mkt/portal/rfqs/:id ─────────────────────────────────────────────
// RFQ detail untuk buyer. Termasuk proposed_quote_id jika status customer_review.
router.get("/rfqs/:id", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  try {
    const { db, mktRfqApprovalsTable } = await import("@workspace/db");
    const { eq, desc, sql } = await import("drizzle-orm");

    // Use raw SQL to include proposed_quote_id (not in Drizzle schema yet)
    const rfqRows = await db.execute(sql`
      SELECT id, rfq_number, status, approval_status,
             approval_requested_at, approval_resolved_at,
             buyer_name, buyer_email, buyer_company, buyer_approval_level,
             notes, required_delivery_date, delivery_address,
             created_at, updated_at, winner_selected_at,
             winning_quote_id, proposed_quote_id
      FROM mkt_rfqs
      WHERE id = ${rfqId} AND portal_customer_id = ${portalCustomerId}
      LIMIT 1
    `);

    const rfq = ((rfqRows as any).rows ?? rfqRows)[0] as Record<string, unknown> | undefined;
    if (!rfq) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });

    // Latest approval record (for rejection reason, pending status, etc.)
    const [approval] = await db
      .select({
        id:            mktRfqApprovalsTable.id,
        approverLevel: mktRfqApprovalsTable.approverLevel,
        status:        mktRfqApprovalsTable.status,
        requestedAt:   mktRfqApprovalsTable.requestedAt,
        responseNotes: mktRfqApprovalsTable.responseNotes,
      })
      .from(mktRfqApprovalsTable)
      .where(eq(mktRfqApprovalsTable.rfqId, rfqId))
      .orderBy(desc(mktRfqApprovalsTable.requestedAt))
      .limit(1);

    return res.json({ ok: true, data: { ...rfq, pendingApproval: approval ?? null } });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] getRfqDetail error");
    return res.status(500).json({ ok: false, error: "Gagal memuat detail RFQ" });
  }
});

// ── GET /api/mkt/portal/rfqs/:id/lines ───────────────────────────────────────
// Buyer melihat line items dari RFQ miliknya.
// Ownership diverifikasi dari session — bukan dari query/params/body.
// Field internal (targetPricePerUnit, vendorCatalogItemId) tidak di-expose.
router.get("/rfqs/:id/lines", readLimiter, async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  try {
    const { db, mktRfqsTable, mktRfqLinesTable } = await import("@workspace/db");
    const { eq, and, asc } = await import("drizzle-orm");

    // 1. Verify ownership — portalCustomerId dari session (PortalAuthReq)
    const [rfq] = await db
      .select({ id: mktRfqsTable.id })
      .from(mktRfqsTable)
      .where(and(
        eq(mktRfqsTable.id, rfqId),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .limit(1);

    // 404 generic — tidak membedakan "tidak ada" vs "milik orang lain"
    if (!rfq) {
      return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });
    }

    // 2. Ambil lines — hanya field buyer-safe, diurutkan sort_order ASC
    const lines = await db
      .select({
        id:              mktRfqLinesTable.id,
        itemName:        mktRfqLinesTable.itemName,
        itemDescription: mktRfqLinesTable.itemDescription,
        itemUnit:        mktRfqLinesTable.itemUnit,
        requestedQty:    mktRfqLinesTable.requestedQty,
        notes:           mktRfqLinesTable.notes,
        sortOrder:       mktRfqLinesTable.sortOrder,
      })
      .from(mktRfqLinesTable)
      .where(eq(mktRfqLinesTable.rfqId, rfqId))
      .orderBy(asc(mktRfqLinesTable.sortOrder));

    return res.json({ ok: true, rfqId, count: lines.length, data: lines });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] getRfqLines error");
    return res.status(500).json({ ok: false, error: "Gagal memuat lines RFQ" });
  }
});

// ── GET /api/mkt/portal/rfqs/:id/quotation ───────────────────────────────────
// Buyer-safe quotation view. Hanya tersedia saat status = customer_review.
// Tidak mengekspos: commission, rank, token, internal price.
router.get("/rfqs/:id/quotation", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  try {
    const {
      db,
      mktVendorQuotesTable, mktVendorQuoteLinesTable, mktRfqLinesTable, suppliersTable,
    } = await import("@workspace/db");
    const { eq, sql } = await import("drizzle-orm");

    // Verify ownership and get proposed_quote_id
    const rfqRows = await db.execute(sql`
      SELECT id, status, proposed_quote_id
      FROM mkt_rfqs
      WHERE id = ${rfqId} AND portal_customer_id = ${portalCustomerId}
      LIMIT 1
    `);
    const rfq = ((rfqRows as any).rows ?? rfqRows)[0] as Record<string, unknown> | undefined;
    if (!rfq) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });

    const proposedQuoteId = rfq["proposed_quote_id"] as number | null;
    if (!proposedQuoteId) {
      return res.status(404).json({ ok: false, error: "Belum ada quotation yang dikirim admin" });
    }

    // Fetch vendor quote — buyer-safe fields only (no commission/rank/token)
    const [quote] = await db
      .select({
        id:               mktVendorQuotesTable.id,
        status:           mktVendorQuotesTable.status,
        quotationNumber:  mktVendorQuotesTable.quotationNumber,
        quotationDate:    mktVendorQuotesTable.quotationDate,
        paymentTerms:     mktVendorQuotesTable.paymentTerms,
        incoterm:         mktVendorQuotesTable.incoterm,
        deliveryLocation: mktVendorQuotesTable.deliveryLocation,
        notes:            mktVendorQuotesTable.notes,
        submittedAt:      mktVendorQuotesTable.submittedAt,
        vendorName:       suppliersTable.name,
        vendorPhone:      suppliersTable.phone,
        vendorEmail:      suppliersTable.contactEmail,
      })
      .from(mktVendorQuotesTable)
      .innerJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
      .where(eq(mktVendorQuotesTable.id, proposedQuoteId))
      .limit(1);

    if (!quote) return res.status(404).json({ ok: false, error: "Quotation tidak ditemukan" });

    // Lines — with rfq item names for context
    const lines = await db
      .select({
        rfqLineId:        mktVendorQuoteLinesTable.rfqLineId,
        itemName:         mktRfqLinesTable.itemName,
        requestedQty:     mktRfqLinesTable.requestedQty,
        offeredUnitPrice: mktVendorQuoteLinesTable.offeredUnitPrice,
        offeredQty:       mktVendorQuoteLinesTable.offeredQty,
        subtotal:         mktVendorQuoteLinesTable.subtotal,
        currency:         mktVendorQuoteLinesTable.currency,
        leadTimeDays:     mktVendorQuoteLinesTable.leadTimeDays,
        stockStatus:      mktVendorQuoteLinesTable.stockStatus,
        notes:            mktVendorQuoteLinesTable.notes,
      })
      .from(mktVendorQuoteLinesTable)
      .leftJoin(mktRfqLinesTable, eq(mktVendorQuoteLinesTable.rfqLineId, mktRfqLinesTable.id))
      .where(eq(mktVendorQuoteLinesTable.quoteId, proposedQuoteId));

    const grandTotal = lines.reduce((s, l) => s + Number(l.subtotal ?? 0), 0);

    return res.json({ ok: true, data: { ...quote, lines, grandTotal } });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] getCustomerQuotation error");
    return res.status(500).json({ ok: false, error: "Gagal memuat quotation" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/customer-approve ───────────────────────────
// Customer menyetujui quotation → PO dibuat otomatis via selectVendorAndCreatePo.
router.post("/rfqs/:id/customer-approve", writeLimiter, validateBody(CustomerApproveBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const { selectVendorAndCreatePo } = await import("../lib/services/vendorSelectionService.js");

    // Verify ownership, status, and proposed_quote_id
    const rfqRows = await db.execute(sql`
      SELECT id, status, proposed_quote_id, buyer_name, buyer_phone, rfq_number
      FROM mkt_rfqs
      WHERE id = ${rfqId} AND portal_customer_id = ${portalCustomerId}
      LIMIT 1
    `);
    const rfq = ((rfqRows as any).rows ?? rfqRows)[0] as Record<string, unknown> | undefined;
    if (!rfq) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });

    if (rfq["status"] !== "customer_review") {
      return res.status(422).json({
        ok: false,
        error: `RFQ tidak dalam status customer_review (current: ${rfq["status"]})`,
      });
    }

    const proposedQuoteId = rfq["proposed_quote_id"] as number | null;
    if (!proposedQuoteId) {
      return res.status(422).json({ ok: false, error: "Belum ada quotation yang diusulkan" });
    }

    // Trigger PO creation — buyer is the approver in this flow
    const result = await selectVendorAndCreatePo({
      rfqId,
      quoteId:   proposedQuoteId,
      adminId:   `portal:${portalCustomerId}`,
      adminName: String(rfq["buyer_name"] ?? "Customer Portal"),
      notes:     "Disetujui oleh buyer melalui Customer Portal",
    });

    if (!result.ok) {
      if (result.code === "RFQ_ALREADY_AWARDED") {
        // Idempotency: RFQ sudah pernah di-award — kembalikan PO yang sudah ada
        try {
          const { db: idempDb, mktPurchaseOrdersTable: potbl } = await import("@workspace/db");
          const { eq: idempEq } = await import("drizzle-orm");
          const [existingPo] = await idempDb
            .select({ id: potbl.id, poNumber: potbl.poNumber, vendorNameSnapshot: potbl.vendorNameSnapshot })
            .from(potbl)
            .where(idempEq(potbl.rfqId, rfqId))
            .limit(1);
          if (existingPo) {
            return res.json({
              ok: true,
              data: {
                poId:           existingPo.id,
                poNumber:       existingPo.poNumber,
                vendorName:     existingPo.vendorNameSnapshot ?? null,
                alreadyApproved: true,
              },
            });
          }
        } catch { /* non-fatal — fall through to 409 */ }
        return res.status(409).json({ ok: false, error: result.message });
      }
      return res.status(500).json({ ok: false, error: result.message });
    }

    // WA to buyer — recipientPhone was previously omitted, so the row always
    // ended up with no phone number and the notification never sent.
    enqueueNotification({
      eventType:     "mkt_rfq_approved" as any,
      recipientType: "buyer",
      recipientPhone: rfq["buyer_phone"] ? String(rfq["buyer_phone"]) : null,
      rfqId,
      payloadJson: {
        rfqId,
        rfqNumber:        rfq["rfq_number"],
        approvedByPortal: true,
        portalCustomerId,
        poId:     result.poId,
        poNumber: result.poNumber,
      },
    }).catch(() => {});

    // In-app admin notification (admin_notifications + SSE) — was missing entirely.
    void NotificationService.saveAndBroadcast("admin_notification", {
      type:         "mkt_rfq_customer_approved",
      orderNumber:  String(rfq["rfq_number"] ?? rfqId),
      customerName: String(rfq["buyer_name"] ?? "Customer"),
      title:        "Quotation Disetujui Customer",
      body:         `Customer menyetujui quotation untuk RFQ ${rfq["rfq_number"]}. PO ${result.poNumber} telah dibuat.`,
      targetRole:   "admin",
      rfqId,
      poId:         result.poId,
      poNumber:     result.poNumber,
    });

    // Fire-and-forget: activity log untuk customer approval (distinct dari admin mkt_vendor_selected)
    void logActivity({
      mktRfqId:           rfqId,
      mktVendorQuoteId:   proposedQuoteId,
      mktPurchaseOrderId: result.poId,
      actorType:          "customer",
      actorId:            `portal:${portalCustomerId}`,
      actorName:          String(rfq["buyer_name"] ?? "Customer Portal"),
      action:             "mkt_customer_approved",
      description:        `Customer menyetujui quotation RFQ ${rfq["rfq_number"]} → PO ${result.poNumber} dibuat`,
      newValue:           { rfqId, poId: result.poId, poNumber: result.poNumber, portalCustomerId },
    }).catch(() => {});

    logger.info({ rfqId, portalCustomerId, poId: result.poId }, "[mktPortal] customerApprove → PO created");
    return res.json({
      ok: true,
      data: { poId: result.poId, poNumber: result.poNumber, vendorName: result.vendorName },
    });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] customerApprove error");
    return res.status(500).json({ ok: false, error: "Gagal memproses persetujuan" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/customer-reject ────────────────────────────
// Customer menolak quotation → RFQ kembali ke 'quoted', admin perlu re-evaluasi.
// C4-REMEDIATION: transition sekarang melalui canonical rejectCustomerQuotation service.
router.post("/rfqs/:id/customer-reject", writeLimiter, validateBody(CustomerRejectBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  const { reason: rawReason } = req.body as { reason?: string };
  const reason = rawReason?.trim() || "Ditolak oleh buyer";

  // ── Canonical transition via service (C4-REMEDIATION) ──────────────────────
  const result = await rejectCustomerQuotation({ rfqId, portalCustomerId, reason });

  if (!result.ok) {
    if (result.code === "RFQ_NOT_FOUND" || result.code === "NOT_OWNER")
      return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });
    if (result.code === "WRONG_STATUS")
      return res.status(422).json({ ok: false, error: result.message });
    return res.status(500).json({ ok: false, error: "Gagal memproses penolakan" });
  }

  // ── Side effects: notification (non-fatal) ────────────────────────────────
  // Load buyer_name and buyer_phone for notifications (not returned by service).
  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");
    const rows = await db.execute(sql`
      SELECT buyer_name, buyer_phone FROM mkt_rfqs WHERE id = ${rfqId} LIMIT 1
    `);
    const rfq = ((rows as any).rows ?? rows)[0] as Record<string, unknown> | undefined;

    enqueueNotification({
      eventType:      "mkt_rfq_rejected" as any,
      recipientType:  "buyer",
      recipientPhone: rfq?.["buyer_phone"] ? String(rfq["buyer_phone"]) : null,
      rfqId,
      payloadJson: {
        rfqId,
        rfqNumber:        result.rfqNumber,
        rejectedByPortal: true,
        portalCustomerId,
        rejectionNotes:   reason,
      },
    }).catch(() => {});

    void NotificationService.saveAndBroadcast("admin_notification", {
      type:         "mkt_rfq_customer_rejected",
      orderNumber:  result.rfqNumber,
      customerName: String(rfq?.["buyer_name"] ?? "Customer"),
      title:        "Quotation Ditolak Customer",
      body:         `Customer menolak quotation untuk RFQ ${result.rfqNumber}. Alasan: ${reason}`,
      targetRole:   "admin",
      rfqId,
      reason,
    });
  } catch (notifErr) {
    logger.warn({ notifErr, rfqId }, "[mktPortal] customerReject notification failed (non-fatal)");
  }

  return res.json({ ok: true, data: { rfqNumber: result.rfqNumber, status: "quoted", reason } });
});

// ── GET /api/mkt/portal/rfqs/:id/purchase-order ──────────────────────────────
// Cari PO yang terhubung ke RFQ ini (scoped ke buyer yang login).
router.get("/rfqs/:id/purchase-order", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  try {
    const { db, mktPurchaseOrdersTable, mktRfqsTable } = await import("@workspace/db");
    const { eq, and } = await import("drizzle-orm");

    const [po] = await db
      .select({
        id:       mktPurchaseOrdersTable.id,
        poNumber: mktPurchaseOrdersTable.poNumber,
        status:   mktPurchaseOrdersTable.status,
      })
      .from(mktPurchaseOrdersTable)
      .innerJoin(mktRfqsTable, and(
        eq(mktPurchaseOrdersTable.rfqId, mktRfqsTable.id),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .where(eq(mktPurchaseOrdersTable.rfqId, rfqId))
      .limit(1);

    if (!po) return res.status(404).json({ ok: false, error: "PO belum tersedia untuk RFQ ini" });
    return res.json({ ok: true, data: po });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] getRfqPurchaseOrder error");
    return res.status(500).json({ ok: false, error: "Gagal memuat PO" });
  }
});

// ── GET /api/mkt/portal/rfqs/:id/quotes ──────────────────────────────────────
// Buyer melihat semua quotation vendor untuk RFQ ini (comparison view).
// Buyer-safe: tidak mengekspos token, commission_*, rank_score, attachment_url (raw).
// Hanya menampilkan quotes yang sudah disubmit vendor (status != 'draft').
// Activity log: QUOTE_VIEWED (non-fatal, fire-and-forget).
router.get("/rfqs/:id/quotes", readLimiter, async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  try {
    const {
      db, mktRfqsTable, mktVendorQuotesTable, mktVendorQuoteLinesTable,
      mktRfqLinesTable, suppliersTable,
    } = await import("@workspace/db");
    const { eq, and, ne } = await import("drizzle-orm");

    // 1. Verifikasi ownership — portalCustomerId dari session
    const [rfq] = await db
      .select({ id: mktRfqsTable.id, status: mktRfqsTable.status })
      .from(mktRfqsTable)
      .where(and(
        eq(mktRfqsTable.id, rfqId),
        eq(mktRfqsTable.portalCustomerId, portalCustomerId),
      ))
      .limit(1);

    if (!rfq) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });

    // 2. Ambil semua quotes yang bukan draft — buyer-safe fields, no token/commission/rank
    const quotes = await db
      .select({
        id:               mktVendorQuotesTable.id,
        status:           mktVendorQuotesTable.status,
        quotationNumber:  mktVendorQuotesTable.quotationNumber,
        quotationDate:    mktVendorQuotesTable.quotationDate,
        paymentTerms:     mktVendorQuotesTable.paymentTerms,
        incoterm:         mktVendorQuotesTable.incoterm,
        deliveryLocation: mktVendorQuotesTable.deliveryLocation,
        notes:            mktVendorQuotesTable.notes,
        validUntil:       mktVendorQuotesTable.validUntil,
        submittedAt:      mktVendorQuotesTable.submittedAt,
        createdAt:        mktVendorQuotesTable.createdAt,
        updatedAt:        mktVendorQuotesTable.updatedAt,
        // Attachment — hanya nama dan ketersediaan, bukan URL langsung
        attachmentAvailable: mktVendorQuotesTable.attachmentFilename,
        attachmentName:      mktVendorQuotesTable.attachmentFilename,
        // Vendor info dari suppliers
        vendorId:    mktVendorQuotesTable.vendorId,
        vendorName:  suppliersTable.name,
        vendorPhone: suppliersTable.phone,
        vendorEmail: suppliersTable.contactEmail,
      })
      .from(mktVendorQuotesTable)
      .innerJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
      .where(and(
        eq(mktVendorQuotesTable.rfqId, rfqId),
      ));

    // 3. Ambil lines untuk setiap quote (buyer-safe — no commission/vendor_catalog_item_id)
    const quoteIds = quotes.map((q) => q.id);
    let allLines: Array<{
      quoteId: number;
      rfqLineId: number;
      itemName: string | null;
      requestedQty: string | null;
      offeredUnitPrice: string;
      offeredQty: string;
      subtotal: string;
      currency: string | null;
      minimumOrderQty: string | null;
      validUntil: string | null;
      leadTimeDays: number | null;
      stockStatus: string | null;
      notes: string | null;
    }> = [];

    if (quoteIds.length > 0) {
      const { inArray } = await import("drizzle-orm");
      allLines = await db
        .select({
          quoteId:          mktVendorQuoteLinesTable.quoteId,
          rfqLineId:        mktVendorQuoteLinesTable.rfqLineId,
          itemName:         mktRfqLinesTable.itemName,
          requestedQty:     mktRfqLinesTable.requestedQty,
          offeredUnitPrice: mktVendorQuoteLinesTable.offeredUnitPrice,
          offeredQty:       mktVendorQuoteLinesTable.offeredQty,
          subtotal:         mktVendorQuoteLinesTable.subtotal,
          currency:         mktVendorQuoteLinesTable.currency,
          minimumOrderQty:  mktVendorQuoteLinesTable.minimumOrderQty,
          validUntil:       mktVendorQuoteLinesTable.validUntil,
          leadTimeDays:     mktVendorQuoteLinesTable.leadTimeDays,
          stockStatus:      mktVendorQuoteLinesTable.stockStatus,
          notes:            mktVendorQuoteLinesTable.notes,
        })
        .from(mktVendorQuoteLinesTable)
        .leftJoin(mktRfqLinesTable, eq(mktVendorQuoteLinesTable.rfqLineId, mktRfqLinesTable.id))
        .where(inArray(mktVendorQuoteLinesTable.quoteId, quoteIds));
    }

    // 4. Gabungkan lines ke dalam masing-masing quote
    const linesByQuote = new Map<number, typeof allLines>();
    for (const line of allLines) {
      const arr = linesByQuote.get(line.quoteId) ?? [];
      arr.push(line);
      linesByQuote.set(line.quoteId, arr);
    }

    const data = quotes.map((q) => {
      const lines = linesByQuote.get(q.id) ?? [];
      const totalAmount = lines.reduce((s, l) => s + Number(l.subtotal ?? 0), 0);
      return {
        id:               q.id,
        vendorId:         q.vendorId,
        vendorName:       q.vendorName,
        vendorPhone:      q.vendorPhone,
        vendorEmail:      q.vendorEmail,
        status:           q.status,
        quotationNumber:  q.quotationNumber,
        quotationDate:    q.quotationDate,
        paymentTerms:     q.paymentTerms,
        incoterm:         q.incoterm,
        deliveryLocation: q.deliveryLocation,
        notes:            q.notes,
        validUntil:       q.validUntil,
        attachmentAvailable: q.attachmentAvailable != null,
        attachmentName:   q.attachmentName,
        submittedAt:      q.submittedAt,
        createdAt:        q.createdAt,
        updatedAt:        q.updatedAt,
        totalAmount,
        lines,
      };
    });

    // Activity log — QUOTE_VIEWED (non-fatal)
    const { logActivity } = await import("../lib/activityLog.js");
    logActivity({
      action:      "QUOTE_VIEWED",
      description: `Buyer melihat ${data.length} quote untuk RFQ #${rfqId}`,
      mktRfqId:    rfqId,
      newValue:    { rfqId, quoteCount: data.length },
    }).catch(() => {});

    return res.json({ ok: true, rfqId, rfqStatus: rfq.status, count: data.length, data });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] getQuotes error");
    return res.status(500).json({ ok: false, error: "Gagal memuat daftar quotation" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/select-vendor ──────────────────────────────
// Buyer memilih vendor dari daftar quotation.
// Menyimpan proposed_quote_id di mkt_rfqs — belum membuat PO.
// Aturan:
//   - Ownership dari session (portalCustomerId)
//   - RFQ belum awarded / cancelled / customer_review (tidak boleh double-select)
//   - Quote harus dimiliki oleh RFQ ini dan status = 'submitted'
//   - Atomic: UPDATE mkt_rfqs ... RETURNING id
//   - Activity log: VENDOR_SELECTED
//   - Notification (non-fatal)
router.post("/rfqs/:id/select-vendor", selectLimiter, validateBody(SelectVendorBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  const { quoteId } = req.body as { quoteId: number };

  try {
    const { db, mktVendorQuotesTable, suppliersTable } = await import("@workspace/db");
    const { eq, and, sql } = await import("drizzle-orm");

    // 1. Verifikasi quote — harus milik RFQ ini dan status 'submitted'
    //    Sekaligus validasi tenant isolation: quote.rfq_id harus = rfqId
    const [quote] = await db
      .select({
        id:         mktVendorQuotesTable.id,
        status:     mktVendorQuotesTable.status,
        rfqId:      mktVendorQuotesTable.rfqId,
        vendorId:   mktVendorQuotesTable.vendorId,
        vendorName: suppliersTable.name,
      })
      .from(mktVendorQuotesTable)
      .innerJoin(suppliersTable, eq(mktVendorQuotesTable.vendorId, suppliersTable.id))
      .where(and(
        eq(mktVendorQuotesTable.id, quoteId),
        eq(mktVendorQuotesTable.rfqId, rfqId),
      ))
      .limit(1);

    if (!quote) return res.status(404).json({ ok: false, error: "Quotation tidak ditemukan untuk RFQ ini" });
    if (quote.status !== "submitted") {
      return res.status(422).json({
        ok: false,
        error: `Hanya quotation dengan status 'submitted' yang dapat dipilih (current: ${quote.status})`,
      });
    }

    // 2. Atomic UPDATE — hanya berhasil jika RFQ:
    //    - dimiliki buyer ini (portal_customer_id = $portalCustomerId)
    //    - belum di status akhir: awarded, cancelled, customer_review
    const updateRows = await db.execute(sql`
      UPDATE mkt_rfqs
      SET    proposed_quote_id   = ${quoteId},
             winner_selected_at  = NOW(),
             winner_selected_by  = ${"portal:" + portalCustomerId}
      WHERE  id                  = ${rfqId}
        AND  portal_customer_id  = ${portalCustomerId}
        AND  status NOT IN ('awarded', 'cancelled', 'customer_review')
      RETURNING id, status, rfq_number, buyer_name, buyer_phone
    `);
    const updated = (((updateRows as any).rows ?? updateRows) as Record<string, unknown>[])[0];

    if (!updated) {
      // Cek apakah karena status tidak valid atau bukan milik buyer
      const rfqRows = await db.execute(sql`
        SELECT status FROM mkt_rfqs
        WHERE id = ${rfqId} AND portal_customer_id = ${portalCustomerId}
        LIMIT 1
      `);
      const rfqCheck = (((rfqRows as any).rows ?? rfqRows) as Record<string, unknown>[])[0];
      if (!rfqCheck) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });
      const s = rfqCheck["status"];
      if (s === "customer_review")
        return res.status(409).json({ ok: false, error: "RFQ sudah dikirim ke customer review. Tidak dapat mengubah vendor pilihan." });
      if (s === "awarded")
        return res.status(409).json({ ok: false, error: "RFQ sudah di-award. Tidak dapat memilih ulang." });
      if (s === "cancelled")
        return res.status(409).json({ ok: false, error: "RFQ sudah dibatalkan." });
      return res.status(422).json({ ok: false, error: "Tidak dapat memilih vendor untuk RFQ ini" });
    }

    // 3. Activity log — VENDOR_SELECTED (non-fatal)
    const { logActivity } = await import("../lib/activityLog.js");
    logActivity({
      action:      "VENDOR_SELECTED",
      description: `Buyer memilih vendor ${quote.vendorName} (quoteId=${quoteId}) untuk RFQ #${rfqId}`,
      mktRfqId:    rfqId,
      newValue:    { rfqId, quoteId, vendorId: quote.vendorId, vendorName: quote.vendorName, selectedBy: `portal:${portalCustomerId}` },
    }).catch(() => {});

    // 4. Notification (non-fatal)
    enqueueNotification({
      eventType:     "mkt_vendor_selected" as any,
      recipientType: "buyer",
      recipientPhone: updated["buyer_phone"] ? String(updated["buyer_phone"]) : null,
      rfqId,
      payloadJson: {
        rfqId,
        rfqNumber:  String(updated["rfq_number"] ?? rfqId),
        quoteId,
        vendorId:   quote.vendorId,
        vendorName: quote.vendorName,
        selectedBy: `portal:${portalCustomerId}`,
      },
    }).catch(() => {});

    logger.info({ rfqId, portalCustomerId, quoteId, vendorId: quote.vendorId }, "[mktPortal] selectVendor success");
    return res.json({
      ok: true,
      data: {
        rfqId,
        rfqNumber:  String(updated["rfq_number"] ?? rfqId),
        quoteId,
        vendorId:   quote.vendorId,
        vendorName: quote.vendorName,
        selectedAt: updated["winner_selected_at"] ?? null,
        message:    "Vendor berhasil dipilih. Gunakan /send-to-customer-review untuk mengirim ke customer.",
      },
    });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId, quoteId }, "[mktPortal] selectVendor error");
    return res.status(500).json({ ok: false, error: "Gagal memilih vendor" });
  }
});

// ── POST /api/mkt/portal/rfqs/:id/send-to-customer-review ────────────────────
// Buyer mengirim vendor terpilih ke Customer untuk review/persetujuan.
// Prasyarat: proposed_quote_id sudah di-set via /select-vendor.
// Efek: mkt_rfqs.status → 'customer_review'.
// Aturan:
//   - Ownership dari session
//   - Harus sudah ada proposed_quote_id
//   - RFQ status harus 'quoted' (bukan customer_review / awarded / cancelled)
//   - Atomic transition via UPDATE ... RETURNING
//   - Activity log: CUSTOMER_REVIEW_SENT
//   - Notification (non-fatal)
router.post("/rfqs/:id/send-to-customer-review", writeLimiter, validateBody(SendToCustomerReviewBodySchema), async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  const { notes } = (req.body ?? {}) as { notes?: string };

  try {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");

    // Verifikasi kondisi sebelum update (untuk error message yang tepat)
    const preRows = await db.execute(sql`
      SELECT status, proposed_quote_id, rfq_number, buyer_name, buyer_phone
      FROM   mkt_rfqs
      WHERE  id = ${rfqId} AND portal_customer_id = ${portalCustomerId}
      LIMIT  1
    `);
    const pre = (((preRows as any).rows ?? preRows) as Record<string, unknown>[])[0];
    if (!pre) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });

    if (!pre["proposed_quote_id"])
      return res.status(422).json({ ok: false, error: "Pilih vendor terlebih dahulu sebelum mengirim ke customer review" });

    if (pre["status"] === "customer_review")
      return res.status(409).json({ ok: false, error: "RFQ sudah dalam status customer_review" });
    if (pre["status"] === "awarded")
      return res.status(409).json({ ok: false, error: "RFQ sudah di-award — tidak dapat diubah" });
    if (pre["status"] === "cancelled")
      return res.status(409).json({ ok: false, error: "RFQ sudah dibatalkan" });

    // Atomic transition: quoted → customer_review
    // Hanya berhasil jika status masih 'quoted' (bukan awarded/cancelled/customer_review)
    const updateRows = await db.execute(sql`
      UPDATE mkt_rfqs
      SET    status     = 'customer_review',
             updated_at = NOW()
      WHERE  id                 = ${rfqId}
        AND  portal_customer_id = ${portalCustomerId}
        AND  proposed_quote_id  IS NOT NULL
        AND  status NOT IN ('awarded', 'cancelled', 'customer_review')
      RETURNING id, status, rfq_number, proposed_quote_id, buyer_name, buyer_phone
    `);
    const updated = (((updateRows as any).rows ?? updateRows) as Record<string, unknown>[])[0];
    if (!updated)
      return res.status(422).json({ ok: false, error: "Tidak dapat mengirim ke customer review — periksa status RFQ" });

    // Activity log — CUSTOMER_REVIEW_SENT (non-fatal)
    const { logActivity } = await import("../lib/activityLog.js");
    logActivity({
      action:      "CUSTOMER_REVIEW_SENT",
      description: `RFQ #${rfqId} dikirim ke customer review dengan quoteId=${pre["proposed_quote_id"]}${notes ? ` — catatan: ${notes}` : ""}`,
      mktRfqId:    rfqId,
      newValue:    {
        rfqId,
        proposedQuoteId: pre["proposed_quote_id"],
        sentBy:          `portal:${portalCustomerId}`,
        notes:           notes ?? null,
      },
    }).catch(() => {});

    // Notification (non-fatal)
    enqueueNotification({
      eventType:      "mkt_rfq_customer_review" as any,
      recipientType:  "buyer",
      recipientPhone: pre["buyer_phone"] ? String(pre["buyer_phone"]) : null,
      rfqId,
      payloadJson: {
        rfqId,
        rfqNumber:       String(pre["rfq_number"] ?? rfqId),
        proposedQuoteId: pre["proposed_quote_id"],
        sentBy:          `portal:${portalCustomerId}`,
        notes:           notes ?? null,
      },
    }).catch(() => {});

    // Admin in-app notification
    void NotificationService.saveAndBroadcast("admin_notification", {
      type:        "mkt_rfq_sent_to_customer_review",
      orderNumber: String(pre["rfq_number"] ?? rfqId),
      customerName: String(pre["buyer_name"] ?? "Customer"),
      title:       "RFQ Dikirim ke Customer Review",
      body:        `Buyer mengirim RFQ ${pre["rfq_number"]} ke customer review. Menunggu persetujuan customer.`,
      targetRole:  "admin",
      rfqId,
      proposedQuoteId: pre["proposed_quote_id"],
    });

    logger.info({ rfqId, portalCustomerId, proposedQuoteId: pre["proposed_quote_id"] }, "[mktPortal] sendToCustomerReview success");
    return res.json({
      ok: true,
      data: {
        rfqId,
        rfqNumber:       String(updated["rfq_number"] ?? rfqId),
        status:          "customer_review",
        proposedQuoteId: updated["proposed_quote_id"],
        message:         "RFQ berhasil dikirim ke customer review. Customer akan menerima notifikasi.",
      },
    });
  } catch (err: unknown) {
    logger.error({ err, portalCustomerId, rfqId }, "[mktPortal] sendToCustomerReview error");
    return res.status(500).json({ ok: false, error: "Gagal mengirim ke customer review" });
  }
});

export default router;


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

const router = Router();

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

router.post("/rfqs/:id/cancel", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const body = req.body as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() || undefined : undefined;

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

router.post("/rfqs/:id/approve", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const body = req.body as { notes?: unknown };
  const notes = typeof body.notes === "string" ? body.notes.trim() || undefined : undefined;

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

router.post("/rfqs/:id/reject", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });
  }

  const body = req.body as { notes?: unknown };
  if (!body.notes || typeof body.notes !== "string" || !body.notes.trim()) {
    return res.status(400).json({ ok: false, error: "notes (alasan penolakan) wajib diisi dan tidak boleh kosong" });
  }
  const notes = body.notes.trim();

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
router.post("/rfqs/:id/customer-approve", async (req: Request, res: Response) => {
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
      if (result.code === "RFQ_ALREADY_AWARDED")
        return res.status(409).json({ ok: false, error: result.message });
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
router.post("/rfqs/:id/customer-reject", async (req: Request, res: Response) => {
  const portalCustomerId = (req as PortalAuthReq).portalCustomerId;
  const rfqId = Number(req.params["id"]);
  if (!Number.isInteger(rfqId) || rfqId <= 0)
    return res.status(400).json({ ok: false, error: "rfqId harus berupa integer positif" });

  const body = req.body as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() || "Ditolak oleh buyer" : "Ditolak oleh buyer";

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

export default router;


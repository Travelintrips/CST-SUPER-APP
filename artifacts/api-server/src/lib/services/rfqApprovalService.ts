/**
 * rfqApprovalService.ts — Phase 2F: Buyer Approval Flow
 *
 * Mengelola lifecycle approval untuk RFQ yang membutuhkan persetujuan internal
 * (buyer_approval_level >= 2 di snapshot portal_company_members).
 *
 * Flow:
 *   Buyer buat RFQ (approval_level >= 2)
 *     → mkt_rfqs: status='draft', approval_status='pending'
 *     → mkt_rfq_approvals: status='pending'
 *     → (opsional) notifikasi approver
 *
 *   Approver setuju
 *     → mkt_rfq_approvals: status='approved', responded_at=NOW, responder_member_id
 *     → mkt_rfqs: status='submitted', approval_status='approved', approval_resolved_at=NOW
 *     → Admin sekarang bisa melihat dan mengelola RFQ
 *
 *   Approver tolak
 *     → mkt_rfq_approvals: status='rejected', responded_at=NOW, response_notes
 *     → mkt_rfqs: approval_status='rejected', approval_resolved_at=NOW
 *     → mkt_rfqs.status tetap 'draft' — buyer bisa revisi dan resubmit
 *
 * Approver eligibility:
 *   portal_company_member di company yang sama dengan buyer_role IN
 *   ('procurement', 'finance', 'admin') dan is_active = true.
 *
 * Semua fungsi menggunakan typed result union — tidak pernah throw ke caller.
 */

import { db, mktRfqsTable, mktRfqApprovalsTable, portalCompanyMembersTable, portalCustomersTable } from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { logger } from "../logger.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Role yang boleh menjadi approver */
const APPROVER_ROLES = ["procurement", "finance", "admin"];

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApprovalErrorCode =
  | "RFQ_NOT_FOUND"
  | "NOT_OWNER"
  | "NOT_ELIGIBLE_APPROVER"
  | "WRONG_STATUS"
  | "NO_PENDING_APPROVAL"
  | "ALREADY_RESOLVED"
  | "NO_COMPANY_MAPPING"
  | "DB_ERROR";

export type ApprovalError = { ok: false; code: ApprovalErrorCode; message: string };
export type ApprovalSuccess<T> = { ok: true } & T;

export interface ApprovalRfqSummary {
  rfqId: number;
  rfqNumber: string;
  rfqStatus: string;
  approvalStatus: string;
  approvalRequestedAt: Date | null;
  approvalResolvedAt: Date | null;
  buyerName: string;
  buyerEmail: string;
  buyerCompany: string | null;
  buyerRole: string | null;
  buyerDepartment: string | null;
  buyerApprovalLevel: number | null;
  companyId: number | null;
  notes: string | null;
  requiredDeliveryDate: string | null;
  createdAt: Date;
  pendingApproval: {
    id: number;
    approverLevel: number;
    status: string;
    requestedAt: Date;
    responseNotes: string | null;
  } | null;
}

// ── Core: init approval flow dari createMktRfqEntry ───────────────────────────

/**
 * initApprovalFlow — Buat mkt_rfq_approvals record ketika RFQ membutuhkan approval.
 * Dipanggil dari marketplaceRfqService setelah transaksi RFQ berhasil.
 * Fire-and-forget — tidak pernah throw.
 */
export async function initApprovalFlow(
  rfqId: number,
  rfqNumber: string,
  companyId: number,
  approvalLevel: number,
): Promise<void> {
  try {
    await db.insert(mktRfqApprovalsTable).values({
      rfqId,
      approverLevel: 1, // Phase 2F: always L1 untuk simplicity
      // approverMemberId: NULL — terbuka untuk semua eligible approver di company
      status: "pending",
    });

    logger.info(
      { rfqId, rfqNumber, companyId, approvalLevel },
      "[rfqApproval] Approval flow initiated",
    );
  } catch (err) {
    // Non-fatal — log and continue (RFQ sudah tersimpan, approval record optional)
    logger.warn({ err, rfqId }, "[rfqApproval] initApprovalFlow failed (non-fatal)");
  }
}

// ── Submit: buyer explicitly submits a draft RFQ ──────────────────────────────

/**
 * submitRfqForApproval — Buyer mengajukan draft RFQ untuk diproses.
 *
 * Jika approval_status = 'rejected' (buyer merevisi dan resubmit):
 *   - Buat approval record baru
 *   - Set approval_status kembali ke 'pending'
 *
 * Jika buyer_approval_level <= 1 atau NULL (self-approve):
 *   - Langsung transisi ke 'submitted', approval_status = 'none'
 *
 * Jika approval_status sudah 'pending':
 *   - Tolak dengan ALREADY_RESOLVED error
 */
export async function submitRfqForApproval(
  rfqId: number,
  portalCustomerId: number,
): Promise<ApprovalSuccess<{ rfqStatus: string; approvalStatus: string; needsApproval: boolean }> | ApprovalError> {
  // ── Load RFQ ──────────────────────────────────────────────────────────────
  let rfq: {
    id: number;
    rfqNumber: string;
    status: string;
    approvalStatus: string;
    portalCustomerId: number | null;
    companyId: number | null;
    buyerApprovalLevel: number | null;
    buyerName: string;
    buyerEmail: string;
  };

  try {
    const rows = await db.select({
      id:                 mktRfqsTable.id,
      rfqNumber:          mktRfqsTable.rfqNumber,
      status:             mktRfqsTable.status,
      approvalStatus:     mktRfqsTable.approvalStatus,
      portalCustomerId:   mktRfqsTable.portalCustomerId,
      companyId:          mktRfqsTable.companyId,
      buyerApprovalLevel: mktRfqsTable.buyerApprovalLevel,
      buyerName:          mktRfqsTable.buyerName,
      buyerEmail:         mktRfqsTable.buyerEmail,
    }).from(mktRfqsTable).where(eq(mktRfqsTable.id, rfqId)).limit(1);

    if (!rows.length) return { ok: false, code: "RFQ_NOT_FOUND", message: `RFQ id=${rfqId} tidak ditemukan` };
    rfq = rows[0]!;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, code: "DB_ERROR", message: msg };
  }

  // ── Validasi ownership ─────────────────────────────────────────────────────
  if (rfq.portalCustomerId !== portalCustomerId) {
    return { ok: false, code: "NOT_OWNER", message: "RFQ ini bukan milik Anda" };
  }

  // ── Validasi status ────────────────────────────────────────────────────────
  if (rfq.status !== "draft") {
    return {
      ok: false,
      code: "WRONG_STATUS",
      message: `RFQ harus dalam status 'draft' untuk disubmit (current: ${rfq.status})`,
    };
  }

  if (rfq.approvalStatus === "pending") {
    return {
      ok: false,
      code: "ALREADY_RESOLVED",
      message: "RFQ sudah menunggu approval — tidak perlu disubmit lagi",
    };
  }

  // ── Tentukan apakah perlu approval ────────────────────────────────────────
  const needsApproval = (rfq.buyerApprovalLevel ?? 0) >= 2 && rfq.companyId != null;

  try {
    if (!needsApproval) {
      // Self-approve atau tidak ada company mapping → langsung submitted
      await db.update(mktRfqsTable)
        .set({
          status:           "submitted",
          approvalStatus:   "none",
          approvalResolvedAt: new Date(),
          updatedAt:        new Date(),
        })
        .where(eq(mktRfqsTable.id, rfqId));

      await logActivity({
        mktRfqId:  rfqId,
        actorType: "customer",
        actorId:   String(portalCustomerId),
        actorName: rfq.buyerName,
        action:    "mkt_rfq_self_approved",
        description: `RFQ ${rfq.rfqNumber} langsung disubmit (self-approve, level=${rfq.buyerApprovalLevel ?? 0})`,
        newValue:  { rfqId, rfqNumber: rfq.rfqNumber, approvalLevel: rfq.buyerApprovalLevel },
      });

      return { ok: true, rfqStatus: "submitted", approvalStatus: "none", needsApproval: false };
    }

    // Needs approval — buat/update record dan set approval_status = pending
    await db.transaction(async (tx) => {
      // Jika previously rejected, buat approval record baru
      await tx.insert(mktRfqApprovalsTable).values({
        rfqId,
        approverLevel: 1,
        status: "pending",
      });

      await tx.update(mktRfqsTable)
        .set({
          approvalStatus:      "pending",
          approvalRequestedAt: new Date(),
          approvalResolvedAt:  null,
          updatedAt:           new Date(),
        })
        .where(eq(mktRfqsTable.id, rfqId));
    });

    await logActivity({
      mktRfqId:  rfqId,
      actorType: "customer",
      actorId:   String(portalCustomerId),
      actorName: rfq.buyerName,
      action:    "mkt_rfq_approval_requested",
      description: `RFQ ${rfq.rfqNumber} diajukan untuk approval (level=${rfq.buyerApprovalLevel})`,
      newValue:  { rfqId, rfqNumber: rfq.rfqNumber, approvalLevel: rfq.buyerApprovalLevel, companyId: rfq.companyId },
    });

    // Enqueue notifikasi ke approver — fire-and-forget
    enqueueNotification({
      eventType:     "mkt_rfq_approval_requested",
      recipientType: "approver",
      rfqId,
      payloadJson: {
        rfqNumber:     rfq.rfqNumber,
        companyId:     rfq.companyId,
        approvalLevel: rfq.buyerApprovalLevel,
        buyerName:     rfq.buyerName,
        buyerEmail:    rfq.buyerEmail,
      },
    }).catch(() => {});

    return { ok: true, rfqStatus: "draft", approvalStatus: "pending", needsApproval: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId }, "[rfqApproval] submitRfqForApproval DB error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}

// ── Approve RFQ ───────────────────────────────────────────────────────────────

/**
 * approveRfq — Approver menyetujui RFQ.
 * Validasi: approver adalah active member di company yang sama dengan buyer_role eligible.
 * Efek: approval record → approved, mkt_rfqs.status → submitted
 */
export async function approveRfq(
  rfqId: number,
  approverPortalCustomerId: number,
  notes?: string,
): Promise<ApprovalSuccess<{ rfqNumber: string; approvalId: number }> | ApprovalError> {
  const result = await resolveApprovalContext(rfqId, approverPortalCustomerId);
  if (!result.ok) return result;
  const { rfq, approval, approverMember } = result;

  try {
    await db.transaction(async (tx) => {
      // Update approval record
      await tx.update(mktRfqApprovalsTable)
        .set({
          status:             "approved",
          respondedAt:        new Date(),
          responseNotes:      notes ?? null,
          responderMemberId:  approverMember.memberId,
          approverMemberId:   approverMember.memberId,
        })
        .where(eq(mktRfqApprovalsTable.id, approval.id));

      // Transisi RFQ ke submitted
      await tx.update(mktRfqsTable)
        .set({
          status:              "submitted",
          approvalStatus:      "approved",
          approvalResolvedAt:  new Date(),
          updatedAt:           new Date(),
        })
        .where(eq(mktRfqsTable.id, rfqId));
    });

    await logActivity({
      mktRfqId:  rfqId,
      actorType: "customer",
      actorId:   String(approverPortalCustomerId),
      actorName: approverMember.memberName ?? "Approver",
      action:    "mkt_rfq_approved",
      description: `RFQ ${rfq.rfqNumber} disetujui oleh ${approverMember.memberName ?? "approver"} (member_id=${approverMember.memberId})`,
      newValue:  { rfqId, rfqNumber: rfq.rfqNumber, approvalId: approval.id, approverMemberId: approverMember.memberId, notes: notes ?? null },
    });

    // Enqueue notifikasi ke buyer (approved) — fire-and-forget
    enqueueNotification({
      eventType:     "mkt_rfq_approved",
      recipientType: "buyer",
      rfqId,
      payloadJson: {
        rfqNumber:        rfq.rfqNumber,
        approverMemberId: approverMember.memberId,
        approverName:     approverMember.memberName ?? null,
        notes:            notes ?? null,
      },
    }).catch(() => {});

    logger.info({ rfqId, approverPortalCustomerId, approvalId: approval.id }, "[rfqApproval] RFQ approved");
    return { ok: true, rfqNumber: rfq.rfqNumber, approvalId: approval.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId }, "[rfqApproval] approveRfq DB error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}

// ── Reject RFQ ────────────────────────────────────────────────────────────────

/**
 * rejectRfq — Approver menolak RFQ.
 * Efek: approval record → rejected, mkt_rfqs.status tetap 'draft' (buyer bisa revisi)
 */
export async function rejectRfq(
  rfqId: number,
  approverPortalCustomerId: number,
  notes: string,
): Promise<ApprovalSuccess<{ rfqNumber: string; approvalId: number }> | ApprovalError> {
  if (!notes?.trim()) {
    return { ok: false, code: "WRONG_STATUS", message: "Alasan penolakan wajib diisi" };
  }

  const result = await resolveApprovalContext(rfqId, approverPortalCustomerId);
  if (!result.ok) return result;
  const { rfq, approval, approverMember } = result;

  try {
    await db.transaction(async (tx) => {
      await tx.update(mktRfqApprovalsTable)
        .set({
          status:             "rejected",
          respondedAt:        new Date(),
          responseNotes:      notes,
          responderMemberId:  approverMember.memberId,
          approverMemberId:   approverMember.memberId,
        })
        .where(eq(mktRfqApprovalsTable.id, approval.id));

      await tx.update(mktRfqsTable)
        .set({
          approvalStatus:     "rejected",
          approvalResolvedAt: new Date(),
          updatedAt:          new Date(),
          // status tetap 'draft' — buyer perlu revisi lalu resubmit
        })
        .where(eq(mktRfqsTable.id, rfqId));
    });

    await logActivity({
      mktRfqId:  rfqId,
      actorType: "customer",
      actorId:   String(approverPortalCustomerId),
      actorName: approverMember.memberName ?? "Approver",
      action:    "mkt_rfq_rejected",
      description: `RFQ ${rfq.rfqNumber} ditolak oleh ${approverMember.memberName ?? "approver"}: ${notes}`,
      newValue:  { rfqId, rfqNumber: rfq.rfqNumber, approvalId: approval.id, approverMemberId: approverMember.memberId, notes },
    });

    // Enqueue notifikasi ke buyer (rejected) — fire-and-forget
    enqueueNotification({
      eventType:     "mkt_rfq_rejected",
      recipientType: "buyer",
      rfqId,
      payloadJson: {
        rfqNumber:        rfq.rfqNumber,
        approverMemberId: approverMember.memberId,
        approverName:     approverMember.memberName ?? null,
        rejectionNotes:   notes,
      },
    }).catch(() => {});

    logger.info({ rfqId, approverPortalCustomerId, approvalId: approval.id }, "[rfqApproval] RFQ rejected");
    return { ok: true, rfqNumber: rfq.rfqNumber, approvalId: approval.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn({ err, rfqId }, "[rfqApproval] rejectRfq DB error");
    return { ok: false, code: "DB_ERROR", message: msg };
  }
}

// ── Cancel RFQ (buyer) ────────────────────────────────────────────────────────

/**
 * cancelRfq — Buyer membatalkan RFQ (draft atau submitted).
 * Hanya buyer (portal_customer_id) yang bisa cancel.
 * Status 'awarded' atau 'quoting' tidak bisa di-cancel via portal.
 */
export async function cancelRfq(
  rfqId: number,
  portalCustomerId: number,
  reason?: string,
): Promise<ApprovalSuccess<{ rfqNumber: string }> | ApprovalError> {
  let rfq: { id: number; rfqNumber: string; status: string; portalCustomerId: number | null; buyerName: string };

  try {
    const rows = await db.select({
      id:               mktRfqsTable.id,
      rfqNumber:        mktRfqsTable.rfqNumber,
      status:           mktRfqsTable.status,
      portalCustomerId: mktRfqsTable.portalCustomerId,
      buyerName:        mktRfqsTable.buyerName,
    }).from(mktRfqsTable).where(eq(mktRfqsTable.id, rfqId)).limit(1);

    if (!rows.length) return { ok: false, code: "RFQ_NOT_FOUND", message: `RFQ id=${rfqId} tidak ditemukan` };
    rfq = rows[0]!;
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  if (rfq.portalCustomerId !== portalCustomerId) {
    return { ok: false, code: "NOT_OWNER", message: "RFQ ini bukan milik Anda" };
  }

  const cancelableStatuses = new Set(["draft", "submitted"]);
  if (!cancelableStatuses.has(rfq.status)) {
    return {
      ok: false,
      code: "WRONG_STATUS",
      message: `RFQ dengan status '${rfq.status}' tidak dapat dibatalkan. Hubungi admin.`,
    };
  }

  try {
    await db.update(mktRfqsTable)
      .set({
        status:    "cancelled",
        notes:     reason ? `[Cancelled by buyer] ${reason}` : undefined,
        updatedAt: new Date(),
      })
      .where(eq(mktRfqsTable.id, rfqId));

    await logActivity({
      mktRfqId:  rfqId,
      actorType: "customer",
      actorId:   String(portalCustomerId),
      actorName: rfq.buyerName,
      action:    "mkt_rfq_cancelled",
      description: `RFQ ${rfq.rfqNumber} dibatalkan oleh buyer`,
      newValue:  { rfqId, rfqNumber: rfq.rfqNumber, reason: reason ?? null },
    });

    return { ok: true, rfqNumber: rfq.rfqNumber };
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }
}

// ── List: RFQ milik buyer ─────────────────────────────────────────────────────

/**
 * getBuyerRfqs — Daftar semua RFQ milik buyer (berdasarkan portal_customer_id).
 */
export async function getBuyerRfqs(
  portalCustomerId: number,
  limit = 50,
  offset = 0,
): Promise<ApprovalRfqSummary[]> {
  const rows = await db.select({
    id:                  mktRfqsTable.id,
    rfqNumber:           mktRfqsTable.rfqNumber,
    status:              mktRfqsTable.status,
    approvalStatus:      mktRfqsTable.approvalStatus,
    approvalRequestedAt: mktRfqsTable.approvalRequestedAt,
    approvalResolvedAt:  mktRfqsTable.approvalResolvedAt,
    buyerName:           mktRfqsTable.buyerName,
    buyerEmail:          mktRfqsTable.buyerEmail,
    buyerCompany:        mktRfqsTable.buyerCompany,
    buyerRole:           mktRfqsTable.buyerRole,
    buyerDepartment:     mktRfqsTable.buyerDepartment,
    buyerApprovalLevel:  mktRfqsTable.buyerApprovalLevel,
    companyId:           mktRfqsTable.companyId,
    notes:               mktRfqsTable.notes,
    requiredDeliveryDate: mktRfqsTable.requiredDeliveryDate,
    createdAt:           mktRfqsTable.createdAt,
  })
  .from(mktRfqsTable)
  .where(eq(mktRfqsTable.portalCustomerId, portalCustomerId))
  .orderBy(desc(mktRfqsTable.createdAt))
  .limit(Math.min(limit, 200))
  .offset(offset);

  // Fetch pending approvals untuk setiap RFQ dalam satu query
  const rfqIds = rows.map((r) => r.id);
  const approvals = rfqIds.length
    ? await db.select({
        rfqId:         mktRfqApprovalsTable.rfqId,
        id:            mktRfqApprovalsTable.id,
        approverLevel: mktRfqApprovalsTable.approverLevel,
        status:        mktRfqApprovalsTable.status,
        requestedAt:   mktRfqApprovalsTable.requestedAt,
        responseNotes: mktRfqApprovalsTable.responseNotes,
      }).from(mktRfqApprovalsTable)
        .where(and(
          inArray(mktRfqApprovalsTable.rfqId, rfqIds),
          eq(mktRfqApprovalsTable.status, "pending"),
        ))
    : [];

  const approvalMap = new Map(approvals.map((a) => [a.rfqId, a]));

  return rows.map((r) => {
    const pa = approvalMap.get(r.id) ?? null;
    return {
      rfqId:               r.id,
      rfqNumber:           r.rfqNumber,
      rfqStatus:           r.status,
      approvalStatus:      r.approvalStatus ?? "none",
      approvalRequestedAt: r.approvalRequestedAt,
      approvalResolvedAt:  r.approvalResolvedAt,
      buyerName:           r.buyerName,
      buyerEmail:          r.buyerEmail,
      buyerCompany:        r.buyerCompany,
      buyerRole:           r.buyerRole,
      buyerDepartment:     r.buyerDepartment,
      buyerApprovalLevel:  r.buyerApprovalLevel,
      companyId:           r.companyId,
      notes:               r.notes,
      requiredDeliveryDate: r.requiredDeliveryDate,
      createdAt:           r.createdAt,
      pendingApproval: pa ? {
        id:            pa.id,
        approverLevel: pa.approverLevel,
        status:        pa.status,
        requestedAt:   pa.requestedAt,
        responseNotes: pa.responseNotes,
      } : null,
    };
  });
}

// ── List: RFQ menunggu approval dari saya (sebagai approver) ─────────────────

/**
 * getPendingApprovalsForMember — Daftar RFQ yang menunggu approval saya.
 * Saya eligible menjadi approver jika:
 *   - Active member di company yang sama dengan buyer
 *   - buyer_role IN ('procurement', 'finance', 'admin')
 */
export async function getPendingApprovalsForMember(
  portalCustomerId: number,
): Promise<ApprovalRfqSummary[]> {
  // Cari semua company yang saya punya eligible role
  const myMemberships = await db.select({
    companyId: portalCompanyMembersTable.companyId,
    buyerRole: portalCompanyMembersTable.buyerRole,
    memberId:  portalCompanyMembersTable.id,
  })
  .from(portalCompanyMembersTable)
  .where(and(
    eq(portalCompanyMembersTable.portalCustomerId, portalCustomerId),
    eq(portalCompanyMembersTable.isActive, true),
    inArray(portalCompanyMembersTable.buyerRole, APPROVER_ROLES),
  ));

  if (!myMemberships.length) return [];

  const eligibleCompanyIds = myMemberships.map((m) => m.companyId);

  // Cari semua pending approval records untuk RFQ di company yang sama
  const pendingApprovals = await db.select({
    approvalId:    mktRfqApprovalsTable.id,
    rfqId:         mktRfqApprovalsTable.rfqId,
    approverLevel: mktRfqApprovalsTable.approverLevel,
    requestedAt:   mktRfqApprovalsTable.requestedAt,
    responseNotes: mktRfqApprovalsTable.responseNotes,
  })
  .from(mktRfqApprovalsTable)
  .where(eq(mktRfqApprovalsTable.status, "pending"));

  if (!pendingApprovals.length) return [];

  // Load RFQ data untuk pending approvals
  const pendingRfqIds = [...new Set(pendingApprovals.map((a) => a.rfqId))];
  const rfqRows = await db.select({
    id:                  mktRfqsTable.id,
    rfqNumber:           mktRfqsTable.rfqNumber,
    status:              mktRfqsTable.status,
    approvalStatus:      mktRfqsTable.approvalStatus,
    approvalRequestedAt: mktRfqsTable.approvalRequestedAt,
    approvalResolvedAt:  mktRfqsTable.approvalResolvedAt,
    buyerName:           mktRfqsTable.buyerName,
    buyerEmail:          mktRfqsTable.buyerEmail,
    buyerCompany:        mktRfqsTable.buyerCompany,
    buyerRole:           mktRfqsTable.buyerRole,
    buyerDepartment:     mktRfqsTable.buyerDepartment,
    buyerApprovalLevel:  mktRfqsTable.buyerApprovalLevel,
    companyId:           mktRfqsTable.companyId,
    notes:               mktRfqsTable.notes,
    requiredDeliveryDate: mktRfqsTable.requiredDeliveryDate,
    createdAt:           mktRfqsTable.createdAt,
  })
  .from(mktRfqsTable)
  .where(and(
    inArray(mktRfqsTable.id, pendingRfqIds),
    // Hanya RFQ di company yang saya eligible sebagai approver
    inArray(mktRfqsTable.companyId, eligibleCompanyIds),
  ));

  const rfqMap = new Map(rfqRows.map((r) => [r.id, r]));
  const approvalMap = new Map(pendingApprovals.map((a) => [a.rfqId, a]));

  return rfqRows.map((r) => {
    const pa = approvalMap.get(r.id)!;
    return {
      rfqId:               r.id,
      rfqNumber:           r.rfqNumber,
      rfqStatus:           r.status,
      approvalStatus:      r.approvalStatus ?? "none",
      approvalRequestedAt: r.approvalRequestedAt,
      approvalResolvedAt:  r.approvalResolvedAt,
      buyerName:           r.buyerName,
      buyerEmail:          r.buyerEmail,
      buyerCompany:        r.buyerCompany,
      buyerRole:           r.buyerRole,
      buyerDepartment:     r.buyerDepartment,
      buyerApprovalLevel:  r.buyerApprovalLevel,
      companyId:           r.companyId,
      notes:               r.notes,
      requiredDeliveryDate: r.requiredDeliveryDate,
      createdAt:           r.createdAt,
      pendingApproval: {
        id:            pa.approvalId,
        approverLevel: pa.approverLevel,
        status:        "pending",
        requestedAt:   pa.requestedAt,
        responseNotes: pa.responseNotes,
      },
    };
  });
}

// ── Internal: resolve approval context (shared by approve/reject) ─────────────

async function resolveApprovalContext(
  rfqId: number,
  approverPortalCustomerId: number,
): Promise<
  | ApprovalError
  | {
      ok: true;
      rfq: { id: number; rfqNumber: string; status: string; companyId: number | null; approvalStatus: string };
      approval: { id: number; status: string; approverLevel: number };
      approverMember: { memberId: number; memberName: string | null };
    }
> {
  // 1. Load RFQ
  let rfq: { id: number; rfqNumber: string; status: string; approvalStatus: string; companyId: number | null };
  try {
    const rows = await db.select({
      id:             mktRfqsTable.id,
      rfqNumber:      mktRfqsTable.rfqNumber,
      status:         mktRfqsTable.status,
      approvalStatus: mktRfqsTable.approvalStatus,
      companyId:      mktRfqsTable.companyId,
    }).from(mktRfqsTable).where(eq(mktRfqsTable.id, rfqId)).limit(1);
    if (!rows.length) return { ok: false, code: "RFQ_NOT_FOUND", message: `RFQ id=${rfqId} tidak ditemukan` };
    rfq = rows[0]!;
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  // 2. Cek ada pending approval
  if (rfq.approvalStatus !== "pending") {
    return {
      ok: false,
      code: rfq.approvalStatus === "approved" || rfq.approvalStatus === "rejected"
        ? "ALREADY_RESOLVED"
        : "NO_PENDING_APPROVAL",
      message: `RFQ tidak dalam status pending approval (current: ${rfq.approvalStatus})`,
    };
  }

  if (!rfq.companyId) {
    return { ok: false, code: "NO_COMPANY_MAPPING", message: "RFQ tidak terkait dengan company manapun" };
  }

  // 3. Validasi approver eligibility
  let approverMember: { memberId: number; memberName: string | null } | null = null;
  try {
    // Phase 2F fix: JOIN portalCustomersTable untuk mendapatkan memberName/displayName
    const [mem] = await db.select({
      id:   portalCompanyMembersTable.id,
      name: portalCustomersTable.name,
    })
    .from(portalCompanyMembersTable)
    .leftJoin(
      portalCustomersTable,
      eq(portalCompanyMembersTable.portalCustomerId, portalCustomersTable.id),
    )
    .where(and(
      eq(portalCompanyMembersTable.portalCustomerId, approverPortalCustomerId),
      eq(portalCompanyMembersTable.companyId, rfq.companyId),
      eq(portalCompanyMembersTable.isActive, true),
      inArray(portalCompanyMembersTable.buyerRole, APPROVER_ROLES),
    ))
    .limit(1);

    if (!mem) {
      return {
        ok: false,
        code: "NOT_ELIGIBLE_APPROVER",
        message: "Anda tidak memiliki hak untuk menyetujui RFQ ini (role tidak cukup atau bukan member company ini)",
      };
    }
    approverMember = { memberId: mem.id, memberName: mem.name ?? null };
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  // 4. Load pending approval record
  let approval: { id: number; status: string; approverLevel: number };
  try {
    const rows = await db.select({
      id:            mktRfqApprovalsTable.id,
      status:        mktRfqApprovalsTable.status,
      approverLevel: mktRfqApprovalsTable.approverLevel,
    })
    .from(mktRfqApprovalsTable)
    .where(and(
      eq(mktRfqApprovalsTable.rfqId, rfqId),
      eq(mktRfqApprovalsTable.status, "pending"),
    ))
    .orderBy(desc(mktRfqApprovalsTable.createdAt))
    .limit(1);

    if (!rows.length) {
      return { ok: false, code: "NO_PENDING_APPROVAL", message: "Tidak ada approval record yang pending untuk RFQ ini" };
    }
    approval = rows[0]!;
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, rfq, approval, approverMember };
}

// ── C4-REMEDIATION: rejectCustomerQuotation ───────────────────────────────────
/**
 * rejectCustomerQuotation — Canonical transition: customer_review → quoted.
 *
 * Menangani penolakan quotation oleh buyer melalui Customer Portal secara atomic:
 *   1. Validasi kepemilikan RFQ (portalCustomerId harus cocok).
 *   2. Validasi current status (harus 'customer_review').
 *   3. Idempotency: jika sudah 'quoted', kembalikan ok:true tanpa update ulang.
 *   4. Atomically reset proposed_quote_id = NULL dan status = 'quoted'.
 *   5. Catat ke activity log (audit trail).
 *
 * Tidak pernah throw — semua error dikembalikan sebagai typed union.
 */
export type CustomerRejectErrorCode =
  | "RFQ_NOT_FOUND"
  | "NOT_OWNER"
  | "WRONG_STATUS"
  | "DB_ERROR";

export type CustomerRejectResult =
  | { ok: true; rfqNumber: string; status: "quoted"; idempotent?: true }
  | { ok: false; code: CustomerRejectErrorCode; message: string };

export async function rejectCustomerQuotation(opts: {
  rfqId: number;
  portalCustomerId: number;
  reason: string;
}): Promise<CustomerRejectResult> {
  const { rfqId, portalCustomerId, reason } = opts;

  // ── 1. Load & validate ownership ───────────────────────────────────────────
  let rfq: { id: number; status: string; rfqNumber: string; portalCustomerId: number | null };
  try {
    const rows = await db
      .select({
        id:               mktRfqsTable.id,
        status:           mktRfqsTable.status,
        rfqNumber:        mktRfqsTable.rfqNumber,
        portalCustomerId: mktRfqsTable.portalCustomerId,
      })
      .from(mktRfqsTable)
      .where(eq(mktRfqsTable.id, rfqId))
      .limit(1);

    if (!rows.length) {
      return { ok: false, code: "RFQ_NOT_FOUND", message: "RFQ tidak ditemukan" };
    }
    rfq = rows[0]!;
  } catch (err) {
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  // ── 2. Ownership check ─────────────────────────────────────────────────────
  if (rfq.portalCustomerId !== portalCustomerId) {
    return { ok: false, code: "NOT_OWNER", message: "RFQ tidak ditemukan" }; // opaque 404-style
  }

  // ── 3. Idempotency: already quoted ─────────────────────────────────────────
  if (rfq.status === "quoted") {
    logger.info({ rfqId, portalCustomerId }, "[rejectCustomerQuotation] idempotent — already quoted");
    return { ok: true, rfqNumber: rfq.rfqNumber, status: "quoted", idempotent: true };
  }

  // ── 4. Status guard ────────────────────────────────────────────────────────
  if (rfq.status !== "customer_review") {
    return {
      ok: false,
      code: "WRONG_STATUS",
      message: `RFQ tidak dalam status customer_review (current: ${rfq.status})`,
    };
  }

  // ── 5. Atomic transition: proposed_quote_id → NULL, status → quoted ────────
  try {
    const { sql: drizzleSql } = await import("drizzle-orm");
    await db.transaction(async (tx) => {
      await tx.execute(drizzleSql`
        UPDATE mkt_rfqs
        SET status            = 'quoted',
            proposed_quote_id = NULL,
            updated_at        = NOW()
        WHERE id = ${rfqId}
          AND status = 'customer_review'
      `);
    });
  } catch (err) {
    logger.error({ err, rfqId, portalCustomerId }, "[rejectCustomerQuotation] DB error during transition");
    return { ok: false, code: "DB_ERROR", message: err instanceof Error ? err.message : String(err) };
  }

  // ── 6. Audit trail ─────────────────────────────────────────────────────────
  try {
    await logActivity({
      mktRfqId:   rfqId,
      actorType:  "portal_customer",
      actorId:    String(portalCustomerId),
      action:     "customer_reject_quotation",
      description: `Customer menolak quotation untuk RFQ ${rfq.rfqNumber}. Alasan: ${reason}. Transition: customer_review → quoted`,
    });
  } catch (auditErr) {
    // Non-fatal: log but don't fail the transition
    logger.warn({ auditErr, rfqId }, "[rejectCustomerQuotation] audit log failed (non-fatal)");
  }

  logger.info({ rfqId, portalCustomerId, reason }, "[rejectCustomerQuotation] customer_review → quoted");
  return { ok: true, rfqNumber: rfq.rfqNumber, status: "quoted" };
}

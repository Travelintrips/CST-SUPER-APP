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

import { randomBytes } from "crypto";
import {
  db,
  mktRfqsTable,
  mktRfqApprovalsTable,
  mktVendorQuotesTable,
  suppliersTable,
  vendorProfilesTable,
  vendorNotificationsTable,
  portalCompanyMembersTable,
  portalCustomersTable,
} from "@workspace/db";
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { logActivity } from "../activityLog.js";
import { logger } from "../logger.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { getPortalCustomerContext } from "./portalCustomerContextService.js";
import { createOrderLink } from "./orderLinkService.js";

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

// ── Admin approval bridge ──────────────────────────────────────────────────────
//
// The buyer-company approver remains the normal approval authority. This bridge
// is for the Marketplace operator surface: one authenticated admin action may
// resolve a pending RFQ and invite the selected vendors through the same
// canonical mkt_vendor_quotes service used by the standalone invite endpoint.
export type AdminApprovalResult =
  | ApprovalSuccess<{
      rfqNumber: string;
      invited: Array<{ vendorId: number; quoteId: number; alreadyInvited: boolean }>;
      alreadyApproved: boolean;
    }>
  | {
      ok: false;
      code:
        | "RFQ_NOT_FOUND"
        | "WRONG_STATUS"
        | "NO_VENDORS"
        | "VENDOR_NOT_FOUND"
        | "VENDOR_INACTIVE"
        | "INVITE_FAILED"
        | "DB_ERROR";
      message: string;
    };

export async function approveRfqForAdmin(opts: {
  rfqId: number;
  vendorIds: number[];
  adminId: string;
  adminName: string;
  notes?: string;
}): Promise<AdminApprovalResult> {
  const vendorIds = [...new Set(opts.vendorIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (vendorIds.length === 0) {
    return { ok: false, code: "NO_VENDORS", message: "Pilih minimal satu vendor sebelum RFQ disetujui" };
  }

  type CreatedInvite = {
    vendorId: number;
    quoteId: number;
    alreadyInvited: boolean;
    token: string | null;
    validUntil: Date | null;
    vendorName: string;
    vendorPhone: string | null;
    vendorEmail: string | null;
  };

  let rfq: { rfqNumber: string; buyerName: string; buyerCompany: string | null; notes: string | null };
  let alreadyApproved = false;
  const createdInvites: CreatedInvite[] = [];
  let invited: Array<{ vendorId: number; quoteId: number; alreadyInvited: boolean }> = [];

  try {
    // The RFQ row is the serialization point for this operation. Approval and
    // every missing vendor quote are committed or rolled back together.
    const transactionResult = await db.transaction(async (tx) => {
      const lockedRows = await tx.execute(sql`
        SELECT id, rfq_number, status, approval_status, buyer_name, buyer_company, notes
        FROM mkt_rfqs
        WHERE id = ${opts.rfqId}
        FOR UPDATE
      `);
      const row = ((lockedRows as any).rows ?? lockedRows)[0] as {
        id: number;
        rfq_number: string;
        status: string;
        approval_status: string | null;
        buyer_name: string;
        buyer_company: string | null;
        notes: string | null;
      } | undefined;

      if (!row) throw Object.assign(new Error("RFQ tidak ditemukan"), { code: "RFQ_NOT_FOUND" });
      if (["cancelled", "expired", "awarded"].includes(row.status)) {
        throw Object.assign(new Error(`RFQ tidak dapat disetujui pada status ${row.status}`), { code: "WRONG_STATUS" });
      }

      const isAlreadyApproved = row.approval_status === "approved" && row.status !== "draft";
      if (!isAlreadyApproved && !(row.status === "draft" && ["pending", "rejected", "none", null, ""].includes(row.approval_status))) {
        throw Object.assign(
          new Error(`RFQ tidak menunggu approval (status=${row.status}, approval=${row.approval_status})`),
          { code: "WRONG_STATUS" },
        );
      }

      const vendors = await tx
        .select({
          id: suppliersTable.id,
          name: suppliersTable.name,
          phone: suppliersTable.phone,
          contactEmail: suppliersTable.contactEmail,
          isActive: suppliersTable.isActive,
        })
        .from(suppliersTable)
        .where(inArray(suppliersTable.id, vendorIds));

      const vendorById = new Map(vendors.map((vendor) => [vendor.id, vendor]));
      const missingVendor = vendorIds.find((vendorId) => !vendorById.has(vendorId));
      if (missingVendor) {
        throw Object.assign(new Error(`Vendor id=${missingVendor} tidak ditemukan`), { code: "VENDOR_NOT_FOUND" });
      }
      const inactiveVendor = vendors.find((vendor) => !vendor.isActive);
      if (inactiveVendor) {
        throw Object.assign(
          new Error(`Vendor "${inactiveVendor.name}" (id=${inactiveVendor.id}) tidak aktif — aktifkan vendor terlebih dahulu`),
          { code: "VENDOR_INACTIVE" },
        );
      }

      const existingQuotes = await tx
        .select({
          id: mktVendorQuotesTable.id,
          vendorId: mktVendorQuotesTable.vendorId,
          status: mktVendorQuotesTable.status,
        })
        .from(mktVendorQuotesTable)
        .where(and(eq(mktVendorQuotesTable.rfqId, opts.rfqId), inArray(mktVendorQuotesTable.vendorId, vendorIds)));
      const existingByVendor = new Map(existingQuotes.map((quote) => [quote.vendorId, quote]));
      let insertedCount = 0;

      for (const vendorId of vendorIds) {
        const existing = existingByVendor.get(vendorId);
        const vendor = vendorById.get(vendorId)!;
        if (existing) {
          createdInvites.push({
            vendorId,
            quoteId: existing.id,
            alreadyInvited: true,
            token: null,
            validUntil: null,
            vendorName: vendor.name,
            vendorPhone: vendor.phone,
            vendorEmail: vendor.contactEmail,
          });
          continue;
        }

        const token = randomBytes(32).toString("hex");
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + 30);
        const [quote] = await tx
          .insert(mktVendorQuotesTable)
          .values({ rfqId: opts.rfqId, vendorId, token, status: "invited", validUntil })
          .onConflictDoNothing({ target: [mktVendorQuotesTable.rfqId, mktVendorQuotesTable.vendorId] })
          .returning({ id: mktVendorQuotesTable.id });

        if (!quote) {
          // A standalone invite may have won the unique-key race. Reusing it
          // keeps retries idempotent without turning the whole request into a
          // false failure.
          const [raced] = await tx
            .select({ id: mktVendorQuotesTable.id, status: mktVendorQuotesTable.status })
            .from(mktVendorQuotesTable)
            .where(and(eq(mktVendorQuotesTable.rfqId, opts.rfqId), eq(mktVendorQuotesTable.vendorId, vendorId)))
            .limit(1);
          if (!raced) throw new Error("Vendor quote tidak dapat dibuat");
          createdInvites.push({
            vendorId,
            quoteId: raced.id,
            alreadyInvited: true,
            token: null,
            validUntil: null,
            vendorName: vendor.name,
            vendorPhone: vendor.phone,
            vendorEmail: vendor.contactEmail,
          });
          continue;
        }

        insertedCount += 1;
        createdInvites.push({
          vendorId,
          quoteId: quote.id,
          alreadyInvited: false,
          token,
          validUntil,
          vendorName: vendor.name,
          vendorPhone: vendor.phone,
          vendorEmail: vendor.contactEmail,
        });
      }

      if (insertedCount > 0) {
        await tx
          .update(mktRfqsTable)
          .set({ quoteCount: sql`${mktRfqsTable.quoteCount} + ${insertedCount}`, updatedAt: new Date() })
          .where(eq(mktRfqsTable.id, opts.rfqId));
      }

      if (!isAlreadyApproved) {
        const [updated] = await tx
          .update(mktRfqsTable)
          .set({
            status: "submitted",
            approvalStatus: "approved",
            approvalResolvedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(and(eq(mktRfqsTable.id, opts.rfqId), eq(mktRfqsTable.status, "draft")))
          .returning({ id: mktRfqsTable.id });
        if (!updated) throw Object.assign(new Error("RFQ approval race"), { code: "WRONG_STATUS" });

        await tx
          .update(mktRfqApprovalsTable)
          .set({
            status: "approved",
            respondedAt: new Date(),
            responseNotes: opts.notes?.trim() || `Disetujui admin ${opts.adminName}`,
          })
          .where(and(eq(mktRfqApprovalsTable.rfqId, opts.rfqId), eq(mktRfqApprovalsTable.status, "pending")));
      }

      return {
        rfqNumber: row.rfq_number,
        buyerName: row.buyer_name,
        buyerCompany: row.buyer_company,
        notes: row.notes,
        alreadyApproved: isAlreadyApproved,
      };
    });

    rfq = transactionResult;
    alreadyApproved = transactionResult.alreadyApproved;
    invited = createdInvites.map(({ vendorId, quoteId, alreadyInvited }) => ({ vendorId, quoteId, alreadyInvited }));
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === "RFQ_NOT_FOUND") return { ok: false, code: "RFQ_NOT_FOUND", message: "RFQ tidak ditemukan" };
    if (code === "VENDOR_NOT_FOUND") return { ok: false, code: "VENDOR_NOT_FOUND", message: (err as Error).message };
    if (code === "VENDOR_INACTIVE") return { ok: false, code: "VENDOR_INACTIVE", message: (err as Error).message };
    if (code === "WRONG_STATUS") return { ok: false, code: "WRONG_STATUS", message: (err as Error).message };
    logger.warn({ err, rfqId: opts.rfqId }, "[rfqApproval] admin approval and invite transaction failed");
    return { ok: false, code: "DB_ERROR", message: "Approval dan undangan vendor dibatalkan karena transaksi gagal" };
  }

  // These are deliberately after commit. They are operational side effects,
  // not part of the financial/workflow state, and must never create a partial
  // approval if a queue or audit sink is unavailable.
  for (const invite of createdInvites.filter((item) => !item.alreadyInvited && item.token && item.validUntil)) {
    const base =
      process.env["PORTAL_BASE_URL"] ??
      (process.env["REPLIT_DEV_DOMAIN"] ? `https://${process.env["REPLIT_DEV_DOMAIN"]}` : null);
    const validUntil = invite.validUntil!;
    const payload = {
      vendorPhone: invite.vendorPhone,
      vendorEmail: invite.vendorEmail,
      vendorName: invite.vendorName,
      rfqId: opts.rfqId,
      rfqNumber: rfq.rfqNumber,
      rfqBuyerName: rfq.buyerName,
      rfqBuyerCompany: rfq.buyerCompany,
      rfqNotes: rfq.notes,
      quoteId: invite.quoteId,
      token: invite.token!,
      validUntil: validUntil.toISOString(),
      deepLinkUrl: base ? `${base}/mkt-vendor-quote/${invite.token!}` : null,
    };

    void createOrderLink({
      sourceTable: "mkt_rfqs",
      sourceId: opts.rfqId,
      targetTable: "mkt_vendor_quotes",
      targetId: invite.quoteId,
      linkType: "rfq_to_vendor_quote",
      createdBy: opts.adminId,
    }).catch(() => {});
    void logActivity({
      mktRfqId: opts.rfqId,
      mktVendorQuoteId: invite.quoteId,
      actorType: "admin",
      actorId: opts.adminId,
      actorName: opts.adminName,
      action: "mkt_vendor_invited",
      description: `Vendor "${invite.vendorName}" diundang ke RFQ ${rfq.rfqNumber} (quote_id=${invite.quoteId}, valid 30 hari)`,
      newValue: { rfqId: opts.rfqId, rfqNumber: rfq.rfqNumber, vendorId: invite.vendorId, quoteId: invite.quoteId },
    }).catch(() => {});
    void enqueueNotification({
      eventType: "mkt_vendor_invitation_notification",
      recipientType: "vendor",
      recipientId: invite.vendorId,
      recipientPhone: invite.vendorPhone,
      rfqId: opts.rfqId,
      vendorQuoteId: invite.quoteId,
      payloadJson: payload,
    }).catch(() => {});
    void (async () => {
      try {
        const [profile] = await db
          .select({ customerId: vendorProfilesTable.customerId })
          .from(vendorProfilesTable)
          .where(eq(vendorProfilesTable.supplierId, invite.vendorId))
          .limit(1);
        if (!profile?.customerId) return;
        await db.insert(vendorNotificationsTable).values({
          vendorId: profile.customerId,
          type: "marketplace_rfq_invitation",
          title: "RFQ Marketplace baru",
          message: `Anda menerima undangan penawaran ${rfq.rfqNumber}. Isi harga per item sebelum batas waktu.`,
          payload: { rfqId: opts.rfqId, quoteId: invite.quoteId, rfqNumber: rfq.rfqNumber, quoteUrl: `/mkt-vendor-quote/${invite.token!}`, validUntil: validUntil.toISOString() },
        });
      } catch (notificationError) {
        logger.warn({ notificationError, vendorId: invite.vendorId }, "[rfqApproval] vendor in-app notification failed");
      }
    })();
  }

  await logActivity({
    mktRfqId: opts.rfqId,
    actorType: "admin",
    actorId: opts.adminId,
    actorName: opts.adminName,
    action: "mkt_rfq_admin_approved_and_invited",
    description: `Admin menyetujui RFQ ${rfq.rfqNumber} dan mengundang ${invited.length} vendor`,
    newValue: {
      rfqId: opts.rfqId,
      rfqNumber: rfq.rfqNumber,
      vendorIds: invited.map((item) => item.vendorId),
      quoteIds: invited.map((item) => item.quoteId),
      alreadyApproved,
    },
  }).catch(() => {});

  enqueueNotification({
    eventType: "mkt_rfq_approved",
    recipientType: "buyer",
    rfqId: opts.rfqId,
    payloadJson: {
      rfqId: opts.rfqId,
      rfqNumber: rfq.rfqNumber,
      approvedBy: opts.adminId,
      invitedVendorCount: invited.length,
    },
  }).catch((err: unknown) => {
    logger.warn({ err, rfqId: opts.rfqId }, "[rfqApproval] admin approval notification failed");
  });

  return { ok: true, rfqNumber: rfq.rfqNumber, invited, alreadyApproved };
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
  const context = await getPortalCustomerContext(portalCustomerId);
  const ownershipWhere = context.customerType === "individual"
    ? eq(mktRfqsTable.portalCustomerId, portalCustomerId)
    : context.companyId
      ? eq(mktRfqsTable.companyId, context.companyId)
      : null;

  // A company without an active canonical membership must not fall back to
  // portal_customer_id: that would hide company RFQs from colleagues and can
  // expose a stale creator-owned view after membership changes.
  if (!ownershipWhere) return [];

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
  .where(ownershipWhere)
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

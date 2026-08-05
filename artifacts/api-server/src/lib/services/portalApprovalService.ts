/**
 * Portal Approval Service
 *
 * Business logic for onboarding approval workflows.
 * Controller (portal.ts) calls these functions and only handles HTTP
 * request/response — no business logic lives in the controller.
 */

import {
  db,
  portalCustomersTable,
  userProfilesTable,
  onboardingApprovalsTable,
  vendorProfilesTable,
  driverProfilesTable,
  employeeProfilesTable,
  vendorCatalogSubmissionLinksTable,
  notificationLogsTable,
  identityDocumentsTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { writeAuditLog } from "../auditLog.js";
import { NotificationService } from "./notificationService.js";
import { runVendorApprovedInTx } from "./vendorLifecycleService.js";
import { getWaTemplateConfig, renderTemplate } from "../orderNotification.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ApprovalStatus = "approved" | "rejected";

export interface ApprovalListOptions {
  status?: string;
  accountType?: string;
}

export interface ProcessApprovalOptions {
  id: number;
  status: ApprovalStatus;
  adminNote?: string;
  reviewedBy?: string;
  /** portalCustomerId of the admin performing the action */
  adminPortalCustomerId?: number;
  ip: string;
  userAgent: string;
}

export interface ProcessApprovalResult {
  ok: true;
  status: string;
  createdSupplierId: number | null;
  createdSupplierName: string | null;
  supplierAlreadyExisted: boolean;
  submissionLinkId: number | null;
  submissionLinkToken: string | null;
  submissionLinkUrl: string | null;
  waNotificationSent: false;
}

type TxLifecycleResult = {
  supplierId: number;
  supplierName: string;
  alreadyExisted: boolean;
  submissionLinkId: number;
  submissionLinkToken: string;
  submissionLinkUrl: string;
} | null;

// ─── listApprovals ────────────────────────────────────────────────────────────

export async function listApprovals(opts: ApprovalListOptions) {
  const conds = [];
  if (opts.status)      conds.push(eq(onboardingApprovalsTable.status, opts.status));
  if (opts.accountType) conds.push(eq(onboardingApprovalsTable.accountType, opts.accountType));

  const rows = await db
    .select({
      id:            onboardingApprovalsTable.id,
      customerId:    onboardingApprovalsTable.customerId,
      accountType:   onboardingApprovalsTable.accountType,
      status:        onboardingApprovalsTable.status,
      adminNote:     onboardingApprovalsTable.adminNote,
      reviewedBy:    onboardingApprovalsTable.reviewedBy,
      reviewedAt:    onboardingApprovalsTable.reviewedAt,
      createdAt:     onboardingApprovalsTable.createdAt,
      customerName:  portalCustomersTable.name,
      customerEmail: portalCustomersTable.email,
      customerPhone: portalCustomersTable.phone,
    })
    .from(onboardingApprovalsTable)
    .leftJoin(portalCustomersTable, eq(onboardingApprovalsTable.customerId, portalCustomersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(onboardingApprovalsTable.createdAt));

  // Attach type-specific profiles
  const enriched = await Promise.all(rows.map(async (row) => {
    let typeProfile: Record<string, unknown> | null = null;

    if (row.accountType === "vendor") {
      const [vp] = await db
        .select()
        .from(vendorProfilesTable)
        .where(eq(vendorProfilesTable.customerId, row.customerId));
      if (vp) {
        let catalogSubmissionLinkToken: string | null = null;
        let catalogSubmissionLinkUrl: string | null = null;
        if (vp.catalogSubmissionLinkId) {
          const [link] = await db
            .select({ token: vendorCatalogSubmissionLinksTable.token, isActive: vendorCatalogSubmissionLinksTable.isActive })
            .from(vendorCatalogSubmissionLinksTable)
            .where(eq(vendorCatalogSubmissionLinksTable.id, vp.catalogSubmissionLinkId))
            .limit(1);
          if (link) {
            catalogSubmissionLinkToken = link.token;
            const devDomain = process.env.REPLIT_DEV_DOMAIN;
            const baseUrl = devDomain ? `https://${devDomain}` : (process.env.APP_BASE_URL ?? "");
            catalogSubmissionLinkUrl = `${baseUrl}/api/vendor-catalog-engine/form/${link.token}`;
          }
        }
        typeProfile = { ...vp, catalogSubmissionLinkToken, catalogSubmissionLinkUrl };
      }
    } else if (row.accountType === "driver") {
      const [dp] = await db.select().from(driverProfilesTable).where(eq(driverProfilesTable.customerId, row.customerId));
      typeProfile = dp ?? null;
    } else if (row.accountType === "employee") {
      const [ep] = await db.select().from(employeeProfilesTable).where(eq(employeeProfilesTable.customerId, row.customerId));
      typeProfile = ep ?? null;
    }

    const [up] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.customerId, row.customerId));
    return { ...row, userProfile: up ?? null, typeProfile };
  }));

  return enriched;
}

// ─── processApproval ─────────────────────────────────────────────────────────

export async function processApproval(opts: ProcessApprovalOptions): Promise<ProcessApprovalResult> {
  const { id, status, adminNote, reviewedBy, adminPortalCustomerId, ip, userAgent } = opts;

  const [approval] = await db
    .select()
    .from(onboardingApprovalsTable)
    .where(eq(onboardingApprovalsTable.id, id));
  if (!approval) throw Object.assign(new Error("Not found"), { statusCode: 404 });

  const newProfileStatus = status === "approved" ? "active" : "rejected";
  const isVendorApproval = status === "approved" && approval.accountType === "vendor";

  let txLifecycle: TxLifecycleResult = null;

  // ── Atomic DB transaction ─────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await db.transaction(async (tx: any) => {
    const now = new Date();

    await tx.update(onboardingApprovalsTable).set({
      status,
      adminNote:  adminNote ?? null,
      reviewedBy: reviewedBy ?? null,
      reviewedAt: now,
      updatedAt:  now,
    }).where(eq(onboardingApprovalsTable.id, id));

    await tx.update(userProfilesTable).set({
      status: newProfileStatus,
      rejectionReason: status === "rejected" ? (adminNote ?? "Tidak memenuhi syarat") : null,
      updatedAt: now,
    }).where(eq(userProfilesTable.customerId, approval.customerId));

    if (status === "approved") {
      await tx.update(portalCustomersTable)
        .set({ role: approval.accountType })
        .where(eq(portalCustomersTable.id, approval.customerId));
    } else {
      await tx.update(portalCustomersTable)
        .set({ role: "customer" })
        .where(eq(portalCustomersTable.id, approval.customerId));
    }

    if (isVendorApproval) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      txLifecycle = await runVendorApprovedInTx(tx as any, approval.customerId, reviewedBy ?? "admin");
    }
  });

  // ── Audit trail (fire-and-forget, after commit) ───────────────────────────
  const lc0 = txLifecycle as TxLifecycleResult;
  writeAuditLog({
    userId:    adminPortalCustomerId ? String(adminPortalCustomerId) : null,
    userEmail: reviewedBy ?? null,
    action:    status === "approved" ? "portal_onboarding_approved" : "portal_onboarding_rejected",
    module:    "vendor",
    referenceId: String(id),
    oldData: {
      approvalId:     id,
      approvalStatus: approval.status,
      accountType:    approval.accountType,
      customerId:     approval.customerId,
    },
    newData: {
      approvalId:     id,
      approvalStatus: status,
      profileStatus:  newProfileStatus,
      accountType:    approval.accountType,
      customerId:     approval.customerId,
      newRole:        status === "approved" ? approval.accountType : "customer",
      adminNote:      adminNote ?? null,
      reviewedBy:     reviewedBy ?? null,
      ...(status === "approved" && lc0 ? {
        supplierId:       lc0.supplierId,
        supplierName:     lc0.supplierName,
        submissionLinkId: lc0.submissionLinkId,
      } : {}),
      ...(status === "rejected" ? {
        rejectionReason: adminNote ?? "Tidak memenuhi syarat",
      } : {}),
    },
    ipAddress: ip,
    userAgent,
  });

  // ── WA notification (non-blocking, after commit) ──────────────────────────
  if (isVendorApproval && txLifecycle) {
    const lc = txLifecycle as NonNullable<TxLifecycleResult>;
    void _sendVendorApprovedWa(lc, approval.customerId);
    void NotificationService.notifyVendorApproved({
      supplierId:        lc.supplierId,
      supplierName:      lc.supplierName,
      customerId:        approval.customerId,
      submissionLinkUrl: lc.submissionLinkUrl,
      waNotificationSent: false,
      reviewedBy:        reviewedBy ?? "admin",
    });
  }

  if (!isVendorApproval) {
    void _sendNonVendorWa(approval.customerId, approval.accountType, status, adminNote);
  }

  const lc = txLifecycle as TxLifecycleResult;
  return {
    ok: true,
    status: newProfileStatus,
    createdSupplierId:      lc?.supplierId       ?? null,
    createdSupplierName:    lc?.supplierName     ?? null,
    supplierAlreadyExisted: lc?.alreadyExisted   ?? false,
    submissionLinkId:       lc?.submissionLinkId    ?? null,
    submissionLinkToken:    lc?.submissionLinkToken ?? null,
    submissionLinkUrl:      lc?.submissionLinkUrl   ?? null,
    waNotificationSent:     false,
  };
}

// ─── getApprovalAuditTrail ────────────────────────────────────────────────────

export async function getApprovalAuditTrail(id: number) {
  const rows = await db.execute(sql`
    SELECT
      id,
      user_id        AS "userId",
      user_email     AS "userEmail",
      action,
      module,
      reference_id   AS "referenceId",
      old_data       AS "oldData",
      new_data       AS "newData",
      ip_address     AS "ipAddress",
      user_agent     AS "userAgent",
      created_at     AS "createdAt"
    FROM erp_audit_logs
    WHERE module = 'vendor'
      AND reference_id = ${String(id)}
      AND action IN ('portal_onboarding_approved', 'portal_onboarding_rejected')
    ORDER BY created_at DESC
    LIMIT 100
  `);
  const logs = (rows as unknown as { rows: unknown[] }).rows ?? rows;
  return { ok: true, data: logs, count: (logs as unknown[]).length };
}

// ─── getApprovalIdentityDocs ─────────────────────────────────────────────────

export async function getApprovalIdentityDocs(approvalId: number) {
  const [approval] = await db
    .select({ customerId: onboardingApprovalsTable.customerId, accountType: onboardingApprovalsTable.accountType })
    .from(onboardingApprovalsTable)
    .where(eq(onboardingApprovalsTable.id, approvalId))
    .limit(1);
  if (!approval) return null;

  const identityDocs = await db
    .select()
    .from(identityDocumentsTable)
    .where(eq(identityDocumentsTable.customerId, approval.customerId));

  // Also pull legalityDocUrl from vendor_profiles (for vendor accounts)
  let legalityDocUrl: string | null = null;
  if (approval.accountType === "vendor") {
    const [vp] = await db
      .select({ legalityDocUrl: vendorProfilesTable.legalityDocUrl })
      .from(vendorProfilesTable)
      .where(eq(vendorProfilesTable.customerId, approval.customerId))
      .limit(1);
    legalityDocUrl = vp?.legalityDocUrl ?? null;
  }

  const docs = [
    ...identityDocs.map((d) => ({
      id:        d.id,
      docType:   d.docType,
      url:       d.url,
      fileName:  d.fileName ?? null,
      source:    "identity_documents" as const,
      createdAt: d.createdAt ? d.createdAt.toISOString() : null,
    })),
    ...(legalityDocUrl ? [{
      id:        null as number | null,
      docType:   "legality",
      url:       legalityDocUrl,
      fileName:  "Dokumen Legalitas Perusahaan",
      source:    "vendor_profile" as const,
      createdAt: null as string | null,
    }] : []),
  ];

  return { customerId: approval.customerId, docs };
}

// ─── getApprovalStats ─────────────────────────────────────────────────────────

export async function getApprovalStats(): Promise<Record<string, number>> {
  const rows = await db
    .select({ status: onboardingApprovalsTable.status, accountType: onboardingApprovalsTable.accountType })
    .from(onboardingApprovalsTable);
  const stats: Record<string, number> = { pending: 0, approved: 0, rejected: 0, total: rows.length };
  for (const r of rows) {
    stats[r.status] = (stats[r.status] ?? 0) + 1;
  }
  return stats;
}

// ─── Private helpers ──────────────────────────────────────────────────────────

async function _sendVendorApprovedWa(
  lc: NonNullable<TxLifecycleResult>,
  customerId: number,
) {
  try {
    const [customer] = await db.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, customerId));
    const [up] = await db.select().from(userProfilesTable).where(eq(userProfilesTable.customerId, customerId));
    const phone = up?.phone ?? customer?.phone;
    if (!phone) return;

    const defaultTpl = [
      `✅ *Selamat! Akun Vendor Anda Disetujui!*`, ``,
      `Hai {{vendorName}},`, ``,
      `Akun vendor Anda telah diverifikasi dan disetujui oleh tim kami.`, ``,
      `Langkah selanjutnya:`,
      `📦 Upload katalog produk/layanan Anda melalui link berikut:`,
      `{{submissionLinkUrl}}`, ``,
      `Link ini sudah siap digunakan. Setelah upload, tim kami akan mereview katalog Anda.`, ``,
      `Terima kasih telah bergabung!`,
    ];
    const tplBody = await getWaTemplateConfig("vendor", "vendor_onboarding_approved", defaultTpl);
    const msg = renderTemplate(tplBody, { vendorName: lc.supplierName, submissionLinkUrl: lc.submissionLinkUrl });
    await sendWhatsApp(phone, msg);
    await db.insert(notificationLogsTable).values({
      channel: "wa", recipient: phone, subject: "Vendor Approved", message: msg,
      status: "sent", context: "vendor_onboarding", refType: "portal_customer", refId: String(customerId),
    }).catch(() => {});
  } catch (e) {
    console.error("[portalApprovalService] vendor WA error:", e);
  }
}

async function _sendNonVendorWa(
  customerId: number,
  accountType: string,
  status: ApprovalStatus,
  adminNote?: string,
) {
  try {
    const [customer] = await db.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, customerId));
    if (!customer?.phone) return;

    const workflow = status === "approved" ? "portal_account_approved" : "portal_account_rejected";
    const defaultTpl = status === "approved"
      ? [
          `✅ *Akun Anda Disetujui!*`, ``,
          `Hai {{customerName}}, akun {{accountType}} Anda di B2B Marketplace and Logistic telah disetujui.`, ``,
          `Silakan login kembali untuk mengakses sistem.`,
        ]
      : [
          `❌ *Akun Anda Ditolak*`, ``,
          `Hai {{customerName}}, permintaan akun {{accountType}} Anda tidak dapat kami setujui.`, ``,
          `Alasan: {{rejectionReason}}`, ``,
          `Hubungi kami untuk informasi lebih lanjut.`,
        ];
    const tplBody = await getWaTemplateConfig("customer", workflow, defaultTpl);
    const msg = renderTemplate(tplBody, {
      customerName: customer.name,
      accountType,
      rejectionReason: adminNote ?? "Tidak memenuhi syarat",
    });
    await sendWhatsApp(customer.phone, msg);
  } catch (e) {
    console.error("[portalApprovalService] non-vendor WA error:", e);
  }
}

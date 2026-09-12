/**
 * customerVerification.ts
 * Sprint P1A — Customer Verification Center
 *
 * Portal customer:
 *   GET    /api/customer-verification          — get status + docs
 *   POST   /api/customer-verification/submit   — submit for review
 *   POST   /api/customer-verification/documents — upload doc
 *   PUT    /api/customer-verification/documents/:id — re-upload / update
 *   DELETE /api/customer-verification/documents/:id — hapus doc (DRAFT only)
 *
 * Admin (requireClerkUser):
 *   GET  /api/customer-verification/admin                          — list pending
 *   GET  /api/customer-verification/admin/:profileId               — detail
 *   POST /api/customer-verification/admin/:profileId/approve        — approve semua
 *   POST /api/customer-verification/admin/:profileId/reject         — reject
 *   POST /api/customer-verification/admin/:profileId/request-revision — minta revisi
 *   PUT  /api/customer-verification/admin/:profileId/documents/:docId/review — review doc
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  portalCustomerProfilesTable,
  portalCustomersTable,
  customerVerificationDocumentsTable,
} from "@workspace/db";
import { requirePortalAuth, type PortalAuthReq } from "../lib/supabaseAuth.js";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { imagePdfUpload } from "../lib/uploadMiddleware.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";
import type { CustomerVerificationStatus, VerificationDocType } from "@workspace/db";

export const customerVerificationRouter = Router();
export const customerVerificationAdminRouter = Router();

const storage = new ObjectStorageService();
const docUpload = imagePdfUpload(20);

// ── Idempotent migration ──────────────────────────────────────────────────────
db.execute(sql`
  ALTER TABLE portal_customer_profiles
    ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'DRAFT',
    ADD COLUMN IF NOT EXISTS verification_submitted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_expired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS verification_notes TEXT;

  CREATE TABLE IF NOT EXISTS customer_verification_documents (
    id SERIAL PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES portal_customer_profiles(id) ON DELETE CASCADE,
    document_type TEXT NOT NULL,
    document_number TEXT,
    file_url TEXT NOT NULL,
    file_name TEXT,
    verification_status TEXT NOT NULL DEFAULT 'UPLOADED',
    verified_by TEXT,
    verified_at TIMESTAMPTZ,
    rejection_reason TEXT,
    expiry_date TIMESTAMPTZ,
    uploaded_version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );
`).catch((e: unknown) => logger.warn({ e }, "[customerVerification] migration warn"));

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getOrCreateProfile(customerId: number) {
  const [existing] = await db
    .select()
    .from(portalCustomerProfilesTable)
    .where(eq(portalCustomerProfilesTable.customerId, customerId))
    .limit(1);

  if (existing) return existing;

  const [created] = await db
    .insert(portalCustomerProfilesTable)
    .values({ customerId, profileStatus: "incomplete", verificationStatus: "DRAFT" })
    .returning();
  return created;
}

async function getProfileDocs(profileId: number) {
  return db
    .select()
    .from(customerVerificationDocumentsTable)
    .where(eq(customerVerificationDocumentsTable.profileId, profileId))
    .orderBy(desc(customerVerificationDocumentsTable.createdAt));
}

function verificationStatusLabel(status: string): string {
  const map: Record<string, string> = {
    DRAFT: "Draft",
    PENDING_VERIFICATION: "Menunggu Verifikasi",
    NEED_REVISION: "Perlu Revisi",
    VERIFIED: "Terverifikasi",
    REJECTED: "Ditolak",
    EXPIRED: "Kadaluarsa",
  };
  return map[status] ?? status;
}

async function sendVerificationWA(phone: string | null | undefined, message: string, ctx: string) {
  if (!phone) return;
  sendWhatsApp(phone, message, { context: ctx }).catch((e: unknown) =>
    logger.warn({ e, ctx }, "[customerVerification] WA send failed"),
  );
}

async function notifyAdmin(message: string, ctx: string) {
  const adminTarget = await getAdminGroupWa().catch(() => null);
  if (!adminTarget) return;
  sendWhatsApp(adminTarget, message, { context: ctx }).catch((e: unknown) =>
    logger.warn({ e, ctx }, "[customerVerification] admin WA send failed"),
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PORTAL CUSTOMER ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/customer-verification
customerVerificationRouter.get("/", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as PortalAuthReq;
    const customerId = authReq.portalCustomerId;
    if (!customerId) return res.status(401).json({ message: "Unauthorized" });

    const profile = await getOrCreateProfile(customerId);
    const docs = await getProfileDocs(profile.id);

    return res.json({
      profileId: profile.id,
      verificationStatus: profile.verificationStatus ?? "DRAFT",
      verificationSubmittedAt: profile.verificationSubmittedAt,
      verificationExpiredAt: profile.verificationExpiredAt,
      verificationNotes: profile.verificationNotes,
      companyName: profile.companyName,
      npwp: profile.npwp,
      nib: profile.nib,
      documents: docs,
    });
  } catch (err) {
    logger.error({ err }, "[customerVerification] get error");
    return res.status(500).json({ message: "Gagal mengambil data verifikasi" });
  }
});

// POST /api/customer-verification/submit — submit for review
customerVerificationRouter.post("/submit", requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const authReq = req as PortalAuthReq;
    const customerId = authReq.portalCustomerId;
    if (!customerId) return res.status(401).json({ message: "Unauthorized" });

    const profile = await getOrCreateProfile(customerId);

    const allowedToSubmit: CustomerVerificationStatus[] = ["DRAFT", "NEED_REVISION"];
    if (!allowedToSubmit.includes(profile.verificationStatus as CustomerVerificationStatus)) {
      return res.status(400).json({
        message: `Tidak dapat submit dari status ${verificationStatusLabel(profile.verificationStatus)}`,
      });
    }

    const docs = await getProfileDocs(profile.id);
    if (docs.length === 0) {
      return res.status(400).json({ message: "Upload minimal satu dokumen sebelum submit" });
    }

    await db
      .update(portalCustomerProfilesTable)
      .set({
        verificationStatus: "PENDING_VERIFICATION",
        verificationSubmittedAt: new Date(),
        verificationNotes: null,
        updatedAt: new Date(),
      })
      .where(eq(portalCustomerProfilesTable.id, profile.id));

    await db
      .update(customerVerificationDocumentsTable)
      .set({ verificationStatus: "PENDING_REVIEW", updatedAt: new Date() })
      .where(
        and(
          eq(customerVerificationDocumentsTable.profileId, profile.id),
          eq(customerVerificationDocumentsTable.verificationStatus, "UPLOADED"),
        ),
      );

    const [customer] = await db
      .select()
      .from(portalCustomersTable)
      .where(eq(portalCustomersTable.id, customerId))
      .limit(1);

    const domain = await getPreferredDomain();
    const adminMsg =
      `📋 *Pengajuan Verifikasi Customer Baru*\n` +
      `Nama: ${customer?.name ?? "-"}\n` +
      `Perusahaan: ${profile.companyName ?? "-"}\n` +
      `Dokumen: ${docs.length} file\n` +
      `Review: https://${domain}/bizportal/portal/customer-verification/${profile.id}`;

    await notifyAdmin(adminMsg, "customer-verification-submit");

    logger.info({ profileId: profile.id, customerId }, "[customerVerification] submitted");
    return res.json({ ok: true, message: "Pengajuan verifikasi berhasil dikirim" });
  } catch (err) {
    logger.error({ err }, "[customerVerification] submit error");
    return res.status(500).json({ message: "Gagal submit verifikasi" });
  }
});

// POST /api/customer-verification/documents — upload doc
customerVerificationRouter.post(
  "/documents",
  requirePortalAuth,
  docUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as PortalAuthReq;
      const customerId = authReq.portalCustomerId;
      if (!customerId) return res.status(401).json({ message: "Unauthorized" });

      const profile = await getOrCreateProfile(customerId);

      const blockedStatuses: CustomerVerificationStatus[] = ["PENDING_VERIFICATION", "VERIFIED"];
      if (blockedStatuses.includes(profile.verificationStatus as CustomerVerificationStatus)) {
        return res.status(400).json({
          message: "Tidak dapat upload dokumen saat proses verifikasi atau sudah terverifikasi",
        });
      }

      if (!req.file) return res.status(400).json({ message: "File wajib diupload" });

      const { documentType, documentNumber } = req.body as {
        documentType?: string;
        documentNumber?: string;
      };
      if (!documentType) return res.status(400).json({ message: "documentType wajib diisi" });

      const ext = req.file.originalname.split(".").pop() ?? "bin";
      const objectKey = `customer-verification/${profile.id}/${documentType}-${randomUUID()}.${ext}`;
      await storage.uploadFile(req.file.buffer, objectKey, req.file.mimetype);
      const fileUrl = objectKey;

      const [doc] = await db
        .insert(customerVerificationDocumentsTable)
        .values({
          profileId: profile.id,
          documentType,
          documentNumber: documentNumber ?? null,
          fileUrl,
          fileName: req.file.originalname,
          verificationStatus: "UPLOADED",
        })
        .returning();

      logger.info({ docId: doc.id, documentType, profileId: profile.id }, "[customerVerification] doc uploaded");
      return res.status(201).json({ ok: true, document: doc });
    } catch (err) {
      logger.error({ err }, "[customerVerification] upload error");
      return res.status(500).json({ message: "Gagal upload dokumen" });
    }
  },
);

// PUT /api/customer-verification/documents/:id — re-upload / update
customerVerificationRouter.put(
  "/documents/:id",
  requirePortalAuth,
  docUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      const authReq = req as PortalAuthReq;
      const customerId = authReq.portalCustomerId;
      if (!customerId) return res.status(401).json({ message: "Unauthorized" });

      const docId = parseInt(String(req.params.id), 10);
      if (isNaN(docId)) return res.status(400).json({ message: "ID tidak valid" });

      const profile = await getOrCreateProfile(customerId);

      const [doc] = await db
        .select()
        .from(customerVerificationDocumentsTable)
        .where(
          and(
            eq(customerVerificationDocumentsTable.id, docId),
            eq(customerVerificationDocumentsTable.profileId, profile.id),
          ),
        )
        .limit(1);

      if (!doc) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

      if (profile.verificationStatus === "PENDING_VERIFICATION" && doc.verificationStatus !== "REJECTED") {
        return res.status(400).json({ message: "Tidak dapat mengganti dokumen yang sedang di-review" });
      }

      let fileUrl = doc.fileUrl;
      let fileName = doc.fileName;

      if (req.file) {
        const ext = req.file.originalname.split(".").pop() ?? "bin";
        const objectKey = `customer-verification/${profile.id}/${doc.documentType}-${randomUUID()}.${ext}`;
        await storage.uploadFile(req.file.buffer, objectKey, req.file.mimetype);
        fileUrl = objectKey;
        fileName = req.file.originalname;
      }

      const { documentNumber } = req.body as { documentNumber?: string };

      const [updated] = await db
        .update(customerVerificationDocumentsTable)
        .set({
          fileUrl,
          fileName,
          documentNumber: documentNumber ?? doc.documentNumber,
          verificationStatus: "UPLOADED",
          rejectionReason: null,
          uploadedVersion: (doc.uploadedVersion ?? 1) + 1,
          updatedAt: new Date(),
        })
        .where(eq(customerVerificationDocumentsTable.id, docId))
        .returning();

      return res.json({ ok: true, document: updated });
    } catch (err) {
      logger.error({ err }, "[customerVerification] re-upload error");
      return res.status(500).json({ message: "Gagal update dokumen" });
    }
  },
);

// DELETE /api/customer-verification/documents/:id
customerVerificationRouter.delete(
  "/documents/:id",
  requirePortalAuth,
  async (req: Request, res: Response) => {
    try {
      const authReq = req as PortalAuthReq;
      const customerId = authReq.portalCustomerId;
      if (!customerId) return res.status(401).json({ message: "Unauthorized" });

      const docId = parseInt(String(req.params.id), 10);
      if (isNaN(docId)) return res.status(400).json({ message: "ID tidak valid" });

      const profile = await getOrCreateProfile(customerId);

      const blockedStatuses: CustomerVerificationStatus[] = ["PENDING_VERIFICATION", "VERIFIED"];
      if (blockedStatuses.includes(profile.verificationStatus as CustomerVerificationStatus)) {
        return res.status(400).json({ message: "Tidak dapat hapus dokumen saat proses verifikasi atau sudah terverifikasi" });
      }

      await db
        .delete(customerVerificationDocumentsTable)
        .where(
          and(
            eq(customerVerificationDocumentsTable.id, docId),
            eq(customerVerificationDocumentsTable.profileId, profile.id),
          ),
        );

      return res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "[customerVerification] delete doc error");
      return res.status(500).json({ message: "Gagal hapus dokumen" });
    }
  },
);

// ═══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/customer-verification/admin — list
customerVerificationAdminRouter.get("/", requireClerkUser, async (req: Request, res: Response) => {
  try {
    const { status, q, limit: lStr, offset: oStr } = req.query as Record<string, string | undefined>;
    const lim = Math.min(parseInt(lStr ?? "50", 10), 200);
    const off = parseInt(oStr ?? "0", 10);

    const rows = await db.execute(sql`
      SELECT
        p.id AS "profileId",
        p.customer_id AS "customerId",
        p.company_name AS "companyName",
        p.npwp,
        p.nib,
        p.pic_name AS "picName",
        p.pic_whatsapp AS "picWhatsapp",
        p.pic_email AS "picEmail",
        p.verification_status AS "verificationStatus",
        p.verification_submitted_at AS "verificationSubmittedAt",
        p.verification_notes AS "verificationNotes",
        c.name AS "customerName",
        c.email AS "customerEmail",
        c.phone AS "customerPhone",
        (SELECT COUNT(*) FROM customer_verification_documents d WHERE d.profile_id = p.id) AS "docCount",
        (SELECT COUNT(*) FROM customer_verification_documents d WHERE d.profile_id = p.id AND d.verification_status = 'PENDING_REVIEW') AS "pendingDocCount"
      FROM portal_customer_profiles p
      LEFT JOIN portal_customers c ON c.id = p.customer_id
      WHERE 1=1
        ${status && status !== "all" ? sql`AND p.verification_status = ${status}` : sql``}
        ${q ? sql`AND (
          p.company_name ILIKE ${"%" + q + "%"} OR
          c.name ILIKE ${"%" + q + "%"} OR
          c.email ILIKE ${"%" + q + "%"} OR
          p.npwp ILIKE ${"%" + q + "%"}
        )` : sql``}
      ORDER BY p.verification_submitted_at DESC NULLS LAST, p.created_at DESC
      LIMIT ${lim} OFFSET ${off}
    `);

    const countRow = await db.execute(sql`
      SELECT COUNT(*) AS cnt FROM portal_customer_profiles p
      LEFT JOIN portal_customers c ON c.id = p.customer_id
      WHERE 1=1
        ${status && status !== "all" ? sql`AND p.verification_status = ${status}` : sql``}
        ${q ? sql`AND (p.company_name ILIKE ${"%" + q + "%"} OR c.name ILIKE ${"%" + q + "%"})` : sql``}
    `);

    return res.json({
      items: rows.rows,
      total: parseInt(String((countRow.rows[0] as Record<string, unknown>)["cnt"] ?? "0"), 10),
    });
  } catch (err) {
    logger.error({ err }, "[customerVerification] admin list error");
    return res.status(500).json({ message: "Gagal mengambil data" });
  }
});

// GET /api/customer-verification/admin/:profileId — detail
customerVerificationAdminRouter.get("/:profileId", requireClerkUser, async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(String(req.params.profileId), 10);
    if (isNaN(profileId)) return res.status(400).json({ message: "ID tidak valid" });

    const [profile] = await db
      .select()
      .from(portalCustomerProfilesTable)
      .where(eq(portalCustomerProfilesTable.id, profileId))
      .limit(1);

    if (!profile) return res.status(404).json({ message: "Profile tidak ditemukan" });

    const docs = await getProfileDocs(profileId);

    let customer = null;
    if (profile.customerId) {
      const [c] = await db
        .select()
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, profile.customerId))
        .limit(1);
      customer = c ?? null;
    }

    return res.json({ profile, documents: docs, customer });
  } catch (err) {
    logger.error({ err }, "[customerVerification] admin detail error");
    return res.status(500).json({ message: "Gagal mengambil detail" });
  }
});

// POST /api/customer-verification/admin/:profileId/approve
customerVerificationAdminRouter.post("/:profileId/approve", requireClerkUser, async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(String(req.params.profileId), 10);
    if (isNaN(profileId)) return res.status(400).json({ message: "ID tidak valid" });

    const { notes, expiredInDays } = req.body as { notes?: string; expiredInDays?: number };
    const adminName = (req as PortalAuthReq & { user?: { email?: string } }).user?.email ?? "admin";

    const expiredAt = expiredInDays
      ? new Date(Date.now() + expiredInDays * 86_400_000)
      : new Date(Date.now() + 365 * 86_400_000);

    const [profile] = await db
      .update(portalCustomerProfilesTable)
      .set({
        verificationStatus: "VERIFIED",
        isVerified: true,
        verifiedBy: adminName,
        verifiedAt: new Date(),
        verificationExpiredAt: expiredAt,
        verificationNotes: notes ?? null,
        updatedAt: new Date(),
      })
      .where(eq(portalCustomerProfilesTable.id, profileId))
      .returning();

    if (!profile) return res.status(404).json({ message: "Profile tidak ditemukan" });

    await db
      .update(customerVerificationDocumentsTable)
      .set({ verificationStatus: "VERIFIED", verifiedBy: adminName, verifiedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(customerVerificationDocumentsTable.profileId, profileId),
          eq(customerVerificationDocumentsTable.verificationStatus, "PENDING_REVIEW"),
        ),
      );

    if (profile.customerId) {
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, profile.customerId))
        .limit(1);

      const phone = customer?.phone ?? profile.picWhatsapp;
      const domain = await getPreferredDomain();
      const msg =
        `✅ *Verifikasi Customer Disetujui*\n\n` +
        `Halo ${profile.companyName ?? customer?.name ?? ""},\n\n` +
        `Verifikasi dokumen perusahaan Anda telah *disetujui* oleh tim kami.\n` +
        `Status: *VERIFIED*\n` +
        `Berlaku hingga: ${expiredAt.toLocaleDateString("id-ID")}\n\n` +
        `${notes ? `Catatan: ${notes}\n\n` : ""}` +
        `Silakan login ke portal untuk melihat status lengkap:\nhttps://${domain}/profile/company-verification`;

      await sendVerificationWA(phone, msg, "customer-verification-approved");
    }

    logger.info({ profileId, adminName }, "[customerVerification] approved");
    return res.json({ ok: true, message: "Verifikasi berhasil disetujui" });
  } catch (err) {
    logger.error({ err }, "[customerVerification] approve error");
    return res.status(500).json({ message: "Gagal approve verifikasi" });
  }
});

// POST /api/customer-verification/admin/:profileId/reject
customerVerificationAdminRouter.post("/:profileId/reject", requireClerkUser, async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(String(req.params.profileId), 10);
    if (isNaN(profileId)) return res.status(400).json({ message: "ID tidak valid" });

    const { notes } = req.body as { notes?: string };
    if (!notes) return res.status(400).json({ message: "Alasan penolakan wajib diisi" });

    const adminName = (req as PortalAuthReq & { user?: { email?: string } }).user?.email ?? "admin";

    const [profile] = await db
      .update(portalCustomerProfilesTable)
      .set({
        verificationStatus: "REJECTED",
        isVerified: false,
        verificationNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(portalCustomerProfilesTable.id, profileId))
      .returning();

    if (!profile) return res.status(404).json({ message: "Profile tidak ditemukan" });

    if (profile.customerId) {
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, profile.customerId))
        .limit(1);

      const phone = customer?.phone ?? profile.picWhatsapp;
      const domain = await getPreferredDomain();
      const msg =
        `❌ *Verifikasi Customer Ditolak*\n\n` +
        `Halo ${profile.companyName ?? customer?.name ?? ""},\n\n` +
        `Mohon maaf, pengajuan verifikasi dokumen perusahaan Anda *ditolak*.\n\n` +
        `Alasan: ${notes}\n\n` +
        `Silakan perbaiki dokumen dan ajukan kembali:\nhttps://${domain}/profile/company-verification`;

      await sendVerificationWA(phone, msg, "customer-verification-rejected");
    }

    logger.info({ profileId, adminName }, "[customerVerification] rejected");
    return res.json({ ok: true, message: "Verifikasi ditolak" });
  } catch (err) {
    logger.error({ err }, "[customerVerification] reject error");
    return res.status(500).json({ message: "Gagal reject verifikasi" });
  }
});

// POST /api/customer-verification/admin/:profileId/request-revision
customerVerificationAdminRouter.post("/:profileId/request-revision", requireClerkUser, async (req: Request, res: Response) => {
  try {
    const profileId = parseInt(String(req.params.profileId), 10);
    if (isNaN(profileId)) return res.status(400).json({ message: "ID tidak valid" });

    const { notes } = req.body as { notes?: string };
    if (!notes) return res.status(400).json({ message: "Catatan revisi wajib diisi" });

    const adminName = (req as PortalAuthReq & { user?: { email?: string } }).user?.email ?? "admin";

    const [profile] = await db
      .update(portalCustomerProfilesTable)
      .set({
        verificationStatus: "NEED_REVISION",
        verificationNotes: notes,
        updatedAt: new Date(),
      })
      .where(eq(portalCustomerProfilesTable.id, profileId))
      .returning();

    if (!profile) return res.status(404).json({ message: "Profile tidak ditemukan" });

    if (profile.customerId) {
      const [customer] = await db
        .select()
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.id, profile.customerId))
        .limit(1);

      const phone = customer?.phone ?? profile.picWhatsapp;
      const domain = await getPreferredDomain();
      const msg =
        `⚠️ *Dokumen Perlu Direvisi*\n\n` +
        `Halo ${profile.companyName ?? customer?.name ?? ""},\n\n` +
        `Pengajuan verifikasi Anda memerlukan perbaikan dokumen.\n\n` +
        `Catatan admin: ${notes}\n\n` +
        `Silakan upload ulang dokumen yang diperlukan:\nhttps://${domain}/profile/company-verification`;

      await sendVerificationWA(phone, msg, "customer-verification-revision");
    }

    logger.info({ profileId, adminName }, "[customerVerification] request-revision");
    return res.json({ ok: true, message: "Permintaan revisi berhasil dikirim" });
  } catch (err) {
    logger.error({ err }, "[customerVerification] request-revision error");
    return res.status(500).json({ message: "Gagal minta revisi" });
  }
});

// PUT /api/customer-verification/admin/:profileId/documents/:docId/review
customerVerificationAdminRouter.put(
  "/:profileId/documents/:docId/review",
  requireClerkUser,
  async (req: Request, res: Response) => {
    try {
      const profileId = parseInt(String(req.params.profileId), 10);
      const docId = parseInt(String(req.params.docId), 10);
      if (isNaN(profileId) || isNaN(docId)) return res.status(400).json({ message: "ID tidak valid" });

      const { action, rejectionReason, expiryDate } = req.body as {
        action: "approve" | "reject";
        rejectionReason?: string;
        expiryDate?: string;
      };

      if (!["approve", "reject"].includes(action)) {
        return res.status(400).json({ message: "action harus 'approve' atau 'reject'" });
      }
      if (action === "reject" && !rejectionReason) {
        return res.status(400).json({ message: "rejectionReason wajib diisi untuk reject" });
      }

      const adminName = (req as PortalAuthReq & { user?: { email?: string } }).user?.email ?? "admin";

      const [updated] = await db
        .update(customerVerificationDocumentsTable)
        .set({
          verificationStatus: action === "approve" ? "VERIFIED" : "REJECTED",
          verifiedBy: adminName,
          verifiedAt: action === "approve" ? new Date() : null,
          rejectionReason: action === "reject" ? (rejectionReason ?? null) : null,
          expiryDate: action === "approve" && expiryDate ? new Date(expiryDate) : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(customerVerificationDocumentsTable.id, docId),
            eq(customerVerificationDocumentsTable.profileId, profileId),
          ),
        )
        .returning();

      if (!updated) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

      logger.info({ docId, profileId, action, adminName }, "[customerVerification] doc reviewed");
      return res.json({ ok: true, document: updated });
    } catch (err) {
      logger.error({ err }, "[customerVerification] doc review error");
      return res.status(500).json({ message: "Gagal review dokumen" });
    }
  },
);

// GET /api/customer-verification/admin/:profileId/signed-url/:docId
customerVerificationAdminRouter.get(
  "/:profileId/signed-url/:docId",
  requireClerkUser,
  async (req: Request, res: Response) => {
    try {
      const profileId = parseInt(String(req.params.profileId), 10);
      const docId = parseInt(String(req.params.docId), 10);

      const [doc] = await db
        .select()
        .from(customerVerificationDocumentsTable)
        .where(
          and(
            eq(customerVerificationDocumentsTable.id, docId),
            eq(customerVerificationDocumentsTable.profileId, profileId),
          ),
        )
        .limit(1);

      if (!doc) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

      const signedUrl = await (storage as any).getSignedUrl(doc.fileUrl, 3600);
      return res.json({ url: signedUrl });
    } catch (err) {
      logger.error({ err }, "[customerVerification] signed-url error");
      return res.status(500).json({ message: "Gagal generate URL" });
    }
  },
);

// GET /api/customer-verification/signed-url/:docId — portal customer get their own doc
customerVerificationRouter.get(
  "/signed-url/:docId",
  requirePortalAuth,
  async (req: Request, res: Response) => {
    try {
      const authReq = req as PortalAuthReq;
      const customerId = authReq.portalCustomerId;
      if (!customerId) return res.status(401).json({ message: "Unauthorized" });

      const docId = parseInt(String(req.params.docId), 10);
      const profile = await getOrCreateProfile(customerId);

      const [doc] = await db
        .select()
        .from(customerVerificationDocumentsTable)
        .where(
          and(
            eq(customerVerificationDocumentsTable.id, docId),
            eq(customerVerificationDocumentsTable.profileId, profile.id),
          ),
        )
        .limit(1);

      if (!doc) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

      const signedUrl = await (storage as any).getSignedUrl(doc.fileUrl, 3600);
      return res.json({ url: signedUrl });
    } catch (err) {
      logger.error({ err }, "[customerVerification] signed-url customer error");
      return res.status(500).json({ message: "Gagal generate URL" });
    }
  },
);

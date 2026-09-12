/**
 * vendorStatus.ts
 * ──────────────────────────────────────────────────────────────────────────────
 * Routes untuk manajemen status vendor, dokumen legalitas, rating, dan riwayat status.
 * Semua endpoint memerlukan auth admin/staff (makeRbacGuard("purchase") dipasang di index.ts).
 *
 * Base path: /api/vendor-status
 *
 * Hardening (PHASE FINAL):
 *   P0  — Storage error propagasi (tidak lagi .catch(() => null))
 *   P1  — Zod runtime validation via validateBody()
 *   P2  — Optimistic locking via expectedUpdatedAt (opsional, backward compat)
 *   B   — Audit log via logVendorAudit()
 *   C   — Soft delete dokumen (deleted_at / deleted_by)
 */

import { Router, type Request, type Response } from "express";
import multer from "multer";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  suppliersTable,
  supplierDocumentsTable,
  supplierStatusHistoryTable,
  supplierReviewsTable,
} from "@workspace/db";
import {
  updateSupplierStatus,
  verifySupplier,
  updateMarketplaceStatus,
  canSupplierParticipateInTransaction,
  getDocumentWarnings,
  type SupplierStatus,
} from "../lib/services/supplierStatusService.js";
import { uploadToSupabase, deleteFromSupabase } from "../lib/supabaseStorage.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import {
  VendorStatusSchema,
  MarketplaceStatusSchema,
  VendorProfileAdminSchema,
  VendorDocumentSchema,
  VendorDocumentVerifySchema,
  VendorReviewModerationSchema,
} from "../lib/schemas/vendor/index.js";
import {
  logVendorAudit,
  actorFromReq,
  ipFromReq,
  uaFromReq,
} from "../lib/services/vendorAuditLogService.js";

const router = Router();

// ── Middleware upload file (max 5 MB) ─────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Tipe file tidak diizinkan. Gunakan JPG, PNG, WebP, atau PDF."));
    }
  },
});

// ── GET /api/vendor-status/:id — ringkasan status vendor ────────────────────
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [vendor] = await db
    .select({
      id: suppliersTable.id,
      name: suppliersTable.name,
      status: suppliersTable.status,
      isActive: suppliersTable.isActive,
      isVerified: suppliersTable.isVerified,
      verifiedAt: suppliersTable.verifiedAt,
      verifiedBy: suppliersTable.verifiedBy,
      statusReason: suppliersTable.statusReason,
      statusChangedAt: suppliersTable.statusChangedAt,
      statusChangedBy: suppliersTable.statusChangedBy,
      marketplaceStatus: suppliersTable.marketplaceStatus,
      marketplacePublishedAt: suppliersTable.marketplacePublishedAt,
      vendorCode: suppliersTable.vendorCode,
      publicSlug: suppliersTable.publicSlug,
      updatedAt: suppliersTable.updatedAt,
    })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, id))
    .limit(1);

  if (!vendor) return res.status(404).json({ message: "Vendor tidak ditemukan" });

  // GET documents: filter out soft-deleted
  const docs = await db
    .select({
      documentType: supplierDocumentsTable.documentType,
      verificationStatus: supplierDocumentsTable.verificationStatus,
      expiresAt: supplierDocumentsTable.expiresAt,
    })
    .from(supplierDocumentsTable)
    .where(
      and(
        eq(supplierDocumentsTable.supplierId, id),
        isNull(supplierDocumentsTable.deletedAt),
      )
    );

  const transactionCheck = canSupplierParticipateInTransaction(vendor.status ?? "active");

  return res.json({
    ...vendor,
    transactionAllowed: transactionCheck.allowed,
    transactionBlockReason: transactionCheck.reason ?? null,
    documentWarnings: getDocumentWarnings(docs.map((d) => ({
      documentType: d.documentType,
      verificationStatus: d.verificationStatus ?? "pending",
      expiresAt: d.expiresAt,
    }))),
  });
});

// ── PATCH /api/vendor-status/:id/status — ubah status vendor ────────────────
router.patch(
  "/:id/status",
  validateBody(VendorStatusSchema),
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

    const { status, reason } = req.body as { status: SupplierStatus; reason?: string | null };
    const actor = actorFromReq(req);

    // Ambil state sebelum perubahan untuk audit log
    const [before] = await db
      .select({ status: suppliersTable.status, isActive: suppliersTable.isActive })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, id))
      .limit(1);

    if (!before) return res.status(404).json({ message: "Vendor tidak ditemukan" });

    try {
      await updateSupplierStatus({
        supplierId: id,
        newStatus: status,
        reason: reason ?? undefined,
        actorUserId: actor,
      });

      void logVendorAudit({
        supplierId: id,
        action: "status_changed",
        actor,
        before: { status: before.status, isActive: before.isActive },
        after: { status, reason: reason ?? null },
        ip: ipFromReq(req),
        userAgent: uaFromReq(req),
      });

      return res.json({ ok: true, status, message: `Status vendor berhasil diubah ke "${status}"` });
    } catch (err: any) {
      return res.status(400).json({ message: err?.message ?? "Gagal mengubah status" });
    }
  }
);

// ── PATCH /api/vendor-status/:id/verify — verifikasi vendor ─────────────────
router.patch("/:id/verify", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const actor = actorFromReq(req);

  const [before] = await db
    .select({ isVerified: suppliersTable.isVerified, status: suppliersTable.status })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, id))
    .limit(1);

  if (!before) return res.status(404).json({ message: "Vendor tidak ditemukan" });

  try {
    await verifySupplier({ supplierId: id, actorUserId: actor });

    void logVendorAudit({
      supplierId: id,
      action: "vendor_verified",
      actor,
      before: { isVerified: before.isVerified, status: before.status },
      after: { isVerified: true },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.json({ ok: true, isVerified: true });
  } catch (err: any) {
    return res.status(400).json({ message: err?.message ?? "Gagal verifikasi vendor" });
  }
});

// ── PATCH /api/vendor-status/:id/marketplace-status — publish/unpublish ──────
router.patch(
  "/:id/marketplace-status",
  validateBody(MarketplaceStatusSchema),
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

    const { marketplaceStatus } = req.body as { marketplaceStatus: string };
    const actor = actorFromReq(req);

    const [before] = await db
      .select({ marketplaceStatus: suppliersTable.marketplaceStatus })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, id))
      .limit(1);

    const result = await updateMarketplaceStatus({
      supplierId: id,
      newMarketplaceStatus: marketplaceStatus as any,
      actorUserId: actor,
    });

    if (!result.ok) return res.status(400).json({ message: result.error });

    const auditAction =
      marketplaceStatus === "published"
        ? "marketplace_published"
        : marketplaceStatus === "unpublished"
          ? "marketplace_unpublished"
          : "marketplace_status_changed";

    void logVendorAudit({
      supplierId: id,
      action: auditAction,
      actor,
      before: { marketplaceStatus: before?.marketplaceStatus },
      after: { marketplaceStatus },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.json({ ok: true, marketplaceStatus });
  }
);

// ── PATCH /api/vendor-status/:id/profile — update profil marketplace ─────────
router.patch(
  "/:id/profile",
  validateBody(VendorProfileAdminSchema),
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

    const { descriptionPublic, serviceAreas, isPremium, isFeatured, expectedUpdatedAt } = req.body as {
      descriptionPublic?: string | null;
      serviceAreas?: string[] | null;
      isPremium?: boolean;
      isFeatured?: boolean;
      expectedUpdatedAt?: string;
    };

    const actor = actorFromReq(req);

    // Optimistic locking: cek updatedAt jika disertakan client
    const [current] = await db
      .select({
        descriptionPublic: suppliersTable.descriptionPublic,
        serviceAreas: suppliersTable.serviceAreas,
        isPremium: suppliersTable.isPremium,
        isFeatured: suppliersTable.isFeatured,
        updatedAt: suppliersTable.updatedAt,
      })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, id))
      .limit(1);

    if (!current) return res.status(404).json({ message: "Vendor tidak ditemukan" });

    if (expectedUpdatedAt) {
      const expected = new Date(expectedUpdatedAt).getTime();
      const actual = current.updatedAt ? new Date(current.updatedAt).getTime() : 0;
      if (Math.abs(expected - actual) > 1000) {
        return res.status(409).json({
          message: "Conflict: data telah diubah oleh pihak lain. Refresh dan coba lagi.",
          currentUpdatedAt: current.updatedAt,
        });
      }
    }

    const updates: Record<string, unknown> = { updatedAt: new Date() };

    if (descriptionPublic !== undefined) updates.descriptionPublic = String(descriptionPublic || "").trim() || null;
    if (serviceAreas !== undefined) {
      updates.serviceAreas = Array.isArray(serviceAreas) ? serviceAreas : null;
    }
    if (isPremium !== undefined) updates.isPremium = Boolean(isPremium);
    if (isFeatured !== undefined) updates.isFeatured = Boolean(isFeatured);

    if (Object.keys(updates).length <= 1) {
      return res.status(400).json({ message: "Tidak ada field yang diubah" });
    }

    await db.update(suppliersTable).set(updates).where(eq(suppliersTable.id, id));

    void logVendorAudit({
      supplierId: id,
      action: "profile_edited_admin",
      actor,
      before: {
        descriptionPublic: current.descriptionPublic,
        serviceAreas: current.serviceAreas,
        isPremium: current.isPremium,
        isFeatured: current.isFeatured,
      },
      after: { descriptionPublic, serviceAreas, isPremium, isFeatured },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.json({ ok: true });
  }
);

// ── POST /api/vendor-status/:id/logo — upload logo vendor ────────────────────
router.post(
  "/:id/logo",
  (req: any, res: any, next: any) =>
    (upload.single("file") as any)(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Ukuran file maks 5 MB" });
      if (err?.message) return res.status(400).json({ error: err.message });
      next(err);
    }),
  async (req: any, res: any) => {
    const id = parseInt(String(req.params.id));
    if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });
    if (!req.file) return res.status(400).json({ error: "Tidak ada file yang diunggah" });

    const actor = actorFromReq(req);

    // P0-FIX: argumen uploadToSupabase dengan urutan yang benar (buffer, contentType, folder)
    const result = await uploadToSupabase(
      req.file.buffer,
      req.file.mimetype,
      "vendor/logos",
    );
    // uploadToSupabase melempar error jika gagal — tidak lagi .catch(() => null)
    // Jika sampai di sini, upload berhasil.

    const [before] = await db
      .select({ logoUrl: suppliersTable.logoUrl })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, id))
      .limit(1);

    await db
      .update(suppliersTable)
      .set({ logoUrl: result.publicUrl, updatedAt: new Date() })
      .where(eq(suppliersTable.id, id));

    void logVendorAudit({
      supplierId: id,
      action: "logo_uploaded_admin",
      actor,
      before: { logoUrl: before?.logoUrl ?? null },
      after: { logoUrl: result.publicUrl },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.json({ ok: true, logoUrl: result.publicUrl });
  }
);

// ── GET /api/vendor-status/:id/documents — list dokumen legalitas ─────────────
router.get("/:id/documents", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  // C — soft delete: tampilkan hanya yang belum dihapus
  const docs = await db
    .select()
    .from(supplierDocumentsTable)
    .where(
      and(
        eq(supplierDocumentsTable.supplierId, id),
        isNull(supplierDocumentsTable.deletedAt),
      )
    )
    .orderBy(desc(supplierDocumentsTable.createdAt));

  return res.json(docs);
});

// ── POST /api/vendor-status/:id/documents — upload dokumen legalitas ──────────
router.post(
  "/:id/documents",
  (req: any, res: any, next: any) =>
    (upload.single("file") as any)(req, res, (err: any) => {
      if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "Ukuran file maks 5 MB" });
      if (err?.message) return res.status(400).json({ error: err.message });
      next(err);
    }),
  validateBody(VendorDocumentSchema),
  async (req: any, res: any) => {
    const supplierId = parseInt(String(req.params.id));
    if (isNaN(supplierId)) return res.status(400).json({ message: "ID tidak valid" });

    const { documentType, documentNumber, documentName, issuedAt, expiresAt } = req.body;
    const actor = actorFromReq(req);

    let fileUrl: string | null = null;
    if (req.file) {
      // P0-FIX: urutan argumen yang benar, error propagasi jika upload gagal
      const uploadResult = await uploadToSupabase(
        req.file.buffer,
        req.file.mimetype,
        "vendor/documents",
      );
      fileUrl = uploadResult.publicUrl;
    }

    const [created] = await db
      .insert(supplierDocumentsTable)
      .values({
        supplierId,
        documentType: String(documentType).toUpperCase(),
        documentNumber: documentNumber ?? null,
        documentName: documentName ?? null,
        fileUrl,
        issuedAt: issuedAt ? String(issuedAt) : null,
        expiresAt: expiresAt ? String(expiresAt) : null,
        source: "admin_upload",
        uploadedBy: actor,
        verificationStatus: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    void logVendorAudit({
      supplierId,
      action: "document_uploaded",
      actor,
      before: null,
      after: {
        documentType: created.documentType,
        documentNumber: created.documentNumber,
        fileUrl: created.fileUrl,
      },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.status(201).json(created);
  }
);

// ── PATCH /api/vendor-status/:id/documents/:docId — verifikasi/tolak dokumen ──
router.patch(
  "/:id/documents/:docId",
  validateBody(VendorDocumentVerifySchema),
  async (req: Request, res: Response) => {
    const supplierId = parseInt(String(req.params.id));
    const docId = parseInt(String(req.params.docId));
    if (isNaN(supplierId) || isNaN(docId)) return res.status(400).json({ message: "ID tidak valid" });

    const { verificationStatus, rejectionReason } = req.body as {
      verificationStatus: "pending" | "verified" | "rejected";
      rejectionReason?: string | null;
    };
    const actor = actorFromReq(req);

    // Ambil before state untuk audit log
    const [before] = await db
      .select({
        verificationStatus: supplierDocumentsTable.verificationStatus,
        documentType: supplierDocumentsTable.documentType,
      })
      .from(supplierDocumentsTable)
      .where(
        and(
          eq(supplierDocumentsTable.id, docId),
          eq(supplierDocumentsTable.supplierId, supplierId),
          isNull(supplierDocumentsTable.deletedAt),
        )
      )
      .limit(1);

    if (!before) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

    const [updated] = await db
      .update(supplierDocumentsTable)
      .set({
        verificationStatus,
        verifiedAt: verificationStatus === "verified" ? new Date() : null,
        verifiedBy: verificationStatus === "verified" ? actor : null,
        rejectionReason: verificationStatus === "rejected" ? (rejectionReason ?? null) : null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(supplierDocumentsTable.id, docId),
          eq(supplierDocumentsTable.supplierId, supplierId),
          isNull(supplierDocumentsTable.deletedAt),
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

    void logVendorAudit({
      supplierId,
      action: verificationStatus === "verified" ? "document_verified" : "document_rejected",
      actor,
      before: { verificationStatus: before.verificationStatus, documentType: before.documentType },
      after: { verificationStatus, rejectionReason: rejectionReason ?? null },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.json(updated);
  }
);

// ── DELETE /api/vendor-status/:id/documents/:docId — soft delete dokumen ────────
// C — Soft delete: tidak langsung menghapus, set deleted_at + deleted_by
// Admin masih bisa melihat histori via /documents?includeDeleted=true (belum diimplementasi)
router.delete("/:id/documents/:docId", async (req: Request, res: Response) => {
  const supplierId = parseInt(String(req.params.id));
  const docId = parseInt(String(req.params.docId));
  if (isNaN(supplierId) || isNaN(docId)) return res.status(400).json({ message: "ID tidak valid" });

  const actor = actorFromReq(req);

  // Ambil dokumen dulu untuk validasi + audit
  const [doc] = await db
    .select()
    .from(supplierDocumentsTable)
    .where(
      and(
        eq(supplierDocumentsTable.id, docId),
        eq(supplierDocumentsTable.supplierId, supplierId),
        isNull(supplierDocumentsTable.deletedAt),
      )
    )
    .limit(1);

  if (!doc) return res.status(404).json({ message: "Dokumen tidak ditemukan" });

  // Soft delete: set deleted_at + deleted_by
  await db
    .update(supplierDocumentsTable)
    .set({
      deletedAt: new Date(),
      deletedBy: actor,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(supplierDocumentsTable.id, docId),
        eq(supplierDocumentsTable.supplierId, supplierId),
      )
    );

  // File di storage TIDAK dihapus agar admin bisa melihat histori
  // Jika ingin purge storage setelah periode retensi, gunakan cleanup job terpisah

  void logVendorAudit({
    supplierId,
    action: "document_deleted",
    actor,
    before: {
      documentType: doc.documentType,
      documentNumber: doc.documentNumber,
      fileUrl: doc.fileUrl,
      verificationStatus: doc.verificationStatus,
    },
    after: { deletedAt: new Date().toISOString(), deletedBy: actor },
    ip: ipFromReq(req),
    userAgent: uaFromReq(req),
  });

  return res.json({ ok: true });
});

// ── GET /api/vendor-status/:id/status-history — riwayat perubahan status ──────
router.get("/:id/status-history", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const history = await db
    .select()
    .from(supplierStatusHistoryTable)
    .where(eq(supplierStatusHistoryTable.supplierId, id))
    .orderBy(desc(supplierStatusHistoryTable.createdAt))
    .limit(100);

  return res.json(history);
});

// ── GET /api/vendor-status/:id/reviews — list review vendor ──────────────────
router.get("/:id/reviews", async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const reviews = await db
    .select()
    .from(supplierReviewsTable)
    .where(eq(supplierReviewsTable.supplierId, id))
    .orderBy(desc(supplierReviewsTable.createdAt))
    .limit(50);

  return res.json(reviews);
});

// ── PATCH /api/vendor-status/:id/reviews/:reviewId — moderasi review ──────────
router.patch(
  "/:id/reviews/:reviewId",
  validateBody(VendorReviewModerationSchema),
  async (req: Request, res: Response) => {
    const supplierId = parseInt(String(req.params.id));
    const reviewId = parseInt(String(req.params.reviewId));
    if (isNaN(supplierId) || isNaN(reviewId)) return res.status(400).json({ message: "ID tidak valid" });

    const { moderationStatus, isPublished } = req.body as {
      moderationStatus?: string;
      isPublished?: boolean;
    };
    const actor = actorFromReq(req);

    const [before] = await db
      .select({
        moderationStatus: supplierReviewsTable.moderationStatus,
        isPublished: supplierReviewsTable.isPublished,
      })
      .from(supplierReviewsTable)
      .where(
        and(
          eq(supplierReviewsTable.id, reviewId),
          eq(supplierReviewsTable.supplierId, supplierId),
        )
      )
      .limit(1);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (moderationStatus !== undefined) updates.moderationStatus = moderationStatus;
    if (isPublished !== undefined) updates.isPublished = Boolean(isPublished);

    const [updated] = await db
      .update(supplierReviewsTable)
      .set(updates)
      .where(
        and(
          eq(supplierReviewsTable.id, reviewId),
          eq(supplierReviewsTable.supplierId, supplierId),
        )
      )
      .returning();

    if (!updated) return res.status(404).json({ message: "Review tidak ditemukan" });

    void logVendorAudit({
      supplierId,
      action: "review_moderated",
      actor,
      before: before
        ? { moderationStatus: before.moderationStatus, isPublished: before.isPublished }
        : null,
      after: { moderationStatus, isPublished },
      ip: ipFromReq(req),
      userAgent: uaFromReq(req),
    });

    return res.json(updated);
  }
);

export default router;

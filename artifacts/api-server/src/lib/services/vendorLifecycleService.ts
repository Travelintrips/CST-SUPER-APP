/**
 * vendorLifecycleService
 * ─────────────────────────────────────────────────────────────────────────────
 * Meng-bridge antara onboarding_approvals (portal) dan suppliers + catalog.
 *
 * Dipanggil setelah admin melakukan approve vendor di PATCH /api/portal/admin/approvals/:id
 *
 * Events:
 *   VendorApproved  → createOrUpdateSupplier()
 *                  → updateVendorProfileBridge()
 *                  → generateFreshSubmissionLink()
 *                  → sendVendorApprovedNotification()   ← ALWAYS outside transaction
 *
 *   ProductApproved → sendProductApprovedNotification()
 *   ProductRejected → sendProductRejectedNotification()
 */

import { eq, and } from "drizzle-orm";
import { generateTokenPair } from "../tokenUtils.js";
import { db } from "@workspace/db";
import {
  suppliersTable,
  vendorProfilesTable,
  portalCustomersTable,
  userProfilesTable,
  vendorCatalogSubmissionLinksTable,
  notificationLogsTable,
  vendorNotificationsTable,
  supplierDocumentsTable,
  identityDocumentsTable,
} from "@workspace/db";
import { updateMarketplaceStatus, verifySupplier } from "./supplierStatusService.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { getWaTemplateConfig, renderTemplate } from "../orderNotification.js";
import { NotificationService } from "./notificationService.js";
import { logger } from "../logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VendorApprovedResult = {
  supplierId: number;
  supplierName: string;
  supplierAlreadyExisted: boolean;
  submissionLinkId: number;
  submissionLinkToken: string;
  submissionLinkUrl: string;
  waNotificationSent: boolean;
};

/**
 * Alias that lets the same helper functions work with `db` or a drizzle `tx`.
 * Drizzle transactions expose the same query surface as the base db object.
 */
type DbLike = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — Create or Update Supplier
// ─────────────────────────────────────────────────────────────────────────────

async function createOrUpdateSupplier(
  customerId: number,
  dbOrTx: DbLike = db,
): Promise<{
  supplierId: number;
  supplierName: string;
  alreadyExisted: boolean;
}> {
  const [[vp], [up], [customer]] = await Promise.all([
    dbOrTx.select().from(vendorProfilesTable).where(eq(vendorProfilesTable.customerId, customerId)),
    dbOrTx.select().from(userProfilesTable).where(eq(userProfilesTable.customerId, customerId)),
    dbOrTx.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, customerId)),
  ]);

  const vendorName = vp?.companyName || up?.fullName || customer?.name || "Vendor Baru";

  // Idempotency: cek via supplierId yang tersimpan di vendor_profiles
  if (vp?.supplierId) {
    const [existing] = await dbOrTx
      .select({ id: suppliersTable.id, name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, vp.supplierId))
      .limit(1);
    if (existing) {
      // Update supplier dengan data terbaru dari vendor profile
      await dbOrTx
        .update(suppliersTable)
        .set({
          name:          vp.companyName ?? existing.name,
          contactEmail:  vp.email ?? customer?.email ?? null,
          contactPerson: vp.picName ?? up?.fullName ?? customer?.name ?? null,
          phone:         vp.phone ?? up?.phone ?? customer?.phone ?? null,
          address:       vp.fullAddress ?? up?.address ?? null,
          taxId:         vp.npwp ?? null,
          serviceType:   vp.serviceType ?? null,
        })
        .where(eq(suppliersTable.id, existing.id));
      return { supplierId: existing.id, supplierName: existing.name, alreadyExisted: true };
    }
  }

  // Idempotency: fallback cek via email
  let existing: { id: number; name: string } | undefined;
  if (customer?.email) {
    const rows = await dbOrTx
      .select({ id: suppliersTable.id, name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.contactEmail, customer.email))
      .limit(1);
    existing = rows[0];
  }

  if (existing) {
    return { supplierId: existing.id, supplierName: existing.name, alreadyExisted: true };
  }

  // Create new supplier — status awal = pending, belum terverifikasi
  const [newSupplier] = await dbOrTx
    .insert(suppliersTable)
    .values({
      name:          vendorName,
      contactEmail:  vp?.email ?? customer?.email ?? null,
      contactPerson: vp?.picName ?? up?.fullName ?? customer?.name ?? null,
      phone:         vp?.phone ?? up?.phone ?? customer?.phone ?? null,
      address:       vp?.fullAddress ?? up?.address ?? null,
      taxId:         vp?.npwp ?? null,
      serviceType:   vp?.serviceType ?? null,
      isActive:      false,
      status:        "pending",
      isVerified:    false,
      logo:          "🏢",
    })
    .returning();

  return { supplierId: newSupplier.id, supplierName: newSupplier.name, alreadyExisted: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2 — Update vendor_profiles bridge fields
// ─────────────────────────────────────────────────────────────────────────────

async function updateVendorProfileBridge(
  customerId: number,
  supplierId: number,
  catalogSubmissionLinkId: number,
  dbOrTx: DbLike = db,
): Promise<void> {
  await dbOrTx
    .update(vendorProfilesTable)
    .set({
      supplierId,
      catalogSubmissionLinkId,
      verificationStatus: "verified",
      approvedAt:         new Date(),
      updatedAt:          new Date(),
    })
    .where(eq(vendorProfilesTable.customerId, customerId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 3 — Generate fresh submission link (nonaktifkan lama, buat baru)
// Default expiry: 30 days from now.
// ─────────────────────────────────────────────────────────────────────────────

async function generateFreshSubmissionLink(
  supplierId: number,
  supplierName: string,
  createdBy: string,
  dbOrTx: DbLike = db,
): Promise<{ id: number; token: string; url: string }> {
  // Approval retries must be deterministic. Reuse an existing active link
  // instead of creating a new link every time an already-approved vendor is
  // approved again. Expired links are replaced below.
  const [existingLink] = await dbOrTx
    .select({
      id: vendorCatalogSubmissionLinksTable.id,
      token: vendorCatalogSubmissionLinksTable.token,
      expiresAt: vendorCatalogSubmissionLinksTable.expiresAt,
    })
    .from(vendorCatalogSubmissionLinksTable)
    .where(
      and(
        eq(vendorCatalogSubmissionLinksTable.supplierId, supplierId),
        eq(vendorCatalogSubmissionLinksTable.isActive, true),
      )
    )
    .limit(1);

  if (existingLink && (!existingLink.expiresAt || existingLink.expiresAt > new Date())) {
    const devDomain = process.env.REPLIT_DEV_DOMAIN;
    const baseUrl = devDomain
      ? `https://${devDomain}`
      : (process.env.APP_BASE_URL ?? "");
    return {
      id: existingLink.id,
      token: existingLink.token,
      url: `${baseUrl}/api/vendor-catalog-engine/form/${existingLink.token}`,
    };
  }

  // Nonaktifkan semua link lama untuk supplier ini
  await dbOrTx
    .update(vendorCatalogSubmissionLinksTable)
    .set({ isActive: false })
    .where(
      and(
        eq(vendorCatalogSubmissionLinksTable.supplierId, supplierId),
        eq(vendorCatalogSubmissionLinksTable.isActive, true),
      )
    );

  // 30-day expiry (Task 4)
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  // Buat link baru — P0 hardening: 256-bit token + HMAC-SHA256 hash stored in DB
  const { raw: token, hash: tokenHash } = generateTokenPair();
  const [link] = await dbOrTx
    .insert(vendorCatalogSubmissionLinksTable)
    .values({
      token,       // kept for backward-compat lookup during transition
      tokenHash,   // P0 — HMAC-SHA256 stored in DB
      supplierId,
      vendorName:    supplierName,
      title:         "Upload Katalog Produk/Layanan",
      notes:         "Silakan isi formulir di bawah untuk mendaftarkan produk atau layanan Anda ke marketplace kami.",
      isActive:      true,
      expiresAt,
      createdBy,
    })
    .returning();

  const devDomain = process.env.REPLIT_DEV_DOMAIN;
  const baseUrl = devDomain
    ? `https://${devDomain}`
    : (process.env.APP_BASE_URL ?? "");
  const url = `${baseUrl}/api/vendor-catalog-engine/form/${token}`;

  return { id: link.id, token, url };
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — Send WA Notification (ALWAYS called outside any transaction)
// ─────────────────────────────────────────────────────────────────────────────

async function sendVendorApprovedNotification(
  customerId: number,
  supplierName: string,
  submissionLinkUrl: string,
): Promise<boolean> {
  try {
    const [[customer], [up]] = await Promise.all([
      db.select().from(portalCustomersTable).where(eq(portalCustomersTable.id, customerId)),
      db.select().from(userProfilesTable).where(eq(userProfilesTable.customerId, customerId)),
    ]);

    const phone = up?.phone ?? customer?.phone;
    if (!phone) return false;

    const defaultTpl = [
      `✅ *Selamat! Akun Vendor Anda Disetujui!*`,
      ``,
      `Hai {{vendorName}},`,
      ``,
      `Akun vendor Anda telah diverifikasi dan disetujui oleh tim kami.`,
      ``,
      `Langkah selanjutnya:`,
      `📦 Upload katalog produk/layanan Anda melalui link berikut:`,
      `{{submissionLinkUrl}}`,
      ``,
      `Link ini sudah siap digunakan. Setelah upload, tim kami akan mereview katalog Anda.`,
      ``,
      `Terima kasih telah bergabung!`,
    ];

    const tplBody = await getWaTemplateConfig("vendor", "vendor_onboarding_approved", defaultTpl);
    const msg = renderTemplate(tplBody, {
      vendorName: supplierName,
      submissionLinkUrl,
    });

    await sendWhatsApp(phone, msg);

    // Log notification
    await db.insert(notificationLogsTable).values({
      channel:   "wa",
      recipient: phone,
      subject:   "Vendor Approved",
      message:   msg,
      status:    "sent",
      context:   "vendor_onboarding",
      refType:   "portal_customer",
      refId:     String(customerId),
    }).catch(() => {});

    return true;
  } catch (e) {
    console.error("[vendorLifecycle] sendVendorApprovedNotification error:", e);
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 5 — Product Approved Notification
// ─────────────────────────────────────────────────────────────────────────────

export async function sendProductApprovedNotification(
  supplierId: number,
  productName: string,
  catalogItemId: number,
): Promise<void> {
  try {
    const [supplier] = await db
      .select({ contactEmail: suppliersTable.contactEmail, phone: suppliersTable.phone, name: suppliersTable.name })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, supplierId));

    if (!supplier?.phone) return;

    const defaultTpl = [
      `🎉 *Produk Berhasil Dipublikasikan!*`,
      ``,
      `Hai {{vendorName}},`,
      ``,
      `Produk Anda *"{{productName}}"* telah disetujui dan sekarang sudah tampil di marketplace kami.`,
      ``,
      `Pelanggan sudah bisa melihat dan memesan produk Anda.`,
      ``,
      `Terima kasih!`,
    ];

    const tplBody = await getWaTemplateConfig("vendor", "vendor_product_approved", defaultTpl);
    const msg = renderTemplate(tplBody, {
      vendorName:  supplier.name ?? "Vendor",
      productName,
    });

    await sendWhatsApp(supplier.phone, msg);

    await db.insert(notificationLogsTable).values({
      channel:   "wa",
      recipient: supplier.phone,
      subject:   "Produk Disetujui",
      message:   msg,
      status:    "sent",
      context:   "vendor_catalog",
      refType:   "catalog_item",
      refId:     String(catalogItemId),
    }).catch(() => {});

    await NotificationService.notifyProductApproved({
      supplierId,
      vendorName:    supplier.name ?? "Vendor",
      productName,
      catalogItemId,
    });

    // ── Vendor in-app notification ────────────────────────────────────────────
    // Look up the portal_customers.id for this supplier via email/phone match
    const vendorId = await resolveVendorIdFromSupplier(supplierId, supplier.contactEmail, supplier.phone);
    if (vendorId) {
      await NotificationService.notifyProductApprovedForVendor({ vendorId, productName, catalogItemId });
    }
  } catch (e) {
    console.error("[vendorLifecycle] sendProductApprovedNotification error:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 6 — Product Rejected Notification
// ─────────────────────────────────────────────────────────────────────────────

export async function sendProductRejectedNotification(
  supplierId: number,
  productName: string,
  catalogItemId: number,
  reviewNotes: string | null,
): Promise<void> {
  try {
    const [supplier] = await db
      .select({ phone: suppliersTable.phone, name: suppliersTable.name, contactEmail: suppliersTable.contactEmail })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, supplierId));

    if (!supplier?.phone) return;

    const defaultTpl = [
      `❌ *Produk Ditolak*`,
      ``,
      `Hai {{vendorName}},`,
      ``,
      `Produk *"{{productName}}"* tidak dapat kami setujui saat ini.`,
      ``,
      `Alasan: {{reviewNotes}}`,
      ``,
      `Silakan perbaiki dan kirim ulang melalui link submission Anda.`,
      ``,
      `Hubungi kami jika ada pertanyaan.`,
    ];

    const tplBody = await getWaTemplateConfig("vendor", "vendor_product_rejected", defaultTpl);
    const msg = renderTemplate(tplBody, {
      vendorName:  supplier.name ?? "Vendor",
      productName,
      reviewNotes: reviewNotes ?? "Tidak memenuhi persyaratan katalog",
    });

    await sendWhatsApp(supplier.phone, msg);

    await db.insert(notificationLogsTable).values({
      channel:   "wa",
      recipient: supplier.phone,
      subject:   "Produk Ditolak",
      message:   msg,
      status:    "sent",
      context:   "vendor_catalog",
      refType:   "catalog_item",
      refId:     String(catalogItemId),
    }).catch(() => {});

    await NotificationService.notifyProductRejected({
      supplierId,
      vendorName:    supplier.name ?? "Vendor",
      productName,
      catalogItemId,
      reviewNotes,
    });

    // ── Vendor in-app notification ────────────────────────────────────────────
    const vendorId = await resolveVendorIdFromSupplier(supplierId, supplier.contactEmail, supplier.phone);
    if (vendorId) {
      await NotificationService.notifyProductRejectedForVendor({ vendorId, productName, catalogItemId, reviewNotes });
    }
  } catch (e) {
    console.error("[vendorLifecycle] sendProductRejectedNotification error:", e);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper — resolve portal_customers.id from a supplier record
// ─────────────────────────────────────────────────────────────────────────────

async function resolveVendorIdFromSupplier(
  supplierId: number,
  contactEmail: string | null,
  phone: string | null,
): Promise<number | null> {
  try {
    // Fastest: check vendor_profiles.supplier_id
    const [vp] = await db
      .select({ customerId: vendorProfilesTable.customerId })
      .from(vendorProfilesTable)
      .where(eq(vendorProfilesTable.supplierId, supplierId))
      .limit(1);
    if (vp) return vp.customerId;

    // Fallback: match by email
    if (contactEmail) {
      const [pc] = await db
        .select({ id: portalCustomersTable.id })
        .from(portalCustomersTable)
        .where(eq(portalCustomersTable.email, contactEmail))
        .limit(1);
      if (pc) return pc.id;
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
// Helper — migrate dokumen onboarding ke supplier_documents (idempotent)
// Source: identity_documents terhubung ke customerId via onboarding
// ─────────────────────────────────────────────────────────────────────────────

async function migrateOnboardingDocuments(
  customerId: number,
  supplierId: number,
  dbOrTx: DbLike = db,
): Promise<void> {
  // Ambil dokumen identitas yang terupload saat onboarding
  const docs = await dbOrTx
    .select()
    .from(identityDocumentsTable)
    .where(eq(identityDocumentsTable.customerId, customerId))
    .catch((e: unknown) => {
      logger.warn({ err: e, customerId, supplierId }, "migrateOnboardingDocuments: gagal membaca identity_documents (non-fatal, approval tetap lanjut)");
      return [] as typeof identityDocumentsTable.$inferSelect[];
    });

  if (!docs || docs.length === 0) return;

  for (const doc of docs) {
    // identity_documents.docType = "ktp" | "npwp" | "nib" dll
    const docType = doc.docType ?? "other";
    const fileUrl = doc.url ?? null;

    // Skip KTP — dokumen sensitif, tidak dimigrasi ke supplier_documents
    if (docType.toLowerCase() === "ktp") continue;

    // Idempotency: cek berdasarkan supplierId + documentType + fileUrl
    const existingRows = await dbOrTx
      .select({ id: supplierDocumentsTable.id })
      .from(supplierDocumentsTable)
      .where(
        and(
          eq(supplierDocumentsTable.supplierId, supplierId),
          eq(supplierDocumentsTable.documentType, docType),
        )
      )
      .limit(1)
      .catch((e: unknown) => {
        logger.warn({ err: e, supplierId, docType }, "migrateOnboardingDocuments: gagal cek idempotency supplier_documents (non-fatal)");
        return [] as { id: number }[];
      });

    if (existingRows && existingRows.length > 0) continue;

    await dbOrTx
      .insert(supplierDocumentsTable)
      .values({
        supplierId,
        documentType: docType.toUpperCase(),
        documentName: doc.fileName ?? docType,
        fileUrl,
        source: "vendor_onboarding",
        verificationStatus: "pending",
        uploadedAt: doc.createdAt ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .catch((e: unknown) => {
        // non-fatal — jangan gagalkan approval karena satu dokumen gagal dimigrasi,
        // tapi tetap log agar tidak hilang tanpa jejak
        logger.warn({ err: e, supplierId, docType }, "migrateOnboardingDocuments: gagal insert supplier_documents (non-fatal)");
      });
  }
}

// runVendorApprovedInTx — all DB writes inside the caller's transaction
// (Task 3: use this from portal.ts inside a db.transaction() block)
// ─────────────────────────────────────────────────────────────────────────────

export async function runVendorApprovedInTx(
  tx: DbLike,
  customerId: number,
  reviewedBy: string,
): Promise<{
  supplierId: number;
  supplierName: string;
  alreadyExisted: boolean;
  submissionLinkId: number;
  submissionLinkToken: string;
  submissionLinkUrl: string;
}> {
  // Step 1: Create/update supplier inside tx
  const { supplierId, supplierName, alreadyExisted } = await createOrUpdateSupplier(customerId, tx);

  // Step 2: Generate fresh submission link inside tx (sets 30-day expiry)
  const link = await generateFreshSubmissionLink(supplierId, supplierName, reviewedBy, tx);

  // Step 3: Update vendor_profiles bridge inside tx
  await updateVendorProfileBridge(customerId, supplierId, link.id, tx);

  // Step 4: Verifikasi supplier → status active + isVerified=true.
  // These are state-critical approval invariants. Do not swallow an error:
  // the surrounding transaction must roll back instead of committing a
  // vendor that is approved in the portal but invisible in Marketplace.
  await verifySupplier({
    supplierId,
    actorUserId: reviewedBy,
    dbOrTx: tx as Parameters<typeof verifySupplier>[0]["dbOrTx"],
  });

  const marketplaceResult = await updateMarketplaceStatus({
    supplierId,
    newMarketplaceStatus: "published",
    actorUserId: reviewedBy,
    dbOrTx: tx as Parameters<typeof updateMarketplaceStatus>[0]["dbOrTx"],
  });
  if (!marketplaceResult.ok) {
    throw new Error(`Vendor approval gagal dipublish ke Marketplace: ${marketplaceResult.error ?? "unknown error"}`);
  }

  // Step 5: Migrate dokumen onboarding → supplier_documents (idempotent)
  await migrateOnboardingDocuments(customerId, supplierId, tx).catch((e: unknown) => {
    logger.warn({ err: e, customerId, supplierId }, "runVendorApprovedInTx: migrateOnboardingDocuments gagal (non-fatal, approval tetap lanjut)");
  });

  // Step 6: Save vendor in-app notification inside tx
  await tx.insert(vendorNotificationsTable).values({
    vendorId: customerId,
    type:     "vendor_approved",
    title:    "✅ Akun Vendor Anda Disetujui",
    message:  `Selamat! Akun vendor ${supplierName} telah diverifikasi. Silakan upload katalog produk/layanan melalui link yang dikirim via WhatsApp.`,
    payload:  { submissionLinkUrl: link.url, supplierId },
  }).catch(() => {}); // non-fatal if vendor_notifications not yet created

  return {
    supplierId,
    supplierName,
    alreadyExisted,
    submissionLinkId:    link.id,
    submissionLinkToken: link.token,
    submissionLinkUrl:   link.url,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main orchestrator — backward-compatible public API
// Now internally wraps DB ops in db.transaction() for atomicity.
// WA notification always runs OUTSIDE the transaction.
// ─────────────────────────────────────────────────────────────────────────────

export async function runVendorApprovedLifecycle(
  customerId: number,
  reviewedBy: string,
): Promise<VendorApprovedResult> {
  // All DB writes in one atomic transaction
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const txResult = await db.transaction(async (tx: any) =>
    runVendorApprovedInTx(tx as DbLike, customerId, reviewedBy)
  );

  // WA notification OUTSIDE transaction (non-blocking on failure)
  const waNotificationSent = await sendVendorApprovedNotification(
    customerId,
    txResult.supplierName,
    txResult.submissionLinkUrl,
  );

  // Admin in-app notification OUTSIDE transaction
  await NotificationService.notifyVendorApproved({
    supplierId:        txResult.supplierId,
    supplierName:      txResult.supplierName,
    customerId,
    submissionLinkUrl: txResult.submissionLinkUrl,
    waNotificationSent,
    reviewedBy,
  });

  return {
    supplierId:             txResult.supplierId,
    supplierName:           txResult.supplierName,
    supplierAlreadyExisted: txResult.alreadyExisted,
    submissionLinkId:       txResult.submissionLinkId,
    submissionLinkToken:    txResult.submissionLinkToken,
    submissionLinkUrl:      txResult.submissionLinkUrl,
    waNotificationSent,
  };
}

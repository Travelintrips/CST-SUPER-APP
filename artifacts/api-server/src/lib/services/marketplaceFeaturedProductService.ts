/**
 * marketplaceFeaturedProductService.ts — Featured Product / Produk Unggulan
 *
 * Shared business logic used by BOTH Customer Portal admin and BizPortal admin
 * (same service, same tables — no separate backend). Vendor-facing mutations
 * also go through the functions here so validation never drifts between
 * call sites.
 *
 * Rules enforced here (Fase 11 — audit & security):
 *   - vendor tidak bisa mengajukan produk vendor lain (ownership check)
 *   - vendor tidak bisa mengubah price (price selalu dari package, backend)
 *   - admin action / payment verification / priority change → audit log
 *   - company isolation via catalog item → vendor → companyId snapshot
 *   - no duplicate active request (DB partial unique index + app-level check)
 *   - atomic update untuk approval/activation/expiry (db.transaction)
 *   - tidak ada featured tanpa expiry (activate always sets featuredUntil)
 */

import {
  db,
  mktFeaturedPackagesTable,
  mktFeaturedProductRequestsTable,
  vendorCatalogItemsTable,
  suppliersTable,
  type MktFeaturedPackage,
  type MktFeaturedProductRequest,
} from "@workspace/db";
import { eq, and, desc, sql, ne, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLog.js";
import { enqueueNotification } from "./marketplaceNotificationQueueService.js";
import { createAlertAndBroadcast } from "../alertHelpers.js";

async function _vendorPhone(vendorId: number): Promise<string | null> {
  const [row] = await db.select({ phone: suppliersTable.phone }).from(suppliersTable).where(eq(suppliersTable.id, vendorId));
  return row?.phone ?? null;
}

export class FeaturedProductError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = "FeaturedProductError";
  }
}

const ACTIVE_LIKE_STATUSES = ["pending", "approved", "active"] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Packages (admin)
// ─────────────────────────────────────────────────────────────────────────────

export async function listFeaturedPackages(
  includeInactive = false,
  options: { internalOnly?: boolean } = {},
): Promise<MktFeaturedPackage[]> {
  const conditions = includeInactive ? [] : [eq(mktFeaturedPackagesTable.isActive, true)];
  if (options.internalOnly === true) {
    conditions.push(eq(mktFeaturedPackagesTable.internalOnly, true));
  } else if (options.internalOnly === false) {
    conditions.push(eq(mktFeaturedPackagesTable.internalOnly, false));
  }
  return db
    .select()
    .from(mktFeaturedPackagesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(mktFeaturedPackagesTable.priorityWeight), mktFeaturedPackagesTable.name);
}

export interface CreateFeaturedPackageInput {
  code: string;
  name: string;
  description?: string | null;
  durationDays: number;
  price: number;
  currency?: string;
  placementType?: string;
  priorityWeight?: number;
  categoryId?: number | null;
}

export async function createFeaturedPackage(
  input: CreateFeaturedPackageInput,
  adminId: string | null,
): Promise<MktFeaturedPackage> {
  if (!input.code?.trim() || !input.name?.trim()) {
    throw new FeaturedProductError("code dan name wajib diisi");
  }
  if (!Number.isFinite(input.durationDays) || input.durationDays <= 0) {
    throw new FeaturedProductError("durationDays harus lebih dari 0");
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new FeaturedProductError("price tidak valid");
  }

  const [row] = await db
    .insert(mktFeaturedPackagesTable)
    .values({
      code: input.code.trim(),
      name: input.name.trim(),
      description: input.description ?? null,
      durationDays: Math.round(input.durationDays),
      price: String(input.price),
      currency: input.currency ?? "IDR",
      placementType: input.placementType ?? "homepage_top",
      priorityWeight: input.priorityWeight ?? 0,
      categoryId: input.categoryId ?? null,
      internalOnly: false,
      isActive: true,
    })
    .returning();

  writeAuditLog({
    userId: adminId,
    action: "featured_package_created",
    module: "marketplace_featured",
    referenceId: String(row.id),
    newData: row,
  });

  return row;
}

export async function updateFeaturedPackage(
  id: number,
  input: Partial<CreateFeaturedPackageInput> & { isActive?: boolean },
  adminId: string | null,
): Promise<MktFeaturedPackage> {
  const [existing] = await db.select().from(mktFeaturedPackagesTable).where(eq(mktFeaturedPackagesTable.id, id));
  if (!existing) throw new FeaturedProductError("Package tidak ditemukan", 404);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.durationDays !== undefined) patch.durationDays = Math.round(input.durationDays);
  if (input.price !== undefined) patch.price = String(input.price);
  if (input.currency !== undefined) patch.currency = input.currency;
  if (input.placementType !== undefined) patch.placementType = input.placementType;
  if (input.priorityWeight !== undefined) patch.priorityWeight = input.priorityWeight;
  if (input.categoryId !== undefined) patch.categoryId = input.categoryId;
  if (input.isActive !== undefined) patch.isActive = input.isActive;

  const [row] = await db
    .update(mktFeaturedPackagesTable)
    .set(patch)
    .where(eq(mktFeaturedPackagesTable.id, id))
    .returning();

  writeAuditLog({
    userId: adminId,
    action: "featured_package_updated",
    module: "marketplace_featured",
    referenceId: String(id),
    oldData: existing,
    newData: row,
  });

  return row;
}

export async function deactivateFeaturedPackage(id: number, adminId: string | null): Promise<void> {
  await updateFeaturedPackage(id, { isActive: false }, adminId);
}

// ─────────────────────────────────────────────────────────────────────────────
// Vendor flow
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateFeaturedRequestInput {
  catalogItemId: number;
  packageId: number;
  requestedStartAt: Date;
}

/** Vendor submits a request to feature one of their OWN catalog items. */
export async function createFeaturedRequest(
  vendorId: number,
  input: CreateFeaturedRequestInput,
): Promise<MktFeaturedProductRequest> {
  const [item] = await db
    .select()
    .from(vendorCatalogItemsTable)
    .where(eq(vendorCatalogItemsTable.id, input.catalogItemId));
  if (!item) throw new FeaturedProductError("Produk tidak ditemukan", 404);
  if (item.vendorId !== vendorId) {
    throw new FeaturedProductError("Anda tidak dapat mengajukan produk milik vendor lain", 403);
  }
  if (!item.isActive || item.status !== "published" || !item.isPublished) {
    throw new FeaturedProductError("Produk harus aktif dan sudah dipublikasikan");
  }
  if (item.isFeatured) {
    throw new FeaturedProductError("Produk ini sedang menjadi Produk Unggulan aktif");
  }

  const [pkg] = await db
    .select()
    .from(mktFeaturedPackagesTable)
    .where(eq(mktFeaturedPackagesTable.id, input.packageId));
  if (!pkg || !pkg.isActive) throw new FeaturedProductError("Paket promosi tidak tersedia", 404);

  if (!(input.requestedStartAt instanceof Date) || isNaN(input.requestedStartAt.getTime())) {
    throw new FeaturedProductError("Tanggal mulai tidak valid");
  }
  const requestedStartAt = input.requestedStartAt;
  const requestedEndAt = new Date(requestedStartAt.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);
  if (requestedEndAt <= requestedStartAt) {
    throw new FeaturedProductError("Periode tidak valid");
  }

  const [supplier] = await db.select().from(suppliersTable).where(eq(suppliersTable.id, vendorId));

  try {
    const [row] = await db
      .insert(mktFeaturedProductRequestsTable)
      .values({
        companyId: supplier?.companyId ?? null,
        vendorId,
        catalogItemId: input.catalogItemId,
        packageId: input.packageId,
        status: "pending",
        requestedStartAt,
        requestedEndAt,
        price: pkg.price, // price ALWAYS from backend package, never trusted from frontend
        currency: pkg.currency,
        paymentStatus: "unpaid",
      })
      .returning();

    writeAuditLog({
      userId: String(vendorId),
      action: "featured_request_submitted",
      module: "marketplace_featured",
      referenceId: String(row.id),
      newData: row,
    });

    await enqueueNotification({
      eventType: "mkt_featured_request_submitted",
      recipientType: "vendor",
      recipientId: vendorId,
      recipientPhone: await _vendorPhone(vendorId),
      payloadJson: { requestId: row.id, catalogItemName: item.name, packageName: pkg.name },
    });

    return row;
  } catch (err: unknown) {
    // Partial unique index (mkt_fpr_one_active_per_item_idx) — race-safe duplicate guard
    if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
      throw new FeaturedProductError("Sudah ada pengajuan aktif untuk produk ini");
    }
    throw err;
  }
}

export interface ActivateInternalFeaturedProductInput {
  vendorId: number;
  catalogItemId: number;
  packageId: number;
  startAt: Date;
  endAt: Date;
}

/**
 * Admin shortcut for internal vendors.
 *
 * It deliberately goes through the same request table and catalog fields as
 * the paid vendor flow, but creates the request as active with verified
 * payment. This keeps expiry, priority ordering, history, and audit behavior
 * identical without requiring a vendor login or payment proof.
 */
export async function activateInternalFeaturedProduct(
  input: ActivateInternalFeaturedProductInput,
  adminId: string | null,
): Promise<MktFeaturedProductRequest> {
  if (!Number.isInteger(input.vendorId) || !Number.isInteger(input.catalogItemId) || !Number.isInteger(input.packageId)) {
    throw new FeaturedProductError("Vendor, produk, dan paket wajib dipilih");
  }
  if (!(input.startAt instanceof Date) || Number.isNaN(input.startAt.getTime())
    || !(input.endAt instanceof Date) || Number.isNaN(input.endAt.getTime())
    || input.endAt <= input.startAt) {
    throw new FeaturedProductError("Tanggal mulai dan selesai tidak valid");
  }

  try {
    const row = await db.transaction(async (tx) => {
      const [supplier] = await tx
        .select()
        .from(suppliersTable)
        .where(eq(suppliersTable.id, input.vendorId))
        .for("update")
        .limit(1);
      if (!supplier) throw new FeaturedProductError("Vendor tidak ditemukan", 404);
      if (!supplier.isInternalVendor) {
        throw new FeaturedProductError("Aksi ini hanya untuk vendor internal");
      }
      if (!supplier.isActive) {
        throw new FeaturedProductError("Vendor internal tidak aktif");
      }

      const [item] = await tx
        .select()
        .from(vendorCatalogItemsTable)
        .where(eq(vendorCatalogItemsTable.id, input.catalogItemId))
        .for("update")
        .limit(1);
      if (!item || item.vendorId !== input.vendorId) {
        throw new FeaturedProductError("Produk tidak dimiliki vendor internal ini", 404);
      }
      if (!item.isActive || item.status !== "published" || !item.isPublished) {
        throw new FeaturedProductError("Produk harus aktif dan sudah dipublikasikan");
      }
      if (item.isFeatured) {
        throw new FeaturedProductError("Produk ini sedang menjadi Produk Unggulan aktif");
      }

      const [pkg] = await tx
        .select()
        .from(mktFeaturedPackagesTable)
        .where(eq(mktFeaturedPackagesTable.id, input.packageId))
        .limit(1);
      if (!pkg || !pkg.isActive) {
        throw new FeaturedProductError("Paket promosi tidak tersedia", 404);
      }

      const expectedEndAt = new Date(input.startAt.getTime() + pkg.durationDays * 24 * 60 * 60 * 1000);
      if (expectedEndAt.getTime() !== input.endAt.getTime()) {
        throw new FeaturedProductError(`Tanggal selesai harus ${pkg.durationDays} hari setelah tanggal mulai`);
      }

      const existing = await tx
        .select({ id: mktFeaturedProductRequestsTable.id })
        .from(mktFeaturedProductRequestsTable)
        .where(and(
          eq(mktFeaturedProductRequestsTable.catalogItemId, input.catalogItemId),
          sql`${mktFeaturedProductRequestsTable.status} IN ('pending', 'approved', 'active')`,
        ))
        .limit(1);
      if (existing.length > 0) {
        throw new FeaturedProductError("Sudah ada pengajuan aktif untuk produk ini", 409);
      }

      const now = new Date();
      const [created] = await tx
        .insert(mktFeaturedProductRequestsTable)
        .values({
          companyId: supplier.companyId ?? null,
          vendorId: supplier.id,
          catalogItemId: item.id,
          packageId: pkg.id,
          status: "active",
          requestedStartAt: input.startAt,
          requestedEndAt: input.endAt,
          approvedStartAt: input.startAt,
          approvedEndAt: input.endAt,
          price: pkg.price,
          currency: pkg.currency,
          paymentStatus: "verified",
          paymentReference: "INTERNAL_VENDOR_FREE",
          adminNotes: "Internal vendor • Bebas Pembayaran",
          approvedBy: adminId,
          approvedAt: now,
          activatedAt: now,
          updatedAt: now,
        })
        .returning();
      if (!created) throw new FeaturedProductError("Gagal membuat Produk Unggulan");

      await tx
        .update(vendorCatalogItemsTable)
        .set({
          isFeatured: true,
          featuredPriority: pkg.priorityWeight,
          featuredStartAt: input.startAt,
          featuredUntil: input.endAt,
          updatedAt: now,
        })
        .where(eq(vendorCatalogItemsTable.id, item.id));

      return created;
    });

    writeAuditLog({
      userId: adminId,
      action: "featured_internal_product_activated",
      module: "marketplace_featured",
      referenceId: String(row.id),
      newData: {
        requestId: row.id,
        vendorId: row.vendorId,
        catalogItemId: row.catalogItemId,
        packageId: row.packageId,
        startAt: row.approvedStartAt,
        endAt: row.approvedEndAt,
        paymentStatus: row.paymentStatus,
        paymentReference: row.paymentReference,
      },
    });

    return row;
  } catch (err: unknown) {
    if (err instanceof FeaturedProductError) throw err;
    if (err instanceof Error && /duplicate key|unique constraint/i.test(err.message)) {
      throw new FeaturedProductError("Sudah ada pengajuan aktif untuk produk ini", 409);
    }
    throw err;
  }
}

export async function listFeaturedRequestsForVendor(vendorId: number): Promise<MktFeaturedProductRequest[]> {
  return db
    .select()
    .from(mktFeaturedProductRequestsTable)
    .where(eq(mktFeaturedProductRequestsTable.vendorId, vendorId))
    .orderBy(desc(mktFeaturedProductRequestsTable.createdAt));
}

async function _getOwnedRequest(vendorId: number, id: number): Promise<MktFeaturedProductRequest> {
  const [row] = await db
    .select()
    .from(mktFeaturedProductRequestsTable)
    .where(and(eq(mktFeaturedProductRequestsTable.id, id), eq(mktFeaturedProductRequestsTable.vendorId, vendorId)));
  if (!row) throw new FeaturedProductError("Pengajuan tidak ditemukan", 404);
  return row;
}

export async function getFeaturedRequestDetailForVendor(vendorId: number, id: number) {
  return _getOwnedRequest(vendorId, id);
}

export async function submitPaymentProofForVendor(
  vendorId: number,
  id: number,
  proofUrl: string,
  paymentReference?: string | null,
): Promise<MktFeaturedProductRequest> {
  const existing = await _getOwnedRequest(vendorId, id);
  if (existing.status !== "approved") {
    throw new FeaturedProductError("Pengajuan harus disetujui admin sebelum mengunggah bukti pembayaran");
  }
  if (existing.paymentStatus === "verified") {
    throw new FeaturedProductError("Pembayaran sudah terverifikasi");
  }

  const token = existing.paymentProofToken ?? randomBytes(16).toString("hex");

  const [row] = await db
    .update(mktFeaturedProductRequestsTable)
    .set({
      paymentProofUrl: proofUrl,
      paymentProofToken: token,
      paymentReference: paymentReference ?? existing.paymentReference,
      paymentStatus: "pending_verification",
      updatedAt: new Date(),
    })
    .where(eq(mktFeaturedProductRequestsTable.id, id))
    .returning();

  writeAuditLog({
    userId: String(vendorId),
    action: "featured_payment_proof_submitted",
    module: "marketplace_featured",
    referenceId: String(id),
    newData: { proofUrl },
  });

  await createAlertAndBroadcast({
    alertType: "mkt_featured_payment_proof_submitted",
    entityType: "mkt_featured_product_request",
    entityId: id,
    severity: "info",
    title: "Bukti pembayaran Produk Unggulan menunggu verifikasi",
    message: `Vendor #${vendorId} telah mengunggah bukti pembayaran untuk pengajuan #${id}`,
    contextJson: { requestId: id, vendorId },
  });

  return row;
}

export async function cancelFeaturedRequestByVendor(vendorId: number, id: number): Promise<MktFeaturedProductRequest> {
  const existing = await _getOwnedRequest(vendorId, id);
  if (!(["pending", "approved"] as string[]).includes(existing.status)) {
    throw new FeaturedProductError("Pengajuan tidak dapat dibatalkan pada status ini");
  }

  const [row] = await db
    .update(mktFeaturedProductRequestsTable)
    .set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() })
    .where(eq(mktFeaturedProductRequestsTable.id, id))
    .returning();

  writeAuditLog({
    userId: String(vendorId),
    action: "featured_request_cancelled",
    module: "marketplace_featured",
    referenceId: String(id),
  });

  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin flow (shared by Customer Portal admin + BizPortal admin)
// ─────────────────────────────────────────────────────────────────────────────

export interface ListFeaturedRequestsFilters {
  status?: string;
  paymentStatus?: string;
  vendorId?: number;
  limit?: number;
  offset?: number;
}

export async function listFeaturedRequests(filters: ListFeaturedRequestsFilters = {}) {
  const conditions = [];
  if (filters.status) conditions.push(eq(mktFeaturedProductRequestsTable.status, filters.status));
  if (filters.paymentStatus) conditions.push(eq(mktFeaturedProductRequestsTable.paymentStatus, filters.paymentStatus));
  if (filters.vendorId) conditions.push(eq(mktFeaturedProductRequestsTable.vendorId, filters.vendorId));

  const limit = Math.min(Math.max(filters.limit ?? 50, 1), 200);
  const offset = Math.max(filters.offset ?? 0, 0);

  const rows = await db
    .select({
      request: mktFeaturedProductRequestsTable,
      catalogItemName: vendorCatalogItemsTable.name,
      vendorName: suppliersTable.name,
      packageName: mktFeaturedPackagesTable.name,
      packageCode: mktFeaturedPackagesTable.code,
    })
    .from(mktFeaturedProductRequestsTable)
    .innerJoin(vendorCatalogItemsTable, eq(mktFeaturedProductRequestsTable.catalogItemId, vendorCatalogItemsTable.id))
    .innerJoin(suppliersTable, eq(mktFeaturedProductRequestsTable.vendorId, suppliersTable.id))
    .innerJoin(mktFeaturedPackagesTable, eq(mktFeaturedProductRequestsTable.packageId, mktFeaturedPackagesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(mktFeaturedProductRequestsTable.createdAt))
    .limit(limit)
    .offset(offset);

  return rows.map((r) => ({ ...r.request, catalogItemName: r.catalogItemName, vendorName: r.vendorName, packageName: r.packageName, packageCode: r.packageCode }));
}

export async function getFeaturedRequestDetail(id: number) {
  const [row] = await db
    .select({
      request: mktFeaturedProductRequestsTable,
      catalogItemName: vendorCatalogItemsTable.name,
      catalogItemIsFeatured: vendorCatalogItemsTable.isFeatured,
      vendorName: suppliersTable.name,
      vendorPhone: suppliersTable.phone,
      packageName: mktFeaturedPackagesTable.name,
      packageCode: mktFeaturedPackagesTable.code,
      packageDurationDays: mktFeaturedPackagesTable.durationDays,
    })
    .from(mktFeaturedProductRequestsTable)
    .innerJoin(vendorCatalogItemsTable, eq(mktFeaturedProductRequestsTable.catalogItemId, vendorCatalogItemsTable.id))
    .innerJoin(suppliersTable, eq(mktFeaturedProductRequestsTable.vendorId, suppliersTable.id))
    .innerJoin(mktFeaturedPackagesTable, eq(mktFeaturedProductRequestsTable.packageId, mktFeaturedPackagesTable.id))
    .where(eq(mktFeaturedProductRequestsTable.id, id));
  if (!row) throw new FeaturedProductError("Pengajuan tidak ditemukan", 404);
  return { ...row.request, catalogItemName: row.catalogItemName, catalogItemIsFeatured: row.catalogItemIsFeatured, vendorName: row.vendorName, vendorPhone: row.vendorPhone, packageName: row.packageName, packageCode: row.packageCode, packageDurationDays: row.packageDurationDays };
}

async function _requireRequest(id: number): Promise<MktFeaturedProductRequest> {
  const [row] = await db.select().from(mktFeaturedProductRequestsTable).where(eq(mktFeaturedProductRequestsTable.id, id));
  if (!row) throw new FeaturedProductError("Pengajuan tidak ditemukan", 404);
  return row;
}

export async function approveFeaturedRequest(
  id: number,
  adminId: string | null,
  opts: { approvedStartAt?: Date; approvedEndAt?: Date; adminNotes?: string; waivePayment?: boolean } = {},
): Promise<MktFeaturedProductRequest> {
  const existing = await _requireRequest(id);
  if (existing.status !== "pending") throw new FeaturedProductError("Hanya pengajuan pending yang dapat disetujui");

  const approvedStartAt = opts.approvedStartAt ?? existing.requestedStartAt;
  const approvedEndAt = opts.approvedEndAt ?? existing.requestedEndAt;
  if (approvedEndAt <= approvedStartAt) throw new FeaturedProductError("Periode approved tidak valid");

  const [row] = await db
    .update(mktFeaturedProductRequestsTable)
    .set({
      status: "approved",
      approvedStartAt,
      approvedEndAt,
      approvedBy: adminId,
      approvedAt: new Date(),
      adminNotes: opts.adminNotes ?? existing.adminNotes,
      paymentStatus: opts.waivePayment ? "verified" : existing.paymentStatus,
      updatedAt: new Date(),
    })
    .where(eq(mktFeaturedProductRequestsTable.id, id))
    .returning();

  writeAuditLog({
    userId: adminId,
    action: "featured_request_approved",
    module: "marketplace_featured",
    referenceId: String(id),
    oldData: existing,
    newData: row,
  });

  await enqueueNotification({
    eventType: opts.waivePayment ? "mkt_featured_approved_waived" : "mkt_featured_approved_awaiting_payment",
    recipientType: "vendor",
    recipientId: existing.vendorId,
    recipientPhone: await _vendorPhone(existing.vendorId),
    payloadJson: { requestId: id },
  });

  return row;
}

export async function rejectFeaturedRequest(id: number, adminId: string | null, reason: string): Promise<MktFeaturedProductRequest> {
  if (!reason?.trim()) throw new FeaturedProductError("Alasan penolakan wajib diisi");
  const existing = await _requireRequest(id);
  if (!(["pending", "approved"] as string[]).includes(existing.status)) {
    throw new FeaturedProductError("Pengajuan tidak dapat ditolak pada status ini");
  }

  const [row] = await db
    .update(mktFeaturedProductRequestsTable)
    .set({ status: "rejected", rejectedBy: adminId, rejectedAt: new Date(), rejectionReason: reason.trim(), updatedAt: new Date() })
    .where(eq(mktFeaturedProductRequestsTable.id, id))
    .returning();

  writeAuditLog({
    userId: adminId,
    action: "featured_request_rejected",
    module: "marketplace_featured",
    referenceId: String(id),
    oldData: existing,
    newData: row,
  });

  await enqueueNotification({
    eventType: "mkt_featured_rejected",
    recipientType: "vendor",
    recipientId: existing.vendorId,
    recipientPhone: await _vendorPhone(existing.vendorId),
    payloadJson: { requestId: id, reason: reason.trim() },
  });

  return row;
}

export async function verifyFeaturedPayment(
  id: number,
  adminId: string | null,
  approve: boolean,
  reason?: string,
): Promise<MktFeaturedProductRequest> {
  const existing = await _requireRequest(id);
  if (existing.status !== "approved") throw new FeaturedProductError("Pengajuan harus berstatus approved");
  if (existing.paymentStatus !== "pending_verification") {
    throw new FeaturedProductError("Tidak ada bukti pembayaran yang menunggu verifikasi");
  }

  const [row] = await db
    .update(mktFeaturedProductRequestsTable)
    .set({
      paymentStatus: approve ? "verified" : "rejected",
      adminNotes: reason ? `${existing.adminNotes ? existing.adminNotes + "\n" : ""}${reason}` : existing.adminNotes,
      updatedAt: new Date(),
    })
    .where(eq(mktFeaturedProductRequestsTable.id, id))
    .returning();

  writeAuditLog({
    userId: adminId,
    action: approve ? "featured_payment_verified" : "featured_payment_rejected",
    module: "marketplace_featured",
    referenceId: String(id),
    oldData: existing,
    newData: row,
  });

  await enqueueNotification({
    eventType: approve ? "mkt_featured_payment_verified" : "mkt_featured_payment_rejected",
    recipientType: "vendor",
    recipientId: existing.vendorId,
    recipientPhone: await _vendorPhone(existing.vendorId),
    payloadJson: { requestId: id, reason: reason ?? null },
  });

  return row;
}

/** Atomic: flips the request to active AND turns the catalog item featured on. */
export async function activateFeaturedProduct(
  id: number,
  adminId: string | null,
  opts: { overridePayment?: boolean } = {},
): Promise<MktFeaturedProductRequest> {
  const existing = await _requireRequest(id);
  if (existing.status !== "approved") throw new FeaturedProductError("Pengajuan harus berstatus approved");
  if (existing.paymentStatus !== "verified" && !opts.overridePayment) {
    throw new FeaturedProductError("Pembayaran harus terverifikasi sebelum aktivasi");
  }
  if (!existing.approvedStartAt || !existing.approvedEndAt) {
    throw new FeaturedProductError("Periode approved belum diset — tidak ada featured tanpa expiry");
  }

  const [pkg] = await db.select().from(mktFeaturedPackagesTable).where(eq(mktFeaturedPackagesTable.id, existing.packageId));

  const row = await db.transaction(async (tx) => {
    const [updatedReq] = await tx
      .update(mktFeaturedProductRequestsTable)
      .set({ status: "active", activatedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(mktFeaturedProductRequestsTable.id, id), eq(mktFeaturedProductRequestsTable.status, "approved")))
      .returning();
    if (!updatedReq) throw new FeaturedProductError("Gagal mengaktifkan — status sudah berubah");

    await tx
      .update(vendorCatalogItemsTable)
      .set({
        isFeatured: true,
        featuredPriority: pkg?.priorityWeight ?? 0,
        featuredStartAt: existing.approvedStartAt,
        featuredUntil: existing.approvedEndAt,
      })
      .where(eq(vendorCatalogItemsTable.id, existing.catalogItemId));

    return updatedReq;
  });

  writeAuditLog({
    userId: adminId,
    action: "featured_product_activated",
    module: "marketplace_featured",
    referenceId: String(id),
    newData: row,
  });

  await enqueueNotification({
    eventType: "mkt_featured_activated",
    recipientType: "vendor",
    recipientId: existing.vendorId,
    recipientPhone: await _vendorPhone(existing.vendorId),
    payloadJson: { requestId: id },
  });

  return row;
}

/** Admin-initiated stop of an approved/active featured product ("penghentian"). */
export async function cancelFeaturedProduct(id: number, adminId: string | null, reason?: string): Promise<MktFeaturedProductRequest> {
  const existing = await _requireRequest(id);
  if (!(["approved", "active"] as string[]).includes(existing.status)) {
    throw new FeaturedProductError("Hanya pengajuan approved/active yang dapat dihentikan");
  }

  const row = await db.transaction(async (tx) => {
    const [updatedReq] = await tx
      .update(mktFeaturedProductRequestsTable)
      .set({
        status: "cancelled",
        cancelledAt: new Date(),
        adminNotes: reason ? `${existing.adminNotes ? existing.adminNotes + "\n" : ""}${reason}` : existing.adminNotes,
        updatedAt: new Date(),
      })
      .where(eq(mktFeaturedProductRequestsTable.id, id))
      .returning();

    if (existing.status === "active") {
      await tx
        .update(vendorCatalogItemsTable)
        .set({ isFeatured: false, featuredStartAt: null, featuredUntil: null })
        .where(eq(vendorCatalogItemsTable.id, existing.catalogItemId));
    }

    return updatedReq;
  });

  writeAuditLog({
    userId: adminId,
    action: "featured_product_cancelled",
    module: "marketplace_featured",
    referenceId: String(id),
    oldData: existing,
  });

  await enqueueNotification({
    eventType: "mkt_featured_cancelled",
    recipientType: "vendor",
    recipientId: existing.vendorId,
    recipientPhone: await _vendorPhone(existing.vendorId),
    payloadJson: { requestId: id, reason: reason ?? null },
  });

  return row;
}

export async function reorderFeaturedProducts(
  items: { catalogItemId: number; priority: number }[],
  adminId: string | null,
): Promise<void> {
  for (const item of items) {
    await db
      .update(vendorCatalogItemsTable)
      .set({ featuredPriority: item.priority })
      .where(and(eq(vendorCatalogItemsTable.id, item.catalogItemId), eq(vendorCatalogItemsTable.isFeatured, true)));
  }

  writeAuditLog({
    userId: adminId,
    action: "featured_products_reordered",
    module: "marketplace_featured",
    newData: { items },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Worker: expiry (Fase 9)
// ─────────────────────────────────────────────────────────────────────────────

export async function expireFeaturedProducts(): Promise<{ expired: number }> {
  const now = new Date();
  const dueRows = await db
    .select()
    .from(mktFeaturedProductRequestsTable)
    .where(and(eq(mktFeaturedProductRequestsTable.status, "active"), sql`${mktFeaturedProductRequestsTable.approvedEndAt} <= ${now}`));

  let expired = 0;
  for (const reqRow of dueRows) {
    try {
      await db.transaction(async (tx) => {
        const [updated] = await tx
          .update(mktFeaturedProductRequestsTable)
          .set({ status: "expired", expiredAt: now, updatedAt: now })
          .where(and(eq(mktFeaturedProductRequestsTable.id, reqRow.id), eq(mktFeaturedProductRequestsTable.status, "active")))
          .returning();
        if (!updated) return;

        await tx
          .update(vendorCatalogItemsTable)
          .set({ isFeatured: false, featuredStartAt: null, featuredUntil: null })
          .where(and(eq(vendorCatalogItemsTable.id, reqRow.catalogItemId), eq(vendorCatalogItemsTable.isFeatured, true)));
      });

      writeAuditLog({
        userId: null,
        action: "featured_product_expired",
        module: "marketplace_featured",
        referenceId: String(reqRow.id),
      });

      await enqueueNotification({
        eventType: "mkt_featured_expired",
        recipientType: "vendor",
        recipientId: reqRow.vendorId,
        recipientPhone: await _vendorPhone(reqRow.vendorId),
        payloadJson: { requestId: reqRow.id },
      });

      expired++;
    } catch (err) {
      logger.error({ err, requestId: reqRow.id }, "[featuredProductExpiryWorker] failed to expire request");
    }
  }

  return { expired };
}

/** H-3 reminder — separate from hard expiry so it can run on its own cadence. */
export async function notifyExpiringSoonFeaturedProducts(daysBefore = 3): Promise<{ notified: number }> {
  const from = new Date();
  const to = new Date(from.getTime() + daysBefore * 24 * 60 * 60 * 1000);

  const rows = await db
    .select()
    .from(mktFeaturedProductRequestsTable)
    .where(
      and(
        eq(mktFeaturedProductRequestsTable.status, "active"),
        sql`${mktFeaturedProductRequestsTable.approvedEndAt} BETWEEN ${from} AND ${to}`,
      ),
    );

  let notified = 0;
  for (const row of rows) {
    await enqueueNotification({
      eventType: "mkt_featured_expiring_soon",
      recipientType: "vendor",
      recipientId: row.vendorId,
      recipientPhone: await _vendorPhone(row.vendorId),
      payloadJson: { requestId: row.id, expiresAt: row.approvedEndAt },
      // dedup per day so re-running the worker doesn't spam H-3 repeatedly
      deduplicationKey: `mkt_featured_expiring_soon:${row.id}:${new Date().toISOString().slice(0, 10)}`,
    });
    notified++;
  }
  return { notified };
}

// ─────────────────────────────────────────────────────────────────────────────
// Marketplace display (Fase 7 — public)
// ─────────────────────────────────────────────────────────────────────────────

export async function listFeaturedProductsForDisplay(limit = 12) {
  const now = new Date();
  const rows = await db
    .select({
      id: vendorCatalogItemsTable.id,
      vendorId: vendorCatalogItemsTable.vendorId,
      vendorName: suppliersTable.name,
      vendorLogo: suppliersTable.logo,
      type: vendorCatalogItemsTable.type,
      name: vendorCatalogItemsTable.name,
      description: vendorCatalogItemsTable.description,
      kategori: vendorCatalogItemsTable.kategori,
      priceSell: vendorCatalogItemsTable.priceSell,
      currency: vendorCatalogItemsTable.currency,
      unit: vendorCatalogItemsTable.unit,
      featuredPriority: vendorCatalogItemsTable.featuredPriority,
      featuredStartAt: vendorCatalogItemsTable.featuredStartAt,
      featuredUntil: vendorCatalogItemsTable.featuredUntil,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(
      and(
        eq(vendorCatalogItemsTable.isFeatured, true),
        eq(vendorCatalogItemsTable.isPublished, true),
        ne(vendorCatalogItemsTable.isActive, false),
        // Defensive: only show items with a valid future expiry — never "abadi" (no expiry).
        // Items with featuredUntil IS NULL are treated as corrupt and excluded from display.
        sql`(${vendorCatalogItemsTable.featuredUntil} IS NOT NULL AND ${vendorCatalogItemsTable.featuredUntil} > ${now})`,
      ),
    )
    .orderBy(desc(vendorCatalogItemsTable.featuredPriority), desc(vendorCatalogItemsTable.featuredStartAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, isFeatured: true as const }));
}

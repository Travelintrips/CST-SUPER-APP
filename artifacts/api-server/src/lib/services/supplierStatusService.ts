/**
 * supplierStatusService
 * ──────────────────────────────────────────────────────────────────────────────
 * Helper terpusat untuk semua operasi status vendor.
 *
 * Aturan:
 *   - updateSupplierStatus()          — satu-satunya jalan ubah status + isActive + audit
 *   - canSupplierParticipateInTransaction() — validasi sebelum RFQ/PO/order baru
 *   - canSupplierAppearInMarketplace()     — filter marketplace publik
 *
 * Status valid: pending | active | inactive | suspended | blacklisted | archived
 * isActive dipertahankan untuk backward compat dan diupdate secara konsisten di sini.
 */

import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { suppliersTable, supplierStatusHistoryTable } from "@workspace/db";

export type SupplierStatus =
  | "pending"
  | "active"
  | "inactive"
  | "suspended"
  | "blacklisted"
  | "archived";

export type MarketplaceStatus = "draft" | "published" | "unpublished";

export interface UpdateSupplierStatusOptions {
  supplierId: number;
  newStatus: SupplierStatus;
  reason?: string;
  actorUserId?: string;
  companyId?: number;
  requestId?: string;
  dbOrTx?: Pick<typeof db, "select" | "update" | "insert" | "execute">;
}

export interface UpdateMarketplaceStatusOptions {
  supplierId: number;
  newMarketplaceStatus: MarketplaceStatus;
  actorUserId?: string;
  dbOrTx?: Pick<typeof db, "select" | "update" | "insert" | "execute">;
}

// Status yang membuat isActive = true
const ACTIVE_STATUSES: SupplierStatus[] = ["active"];

// Status yang melarang partisipasi transaksi baru
const TRANSACTION_BLOCKED_STATUSES: SupplierStatus[] = [
  "pending",
  "inactive",
  "suspended",
  "blacklisted",
  "archived",
];

/**
 * Satu-satunya fungsi yang boleh mengubah status vendor.
 * Selalu update isActive secara konsisten dan catat audit log.
 */
export async function updateSupplierStatus(opts: UpdateSupplierStatusOptions): Promise<void> {
  const { supplierId, newStatus, reason, actorUserId, companyId, requestId } = opts;
  const conn = opts.dbOrTx ?? db;

  const [current] = await conn
    .select({ status: suppliersTable.status, isVerified: suppliersTable.isVerified })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, supplierId))
    .limit(1);

  if (!current) throw new Error(`Supplier ${supplierId} tidak ditemukan`);

  const previousStatus = current.status;
  const newIsActive = ACTIVE_STATUSES.includes(newStatus);
  const now = new Date();

  await conn
    .update(suppliersTable)
    .set({
      status: newStatus,
      isActive: newIsActive,
      statusReason: reason ?? null,
      statusChangedAt: now,
      statusChangedBy: actorUserId ?? null,
    })
    .where(eq(suppliersTable.id, supplierId));

  await conn
    .insert(supplierStatusHistoryTable)
    .values({
      supplierId,
      previousStatus,
      newStatus,
      reason: reason ?? null,
      actorUserId: actorUserId ?? null,
      companyId: companyId ?? null,
      requestId: requestId ?? null,
      createdAt: now,
    });
}

/**
 * Set isVerified + verifiedAt + verifiedBy secara konsisten.
 * Jika isVerified=true dan status masih pending, otomatis naikkan ke active.
 */
export async function verifySupplier(opts: {
  supplierId: number;
  actorUserId?: string;
  companyId?: number;
  dbOrTx?: Pick<typeof db, "select" | "update" | "insert" | "execute">;
}): Promise<void> {
  const { supplierId, actorUserId, companyId } = opts;
  const conn = opts.dbOrTx ?? db;
  const now = new Date();

  const [current] = await conn
    .select({ status: suppliersTable.status })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, supplierId))
    .limit(1);

  if (!current) throw new Error(`Supplier ${supplierId} tidak ditemukan`);

  await conn
    .update(suppliersTable)
    .set({
      isVerified: true,
      verifiedAt: now,
      verifiedBy: actorUserId ?? null,
    })
    .where(eq(suppliersTable.id, supplierId));

  if (current.status === "pending") {
    await updateSupplierStatus({
      supplierId,
      newStatus: "active",
      reason: "Auto-activated saat verifikasi",
      actorUserId,
      companyId,
      dbOrTx: conn,
    });
  }
}

/**
 * Set verification state without leaving a published supplier in a
 * contradictory state. Unverifying a published supplier automatically moves
 * it back to draft; publishing must then be explicitly re-approved.
 */
export async function setSupplierVerification(opts: {
  supplierId: number;
  isVerified: boolean;
  actorUserId?: string;
  dbOrTx?: Pick<typeof db, "select" | "update" | "insert" | "execute">;
}): Promise<void> {
  const { supplierId, isVerified, actorUserId } = opts;
  const conn = opts.dbOrTx ?? db;
  const now = new Date();
  const [current] = await conn
    .select({
      status: suppliersTable.status,
      isActive: suppliersTable.isActive,
      marketplaceStatus: suppliersTable.marketplaceStatus,
    })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, supplierId))
    .limit(1);

  if (!current) throw new Error(`Supplier ${supplierId} tidak ditemukan`);

  const remainsEligible =
    isVerified &&
    current.status === "active" &&
    current.isActive === true;

  await conn
    .update(suppliersTable)
    .set({
      isVerified,
      verifiedAt: isVerified ? now : null,
      verifiedBy: isVerified ? (actorUserId ?? null) : null,
      ...(current.marketplaceStatus === "published" && !remainsEligible
        ? {
            marketplaceStatus: "draft" as const,
            marketplacePublishedAt: null,
            marketplacePublishedBy: null,
          }
        : {}),
    })
    .where(eq(suppliersTable.id, supplierId));
}

/**
 * Update marketplace_status + timestamp publikasi.
 * Hanya vendor active + verified yang boleh dipublish.
 */
export async function updateMarketplaceStatus(opts: UpdateMarketplaceStatusOptions): Promise<{
  ok: boolean;
  error?: string;
}> {
  const { supplierId, newMarketplaceStatus, actorUserId } = opts;
  const conn = opts.dbOrTx ?? db;

  if (newMarketplaceStatus === "published") {
    const [current] = await conn
      .select({ status: suppliersTable.status, isVerified: suppliersTable.isVerified })
      .from(suppliersTable)
      .where(eq(suppliersTable.id, supplierId))
      .limit(1);

    if (!current) return { ok: false, error: "Vendor tidak ditemukan" };
    if (current.status !== "active") return { ok: false, error: "Vendor harus berstatus active sebelum dipublish" };
    if (!current.isVerified) return { ok: false, error: "Vendor harus terverifikasi sebelum dipublish" };
  }

  const now = new Date();
  await conn
    .update(suppliersTable)
    .set({
      marketplaceStatus: newMarketplaceStatus,
      marketplacePublishedAt: newMarketplaceStatus === "published" ? now : undefined,
      marketplacePublishedBy: newMarketplaceStatus === "published" ? (actorUserId ?? null) : undefined,
    })
    .where(eq(suppliersTable.id, supplierId));

  return { ok: true };
}

/**
 * Cek apakah vendor boleh dipilih pada transaksi baru (RFQ, PO, order, fulfillment).
 * Vendor lama di histori transaksi tidak perlu dicek ulang — ini hanya untuk pemilihan baru.
 */
export function canSupplierParticipateInTransaction(status: string): {
  allowed: boolean;
  reason?: string;
} {
  if (TRANSACTION_BLOCKED_STATUSES.includes(status as SupplierStatus)) {
    return {
      allowed: false,
      reason: `Vendor berstatus "${status}" tidak dapat dipilih pada transaksi baru`,
    };
  }
  return { allowed: true };
}

/**
 * Cek apakah vendor boleh tampil di marketplace publik.
 * Semua syarat harus terpenuhi sekaligus.
 */
export function canSupplierAppearInMarketplace(supplier: {
  status: string;
  isActive: boolean;
  isVerified: boolean;
  marketplaceStatus: string;
}): boolean {
  return (
    supplier.status === "active" &&
    supplier.isActive === true &&
    supplier.isVerified === true &&
    supplier.marketplaceStatus === "published"
  );
}

/**
 * Hitung ringkasan warning dokumen vendor.
 */
export function getDocumentWarnings(documents: Array<{
  documentType: string;
  verificationStatus: string;
  expiresAt?: string | null;
}>): string[] {
  const warnings: string[] = [];
  const today = new Date();
  const thirtyDaysFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const requiredTypes = ["NPWP", "NIB"];
  for (const type of requiredTypes) {
    if (!documents.some((d) => d.documentType === type)) {
      warnings.push(`Dokumen wajib "${type}" belum ada`);
    }
  }

  for (const doc of documents) {
    if (doc.verificationStatus === "rejected") {
      warnings.push(`Dokumen "${doc.documentType}" ditolak`);
    }
    if (doc.expiresAt) {
      const expiry = new Date(doc.expiresAt);
      if (expiry < today) {
        warnings.push(`Dokumen "${doc.documentType}" sudah kedaluwarsa`);
      } else if (expiry < thirtyDaysFromNow) {
        warnings.push(`Dokumen "${doc.documentType}" akan kedaluwarsa dalam 30 hari`);
      }
    }
  }

  return warnings;
}

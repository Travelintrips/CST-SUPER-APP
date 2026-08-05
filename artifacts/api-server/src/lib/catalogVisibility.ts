import { eq, ne } from "drizzle-orm";
import { vendorCatalogItemsTable, suppliersTable } from "@workspace/db";

/**
 * Runtime check — cocok untuk filter array in-memory (bukan DB query).
 *
 * Logic:
 *   isPublished === true  — sudah dipublikasikan
 *   isActive    !== false — tidak dinonaktifkan (null/undefined dianggap aktif)
 *   !deletedAt            — belum soft-deleted
 *
 * Endpoint admin/vendor TIDAK menggunakan helper ini karena admin
 * perlu melihat draft dan item yang inactive.
 */
export function isCatalogItemPublic(item: {
  isPublished?: boolean | null;
  isActive?: boolean | null;
  deletedAt?: Date | string | null;
}): boolean {
  return (
    item.isPublished === true &&
    item.isActive !== false &&
    !item.deletedAt
  );
}

/**
 * Drizzle WHERE conditions yang setara dengan isCatalogItemPublic.
 * Gabungkan ke query dengan `and(...catalogPublicConditions(), ...)`.
 *
 * Catatan: isActive di schema adalah NOT NULL DEFAULT true, sehingga
 * ne(isActive, false) lebih aman daripada eq(isActive, true) karena
 * tidak mengecualikan baris yang secara logika "tidak inactive" bila
 * kolom suatu saat menjadi nullable.
 */
export function catalogPublicConditions(
  vci: typeof vendorCatalogItemsTable = vendorCatalogItemsTable,
) {
  return [
    eq(vci.isPublished, true),
    ne(vci.isActive, false),
    // deletedAt belum ada di schema — tambahkan di sini bila ditambahkan:
    // isNull(vci.deletedAt),
  ] as const;
}

/**
 * Drizzle WHERE conditions untuk supplier visibility di marketplace publik.
 * Gunakan bersamaan dengan catalogPublicConditions di query yang JOIN suppliersTable.
 *
 * Supplier harus:
 *   - is_active = true     — tidak di-nonaktifkan oleh admin
 *   - is_verified = true   — sudah terverifikasi
 *   - marketplace_status = 'published' — sudah dipublish ke marketplace
 */
export function catalogSupplierConditions(
  s: typeof suppliersTable = suppliersTable,
) {
  return [
    eq(s.isActive, true),
    eq(s.isVerified, true),
    eq(s.marketplaceStatus, "published"),
  ] as const;
}

type RawAsset = Record<string, unknown>;

/** Returns true if the asset is publicly visible (or has no visibility field — legacy). */
function isPublicAsset(a: RawAsset): boolean {
  const vis = a["visibility"];
  return vis === undefined || vis === null || String(vis) === "public";
}

/**
 * Algoritma canonical resolusi primary image dari media_assets JSONB.
 *
 * Prioritas:
 *   1. type=image, isPrimary=true  (atau isCover=true)
 *   2. type=image, sortOrder rendah
 *   3. null jika tidak ada gambar publik
 *
 * Legacy: asset tanpa field `type` diasumsikan "image".
 * Legacy: asset tanpa field `visibility` diasumsikan "public".
 *
 * Digunakan di: Marketplace Card, Hero, Product Detail, Related, Similar, Vendor Dashboard.
 */
export function resolveMediaAssetsImage(mediaAssets: unknown): string | null {
  if (!Array.isArray(mediaAssets) || mediaAssets.length === 0) return null;

  const images = (mediaAssets as RawAsset[])
    .filter((a) => {
      if (typeof a["url"] !== "string" || !a["url"]) return false;
      const t = String(a["type"] ?? "");
      // Asset tanpa type dianggap image (format lama)
      if (t === "video" || t === "pdf" || t === "document") return false;
      return isPublicAsset(a);
    })
    .sort((a, b) => {
      // isPrimary/isCover lebih tinggi prioritasnya, lalu sortOrder ascending
      const ap = a["isPrimary"] ?? a["isCover"];
      const bp = b["isPrimary"] ?? b["isCover"];
      if (ap && !bp) return -1;
      if (!ap && bp) return 1;
      return (Number(a["sortOrder"] ?? 0)) - (Number(b["sortOrder"] ?? 0));
    });

  return images.length > 0 ? String(images[0]["url"]) : null;
}

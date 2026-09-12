/**
 * mediaAssetsHelper.ts
 *
 * Tipe, normalizer, dan sanitizer untuk kolom `media_assets` (JSONB []).
 * Digunakan oleh semua tabel yang menyimpan mediaAssets:
 *   - vendor_mini_form_submissions
 *   - customer_approvals
 *   - vendor_catalog_items
 *   - customer_quote_links
 *   - product_templates
 *   - service_templates
 */

// ── Tipe ─────────────────────────────────────────────────────────────────────

export type MediaAssetType =
  | "image"
  | "video"
  | "pdf"
  | "certificate"
  | "brochure";

export type MediaAssetSource = "vendor" | "admin" | "system";

export interface MediaAssetItem {
  id: string;
  type: MediaAssetType;
  url: string;
  objectPath?: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  isPrimary?: boolean;
  isApproved?: boolean;
  source?: MediaAssetSource;
  internalNote?: string;
  createdAt?: string;
}

export interface PublicMediaAsset {
  id: string;
  type: MediaAssetType;
  url: string;
  title?: string;
  mimeType?: string;
  sizeBytes?: number;
  isPrimary?: boolean;
}

// ── Konstanta ─────────────────────────────────────────────────────────────────

const ALLOWED_TYPES: Set<string> = new Set<MediaAssetType>([
  "image",
  "video",
  "pdf",
  "certificate",
  "brochure",
]);

const ALLOWED_SOURCES: Set<string> = new Set<MediaAssetSource>([
  "vendor",
  "admin",
  "system",
]);

// ── Normalizer ────────────────────────────────────────────────────────────────

/**
 * Mengambil data mentah dari DB (JSONB) dan mengembalikan array MediaAssetItem
 * yang sudah divalidasi strukturnya.
 * - Entry yang tidak punya `id` atau `url` dibuang.
 * - Type yang tidak dikenal di-default ke "image".
 * - Source yang tidak dikenal di-default ke "admin".
 */
export function normalizeMediaAssets(raw: unknown): MediaAssetItem[] {
  if (!Array.isArray(raw)) return [];

  const result: MediaAssetItem[] = [];

  for (const item of raw) {
    if (!item || typeof item !== "object") continue;

    const r = item as Record<string, unknown>;

    const id = typeof r.id === "string" && r.id.trim() ? r.id.trim() : null;
    const url = typeof r.url === "string" && r.url.trim() ? r.url.trim() : null;

    if (!id || !url) continue;

    const type: MediaAssetType = ALLOWED_TYPES.has(r.type as string)
      ? (r.type as MediaAssetType)
      : "image";

    const source: MediaAssetSource = ALLOWED_SOURCES.has(r.source as string)
      ? (r.source as MediaAssetSource)
      : "admin";

    result.push({
      id,
      type,
      url,
      objectPath: typeof r.objectPath === "string" ? r.objectPath : undefined,
      title: typeof r.title === "string" ? r.title.trim() || undefined : undefined,
      mimeType: typeof r.mimeType === "string" ? r.mimeType : undefined,
      sizeBytes: typeof r.sizeBytes === "number" && r.sizeBytes >= 0 ? r.sizeBytes : undefined,
      isPrimary: typeof r.isPrimary === "boolean" ? r.isPrimary : false,
      isApproved: typeof r.isApproved === "boolean" ? r.isApproved : false,
      source,
      internalNote: typeof r.internalNote === "string" ? r.internalNote : undefined,
      createdAt: typeof r.createdAt === "string" ? r.createdAt : undefined,
    });
  }

  return result;
}

// ── Sanitizer (customer-safe) ─────────────────────────────────────────────────

/**
 * Menyaring mediaAssets agar aman dikembalikan ke customer/publik.
 *
 * Aturan:
 * 1. Hanya item dengan `isApproved === true` yang lolos.
 * 2. `objectPath` dihapus (internal storage path, tidak boleh expose).
 * 3. `internalNote` dihapus.
 * 4. `source` dihapus (internal metadata).
 * 5. Type yang tidak dikenal dibuang.
 * 6. URL harus https (bukan signed URL internal atau localhost).
 */
export function sanitizeMediaAssetsForCustomer(
  assets: MediaAssetItem[],
): PublicMediaAsset[] {
  const result: PublicMediaAsset[] = [];

  for (const asset of assets) {
    if (!asset.isApproved) continue;
    if (!ALLOWED_TYPES.has(asset.type)) continue;
    if (!asset.url.startsWith("https://")) continue;

    result.push({
      id: asset.id,
      type: asset.type,
      url: asset.url,
      title: asset.title,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      isPrimary: asset.isPrimary,
    });
  }

  return result;
}

/**
 * Shorthand: normalisasi lalu sanitasi sekaligus.
 * Berguna untuk query endpoint publik / customer portal.
 */
export function getPublicMediaAssets(raw: unknown): PublicMediaAsset[] {
  return sanitizeMediaAssetsForCustomer(normalizeMediaAssets(raw));
}

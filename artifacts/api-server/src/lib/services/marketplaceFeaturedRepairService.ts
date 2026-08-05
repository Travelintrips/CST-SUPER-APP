/**
 * marketplaceFeaturedRepairService.ts — Legacy Featured Data Repair
 *
 * RC3 Fase 2: sebagian item vendor_catalog_items memiliki is_featured=true
 * yang tidak konsisten dengan invariant asli fitur Featured Product ("tidak
 * ada featured tanpa expiry" — lihat activateFeaturedProduct() di
 * marketplaceFeaturedProductService.ts, yang SELALU mengisi featured_until
 * saat mengaktifkan). State ini hanya bisa muncul dari edit manual database
 * (mis. testing lama) — bukan dari flow aplikasi manapun.
 *
 * scanFeaturedIntegrity() — read-only, tidak mengubah apapun. Melaporkan
 *   semua item corrupt beserta alasannya.
 * repairFeaturedIntegrity() — mode:
 *   - "dry-run" (default): sama seperti scan, tidak menulis apapun.
 *   - "execute": mereset HANYA item yang benar-benar corrupt ke non-featured,
 *     lalu mencatat audit log per item. Tidak pernah menghapus baris apapun.
 *
 * Definisi "corrupt" (item is_featured=true DAN salah satu dari):
 *   1. featured_until IS NULL — tidak mungkin dihasilkan oleh activateFeaturedProduct()
 *   2. tidak ada mkt_featured_product_requests yang menunjuk ke item ini
 *   3. request yang menunjuk ke item ini tidak berstatus "active"
 *      (mis. sudah expired/cancelled/rejected tapi flag is_featured tidak pernah direset)
 *
 * Item yang valid (ada request status="active" milik item tsb, dan
 * featured_until terisi) TIDAK PERNAH disentuh, meskipun featured_until-nya
 * sudah lewat tanggal hari ini — itu tanggung jawab featuredProductExpiryWorker,
 * bukan repair utility ini.
 */

import {
  db,
  mktFeaturedProductRequestsTable,
  vendorCatalogItemsTable,
  suppliersTable,
} from "@workspace/db";
import { eq, and, sql, isNull } from "drizzle-orm";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLog.js";

export type FeaturedCorruptReason =
  | "no_expiry_date"
  | "no_matching_request"
  | "request_not_active";

export interface FeaturedCorruptItem {
  catalogItemId: number;
  itemName: string | null;
  vendorId: number;
  vendorName: string | null;
  isFeatured: boolean;
  featuredUntil: string | null;
  featuredStartAt: string | null;
  featuredPriority: number | null;
  matchingRequestId: number | null;
  matchingRequestStatus: string | null;
  reasons: FeaturedCorruptReason[];
}

export interface FeaturedIntegrityReport {
  scannedAt: string;
  totalFeaturedItems: number;
  corruptCount: number;
  items: FeaturedCorruptItem[];
}

/**
 * Read-only scan. Never writes. Safe to call at any time (e.g. from an admin
 * "Scan Integrity" button, a cron dry-run, or a CLI --dry-run invocation).
 */
export async function scanFeaturedIntegrity(): Promise<FeaturedIntegrityReport> {
  const featuredItems = await db
    .select({
      id: vendorCatalogItemsTable.id,
      name: vendorCatalogItemsTable.name,
      vendorId: vendorCatalogItemsTable.vendorId,
      vendorName: suppliersTable.name,
      isFeatured: vendorCatalogItemsTable.isFeatured,
      featuredUntil: vendorCatalogItemsTable.featuredUntil,
      featuredStartAt: vendorCatalogItemsTable.featuredStartAt,
      featuredPriority: vendorCatalogItemsTable.featuredPriority,
    })
    .from(vendorCatalogItemsTable)
    .leftJoin(suppliersTable, eq(suppliersTable.id, vendorCatalogItemsTable.vendorId))
    .where(eq(vendorCatalogItemsTable.isFeatured, true));

  const items: FeaturedCorruptItem[] = [];

  for (const item of featuredItems) {
    const [activeRequest] = await db
      .select({ id: mktFeaturedProductRequestsTable.id, status: mktFeaturedProductRequestsTable.status })
      .from(mktFeaturedProductRequestsTable)
      .where(eq(mktFeaturedProductRequestsTable.catalogItemId, item.id))
      .orderBy(sql`${mktFeaturedProductRequestsTable.id} DESC`)
      .limit(1);

    const reasons: FeaturedCorruptReason[] = [];
    if (!item.featuredUntil) reasons.push("no_expiry_date");
    if (!activeRequest) reasons.push("no_matching_request");
    else if (activeRequest.status !== "active") reasons.push("request_not_active");

    if (reasons.length === 0) continue;

    items.push({
      catalogItemId: item.id,
      itemName: item.name,
      vendorId: item.vendorId,
      vendorName: item.vendorName,
      isFeatured: item.isFeatured,
      featuredUntil: item.featuredUntil ? item.featuredUntil.toISOString() : null,
      featuredStartAt: item.featuredStartAt ? item.featuredStartAt.toISOString() : null,
      featuredPriority: item.featuredPriority,
      matchingRequestId: activeRequest?.id ?? null,
      matchingRequestStatus: activeRequest?.status ?? null,
      reasons,
    });
  }

  return {
    scannedAt: new Date().toISOString(),
    totalFeaturedItems: featuredItems.length,
    corruptCount: items.length,
    items,
  };
}

export interface FeaturedRepairResult {
  mode: "dry-run" | "execute";
  report: FeaturedIntegrityReport;
  repaired: number;
  failed: { catalogItemId: number; error: string }[];
}

/**
 * mode="dry-run" (default): identical to scanFeaturedIntegrity(), no writes.
 * mode="execute": resets ONLY the items scanFeaturedIntegrity() flagged as
 * corrupt. Each reset is its own row-scoped UPDATE guarded by
 * isFeatured=true so a concurrent legitimate activation can't be clobbered
 * by a stale scan. One audit log entry per repaired item.
 */
export async function repairFeaturedIntegrity(
  mode: "dry-run" | "execute" = "dry-run",
  actorUserId?: string | null,
): Promise<FeaturedRepairResult> {
  const report = await scanFeaturedIntegrity();

  if (mode === "dry-run" || report.corruptCount === 0) {
    return { mode, report, repaired: 0, failed: [] };
  }

  let repaired = 0;
  const failed: { catalogItemId: number; error: string }[] = [];

  for (const item of report.items) {
    try {
      const [updated] = await db
        .update(vendorCatalogItemsTable)
        .set({ isFeatured: false, featuredPriority: 0, featuredStartAt: null, featuredUntil: null })
        .where(and(eq(vendorCatalogItemsTable.id, item.catalogItemId), eq(vendorCatalogItemsTable.isFeatured, true)))
        .returning({ id: vendorCatalogItemsTable.id });

      if (!updated) continue; // sudah berubah sejak scan (mis. baru saja diaktifkan ulang) — skip, jangan paksa

      writeAuditLog({
        userId: actorUserId ?? null,
        action: "featured_integrity_repaired",
        module: "marketplace_featured",
        referenceId: String(item.catalogItemId),
        oldData: {
          isFeatured: item.isFeatured,
          featuredUntil: item.featuredUntil,
          featuredStartAt: item.featuredStartAt,
          featuredPriority: item.featuredPriority,
          reasons: item.reasons,
        },
        newData: { isFeatured: false, featuredUntil: null, featuredStartAt: null, featuredPriority: 0 },
      });

      repaired++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, catalogItemId: item.catalogItemId }, "[featuredRepairService] failed to repair item");
      failed.push({ catalogItemId: item.catalogItemId, error: msg });
    }
  }

  return { mode, report, repaired, failed };
}

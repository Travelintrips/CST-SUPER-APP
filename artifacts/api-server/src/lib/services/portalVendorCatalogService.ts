/**
 * Portal Vendor Catalog Service
 *
 * Business logic for all vendor catalog, marketplace, and template queries.
 * Controllers in portal.ts handle HTTP, caching headers, and rate-limiter
 * middleware — this service owns only the data access layer.
 */

import {
  db,
  vendorCatalogItemsTable,
  suppliersTable,
  productMediaTable,
  vendorPerformanceTable,
  productTemplatesTable,
  serviceTemplatesTable,
  vendorProfilesTable,
  vendorCatalogSubmissionsTable,
  vendorCatalogSubmissionLinksTable,
  portalCustomersTable,
  supplierDocumentsTable,
  companiesTable,
} from "@workspace/db";
import { eq, and, ne, isNull, sql, desc, gte, ilike, or, asc, inArray } from "drizzle-orm";
import { catalogPublicConditions, catalogSupplierConditions, resolveMediaAssetsImage } from "../catalogVisibility.js";
import {
  normalizeServiceCategory,
  normalizeMarketplaceStockStatus,
  SERVICE_CATEGORY_ALIASES,
  SERVICE_CATEGORY_LABELS,
} from "../catalogNormalization.js";
import { uploadToSupabase } from "../supabaseStorage.js";
import { compressImageBuffer, isCompressibleImage } from "../imageCompress.js";

// ─── Re-export so portal.ts can keep using via single import ─────────────────
export { normalizeServiceCategory, SERVICE_CATEGORY_LABELS };

// ─── Shared column shape (no priceBase) ─────────────────────────────────────

const CATALOG_PUBLIC_COLS = {
  id:               vendorCatalogItemsTable.id,
  vendorId:         vendorCatalogItemsTable.vendorId,
  vendorName:       vendorCatalogItemsTable.vendorName,
  templateKind:     vendorCatalogItemsTable.templateKind,
  categoryKey:      vendorCatalogItemsTable.categoryKey,
  serviceType:      vendorCatalogItemsTable.serviceType,
  name:             vendorCatalogItemsTable.name,
  description:      vendorCatalogItemsTable.description,
  kategori:         vendorCatalogItemsTable.kategori,
  specValues:       vendorCatalogItemsTable.specValues,
  priceSell:        vendorCatalogItemsTable.priceSell,
  currency:         vendorCatalogItemsTable.currency,
  unit:             vendorCatalogItemsTable.unit,
  moq:              vendorCatalogItemsTable.moq,
  stockStatus:      vendorCatalogItemsTable.stockStatus,
  leadTime:         vendorCatalogItemsTable.leadTime,
  location:         vendorCatalogItemsTable.location,
  origin:           vendorCatalogItemsTable.origin,
  publishedAt:      vendorCatalogItemsTable.publishedAt,
  mediaAssets:      vendorCatalogItemsTable.mediaAssets,
};

const primaryImageSubquery = (itemIdRef: ReturnType<typeof sql>) =>
  sql<string | null>`(
    SELECT pm.file_url
    FROM product_media pm
    WHERE pm.vendor_catalog_item_id = ${itemIdRef}
      AND pm.is_active = true
      AND pm.media_type = 'image'
    ORDER BY pm.is_primary DESC, pm.sort_order ASC
    LIMIT 1
  )`;

// ─── getCatalogItemPublic ─────────────────────────────────────────────────────

export async function getCatalogItemPublic(id: number) {
  const [row] = await db
    .select({
      id:               vendorCatalogItemsTable.id,
      vendorId:         vendorCatalogItemsTable.vendorId,
      vendorName:       vendorCatalogItemsTable.vendorName,
      templateKind:     vendorCatalogItemsTable.templateKind,
      categoryKey:      vendorCatalogItemsTable.categoryKey,
      serviceType:      vendorCatalogItemsTable.serviceType,
      templateId:       vendorCatalogItemsTable.templateId,
      templateVersion:  vendorCatalogItemsTable.templateVersion,
      templateSnapshot: vendorCatalogItemsTable.templateSnapshot,
      name:             vendorCatalogItemsTable.name,
      description:      vendorCatalogItemsTable.description,
      kategori:         vendorCatalogItemsTable.kategori,
      subcategory:      vendorCatalogItemsTable.subcategory,
      specValues:       vendorCatalogItemsTable.specValues,
      priceSell:        vendorCatalogItemsTable.priceSell,
      currency:         vendorCatalogItemsTable.currency,
      unit:             vendorCatalogItemsTable.unit,
      moq:              vendorCatalogItemsTable.moq,
      stockStatus:      vendorCatalogItemsTable.stockStatus,
      stockQty:         vendorCatalogItemsTable.stockQty,
      leadTime:         vendorCatalogItemsTable.leadTime,
      validityDate:     vendorCatalogItemsTable.validityDate,
      location:         vendorCatalogItemsTable.location,
      origin:           vendorCatalogItemsTable.origin,
      documents:        vendorCatalogItemsTable.documents,
      publishedAt:      vendorCatalogItemsTable.publishedAt,
      isPublished:      vendorCatalogItemsTable.isPublished,
      mediaAssets:      vendorCatalogItemsTable.mediaAssets,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, and(eq(suppliersTable.id, vendorCatalogItemsTable.vendorId), ...catalogSupplierConditions()))
    .where(and(eq(vendorCatalogItemsTable.id, id), ...catalogPublicConditions()));
  if (!row) return null;
  return { ...row, priceSell: row.priceSell !== null ? Number(row.priceSell) : null };
}

// ─── listPublicMarketplaceItems ───────────────────────────────────────────────

export interface MarketplaceListFilters {
  kind?: string;
  category?: string;
  vendorId?: string;
  /** Full-text search term — matched ILIKE against name, description, vendorName, kategori */
  q?: string;
  /** Backward-compatible alias for q (both are accepted, q takes precedence) */
  search?: string;
}

export async function listPublicMarketplaceItems(filters: MarketplaceListFilters) {
  const { kind, category, vendorId } = filters;
  const searchTerm = (filters.q ?? filters.search ?? "").trim();

  const conditions: ReturnType<typeof eq>[] = [
    ...catalogPublicConditions(),
    or(isNull(vendorCatalogItemsTable.validityDate), gte(vendorCatalogItemsTable.validityDate, sql`CURRENT_DATE`)) as ReturnType<typeof eq>,
  ];

  if (kind === "service") {
    conditions.push(eq(vendorCatalogItemsTable.templateKind, "service"));
  } else if (kind === "product") {
    // Items with templateKind=null are legacy products — include them in the product tab
    conditions.push(
      or(
        eq(vendorCatalogItemsTable.templateKind, "product"),
        isNull(vendorCatalogItemsTable.templateKind),
      ) as ReturnType<typeof eq>,
    );
  }
  if (vendorId) {
    const vid = parseInt(vendorId, 10);
    if (!isNaN(vid)) conditions.push(eq(vendorCatalogItemsTable.vendorId, vid));
  }
  if (category && category !== "all") {
    const normCategory = normalizeServiceCategory(category);
    if (normCategory) {
      const matchKeys = Object.entries(SERVICE_CATEGORY_ALIASES)
        .filter(([, v]) => v === normCategory)
        .map(([k]) => k);
      const rawLower = category.toLowerCase().trim();
      const allVariants = Array.from(new Set([
        normCategory,
        rawLower,
        rawLower.replace(/[\s-]+/g, "_"),
        rawLower.replace(/[\s_]+/g, "-"),
        rawLower.replace(/[\s_-]+/g, " "),
        ...matchKeys,
        ...matchKeys.map((k) => k.replace(/[\s-]+/g, "_")),
        ...matchKeys.map((k) => k.replace(/[\s_]+/g, "-")),
        ...matchKeys.map((k) => k.replace(/[\s_-]+/g, " ")),
      ]));
      const normalizeDbExpr = (col: ReturnType<typeof sql>) =>
        sql`lower(trim(replace(replace(${col}::text, '-', '_'), ' ', '_')))`;
      const variantConditions = allVariants.flatMap((v) => [
        sql`${normalizeDbExpr(sql`${vendorCatalogItemsTable.serviceType}`)} = ${v}`,
        sql`${normalizeDbExpr(sql`${vendorCatalogItemsTable.categoryKey}`)} = ${v}`,
        sql`${normalizeDbExpr(sql`${vendorCatalogItemsTable.kategori}`)} = ${v}`,
        sql`${normalizeDbExpr(sql`${vendorCatalogItemsTable.templateSnapshot}::text::jsonb->>'serviceType'`)} = ${v}`,
        sql`${normalizeDbExpr(sql`${vendorCatalogItemsTable.templateSnapshot}::text::jsonb->>'category'`)} = ${v}`,
      ]);
      conditions.push(or(...variantConditions) as ReturnType<typeof eq>);
    }
  }

  // ── Full-text search (q, alias: search) — ILIKE across the fields buyers
  // actually type: name, description, category, origin/location, vendor name,
  // and the raw JSON text of specValues (so spec values like grade/variant
  // codes are searchable too, e.g. "R320", "MD2"). ──────────────────────────
  if (searchTerm) {
    const term = `%${searchTerm}%`;
    conditions.push(
      or(
        ilike(vendorCatalogItemsTable.name, term),
        ilike(vendorCatalogItemsTable.description, term),
        ilike(vendorCatalogItemsTable.categoryKey, term),
        ilike(vendorCatalogItemsTable.kategori, term),
        ilike(vendorCatalogItemsTable.subcategory, term),
        ilike(vendorCatalogItemsTable.serviceType, term),
        ilike(vendorCatalogItemsTable.origin, term),
        ilike(vendorCatalogItemsTable.location, term),
        ilike(vendorCatalogItemsTable.vendorName, term),
        ilike(suppliersTable.name, term),
        ilike(sql`${vendorCatalogItemsTable.specValues}::text`, term),
      ) as ReturnType<typeof eq>,
    );
  }

  const rows = await db
    .select({
      id:               vendorCatalogItemsTable.id,
      vendorId:         vendorCatalogItemsTable.vendorId,
      vendorName:       vendorCatalogItemsTable.vendorName,
      supplierName:     suppliersTable.name,
      templateKind:     vendorCatalogItemsTable.templateKind,
      categoryKey:      vendorCatalogItemsTable.categoryKey,
      serviceType:      vendorCatalogItemsTable.serviceType,
      templateId:       vendorCatalogItemsTable.templateId,
      templateSnapshot: vendorCatalogItemsTable.templateSnapshot,
      name:             vendorCatalogItemsTable.name,
      description:      vendorCatalogItemsTable.description,
      kategori:         vendorCatalogItemsTable.kategori,
      subcategory:      vendorCatalogItemsTable.subcategory,
      specValues:       vendorCatalogItemsTable.specValues,
      priceSell:        vendorCatalogItemsTable.priceSell,
      currency:         vendorCatalogItemsTable.currency,
      unit:             vendorCatalogItemsTable.unit,
      moq:              vendorCatalogItemsTable.moq,
      stockStatus:      vendorCatalogItemsTable.stockStatus,
      stockQty:         vendorCatalogItemsTable.stockQty,
      leadTime:         vendorCatalogItemsTable.leadTime,
      location:         vendorCatalogItemsTable.location,
      origin:           vendorCatalogItemsTable.origin,
      publishedAt:      vendorCatalogItemsTable.publishedAt,
      validityDate:     vendorCatalogItemsTable.validityDate,
      isFeatured:       vendorCatalogItemsTable.isFeatured,
      sortOrder:        vendorCatalogItemsTable.sortOrder,
      mediaAssets:      vendorCatalogItemsTable.mediaAssets,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, and(eq(vendorCatalogItemsTable.vendorId, suppliersTable.id), ...catalogSupplierConditions()))
    .where(and(...conditions))
    .orderBy(desc(vendorCatalogItemsTable.isFeatured), vendorCatalogItemsTable.sortOrder, desc(vendorCatalogItemsTable.publishedAt));

  return rows.map((r) => {
    const rawCat = r.serviceType || r.kategori || r.categoryKey;
    const resolvedCategory = normalizeServiceCategory(rawCat);
    return {
      ...r,
      vendorName:    r.vendorName || r.supplierName || null,
      priceSell:     r.priceSell !== null ? Number(r.priceSell) : null,
      stockStatus:   normalizeMarketplaceStockStatus(r.stockStatus),
      primaryImageUrl: resolveMediaAssetsImage(r.mediaAssets),
      validityDate:  r.validityDate ?? null,
      isFeatured:    r.isFeatured ?? false,
      resolvedCategory,
      resolvedCategoryLabel: resolvedCategory
        ? (SERVICE_CATEGORY_LABELS[resolvedCategory] ?? resolvedCategory)
        : null,
    };
  });
}

// ─── media_assets fallback (when product_media table has no rows) ────────────

// Generic brochure/company assets that ship on every vendor's media_assets —
// never product-specific, so they must never appear in a product gallery.
const MEDIA_ASSETS_EXCLUDED_SLUGS = [
  "cover-main",
  "quality-assurance",
  "company-profile",
  "legality",
  "contact-us",
];

function isExcludedMediaAsset(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  return MEDIA_ASSETS_EXCLUDED_SLUGS.some((slug) => lower.includes(slug));
}

// NOTE: mediaAssetsToMarketplaceMedia moved below (canonical 3-arg version,
// see line ~1048) — this file previously had a duplicate 2-arg declaration
// here that esbuild rejected as a duplicate top-level export; removed.

// ─── getHeroCategoryTiles ────────────────────────────────────────────────────
// Returns one tile per hero category.
// Image source: vendor_catalog_items.media_assets JSONB only (canonical public source).
// No product_media join — keeps Hero and Product Detail on the same source of truth.
//
// Image priority (per asset):
//   1. type=image, isPrimary=true, visibility=public (or visibility absent → legacy public)
//   2. type=image, visibility=public (or absent), lowest sortOrder
//   Excludes assets explicitly marked visibility != public.
//
// If a category has no qualifying image, the tile is omitted.

const HERO_CATEGORY_DEFS = [
  { categoryKey: "coffee",           label: "Kopi"           },
  { categoryKey: "palm_oil",         label: "Sawit"          },
  { categoryKey: "cashew_nut",       label: "Kacang Mete"    },
  { categoryKey: "seafood",          label: "Seafood"        },
  { categoryKey: "fresh_pineapple",  label: "Nanas Segar"    },
  { categoryKey: "canned_pineapple", label: "Nanas Kalengan" },
] as const;

export interface HeroCategoryTile {
  label:       string;
  categoryKey: string;
  imageUrl:    string;
  productId:   number;
  vendorId:    number;
}

export async function getHeroCategoryTiles(): Promise<HeroCategoryTile[]> {
  const results = await Promise.all(
    HERO_CATEGORY_DEFS.map(async ({ categoryKey, label }) => {
      // Single row — best product per category (featured first, then newest).
      // No JOIN: image comes exclusively from media_assets JSONB.
      const [row] = await db
        .select({
          id:          vendorCatalogItemsTable.id,
          vendorId:    vendorCatalogItemsTable.vendorId,
          mediaAssets: vendorCatalogItemsTable.mediaAssets,
        })
        .from(vendorCatalogItemsTable)
        .innerJoin(suppliersTable, and(eq(suppliersTable.id, vendorCatalogItemsTable.vendorId), ...catalogSupplierConditions()))
        .where(
          and(
            ...catalogPublicConditions(),
            or(
              isNull(vendorCatalogItemsTable.validityDate),
              gte(vendorCatalogItemsTable.validityDate, sql`CURRENT_DATE`),
            ) as ReturnType<typeof eq>,
            or(
              eq(vendorCatalogItemsTable.categoryKey, categoryKey),
              ilike(vendorCatalogItemsTable.kategori, categoryKey.replace(/_/g, " ")),
            ) as ReturnType<typeof eq>,
          ),
        )
        .orderBy(
          desc(vendorCatalogItemsTable.isFeatured),
          desc(vendorCatalogItemsTable.publishedAt),
        )
        .limit(1);

      if (!row) return null;

      const imageUrl = resolveMediaAssetsImage(row.mediaAssets);
      if (!imageUrl) return null;

      return {
        label,
        categoryKey,
        imageUrl,
        productId: row.id,
        vendorId:  row.vendorId,
      } as HeroCategoryTile;
    }),
  );

  return results.filter((r): r is NonNullable<(typeof results)[number]> => r !== null) as HeroCategoryTile[];
}

// ─── getMarketplaceItemMedia ──────────────────────────────────────────────────

export async function getMarketplaceItemMedia(id: number) {
  try {
    const result = await db.execute(sql`
      SELECT * FROM product_media
      WHERE vendor_catalog_item_id = ${id}
        AND is_active = true
        AND (image_source IS NULL OR image_source != 'ai' OR ai_image_status = 'approved')
      ORDER BY sort_order ASC, created_at ASC
    `);
    return Array.isArray(result) ? result : ((result as any).rows ?? []);
  } catch {
    return [];
  }
}

// ─── getRelatedItems ──────────────────────────────────────────────────────────

export async function getRelatedItems(id: number, item: NonNullable<Awaited<ReturnType<typeof getCatalogItemPublic>>>) {
  const vci = vendorCatalogItemsTable;
  const rows = await db
    .select({ ...CATALOG_PUBLIC_COLS })
    .from(vci)
    .innerJoin(suppliersTable, and(eq(suppliersTable.id, vci.vendorId), ...catalogSupplierConditions()))
    .where(and(
      eq(vci.vendorId, item.vendorId),
      ne(vci.id, id),
      ...catalogPublicConditions(vci),
    ))
    .orderBy(
      sql`CASE WHEN ${vci.categoryKey} = ${item.categoryKey ?? ""} THEN 0 ELSE 1 END`,
      item.priceSell != null
        ? sql`CASE WHEN ${vci.priceSell} IS NOT NULL THEN ABS(${vci.priceSell}::numeric - ${String(item.priceSell)}::numeric) ELSE CAST(999999 AS numeric) END`
        : sql`CAST(999999 AS numeric)`,
      desc(vci.publishedAt),
    )
    .limit(8);
  return rows.map((r) => ({
    ...r,
    priceSell: r.priceSell !== null ? Number(r.priceSell) : null,
    primaryImageUrl: resolveMediaAssetsImage(r.mediaAssets),
  }));
}

// ─── getSimilarItems ──────────────────────────────────────────────────────────

export async function getSimilarItems(id: number, item: NonNullable<Awaited<ReturnType<typeof getCatalogItemPublic>>>) {
  const vci = vendorCatalogItemsTable;

  const commodityVal = item.specValues && typeof item.specValues === "object"
    ? (item.specValues as Record<string, unknown>)["commodity"]
      ?? (item.specValues as Record<string, unknown>)["komoditi"]
      ?? null
    : null;
  void commodityVal;

  const conditions: ReturnType<typeof eq>[] = [
    ne(vci.id, id),
    ...catalogPublicConditions(vci),
  ];
  if (item.templateKind) conditions.push(eq(vci.templateKind, item.templateKind));

  const matchConditions = [];
  if (item.categoryKey) matchConditions.push(eq(vci.categoryKey, item.categoryKey));
  if (item.serviceType) matchConditions.push(eq(vci.serviceType, item.serviceType));
  if (item.kategori)    matchConditions.push(eq(vci.kategori, item.kategori));
  if (matchConditions.length > 0) conditions.push(or(...matchConditions)!);

  const rows = await db
    .select({ ...CATALOG_PUBLIC_COLS })
    .from(vci)
    .innerJoin(suppliersTable, and(eq(suppliersTable.id, vci.vendorId), ...catalogSupplierConditions()))
    .where(and(...conditions))
    .orderBy(
      sql`CASE WHEN ${vci.vendorId} = ${item.vendorId} THEN 1 ELSE 0 END`,
      sql`CASE WHEN ${vci.categoryKey} = ${item.categoryKey ?? ""} THEN 0 ELSE 1 END`,
      desc(vci.publishedAt),
    )
    .limit(8);
  return rows.map((r) => ({
    ...r,
    priceSell: r.priceSell !== null ? Number(r.priceSell) : null,
    primaryImageUrl: resolveMediaAssetsImage(r.mediaAssets),
  }));
}

// ─── getSameProvinceItems ─────────────────────────────────────────────────────

export async function getSameProvinceItems(id: number, item: NonNullable<Awaited<ReturnType<typeof getCatalogItemPublic>>>) {
  const rawLocation = item.location ?? "";
  const province = rawLocation.includes(",")
    ? rawLocation.split(",").pop()!.trim()
    : rawLocation.trim();
  if (!province) return [];

  const vci = vendorCatalogItemsTable;
  const rows = await db
    .select({ ...CATALOG_PUBLIC_COLS })
    .from(vci)
    .innerJoin(suppliersTable, and(eq(suppliersTable.id, vci.vendorId), ...catalogSupplierConditions()))
    .where(and(
      ne(vci.id, id),
      ne(vci.vendorId, item.vendorId),
      ilike(vci.location, `%${province}%`),
      ...catalogPublicConditions(vci),
    ))
    .orderBy(
      sql`CASE WHEN ${vci.categoryKey} = ${item.categoryKey ?? ""} THEN 0 ELSE 1 END`,
      desc(vci.publishedAt),
    )
    .limit(8);
  return rows.map((r) => ({
    ...r,
    priceSell: r.priceSell !== null ? Number(r.priceSell) : null,
    primaryImageUrl: resolveMediaAssetsImage(r.mediaAssets),
  }));
}

// ─── getVendorPublicProfile ───────────────────────────────────────────────────
// Hanya mengembalikan field publik. Dokumen sensitif (KTP, rekening, catatan internal) TIDAK disertakan.
// bypassMarketplaceFilter=true digunakan untuk admin preview saja.

// Document types that are safe to show publicly (no KTP, no rekening, no internal notes)
const PUBLIC_LEGALITY_TYPES = new Set([
  "akta_perusahaan", "akta", "company_deed",
  "nib", "npwp",
  "sk_kemenkumham", "sk_menkumham",
  "export_license", "import_license",
  "siup", "tdp",
  "iso", "iso_9001", "iso_14001", "iso_22000",
  "halal", "halal_certificate",
  "fda", "haccp", "gmp", "bpom",
  "other_license", "certificate",
]);

const PUBLIC_QA_TYPES = new Set([
  "coa", "certificate_of_analysis",
  "sgs", "sgs_certificate",
  "inspection", "inspection_report",
  "factory_audit", "factory_audit_report",
  "pre_shipment_inspection", "psi",
  "quality_control", "qc_report",
  "packaging_inspection", "packaging_report",
  "shipment_inspection",
  "survey_report",
]);

export async function getVendorPublicProfile(vendorId: number, bypassMarketplaceFilter = false) {
  const conditions: ReturnType<typeof eq>[] = [eq(suppliersTable.id, vendorId)];
  if (!bypassMarketplaceFilter) {
    conditions.push(eq(suppliersTable.status, "active") as any);
    conditions.push(eq(suppliersTable.isVerified, true) as any);
    conditions.push(eq(suppliersTable.marketplaceStatus, "published") as any);
  }
  const [vendor] = await db
    .select({
      id:                   suppliersTable.id,
      name:                 suppliersTable.name,
      logo:                 suppliersTable.logo,
      logoUrl:              suppliersTable.logoUrl,
      coverUrl:             suppliersTable.coverUrl,
      descriptionPublic:    suppliersTable.descriptionPublic,
      serviceAreas:         suppliersTable.serviceAreas,
      location:             suppliersTable.address,
      serviceType:          suppliersTable.serviceType,
      country:              suppliersTable.country,
      isVerified:           suppliersTable.isVerified,
      isPremium:            suppliersTable.isPremium,
      isFeatured:           suppliersTable.isFeatured,
      marketplaceStatus:    suppliersTable.marketplaceStatus,
      publicSlug:           suppliersTable.publicSlug,
      status:               suppliersTable.status,
      createdAt:            suppliersTable.createdAt,
      // Phase 5: contact + company link
      phone:                suppliersTable.phone,
      contactEmail:         suppliersTable.contactEmail,
      companyId:            suppliersTable.companyId,
    })
    .from(suppliersTable)
    .where(and(...conditions as any));
  if (!vendor) return null;

  // Phase 5: parallel queries for perf, catalog counts, company info, public documents
  const [perf, countResult, companyRow, docsRows] = await Promise.all([
    db
      .select({
        totalOrders:             vendorPerformanceTable.totalOrders,
        completedOrders:         vendorPerformanceTable.completedOrders,
        ontimePercentage:        vendorPerformanceTable.ontimePercentage,
        avgResponseHours:        vendorPerformanceTable.avgResponseHours,
        averageResponseMinutes:  vendorPerformanceTable.averageResponseMinutes,
        customerRating:          vendorPerformanceTable.customerRating,
        vendorGrade:             vendorPerformanceTable.vendorGrade,
        score:                   vendorPerformanceTable.score,
        lastCalculatedAt:        vendorPerformanceTable.lastCalculatedAt,
        totalRfqInvites:         vendorPerformanceTable.totalRfqInvites,
        totalSubmitted:          vendorPerformanceTable.totalSubmitted,
        totalSelected:           vendorPerformanceTable.totalSelected,
      })
      .from(vendorPerformanceTable)
      .where(eq(vendorPerformanceTable.vendorId, vendorId))
      .then((r) => r[0]),

    db
      .select({
        products: sql<number>`count(*) filter (where ${vendorCatalogItemsTable.templateKind} = 'product')`,
        services: sql<number>`count(*) filter (where ${vendorCatalogItemsTable.templateKind} = 'service')`,
        featured: sql<number>`count(*) filter (where ${vendorCatalogItemsTable.isFeatured} = true)`,
      })
      .from(vendorCatalogItemsTable)
      .where(and(
        eq(vendorCatalogItemsTable.vendorId, vendorId),
        ...catalogPublicConditions(),
      ))
      .then((r) => r[0]),

    vendor.companyId
      ? db
          .select({
            companyName:      companiesTable.companyName,
            address:          companiesTable.address,
            city:             companiesTable.city,
            province:         companiesTable.province,
            phone:            companiesTable.phone,
            email:            companiesTable.email,
            website:          companiesTable.website,
            npwp:             companiesTable.npwp,
            nib:              companiesTable.nib,
            bentukBadanHukum: companiesTable.bentukBadanHukum,
            tanggalTerdaftar: companiesTable.tanggalTerdaftar,
            kegiatanUtama:    companiesTable.kegiatanUtama,
          })
          .from(companiesTable)
          .where(eq(companiesTable.id, vendor.companyId))
          .then((r) => r[0] ?? null)
      : Promise.resolve(null),

    db
      .select({
        id:                 supplierDocumentsTable.id,
        documentType:       supplierDocumentsTable.documentType,
        documentName:       supplierDocumentsTable.documentName,
        documentNumber:     supplierDocumentsTable.documentNumber,
        fileUrl:            supplierDocumentsTable.fileUrl,
        verificationStatus: supplierDocumentsTable.verificationStatus,
        issuedAt:           supplierDocumentsTable.issuedAt,
        expiresAt:          supplierDocumentsTable.expiresAt,
      })
      .from(supplierDocumentsTable)
      .where(and(
        eq(supplierDocumentsTable.supplierId, vendorId),
        eq(supplierDocumentsTable.verificationStatus, "verified"),
      )),
  ]);

  // Separate docs into legality and QA buckets
  const legalityDocs = docsRows.filter((d) => PUBLIC_LEGALITY_TYPES.has((d.documentType ?? "").toLowerCase()));
  const qaDocs       = docsRows.filter((d) => PUBLIC_QA_TYPES.has((d.documentType ?? "").toLowerCase()));

  // Compute RFQ response rate (submitted / invited)
  const rfqInvites   = perf?.totalRfqInvites  ?? 0;
  const rfqSubmitted = perf?.totalSubmitted    ?? 0;
  const rfqSelected  = perf?.totalSelected     ?? 0;
  const rfqResponseRate = rfqInvites > 0 ? Math.round((rfqSubmitted / rfqInvites) * 100) : null;

  return {
    vendor,
    company: companyRow ?? null,
    performance: perf
      ? {
          totalOrders:            perf.totalOrders,
          completedOrders:        perf.completedOrders,
          ontimePercentage:       perf.ontimePercentage !== null ? Number(perf.ontimePercentage) : null,
          avgResponseHours:       perf.avgResponseHours !== null ? Number(perf.avgResponseHours) : null,
          averageResponseMinutes: perf.averageResponseMinutes !== null ? Number(perf.averageResponseMinutes) : null,
          customerRating:         perf.customerRating !== null ? Number(perf.customerRating) : null,
          vendorGrade:            perf.vendorGrade,
          score:                  perf.score !== null ? Number(perf.score) : null,
          lastCalculatedAt:       perf.lastCalculatedAt,
          rfqInvites,
          rfqSubmitted,
          rfqSelected,
          rfqResponseRate,
        }
      : null,
    productCount:  Number(countResult?.products ?? 0),
    serviceCount:  Number(countResult?.services  ?? 0),
    featuredCount: Number(countResult?.featured  ?? 0),
    legalityDocs,
    qaDocs,
  };
}

// ─── listVendorCatalogPublic ──────────────────────────────────────────────────

export async function listVendorCatalogPublic(filters: { type?: string; kategori?: string }) {
  const { type, kategori } = filters;
  const conditions = [...catalogPublicConditions()];
  if (type === "product" || type === "service") {
    conditions.push(eq(vendorCatalogItemsTable.type, type));
  }
  if (kategori) {
    conditions.push(ilike(vendorCatalogItemsTable.kategori, `%${kategori}%`));
  }
  const rows = await db
    .select({
      id:          vendorCatalogItemsTable.id,
      vendorId:    vendorCatalogItemsTable.vendorId,
      vendorName:  suppliersTable.name,
      vendorLogo:  suppliersTable.logo,
      type:        vendorCatalogItemsTable.type,
      name:        vendorCatalogItemsTable.name,
      description: vendorCatalogItemsTable.description,
      unit:        vendorCatalogItemsTable.unit,
      kategori:    vendorCatalogItemsTable.kategori,
      subcategory: vendorCatalogItemsTable.subcategory,
      priceBase:   vendorCatalogItemsTable.priceBase,
      markupPct:   vendorCatalogItemsTable.markupPct,
      sortOrder:   vendorCatalogItemsTable.sortOrder,
      mediaAssets: vendorCatalogItemsTable.mediaAssets,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, and(eq(vendorCatalogItemsTable.vendorId, suppliersTable.id), ...catalogSupplierConditions()))
    .where(and(...conditions))
    .orderBy(vendorCatalogItemsTable.sortOrder, vendorCatalogItemsTable.name);

  return rows.map((r) => {
    const base     = Number(r.priceBase);
    const markup   = Number(r.markupPct);
    const sellPrice = base > 0 ? Math.ceil(base * (1 + markup / 100)) : 0;
    return {
      id:              r.id,
      vendorId:        r.vendorId,
      vendorName:      r.vendorName,
      vendorLogo:      r.vendorLogo,
      type:            r.type,
      name:            r.name,
      description:     r.description ?? null,
      unit:            r.unit ?? null,
      kategori:        r.kategori ?? null,
      subcategory:     r.subcategory ?? null,
      sellPrice,
      sortOrder:       r.sortOrder,
      primaryImageUrl: resolveMediaAssetsImage(r.mediaAssets),
    };
  });
}

// ─── compareVendorCatalog ─────────────────────────────────────────────────────

export async function compareVendorCatalog(type?: string) {
  const conditions = [...catalogPublicConditions()];
  if (type === "product" || type === "service") {
    conditions.push(eq(vendorCatalogItemsTable.type, type));
  }
  const rows = await db
    .select({
      id:          vendorCatalogItemsTable.id,
      vendorId:    vendorCatalogItemsTable.vendorId,
      vendorName:  suppliersTable.name,
      vendorLogo:  suppliersTable.logo,
      type:        vendorCatalogItemsTable.type,
      name:        vendorCatalogItemsTable.name,
      description: vendorCatalogItemsTable.description,
      unit:        vendorCatalogItemsTable.unit,
      kategori:    vendorCatalogItemsTable.kategori,
      subcategory: vendorCatalogItemsTable.subcategory,
      priceBase:   vendorCatalogItemsTable.priceBase,
      markupPct:   vendorCatalogItemsTable.markupPct,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(and(...conditions))
    .orderBy(vendorCatalogItemsTable.name);

  const groupMap = new Map<string, {
    itemName: string; type: string; kategori: string | null;
    vendors: { id: number; vendorId: number; vendorName: string; vendorLogo: string | null; sellPrice: number; unit: string | null; description: string | null }[];
  }>();

  for (const r of rows) {
    const base      = Number(r.priceBase);
    const markup    = Number(r.markupPct);
    const sellPrice = base > 0 ? Math.ceil(base * (1 + markup / 100)) : 0;
    const key       = r.name.toLowerCase().trim();
    if (!groupMap.has(key)) {
      groupMap.set(key, { itemName: r.name, type: r.type, kategori: r.kategori ?? null, vendors: [] });
    }
    groupMap.get(key)!.vendors.push({
      id: r.id, vendorId: r.vendorId, vendorName: r.vendorName,
      vendorLogo: r.vendorLogo, sellPrice, unit: r.unit ?? null, description: r.description ?? null,
    });
  }

  const groups = Array.from(groupMap.values())
    .filter((g) => g.vendors.length >= 2)
    .sort((a, b) => b.vendors.length - a.vendors.length)
    .map((g) => {
      const prices   = g.vendors.map((v) => v.sellPrice).filter((p) => p > 0);
      const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
      const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
      const vendorsSorted = [...g.vendors].sort((a, b) => {
        if (a.sellPrice === 0 && b.sellPrice === 0) return 0;
        if (a.sellPrice === 0) return 1;
        if (b.sellPrice === 0) return -1;
        return a.sellPrice - b.sellPrice;
      });
      return { ...g, vendors: vendorsSorted, minPrice, maxPrice, vendorCount: g.vendors.length };
    });

  return { groups, totalGroups: groups.length };
}

// ─── listProductTemplates / listServiceTemplates ──────────────────────────────

export async function listProductTemplates() {
  return db
    .select({
      id:                   productTemplatesTable.id,
      categoryKey:          productTemplatesTable.categoryKey,
      label:                productTemplatesTable.label,
      icon:                 productTemplatesTable.icon,
      description:          productTemplatesTable.description,
      version:              productTemplatesTable.version,
      sortOrder:            productTemplatesTable.sortOrder,
      customFields:         productTemplatesTable.customFields,
      requiredDocuments:    productTemplatesTable.requiredDocuments,
      checklist:            productTemplatesTable.checklist,
      packagingInstructions: productTemplatesTable.packagingInstructions,
    })
    .from(productTemplatesTable)
    .where(eq(productTemplatesTable.isActive, true))
    .orderBy(productTemplatesTable.sortOrder, productTemplatesTable.label);
}

export async function listServiceTemplates() {
  return db
    .select({
      id:                serviceTemplatesTable.id,
      serviceType:       serviceTemplatesTable.serviceType,
      label:             serviceTemplatesTable.label,
      emoji:             serviceTemplatesTable.emoji,
      description:       serviceTemplatesTable.description,
      version:           serviceTemplatesTable.version,
      sortOrder:         serviceTemplatesTable.sortOrder,
      fields:            serviceTemplatesTable.fields,
      requiredDocuments: serviceTemplatesTable.requiredDocuments,
      checklist:         serviceTemplatesTable.checklist,
    })
    .from(serviceTemplatesTable)
    .where(eq(serviceTemplatesTable.isActive, true))
    .orderBy(serviceTemplatesTable.sortOrder, serviceTemplatesTable.label);
}

// ─── getLinkedSupplier ────────────────────────────────────────────────────────

export async function getLinkedSupplier(customerId: number) {
  const [customer] = await db
    .select()
    .from(portalCustomersTable)
    .where(eq(portalCustomersTable.id, customerId));
  if (!customer) return null;
  const allSuppliers = await db.select().from(suppliersTable);
  const normalizePhone = (p: string | null) =>
    p ? p.replace(/[^\d]/g, "").replace(/^0/, "62") : null;
  const customerPhone = normalizePhone(customer.phone);
  return (
    allSuppliers.find(
      (s) =>
        (s.contactEmail && s.contactEmail.toLowerCase() === customer.email.toLowerCase()) ||
        (customerPhone && normalizePhone(s.phone) === customerPhone),
    ) ?? null
  );
}

// ─── listVendorOwnCatalog ─────────────────────────────────────────────────────

export async function listVendorOwnCatalog(supplierId: number, supplierName: string) {
  const rows = await db.execute(sql`
    SELECT
      vci.id,
      vci.name,
      vci.template_kind,
      vci.kategori,
      vci.category_key,
      vci.is_active,
      vci.is_published,
      vci.status,
      vci.description,
      vci.moq,
      vci.origin,
      vci.hs_code,
      vci.spec_values,
      vci.price_sell,
      vci.unit,
      COALESCE(vci.media_assets, '[]'::jsonb) AS media_assets
    FROM vendor_catalog_items vci
    WHERE vci.vendor_id = ${supplierId}
    ORDER BY
      CASE WHEN vci.status = 'archived' THEN 1 ELSE 0 END ASC,
      vci.sort_order ASC NULLS LAST,
      vci.id ASC
  `);

  return {
    supplierId,
    supplierName,
    items: ((rows as any).rows as any[]).map((r: any) => {
      const mediaAssets: unknown[] = Array.isArray(r.media_assets) ? r.media_assets : [];
      return {
        id:           r.id,
        name:         r.name,
        templateKind: r.template_kind,
        kategori:     r.kategori,
        categoryKey:  r.category_key,
        isActive:     r.is_active,
        isPublished:  r.is_published,
        status:       r.status ?? "draft",
        description:  r.description,
        moq:          r.moq ?? null,
        origin:       r.origin ?? null,
        hsCode:       r.hs_code ?? null,
        priceSell:    r.price_sell ?? null,
        unit:         r.unit ?? null,
        mediaCount:   mediaAssets.length,
        images:       [], // legacy — callers must use mediaAssets
        mediaAssets,
      };
    }),
  };
}

// ─── deleteVendorCatalogMedia ─────────────────────────────────────────────────

export interface DeleteVendorMediaResult {
  storagePath: string | null;
  isPrimary:   boolean;
  nextMediaId: number | null;
  vendorCatalogItemId: number | null;
}

export async function deleteVendorCatalogMedia(
  mediaId: number,
  supplierId: number,
): Promise<DeleteVendorMediaResult> {
  const [media] = await db
    .select()
    .from(productMediaTable)
    .where(eq(productMediaTable.id, mediaId));
  if (!media) throw Object.assign(new Error("Media tidak ditemukan"), { statusCode: 404 });
  if (media.vendorId !== supplierId) throw Object.assign(new Error("Bukan milik vendor ini"), { statusCode: 403 });

  await db.delete(productMediaTable).where(eq(productMediaTable.id, mediaId));

  let nextMediaId: number | null = null;
  if (media.isPrimary && media.vendorCatalogItemId) {
    const [next] = await db
      .select({ id: productMediaTable.id })
      .from(productMediaTable)
      .where(and(
        eq(productMediaTable.vendorCatalogItemId, media.vendorCatalogItemId),
        eq(productMediaTable.isActive, true),
      ))
      .orderBy(asc(productMediaTable.sortOrder), asc(productMediaTable.createdAt))
      .limit(1);
    if (next) {
      await db
        .update(productMediaTable)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(productMediaTable.id, next.id));
      nextMediaId = next.id;
    }
  }

  return {
    storagePath:         media.storagePath ?? null,
    isPrimary:           media.isPrimary ?? false,
    nextMediaId,
    vendorCatalogItemId: media.vendorCatalogItemId ?? null,
  };
}

// ─── getMarketplaceStats ──────────────────────────────────────────────────────

export async function getMarketplaceStats() {
  // NOTE: itemCount/vendorCount/categoryCount are scoped to template_kind='product'
  // so they match the public marketplace listing (which is product-only —
  // the service tab was removed from the UI). verifiedVendors/totalRfqs/avgRating
  // intentionally keep their original, unfiltered (product+service) scope.
  const result = await db.execute(sql`
    WITH product_items AS (
      SELECT vendor_id, category_key, service_type
      FROM vendor_catalog_items
      WHERE is_published = true
        AND is_active != false
        AND (validity_date IS NULL OR validity_date >= CURRENT_DATE)
        AND template_kind = 'product'
    )
    SELECT
      (SELECT COUNT(*)::int FROM product_items)                                        AS item_count,
      (SELECT COUNT(DISTINCT vendor_id)::int FROM product_items)                        AS vendor_count,
      (SELECT COUNT(DISTINCT COALESCE(category_key, service_type))::int FROM product_items) AS category_count,
      (
        SELECT COUNT(DISTINCT CASE WHEN vp.vendor_grade IS NOT NULL THEN vci.vendor_id END)::int
        FROM vendor_catalog_items vci
        LEFT JOIN vendor_performance vp ON vp.vendor_id = vci.vendor_id
        WHERE vci.is_published = true
          AND vci.is_active != false
          AND (vci.validity_date IS NULL OR vci.validity_date >= CURRENT_DATE)
      )                                                                                 AS verified_vendors,
      (
        SELECT COUNT(*)::int FROM portal_product_orders
        WHERE status ILIKE 'Quote%' OR status = 'RFQ'
      )                                                                                 AS total_rfqs,
      (
        SELECT ROUND(AVG(customer_rating)::numeric, 1)
        FROM vendor_performance
        WHERE customer_rating IS NOT NULL AND customer_rating > 0
      )                                                                                 AS avg_rating
  `);
  const row = ((result as any).rows ?? result)[0] as Record<string, unknown>;
  const itemCount      = Number(row?.item_count      ?? 0);
  const vendorCount    = Number(row?.vendor_count    ?? 0);
  const categoryCount  = Number(row?.category_count  ?? 0);
  const verifiedVendors = Number(row?.verified_vendors ?? 0);
  const totalRfqs      = Number(row?.total_rfqs      ?? 0);
  const avgRating      = row?.avg_rating ? Number(row.avg_rating) : null;
  return {
    itemCount, vendorCount, categoryCount,
    totalItems: itemCount, totalVendors: vendorCount,
    verifiedVendors, totalRfqs, avgRating,
  };
}

// ─── uploadVendorCatalogMedia ─────────────────────────────────────────────────

const VENDOR_IMG_MIME = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export async function uploadVendorCatalogMedia(params: {
  itemId:        number;
  supplierId:    number;
  uploaderEmail: string | null;
  buffer:        Buffer;
  mimetype:      string;
}) {
  const { itemId, supplierId, uploaderEmail, buffer: rawBuffer, mimetype: rawMime } = params;

  // Validate MIME early (before any I/O)
  if (!VENDOR_IMG_MIME.has(rawMime)) {
    throw Object.assign(new Error("Hanya file JPG, PNG, atau WebP yang diizinkan"), { statusCode: 415 });
  }

  // Verify item ownership
  const [item] = await db
    .select({ id: vendorCatalogItemsTable.id })
    .from(vendorCatalogItemsTable)
    .where(and(eq(vendorCatalogItemsTable.id, itemId), eq(vendorCatalogItemsTable.vendorId, supplierId)));
  if (!item) throw Object.assign(new Error("Item tidak ditemukan atau bukan milik vendor ini"), { statusCode: 404 });

  // Compress if possible
  let buffer = rawBuffer;
  let mime   = rawMime;
  if (isCompressibleImage(mime)) {
    const c = await compressImageBuffer(buffer, mime, "photo");
    buffer = c.buffer;
    mime   = c.contentType;
  }

  // Upload to storage
  const folder = `product-media/vendor-${supplierId}/item-${itemId}`;
  const { publicUrl, storagePath } = await uploadToSupabase(buffer, mime, folder);

  // Determine primary flag
  const [existingPrimary] = await db
    .select({ id: productMediaTable.id })
    .from(productMediaTable)
    .where(and(
      eq(productMediaTable.vendorCatalogItemId, itemId),
      eq(productMediaTable.isPrimary, true),
      eq(productMediaTable.isActive, true),
    ));
  const isPrimary = !existingPrimary;

  const [inserted] = await db
    .insert(productMediaTable)
    .values({
      vendorCatalogItemId: itemId,
      vendorId:            supplierId,
      mediaType:           "image",
      fileUrl:             publicUrl,
      storagePath,
      isPrimary,
      isActive:            true,
      uploadedBy:          uploaderEmail ?? "vendor",
      uploadedByRole:      "vendor",
      sortOrder:           0,
      imageSource:         "vendor",
      aiImageStatus:       null,
    })
    .returning();

  return inserted;
}

// ─── listVendorCatalogSubmissions ─────────────────────────────────────────────

export async function listVendorCatalogSubmissions(customerId: number) {
  const [vp] = await db
    .select({ supplierId: vendorProfilesTable.supplierId })
    .from(vendorProfilesTable)
    .where(eq(vendorProfilesTable.customerId, customerId));

  if (!vp?.supplierId) return [];

  const links = await db
    .select({ id: vendorCatalogSubmissionLinksTable.id })
    .from(vendorCatalogSubmissionLinksTable)
    .where(eq(vendorCatalogSubmissionLinksTable.supplierId, vp.supplierId));

  if (!links.length) return [];

  const linkIds = links.map((l) => l.id);
  return db
    .select()
    .from(vendorCatalogSubmissionsTable)
    .where(inArray(vendorCatalogSubmissionsTable.linkId, linkIds))
    .orderBy(desc(vendorCatalogSubmissionsTable.createdAt));
}

// ─── mediaAssetsToMarketplaceMedia ────────────────────────────────────────────
// Converts vendor_catalog_items.media_assets JSONB → MarketplaceMediaItem[].
// Handles both old format (isCover/name/size) and new format (isPrimary/title/sizeBytes).
// Documents are excluded — call mediaAssetsToPublicDocs for those.
const _DOC_TYPES = new Set(["pdf", "document", "certificate", "brochure"]);

export function mediaAssetsToMarketplaceMedia(
  itemId: number,
  vendorId: number | null,
  assets: unknown,
): MarketplaceMediaItem[] {
  if (!Array.isArray(assets) || assets.length === 0) return [];
  return (assets as Array<Record<string, unknown>>)
    .filter((a) => {
      if (typeof a.url !== "string" || !a.url) return false;
      if (_DOC_TYPES.has(String(a.type ?? ""))) return false;
      // Exclude generic brochure/company assets — never product-specific.
      if (isExcludedMediaAsset(a.url as string)) return false;
      // Security: exclude assets explicitly marked private or internal.
      // Assets with no visibility field (legacy data, pre-visibility) are
      // treated as public for gallery backward-compatibility.
      const vis = a.visibility;
      if (vis !== undefined && vis !== null && String(vis) !== "public") return false;
      return true;
    })
    .map((a, i) => {
      const isVid   = a.type === "video";
      const isPrimary = a.isPrimary != null
        ? Boolean(a.isPrimary)
        : a.isCover != null
          ? Boolean(a.isCover)
          : i === 0;
      return {
        id:                  i + 1,
        vendorCatalogItemId: itemId,
        vendorId,
        mediaType:           isVid ? "video" : "image",
        fileUrl:             String(a.url),
        thumbnailUrl:        null,
        externalUrl:         isVid ? String(a.url) : null,
        title:               (a.title ?? a.name) != null ? String(a.title ?? a.name) : null,
        description:         a.description != null ? String(a.description) : null,
        sortOrder:           a.sortOrder != null ? Number(a.sortOrder) : i,
        isPrimary,
        isActive:            true,
        uploadedBy:          null,
        uploadedByRole:      null,
        storagePath:         a.objectPath != null ? String(a.objectPath) : null,
        imageSource:         "vendor",
        aiImageStatus:       null,
        generationPrompt:    null,
        duration:            null,
        fileSizeBytes:       a.sizeBytes != null
                               ? Number(a.sizeBytes)
                               : a.size != null
                                 ? Number(a.size)
                                 : null,
        isAiGenerated:       false,
        sourceLabel:         "Foto oleh Vendor",
      } as MarketplaceMediaItem;
    })
    .sort((a, b) =>
      (b.isPrimary ? 1 : 0) - (a.isPrimary ? 1 : 0) ||
      (a.sortOrder ?? 0) - (b.sortOrder ?? 0),
    );
}

export function mediaAssetsToPublicDocs(assets: unknown): PublicMediaDocument[] {
  if (!Array.isArray(assets)) return [];
  return (assets as Array<Record<string, unknown>>)
    .filter((a) => {
      if (typeof a.url !== "string" || !a.url) return false;
      if (!_DOC_TYPES.has(String(a.type ?? ""))) return false;
      return String(a.visibility ?? "") === "public";
    })
    .map((a, i) => ({
      id:          a.id != null ? String(a.id) : i + 1,
      type:        String(a.type ?? "document"),
      title:       (a.title ?? a.name) != null ? String(a.title ?? a.name) : null,
      fileUrl:     String(a.url),
      mimeType:    a.mimeType != null ? String(a.mimeType) : null,
      sizeBytes:   a.sizeBytes != null ? Number(a.sizeBytes) : null,
      visibility:  "public",
      documentKey: a.documentKey != null ? String(a.documentKey) : null,
    }));
}

// ─── getMarketplaceItemDetail ─────────────────────────────────────────────────

export interface MarketplaceMediaItem {
  id:                number;
  vendorCatalogItemId: number;
  vendorId:          number | null;
  mediaType:         string | null;
  fileUrl:           string | null;
  thumbnailUrl:      string | null;
  externalUrl:       string | null;
  title:             string | null;
  description:       string | null;
  sortOrder:         number | null;
  isPrimary:         boolean | null;
  isActive:          boolean | null;
  uploadedBy:        string | null;
  uploadedByRole:    string | null;
  storagePath:       string | null;
  imageSource:       string | null;
  aiImageStatus:     string | null;
  generationPrompt:  string | null;
  duration:          number | null;
  fileSizeBytes:     number | null;
  isAiGenerated:     boolean;
  sourceLabel:       string | null;
}

export interface PublicMediaDocument {
  id:          string | number;
  type:        string;
  title:       string | null;
  fileUrl:     string | null;
  mimeType:    string | null;
  sizeBytes:   number | null;
  visibility:  string | null;
  documentKey: string | null;
}

export interface MarketplaceItemDetail extends Omit<NonNullable<Awaited<ReturnType<typeof getCatalogItemPublic>>>, "mediaAssets"> {
  media:              MarketplaceMediaItem[];
  primaryImageUrl:    string | null;
  primaryImageSource: string | null;
  hasVideo:           boolean;
  mediaDocuments:     PublicMediaDocument[];
}

/**
 * Fetch a single published marketplace catalog item enriched with its media.
 * - Increments view_count (fire-and-forget, non-fatal)
 * - Returns null when item is not found / not published
 */
export async function getMarketplaceItemDetail(id: number): Promise<MarketplaceItemDetail | null> {
  const item = await getCatalogItemPublic(id);
  if (!item) return null;

  // Fire-and-forget view count increment — never blocks the response
  db.execute(sql`UPDATE vendor_catalog_items SET view_count = view_count + 1 WHERE id = ${id}`)
    .catch(() => {});

  // Sprint A — media_assets is the canonical source.
  // product_media table is no longer consulted for public marketplace display.
  const media = mediaAssetsToMarketplaceMedia(id, item.vendorId, item.mediaAssets);

  const mediaDocuments = mediaAssetsToPublicDocs(item.mediaAssets);

  const primaryMedia = media.find((m) => m.isPrimary) ?? (media.length > 0 ? media[0] : null);
  const primaryImageUrl    = primaryMedia?.mediaType === "image" ? (primaryMedia.fileUrl ?? null) : null;
  const primaryImageSource = primaryMedia?.imageSource ?? null;
  const hasVideo           = media.some((m) => m.mediaType === "video" || m.mediaType === "video_link");

  // Security: strip raw mediaAssets (unfiltered JSONB) from public response.
  // Public consumers must use the already-filtered `media` and `mediaDocuments` fields.
  const { mediaAssets: _rawMediaAssets, ...itemPublic } = item;
  return { ...itemPublic, media, primaryImageUrl, primaryImageSource, hasVideo, mediaDocuments };
}

import { Router } from "express";
import { db } from "@workspace/db";
import { vendorCatalogItemsTable, suppliersTable } from "@workspace/db";
import { eq, and, ilike, or, sql, asc, ne, isNull, gte } from "drizzle-orm";
import {
  isCatalogItemPublic,
  catalogPublicConditions,
  catalogSupplierConditions,
} from "../lib/catalogVisibility.js";

export { isCatalogItemPublic };

export const marketplaceRouter = Router();

// GET /api/marketplace/products — list published+active vendor catalog items (public)
// SECURITY: hanya ekspos priceSell, BUKAN priceBase
marketplaceRouter.get("/products", async (req, res) => {
  const { vendor, category, location, search } = req.query as Record<string, string>;

  const conditions = [
    ...catalogPublicConditions(),
    ...catalogSupplierConditions(),
    or(isNull(vendorCatalogItemsTable.validityDate), gte(vendorCatalogItemsTable.validityDate, sql`CURRENT_DATE`))!,
  ];

  if (vendor && !isNaN(Number(vendor))) {
    conditions.push(eq(vendorCatalogItemsTable.vendorId, Number(vendor)));
  }
  if (category) {
    const catCond = or(
      eq(vendorCatalogItemsTable.kategori, category),
      eq(vendorCatalogItemsTable.categoryKey, category),
    );
    if (catCond) conditions.push(catCond);
  }
  if (location) {
    conditions.push(ilike(vendorCatalogItemsTable.location, `%${location}%`));
  }
  if (search?.trim()) {
    const q = `%${search.trim()}%`;
    const searchCond = or(
      ilike(vendorCatalogItemsTable.name, q),
      ilike(vendorCatalogItemsTable.description, q),
      ilike(vendorCatalogItemsTable.vendorName, q),
    );
    if (searchCond) conditions.push(searchCond);
  }

  const rows = await db
    .select({
      id:             vendorCatalogItemsTable.id,
      name:           vendorCatalogItemsTable.name,
      description:    vendorCatalogItemsTable.description,
      kategori:       vendorCatalogItemsTable.kategori,
      categoryKey:    vendorCatalogItemsTable.categoryKey,
      priceSell:      vendorCatalogItemsTable.priceSell,
      currency:       vendorCatalogItemsTable.currency,
      unit:           vendorCatalogItemsTable.unit,
      moq:            vendorCatalogItemsTable.moq,
      stockStatus:    vendorCatalogItemsTable.stockStatus,
      leadTime:       vendorCatalogItemsTable.leadTime,
      location:       vendorCatalogItemsTable.location,
      origin:         vendorCatalogItemsTable.origin,
      specValues:     vendorCatalogItemsTable.specValues,
      templateKind:   vendorCatalogItemsTable.templateKind,
      sortOrder:      vendorCatalogItemsTable.sortOrder,
      vendorId:       vendorCatalogItemsTable.vendorId,
      vendorName:     vendorCatalogItemsTable.vendorName,
      supplierName:   suppliersTable.name,
      mediaAssets:    vendorCatalogItemsTable.mediaAssets,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(
      suppliersTable,
      and(eq(vendorCatalogItemsTable.vendorId, suppliersTable.id), ...catalogSupplierConditions()),
    )
    .where(and(...conditions))
    .orderBy(asc(vendorCatalogItemsTable.sortOrder), asc(vendorCatalogItemsTable.id));

  return res.json(
    rows.map((r: any) => {
      const media = Array.isArray(r.mediaAssets) ? r.mediaAssets as { type: string; url: string; isPrimary?: boolean }[] : [];
      const primaryImage = media.find((m) => m.type === "image" && m.isPrimary)?.url
        ?? media.find((m) => m.type === "image")?.url
        ?? null;
      return {
        ...r,
        priceSell:         r.priceSell != null ? Number(r.priceSell) : null,
        vendorDisplayName: r.vendorName || r.supplierName || "Vendor",
        imageUrl:          primaryImage,
        mediaItems:        media,
      };
    }),
  );
});

// GET /api/marketplace/vendors — vendor list for filter dropdown (published+active only)
marketplaceRouter.get("/vendors", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT DISTINCT
      s.id,
      COALESCE(vci.vendor_name, s.name) AS name
    FROM vendor_catalog_items vci
    INNER JOIN suppliers s
      ON vci.vendor_id = s.id
      AND s.is_active = true
      AND s.is_verified = true
      AND s.marketplace_status = 'published'
    WHERE vci.is_published = true
      AND vci.is_active != false
    ORDER BY 2
  `);
  return res.json(rows.rows as { id: number; name: string }[]);
});

// GET /api/marketplace/categories — unique categories for filter chips (published+active only)
marketplaceRouter.get("/categories", async (_req, res) => {
  const rows = await db.execute(sql`
    SELECT DISTINCT COALESCE(vci.category_key, vci.kategori) AS key
    FROM vendor_catalog_items vci
    INNER JOIN suppliers s
      ON vci.vendor_id = s.id
      AND s.is_active = true
      AND s.is_verified = true
      AND s.marketplace_status = 'published'
    WHERE vci.is_published = true
      AND vci.is_active != false
      AND COALESCE(vci.category_key, vci.kategori) IS NOT NULL
      AND COALESCE(vci.category_key, vci.kategori) != ''
    ORDER BY 1
  `);
  return res.json(
    (rows.rows as { key: string }[]).map((r) => r.key).filter(Boolean),
  );
});

// @deprecated — use GET /api/portal/marketplace/:id/related instead.
// Kept for backward-compatibility with older consumers; do NOT add new callers.
// GET /api/marketplace/products/:id/related — up to 4 published related items
// DEPRECATED: use /api/portal/marketplace/:id/related instead (P1 — legacy cleanup)
marketplaceRouter.get("/products/:id/related", async (req, res) => {
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ error: "id tidak valid" });

  const [current] = await db
    .select({
      vendorId:    vendorCatalogItemsTable.vendorId,
      kategori:    vendorCatalogItemsTable.kategori,
      categoryKey: vendorCatalogItemsTable.categoryKey,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(
      suppliersTable,
      and(eq(vendorCatalogItemsTable.vendorId, suppliersTable.id), ...catalogSupplierConditions()),
    )
    .where(and(eq(vendorCatalogItemsTable.id, id), ...catalogPublicConditions()))
    .limit(1);

  if (!current) return res.json([]);

  const cols = {
    id:           vendorCatalogItemsTable.id,
    name:         vendorCatalogItemsTable.name,
    vendorName:   vendorCatalogItemsTable.vendorName,
    templateKind: vendorCatalogItemsTable.templateKind,
    priceSell:    vendorCatalogItemsTable.priceSell,
    unit:         vendorCatalogItemsTable.unit,
    stockStatus:  vendorCatalogItemsTable.stockStatus,
    leadTime:     vendorCatalogItemsTable.leadTime,
    location:     vendorCatalogItemsTable.location,
    sortOrder:    vendorCatalogItemsTable.sortOrder,
    vendorId:     vendorCatalogItemsTable.vendorId,
  };

  const seen = new Set<number>([id]);
  const result: unknown[] = [];

  // 1. same vendor (published only)
  if (current.vendorId) {
    const sameVendor = await db
      .select(cols)
      .from(vendorCatalogItemsTable)
      .innerJoin(
        suppliersTable,
        and(eq(vendorCatalogItemsTable.vendorId, suppliersTable.id), ...catalogSupplierConditions()),
      )
      .where(and(
        ...catalogPublicConditions(),
        eq(vendorCatalogItemsTable.vendorId, current.vendorId),
        ne(vendorCatalogItemsTable.id, id),
      ))
      .orderBy(asc(vendorCatalogItemsTable.sortOrder), asc(vendorCatalogItemsTable.id))
      .limit(4);
    for (const r of sameVendor) {
      if (result.length >= 4) break;
      seen.add(r.id);
      result.push({ ...r, priceSell: r.priceSell != null ? Number(r.priceSell) : null });
    }
  }

  // 2. same category (fill up to 4, published only)
  if (result.length < 4) {
    const cat = current.categoryKey ?? current.kategori;
    if (cat) {
      const sameCat = await db
        .select(cols)
        .from(vendorCatalogItemsTable)
        .innerJoin(
          suppliersTable,
          and(eq(vendorCatalogItemsTable.vendorId, suppliersTable.id), ...catalogSupplierConditions()),
        )
        .where(and(
          ...catalogPublicConditions(),
          or(
            eq(vendorCatalogItemsTable.categoryKey, cat),
            eq(vendorCatalogItemsTable.kategori, cat),
          ),
          ne(vendorCatalogItemsTable.id, id),
        ))
        .orderBy(asc(vendorCatalogItemsTable.sortOrder), asc(vendorCatalogItemsTable.id))
        .limit(4);
      for (const r of sameCat) {
        if (result.length >= 4) break;
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        result.push({ ...r, priceSell: r.priceSell != null ? Number(r.priceSell) : null });
      }
    }
  }

  return res.json(result);
});


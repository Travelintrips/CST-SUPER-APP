/**
 * Marketplace Semantic Search — Candidate DB Query
 *
 * Fetches raw candidate products from vendor_catalog_items using
 * the same public visibility filter as the Customer Portal.
 *
 * ONE efficient query per search call — no N+1, parameterized, no raw concat.
 * Fetches more candidates than the final limit to allow in-memory re-ranking.
 */

import { db } from "@workspace/db";
import { vendorCatalogItemsTable, suppliersTable } from "@workspace/db";
import { and, or, eq, ne, gte, ilike, isNull, sql } from "drizzle-orm";
import { catalogPublicConditions, catalogSupplierConditions } from "../../lib/catalogVisibility.js";
import type { CandidateRow } from "./types.js";

/** How many raw candidates to fetch before in-memory ranking */
const CANDIDATE_LIMIT = 30;

/**
 * Build the public visibility WHERE clause (same as Customer Portal).
 * Must be kept in sync with catalogPublicConditions + catalogSupplierConditions.
 */
function publicVisibilityConditions() {
  return and(
    ...catalogPublicConditions(),
    ...catalogSupplierConditions(),
    or(
      isNull(vendorCatalogItemsTable.validityDate),
      gte(vendorCatalogItemsTable.validityDate, sql`CURRENT_DATE`),
    )!,
  );
}

/**
 * Fetch all publicly visible candidates that match ANY of the expanded terms.
 * Uses OR across: name, kategori, categoryKey, description (first 500 chars), hsCode.
 *
 * @param expandedTerms - deduplicated list from queryExpander (max ~15 terms)
 * @param hsCodeTerms   - extracted HS Code patterns for exact/prefix matching
 * @returns raw candidate rows, unranked
 */
export async function fetchCandidates(
  expandedTerms: string[],
  hsCodeTerms: string[],
): Promise<CandidateRow[]> {
  // Build OR conditions across all expanded terms × all searchable fields
  const textConditions = expandedTerms.map((term) =>
    or(
      ilike(vendorCatalogItemsTable.name, `%${term}%`),
      ilike(vendorCatalogItemsTable.kategori, `%${term}%`),
      ilike(vendorCatalogItemsTable.categoryKey, `%${term}%`),
      ilike(vendorCatalogItemsTable.description, `%${term}%`),
    )!,
  );

  // HS Code exact and prefix matching
  const hsConditions = hsCodeTerms.map((code) =>
    or(
      // Exact match (with or without dots)
      ilike(vendorCatalogItemsTable.hsCode, code),
      // Prefix match
      ilike(vendorCatalogItemsTable.hsCode, `${code}%`),
    )!,
  );

  const allConditions = [...textConditions, ...hsConditions];

  const searchCondition =
    allConditions.length > 0
      ? or(...allConditions)!
      : sql`false`;

  const rows = await db
    .select({
      id: vendorCatalogItemsTable.id,
      name: vendorCatalogItemsTable.name,
      kategori: vendorCatalogItemsTable.kategori,
      categoryKey: vendorCatalogItemsTable.categoryKey,
      description: vendorCatalogItemsTable.description,
      hsCode: vendorCatalogItemsTable.hsCode,
      stockStatus: vendorCatalogItemsTable.stockStatus,
      priceSell: vendorCatalogItemsTable.priceSell,
      unit: vendorCatalogItemsTable.unit,
      vendorName: vendorCatalogItemsTable.vendorName,
      supplierPublicName: suppliersTable.name,
      isFeatured: vendorCatalogItemsTable.isFeatured,
    })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(and(publicVisibilityConditions(), searchCondition)!)
    .orderBy(vendorCatalogItemsTable.name)
    .limit(CANDIDATE_LIMIT);

  return rows.map((r) => ({
    id: r.id,
    name: r.name ?? "",
    kategori: r.kategori,
    categoryKey: r.categoryKey,
    description: r.description,
    hsCode: r.hsCode,
    stockStatus: r.stockStatus,
    priceSell: r.priceSell,
    unit: r.unit,
    vendorName: r.vendorName,
    supplierPublicName: (r.supplierPublicName as string | null) ?? null,
    isFeatured: r.isFeatured,
  }));
}

/**
 * Fetch a small set of category names for "not found" suggestions.
 * Used to offer related categories when the exact product is not found.
 */
export async function fetchActiveCategories(limit = 8): Promise<string[]> {
  const rows = await db
    .select({ kategori: vendorCatalogItemsTable.kategori })
    .from(vendorCatalogItemsTable)
    .innerJoin(suppliersTable, eq(vendorCatalogItemsTable.vendorId, suppliersTable.id))
    .where(publicVisibilityConditions())
    .groupBy(vendorCatalogItemsTable.kategori)
    .limit(limit);

  return rows
    .filter((r) => r.kategori)
    .map((r) => r.kategori as string);
}

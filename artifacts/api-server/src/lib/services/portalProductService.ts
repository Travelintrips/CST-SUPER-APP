/**
 * Portal Product Service
 *
 * Business logic for admin product CRUD.
 * Controller (portal.ts) handles HTTP + side-effects (broadcast, file cleanup).
 */

import {
  db,
  productsTable,
  productCategoriesTable,
  productCategoryMapTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function _getCategoryMap(productIds: number[]): Promise<Record<number, string[]>> {
  if (productIds.length === 0) return {};
  const rows = await db
    .select({ productId: productCategoryMapTable.productId, name: productCategoriesTable.name })
    .from(productCategoryMapTable)
    .innerJoin(productCategoriesTable, eq(productCategoryMapTable.categoryId, productCategoriesTable.id))
    .where(inArray(productCategoryMapTable.productId, productIds));
  const map: Record<number, string[]> = {};
  for (const r of rows) {
    if (!map[r.productId]) map[r.productId] = [];
    map[r.productId].push(r.name);
  }
  return map;
}

function _sanitizeText(val: unknown): string | null {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s === "" || s === "null" ? null : s;
}

function _parseUnitOptions(unitOptions: unknown): string {
  if (Array.isArray(unitOptions)) return JSON.stringify(unitOptions);
  if (unitOptions) return JSON.stringify(String(unitOptions).split(",").map((s: string) => s.trim()).filter(Boolean));
  return "[]";
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductRow {
  id: number;
  name: string;
  description: string | null;
  price: number;
  stock: number;
  unit: string | null;
  unitOptions: string[];
  imageUrl: string | null;
  mediaItems: Array<{ type: string; url: string }>;
  itemType: string | null;
  categories: string[];
}

export interface CreateProductInput {
  name: string;
  description?: string;
  price?: number;
  imageUrl?: string;
  mediaItems?: unknown;
  unit?: string;
  unitOptions?: unknown;
  categories?: string[];
}

export interface UpdateProductInput {
  name?: string;
  description?: unknown;
  price?: unknown;
  stock?: unknown;
  imageUrl?: unknown;
  mediaItems?: unknown;
  unit?: unknown;
  unitOptions?: unknown;
  categories?: string[];
}

// ─── listProducts ─────────────────────────────────────────────────────────────

export async function listAdminProducts(): Promise<ProductRow[]> {
  const rows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.isActive, true))
    .orderBy(productsTable.id);
  const catMap = await _getCategoryMap(rows.map((p) => p.id));
  return rows.map((p) => {
    let mediaItems: Array<{ type: string; url: string }> = [];
    try { mediaItems = JSON.parse(p.mediaItems ?? "[]"); } catch { /* empty */ }
    let unitOptions: string[] = [];
    try { unitOptions = JSON.parse(p.unitOptions ?? "[]"); } catch { /* empty */ }
    return {
      id:          p.id,
      name:        p.name,
      description: p.description ?? null,
      price:       Number(p.price),
      stock:       p.stock ?? 0,
      unit:        p.unit,
      unitOptions,
      imageUrl:    p.imageUrl ?? null,
      mediaItems,
      itemType:    p.itemType,
      categories:  catMap[p.id] ?? [],
    };
  });
}

// ─── listProductCategories ────────────────────────────────────────────────────

export async function listProductCategories() {
  return db
    .select({ id: productCategoriesTable.id, name: productCategoriesTable.name })
    .from(productCategoriesTable)
    .orderBy(productCategoriesTable.name);
}

// ─── createProduct ────────────────────────────────────────────────────────────

export async function createProduct(input: CreateProductInput) {
  const { name, description, price, imageUrl, mediaItems, unit, unitOptions, categories = [] } = input;
  const parsedPrice = price !== undefined ? parseFloat(String(price)) : 0;

  const [maxRow] = await db
    .select({ maxId: sql<number>`COALESCE(MAX(id), 0)` })
    .from(productsTable);
  const nextId = Number(maxRow?.maxId ?? 0) + 1;
  const autoSku = `PRD-${new Date().getFullYear()}-${String(nextId).padStart(4, "0")}`;

  const catNames = categories.map(String).filter(Boolean);

  return db.transaction(async (tx) => {
    const [p] = await tx
      .insert(productsTable)
      .values({
        name:        name.trim(),
        sku:         autoSku,
        description: description ? String(description).trim() : null,
        price:       parsedPrice.toFixed(2),
        imageUrl:    imageUrl ? String(imageUrl).trim() : null,
        mediaItems:  mediaItems ? JSON.stringify(mediaItems) : "[]",
        itemType:    "barang",
        unit:        unit ? String(unit).trim() : "pcs",
        unitOptions: _parseUnitOptions(unitOptions),
        isActive:    true,
      })
      .returning();
    if (catNames.length > 0) {
      const validCats = await tx
        .select()
        .from(productCategoriesTable)
        .where(inArray(productCategoriesTable.name, catNames));
      if (validCats.length > 0) {
        await tx.insert(productCategoryMapTable).values(
          validCats.map((c) => ({ productId: p.id, categoryId: c.id }))
        );
      }
    }
    return { ...p, categories: catNames };
  });
}

// ─── updateProduct ────────────────────────────────────────────────────────────

export interface UpdateProductResult {
  updated: unknown;
  mediaUrlsToDelete: string[];
}

export async function updateProduct(id: number, input: UpdateProductInput): Promise<unknown> {
  const { name, description, price, stock, imageUrl, mediaItems, unit, unitOptions, categories } = input;

  const updates: Record<string, unknown> = {};
  if (name        !== undefined) updates.name        = String(name);
  if (description !== undefined) updates.description = _sanitizeText(description);
  if (price       !== undefined) updates.price       = parseFloat(String(price)).toFixed(2);
  if (stock       !== undefined) updates.stock       = Math.max(0, parseInt(String(stock), 10) || 0);
  if (imageUrl    !== undefined) updates.imageUrl    = _sanitizeText(imageUrl);
  if (mediaItems  !== undefined) updates.mediaItems  = JSON.stringify(mediaItems);
  if (unit        !== undefined) updates.unit        = String(unit).trim() || "pcs";
  if (unitOptions !== undefined) updates.unitOptions = _parseUnitOptions(unitOptions);

  const hasCategoryUpdate = categories !== undefined;
  const catNames = hasCategoryUpdate ? (categories ?? []).map(String).filter(Boolean) : [];

  if (Object.keys(updates).length === 0 && !hasCategoryUpdate) {
    throw Object.assign(new Error("Tidak ada field yang diubah"), { statusCode: 400 });
  }

  return db.transaction(async (tx) => {
    const updated = Object.keys(updates).length > 0
      ? (await tx.update(productsTable).set(updates).where(eq(productsTable.id, id)).returning())[0]
      : (await tx.select().from(productsTable).where(eq(productsTable.id, id)))[0];

    if (hasCategoryUpdate) {
      await tx.delete(productCategoryMapTable).where(eq(productCategoryMapTable.productId, id));
      if (catNames.length > 0) {
        const validCats = await tx
          .select()
          .from(productCategoriesTable)
          .where(inArray(productCategoriesTable.name, catNames));
        if (validCats.length > 0) {
          await tx.insert(productCategoryMapTable).values(
            validCats.map((c) => ({ productId: id, categoryId: c.id }))
          );
        }
      }
    }
    const catMap = await _getCategoryMap([id]);
    return { ...updated, categories: catMap[id] ?? [] };
  });
}

// ─── deleteProduct ────────────────────────────────────────────────────────────

export interface DeleteProductResult {
  mediaUrlsToDelete: string[];
}

export async function deleteProduct(id: number): Promise<DeleteProductResult> {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  await db.delete(productsTable).where(eq(productsTable.id, id));

  const urlsToDelete: string[] = [];
  if (product) {
    if (product.imageUrl) urlsToDelete.push(product.imageUrl);
    try {
      const items: Array<{ url?: string }> = JSON.parse(product.mediaItems ?? "[]");
      for (const item of items) { if (item.url) urlsToDelete.push(item.url); }
    } catch { /* ignore */ }
  }
  return { mediaUrlsToDelete: urlsToDelete };
}

// ─── createService ────────────────────────────────────────────────────────────

export interface CreateServiceInput {
  name: string;
  description?: string;
  price?: number | string;
  imageUrl?: string;
  subcategory?: string;
  unit?: string;
}

export async function createService(input: CreateServiceInput) {
  const { name, description, price, imageUrl, subcategory, unit } = input;
  const parsedPrice = price !== undefined ? parseFloat(String(price)) : 0;
  const year = new Date().getFullYear();
  const [maxRow] = await db.select({ maxId: sql<number>`COALESCE(MAX(id), 0)` }).from(productsTable);
  const nextId = Number(maxRow?.maxId ?? 0) + 1;
  const autoSku = `SVC-${year}-${String(nextId).padStart(4, "0")}`;
  const [created] = await db.insert(productsTable).values({
    name: name.trim(),
    sku: autoSku,
    description: description ? String(description).trim() : null,
    price: parsedPrice.toFixed(2),
    imageUrl: imageUrl ? String(imageUrl).trim() : null,
    mediaItems: "[]",
    itemType: "jasa",
    unit: unit ? String(unit) : "pcs",
    subcategory: subcategory ? String(subcategory) : null,
    isActive: true,
  }).returning();
  return created;
}

// ─── updateService ────────────────────────────────────────────────────────────

export interface UpdateServiceInput {
  name?: string;
  description?: unknown;
  price?: unknown;
  imageUrl?: unknown;
  mediaItems?: unknown;
}

export async function updateService(id: number, input: UpdateServiceInput) {
  const { name, description, price, imageUrl, mediaItems } = input;
  const updates: Record<string, unknown> = {};
  if (name        !== undefined) updates.name        = String(name);
  if (description !== undefined) updates.description = _sanitizeText(description);
  if (price       !== undefined) updates.price       = parseFloat(String(price)).toFixed(2);
  if (imageUrl    !== undefined) updates.imageUrl    = _sanitizeText(imageUrl);
  if (mediaItems  !== undefined) updates.mediaItems  = JSON.stringify(Array.isArray(mediaItems) ? mediaItems : []);
  if (Object.keys(updates).length === 0) {
    throw Object.assign(new Error("Tidak ada field yang diubah"), { statusCode: 400 });
  }
  const [updated] = await db.update(productsTable).set(updates).where(eq(productsTable.id, id)).returning();
  return updated;
}

// ─── deleteService ────────────────────────────────────────────────────────────

export async function deleteService(id: number): Promise<DeleteProductResult> {
  const [product] = await db.select().from(productsTable).where(eq(productsTable.id, id));
  await db.delete(productsTable).where(eq(productsTable.id, id));
  const urlsToDelete: string[] = [];
  if (product) {
    if (product.imageUrl) urlsToDelete.push(product.imageUrl);
    try {
      const items: Array<{ url?: string }> = JSON.parse(product.mediaItems ?? "[]");
      for (const item of items) { if (item.url) urlsToDelete.push(item.url); }
    } catch { /* ignore */ }
  }
  return { mediaUrlsToDelete: urlsToDelete };
}

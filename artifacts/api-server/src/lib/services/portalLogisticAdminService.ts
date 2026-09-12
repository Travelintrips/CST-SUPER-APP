/**
 * Portal Logistic Admin Service
 *
 * Business logic for /logistic-admin/* routes.
 * Controllers in portal.ts handle HTTP (auth middleware, param extraction,
 * SSE broadcast after mutation) — this service owns DB access only.
 */

import { db, productsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { deleteFromSupabase } from "../supabaseStorage.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeError(statusCode: number, message: string): Error {
  return Object.assign(new Error(message), { statusCode });
}

// ─── listLogisticAdminServices ────────────────────────────────────────────────

export async function listLogisticAdminServices() {
  const rows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.itemType, "jasa"))
    .orderBy(productsTable.id);

  return rows.map((p) => ({
    id:          p.id,
    name:        p.name,
    sku:         p.sku,
    price:       Number(p.price),
    subcategory: p.subcategory ?? null,
    unit:        p.unit,
    description: p.description ?? null,
    isActive:    p.isActive,
  }));
}

// ─── createLogisticAdminService ───────────────────────────────────────────────

export async function createLogisticAdminService(body: {
  name?:        unknown;
  sku?:         unknown;
  price?:       unknown;
  subcategory?: unknown;
  unit?:        unknown;
  description?: unknown;
}) {
  const { name, sku, price, subcategory, unit, description } = body;
  if (!name || !sku) throw makeError(400, "Nama dan SKU wajib diisi");

  const [inserted] = await db.insert(productsTable).values({
    name:        String(name),
    sku:         String(sku),
    price:       String(Number(price) || 0),
    stock:       0,
    itemType:    "jasa",
    unit:        String(unit || "pcs"),
    subcategory: subcategory ? String(subcategory) : null,
    description: description ? String(description) : null,
    isActive:    true,
    createdAt:   new Date(),
  }).returning();

  return inserted;
}

// ─── updateLogisticAdminService ───────────────────────────────────────────────

export async function updateLogisticAdminService(
  id: number,
  body: {
    name?:        unknown;
    price?:       unknown;
    subcategory?: unknown;
    unit?:        unknown;
    description?: unknown;
    isActive?:    unknown;
  },
) {
  const { name, price, subcategory, unit, description, isActive } = body;
  const updates: Record<string, unknown> = {};
  if (name        !== undefined) updates.name        = String(name);
  if (price       !== undefined) updates.price       = String(Number(price));
  if (subcategory !== undefined) updates.subcategory = subcategory ? String(subcategory) : null;
  if (unit        !== undefined) updates.unit        = String(unit);
  if (description !== undefined) updates.description = description ? String(description) : null;
  if (isActive    !== undefined) updates.isActive    = Boolean(isActive);

  if (Object.keys(updates).length === 0) throw makeError(400, "Tidak ada data yang diupdate");

  const [updated] = await db
    .update(productsTable)
    .set(updates)
    .where(eq(productsTable.id, id))
    .returning();

  if (!updated) throw makeError(404, "Jasa tidak ditemukan");
  return updated;
}

// ─── deleteLogisticAdminService ───────────────────────────────────────────────

export async function deleteLogisticAdminService(id: number) {
  const [product] = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.id, id));

  await db.delete(productsTable).where(eq(productsTable.id, id));

  if (product) {
    const urls: string[] = [];
    if (product.imageUrl) urls.push(product.imageUrl);
    try {
      const items: Array<{ url?: string }> = JSON.parse(product.mediaItems ?? "[]");
      for (const item of items) { if (item.url) urls.push(item.url); }
    } catch { /* ignore */ }
    for (const url of urls) deleteFromSupabase(url).catch(() => {});
  }
}

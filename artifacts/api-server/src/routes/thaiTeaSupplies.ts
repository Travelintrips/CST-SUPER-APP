/**
 * /api/thai-tea — Manajemen Bahan Thai Tea & Inventori CST
 *
 * Sistem stok DIMERGE ke pos_inventory_stocks (sistem tunggal Inventory CST).
 * Bahan Thai Tea diidentifikasi via SKU prefix "BTT-" di pos_inventory_items.
 * Cabang Thai Tea = pos_branches dengan business_unit = 'THAI_TEA'.
 *
 * Products (ERP - untuk integrasi Purchase Order):
 * GET  /products          — daftar produk bahan thai tea
 * POST /products          — tambah produk + sync ke pos_inventory_items
 * PUT  /products/:id      — update produk + sync ke pos_inventory_items
 * DELETE /products/:id    — hapus produk
 * POST /seed              — seed bahan default ke products + pos_inventory_items
 *
 * Stock (POS Inventory system):
 * GET  /purchases         — daftar PO yang berisi bahan thai tea
 * GET  /stock             — stok dari pos_inventory_stocks (item SKU 'BTT-%')
 * POST /receive           — terima bahan → update pos_inventory_stocks + mutasi
 *
 * Recipes / BOM:
 * GET  /recipes / POST /recipes / DELETE /recipes/:id
 *
 * Warehouses (via POS system):
 * GET  /warehouses        — pos_warehouses dari cabang business_unit='THAI_TEA'
 */
import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { db, productsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { deleteFromSupabase } from "../lib/supabaseStorage.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

const SUBCATEGORY = "bahan_thai_tea";
const BUSINESS_UNIT = "THAI_TEA";

const DEFAULT_BAHAN: Array<{ name: string; sku: string; unit: string; price: number; description: string }> = [
  { name: "Teh Hitam CTC", sku: "BTT-TEH-001", unit: "kg", price: 85000, description: "Teh hitam grade CTC untuk thai tea" },
  { name: "Teh Hitam Premium", sku: "BTT-TEH-002", unit: "kg", price: 120000, description: "Teh hitam premium blend Thai" },
  { name: "Gula Pasir", sku: "BTT-GUL-001", unit: "kg", price: 15000, description: "Gula pasir putih" },
  { name: "Susu Kental Manis Putih", sku: "BTT-SKM-001", unit: "kaleng", price: 14000, description: "Susu kental manis putih 390gr" },
  { name: "Susu Kental Manis Coklat", sku: "BTT-SKM-002", unit: "kaleng", price: 14500, description: "Susu kental manis coklat 390gr" },
  { name: "Creamer Bubuk", sku: "BTT-CRM-001", unit: "kg", price: 55000, description: "Non-dairy creamer bubuk" },
  { name: "Es Batu", sku: "BTT-ICE-001", unit: "kg", price: 3000, description: "Es batu kristal" },
  { name: "Susu Full Cream", sku: "BTT-SUF-001", unit: "liter", price: 18000, description: "Susu full cream segar" },
  { name: "Bubble Tapioka", sku: "BTT-BBL-001", unit: "kg", price: 32000, description: "Bubble boba tapioka hitam" },
  { name: "Sirup Gula Aren", sku: "BTT-SRP-001", unit: "liter", price: 28000, description: "Sirup gula aren untuk campuran" },
  { name: "Vanilla Syrup", sku: "BTT-SRP-002", unit: "liter", price: 45000, description: "Sirup vanilla premium" },
  { name: "Taro Powder", sku: "BTT-POW-001", unit: "kg", price: 95000, description: "Taro powder untuk varian taro" },
  { name: "Matcha Powder", sku: "BTT-POW-002", unit: "kg", price: 180000, description: "Matcha powder grade premium" },
  { name: "Brown Sugar", sku: "BTT-GUL-002", unit: "kg", price: 22000, description: "Gula cokelat / gula merah kristal" },
  { name: "Gelas Plastik 16oz", sku: "BTT-PKG-001", unit: "pcs", price: 850, description: "Gelas plastik cup 16oz" },
  { name: "Gelas Plastik 22oz", sku: "BTT-PKG-002", unit: "pcs", price: 1100, description: "Gelas plastik cup 22oz" },
  { name: "Sedotan", sku: "BTT-PKG-003", unit: "pcs", price: 150, description: "Sedotan boba diameter besar" },
  { name: "Plastik Sealer Roll", sku: "BTT-PKG-004", unit: "roll", price: 45000, description: "Plastik sealer untuk mesin cup sealer" },
];

function grnNo(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  return `BTT-GRN/${ymd}/${now.getTime().toString().slice(-5)}`;
}

// ── Sync helper: upsert bahan ke pos_inventory_items ─────────────────────────

async function syncToInventoryItem(sku: string, name: string, unit: string, price: number): Promise<number> {
  const existing = (await db.execute(sql`
    SELECT id FROM pos_inventory_items WHERE sku = ${sku}
  `)).rows[0] as { id: number } | undefined;

  if (existing) {
    await db.execute(sql`
      UPDATE pos_inventory_items
      SET name = ${name}, unit = ${unit}, cost_price = ${price}, updated_at = NOW()
      WHERE id = ${existing.id}
    `);
    return existing.id;
  }

  const row = (await db.execute(sql`
    INSERT INTO pos_inventory_items (name, sku, unit, cost_price, min_stock, is_active)
    VALUES (${name}, ${sku}, ${unit}, ${price}, 0, TRUE)
    RETURNING id
  `)).rows[0] as { id: number };
  return row.id;
}

// ── GET /products ────────────────────────────────────────────────────────────

router.get("/products", async (_req: Request, res: Response) => {
  const rows = await db
    .select()
    .from(productsTable)
    .where(eq(productsTable.subcategory, SUBCATEGORY))
    .orderBy(productsTable.name);
  res.json(rows);
});

// ── POST /products ───────────────────────────────────────────────────────────

router.post("/products", async (req: Request, res: Response) => {
  const { name, sku, unit, price, description } = req.body as {
    name: string; sku: string; unit?: string; price?: number; description?: string;
  };
  if (!name || !sku) {
    res.status(400).json({ message: "name dan sku wajib diisi" });
    return;
  }
  const skuUpper = sku.toUpperCase();
  const [row] = await db.insert(productsTable).values({
    name,
    sku: skuUpper,
    unit: unit ?? "kg",
    price: String(price ?? 0),
    description: description ?? null,
    subcategory: SUBCATEGORY,
    itemType: "barang",
    isActive: true,
  }).returning();
  await syncToInventoryItem(skuUpper, name, unit ?? "kg", price ?? 0);
  res.status(201).json(row);
});

// ── PUT /products/:id ────────────────────────────────────────────────────────

router.put("/products/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const { name, sku, unit, price, description, isActive } = req.body as {
    name?: string; sku?: string; unit?: string; price?: number;
    description?: string; isActive?: boolean;
  };
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (sku !== undefined) patch.sku = sku.toUpperCase();
  if (unit !== undefined) patch.unit = unit;
  if (price !== undefined) patch.price = String(price);
  if (description !== undefined) patch.description = description;
  if (isActive !== undefined) patch.isActive = isActive;

  const [row] = await db.update(productsTable).set(patch).where(eq(productsTable.id, id)).returning();
  if (!row) { res.status(404).json({ message: "Produk tidak ditemukan" }); return; }

  if (row.sku) {
    await syncToInventoryItem(row.sku, row.name, row.unit ?? "kg", Number(row.price ?? 0));
  }
  res.json(row);
});

// ── DELETE /products/:id ─────────────────────────────────────────────────────

router.delete("/products/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  const [product] = await db.select({ imageUrl: productsTable.imageUrl, mediaItems: productsTable.mediaItems })
    .from(productsTable).where(eq(productsTable.id, id));
  await db.delete(productsTable).where(eq(productsTable.id, id));
  // Cascade storage cleanup
  if (product) {
    const urls: string[] = [];
    if (product.imageUrl) urls.push(product.imageUrl);
    try {
      const items: Array<{ url?: string }> = JSON.parse(product.mediaItems ?? "[]");
      for (const item of items) { if (item.url) urls.push(item.url); }
    } catch { /* ignore */ }
    for (const url of urls) deleteFromSupabase(url).catch(() => {});
  }
  res.json({ ok: true });
});

// ── POST /seed ────────────────────────────────────────────────────────────────

router.post("/seed", async (_req: Request, res: Response) => {
  const existing = await db.select({ id: productsTable.id }).from(productsTable).where(eq(productsTable.subcategory, SUBCATEGORY));
  if (existing.length > 0) {
    // Masih sync ke pos_inventory_items meskipun products sudah ada
    for (const b of DEFAULT_BAHAN) {
      await syncToInventoryItem(b.sku, b.name, b.unit, b.price);
    }
    res.json({ message: `${existing.length} bahan sudah ada, sync pos_inventory_items selesai`, seeded: 0 });
    return;
  }
  const rows = await db.insert(productsTable).values(
    DEFAULT_BAHAN.map((b) => ({
      name: b.name,
      sku: b.sku,
      unit: b.unit,
      price: String(b.price),
      description: b.description,
      subcategory: SUBCATEGORY,
      itemType: "barang" as const,
      isActive: true,
    }))
  ).returning();
  for (const b of DEFAULT_BAHAN) {
    await syncToInventoryItem(b.sku, b.name, b.unit, b.price);
  }
  res.status(201).json({ message: `${rows.length} bahan berhasil di-seed`, seeded: rows.length });
});

// ── GET /purchases ───────────────────────────────────────────────────────────

router.get("/purchases", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT DISTINCT
      pd.id, pd.doc_number, pd.kind, pd.status, pd.receive_status,
      pd.bill_status, pd.supplier_name,
      pd.total_amount::float, pd.grand_total::float,
      pd.expected_date, pd.confirmed_at, pd.created_at
    FROM purchase_documents pd
    JOIN purchase_document_lines pdl ON pdl.document_id = pd.id
    JOIN products p ON p.id = pdl.product_id
    WHERE p.subcategory = ${SUBCATEGORY}
    ORDER BY pd.created_at DESC
    LIMIT 200
  `);
  res.json(rows.rows);
});

// ── GET /stock ────────────────────────────────────────────────────────────────
// Stok dari pos_inventory_stocks — item SKU prefix 'BTT-' (sistem tunggal)

router.get("/stock", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      i.id AS item_id,
      i.name AS item_name,
      i.sku,
      i.unit,
      i.cost_price::float AS cost_price,
      COALESCE(SUM(s.qty::float), 0) AS total_qty,
      COUNT(DISTINCT s.branch_id) AS branch_count,
      COALESCE(
        json_agg(
          json_build_object(
            'stock_id', s.id,
            'branch_id', b.id,
            'branch_name', b.name,
            'business_unit', b.business_unit,
            'warehouse_id', w.id,
            'warehouse_name', w.name,
            'qty', COALESCE(s.qty::float, 0)
          ) ORDER BY b.name, w.name
        ) FILTER (WHERE s.id IS NOT NULL),
        '[]'
      ) AS branches
    FROM pos_inventory_items i
    LEFT JOIN pos_inventory_stocks s ON s.item_id = i.id
    LEFT JOIN pos_branches b ON b.id = s.branch_id
    LEFT JOIN pos_warehouses w ON w.id = s.warehouse_id
    WHERE i.sku LIKE 'BTT-%' AND i.is_active = TRUE
    GROUP BY i.id, i.name, i.sku, i.unit, i.cost_price
    ORDER BY i.name
  `);
  res.json(rows.rows);
});

// ── POST /receive ─────────────────────────────────────────────────────────────
// Terima bahan Thai Tea → update pos_inventory_stocks + mutasi

router.post("/receive", async (req: Request, res: Response) => {
  const { branchId, warehouseId, notes, receivedBy, lines } = req.body as {
    branchId: number;
    warehouseId?: number | null;
    notes?: string;
    receivedBy?: string;
    lines: Array<{
      itemId?: number;
      productId?: number;
      qty: number;
      unitCost?: number;
    }>;
  };

  if (!branchId || !lines?.length) {
    res.status(400).json({ message: "branchId dan lines wajib diisi" });
    return;
  }

  const validLines = lines.filter(l => l.qty > 0 && (l.itemId || l.productId));
  if (!validLines.length) {
    res.status(400).json({ message: "Minimal satu item dengan qty > 0" });
    return;
  }

  // Validasi cabang
  const branchRow = (await db.execute(sql`SELECT id, name FROM pos_branches WHERE id = ${branchId}`)).rows[0] as { id: number; name: string } | undefined;
  if (!branchRow) {
    res.status(400).json({ message: `Cabang #${branchId} tidak ditemukan` });
    return;
  }

  const receiptNo = grnNo();
  const results: Array<{ itemId: number; itemName: string; qty: number; qtyAfter: number }> = [];

  for (const line of validLines) {
    let itemId = line.itemId;
    let itemName = "";

    // Bridge: jika pakai productId (legacy), cari di pos_inventory_items via SKU
    if (!itemId && line.productId) {
      const prodRow = (await db.execute(sql`SELECT sku, name FROM products WHERE id = ${line.productId}`)).rows[0] as { sku: string; name: string } | undefined;
      if (!prodRow) { res.status(400).json({ message: `Produk #${line.productId} tidak ditemukan` }); return; }
      const invRow = (await db.execute(sql`SELECT id, name FROM pos_inventory_items WHERE sku = ${prodRow.sku}`)).rows[0] as { id: number; name: string } | undefined;
      if (!invRow) {
        // Auto-seed ke pos_inventory_items
        const newId = await syncToInventoryItem(prodRow.sku, prodRow.name, "kg", line.unitCost ?? 0);
        itemId = newId;
        itemName = prodRow.name;
      } else {
        itemId = invRow.id;
        itemName = invRow.name;
      }
    } else if (itemId) {
      const invRow = (await db.execute(sql`SELECT name FROM pos_inventory_items WHERE id = ${itemId}`)).rows[0] as { name: string } | undefined;
      if (!invRow) { res.status(400).json({ message: `Item #${itemId} tidak ditemukan di inventory` }); return; }
      itemName = invRow.name;
    }

    if (!itemId) { res.status(400).json({ message: "itemId tidak valid" }); return; }

    // Upsert pos_inventory_stocks
    const existing = (await db.execute(sql`
      SELECT id, qty FROM pos_inventory_stocks
      WHERE item_id = ${itemId} AND branch_id = ${branchId}
        AND warehouse_id IS NOT DISTINCT FROM ${warehouseId ?? null}
    `)).rows[0] as { id: number; qty: string } | undefined;

    const qtyBefore = existing ? Number(existing.qty) : 0;
    const qtyAfter = qtyBefore + line.qty;

    if (existing) {
      await db.execute(sql`
        UPDATE pos_inventory_stocks SET qty = ${qtyAfter}, updated_at = NOW()
        WHERE id = ${existing.id}
      `);
    } else {
      await db.execute(sql`
        INSERT INTO pos_inventory_stocks (item_id, branch_id, warehouse_id, qty)
        VALUES (${itemId}, ${branchId}, ${warehouseId ?? null}, ${qtyAfter})
      `);
    }

    // Catat mutasi
    await db.execute(sql`
      INSERT INTO pos_stock_mutations (item_id, branch_id, warehouse_id, type, qty, qty_before, qty_after, ref_type, note)
      VALUES (${itemId}, ${branchId}, ${warehouseId ?? null}, 'in', ${line.qty}, ${qtyBefore}, ${qtyAfter}, 'receipt', ${`${receiptNo}${notes ? ` — ${notes}` : ""}${receivedBy ? ` — ${receivedBy}` : ""}`})
    `);

    results.push({ itemId, itemName, qty: line.qty, qtyAfter });
  }

  res.status(201).json({
    receiptNo,
    businessUnit: BUSINESS_UNIT,
    branchId,
    branchName: branchRow.name,
    lines: results,
    message: `${validLines.length} item berhasil diterima ke cabang ${branchRow.name}`,
  });
});

// ── GET /warehouses ───────────────────────────────────────────────────────────
// Daftar pos_warehouses dari cabang THAI_TEA (bisa difilter)

router.get("/warehouses", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT w.id, w.name AS warehouse_name, w.type AS warehouse_type, w.is_active,
           b.id AS branch_id, b.name AS branch_name, b.business_unit
    FROM pos_warehouses w
    JOIN pos_branches b ON b.id = w.branch_id
    WHERE b.business_unit = ${BUSINESS_UNIT} AND w.is_active = TRUE
    ORDER BY b.name, w.name
  `);
  res.json(rows.rows);
});

// ── GET /branches ─────────────────────────────────────────────────────────────
// Daftar cabang Thai Tea (business_unit = 'THAI_TEA')

router.get("/branches", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT * FROM pos_branches WHERE business_unit = ${BUSINESS_UNIT} ORDER BY name
  `);
  res.json(rows.rows);
});

// ── GET /recipes ──────────────────────────────────────────────────────────────

router.get("/recipes", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      pr.id, pr.product_id, p.name AS product_name, p.sku AS product_sku,
      pr.yield_qty::float, pr.yield_unit, pr.note, pr.is_active,
      pr.created_at, pr.updated_at,
      json_agg(
        json_build_object(
          'id', ri.id,
          'ingredient_product_id', ri.ingredient_product_id,
          'ingredient_name', ip.name,
          'ingredient_sku', ip.sku,
          'unit', ri.unit,
          'qty', ri.qty::float,
          'note', ri.note
        ) ORDER BY ri.id
      ) FILTER (WHERE ri.id IS NOT NULL) AS ingredients
    FROM product_recipes pr
    JOIN products p ON p.id = pr.product_id
    LEFT JOIN product_recipe_items ri ON ri.recipe_id = pr.id
    LEFT JOIN products ip ON ip.id = ri.ingredient_product_id
    WHERE EXISTS (
      SELECT 1 FROM product_recipe_items ri2
      JOIN products ip2 ON ip2.id = ri2.ingredient_product_id
      WHERE ri2.recipe_id = pr.id AND ip2.subcategory = ${SUBCATEGORY}
    )
    GROUP BY pr.id, pr.product_id, p.name, p.sku, pr.yield_qty, pr.yield_unit, pr.note, pr.is_active, pr.created_at, pr.updated_at
    ORDER BY p.name
  `);
  res.json(rows.rows);
});

// ── POST /recipes ─────────────────────────────────────────────────────────────

router.post("/recipes", async (req: Request, res: Response) => {
  const { productId, yieldQty, yieldUnit, note, isActive, ingredients } = req.body as {
    productId: number;
    yieldQty?: number;
    yieldUnit?: string;
    note?: string;
    isActive?: boolean;
    ingredients: Array<{ ingredientProductId: number; qty: number; unit: string; note?: string }>;
  };

  if (!productId || !ingredients?.length) {
    res.status(400).json({ message: "productId dan ingredients wajib diisi" });
    return;
  }

  for (const ing of ingredients) {
    if (!ing.qty || ing.qty <= 0) {
      res.status(400).json({ message: "qty ingredient harus > 0" });
      return;
    }
    const ingRow = (await db.execute(sql`
      SELECT subcategory FROM products WHERE id = ${ing.ingredientProductId}
    `)).rows[0] as { subcategory: string | null } | undefined;
    if (!ingRow) {
      res.status(400).json({ message: `Bahan #${ing.ingredientProductId} tidak ditemukan` });
      return;
    }
    if (ingRow.subcategory !== SUBCATEGORY) {
      res.status(400).json({ message: `Bahan #${ing.ingredientProductId} bukan bahan thai tea` });
      return;
    }
  }

  const existing = (await db.execute(sql`SELECT id FROM product_recipes WHERE product_id = ${productId}`)).rows[0] as { id: number } | undefined;
  let recipeId: number;

  if (existing) {
    recipeId = existing.id;
    await db.execute(sql`
      UPDATE product_recipes
      SET yield_qty = ${yieldQty ?? 1}, yield_unit = ${yieldUnit ?? "pcs"},
          note = ${note ?? null}, is_active = ${isActive ?? true}, updated_at = NOW()
      WHERE id = ${recipeId}
    `);
    await db.execute(sql`DELETE FROM product_recipe_items WHERE recipe_id = ${recipeId}`);
  } else {
    const r = (await db.execute(sql`
      INSERT INTO product_recipes (product_id, yield_qty, yield_unit, note, is_active)
      VALUES (${productId}, ${yieldQty ?? 1}, ${yieldUnit ?? "pcs"}, ${note ?? null}, ${isActive ?? true})
      RETURNING id
    `)).rows[0] as { id: number };
    recipeId = r.id;
  }

  for (const ing of ingredients) {
    await db.execute(sql`
      INSERT INTO product_recipe_items (recipe_id, ingredient_product_id, qty, unit, note)
      VALUES (${recipeId}, ${ing.ingredientProductId}, ${ing.qty}, ${ing.unit}, ${ing.note ?? null})
    `);
  }

  const result = (await db.execute(sql`
    SELECT pr.*, p.name AS product_name,
      (SELECT json_agg(i) FROM (
        SELECT ri.*, ri.qty::float, ip.name AS ingredient_name
        FROM product_recipe_items ri JOIN products ip ON ip.id = ri.ingredient_product_id
        WHERE ri.recipe_id = pr.id
      ) i) AS ingredients
    FROM product_recipes pr JOIN products p ON p.id = pr.product_id
    WHERE pr.id = ${recipeId}
  `)).rows[0];

  res.status(201).json(result);
});

// ── DELETE /recipes/:id ───────────────────────────────────────────────────────

router.delete("/recipes/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) { res.status(400).json({ message: "Invalid id" }); return; }
  await db.execute(sql`DELETE FROM product_recipes WHERE id = ${id}`);
  res.json({ ok: true });
});

export default router;

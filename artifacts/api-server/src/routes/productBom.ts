import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { deleteFromSupabase } from "../lib/supabaseStorage.js";

const router = Router();

router.use(async (req: Request, res: Response, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ── KATEGORI PRODUK ───────────────────────────────────────────────────────────

router.get("/categories", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT DISTINCT subcategory
    FROM products
    WHERE company_id = ${companyId}
      AND subcategory IS NOT NULL
      AND subcategory <> ''
    ORDER BY subcategory ASC
  `);
  const categories = rows.rows.map((r: Record<string, unknown>) => r.subcategory as string);
  res.json(categories);
});

router.put("/categories/:name", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const oldName = decodeURIComponent(String(req.params.name));
  const { newName } = req.body as { newName?: string };
  if (!newName || !newName.trim()) {
    res.status(400).json({ message: "newName wajib diisi" }); return;
  }
  const result = await db.execute(sql`
    UPDATE products
    SET subcategory = ${newName.trim()}
    WHERE company_id = ${companyId} AND subcategory = ${oldName}
  `);
  res.json({ updated: result.rowCount ?? 0 });
});

router.delete("/categories/:name", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const name = decodeURIComponent(String(req.params.name));
  const result = await db.execute(sql`
    UPDATE products
    SET subcategory = NULL
    WHERE company_id = ${companyId} AND subcategory = ${name}
  `);
  res.json({ updated: result.rowCount ?? 0 });
});

// ── PRODUK JUAL (dari tabel products) ────────────────────────────────────────

router.get("/products", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const search = req.query.search as string | undefined;
  const rows = await db.execute(sql`
    SELECT id, name, sku, unit, price::float, cost_price::float, is_active, item_type, subcategory, currency_code
    FROM products
    WHERE company_id = ${companyId}
      ${search ? sql`AND (name ILIKE ${"%" + search + "%"} OR sku ILIKE ${"%" + search + "%"})` : sql``}
    ORDER BY name ASC
    LIMIT 500
  `);
  res.json(rows.rows);
});

router.post("/products", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { name, sku, unit, price, costPrice, itemType, subcategory, isActive, currencyCode } = req.body as {
    name: string; sku: string; unit?: string; price?: number; costPrice?: number;
    itemType?: string; subcategory?: string; isActive?: boolean; currencyCode?: string;
  };
  if (!name || !sku) { res.status(400).json({ message: "name dan sku wajib diisi" }); return; }
  const result = await db.execute(sql`
    INSERT INTO products (company_id, name, sku, unit, price, cost_price, item_type, subcategory, is_active, currency_code)
    VALUES (${companyId}, ${name}, ${sku}, ${unit ?? "pcs"}, ${price ?? 0}, ${costPrice ?? 0},
            ${itemType ?? "barang"}, ${subcategory ?? null}, ${isActive ?? true}, ${currencyCode ?? "IDR"})
    RETURNING id, name, sku, unit, price::float, cost_price::float, is_active, item_type, subcategory, currency_code
  `);
  res.status(201).json(result.rows[0]);
});

router.put("/products/:id", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const id = Number(String(req.params.id));
  const { name, sku, unit, price, costPrice, itemType, subcategory, isActive, currencyCode } = req.body as {
    name?: string; sku?: string; unit?: string; price?: number; costPrice?: number;
    itemType?: string; subcategory?: string; isActive?: boolean; currencyCode?: string;
  };
  const check = await db.execute(sql`SELECT id FROM products WHERE id = ${id} AND company_id = ${companyId}`);
  if (check.rows.length === 0) { res.status(404).json({ message: "Produk tidak ditemukan" }); return; }
  const result = await db.execute(sql`
    UPDATE products SET
      name          = COALESCE(${name ?? null}, name),
      sku           = COALESCE(${sku ?? null}, sku),
      unit          = COALESCE(${unit ?? null}, unit),
      price         = COALESCE(${price ?? null}, price),
      cost_price    = COALESCE(${costPrice ?? null}, cost_price),
      item_type     = COALESCE(${itemType ?? null}, item_type),
      subcategory   = COALESCE(${subcategory ?? null}, subcategory),
      is_active     = COALESCE(${isActive ?? null}, is_active),
      currency_code = COALESCE(${currencyCode ?? null}, currency_code)
    WHERE id = ${id} AND company_id = ${companyId}
    RETURNING id, name, sku, unit, price::float, cost_price::float, is_active, item_type, subcategory, currency_code
  `);
  res.json(result.rows[0]);
});

router.post("/products/import", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { rows } = req.body as {
    rows: Array<{
      name: string; sku: string; unit?: string; price?: number; costPrice?: number;
      itemType?: string; subcategory?: string;
      weightKg?: number; lengthCm?: number; widthCm?: number; heightCm?: number; goodsType?: string;
    }>;
  };
  if (!Array.isArray(rows) || rows.length === 0) {
    res.status(400).json({ message: "Tidak ada data untuk diimport" }); return;
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.name?.trim() || !row.sku?.trim()) {
      errors.push(`Baris dilewati: nama/SKU kosong (${row.name || "?"})`);
      skipped++;
      continue;
    }
    try {
      await db.execute(sql`
        INSERT INTO products (
          company_id, name, sku, unit, price, cost_price, item_type, subcategory,
          weight_kg, length_cm, width_cm, height_cm, goods_type, is_active
        )
        VALUES (
          ${companyId}, ${row.name.trim()}, ${row.sku.trim()},
          ${row.unit ?? "pcs"}, ${row.price ?? 0}, ${row.costPrice ?? 0},
          ${row.itemType ?? "barang"}, ${row.subcategory ?? null},
          ${row.weightKg ?? null}, ${row.lengthCm ?? null},
          ${row.widthCm ?? null}, ${row.heightCm ?? null},
          ${row.goodsType ?? null}, true
        )
        ON CONFLICT (sku) DO UPDATE SET
          name        = EXCLUDED.name,
          unit        = EXCLUDED.unit,
          price       = EXCLUDED.price,
          cost_price  = EXCLUDED.cost_price,
          item_type   = EXCLUDED.item_type,
          subcategory = EXCLUDED.subcategory,
          weight_kg   = EXCLUDED.weight_kg,
          length_cm   = EXCLUDED.length_cm,
          width_cm    = EXCLUDED.width_cm,
          height_cm   = EXCLUDED.height_cm,
          goods_type  = EXCLUDED.goods_type
      `);
      imported++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`SKU ${row.sku}: ${msg}`);
      skipped++;
    }
  }

  res.json({ imported, skipped, errors });
});

router.delete("/products/:id", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const id = Number(String(req.params.id));
  const check = await db.execute(sql`SELECT id, image_url, media_items FROM products WHERE id = ${id} AND company_id = ${companyId}`);
  if (check.rows.length === 0) { res.status(404).json({ message: "Produk tidak ditemukan" }); return; }
  await db.execute(sql`DELETE FROM products WHERE id = ${id} AND company_id = ${companyId}`);
  // Cascade storage cleanup
  const row = check.rows[0] as { image_url?: string; media_items?: string };
  const urls: string[] = [];
  if (row.image_url) urls.push(row.image_url);
  try {
    const items: Array<{ url?: string }> = JSON.parse(row.media_items ?? "[]");
    for (const item of items) { if (item.url) urls.push(item.url); }
  } catch { /* ignore */ }
  for (const url of urls) deleteFromSupabase(url).catch(() => {});
  res.json({ ok: true });
});

// ── BAHAN BAKU (raw_materials) ────────────────────────────────────────────────

router.get("/raw-materials", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const search = req.query.search as string | undefined;
  const rows = await db.execute(sql`
    SELECT id, name, sku, unit, cost_price::float, description, is_active, created_at
    FROM raw_materials
    WHERE company_id = ${companyId}
      ${search ? sql`AND (name ILIKE ${"%" + search + "%"} OR sku ILIKE ${"%" + search + "%"})` : sql``}
    ORDER BY name ASC
  `);
  res.json(rows.rows);
});

router.post("/raw-materials", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { name, sku, unit, costPrice, description, isActive } = req.body as {
    name: string; sku: string; unit?: string; costPrice?: number; description?: string; isActive?: boolean;
  };
  if (!name || !sku) { res.status(400).json({ message: "name dan sku wajib diisi" }); return; }
  const dup = await db.execute(sql`SELECT id FROM raw_materials WHERE company_id = ${companyId} AND sku = ${sku}`);
  if (dup.rows.length > 0) { res.status(400).json({ message: "SKU sudah digunakan" }); return; }
  const result = await db.execute(sql`
    INSERT INTO raw_materials (company_id, name, sku, unit, cost_price, description, is_active)
    VALUES (${companyId}, ${name}, ${sku}, ${unit ?? "gram"}, ${costPrice ?? 0}, ${description ?? null}, ${isActive ?? true})
    RETURNING id, name, sku, unit, cost_price::float, description, is_active
  `);
  res.status(201).json(result.rows[0]);
});

router.put("/raw-materials/:id", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const id = Number(String(req.params.id));
  const { name, sku, unit, costPrice, description, isActive } = req.body as {
    name?: string; sku?: string; unit?: string; costPrice?: number; description?: string; isActive?: boolean;
  };
  const check = await db.execute(sql`SELECT id FROM raw_materials WHERE id = ${id} AND company_id = ${companyId}`);
  if (check.rows.length === 0) { res.status(404).json({ message: "Bahan baku tidak ditemukan" }); return; }
  if (sku) {
    const dup = await db.execute(sql`SELECT id FROM raw_materials WHERE company_id = ${companyId} AND sku = ${sku} AND id <> ${id}`);
    if (dup.rows.length > 0) { res.status(400).json({ message: "SKU sudah digunakan" }); return; }
  }
  const result = await db.execute(sql`
    UPDATE raw_materials SET
      name        = COALESCE(${name ?? null}, name),
      sku         = COALESCE(${sku ?? null}, sku),
      unit        = COALESCE(${unit ?? null}, unit),
      cost_price  = COALESCE(${costPrice ?? null}, cost_price),
      description = COALESCE(${description ?? null}, description),
      is_active   = COALESCE(${isActive ?? null}, is_active)
    WHERE id = ${id} AND company_id = ${companyId}
    RETURNING id, name, sku, unit, cost_price::float, description, is_active
  `);
  res.json(result.rows[0]);
});

router.delete("/raw-materials/:id", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const id = Number(String(req.params.id));
  const check = await db.execute(sql`SELECT id FROM raw_materials WHERE id = ${id} AND company_id = ${companyId}`);
  if (check.rows.length === 0) { res.status(404).json({ message: "Bahan baku tidak ditemukan" }); return; }
  await db.execute(sql`DELETE FROM raw_materials WHERE id = ${id} AND company_id = ${companyId}`);
  res.json({ ok: true });
});

// ── RECIPES ───────────────────────────────────────────────────────────────────

router.get("/recipes", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const rows = await db.execute(sql`
    SELECT r.id, r.company_id, r.product_id, r.note, r.is_active, r.created_at, r.updated_at,
           p.name AS product_name, p.sku AS product_sku, p.unit AS product_unit
    FROM recipes r
    JOIN products p ON p.id = r.product_id
    WHERE r.company_id = ${companyId}
      ${productId ? sql`AND r.product_id = ${productId}` : sql``}
    ORDER BY p.name ASC
  `);
  const recipes = rows.rows as Array<Record<string, unknown>>;

  const recipeIds = recipes.map((r) => r.id as number);
  if (recipeIds.length === 0) { res.json(recipes.map((r) => ({ ...r, items: [] }))); return; }

  const itemRows = await db.execute(sql`
    SELECT ri.id, ri.recipe_id, ri.raw_material_id, ri.qty::float, ri.unit,
           rm.name AS raw_material_name, rm.sku AS raw_material_sku, rm.unit AS raw_material_base_unit
    FROM recipe_items ri
    JOIN raw_materials rm ON rm.id = ri.raw_material_id
    WHERE ri.recipe_id = ANY(ARRAY[${sql.raw(recipeIds.join(","))}]::int[])
    ORDER BY ri.id ASC
  `);

  const itemsByRecipe = new Map<number, unknown[]>();
  for (const item of itemRows.rows) {
    const rid = (item as Record<string, unknown>).recipe_id as number;
    if (!itemsByRecipe.has(rid)) itemsByRecipe.set(rid, []);
    itemsByRecipe.get(rid)!.push(item);
  }

  res.json(recipes.map((r) => ({ ...r, items: itemsByRecipe.get(r.id as number) ?? [] })));
});

router.get("/recipes/:id", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const id = Number(String(req.params.id));
  const rows = await db.execute(sql`
    SELECT r.id, r.company_id, r.product_id, r.note, r.is_active, r.created_at, r.updated_at,
           p.name AS product_name, p.sku AS product_sku
    FROM recipes r
    JOIN products p ON p.id = r.product_id
    WHERE r.id = ${id} AND r.company_id = ${companyId}
  `);
  if (rows.rows.length === 0) { res.status(404).json({ message: "Recipe tidak ditemukan" }); return; }
  const recipe = rows.rows[0] as Record<string, unknown>;
  const items = await db.execute(sql`
    SELECT ri.id, ri.recipe_id, ri.raw_material_id, ri.qty::float, ri.unit,
           rm.name AS raw_material_name, rm.sku AS raw_material_sku
    FROM recipe_items ri
    JOIN raw_materials rm ON rm.id = ri.raw_material_id
    WHERE ri.recipe_id = ${id}
    ORDER BY ri.id ASC
  `);
  res.json({ ...recipe, items: items.rows });
});

router.post("/recipes", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { productId, note, isActive, items } = req.body as {
    productId: number; note?: string; isActive?: boolean;
    items: Array<{ rawMaterialId: number; qty: number; unit: string }>;
  };
  if (!productId) { res.status(400).json({ message: "productId wajib diisi" }); return; }
  if (!items || items.length === 0) { res.status(400).json({ message: "items wajib ada minimal 1 bahan" }); return; }

  const productCheck = await db.execute(sql`SELECT id FROM products WHERE id = ${productId} AND company_id = ${companyId}`);
  if (productCheck.rows.length === 0) { res.status(400).json({ message: "Produk tidak ditemukan atau bukan milik company ini" }); return; }

  const existing = await db.execute(sql`SELECT id FROM recipes WHERE product_id = ${productId} AND company_id = ${companyId}`);
  let recipeId: number;

  if (existing.rows.length > 0) {
    recipeId = (existing.rows[0] as { id: number }).id;
    await db.execute(sql`
      UPDATE recipes SET note = ${note ?? null}, is_active = ${isActive ?? true}, updated_at = NOW()
      WHERE id = ${recipeId}
    `);
    await db.execute(sql`DELETE FROM recipe_items WHERE recipe_id = ${recipeId}`);
  } else {
    const ins = await db.execute(sql`
      INSERT INTO recipes (company_id, product_id, note, is_active)
      VALUES (${companyId}, ${productId}, ${note ?? null}, ${isActive ?? true})
      RETURNING id
    `);
    recipeId = (ins.rows[0] as { id: number }).id;
  }

  for (const item of items) {
    if (!item.rawMaterialId || !item.qty) continue;
    await db.execute(sql`
      INSERT INTO recipe_items (recipe_id, raw_material_id, qty, unit)
      VALUES (${recipeId}, ${item.rawMaterialId}, ${item.qty}, ${item.unit ?? "gram"})
    `);
  }

  const result = await db.execute(sql`
    SELECT r.id, r.product_id, r.note, r.is_active, p.name AS product_name
    FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.id = ${recipeId}
  `);
  const finalItems = await db.execute(sql`
    SELECT ri.id, ri.raw_material_id, ri.qty::float, ri.unit,
           rm.name AS raw_material_name, rm.sku AS raw_material_sku
    FROM recipe_items ri JOIN raw_materials rm ON rm.id = ri.raw_material_id
    WHERE ri.recipe_id = ${recipeId} ORDER BY ri.id
  `);
  res.status(201).json({ ...result.rows[0], items: finalItems.rows });
});

router.delete("/recipes/:id", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const id = Number(String(req.params.id));
  const check = await db.execute(sql`SELECT id FROM recipes WHERE id = ${id} AND company_id = ${companyId}`);
  if (check.rows.length === 0) { res.status(404).json({ message: "Recipe tidak ditemukan" }); return; }
  await db.execute(sql`DELETE FROM recipes WHERE id = ${id} AND company_id = ${companyId}`);
  res.json({ ok: true });
});

export default router;

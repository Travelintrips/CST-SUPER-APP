import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { requireAdmin } from "../../lib/requireAdmin.js";

const router: IRouter = Router();
router.use(requireAdmin);

// ── BRANCHES ───────────────────────────────────────────────────────────────
router.get("/branches", async (req, res) => {
  try {
    const cid = req.query.company_id ? Number(req.query.company_id) : null;
    const filter = cid ? sql` WHERE company_id=${cid}` : sql``;
    const { rows } = (await db.execute(sql`SELECT * FROM pos_branches ${filter} ORDER BY name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "pos branches list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/branches", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO pos_branches (name, address, phone, is_active, company_id)
      VALUES (${b.name}, ${b.address ?? null}, ${b.phone ?? null},
              ${b.is_active ?? true}, ${b.company_id ?? null})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "pos branches create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/branches/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE pos_branches SET name=${b.name}, address=${b.address ?? null},
        phone=${b.phone ?? null}, is_active=${b.is_active ?? true}
      WHERE id=${Number(String(req.params.id))} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "pos branches update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/branches/:id", async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM pos_branches WHERE id=${Number(String(req.params.id))}`);
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "pos branches delete"); res.status(500).json({ error: "DB error" }); }
});

// ── CASHIERS ───────────────────────────────────────────────────────────────
router.get("/cashiers", async (req, res) => {
  try {
    const bid = req.query.branch_id ? Number(req.query.branch_id) : null;
    const filter = bid ? sql` WHERE c.branch_id=${bid}` : sql``;
    const { rows } = (await db.execute(sql`
      SELECT c.id, c.name, c.email, c.phone, c.status, c.role, c.pos_role,
             c.allow_all_branches, c.created_at, c.branch_id, c.company_id,
             b.name AS branch_name
      FROM pos_cashiers c LEFT JOIN pos_branches b ON b.id=c.branch_id
      ${filter} ORDER BY c.name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "pos cashiers list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/cashiers", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO pos_cashiers (name, email, phone, status, role, pos_role,
                                branch_id, company_id, allow_all_branches, password_hash)
      VALUES (${b.name}, ${b.email}, ${b.phone ?? null},
              ${b.status ?? "active"}, ${b.role ?? "cashier"}, ${b.pos_role ?? "cashier"},
              ${b.branch_id ?? null}, ${b.company_id ?? null},
              ${b.allow_all_branches ?? false}, ${b.password_hash ?? ""})
      RETURNING id, name, email, phone, status, role, pos_role, branch_id, company_id, created_at`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "pos cashiers create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/cashiers/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE pos_cashiers SET
        name=${b.name}, email=${b.email}, phone=${b.phone ?? null},
        status=${b.status ?? "active"}, role=${b.role ?? "cashier"},
        pos_role=${b.pos_role ?? "cashier"}, branch_id=${b.branch_id ?? null},
        allow_all_branches=${b.allow_all_branches ?? false}, updated_at=NOW()
      WHERE id=${Number(String(req.params.id))}
      RETURNING id, name, email, phone, status, role, pos_role, branch_id`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "pos cashiers update"); res.status(500).json({ error: "DB error" }); }
});

// ── PRODUCTS ───────────────────────────────────────────────────────────────
router.get("/products", async (req, res) => {
  try {
    const cid = req.query.company_id ? Number(req.query.company_id) : null;
    const filter = cid ? sql` WHERE company_id=${cid}` : sql``;
    const { rows } = (await db.execute(sql`SELECT * FROM pos_products ${filter} ORDER BY sort_order, name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "pos products list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/products", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO pos_products (name, description, price, category, image_url, is_active,
                                sort_order, stock_unit, product_type, company_id,
                                stock_usage_per_unit)
      VALUES (${b.name}, ${b.description ?? null}, ${b.price ?? 0},
              ${b.category ?? "umum"}, ${b.image_url ?? null}, ${b.is_active ?? true},
              ${b.sort_order ?? 0}, ${b.stock_unit ?? "pcs"}, ${b.product_type ?? "regular"},
              ${b.company_id ?? null}, ${b.stock_usage_per_unit ?? 1})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "pos products create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/products/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE pos_products SET
        name=${b.name}, description=${b.description ?? null}, price=${b.price ?? 0},
        category=${b.category ?? "umum"}, image_url=${b.image_url ?? null},
        is_active=${b.is_active ?? true}, sort_order=${b.sort_order ?? 0},
        stock_unit=${b.stock_unit ?? "pcs"}
      WHERE id=${Number(String(req.params.id))} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "pos products update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/products/:id", async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM pos_products WHERE id=${Number(String(req.params.id))}`);
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "pos products delete"); res.status(500).json({ error: "DB error" }); }
});

// ── ROLES ──────────────────────────────────────────────────────────────────
router.get("/roles", async (req, res) => {
  try {
    const cid = req.query.company_id ? Number(req.query.company_id) : null;
    const filter = cid ? sql` WHERE company_id=${cid}` : sql``;
    const { rows } = (await db.execute(sql`SELECT * FROM pos_roles ${filter} ORDER BY display_name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "pos roles list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/roles", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO pos_roles (name, display_name, permissions, is_system_role, company_id)
      VALUES (${b.name}, ${b.display_name}, ${JSON.stringify(b.permissions ?? {})}::jsonb,
              ${b.is_system_role ?? false}, ${b.company_id ?? null})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "pos roles create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/roles/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE pos_roles SET display_name=${b.display_name},
        permissions=${JSON.stringify(b.permissions ?? {})}::jsonb, updated_at=NOW()
      WHERE id=${Number(String(req.params.id))} AND is_system_role=false RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found or system role" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "pos roles update"); res.status(500).json({ error: "DB error" }); }
});

// ── INVENTORY ──────────────────────────────────────────────────────────────
router.get("/inventory", async (req, res) => {
  try {
    const cid = req.query.company_id ? Number(req.query.company_id) : null;
    const filter = cid ? sql` WHERE company_id=${cid}` : sql``;
    const { rows } = (await db.execute(sql`SELECT * FROM pos_inventory_items ${filter} ORDER BY name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "pos inventory list"); res.status(500).json({ error: "DB error" }); }
});

// ── SETTINGS ───────────────────────────────────────────────────────────────
router.get("/settings", async (_req, res) => {
  try {
    const { rows } = (await db.execute(sql`SELECT * FROM pos_settings ORDER BY key`)) as any;
    const obj: Record<string, string> = {};
    for (const r of rows) obj[r.key] = r.value;
    res.json({ rows, obj });
  } catch (err) { logger.error({ err }, "pos settings get"); res.status(500).json({ error: "DB error" }); }
});

router.put("/settings", async (req, res) => {
  try {
    const pairs = req.body as Record<string, string>;
    for (const [key, value] of Object.entries(pairs)) {
      await db.execute(sql`
        INSERT INTO pos_settings (key, value, updated_at)
        VALUES (${key}, ${String(value)}, NOW())
        ON CONFLICT (key) DO UPDATE SET value=${String(value)}, updated_at=NOW()`);
    }
    res.json({ ok: true, updated: Object.keys(pairs).length });
  } catch (err) { logger.error({ err }, "pos settings update"); res.status(500).json({ error: "DB error" }); }
});

// ── STATS ──────────────────────────────────────────────────────────────────
router.get("/stats", async (_req, res) => {
  try {
    const [branches, cashiers, products, roles, inventory] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM pos_branches`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active FROM pos_cashiers`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM pos_products`),
      db.execute(sql`SELECT COUNT(*)::int AS total FROM pos_roles`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM pos_inventory_items`),
    ]);
    res.json({
      branches: (branches as any).rows[0],
      cashiers: (cashiers as any).rows[0],
      products: (products as any).rows[0],
      roles: (roles as any).rows[0],
      inventory: (inventory as any).rows[0],
    });
  } catch (err) { logger.error({ err }, "pos stats"); res.status(500).json({ error: "DB error" }); }
});

export default router;

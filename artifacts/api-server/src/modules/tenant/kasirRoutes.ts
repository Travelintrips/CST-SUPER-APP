import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../../lib/logger.js";
import { requireAdmin } from "../../lib/requireAdmin.js";

// ── image_url guard ─────────────────────────────────────────────────────────
// Reject bare local paths — these break at display time because the files are
// NOT served from disk in production (images live in Supabase Storage).
const LOCAL_IMAGE_PATH_RE = /^\/(images|menu|api\/pos-images)\//;

function validateImageUrl(raw: unknown): string | null {
  if (raw == null || raw === "") return null;
  const url = String(raw).trim();
  if (LOCAL_IMAGE_PATH_RE.test(url)) {
    const err: any = new Error(
      `image_url tidak boleh berupa path lokal ('${url}'). ` +
      `Upload gambar via /api/media/upload dan gunakan URL Supabase Storage yang dikembalikan.`
    );
    err.status = 400;
    throw err;
  }
  return url;
}

const router: IRouter = Router();
router.use(requireAdmin);

// ── COMPANIES ──────────────────────────────────────────────────────────────
router.get("/companies", async (_req, res) => {
  try {
    const { rows } = (await db.execute(sql`SELECT * FROM kasir_companies ORDER BY name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir companies list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/companies", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO kasir_companies (id, name, address, phone, is_active)
      VALUES (gen_random_uuid(), ${b.name}, ${b.address ?? null}, ${b.phone ?? null}, ${b.is_active ?? true})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir companies create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/companies/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE kasir_companies SET
        name=${b.name}, address=${b.address ?? null}, phone=${b.phone ?? null},
        is_active=${b.is_active ?? true}, updated_at=NOW()
      WHERE id=${String(req.params.id)} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir companies update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/companies/:id", async (req, res) => {
  try {
    const { rows } = (await db.execute(sql`DELETE FROM kasir_companies WHERE id=${String(req.params.id)} RETURNING id`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "kasir companies delete"); res.status(500).json({ error: "DB error" }); }
});

// ── BRANCHES ───────────────────────────────────────────────────────────────
router.get("/branches", async (req, res) => {
  try {
    const cid = req.query.company_id as string | undefined;
    const filter = cid ? sql` WHERE b.company_id=${cid}::uuid` : sql``;
    const { rows } = (await db.execute(sql`
      SELECT b.*, c.name AS company_name
      FROM kasir_branches b LEFT JOIN kasir_companies c ON c.id=b.company_id
      ${filter} ORDER BY c.name, b.name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir branches list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/branches", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO kasir_branches (id, company_id, code, name, address, phone, is_active)
      VALUES (gen_random_uuid(), ${b.company_id}::uuid, ${b.code}, ${b.name},
              ${b.address ?? null}, ${b.phone ?? null}, ${b.is_active ?? true})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir branches create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/branches/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE kasir_branches SET
        code=${b.code}, name=${b.name}, address=${b.address ?? null},
        phone=${b.phone ?? null}, is_active=${b.is_active ?? true}, updated_at=NOW()
      WHERE id=${String(req.params.id)} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir branches update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/branches/:id", async (req, res) => {
  try {
    const { rows } = (await db.execute(sql`DELETE FROM kasir_branches WHERE id=${String(req.params.id)} RETURNING id`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "kasir branches delete"); res.status(500).json({ error: "DB error" }); }
});

// ── USERS ──────────────────────────────────────────────────────────────────
router.get("/users", async (req, res) => {
  try {
    const bid = req.query.branch_id as string | undefined;
    const filter = bid ? sql` WHERE u.branch_id=${bid}::uuid` : sql``;
    const { rows } = (await db.execute(sql`
      SELECT u.id, u.username, u.full_name, u.role, u.status, u.phone, u.email,
             u.whatsapp_number, u.is_active, u.created_at, u.branch_id,
             b.name AS branch_name, c.name AS company_name
      FROM kasir_users u
      LEFT JOIN kasir_branches b ON b.id=u.branch_id
      LEFT JOIN kasir_companies c ON c.id=b.company_id
      ${filter} ORDER BY u.full_name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir users list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/users", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO kasir_users (id, username, password_hash, full_name, role, branch_id,
                               is_active, status, phone, email, whatsapp_number)
      VALUES (gen_random_uuid(), ${b.username}, ${b.password_hash ?? ""},
              ${b.full_name ?? null}, ${b.role ?? "cashier"},
              ${b.branch_id ? sql`${b.branch_id}::uuid` : sql`NULL`},
              ${b.is_active ?? true}, ${b.status ?? "active"},
              ${b.phone ?? null}, ${b.email ?? null}, ${b.whatsapp_number ?? null})
      RETURNING id, username, full_name, role, status, phone, email, is_active, created_at`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir users create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/users/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE kasir_users SET
        username=${b.username}, full_name=${b.full_name ?? null}, role=${b.role ?? "cashier"},
        branch_id=${b.branch_id ? sql`${b.branch_id}::uuid` : sql`NULL`},
        is_active=${b.is_active ?? true}, status=${b.status ?? "active"},
        phone=${b.phone ?? null}, email=${b.email ?? null},
        whatsapp_number=${b.whatsapp_number ?? null}, updated_at=NOW()
      WHERE id=${String(req.params.id)}
      RETURNING id, username, full_name, role, status, phone, email, is_active`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir users update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/users/:id", async (req, res) => {
  try {
    await db.execute(sql`UPDATE kasir_users SET is_active=false, status='inactive', updated_at=NOW() WHERE id=${String(req.params.id)}`);
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "kasir users delete"); res.status(500).json({ error: "DB error" }); }
});

// ── CATEGORIES ─────────────────────────────────────────────────────────────
router.get("/categories", async (_req, res) => {
  try {
    const { rows } = (await db.execute(sql`SELECT * FROM kasir_categories ORDER BY sort_order, name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir categories list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/categories", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      INSERT INTO kasir_categories (id, name, color, sort_order)
      VALUES (gen_random_uuid(), ${b.name}, ${b.color ?? null}, ${b.sort_order ?? 0})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir categories create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/categories/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE kasir_categories SET name=${b.name}, color=${b.color ?? null},
        sort_order=${b.sort_order ?? 0}, updated_at=NOW()
      WHERE id=${String(req.params.id)} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir categories update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/categories/:id", async (req, res) => {
  try {
    const { rows } = (await db.execute(sql`DELETE FROM kasir_categories WHERE id=${String(req.params.id)} RETURNING id`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "kasir categories delete"); res.status(500).json({ error: "DB error" }); }
});

// ── PRODUCTS ───────────────────────────────────────────────────────────────
router.get("/products", async (req, res) => {
  try {
    const cid = req.query.category_id as string | undefined;
    const filter = cid ? sql` WHERE p.category_id=${cid}::uuid` : sql``;
    const { rows } = (await db.execute(sql`
      SELECT p.*, cat.name AS category_name
      FROM kasir_products p LEFT JOIN kasir_categories cat ON cat.id=p.category_id
      ${filter} ORDER BY p.name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir products list"); res.status(500).json({ error: "DB error" }); }
});

router.post("/products", async (req, res) => {
  try {
    const b = req.body as any;
    let imageUrl: string | null;
    try { imageUrl = validateImageUrl(b.image_url); } catch (e: any) { return void res.status(400).json({ error: e.message }); }
    const { rows } = (await db.execute(sql`
      INSERT INTO kasir_products (id, name, sku, description, price, category_id, image_url, is_active)
      VALUES (gen_random_uuid(), ${b.name}, ${b.sku ?? null}, ${b.description ?? null},
              ${b.price ?? 0}, ${b.category_id ? sql`${b.category_id}::uuid` : sql`NULL`},
              ${imageUrl}, ${b.is_active ?? true})
      RETURNING *`)) as any;
    res.status(201).json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir products create"); res.status(500).json({ error: "DB error" }); }
});

router.put("/products/:id", async (req, res) => {
  try {
    const b = req.body as any;
    let imageUrl: string | null;
    try { imageUrl = validateImageUrl(b.image_url); } catch (e: any) { return void res.status(400).json({ error: e.message }); }
    const { rows } = (await db.execute(sql`
      UPDATE kasir_products SET
        name=${b.name}, sku=${b.sku ?? null}, description=${b.description ?? null},
        price=${b.price ?? 0},
        category_id=${b.category_id ? sql`${b.category_id}::uuid` : sql`NULL`},
        image_url=${imageUrl}, is_active=${b.is_active ?? true}, updated_at=NOW()
      WHERE id=${String(req.params.id)} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir products update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/products/:id", async (req, res) => {
  try {
    const { rows } = (await db.execute(sql`DELETE FROM kasir_products WHERE id=${String(req.params.id)} RETURNING id`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "kasir products delete"); res.status(500).json({ error: "DB error" }); }
});

// ── DEVICES ────────────────────────────────────────────────────────────────
router.get("/devices", async (req, res) => {
  try {
    const bid = req.query.branch_id as string | undefined;
    const filter = bid ? sql` WHERE d.branch_id=${bid}::uuid` : sql``;
    const { rows } = (await db.execute(sql`
      SELECT d.*, b.name AS branch_name, c.name AS company_name
      FROM kasir_devices d
      LEFT JOIN kasir_branches b ON b.id=d.branch_id
      LEFT JOIN kasir_companies c ON c.id=b.company_id
      ${filter} ORDER BY b.name, d.name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir devices list"); res.status(500).json({ error: "DB error" }); }
});

router.put("/devices/:id", async (req, res) => {
  try {
    const b = req.body as any;
    const { rows } = (await db.execute(sql`
      UPDATE kasir_devices SET name=${b.name}, is_active=${b.is_active ?? true}, updated_at=NOW()
      WHERE id=${String(req.params.id)} RETURNING *`)) as any;
    if (!rows[0]) return void res.status(404).json({ error: "Not found" });
    res.json(rows[0]);
  } catch (err) { logger.error({ err }, "kasir devices update"); res.status(500).json({ error: "DB error" }); }
});

router.delete("/devices/:id", async (req, res) => {
  try {
    await db.execute(sql`DELETE FROM kasir_devices WHERE id=${String(req.params.id)}`);
    res.json({ ok: true });
  } catch (err) { logger.error({ err }, "kasir devices delete"); res.status(500).json({ error: "DB error" }); }
});

// ── INGREDIENTS ────────────────────────────────────────────────────────────
router.get("/ingredients", async (req, res) => {
  try {
    const bid = req.query.branch_id as string | undefined;
    const filter = bid ? sql` WHERE branch_id=${bid}::uuid` : sql``;
    const { rows } = (await db.execute(sql`SELECT * FROM kasir_ingredients ${filter} ORDER BY name`)) as any;
    res.json(rows);
  } catch (err) { logger.error({ err }, "kasir ingredients list"); res.status(500).json({ error: "DB error" }); }
});

// ── STATS ──────────────────────────────────────────────────────────────────
router.get("/stats", async (_req, res) => {
  try {
    const [companies, branches, users, products, devices] = await Promise.all([
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM kasir_companies`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM kasir_branches`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM kasir_users`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM kasir_products`),
      db.execute(sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active FROM kasir_devices`),
    ]);
    res.json({
      companies: (companies as any).rows[0],
      branches: (branches as any).rows[0],
      users: (users as any).rows[0],
      products: (products as any).rows[0],
      devices: (devices as any).rows[0],
    });
  } catch (err) { logger.error({ err }, "kasir stats"); res.status(500).json({ error: "DB error" }); }
});

export default router;

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

// Buat tabel jika belum ada + seed defaults
db.execute(sql`
  CREATE TABLE IF NOT EXISTS logistics_units (
    id          SERIAL PRIMARY KEY,
    name        TEXT NOT NULL UNIQUE,
    symbol      TEXT NOT NULL,
    description TEXT,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TIMESTAMP DEFAULT NOW() NOT NULL
  )
`).then(() =>
  db.execute(sql`
    INSERT INTO logistics_units (name, symbol, description, sort_order) VALUES
      ('Kilogram',          'kg',      'Satuan berat metrik',                   10),
      ('Metric Ton',        'MT',      'Setara 1.000 kg',                       20),
      ('Cubic Metre',       'CBM',     'Volume (panjang x lebar x tinggi m)',   30),
      ('Pallet',            'plt',     'Pallet standar 120x80 cm',              40),
      ('Carton',            'ctn',     'Karton/dus',                            50),
      ('Piece',             'pcs',     'Satuan buah',                           60),
      ('Container 20ft',   'FCL20',   'Full Container Load 20 kaki',           70),
      ('Container 40ft',   'FCL40',   'Full Container Load 40 kaki',           80),
      ('LCL Shipment',     'LCL',     'Less than Container Load',              90),
      ('Truck Load',       'TL',      'Full truck load',                      100)
    ON CONFLICT (name) DO NOTHING
  `)
).catch(() => {});

// Auth — semua route ini hanya untuk admin
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// GET /api/logistics-units
router.get("/", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT id, name, symbol, description, is_active, sort_order, created_at
    FROM logistics_units
    ORDER BY sort_order, name
  `);
  return res.json(rows.rows);
});

// POST /api/logistics-units
router.post("/", async (req: Request, res: Response) => {
  const { name, symbol, description = "", sortOrder = 0 } = req.body ?? {};
  if (!name?.trim() || !symbol?.trim())
    return res.status(400).json({ message: "name dan symbol wajib diisi" });
  try {
    const row = await db.execute(sql`
      INSERT INTO logistics_units (name, symbol, description, sort_order)
      VALUES (${name.trim()}, ${symbol.trim()}, ${description ?? ""}, ${Number(sortOrder)})
      RETURNING *
    `);
    return res.status(201).json(row.rows[0]);
  } catch (e: any) {
    if (e.message?.includes("unique")) return res.status(409).json({ message: "Nama satuan sudah ada" });
    throw e;
  }
});

// PUT /api/logistics-units/:id
router.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { name, symbol, description, isActive, sortOrder } = req.body ?? {};
  await db.execute(sql`
    UPDATE logistics_units SET
      name        = COALESCE(${name ?? null}, name),
      symbol      = COALESCE(${symbol ?? null}, symbol),
      description = COALESCE(${description ?? null}, description),
      is_active   = COALESCE(${isActive ?? null}, is_active),
      sort_order  = COALESCE(${sortOrder !== undefined ? Number(sortOrder) : null}, sort_order)
    WHERE id = ${id}
  `);
  const row = await db.execute(sql`SELECT * FROM logistics_units WHERE id = ${id}`);
  return res.json(row.rows[0] ?? {});
});

// DELETE /api/logistics-units/:id
router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`DELETE FROM logistics_units WHERE id = ${id}`);
  return res.json({ ok: true });
});

export default router;

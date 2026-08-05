import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

db.execute(sql`
  CREATE TABLE IF NOT EXISTS trucking_vehicle_rates (
    id          SERIAL PRIMARY KEY,
    type        TEXT NOT NULL UNIQUE,
    label       TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    max_kg      NUMERIC,
    rate_per_kg NUMERIC NOT NULL DEFAULT 2500,
    min_price   NUMERIC NOT NULL DEFAULT 150000,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
  )
`).then(() =>
  db.execute(sql`
    INSERT INTO trucking_vehicle_rates
      (type, label, description, max_kg, rate_per_kg, min_price, sort_order) VALUES
      ('CDE',     'CDE — Engkel Kecil',   's/d 1.500 kg',  1500,  3500, 200000,  10),
      ('CDD',     'CDD — Engkel Besar',   's/d 3.000 kg',  3000,  2800, 350000,  20),
      ('Fuso',    'Fuso — Truk Medium',   's/d 8.000 kg',  8000,  2200, 800000,  30),
      ('Wingbox', 'Wingbox — Truk Besar', 's/d 20.000 kg', 20000, 1800, 2500000, 40),
      ('Trailer', 'Trailer',              '> 20.000 kg',   NULL,  1500, 5000000, 50)
    ON CONFLICT (type) DO NOTHING
  `)
).catch(() => {});

router.get("/", async (_req: Request, res: Response) => {
  try {
    const result = await db.execute(sql`
      SELECT id, type, label, description, max_kg, rate_per_kg, min_price, sort_order, is_active
      FROM trucking_vehicle_rates
      WHERE is_active = TRUE
      ORDER BY sort_order
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ message: "Gagal memuat tarif kendaraan" });
  }
});

router.get("/all", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const result = await db.execute(sql`
      SELECT id, type, label, description, max_kg, rate_per_kg, min_price, sort_order, is_active, updated_at
      FROM trucking_vehicle_rates
      ORDER BY sort_order
    `);
    res.json(result.rows);
  } catch {
    res.status(500).json({ message: "Gagal memuat data" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ message: "ID tidak valid" }); return; }
  const { label, description, max_kg, rate_per_kg, min_price, sort_order, is_active } =
    req.body as Record<string, unknown>;
  try {
    const maxKg = (max_kg !== null && max_kg !== undefined && max_kg !== "") ? Number(max_kg) : null;
    const result = await db.execute(sql`
      UPDATE trucking_vehicle_rates SET
        label       = ${String(label ?? "")},
        description = ${String(description ?? "")},
        max_kg      = ${maxKg},
        rate_per_kg = ${Number(rate_per_kg ?? 0)},
        min_price   = ${Number(min_price ?? 0)},
        sort_order  = ${Number(sort_order ?? 0)},
        is_active   = ${Boolean(is_active ?? true)},
        updated_at  = NOW()
      WHERE id = ${id}
      RETURNING *
    `);
    if (result.rows.length === 0) {
      res.status(404).json({ message: "Kendaraan tidak ditemukan" }); return;
    }
    res.json(result.rows[0]);
  } catch {
    res.status(500).json({ message: "Gagal update tarif" });
  }
});

export default router;

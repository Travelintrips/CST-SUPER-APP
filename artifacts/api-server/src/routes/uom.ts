import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { convertQty } from "../lib/uomEngine.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── LIST UOMs ────────────────────────────────────────────────────────────────

router.get("/", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT id, name, symbol, category, is_active, created_at
    FROM uom ORDER BY category, name
  `);
  return res.json(rows.rows);
});

// ── CREATE UOM ───────────────────────────────────────────────────────────────

router.post("/", async (req: Request, res: Response) => {
  const { name, symbol, category = "count" } = req.body ?? {};
  if (!name?.trim() || !symbol?.trim())
    return res.status(400).json({ message: "name dan symbol wajib diisi" });
  try {
    const row = await db.execute(sql`
      INSERT INTO uom (name, symbol, category)
      VALUES (${name.trim()}, ${symbol.trim()}, ${category})
      RETURNING *
    `);
    return res.status(201).json(row.rows[0]);
  } catch (e: any) {
    if (e.message?.includes("unique")) return res.status(409).json({ message: "Nama UOM sudah ada" });
    throw e;
  }
});

// ── UPDATE UOM ───────────────────────────────────────────────────────────────

router.put("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { name, symbol, category, isActive } = req.body ?? {};
  await db.execute(sql`
    UPDATE uom SET
      name      = COALESCE(${name ?? null}, name),
      symbol    = COALESCE(${symbol ?? null}, symbol),
      category  = COALESCE(${category ?? null}, category),
      is_active = COALESCE(${isActive ?? null}, is_active)
    WHERE id = ${id}
  `);
  const row = await db.execute(sql`SELECT * FROM uom WHERE id = ${id}`);
  return res.json(row.rows[0] ?? {});
});

// ── DELETE UOM ───────────────────────────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`DELETE FROM uom WHERE id = ${id}`);
  return res.json({ ok: true });
});

// ── LIST CONVERSIONS ─────────────────────────────────────────────────────────

router.get("/conversions", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT uc.id, uc.from_uom_id, f.name AS from_name, f.symbol AS from_symbol,
           uc.to_uom_id, t.name AS to_name, t.symbol AS to_symbol,
           uc.factor::float
    FROM uom_conversions uc
    JOIN uom f ON f.id = uc.from_uom_id
    JOIN uom t ON t.id = uc.to_uom_id
    ORDER BY f.name, t.name
  `);
  return res.json(rows.rows);
});

// ── CREATE CONVERSION ────────────────────────────────────────────────────────

router.post("/conversions", async (req: Request, res: Response) => {
  const { fromUomId, toUomId, factor } = req.body ?? {};
  if (!fromUomId || !toUomId || !factor)
    return res.status(400).json({ message: "fromUomId, toUomId, factor wajib diisi" });
  if (Number(factor) <= 0)
    return res.status(400).json({ message: "factor harus > 0" });
  try {
    const row = await db.execute(sql`
      INSERT INTO uom_conversions (from_uom_id, to_uom_id, factor)
      VALUES (${Number(fromUomId)}, ${Number(toUomId)}, ${Number(factor)})
      ON CONFLICT ON CONSTRAINT uom_conversions_pair_uidx
      DO UPDATE SET factor = EXCLUDED.factor
      RETURNING id, from_uom_id, to_uom_id, factor::float
    `);
    return res.status(201).json(row.rows[0]);
  } catch (e: any) {
    throw e;
  }
});

// ── UPDATE CONVERSION ────────────────────────────────────────────────────────

router.put("/conversions/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { factor } = req.body ?? {};
  if (!factor || Number(factor) <= 0) return res.status(400).json({ message: "factor harus > 0" });
  await db.execute(sql`UPDATE uom_conversions SET factor = ${Number(factor)} WHERE id = ${id}`);
  return res.json({ ok: true });
});

// ── DELETE CONVERSION ────────────────────────────────────────────────────────

router.delete("/conversions/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`DELETE FROM uom_conversions WHERE id = ${id}`);
  return res.json({ ok: true });
});

// ── CONVERT QTY ──────────────────────────────────────────────────────────────

router.get("/convert", async (req: Request, res: Response) => {
  const fromUomId = Number(req.query["from"]);
  const toUomId = Number(req.query["to"]);
  const qty = Number(req.query["qty"] ?? 1);
  if (!fromUomId || !toUomId || Number.isNaN(qty))
    return res.status(400).json({ message: "from, to, qty wajib diisi" });
  try {
    const converted = await convertQty(qty, fromUomId, toUomId);
    return res.json({ from: fromUomId, to: toUomId, qty, converted });
  } catch (e: any) {
    return res.status(422).json({ message: e.message });
  }
});

export default router;

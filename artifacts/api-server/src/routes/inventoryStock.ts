/**
 * GET /api/inventory/stock         — stok per produk + gudang
 * GET /api/inventory/stock/summary — ringkasan per produk
 * GET /api/inventory/stock/racks   — rak dari gudang tertentu
 * GET /api/inventory/stock/movements — riwayat stock_movements
 * GET /api/inventory/warehouses    — daftar gudang aktif
 */
import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { convertQty } from "../lib/uomEngine.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Warehouses ────────────────────────────────────────────────────────────────

router.get("/warehouses", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT id, warehouse_code, warehouse_name, warehouse_type, branch_id, address, is_active, created_at
    FROM warehouses
    ORDER BY warehouse_name
  `);
  res.json(rows.rows);
});

router.post("/warehouses", async (req: Request, res: Response) => {
  const { warehouseCode, warehouseName, warehouseType, branchId, address } = req.body as {
    warehouseCode: string; warehouseName: string;
    warehouseType?: string; branchId?: number | null; address?: string;
  };
  if (!warehouseCode || !warehouseName) {
    res.status(400).json({ message: "warehouseCode dan warehouseName wajib diisi" }); return;
  }
  const r = await db.execute(sql`
    INSERT INTO warehouses (warehouse_code, warehouse_name, warehouse_type, branch_id, address)
    VALUES (${warehouseCode.toUpperCase()}, ${warehouseName},
            ${(warehouseType ?? "BRANCH")}::warehouse_type,
            ${branchId ?? null}, ${address ?? null})
    RETURNING *
  `);
  res.status(201).json(r.rows[0]);
});

router.put("/warehouses/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { warehouseName, warehouseType, branchId, address, isActive } = req.body as {
    warehouseName?: string; warehouseType?: string;
    branchId?: number | null; address?: string; isActive?: boolean;
  };
  await db.execute(sql`
    UPDATE warehouses SET
      warehouse_name  = COALESCE(${warehouseName ?? null}, warehouse_name),
      warehouse_type  = COALESCE(${warehouseType ?? null}::warehouse_type, warehouse_type),
      branch_id       = ${branchId ?? null},
      address         = COALESCE(${address ?? null}, address),
      is_active       = COALESCE(${isActive ?? null}, is_active),
      updated_at      = NOW()
    WHERE id = ${id}
  `);
  const r = await db.execute(sql`SELECT * FROM warehouses WHERE id = ${id}`);
  res.json(r.rows[0]);
});

// ── Racks ─────────────────────────────────────────────────────────────────────

router.get("/racks", async (req: Request, res: Response) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const rows = await db.execute(sql`
    SELECT wr.*, w.warehouse_name, w.warehouse_code
    FROM warehouse_racks wr
    JOIN warehouses w ON w.id = wr.warehouse_id
    WHERE wr.is_active = TRUE
      ${warehouseId ? sql`AND wr.warehouse_id = ${warehouseId}` : sql``}
    ORDER BY wr.warehouse_id, wr.rack_code
  `);
  res.json(rows.rows);
});

router.post("/racks", async (req: Request, res: Response) => {
  const { warehouseId, rackCode, rackName, zone, qrCode } = req.body as {
    warehouseId: number; rackCode: string; rackName: string;
    zone?: string; qrCode?: string;
  };
  if (!warehouseId || !rackCode || !rackName) {
    res.status(400).json({ message: "warehouseId, rackCode, rackName wajib diisi" }); return;
  }
  const r = await db.execute(sql`
    INSERT INTO warehouse_racks (warehouse_id, rack_code, rack_name, zone, qr_code)
    VALUES (${warehouseId}, ${rackCode.toUpperCase()}, ${rackName}, ${zone ?? null}, ${qrCode ?? null})
    RETURNING *
  `);
  res.status(201).json(r.rows[0]);
});

router.put("/racks/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { rackName, zone, qrCode, isActive } = req.body as {
    rackName?: string; zone?: string; qrCode?: string; isActive?: boolean;
  };
  await db.execute(sql`
    UPDATE warehouse_racks SET
      rack_name = COALESCE(${rackName ?? null}, rack_name),
      zone      = COALESCE(${zone ?? null}, zone),
      qr_code   = COALESCE(${qrCode ?? null}, qr_code),
      is_active = COALESCE(${isActive ?? null}, is_active)
    WHERE id = ${id}
  `);
  const r = await db.execute(sql`SELECT * FROM warehouse_racks WHERE id = ${id}`);
  res.json(r.rows[0]);
});

// ── Stock (detail per gudang+rak) ─────────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const lowStock = req.query.lowStock === "true";
  const rows = await db.execute(sql`
    SELECT
      ist.id, ist.product_id, ist.warehouse_id, ist.rack_id,
      ist.stock_on_hand::float, ist.stock_reserved::float,
      ist.stock_available::float, ist.minimum_stock::float,
      ist.average_cost::float, ist.unit, ist.last_updated,
      p.name AS product_name, p.sku, p.unit AS product_unit,
      w.warehouse_code, w.warehouse_name, w.warehouse_type,
      wr.rack_code, wr.rack_name, wr.zone
    FROM inventory_stock ist
    JOIN products p ON p.id = ist.product_id
    JOIN warehouses w ON w.id = ist.warehouse_id
    LEFT JOIN warehouse_racks wr ON wr.id = ist.rack_id
    WHERE TRUE
      ${warehouseId ? sql`AND ist.warehouse_id = ${warehouseId}` : sql``}
      ${productId ? sql`AND ist.product_id = ${productId}` : sql``}
      ${lowStock ? sql`AND ist.stock_on_hand <= ist.minimum_stock` : sql``}
    ORDER BY p.name, w.warehouse_name
  `);
  res.json(rows.rows);
});

// ── Stock Check (untuk validasi real-time di quotation editor) ───────────────

router.get("/check", async (req: Request, res: Response) => {
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const salesUomId = req.query.salesUomId ? Number(req.query.salesUomId) : null;

  if (!productId || !Number.isInteger(productId) || productId <= 0) {
    res.status(400).json({ message: "productId wajib diisi" }); return;
  }

  const stockRow = (await db.execute(sql`
    SELECT
      p.id AS product_id,
      p.name,
      p.unit AS base_unit,
      p.base_uom_id,
      p.item_type,
      COALESCE(SUM(ist.stock_available), 0)::float AS total_available,
      u.symbol AS base_uom_symbol
    FROM products p
    LEFT JOIN inventory_stock ist ON ist.product_id = p.id
    LEFT JOIN uom u ON u.id = p.base_uom_id
    WHERE p.id = ${productId}
    GROUP BY p.id, p.name, p.unit, p.base_uom_id, p.item_type, u.symbol
  `)).rows[0] as {
    product_id: number; name: string; base_unit: string;
    base_uom_id: number | null; item_type: string;
    total_available: number; base_uom_symbol: string | null;
  } | undefined;

  if (!stockRow) { res.status(404).json({ message: "Produk tidak ditemukan" }); return; }

  const baseAvailable = Number(stockRow.total_available ?? 0);
  const baseUomId = stockRow.base_uom_id ? Number(stockRow.base_uom_id) : null;
  const baseUomSymbol = stockRow.base_uom_symbol ?? stockRow.base_unit;

  let salesUomSymbol: string | null = null;
  if (salesUomId) {
    const uomRow = (await db.execute(sql`
      SELECT symbol FROM uom WHERE id = ${salesUomId} LIMIT 1
    `)).rows[0] as { symbol: string } | undefined;
    salesUomSymbol = uomRow?.symbol ?? null;
  }

  let available = baseAvailable;
  let conversionAvailable = true;

  if (salesUomId && baseUomId && salesUomId !== baseUomId) {
    try {
      available = await convertQty(baseAvailable, baseUomId, salesUomId);
    } catch {
      conversionAvailable = false;
    }
  } else if (!salesUomId || !baseUomId) {
    conversionAvailable = salesUomId ? false : true;
  }

  res.json({
    productId,
    itemType: stockRow.item_type,
    baseUnit: stockRow.base_unit,
    baseUomId,
    baseUomSymbol,
    baseAvailable,
    salesUomId: salesUomId ?? null,
    salesUomSymbol: salesUomSymbol ?? baseUomSymbol,
    available,
    conversionAvailable,
  });
});

// ── Stock Summary (per produk, all warehouses) ────────────────────────────────

router.get("/summary", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      ist.product_id,
      p.name AS product_name, p.sku, p.unit,
      SUM(ist.stock_on_hand)::float AS total_on_hand,
      SUM(ist.stock_reserved)::float AS total_reserved,
      SUM(ist.stock_available)::float AS total_available,
      AVG(ist.average_cost)::float AS avg_cost,
      SUM(ist.stock_on_hand * ist.average_cost)::float AS total_value,
      COUNT(DISTINCT ist.warehouse_id) AS warehouse_count,
      MAX(ist.last_updated) AS last_updated,
      BOOL_OR(ist.stock_on_hand <= ist.minimum_stock AND ist.minimum_stock > 0) AS is_low_stock
    FROM inventory_stock ist
    JOIN products p ON p.id = ist.product_id
    GROUP BY ist.product_id, p.name, p.sku, p.unit
    ORDER BY p.name
  `);
  res.json(rows.rows);
});

// ── Movements ─────────────────────────────────────────────────────────────────

router.get("/movements", async (req: Request, res: Response) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const limit = Math.min(Number(req.query.limit ?? 300), 1000);

  const rows = await db.execute(sql`
    SELECT
      sm.*,
      sm.qty_in::float, sm.qty_out::float, sm.balance_after::float,
      sm.unit_cost::float, sm.total_cost::float,
      p.name AS product_name, p.sku, p.unit,
      w.warehouse_name, w.warehouse_code,
      wr.rack_code, wr.rack_name
    FROM stock_movements sm
    JOIN products p ON p.id = sm.product_id
    JOIN warehouses w ON w.id = sm.warehouse_id
    LEFT JOIN warehouse_racks wr ON wr.id = sm.rack_id
    WHERE TRUE
      ${warehouseId ? sql`AND sm.warehouse_id = ${warehouseId}` : sql``}
      ${productId ? sql`AND sm.product_id = ${productId}` : sql``}
    ORDER BY sm.created_at DESC
    LIMIT ${limit}
  `);
  res.json(rows.rows);
});

export default router;

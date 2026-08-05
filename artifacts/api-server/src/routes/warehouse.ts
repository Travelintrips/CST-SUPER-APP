import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { postOpnameAdjust, postDamageJournal, postWarehouseTransfer } from "../lib/accounting.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ── helpers ───────────────────────────────────────────────────────────────────

function makeDocNumber(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ms = now.getTime().toString().slice(-5);
  return `${prefix}/${y}${m}${d}/${ms}`;
}

// ── STOCK ─────────────────────────────────────────────────────────────────────

router.get("/stock", async (req: Request, res: Response) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT
      ws.id, ws.product_id, ws.warehouse_id, ws.rack_id,
      ws.qty::float, ws.cost_price::float, ws.updated_at,
      p.name AS product_name, p.sku, p.unit,
      w.warehouse_name,
      w.warehouse_code,
      pb.name AS branch_name,
      wr.rack_code, wr.rack_name
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    LEFT JOIN pos_branches pb ON pb.id = w.branch_id
    LEFT JOIN warehouse_racks wr ON wr.id = ws.rack_id
    WHERE ws.company_id = ${companyId}
      ${warehouseId ? sql`AND ws.warehouse_id = ${warehouseId}` : sql``}
    ORDER BY pb.name, w.warehouse_name, p.name
  `);
  res.json(rows.rows);
});

router.get("/stock/summary", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT
      ws.product_id,
      p.name AS product_name, p.sku, p.unit,
      SUM(ws.qty)::float AS total_qty,
      AVG(ws.cost_price)::float AS avg_cost_price,
      COUNT(DISTINCT ws.warehouse_id) AS warehouse_count
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    WHERE ws.company_id = ${companyId}
    GROUP BY ws.product_id, p.name, p.sku, p.unit
    ORDER BY p.name
  `);
  res.json(rows.rows);
});

router.post("/stock/adjust", async (req: Request, res: Response) => {
  const { productId, warehouseId, rackId, qty, costPrice, note } = req.body as {
    productId: number; warehouseId: number; rackId?: number | null;
    qty: number; costPrice?: number; note?: string;
  };
  if (!productId || !warehouseId || qty === undefined) {
    res.status(400).json({ message: "productId, warehouseId, qty wajib diisi" }); return;
  }
  const rack = rackId ?? null;
  const cur = await db.execute(sql`
    SELECT qty::float FROM wh_stock
    WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}
    AND (rack_id = ${rack}::int OR (rack_id IS NULL AND ${rack}::int IS NULL))
  `);
  const qtyBefore = Number(cur.rows[0]?.qty ?? 0);
  const qtyAfter = qtyBefore + qty;
  await db.execute(sql`
    INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, cost_price, updated_at)
    VALUES (${productId}, ${warehouseId}, ${rack}, ${qtyAfter}, ${costPrice ?? 0}, NOW())
    ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
    DO UPDATE SET qty = ${qtyAfter},
      cost_price = COALESCE(NULLIF(${costPrice ?? null}, 0), wh_stock.cost_price),
      updated_at = NOW()
  `);
  const type = qty >= 0 ? "manual_in" : "manual_out";
  await db.execute(sql`
    INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, note)
    VALUES (${productId}, ${warehouseId}, ${rack}, ${type}, ${Math.abs(qty)}, ${qtyBefore}, ${qtyAfter}, ${costPrice ?? 0}, ${note ?? null})
  `);
  res.json({ ok: true, qtyBefore, qtyAfter });
});

// ── MOVEMENTS ─────────────────────────────────────────────────────────────────

router.get("/movements", async (req: Request, res: Response) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const limit = Math.min(Number(req.query.limit ?? 200), 500);
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT
      wm.*,
      wm.qty::float, wm.qty_before::float, wm.qty_after::float, wm.cost_price::float,
      p.name AS product_name, p.sku, p.unit,
      w.warehouse_name
    FROM wh_movements wm
    JOIN products p ON p.id = wm.product_id
    JOIN warehouses w ON w.id = wm.warehouse_id
    WHERE wm.company_id = ${companyId}
      ${warehouseId ? sql`AND wm.warehouse_id = ${warehouseId}` : sql``}
      ${productId ? sql`AND wm.product_id = ${productId}` : sql``}
    ORDER BY wm.created_at DESC
    LIMIT ${limit}
  `);
  res.json(rows.rows);
});

// ── TRANSFERS ─────────────────────────────────────────────────────────────────

router.get("/transfers", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT
      wt.*,
      fw.warehouse_name AS from_warehouse_name, tw.warehouse_name AS to_warehouse_name,
      fb.name AS from_branch_name, tb.name AS to_branch_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT tl.*, tl.qty_requested::float, tl.qty_sent::float, tl.qty_received::float,
               p.name AS product_name, p.sku, p.unit
        FROM wh_transfer_lines tl JOIN products p ON p.id = tl.product_id
        WHERE tl.transfer_id = wt.id
      ) l) AS lines
    FROM wh_transfers wt
    JOIN warehouses fw ON fw.id = wt.from_warehouse_id
    JOIN warehouses tw ON tw.id = wt.to_warehouse_id
    LEFT JOIN pos_branches fb ON fb.id = fw.branch_id
    LEFT JOIN pos_branches tb ON tb.id = tw.branch_id
    WHERE wt.company_id = ${companyId}
    ORDER BY wt.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/transfers", async (req: Request, res: Response) => {
  const { fromWarehouseId, toWarehouseId, note, lines } = req.body as {
    fromWarehouseId: number; toWarehouseId: number; note?: string;
    lines: { productId: number; fromRackId?: number | null; toRackId?: number | null; qtyRequested: number }[];
  };
  if (!fromWarehouseId || !toWarehouseId || !lines?.length) {
    res.status(400).json({ message: "fromWarehouseId, toWarehouseId, lines wajib diisi" }); return;
  }
  const companyId = resolveCompanyId(req);
  const transferNumber = makeDocNumber("TRF");
  const tr = await db.execute(sql`
    INSERT INTO wh_transfers (company_id, transfer_number, from_warehouse_id, to_warehouse_id, note)
    VALUES (${companyId}, ${transferNumber}, ${fromWarehouseId}, ${toWarehouseId}, ${note ?? null})
    RETURNING *
  `);
  const transferId = (tr.rows[0] as any).id;
  for (const line of lines) {
    await db.execute(sql`
      INSERT INTO wh_transfer_lines (transfer_id, product_id, from_rack_id, to_rack_id, qty_requested)
      VALUES (${transferId}, ${line.productId}, ${line.fromRackId ?? null}, ${line.toRackId ?? null}, ${line.qtyRequested})
    `);
  }
  res.status(201).json({ ...tr.rows[0], lines });
});

router.post("/transfers/:id/action", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { action } = req.body as { action: string };
  const tr = await db.execute(sql`SELECT * FROM wh_transfers WHERE id = ${id}`);
  const transfer = tr.rows[0] as any;
  if (!transfer) { res.status(404).json({ message: "Transfer tidak ditemukan" }); return; }

  if (action === "send") {
    const lines = await db.execute(sql`SELECT * FROM wh_transfer_lines WHERE transfer_id = ${id}`);
    for (const line of lines.rows as any[]) {
      const cur = await db.execute(sql`
        SELECT qty::float FROM wh_stock
        WHERE product_id = ${line.product_id} AND warehouse_id = ${transfer.from_warehouse_id}
        AND (rack_id = ${line.from_rack_id ?? null} OR (rack_id IS NULL AND ${line.from_rack_id ?? null} IS NULL))
      `);
      const qtyBefore = Number(cur.rows[0]?.qty ?? 0);
      const qtyAfter = qtyBefore - Number(line.qty_requested);
      await db.execute(sql`
        INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
        VALUES (${line.product_id}, ${transfer.from_warehouse_id}, ${line.from_rack_id ?? null}, ${qtyAfter}, NOW())
        ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
        DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
      `);
      await db.execute(sql`
        INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
        VALUES (${line.product_id}, ${transfer.from_warehouse_id}, ${line.from_rack_id ?? null},
                'transfer_out', ${line.qty_requested}, ${qtyBefore}, ${qtyAfter},
                'wh_transfer', ${id}, 'Transfer keluar ke gudang tujuan')
      `);
      await db.execute(sql`UPDATE wh_transfer_lines SET qty_sent = qty_requested WHERE id = ${line.id}`);
    }
    await db.execute(sql`UPDATE wh_transfers SET status = 'in_transit', sent_at = NOW() WHERE id = ${id}`);

  } else if (action === "receive") {
    const lines = await db.execute(sql`SELECT * FROM wh_transfer_lines WHERE transfer_id = ${id}`);
    for (const line of lines.rows as any[]) {
      const qtyToReceive = Number(line.qty_sent ?? line.qty_requested);
      const cur = await db.execute(sql`
        SELECT qty::float FROM wh_stock
        WHERE product_id = ${line.product_id} AND warehouse_id = ${transfer.to_warehouse_id}
        AND (rack_id = ${line.to_rack_id ?? null} OR (rack_id IS NULL AND ${line.to_rack_id ?? null} IS NULL))
      `);
      const qtyBefore = Number(cur.rows[0]?.qty ?? 0);
      const qtyAfter = qtyBefore + qtyToReceive;
      await db.execute(sql`
        INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
        VALUES (${line.product_id}, ${transfer.to_warehouse_id}, ${line.to_rack_id ?? null}, ${qtyAfter}, NOW())
        ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
        DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
      `);
      await db.execute(sql`
        INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
        VALUES (${line.product_id}, ${transfer.to_warehouse_id}, ${line.to_rack_id ?? null},
                'transfer_in', ${qtyToReceive}, ${qtyBefore}, ${qtyAfter},
                'wh_transfer', ${id}, 'Transfer masuk dari gudang sumber')
      `);
      await db.execute(sql`UPDATE wh_transfer_lines SET qty_received = ${qtyToReceive} WHERE id = ${line.id}`);
    }
    await db.execute(sql`UPDATE wh_transfers SET status = 'received', received_at = NOW() WHERE id = ${id}`);

    try {
      const transferLines = await db.execute(sql`
        SELECT tl.product_id, tl.qty_sent, p.name AS product_name,
               ws_from.cost_price AS cost_price
        FROM wh_transfer_lines tl
        JOIN products p ON p.id = tl.product_id
        LEFT JOIN wh_stock ws_from ON ws_from.product_id = tl.product_id
          AND ws_from.warehouse_id = ${transfer.from_warehouse_id}
        WHERE tl.transfer_id = ${id}
      `);
      const companyResult = await db.execute(sql`
        SELECT company_id FROM warehouses WHERE id = ${transfer.from_warehouse_id} LIMIT 1
      `);
      const companyId = (companyResult.rows[0] as any)?.company_id ?? null;
      const transferItems = (transferLines.rows as any[]).map((r) => ({
        productId: r.product_id as number,
        productName: r.product_name as string,
        qty: Number(r.qty_sent ?? 0),
        costPrice: Number(r.cost_price ?? 0),
      })).filter((i) => i.qty > 0 && i.costPrice > 0);
      if (transferItems.length > 0) {
        await postWarehouseTransfer({
          transferId: id,
          fromWarehouseId: transfer.from_warehouse_id,
          toWarehouseId: transfer.to_warehouse_id,
          items: transferItems,
          companyId,
        }).catch((e) => console.error("[transfer accounting]", e));
      }
    } catch (e) { console.error("[transfer accounting]", e); }

  } else if (action === "cancel") {
    if (transfer.status !== "draft") {
      res.status(400).json({ message: "Hanya transfer draft yang bisa dibatalkan" }); return;
    }
    await db.execute(sql`UPDATE wh_transfers SET status = 'cancelled', cancelled_at = NOW() WHERE id = ${id}`);
  } else {
    res.status(400).json({ message: "Action tidak valid: send | receive | cancel" }); return;
  }

  const updated = await db.execute(sql`SELECT * FROM wh_transfers WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ── DAMAGE REPORTS ────────────────────────────────────────────────────────────

router.get("/damage", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      dr.*,
      w.warehouse_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT dl.*, dl.qty::float, p.name AS product_name, p.sku, p.unit
        FROM wh_damage_lines dl JOIN products p ON p.id = dl.product_id
        WHERE dl.report_id = dr.id
      ) l) AS lines
    FROM wh_damage_reports dr
    JOIN warehouses w ON w.id = dr.warehouse_id
    ORDER BY dr.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/damage", async (req: Request, res: Response) => {
  const { warehouseId, note, lines } = req.body as {
    warehouseId: number; note?: string;
    lines: { productId: number; rackId?: number | null; qty: number; damageType?: string; note?: string }[];
  };
  if (!warehouseId || !lines?.length) {
    res.status(400).json({ message: "warehouseId, lines wajib diisi" }); return;
  }
  const reportNumber = makeDocNumber("DMG");
  const dr = await db.execute(sql`
    INSERT INTO wh_damage_reports (report_number, warehouse_id, note)
    VALUES (${reportNumber}, ${warehouseId}, ${note ?? null})
    RETURNING *
  `);
  const reportId = (dr.rows[0] as any).id;
  for (const line of lines) {
    await db.execute(sql`
      INSERT INTO wh_damage_lines (report_id, product_id, rack_id, qty, damage_type, note)
      VALUES (${reportId}, ${line.productId}, ${line.rackId ?? null}, ${line.qty},
              ${line.damageType ?? "rusak"}, ${line.note ?? null})
    `);
  }
  res.status(201).json(dr.rows[0]);
});

router.post("/damage/:id/confirm", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const dr = await db.execute(sql`SELECT * FROM wh_damage_reports WHERE id = ${id}`);
  const report = dr.rows[0] as any;
  if (!report) { res.status(404).json({ message: "Laporan tidak ditemukan" }); return; }
  if (report.status !== "draft") { res.status(400).json({ message: "Hanya draft yang bisa dikonfirmasi" }); return; }

  const lines = await db.execute(sql`SELECT * FROM wh_damage_lines WHERE report_id = ${id}`);
  for (const line of lines.rows as any[]) {
    const cur = await db.execute(sql`
      SELECT qty::float FROM wh_stock
      WHERE product_id = ${line.product_id} AND warehouse_id = ${report.warehouse_id}
      AND (rack_id = ${line.rack_id ?? null} OR (rack_id IS NULL AND ${line.rack_id ?? null} IS NULL))
    `);
    const qtyBefore = Number(cur.rows[0]?.qty ?? 0);
    const qtyAfter = Math.max(0, qtyBefore - Number(line.qty));
    await db.execute(sql`
      INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
      VALUES (${line.product_id}, ${report.warehouse_id}, ${line.rack_id ?? null}, ${qtyAfter}, NOW())
      ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
      DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
      VALUES (${line.product_id}, ${report.warehouse_id}, ${line.rack_id ?? null},
              'damage', ${line.qty}, ${qtyBefore}, ${qtyAfter},
              'wh_damage', ${id}, ${`${line.damage_type}: ${report.note ?? ""}`})
    `);
  }
  await db.execute(sql`UPDATE wh_damage_reports SET status = 'confirmed', confirmed_at = NOW() WHERE id = ${id}`);

  try {
    const valuation = await db.execute(sql`
      SELECT COALESCE(SUM(dl.qty::numeric * COALESCE(ws.cost_price::numeric, 0)), 0) AS total_value
      FROM wh_damage_lines dl
      LEFT JOIN wh_stock ws
        ON ws.product_id = dl.product_id
        AND ws.warehouse_id = ${report.warehouse_id}
        AND (ws.rack_id = dl.rack_id OR (ws.rack_id IS NULL AND dl.rack_id IS NULL))
      WHERE dl.report_id = ${id}
    `);
    const totalValue = Number((valuation.rows[0] as any)?.total_value ?? 0);
    if (totalValue > 0) {
      await postDamageJournal({
        damageReportId: id,
        reportNumber: report.report_number as string,
        totalValue,
        createdById: null,
      });
    }
  } catch (e) { console.error("[damage accounting]", e); }

  const updated = await db.execute(sql`SELECT * FROM wh_damage_reports WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ── RETURNS ───────────────────────────────────────────────────────────────────

router.get("/returns", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      wr.*,
      w.warehouse_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT rl.*, rl.qty::float, rl.unit_cost::float, p.name AS product_name, p.sku, p.unit
        FROM wh_return_lines rl JOIN products p ON p.id = rl.product_id
        WHERE rl.return_id = wr.id
      ) l) AS lines
    FROM wh_returns wr
    JOIN warehouses w ON w.id = wr.warehouse_id
    ORDER BY wr.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/returns", async (req: Request, res: Response) => {
  const { type, refDocId, refDocNumber, warehouseId, note, lines } = req.body as {
    type: "purchase" | "sales"; refDocId?: number; refDocNumber?: string;
    warehouseId: number; note?: string;
    lines: { productId: number; rackId?: number | null; qty: number; unitCost?: number; note?: string }[];
  };
  if (!type || !warehouseId || !lines?.length) {
    res.status(400).json({ message: "type, warehouseId, lines wajib diisi" }); return;
  }
  const prefix = type === "purchase" ? "RTP" : "RTS";
  const returnNumber = makeDocNumber(prefix);
  const ret = await db.execute(sql`
    INSERT INTO wh_returns (return_number, type, ref_doc_id, ref_doc_number, warehouse_id, note)
    VALUES (${returnNumber}, ${type}, ${refDocId ?? null}, ${refDocNumber ?? null}, ${warehouseId}, ${note ?? null})
    RETURNING *
  `);
  const returnId = (ret.rows[0] as any).id;
  for (const line of lines) {
    await db.execute(sql`
      INSERT INTO wh_return_lines (return_id, product_id, rack_id, qty, unit_cost, note)
      VALUES (${returnId}, ${line.productId}, ${line.rackId ?? null}, ${line.qty}, ${line.unitCost ?? 0}, ${line.note ?? null})
    `);
  }
  res.status(201).json(ret.rows[0]);
});

router.post("/returns/:id/confirm", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ret = await db.execute(sql`SELECT * FROM wh_returns WHERE id = ${id}`);
  const returnDoc = ret.rows[0] as any;
  if (!returnDoc) { res.status(404).json({ message: "Retur tidak ditemukan" }); return; }
  if (returnDoc.status !== "draft") { res.status(400).json({ message: "Hanya draft yang bisa dikonfirmasi" }); return; }

  const lines = await db.execute(sql`SELECT * FROM wh_return_lines WHERE return_id = ${id}`);
  for (const line of lines.rows as any[]) {
    const cur = await db.execute(sql`
      SELECT qty::float FROM wh_stock
      WHERE product_id = ${line.product_id} AND warehouse_id = ${returnDoc.warehouse_id}
      AND (rack_id = ${line.rack_id ?? null} OR (rack_id IS NULL AND ${line.rack_id ?? null} IS NULL))
    `);
    const qtyBefore = Number(cur.rows[0]?.qty ?? 0);
    const delta = returnDoc.type === "sales" ? Number(line.qty) : -Number(line.qty);
    const qtyAfter = qtyBefore + delta;
    await db.execute(sql`
      INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
      VALUES (${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null}, ${qtyAfter}, NOW())
      ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
      DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
    `);
    const mvType = returnDoc.type === "sales" ? "return_in" : "return_out";
    await db.execute(sql`
      INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, ref_type, ref_id)
      VALUES (${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null},
              ${mvType}, ${line.qty}, ${qtyBefore}, ${qtyAfter}, ${line.unit_cost},
              'wh_return', ${id})
    `);
  }
  await db.execute(sql`UPDATE wh_returns SET status = 'confirmed', confirmed_at = NOW() WHERE id = ${id}`);
  const updated = await db.execute(sql`SELECT * FROM wh_returns WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ── RECIPES / BOM ─────────────────────────────────────────────────────────────

router.get("/recipes", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      pr.*,
      p.name AS product_name, p.sku, p.unit,
      (SELECT json_agg(i ORDER BY i.id) FROM (
        SELECT ri.*, ri.qty::float,
               ip.name AS ingredient_name, ip.sku AS ingredient_sku, ip.unit AS ingredient_unit
        FROM product_recipe_items ri
        JOIN products ip ON ip.id = ri.ingredient_product_id
        WHERE ri.recipe_id = pr.id
      ) i) AS items
    FROM product_recipes pr
    JOIN products p ON p.id = pr.product_id
    ORDER BY p.name
  `);
  res.json(rows.rows);
});

router.post("/recipes", async (req: Request, res: Response) => {
  const { productId, yieldQty, yieldUnit, note, items } = req.body as {
    productId: number; yieldQty?: number; yieldUnit?: string; note?: string;
    items: { ingredientProductId: number; qty: number; unit?: string; note?: string }[];
  };
  if (!productId || !items?.length) {
    res.status(400).json({ message: "productId, items wajib diisi" }); return;
  }
  const existing = await db.execute(sql`SELECT id FROM product_recipes WHERE product_id = ${productId}`);
  let recipeId: number;
  if (existing.rows.length > 0) {
    recipeId = (existing.rows[0] as any).id;
    await db.execute(sql`
      UPDATE product_recipes
      SET yield_qty = ${yieldQty ?? 1}, yield_unit = ${yieldUnit ?? "pcs"},
          note = ${note ?? null}, updated_at = NOW()
      WHERE id = ${recipeId}
    `);
    await db.execute(sql`DELETE FROM product_recipe_items WHERE recipe_id = ${recipeId}`);
  } else {
    const nr = await db.execute(sql`
      INSERT INTO product_recipes (product_id, yield_qty, yield_unit, note)
      VALUES (${productId}, ${yieldQty ?? 1}, ${yieldUnit ?? "pcs"}, ${note ?? null})
      RETURNING id
    `);
    recipeId = (nr.rows[0] as any).id;
  }
  for (const item of items) {
    await db.execute(sql`
      INSERT INTO product_recipe_items (recipe_id, ingredient_product_id, qty, unit, note)
      VALUES (${recipeId}, ${item.ingredientProductId}, ${item.qty}, ${item.unit ?? "pcs"}, ${item.note ?? null})
    `);
  }
  const result = await db.execute(sql`
    SELECT pr.*, p.name AS product_name,
      (SELECT json_agg(i) FROM (
        SELECT ri.*, ri.qty::float, ip.name AS ingredient_name, ip.unit AS ingredient_unit
        FROM product_recipe_items ri JOIN products ip ON ip.id = ri.ingredient_product_id
        WHERE ri.recipe_id = pr.id
      ) i) AS items
    FROM product_recipes pr JOIN products p ON p.id = pr.product_id
    WHERE pr.id = ${recipeId}
  `);
  res.status(201).json(result.rows[0]);
});

router.delete("/recipes/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await db.execute(sql`DELETE FROM product_recipes WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── OPNAMES ───────────────────────────────────────────────────────────────────

router.get("/opnames", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT
      wo.*,
      w.warehouse_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT ol.*, ol.system_qty::float, ol.actual_qty::float, ol.diff_qty::float,
               p.name AS product_name, p.sku, p.unit
        FROM wh_opname_lines ol JOIN products p ON p.id = ol.product_id
        WHERE ol.opname_id = wo.id
      ) l) AS lines
    FROM wh_opnames wo
    JOIN warehouses w ON w.id = wo.warehouse_id
    ORDER BY wo.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/opnames", async (req: Request, res: Response) => {
  const { warehouseId, note } = req.body as { warehouseId: number; note?: string };
  if (!warehouseId) { res.status(400).json({ message: "warehouseId wajib diisi" }); return; }
  const opnameNumber = makeDocNumber("OPN");
  const stock = await db.execute(sql`
    SELECT ws.product_id, ws.rack_id, ws.qty::float
    FROM wh_stock ws WHERE ws.warehouse_id = ${warehouseId}
  `);
  const opn = await db.execute(sql`
    INSERT INTO wh_opnames (opname_number, warehouse_id, note)
    VALUES (${opnameNumber}, ${warehouseId}, ${note ?? null})
    RETURNING *
  `);
  const opnameId = (opn.rows[0] as any).id;
  for (const s of stock.rows as any[]) {
    await db.execute(sql`
      INSERT INTO wh_opname_lines (opname_id, product_id, rack_id, system_qty, actual_qty, diff_qty)
      VALUES (${opnameId}, ${s.product_id}, ${s.rack_id ?? null}, ${s.qty}, ${s.qty}, 0)
    `);
  }
  res.status(201).json(opn.rows[0]);
});

router.put("/opnames/:id/lines/:lineId", async (req: Request, res: Response) => {
  const lineId = Number(req.params.lineId);
  const { actualQty } = req.body as { actualQty: number };
  await db.execute(sql`
    UPDATE wh_opname_lines
    SET actual_qty = ${actualQty}, diff_qty = ${actualQty} - system_qty
    WHERE id = ${lineId}
  `);
  const updated = await db.execute(sql`SELECT * FROM wh_opname_lines WHERE id = ${lineId}`);
  res.json(updated.rows[0]);
});

router.post("/opnames/:id/confirm", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const opn = await db.execute(sql`SELECT * FROM wh_opnames WHERE id = ${id}`);
  const opname = opn.rows[0] as any;
  if (!opname) { res.status(404).json({ message: "Opname tidak ditemukan" }); return; }
  if (opname.status !== "draft") { res.status(400).json({ message: "Hanya draft yang bisa dikonfirmasi" }); return; }

  const lines = await db.execute(sql`SELECT * FROM wh_opname_lines WHERE opname_id = ${id} AND diff_qty != 0`);
  for (const line of lines.rows as any[]) {
    const newQty = Number(line.actual_qty);
    await db.execute(sql`
      INSERT INTO wh_stock (product_id, warehouse_id, rack_id, qty, updated_at)
      VALUES (${line.product_id}, ${opname.warehouse_id}, ${line.rack_id ?? null}, ${newQty}, NOW())
      ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
      DO UPDATE SET qty = ${newQty}, updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO wh_movements (product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
      VALUES (${line.product_id}, ${opname.warehouse_id}, ${line.rack_id ?? null},
              'opname_adjust', ${Math.abs(Number(line.diff_qty))},
              ${Number(line.system_qty)}, ${newQty},
              'wh_opname', ${id}, 'Penyesuaian stok opname')
    `);
  }
  await db.execute(sql`UPDATE wh_opnames SET status = 'confirmed', confirmed_at = NOW() WHERE id = ${id}`);

  try {
    const costRows = await db.execute(sql`
      SELECT ol.diff_qty::float, COALESCE(ws.cost_price::float, p.cost_price::float, 0) AS cost_price
      FROM wh_opname_lines ol
      LEFT JOIN wh_stock ws ON ws.product_id = ol.product_id AND ws.warehouse_id = ${opname.warehouse_id} AND ws.rack_id IS NOT DISTINCT FROM ol.rack_id
      LEFT JOIN products p ON p.id = ol.product_id
      WHERE ol.opname_id = ${id} AND ol.diff_qty != 0
    `);
    const totalDiffAmount = (costRows.rows as Array<{ diff_qty: number; cost_price: number }>)
      .reduce((sum, r) => sum + r.diff_qty * (r.cost_price ?? 0), 0);
    if (Math.abs(totalDiffAmount) > 0.01) {
      postOpnameAdjust({
        opnameId: id,
        opnameNumber: String(opname.opname_number),
        diffAmount: totalDiffAmount,
      }).catch((e) => console.error("[accounting] postOpnameAdjust error:", e));
    }
  } catch (e) {
    console.error("[accounting] opname adjust calc error:", e);
  }

  const updated = await db.execute(sql`SELECT * FROM wh_opnames WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ── WAREHOUSES (unified ERP warehouses) ──────────────────────────────────────

router.get("/warehouses", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`
    SELECT w.id, w.warehouse_code, w.warehouse_name, w.warehouse_type, w.is_active,
           w.company_id, w.branch_id, w.address,
           pb.name AS branch_name
    FROM warehouses w
    LEFT JOIN pos_branches pb ON pb.id = w.branch_id
    WHERE w.is_active = TRUE
    ORDER BY pb.name, w.warehouse_name
  `);
  res.json(rows.rows);
});

router.get("/branches", async (_req: Request, res: Response) => {
  const rows = await db.execute(sql`SELECT * FROM pos_branches WHERE is_active = TRUE ORDER BY name`);
  res.json(rows.rows);
});

export default router;

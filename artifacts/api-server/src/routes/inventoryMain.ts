/**
 * /api/inventory — Inventory Module (berbasis cabang & gudang)
 *
 * Aturan akses:
 * - Semua user BizPortal internal bisa membaca stok
 * - Kasir TIDAK bisa POST /stock/adjust (manual edit)
 * - Perubahan stok hanya lewat movement (transfer, return, damage, opname, adjust)
 * - company_id wajib di semua query
 * - branch scoping: admin/owner/manager lihat semua; gudang/kasir lihat cabangnya
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { postOpnameAdjust, postDamageJournal, postWarehouseTransfer } from "../lib/accounting.js";
import { auditFromReq } from "../lib/auditLog.js";
import { assertNotKasir } from "../lib/securityValidation.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

function makeDocNumber(prefix: string): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const ms = now.getTime().toString().slice(-5);
  return `${prefix}/${y}${m}${d}/${ms}`;
}

function getUserRole(req: Request): string {
  return (req.user as { role?: string | null })?.role ?? "";
}

function isKasir(req: Request): boolean {
  return getUserRole(req) === "kasir";
}

function canSeeAllBranches(req: Request): boolean {
  const role = getUserRole(req);
  return ["admin", "owner", "manager"].includes(role);
}

// Resolve branchId dari query param atau user's warehouse assignment
function resolveBranchFilter(req: Request): number | null {
  if (req.query.branchId) return Number(req.query.branchId);
  return null;
}

// ── WAREHOUSES ────────────────────────────────────────────────────────────────

router.get("/warehouses", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchFilter(req);
  const rows = await db.execute(sql`
    SELECT
      w.id, w.warehouse_code, w.warehouse_name, w.warehouse_type,
      w.branch_id, w.address, w.is_active, w.created_at, w.updated_at,
      b.name AS branch_name, b.code AS branch_code
    FROM warehouses w
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE w.company_id = ${companyId}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    ORDER BY b.name, w.warehouse_name
  `);
  res.json(rows.rows);
});

router.post("/warehouses", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengelola gudang" }); return; }
  const companyId = resolveCompanyId(req);
  const { warehouseCode, warehouseName, warehouseType, branchId, address } = req.body as {
    warehouseCode: string; warehouseName: string;
    warehouseType?: string; branchId?: number | null; address?: string;
  };
  if (!warehouseCode || !warehouseName) {
    res.status(400).json({ message: "warehouseCode dan warehouseName wajib diisi" }); return;
  }
  const r = await db.execute(sql`
    INSERT INTO warehouses (company_id, warehouse_code, warehouse_name, warehouse_type, branch_id, address)
    VALUES (${companyId}, ${warehouseCode.toUpperCase()}, ${warehouseName},
            ${(warehouseType ?? "BRANCH")}::warehouse_type,
            ${branchId ?? null}, ${address ?? null})
    RETURNING *
  `);
  res.status(201).json(r.rows[0]);
});

router.put("/warehouses/:id", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengelola gudang" }); return; }
  const id = Number(req.params.id);
  const { warehouseName, warehouseType, branchId, address, isActive } = req.body as {
    warehouseName?: string; warehouseType?: string;
    branchId?: number | null; address?: string; isActive?: boolean;
  };
  await db.execute(sql`
    UPDATE warehouses SET
      warehouse_name = COALESCE(${warehouseName ?? null}, warehouse_name),
      warehouse_type = COALESCE(${warehouseType ?? null}::warehouse_type, warehouse_type),
      branch_id      = ${branchId ?? null},
      address        = COALESCE(${address ?? null}, address),
      is_active      = COALESCE(${isActive ?? null}, is_active),
      updated_at     = NOW()
    WHERE id = ${id}
  `);
  const r = await db.execute(sql`
    SELECT w.*, b.name AS branch_name FROM warehouses w
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE w.id = ${id}
  `);
  res.json(r.rows[0]);
});

// ── RACKS ─────────────────────────────────────────────────────────────────────

router.get("/racks", async (req: Request, res: Response) => {
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT wr.*, w.warehouse_name, w.warehouse_code, b.name AS branch_name
    FROM warehouse_racks wr
    JOIN warehouses w ON w.id = wr.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE w.company_id = ${companyId}
      AND wr.is_active = TRUE
      ${warehouseId ? sql`AND wr.warehouse_id = ${warehouseId}` : sql``}
    ORDER BY b.name, w.warehouse_name, wr.rack_code
  `);
  res.json(rows.rows);
});

router.post("/racks", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengelola rak" }); return; }
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
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengelola rak" }); return; }
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

router.delete("/racks/:id", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh menghapus rak" }); return; }
  const id = Number(req.params.id);
  await db.execute(sql`UPDATE warehouse_racks SET is_active = FALSE WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── STOCK ─────────────────────────────────────────────────────────────────────

router.get("/stock", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const branchId = resolveBranchFilter(req);
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const rows = await db.execute(sql`
    SELECT
      ws.id, ws.product_id, ws.warehouse_id, ws.rack_id,
      ws.qty::float, ws.cost_price::float, ws.updated_at,
      p.name AS product_name, p.sku, p.unit,
      w.warehouse_name, w.warehouse_code, w.warehouse_type,
      b.id AS branch_id, b.name AS branch_name, b.code AS branch_code,
      wr.rack_code, wr.rack_name, wr.zone
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    LEFT JOIN warehouse_racks wr ON wr.id = ws.rack_id
    WHERE ws.company_id = ${companyId}
      ${warehouseId ? sql`AND ws.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${productId ? sql`AND ws.product_id = ${productId}` : sql``}
    ORDER BY b.name, w.warehouse_name, p.name
  `);
  res.json(rows.rows);
});

router.get("/stock/summary", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchFilter(req);
  const rows = await db.execute(sql`
    SELECT
      ws.product_id,
      p.name AS product_name, p.sku, p.unit,
      SUM(ws.qty)::float AS total_qty,
      AVG(ws.cost_price)::float AS avg_cost_price,
      SUM(ws.qty * ws.cost_price)::float AS total_value,
      COUNT(DISTINCT ws.warehouse_id) AS warehouse_count,
      BOOL_OR(ws.qty <= 0) AS has_zero
    FROM wh_stock ws
    JOIN products p ON p.id = ws.product_id
    JOIN warehouses w ON w.id = ws.warehouse_id
    WHERE ws.company_id = ${companyId}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    GROUP BY ws.product_id, p.name, p.sku, p.unit
    ORDER BY p.name
  `);
  res.json(rows.rows);
});

router.post("/stock/adjust", async (req: Request, res: Response) => {
  if (isKasir(req)) {
    res.status(403).json({ message: "Kasir tidak boleh melakukan penyesuaian stok manual" }); return;
  }
  const { productId, warehouseId, rackId, qty, costPrice, note } = req.body as {
    productId: number; warehouseId: number; rackId?: number | null;
    qty: number; costPrice?: number; note?: string;
  };
  if (!productId || !warehouseId || qty === undefined) {
    res.status(400).json({ message: "productId, warehouseId, qty wajib diisi" }); return;
  }
  const companyId = resolveCompanyId(req);
  const rack = rackId ?? null;
  const cur = await db.execute(sql`
    SELECT qty::float FROM wh_stock
    WHERE product_id = ${productId} AND warehouse_id = ${warehouseId}
    AND (rack_id = ${rack}::int OR (rack_id IS NULL AND ${rack}::int IS NULL))
  `);
  const qtyBefore = Number(cur.rows[0]?.qty ?? 0);
  const qtyAfter = qtyBefore + qty;
  await db.execute(sql`
    INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, cost_price, updated_at)
    VALUES (${companyId}, ${productId}, ${warehouseId}, ${rack}, ${qtyAfter}, ${costPrice ?? 0}, NOW())
    ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
    DO UPDATE SET qty = ${qtyAfter},
      cost_price = COALESCE(NULLIF(${costPrice ?? null}, 0), wh_stock.cost_price),
      updated_at = NOW()
  `);
  const type = qty >= 0 ? "manual_in" : "manual_out";
  const createdById = (req.user as { id?: string })?.id ?? null;
  await db.execute(sql`
    INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, note, created_by_id)
    VALUES (${companyId}, ${productId}, ${warehouseId}, ${rack}, ${type}, ${Math.abs(qty)}, ${qtyBefore}, ${qtyAfter}, ${costPrice ?? 0}, ${note ?? null}, ${createdById})
  `);
  auditFromReq(req, {
    action: "adjust",
    module: "stock",
    branchId: null,
    referenceId: `product-${productId}/warehouse-${warehouseId}`,
    oldData: { qty: qtyBefore },
    newData: { qty: qtyAfter, note, warehouseId, productId },
  });
  res.json({ ok: true, qtyBefore, qtyAfter });
});

// ── MOVEMENTS ─────────────────────────────────────────────────────────────────

router.get("/movements", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const warehouseId = req.query.warehouseId ? Number(req.query.warehouseId) : null;
  const productId = req.query.productId ? Number(req.query.productId) : null;
  const branchId = resolveBranchFilter(req);
  const typeFilter = req.query.type as string | undefined;
  const limit = Math.min(Number(req.query.limit ?? 300), 1000);
  const rows = await db.execute(sql`
    SELECT
      wm.id, wm.type, wm.qty::float, wm.qty_before::float, wm.qty_after::float,
      wm.cost_price::float, wm.ref_type, wm.ref_id, wm.note, wm.created_at, wm.created_by_id,
      p.name AS product_name, p.sku, p.unit,
      w.warehouse_name, w.warehouse_code,
      b.name AS branch_name,
      wr.rack_code, wr.rack_name
    FROM wh_movements wm
    JOIN products p ON p.id = wm.product_id
    JOIN warehouses w ON w.id = wm.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    LEFT JOIN warehouse_racks wr ON wr.id = wm.rack_id
    WHERE wm.company_id = ${companyId}
      ${warehouseId ? sql`AND wm.warehouse_id = ${warehouseId}` : sql``}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
      ${productId ? sql`AND wm.product_id = ${productId}` : sql``}
      ${typeFilter ? sql`AND wm.type = ${typeFilter}` : sql``}
    ORDER BY wm.created_at DESC
    LIMIT ${limit}
  `);
  res.json(rows.rows);
});

// ── TRANSFERS ─────────────────────────────────────────────────────────────────

router.get("/transfers", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchFilter(req);
  const rows = await db.execute(sql`
    SELECT
      wt.*,
      fw.warehouse_name AS from_warehouse_name, fw.warehouse_code AS from_warehouse_code,
      tw.warehouse_name AS to_warehouse_name, tw.warehouse_code AS to_warehouse_code,
      fb.id AS from_branch_id, fb.name AS from_branch_name,
      tb.id AS to_branch_id, tb.name AS to_branch_name,
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
      ${branchId ? sql`AND (fw.branch_id = ${branchId} OR tw.branch_id = ${branchId})` : sql``}
    ORDER BY wt.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/transfers", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh membuat transfer stok" }); return; }
  const { fromWarehouseId, toWarehouseId, note, lines } = req.body as {
    fromWarehouseId: number; toWarehouseId: number; note?: string;
    lines: { productId: number; fromRackId?: number | null; toRackId?: number | null; qtyRequested: number }[];
  };
  if (!fromWarehouseId || !toWarehouseId || !lines?.length) {
    res.status(400).json({ message: "fromWarehouseId, toWarehouseId, lines wajib diisi" }); return;
  }
  const companyId = resolveCompanyId(req);
  const createdById = (req.user as { id?: string })?.id ?? null;
  const transferNumber = makeDocNumber("TRF");
  const tr = await db.execute(sql`
    INSERT INTO wh_transfers (company_id, transfer_number, from_warehouse_id, to_warehouse_id, note, created_by_id)
    VALUES (${companyId}, ${transferNumber}, ${fromWarehouseId}, ${toWarehouseId}, ${note ?? null}, ${createdById})
    RETURNING *
  `);
  const transferId = (tr.rows[0] as any).id;
  for (const line of lines) {
    await db.execute(sql`
      INSERT INTO wh_transfer_lines (transfer_id, product_id, from_rack_id, to_rack_id, qty_requested)
      VALUES (${transferId}, ${line.productId}, ${line.fromRackId ?? null}, ${line.toRackId ?? null}, ${line.qtyRequested})
    `);
  }
  const newTransfer = tr.rows[0] as { transfer_number?: string };
  auditFromReq(req, {
    action: "create",
    module: "transfer",
    referenceId: newTransfer?.transfer_number ?? String(transferId),
    newData: { fromWarehouseId, toWarehouseId, note, lineCount: lines.length },
  });
  res.status(201).json({ ...tr.rows[0], lines });
});

router.post("/transfers/:id/action", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh memproses transfer" }); return; }
  const id = Number(req.params.id);
  const { action } = req.body as { action: string };
  const tr = await db.execute(sql`SELECT * FROM wh_transfers WHERE id = ${id}`);
  const transfer = tr.rows[0] as any;
  if (!transfer) { res.status(404).json({ message: "Transfer tidak ditemukan" }); return; }

  const companyId = resolveCompanyId(req);

  if (action === "send") {
    if (transfer.status !== "draft") { res.status(400).json({ message: "Hanya transfer draft yang bisa dikirim" }); return; }
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
        INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, updated_at)
        VALUES (${companyId}, ${line.product_id}, ${transfer.from_warehouse_id}, ${line.from_rack_id ?? null}, ${qtyAfter}, NOW())
        ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
        DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
      `);
      await db.execute(sql`
        INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
        VALUES (${companyId}, ${line.product_id}, ${transfer.from_warehouse_id}, ${line.from_rack_id ?? null},
                'transfer_out', ${line.qty_requested}, ${qtyBefore}, ${qtyAfter},
                'wh_transfer', ${id}, 'Transfer keluar ke gudang tujuan')
      `);
      await db.execute(sql`UPDATE wh_transfer_lines SET qty_sent = qty_requested WHERE id = ${line.id}`);
    }
    await db.execute(sql`UPDATE wh_transfers SET status = 'in_transit', sent_at = NOW() WHERE id = ${id}`);

  } else if (action === "receive") {
    if (transfer.status !== "in_transit") { res.status(400).json({ message: "Hanya transfer in_transit yang bisa diterima" }); return; }
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
        INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, updated_at)
        VALUES (${companyId}, ${line.product_id}, ${transfer.to_warehouse_id}, ${line.to_rack_id ?? null}, ${qtyAfter}, NOW())
        ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
        DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
      `);
      await db.execute(sql`
        INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
        VALUES (${companyId}, ${line.product_id}, ${transfer.to_warehouse_id}, ${line.to_rack_id ?? null},
                'transfer_in', ${qtyToReceive}, ${qtyBefore}, ${qtyAfter},
                'wh_transfer', ${id}, 'Transfer masuk dari gudang sumber')
      `);
      await db.execute(sql`UPDATE wh_transfer_lines SET qty_received = ${qtyToReceive} WHERE id = ${line.id}`);
    }
    await db.execute(sql`UPDATE wh_transfers SET status = 'received', received_at = NOW() WHERE id = ${id}`);
    try {
      const transferLines = await db.execute(sql`
        SELECT tl.product_id, tl.qty_sent, p.name AS product_name, ws_from.cost_price
        FROM wh_transfer_lines tl
        JOIN products p ON p.id = tl.product_id
        LEFT JOIN wh_stock ws_from ON ws_from.product_id = tl.product_id
          AND ws_from.warehouse_id = ${transfer.from_warehouse_id}
        WHERE tl.transfer_id = ${id}
      `);
      const items = (transferLines.rows as any[])
        .map((r) => ({ productId: r.product_id, productName: r.product_name, qty: Number(r.qty_sent ?? 0), costPrice: Number(r.cost_price ?? 0) }))
        .filter((i) => i.qty > 0 && i.costPrice > 0);
      if (items.length > 0) {
        await postWarehouseTransfer({ transferId: id, fromWarehouseId: transfer.from_warehouse_id, toWarehouseId: transfer.to_warehouse_id, items, companyId }).catch(console.error);
      }
    } catch (e) { console.error("[transfer accounting]", e); }

  } else if (action === "cancel") {
    if (transfer.status !== "draft") { res.status(400).json({ message: "Hanya transfer draft yang bisa dibatalkan" }); return; }
    await db.execute(sql`UPDATE wh_transfers SET status = 'cancelled', cancelled_at = NOW() WHERE id = ${id}`);
  } else {
    res.status(400).json({ message: "Action tidak valid: send | receive | cancel" }); return;
  }

  const updated = await db.execute(sql`SELECT * FROM wh_transfers WHERE id = ${id}`);
  auditFromReq(req, {
    action: action as string,
    module: "transfer",
    referenceId: (transfer as { transfer_number?: string }).transfer_number ?? String(id),
    newData: { action, status: (updated.rows[0] as any)?.status },
  });
  res.json(updated.rows[0]);
});

// ── DAMAGE / BARANG RUSAK & HILANG ────────────────────────────────────────────

router.get("/damage", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchFilter(req);
  const rows = await db.execute(sql`
    SELECT
      dr.*,
      w.warehouse_name, w.warehouse_code,
      b.name AS branch_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT dl.*, dl.qty::float, p.name AS product_name, p.sku, p.unit
        FROM wh_damage_lines dl JOIN products p ON p.id = dl.product_id
        WHERE dl.report_id = dr.id
      ) l) AS lines
    FROM wh_damage_reports dr
    JOIN warehouses w ON w.id = dr.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE dr.company_id = ${companyId}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    ORDER BY dr.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/damage", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh membuat laporan kerusakan" }); return; }
  const { warehouseId, note, lines } = req.body as {
    warehouseId: number; note?: string;
    lines: { productId: number; rackId?: number | null; qty: number; damageType?: string; note?: string }[];
  };
  if (!warehouseId || !lines?.length) {
    res.status(400).json({ message: "warehouseId, lines wajib diisi" }); return;
  }
  const companyId = resolveCompanyId(req);
  const createdById = (req.user as { id?: string })?.id ?? null;
  const reportNumber = makeDocNumber("DMG");
  const dr = await db.execute(sql`
    INSERT INTO wh_damage_reports (company_id, report_number, warehouse_id, note, created_by_id)
    VALUES (${companyId}, ${reportNumber}, ${warehouseId}, ${note ?? null}, ${createdById})
    RETURNING *
  `);
  const reportId = (dr.rows[0] as any).id;
  for (const line of lines) {
    await db.execute(sql`
      INSERT INTO wh_damage_lines (report_id, product_id, rack_id, qty, damage_type, note)
      VALUES (${reportId}, ${line.productId}, ${line.rackId ?? null}, ${line.qty},
              ${line.damageType ?? "rusak"}::wh_damage_type, ${line.note ?? null})
    `);
  }
  const newDamage = dr.rows[0] as { report_number?: string };
  auditFromReq(req, {
    action: "create",
    module: "damage",
    referenceId: newDamage?.report_number ?? String(reportId),
    newData: { warehouseId, note, lineCount: lines.length, lines: lines.map((l) => ({ productId: l.productId, qty: l.qty, damageType: l.damageType })) },
  });
  res.status(201).json(dr.rows[0]);
});

router.post("/damage/:id/confirm", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengkonfirmasi laporan kerusakan" }); return; }
  const id = Number(req.params.id);
  const companyId = resolveCompanyId(req);
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
      INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, updated_at)
      VALUES (${companyId}, ${line.product_id}, ${report.warehouse_id}, ${line.rack_id ?? null}, ${qtyAfter}, NOW())
      ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
      DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
      VALUES (${companyId}, ${line.product_id}, ${report.warehouse_id}, ${line.rack_id ?? null},
              'damage', ${line.qty}, ${qtyBefore}, ${qtyAfter},
              'wh_damage', ${id}, ${`${line.damage_type}: ${report.note ?? ""}`})
    `);
  }
  await db.execute(sql`UPDATE wh_damage_reports SET status = 'confirmed', confirmed_at = NOW() WHERE id = ${id}`);
  auditFromReq(req, {
    action: "confirm",
    module: "damage",
    referenceId: (report as { report_number?: string }).report_number ?? String(id),
    newData: { status: "confirmed", warehouseId: report.warehouse_id },
  });
  try {
    const valuation = await db.execute(sql`
      SELECT COALESCE(SUM(dl.qty::numeric * COALESCE(ws.cost_price::numeric, 0)), 0) AS total_value
      FROM wh_damage_lines dl
      LEFT JOIN wh_stock ws ON ws.product_id = dl.product_id AND ws.warehouse_id = ${report.warehouse_id}
        AND (ws.rack_id = dl.rack_id OR (ws.rack_id IS NULL AND dl.rack_id IS NULL))
      WHERE dl.report_id = ${id}
    `);
    const totalValue = Number((valuation.rows[0] as any)?.total_value ?? 0);
    if (totalValue > 0) {
      await postDamageJournal({ damageReportId: id, reportNumber: report.report_number, totalValue, createdById: null });
    }
  } catch (e) { console.error("[damage accounting]", e); }

  const updated = await db.execute(sql`SELECT * FROM wh_damage_reports WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

router.post("/damage/:id/cancel", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const dr = await db.execute(sql`SELECT * FROM wh_damage_reports WHERE id = ${id}`);
  const report = dr.rows[0] as any;
  if (!report) { res.status(404).json({ message: "Laporan tidak ditemukan" }); return; }
  if (report.status !== "draft") { res.status(400).json({ message: "Hanya draft yang bisa dibatalkan" }); return; }
  await db.execute(sql`UPDATE wh_damage_reports SET status = 'cancelled', cancelled_at = NOW() WHERE id = ${id}`);
  res.json({ ok: true });
});

// ── RETURNS / RETUR BARANG ────────────────────────────────────────────────────

router.get("/returns", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchFilter(req);
  const rows = await db.execute(sql`
    SELECT
      wr.*,
      w.warehouse_name, w.warehouse_code,
      b.name AS branch_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT rl.*, rl.qty::float, rl.unit_cost::float, p.name AS product_name, p.sku, p.unit
        FROM wh_return_lines rl JOIN products p ON p.id = rl.product_id
        WHERE rl.return_id = wr.id
      ) l) AS lines
    FROM wh_returns wr
    JOIN warehouses w ON w.id = wr.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE wr.company_id = ${companyId}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    ORDER BY wr.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/returns", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh membuat retur" }); return; }
  const { type, refDocId, refDocNumber, warehouseId, note, lines } = req.body as {
    type: "purchase" | "sales"; refDocId?: number; refDocNumber?: string;
    warehouseId: number; note?: string;
    lines: { productId: number; rackId?: number | null; qty: number; unitCost?: number; condition?: string; note?: string }[];
  };
  if (!type || !warehouseId || !lines?.length) {
    res.status(400).json({ message: "type, warehouseId, lines wajib diisi" }); return;
  }
  const companyId = resolveCompanyId(req);
  const createdById = (req.user as { id?: string })?.id ?? null;
  const prefix = type === "purchase" ? "RTP" : "RTS";
  const returnNumber = makeDocNumber(prefix);
  const ret = await db.execute(sql`
    INSERT INTO wh_returns (company_id, return_number, type, ref_doc_id, ref_doc_number, warehouse_id, note, created_by_id)
    VALUES (${companyId}, ${returnNumber}, ${type}::wh_return_type, ${refDocId ?? null}, ${refDocNumber ?? null}, ${warehouseId}, ${note ?? null}, ${createdById})
    RETURNING *
  `);
  const returnId = (ret.rows[0] as any).id;
  for (const line of lines) {
    const cond = line.condition ?? "layak";
    await db.execute(sql`
      INSERT INTO wh_return_lines (return_id, product_id, rack_id, qty, unit_cost, condition, note)
      VALUES (${returnId}, ${line.productId}, ${line.rackId ?? null}, ${line.qty}, ${line.unitCost ?? 0}, ${cond}, ${line.note ?? null})
    `);
  }
  const newReturn = ret.rows[0] as { return_number?: string };
  auditFromReq(req, {
    action: "create",
    module: "return",
    referenceId: newReturn?.return_number ?? String(returnId),
    newData: { type, warehouseId, refDocNumber, lineCount: lines.length },
  });
  res.status(201).json(ret.rows[0]);
});

router.post("/returns/:id/confirm", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengkonfirmasi retur" }); return; }
  const id = Number(req.params.id);
  const companyId = resolveCompanyId(req);
  const ret = await db.execute(sql`SELECT * FROM wh_returns WHERE id = ${id}`);
  const returnDoc = ret.rows[0] as any;
  if (!returnDoc) { res.status(404).json({ message: "Retur tidak ditemukan" }); return; }
  if (returnDoc.status !== "draft") { res.status(400).json({ message: "Hanya draft yang bisa dikonfirmasi" }); return; }

  const lines = await db.execute(sql`SELECT * FROM wh_return_lines WHERE return_id = ${id}`);
  for (const line of lines.rows as any[]) {
    const condition: string = line.condition ?? "layak";
    const qty = Number(line.qty);

    const cur = await db.execute(sql`
      SELECT qty::float FROM wh_stock
      WHERE product_id = ${line.product_id} AND warehouse_id = ${returnDoc.warehouse_id}
      AND (rack_id = ${line.rack_id ?? null} OR (rack_id IS NULL AND ${line.rack_id ?? null} IS NULL))
    `);
    const qtyBefore = Number(cur.rows[0]?.qty ?? 0);

    if (returnDoc.type === "sales") {
      // Retur dari pelanggan ke gudang
      if (condition === "layak") {
        // Barang bagus → masuk stok
        const qtyAfter = qtyBefore + qty;
        await db.execute(sql`
          INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, updated_at)
          VALUES (${companyId}, ${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null}, ${qtyAfter}, NOW())
          ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
          DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
        `);
        await db.execute(sql`
          INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, ref_type, ref_id, note)
          VALUES (${companyId}, ${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null},
                  'return_in', ${qty}, ${qtyBefore}, ${qtyAfter}, ${line.unit_cost}, 'wh_return', ${id},
                  'Retur penjualan — kondisi layak, masuk stok')
        `);
      } else {
        // Barang rusak/hilang saat retur dari pelanggan → tidak masuk stok, langsung catat sebagai damaged/lost
        // Stok tidak berubah (barang rusak tidak layak disimpan)
        await db.execute(sql`
          INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, ref_type, ref_id, note)
          VALUES (${companyId}, ${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null},
                  'damage', ${qty}, ${qtyBefore}, ${qtyBefore}, ${line.unit_cost}, 'wh_return', ${id},
                  ${'Retur penjualan — kondisi ' + condition + ', tidak masuk stok'})
        `);
      }
    } else {
      // Retur pembelian ke supplier → selalu kurangi stok
      const qtyAfter = Math.max(0, qtyBefore - qty);
      await db.execute(sql`
        INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, updated_at)
        VALUES (${companyId}, ${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null}, ${qtyAfter}, NOW())
        ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
        DO UPDATE SET qty = ${qtyAfter}, updated_at = NOW()
      `);
      const mvNote = condition !== "layak" ? `Retur pembelian — kondisi ${condition}` : "Retur pembelian ke supplier";
      await db.execute(sql`
        INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, cost_price, ref_type, ref_id, note)
        VALUES (${companyId}, ${line.product_id}, ${returnDoc.warehouse_id}, ${line.rack_id ?? null},
                'return_out', ${qty}, ${qtyBefore}, ${qtyAfter}, ${line.unit_cost}, 'wh_return', ${id}, ${mvNote})
      `);
    }
  }
  await db.execute(sql`UPDATE wh_returns SET status = 'confirmed', confirmed_at = NOW() WHERE id = ${id}`);
  auditFromReq(req, {
    action: "confirm",
    module: "return",
    referenceId: (returnDoc as { return_number?: string }).return_number ?? String(id),
    newData: { status: "confirmed", type: returnDoc.type, warehouseId: returnDoc.warehouse_id },
  });
  const updated = await db.execute(sql`SELECT * FROM wh_returns WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ── STOCK OPNAME ──────────────────────────────────────────────────────────────

router.get("/opname", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const branchId = resolveBranchFilter(req);
  const rows = await db.execute(sql`
    SELECT
      wo.*,
      w.warehouse_name, w.warehouse_code,
      b.name AS branch_name,
      (SELECT json_agg(l ORDER BY l.id) FROM (
        SELECT ol.*, ol.system_qty::float, ol.actual_qty::float, ol.diff_qty::float,
               p.name AS product_name, p.sku, p.unit
        FROM wh_opname_lines ol JOIN products p ON p.id = ol.product_id
        WHERE ol.opname_id = wo.id
      ) l) AS lines
    FROM wh_opnames wo
    JOIN warehouses w ON w.id = wo.warehouse_id
    LEFT JOIN pos_branches b ON b.id = w.branch_id
    WHERE wo.company_id = ${companyId}
      ${branchId ? sql`AND w.branch_id = ${branchId}` : sql``}
    ORDER BY wo.created_at DESC
  `);
  res.json(rows.rows);
});

router.post("/opname", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh membuat opname" }); return; }
  const { warehouseId, note } = req.body as { warehouseId: number; note?: string };
  if (!warehouseId) { res.status(400).json({ message: "warehouseId wajib diisi" }); return; }
  const companyId = resolveCompanyId(req);
  const createdById = (req.user as { id?: string })?.id ?? null;
  const opnameNumber = makeDocNumber("OPN");
  const stock = await db.execute(sql`
    SELECT ws.product_id, ws.rack_id, ws.qty::float
    FROM wh_stock ws WHERE ws.warehouse_id = ${warehouseId} AND ws.company_id = ${companyId}
  `);
  const opn = await db.execute(sql`
    INSERT INTO wh_opnames (company_id, opname_number, warehouse_id, note, created_by_id)
    VALUES (${companyId}, ${opnameNumber}, ${warehouseId}, ${note ?? null}, ${createdById})
    RETURNING *
  `);
  const opnameId = (opn.rows[0] as any).id;
  for (const s of stock.rows as any[]) {
    await db.execute(sql`
      INSERT INTO wh_opname_lines (opname_id, product_id, rack_id, system_qty, actual_qty, diff_qty)
      VALUES (${opnameId}, ${s.product_id}, ${s.rack_id ?? null}, ${s.qty}, ${s.qty}, 0)
    `);
  }
  const newOpname = opn.rows[0] as { opname_number?: string };
  auditFromReq(req, {
    action: "create",
    module: "opname",
    referenceId: newOpname?.opname_number ?? String(opnameId),
    newData: { warehouseId, note, lineCount: stock.rows.length },
  });
  res.status(201).json(opn.rows[0]);
});

router.put("/opname/:id/lines/:lineId", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengisi opname" }); return; }
  const lineId = Number(req.params.lineId);
  const { actualQty } = req.body as { actualQty: number };
  await db.execute(sql`
    UPDATE wh_opname_lines
    SET actual_qty = ${actualQty}, diff_qty = ${actualQty} - system_qty
    WHERE id = ${lineId}
  `);
  const updated = await db.execute(sql`SELECT *, system_qty::float, actual_qty::float, diff_qty::float FROM wh_opname_lines WHERE id = ${lineId}`);
  res.json(updated.rows[0]);
});

router.post("/opname/:id/confirm", async (req: Request, res: Response) => {
  if (isKasir(req)) { res.status(403).json({ message: "Kasir tidak boleh mengkonfirmasi opname" }); return; }
  const id = Number(req.params.id);
  const companyId = resolveCompanyId(req);
  const confirmedById = (req.user as { id?: string })?.id ?? null;
  const opn = await db.execute(sql`SELECT * FROM wh_opnames WHERE id = ${id}`);
  const opname = opn.rows[0] as any;
  if (!opname) { res.status(404).json({ message: "Opname tidak ditemukan" }); return; }
  if (opname.status !== "draft") { res.status(400).json({ message: "Hanya draft yang bisa dikonfirmasi" }); return; }

  const lines = await db.execute(sql`SELECT * FROM wh_opname_lines WHERE opname_id = ${id} AND diff_qty != 0`);
  for (const line of lines.rows as any[]) {
    const newQty = Number(line.actual_qty);
    await db.execute(sql`
      INSERT INTO wh_stock (company_id, product_id, warehouse_id, rack_id, qty, updated_at)
      VALUES (${companyId}, ${line.product_id}, ${opname.warehouse_id}, ${line.rack_id ?? null}, ${newQty}, NOW())
      ON CONFLICT ON CONSTRAINT wh_stock_product_warehouse_rack_idx
      DO UPDATE SET qty = ${newQty}, updated_at = NOW()
    `);
    await db.execute(sql`
      INSERT INTO wh_movements (company_id, product_id, warehouse_id, rack_id, type, qty, qty_before, qty_after, ref_type, ref_id, note)
      VALUES (${companyId}, ${line.product_id}, ${opname.warehouse_id}, ${line.rack_id ?? null},
              'opname_adjust', ${Math.abs(Number(line.diff_qty))},
              ${Number(line.system_qty)}, ${newQty},
              'wh_opname', ${id}, 'Penyesuaian stok opname')
    `);
  }
  await db.execute(sql`
    UPDATE wh_opnames SET status = 'confirmed', confirmed_at = NOW(), confirmed_by_id = ${confirmedById}
    WHERE id = ${id}
  `);
  auditFromReq(req, {
    action: "confirm",
    module: "opname",
    referenceId: (opname as { opname_number?: string }).opname_number ?? String(id),
    newData: { status: "confirmed", warehouseId: opname.warehouse_id, linesAdjusted: lines.rows.length },
  });

  try {
    const diffLines = await db.execute(sql`
      SELECT ol.diff_qty::float, COALESCE(ws.cost_price::float, 0) AS cost_price
      FROM wh_opname_lines ol
      LEFT JOIN wh_stock ws ON ws.product_id = ol.product_id AND ws.warehouse_id = ${opname.warehouse_id}
        AND (ws.rack_id = ol.rack_id OR (ws.rack_id IS NULL AND ol.rack_id IS NULL))
      WHERE ol.opname_id = ${id} AND ol.diff_qty != 0
    `);
    const totalValue = (diffLines.rows as any[]).reduce((s, r) => s + Math.abs(Number(r.diff_qty)) * Number(r.cost_price), 0);
    if (totalValue > 0) {
      await postOpnameAdjust({ opnameId: id, opnameNumber: opname.opname_number, diffAmount: totalValue, createdById: null });
    }
  } catch (e) { console.error("[opname accounting]", e); }

  const updated = await db.execute(sql`SELECT * FROM wh_opnames WHERE id = ${id}`);
  res.json(updated.rows[0]);
});

// ── BRANCHES (pos_branches sebagai referensi cabang) ──────────────────────────

router.get("/branches", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql`
    SELECT id, name, code, address, is_active
    FROM pos_branches
    WHERE company_id = ${companyId}
    ORDER BY name
  `);
  res.json(rows.rows);
});

export default router;

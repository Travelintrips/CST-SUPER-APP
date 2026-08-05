/**
 * Core helper: post a stock-in or stock-out movement to inventory_stock + stock_movements.
 * All callers (purchase receive, sales delivery, transfer, etc.) use this.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let _movSeq = 0;
function movementNo(): string {
  const now = new Date();
  const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const ts = now.getTime().toString().slice(-5);
  _movSeq = (_movSeq + 1) % 1000;
  return `MOV/${ymd}/${ts}${String(_movSeq).padStart(3, "0")}`;
}

export interface StockInOptions {
  productId: number;
  warehouseId: number;
  rackId?: number | null;
  qty: number;          // positive
  unitCost: number;
  movementType: string; // inv_movement_type enum value
  referenceType?: string | null;
  referenceId?: number | null;
  notes?: string | null;
  createdBy?: string | null;
}

export interface StockOutOptions {
  productId: number;
  warehouseId: number;
  rackId?: number | null;
  qty: number;          // positive, will be deducted
  unitCost?: number;    // if not provided, use average_cost from stock
  movementType: string;
  referenceType?: string | null;
  referenceId?: number | null;
  notes?: string | null;
  createdBy?: string | null;
  /** If true (default), throw StockShortageError when available stock < qty. Set false to allow negative (legacy). */
  strict?: boolean;
}

export class StockShortageError extends Error {
  constructor(
    public readonly productId: number,
    public readonly requested: number,
    public readonly available: number,
  ) {
    super(`Stok tidak cukup: produk ${productId} tersedia ${available}, diminta ${requested}`);
    this.name = "StockShortageError";
  }
}

/**
 * Stock-IN: adds qty, recalculates weighted average cost, logs movement.
 * Returns { balanceAfter, newAverageCost }.
 */
export async function postStockIn(opts: StockInOptions) {
  const { productId, warehouseId, rackId = null, qty, unitCost, movementType, referenceType = null, referenceId = null, notes = null, createdBy = null } = opts;

  // Get current stock row
  const cur = await db.execute(sql`
    SELECT id, stock_on_hand::float, stock_reserved::float, average_cost::float
    FROM inventory_stock
    WHERE product_id = ${productId}
      AND warehouse_id = ${warehouseId}
      AND (rack_id = ${rackId}::int OR (rack_id IS NULL AND ${rackId}::int IS NULL))
    LIMIT 1
  `);

  const existing = cur.rows[0] as { id: number; stock_on_hand: number; stock_reserved: number; average_cost: number } | undefined;
  const prevQty = Number(existing?.stock_on_hand ?? 0);
  const prevAvgCost = Number(existing?.average_cost ?? 0);

  // Weighted average cost: (prevQty * prevAvgCost + qty * unitCost) / (prevQty + qty)
  const newQty = prevQty + qty;
  const newAvgCost = newQty > 0
    ? (prevQty * prevAvgCost + qty * unitCost) / newQty
    : unitCost;

  const stockAvailable = newQty - Number(existing?.stock_reserved ?? 0);

  // Upsert inventory_stock
  if (existing) {
    await db.execute(sql`
      UPDATE inventory_stock
      SET stock_on_hand = ${newQty},
          stock_available = ${Math.max(0, stockAvailable)},
          average_cost = ${newAvgCost},
          last_updated = NOW()
      WHERE id = ${existing.id}
    `);
  } else {
    // Get unit from products table
    const prod = await db.execute(sql`SELECT unit FROM products WHERE id = ${productId}`);
    const unit = (prod.rows[0] as any)?.unit ?? "pcs";
    await db.execute(sql`
      INSERT INTO inventory_stock
        (product_id, warehouse_id, rack_id, stock_on_hand, stock_reserved, stock_available,
         minimum_stock, unit, average_cost, last_updated)
      VALUES
        (${productId}, ${warehouseId}, ${rackId}, ${newQty}, 0, ${Math.max(0, newQty)},
         0, ${unit}, ${newAvgCost}, NOW())
    `);
  }

  // Log movement
  const mNo = movementNo();
  const totalCost = qty * unitCost;
  await db.execute(sql`
    INSERT INTO stock_movements
      (movement_no, product_id, warehouse_id, rack_id, movement_type,
       reference_type, reference_id,
       qty_in, qty_out, balance_after, unit_cost, total_cost, notes, created_by)
    VALUES
      (${mNo}, ${productId}, ${warehouseId}, ${rackId}, ${movementType}::inv_movement_type,
       ${referenceType}::inv_reference_type, ${referenceId},
       ${qty}, 0, ${newQty}, ${unitCost}, ${totalCost}, ${notes}, ${createdBy})
  `);

  return { balanceAfter: newQty, newAverageCost: newAvgCost };
}

/**
 * Stock-OUT: deducts qty, logs movement.
 * Returns { balanceAfter }.
 */
export async function postStockOut(opts: StockOutOptions) {
  const { productId, warehouseId, rackId = null, qty, movementType, referenceType = null, referenceId = null, notes = null, createdBy = null, strict = true } = opts;

  // Get current stock row
  const cur = await db.execute(sql`
    SELECT id, stock_on_hand::float, stock_reserved::float, average_cost::float
    FROM inventory_stock
    WHERE product_id = ${productId}
      AND warehouse_id = ${warehouseId}
      AND (rack_id = ${rackId}::int OR (rack_id IS NULL AND ${rackId}::int IS NULL))
    LIMIT 1
  `);

  const existing = cur.rows[0] as { id: number; stock_on_hand: number; stock_reserved: number; average_cost: number } | undefined;
  const prevQty = Number(existing?.stock_on_hand ?? 0);
  const available = Math.max(0, prevQty - Number(existing?.stock_reserved ?? 0));
  const avgCost = Number(existing?.average_cost ?? opts.unitCost ?? 0);

  // Strict mode: block if available stock < requested qty
  if (strict && available < qty) {
    throw new StockShortageError(productId, qty, available);
  }

  const newQty = Math.max(0, prevQty - qty);
  const stockAvailable = Math.max(0, newQty - Number(existing?.stock_reserved ?? 0));
  const unitCost = opts.unitCost ?? avgCost;
  const totalCost = qty * unitCost;

  if (existing) {
    await db.execute(sql`
      UPDATE inventory_stock
      SET stock_on_hand = ${newQty},
          stock_available = ${stockAvailable},
          last_updated = NOW()
      WHERE id = ${existing.id}
    `);
  } else {
    const prod = await db.execute(sql`SELECT unit FROM products WHERE id = ${productId}`);
    const unit = (prod.rows[0] as any)?.unit ?? "pcs";
    await db.execute(sql`
      INSERT INTO inventory_stock
        (product_id, warehouse_id, rack_id, stock_on_hand, stock_reserved, stock_available,
         minimum_stock, unit, average_cost, last_updated)
      VALUES (${productId}, ${warehouseId}, ${rackId}, 0, 0, 0, 0, ${unit}, 0, NOW())
    `);
  }

  const mNo = movementNo();
  await db.execute(sql`
    INSERT INTO stock_movements
      (movement_no, product_id, warehouse_id, rack_id, movement_type,
       reference_type, reference_id,
       qty_in, qty_out, balance_after, unit_cost, total_cost, notes, created_by)
    VALUES
      (${mNo}, ${productId}, ${warehouseId}, ${rackId}, ${movementType}::inv_movement_type,
       ${referenceType}::inv_reference_type, ${referenceId},
       0, ${qty}, ${newQty}, ${unitCost}, ${totalCost}, ${notes}, ${createdBy})
  `);

  return { balanceAfter: newQty };
}

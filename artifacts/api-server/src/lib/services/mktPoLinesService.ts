/**
 * mktPoLinesService.ts — Phase 2G.1: PO Line Items (read-only)
 *
 * Public API:
 *   listPoLines(poId)    — returns immutable snapshot lines for a PO
 *   getPoLineCount(poId) — returns count only (lightweight)
 *
 * Security:
 *   - poId is NOT exposed in response (internal join key only)
 *   - No commission, margin, targetPrice, rankScore, vendorScore, companyId,
 *     quoteId, rfqId, createdBy, or any internal note exposed
 *   - lineNumber computed server-side (not stored) — ascending order by id
 */

import { db, mktPurchaseOrderLinesTable } from "@workspace/db";
import { eq, asc, sql } from "drizzle-orm";

export interface PoLineItem {
  id:          number;
  lineNumber:  number;
  itemName:    string;
  description: null;         // not in schema — placeholder for UI compatibility
  qty:         string;
  unit:        string | null;
  unitPrice:   string;
  subtotal:    string;
  notes:       string | null;
  createdAt:   Date;
  updatedAt:   Date;         // immutable — same as createdAt (no update allowed)
}

export async function listPoLines(poId: number): Promise<PoLineItem[]> {
  try {
    const rows = await db
      .select({
        id:        mktPurchaseOrderLinesTable.id,
        itemName:  mktPurchaseOrderLinesTable.itemName,
        qty:       mktPurchaseOrderLinesTable.qty,
        unit:      mktPurchaseOrderLinesTable.unit,
        unitPrice: mktPurchaseOrderLinesTable.unitPrice,
        subtotal:  mktPurchaseOrderLinesTable.subtotal,
        notes:     mktPurchaseOrderLinesTable.notes,
        createdAt: mktPurchaseOrderLinesTable.createdAt,
      })
      .from(mktPurchaseOrderLinesTable)
      .where(eq(mktPurchaseOrderLinesTable.poId, poId))
      .orderBy(asc(mktPurchaseOrderLinesTable.id));

    return rows.map((r, i) => ({
      id:          r.id,
      lineNumber:  i + 1,
      itemName:    r.itemName,
      description: null,
      qty:         r.qty,
      unit:        r.unit,
      unitPrice:   r.unitPrice,
      subtotal:    r.subtotal,
      notes:       r.notes,
      createdAt:   r.createdAt,
      updatedAt:   r.createdAt,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[mktPoLines] listPoLines(poId=${poId}) DB error: ${msg}`);
  }
}

export async function getPoLineCount(poId: number): Promise<number> {
  try {
    const [row] = await db
      .select({ cnt: sql<number>`count(*)::int` })
      .from(mktPurchaseOrderLinesTable)
      .where(eq(mktPurchaseOrderLinesTable.poId, poId));
    return row?.cnt ?? 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[mktPoLines] getPoLineCount(poId=${poId}) DB error: ${msg}`);
  }
}

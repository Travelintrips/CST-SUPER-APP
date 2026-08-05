import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Activity Log — timeline audit trail for each logistic order ────────────────
//
// Every significant lifecycle event (order created, RFQ blasted, vendor confirmed,
// customer approved, SO created, driver status update, POD submitted, etc.) should
// call logActivity(). Failures are NON-FATAL — they log a warning and do not
// block the HTTP response.
//
// actorType values: "admin" | "vendor" | "customer" | "driver" | "system"
//
// action values (canonical):
//   order_created, rfq_blasted, vendor_confirmed, vendor_rejected,
//   vendor_selected, customer_approved, customer_rejected, so_created,
//   shipment_status_updated, pod_submitted, status_changed, details_updated,
//   shipment_type_changed, bulk_status_changed, note_added
//
// Rendered in BizPortal → order-detail.tsx → Timeline Aktivitas section.
// Filtered by: order_id (primary) or rfq_id (for RFQ-scoped events).

export interface LogActivityOptions {
  rfqId?: number | null;
  orderId?: number | null;
  actorType?: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  description?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
  // Marketplace audit trail — Phase 2A (2026-07-02)
  mktRfqId?: number | null;
  mktVendorQuoteId?: number | null;
  mktPurchaseOrderId?: number | null;
}

export async function logActivity(opts: LogActivityOptions): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO activity_logs (
        rfq_id, order_id, actor_type, actor_id, actor_name,
        action, description, old_value, new_value, ip_address,
        mkt_rfq_id, mkt_vendor_quote_id, mkt_purchase_order_id
      )
      VALUES (
        ${opts.rfqId ?? null},
        ${opts.orderId ?? null},
        ${opts.actorType ?? "admin"},
        ${opts.actorId ?? null},
        ${opts.actorName ?? null},
        ${opts.action},
        ${opts.description ?? null},
        ${opts.oldValue != null ? JSON.stringify(opts.oldValue) : null}::jsonb,
        ${opts.newValue != null ? JSON.stringify(opts.newValue) : null}::jsonb,
        ${opts.ipAddress ?? null},
        ${opts.mktRfqId ?? null},
        ${opts.mktVendorQuoteId ?? null},
        ${opts.mktPurchaseOrderId ?? null}
      )
    `);
  } catch (err) {
    // Non-fatal: warn but do not throw — activity log failure must never
    // block the business operation that triggered it.
    logger.warn({ err, action: opts.action }, "logActivity failed — non-fatal");
  }
}

// getActivityLogs — fetch timeline entries for an order or RFQ.
// Used by GET /api/logistic/orders/:id/detail to populate the timeline panel.
export async function getActivityLogs(orderId?: number, rfqId?: number, limit = 50): Promise<unknown[]> {
  try {
    let result;
    if (orderId && rfqId) {
      result = await db.execute(sql`
        SELECT * FROM activity_logs WHERE order_id = ${orderId} OR rfq_id = ${rfqId}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
    } else if (orderId) {
      result = await db.execute(sql`
        SELECT * FROM activity_logs WHERE order_id = ${orderId}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
    } else if (rfqId) {
      result = await db.execute(sql`
        SELECT * FROM activity_logs WHERE rfq_id = ${rfqId}
        ORDER BY created_at DESC LIMIT ${limit}
      `);
    } else {
      result = await db.execute(sql`
        SELECT * FROM activity_logs ORDER BY created_at DESC LIMIT ${limit}
      `);
    }
    return result.rows as unknown[];
  } catch {
    return [];
  }
}

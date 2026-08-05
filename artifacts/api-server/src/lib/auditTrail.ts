import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Audit Trail Helpers ────────────────────────────────────────────────────────
//
// Semua fungsi bersifat NON-FATAL — gagal logging tidak boleh menghentikan
// operasi bisnis yang memicunya. Setiap fungsi catch error dan log warning saja.
//
// Tabel:
//   order_status_history   — setiap perubahan status order (siapa, kapan, lama→baru)
//   order_audit_logs       — semua aktivitas per order (lebih terstruktur dari activity_logs)
//   vendor_quote_history   — event siklus hidup quote vendor per order/rfq
//   customer_approval_history — event approval/rejection customer
// ────────────────────────────────────────────────────────────────────────────────

// ── order_status_history ─────────────────────────────────────────────────────

export interface LogOrderStatusChangeOpts {
  orderId: number;
  orderNumber?: string | null;
  oldStatus?: string | null;
  newStatus: string;
  changedByType?: string;
  changedById?: string | null;
  changedByName?: string | null;
  changedByIp?: string | null;
  notes?: string | null;
  source?: string | null;
}

export async function logOrderStatusChange(opts: LogOrderStatusChangeOpts): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO order_status_history
        (order_id, order_number, old_status, new_status,
         changed_by_type, changed_by_id, changed_by_name, changed_by_ip,
         notes, source)
      VALUES (
        ${opts.orderId},
        ${opts.orderNumber ?? null},
        ${opts.oldStatus ?? null},
        ${opts.newStatus},
        ${opts.changedByType ?? "admin"},
        ${opts.changedById ?? null},
        ${opts.changedByName ?? null},
        ${opts.changedByIp ?? null},
        ${opts.notes ?? null},
        ${opts.source ?? null}
      )
    `);
  } catch (err) {
    logger.warn({ err, opts }, "logOrderStatusChange failed — non-fatal");
  }
}

// ── order_audit_logs ─────────────────────────────────────────────────────────

export interface LogOrderAuditOpts {
  orderId: number;
  orderNumber?: string | null;
  rfqId?: number | null;
  actorType?: string;
  actorId?: string | null;
  actorName?: string | null;
  action: string;
  description?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  ipAddress?: string | null;
}

export async function logOrderAudit(opts: LogOrderAuditOpts): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO order_audit_logs
        (order_id, order_number, rfq_id, actor_type, actor_id, actor_name,
         action, description, old_value, new_value, ip_address)
      VALUES (
        ${opts.orderId},
        ${opts.orderNumber ?? null},
        ${opts.rfqId ?? null},
        ${opts.actorType ?? "admin"},
        ${opts.actorId ?? null},
        ${opts.actorName ?? null},
        ${opts.action},
        ${opts.description ?? null},
        ${opts.oldValue != null ? JSON.stringify(opts.oldValue) : null}::jsonb,
        ${opts.newValue != null ? JSON.stringify(opts.newValue) : null}::jsonb,
        ${opts.ipAddress ?? null}
      )
    `);
  } catch (err) {
    logger.warn({ err, action: opts.action }, "logOrderAudit failed — non-fatal");
  }
}

// ── vendor_quote_history ─────────────────────────────────────────────────────

export interface LogVendorQuoteEventOpts {
  orderId: number;
  orderNumber?: string | null;
  rfqId?: number | null;
  rfqNumber?: string | null;
  vendorId?: number | null;
  vendorName?: string | null;
  eventType: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  oldPrice?: number | null;
  newPrice?: number | null;
  changedByType?: string;
  changedById?: string | null;
  changedByName?: string | null;
  notes?: string | null;
}

export async function logVendorQuoteEvent(opts: LogVendorQuoteEventOpts): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO vendor_quote_history
        (order_id, order_number, rfq_id, rfq_number, vendor_id, vendor_name,
         event_type, old_status, new_status, old_price, new_price,
         changed_by_type, changed_by_id, changed_by_name, notes)
      VALUES (
        ${opts.orderId},
        ${opts.orderNumber ?? null},
        ${opts.rfqId ?? null},
        ${opts.rfqNumber ?? null},
        ${opts.vendorId ?? null},
        ${opts.vendorName ?? null},
        ${opts.eventType},
        ${opts.oldStatus ?? null},
        ${opts.newStatus ?? null},
        ${opts.oldPrice != null ? String(opts.oldPrice) : null},
        ${opts.newPrice != null ? String(opts.newPrice) : null},
        ${opts.changedByType ?? "system"},
        ${opts.changedById ?? null},
        ${opts.changedByName ?? null},
        ${opts.notes ?? null}
      )
    `);
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType }, "logVendorQuoteEvent failed — non-fatal");
  }
}

// ── customer_approval_history ────────────────────────────────────────────────

export interface LogCustomerApprovalEventOpts {
  orderId: number;
  orderNumber?: string | null;
  rfqId?: number | null;
  eventType: string;
  oldStatus?: string | null;
  newStatus?: string | null;
  customerName?: string | null;
  customerEmail?: string | null;
  customerPhone?: string | null;
  tokenUsed?: string | null;
  response?: string | null;
  revisionNotes?: string | null;
  rejectionReason?: string | null;
  actorType?: string;
  actorId?: string | null;
  actorName?: string | null;
  ipAddress?: string | null;
}

export async function logCustomerApprovalEvent(opts: LogCustomerApprovalEventOpts): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO customer_approval_history
        (order_id, order_number, rfq_id, event_type, old_status, new_status,
         customer_name, customer_email, customer_phone, token_used,
         response, revision_notes, rejection_reason,
         actor_type, actor_id, actor_name, ip_address)
      VALUES (
        ${opts.orderId},
        ${opts.orderNumber ?? null},
        ${opts.rfqId ?? null},
        ${opts.eventType},
        ${opts.oldStatus ?? null},
        ${opts.newStatus ?? null},
        ${opts.customerName ?? null},
        ${opts.customerEmail ?? null},
        ${opts.customerPhone ?? null},
        ${opts.tokenUsed ?? null},
        ${opts.response ?? null},
        ${opts.revisionNotes ?? null},
        ${opts.rejectionReason ?? null},
        ${opts.actorType ?? "customer"},
        ${opts.actorId ?? null},
        ${opts.actorName ?? null},
        ${opts.ipAddress ?? null}
      )
    `);
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType }, "logCustomerApprovalEvent failed — non-fatal");
  }
}

// ── getOrderAuditTrail — combined timeline ───────────────────────────────────

export async function getOrderAuditTrail(orderId: number): Promise<{
  statusHistory: unknown[];
  activityLogs: unknown[];
  vendorQuotes: unknown[];
  customerApprovals: unknown[];
}> {
  try {
    const [statusHistory, activityLogs, vendorQuotes, customerApprovals] = await Promise.all([
      db.execute(sql`
        SELECT * FROM order_status_history
        WHERE order_id = ${orderId}
        ORDER BY created_at ASC
      `),
      db.execute(sql`
        SELECT * FROM order_audit_logs
        WHERE order_id = ${orderId}
        ORDER BY created_at ASC
      `),
      db.execute(sql`
        SELECT * FROM vendor_quote_history
        WHERE order_id = ${orderId}
        ORDER BY created_at ASC
      `),
      db.execute(sql`
        SELECT * FROM customer_approval_history
        WHERE order_id = ${orderId}
        ORDER BY created_at ASC
      `),
    ]);
    return {
      statusHistory: statusHistory.rows as unknown[],
      activityLogs: activityLogs.rows as unknown[],
      vendorQuotes: vendorQuotes.rows as unknown[],
      customerApprovals: customerApprovals.rows as unknown[],
    };
  } catch (err) {
    logger.warn({ err, orderId }, "getOrderAuditTrail failed");
    return { statusHistory: [], activityLogs: [], vendorQuotes: [], customerApprovals: [] };
  }
}

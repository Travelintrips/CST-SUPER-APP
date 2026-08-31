import { db } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { vendorNotificationsTable } from "@workspace/db";
import { broadcastToAdmins } from "./sseManager.js";
import { logger } from "./logger.js";

export interface AdminNotifPayload {
  type: string;
  orderId?: number | null;
  orderNumber: string;
  customerName: string;
  companyName?: string | null;
  /** Optional explicit title/body for admin_notifications (NOT NULL columns). Falls back to a generic message derived from `type` when omitted. */
  title?: string;
  body?: string;
  /** Stable logical-event key. When supplied, concurrent retries produce one row. */
  dedupeKey?: string;
  [key: string]: unknown;
}

/** admin_notifications.title/body are NOT NULL — always derive a non-empty value. */
function humanizeType(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export async function saveAndBroadcast(
  sseEvent: string,
  payload: AdminNotifPayload,
): Promise<void> {
  let dbId: number | null = null;
  let createdAt: string = new Date().toISOString();
  // correlation id so a swallowed/failed insert can still be traced in logs
  const correlationId = `notif_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const title = payload.title?.trim() || humanizeType(payload.type);
  const body = payload.body?.trim() || `${payload.customerName} — ${payload.orderNumber}`;
  try {
    const result = await db.execute(sql`
      INSERT INTO admin_notifications (type, order_id, order_number, customer_name, company_name, payload, title, body, dedupe_key)
      VALUES (
        ${payload.type},
        ${payload.orderId ?? null},
        ${payload.orderNumber},
        ${payload.customerName},
        ${payload.companyName ?? null},
        ${JSON.stringify(payload)}::jsonb,
        ${title},
        ${body},
        ${payload.dedupeKey ?? null}
      )
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id, created_at
    `);
    if (!result.rows.length) return;
    const row = result.rows[0] as { id: number; created_at: Date | string };
    dbId = row.id;
    createdAt = new Date(row.created_at).toISOString();
  } catch (err: unknown) {
    // DB save failed — log with a correlation id so the failure is traceable
    // (previously this was a silent `catch {}` and left no trace at all),
    // then still broadcast via SSE so online admins get a live toast.
    logger.error(
      { correlationId, sseEvent, type: payload.type, orderNumber: payload.orderNumber, err },
      "[notificationStore] saveAndBroadcast: admin_notifications insert failed",
    );
  }
  broadcastToAdmins(sseEvent, { ...payload, dbId, createdAt, correlationId });
}

// ── Vendor notification store ─────────────────────────────────────────────────

export interface VendorNotifInput {
  vendorId: number;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
  /** Optional: pass a drizzle transaction object to run inside an existing tx */
  tx?: typeof db;
}

/**
 * Save a notification to vendor_notifications.
 * Non-throwing: callers must handle errors or swallow them intentionally.
 */
export async function saveVendorNotification(
  input: VendorNotifInput,
): Promise<number | null> {
  const dbOrTx = input.tx ?? db;
  const [row] = await (dbOrTx as typeof db)
    .insert(vendorNotificationsTable)
    .values({
      vendorId: input.vendorId,
      type:     input.type,
      title:    input.title,
      message:  input.message,
      payload:  input.payload ?? {},
    })
    .returning({ id: vendorNotificationsTable.id });
  return row?.id ?? null;
}

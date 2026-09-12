import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { broadcastToCustomer } from "./sseManager.js";
import { logger } from "./logger.js";

export interface CustomerPortalNotificationInput {
  portalCustomerId: number | null | undefined;
  eventKey: string;
  type: string;
  title: string;
  message: string;
  payload?: Record<string, unknown>;
}

export interface CustomerPortalNotification {
  id: number;
  portalCustomerId: number;
  eventKey: string;
  type: string;
  title: string;
  message: string;
  payload: Record<string, unknown>;
  isRead: boolean;
  createdAt: string;
  readAt: string | null;
}

function mapNotification(row: any): CustomerPortalNotification {
  return {
    id: Number(row.id),
    portalCustomerId: Number(row.portal_customer_id),
    eventKey: String(row.event_key),
    type: String(row.type),
    title: String(row.title),
    message: String(row.message),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    isRead: Boolean(row.is_read),
    createdAt: new Date(row.created_at).toISOString(),
    readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
  };
}

export async function notifyCustomerPortal(input: CustomerPortalNotificationInput): Promise<void> {
  const customerId = Number(input.portalCustomerId);
  if (!Number.isInteger(customerId) || customerId <= 0) return;

  try {
    const result = await db.execute(sql`
      INSERT INTO portal_customer_notifications
        (portal_customer_id, event_key, type, title, message, payload)
      VALUES
        (${customerId}, ${input.eventKey}, ${input.type}, ${input.title}, ${input.message},
         ${JSON.stringify(input.payload ?? {})}::jsonb)
      ON CONFLICT (portal_customer_id, event_key) DO NOTHING
      RETURNING id, portal_customer_id, event_key, type, title, message, payload,
                is_read, created_at, read_at
    `);
    if (result.rows.length === 0) return;
    broadcastToCustomer(customerId, "customer_notification", mapNotification(result.rows[0]));
  } catch (error) {
    // Notifications must not turn a successful canonical status transition
    // into a 500. The durable row remains the source of truth when available.
    logger.error({ err: error, customerId, eventKey: input.eventKey }, "Customer notification failed");
  }
}

export async function listCustomerPortalNotifications(
  portalCustomerId: number,
  limit = 50,
): Promise<CustomerPortalNotification[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
  const result = await db.execute(sql`
    SELECT id, portal_customer_id, event_key, type, title, message, payload,
           is_read, created_at, read_at
    FROM portal_customer_notifications
    WHERE portal_customer_id = ${portalCustomerId}
    ORDER BY created_at DESC, id DESC
    LIMIT ${safeLimit}
  `);
  return result.rows.map(mapNotification);
}

export async function getCustomerPortalUnreadCount(portalCustomerId: number): Promise<number> {
  const result = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM portal_customer_notifications
    WHERE portal_customer_id = ${portalCustomerId} AND is_read = FALSE
  `);
  return Number((result.rows[0] as { count: number }).count);
}

export async function markCustomerPortalNotificationRead(
  portalCustomerId: number,
  notificationId: number,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE portal_customer_notifications
    SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
    WHERE id = ${notificationId} AND portal_customer_id = ${portalCustomerId}
    RETURNING id
  `);
  return result.rows.length > 0;
}

export async function markAllCustomerPortalNotificationsRead(portalCustomerId: number): Promise<number> {
  const result = await db.execute(sql`
    UPDATE portal_customer_notifications
    SET is_read = TRUE, read_at = COALESCE(read_at, NOW())
    WHERE portal_customer_id = ${portalCustomerId} AND is_read = FALSE
    RETURNING id
  `);
  return result.rows.length;
}
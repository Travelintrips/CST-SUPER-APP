/**
 * Portal Dashboard Service
 *
 * Aggregates role-based stats for GET /api/portal/me/dashboard-stats.
 * Three branches: vendor (RFQ-centric), admin (global), customer (per-email).
 *
 * Controller (portal.ts) resolves auth context, calls getPortalDashboardStats(),
 * and handles the error-fallback (returning zeros) so this service can stay pure.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { getLinkedSupplier } from "./portalVendorCatalogService.js";

// ─── Return shapes ────────────────────────────────────────────────────────────

export interface VendorDashboardStats {
  rfqReceived: number;
  rfqSubmitted: number;
  fulfillmentPending: number;
  completedOrders: number;
}

export interface CustomerDashboardStats {
  totalOrders: number;
  activeOrders: number;
  completedOrders: number;
  invoiceOutstandingCount: number;
  invoiceOutstandingAmount: number;
  trackingActive: number;
}

export interface AdminDashboardStats extends CustomerDashboardStats {
  pendingOrders: number;
  processingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
}

export type PortalDashboardStats = VendorDashboardStats | CustomerDashboardStats | AdminDashboardStats;

// ─── Vendor branch ────────────────────────────────────────────────────────────

const VENDOR_ZEROS: VendorDashboardStats = {
  rfqReceived: 0, rfqSubmitted: 0, fulfillmentPending: 0, completedOrders: 0,
};

async function getVendorStats(customerId: number): Promise<VendorDashboardStats> {
  const supplier = await getLinkedSupplier(customerId);
  if (!supplier) return VENDOR_ZEROS;

  const vendorId = supplier.id;
  const [rfqReceived, rfqSubmitted, fulfillmentPending, completedOrders] = await Promise.all([
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_order_rfqs
      WHERE ${vendorId} = ANY(vendor_ids) AND status IN ('pending','open','sent','blasted')
    `),
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_order_quotes
      WHERE vendor_id = ${vendorId}
    `),
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_order_quotes q
      JOIN logistic_orders o ON o.id = q.order_id
      WHERE q.vendor_id = ${vendorId}
        AND q.quote_status = 'approved'
        AND o.status NOT IN ('Completed','Cancelled','cancelled')
    `),
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_order_quotes q
      JOIN logistic_orders o ON o.id = q.order_id
      WHERE q.vendor_id = ${vendorId}
        AND o.status IN ('Completed','delivered','Delivered')
    `),
  ]);

  return {
    rfqReceived:       Number(rfqReceived.rows[0]?.cnt       ?? 0),
    rfqSubmitted:      Number(rfqSubmitted.rows[0]?.cnt      ?? 0),
    fulfillmentPending: Number(fulfillmentPending.rows[0]?.cnt ?? 0),
    completedOrders:   Number(completedOrders.rows[0]?.cnt   ?? 0),
  };
}

// ─── Admin branch ─────────────────────────────────────────────────────────────

async function getAdminStats(): Promise<AdminDashboardStats> {
  const [
    totalOrdersRes, activeOrdersRes, completedOrdersRes,
    invoiceOutstandingRes, trackingRes,
    pendingRes, processingRes, shippedRes, deliveredRes, cancelledRes,
  ] = await Promise.all([
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('In Progress','in_transit','In Transit','New Order','processing','Order Received','Quote Received','Vendor Selected','Confirmed')`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('Completed','delivered','Delivered')`),
    db.execute<{ total: string; cnt: string }>(sql`SELECT COALESCE(SUM(grand_total::numeric), 0)::text AS total, count(*)::text AS cnt FROM sales_documents WHERE status NOT IN ('cancelled','draft') AND invoice_status = 'to_invoice'`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('In Progress','in_transit','In Transit') AND EXISTS (SELECT 1 FROM driver_locations dl WHERE dl.order_id = logistic_orders.id)`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('Order Received','Quote Received','New Order')`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('Confirmed','Vendor Selected','processing','In Progress')`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('in_transit','In Transit','Shipped')`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('Completed','delivered','Delivered')`),
    db.execute<{ cnt: string }>(sql`SELECT count(*)::text AS cnt FROM logistic_orders WHERE status IN ('Cancelled','cancelled')`),
  ]);

  return {
    totalOrders:              Number(totalOrdersRes.rows[0]?.cnt        ?? 0),
    activeOrders:             Number(activeOrdersRes.rows[0]?.cnt       ?? 0),
    completedOrders:          Number(completedOrdersRes.rows[0]?.cnt    ?? 0),
    invoiceOutstandingCount:  Number(invoiceOutstandingRes.rows[0]?.cnt ?? 0),
    invoiceOutstandingAmount: Number(invoiceOutstandingRes.rows[0]?.total ?? 0),
    trackingActive:           Number(trackingRes.rows[0]?.cnt           ?? 0),
    pendingOrders:            Number(pendingRes.rows[0]?.cnt            ?? 0),
    processingOrders:         Number(processingRes.rows[0]?.cnt         ?? 0),
    shippedOrders:            Number(shippedRes.rows[0]?.cnt            ?? 0),
    deliveredOrders:          Number(deliveredRes.rows[0]?.cnt          ?? 0),
    cancelledOrders:          Number(cancelledRes.rows[0]?.cnt          ?? 0),
  };
}

// ─── Customer branch ──────────────────────────────────────────────────────────

async function getCustomerStats(customerId: number): Promise<CustomerDashboardStats> {
  const [totalOrdersRes, activeOrdersRes, completedOrdersRes, invoiceOutstandingRes, trackingRes] = await Promise.all([
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_orders
      WHERE email = (SELECT email FROM portal_customers WHERE id = ${customerId} LIMIT 1)
    `),
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_orders
      WHERE email = (SELECT email FROM portal_customers WHERE id = ${customerId} LIMIT 1)
        AND status IN ('In Progress','in_transit','In Transit','New Order','processing')
    `),
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_orders
      WHERE email = (SELECT email FROM portal_customers WHERE id = ${customerId} LIMIT 1)
        AND status IN ('Completed','delivered','Delivered')
    `),
    db.execute<{ total: string; cnt: string }>(sql`
      SELECT
        COALESCE(SUM(grand_total::numeric), 0)::text AS total,
        count(*)::text AS cnt
      FROM sales_documents
      WHERE status NOT IN ('cancelled','draft')
        AND invoice_status = 'to_invoice'
        AND LOWER(customer_name) = LOWER((SELECT name FROM portal_customers WHERE id = ${customerId} LIMIT 1))
    `),
    db.execute<{ cnt: string }>(sql`
      SELECT count(*)::text AS cnt FROM logistic_orders
      WHERE email = (SELECT email FROM portal_customers WHERE id = ${customerId} LIMIT 1)
        AND status IN ('In Progress','in_transit','In Transit')
        AND EXISTS (
          SELECT 1 FROM driver_locations dl WHERE dl.order_id = logistic_orders.id
        )
    `),
  ]);

  return {
    totalOrders:              Number(totalOrdersRes.rows[0]?.cnt        ?? 0),
    activeOrders:             Number(activeOrdersRes.rows[0]?.cnt       ?? 0),
    completedOrders:          Number(completedOrdersRes.rows[0]?.cnt    ?? 0),
    invoiceOutstandingCount:  Number(invoiceOutstandingRes.rows[0]?.cnt ?? 0),
    invoiceOutstandingAmount: Number(invoiceOutstandingRes.rows[0]?.total ?? 0),
    trackingActive:           Number(trackingRes.rows[0]?.cnt           ?? 0),
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns role-appropriate dashboard stats.
 * - vendor  → VendorDashboardStats  (returns zeros if no linked supplier found)
 * - admin   → AdminDashboardStats
 * - default → CustomerDashboardStats
 *
 * Throws on DB error; caller is responsible for returning graceful zero-fallbacks.
 */
export async function getPortalDashboardStats(
  customerId: number,
  role: string,
): Promise<PortalDashboardStats> {
  if (role === "vendor") return getVendorStats(customerId);
  if (role === "admin")  return getAdminStats();
  return getCustomerStats(customerId);
}

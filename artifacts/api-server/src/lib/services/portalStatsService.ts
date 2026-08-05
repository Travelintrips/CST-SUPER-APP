/**
 * Portal Stats Service
 *
 * Business logic for ERP / dashboard statistics endpoints.
 * Controller (portal.ts) calls these; no logic lives in the controller.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ErpStats {
  portalOrdersThisMonth:  number;
  activeCustomers:        number;
  pendingRfqs:            number;
  salesRevenueThisMonth:  number;
  activeFreightShipments: number;
  inTransitShipments:     number;
}

// ─── getErpStats ──────────────────────────────────────────────────────────────

export async function getErpStats(): Promise<ErpStats> {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [
    portalOrdersResult,
    activeCustomersResult,
    pendingRfqsResult,
    salesRevenueResult,
    activeFreightResult,
    inTransitResult,
  ] = await Promise.all([
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM logistic_orders
      WHERE created_at >= ${startOfMonth.toISOString()}
    `),
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM portal_customers WHERE role = 'customer'
    `),
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM logistic_order_rfqs WHERE status = 'pending'
    `),
    db.execute<{ total: string }>(sql`
      SELECT coalesce(sum(grand_total), 0)::text AS total
      FROM sales_documents
      WHERE kind = 'order' AND status IN ('confirmed', 'done')
      AND created_at >= ${startOfMonth.toISOString()}
    `),
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM freight_shipments
      WHERE status NOT IN ('cancelled', 'completed')
    `),
    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM freight_shipments WHERE status = 'in_transit'
    `),
  ]);

  return {
    portalOrdersThisMonth:  Number(portalOrdersResult.rows[0]?.count  ?? 0),
    activeCustomers:        Number(activeCustomersResult.rows[0]?.count ?? 0),
    pendingRfqs:            Number(pendingRfqsResult.rows[0]?.count    ?? 0),
    salesRevenueThisMonth:  Number(salesRevenueResult.rows[0]?.total   ?? 0),
    activeFreightShipments: Number(activeFreightResult.rows[0]?.count  ?? 0),
    inTransitShipments:     Number(inTransitResult.rows[0]?.count      ?? 0),
  };
}

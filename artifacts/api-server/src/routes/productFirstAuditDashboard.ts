/**
 * productFirstAuditDashboard.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Audit dashboard untuk product-first logistic orders.
 *
 * Mounted at: /api/logistic/product-first/audit
 *
 * GET /sla              — SLA per fase (product phase & shipment phase)
 * GET /blocked          — Orders stuck di satu status melebihi threshold
 * GET /missing-data     — Orders dengan data penting yang belum diisi
 * GET /exceptions       — Exception summary untuk product-first orders
 * GET /all              — Semua audit data dalam satu response
 */

import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();
router.use(requireAdmin);

// ── SLA thresholds (jam) ──────────────────────────────────────────────────────
const PRODUCT_PHASE_SLA: Record<string, number> = {
  "Admin Review":              4,
  "Product RFQ Sent":         24,
  "Product Quote Received":    8,
  "Product Vendor Selected":   4,
  "Customer Product Approval":24,
  "Shipment Selection Pending":24,
};

const SHIPMENT_PHASE_SLA: Record<string, number> = {
  "RFQ Sent":           48,
  "Quote Received":      8,
  "Customer Approval":  24,
  "Vendor Confirmed":    4,
  "In Progress":        72,
  "Pickup":             24,
  "In Transit":        120,
  "Arrived":            24,
  "Delivered":          24,
  "POD Uploaded":       24,
  "Invoice Issued":     72,
  "Payment Received":   24,
};

// ── GET /sla ─────────────────────────────────────────────────────────────────
router.get("/sla", async (req, res) => {
  try {
    // Avg time spent per status transition using order_status_history
    const rows = await db.execute(sql.raw(`
      SELECT
        osh.new_status AS status,
        COUNT(DISTINCT osh.order_id)::int AS order_count,
        ROUND(AVG(
          EXTRACT(EPOCH FROM (
            LEAD(osh.created_at) OVER (PARTITION BY osh.order_id ORDER BY osh.created_at)
            - osh.created_at
          )) / 3600
        )::numeric, 1) AS avg_hours_in_status,
        ROUND(MAX(
          EXTRACT(EPOCH FROM (
            LEAD(osh.created_at) OVER (PARTITION BY osh.order_id ORDER BY osh.created_at)
            - osh.created_at
          )) / 3600
        )::numeric, 1) AS max_hours_in_status
      FROM order_status_history osh
      JOIN logistic_orders lo ON lo.id = osh.order_id
      WHERE lo.order_type = 'product_first'
      GROUP BY osh.new_status
      ORDER BY osh.new_status
    `));

    const productPhaseSla: any[] = [];
    const shipmentPhaseSla: any[] = [];

    for (const r of rows.rows as any[]) {
      const slaHours = PRODUCT_PHASE_SLA[r.status] ?? SHIPMENT_PHASE_SLA[r.status] ?? null;
      const entry = {
        status: r.status,
        orderCount: r.order_count,
        avgHours: r.avg_hours_in_status,
        maxHours: r.max_hours_in_status,
        slaTargetHours: slaHours,
        slaStatus: slaHours
          ? (r.avg_hours_in_status <= slaHours ? "on_time" : "breached")
          : "no_sla",
      };
      if (r.status in PRODUCT_PHASE_SLA) {
        productPhaseSla.push(entry);
      } else {
        shipmentPhaseSla.push(entry);
      }
    }

    res.json({ productPhaseSla, shipmentPhaseSla });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil SLA data" });
  }
});

// ── GET /blocked ─────────────────────────────────────────────────────────────
// Orders stuck di status tertentu melebihi threshold jam
router.get("/blocked", async (req, res) => {
  const thresholdHours = Number(req.query.thresholdHours ?? 24);

  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        lo.id, lo.order_number, lo.customer_name, lo.status,
        lo.shipment_mode,
        lo.product_ready_date,
        EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck,
        lo.updated_at::text AS last_updated,
        lo.created_at::text AS created_at,
        COALESCE(s.name, '') AS product_vendor_name
      FROM logistic_orders lo
      LEFT JOIN suppliers s ON s.id = lo.product_vendor_id
      WHERE lo.order_type = 'product_first'
        AND lo.status NOT IN ('Completed', 'Cancelled')
        AND lo.updated_at < NOW() - INTERVAL '${thresholdHours} hours'
      ORDER BY hours_stuck DESC
      LIMIT 100
    `));

    const withSla = (rows.rows as any[]).map((r) => {
      const slaHours = PRODUCT_PHASE_SLA[r.status] ?? SHIPMENT_PHASE_SLA[r.status] ?? null;
      return {
        ...r,
        hoursStuck: Math.round(r.hours_stuck),
        slaTargetHours: slaHours,
        slaBreached: slaHours ? r.hours_stuck > slaHours : false,
      };
    });

    const summary = {
      total: withSla.length,
      slaBreached: withSla.filter((r) => r.slaBreached).length,
      critical: withSla.filter((r) => r.hoursStuck > 72).length,
    };

    res.json({ orders: withSla, summary });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil blocked orders" });
  }
});

// ── GET /missing-data ────────────────────────────────────────────────────────
// Orders dengan data wajib yang belum diisi
router.get("/missing-data", async (req, res) => {
  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        lo.id, lo.order_number, lo.customer_name, lo.status,
        lo.shipment_mode,
        lo.product_ready_date,
        lo.product_pickup_location,
        lo.product_vendor_id,
        lo.customer_product_approval_token,
        lo.customer_product_approved_at,
        lo.created_at::text,
        COALESCE(s.name, '') AS product_vendor_name,
        -- flags
        (lo.product_ready_date IS NULL
          AND lo.status NOT IN ('Order Received','Admin Review','Product RFQ Sent','Cancelled')
        ) AS missing_ready_date,
        (lo.product_pickup_location IS NULL
          AND lo.shipment_mode = 'pickup_self'
          AND lo.status NOT IN ('Cancelled')
        ) AS missing_pickup_location,
        (lo.product_vendor_id IS NULL
          AND lo.status NOT IN ('Order Received','Admin Review','Product RFQ Sent','Cancelled')
        ) AS missing_product_vendor,
        (lo.customer_product_approval_token IS NULL
          AND lo.status IN ('Customer Product Approval')
        ) AS missing_approval_token
      FROM logistic_orders lo
      LEFT JOIN suppliers s ON s.id = lo.product_vendor_id
      WHERE lo.order_type = 'product_first'
        AND lo.status NOT IN ('Completed', 'Cancelled')
        AND (
          (lo.product_ready_date IS NULL
            AND lo.status NOT IN ('Order Received','Admin Review','Product RFQ Sent','Cancelled'))
          OR
          (lo.product_pickup_location IS NULL
            AND lo.shipment_mode = 'pickup_self')
          OR
          (lo.product_vendor_id IS NULL
            AND lo.status NOT IN ('Order Received','Admin Review','Product RFQ Sent','Cancelled'))
          OR
          (lo.customer_product_approval_token IS NULL
            AND lo.status = 'Customer Product Approval')
        )
      ORDER BY lo.created_at DESC
      LIMIT 100
    `));

    const summary = {
      total: (rows.rows as any[]).length,
      missingReadyDate: (rows.rows as any[]).filter((r: any) => r.missing_ready_date).length,
      missingPickupLocation: (rows.rows as any[]).filter((r: any) => r.missing_pickup_location).length,
      missingProductVendor: (rows.rows as any[]).filter((r: any) => r.missing_product_vendor).length,
      missingApprovalToken: (rows.rows as any[]).filter((r: any) => r.missing_approval_token).length,
    };

    res.json({ orders: rows.rows, summary });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil missing data" });
  }
});

// ── GET /exceptions ───────────────────────────────────────────────────────────
// Exception summary untuk product-first orders
router.get("/exceptions", async (req, res) => {
  try {
    const [bySeverity, byType, recent] = await Promise.all([
      db.execute(sql.raw(`
        SELECT e.severity, e.status, COUNT(*)::int AS count
        FROM exceptions e
        JOIN logistic_orders lo ON lo.id = e.ref_id::int
        WHERE e.ref_type = 'logistic_order'
          AND lo.order_type = 'product_first'
        GROUP BY e.severity, e.status
        ORDER BY e.severity, e.status
      `)),
      db.execute(sql.raw(`
        SELECT e.exception_type::text AS exception_type, COUNT(*)::int AS count
        FROM exceptions e
        JOIN logistic_orders lo ON lo.id = e.ref_id::int
        WHERE e.ref_type = 'logistic_order'
          AND lo.order_type = 'product_first'
          AND e.status IN ('open','in_progress')
        GROUP BY e.exception_type
        ORDER BY count DESC
      `)),
      db.execute(sql.raw(`
        SELECT
          e.id, e.exception_type::text AS exception_type, e.severity,
          e.status, e.title, e.ref_number AS order_number,
          e.customer_name, e.created_at::text
        FROM exceptions e
        JOIN logistic_orders lo ON lo.id = e.ref_id::int
        WHERE e.ref_type = 'logistic_order'
          AND lo.order_type = 'product_first'
          AND e.status IN ('open','in_progress')
        ORDER BY
          CASE e.severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END,
          e.created_at DESC
        LIMIT 20
      `)),
    ]);

    res.json({ bySeverity: bySeverity.rows, byType: byType.rows, recentOpen: recent.rows });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil exception data" });
  }
});

// ── GET /all ─────────────────────────────────────────────────────────────────
router.get("/all", async (req, res) => {
  const thresholdHours = Number(req.query.thresholdHours ?? 24);

  try {
    const [blocked, missingData, exceptions] = await Promise.allSettled([
      db.execute(sql.raw(`
        SELECT COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE EXTRACT(EPOCH FROM (NOW()-updated_at))/3600 > 72)::int AS critical
        FROM logistic_orders
        WHERE order_type='product_first'
          AND status NOT IN ('Completed','Cancelled')
          AND updated_at < NOW() - INTERVAL '${thresholdHours} hours'
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE product_ready_date IS NULL
            AND status NOT IN ('Order Received','Admin Review','Product RFQ Sent','Cancelled'))::int AS missing_ready_date,
          COUNT(*) FILTER (WHERE product_pickup_location IS NULL
            AND shipment_mode='pickup_self')::int AS missing_pickup_location
        FROM logistic_orders
        WHERE order_type='product_first' AND status NOT IN ('Completed','Cancelled')
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE e.status IN ('open','in_progress'))::int AS open_count,
          COUNT(*) FILTER (WHERE e.severity IN ('critical','high') AND e.status IN ('open','in_progress'))::int AS high_priority
        FROM exceptions e
        JOIN logistic_orders lo ON lo.id = e.ref_id::int
        WHERE e.ref_type='logistic_order' AND lo.order_type='product_first'
      `)),
    ]);

    res.json({
      blocked: blocked.status === "fulfilled" ? (blocked.value.rows[0] ?? {}) : {},
      missingData: missingData.status === "fulfilled" ? (missingData.value.rows[0] ?? {}) : {},
      exceptions: exceptions.status === "fulfilled" ? (exceptions.value.rows[0] ?? {}) : {},
    });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil audit data" });
  }
});

export default router;

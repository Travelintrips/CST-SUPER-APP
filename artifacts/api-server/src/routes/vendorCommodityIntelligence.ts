/**
 * Sprint 9 — Vendor Commodity Intelligence
 *
 * GET /api/vendor-intelligence/commodities
 *   Returns: for all vendors × commodities they've handled — order count, revenue, margin
 *
 * GET /api/vendor-intelligence/commodities/:vendorId
 *   Returns: all commodities handled by a specific vendor with detailed metrics
 *
 * GET /api/vendor-intelligence/top-vendors-by-commodity
 *   Returns: for each commodity, the top 3 vendors by order count
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";

const router = Router();

router.use(async (req, res, next) => {
  const ok = await requireClerkUser(req, res);
  if (ok) next();
});

// GET /api/vendor-intelligence/commodities
// Returns cross-table: vendorId × commodity with aggregated metrics
router.get("/commodities", async (req, res) => {
  const dateFrom = req.query.dateFrom ? new Date(String(req.query.dateFrom)) : null;
  const dateTo   = req.query.dateTo   ? new Date(String(req.query.dateTo))   : null;

  try {
    const rows = await db.execute<{
      vendor_id: string; vendor_name: string; vendor_grade: string;
      commodity: string; order_count: string;
      revenue: string; vendor_cost: string; margin: string; margin_pct: string;
      completed: string; cancelled: string;
    }>(sql`
      SELECT
        s.id::text                                                         AS vendor_id,
        s.name                                                             AS vendor_name,
        COALESCE(vp.vendor_grade, 'D')                                    AS vendor_grade,
        COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')          AS commodity,
        COUNT(lo.id)::text                                                 AS order_count,
        COALESCE(SUM(lo.grand_total),                           0)::text  AS revenue,
        COALESCE(SUM(COALESCE(lo.truck_price, 0)),              0)::text  AS vendor_cost,
        COALESCE(SUM(lo.grand_total - COALESCE(lo.truck_price, 0)), 0)::text AS margin,
        ROUND(
          CASE WHEN SUM(lo.grand_total) > 0
            THEN SUM(lo.grand_total - COALESCE(lo.truck_price, 0)) / SUM(lo.grand_total) * 100
            ELSE 0
          END, 1
        )::text                                                            AS margin_pct,
        COUNT(*) FILTER (WHERE lo.status ILIKE '%completed%' OR lo.status ILIKE '%delivered%')::text AS completed,
        COUNT(*) FILTER (WHERE lo.status ILIKE '%cancel%')::text          AS cancelled
      FROM logistic_orders lo
      JOIN suppliers s ON s.id = lo.approved_vendor_id
      LEFT JOIN vendor_performance vp ON vp.vendor_id = s.id
      WHERE lo.approved_vendor_id IS NOT NULL
        AND lo.status NOT IN ('Cancelled','cancelled')
        ${dateFrom ? sql`AND lo.created_at >= ${dateFrom}` : sql``}
        ${dateTo   ? sql`AND lo.created_at <= ${dateTo}`   : sql``}
      GROUP BY s.id, s.name, vp.vendor_grade, COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')
      ORDER BY s.name, COUNT(lo.id) DESC
    `);

    const matrix: Record<string, {
      vendorId: number; vendorName: string; vendorGrade: string;
      commodities: Array<{
        commodity: string; orderCount: number;
        revenue: number; vendorCost: number; margin: number; marginPct: number;
        completed: number; cancelled: number;
      }>;
    }> = {};

    for (const r of rows.rows) {
      const vId = r.vendor_id;
      if (!matrix[vId]) {
        matrix[vId] = {
          vendorId: Number(vId),
          vendorName: r.vendor_name,
          vendorGrade: r.vendor_grade,
          commodities: [],
        };
      }
      matrix[vId].commodities.push({
        commodity:   r.commodity,
        orderCount:  Number(r.order_count),
        revenue:     Number(r.revenue),
        vendorCost:  Number(r.vendor_cost),
        margin:      Number(r.margin),
        marginPct:   Number(r.margin_pct),
        completed:   Number(r.completed),
        cancelled:   Number(r.cancelled),
      });
    }

    res.json({ vendors: Object.values(matrix), total: Object.keys(matrix).length });
  } catch (e) {
    console.error("[vendor-intelligence/commodities]", e);
    res.status(500).json({ error: "Gagal memuat vendor commodity intelligence" });
  }
});

// GET /api/vendor-intelligence/commodities/:vendorId
router.get("/commodities/:vendorId", async (req, res) => {
  const vendorId = Number(req.params.vendorId);
  if (!vendorId) { res.status(400).json({ error: "Invalid vendorId" }); return; }

  try {
    const [vendor, rows] = await Promise.all([
      db.execute<{ name: string; vendor_grade: string; preferred_vendor_score: string }>(sql`
        SELECT s.name, COALESCE(vp.vendor_grade, 'D') AS vendor_grade,
               COALESCE(vp.preferred_vendor_score, 0) AS preferred_vendor_score
        FROM suppliers s
        LEFT JOIN vendor_performance vp ON vp.vendor_id = s.id
        WHERE s.id = ${vendorId}
        LIMIT 1
      `),
      db.execute<{
        commodity: string; order_count: string;
        revenue: string; vendor_cost: string; margin: string; margin_pct: string;
        completed: string; cancelled: string; cancel_rate: string;
        avg_weight_kg: string;
      }>(sql`
        SELECT
          COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')        AS commodity,
          COUNT(lo.id)::text                                               AS order_count,
          COALESCE(SUM(lo.grand_total),                         0)::text  AS revenue,
          COALESCE(SUM(COALESCE(lo.truck_price, 0)),            0)::text  AS vendor_cost,
          COALESCE(SUM(lo.grand_total - COALESCE(lo.truck_price, 0)), 0)::text AS margin,
          ROUND(
            CASE WHEN SUM(lo.grand_total) > 0
              THEN SUM(lo.grand_total - COALESCE(lo.truck_price, 0)) / SUM(lo.grand_total) * 100
              ELSE 0
            END, 1
          )::text                                                          AS margin_pct,
          COUNT(*) FILTER (WHERE lo.status ILIKE '%completed%' OR lo.status ILIKE '%delivered%')::text AS completed,
          COUNT(*) FILTER (WHERE lo.status ILIKE '%cancel%')::text        AS cancelled,
          ROUND(
            CASE WHEN COUNT(*) > 0
              THEN COUNT(*) FILTER (WHERE lo.status ILIKE '%cancel%')::numeric / COUNT(*) * 100
              ELSE 0
            END, 1
          )::text                                                          AS cancel_rate,
          COALESCE(AVG(lo.gross_weight::numeric) FILTER (WHERE lo.gross_weight IS NOT NULL), 0)::text AS avg_weight_kg
        FROM logistic_orders lo
        WHERE lo.approved_vendor_id = ${vendorId}
          AND lo.status NOT IN ('Cancelled','cancelled')
        GROUP BY COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')
        ORDER BY COUNT(lo.id) DESC
      `),
    ]);

    const v = vendor.rows[0];
    if (!v) { res.status(404).json({ error: "Vendor tidak ditemukan" }); return; }

    const commodities = rows.rows.map(r => ({
      commodity:    r.commodity,
      orderCount:   Number(r.order_count),
      revenue:      Number(r.revenue),
      vendorCost:   Number(r.vendor_cost),
      margin:       Number(r.margin),
      marginPct:    Number(r.margin_pct),
      completed:    Number(r.completed),
      cancelled:    Number(r.cancelled),
      cancelRate:   Number(r.cancel_rate),
      avgWeightKg:  Number(r.avg_weight_kg),
    }));

    res.json({
      vendorId,
      vendorName:          (v as any).name,
      vendorGrade:         (v as any).vendor_grade,
      preferredScore:      Number((v as any).preferred_vendor_score),
      commodities,
      totalCommodities:    commodities.length,
      totalOrders:         commodities.reduce((s, c) => s + c.orderCount, 0),
      totalRevenue:        commodities.reduce((s, c) => s + c.revenue,    0),
      totalMargin:         commodities.reduce((s, c) => s + c.margin,     0),
    });
  } catch (e) {
    console.error("[vendor-intelligence/commodities/:vendorId]", e);
    res.status(500).json({ error: "Gagal memuat data vendor" });
  }
});

// GET /api/vendor-intelligence/top-vendors-by-commodity
// Returns: top 3 vendors per commodity by order count
router.get("/top-vendors-by-commodity", async (req, res) => {
  try {
    const rows = await db.execute<{
      commodity: string; vendor_id: string; vendor_name: string;
      vendor_grade: string; order_count: string; margin_pct: string; rank: string;
    }>(sql`
      WITH ranked AS (
        SELECT
          COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')    AS commodity,
          s.id::text                                                    AS vendor_id,
          s.name                                                        AS vendor_name,
          COALESCE(vp.vendor_grade, 'D')                               AS vendor_grade,
          COUNT(lo.id)                                                  AS order_count,
          ROUND(
            CASE WHEN SUM(lo.grand_total) > 0
              THEN SUM(lo.grand_total - COALESCE(lo.truck_price, 0)) / SUM(lo.grand_total) * 100
              ELSE 0
            END, 1
          )                                                             AS margin_pct,
          ROW_NUMBER() OVER (
            PARTITION BY COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')
            ORDER BY COUNT(lo.id) DESC
          )                                                             AS rank
        FROM logistic_orders lo
        JOIN suppliers s ON s.id = lo.approved_vendor_id
        LEFT JOIN vendor_performance vp ON vp.vendor_id = s.id
        WHERE lo.approved_vendor_id IS NOT NULL
          AND lo.status NOT IN ('Cancelled','cancelled')
        GROUP BY lo.commodity, s.id, s.name, vp.vendor_grade
      )
      SELECT * FROM ranked WHERE rank <= 3
      ORDER BY commodity, rank
    `);

    const grouped: Record<string, Array<{
      vendorId: number; vendorName: string; vendorGrade: string;
      orderCount: number; marginPct: number; rank: number;
    }>> = {};

    for (const r of rows.rows) {
      if (!grouped[r.commodity]) grouped[r.commodity] = [];
      grouped[r.commodity].push({
        vendorId:   Number(r.vendor_id),
        vendorName: r.vendor_name,
        vendorGrade: r.vendor_grade,
        orderCount: Number(r.order_count),
        marginPct:  Number(r.margin_pct),
        rank:       Number(r.rank),
      });
    }

    res.json({
      commodities: Object.entries(grouped).map(([commodity, vendors]) => ({ commodity, vendors })),
    });
  } catch (e) {
    console.error("[vendor-intelligence/top-vendors-by-commodity]", e);
    res.status(500).json({ error: "Gagal memuat data" });
  }
});

export { router as vendorCommodityIntelligenceRouter };

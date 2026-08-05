/**
 * Sprint 6 — Auto Vendor Recommendation Engine
 *
 * GET /api/vendor-recommendation/candidates
 *   ?origin=&destination=&commodity=&shipmentType=&weightKg=
 *
 * GET /api/vendor-recommendation/for-order/:orderId
 *   Reads the order and runs the same engine.
 */
import { Router } from "express";
import { db, suppliersTable, logisticOrdersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";

const router = Router();

router.use(async (req, res, next) => {
  const ok = await requireClerkUser(req, res);
  if (ok) next();
});

// ── Core scoring engine ───────────────────────────────────────────────────────
interface CandidateInput {
  origin?: string;
  destination?: string;
  commodity?: string;
  shipmentType?: string;
  weightKg?: number;
}

interface VendorCandidate {
  vendorId: number;
  vendorName: string;
  serviceType: string | null;
  vendorGrade: string;
  preferredScore: number;
  finalScore: number;
  confidence: "high" | "medium" | "low" | "none";
  routeOrderCount: number;
  routeOnTimePct: number | null;
  commodityOrderCount: number;
  explanation: string[];
  badges: string[];
}

async function scoreVendors(input: CandidateInput): Promise<VendorCandidate[]> {
  const { origin, destination, commodity, shipmentType } = input;

  // 1. All active vendors with performance data
  const vendorRows = await db.execute<{
    vendor_id: string; vendor_name: string; service_type: string | null;
    preferred_vendor_score: string; vendor_grade: string;
    ontime_percentage: string; cancel_rate: string;
    avg_response_hours: string; pod_completeness_score: string;
    total_orders: string; total_rfq_invites: string; total_selected: string;
  }>(sql`
    SELECT
      s.id                                                   AS vendor_id,
      s.name                                                 AS vendor_name,
      s.service_type,
      COALESCE(vp.preferred_vendor_score, 0)                AS preferred_vendor_score,
      COALESCE(vp.vendor_grade, 'D')                        AS vendor_grade,
      COALESCE(vp.ontime_percentage, 0)                     AS ontime_percentage,
      COALESCE(vp.cancel_rate, 0)                           AS cancel_rate,
      COALESCE(vp.avg_response_hours, 0)                    AS avg_response_hours,
      COALESCE(vp.pod_completeness_score, 0)                AS pod_completeness_score,
      COALESCE(vp.total_orders, 0)                          AS total_orders,
      COALESCE(vp.total_rfq_invites, 0)                     AS total_rfq_invites,
      COALESCE(vp.total_selected, 0)                        AS total_selected
    FROM suppliers s
    LEFT JOIN vendor_performance vp ON vp.vendor_id = s.id
    WHERE s.is_active = true
      AND s.service_type IS NOT NULL
    ORDER BY COALESCE(vp.preferred_vendor_score, 0) DESC
    LIMIT 100
  `);

  if (vendorRows.rows.length === 0) return [];

  const vendorIds = vendorRows.rows.map(r => Number(r.vendor_id));

  // 2. Route-specific history from logistic_orders
  const routeRows = await db.execute<{
    vendor_id: string;
    route_total: string;
    route_completed: string;
  }>(sql`
    SELECT
      approved_vendor_id::text                                     AS vendor_id,
      COUNT(*)::int                                                AS route_total,
      COUNT(*) FILTER (WHERE status ILIKE '%completed%' OR status ILIKE '%delivered%')::int AS route_completed
    FROM logistic_orders
    WHERE approved_vendor_id IN (${sql.raw(vendorIds.join(','))})
      AND status NOT IN ('Cancelled','cancelled')
      ${origin ? sql`AND origin ILIKE ${`%${origin}%`}` : sql``}
      ${destination ? sql`AND destination ILIKE ${`%${destination}%`}` : sql``}
      ${shipmentType ? sql`AND shipment_type = ${shipmentType}` : sql``}
    GROUP BY approved_vendor_id
  `);

  const routeMap = new Map<number, { total: number; completed: number }>();
  for (const r of routeRows.rows) {
    routeMap.set(Number(r.vendor_id), {
      total: Number(r.route_total),
      completed: Number(r.route_completed),
    });
  }

  // 3. Commodity-specific history
  const commodityRows = commodity
    ? await db.execute<{ vendor_id: string; commodity_count: string }>(sql`
        SELECT
          approved_vendor_id::text AS vendor_id,
          COUNT(*)::int            AS commodity_count
        FROM logistic_orders
        WHERE approved_vendor_id IN (${sql.raw(vendorIds.join(','))})
          AND commodity ILIKE ${`%${commodity}%`}
          AND status NOT IN ('Cancelled','cancelled')
        GROUP BY approved_vendor_id
      `)
    : { rows: [] };

  const commodityMap = new Map<number, number>();
  for (const r of commodityRows.rows) {
    commodityMap.set(Number((r as any).vendor_id), Number((r as any).commodity_count));
  }

  // 4. Score each vendor
  const results: VendorCandidate[] = vendorRows.rows.map(r => {
    const vId = Number(r.vendor_id);
    const baseScore = Number(r.preferred_vendor_score ?? 0);
    const routeData = routeMap.get(vId);
    const commodityCount = commodityMap.get(vId) ?? 0;
    const routeTotal = routeData?.total ?? 0;
    const routeCompleted = routeData?.completed ?? 0;
    const routeOnTimePct = routeTotal > 0 ? (routeCompleted / routeTotal) * 100 : null;

    // Scoring: base + route boost + commodity boost
    let finalScore = baseScore;
    let confidence: "high" | "medium" | "low" | "none" = "none";

    if (routeTotal >= 5) {
      finalScore = (routeOnTimePct! * 0.5) + (baseScore * 0.5);
      confidence = "high";
    } else if (routeTotal >= 2) {
      finalScore = (routeOnTimePct! * 0.3) + (baseScore * 0.7);
      confidence = "medium";
    } else if (routeTotal >= 1) {
      finalScore = (routeOnTimePct! * 0.15) + (baseScore * 0.85);
      confidence = "low";
    }

    // Commodity boost (+5 per 5 orders on this commodity, max +10)
    if (commodityCount > 0) {
      finalScore = Math.min(100, finalScore + Math.min(10, commodityCount * 2));
    }

    // Build explanation bullets
    const explanation: string[] = [];
    const ontimePct = Number(r.ontime_percentage ?? 0);
    const cancelRate = Number(r.cancel_rate ?? 0);
    const respHours = Number(r.avg_response_hours ?? 0);
    const podScore = Number(r.pod_completeness_score ?? 0);
    const invites = Number(r.total_rfq_invites ?? 0);
    const selected = Number(r.total_selected ?? 0);

    if (routeTotal > 0 && routeOnTimePct !== null) {
      explanation.push(`${routeCompleted}/${routeTotal} on-time pada rute ini (${routeOnTimePct.toFixed(0)}%)`);
    } else if (routeTotal === 0 && Number(r.total_orders) > 0) {
      explanation.push(`Belum ada riwayat pada rute ini, tapi ${r.total_orders} order global`);
    }
    if (commodityCount > 0) {
      explanation.push(`${commodityCount} order komoditas "${commodity || "-"}" sebelumnya`);
    }
    if (ontimePct > 0) explanation.push(`On-time global: ${ontimePct.toFixed(0)}%`);
    if (cancelRate > 0) explanation.push(`Cancel rate: ${cancelRate.toFixed(1)}%`);
    if (respHours > 0) explanation.push(`Rata-rata respon: ${respHours.toFixed(1)} jam`);
    if (podScore > 0) explanation.push(`POD completeness: ${podScore.toFixed(0)}%`);
    if (invites > 0) explanation.push(`Win rate: ${selected}/${invites} (${invites > 0 ? (selected/invites*100).toFixed(0) : 0}%)`);
    if (explanation.length === 0) explanation.push("Vendor baru — belum ada data historis");

    // Badges
    const badges: string[] = [];
    if (routeTotal >= 5 && routeOnTimePct !== null && routeOnTimePct >= 80) badges.push("Route Expert");
    if (ontimePct >= 90) badges.push("Top Vendor");
    if (respHours > 0 && respHours <= 2) badges.push("Fast Response");
    if (commodityCount >= 3) badges.push("Commodity Specialist");
    if (cancelRate <= 5 && Number(r.total_orders) >= 10) badges.push("Trusted");

    return {
      vendorId: vId,
      vendorName: r.vendor_name,
      serviceType: r.service_type ?? null,
      vendorGrade: r.vendor_grade,
      preferredScore: Math.round(baseScore * 10) / 10,
      finalScore: Math.round(finalScore * 10) / 10,
      confidence,
      routeOrderCount: routeTotal,
      routeOnTimePct: routeOnTimePct !== null ? Math.round(routeOnTimePct * 10) / 10 : null,
      commodityOrderCount: commodityCount,
      explanation,
      badges,
    };
  });

  results.sort((a, b) => b.finalScore - a.finalScore);
  return results;
}

// GET /api/vendor-recommendation/candidates
router.get("/candidates", async (req, res) => {
  const origin      = req.query.origin      ? String(req.query.origin).trim()      : undefined;
  const destination = req.query.destination ? String(req.query.destination).trim() : undefined;
  const commodity   = req.query.commodity   ? String(req.query.commodity).trim()   : undefined;
  const shipmentType = req.query.shipmentType ? String(req.query.shipmentType).trim() : undefined;
  const weightKg    = req.query.weightKg    ? Number(req.query.weightKg)           : undefined;

  try {
    const candidates = await scoreVendors({ origin, destination, commodity, shipmentType, weightKg });
    res.json({ candidates, input: { origin, destination, commodity, shipmentType, weightKg } });
  } catch (e) {
    console.error("[vendor-recommendation/candidates]", e);
    res.status(500).json({ error: "Gagal menjalankan rekomendasi vendor" });
  }
});

// GET /api/vendor-recommendation/for-order/:orderId
router.get("/for-order/:orderId", async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (!orderId) { res.status(400).json({ error: "Invalid orderId" }); return; }

  try {
    const [order] = await db
      .select({
        origin: logisticOrdersTable.origin,
        destination: logisticOrdersTable.destination,
        commodity: logisticOrdersTable.commodity,
        shipmentType: logisticOrdersTable.shipmentType,
        weightKg: logisticOrdersTable.weightKg,
      })
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, orderId));

    if (!order) { res.status(404).json({ error: "Order tidak ditemukan" }); return; }

    const candidates = await scoreVendors({
      origin:       order.origin ?? undefined,
      destination:  order.destination ?? undefined,
      commodity:    order.commodity ?? undefined,
      shipmentType: order.shipmentType ?? undefined,
      weightKg:     order.weightKg ? Number(order.weightKg) : undefined,
    });
    res.json({ candidates, order: { id: orderId, ...order } });
  } catch (e) {
    console.error("[vendor-recommendation/for-order]", e);
    res.status(500).json({ error: "Gagal menjalankan rekomendasi vendor" });
  }
});

export { router as vendorRecommendationRouter };

import { db, suppliersTable, vendorPerformanceTable, logisticOrdersTable, rfqVendorLinksTable, driverJobsTable, driversTable } from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Additive column migration ──────────────────────────────────────────────────
export async function runVendorPerformanceMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_performance (
        id                        SERIAL PRIMARY KEY,
        vendor_id                 INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        total_orders              INTEGER NOT NULL DEFAULT 0,
        completed_orders          INTEGER NOT NULL DEFAULT 0,
        cancelled_orders          INTEGER NOT NULL DEFAULT 0,
        ontime_percentage         NUMERIC(5,2) DEFAULT 0,
        average_response_minutes  NUMERIC(10,2) DEFAULT 0,
        pod_completeness_score    NUMERIC(5,2) DEFAULT 0,
        eta_accuracy_score        NUMERIC(5,2) DEFAULT 0,
        customer_rating           NUMERIC(3,2) DEFAULT 0,
        order_success_rate        NUMERIC(5,2) DEFAULT 0,
        cancel_rate               NUMERIC(5,2) DEFAULT 0,
        total_complaints          INTEGER NOT NULL DEFAULT 0,
        recommendation_score      NUMERIC(5,2) DEFAULT 0,
        updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(vendor_id)
      )
    `);

    const extendedCols: Array<[string, string]> = [
      ["total_rfq_invites",        "INTEGER DEFAULT 0"],
      ["total_submitted",          "INTEGER DEFAULT 0"],
      ["total_selected",           "INTEGER DEFAULT 0"],
      ["total_rejected",           "INTEGER DEFAULT 0"],
      ["avg_response_hours",       "NUMERIC(10,2) DEFAULT 0"],
      ["on_time_orders",           "INTEGER DEFAULT 0"],
      ["late_orders",              "INTEGER DEFAULT 0"],
      ["pod_complete_orders",      "INTEGER DEFAULT 0"],
      ["score",                    "NUMERIC(5,2) DEFAULT 0"],
      ["last_calculated_at",       "TIMESTAMPTZ"],
      // Financial
      ["total_revenue",            "NUMERIC(18,2) DEFAULT 0"],
      ["total_cost",               "NUMERIC(18,2) DEFAULT 0"],
      ["total_margin",             "NUMERIC(18,2) DEFAULT 0"],
      ["margin_pct",               "NUMERIC(7,2) DEFAULT 0"],
      // POD counts
      ["pod_uploaded_count",       "INTEGER DEFAULT 0"],
      ["pod_missing_count",        "INTEGER DEFAULT 0"],
      // Invoice counts
      ["invoice_issued_count",     "INTEGER DEFAULT 0"],
      ["invoice_dispute_count",    "INTEGER DEFAULT 0"],
      // Complaint
      ["customer_complaint_count", "INTEGER DEFAULT 0"],
      // Preferred score & grade
      ["preferred_vendor_score",   "NUMERIC(5,2) DEFAULT 0"],
      ["vendor_grade",             "TEXT DEFAULT 'D'"],
    ];

    for (const [col, def] of extendedCols) {
      await db.execute(sql.raw(`
        DO $$ BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'vendor_performance' AND column_name = '${col}'
          ) THEN
            ALTER TABLE vendor_performance ADD COLUMN ${col} ${def};
          END IF;
        END $$;
      `));
    }

    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS vendor_perf_vendor_id_key
        ON vendor_performance(vendor_id)
        WHERE vendor_id IS NOT NULL
    `);

    logger.info("[vendorPerformanceService] migration selesai");
  } catch (err) {
    logger.warn({ err }, "[vendorPerformanceService] migration warning (non-fatal)");
  }
}

// ── Grade from preferred score ─────────────────────────────────────────────────
function calcGrade(score: number): string {
  if (score >= 85) return "A+";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "D";
}

// ── Core recalculation for a single vendor ────────────────────────────────────
export async function recalculateVendorPerformance(vendorId: number) {
  // A. Order stats + financial (revenue = final_price, cost = vendor_price, for completed orders)
  const orderStats = await db.execute<{
    total: string; completed: string; cancelled: string;
    total_revenue: string; total_cost: string;
  }>(sql`
    SELECT
      COUNT(*)::int                                                                         AS total,
      COUNT(*) FILTER (WHERE status ILIKE '%completed%' OR status ILIKE '%delivered%')::int AS completed,
      COUNT(*) FILTER (WHERE status ILIKE '%cancelled%' OR status ILIKE '%cancel%')::int    AS cancelled,
      COALESCE(SUM(final_price)   FILTER (WHERE status ILIKE '%completed%' OR status ILIKE '%delivered%'), 0)::numeric(18,2) AS total_revenue,
      COALESCE(SUM(vendor_price)  FILTER (WHERE status ILIKE '%completed%' OR status ILIKE '%delivered%'), 0)::numeric(18,2) AS total_cost
    FROM logistic_orders
    WHERE approved_vendor_id = ${vendorId}
  `);

  const os = (orderStats.rows[0] ?? {}) as Record<string, string>;
  const total        = Number(os["total"]         ?? 0);
  const completed    = Number(os["completed"]     ?? 0);
  const cancelled    = Number(os["cancelled"]     ?? 0);
  const totalRevenue = Number(os["total_revenue"] ?? 0);
  const totalCost    = Number(os["total_cost"]    ?? 0);
  const totalMargin  = totalRevenue - totalCost;
  const marginPct    = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  // B. RFQ stats
  const rfqStats = await db.execute<{
    total_invites: string; total_submitted: string;
    total_selected: string; avg_response_min: string;
  }>(sql`
    SELECT
      COUNT(*)::int                                                        AS total_invites,
      COUNT(*) FILTER (WHERE submitted_at IS NOT NULL)::int               AS total_submitted,
      COUNT(*) FILTER (WHERE status = 'selected')::int                    AS total_selected,
      COALESCE(AVG(EXTRACT(EPOCH FROM (submitted_at - created_at)) / 60)
        FILTER (WHERE submitted_at IS NOT NULL), 0)::numeric(10,2)        AS avg_response_min
    FROM rfq_vendor_links
    WHERE vendor_id = ${vendorId}
  `);

  const rfq = (rfqStats.rows[0] ?? {}) as Record<string, string>;
  const totalRfqInvites  = Number(rfq["total_invites"]   ?? 0);
  const totalSubmitted   = Number(rfq["total_submitted"]  ?? 0);
  const totalSelected    = Number(rfq["total_selected"]   ?? 0);
  const totalRejected    = Math.max(0, totalRfqInvites - totalSelected);
  const avgResponseMin   = Number(rfq["avg_response_min"] ?? 0);
  const avgResponseHours = avgResponseMin > 0 ? avgResponseMin / 60 : 0;

  // C. POD stats
  const podStats = await db
    .select({
      totalJobs: sql<number>`count(*)::int`,
      withPod:   sql<number>`count(*) filter (where pod_receiver_name IS NOT NULL AND pod_receiver_name != '')::int`,
    })
    .from(driverJobsTable)
    .innerJoin(driversTable, eq(driverJobsTable.driverId, driversTable.id))
    .where(
      and(
        sql`${driverJobsTable.logisticOrderId} IN (
          SELECT id FROM logistic_orders WHERE approved_vendor_id = ${vendorId}
        )`,
      )
    );

  const { totalJobs, withPod } = podStats[0] ?? { totalJobs: 0, withPod: 0 };
  const podScore          = totalJobs > 0 ? (withPod / totalJobs) * 100 : 0;
  const podCompleteOrders = withPod;
  const podUploadedCount  = withPod;
  const podMissingCount   = Math.max(0, totalJobs - withPod);

  // D. Invoice stats & complaints via exceptions table
  const invoiceIssuedCount = completed; // each completed order = 1 invoice issued
  let invoiceDisputeCount    = 0;
  let customerComplaintCount = 0;
  try {
    const exRes = await db.execute<{ dispute_count: string; complaint_count: string }>(sql`
      SELECT
        COUNT(*) FILTER (WHERE exception_type = 'payment_overdue')::int    AS dispute_count,
        COUNT(*) FILTER (WHERE exception_type = 'customer_complaint')::int AS complaint_count
      FROM exceptions
      WHERE supplier_name IN (SELECT name FROM suppliers WHERE id = ${vendorId})
    `);
    const ex = (exRes.rows[0] ?? {}) as Record<string, string>;
    invoiceDisputeCount    = Number(ex["dispute_count"]   ?? 0);
    customerComplaintCount = Number(ex["complaint_count"] ?? 0);
  } catch { /* exceptions table may not exist yet */ }

  // E. Derived order metrics
  const successRate  = total > 0 ? (completed / total) * 100 : 0;
  const cancelRate   = total > 0 ? (cancelled / total) * 100 : 0;
  const ontimePct    = total > 0 ? Math.max(0, successRate - cancelRate / 2) : 0;
  const onTimeOrders = completed;
  const lateOrders   = Math.max(0, total - completed - cancelled);

  // F. Preferred Vendor Score (0–100) with weighted components
  //   25% On Time
  //   20% Win Rate (selected / invites)
  //   20% Margin % (normalized, 30% margin = full score)
  //   15% Response Speed (inverted avg response hours, 48h cap)
  //   10% POD Completeness
  //   10% Cancellation Rate (inverted)
  const winRate = totalRfqInvites > 0 ? totalSelected / totalRfqInvites : 0;
  const scoreOnTime     = (ontimePct / 100) * 25;
  const scoreWinRate    = winRate * 20;
  const scoreMargin     = Math.min(Math.max(marginPct, 0) / 30, 1) * 20;
  const scoreRespSpeed  = (1 - Math.min(avgResponseHours, 48) / 48) * 15;
  const scorePod        = (podScore / 100) * 10;
  const scoreCancelRate = (1 - Math.min(cancelRate, 100) / 100) * 10;
  const preferredVendorScore = Math.min(
    100,
    scoreOnTime + scoreWinRate + scoreMargin + scoreRespSpeed + scorePod + scoreCancelRate
  );
  const vendorGrade = calcGrade(preferredVendorScore);

  // Legacy recommendation score (kept for backward compat & RFQ recommendation)
  const recScore =
    (ontimePct * 0.3) +
    (Math.max(0, 100 - Math.min(avgResponseMin, 120)) * 0.2) +
    (podScore * 0.2) +
    (successRate * 0.3);

  const perf = {
    vendorId,
    totalOrders:            total,
    completedOrders:        completed,
    cancelledOrders:        cancelled,
    ontimePercentage:       ontimePct.toFixed(2),
    averageResponseMinutes: avgResponseMin.toFixed(2),
    podCompletenessScore:   podScore.toFixed(2),
    etaAccuracyScore:       "0",
    customerRating:         "0",
    orderSuccessRate:       successRate.toFixed(2),
    cancelRate:             cancelRate.toFixed(2),
    totalComplaints:        customerComplaintCount,
    recommendationScore:    recScore.toFixed(2),
    updatedAt:              new Date(),
    totalRfqInvites, totalSubmitted, totalSelected, totalRejected,
    avgResponseHours:       avgResponseHours.toFixed(2),
    onTimeOrders, lateOrders, podCompleteOrders,
    score:                  recScore.toFixed(2),
    lastCalculatedAt:       new Date(),
    totalRevenue:           totalRevenue.toFixed(2),
    totalCost:              totalCost.toFixed(2),
    totalMargin:            totalMargin.toFixed(2),
    marginPct:              marginPct.toFixed(2),
    podUploadedCount, podMissingCount,
    invoiceIssuedCount, invoiceDisputeCount,
    customerComplaintCount,
    preferredVendorScore:   preferredVendorScore.toFixed(2),
    vendorGrade,
  };

  await db.execute(sql`
    INSERT INTO vendor_performance (
      vendor_id, total_orders, completed_orders, cancelled_orders,
      ontime_percentage, average_response_minutes, pod_completeness_score,
      eta_accuracy_score, customer_rating, order_success_rate, cancel_rate,
      total_complaints, recommendation_score, updated_at,
      total_rfq_invites, total_submitted, total_selected, total_rejected,
      avg_response_hours, on_time_orders, late_orders, pod_complete_orders,
      score, last_calculated_at,
      total_revenue, total_cost, total_margin, margin_pct,
      pod_uploaded_count, pod_missing_count,
      invoice_issued_count, invoice_dispute_count,
      customer_complaint_count,
      preferred_vendor_score, vendor_grade
    ) VALUES (
      ${vendorId}, ${total}, ${completed}, ${cancelled},
      ${ontimePct.toFixed(2)}, ${avgResponseMin.toFixed(2)}, ${podScore.toFixed(2)},
      0, 0, ${successRate.toFixed(2)}, ${cancelRate.toFixed(2)}, ${customerComplaintCount},
      ${recScore.toFixed(2)}, NOW(),
      ${totalRfqInvites}, ${totalSubmitted}, ${totalSelected}, ${totalRejected},
      ${avgResponseHours.toFixed(2)}, ${onTimeOrders}, ${lateOrders}, ${podCompleteOrders},
      ${recScore.toFixed(2)}, NOW(),
      ${totalRevenue.toFixed(2)}, ${totalCost.toFixed(2)}, ${totalMargin.toFixed(2)}, ${marginPct.toFixed(2)},
      ${podUploadedCount}, ${podMissingCount},
      ${invoiceIssuedCount}, ${invoiceDisputeCount},
      ${customerComplaintCount},
      ${preferredVendorScore.toFixed(2)}, ${vendorGrade}
    )
    ON CONFLICT (vendor_id) WHERE vendor_id IS NOT NULL
    DO UPDATE SET
      total_orders             = EXCLUDED.total_orders,
      completed_orders         = EXCLUDED.completed_orders,
      cancelled_orders         = EXCLUDED.cancelled_orders,
      ontime_percentage        = EXCLUDED.ontime_percentage,
      average_response_minutes = EXCLUDED.average_response_minutes,
      pod_completeness_score   = EXCLUDED.pod_completeness_score,
      order_success_rate       = EXCLUDED.order_success_rate,
      cancel_rate              = EXCLUDED.cancel_rate,
      total_complaints         = EXCLUDED.total_complaints,
      recommendation_score     = EXCLUDED.recommendation_score,
      updated_at               = NOW(),
      total_rfq_invites        = EXCLUDED.total_rfq_invites,
      total_submitted          = EXCLUDED.total_submitted,
      total_selected           = EXCLUDED.total_selected,
      total_rejected           = EXCLUDED.total_rejected,
      avg_response_hours       = EXCLUDED.avg_response_hours,
      on_time_orders           = EXCLUDED.on_time_orders,
      late_orders              = EXCLUDED.late_orders,
      pod_complete_orders      = EXCLUDED.pod_complete_orders,
      score                    = EXCLUDED.score,
      last_calculated_at       = NOW(),
      total_revenue            = EXCLUDED.total_revenue,
      total_cost               = EXCLUDED.total_cost,
      total_margin             = EXCLUDED.total_margin,
      margin_pct               = EXCLUDED.margin_pct,
      pod_uploaded_count       = EXCLUDED.pod_uploaded_count,
      pod_missing_count        = EXCLUDED.pod_missing_count,
      invoice_issued_count     = EXCLUDED.invoice_issued_count,
      invoice_dispute_count    = EXCLUDED.invoice_dispute_count,
      customer_complaint_count = EXCLUDED.customer_complaint_count,
      preferred_vendor_score   = EXCLUDED.preferred_vendor_score,
      vendor_grade             = EXCLUDED.vendor_grade
  `);

  return perf;
}

// ── Backfill all active vendors ────────────────────────────────────────────────
export async function recalculateAllVendorPerformance(): Promise<{ updated: number; skipped: number }> {
  try {
    const vendors = await db
      .select({ id: suppliersTable.id })
      .from(suppliersTable)
      .where(eq(suppliersTable.isActive, true));

    let updated = 0;
    let skipped = 0;

    for (const v of vendors) {
      try {
        await recalculateVendorPerformance(v.id);
        updated++;
      } catch {
        skipped++;
      }
    }

    logger.info({ updated, skipped }, "[vendorPerformanceService] backfill selesai");
    return { updated, skipped };
  } catch (err) {
    logger.error({ err }, "[vendorPerformanceService] backfill error");
    return { updated: 0, skipped: 0 };
  }
}

// ── Health summary ─────────────────────────────────────────────────────────────
export async function getVendorPerformanceHealth(): Promise<{
  tableExists: boolean;
  rowCount: number;
  lastCalculatedAt: string | null;
  vendorsWithScore: number;
  vendorsWithoutScore: number;
  activeVendors: number;
  backfillCoverage: string;
}> {
  try {
    const [existsRes, statsRes, activeRes] = await Promise.all([
      db.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM information_schema.tables
          WHERE table_name = 'vendor_performance'
        ) AS exists
      `),
      db.execute(sql`
        SELECT
          COUNT(*)::int                                                   AS row_count,
          MAX(last_calculated_at)                                         AS last_calculated_at,
          COUNT(*) FILTER (WHERE score::numeric > 0)::int                AS with_score,
          COUNT(*) FILTER (WHERE score IS NULL OR score::numeric = 0)::int AS without_score
        FROM vendor_performance
      `),
      db.execute(sql`SELECT COUNT(*)::int AS n FROM suppliers WHERE is_active = true`),
    ]);

    const tableExists = (existsRes.rows[0] as Record<string, unknown>)?.["exists"] === true
      || (existsRes.rows[0] as Record<string, unknown>)?.["exists"] === "true";

    if (!tableExists) {
      return { tableExists: false, rowCount: 0, lastCalculatedAt: null, vendorsWithScore: 0, vendorsWithoutScore: 0, activeVendors: 0, backfillCoverage: "0%" };
    }

    const s = (statsRes.rows[0] ?? {}) as Record<string, unknown>;
    const rowCount            = Number(s["row_count"]          ?? 0);
    const vendorsWithScore    = Number(s["with_score"]         ?? 0);
    const vendorsWithoutScore = Number(s["without_score"]      ?? 0);
    const lastCalculatedAt    = s["last_calculated_at"] ? String(s["last_calculated_at"]) : null;
    const activeVendors       = Number((activeRes.rows[0] as Record<string, unknown>)?.["n"] ?? 0);
    const backfillCoverage    = activeVendors > 0
      ? `${Math.round((rowCount / activeVendors) * 100)}%`
      : "0%";

    return { tableExists, rowCount, lastCalculatedAt, vendorsWithScore, vendorsWithoutScore, activeVendors, backfillCoverage };
  } catch (err) {
    logger.error({ err }, "[vendorPerformanceService] getHealth error");
    return { tableExists: false, rowCount: 0, lastCalculatedAt: null, vendorsWithScore: 0, vendorsWithoutScore: 0, activeVendors: 0, backfillCoverage: "0%" };
  }
}

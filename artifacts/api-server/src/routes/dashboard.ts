import { Router, type Request } from "express";
import {
  db, ordersTable, stocksTable, transactionsTable, productsTable,
  freightShipmentsTable, salesDocumentsTable,
} from "@workspace/db";
import { sql, and, ne, eq, or, isNull } from "drizzle-orm";
import { getRecentResponseTimesFromDb } from "../lib/responseTimeLog";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

// Inline migration: buat tabel vendor_performance jika belum ada
db.execute(sql`
  CREATE TABLE IF NOT EXISTS vendor_performance (
    id SERIAL PRIMARY KEY,
    supplier_id INTEGER REFERENCES suppliers(id) ON DELETE CASCADE,
    score NUMERIC(5,2) DEFAULT 0,
    completed_orders INTEGER DEFAULT 0,
    on_time_rate NUMERIC(5,2) DEFAULT 0,
    total_orders INTEGER DEFAULT 0,
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`).catch(() => {});

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// ?companyId=N  → single company mode (holding only)
// ?companyId=all or omitted → consolidated mode (holding only)
// non-holding user → always locked to user.companyId
function parseCompanyParam(req: Request): { isConsolidated: boolean; companyId: number | null } {
  const user = req.user as { companyId?: number | null; role?: string | null } | undefined;
  // Hanya non-admin & non-owner yang dikunci ke company mereka sendiri
  // (konsisten dengan resolveCompanyScope di lib/resolveCompany.ts)
  const isLocked = user?.companyId != null && user.role !== "admin" && user.role !== "owner";
  if (isLocked) {
    return { isConsolidated: false, companyId: user!.companyId! };
  }
  // Admin / owner: gunakan query param atau consolidated view
  const raw = req.query.companyId;
  if (raw === "all" || raw === undefined || raw === "") {
    return { isConsolidated: true, companyId: null };
  }
  const id = Number(raw);
  if (!isFinite(id) || id <= 0) return { isConsolidated: true, companyId: null };
  return { isConsolidated: false, companyId: id };
}

// GET /api/dashboard/org-breakdown?companyId=<id>|all&branchId=N&divisionId=N&departmentId=N
// Returns breakdown metrics per branch, division, or department
router.get("/org-breakdown", async (req, res) => {
  const { isConsolidated, companyId } = parseCompanyParam(req);
  const dimension = (req.query["dimension"] as string) || "branch"; // branch | division | department

  // Sales revenue breakdown by division (via created_by user's division)
  const salesDivisionRows = await db.execute<{
    division_id: string; division_name: string;
    revenue: string; order_count: string;
  }>(sql`
    SELECT
      d.id::text AS division_id,
      d.name AS division_name,
      COALESCE(SUM(sd.grand_total::numeric), 0)::text AS revenue,
      COUNT(sd.id)::text AS order_count
    FROM divisions d
    LEFT JOIN users u ON u.division_id = d.id
    LEFT JOIN sales_documents sd ON sd.created_by_id = u.id
      AND sd.kind = 'order'
      AND sd.status IN ('confirmed','done')
      AND sd.created_at >= date_trunc('month', NOW())
    GROUP BY d.id, d.name
    ORDER BY revenue DESC NULLS LAST
  `);

  // Sales revenue breakdown by department
  const salesDeptRows = await db.execute<{
    department_id: string; department_name: string;
    revenue: string; order_count: string;
  }>(sql`
    SELECT
      dep.id::text AS department_id,
      dep.name AS department_name,
      COALESCE(SUM(sd.grand_total::numeric), 0)::text AS revenue,
      COUNT(sd.id)::text AS order_count
    FROM departments dep
    LEFT JOIN users u ON u.department_id = dep.id
    LEFT JOIN sales_documents sd ON sd.created_by_id = u.id
      AND sd.kind = 'order'
      AND sd.status IN ('confirmed','done')
      AND sd.created_at >= date_trunc('month', NOW())
    GROUP BY dep.id, dep.name
    ORDER BY revenue DESC NULLS LAST
  `);

  return res.json({
    byDivision: salesDivisionRows.rows.map((r) => ({
      divisionId: Number(r.division_id),
      divisionName: r.division_name,
      revenue: Number(r.revenue),
      orderCount: Number(r.order_count),
    })),
    byDepartment: salesDeptRows.rows.map((r) => ({
      departmentId: Number(r.department_id),
      departmentName: r.department_name,
      revenue: Number(r.revenue),
      orderCount: Number(r.order_count),
    })),
  });
});

// GET /api/dashboard/summary?companyId=<id>|all
router.get("/summary", async (req, res) => {
  const { isConsolidated, companyId } = parseCompanyParam(req);

  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const startOfThisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfPrevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfPrevMonth = startOfThisMonth;

  // Raw SQL company filter fragments
  const companyFilter = (!isConsolidated && companyId !== null)
    ? sql` AND (sd.company_id = ${companyId} OR sd.company_id IS NULL)`
    : sql``;

  const companyFilterNoAlias = (!isConsolidated && companyId !== null)
    ? sql` AND (company_id = ${companyId} OR company_id IS NULL)`
    : sql``;

  // ORM filters for freight shipments
  const freightCompanyFilter = (!isConsolidated && companyId !== null)
    ? eq(freightShipmentsTable.companyId, companyId)
    : undefined;

  const [
    [orderCount],
    [revenue],
    [shipmentCount],
    [stockValue],
    [lowStock],
    [activeFreight],
    [awaitingQuote],
    [inTransit],
    salesRevenueThisMonthResult,
    salesRevenuePrevMonthResult,
    salesOrdersThisMonthResult,
    salesOrdersPrevMonthResult,
    quotesActiveResult,
    salesOrdersConfirmedResult,
    monthlyTrendRaw,
    perCompanyRaw,
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(ordersTable)
      .where(!isConsolidated && companyId !== null
        ? eq(ordersTable.companyId, companyId)
        : undefined),
    db.select({ total: sql<number>`coalesce(sum(total_amount), 0)` }).from(ordersTable)
      .where(!isConsolidated && companyId !== null
        ? eq(ordersTable.companyId, companyId)
        : undefined),
    db.select({ count: sql<number>`count(*)` }).from(freightShipmentsTable)
      .where(freightCompanyFilter),
    db.select({ total: sql<number>`coalesce(sum(cost_price * quantity), 0)` }).from(stocksTable),
    db.select({ count: sql<number>`count(*)` }).from(productsTable)
      .where(sql`stock < 10`),
    db.select({ count: sql<number>`count(*)` }).from(freightShipmentsTable)
      .where(and(
        ne(freightShipmentsTable.status, "cancelled"),
        ne(freightShipmentsTable.status, "completed"),
        freightCompanyFilter,
      )),
    db.select({ count: sql<number>`count(*)` }).from(freightShipmentsTable)
      .where(and(eq(freightShipmentsTable.status, "rfq_sent"), freightCompanyFilter)),
    db.select({ count: sql<number>`count(*)` }).from(freightShipmentsTable)
      .where(and(eq(freightShipmentsTable.status, "in_transit"), freightCompanyFilter)),

    // Revenue dari sales orders bulan ini — pure raw SQL
    db.execute<{ total: string }>(sql`
      SELECT coalesce(sum(grand_total), 0)::text AS total
      FROM sales_documents
      WHERE kind = 'order'
        AND status IN ('confirmed','done')
        AND created_at >= ${startOfThisMonth}${companyFilterNoAlias}
    `),

    db.execute<{ total: string }>(sql`
      SELECT coalesce(sum(grand_total), 0)::text AS total
      FROM sales_documents
      WHERE kind = 'order'
        AND status IN ('confirmed','done')
        AND created_at >= ${startOfPrevMonth}
        AND created_at < ${endOfPrevMonth}${companyFilterNoAlias}
    `),

    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM sales_documents
      WHERE kind = 'order'
        AND status IN ('confirmed','done')
        AND created_at >= ${startOfThisMonth}${companyFilterNoAlias}
    `),

    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM sales_documents
      WHERE kind = 'order'
        AND status IN ('confirmed','done')
        AND created_at >= ${startOfPrevMonth}
        AND created_at < ${endOfPrevMonth}${companyFilterNoAlias}
    `),

    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM sales_documents
      WHERE kind = 'quote'
        AND status IN ('draft','sent')${companyFilterNoAlias}
    `),

    db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count
      FROM sales_documents
      WHERE kind = 'order'
        AND status = 'confirmed'${companyFilterNoAlias}
    `),

    db.execute<{ month: string; revenue: string }>(sql`
      SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
             coalesce(sum(grand_total), 0)::text AS revenue
      FROM sales_documents
      WHERE kind = 'order'
        AND status IN ('confirmed','done')
        AND created_at >= date_trunc('month', now()) - INTERVAL '5 months'${companyFilterNoAlias}
      GROUP BY date_trunc('month', created_at)
      ORDER BY 1
    `),

    db.execute<{
      company_id: string; company_name: string; company_code: string;
      revenue_this_month: string; revenue_prev_month: string;
      orders_this_month: string; total_revenue: string;
    }>(sql`
      SELECT
        c.id::text AS company_id,
        c.company_name,
        c.company_code,
        coalesce(sum(CASE WHEN sd.created_at >= ${startOfThisMonth} THEN sd.grand_total ELSE 0 END), 0)::text AS revenue_this_month,
        coalesce(sum(CASE WHEN sd.created_at >= ${startOfPrevMonth} AND sd.created_at < ${endOfPrevMonth} THEN sd.grand_total ELSE 0 END), 0)::text AS revenue_prev_month,
        coalesce(count(CASE WHEN sd.created_at >= ${startOfThisMonth} AND sd.kind = 'order' AND sd.status IN ('confirmed','done') THEN 1 END), 0)::text AS orders_this_month,
        coalesce(sum(sd.grand_total), 0)::text AS total_revenue
      FROM companies c
      LEFT JOIN sales_documents sd
        ON sd.company_id = c.id
        AND sd.kind = 'order'
        AND sd.status IN ('confirmed','done')
      WHERE c.is_active = true
        AND (${isConsolidated ? sql`1=1` : sql`c.id = ${companyId}`})
      GROUP BY c.id, c.company_name, c.company_code
      ORDER BY revenue_this_month DESC NULLS LAST
    `),
  ]);

  const trend = monthlyTrendRaw.rows.map((r) => ({
    month: r.month,
    revenue: Number(r.revenue),
  }));

  const companyBreakdown = perCompanyRaw.rows.map((r) => ({
    companyId: Number(r.company_id),
    companyName: r.company_name,
    companyCode: r.company_code,
    revenueThisMonth: Number(r.revenue_this_month),
    revenuePrevMonth: Number(r.revenue_prev_month),
    ordersThisMonth: Number(r.orders_this_month),
    totalRevenue: Number(r.total_revenue),
  }));

  const totalThisMonth = companyBreakdown.reduce((s, c) => s + c.revenueThisMonth, 0);
  const companyBreakdownWithPct = companyBreakdown.map((c) => ({
    ...c,
    contributionPct: totalThisMonth > 0 ? Math.round((c.revenueThisMonth / totalThisMonth) * 100) : 0,

  }))

  let perCompany: Array<{
    companyId: number; companyName: string; companyCode: string;
    revenueThisMonth: number; ordersThisMonth: number; contribution: number;
  }> = [];
  if (isConsolidated) {
    const breakdown = await db.execute<{
      company_id: string; company_name: string; company_code: string; revenue: string; orders: string;
    }>(sql`
      SELECT
        c.id::text AS company_id,
        c.company_name,
        c.company_code,
        coalesce(sum(CASE WHEN sd.kind = 'order' AND sd.status IN ('confirmed','done') AND sd.created_at >= date_trunc('month', now()) THEN sd.grand_total ELSE 0 END), 0)::text AS revenue,
        coalesce(count(CASE WHEN sd.kind = 'order' AND sd.status IN ('confirmed','done') AND sd.created_at >= date_trunc('month', now()) THEN 1 END), 0)::text AS orders
      FROM companies c
      LEFT JOIN sales_documents sd ON sd.company_id = c.id
      WHERE c.is_active = true AND c.is_holding = false
      GROUP BY c.id, c.company_name, c.company_code
      ORDER BY revenue DESC
    `);
    const totalRev = breakdown.rows.reduce((s, r) => s + Number(r.revenue), 0);
    perCompany = breakdown.rows.map((r) => ({
      companyId: Number(r.company_id),
      companyName: r.company_name,
      companyCode: r.company_code,
      revenueThisMonth: Number(r.revenue),
      ordersThisMonth: Number(r.orders),
      contribution: totalRev > 0 ? Math.round((Number(r.revenue) / totalRev) * 100) : 0,
    }));
  }

  return res.json({
    isConsolidated,
    scopeCompanyId: companyId,

    totalOrders: Number(orderCount?.count ?? 0),
    totalRevenue: Number(revenue?.total ?? 0),
    totalShipments: Number(shipmentCount?.count ?? 0),
    totalStockValue: Number(stockValue?.total ?? 0),
    lowStockCount: Number(lowStock?.count ?? 0),
    activeFreightCount: Number(activeFreight?.count ?? 0),
    awaitingQuoteCount: Number(awaitingQuote?.count ?? 0),
    inTransitCount: Number(inTransit?.count ?? 0),

    // Sales metrics (company-scoped)
    salesRevenueThisMonth: Number(salesRevenueThisMonthResult.rows[0]?.total ?? 0),
    salesRevenuePrevMonth: Number(salesRevenuePrevMonthResult.rows[0]?.total ?? 0),
    salesOrdersThisMonth: Number(salesOrdersThisMonthResult.rows[0]?.count ?? 0),
    salesOrdersPrevMonth: Number(salesOrdersPrevMonthResult.rows[0]?.count ?? 0),
    quotesActive: Number(quotesActiveResult.rows[0]?.count ?? 0),
    salesOrdersConfirmed: Number(salesOrdersConfirmedResult.rows[0]?.count ?? 0),
    monthlyRevenueTrend: trend,

    companyBreakdown: companyBreakdownWithPct,
  });
});

// GET /api/dashboard/response-times?path=<path-fragment>
router.get("/response-times", async (req, res) => {
  const pathFilter = typeof req.query["path"] === "string" ? req.query["path"] : undefined;
  const entries = await getRecentResponseTimesFromDb(pathFilter);
  return res.json({ entries });
});

// GET /api/dashboard/response-time-stats?path=<fragment>&window=<24h|7d|30d>
const WINDOW_INTERVALS: Record<string, string> = {
  "24h": "24 hours",
  "7d": "7 days",
  "30d": "30 days",
};

router.get("/response-time-stats", async (req, res) => {
  try {
    const windowParam = typeof req.query["window"] === "string" ? req.query["window"] : "24h";
    if (!(windowParam in WINDOW_INTERVALS)) {
      return res.status(400).json({ error: "Invalid window. Allowed: 24h, 7d, 30d" });
    }
    const intervalStr = WINDOW_INTERVALS[windowParam]!;
    const pathFilter = typeof req.query["path"] === "string" ? req.query["path"] : undefined;

    const result = await db.execute<{
      path: string; count: string; min_ms: string; max_ms: string; avg_ms: string; p95_ms: string;
    }>(
      pathFilter
        ? sql`
            SELECT path, COUNT(*) AS count, MIN(duration_ms) AS min_ms, MAX(duration_ms) AS max_ms,
                   ROUND(AVG(duration_ms)) AS avg_ms,
                   PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
            FROM api_response_times
            WHERE timestamp >= NOW() - ${intervalStr}::interval AND path LIKE ${`%${pathFilter}%`}
            GROUP BY path ORDER BY count DESC`
        : sql`
            SELECT path, COUNT(*) AS count, MIN(duration_ms) AS min_ms, MAX(duration_ms) AS max_ms,
                   ROUND(AVG(duration_ms)) AS avg_ms,
                   PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms) AS p95_ms
            FROM api_response_times
            WHERE timestamp >= NOW() - ${intervalStr}::interval
            GROUP BY path ORDER BY count DESC`,
    );

    return res.json({
      stats: result.rows.map((row) => ({
        path: row.path,
        count: Number(row.count),
        minMs: Number(row.min_ms),
        maxMs: Number(row.max_ms),
        avgMs: Number(row.avg_ms),
        p95Ms: Math.round(Number(row.p95_ms)),
      })),
    });
  } catch {
    return res.json({ stats: [] });
  }
});

// GET /api/dashboard/analytics?period=30d&companyId=N
router.get("/analytics", async (req, res) => {
  const period = String(req.query.period ?? "30d");
  const { companyId } = parseCompanyParam(req);

  const intervalMap: Record<string, string> = {
    "7d": "7 days", "30d": "30 days", "90d": "90 days", "1y": "1 year",
  };
  const interval = intervalMap[period] ?? "30 days";

  const companyFilter = companyId ? sql` AND company_id = ${companyId}` : sql``;

  try {
    const [rfqStats, orderStats, revenueStats, topCustomers, orderStatusCounts, rfqThisPeriod, ordersThisPeriod] = await Promise.all([
      // Total RFQ
      db.execute(sql`SELECT count(*)::int AS total FROM logistic_order_rfqs WHERE 1=1 ${companyFilter}`),
      // Total orders
      db.execute(sql`SELECT count(*)::int AS total FROM logistic_orders WHERE 1=1 ${companyFilter}`),
      // Revenue & profit
      db.execute(sql`
        SELECT
          COALESCE(SUM(grand_total::numeric), 0)::numeric AS total_revenue,
          COALESCE(SUM(final_selling_price::numeric) - SUM(subtotal::numeric), 0)::numeric AS gross_profit
        FROM logistic_orders
        WHERE status NOT IN ('Cancelled', 'cancelled')
        AND created_at >= NOW() - INTERVAL '${sql.raw(interval)}'
        ${companyFilter}
      `),
      // Top customers by repeat order
      db.execute(sql`
        SELECT customer_name, count(*)::int AS order_count
        FROM logistic_orders
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(interval)}'
        ${companyFilter}
        GROUP BY customer_name
        ORDER BY order_count DESC
        LIMIT 10
      `),
      // Order status distribution
      db.execute(sql`
        SELECT status, count(*)::int AS cnt
        FROM logistic_orders
        WHERE 1=1 ${companyFilter}
        GROUP BY status
        ORDER BY cnt DESC
      `),
      // RFQ this period
      db.execute(sql`
        SELECT count(*)::int AS total FROM logistic_order_rfqs
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(interval)}'
      `),
      // Orders this period
      db.execute(sql`
        SELECT count(*)::int AS total FROM logistic_orders
        WHERE created_at >= NOW() - INTERVAL '${sql.raw(interval)}'
        ${companyFilter}
      `),
    ]);

    // Avg response from RFQ vendor links
    const avgResp = await db.execute(sql`
      SELECT avg(extract(epoch from (submitted_at - created_at)) / 60)::numeric(10,2) AS avg_min
      FROM rfq_vendor_links
      WHERE submitted_at IS NOT NULL
      AND created_at >= NOW() - INTERVAL '${sql.raw(interval)}'
    `);

    // Approval rate
    const approvalStats = await db.execute(sql`
      SELECT
        count(*)::int AS total,
        count(*) filter (where customer_confirm_status = 'confirmed')::int AS confirmed
      FROM logistic_orders
      WHERE created_at >= NOW() - INTERVAL '${sql.raw(interval)}'
      ${companyFilter}
    `);

    const rev = revenueStats.rows[0] as { total_revenue: string; gross_profit: string };
    const appr = approvalStats.rows[0] as { total: number; confirmed: number };
    const totalRevenue = Number(rev?.total_revenue ?? 0);
    const grossProfit = Number(rev?.gross_profit ?? 0);
    const marginPct = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0;

    const orderStatusCountsMap: Record<string, number> = {};
    for (const row of orderStatusCounts.rows as { status: string; cnt: number }[]) {
      orderStatusCountsMap[row.status] = row.cnt;
    }

    res.json({
      totalRfq: (rfqStats.rows[0] as { total: number }).total,
      totalOrders: (orderStats.rows[0] as { total: number }).total,
      rfqThisPeriod: (rfqThisPeriod.rows[0] as { total: number }).total,
      ordersThisPeriod: (ordersThisPeriod.rows[0] as { total: number }).total,
      totalRevenue,
      grossProfit,
      marginPct: Number(marginPct.toFixed(1)),
      avgResponseMin: (avgResp.rows[0] as { avg_min: string })?.avg_min ?? null,
      approvalRate: appr?.total > 0 ? (appr.confirmed / appr.total) * 100 : 0,
      topCustomers: topCustomers.rows,
      orderStatusCounts: orderStatusCountsMap,
    });
  } catch (e) {
    res.status(500).json({ error: "Gagal memuat analytics" });
  }
});

// ── CEO / Director Dashboard ──────────────────────────────────────────────
// GET /api/dashboard/ceo?companyId=N|all
router.get("/ceo", async (req, res) => {
  const { isConsolidated, companyId } = parseCompanyParam(req);
  const cf = (!isConsolidated && companyId !== null) ? sql` AND company_id = ${companyId}` : sql``;
  const cfSd = (!isConsolidated && companyId !== null) ? sql` AND (sd.company_id = ${companyId} OR sd.company_id IS NULL)` : sql``;

  const now = new Date();
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const SLA_DAYS = 7;

  try {
    const [
      ordersCreatedTodayRes,
      rfqSentTodayRes,
      revenueTodayRes,
      grossMarginTodayRes,
      openExceptionsRes,
      slaViolationsRes,
      orderVolumeMonthRes,
      orderVolumePrevRes,
      topCustomersRes,
      topVendorsRes,
      conversionRateRes,
      paymentCollectionRes,
      revenueTrendRes,
      rfqResponseTrendRes,
      vendorRankingRes,
      slaComplianceTrendRes,
    ] = await Promise.all([
      // Today: orders created
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE created_at >= ${todayStart} ${cf}
      `),
      // Today: RFQ sent
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_order_rfqs
        WHERE created_at >= ${todayStart} ${cf}
      `),
      // Today: revenue from sales orders
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(grand_total::numeric), 0)::text AS total
        FROM sales_documents sd
        WHERE kind = 'order' AND status IN ('confirmed','done')
        AND created_at >= ${todayStart} ${cfSd}
      `),
      // Today: gross margin from logistic orders
      db.execute<{ revenue: string; cost: string }>(sql`
        SELECT
          COALESCE(SUM(grand_total::numeric), 0)::text AS revenue,
          COALESCE(SUM(subtotal::numeric), 0)::text AS cost
        FROM logistic_orders
        WHERE created_at >= ${todayStart}
        AND status NOT IN ('Cancelled','cancelled') ${cf}
      `),
      // Open exceptions (all-time open)
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM exceptions
        WHERE status = 'open'
        ${(!isConsolidated && companyId !== null) ? sql` AND company_id = ${companyId}` : sql``}
      `),
      // SLA violations: orders still active beyond SLA_DAYS
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status NOT IN ('Completed','Cancelled','delivered','Delivered','cancelled')
        AND created_at < NOW() - INTERVAL '${sql.raw(String(SLA_DAYS))} days' ${cf}
      `),
      // This month: order volume
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE created_at >= ${monthStart}
        AND status NOT IN ('Cancelled','cancelled') ${cf}
      `),
      // Prev month: order volume
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE created_at >= ${prevMonthStart} AND created_at < ${monthStart}
        AND status NOT IN ('Cancelled','cancelled') ${cf}
      `),
      // This month: top 10 customers by order count
      db.execute<{ customer_name: string; order_count: string; revenue: string }>(sql`
        SELECT customer_name,
               count(*)::text AS order_count,
               COALESCE(SUM(grand_total::numeric),0)::text AS revenue
        FROM logistic_orders
        WHERE created_at >= ${monthStart}
        AND status NOT IN ('Cancelled','cancelled') ${cf}
        GROUP BY customer_name
        ORDER BY order_count DESC NULLS LAST
        LIMIT 10
      `),
      // This month: top 10 vendors by assigned orders
      db.execute<{ vendor_id: string; vendor_name: string; order_count: string; success_rate: string }>(sql`
        SELECT
          s.id::text AS vendor_id,
          s.name AS vendor_name,
          count(lo.id)::text AS order_count,
          (count(lo.id) FILTER (WHERE lo.status ILIKE '%completed%' OR lo.status ILIKE '%delivered%')
           * 100.0 / NULLIF(count(lo.id), 0))::numeric(5,1)::text AS success_rate
        FROM suppliers s
        JOIN logistic_orders lo ON lo.approved_vendor_id = s.id
          AND lo.created_at >= ${monthStart} ${cf}
        GROUP BY s.id, s.name
        ORDER BY count(lo.id) DESC NULLS LAST
        LIMIT 10
      `),
      // This month: conversion rate (orders confirmed / total orders incl unconfirmed)
      db.execute<{ total: string; confirmed: string }>(sql`
        SELECT
          count(*)::text AS total,
          count(*) FILTER (WHERE customer_confirm_status = 'confirmed')::text AS confirmed
        FROM logistic_orders
        WHERE created_at >= ${monthStart} ${cf}
      `),
      // This month: payment collection from accounting (credit entries to receivable/cash)
      db.execute<{ collected: string }>(sql`
        SELECT COALESCE(SUM(amount::numeric), 0)::text AS collected
        FROM accounting_entries
        WHERE entry_type = 'credit'
        AND account_id IN (
          SELECT id FROM chart_of_accounts WHERE code LIKE '1%' AND (name ILIKE '%cash%' OR name ILIKE '%bank%' OR name ILIKE '%kas%')
        )
        AND created_at >= ${monthStart}
        ${(!isConsolidated && companyId !== null) ? sql` AND company_id = ${companyId}` : sql``}
      `),
      // Revenue trend: last 6 months
      db.execute<{ month: string; revenue: string; profit: string }>(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
          COALESCE(SUM(grand_total::numeric), 0)::text AS revenue,
          COALESCE(SUM(grand_total::numeric) - SUM(subtotal::numeric), 0)::text AS profit
        FROM logistic_orders
        WHERE status NOT IN ('Cancelled','cancelled')
        AND created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months' ${cf}
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY 1 ASC
      `),
      // RFQ response time trend: last 6 months avg minutes
      db.execute<{ month: string; avg_min: string; total_rfq: string }>(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', rvl.created_at), 'YYYY-MM') AS month,
          AVG(EXTRACT(EPOCH FROM (rvl.submitted_at - rvl.created_at)) / 60)::numeric(8,1)::text AS avg_min,
          count(*)::text AS total_rfq
        FROM rfq_vendor_links rvl
        WHERE rvl.submitted_at IS NOT NULL
        AND rvl.created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months'
        GROUP BY DATE_TRUNC('month', rvl.created_at)
        ORDER BY 1 ASC
      `),
      // Vendor ranking: top 5 by recommendation score
      db.execute<{ vendor_id: string; vendor_name: string; score: string; ontime: string; total_orders: string; response_min: string }>(sql`
        SELECT
          s.id::text AS vendor_id,
          s.name AS vendor_name,
          COALESCE(vp.recommendation_score, 0)::text AS score,
          COALESCE(vp.ontime_percentage, 0)::text AS ontime,
          COALESCE(vp.total_orders, 0)::text AS total_orders,
          COALESCE(vp.average_response_minutes, 0)::text AS response_min
        FROM suppliers s
        LEFT JOIN vendor_performance vp ON vp.vendor_id = s.id
        WHERE s.is_active = true
        ORDER BY COALESCE(vp.recommendation_score, 0) DESC NULLS LAST
        LIMIT 5
      `),
      // SLA compliance trend: last 6 months — % orders completed within SLA window
      db.execute<{ month: string; total: string; on_time: string }>(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
          count(*)::text AS total,
          count(*) FILTER (
            WHERE (status ILIKE '%completed%' OR status ILIKE '%delivered%')
            AND updated_at <= created_at + INTERVAL '${sql.raw(String(SLA_DAYS))} days'
          )::text AS on_time
        FROM logistic_orders
        WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '5 months' ${cf}
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY 1 ASC
      `),
    ]);

    const gm = grossMarginTodayRes.rows[0] as { revenue: string; cost: string } | undefined;
    const gmRevenue = Number(gm?.revenue ?? 0);
    const gmCost = Number(gm?.cost ?? 0);
    const grossMarginToday = gmRevenue > 0 ? ((gmRevenue - gmCost) / gmRevenue) * 100 : 0;

    const conv = conversionRateRes.rows[0] as { total: string; confirmed: string } | undefined;
    const convTotal = Number(conv?.total ?? 0);
    const convConfirmed = Number(conv?.confirmed ?? 0);
    const conversionRate = convTotal > 0 ? (convConfirmed / convTotal) * 100 : 0;

    const orderVolumeThisMonth = Number((orderVolumeMonthRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0);
    const orderVolumePrevMonth = Number((orderVolumePrevRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0);
    const orderVolumeChange = orderVolumePrevMonth > 0
      ? ((orderVolumeThisMonth - orderVolumePrevMonth) / orderVolumePrevMonth) * 100
      : null;

    return res.json({
      // Today
      ordersCreatedToday: Number((ordersCreatedTodayRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0),
      rfqSentToday: Number((rfqSentTodayRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0),
      revenueToday: Number((revenueTodayRes.rows[0] as { total: string } | undefined)?.total ?? 0),
      grossMarginTodayPct: Number(grossMarginToday.toFixed(1)),
      openExceptions: Number((openExceptionsRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0),
      slaViolations: Number((slaViolationsRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0),

      // This month
      orderVolumeThisMonth,
      orderVolumePrevMonth,
      orderVolumeChangePct: orderVolumeChange !== null ? Number(orderVolumeChange.toFixed(1)) : null,
      conversionRatePct: Number(conversionRate.toFixed(1)),
      paymentCollection: Number((paymentCollectionRes.rows[0] as { collected: string } | undefined)?.collected ?? 0),
      topCustomers: (topCustomersRes.rows as { customer_name: string; order_count: string; revenue: string }[]).map(r => ({
        name: r.customer_name,
        orderCount: Number(r.order_count),
        revenue: Number(r.revenue),
      })),
      topVendors: (topVendorsRes.rows as { vendor_id: string; vendor_name: string; order_count: string; success_rate: string }[]).map(r => ({
        vendorId: Number(r.vendor_id),
        name: r.vendor_name,
        orderCount: Number(r.order_count),
        successRate: Number(r.success_rate ?? 0),
      })),

      // Widget data
      revenueTrend: (revenueTrendRes.rows as { month: string; revenue: string; profit: string }[]).map(r => ({
        month: r.month,
        revenue: Number(r.revenue),
        profit: Number(r.profit),
      })),
      rfqResponseTrend: (rfqResponseTrendRes.rows as { month: string; avg_min: string; total_rfq: string }[]).map(r => ({
        month: r.month,
        avgMin: Number(r.avg_min ?? 0),
        totalRfq: Number(r.total_rfq),
      })),
      vendorRanking: (vendorRankingRes.rows as { vendor_id: string; vendor_name: string; score: string; ontime: string; total_orders: string; response_min: string }[]).map(r => ({
        vendorId: Number(r.vendor_id),
        name: r.vendor_name,
        score: Number(r.score ?? 0),
        ontimePct: Number(r.ontime ?? 0),
        totalOrders: Number(r.total_orders ?? 0),
        avgResponseMin: Number(r.response_min ?? 0),
      })),
      slaComplianceTrend: (slaComplianceTrendRes.rows as { month: string; total: string; on_time: string }[]).map(r => ({
        month: r.month,
        total: Number(r.total),
        onTime: Number(r.on_time),
        compliancePct: Number(r.total) > 0
          ? Number(((Number(r.on_time) / Number(r.total)) * 100).toFixed(1))
          : 0,
      })),
    });
  } catch (e) {
    console.error("[dashboard/ceo] error:", e);
    return res.status(500).json({ error: "Gagal memuat CEO dashboard" });
  }
});

// ── Enterprise Admin Dashboard ─────────────────────────────────────────────
// GET /api/dashboard/enterprise?companyId=N|all
router.get("/enterprise", async (req, res) => {
  const { isConsolidated, companyId } = parseCompanyParam(req);
  const cf = (!isConsolidated && companyId !== null)
    ? sql` AND (company_id = ${companyId} OR company_id IS NULL)`
    : sql``;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = startOfMonth;

  try {
    const [
      totalOrdersRes,
      pendingRfqRes,
      pendingApprovalRes,
      inTransitRes,
      deliveredRes,
      revenueThisMonthRes,
      revenueLastMonthRes,
      cancelledRes,
      vendorPerfRes,
      dailyTrendRes,
      statusBreakdownRes,
      topCustomersRes,
    ] = await Promise.all([
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders WHERE 1=1 ${cf}
      `),
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_order_rfqs
        WHERE status IN ('pending','open','sent','blasted') ${cf}
      `),
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE (customer_confirm_status = 'pending' OR status = 'New Order')
          AND status != 'Cancelled' ${cf}
      `),
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('In Progress','in_transit','In Transit') ${cf}
      `),
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('Completed','delivered','Delivered') ${cf}
      `),
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(grand_total::numeric), 0)::text AS total
        FROM logistic_orders
        WHERE status NOT IN ('Cancelled','cancelled')
          AND created_at >= ${startOfMonth} ${cf}
      `),
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(grand_total::numeric), 0)::text AS total
        FROM logistic_orders
        WHERE status NOT IN ('Cancelled','cancelled')
          AND created_at >= ${startOfLastMonth}
          AND created_at < ${endOfLastMonth} ${cf}
      `),
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('Cancelled','cancelled') ${cf}
      `),
      db.execute<{ supplier_id: string; name: string; score: string; completed: string; on_time: string }>(sql`
        SELECT vp.supplier_id::text, s.name, vp.score::text,
               vp.completed_orders::text AS completed,
               vp.on_time_rate::text AS on_time
        FROM vendor_performance vp
        LEFT JOIN suppliers s ON s.id = vp.supplier_id
        ORDER BY vp.score DESC NULLS LAST
        LIMIT 5
      `),
      db.execute<{ day: string; revenue: string; orders: string }>(sql`
        SELECT
          to_char(date_trunc('day', created_at), 'YYYY-MM-DD') AS day,
          COALESCE(SUM(grand_total::numeric), 0)::text AS revenue,
          count(*)::text AS orders
        FROM logistic_orders
        WHERE created_at >= NOW() - INTERVAL '30 days'
          AND status NOT IN ('Cancelled','cancelled') ${cf}
        GROUP BY date_trunc('day', created_at)
        ORDER BY 1
      `),
      db.execute<{ status: string; cnt: string }>(sql`
        SELECT status, count(*)::text AS cnt
        FROM logistic_orders WHERE 1=1 ${cf}
        GROUP BY status ORDER BY cnt::int DESC
      `),
      db.execute<{ customer_name: string; cnt: string; revenue: string }>(sql`
        SELECT customer_name,
               count(*)::text AS cnt,
               COALESCE(SUM(grand_total::numeric), 0)::text AS revenue
        FROM logistic_orders
        WHERE created_at >= NOW() - INTERVAL '90 days' ${cf}
        GROUP BY customer_name
        ORDER BY cnt::int DESC
        LIMIT 8
      `),
    ]);

    const revenueThis = Number(revenueThisMonthRes.rows[0]?.total ?? 0);
    const revenueLast = Number(revenueLastMonthRes.rows[0]?.total ?? 0);
    const revenueGrowth = revenueLast > 0
      ? ((revenueThis - revenueLast) / revenueLast) * 100
      : revenueThis > 0 ? 100 : 0;

    return res.json({
      // Core KPIs
      totalOrders: Number(totalOrdersRes.rows[0]?.cnt ?? 0),
      pendingRfq: Number(pendingRfqRes.rows[0]?.cnt ?? 0),
      pendingApproval: Number(pendingApprovalRes.rows[0]?.cnt ?? 0),
      inTransit: Number(inTransitRes.rows[0]?.cnt ?? 0),
      delivered: Number(deliveredRes.rows[0]?.cnt ?? 0),
      cancelled: Number(cancelledRes.rows[0]?.cnt ?? 0),
      revenueThisMonth: revenueThis,
      revenueLastMonth: revenueLast,
      revenueGrowthPct: Number(revenueGrowth.toFixed(1)),
      // Vendor performance
      topVendors: vendorPerfRes.rows.map((r) => ({
        supplierId: Number(r.supplier_id),
        name: r.name,
        score: Number(r.score ?? 0),
        completedOrders: Number(r.completed ?? 0),
        onTimeRate: Number(r.on_time ?? 0),
      })),
      // Trend
      dailyTrend: dailyTrendRes.rows.map((r) => ({
        day: r.day,
        revenue: Number(r.revenue),
        orders: Number(r.orders),
      })),
      // Status breakdown for donut
      statusBreakdown: statusBreakdownRes.rows.map((r) => ({
        status: r.status,
        count: Number(r.cnt),
      })),
      // Top customers
      topCustomers: topCustomersRes.rows.map((r) => ({
        name: r.customer_name,
        orders: Number(r.cnt),
        revenue: Number(r.revenue),
      })),
    });
  } catch (e) {
    console.error("enterprise dashboard error", e);
    return res.status(500).json({ error: "Gagal memuat enterprise dashboard" });
  }
});

// ── GET /api/dashboard/operational ──────────────────────────────────────────
// Real-time operational snapshot untuk tim operasional.
router.get("/operational", async (req, res) => {
  const { isConsolidated, companyId } = parseCompanyParam(req);
  const cf = (!isConsolidated && companyId !== null)
    ? sql` AND company_id = ${companyId}`
    : sql``;

  try {
    const [
      todayRes,
      pendingRfqRes,
      waitingVendorRes,
      waitingCustomerRes,
      inFulfillmentRes,
      podCompletedRes,
      failedWaRes,
      recentOrdersRes,
    ] = await Promise.all([
      // Today's orders
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE created_at >= date_trunc('day', NOW()) ${cf}
      `),
      // Pending RFQ — order masuk, belum ada tindakan RFQ
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('Order Received','Admin Review')
          AND status NOT IN ('Cancelled','cancelled') ${cf}
      `),
      // Waiting Vendor — sudah blast RFQ, vendor belum balas
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('RFQ Sent','Quote Received') ${cf}
      `),
      // Waiting Customer — quote sudah dikirim ke customer, menunggu approval
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status = 'Customer Approval' ${cf}
      `),
      // In Fulfillment — proses aktif (confirmed → delivered)
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('Vendor Confirmed','In Progress','Pickup','In Transit','Arrived','Delivered') ${cf}
      `),
      // POD Completed — sudah ada bukti pengiriman
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM logistic_orders
        WHERE status IN ('POD Uploaded','Invoice Issued','Payment Received','Completed') ${cf}
      `),
      // Failed WA — notif WA gagal & sudah exhausted retries (retry_count >= 3)
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM notification_logs
        WHERE channel = 'wa' AND status = 'failed' AND retry_count >= 3
          AND created_at >= NOW() - INTERVAL '7 days'
      `),
      // Recent 20 active orders (non-cancelled, non-completed)
      db.execute<{
        order_number: string; status: string; customer_name: string;
        origin: string; destination: string; created_at: string;
        transport_mode: string | null; approved_vendor_id: string | null;
      }>(sql`
        SELECT order_number, status, customer_name, origin, destination,
               to_char(created_at, 'YYYY-MM-DD HH24:MI') AS created_at,
               transport_mode, approved_vendor_id::text
        FROM logistic_orders
        WHERE status NOT IN ('Completed','Cancelled','cancelled') ${cf}
        ORDER BY created_at DESC
        LIMIT 20
      `),
    ]);

    return res.json({
      todayOrders: Number(todayRes.rows[0]?.cnt ?? 0),
      pendingRfq: Number(pendingRfqRes.rows[0]?.cnt ?? 0),
      waitingVendor: Number(waitingVendorRes.rows[0]?.cnt ?? 0),
      waitingCustomer: Number(waitingCustomerRes.rows[0]?.cnt ?? 0),
      inFulfillment: Number(inFulfillmentRes.rows[0]?.cnt ?? 0),
      podCompleted: Number(podCompletedRes.rows[0]?.cnt ?? 0),
      failedWa: Number(failedWaRes.rows[0]?.cnt ?? 0),
      recentOrders: recentOrdersRes.rows.map((r) => ({
        orderNumber: r.order_number,
        status: r.status,
        customerName: r.customer_name,
        origin: r.origin,
        destination: r.destination,
        createdAt: r.created_at,
        transportMode: r.transport_mode ?? null,
        hasVendor: !!r.approved_vendor_id,
      })),
    });
  } catch (e) {
    console.error("operational dashboard error", e);
    return res.status(500).json({ error: "Gagal memuat operational dashboard" });
  }
});

// GET /api/dashboard/cross-module?companyId=N|all
// Returns Sport Centre + Sales summary for the current & previous month
router.get("/cross-module", async (req, res) => {
  const { isConsolidated, companyId } = parseCompanyParam(req);
  const cf = (!isConsolidated && companyId !== null)
    ? sql` AND (company_id = ${companyId} OR company_id IS NULL)`
    : sql``;

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const endOfLastMonth = startOfMonth;

  try {
    const [
      scBookingsThisRes,
      scBookingsLastRes,
      scRevenueThisRes,
      scRevenueLastRes,
      scTopFacilityRes,
      salesCountThisRes,
      salesCountLastRes,
      salesRevenueThisRes,
      salesRevenueLastRes,
    ] = await Promise.all([
      // Sport Centre – bookings count this month (pakai booking_date, konsisten dgn sport center module)
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM sport_bookings
        WHERE status NOT IN ('cancelled','Cancelled')
          AND booking_date >= ${startOfMonth.toISOString().slice(0, 10)}::date ${cf}
      `),
      // Sport Centre – bookings count last month
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM sport_bookings
        WHERE status NOT IN ('cancelled','Cancelled')
          AND booking_date >= ${startOfLastMonth.toISOString().slice(0, 10)}::date
          AND booking_date < ${endOfLastMonth.toISOString().slice(0, 10)}::date ${cf}
      `),
      // Sport Centre – revenue this month dari sport_bookings.total_amount (paid)
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(total_amount::numeric), 0)::text AS total
        FROM sport_bookings
        WHERE payment_status IN ('paid','Paid')
          AND status NOT IN ('cancelled','Cancelled')
          AND booking_date >= ${startOfMonth.toISOString().slice(0, 10)}::date ${cf}
      `),
      // Sport Centre – revenue last month
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(total_amount::numeric), 0)::text AS total
        FROM sport_bookings
        WHERE payment_status IN ('paid','Paid')
          AND status NOT IN ('cancelled','Cancelled')
          AND booking_date >= ${startOfLastMonth.toISOString().slice(0, 10)}::date
          AND booking_date < ${endOfLastMonth.toISOString().slice(0, 10)}::date ${cf}
      `),
      // Sport Centre – top facilities this month
      db.execute<{ name: string; cnt: string; revenue: string }>(sql`
        SELECT COALESCE(facility_name, '—') AS name,
               count(id)::text AS cnt,
               COALESCE(SUM(total_amount::numeric), 0)::text AS revenue
        FROM sport_bookings
        WHERE status NOT IN ('cancelled','Cancelled')
          AND booking_date >= ${startOfMonth.toISOString().slice(0, 10)}::date ${cf}
        GROUP BY facility_name
        ORDER BY cnt::int DESC
        LIMIT 5
      `),
      // Sales – confirmed docs count this month
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM sales_documents
        WHERE status NOT IN ('draft','cancelled')
          AND created_at >= ${startOfMonth} ${cf}
      `),
      // Sales – confirmed docs count last month
      db.execute<{ cnt: string }>(sql`
        SELECT count(*)::text AS cnt FROM sales_documents
        WHERE status NOT IN ('draft','cancelled')
          AND created_at >= ${startOfLastMonth}
          AND created_at < ${endOfLastMonth} ${cf}
      `),
      // Sales – revenue this month
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(grand_total::numeric), 0)::text AS total
        FROM sales_documents
        WHERE status NOT IN ('draft','cancelled')
          AND created_at >= ${startOfMonth} ${cf}
      `),
      // Sales – revenue last month
      db.execute<{ total: string }>(sql`
        SELECT COALESCE(SUM(grand_total::numeric), 0)::text AS total
        FROM sales_documents
        WHERE status NOT IN ('draft','cancelled')
          AND created_at >= ${startOfLastMonth}
          AND created_at < ${endOfLastMonth} ${cf}
      `),
    ]);

    const scRevThis = Number(scRevenueThisRes.rows[0]?.total ?? 0);
    const scRevLast = Number(scRevenueLastRes.rows[0]?.total ?? 0);
    const scGrowth = scRevLast > 0
      ? ((scRevThis - scRevLast) / scRevLast) * 100
      : scRevThis > 0 ? 100 : 0;

    const salesRevThis = Number(salesRevenueThisRes.rows[0]?.total ?? 0);
    const salesRevLast = Number(salesRevenueLastRes.rows[0]?.total ?? 0);
    const salesGrowth = salesRevLast > 0
      ? ((salesRevThis - salesRevLast) / salesRevLast) * 100
      : salesRevThis > 0 ? 100 : 0;

    return res.json({
      sportCenter: {
        bookingsThisMonth: Number(scBookingsThisRes.rows[0]?.cnt ?? 0),
        bookingsLastMonth: Number(scBookingsLastRes.rows[0]?.cnt ?? 0),
        revenueThisMonth: scRevThis,
        revenueLastMonth: scRevLast,
        growthPct: Number(scGrowth.toFixed(1)),
        topFacilities: scTopFacilityRes.rows.map((r) => ({
          name: r.name ?? "—",
          bookings: Number(r.cnt),
          revenue: Number(r.revenue),
        })),
      },
      sales: {
        countThisMonth: Number(salesCountThisRes.rows[0]?.cnt ?? 0),
        countLastMonth: Number(salesCountLastRes.rows[0]?.cnt ?? 0),
        revenueThisMonth: salesRevThis,
        revenueLastMonth: salesRevLast,
        growthPct: Number(salesGrowth.toFixed(1)),
      },
    });
  } catch (e) {
    console.error("cross-module dashboard error", e);
    return res.status(500).json({ error: "Gagal memuat cross-module dashboard" });
  }
});

export default router;

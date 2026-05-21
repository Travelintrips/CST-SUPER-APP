import { Router } from "express";
import {
  db, ordersTable, shipmentsTable, stocksTable, transactionsTable, productsTable,
  freightShipmentsTable, salesDocumentsTable,
} from "@workspace/db";
import { sql, and, ne, eq } from "drizzle-orm";
import { getRecentResponseTimesFromDb } from "../lib/responseTimeLog";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

// ?companyId=N  → single company mode
// ?companyId=all or omitted → consolidated mode
function parseCompanyParam(raw: unknown): { isConsolidated: boolean; companyId: number | null } {
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
  const { isConsolidated, companyId } = parseCompanyParam(req.query.companyId);
  const branchId = typeof req.query["branchId"] === "string" ? Number(req.query["branchId"]) : null;
  const dimension = (req.query["dimension"] as string) || "branch"; // branch | division | department

  const companyFilter = (!isConsolidated && companyId !== null)
    ? sql` AND (o.company_id = ${companyId} OR o.company_id IS NULL)`
    : sql``;
  const branchFilter = branchId ? sql` AND o.branch_id = ${branchId}` : sql``;

  // POS revenue breakdown by branch
  const posBranchRows = await db.execute<{
    branch_id: string; branch_name: string;
    revenue: string; order_count: string;
  }>(sql`
    SELECT
      b.id::text AS branch_id,
      b.name AS branch_name,
      COALESCE(SUM(o.total::numeric), 0)::text AS revenue,
      COUNT(o.id)::text AS order_count
    FROM pos_branches b
    LEFT JOIN pos_orders o ON o.branch_id = b.id AND o.status = 'paid'
      AND o.created_at >= date_trunc('month', NOW())
    WHERE 1=1 ${companyFilter}
    GROUP BY b.id, b.name
    ORDER BY revenue DESC NULLS LAST
  `);

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
    byBranch: posBranchRows.rows.map((r) => ({
      branchId: Number(r.branch_id),
      branchName: r.branch_name,
      revenue: Number(r.revenue),
      orderCount: Number(r.order_count),
    })),
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
  const { isConsolidated, companyId } = parseCompanyParam(req.query.companyId);

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
    [todayTx],
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
    db.select({ count: sql<number>`count(*)` }).from(ordersTable),
    db.select({ total: sql<number>`coalesce(sum(total_amount), 0)` }).from(ordersTable),
    db.select({ count: sql<number>`count(*)` }).from(shipmentsTable),
    db.select({ total: sql<number>`coalesce(sum(cost_price * quantity), 0)` }).from(stocksTable),
    db.select({ count: sql<number>`count(*)` }).from(transactionsTable)
      .where(sql`created_at >= ${today.toISOString()}`),
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
    todayTransactions: Number(todayTx?.count ?? 0),
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
  const { companyId } = parseCompanyParam(req.query.companyId);

  const intervalMap: Record<string, string> = {
    "7d": "7 days", "30d": "30 days", "90d": "90 days", "1y": "1 year",
  };
  const interval = intervalMap[period] ?? "30 days";

  const companyFilter = companyId ? sql` AND company_id = ${companyId}` : sql``;

  try {
    const [rfqStats, orderStats, revenueStats, topCustomers, orderStatusCounts, rfqThisPeriod, ordersThisPeriod] = await Promise.all([
      // Total RFQ
      db.execute(sql`SELECT count(*)::int AS total FROM logistic_order_rfqs`),
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

export default router;

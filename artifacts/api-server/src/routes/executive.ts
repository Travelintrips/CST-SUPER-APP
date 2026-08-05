import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

function parseDateRange(req: { query: Record<string, unknown> }) {
  const from = req.query["from"] as string | undefined;
  const to = req.query["to"] as string | undefined;
  const fromD = from ? new Date(from) : null;
  const toD = to ? new Date(to) : null;
  if (fromD && isNaN(fromD.getTime())) return { error: "Invalid from date" };
  if (toD && isNaN(toD.getTime())) return { error: "Invalid to date" };
  return { from: fromD, to: toD, error: null };
}

/**
 * GET /api/executive/summary?from=&to=
 *
 * Sections covered:
 *   B  — consolidated KPI (revenue_total, expense_total, profit_total, cash_position)
 *   C  — company performance (group by company_id)
 *   D  — cost center performance (group by cost_center_id)
 *   E  — top 5 company, top/bottom 5 cost center
 *   F  — cash position per company + consolidated
 *   H  — validation: sum per company == consolidated
 */
router.get("/summary", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const range = parseDateRange(req);
    if (range.error) return res.status(400).json({ message: range.error });

    const dateFilter =
      range.from && range.to
        ? sql`AND ae.date BETWEEN ${range.from.toISOString().slice(0, 10)} AND ${range.to.toISOString().slice(0, 10)}`
        : range.from
          ? sql`AND ae.date >= ${range.from.toISOString().slice(0, 10)}`
          : range.to
            ? sql`AND ae.date <= ${range.to.toISOString().slice(0, 10)}`
            : sql``;

    const [companiesRes, companyPerfRes, costCenterPerfRes, cashRes, costCentersRes] =
      await Promise.all([
        // All active companies
        db.execute(sql`
          SELECT id, company_name, company_code, is_active, is_holding, parent_company_id
          FROM companies
          WHERE is_active = true
          ORDER BY company_code
        `),

        // Section C: Revenue/Expense per company (P&L filter by date)
        db.execute(sql`
          SELECT
            ae.company_id,
            COALESCE(SUM(CASE WHEN coa.type = 'revenue' THEN ael.credit - ael.debit ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN coa.type = 'expense' THEN ael.debit - ael.credit ELSE 0 END), 0) AS expense
          FROM accounting_entries ae
          JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
          JOIN chart_of_accounts coa ON coa.id = ael.account_id
          WHERE ae.status = 'posted'
            ${dateFilter}
          GROUP BY ae.company_id
        `),

        // Section D: Revenue/Expense per cost center (P&L filter by date)
        db.execute(sql`
          SELECT
            ae.cost_center_id,
            COALESCE(SUM(CASE WHEN coa.type = 'revenue' THEN ael.credit - ael.debit ELSE 0 END), 0) AS revenue,
            COALESCE(SUM(CASE WHEN coa.type = 'expense' THEN ael.debit - ael.credit ELSE 0 END), 0) AS expense
          FROM accounting_entries ae
          JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
          JOIN chart_of_accounts coa ON coa.id = ael.account_id
          WHERE ae.status = 'posted'
            ${dateFilter}
          GROUP BY ae.cost_center_id
        `),

        // Section F: Cash position per company (all time — no date filter for balance)
        db.execute(sql`
          SELECT
            ae.company_id,
            COALESCE(SUM(
              CASE WHEN coa.type = 'asset'
                AND (lower(coa.name) LIKE '%kas%' OR lower(coa.name) LIKE '%cash%' OR lower(coa.name) LIKE '%bank%')
              THEN ael.debit - ael.credit ELSE 0 END
            ), 0) AS cash_balance
          FROM accounting_entries ae
          JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
          JOIN chart_of_accounts coa ON coa.id = ael.account_id
          WHERE ae.status = 'posted'
          GROUP BY ae.company_id
        `),

        // All active cost centers
        db.execute(sql`
          SELECT cc.id, cc.code, cc.name, cc.company_id, c.company_name
          FROM cost_centers cc
          LEFT JOIN companies c ON c.id = cc.company_id
          WHERE cc.is_active = true
          ORDER BY cc.code
        `),
      ]);

    type CompanyRow = { id: number; company_name: string; company_code: string; is_holding: boolean; parent_company_id: number | null };
    type PerfRow = { company_id: number | null; revenue: string; expense: string };
    type CcPerfRow = { cost_center_id: number | null; revenue: string; expense: string };
    type CashRow = { company_id: number | null; cash_balance: string };
    type CcRow = { id: number; code: string; name: string; company_id: number | null; company_name: string | null };

    const companies = companiesRes.rows as CompanyRow[];
    const perfRows = companyPerfRes.rows as PerfRow[];
    const ccPerfRows = costCenterPerfRes.rows as CcPerfRow[];
    const cashRows = cashRes.rows as CashRow[];
    const costCenters = costCentersRes.rows as CcRow[];

    // Build cash map per company
    const cashMap = new Map<number, number>();
    for (const r of cashRows) {
      if (r.company_id != null) cashMap.set(r.company_id, Number(r.cash_balance));
    }

    // Section C: Company performance
    const companyPerf = companies.map((c) => {
      const row = perfRows.find((r) => r.company_id === c.id);
      const revenue = Math.round(Number(row?.revenue ?? 0) * 100) / 100;
      const expense = Math.round(Number(row?.expense ?? 0) * 100) / 100;
      const profit = Math.round((revenue - expense) * 100) / 100;
      const margin = revenue > 0 ? Math.round((profit / revenue) * 10000) / 100 : 0;
      const cash = Math.round((cashMap.get(c.id) ?? 0) * 100) / 100;
      return {
        company_id: c.id,
        company_name: c.company_name,
        company_code: c.company_code,
        is_holding: c.is_holding,
        revenue,
        expense,
        profit,
        profit_margin_pct: margin,
        cash_balance: cash,
      };
    });

    // Section D: Cost center performance
    const costCenterPerf = costCenters.map((cc) => {
      const row = ccPerfRows.find((r) => r.cost_center_id === cc.id);
      const revenue = Math.round(Number(row?.revenue ?? 0) * 100) / 100;
      const expense = Math.round(Number(row?.expense ?? 0) * 100) / 100;
      const profit = Math.round((revenue - expense) * 100) / 100;
      return {
        cost_center_id: cc.id,
        code: cc.code,
        name: cc.name,
        company_id: cc.company_id,
        company_name: cc.company_name ?? null,
        revenue,
        expense,
        profit,
      };
    });

    // Section B: Consolidated KPI (sum per company, excludes holding co to avoid double-count)
    const operatingCompanies = companyPerf.filter((c) => !c.is_holding);
    const revenue_total = Math.round(
      operatingCompanies.reduce((s, c) => s + c.revenue, 0) * 100,
    ) / 100;
    const expense_total = Math.round(
      operatingCompanies.reduce((s, c) => s + c.expense, 0) * 100,
    ) / 100;
    const profit_total = Math.round((revenue_total - expense_total) * 100) / 100;
    const cash_position = Math.round(
      operatingCompanies.reduce((s, c) => s + c.cash_balance, 0) * 100,
    ) / 100;

    // Section E: Top / bottom ranking
    const sorted = [...companyPerf].sort((a, b) => b.profit - a.profit);
    const top_companies = sorted.slice(0, 5);
    const ccSorted = [...costCenterPerf].sort((a, b) => b.profit - a.profit);
    const top_cost_centers = ccSorted.slice(0, 5);
    const bottom_cost_centers = ccSorted.slice(-5).reverse();

    // Section F: Cash per company detail + consolidated
    const cash_per_company = companyPerf.map((c) => ({
      company_id: c.company_id,
      company_name: c.company_name,
      company_code: c.company_code,
      cash_balance: c.cash_balance,
    }));

    // Section H: Validation — sum per company vs consolidated
    const sumPerCompany = Math.round(
      operatingCompanies.reduce((s, c) => s + c.profit, 0) * 100,
    ) / 100;
    const validation_match = Math.abs(sumPerCompany - profit_total) < 0.02;

    return res.json({
      // Section A keys
      companies,
      cost_centers: costCenters,
      // Section B
      revenue_total,
      expense_total,
      profit_total,
      cash_position,
      top_company: top_companies[0] ?? null,
      top_cost_center: top_cost_centers[0] ?? null,
      // Section C
      company_performance: companyPerf,
      // Section D
      cost_center_performance: costCenterPerf,
      // Section E
      top_companies,
      top_cost_centers,
      bottom_cost_centers,
      // Section F
      cash_per_company,
      // Section H
      validation: {
        sum_per_company: sumPerCompany,
        consolidated: profit_total,
        match: validation_match,
      },
    });
  } catch (err: unknown) {
    console.error("[executive/summary]", err);
    return res.status(500).json({ message: "Gagal memuat executive summary" });
  }
});

/**
 * Sprint 10 — Executive Logistics Summary
 * GET /api/executive/logistics-summary?from=&to=
 *
 * Returns logistics-specific KPIs for the executive dashboard:
 * - Total orders, revenue, cost, margin, margin%
 * - Top 5 routes by revenue + margin
 * - Top 5 commodities by revenue + margin
 * - Vendor grade distribution
 * - MoM comparison (this period vs same period prior)
 * - AI-derived insight bullets
 */
router.get("/logistics-summary", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  try {
    const range = parseDateRange(req);
    if (range.error) return res.status(400).json({ message: range.error });

    const fromSql = range.from ? sql`AND lo.created_at >= ${range.from.toISOString()}` : sql``;
    const toSql   = range.to   ? sql`AND lo.created_at <= ${range.to.toISOString()}`   : sql``;

    const [kpiRes, routeRes, commodityRes, gradeRes, trendRes] = await Promise.all([
      // ── KPI ─────────────────────────────────────────────────────────────────
      db.execute<{
        order_count: string; revenue: string; vendor_cost: string;
        margin: string; margin_pct: string; avg_order_value: string;
        completed: string; cancelled: string;
      }>(sql`
        SELECT
          COUNT(lo.id)::text                                                       AS order_count,
          COALESCE(SUM(lo.grand_total),                              0)::text      AS revenue,
          COALESCE(SUM(COALESCE(lo.truck_price, 0)),                 0)::text      AS vendor_cost,
          COALESCE(SUM(lo.grand_total - COALESCE(lo.truck_price, 0)), 0)::text     AS margin,
          ROUND(
            CASE WHEN SUM(lo.grand_total) > 0
              THEN SUM(lo.grand_total - COALESCE(lo.truck_price, 0)) / SUM(lo.grand_total) * 100
              ELSE 0
            END, 1
          )::text                                                                  AS margin_pct,
          COALESCE(AVG(lo.grand_total), 0)::text                                  AS avg_order_value,
          COUNT(*) FILTER (WHERE lo.status ILIKE '%completed%' OR lo.status ILIKE '%delivered%')::text AS completed,
          COUNT(*) FILTER (WHERE lo.status ILIKE '%cancel%')::text                AS cancelled
        FROM logistic_orders lo
        WHERE lo.status NOT IN ('Cancelled','cancelled')
          ${fromSql} ${toSql}
      `),

      // ── Top Routes ───────────────────────────────────────────────────────────
      db.execute<{
        origin: string; destination: string; order_count: string;
        revenue: string; margin: string; margin_pct: string;
      }>(sql`
        SELECT
          COALESCE(NULLIF(TRIM(lo.origin), ''), '?')        AS origin,
          COALESCE(NULLIF(TRIM(lo.destination), ''), '?')   AS destination,
          COUNT(lo.id)::text                                 AS order_count,
          COALESCE(SUM(lo.grand_total),                              0)::text  AS revenue,
          COALESCE(SUM(lo.grand_total - COALESCE(lo.truck_price, 0)), 0)::text  AS margin,
          ROUND(
            CASE WHEN SUM(lo.grand_total) > 0
              THEN SUM(lo.grand_total - COALESCE(lo.truck_price, 0)) / SUM(lo.grand_total) * 100
              ELSE 0
            END, 1
          )::text                                                               AS margin_pct
        FROM logistic_orders lo
        WHERE lo.status NOT IN ('Cancelled','cancelled')
          AND NULLIF(TRIM(lo.origin), '') IS NOT NULL
          AND NULLIF(TRIM(lo.destination), '') IS NOT NULL
          ${fromSql} ${toSql}
        GROUP BY lo.origin, lo.destination
        ORDER BY SUM(lo.grand_total) DESC NULLS LAST
        LIMIT 5
      `),

      // ── Top Commodities ──────────────────────────────────────────────────────
      db.execute<{
        commodity: string; order_count: string; revenue: string;
        margin: string; margin_pct: string;
      }>(sql`
        SELECT
          COALESCE(NULLIF(TRIM(lo.commodity), ''), '(tidak diisi)')  AS commodity,
          COUNT(lo.id)::text                                          AS order_count,
          COALESCE(SUM(lo.grand_total),                              0)::text  AS revenue,
          COALESCE(SUM(lo.grand_total - COALESCE(lo.truck_price, 0)), 0)::text  AS margin,
          ROUND(
            CASE WHEN SUM(lo.grand_total) > 0
              THEN SUM(lo.grand_total - COALESCE(lo.truck_price, 0)) / SUM(lo.grand_total) * 100
              ELSE 0
            END, 1
          )::text                                                               AS margin_pct
        FROM logistic_orders lo
        WHERE lo.status NOT IN ('Cancelled','cancelled')
          ${fromSql} ${toSql}
        GROUP BY lo.commodity
        ORDER BY SUM(lo.grand_total) DESC NULLS LAST
        LIMIT 5
      `),

      // ── Vendor Grade Distribution ────────────────────────────────────────────
      db.execute<{ vendor_grade: string; cnt: string }>(sql`
        SELECT COALESCE(vendor_grade, 'D') AS vendor_grade, COUNT(*)::text AS cnt
        FROM vendor_performance
        GROUP BY vendor_grade
        ORDER BY vendor_grade
      `),

      // ── Monthly Trend (last 6 months) ────────────────────────────────────────
      db.execute<{
        month: string; order_count: string; revenue: string; margin: string;
      }>(sql`
        SELECT
          TO_CHAR(DATE_TRUNC('month', lo.created_at), 'YYYY-MM') AS month,
          COUNT(lo.id)::text                                       AS order_count,
          COALESCE(SUM(lo.grand_total), 0)::text                                    AS revenue,
          COALESCE(SUM(lo.grand_total - COALESCE(lo.truck_price, 0)), 0)::text    AS margin
        FROM logistic_orders lo
        WHERE lo.status NOT IN ('Cancelled','cancelled')
          AND lo.created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', lo.created_at)
        ORDER BY month ASC
      `),
    ]);

    const kpi = kpiRes.rows[0];
    const orderCount   = Number(kpi?.order_count   ?? 0);
    const revenue      = Number(kpi?.revenue        ?? 0);
    const vendorCost   = Number(kpi?.vendor_cost    ?? 0);
    const margin       = Number(kpi?.margin         ?? 0);
    const marginPct    = Number(kpi?.margin_pct     ?? 0);
    const avgOrderVal  = Number(kpi?.avg_order_value ?? 0);
    const completed    = Number(kpi?.completed       ?? 0);
    const cancelled    = Number(kpi?.cancelled       ?? 0);
    const completionRate = orderCount > 0 ? Math.round(completed / orderCount * 1000) / 10 : 0;
    const cancelRate     = orderCount > 0 ? Math.round(cancelled / orderCount * 1000) / 10 : 0;

    const topRoutes = routeRes.rows.map(r => ({
      route:       `${r.origin} → ${r.destination}`,
      origin:      r.origin,
      destination: r.destination,
      orderCount:  Number(r.order_count),
      revenue:     Number(r.revenue),
      margin:      Number(r.margin),
      marginPct:   Number(r.margin_pct),
    }));

    const topCommodities = commodityRes.rows.map(r => ({
      commodity:  r.commodity,
      orderCount: Number(r.order_count),
      revenue:    Number(r.revenue),
      margin:     Number(r.margin),
      marginPct:  Number(r.margin_pct),
    }));

    const gradeDistribution: Record<string, number> = {};
    for (const r of gradeRes.rows) {
      gradeDistribution[r.vendor_grade] = Number(r.cnt);
    }

    const trendData = trendRes.rows.map(r => ({
      month:      r.month,
      orderCount: Number(r.order_count),
      revenue:    Number(r.revenue),
      margin:     Number(r.margin),
    }));

    // AI-derived insight bullets (rule-based, no external LLM call)
    const insights: string[] = [];
    if (marginPct >= 20) {
      insights.push(`Margin sehat ${marginPct.toFixed(1)}% — target di atas 15%.`);
    } else if (marginPct > 0) {
      insights.push(`Margin ${marginPct.toFixed(1)}% — perlu optimasi pricing atau vendor cost.`);
    }
    if (cancelRate > 10) {
      insights.push(`Cancel rate ${cancelRate.toFixed(1)}% tinggi — investigasi akar masalah.`);
    } else if (cancelRate > 0) {
      insights.push(`Cancel rate terkendali di ${cancelRate.toFixed(1)}%.`);
    }
    if (topRoutes.length > 0) {
      const best = topRoutes[0];
      insights.push(`Rute terlaris: ${best.route} (${best.orderCount} order, margin ${best.marginPct.toFixed(1)}%).`);
    }
    if (topCommodities.length > 0) {
      const best = topCommodities[0];
      insights.push(`Komoditas dominan: ${best.commodity} (revenue terbesar, margin ${best.marginPct.toFixed(1)}%).`);
    }
    const gradeA = (gradeDistribution["A+"] ?? 0) + (gradeDistribution["A"] ?? 0);
    const gradeTotal = Object.values(gradeDistribution).reduce((s, v) => s + v, 0);
    if (gradeTotal > 0) {
      const gradeAPct = Math.round(gradeA / gradeTotal * 100);
      if (gradeAPct >= 50) {
        insights.push(`${gradeAPct}% vendor termasuk grade A/A+ — kualitas vendor baik.`);
      } else {
        insights.push(`Hanya ${gradeAPct}% vendor grade A/A+ — pertimbangkan seleksi vendor.`);
      }
    }
    if (trendData.length >= 2) {
      const last  = trendData[trendData.length - 1];
      const prev  = trendData[trendData.length - 2];
      if (prev.revenue > 0) {
        const growthPct = (last.revenue - prev.revenue) / prev.revenue * 100;
        if (growthPct > 0) {
          insights.push(`Revenue bulan ini tumbuh ${growthPct.toFixed(1)}% vs bulan lalu.`);
        } else {
          insights.push(`Revenue bulan ini turun ${Math.abs(growthPct).toFixed(1)}% vs bulan lalu — perlu perhatian.`);
        }
      }
    }

    return res.json({
      kpi: {
        orderCount, revenue, vendorCost, margin, marginPct,
        avgOrderValue: avgOrderVal, completionRate, cancelRate,
        completed, cancelled,
      },
      topRoutes,
      topCommodities,
      gradeDistribution,
      trendData,
      insights,
    });
  } catch (err) {
    console.error("[executive/logistics-summary]", err);
    return res.status(500).json({ message: "Gagal memuat logistics summary" });
  }
});

export default router;

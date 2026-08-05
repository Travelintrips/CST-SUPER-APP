/**
 * Treasury Dashboard API — Batch 4 Phase 4
 *
 * Endpoints:
 *   GET /api/treasury/dashboard    — full dashboard (position + forecast + liquidity + alerts)
 *   GET /api/treasury/cash-position — cash position per company/bank/currency
 *   GET /api/treasury/forecast      — cash forecast for 0/7/30/60/90d horizons
 *   GET /api/treasury/variance      — expected vs actual variance
 *   GET /api/treasury/liquidity     — liquidity ratios and metrics
 *   GET /api/treasury/risk          — risk detection alerts
 *
 * All: company-aware, permission-aware, pagination, date filter.
 * Security: strict company isolation — unauthenticated → 401, no company → 403,
 *           cross-company without permission → 403.
 */

import { Router, type Request, type Response } from "express";
import {
  resolveCompanyIdStrict,
  TreasuryAuthError,
  AUTHENTICATION_REQUIRED,
} from "../lib/treasury/resolveCompanyStrict.js";
import { computeCashPosition }  from "../lib/treasury/cashPositionEngine.js";
import { computeCashForecast }  from "../lib/treasury/cashForecastEngine.js";
import { computeVariance }      from "../lib/treasury/varianceEngine.js";
import { computeLiquidity }     from "../lib/treasury/liquidityEngine.js";
import { detectRisks }          from "../lib/treasury/riskEngine.js";
import { treasuryCache }        from "../lib/treasury/treasuryCache.js";
import { getAllMetricsSummary }  from "../lib/treasury/treasuryMetrics.js";
import type { TreasuryDashboard, TreasuryQueryParams } from "../lib/treasury/types.js";

export const treasuryRouter = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDate(val: unknown): string | undefined {
  if (typeof val !== "string" || val.trim() === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return undefined;
  return val;
}

function parsePage(val: unknown, def = 1): number {
  const n = parseInt(String(val ?? def), 10);
  return isNaN(n) || n < 1 ? def : n;
}

function parsePageSize(val: unknown, def = 50, max = 200): number {
  const n = parseInt(String(val ?? def), 10);
  if (isNaN(n) || n < 1) return def;
  return Math.min(n, max);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/**
 * Safe error response — never exposes class names, SQL, or stack traces.
 * TreasuryAuthError maps to 401/403 with the error code as message.
 * All other errors map to 500 with a generic message.
 */
function handleErr(res: Response, e: unknown): void {
  if (e instanceof TreasuryAuthError) {
    res.status(e.httpStatus).json({ ok: false, error: e.code });
    return;
  }
  // Generic 500 — do not expose internals
  res.status(500).json({ ok: false, error: "Internal server error" });
}

// ── GET /api/treasury/dashboard ───────────────────────────────────────────────

treasuryRouter.get("/treasury/dashboard", async (req: Request, res: Response) => {
  const t0 = performance.now();
  try {
    const companyId = resolveCompanyIdStrict(req);
    const asOf      = parseDate(req.query.asOf) ?? today();
    const params: TreasuryQueryParams = { companyId, asOf };

    const [cashPosition, forecast, liquidity, riskReport] = await Promise.all([
      computeCashPosition(params),
      computeCashForecast(params),
      computeLiquidity(params),
      detectRisks(params),
    ]);

    const latencyMs = Math.round((performance.now() - t0) * 100) / 100;

    const dashboard: TreasuryDashboard = {
      companyId,
      asOf,
      cashPosition,
      forecast,
      liquidity,
      alerts: riskReport.alerts,
      computedAt: new Date().toISOString(),
      latencyMs,
    };

    res.json({ ok: true, data: dashboard });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

// ── GET /api/treasury/cash-position ──────────────────────────────────────────

treasuryRouter.get("/treasury/cash-position", async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyIdStrict(req);
    const asOf      = parseDate(req.query.asOf) ?? today();
    const page      = parsePage(req.query.page);
    const pageSize  = parsePageSize(req.query.pageSize);

    const position = await computeCashPosition({ companyId, asOf });

    // Paginate bank accounts
    const accounts = position.bankAccounts;
    const total    = accounts.length;
    const paged    = accounts.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      ok: true,
      data: {
        ...position,
        bankAccounts: paged,
      },
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

// ── GET /api/treasury/forecast ────────────────────────────────────────────────

treasuryRouter.get("/treasury/forecast", async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyIdStrict(req);
    const asOf      = parseDate(req.query.asOf) ?? today();
    const page      = parsePage(req.query.page);
    const pageSize  = parsePageSize(req.query.pageSize);

    const forecast = await computeCashForecast({ companyId, asOf });

    const total  = forecast.buckets.length;
    const paged  = forecast.buckets.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      ok: true,
      data: { ...forecast, buckets: paged },
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

// ── GET /api/treasury/variance ────────────────────────────────────────────────

treasuryRouter.get("/treasury/variance", async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyIdStrict(req);
    const fromDate  = parseDate(req.query.from) ?? daysAgo(30);
    const toDate    = parseDate(req.query.to)   ?? today();
    const page      = parsePage(req.query.page);
    const pageSize  = parsePageSize(req.query.pageSize);

    if (fromDate > toDate) {
      res.status(400).json({ ok: false, error: "from must be before or equal to to" });
      return;
    }

    const report = await computeVariance({ companyId, fromDate, toDate });

    const rows  = report.rows;
    const total = rows.length;
    const paged = rows.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      ok: true,
      data: { ...report, rows: paged },
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

// ── GET /api/treasury/liquidity ───────────────────────────────────────────────

treasuryRouter.get("/treasury/liquidity", async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyIdStrict(req);
    const asOf      = parseDate(req.query.asOf) ?? today();

    const metrics = await computeLiquidity({ companyId, asOf });

    res.json({ ok: true, data: metrics });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

// ── GET /api/treasury/risk ────────────────────────────────────────────────────

treasuryRouter.get("/treasury/risk", async (req: Request, res: Response) => {
  try {
    const companyId = resolveCompanyIdStrict(req);
    const asOf      = parseDate(req.query.asOf) ?? today();
    const page      = parsePage(req.query.page);
    const pageSize  = parsePageSize(req.query.pageSize);

    const report = await detectRisks({ companyId, asOf });

    const alerts = report.alerts;
    const total  = alerts.length;
    const paged  = alerts.slice((page - 1) * pageSize, page * pageSize);

    res.json({
      ok: true,
      data: { ...report, alerts: paged },
      pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

// ── GET /api/treasury/metrics (internal — cache + perf stats) ────────────────

treasuryRouter.get("/treasury/metrics", async (req: Request, res: Response) => {
  try {
    resolveCompanyIdStrict(req); // auth + company check
    const cacheStats = treasuryCache.stats();
    const perfMetrics = getAllMetricsSummary();
    res.json({ ok: true, data: { cache: cacheStats, performance: perfMetrics } });
  } catch (e: unknown) {
    handleErr(res, e);
  }
});

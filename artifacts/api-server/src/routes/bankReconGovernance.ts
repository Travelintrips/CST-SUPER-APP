/**
 * Bank Reconciliation — Governance & Enterprise Readiness (Batch 2)
 *
 * New endpoints (all under /api/bank-reconciliation/):
 *
 *  GET  /rules/:id/history        — versioned change history for a rule
 *  POST /rules/:id/simulate       — simulate rule against historical mutations (read-only)
 *  GET  /metrics                  — overall metrics (all companies admin has access to)
 *  GET  /metrics/company/:id      — metrics for a specific company
 *  GET  /metrics/rules            — per-rule match counts
 *  GET  /cache/status             — cache stats
 *  POST /cache/refresh            — invalidate company cache
 *
 * All endpoints require admin auth.
 * Simulation is strictly read-only.
 * Cache refresh does NOT flush approval results.
 */

import { Router } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { getRuleVersionHistory } from "../lib/reconciliation/reconRuleVersioning.js";
import { simulateRule } from "../lib/reconciliation/reconRuleSimulation.js";
import { getMetricsSummary, getRuleMetrics } from "../lib/reconciliation/reconMetricsService.js";
import {
  reconCache,
  invalidateCompanyCache,
  invalidateRulesCache,
  invalidateEcfCache,
} from "../lib/reconciliation/reconCache.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

function requireCompanyId(req: any, res: any): number | null {
  const cid = parseInt(req.query.company_id ?? req.body?.company_id ?? "0", 10);
  if (!Number.isFinite(cid) || cid <= 0) {
    res.status(400).json({ error: "company_id wajib diisi (integer positif)" });
    return null;
  }
  return cid;
}

// ─── GET /rules/:id/history ────────────────────────────────────────────────────

router.get("/rules/:id/history", async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  if (!Number.isFinite(ruleId) || ruleId <= 0) {
    return res.status(400).json({ error: "id tidak valid" });
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const history = await getRuleVersionHistory(ruleId, companyId);
    return res.json({ ruleId, companyId, history });
  } catch (e: any) {
    logger.error({ err: e.message, ruleId }, "[governance] GET /rules/:id/history error");
    return res.status(500).json({ error: "Gagal mengambil history rule" });
  }
});

// ─── POST /rules/:id/simulate ─────────────────────────────────────────────────

router.post("/rules/:id/simulate", async (req, res) => {
  const ruleId = parseInt(req.params.id, 10);
  if (!Number.isFinite(ruleId) || ruleId <= 0) {
    return res.status(400).json({ error: "id tidak valid" });
  }

  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const { date_from, date_to, mutation_ids, limit } = req.body ?? {};

  if (!date_from || !date_to) {
    return res.status(400).json({ error: "date_from dan date_to wajib diisi (YYYY-MM-DD)" });
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateRegex.test(date_from) || !dateRegex.test(date_to)) {
    return res.status(400).json({ error: "date_from dan date_to harus format YYYY-MM-DD" });
  }

  if (date_from > date_to) {
    return res.status(400).json({ error: "date_from harus sebelum atau sama dengan date_to" });
  }

  const parsedLimit = limit ? Math.min(parseInt(limit, 10), 10_000) : 1000;

  try {
    const result = await simulateRule({
      ruleId,
      companyId,
      dateFrom: date_from,
      dateTo:   date_to,
      mutationIds: Array.isArray(mutation_ids) ? mutation_ids.map(Number).filter(n => n > 0) : undefined,
      limit: parsedLimit,
    });
    return res.json(result);
  } catch (e: any) {
    if (e.message?.includes("not found")) {
      return res.status(404).json({ error: e.message });
    }
    logger.error({ err: e.message, ruleId, companyId }, "[governance] POST /rules/:id/simulate error");
    return res.status(500).json({ error: "Gagal menjalankan simulasi" });
  }
});

// ─── GET /metrics ──────────────────────────────────────────────────────────────

router.get("/metrics", async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const bankAccountId = req.query.bank_account_id ? parseInt(req.query.bank_account_id as string, 10) : undefined;
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo   = req.query.date_to   as string | undefined;

  try {
    const summary = await getMetricsSummary({
      companyId,
      bankAccountId: bankAccountId ?? null,
      dateFrom,
      dateTo,
    });
    return res.json(summary);
  } catch (e: any) {
    logger.error({ err: e.message, companyId }, "[governance] GET /metrics error");
    return res.status(500).json({ error: "Gagal mengambil metrics" });
  }
});

// ─── GET /metrics/company/:id ─────────────────────────────────────────────────

router.get("/metrics/company/:id", async (req, res) => {
  const companyId = parseInt(req.params.id, 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "company id tidak valid" });
  }

  const bankAccountId = req.query.bank_account_id ? parseInt(req.query.bank_account_id as string, 10) : undefined;
  const dateFrom = req.query.date_from as string | undefined;
  const dateTo   = req.query.date_to   as string | undefined;

  try {
    const summary = await getMetricsSummary({
      companyId,
      bankAccountId: bankAccountId ?? null,
      dateFrom,
      dateTo,
    });
    return res.json(summary);
  } catch (e: any) {
    logger.error({ err: e.message, companyId }, "[governance] GET /metrics/company/:id error");
    return res.status(500).json({ error: "Gagal mengambil metrics perusahaan" });
  }
});

// ─── GET /metrics/rules ───────────────────────────────────────────────────────

router.get("/metrics/rules", async (req, res) => {
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const rules = await getRuleMetrics(companyId);
    return res.json({ companyId, rules });
  } catch (e: any) {
    logger.error({ err: e.message, companyId }, "[governance] GET /metrics/rules error");
    return res.status(500).json({ error: "Gagal mengambil metrics rules" });
  }
});

// ─── GET /cache/status ────────────────────────────────────────────────────────

router.get("/cache/status", async (_req, res) => {
  try {
    const stats = reconCache.stats();
    const keys  = reconCache.keys();

    // Group by company
    const byCompany: Record<string, string[]> = {};
    for (const k of keys) {
      const parts = k.split(":");
      const type  = parts[0];
      const cid   = parts[1] ?? "unknown";
      if (!byCompany[cid]) byCompany[cid] = [];
      byCompany[cid].push(type);
    }

    return res.json({
      provider: "memory",
      stats,
      entries: keys.length,
      byCompany,
      retrievedAt: new Date().toISOString(),
    });
  } catch (e: any) {
    logger.error({ err: e.message }, "[governance] GET /cache/status error");
    return res.status(500).json({ error: "Gagal mengambil cache status" });
  }
});

// ─── POST /cache/refresh ──────────────────────────────────────────────────────

router.post("/cache/refresh", async (req, res) => {
  const body = req.body ?? {};

  // company_id optional — if provided, invalidate only that company
  const companyId = body.company_id ? parseInt(body.company_id, 10) : null;
  const type      = body.type as "rules" | "ecf" | "all" | undefined;

  try {
    if (companyId) {
      if (type === "rules") {
        invalidateRulesCache(companyId);
      } else if (type === "ecf") {
        invalidateEcfCache(companyId);
      } else {
        invalidateCompanyCache(companyId);
      }
      logger.info({ companyId, type }, "[governance] cache invalidated for company");
      return res.json({ invalidated: true, companyId, type: type ?? "all" });
    } else {
      // Flush entire cache (all companies)
      reconCache.clear();
      logger.info("[governance] full cache cleared");
      return res.json({ invalidated: true, scope: "all", message: "Cache seluruh company telah direset" });
    }
  } catch (e: any) {
    logger.error({ err: e.message }, "[governance] POST /cache/refresh error");
    return res.status(500).json({ error: "Gagal me-refresh cache" });
  }
});

export default router;

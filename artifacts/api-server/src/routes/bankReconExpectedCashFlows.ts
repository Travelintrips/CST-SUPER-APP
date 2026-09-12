/**
 * Bank Reconciliation — Expected Cash Flow Routes
 *
 * Endpoints:
 *  GET  /api/bank-reconciliation/expected-cash-flows         — list open ECFs
 *  POST /api/bank-reconciliation/expected-cash-flows/refresh — regenerate for company
 *  GET  /api/bank-reconciliation/expected-cash-flows/:id     — get by id
 *
 * All endpoints require admin auth and company_id isolation.
 */

import { Router } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import {
  runExpectedCashFlowMigration,
  generateExpectedCashFlows,
  getOpenExpectedCashFlows,
  getExpectedCashFlowById,
  type EcfFilters,
  type EcfDirection,
  type EcfStatus,
  type EcfSourceType,
} from "../lib/reconciliation/expectedCashFlowService.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── GET /expected-cash-flows ─────────────────────────────────────────────────

router.get("/", async (req, res) => {
  await runExpectedCashFlowMigration();

  const companyId = parseInt(String(req.query.company_id ?? "0"), 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "company_id wajib diisi (integer positif)" });
  }

  const filters: EcfFilters = {
    companyId,
    direction:    req.query.direction as EcfDirection | undefined,
    status:       req.query.status as EcfStatus | undefined,
    sourceType:   req.query.source_type as EcfSourceType | undefined,
    dueDateBefore: req.query.due_date_before as string | undefined,
    limit:        Math.min(parseInt(String(req.query.limit ?? "100"), 10) || 100, 1000),
    offset:       parseInt(String(req.query.offset ?? "0"), 10) || 0,
  };

  try {
    const ecfs = await getOpenExpectedCashFlows(filters);
    return res.json({ expectedCashFlows: ecfs, count: ecfs.length });
  } catch (e: any) {
    logger.error({ err: e.message, companyId }, "[ECF] GET / error");
    return res.status(500).json({ error: "Gagal memuat expected cash flows" });
  }
});

// ─── POST /expected-cash-flows/refresh ───────────────────────────────────────

router.post("/refresh", async (req, res) => {
  await runExpectedCashFlowMigration();

  const companyId = parseInt(String(req.body?.company_id ?? req.query.company_id ?? "0"), 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "company_id wajib diisi (integer positif)" });
  }

  try {
    const result = await generateExpectedCashFlows(companyId);
    return res.json({
      ok: true,
      refreshed: result,
      message: `${result.total} expected cash flows diperbarui`,
    });
  } catch (e: any) {
    logger.error({ err: e.message, companyId }, "[ECF] POST /refresh error");
    return res.status(500).json({ error: "Gagal me-refresh expected cash flows" });
  }
});

// ─── GET /expected-cash-flows/:id ─────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  await runExpectedCashFlowMigration();

  const id = req.params.id;
  if (!id || id.length < 10) {
    return res.status(400).json({ error: "id tidak valid" });
  }

  try {
    const ecf = await getExpectedCashFlowById(id);
    if (!ecf) return res.status(404).json({ error: "Expected cash flow tidak ditemukan" });
    return res.json({ expectedCashFlow: ecf });
  } catch (e: any) {
    logger.error({ err: e.message, id }, "[ECF] GET /:id error");
    return res.status(500).json({ error: "Gagal memuat expected cash flow" });
  }
});

export default router;

/**
 * taxSptControl.ts
 * Routes untuk SPT Control: include/exclude, adjustment, audit log,
 * period management (Fase 3 — Period Lock Guard).
 *
 * Base: /api/tax/spt-control
 *
 * POST /toggle/:id                   — toggle INCLUDED ↔ EXCLUDED
 * POST /exclude/:id                  — exclude dengan wajib alasan
 * POST /bulk-update                  — bulk include/exclude per periode
 * GET  /summary                      — ringkasan spt_status per periode
 *
 * GET  /adjustments                  — list adjustments
 * POST /adjustments                  — buat adjustment baru
 * POST /adjustments/:id/approve      — approve adjustment
 * POST /adjustments/:id/reject       — reject adjustment
 *
 * GET  /audit-logs                   — list tax audit logs
 *
 * GET  /periods                      — list period lock status
 * POST /periods                      — upsert period (lock/unlock)
 * GET  /periods/:companyId/:period   — status satu period
 */

import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import {
  toggleSptStatus,
  excludeWithReason,
  bulkUpdateSptStatus,
  getSptStatusSummary,
} from "../lib/taxSptControlService.js";
import {
  createAdjustment,
  approveAdjustment,
  rejectAdjustment,
  listAdjustments,
  type AdjustmentType,
  type AdjustmentStatus,
} from "../lib/taxAdjustmentService.js";
import { extractActorFromReq, logTaxActivity } from "../lib/taxAuditService.js";
import {
  assertTaxPeriodEditable,
  guardTaxPeriodFromRequest,
} from "../lib/taxPeriodGuard.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router = Router();

router.use(async (req: Request, res: Response, next) => {
  const ok = await requireAdmin(req, res);
  if (ok) next();
});

function resolveCompanyId(req: Request): number | null {
  const n = Number(req.query["companyId"] ?? req.body?.companyId ?? 0);
  return n > 0 ? n : null;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Helper: ambil period dari transaction_tax record
async function getPeriodForTaxRecord(id: number, companyId: number): Promise<string | null> {
  try {
    const { rows } = await db.execute(sql`
      SELECT period FROM transaction_taxes WHERE id = ${id} AND company_id = ${companyId} LIMIT 1
    `);
    return (rows[0] as { period?: string })?.period ?? null;
  } catch {
    return null;
  }
}

// ── POST /toggle/:id ─────────────────────────────────────────────────────────

router.post("/toggle/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!id) { res.status(400).json({ error: "id tidak valid" }); return; }

  const companyId = resolveCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId wajib ada" }); return; }

  const period = await getPeriodForTaxRecord(id, companyId);
  const canEdit = await guardTaxPeriodFromRequest(companyId, period, res);
  if (!canEdit) return;

  const { performedBy, ipAddress } = extractActorFromReq(req);

  try {
    const result = await toggleSptStatus(id, companyId, performedBy, ipAddress);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
});

// ── POST /exclude/:id ────────────────────────────────────────────────────────

router.post("/exclude/:id", async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(String(req.params["id"] ?? ""), 10);
  if (!id) { res.status(400).json({ error: "id tidak valid" }); return; }

  const companyId = resolveCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId wajib ada" }); return; }
  const { reason } = req.body ?? {};

  if (!reason?.trim()) {
    res.status(400).json({ error: "reason wajib diisi" });
    return;
  }

  const period = await getPeriodForTaxRecord(id, companyId);
  const canEdit = await guardTaxPeriodFromRequest(companyId, period, res);
  if (!canEdit) return;

  const { performedBy, ipAddress } = extractActorFromReq(req);

  try {
    await excludeWithReason({ transactionTaxId: id, companyId, reason, userId: performedBy, ipAddress });
    res.json({ ok: true, message: "Pajak berhasil di-exclude dari SPT" });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
});

// ── POST /bulk-update ────────────────────────────────────────────────────────

router.post("/bulk-update", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId wajib ada" }); return; }
  const { period, ids, targetStatus, reason } = req.body ?? {};

  if (!period || !Array.isArray(ids) || !ids.length) {
    res.status(400).json({ error: "period dan ids (array) wajib diisi" });
    return;
  }
  if (!["INCLUDED", "EXCLUDED"].includes(targetStatus)) {
    res.status(400).json({ error: "targetStatus harus INCLUDED atau EXCLUDED" });
    return;
  }

  const canEdit = await guardTaxPeriodFromRequest(companyId, period, res);
  if (!canEdit) return;

  const { performedBy, ipAddress } = extractActorFromReq(req);

  try {
    const result = await bulkUpdateSptStatus({
      companyId,
      period,
      ids: ids.map(Number),
      targetStatus,
      reason,
      userId: performedBy,
      ipAddress,
    });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
});

// ── GET /summary ─────────────────────────────────────────────────────────────

router.get("/summary", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  const period = String(req.query["period"] ?? "");
  if (!period) { res.status(400).json({ error: "period diperlukan (format: YYYY-MM)" }); return; }

  try {
    const cid = companyId ?? 0;
    const summary = await getSptStatusSummary(cid, period);
    const periodStatus = await assertTaxPeriodEditable(cid, period);
    res.json({ companyId, period, summary, periodStatus });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── GET /adjustments ─────────────────────────────────────────────────────────

router.get("/adjustments", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  const status = req.query["status"] as AdjustmentStatus | undefined;
  const period = req.query["period"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 200);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;

  try {
    const rows = await listAdjustments(companyId ?? 0, { status, period, limit, offset });
    res.json({ adjustments: rows, limit, offset });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── POST /adjustments ────────────────────────────────────────────────────────
// Adjustment BOLEH dibuat untuk period locked/exported (buat koreksi, tidak overwrite)

router.post("/adjustments", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId wajib ada" }); return; }
  const { transactionTaxId, adjustmentType, newValue, reason } = req.body ?? {};
  const { performedBy, ipAddress } = extractActorFromReq(req);

  const VALID_TYPES: AdjustmentType[] = ["CORRECTION", "REVERSAL", "OVERRIDE"];
  if (!transactionTaxId || !adjustmentType || !newValue || !reason) {
    res.status(400).json({ error: "transactionTaxId, adjustmentType, newValue, reason wajib diisi" });
    return;
  }
  if (!VALID_TYPES.includes(adjustmentType)) {
    res.status(400).json({ error: `adjustmentType harus salah satu dari: ${VALID_TYPES.join(", ")}` });
    return;
  }

  try {
    const result = await createAdjustment({
      companyId,
      transactionTaxId: Number(transactionTaxId),
      adjustmentType,
      newValue,
      reason,
      createdBy: performedBy,
      ipAddress,
    });
    res.status(201).json({ ok: true, adjustmentId: result.id });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
});

// ── POST /adjustments/:id/approve ────────────────────────────────────────────

router.post("/adjustments/:id/approve", async (req: Request, res: Response): Promise<void> => {
  const adjustmentId = String(req.params["id"] ?? "");
  const companyId = resolveCompanyId(req) ?? 0;
  const { performedBy, ipAddress } = extractActorFromReq(req);

  try {
    await approveAdjustment({ adjustmentId, companyId, approvedBy: performedBy, ipAddress });
    res.json({ ok: true, message: "Adjustment berhasil di-approve dan diterapkan ke SPT layer" });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
});

// ── POST /adjustments/:id/reject ─────────────────────────────────────────────

router.post("/adjustments/:id/reject", async (req: Request, res: Response): Promise<void> => {
  const adjustmentId = String(req.params["id"] ?? "");
  const companyId = resolveCompanyId(req) ?? 0;
  const { rejectionReason } = req.body ?? {};
  const { performedBy, ipAddress } = extractActorFromReq(req);

  if (!rejectionReason?.trim()) {
    res.status(400).json({ error: "rejectionReason wajib diisi" });
    return;
  }

  try {
    await rejectAdjustment({ adjustmentId, companyId, rejectedBy: performedBy, rejectionReason, ipAddress });
    res.json({ ok: true, message: "Adjustment ditolak" });
  } catch (err) {
    res.status(400).json({ error: errMsg(err) });
  }
});

// ── GET /audit-logs ───────────────────────────────────────────────────────────

router.get("/audit-logs", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  const entityType = req.query["entityType"] as string | undefined;
  const action = req.query["action"] as string | undefined;
  const from = req.query["from"] as string | undefined;
  const to = req.query["to"] as string | undefined;
  const limit = Math.min(parseInt(String(req.query["limit"] ?? "50"), 10) || 50, 500);
  const offset = parseInt(String(req.query["offset"] ?? "0"), 10) || 0;

  try {
    const result = await db.execute(sql`
      SELECT
        id, entity_type, entity_id, action,
        before_data, after_data,
        performed_by, ip_address, timestamp
      FROM tax_audit_logs
      WHERE company_id = ${companyId}
        ${entityType ? sql`AND entity_type = ${entityType}` : sql``}
        ${action ? sql`AND action = ${action}` : sql``}
        ${from ? sql`AND timestamp >= ${from}::timestamptz` : sql``}
        ${to ? sql`AND timestamp <= ${to}::timestamptz` : sql``}
      ORDER BY timestamp DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    res.json({ logs: result.rows, limit, offset });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── GET /periods ──────────────────────────────────────────────────────────────

router.get("/periods", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId wajib ada" }); return; }
  const taxPeriod = req.query["period"] as string | undefined;
  const status = req.query["status"] as string | undefined;

  try {
    const result = await db.execute(sql`
      SELECT
        id, company_id, tax_period, tax_type, status,
        locked_at, locked_by, exported_at, exported_by,
        revised_at, revised_by, notes, created_at, updated_at
      FROM tax_periods
      WHERE company_id = ${companyId}
        ${taxPeriod ? sql`AND tax_period = ${taxPeriod}` : sql``}
        ${status ? sql`AND status = ${status}` : sql``}
      ORDER BY tax_period DESC, tax_type
    `);
    res.json({ periods: result.rows });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── POST /periods ─────────────────────────────────────────────────────────────
// Upsert period status (lock, unlock, export, revise)

router.post("/periods", async (req: Request, res: Response): Promise<void> => {
  const companyId = resolveCompanyId(req);
  if (!companyId) { res.status(400).json({ error: "companyId wajib ada" }); return; }

  const { taxPeriod, taxType = "ALL", status, notes } = req.body ?? {};
  const { performedBy } = extractActorFromReq(req);

  const VALID_STATUS = ["open", "validating", "locked", "exported", "revised"];
  if (!taxPeriod || !status) {
    res.status(400).json({ error: "taxPeriod dan status wajib diisi" });
    return;
  }
  if (!VALID_STATUS.includes(status)) {
    res.status(400).json({ error: `status harus salah satu dari: ${VALID_STATUS.join(", ")}` });
    return;
  }

  try {
    const now = new Date().toISOString();
    const lockedAt = status === "locked" ? now : null;
    const exportedAt = status === "exported" ? now : null;
    const revisedAt = status === "revised" ? now : null;
    const lockedBy = status === "locked" ? performedBy : null;
    const exportedBy = status === "exported" ? performedBy : null;
    const revisedBy = status === "revised" ? performedBy : null;

    await db.execute(sql`
      INSERT INTO tax_periods (
        company_id, tax_period, tax_type, status,
        locked_at, locked_by, exported_at, exported_by,
        revised_at, revised_by, notes, updated_at
      ) VALUES (
        ${companyId}, ${taxPeriod}, ${taxType}, ${status},
        ${lockedAt}::timestamptz, ${lockedBy},
        ${exportedAt}::timestamptz, ${exportedBy},
        ${revisedAt}::timestamptz, ${revisedBy},
        ${notes ?? null}, NOW()
      )
      ON CONFLICT (company_id, tax_period, tax_type) DO UPDATE SET
        status       = EXCLUDED.status,
        locked_at    = COALESCE(EXCLUDED.locked_at, tax_periods.locked_at),
        locked_by    = COALESCE(EXCLUDED.locked_by, tax_periods.locked_by),
        exported_at  = COALESCE(EXCLUDED.exported_at, tax_periods.exported_at),
        exported_by  = COALESCE(EXCLUDED.exported_by, tax_periods.exported_by),
        revised_at   = COALESCE(EXCLUDED.revised_at, tax_periods.revised_at),
        revised_by   = COALESCE(EXCLUDED.revised_by, tax_periods.revised_by),
        notes        = COALESCE(EXCLUDED.notes, tax_periods.notes),
        updated_at   = NOW()
    `);

    // ── FASE 4 T009: Audit log Lock/Unlock/Export period ─────────────────────
    const auditActionMap: Record<string, "LOCK_PERIOD" | "UNLOCK_PERIOD" | "SPT_EXPORT" | "VALIDATE"> = {
      locked: "LOCK_PERIOD",
      revised: "UNLOCK_PERIOD",
      exported: "SPT_EXPORT",
      validating: "VALIDATE",
    };
    const auditAction = auditActionMap[status];
    if (auditAction) {
      logTaxActivity({
        companyId,
        entityType: "tax_spt_draft",
        entityId: taxPeriod,
        action: auditAction,
        after: { taxPeriod, taxType, status, notes: notes ?? null },
        performedBy,
        ipAddress: null,
      }).catch(() => {});
    }

    res.json({ ok: true, taxPeriod, taxType, status, updatedBy: performedBy });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

// ── GET /periods/:companyId/:period ───────────────────────────────────────────

router.get("/periods/:companyId/:period", async (req: Request, res: Response): Promise<void> => {
  const companyId = parseInt(String(req.params["companyId"] ?? ""), 10);
  const taxPeriod = String(req.params["period"] ?? "");
  const taxType = String(req.query["taxType"] ?? "ALL");

  if (!companyId || !taxPeriod) {
    res.status(400).json({ error: "companyId dan period diperlukan" });
    return;
  }

  try {
    const guard = await assertTaxPeriodEditable(companyId, taxPeriod, taxType);
    res.json({ companyId, taxPeriod, taxType, ...guard });
  } catch (err) {
    res.status(500).json({ error: errMsg(err) });
  }
});

export default router;

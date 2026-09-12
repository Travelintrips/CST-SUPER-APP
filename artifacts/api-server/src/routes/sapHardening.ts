/**
 * SAP HARDENING — Admin Routes
 * Prefix: /api/sap-hardening
 *
 * Endpoints:
 *   GET  /status                        — Status semua hardening layer
 *   GET  /integrity-queue               — Daftar error di integrity queue
 *   POST /integrity-queue/:id/resolve   — Resolve integrity error
 *   POST /lock-entries                  — Bulk lock posted entries (per company + period)
 *   POST /auto-repair/:batchId          — Trigger auto-repair untuk batch normalisasi
 *   GET  /audit-trail                   — Enhanced audit trail query
 *   GET  /consolidation/validate        — Validate consolidation report
 *   GET  /consolidation/report          — Get consolidation report (locked entries only)
 */

import { Router } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId, getAllowedCompanyIds } from "../lib/resolveCompany.js";
import { getUnresolvedErrors, resolveIntegrityError } from "../lib/errorContainment.js";
import { lockAllPostedEntries } from "../lib/ledgerImmutability.js";
import { runAutoRepairBatch } from "../lib/autoRepairEngine.js";
import { getEntityAuditTrail, auditBulkLock } from "../lib/sapAuditTrail.js";
import {
  validateConsolidationReport,
  getConsolidatedEntries,
  computeIntercompanyEliminations,
} from "../lib/consolidationSafety.js";
import {
  runSapInvoiceLockEngine,
  validateSapInvoiceInput,
} from "../lib/sapInvoiceLockEngine.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── GET /status — Hardening layer health check ───────────────────────────

router.get("/status", async (req, res) => {
  try {
    const [lockedResult, queueResult, auditResult] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'posted' AND is_locked = TRUE)  AS locked_posted,
          COUNT(*) FILTER (WHERE status = 'posted' AND is_locked = FALSE) AS unlocked_posted,
          COUNT(*) FILTER (WHERE status = 'draft')                        AS draft_count
        FROM accounting_entries
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE resolved = FALSE AND classification = 'HIGH')   AS high_unresolved,
          COUNT(*) FILTER (WHERE resolved = FALSE AND classification = 'MEDIUM') AS medium_unresolved,
          COUNT(*) FILTER (WHERE resolved = FALSE AND classification = 'LOW')    AS low_unresolved,
          COUNT(*) FILTER (WHERE resolved = TRUE)                                AS resolved_total
        FROM integrity_audit_queue
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS total_events,
               MAX(created_at) AS last_event_at
        FROM audit_accounting_events
      `)).catch(() => ({ rows: [{ total_events: 0, last_event_at: null }] })),
    ]);

    const ls = lockedResult.rows[0] as any;
    const qs = queueResult.rows[0] as any;
    const as = auditResult.rows[0] as any;

    return res.json({
      ok: true,
      fase1_immutable_ledger: {
        locked_posted:   Number(ls?.locked_posted ?? 0),
        unlocked_posted: Number(ls?.unlocked_posted ?? 0),
        draft:           Number(ls?.draft_count ?? 0),
      },
      fase3_auto_repair: {
        note: "Auto repair berjalan per-batch via POST /auto-repair/:batchId",
      },
      fase6_audit_trail: {
        total_events: Number(as?.total_events ?? 0),
        last_event:   as?.last_event_at ?? null,
      },
      fase8_integrity_queue: {
        high:   Number(qs?.high_unresolved ?? 0),
        medium: Number(qs?.medium_unresolved ?? 0),
        low:    Number(qs?.low_unresolved ?? 0),
        resolved_all_time: Number(qs?.resolved_total ?? 0),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err }, "[sap-hardening] /status error");
    return res.status(500).json({ error: String((err as any)?.message ?? err) });
  }
});

// ─── GET /integrity-queue ─────────────────────────────────────────────────

router.get("/integrity-queue", async (req, res) => {
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const classification = (req.query.classification as string) || null;
  const module = (req.query.module as string) || null;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);

  const errors = await getUnresolvedErrors({ companyId, classification: classification as any, module, limit });
  return res.json({ items: errors, count: errors.length });
});

// ─── POST /integrity-queue/:id/resolve ───────────────────────────────────

router.post("/integrity-queue/:id/resolve", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const actor = (req as any).user?.email ?? "admin";
  const { notes } = req.body ?? {};

  const ok = await resolveIntegrityError(id, actor, notes);
  if (!ok) return res.status(404).json({ error: "Item tidak ditemukan atau sudah resolved" });
  return res.json({ ok: true, id, resolvedBy: actor });
});

// ─── POST /lock-entries — Bulk lock posted entries ────────────────────────

router.post("/lock-entries", async (req, res) => {
  const { companyId, periodBefore } = req.body ?? {};
  if (!companyId) return res.status(400).json({ error: "companyId wajib diisi" });
  const actor = (req as any).user?.email ?? "admin";

  const count = await lockAllPostedEntries(Number(companyId), periodBefore ?? null);
  await auditBulkLock({ companyId: Number(companyId), count, period: periodBefore ?? null, actor });

  logger.info({ companyId, periodBefore, count, actor }, "[sap-hardening] bulk lock selesai");
  return res.json({ ok: true, lockedCount: count, companyId, periodBefore: periodBefore ?? null });
});

// ─── POST /auto-repair/:batchId ───────────────────────────────────────────

router.post("/auto-repair/:batchId", async (req, res) => {
  const batchId = Number(req.params.batchId);
  if (Number.isNaN(batchId)) return res.status(400).json({ error: "batchId tidak valid" });
  const companyId = req.body?.companyId ? Number(req.body.companyId) : null;
  const actor = (req as any).user?.email ?? "admin";

  const result = await runAutoRepairBatch(batchId, companyId, actor);
  return res.json({ ok: true, batchId, ...result });
});

// ─── GET /audit-trail ─────────────────────────────────────────────────────

router.get("/audit-trail", async (req, res) => {
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const correlationId = (req.query.correlationId as string) || null;
  const limit = Math.min(Number(req.query.limit ?? 50), 500);

  const trail = await getEntityAuditTrail({ companyId, correlationId, limit });
  return res.json({ items: trail, count: trail.length });
});

// ─── GET /consolidation/validate ─────────────────────────────────────────

router.get("/consolidation/validate", async (req, res) => {
  const companyIds = ((req.query.companyIds as string) ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => !Number.isNaN(x) && x > 0);
  if (!companyIds.length) return res.status(400).json({ error: "companyIds wajib diisi (comma-separated)" });

  const fromDate = (req.query.from as string) || null;
  const toDate   = (req.query.to as string)   || null;

  const result = await validateConsolidationReport({ companyIds, fromDate, toDate });
  return res.json(result);
});

// ─── GET /consolidation/report ────────────────────────────────────────────

router.get("/consolidation/report", async (req, res) => {
  const companyIds = ((req.query.companyIds as string) ?? "")
    .split(",")
    .map((x) => Number(x.trim()))
    .filter((x) => !Number.isNaN(x) && x > 0);
  if (!companyIds.length) return res.status(400).json({ error: "companyIds wajib diisi" });

  const fromDate = (req.query.from as string) || null;
  const toDate   = (req.query.to as string)   || null;
  const holdingId = req.query.holdingId ? Number(req.query.holdingId) : null;

  const [reportResult, eliminationResult] = await Promise.all([
    getConsolidatedEntries({ companyIds, fromDate, toDate }),
    holdingId
      ? computeIntercompanyEliminations({
          holdingCompanyId: holdingId,
          subsidiaryIds: companyIds.filter((id) => id !== holdingId),
          fromDate: fromDate ?? "1900-01-01",
          toDate: toDate ?? new Date().toISOString().split("T")[0]!,
        })
      : Promise.resolve(null),
  ]);

  return res.json({
    entries: reportResult.entries,
    excludedDraftCount: reportResult.excludedDraftCount,
    excludedUnlockedCount: reportResult.excludedUnlockedCount,
    eliminations: eliminationResult,
    note: "Hanya entri POSTED + LOCKED yang masuk laporan konsolidasi (SAP FASE 7)",
    generatedAt: new Date().toISOString(),
  });
});

// ─── GET /invoice-lock/:id — SAP Invoice Lock Status ─────────────────────
/**
 * Query the SAP lock status of a vendor invoice.
 * Returns the canonical output format per SAP Invoice Lock Engine spec:
 *   { status, tax_mode, validated, flags }
 *
 * Also accepts optional incoming data via POST body to validate before applying.
 *
 * GET  /api/sap-hardening/invoice-lock/:id          — check current lock state
 * POST /api/sap-hardening/invoice-lock/:id/validate — validate incoming payload against lock rules
 */

router.get("/invoice-lock/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, status, total_amount, tax_amount, grand_total,
             invoice_number, company_id, sap_lock_snapshot
      FROM vendor_invoices
      WHERE id = ${id}
      LIMIT 1
    `));
    if (!rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan" });

    const row = rows[0] as any;
    const sapResult = runSapInvoiceLockEngine({
      id:          row.id,
      status:      String(row.status ?? "draft"),
      totalAmount: row.total_amount,
      taxAmount:   row.tax_amount,
      grandTotal:  row.grand_total,
      invoiceNumber: row.invoice_number,
      companyId:   row.company_id ? Number(row.company_id) : null,
    });

    return res.json({
      invoice_id:     id,
      invoice_number: row.invoice_number,
      // ── SAP SPEC OUTPUT ──────────────────────────────────
      status:    sapResult.status,
      tax_mode:  sapResult.tax_mode,
      validated: sapResult.validated,
      flags:     sapResult.flags,
      // ── Detail ───────────────────────────────────────────
      values:           sapResult.values,
      sap_lock_snapshot: row.sap_lock_snapshot ?? null,
      checked_at:       new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, id }, "[sap-hardening] /invoice-lock/:id error");
    return res.status(500).json({ error: String((err as any)?.message ?? err) });
  }
});

router.post("/invoice-lock/:id/validate", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const incomingData = (req.body ?? {}) as Record<string, unknown>;

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, status, total_amount, tax_amount, grand_total, invoice_number, company_id
      FROM vendor_invoices
      WHERE id = ${id}
      LIMIT 1
    `));
    if (!rows.length) return res.status(404).json({ error: "Invoice tidak ditemukan" });

    const row = rows[0] as any;
    const existing = {
      id:          row.id,
      status:      String(row.status ?? "draft"),
      totalAmount: row.total_amount,
      taxAmount:   row.tax_amount,
      grandTotal:  row.grand_total,
      invoiceNumber: row.invoice_number,
      companyId:   row.company_id ? Number(row.company_id) : null,
    };

    const validation = validateSapInvoiceInput(existing, incomingData);

    return res.status(validation.accepted ? 200 : 409).json({
      invoice_id:    id,
      accepted:      validation.accepted,
      reject_reason: validation.rejectReason ?? null,
      // ── SAP SPEC OUTPUT ──────────────────────────────────
      status:    validation.sapResult.status,
      tax_mode:  validation.sapResult.tax_mode,
      validated: validation.sapResult.validated,
      flags:     validation.sapResult.flags,
    });
  } catch (err) {
    logger.error({ err, id }, "[sap-hardening] /invoice-lock/:id/validate error");
    return res.status(500).json({ error: String((err as any)?.message ?? err) });
  }
});

// ─── GET /coa-mappings ────────────────────────────────────────────────────

router.get("/coa-mappings", async (req, res) => {
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const companyFilter = companyId ? `WHERE company_id = ${companyId} OR company_id IS NULL` : "";
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM master_coa_mapping ${companyFilter}
      ORDER BY confidence DESC, keyword ASC
      LIMIT 200
    `));
    return res.json({ items: rows, count: rows.length });
  } catch (err) {
    return res.status(500).json({ error: String((err as any)?.message ?? err) });
  }
});

// ─── POST /coa-mappings ───────────────────────────────────────────────────

router.post("/coa-mappings", async (req, res) => {
  const { companyId, keyword, erpCategory, entityType, coaDebit, coaCredit, confidence } = req.body ?? {};
  if (!keyword || !coaDebit || !coaCredit) {
    return res.status(400).json({ error: "keyword, coaDebit, coaCredit wajib diisi" });
  }
  try {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO master_coa_mapping
        (company_id, keyword, erp_category, entity_type, coa_debit, coa_credit, confidence)
      VALUES (
        ${companyId ? Number(companyId) : "NULL"},
        '${String(keyword).replace(/'/g, "''")}',
        ${erpCategory ? `'${String(erpCategory).replace(/'/g, "''")}'` : "NULL"},
        ${entityType  ? `'${String(entityType).replace(/'/g, "''")}'`  : "NULL"},
        '${String(coaDebit).replace(/'/g, "''")}',
        '${String(coaCredit).replace(/'/g, "''")}',
        ${Number(confidence ?? 80)}
      )
      RETURNING *
    `));
    return res.status(201).json({ item: rows[0] });
  } catch (err) {
    return res.status(500).json({ error: String((err as any)?.message ?? err) });
  }
});

// ─── DELETE /coa-mappings/:id ─────────────────────────────────────────────

router.delete("/coa-mappings/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  await db.execute(sql.raw(`DELETE FROM master_coa_mapping WHERE id = ${id}`));
  return res.json({ ok: true, id });
});

export default router;

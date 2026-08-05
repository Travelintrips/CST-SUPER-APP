/**
 * Finance Governance & Audit Control Layer — Routes
 * Prefix: /api/accounting/governance
 */

import { Router, type Request, type Response } from "express";
import { createHash } from "crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import {
  financeAuditMiddleware,
  writeFinanceAuditTrail,
  getAuditTrailByCorrelation,
} from "../lib/financeAuditMiddleware.js";
import {
  requireFinanceApproveRole,
  requireFinanceOverrideRole,
  requireLedgerRole,
  logGovernanceBypass,
  FINANCE_MAKER_ROLES,
} from "../lib/financeGovernanceGuard.js";

import { queueIntegrityError } from "../lib/errorContainment.js";
import { safeAccountingPost } from "../lib/safeAccountingPost.js";
import { captureManualJournalTax } from "../lib/taxAutoService.js";
import { runTaxReconciliation } from "../lib/taxReconciliationService.js";

const FINANCE_READ_ROLES = ["finance", "finance_approver", "cfo", "auditor", "accountant", "admin", "super_admin"];

const router = Router();

// Auth guard for all routes
router.use(async (req: Request, res: Response, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// RBAC: all governance endpoints require at minimum a finance read role
router.use(requireLedgerRole(FINANCE_READ_ROLES));

// Inject audit context
router.use(financeAuditMiddleware);

// ── FASE 1: Maker-Checker Approval ───────────────────────────────────────────

// GET /pending — list pending approval workflows
router.get("/journal/pending", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 20)));
  const offset = (page - 1) * limit;

  const { rows } = await db.execute(sql.raw(`
    SELECT
      jaw.*,
      ae.entry_number,
      ae.date,
      ae.total_debit,
      ae.total_credit,
      ae.source,
      ae.description
    FROM journal_approval_workflow jaw
    JOIN accounting_entries ae ON ae.id = jaw.entry_id
    WHERE jaw.company_id = ${companyId}
      AND jaw.status = 'pending'
    ORDER BY jaw.submitted_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  const { rows: countRows } = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS total
    FROM journal_approval_workflow
    WHERE company_id = ${companyId} AND status = 'pending'
  `));

  return res.json({ items: rows, total: (countRows[0] as any)?.total ?? 0, page, limit });
});

// GET /journal/all — list all workflows with filter
router.get("/journal/all", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const status = req.query["status"] as string | undefined;
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 20)));
  const offset = (page - 1) * limit;
  const statusClause = status && status !== "all" ? `AND jaw.status = '${status.replace(/'/g, "''")}'` : "";

  const { rows } = await db.execute(sql.raw(`
    SELECT
      jaw.*,
      ae.entry_number,
      ae.date,
      ae.total_debit,
      ae.total_credit,
      ae.source,
      ae.description
    FROM journal_approval_workflow jaw
    JOIN accounting_entries ae ON ae.id = jaw.entry_id
    WHERE jaw.company_id = ${companyId}
    ${statusClause}
    ORDER BY jaw.submitted_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  const { rows: countRows } = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS total
    FROM journal_approval_workflow jaw
    WHERE jaw.company_id = ${companyId} ${statusClause}
  `));

  return res.json({ items: rows, total: (countRows[0] as any)?.total ?? 0, page, limit });
});

// POST /journal/:entryId/submit — submit draft for approval (maker role only, auditor excluded)
router.post("/journal/:entryId/submit", requireLedgerRole(FINANCE_MAKER_ROLES), async (req: Request, res: Response) => {
  const entryId = Number(req.params["entryId"]);
  const companyId = resolveCompanyId(req);
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const { notes } = req.body as { notes?: string };

  const { rows: entryRows } = await db.execute(sql.raw(`
    SELECT id, status, entry_number, company_id FROM accounting_entries
    WHERE id = ${entryId} AND company_id = ${companyId}
  `));
  const entry = entryRows[0] as any;
  if (!entry) return res.status(404).json({ message: "Entri tidak ditemukan" });
  if (!["draft", "rejected"].includes(entry.status)) {
    return res.status(400).json({ message: `Entri berstatus '${entry.status}' tidak bisa disubmit. Hanya draft atau rejected.` });
  }

  // Check if workflow already exists
  const { rows: existingRows } = await db.execute(sql.raw(`
    SELECT id, status FROM journal_approval_workflow
    WHERE entry_id = ${entryId} AND status = 'pending'
    LIMIT 1
  `));
  if (existingRows.length > 0) {
    return res.status(400).json({ message: "Sudah ada approval workflow aktif untuk entri ini." });
  }

  // Update entry status
  await db.execute(sql.raw(`
    UPDATE accounting_entries
    SET status = 'pending_approval', governance_flags = COALESCE(governance_flags, '{}'::jsonb) || '{"submitted_at": "${new Date().toISOString()}"}'::jsonb
    WHERE id = ${entryId}
  `));

  // Create workflow
  const { rows: workflowRows } = await db.execute(sql.raw(`
    INSERT INTO journal_approval_workflow
      (entry_id, company_id, status, submitted_by, current_approver_role, notes)
    VALUES
      (${entryId}, ${companyId}, 'pending', '${actor.replace(/'/g, "''")}', 'finance_approver', ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"})
    RETURNING *
  `));

  // Log
  await db.execute(sql.raw(`
    INSERT INTO journal_approval_logs (workflow_id, entry_id, action, actor_id, actor_role, reason, ip_address)
    VALUES (${(workflowRows[0] as any).id}, ${entryId}, 'submitted', '${actor.replace(/'/g, "''")}',
            '${((req.user as any)?.role ?? "unknown").replace(/'/g, "''")}', 'Submitted for approval',
            '${(req.financeAuditContext?.ipAddress ?? "").replace(/'/g, "''")}')
  `));

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    entryId,
    action: "SUBMIT_FOR_APPROVAL",
    userId: actor,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: { status: entry.status },
    afterState: { status: "pending_approval", workflowId: (workflowRows[0] as any).id },
  });

  return res.status(201).json({ workflow: workflowRows[0], message: "Entri berhasil disubmit untuk approval." });
});

// POST /journal/:entryId/approve — approve
router.post("/journal/:entryId/approve", requireFinanceApproveRole, async (req: Request, res: Response) => {
  const entryId = Number(req.params["entryId"]);
  const companyId = resolveCompanyId(req);
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const { notes } = req.body as { notes?: string };

  const { rows: wfRows } = await db.execute(sql.raw(`
    SELECT * FROM journal_approval_workflow
    WHERE entry_id = ${entryId} AND company_id = ${companyId} AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `));
  const wf = wfRows[0] as any;
  if (!wf) return res.status(404).json({ message: "Tidak ada workflow pending untuk entri ini." });

  // Self-approval guard
  if (wf.submitted_by && wf.submitted_by === actor) {
    await logGovernanceBypass({ companyId, entryId, actor, action: "SELF_APPROVAL_ATTEMPT", reason: "Actor tried to approve their own submission" });
    return res.status(403).json({ message: "Anda tidak bisa menyetujui entri yang Anda submit sendiri." });
  }

  // Update workflow
  await db.execute(sql.raw(`
    UPDATE journal_approval_workflow
    SET status = 'approved', approved_by = '${actor.replace(/'/g, "''")}',
        approved_at = NOW(), notes = COALESCE(${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"}, notes),
        updated_at = NOW()
    WHERE id = ${wf.id}
  `));

  // Update entry status
  await db.execute(sql.raw(`
    UPDATE accounting_entries
    SET status = 'approved', approved_by = '${actor.replace(/'/g, "''")}', approved_at = NOW()
    WHERE id = ${entryId}
  `));

  await db.execute(sql.raw(`
    INSERT INTO journal_approval_logs (workflow_id, entry_id, action, actor_id, actor_role, reason, ip_address)
    VALUES (${wf.id}, ${entryId}, 'approved', '${actor.replace(/'/g, "''")}',
            '${((req.user as any)?.role ?? "unknown").replace(/'/g, "''")}',
            ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"},
            '${(req.financeAuditContext?.ipAddress ?? "").replace(/'/g, "''")}')
  `));

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    entryId,
    action: "APPROVED",
    userId: actor,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: { status: "pending_approval" },
    afterState: { status: "approved", approvedBy: actor },
  });

  // Auto-post via safeAccountingPost — this is the canonical posting path for manual entries.
  // safeAccountingPost enforces: period check, COA validation, approval gate, lock, audit trail.
  let postWarning: string | undefined;
  try {
    const { rows: entryRows } = await db.execute(sql.raw(`
      SELECT journal_id, date::text AS date FROM accounting_entries
      WHERE id = ${entryId} AND company_id = ${companyId} LIMIT 1
    `));
    const entryMeta = entryRows[0] as any;
    const { rows: lineRows } = await db.execute(sql.raw(`
      SELECT account_id, debit::numeric AS debit, credit::numeric AS credit, description
      FROM accounting_entry_lines WHERE entry_id = ${entryId}
    `));
    const lines = (lineRows as any[]).map((l) => ({
      accountId: Number(l.account_id),
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: l.description ?? null,
    }));
    const postResult = await safeAccountingPost({
      companyId,
      journalId: Number(entryMeta.journal_id),
      date: String(entryMeta.date),
      lines,
      normalizedEntryId: entryId,
      source: "governance_approval",
      actor,
      actorType: "USER",
      description: `Auto-posted after approval by ${actor}`,
      correlationId: req.financeCorrelationId ?? undefined,
      postFn: async () => {
        // Atomically set status='posted' AND is_locked=TRUE in one UPDATE.
        // OLD.status is 'approved' at this point — the immutability trigger only
        // fires when OLD.status='posted', so this UPDATE succeeds.
        // After this, lockAccountingEntry() uses WHERE is_locked=FALSE → no-op (already locked).
        await db.execute(sql.raw(`
          UPDATE accounting_entries
          SET status = 'posted', is_locked = TRUE, locked_by = '${actor.replace(/'/g, "''")}', locked_at = NOW()
          WHERE id = ${entryId} AND company_id = ${companyId}
        `));
        return entryId;
      },
    });
    if (!postResult.ok) {
      postWarning = postResult.errors?.[0]?.message ?? "Posting otomatis gagal.";
    } else {
      // ── T007: Auto Tax — tangkap pajak dari baris jurnal ──────────────────
      const entryDateStr = String(entryMeta.date);
      try {
        const { rows: numRows } = await db.execute(sql.raw(`
          SELECT entry_number FROM accounting_entries WHERE id = ${entryId} LIMIT 1
        `));
        const entryNumber = (numRows[0] as any)?.entry_number ?? null;

        await captureManualJournalTax({
          companyId,
          entryId,
          entryNumber,
          entryDate: entryDateStr,
        });
      } catch (taxErr) {
        // Non-fatal — jangan gagalkan response utama
        const taxErrMsg = taxErr instanceof Error ? taxErr.message : String(taxErr);
        logger.warn({ err: taxErrMsg, entryId }, "[T007] captureManualJournalTax failed (non-fatal)");
      }

      // ── T008: Auto Reconciliation (fire-and-forget) ───────────────────────
      const d8 = new Date(entryDateStr);
      const taxPeriod = `${d8.getFullYear()}-${String(d8.getMonth() + 1).padStart(2, "0")}`;
      runTaxReconciliation(companyId, taxPeriod)
        .then((recon: any) => {
          if (recon && recon.is_balanced === false) {
            logger.warn({ companyId, taxPeriod, gapCount: recon.gaps?.length ?? 0 },
              "[T008] Tax reconciliation gaps found after manual journal posting");
          }
        })
        .catch(() => {});
    }
  } catch (postErr) {
    postWarning = postErr instanceof Error ? postErr.message : "Posting otomatis gagal.";
  }

  return res.json({
    message: postWarning
      ? "Entri berhasil disetujui tetapi posting otomatis gagal."
      : "Entri berhasil disetujui dan diposting.",
    workflowId: wf.id,
    ...(postWarning ? { postWarning } : {}),
  });
});

// POST /journal/:entryId/reject — reject
router.post("/journal/:entryId/reject", requireFinanceApproveRole, async (req: Request, res: Response) => {
  const entryId = Number(req.params["entryId"]);
  const companyId = resolveCompanyId(req);
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) {
    return res.status(400).json({ message: "Alasan penolakan wajib diisi." });
  }

  const { rows: wfRows } = await db.execute(sql.raw(`
    SELECT * FROM journal_approval_workflow
    WHERE entry_id = ${entryId} AND company_id = ${companyId} AND status = 'pending'
    ORDER BY created_at DESC LIMIT 1
  `));
  const wf = wfRows[0] as any;
  if (!wf) return res.status(404).json({ message: "Tidak ada workflow pending untuk entri ini." });

  await db.execute(sql.raw(`
    UPDATE journal_approval_workflow
    SET status = 'rejected', rejected_by = '${actor.replace(/'/g, "''")}',
        rejected_at = NOW(), notes = '${reason.replace(/'/g, "''")}', updated_at = NOW()
    WHERE id = ${wf.id}
  `));

  await db.execute(sql.raw(`
    UPDATE accounting_entries SET status = 'rejected' WHERE id = ${entryId}
  `));

  await db.execute(sql.raw(`
    INSERT INTO journal_approval_logs (workflow_id, entry_id, action, actor_id, actor_role, reason, ip_address)
    VALUES (${wf.id}, ${entryId}, 'rejected', '${actor.replace(/'/g, "''")}',
            '${((req.user as any)?.role ?? "unknown").replace(/'/g, "''")}',
            '${reason.replace(/'/g, "''")}',
            '${(req.financeAuditContext?.ipAddress ?? "").replace(/'/g, "''")}')
  `));

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    entryId,
    action: "REJECTED",
    userId: actor,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: { status: "pending_approval" },
    afterState: { status: "rejected", rejectedBy: actor, reason },
  });

  return res.json({ message: "Entri berhasil ditolak.", workflowId: wf.id });
});

// ── FASE 8: System Override ────────────────────────────────────────────────

router.post("/override", requireFinanceOverrideRole, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const { entryId, reason, targetAction } = req.body as {
    entryId: number; reason: string; targetAction: string;
  };

  if (!entryId || !reason?.trim() || !targetAction?.trim()) {
    return res.status(400).json({ message: "entryId, reason, dan targetAction wajib diisi." });
  }

  const { rows: entryRows } = await db.execute(sql.raw(`
    SELECT id, status, entry_number FROM accounting_entries
    WHERE id = ${entryId} AND company_id = ${companyId}
  `));
  if (!entryRows[0]) return res.status(404).json({ message: "Entri tidak ditemukan." });

  const beforeState = { ...(entryRows[0] as any) };

  await db.execute(sql.raw(`
    UPDATE accounting_entries
    SET system_override = TRUE,
        override_reason = '${reason.replace(/'/g, "''")}',
        override_by = '${actor.replace(/'/g, "''")}',
        override_at = NOW()
    WHERE id = ${entryId}
  `));

  // Get or create workflow
  const { rows: wfRows } = await db.execute(sql.raw(`
    SELECT id FROM journal_approval_workflow WHERE entry_id = ${entryId}
    ORDER BY created_at DESC LIMIT 1
  `));
  let workflowId = (wfRows[0] as any)?.id;

  if (!workflowId) {
    const { rows: newWf } = await db.execute(sql.raw(`
      INSERT INTO journal_approval_workflow
        (entry_id, company_id, status, submitted_by, current_approver_role, notes)
      VALUES (${entryId}, ${companyId}, 'approved', '${actor.replace(/'/g, "''")}', 'cfo', 'System override')
      RETURNING id
    `));
    workflowId = (newWf[0] as any)?.id;
  }

  await db.execute(sql.raw(`
    INSERT INTO journal_approval_logs (workflow_id, entry_id, action, actor_id, actor_role, reason, ip_address)
    VALUES (${workflowId ?? "NULL"}, ${entryId}, 'override', '${actor.replace(/'/g, "''")}',
            '${((req.user as any)?.role ?? "unknown").replace(/'/g, "''")}',
            '${reason.replace(/'/g, "''")}',
            '${(req.financeAuditContext?.ipAddress ?? "").replace(/'/g, "''")}')
  `));

  await queueIntegrityError({
    companyId,
    classification: "HIGH",
    module: "finance_governance",
    errorCode: "SYSTEM_OVERRIDE",
    message: `System override oleh ${actor}: ${targetAction} — ${reason}`,
    context: { entryId, targetAction, beforeStatus: (entryRows[0] as any).status },
    entityType: "accounting_entry",
    entityId: String(entryId),
  });

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    entryId,
    action: "SYSTEM_OVERRIDE",
    userId: actor,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState,
    afterState: { systemOverride: true, overrideBy: actor, overrideReason: reason, targetAction },
  });

  return res.json({ ok: true, message: "System override berhasil dicatat.", entryId });
});

// ── FASE 4: Period hard close ─────────────────────────────────────────────

router.post("/periods/:id/close", requireFinanceOverrideRole, async (req: Request, res: Response) => {
  const periodId = Number(req.params["id"]);
  const companyId = resolveCompanyId(req);
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const { reason } = req.body as { reason?: string };

  if (!reason?.trim()) {
    return res.status(400).json({ message: "Alasan penutupan period wajib diisi." });
  }

  const { rows } = await db.execute(sql.raw(`
    SELECT id, company_id, year, month, is_closed
    FROM financial_periods
    WHERE id = ${periodId} AND company_id = ${companyId}
  `));
  const period = rows[0] as any;
  if (!period) return res.status(404).json({ message: "Period tidak ditemukan." });
  if (period.is_closed) return res.status(400).json({ message: "Period sudah tertutup." });

  const now = new Date().toISOString();
  const sigInput = `${companyId}|${period.year}|${period.month}|${actor}|${now}`;
  const signature = createHash("sha256").update(sigInput).digest("hex");

  await db.execute(sql.raw(`
    UPDATE financial_periods
    SET is_closed = TRUE,
        closed_at = NOW(),
        closed_by = '${actor.replace(/'/g, "''")}',
        period_close_signature = '${signature}',
        close_reason = '${reason.replace(/'/g, "''")}'
    WHERE id = ${periodId}
  `));

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    action: "PERIOD_CLOSED",
    userId: actor,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: { periodId, year: period.year, month: period.month, isClosed: false },
    afterState: { periodId, year: period.year, month: period.month, signature, reason, isClosed: true },
  });

  return res.json({ ok: true, signature, message: `Period ${period.year}-${String(period.month).padStart(2,"0")} berhasil ditutup.` });
});

// ── FASE 5 & 6: Dashboard data endpoints ──────────────────────────────────

// GET /anomalies — list anomaly log
router.get("/anomalies", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const severity = req.query["severity"] as string | undefined;
  const reviewed = req.query["reviewed"];
  const page = Math.max(1, Number(req.query["page"] ?? 1));
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 20)));
  const offset = (page - 1) * limit;

  const conditions: string[] = [`company_id = ${companyId}`];
  if (severity && severity !== "all") conditions.push(`severity = '${severity.replace(/'/g, "''")}'`);
  if (reviewed === "false") conditions.push("reviewed = FALSE");
  if (reviewed === "true") conditions.push("reviewed = TRUE");

  const where = conditions.join(" AND ");

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM finance_anomaly_log WHERE ${where}
    ORDER BY detected_at DESC LIMIT ${limit} OFFSET ${offset}
  `));
  const { rows: cnt } = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS total FROM finance_anomaly_log WHERE ${where}
  `));

  return res.json({ items: rows, total: (cnt[0] as any)?.total ?? 0, page, limit });
});

// PATCH /anomalies/:id/review — always scoped to company (prevents IDOR)
router.patch("/anomalies/:id/review", requireFinanceApproveRole, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  const companyId = resolveCompanyId(req);
  const actor = req.user?.email ?? req.user?.id ?? "unknown";
  const { rowCount } = await db.execute(sql.raw(`
    UPDATE finance_anomaly_log
    SET reviewed = TRUE, reviewed_by = '${actor.replace(/'/g, "''")}', reviewed_at = NOW()
    WHERE id = ${id} AND company_id = ${companyId}
  `)) as any;
  if (!rowCount) {
    return res.status(404).json({ code: "NOT_FOUND", message: "Anomali tidak ditemukan atau bukan milik perusahaan ini." });
  }
  return res.json({ ok: true });
});

// GET /audit-trail — list recent audit trail events (always scoped to company)
router.get("/audit-trail", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const correlationId = req.query["correlationId"] as string | undefined;
  const entryId = req.query["entryId"] ? Number(req.query["entryId"]) : undefined;
  const limit = Math.min(100, Math.max(1, Number(req.query["limit"] ?? 50)));

  // correlationId search: still scope by company for security
  if (correlationId) {
    const { rows } = await db.execute(sql.raw(`
      SELECT fat.*
      FROM finance_audit_trail fat
      WHERE fat.correlation_id = '${correlationId.replace(/'/g, "''")}'
        AND (fat.company_id = ${companyId} OR fat.company_id IS NULL)
      ORDER BY fat.created_at ASC
    `));
    return res.json({ items: rows, correlationId });
  }

  // Always filter by company_id — no cross-company data exposure
  const conditions: string[] = [`(fat.company_id = ${companyId} OR fat.company_id IS NULL)`];
  if (entryId) {
    conditions.push(`fat.entry_id = ${entryId}`);
    // Extra safety: verify entry belongs to this company
    conditions.push(`NOT EXISTS (
      SELECT 1 FROM accounting_entries ae
      WHERE ae.id = ${entryId} AND ae.company_id <> ${companyId}
    )`);
  }

  const { rows } = await db.execute(sql.raw(`
    SELECT fat.*
    FROM finance_audit_trail fat
    WHERE ${conditions.join(" AND ")}
    ORDER BY fat.created_at DESC
    LIMIT ${limit}
  `));
  return res.json({ items: rows });
});

// GET /locked-periods — list closed periods with signature
router.get("/locked-periods", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { rows } = await db.execute(sql.raw(`
    SELECT id, year, month, is_closed, closed_at, closed_by,
           period_close_signature, close_reason, override_allowed
    FROM financial_periods
    WHERE company_id = ${companyId}
    ORDER BY year DESC, month DESC
    LIMIT 60
  `));
  return res.json({ items: rows });
});

// GET /stats — KPI counts
router.get("/stats", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);

  const [pending, anomalies, lockedPeriods, overrides] = await Promise.all([
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM journal_approval_workflow
      WHERE company_id = ${companyId} AND status = 'pending'
    `)),
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM finance_anomaly_log
      WHERE company_id = ${companyId} AND reviewed = FALSE
    `)),
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM financial_periods
      WHERE company_id = ${companyId} AND is_closed = TRUE
    `)),
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt FROM accounting_entries
      WHERE company_id = ${companyId} AND system_override = TRUE
    `)),
  ]);

  return res.json({
    pendingApprovals: (pending.rows[0] as any)?.cnt ?? 0,
    openAnomalies: (anomalies.rows[0] as any)?.cnt ?? 0,
    lockedPeriods: (lockedPeriods.rows[0] as any)?.cnt ?? 0,
    totalOverrides: (overrides.rows[0] as any)?.cnt ?? 0,
  });
});

// ── FASE 9: Dual-Control Override (Four-Eyes Principle) ──────────────────────
//
// Flow:
//   1. Requester (finance_override role) → POST /override-requests          → status: PENDING_SECOND_APPROVAL  → audit: OVERRIDE_REQUESTED
//   2. Different approver (finance_override role) → POST /override-requests/:id/approve → status: APPROVED     → audit: OVERRIDE_APPROVED
//      OR → POST /override-requests/:id/reject   → status: REJECTED                                           → audit: OVERRIDE_REJECTED
//   3. Any finance_override user → POST /override-requests/:id/execute      → status: EXECUTED                → audit: OVERRIDE_EXECUTED
//
// Invariant: requester_id !== approver_id enforced server-side on approve/reject.

// POST /override-requests — create a new override request (PENDING_SECOND_APPROVAL)
router.post("/override-requests", requireFinanceOverrideRole, async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const requesterId = (req.user as any)?.id ?? (req.user as any)?.email ?? "unknown";
  const requesterEmail = (req.user as any)?.email ?? requesterId;

  const { entityType, entityId, targetAction, reason } = req.body as {
    entityType?: string; entityId?: string | number;
    targetAction?: string; reason?: string;
  };

  if (!entityType?.trim() || !entityId || !targetAction?.trim() || !reason?.trim()) {
    return res.status(400).json({
      message: "entityType, entityId, targetAction, dan reason wajib diisi.",
    });
  }

  // Capture entity snapshot
  let entitySnapshot: Record<string, unknown> | null = null;
  if (entityType === "accounting_entry") {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, status, entry_number, description FROM accounting_entries
      WHERE id = ${Number(entityId)} AND company_id = ${companyId} LIMIT 1
    `));
    if (!rows[0]) return res.status(404).json({ message: "Entri tidak ditemukan." });
    entitySnapshot = rows[0] as Record<string, unknown>;
  } else if (entityType === "financial_period") {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, year, month, is_closed FROM financial_periods
      WHERE id = ${Number(entityId)} AND company_id = ${companyId} LIMIT 1
    `));
    if (!rows[0]) return res.status(404).json({ message: "Period tidak ditemukan." });
    entitySnapshot = rows[0] as Record<string, unknown>;
  }

  const snapshotSql = entitySnapshot
    ? `'${JSON.stringify(entitySnapshot).replace(/'/g, "''")}'::jsonb`
    : "NULL";

  const { rows: inserted } = await db.execute(sql.raw(`
    INSERT INTO finance_override_requests
      (company_id, requester_id, requester_email, status,
       entity_type, entity_id, entity_snapshot, target_action, reason)
    VALUES
      (${companyId}, '${requesterId.replace(/'/g, "''")}',
       '${requesterEmail.replace(/'/g, "''")}',
       'PENDING_SECOND_APPROVAL',
       '${entityType.replace(/'/g, "''")}',
       '${String(entityId).replace(/'/g, "''")}',
       ${snapshotSql},
       '${targetAction.replace(/'/g, "''")}',
       '${reason.replace(/'/g, "''")}')
    RETURNING *
  `));
  const request = inserted[0] as any;

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    action: "OVERRIDE_REQUESTED",
    userId: requesterEmail,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    afterState: {
      requestId: request.id,
      entityType,
      entityId: String(entityId),
      targetAction,
      reason,
      requester: requesterEmail,
      status: "PENDING_SECOND_APPROVAL",
      entitySnapshot,
    },
  });

  return res.status(201).json({
    message: "Override request dibuat. Menunggu persetujuan dari pengguna berbeda.",
    request,
  });
});

// GET /override-requests — list override requests for this company
router.get("/override-requests", async (req: Request, res: Response) => {
  const companyId = resolveCompanyId(req);
  const { status, page: pageQ, limit: limitQ } = req.query as Record<string, string>;
  const page = Math.max(1, Number(pageQ ?? 1));
  const limit = Math.min(100, Math.max(1, Number(limitQ ?? 20)));
  const offset = (page - 1) * limit;

  const statusFilter = status
    ? `AND status = '${status.replace(/'/g, "''")}'::override_request_status`
    : "";

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM finance_override_requests
    WHERE company_id = ${companyId} ${statusFilter}
    ORDER BY created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `));

  const { rows: countRows } = await db.execute(sql.raw(`
    SELECT COUNT(*)::int AS cnt FROM finance_override_requests
    WHERE company_id = ${companyId} ${statusFilter}
  `));

  return res.json({
    items: rows,
    total: (countRows[0] as any)?.cnt ?? 0,
    page,
    limit,
  });
});

// GET /override-requests/:id — detail
router.get("/override-requests/:id", async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (Number.isNaN(id)) return res.status(400).json({ message: "ID tidak valid." });
  const companyId = resolveCompanyId(req);

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM finance_override_requests
    WHERE id = ${id} AND company_id = ${companyId}
    LIMIT 1
  `));
  if (!rows[0]) return res.status(404).json({ message: "Override request tidak ditemukan." });
  return res.json(rows[0]);
});

// POST /override-requests/:id/approve — second approval (different user)
router.post("/override-requests/:id/approve", requireFinanceOverrideRole, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (Number.isNaN(id)) return res.status(400).json({ message: "ID tidak valid." });
  const companyId = resolveCompanyId(req);
  const approverId = (req.user as any)?.id ?? (req.user as any)?.email ?? "unknown";
  const approverEmail = (req.user as any)?.email ?? approverId;

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM finance_override_requests
    WHERE id = ${id} AND company_id = ${companyId} LIMIT 1
  `));
  const request = rows[0] as any;
  if (!request) return res.status(404).json({ message: "Override request tidak ditemukan." });
  if (request.status !== "PENDING_SECOND_APPROVAL") {
    return res.status(400).json({
      message: `Request sudah dalam status ${request.status}. Hanya status PENDING_SECOND_APPROVAL yang bisa disetujui.`,
    });
  }

  // Dual-control invariant: approver cannot be the same as requester
  if (request.requester_id === approverId) {
    await logGovernanceBypass({
      companyId,
      actor: approverEmail,
      action: "SELF_APPROVE_OVERRIDE_ATTEMPT",
      reason: `User ${approverEmail} mencoba menyetujui override request yang dibuat sendiri (request #${id}).`,
    });
    return res.status(403).json({
      code: "SELF_APPROVAL_FORBIDDEN",
      message: "Pengguna yang membuat override request tidak dapat menyetujuinya sendiri. Four-eyes principle wajib.",
    });
  }

  await db.execute(sql.raw(`
    UPDATE finance_override_requests
    SET status = 'APPROVED',
        approver_id = '${approverId.replace(/'/g, "''")}',
        approver_email = '${approverEmail.replace(/'/g, "''")}',
        approved_at = NOW()
    WHERE id = ${id}
  `));

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    action: "OVERRIDE_APPROVED",
    userId: approverEmail,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: { requestId: id, status: "PENDING_SECOND_APPROVAL", requester: request.requester_email },
    afterState: {
      requestId: id,
      status: "APPROVED",
      approver: approverEmail,
      entityType: request.entity_type,
      entityId: request.entity_id,
      targetAction: request.target_action,
    },
  });

  return res.json({
    message: "Override request disetujui. Lanjutkan eksekusi via /override-requests/:id/execute.",
    requestId: id,
  });
});

// POST /override-requests/:id/reject — reject (different user)
router.post("/override-requests/:id/reject", requireFinanceOverrideRole, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (Number.isNaN(id)) return res.status(400).json({ message: "ID tidak valid." });
  const companyId = resolveCompanyId(req);
  const approverId = (req.user as any)?.id ?? (req.user as any)?.email ?? "unknown";
  const approverEmail = (req.user as any)?.email ?? approverId;
  const { reason: rejectionReason } = req.body as { reason?: string };

  if (!rejectionReason?.trim()) {
    return res.status(400).json({ message: "Alasan penolakan wajib diisi." });
  }

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM finance_override_requests
    WHERE id = ${id} AND company_id = ${companyId} LIMIT 1
  `));
  const request = rows[0] as any;
  if (!request) return res.status(404).json({ message: "Override request tidak ditemukan." });
  if (request.status !== "PENDING_SECOND_APPROVAL") {
    return res.status(400).json({
      message: `Request sudah dalam status ${request.status}. Hanya status PENDING_SECOND_APPROVAL yang bisa ditolak.`,
    });
  }

  // Dual-control invariant
  if (request.requester_id === approverId) {
    return res.status(403).json({
      code: "SELF_REJECTION_FORBIDDEN",
      message: "Pengguna yang membuat override request tidak dapat menolaknya sendiri. Four-eyes principle wajib.",
    });
  }

  await db.execute(sql.raw(`
    UPDATE finance_override_requests
    SET status = 'REJECTED',
        approver_id = '${approverId.replace(/'/g, "''")}',
        approver_email = '${approverEmail.replace(/'/g, "''")}',
        rejection_reason = '${rejectionReason.replace(/'/g, "''")}',
        rejected_at = NOW()
    WHERE id = ${id}
  `));

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    action: "OVERRIDE_REJECTED",
    userId: approverEmail,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: { requestId: id, status: "PENDING_SECOND_APPROVAL", requester: request.requester_email },
    afterState: {
      requestId: id,
      status: "REJECTED",
      rejectedBy: approverEmail,
      rejectionReason,
      entityType: request.entity_type,
      entityId: request.entity_id,
    },
  });

  return res.json({ message: "Override request ditolak.", requestId: id });
});

// POST /override-requests/:id/execute — execute the approved override action
router.post("/override-requests/:id/execute", requireFinanceOverrideRole, async (req: Request, res: Response) => {
  const id = Number(req.params["id"]);
  if (Number.isNaN(id)) return res.status(400).json({ message: "ID tidak valid." });
  const companyId = resolveCompanyId(req);
  const actor = (req.user as any)?.email ?? (req.user as any)?.id ?? "unknown";

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM finance_override_requests
    WHERE id = ${id} AND company_id = ${companyId} LIMIT 1
  `));
  const request = rows[0] as any;
  if (!request) return res.status(404).json({ message: "Override request tidak ditemukan." });
  if (request.status !== "APPROVED") {
    return res.status(400).json({
      message: `Override hanya bisa dieksekusi setelah disetujui. Status saat ini: ${request.status}.`,
    });
  }

  const entityId = Number(request.entity_id);
  const targetAction: string = request.target_action;
  let executionResult: Record<string, unknown> = {};

  // Dispatch execution based on entity_type + target_action
  if (request.entity_type === "accounting_entry") {
    const { rows: entryRows } = await db.execute(sql.raw(`
      SELECT id, status, entry_number FROM accounting_entries
      WHERE id = ${entityId} AND company_id = ${companyId} LIMIT 1
    `));
    if (!entryRows[0]) return res.status(404).json({ message: "Entri accounting tidak ditemukan." });

    await db.execute(sql.raw(`
      UPDATE accounting_entries
      SET system_override = TRUE,
          override_reason = '${request.reason.replace(/'/g, "''")}',
          override_by = '${actor.replace(/'/g, "''")}',
          override_at = NOW()
      WHERE id = ${entityId}
    `));

    // Upsert journal_approval_workflow
    const { rows: wfRows } = await db.execute(sql.raw(`
      SELECT id FROM journal_approval_workflow
      WHERE entry_id = ${entityId} AND company_id = ${companyId}
      ORDER BY created_at DESC LIMIT 1
    `));
    let workflowId = (wfRows[0] as any)?.id;
    if (!workflowId) {
      const { rows: newWf } = await db.execute(sql.raw(`
        INSERT INTO journal_approval_workflow
          (entry_id, company_id, status, submitted_by, current_approver_role, notes)
        VALUES (${entityId}, ${companyId}, 'approved', '${actor.replace(/'/g, "''")}', 'cfo', 'Dual-control override — request #${id}')
        RETURNING id
      `));
      workflowId = (newWf[0] as any)?.id;
    }
    await db.execute(sql.raw(`
      INSERT INTO journal_approval_logs
        (workflow_id, entry_id, action, actor_id, actor_role, reason, ip_address)
      VALUES (${workflowId ?? "NULL"}, ${entityId}, 'override',
              '${actor.replace(/'/g, "''")}',
              '${((req.user as any)?.role ?? "cfo").replace(/'/g, "''")}',
              'Dual-control override request #${id}: ${request.reason.replace(/'/g, "''")}',
              '${(req.financeAuditContext?.ipAddress ?? "").replace(/'/g, "''")}')
    `));
    executionResult = { entryId: entityId, action: targetAction, systemOverrideSet: true };

  } else if (request.entity_type === "financial_period") {
    await db.execute(sql.raw(`
      UPDATE financial_periods
      SET override_allowed = TRUE,
          closed_by = '${actor.replace(/'/g, "''")}',
          close_reason = 'Dual-control override #${id}: ${request.reason.replace(/'/g, "''")}'
      WHERE id = ${entityId} AND company_id = ${companyId}
    `));
    executionResult = { periodId: entityId, action: targetAction, overrideAllowed: true };
  } else {
    // Generic: mark executed without specific side-effect
    executionResult = { entityType: request.entity_type, entityId: request.entity_id, action: targetAction };
  }

  // Mark request as EXECUTED
  await db.execute(sql.raw(`
    UPDATE finance_override_requests
    SET status = 'EXECUTED', executed_at = NOW()
    WHERE id = ${id}
  `));

  // Queue integrity event
  await queueIntegrityError({
    companyId,
    classification: "HIGH",
    module: "finance_governance",
    errorCode: "DUAL_CONTROL_OVERRIDE_EXECUTED",
    message: `Dual-control override #${id} dieksekusi oleh ${actor} (disetujui oleh ${request.approver_email}) — action: ${targetAction}`,
    context: {
      requestId: id,
      requesterId: request.requester_id,
      approverId: request.approver_id,
      entityType: request.entity_type,
      entityId: request.entity_id,
      targetAction,
    },
    entityType: request.entity_type,
    entityId: request.entity_id,
  });

  await writeFinanceAuditTrail({
    correlationId: req.financeCorrelationId!,
    companyId,
    action: "OVERRIDE_EXECUTED",
    userId: actor,
    userRole: (req.user as any)?.role ?? null,
    ipAddress: req.financeAuditContext?.ipAddress ?? null,
    beforeState: {
      requestId: id,
      status: "APPROVED",
      requester: request.requester_email,
      approver: request.approver_email,
    },
    afterState: {
      requestId: id,
      status: "EXECUTED",
      executedBy: actor,
      entityType: request.entity_type,
      entityId: request.entity_id,
      targetAction,
      result: executionResult,
    },
    approvalChain: [
      { step: 1, role: "requester", actor: request.requester_email, at: request.created_at, action: "REQUESTED" },
      { step: 2, role: "approver",  actor: request.approver_email,  at: request.approved_at, action: "APPROVED" },
      { step: 3, role: "executor",  actor,                          at: new Date().toISOString(), action: "EXECUTED" },
    ],
  });

  return res.json({
    message: "Override berhasil dieksekusi dengan dual-control approval.",
    requestId: id,
    result: executionResult,
    auditChain: {
      requester: request.requester_email,
      approver: request.approver_email,
      executor: actor,
    },
  });
});

// GET /approval-logs/:entryId — scoped by company_id via JOIN (prevents IDOR)
router.get("/approval-logs/:entryId", async (req: Request, res: Response) => {
  const entryId = Number(req.params["entryId"]);
  const companyId = resolveCompanyId(req);
  const { rows } = await db.execute(sql.raw(`
    SELECT jal.*, jaw.status AS workflow_status, jaw.submitted_by, jaw.approved_by
    FROM journal_approval_logs jal
    JOIN journal_approval_workflow jaw ON jaw.id = jal.workflow_id
    WHERE jal.entry_id = ${entryId}
      AND jaw.company_id = ${companyId}
    ORDER BY jal.created_at ASC
  `));
  return res.json({ items: rows });
});

export default router;

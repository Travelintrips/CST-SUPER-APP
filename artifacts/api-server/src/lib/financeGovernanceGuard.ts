/**
 * Finance Governance — FASE 9
 * Composable enforcement middleware chain
 *
 * Guards (in order):
 *  1. Period open check
 *  2. RBAC role check
 *  3. Approval required check (for write operations)
 *  4. Audit context present check (correlation_id)
 */

import type { Request, Response, NextFunction } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { queueIntegrityError } from "./errorContainment.js";
import { resolveCompanyId } from "./resolveCompany.js";

// accountant can create drafts and view ledger (cannot approve own submissions)
const FINANCE_WRITE_ROLES = ["accountant", "finance", "finance_approver", "cfo", "admin", "super_admin"];
const FINANCE_APPROVE_ROLES = ["finance_approver", "cfo", "admin", "super_admin"];
const FINANCE_OVERRIDE_ROLES = ["cfo", "super_admin", "admin"];
// Maker roles: can create/submit entries — auditor explicitly excluded (read-only)
export const FINANCE_MAKER_ROLES = ["accountant", "finance", "finance_approver", "cfo", "admin", "super_admin"];

function getUserRole(req: Request): string | null {
  return (req.user as any)?.role ?? (req.user as any)?.system_role ?? null;
}

function getUserId(req: Request): string | null {
  return (req.user as any)?.id ?? (req.user as any)?.email ?? null;
}

// Guard: requires finance write role
export function requireFinanceWriteRole(req: Request, res: Response, next: NextFunction): void {
  const role = getUserRole(req);
  if (!role || !FINANCE_WRITE_ROLES.includes(role)) {
    res.status(403).json({
      code: "FINANCE_ROLE_REQUIRED",
      message: "Akses ditolak. Role keuangan diperlukan untuk operasi ini.",
    });
    return;
  }
  next();
}

// Guard: requires finance approve role
export function requireFinanceApproveRole(req: Request, res: Response, next: NextFunction): void {
  const role = getUserRole(req);
  if (!role || !FINANCE_APPROVE_ROLES.includes(role)) {
    res.status(403).json({
      code: "FINANCE_APPROVER_ROLE_REQUIRED",
      message: "Akses ditolak. Role Finance Approver, CFO, atau Admin diperlukan.",
    });
    return;
  }
  next();
}

// Guard: requires CFO/override role
export function requireFinanceOverrideRole(req: Request, res: Response, next: NextFunction): void {
  const role = getUserRole(req);
  if (!role || !FINANCE_OVERRIDE_ROLES.includes(role)) {
    res.status(403).json({
      code: "FINANCE_OVERRIDE_ROLE_REQUIRED",
      message: "Akses ditolak. Hanya CFO atau System Admin yang dapat melakukan override.",
    });
    return;
  }
  next();
}

// Guard: ensure audit correlation_id is present
export function requireAuditContext(req: Request, res: Response, next: NextFunction): void {
  if (!req.financeCorrelationId) {
    logger.warn({ path: req.path }, "[governance] Missing financeCorrelationId — audit context not injected");
    res.status(500).json({
      code: "AUDIT_CONTEXT_MISSING",
      message: "Audit context tidak tersedia. Pastikan financeAuditMiddleware terpasang.",
    });
    return;
  }
  next();
}

// Guard: check entry is not in a closed period (async middleware)
export function requireOpenPeriod(req: Request, res: Response, next: NextFunction): void {
  const dateStr: string | undefined = req.body?.date ?? req.query["date"] as string | undefined;
  const companyId = resolveCompanyId(req);

  if (!dateStr) {
    res.status(422).json({
      code: "PERIOD_DATE_REQUIRED",
      message: "Parameter 'date' wajib disertakan untuk validasi period lock. Operasi dibatalkan.",
    });
    return;
  }
  if (!companyId) {
    res.status(422).json({
      code: "COMPANY_ID_REQUIRED",
      message: "companyId wajib ada untuk validasi period lock. Operasi dibatalkan.",
    });
    return;
  }

  const d = new Date(dateStr);
  if (isNaN(d.getTime())) {
    res.status(422).json({
      code: "PERIOD_DATE_INVALID",
      message: `Format tanggal tidak valid: '${dateStr}'. Gunakan format ISO 8601 (YYYY-MM-DD).`,
    });
    return;
  }

  const year = d.getFullYear();
  const month = d.getMonth() + 1;

  db.execute(sql.raw(`
    SELECT is_closed, override_allowed
    FROM financial_periods
    WHERE company_id = ${companyId} AND year = ${year} AND month = ${month}
    LIMIT 1
  `)).then(({ rows }) => {
    const period = rows[0] as any;
    if (period?.is_closed && !period?.override_allowed) {
      const periodStr = `${year}-${String(month).padStart(2, "0")}`;
      res.status(422).json({
        code: "PERIOD_CLOSED",
        message: `Periode ${periodStr} sudah ditutup. Buat reversal entry di periode baru.`,
      });
      return;
    }
    next();
  }).catch((err) => {
    // FAIL-CLOSED: governance checks must never fail-open. DB unavailability blocks writes.
    logger.error({ err }, "[governance] requireOpenPeriod DB error — blocking request (fail-closed)");
    res.status(503).json({
      code: "GOVERNANCE_UNAVAILABLE",
      message: "Governance period check tidak tersedia. Coba lagi atau hubungi administrator.",
    });
  });
}

// Guard: check that entry has an approved workflow before posting (FAIL-CLOSED)
// Returns { ok: false } on any DB error — governance checks must never fail-open.
export async function requireApprovedWorkflow(entryId: number, companyId: number): Promise<{ ok: boolean; message?: string }> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT status FROM journal_approval_workflow
      WHERE entry_id = ${entryId} AND company_id = ${companyId}
      ORDER BY created_at DESC
      LIMIT 1
    `));
    const workflow = rows[0] as any;
    if (!workflow) {
      return { ok: false, message: "Tidak ada approval workflow untuk entri ini. Submit untuk approval terlebih dahulu." };
    }
    if (workflow.status !== "approved") {
      return { ok: false, message: `Entri belum disetujui. Status approval: ${workflow.status}.` };
    }
    return { ok: true };
  } catch (err) {
    logger.error({ err, entryId }, "[governance] requireApprovedWorkflow check failed — blocking (fail-closed)");
    return { ok: false, message: "Governance check gagal — posting diblokir demi keamanan. Coba lagi." };
  }
}

// requireLedgerRole — checks that the user has one of the allowed ledger roles
export function requireLedgerRole(allowedRoles: string[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const role = getUserRole(req);
    if (!role || !allowedRoles.includes(role)) {
      res.status(403).json({
        code: "LEDGER_ROLE_REQUIRED",
        message: `Akses ditolak. Role yang diizinkan: ${allowedRoles.join(", ")}.`,
      });
      return;
    }
    next();
  };
}

// writeMethodGovernanceGuard — full governance chain for financial write methods (POST/PUT/PATCH/DELETE).
// Enforces: open period + finance write role (RBAC) + approval-state guard + audit context.
// GET/HEAD/OPTIONS pass through unchanged.
//
// Approval-state guard: if the request references an existing entryId (via body or params),
// verify the entry is NOT already posted. This prevents re-posting of immutable entries
// through write routes and enforces that posted entries are modify-only via reversal.
// Paths that are POST/PATCH but not financial writes — exempt from governance chain.
// - OCR/AI endpoints: read-only analysis, no journal entries created
// - /settings (exact): accounting configuration — not tied to a fiscal period
// - /accounts and /accounts/:id: chart-of-accounts master data — not a journal
//   entry and therefore not tied to a fiscal period
//   Use exact match to prevent unintended exemption of other routes that happen
//   to end with "/settings".
const GOVERNANCE_EXEMPT_SUFFIXES = ["/ocr-extract", "/ocr-preview"];
const GOVERNANCE_EXEMPT_EXACT   = ["/settings", "/accounts"];
const GOVERNANCE_EXEMPT_PREFIXES = ["/accounts/"];

export function writeMethodGovernanceGuard(req: Request, res: Response, next: NextFunction): void {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    next();
    return;
  }

  // Exempt OCR/AI endpoints (suffix match) and exact-path entries (e.g. /settings)
  if (
    GOVERNANCE_EXEMPT_SUFFIXES.some((s) => req.path.endsWith(s)) ||
    GOVERNANCE_EXEMPT_EXACT.some((s) => req.path === s) ||
    GOVERNANCE_EXEMPT_PREFIXES.some((s) => req.path.startsWith(s))
  ) {
    next();
    return;
  }

  const entryIdRaw = req.body?.entryId ?? req.body?.entry_id ?? req.params["entryId"] ?? req.params["id"];
  const entryId = entryIdRaw ? Number(entryIdRaw) : null;
  const companyId = resolveCompanyId(req);

  const checkApprovalState = (cb: () => void): void => {
    if (!entryId || !companyId || isNaN(entryId)) {
      cb();
      return;
    }
    db.execute(sql.raw(`
      SELECT ae.status,
             jaw.status AS workflow_status
      FROM accounting_entries ae
      LEFT JOIN journal_approval_workflow jaw
        ON jaw.entry_id = ae.id AND jaw.company_id = ae.company_id
        AND jaw.id = (
          SELECT id FROM journal_approval_workflow
          WHERE entry_id = ae.id AND company_id = ae.company_id
          ORDER BY created_at DESC LIMIT 1
        )
      WHERE ae.id = ${entryId} AND ae.company_id = ${companyId}
      LIMIT 1
    `)).then(({ rows }) => {
      const entry = rows[0] as any;

      // Block modifications to already-posted (immutable) entries
      if (entry?.status === "posted") {
        res.status(422).json({
          code: "ENTRY_ALREADY_POSTED",
          message: `Entri jurnal ${entryId} sudah diposting dan tidak dapat dimodifikasi. Gunakan reversal entry untuk koreksi.`,
        });
        return;
      }

      // Block actions on pending-approval entries that have no approved workflow:
      // Entry is submitted but approver has not approved yet — prevent premature actions.
      if (entry?.status === "pending_approval" && entry?.workflow_status !== "approved") {
        res.status(422).json({
          code: "APPROVAL_WORKFLOW_REQUIRED",
          message: `Entri jurnal ${entryId} menunggu approval. Workflow belum disetujui — status: ${entry.workflow_status ?? "tidak ada"}.`,
        });
        return;
      }

      cb();
    }).catch((err) => {
      // FAIL-CLOSED: governance approval-state check must never fail-open
      logger.error({ err, entryId }, "[governance] approval-state check DB error — blocking (fail-closed)");
      res.status(503).json({
        code: "GOVERNANCE_UNAVAILABLE",
        message: "Governance approval-state check tidak tersedia. Coba lagi atau hubungi administrator.",
      });
    });
  };

  requireOpenPeriod(req, res, () =>
    requireFinanceWriteRole(req, res, () =>
      checkApprovalState(() =>
        requireAuditContext(req, res, next))));
}

// Log attempted bypass to integrity_audit_queue
export async function logGovernanceBypass(opts: {
  companyId: number;
  entryId?: number;
  actor: string;
  action: string;
  reason: string;
}): Promise<void> {
  await queueIntegrityError({
    companyId: opts.companyId,
    classification: "HIGH",
    module: "finance_governance",
    errorCode: "GOVERNANCE_BYPASS_ATTEMPT",
    message: `[${opts.action}] ${opts.reason} — actor: ${opts.actor}`,
    context: { entryId: opts.entryId, action: opts.action },
    entityType: "accounting_entry",
    entityId: opts.entryId ? String(opts.entryId) : null,
  });
}

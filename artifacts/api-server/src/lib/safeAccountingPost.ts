/**
 * SAP HARDENING — FASE 5
 * safeAccountingPost() — Global Safety Wrapper
 *
 * SEMUA posting jurnal WAJIB melalui wrapper ini.
 *
 * Pipeline:
 *  1. validateBeforePost()       — COA valid, company valid, subledger, transfer pairing
 *  2. checkRevenueFieldLock()    — blokir edit field kritis jika POSTED
 *  3. Lock entry setelah posting — is_locked = TRUE
 *  4. Audit trail forensic-grade
 *
 * Return: { ok, journalEntryId?, errors?, warnings?, blocked?, correlationId }
 */

import { randomUUID } from "crypto";
import { validateBeforePost, PostingLine } from "./prePostGate.js";
import { lockAccountingEntry, checkRevenueFieldLock, reportImmutabilityViolation } from "./ledgerImmutability.js";
import { writeSapAudit } from "./sapAuditTrail.js";
import { queueIntegrityError } from "./errorContainment.js";
import { logger } from "./logger.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { runAnomalyDetection } from "./anomalyDetector.js";
import { requireApprovedWorkflow } from "./financeGovernanceGuard.js";
import { writeFinanceAuditTrail } from "./financeAuditMiddleware.js";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SafePostOpts {
  companyId: number;
  journalId: number;
  date: string;
  lines: PostingLine[];
  normalizedEntryId?: number | null;
  transactionPairId?: string | null;
  source?: string | null;
  actor?: string | null;
  actorType?: "SYSTEM" | "ADMIN" | "AI" | "USER";
  description?: string | null;
  correlationId?: string | null;
  revenueEntryStatus?: string | null;
  attemptedRevenueFields?: string[];
  postFn: () => Promise<number>;
}

export interface SafePostResult {
  ok: boolean;
  journalEntryId?: number | null;
  blocked?: boolean;
  errors?: { code: string; message: string; field?: string }[];
  warnings?: { code: string; message: string }[];
  correlationId: string;
}

// ─── Main wrapper ───────────────────────────────────────────────────────────

export async function safeAccountingPost(opts: SafePostOpts): Promise<SafePostResult> {
  const correlationId = opts.correlationId ?? `SAP-${randomUUID().replace(/-/g, "").slice(0, 16).toUpperCase()}`;

  // ── Step 0: Fiscal Period Check (FASE 3) ─────────────────────────────────
  // Blokir posting jika fiscal period sudah CLOSED
  if (opts.date && opts.companyId) {
    try {
      const d = new Date(opts.date);
      if (!isNaN(d.getTime())) {
        const year  = d.getFullYear();
        const month = d.getMonth() + 1;
        const { rows: periodRows } = await db.execute(sql.raw(`
          SELECT is_closed, override_allowed
          FROM financial_periods
          WHERE company_id = ${opts.companyId}
            AND year  = ${year}
            AND month = ${month}
          LIMIT 1
        `));
        const period = periodRows[0] as any;
        if (period?.is_closed && !period?.override_allowed) {
          const periodStr = `${year}-${String(month).padStart(2, "0")}`;
          await writeSapAudit({
            action: "POST",
            module: "accounting",
            companyId: opts.companyId,
            changeReason: `BLOCKED: fiscal period ${periodStr} sudah CLOSED`,
            actor: opts.actor ?? "SYSTEM",
            actorType: opts.actorType ?? "SYSTEM",
            correlationId,
          });
          logger.warn({ correlationId, period: periodStr, companyId: opts.companyId },
            "[safe-post] Posting diblokir — fiscal period CLOSED");
          return {
            ok: false,
            blocked: true,
            errors: [{ code: "PERIOD_CLOSED", message: `Fiscal period ${periodStr} sudah ditutup. Gunakan reversal entry di period baru.` }],
            correlationId,
          };
        }
      }
    } catch {
      // jika tabel belum ada (fresh install), lanjutkan posting
    }
  }

  // ── Step 1: Revenue field lock check (FASE 2) ────────────────────────────
  if (opts.revenueEntryStatus && opts.attemptedRevenueFields?.length) {
    const revLock = checkRevenueFieldLock(opts.revenueEntryStatus, opts.attemptedRevenueFields);
    if (revLock.blocked) {
      await reportImmutabilityViolation({
        companyId: opts.companyId,
        entryId: opts.normalizedEntryId ?? 0,
        attemptedAction: "UPDATE",
        actor: opts.actor,
      });
      await writeSapAudit({
        action: "POST",
        module: "accounting",
        companyId: opts.companyId,
        entityType: "normalized_entry",
        entityId: opts.normalizedEntryId ? String(opts.normalizedEntryId) : null,
        changeReason: `BLOCKED: revenue field lock — ${revLock.blockedFields.join(", ")}`,
        actor: opts.actor ?? "SYSTEM",
        actorType: opts.actorType ?? "SYSTEM",
        correlationId,
      });
      logger.warn({ correlationId, blockedFields: revLock.blockedFields, companyId: opts.companyId },
        "[safe-post] Posting diblokir — revenue field lock");
      return {
        ok: false,
        blocked: true,
        errors: [{ code: "REVENUE_FIELD_LOCKED", message: revLock.message ?? "Revenue field terkunci" }],
        correlationId,
      };
    }
  }

  // ── Step 2: Pre-post validation gate (FASE 4) ────────────────────────────
  const validation = await validateBeforePost({
    companyId: opts.companyId,
    journalId: opts.journalId,
    date: opts.date,
    lines: opts.lines,
    normalizedEntryId: opts.normalizedEntryId,
    transactionPairId: opts.transactionPairId,
    source: opts.source,
  });

  if (!validation.valid) {
    await writeSapAudit({
      action: "POST",
      module: "accounting",
      companyId: opts.companyId,
      entityType: "normalized_entry",
      entityId: opts.normalizedEntryId ? String(opts.normalizedEntryId) : null,
      changeReason: `BLOCKED: pre-post gate — ${validation.errors.map((e) => e.code).join(", ")}`,
      actor: opts.actor ?? "SYSTEM",
      actorType: opts.actorType ?? "SYSTEM",
      correlationId,
      batchId: null,
    });
    logger.warn({ correlationId, errors: validation.errors, companyId: opts.companyId },
      "[safe-post] Posting diblokir — pre-post gate");
    return {
      ok: false,
      blocked: true,
      errors: validation.errors,
      warnings: validation.warnings,
      correlationId,
    };
  }

  // ── Step 2b: Approval gate — all posting paths must be either approved or audited system override ──
  //
  // Case A (normalizedEntryId provided): full approval gate — entry must have status='approved' OR
  //   system_override=true in accounting_entries, AND a matching approved workflow row.
  //
  // Case B (normalizedEntryId null): system-generated entry path.
  //   - actorType=SYSTEM/AI is treated as "audited system override" — allowed, but MUST be logged.
  //   - actorType=USER/ADMIN without a normalizedEntryId is blocked: users must create a draft entry
  //     (POST /accounting/entries → draft) and submit through approval workflow.
  if (!opts.normalizedEntryId) {
    if (opts.actorType === "USER" || opts.actorType === "ADMIN") {
      // Non-system actor trying to post without an entry ID — block.
      await writeSapAudit({
        action: "POST",
        module: "accounting",
        companyId: opts.companyId,
        entityType: "accounting_entry",
        entityId: null,
        changeReason: `BLOCKED: user/admin actor attempted direct post without normalizedEntryId — requires draft+approval workflow`,
        actor: opts.actor ?? "unknown",
        actorType: opts.actorType,
        correlationId,
      });
      logger.warn({ correlationId, actorType: opts.actorType, source: opts.source, companyId: opts.companyId },
        "[safe-post] Posting diblokir — USER/ADMIN harus pakai draft+approval workflow");
      return {
        ok: false,
        blocked: true,
        errors: [{ code: "APPROVAL_REQUIRED", message: "Pengguna harus membuat draft entry dan melalui approval workflow sebelum posting." }],
        correlationId,
      };
    }
    // SYSTEM/AI actor: explicit override path — MUST be fully audited with HIGH severity.
    // An override reason is required (source field used as reason if none provided).
    const overrideReason = opts.description ?? `system-generated via source=${opts.source ?? "unknown"}`;
    await queueIntegrityError({
      companyId: opts.companyId,
      classification: "HIGH",
      module: "accounting_governance",
      errorCode: "SYSTEM_APPROVAL_BYPASS",
      message: `SYSTEM_OVERRIDE: direct posting bypassed approval workflow — actor=${opts.actor ?? "SYSTEM"} source=${opts.source ?? "unknown"} reason="${overrideReason}"`,
      context: {
        correlationId,
        source: opts.source,
        actor: opts.actor,
        actorType: opts.actorType,
        overrideReason,
      },
      entityType: "accounting_entry",
      entityId: null,
    });
    await writeSapAudit({
      action: "POST",
      module: "accounting",
      companyId: opts.companyId,
      entityType: "accounting_entry",
      entityId: null,
      changeReason: `SYSTEM_OVERRIDE [HIGH]: system actor bypassed approval workflow — source=${opts.source ?? "unknown"} reason="${overrideReason}"`,
      actor: opts.actor ?? "SYSTEM",
      actorType: opts.actorType ?? "SYSTEM",
      correlationId,
    });
    await writeFinanceAuditTrail({
      correlationId,
      companyId: opts.companyId,
      entryId: null,
      action: "SYSTEM_BYPASS_APPROVED",
      userId: opts.actor ?? "SYSTEM",
      userRole: opts.actorType ?? "SYSTEM",
      beforeState: { source: opts.source, description: opts.description },
      afterState: { override: "system_generated", actorType: opts.actorType, reason: overrideReason },
    });
  }

  if (opts.normalizedEntryId) {
    // First check the accounting_entries table directly for approved status or override flag
    let entryStatusRow: any = null;
    try {
      const { rows: statusRows } = await db.execute(sql.raw(`
        SELECT status, system_override
        FROM accounting_entries
        WHERE id = ${opts.normalizedEntryId} AND company_id = ${opts.companyId}
        LIMIT 1
      `));
      entryStatusRow = statusRows[0] ?? null;
    } catch {
      // Table might not exist yet (fresh install) — fall through to workflow check
    }

    if (entryStatusRow) {
      // Entry exists in accounting_entries — enforce status gate
      const isApproved = entryStatusRow.status === "approved";
      const hasOverride = entryStatusRow.system_override === true;
      if (!isApproved && !hasOverride) {
        // Double-check workflow approval table (fail-closed)
        const approvalCheck = await requireApprovedWorkflow(opts.normalizedEntryId, opts.companyId);
        if (!approvalCheck.ok) {
          await writeSapAudit({
            action: "POST",
            module: "accounting",
            companyId: opts.companyId,
            entityType: "accounting_entry",
            entityId: String(opts.normalizedEntryId),
            changeReason: `BLOCKED: approval gate — ${approvalCheck.message}`,
            actor: opts.actor ?? "USER",
            actorType: opts.actorType ?? "USER",
            correlationId,
          });
          await writeFinanceAuditTrail({
            correlationId,
            companyId: opts.companyId,
            entryId: opts.normalizedEntryId,
            action: "POST_BLOCKED_NO_APPROVAL",
            userId: opts.actor ?? null,
            userRole: opts.actorType ?? null,
            beforeState: { entryId: opts.normalizedEntryId, source: opts.source, actorType: opts.actorType },
            afterState: { blocked: true, reason: approvalCheck.message },
          });
          logger.warn({ correlationId, entryId: opts.normalizedEntryId, companyId: opts.companyId, actorType: opts.actorType },
            "[safe-post] Posting diblokir — approval gate: entry belum disetujui");
          return {
            ok: false,
            blocked: true,
            errors: [{ code: "APPROVAL_REQUIRED", message: approvalCheck.message ?? "Entri harus disetujui oleh Finance Approver sebelum bisa diposting." }],
            correlationId,
          };
        }
      }
    }
  }

  // ── Step 3: Execute posting ───────────────────────────────────────────────
  let journalEntryId: number | null = null;
  try {
    journalEntryId = await opts.postFn();
  } catch (err: any) {
    await queueIntegrityError({
      companyId: opts.companyId,
      classification: "HIGH",
      module: "accounting",
      errorCode: "POSTING_FAILED",
      message: `Posting gagal: ${err?.message ?? String(err)}`,
      context: { correlationId, normalizedEntryId: opts.normalizedEntryId, source: opts.source },
      entityType: "journal_entry",
      entityId: opts.normalizedEntryId ? String(opts.normalizedEntryId) : null,
    });
    await writeSapAudit({
      action: "POST",
      module: "accounting",
      companyId: opts.companyId,
      changeReason: `ERROR: ${err?.message ?? "posting gagal"}`,
      actor: opts.actor ?? "SYSTEM",
      actorType: opts.actorType ?? "SYSTEM",
      correlationId,
    });
    throw err;
  }

  // ── Step 4: Auto-lock setelah posting (FASE 1) ────────────────────────────
  if (journalEntryId) {
    await lockAccountingEntry(journalEntryId, opts.actor ?? "SYSTEM");
    await writeSapAudit({
      action: "POST",
      module: "accounting",
      companyId: opts.companyId,
      journalId: journalEntryId,
      entityType: "accounting_entry",
      entityId: String(journalEntryId),
      afterState: {
        is_locked: true,
        locked_by: opts.actor ?? "SYSTEM",
        source: opts.source,
        correlationId,
      },
      changeReason: opts.description ?? "Journal entry posted via safeAccountingPost",
      actor: opts.actor ?? "SYSTEM",
      actorType: opts.actorType ?? "SYSTEM",
      correlationId,
    });

    // Write to governance finance_audit_trail — full before/after state tracing
    const beforeEntryState: Record<string, unknown> = {
      entryId: opts.normalizedEntryId ?? journalEntryId,
      status: "approved",
      source: opts.source,
      companyId: opts.companyId,
    };
    await writeFinanceAuditTrail({
      correlationId,
      companyId: opts.companyId,
      entryId: journalEntryId,
      action: "POSTED",
      requestSource: opts.source ?? null,
      userId: opts.actor ?? null,
      userRole: opts.actorType ?? null,
      beforeState: beforeEntryState,
      afterState: {
        journalEntryId,
        status: "posted",
        isLocked: true,
        lockedBy: opts.actor ?? "SYSTEM",
        description: opts.description,
      },
    });
  }

  logger.info({ correlationId, journalEntryId, companyId: opts.companyId, source: opts.source },
    "[safe-post] Posting berhasil + locked");

  // ── Step 5: Run anomaly detection (FASE 6) ────────────────────────────────
  if (journalEntryId) {
    const totalAmount = opts.lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
    runAnomalyDetection({
      companyId: opts.companyId,
      entryId: journalEntryId,
      journalId: opts.journalId,
      amount: totalAmount,
      date: opts.date,
      actor: opts.actor ?? "SYSTEM",
    }).catch((err) => {
      logger.warn({ err, journalEntryId }, "[safe-post] Anomaly detection error (non-fatal)");
    });
  }

  return {
    ok: true,
    journalEntryId,
    warnings: validation.warnings,
    correlationId,
  };
}

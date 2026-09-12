/**
 * SAP HARDENING — FASE 6
 * Enterprise-Grade Audit Trail
 *
 * Setiap perubahan data akuntansi WAJIB tercatat dengan:
 *  - before_state (JSON)
 *  - after_state (JSON)
 *  - change_reason
 *  - actor_type (SYSTEM / ADMIN / AI)
 *  - correlation_id
 *
 * Tidak ada exception — semua perubahan tercatat.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { randomUUID } from "crypto";

export type ActorType = "SYSTEM" | "ADMIN" | "AI" | "USER";
export type AuditAction = "CREATE" | "POST" | "VOID" | "REPOST" | "LOCK" | "REVERSE" | "UPDATE" | "DELETE" | "AUTO_REPAIR" | "BULK_LOCK" | "PERIOD_CLOSE" | "CONSOLIDATE";

export interface SapAuditEntry {
  action: AuditAction;
  module: string;
  companyId?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  beforeState?: Record<string, unknown> | null;
  afterState?: Record<string, unknown> | null;
  changeReason?: string | null;
  actor?: string | null;
  actorType?: ActorType;
  correlationId?: string | null;
  batchId?: number | null;
  importRowId?: number | null;
  erpCategory?: string | null;
  amount?: number | null;
  journalId?: number | null;
}

// ─── Write a forensic-grade audit record ─────────────────────────────────

export async function writeSapAudit(entry: SapAuditEntry): Promise<void> {
  const correlationId = entry.correlationId ?? generateCorrelationId(entry);
  const actorType = entry.actorType ?? inferActorType(entry.actor);

  try {
    const before = entry.beforeState
      ? `'${JSON.stringify(entry.beforeState).replace(/'/g, "''")}'::jsonb`
      : "NULL";
    const after = entry.afterState
      ? `'${JSON.stringify(entry.afterState).replace(/'/g, "''")}'::jsonb`
      : "NULL";

    await db.execute(sql.raw(`
      INSERT INTO audit_accounting_events
        (journal_id, action, company_id, erp_category, amount,
         before_state, after_state, user_id, batch_id, import_row_id,
         change_reason, actor_type, correlation_id)
      VALUES (
        ${entry.journalId ?? "NULL"},
        '${entry.action}',
        ${entry.companyId ?? "NULL"},
        ${entry.erpCategory ? `'${entry.erpCategory.replace(/'/g, "''")}'` : "NULL"},
        ${entry.amount ?? "NULL"},
        ${before},
        ${after},
        '${(entry.actor || "system").replace(/'/g, "''")}',
        ${entry.batchId ?? "NULL"},
        ${entry.importRowId ?? "NULL"},
        ${entry.changeReason ? `'${entry.changeReason.replace(/'/g, "''")}'` : "NULL"},
        '${actorType}',
        '${correlationId.replace(/'/g, "''")}'
      )
    `));
  } catch (err) {
    // Never throw — audit trail must not crash the system
    logger.warn({ err, entry }, "[sap-audit] writeSapAudit gagal (non-fatal)");
  }
}

// ─── Record immutable lock event ─────────────────────────────────────────

export async function auditLockEntry(opts: {
  entryId: number;
  entryNumber?: string | null;
  companyId?: number | null;
  actor?: string | null;
  reason?: string | null;
}): Promise<void> {
  await writeSapAudit({
    action: "LOCK",
    module: "accounting",
    companyId: opts.companyId,
    entityType: "accounting_entry",
    entityId: String(opts.entryId),
    beforeState: { is_locked: false },
    afterState: { is_locked: true, locked_by: opts.actor ?? "SYSTEM", locked_at: new Date().toISOString() },
    changeReason: opts.reason ?? "Entry di-POST, otomatis dikunci (SAP immutability)",
    actor: opts.actor ?? "SYSTEM",
    actorType: "SYSTEM",
  });
}

// ─── Record reversal event ────────────────────────────────────────────────

export async function auditReversal(opts: {
  originalEntryId: number;
  reversalEntryId: number;
  reversalEntryNumber?: string | null;
  companyId?: number | null;
  actor?: string | null;
  reason?: string | null;
}): Promise<void> {
  const correlationId = `REV-${opts.originalEntryId}-${opts.reversalEntryId}`;
  await writeSapAudit({
    action: "REVERSE",
    module: "accounting",
    companyId: opts.companyId,
    entityType: "accounting_entry",
    entityId: String(opts.reversalEntryId),
    beforeState: { originalEntryId: opts.originalEntryId },
    afterState: {
      reversalEntryId: opts.reversalEntryId,
      reversalEntryNumber: opts.reversalEntryNumber,
    },
    changeReason: opts.reason ?? "Reversal journal entry",
    actor: opts.actor ?? "SYSTEM",
    actorType: "ADMIN",
    correlationId,
  });
}

// ─── Record auto-repair action ────────────────────────────────────────────

export async function auditAutoRepair(opts: {
  normalizedEntryId: number;
  repairType: "COA_AUTO_ASSIGNED" | "SUBLEDGER_AUTO_LINKED" | "TRANSFER_PAIRED";
  companyId?: number | null;
  details?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
}): Promise<void> {
  await writeSapAudit({
    action: "AUTO_REPAIR",
    module: "bank_mutation",
    companyId: opts.companyId,
    entityType: "normalized_entry",
    entityId: String(opts.normalizedEntryId),
    beforeState: opts.before,
    afterState: opts.after,
    changeReason: opts.details ?? opts.repairType,
    actor: "AUTO_REPAIR_ENGINE",
    actorType: "SYSTEM",
  });
}

// ─── Record bulk lock event ───────────────────────────────────────────────

export async function auditBulkLock(opts: {
  companyId: number;
  count: number;
  period?: string | null;
  actor?: string | null;
}): Promise<void> {
  await writeSapAudit({
    action: "BULK_LOCK",
    module: "accounting",
    companyId: opts.companyId,
    entityType: "accounting_entries_bulk",
    changeReason: opts.period ? `Bulk lock periode ${opts.period}` : "Bulk lock semua posted entries",
    beforeState: null,
    afterState: { lockedCount: opts.count, period: opts.period, lockedBy: opts.actor ?? "SYSTEM" },
    actor: opts.actor ?? "SYSTEM",
    actorType: "ADMIN",
  });
}

// ─── Query audit trail for an entity ─────────────────────────────────────

export async function getEntityAuditTrail(opts: {
  companyId?: number | null;
  entityType?: string | null;
  entityId?: string | null;
  correlationId?: string | null;
  limit?: number;
}): Promise<any[]> {
  try {
    const conditions: string[] = [];
    if (opts.companyId)    conditions.push(`company_id = ${opts.companyId}`);
    if (opts.correlationId) conditions.push(`correlation_id = '${opts.correlationId.replace(/'/g, "''")}'`);
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 50;
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM audit_accounting_events
      ${where}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `));
    return rows;
  } catch (err) {
    logger.warn({ err }, "[sap-audit] getEntityAuditTrail gagal");
    return [];
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function generateCorrelationId(entry: SapAuditEntry): string {
  const ts = Date.now();
  const hash = `${entry.action}-${entry.module}-${entry.companyId ?? 0}-${ts}`;
  return `CORP-${hash.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 32)}`;
}

function inferActorType(actor?: string | null): ActorType {
  if (!actor || actor === "SYSTEM" || actor === "system") return "SYSTEM";
  if (actor.toLowerCase().includes("ai") || actor.toLowerCase().includes("bot")) return "AI";
  return "ADMIN";
}

/**
 * SAP HARDENING — FASE 1 + FASE 2
 * Immutable Ledger Layer & Revenue Engine Lock
 *
 * Rules:
 *  - Accounting entries yang sudah di-POST → is_locked = TRUE (auto-lock)
 *  - Entry yang is_locked = TRUE TIDAK BISA diedit/dihapus
 *  - Perubahan hanya boleh via REVERSE JOURNAL ENTRY
 *  - Revenue engine (normalized entries POSTED) → lock revenue fields
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { queueIntegrityError } from "./errorContainment.js";

// ─── Lock an accounting entry after posting ────────────────────────────────

export async function lockAccountingEntry(
  entryId: number,
  lockedBy: string = "SYSTEM",
  client: typeof db = db,
): Promise<void> {
  try {
    await client.execute(sql.raw(`
      UPDATE accounting_entries
      SET is_locked = TRUE, locked_at = NOW(), locked_by = '${lockedBy.replace(/'/g, "''")}'
      WHERE id = ${entryId} AND is_locked = FALSE
    `));
  } catch (err) {
    logger.warn({ err, entryId }, "[ledger-immutability] lockAccountingEntry failed (non-fatal)");
  }
}

// ─── Guard: check if entry is locked before update/delete ─────────────────

export interface LockCheckResult {
  locked: boolean;
  lockedAt?: string | null;
  lockedBy?: string | null;
  message?: string;
}

export async function checkEntryLocked(entryId: number): Promise<LockCheckResult> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT is_locked, locked_at, locked_by, status, source, entry_number
      FROM accounting_entries
      WHERE id = ${entryId}
      LIMIT 1
    `));
    if (!rows.length) {
      return { locked: false };
    }
    const row = rows[0] as any;
    if (row.is_locked) {
      return {
        locked: true,
        lockedAt: row.locked_at,
        lockedBy: row.locked_by,
        message: `Jurnal ${row.entry_number ?? entryId} sudah LOCKED (dikunci pada ${row.locked_at ?? "??"} oleh ${row.locked_by ?? "SYSTEM"}). Gunakan /entries/:id/reverse untuk koreksi.`,
      };
    }
    return { locked: false };
  } catch (err) {
    // FIX: fail-CLOSED — jika DB error, anggap entry terkunci agar tidak ada
    // window di mana attacker bisa trigger DB error untuk bypass lock check.
    logger.error({ err, entryId }, "[ledger-immutability] checkEntryLocked DB error — defaulting to LOCKED (fail-closed)");
    return {
      locked: true,
      message: `Tidak dapat memverifikasi status lock untuk entri #${entryId}. Akses ditolak sebagai tindakan pencegahan (fail-closed). Coba lagi atau hubungi administrator.`,
    };
  }
}

// ─── Lock all posted entries in bulk (e.g. after period close) ─────────────

export async function lockAllPostedEntries(
  companyId: number,
  periodBefore?: string,
): Promise<number> {
  try {
    const periodClause = periodBefore
      ? `AND date < '${periodBefore}'`
      : "";
    const { rowCount } = await db.execute(sql.raw(`
      UPDATE accounting_entries
      SET is_locked = TRUE, locked_at = NOW(), locked_by = 'PERIOD_CLOSE'
      WHERE company_id = ${companyId}
        AND status = 'posted'
        AND is_locked = FALSE
        ${periodClause}
    `)) as any;
    const count = rowCount ?? 0;
    logger.info({ companyId, periodBefore, count }, "[ledger-immutability] bulk lock selesai");
    return count;
  } catch (err) {
    logger.warn({ err, companyId }, "[ledger-immutability] lockAllPostedEntries error");
    return 0;
  }
}

// ─── FASE 2: Revenue Engine Lock ──────────────────────────────────────────
// Blocks editing revenue-critical fields on POSTED normalized entries.
// Fields: revenue_company_id, collecting_company_id, coa_debit, coa_credit, amount

export interface RevenueFieldLockResult {
  blocked: boolean;
  blockedFields: string[];
  message?: string;
}

export const REVENUE_IMMUTABLE_FIELDS = [
  "revenue_company_id",
  "collecting_company_id",
  "coa_debit",
  "coa_credit",
  "amount",
  "erp_category",
] as const;

export function checkRevenueFieldLock(
  entryStatus: string,
  attemptedFields: string[],
): RevenueFieldLockResult {
  if (entryStatus !== "POSTED") {
    return { blocked: false, blockedFields: [] };
  }
  const blocked = attemptedFields.filter((f) =>
    REVENUE_IMMUTABLE_FIELDS.includes(f as any),
  );
  if (blocked.length === 0) {
    return { blocked: false, blockedFields: [] };
  }
  return {
    blocked: true,
    blockedFields: blocked,
    message: `Revenue entry sudah POSTED — field [${blocked.join(", ")}] tidak bisa diedit. Buat reversal entry untuk koreksi.`,
  };
}

// ─── Helper: queue violation to integrity audit ───────────────────────────

export async function reportImmutabilityViolation(opts: {
  companyId?: number | null;
  entryId: number;
  attemptedAction: "UPDATE" | "DELETE";
  actor?: string | null;
}): Promise<void> {
  await queueIntegrityError({
    companyId: opts.companyId ?? null,
    classification: "HIGH",
    module: "accounting",
    errorCode: "IMMUTABILITY_VIOLATION",
    message: `Percobaan ${opts.attemptedAction} pada entry ID ${opts.entryId} yang sudah LOCKED`,
    context: { entryId: opts.entryId, attemptedAction: opts.attemptedAction, actor: opts.actor },
    entityType: "accounting_entry",
    entityId: String(opts.entryId),
  });
}

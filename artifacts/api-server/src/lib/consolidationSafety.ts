/**
 * SAP HARDENING — FASE 7
 * Consolidation Safety Layer
 *
 * Rules:
 *  1. Consolidated report HANYA dari: locked entries + posted journal entries
 *  2. TIDAK boleh ada draft/pending data masuk report
 *  3. Intercompany elimination HANYA di reporting layer — ledger asli tidak berubah
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Guard: apply consolidation safety filter to a query ─────────────────

export interface ConsolidatedEntryFilter {
  companyIds: number[];
  fromDate?: string | null;
  toDate?: string | null;
  requireLocked?: boolean;
}

/**
 * Returns WHERE clause fragments that enforce consolidation safety.
 * Only locked + posted entries are eligible.
 */
export function buildConsolidationFilter(opts: ConsolidatedEntryFilter): string {
  const companySql = `company_id IN (${opts.companyIds.join(",")})`;
  const statusSql  = `status = 'posted'`;
  const lockSql    = opts.requireLocked !== false ? `is_locked = TRUE` : `(is_locked = TRUE OR is_locked = FALSE)`;
  const fromSql    = opts.fromDate ? `date >= '${opts.fromDate}'` : "TRUE";
  const toSql      = opts.toDate   ? `date <= '${opts.toDate}'`   : "TRUE";

  return `${companySql} AND ${statusSql} AND ${lockSql} AND ${fromSql} AND ${toSql}`;
}

// ─── Get locked, posted journal entries for consolidation ─────────────────

export async function getConsolidatedEntries(opts: ConsolidatedEntryFilter): Promise<{
  entries: any[];
  excludedDraftCount: number;
  excludedUnlockedCount: number;
}> {
  const filter = buildConsolidationFilter(opts);
  const companySql = `company_id IN (${opts.companyIds.join(",")})`;
  const fromSql = opts.fromDate ? `AND date >= '${opts.fromDate}'` : "";
  const toSql   = opts.toDate   ? `AND date <= '${opts.toDate}'`   : "";

  try {
    const [entriesResult, draftCountResult, unlockedCountResult] = await Promise.all([
      db.execute(sql.raw(`
        SELECT ae.*, ael.account_id, ael.debit, ael.credit, ael.description AS line_desc,
               coa.code AS account_code, coa.name AS account_name, coa.type AS account_type
        FROM accounting_entries ae
        JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
        JOIN chart_of_accounts coa ON coa.id = ael.account_id
        WHERE ${filter}
        ORDER BY ae.date ASC, ae.id ASC
      `)),
      // Count excluded drafts (for transparency)
      db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt
        FROM accounting_entries
        WHERE ${companySql}
          AND status IN ('draft','cancelled')
          ${fromSql} ${toSql}
      `)),
      // Count excluded unlocked (for transparency)
      db.execute(sql.raw(`
        SELECT COUNT(*) AS cnt
        FROM accounting_entries
        WHERE ${companySql}
          AND status = 'posted'
          AND is_locked = FALSE
          ${fromSql} ${toSql}
      `)),
    ]);

    return {
      entries: entriesResult.rows,
      excludedDraftCount: Number((draftCountResult.rows[0] as any)?.cnt ?? 0),
      excludedUnlockedCount: Number((unlockedCountResult.rows[0] as any)?.cnt ?? 0),
    };
  } catch (err) {
    logger.warn({ err, opts }, "[consolidation-safety] getConsolidatedEntries error");
    return { entries: [], excludedDraftCount: 0, excludedUnlockedCount: 0 };
  }
}

// ─── Intercompany elimination (reporting layer only) ──────────────────────

export interface EliminationEntry {
  companyId: number;
  counterpartCompanyId: number;
  amount: number;
  accountCode: string;
  date: string;
  entryNumber: string;
}

/**
 * Computes intercompany eliminations IN MEMORY only.
 * Does NOT write anything to the ledger.
 * Returns virtual elimination entries for report output.
 */
export async function computeIntercompanyEliminations(opts: {
  holdingCompanyId: number;
  subsidiaryIds: number[];
  fromDate: string;
  toDate: string;
}): Promise<{
  eliminations: EliminationEntry[];
  totalEliminatedDebit: number;
  totalEliminatedCredit: number;
  note: string;
}> {
  const allCompanyIds = [opts.holdingCompanyId, ...opts.subsidiaryIds];

  try {
    // Find intercompany entries (entries with same ref between companies)
    const { rows } = await db.execute(sql.raw(`
      SELECT ae.company_id, ae.ref, ae.date, ae.entry_number,
             SUM(ael.debit) AS total_debit, SUM(ael.credit) AS total_credit,
             coa.code AS account_code
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ae.company_id IN (${allCompanyIds.join(",")})
        AND ae.status = 'posted'
        AND ae.is_locked = TRUE
        AND ae.date BETWEEN '${opts.fromDate}' AND '${opts.toDate}'
        AND ae.ref LIKE 'IC-%'
      GROUP BY ae.company_id, ae.ref, ae.date, ae.entry_number, coa.code
      ORDER BY ae.date ASC
    `));

    const eliminations: EliminationEntry[] = [];
    let totalEliminatedDebit = 0;
    let totalEliminatedCredit = 0;

    // Match pairs by ref
    const byRef = new Map<string, any[]>();
    for (const row of rows as any[]) {
      const key = row.ref;
      if (!byRef.has(key)) byRef.set(key, []);
      byRef.get(key)!.push(row);
    }

    for (const [, entries] of byRef) {
      if (entries.length >= 2) {
        for (const entry of entries) {
          const e = entry as any;
          eliminations.push({
            companyId: e.company_id,
            counterpartCompanyId: entries.find((x: any) => x.company_id !== e.company_id)?.company_id ?? 0,
            amount: Number(e.total_debit || e.total_credit),
            accountCode: e.account_code,
            date: e.date,
            entryNumber: e.entry_number,
          });
          totalEliminatedDebit  += Number(e.total_debit ?? 0);
          totalEliminatedCredit += Number(e.total_credit ?? 0);
        }
      }
    }

    return {
      eliminations,
      totalEliminatedDebit,
      totalEliminatedCredit,
      note: "Eliminasi intercompany HANYA di reporting layer — ledger asli tidak dimodifikasi (SAP FASE 7)",
    };
  } catch (err) {
    logger.warn({ err, opts }, "[consolidation-safety] computeIntercompanyEliminations error");
    return {
      eliminations: [],
      totalEliminatedDebit: 0,
      totalEliminatedCredit: 0,
      note: "Eliminations computation error — ledger tetap aman",
    };
  }
}

// ─── Validate a report request ────────────────────────────────────────────

export interface ConsolidationReportValidation {
  valid: boolean;
  issues: string[];
  warnings: string[];
}

export async function validateConsolidationReport(opts: ConsolidatedEntryFilter): Promise<ConsolidationReportValidation> {
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!opts.companyIds.length) {
    issues.push("Tidak ada company yang dipilih untuk konsolidasi");
    return { valid: false, issues, warnings };
  }

  try {
    // Check for unlocked posted entries in period
    const filter = buildConsolidationFilter({ ...opts, requireLocked: false });
    const { rows } = await db.execute(sql.raw(`
      SELECT
        SUM(CASE WHEN status = 'posted' AND is_locked = FALSE THEN 1 ELSE 0 END) AS unlocked_posted,
        SUM(CASE WHEN status IN ('draft') THEN 1 ELSE 0 END) AS draft_count
      FROM accounting_entries
      WHERE company_id IN (${opts.companyIds.join(",")})
        ${opts.fromDate ? `AND date >= '${opts.fromDate}'` : ""}
        ${opts.toDate   ? `AND date <= '${opts.toDate}'`   : ""}
    `));

    const r = rows[0] as any;
    if (Number(r?.unlocked_posted ?? 0) > 0) {
      warnings.push(`${r.unlocked_posted} entry sudah POSTED tapi belum LOCKED — tidak akan masuk laporan konsolidasi`);
    }
    if (Number(r?.draft_count ?? 0) > 0) {
      warnings.push(`${r.draft_count} entry masih DRAFT — dikecualikan dari laporan`);
    }
  } catch (err) {
    logger.warn({ err }, "[consolidation-safety] validateConsolidationReport error (non-fatal)");
  }

  return { valid: issues.length === 0, issues, warnings };
}

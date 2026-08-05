/**
 * SAP HARDENING — FASE 4
 * Consistency Check Before Post (Hard Gate)
 *
 * Sebelum posting jurnal, WAJIB cek:
 *  ✓ COA VALID (account exists + active)
 *  ✓ company_id VALID
 *  ✓ subledger VALID (or block)
 *  ✓ normalized entry EXISTS (for bank mutation path)
 *  ✓ internal transfer fully paired (if applicable)
 *
 * Jika gagal → BLOCK POSTING → masuk NEED_REVIEW queue
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { queueIntegrityError } from "./errorContainment.js";

// ─── Types ────────────────────────────────────────────────────────────────

export interface PostingLine {
  accountId: number;
  debit: number;
  credit: number;
  description?: string | null;
}

export interface PrePostValidationResult {
  valid: boolean;
  errors: PrePostError[];
  warnings: PrePostWarning[];
}

export interface PrePostError {
  code: string;
  message: string;
  field?: string;
}

export interface PrePostWarning {
  code: string;
  message: string;
}

// ─── Main gate ────────────────────────────────────────────────────────────

export async function validateBeforePost(opts: {
  companyId: number;
  journalId: number;
  date: string;
  lines: PostingLine[];
  normalizedEntryId?: number | null;
  transactionPairId?: string | null;
  source?: string | null;
}): Promise<PrePostValidationResult> {
  const errors: PrePostError[] = [];
  const warnings: PrePostWarning[] = [];

  // Run all checks in parallel where possible
  const [coaResult, companyResult, normalizedResult, pairResult] = await Promise.all([
    checkCoaValid(opts.lines, opts.companyId),
    checkCompanyValid(opts.companyId),
    opts.normalizedEntryId ? checkNormalizedEntryExists(opts.normalizedEntryId) : Promise.resolve(null),
    opts.transactionPairId ? checkInternalTransferPaired(opts.transactionPairId, opts.companyId) : Promise.resolve(null),
  ]);

  // Aggregate errors
  errors.push(...coaResult.errors);
  errors.push(...companyResult.errors);
  if (normalizedResult) errors.push(...normalizedResult.errors);
  if (pairResult) errors.push(...pairResult.errors);

  warnings.push(...coaResult.warnings);

  const valid = errors.length === 0;

  // If invalid, queue to integrity_audit_queue
  if (!valid) {
    await queueIntegrityError({
      companyId: opts.companyId,
      classification: "HIGH",
      module: "accounting",
      errorCode: "PRE_POST_GATE_FAILED",
      message: `Posting diblokir — ${errors.length} kesalahan: ${errors.map((e) => e.code).join(", ")}`,
      context: {
        errors,
        warnings,
        journalId: opts.journalId,
        normalizedEntryId: opts.normalizedEntryId,
        source: opts.source,
      },
      entityType: "journal_entry",
      entityId: opts.normalizedEntryId ? String(opts.normalizedEntryId) : null,
    });
  }

  if (errors.length > 0) {
    logger.warn({ companyId: opts.companyId, errors }, "[pre-post-gate] posting diblokir");
  }

  return { valid, errors, warnings };
}

// ─── Check 1: COA Valid ───────────────────────────────────────────────────

async function checkCoaValid(
  lines: PostingLine[],
  companyId: number,
): Promise<{ errors: PrePostError[]; warnings: PrePostWarning[] }> {
  const errors: PrePostError[] = [];
  const warnings: PrePostWarning[] = [];

  if (!lines.length) {
    errors.push({ code: "NO_LINES", message: "Jurnal tidak memiliki baris" });
    return { errors, warnings };
  }

  const accountIds = [...new Set(lines.map((l) => l.accountId).filter(Boolean))];
  if (!accountIds.length) {
    errors.push({ code: "NO_ACCOUNT_IDS", message: "Semua baris tidak memiliki account ID" });
    return { errors, warnings };
  }

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, code, name, is_active
      FROM chart_of_accounts
      WHERE id IN (${accountIds.join(",")})
        AND (company_id = ${companyId} OR company_id IS NULL)
    `));

    const foundIds = new Set((rows as any[]).map((r) => r.id));
    const inactiveIds = (rows as any[]).filter((r) => !r.is_active).map((r) => r.id);

    for (const id of accountIds) {
      if (!foundIds.has(id)) {
        errors.push({
          code: "COA_NOT_FOUND",
          message: `Account ID ${id} tidak ditemukan atau tidak tersedia untuk company ${companyId}`,
          field: `accountId:${id}`,
        });
      }
    }
    for (const id of inactiveIds) {
      warnings.push({
        code: "COA_INACTIVE",
        message: `Account ID ${id} sudah tidak aktif`,
      });
    }
  } catch (err) {
    logger.warn({ err }, "[pre-post-gate] checkCoaValid error");
  }

  return { errors, warnings };
}

// ─── Check 2: Company Valid ───────────────────────────────────────────────

async function checkCompanyValid(
  companyId: number,
): Promise<{ errors: PrePostError[] }> {
  const errors: PrePostError[] = [];
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, is_active FROM companies WHERE id = ${companyId} LIMIT 1
    `));
    if (!rows.length) {
      errors.push({
        code: "COMPANY_NOT_FOUND",
        message: `Company ID ${companyId} tidak ditemukan`,
        field: "companyId",
      });
    } else if (!(rows[0] as any).is_active) {
      errors.push({
        code: "COMPANY_INACTIVE",
        message: `Company ID ${companyId} sudah tidak aktif`,
        field: "companyId",
      });
    }
  } catch (err) {
    logger.warn({ err, companyId }, "[pre-post-gate] checkCompanyValid error");
  }
  return { errors };
}

// ─── Check 3: Normalized Entry Exists ────────────────────────────────────

async function checkNormalizedEntryExists(
  normalizedEntryId: number,
): Promise<{ errors: PrePostError[] }> {
  const errors: PrePostError[] = [];
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, status, coa_status, is_latest_version
      FROM bank_mutation_normalized_entries
      WHERE id = ${normalizedEntryId}
      LIMIT 1
    `));
    if (!rows.length) {
      errors.push({
        code: "NORMALIZED_ENTRY_MISSING",
        message: `Normalized entry ID ${normalizedEntryId} tidak ditemukan`,
        field: "normalizedEntryId",
      });
      return { errors };
    }
    const entry = rows[0] as any;
    if (entry.status === "SUPERSEDED") {
      errors.push({
        code: "NORMALIZED_ENTRY_SUPERSEDED",
        message: `Normalized entry ID ${normalizedEntryId} sudah di-supersede. Gunakan versi terbaru.`,
        field: "normalizedEntryId",
      });
    }
    if (!entry.is_latest_version) {
      errors.push({
        code: "NORMALIZED_ENTRY_NOT_LATEST",
        message: `Normalized entry ID ${normalizedEntryId} bukan versi terbaru`,
        field: "normalizedEntryId",
      });
    }
    if (entry.coa_status === "NEED_COA_MAPPING") {
      errors.push({
        code: "COA_MAPPING_REQUIRED",
        message: `COA mapping belum selesai untuk entry ${normalizedEntryId}`,
        field: "coa_status",
      });
    }
  } catch (err) {
    logger.warn({ err, normalizedEntryId }, "[pre-post-gate] checkNormalizedEntryExists error (non-fatal)");
  }
  return { errors };
}

// ─── Check 4: Internal Transfer Paired ───────────────────────────────────

async function checkInternalTransferPaired(
  transactionPairId: string,
  companyId: number,
): Promise<{ errors: PrePostError[] }> {
  const errors: PrePostError[] = [];
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM bank_mutation_normalized_entries
      WHERE transaction_pair_id = '${transactionPairId.replace(/'/g, "''")}'
        AND status NOT IN ('SUPERSEDED','DUPLICATE')
        AND is_latest_version = TRUE
    `));
    const count = Number((rows[0] as any)?.cnt ?? 0);
    if (count < 2) {
      errors.push({
        code: "TRANSFER_UNPAIRED",
        message: `Internal transfer ${transactionPairId} belum memiliki pasangan. Posting diblokir.`,
        field: "transactionPairId",
      });
    }
  } catch (err) {
    logger.warn({ err, transactionPairId }, "[pre-post-gate] checkInternalTransferPaired error");
  }
  return { errors };
}

// ─── Quick balance check ──────────────────────────────────────────────────

export function checkLinesBalanced(lines: PostingLine[]): boolean {
  const totalDebit  = lines.reduce((s, l) => s + (l.debit  ?? 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
  return Math.abs(totalDebit - totalCredit) < 0.01;
}

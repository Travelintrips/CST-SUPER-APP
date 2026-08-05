/**
 * BD Source Guard — P0 enforcement for Bank Disbursement source linkage.
 *
 * Bank Disbursement adalah financial posting, bukan source of truth transaksi bisnis.
 * Business object adalah source of truth.
 *
 * Rules (P0):
 * - Jenis transaksi RESTRICTED harus punya source_module + source_id yang valid.
 * - Source object harus dalam status yang mengizinkan pembayaran.
 * - Tidak boleh double-posting untuk source yang sama.
 * - Setelah disbursement dibuat, source object harus diupdate secara sinkron.
 *
 * Restricted types (hard block):
 *   employee_advance  → source_module = 'cash_advances'
 *   expense           → source_module = 'expenses'
 *   loan_payment      → source_module = 'bank_loans'
 *
 * Soft block (warn only — tax module belum sepenuhnya terintegrasi):
 *   tax_payment       → source_module = 'tax_periods' / 'tax_payables'
 *
 * Pure bank types (no source required):
 *   fund_transfer, equity_withdrawal, supplier_payment, other
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Transaction types that MUST have source_module + source_id */
export const HARD_BLOCKED_TYPES = new Set([
  "employee_advance",
  "expense",
  "loan_payment",
]);

/** Transaction types that SHOULD have source_module + source_id (soft warning) */
export const SOFT_BLOCKED_TYPES = new Set(["tax_payment"]);

/** All restricted types (hard + soft) */
export const ALL_RESTRICTED_TYPES = new Set([
  ...HARD_BLOCKED_TYPES,
  ...SOFT_BLOCKED_TYPES,
]);

/**
 * Canonical source_module value for each restricted transaction type.
 * Used to validate that the caller passes a consistent source_module.
 */
export const CANONICAL_SOURCE_MODULE: Record<string, string[]> = {
  employee_advance: ["cash_advances"],
  expense:          ["expenses"],
  loan_payment:     ["bank_loans"],
  tax_payment:      ["tax_periods", "tax_payables", "tax_reports", "tax_spt_drafts"],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BdSourceValidationInput {
  transactionTypes: string[];   // all item transactionType values in the BD
  sourceModule: string | null;
  sourceId: number | null;
  amount: number;               // total amount being disbursed (all items)
  /**
   * Per-type amounts — used to correctly validate loan overpayment.
   * Key = transactionType, Value = sum of amounts for that type.
   * If omitted, falls back to `amount` for all checks.
   */
  amountByType?: Record<string, number>;
  companyId: number;
}

export interface BdSourceValidationResult {
  ok: boolean;
  error?: string;
  statusCode?: number;
  /** true when the block is hard (must stop); false = soft warning only */
  hard?: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function execRows<T>(result: unknown): T[] {
  if (result && typeof result === "object" && "rows" in result) {
    return (result as { rows: T[] }).rows;
  }
  if (Array.isArray(result)) return result as T[];
  return [];
}

// ── Validate ──────────────────────────────────────────────────────────────────

/**
 * validateBdSource
 *
 * Call BEFORE creating the disbursement. Performs:
 * 1. Checks whether source_id is required for the given transaction types.
 * 2. Validates the source record exists + belongs to company + is in a payable state.
 * 3. Checks for double-posting (existing non-void BD with same source).
 */
export async function validateBdSource(
  input: BdSourceValidationInput,
): Promise<BdSourceValidationResult> {
  const { transactionTypes, sourceModule, sourceId, amount, companyId } = input;

  // Determine the most-restricted transaction type in the list
  const hardRestrictedItems = transactionTypes.filter((t) => HARD_BLOCKED_TYPES.has(t));
  const softRestrictedItems = transactionTypes.filter((t) => SOFT_BLOCKED_TYPES.has(t));
  const hasRestricted = hardRestrictedItems.length > 0 || softRestrictedItems.length > 0;

  if (!hasRestricted) {
    // Pure bank transactions — no source required
    return { ok: true };
  }

  // ── Source ID required for hard-blocked types ────────────────────────────
  if (hardRestrictedItems.length > 0 && (!sourceId || !sourceModule)) {
    const typeLabel: Record<string, string> = {
      employee_advance: "Kasbon Karyawan",
      expense:          "Expense / Biaya",
      loan_payment:     "Cicilan Pinjaman",
    };
    const names = [...new Set(hardRestrictedItems)].map((t) => typeLabel[t] ?? t).join(", ");
    return {
      ok: false,
      hard: true,
      statusCode: 422,
      error: `Transaksi jenis ${names} harus dibuat dari modul sumber terkait, bukan langsung dari Bank Disbursement. ` +
             `Gunakan modul Kasbon, Expense, atau Pinjaman untuk mencairkan/membayar transaksi ini.`,
    };
  }

  // ── If source_id provided, validate it ──────────────────────────────────
  if (sourceId && sourceModule) {
    // Validate canonical source_module matches transaction type
    const firstRestricted = hardRestrictedItems[0] ?? softRestrictedItems[0];
    if (firstRestricted) {
      const allowed = CANONICAL_SOURCE_MODULE[firstRestricted] ?? [];
      if (allowed.length > 0 && !allowed.includes(sourceModule)) {
        return {
          ok: false,
          hard: true,
          statusCode: 422,
          error: `source_module "${sourceModule}" tidak sesuai untuk jenis transaksi "${firstRestricted}". ` +
                 `Harusnya: ${allowed.join(" atau ")}.`,
        };
      }
    }

    // ── Validate source record by module ──────────────────────────────────

    if (sourceModule === "cash_advances") {
      const rows = execRows<{ id: number; status: string; company_id: number; amount: string; paid_amount: string; disbursed_at: string | null }>(
        await db.execute(sql`
          SELECT id, status, company_id, amount, paid_amount, disbursed_at
          FROM cash_advances
          WHERE id = ${sourceId} AND company_id = ${companyId}
          LIMIT 1
        `)
      );
      if (!rows[0]) {
        return { ok: false, hard: true, statusCode: 404, error: `Kasbon #${sourceId} tidak ditemukan atau bukan milik perusahaan ini.` };
      }
      const ca = rows[0];
      if (ca.status === "repaid" || ca.status === "voided") {
        return { ok: false, hard: true, statusCode: 409, error: `Kasbon #${sourceId} sudah lunas atau dibatalkan (status: ${ca.status}).` };
      }
      // Double-posting check
      const dupRows = execRows<{ cnt: number }>(
        await db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM bank_disbursements
          WHERE source_module = 'cash_advances'
            AND source_id = ${sourceId}
            AND company_id = ${companyId}
            AND status NOT IN ('voided', 'cancelled')
        `)
      );
      if ((dupRows[0]?.cnt ?? 0) > 0) {
        return { ok: false, hard: true, statusCode: 409, error: `Kasbon #${sourceId} sudah memiliki pencairan bank. Void disbursement yang lama terlebih dahulu jika perlu dibuat ulang.` };
      }
    }

    else if (sourceModule === "expenses") {
      const rows = execRows<{ id: number; status: string; company_id: number; disbursement_id: number | null }>(
        await db.execute(sql`
          SELECT id, status, company_id, disbursement_id
          FROM expenses
          WHERE id = ${sourceId} AND company_id = ${companyId}
          LIMIT 1
        `)
      );
      if (!rows[0]) {
        return { ok: false, hard: true, statusCode: 404, error: `Expense #${sourceId} tidak ditemukan atau bukan milik perusahaan ini.` };
      }
      const exp = rows[0];
      if (exp.status === "void" || exp.status === "cancelled") {
        return { ok: false, hard: true, statusCode: 409, error: `Expense #${sourceId} sudah dibatalkan (status: ${exp.status}).` };
      }
      // Double-posting check via disbursement_id column
      if (exp.disbursement_id) {
        // Check if that disbursement is non-void
        const existingRows = execRows<{ status: string; disbursement_number: string }>(
          await db.execute(sql`
            SELECT status, disbursement_number FROM bank_disbursements
            WHERE id = ${exp.disbursement_id} AND status NOT IN ('voided', 'cancelled')
            LIMIT 1
          `)
        );
        if (existingRows[0]) {
          return {
            ok: false, hard: true, statusCode: 409,
            error: `Expense #${sourceId} sudah dibayar melalui ${existingRows[0].disbursement_number}. Void disbursement yang lama terlebih dahulu jika perlu dibuat ulang.`,
          };
        }
      }
      // Also check via source_module/source_id
      const dupRows = execRows<{ cnt: number }>(
        await db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM bank_disbursements
          WHERE source_module = 'expenses'
            AND source_id = ${sourceId}
            AND company_id = ${companyId}
            AND status NOT IN ('voided', 'cancelled')
        `)
      );
      if ((dupRows[0]?.cnt ?? 0) > 0) {
        return { ok: false, hard: true, statusCode: 409, error: `Expense #${sourceId} sudah memiliki pembayaran bank. Void disbursement yang lama terlebih dahulu.` };
      }
    }

    else if (sourceModule === "bank_loans") {
      const rows = execRows<{ id: number; status: string; company_id: number; outstanding_amount: string; loan_number: string }>(
        await db.execute(sql`
          SELECT id, status, company_id, outstanding_amount, loan_number
          FROM bank_loans
          WHERE id = ${sourceId} AND company_id = ${companyId}
          LIMIT 1
        `)
      );
      if (!rows[0]) {
        return { ok: false, hard: true, statusCode: 404, error: `Pinjaman #${sourceId} tidak ditemukan atau bukan milik perusahaan ini.` };
      }
      const loan = rows[0];
      if (loan.status === "paid") {
        return { ok: false, hard: true, statusCode: 409, error: `Pinjaman ${loan.loan_number} sudah lunas (outstanding: 0).` };
      }
      const outstanding = Number(loan.outstanding_amount);
      if (outstanding <= 0) {
        return { ok: false, hard: true, statusCode: 409, error: `Pinjaman ${loan.loan_number} tidak memiliki sisa tagihan (outstanding: ${outstanding}).` };
      }

      // Use only loan_payment-type amount for overpayment check, not total (which includes interest/expense lines)
      const loanPrincipalAmt = input.amountByType?.["loan_payment"] ?? amount;
      if (loanPrincipalAmt > outstanding + 0.01) {
        return {
          ok: false, hard: true, statusCode: 400,
          error: `Jumlah cicilan pokok (${loanPrincipalAmt}) melebihi sisa pinjaman (${outstanding}).`,
        };
      }

      // Double-posting check for loans (outstanding check at validation time is insufficient for concurrent requests)
      const dupRows = execRows<{ cnt: number }>(
        await db.execute(sql`
          SELECT COUNT(*)::int AS cnt
          FROM bank_disbursements
          WHERE source_module = 'bank_loans'
            AND source_id = ${sourceId}
            AND company_id = ${companyId}
            AND status NOT IN ('voided', 'cancelled')
        `)
      );
      if ((dupRows[0]?.cnt ?? 0) > 0) {
        return {
          ok: false, hard: true, statusCode: 409,
          error: `Pinjaman ${loan.loan_number} sudah memiliki pembayaran bank yang aktif. Jika ingin mencicil lagi, void pembayaran sebelumnya terlebih dahulu, atau hubungi admin untuk partial payment.`,
        };
      }
    }

    else if (CANONICAL_SOURCE_MODULE["tax_payment"]?.includes(sourceModule)) {
      // Soft validation for tax module — just check source exists
      // Tax module structure is complex; skip deep validation in P0
      logger.info({ sourceModule, sourceId, companyId }, "[bdSourceGuard] tax_payment source validation (soft/P0)");
    }
  }

  // ── Soft block for tax_payment without source_id ──────────────────────
  if (softRestrictedItems.length > 0 && hardRestrictedItems.length === 0 && (!sourceId || !sourceModule)) {
    // Log as warning but don't block — P0 soft enforcement
    logger.warn({ companyId, transactionTypes }, "[bdSourceGuard] tax_payment without source_id — soft warning P0");
    // Return ok but with a warning signal (caller may log or tag)
    return { ok: true };
  }

  return { ok: true };
}

// ── Update Source After Disbursement ─────────────────────────────────────────

export interface BdSourceUpdateInput {
  transactionTypes: string[];
  sourceModule: string;
  sourceId: number;
  disbId: number;
  disbNumber: string;
  amount: number;
  date: Date;
  companyId: number;
}

/**
 * updateSourceAfterDisbursement
 *
 * Call AFTER the disbursement + journal entry have been inserted.
 * Updates the source business object to reflect payment.
 *
 * This is best-effort: if the update fails, log the error but do NOT throw —
 * the disbursement is already created. P1 will wrap this in a full transaction.
 */
export async function updateSourceAfterDisbursement(
  input: BdSourceUpdateInput,
): Promise<void> {
  const { transactionTypes, sourceModule, sourceId, disbId, disbNumber, amount, date, companyId } = input;

  try {
    if (sourceModule === "cash_advances") {
      // Update kasbon: mark disbursed_at, increment paid_amount
      await db.execute(sql`
        UPDATE cash_advances
        SET
          disbursed_at  = COALESCE(disbursed_at, ${date}),
          paid_amount   = COALESCE(paid_amount, 0) + ${String(amount)},
          updated_at    = NOW()
        WHERE id = ${sourceId} AND company_id = ${companyId}
      `);
      logger.info({ sourceId, disbId, amount }, "[bdSourceGuard] cash_advance updated after disbursement");
    }

    else if (sourceModule === "expenses") {
      // Update expense: link disbursement_id
      await db.execute(sql`
        UPDATE expenses
        SET
          disbursement_id = ${disbId},
          updated_at      = NOW()
        WHERE id = ${sourceId} AND company_id = ${companyId}
          AND (disbursement_id IS NULL OR disbursement_id = ${disbId})
      `);
      logger.info({ sourceId, disbId }, "[bdSourceGuard] expense disbursement_id updated");
    }

    else if (sourceModule === "bank_loans") {
      // Update loan outstanding + paid amount + status
      const rows = execRows<{ outstanding_amount: string; paid_amount: string; principal_amount: string }>(
        await db.execute(sql`
          SELECT outstanding_amount, paid_amount, principal_amount
          FROM bank_loans WHERE id = ${sourceId} AND company_id = ${companyId}
          LIMIT 1
        `)
      );
      if (rows[0]) {
        const newOutstanding = Math.max(0, Number(rows[0].outstanding_amount) - amount);
        const newPaid = Number(rows[0].paid_amount ?? 0) + amount;
        const newStatus = newOutstanding <= 0.01 ? "paid" : "partial";

        await db.execute(sql`
          UPDATE bank_loans
          SET
            outstanding_amount = ${String(newOutstanding)},
            paid_amount        = ${String(newPaid)},
            status             = ${newStatus}
          WHERE id = ${sourceId} AND company_id = ${companyId}
        `);

        // Insert payment record
        await db.execute(sql`
          INSERT INTO bank_loan_payments
            (loan_id, payment_date, principal_amount, interest_amount, total_amount, payment_method, reference, notes)
          VALUES
            (${sourceId}, ${date.toISOString().substring(0, 10)},
             ${String(amount)}, '0', ${String(amount)},
             'bank', ${disbNumber}, ${'Auto-recorded via Bank Disbursement ' + disbNumber})
        `);
        logger.info({ sourceId, disbId, newOutstanding, newStatus }, "[bdSourceGuard] bank_loan updated after disbursement");
      }
    }

    else {
      logger.info({ sourceModule, sourceId, disbId }, "[bdSourceGuard] source module update — no handler (non-fatal)");
    }
  } catch (err) {
    // Non-fatal: disbursement already created; log for manual reconciliation
    logger.error({ err, sourceModule, sourceId, disbId }, "[bdSourceGuard] source update failed after disbursement — manual reconciliation may be needed");
  }
}

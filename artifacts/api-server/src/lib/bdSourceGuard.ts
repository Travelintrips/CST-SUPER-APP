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
 * Tax payments use transaction_taxes as their source of truth:
 *   tax_payment       → source_module = 'transaction_taxes'
 *
 * Pure bank types (no source required):
 *   fund_transfer, equity_withdrawal, other
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import type { DbClient } from "./accounting.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Normalize business names accepted by older callers to the canonical item type. */
export const TRANSACTION_TYPE_ALIASES: Record<string, string> = {
  vendor_payment: "supplier_payment",
  reimbursement: "expense",
  employee_fund: "employee_advance",
  dana_talangan: "employee_advance",
};

export function normalizeBdTransactionType(transactionType: string): string {
  return TRANSACTION_TYPE_ALIASES[transactionType] ?? transactionType;
}

/** Transaction types that MUST have a business source reference. */
export const HARD_BLOCKED_TYPES = new Set([
  "employee_advance",
  "expense",
  "loan_payment",
  "tax_payment",
]);

/** Kept as a separate set for compatibility; business types are hard-blocked. */
export const SOFT_BLOCKED_TYPES = new Set<string>();

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
  tax_payment:      ["transaction_taxes"],
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
  const {
    transactionTypes: rawTransactionTypes,
    sourceModule,
    sourceId,
    amount,
    companyId,
  } = input;
  const transactionTypes = rawTransactionTypes.map(normalizeBdTransactionType);

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
      tax_payment:      "Pembayaran Pajak",
    };
    const names = [...new Set(hardRestrictedItems)].map((t) => typeLabel[t] ?? t).join(", ");
    return {
      ok: false,
      hard: true,
      statusCode: 422,
      error: `Transaksi jenis ${names} harus dibuat dari modul sumber terkait, bukan langsung dari Bank Disbursement. ` +
             `Gunakan modul sumber terkait untuk mencairkan/membayar transaksi ini.`,
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
      const advanceStatus = (ca as { lifecycle_status?: string | null }).lifecycle_status ?? ca.status;
      if (advanceStatus !== "approved") {
        return { ok: false, hard: true, statusCode: 409, error: `Kasbon #${sourceId} harus berstatus approved sebelum dicairkan. Status saat ini: ${advanceStatus}.` };
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
      if (exp.status !== "active") {
        return { ok: false, hard: true, statusCode: 409, error: `Expense #${sourceId} harus berstatus active/approved sebelum dibayar. Status saat ini: ${exp.status}.` };
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

    else if (sourceModule === "transaction_taxes") {
      const rows = execRows<{ id: number; status: string; company_id: number; paid_at: string | null }>(
        await db.execute(sql`
          SELECT id, status, company_id, paid_at
          FROM transaction_taxes
          WHERE id = ${sourceId} AND company_id = ${companyId}
          LIMIT 1
        `)
      );
      if (!rows[0]) {
        return { ok: false, hard: true, statusCode: 404, error: `Transaksi pajak #${sourceId} tidak ditemukan atau bukan milik perusahaan ini.` };
      }
      if (rows[0].status === "paid" || rows[0].status === "reported" || rows[0].paid_at) {
        return { ok: false, hard: true, statusCode: 409, error: `Transaksi pajak #${sourceId} sudah dibayar atau dilaporkan.` };
      }
    }
  }

  return { ok: true };
}

// ── Update Source After Disbursement ─────────────────────────────────────────

export interface BdSourceUpdateInput {
  client?: DbClient;
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
 * Call inside the same transaction as the journal and disbursement inserts.
 * Any error propagates so the complete posting rolls back.
 */
export async function updateSourceAfterDisbursement(
  input: BdSourceUpdateInput,
): Promise<void> {
  const {
    client = db,
    transactionTypes,
    sourceModule,
    sourceId,
    disbId,
    disbNumber,
    amount,
    date,
    companyId,
  } = input;

    if (sourceModule === "cash_advances") {
      const result = await client.execute(sql`
        UPDATE cash_advances
        SET
          lifecycle_status = 'disbursed',
          status         = 'active',
          disbursed_at  = COALESCE(disbursed_at, ${date}),
          updated_at    = NOW()
        WHERE id = ${sourceId} AND company_id = ${companyId}
          AND COALESCE(lifecycle_status, status) = 'approved'
        RETURNING id
      `);
      if (execRows(result).length !== 1) {
        throw new Error(`Kasbon #${sourceId} berubah status sebelum pencairan.`);
      }
      logger.info({ sourceId, disbId, amount }, "[bdSourceGuard] cash_advance updated after disbursement");
    }

    else if (sourceModule === "expenses") {
      const result = await client.execute(sql`
        UPDATE expenses
        SET
          disbursement_id = ${disbId},
          status         = 'paid',
          updated_at      = NOW()
        WHERE id = ${sourceId} AND company_id = ${companyId}
          AND status = 'active'
          AND (disbursement_id IS NULL OR disbursement_id = ${disbId})
        RETURNING id
      `);
      if (execRows(result).length !== 1) {
        throw new Error(`Expense #${sourceId} berubah status atau sudah dibayar.`);
      }
      logger.info({ sourceId, disbId }, "[bdSourceGuard] expense disbursement_id updated");
    }

    else if (sourceModule === "bank_loans") {
      // `amount` is the principal amount for loan-only postings. The route
      // supplies loan-only amount for mixed principal+interest postings.
      if (!transactionTypes.includes("loan_payment") || amount <= 0) {
        throw new Error(`Pinjaman #${sourceId} tidak memiliki nominal pokok.`);
      }
      const result = await client.execute(sql`
        UPDATE bank_loans
        SET
          outstanding_amount = outstanding_amount - ${String(amount)},
          paid_amount        = COALESCE(paid_amount, 0) + ${String(amount)},
          status = CASE
            WHEN outstanding_amount - ${String(amount)} <= 0.01 THEN 'paid'
            ELSE 'partial'
          END
        WHERE id = ${sourceId}
          AND company_id = ${companyId}
          AND status <> 'paid'
          AND outstanding_amount >= ${String(amount)}
        RETURNING id
      `);
      if (execRows(result).length !== 1) {
        throw new Error(`Pinjaman #${sourceId} berubah status atau saldo outstanding tidak mencukupi.`);
      }

      await client.execute(sql`
          INSERT INTO bank_loan_payments
            (loan_id, payment_date, principal_amount, interest_amount, total_amount, payment_method, reference, notes)
          VALUES
            (${sourceId}, ${date.toISOString().substring(0, 10)},
             ${String(amount)}, '0', ${String(amount)},
             'bank', ${disbNumber}, ${'Auto-recorded via Bank Disbursement ' + disbNumber})
        `);
      logger.info({ sourceId, disbId, principalAmount: amount }, "[bdSourceGuard] bank_loan updated after disbursement");
    }

    else if (sourceModule === "transaction_taxes") {
      const result = await client.execute(sql`
        UPDATE transaction_taxes
        SET status = 'paid', paid_at = ${date}, updated_at = NOW()
        WHERE id = ${sourceId}
          AND company_id = ${companyId}
          AND status NOT IN ('paid', 'reported')
          AND paid_at IS NULL
        RETURNING id
      `);
      if (execRows(result).length !== 1) {
        throw new Error(`Transaksi pajak #${sourceId} berubah status atau sudah dibayar.`);
      }
      logger.info({ sourceId, disbId }, "[bdSourceGuard] transaction_tax updated after disbursement");
    }

    else {
      throw new Error(`source_module "${sourceModule}" belum memiliki handler update sumber.`);
    }
}

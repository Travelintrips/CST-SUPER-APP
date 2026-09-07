/**
 * PayrollJournalService — Single Source of Truth for payroll-related journal postings.
 *
 * RULE: routes/payroll.ts must NOT call postEntry() directly — always go through
 * this service, mirroring the convention used by AdvanceJournalService for kasbon.
 *
 *   postAccrualJournal()  DR Salary Expense + Allowance Expense
 *                         CR Salary Payable + Employee Receivable (kasbon) + Tax Payable + BPJS Payable
 *   postPaymentJournal()  DR Salary Payable / CR Cash-Bank
 */
import { db, accountingSettingsTable, accountingJournalsTable } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { postEntry, postEntryWithClient, type DbClient, type PostingInput } from "../accounting.js";
import { AccountingConfigError } from "../advance/AdvanceErrors.js";
import {
  assertSettlementAccounts,
  assertSettlementPeriodOpen,
  assertSettlementRows,
  repaymentIdempotencyKey,
  settlementReference,
  settlementSourceId,
  type KasbonRepaymentValidationRow,
} from "./payrollSettlementGuards.js";

export interface PayrollAccountMapping {
  salaryExpenseAccountId: number;
  allowanceExpenseAccountId: number;
  salaryPayableAccountId: number;
  taxPayableAccountId: number;
  bpjsPayableAccountId: number;
}

/** Returns null (not throw) when mapping is incomplete — caller decides the user-facing message. */
export async function resolvePayrollAccountMapping(companyId: number): Promise<PayrollAccountMapping | null> {
  const [row] = await db
    .select()
    .from(accountingSettingsTable)
    .where(eq(accountingSettingsTable.companyId, companyId))
    .limit(1);
  if (!row) return null;
  const {
    salaryExpenseAccountId, allowanceExpenseAccountId,
    salaryPayableAccountId, taxPayableAccountId, bpjsPayableAccountId,
  } = row;
  if (!salaryExpenseAccountId || !allowanceExpenseAccountId || !salaryPayableAccountId
    || !taxPayableAccountId || !bpjsPayableAccountId) {
    return null;
  }
  return { salaryExpenseAccountId, allowanceExpenseAccountId, salaryPayableAccountId, taxPayableAccountId, bpjsPayableAccountId };
}

async function requireJournal(companyId: number, type: "bank" | "cash" | "general") {
  const rows = await db.execute<{ id: number; code: string }>(sql`
    SELECT id, code FROM accounting_journals
    WHERE (company_id = ${companyId} OR company_id IS NULL) AND type = ${type}
    ORDER BY company_id DESC NULLS LAST LIMIT 1
  `).then((r) => r.rows);
  const j = rows[0] ?? await db.execute<{ id: number; code: string }>(sql`
    SELECT id, code FROM accounting_journals WHERE company_id = ${companyId} OR company_id IS NULL ORDER BY id LIMIT 1
  `).then((r) => r.rows[0]);
  if (!j) throw new AccountingConfigError(`Jurnal '${type}' tidak ditemukan. Konfigurasi jurnal akuntansi diperlukan.`);
  return j;
}

export interface AccrualJournalParams {
  companyId: number;
  payrollRunId: number;
  period: string; // e.g. "2026-07"
  date: Date | string;
  totalSalary: number;
  totalAllowance: number;
  totalTax: number;
  totalBpjs: number;
  /** kasbon deductions grouped by the receivable COA of the matched cash_advances rows */
  kasbonByAccount: Array<{ accountId: number; amount: number }>;
  totalSalaryPayable: number; // sum(netSalary) across items
}

export interface AccrualJournalResult {
  entryId: number;
}

export interface KasbonSettlementParams {
  companyId: number;
  payrollRunId: number;
  salaryPayableAccountId: number;
  employeeReceivableAccountId: number;
  amount: number;
  repaymentCount: number;
  date: Date | string;
  actor: string;
}

export interface KasbonSettlementResult {
  entryId: number;
  repaymentIds: number[];
  reused: boolean;
  reference: string;
}

type KasbonRepaymentRow = KasbonRepaymentValidationRow & {
  id: number;
  advance_id: number;
};

export const PayrollJournalService = {
  async postAccrualJournal(mapping: PayrollAccountMapping, p: AccrualJournalParams): Promise<AccrualJournalResult> {
    const j = await requireJournal(p.companyId, "general");
    const ref = `PAYROLL-${p.payrollRunId}`;

    const lines: PostingInput["lines"] = [];
    if (p.totalSalary > 0) {
      lines.push({ accountId: mapping.salaryExpenseAccountId, debit: p.totalSalary, credit: 0, description: "Beban Gaji" });
    }
    if (p.totalAllowance > 0) {
      lines.push({ accountId: mapping.allowanceExpenseAccountId, debit: p.totalAllowance, credit: 0, description: "Beban Tunjangan" });
    }
    if (p.totalSalaryPayable > 0) {
      lines.push({ accountId: mapping.salaryPayableAccountId, debit: 0, credit: p.totalSalaryPayable, description: "Utang Gaji" });
    }
    for (const k of p.kasbonByAccount) {
      if (k.amount > 0) {
        lines.push({ accountId: k.accountId, debit: 0, credit: k.amount, description: "Potongan Kasbon" });
      }
    }
    if (p.totalTax > 0) {
      lines.push({ accountId: mapping.taxPayableAccountId, debit: 0, credit: p.totalTax, description: "PPh 21" });
    }
    if (p.totalBpjs > 0) {
      lines.push({ accountId: mapping.bpjsPayableAccountId, debit: 0, credit: p.totalBpjs, description: "BPJS" });
    }

    const entry = await postEntry(
      {
        journalId: j.id,
        date: new Date(p.date),
        ref,
        description: `${ref} — Payroll Accrual ${p.period}`,
        source: "payroll",
        sourceModule: "hrd",
        sourceId: p.payrollRunId,
        companyId: p.companyId,
        lines,
      } as PostingInput,
      j.code,
    );
    return { entryId: entry.id };
  },

  async postPaymentJournal(p: {
    companyId: number;
    payrollRunId: number;
    period: string;
    date: Date | string;
    amount: number;
    salaryPayableAccountId: number;
    cashBankAccountId: number;
    paymentMethod?: "cash" | "bank";
  }): Promise<AccrualJournalResult> {
    const pm = p.paymentMethod ?? "bank";
    const j = await requireJournal(p.companyId, pm === "cash" ? "cash" : "bank");
    const ref = `PAYROLL-PAY-${p.payrollRunId}`;

    const entry = await postEntry(
      {
        journalId: j.id,
        date: new Date(p.date),
        ref,
        description: `${ref} — Pembayaran Gaji ${p.period}`,
        source: "hrd_salary_payment",
        sourceModule: "hrd",
        sourceId: p.payrollRunId,
        companyId: p.companyId,
        lines: [
          { accountId: p.salaryPayableAccountId, debit: p.amount, credit: 0, description: "Utang Gaji" },
          { accountId: p.cashBankAccountId, debit: 0, credit: p.amount, description: pm === "cash" ? "Kas" : "Bank" },
        ],
      } as PostingInput,
      j.code,
    );
    return { entryId: entry.id };
  },

  /**
   * Post the cash-advance deduction settlement for one payroll run.
   *
   * The accounting entry and all repayment links commit in one transaction.
   * This is intentionally separate from postPaymentJournal: the former clears
   * the salary payable against the employee receivable, while the latter
   * clears the remaining salary payable against cash/bank evidence.
   */
  async postKasbonSettlement(p: KasbonSettlementParams): Promise<KasbonSettlementResult> {
    if (!Number.isInteger(p.companyId) || p.companyId <= 0) {
      throw new Error("KASBON_SETTLEMENT_COMPANY_REQUIRED: companyId must be positive.");
    }
    if (!Number.isInteger(p.payrollRunId) || p.payrollRunId <= 0) {
      throw new Error("KASBON_SETTLEMENT_RUN_REQUIRED: payrollRunId must be positive.");
    }
    if (!Number.isInteger(p.repaymentCount) || p.repaymentCount <= 0 || p.amount <= 0) {
      throw new Error("KASBON_SETTLEMENT_INPUT_INVALID: amount and repaymentCount must be positive.");
    }

    return db.transaction(async (tx) => {
      const runRows = await tx.execute<{ month: number; year: number; status: string; company_id: number }>(sql`
        SELECT month, year, status, company_id
        FROM payroll_runs
        WHERE id = ${p.payrollRunId} AND company_id = ${p.companyId}
        FOR UPDATE
      `);
      const run = runRows.rows[0];
      if (!run) throw new Error("KASBON_SETTLEMENT_RUN_NOT_FOUND: payroll run is not in the requested company.");
      if (!["approved", "paid"].includes(run.status)) {
        throw new Error(`KASBON_SETTLEMENT_RUN_STATUS_INVALID: run status '${run.status}' is not approved/paid.`);
      }

      const period = `${run.year}-${String(run.month).padStart(2, "0")}`;
      const reference = settlementReference(p.payrollRunId, period);
      const sourceId = settlementSourceId(p.payrollRunId);
      const date = new Date(p.date);
      if (Number.isNaN(date.getTime())) throw new Error("KASBON_SETTLEMENT_DATE_INVALID: posting date is invalid.");

      const periodRows = await tx.execute<{ is_closed: boolean; override_allowed: boolean }>(sql`
        SELECT is_closed, override_allowed
        FROM financial_periods
        WHERE company_id = ${p.companyId}
          AND year = ${date.getUTCFullYear()}
          AND month = ${date.getUTCMonth() + 1}
        LIMIT 1
      `);
      const periodState = periodRows.rows[0];
      assertSettlementPeriodOpen(periodState, date.toISOString().slice(0, 7));

      const repaymentRows = await tx.execute<KasbonRepaymentRow>(sql`
        SELECT car.id, car.advance_id, car.amount, car.entry_id,
               car.posted_at, car.idempotency_key
        FROM cash_advance_repayments car
        JOIN cash_advances ca ON ca.id = car.advance_id
        WHERE ca.company_id = ${p.companyId}
          AND ca.type = 'kasbon'
          AND EXISTS (
            SELECT 1
            FROM payroll_items pi
            WHERE pi.run_id = ${p.payrollRunId}
              AND pi.cash_advance_id = ca.id
          )
        ORDER BY car.id
        FOR UPDATE OF car
      `);
      assertSettlementRows(repaymentRows.rows, p.repaymentCount, p.amount);

      const coaRows = await tx.execute<{
        id: number;
        company_id: number | null;
        is_active: boolean;
        is_postable: boolean;
        status: string;
      }>(sql`
        SELECT id, company_id, is_active, is_postable, status
        FROM chart_of_accounts
        WHERE id IN (${p.salaryPayableAccountId}, ${p.employeeReceivableAccountId})
        FOR UPDATE
      `);
      assertSettlementAccounts(coaRows.rows, p.companyId);

      const existingRows = await tx.execute<{
        id: number;
        status: string;
        total_debit: string;
        total_credit: string;
      }>(sql`
        SELECT id, status, total_debit, total_credit
        FROM accounting_entries
        WHERE company_id = ${p.companyId}
          AND (
            (source = 'kasbon' AND source_id = ${sourceId})
            OR ref = ${reference}
          )
        ORDER BY id
        FOR UPDATE
      `);

      const existing = existingRows.rows[0];
      if (existingRows.rows.length > 1) {
        throw new Error("KASBON_SETTLEMENT_DUPLICATE: more than one equivalent settlement journal exists.");
      }

      if (existing) {
        const lineRows = await tx.execute<{
          account_id: number;
          debit: string;
          credit: string;
        }>(sql`
          SELECT account_id, debit, credit
          FROM accounting_entry_lines
          WHERE entry_id = ${existing.id}
          ORDER BY id
        `);
        const hasExactLines =
          existing.status === "posted" &&
          Math.abs(Number(existing.total_debit) - p.amount) <= 0.01 &&
          Math.abs(Number(existing.total_credit) - p.amount) <= 0.01 &&
          lineRows.rows.length === 2 &&
          lineRows.rows.some((line) =>
            line.account_id === p.salaryPayableAccountId &&
            Math.abs(Number(line.debit) - p.amount) <= 0.01 &&
            Number(line.credit) === 0
          ) &&
          lineRows.rows.some((line) =>
            line.account_id === p.employeeReceivableAccountId &&
            Number(line.debit) === 0 &&
            Math.abs(Number(line.credit) - p.amount) <= 0.01
          );
        if (!hasExactLines) {
          throw new Error("KASBON_SETTLEMENT_EXISTING_MISMATCH: equivalent journal is not the required posted two-line settlement.");
        }
        if (repaymentRows.rows.some((row) => row.entry_id !== existing.id || row.posted_at == null)) {
          throw new Error("KASBON_SETTLEMENT_LINKAGE_MISMATCH: equivalent journal exists but repayment linkage is incomplete.");
        }
        for (const row of repaymentRows.rows) {
          const expectedKey = repaymentIdempotencyKey(p.payrollRunId, row.id);
          if (row.idempotency_key && row.idempotency_key !== expectedKey) {
            throw new Error("KASBON_SETTLEMENT_IDEMPOTENCY_MISMATCH: repayment key belongs to another settlement.");
          }
        }
        await tx.execute(sql`
          UPDATE cash_advance_repayments
          SET idempotency_key = CASE id
            ${sql.join(
              repaymentRows.rows.map((row) => sql`WHEN ${row.id} THEN ${repaymentIdempotencyKey(p.payrollRunId, row.id)}`),
              sql` `,
            )}
          END
          WHERE id IN (${sql.join(repaymentRows.rows.map((row) => sql`${row.id}`), sql`, `)})
        `);
        return {
          entryId: existing.id,
          repaymentIds: repaymentRows.rows.map((row) => row.id),
          reused: true,
          reference,
        };
      }

      if (repaymentRows.rows.some((row) => row.entry_id != null || row.posted_at != null)) {
        throw new Error("KASBON_SETTLEMENT_UNEXPECTED_LINK: repayment is linked before its settlement journal.");
      }

      const journal = await requireJournal(p.companyId, "general");
      const entry = await postEntryWithClient(
        tx as unknown as DbClient,
        {
          journalId: journal.id,
          date,
          ref: reference,
          description: `Payroll ${period} Run ${p.payrollRunId} — Settlement Kasbon`,
          source: "kasbon",
          sourceModule: "hrd",
          sourceId,
          companyId: p.companyId,
          createdById: p.actor,
          lines: [
            { accountId: p.salaryPayableAccountId, debit: p.amount, credit: 0, description: "Pelunasan Hutang Gaji dari Kasbon" },
            { accountId: p.employeeReceivableAccountId, debit: 0, credit: p.amount, description: "Pelunasan Piutang Karyawan (Kasbon)" },
          ],
        } as PostingInput,
        journal.code,
      );

      await tx.execute(sql`
        UPDATE cash_advance_repayments
        SET entry_id = ${entry.id},
            posted_at = NOW(),
            idempotency_key = CASE id
              ${sql.join(
                repaymentRows.rows.map((row) => sql`WHEN ${row.id} THEN ${repaymentIdempotencyKey(p.payrollRunId, row.id)}`),
                sql` `,
              )}
            END,
            created_by = ${p.actor}
        WHERE id IN (${sql.join(repaymentRows.rows.map((row) => sql`${row.id}`), sql`, `)})
      `);

      return {
        entryId: entry.id,
        repaymentIds: repaymentRows.rows.map((row) => row.id),
        reused: false,
        reference,
      };
    });
  },
};

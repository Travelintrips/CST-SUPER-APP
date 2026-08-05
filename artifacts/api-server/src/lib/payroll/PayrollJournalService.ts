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
import { postEntry, type PostingInput } from "../accounting.js";
import { AccountingConfigError } from "../advance/AdvanceErrors.js";

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
};

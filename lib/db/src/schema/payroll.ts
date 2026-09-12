/**
 * Payroll & Employee schema — Cash Advance & Payroll Accounting Automation.
 *
 * These tables (employees, payroll_runs, payroll_items) already existed in the
 * physical database before this Drizzle definition was added; this file is a
 * type-safe wrapper matching the real columns so the API server can query them
 * safely. Do not rename columns without a matching migration.
 */
import {
  pgTable, serial, text, integer, numeric, real, boolean, timestamp, date, index,
} from "drizzle-orm/pg-core";

export const employeesTable = pgTable("employees", {
  id: serial("id").primaryKey(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  position: text("position"),
  departmentId: integer("department_id"),
  status: text("status").notNull().default("active"),
  hireDate: date("hire_date").notNull(),
  salary: real("salary"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  maritalStatus: text("marital_status").default("TK/0"),
  deletedAt: timestamp("deleted_at"),
  companyId: integer("company_id"),
}, (t) => [
  index("employees_company_idx").on(t.companyId),
]);

export const payrollRunsTable = pgTable("payroll_runs", {
  id: serial("id").primaryKey(),
  month: integer("month").notNull(),
  year: integer("year").notNull(),
  status: text("status").notNull().default("draft"), // 'draft'|'calculated'|'approved'|'paid'|'cancelled'
  notes: text("notes"),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
  approvedAt: timestamp("approved_at"),
  postedAt: timestamp("posted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  companyId: integer("company_id"),
  accountingEntryId: integer("accounting_entry_id"), // payroll accrual journal entry id
  paymentEntryId: integer("payment_entry_id"),
  postingStatus: text("posting_status").notNull().default("pending"), // 'pending'|'posted'|'error'
  postingError: text("posting_error"),
  postingClaimedAt: timestamp("posting_claimed_at"),
  paymentMethod: text("payment_method").notNull().default("bank"), // 'cash'|'bank'
}, (t) => [
  index("payroll_runs_company_idx2").on(t.companyId),
  index("payroll_runs_status_idx2").on(t.status),
]);

export const payrollItemsTable = pgTable("payroll_items", {
  id: serial("id").primaryKey(),
  runId: integer("run_id").notNull(),
  employeeId: integer("employee_id").notNull(),
  baseSalary: numeric("base_salary", { precision: 12, scale: 2 }).notNull(),
  allowance: numeric("allowance", { precision: 12, scale: 2 }).notNull().default("0"),
  grossSalary: numeric("gross_salary", { precision: 12, scale: 2 }).notNull(),
  bpjsJhtEmployee: numeric("bpjs_jht_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  bpjsKesEmployee: numeric("bpjs_kes_employee", { precision: 12, scale: 2 }).notNull().default("0"),
  pph21: numeric("pph21", { precision: 12, scale: 2 }).notNull().default("0"),
  kasbonDeduction: numeric("kasbon_deduction", { precision: 12, scale: 2 }).notNull().default("0"),
  otherDeductions: numeric("other_deductions", { precision: 12, scale: 2 }).notNull().default("0"),
  totalDeductions: numeric("total_deductions", { precision: 12, scale: 2 }).notNull(),
  netSalary: numeric("net_salary", { precision: 12, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  isPaid: boolean("is_paid").notNull().default(false),
  kasbonBalanceAfter: numeric("kasbon_balance_after", { precision: 12, scale: 2 }).notNull().default("0"),
  paidAt: timestamp("paid_at"),
  paidBy: text("paid_by"),
  cashAdvanceId: integer("cash_advance_id"), // which cash_advances row this deduction settles (nullable)
}, (t) => [
  index("payroll_items_run_idx2").on(t.runId),
  index("payroll_items_employee_idx").on(t.employeeId),
]);

export type Employee = typeof employeesTable.$inferSelect;
export type PayrollRun = typeof payrollRunsTable.$inferSelect;
export type PayrollItem = typeof payrollItemsTable.$inferSelect;

/**
 * One payroll item may repay more than one employee advance.  The legacy
 * payroll_items.cash_advance_id column remains as a compatibility pointer to
 * the first FIFO allocation; this table is the canonical allocation ledger.
 */
export const payrollCashAdvanceAllocationsTable = pgTable("payroll_cash_advance_allocations", {
  id: serial("id").primaryKey(),
  payrollItemId: integer("payroll_item_id").notNull(),
  cashAdvanceId: integer("cash_advance_id").notNull(),
  installmentScheduleId: integer("installment_schedule_id"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("payroll_cash_adv_alloc_item_idx").on(t.payrollItemId),
  index("payroll_cash_adv_alloc_advance_idx").on(t.cashAdvanceId),
]);

export const salaryPaymentsTable = pgTable("salary_payments", {
  id: serial("id").primaryKey(),
  payrollItemId: integer("payroll_item_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull(),
  paidAt: timestamp("paid_at").notNull(),
  paidBy: text("paid_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  bankAccountName: text("bank_account_name"),
  bankAccountCode: text("bank_account_code"),
});

export type PayrollCashAdvanceAllocation = typeof payrollCashAdvanceAllocationsTable.$inferSelect;
export type SalaryPayment = typeof salaryPaymentsTable.$inferSelect;

import {
  pgTable, serial, text, integer, numeric, timestamp, date, index,
} from "drizzle-orm/pg-core";
import { chartOfAccountsTable } from "./accounting";

export const cashAdvancesTable = pgTable("cash_advances", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  advanceNumber: text("advance_number").notNull().unique(),
  type: text("type").notNull(), // 'kasbon' | 'talangan'
  partyName: text("party_name").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("bank"), // 'cash' | 'bank'
  date: date("date").notNull(),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // 'active' | 'partial' | 'repaid'
  receivableAccountId: integer("receivable_account_id").references(
    () => chartOfAccountsTable.id, { onDelete: "set null" }
  ),
  cashBankAccountId: integer("cash_bank_account_id").references(
    () => chartOfAccountsTable.id, { onDelete: "set null" }
  ),
  vendorId: integer("vendor_id"),
  userId: text("user_id"),
  entryId: integer("entry_id"),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  disbursedAt: timestamp("disbursed_at"),
  repaidAt: timestamp("repaid_at"),
  voidedAt: timestamp("voided_at"),
  voidedBy: text("voided_by"),
  voidReason: text("void_reason"),
  reversalJournalId: integer("reversal_journal_id"),
  repaymentJournalId: integer("repayment_journal_id"),
  settledAmount: numeric("settled_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  receiptUrl: text("receipt_url"),
  ocrRawData: text("ocr_raw_data"),
  // ── Payroll deduction plan (Cash Advance & Payroll Accounting Automation) ──
  repaymentMethod: text("repayment_method").notNull().default("one_time"), // 'one_time' | 'installment'
  installmentCount: integer("installment_count"),
  installmentAmount: numeric("installment_amount", { precision: 14, scale: 2 }),
  postingStatus: text("posting_status").notNull().default("posted"), // 'pending' | 'posted' | 'error'
  postingError: text("posting_error"),
  accountingPaymentId: integer("accounting_payment_id"),
  // ── Dana Talangan extended fields ──
  category: text("category"),                            // e.g. Operasional, Pembayaran Vendor, ...
  categoryOther: text("category_other"),                 // jika category='lainnya'
  purpose: text("purpose"),                              // tujuan / keperluan dana
  fundingSourceType: text("funding_source_type"),        // kas_perusahaan | rekening_bank | perusahaan_lain | bank | pribadi | pihak_lain
  sourceCompanyId: integer("source_company_id"),         // untuk perusahaan_lain
  sourceBankName: text("source_bank_name"),              // untuk bank / rekening_bank (nama bank)
  sourcePartyName: text("source_party_name"),            // untuk pribadi / pihak_lain / perusahaan_lain manual
  responsiblePartyType: text("responsible_party_type"),  // perusahaan_aktif | perusahaan_lain | bank | vendor | karyawan | pihak_lain
  responsibleCompanyId: integer("responsible_company_id"),
  responsibleBankName: text("responsible_bank_name"),
  responsibleVendorId: integer("responsible_vendor_id"),
  responsibleEmployeeId: text("responsible_employee_id"),
  responsiblePartyName: text("responsible_party_name"),  // nama bebas untuk pihak_lain / manual
  referenceNumber: text("reference_number"),             // no. dokumen / referensi
}, (t) => [
  index("cash_advances_company_idx").on(t.companyId),
  index("cash_advances_type_idx").on(t.type),
  index("cash_advances_status_idx").on(t.status),
  index("cash_advances_date_idx").on(t.date),
]);

export const cashAdvanceRepaymentsTable = pgTable("cash_advance_repayments", {
  id: serial("id").primaryKey(),
  advanceId: integer("advance_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("bank"),
  sourceAccountId: integer("source_account_id"),
  date: date("date").notNull(),
  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  entryId: integer("entry_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cashAdvanceSettlementsTable = pgTable("cash_advance_settlements", {
  id: serial("id").primaryKey(),
  advanceId: integer("advance_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  expenseAccountId: integer("expense_account_id").references(
    () => chartOfAccountsTable.id, { onDelete: "set null" }
  ),
  category: text("category"),
  date: date("date").notNull(),
  notes: text("notes"),
  receiptUrl: text("receipt_url"),
  entryId: integer("entry_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type CashAdvance = typeof cashAdvancesTable.$inferSelect;
export type CashAdvanceRepayment = typeof cashAdvanceRepaymentsTable.$inferSelect;
export type CashAdvanceSettlement = typeof cashAdvanceSettlementsTable.$inferSelect;

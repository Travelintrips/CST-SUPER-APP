import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  pgEnum,
  jsonb,
  date,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { sql as drizzleSql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const accountTypeEnum = pgEnum("account_type", [
  "asset",
  "liability",
  "equity",
  "revenue",
  "expense",
]);

export const coaNormalBalanceEnum = pgEnum("coa_normal_balance", ["DEBIT", "CREDIT"]);
export const coaAccountCategoryEnum = pgEnum("coa_account_category", [
  "ASSET",
  "LIABILITY",
  "EQUITY",
  "REVENUE",
  "EXPENSE",
  "OTHER_INCOME",
  "OTHER_EXPENSE",
  "CONTRA_ASSET",
  "CONTRA_LIABILITY",
  "CONTRA_REVENUE",
  "CONTRA_EXPENSE",
  "CLEARING",
]);
export const coaStatusEnum = pgEnum("coa_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "ACTIVE",
  "REJECTED",
  "INACTIVE",
  "ARCHIVED",
]);
export const coaChangeActionEnum = pgEnum("coa_change_action", [
  "CREATE",
  "UPDATE",
  "UPDATE_NAME",
  "UPDATE_CODE",
  "UPDATE_PARENT",
  "UPDATE_CATEGORY",
  "UPDATE_NORMAL_BALANCE",
  "UPDATE_POSTABLE",
  "ACTIVATE",
  "DEACTIVATE",
  "ARCHIVE",
]);
export const coaChangeRequestStatusEnum = pgEnum("coa_change_request_status", [
  "DRAFT",
  "PENDING_APPROVAL",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);

export const journalTypeEnum = pgEnum("journal_type", [
  "sales",
  "purchase",
  "bank",
  "cash",
  "general",
]);

export const taxKindEnum = pgEnum("tax_kind", ["sale", "purchase", "withholding"]);

export const cutTypeEnum = pgEnum("cut_type", ["self_borne", "withholding"]);

export const accountingEntryStatusEnum = pgEnum("accounting_entry_status", [
  "draft",
  "posted",
  "pending_approval",
  "approved",
  "rejected",
  "voided",
]);

export const accountingEntrySourceEnum = pgEnum("accounting_entry_source", [
  "manual",
  "sales_invoice",
  "purchase_bill",
  "sales_payment",
  "purchase_payment",
  "ecommerce_order",
  "stock_received",
  "manual_payment",
  "reversal",
  "cogs_delivery",
  "purchase_return",
  "sales_return",
  "opname_adjust",
  "damage_adjust",
  "grn_receipt",
  "wh_transfer",
  "sport_center_booking",
  "sport_center_booking_reversal",
  "sport_center_booking_refund",
  "sport_center_refund",
  "sport_center_membership",
  "sport_center_operational_expense",
  "closing_entry",
  "pos_sale",
  "logistic_vendor_cost",
  "tenant_rent_payment",
  "tenant_rent_reversal",
  "bank_mutation_import",
  "gsheet_import",
  "bank_reconciliation",         // Reconciliation approval journal — canonical posting path
  "bank_reconciliation_void",    // Reversal of a reconciliation journal
  "fleet_cash_payment",
  "marketplace_commission", // Added Phase 1C — 2026-07-02
  "kasbon",                 // Advance disbursement/repayment — already in DB enum
  "payroll",                // Payroll disbursement — already in DB enum
  "hrd_salary_payment",     // HRD salary payment — already in DB enum
  "sport_center_ppn_correction",    // Koreksi PPN double-count sport center
  "sport_center_amount_correction", // Koreksi jumlah jurnal ≠ harga fasilitas
  "sport_center_qris_mdr",           // Jurnal biaya MDR QRIS
]);

export const accountingPaymentTypeEnum = pgEnum("accounting_payment_type", [
  "inbound",
  "outbound",
]);

export const accountingPaymentStatusEnum = pgEnum("accounting_payment_status", [
  "posted",
  "voided",
  "draft",
  "pending_approval",
  "approved",
  "rejected",
]);

export const chartOfAccountsTable = pgTable("chart_of_accounts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: accountTypeEnum("type").notNull(),
  /**
   * subtype: opsional, untuk membedakan sub-jenis akun dalam tipe yang sama.
   * Nilai utama:
   *   'cash_bank'  — Kas, Bank, Giro, Kliring → boleh dipakai sbg tujuan fund_transfer
   *   'receivable' — Piutang (Usaha, Karyawan, Dana Talangan, dll.)
   *   'inventory'  — Persediaan Barang
   *   'fixed_asset'— Aset Tetap & Akumulasi Depresiasi
   *   'prepaid'    — Uang Muka / Biaya Dibayar di Muka
   *   'tax_asset'  — PPN Masukan / PPh Dibayar di Muka
   * NULL berarti belum dikategorikan.
   */
  subtype: text("subtype"),
  parentId: integer("parent_id"),
  isActive: boolean("is_active").notNull().default(true),
  normalBalance: coaNormalBalanceEnum("normal_balance").notNull().default("DEBIT"),
  accountCategory: coaAccountCategoryEnum("account_category").notNull().default("ASSET"),
  isPostable: boolean("is_postable").notNull().default(true),
  isHeader: boolean("is_header").notNull().default(false),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  status: coaStatusEnum("status").notNull().default("ACTIVE"),
  version: integer("version").notNull().default(1),
  createdBy: text("created_by"),
  updatedBy: text("updated_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyCodeUniq: uniqueIndex("coa_company_code_uniq").on(t.companyId, t.code),
}));

export const coaChangeRequestsTable = pgTable("coa_change_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  coaId: integer("coa_id"),
  action: coaChangeActionEnum("action").notNull(),
  status: coaChangeRequestStatusEnum("status").notNull().default("DRAFT"),
  beforeSnapshotJson: jsonb("before_snapshot_json"),
  afterSnapshotJson: jsonb("after_snapshot_json").notNull(),
  reason: text("reason").notNull(),
  requestedBy: text("requested_by").notNull(),
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
  reviewedBy: text("reviewed_by"),
  reviewedAt: timestamp("reviewed_at"),
  reviewComments: text("review_comments"),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdempotencyUniq: uniqueIndex("coa_change_requests_company_idempotency_uniq")
    .on(t.companyId, t.idempotencyKey),
  companyStatusIdx: index("coa_change_requests_company_status_idx").on(t.companyId, t.status),
}));

export const coaVersionsTable = pgTable("coa_versions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  coaId: integer("coa_id").notNull(),
  version: integer("version").notNull(),
  snapshotJson: jsonb("snapshot_json").notNull(),
  changeRequestId: integer("change_request_id"),
  effectiveFrom: timestamp("effective_from"),
  effectiveTo: timestamp("effective_to"),
  createdBy: text("created_by"),
  approvedBy: text("approved_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  coaVersionUniq: uniqueIndex("coa_versions_coa_version_uniq").on(t.coaId, t.version),
  companyCoaIdx: index("coa_versions_company_coa_idx").on(t.companyId, t.coaId),
}));

export const accountingJournalsTable = pgTable("accounting_journals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  type: journalTypeEnum("type").notNull(),
  defaultDebitAccountId: integer("default_debit_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  defaultCreditAccountId: integer("default_credit_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyCodeUniq: uniqueIndex("journals_company_code_uniq").on(t.companyId, t.code),
}));

export const accountingTaxesTable = pgTable("accounting_taxes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  rate: numeric("rate", { precision: 6, scale: 3 }).notNull(),
  kind: taxKindEnum("kind").notNull(),
  cutType: cutTypeEnum("cut_type").notNull().default("self_borne"),
  accountId: integer("account_id")
    .notNull()
    .references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const costCentersTable = pgTable("cost_centers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  code: text("code").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyCodeUniq: uniqueIndex("cost_centers_company_code_uniq").on(t.companyId, t.code),
}));

export const accountingEntriesTable = pgTable("accounting_entries", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  entryNumber: text("entry_number").notNull().unique(),
  journalId: integer("journal_id")
    .notNull()
    .references(() => accountingJournalsTable.id, { onDelete: "restrict" }),
  date: date("date").notNull(),
  ref: text("ref"),
  description: text("description"),
  status: accountingEntryStatusEnum("status").notNull().default("posted"),
  source: accountingEntrySourceEnum("source").notNull().default("manual"),
  sourceId: integer("source_id"),
  totalDebit: numeric("total_debit", { precision: 14, scale: 2 }).notNull().default("0"),
  totalCredit: numeric("total_credit", { precision: 14, scale: 2 }).notNull().default("0"),
  createdById: text("created_by_id"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  cancelledBy: text("cancelled_by"),
  cancelledAt: timestamp("cancelled_at"),
  cancelReason: text("cancel_reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  costCenterId: integer("cost_center_id").references(() => costCentersTable.id, { onDelete: "set null" }),
  facilityId: integer("facility_id"),
  expenseCategory: text("expense_category"),
  // ── Accounting Hub columns ────────────────────────────────────────────────
  branchId: integer("branch_id"),
  divisionId: integer("division_id"),
  sourceSchema: text("source_schema"),
  sourceModule: text("source_module"),
  sourceTable: text("source_table"),
  postedAt: timestamp("posted_at"),
  voidedAt: timestamp("voided_at"),
  voidEntryId: integer("void_entry_id"),
}, (t) => ({
  uniqAutoSource: uniqueIndex("accounting_entries_source_uniq")
    .on(t.source, t.sourceId)
    .where(drizzleSql`${t.source} <> 'manual' AND ${t.sourceId} IS NOT NULL`),
  companyIdx: index("accounting_entries_company_idx").on(t.companyId),
  journalIdx: index("accounting_entries_journal_idx").on(t.journalId),
  dateIdx: index("accounting_entries_date_idx").on(t.date),
  branchIdx: index("accounting_entries_branch_idx").on(t.branchId),
  moduleIdx: index("accounting_entries_module_idx").on(t.sourceModule),
}));

export const accountingEntryLinesTable = pgTable("accounting_entry_lines", {
  id: serial("id").primaryKey(),
  entryId: integer("entry_id")
    .notNull()
    .references(() => accountingEntriesTable.id, { onDelete: "cascade" }),
  accountId: integer("account_id")
    .notNull()
    .references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  description: text("description"),
  debit: numeric("debit", { precision: 14, scale: 2 }).notNull().default("0"),
  credit: numeric("credit", { precision: 14, scale: 2 }).notNull().default("0"),
}, (t) => ({
  entryIdx: index("entry_lines_entry_idx").on(t.entryId),
  accountIdx: index("entry_lines_account_idx").on(t.accountId),
}));

export const accountingSettingsTable = pgTable("accounting_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  arAccountId: integer("ar_account_id").references(() => chartOfAccountsTable.id, {
    onDelete: "set null",
  }),
  apAccountId: integer("ap_account_id").references(() => chartOfAccountsTable.id, {
    onDelete: "set null",
  }),
  salesIncomeAccountId: integer("sales_income_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  purchaseExpenseAccountId: integer("purchase_expense_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  defaultBankAccountId: integer("default_bank_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  ppnOutputAccountId: integer("ppn_output_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  ppnInputAccountId: integer("ppn_input_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  salesJournalId: integer("sales_journal_id").references(
    () => accountingJournalsTable.id,
    { onDelete: "set null" },
  ),
  purchaseJournalId: integer("purchase_journal_id").references(
    () => accountingJournalsTable.id,
    { onDelete: "set null" },
  ),
  bankJournalId: integer("bank_journal_id").references(
    () => accountingJournalsTable.id,
    { onDelete: "set null" },
  ),
  cashJournalId: integer("cash_journal_id").references(
    () => accountingJournalsTable.id,
    { onDelete: "set null" },
  ),
  defaultSalesTaxId: integer("default_sales_tax_id").references(
    () => accountingTaxesTable.id,
    { onDelete: "set null" },
  ),
  defaultPurchaseTaxId: integer("default_purchase_tax_id").references(
    () => accountingTaxesTable.id,
    { onDelete: "set null" },
  ),
  defaultCashAccountId: integer("default_cash_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  inventoryAccountId: integer("inventory_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  gsheetSpreadsheetId: text("gsheet_spreadsheet_id"),
  cogsAccountId: integer("cogs_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  grirAccountId: integer("grir_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  companyName: text("company_name"),
  companyAddress: text("company_address"),
  companyNpwp: text("company_npwp"),
  companyLogoUrl: text("company_logo_url"),
  meta: jsonb("meta"),
  // ── Payroll account mapping (Cash Advance & Payroll Accounting Automation) ──
  salaryExpenseAccountId: integer("salary_expense_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  allowanceExpenseAccountId: integer("allowance_expense_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  salaryPayableAccountId: integer("salary_payable_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  taxPayableAccountId: integer("tax_payable_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  bpjsPayableAccountId: integer("bpjs_payable_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  fleetCashAccountId: integer("fleet_cash_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  fleetDriverReceivableAccountId: integer("fleet_driver_receivable_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  tenantRentIncomeAccountId: integer("tenant_rent_income_account_id").references(
    () => chartOfAccountsTable.id,
    { onDelete: "set null" },
  ),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const accountingPaymentsTable = pgTable("accounting_payments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  paymentNumber: text("payment_number"),
  paymentType: accountingPaymentTypeEnum("payment_type").notNull(),
  status: accountingPaymentStatusEnum("status").notNull().default("posted"),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  journalId: integer("journal_id")
    .notNull()
    .references(() => accountingJournalsTable.id, { onDelete: "restrict" }),
  partnerName: text("partner_name"),
  date: date("date").notNull(),
  ref: text("ref"),
  memo: text("memo"),
  entryId: integer("entry_id").references(() => accountingEntriesTable.id, {
    onDelete: "set null",
  }),
  voidEntryId: integer("void_entry_id").references(() => accountingEntriesTable.id, {
    onDelete: "set null",
  }),
  sourceType: text("source_type"),
  sourceDocId: integer("source_doc_id"),
  voidReason: text("void_reason"),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  // ── Accounting Hub columns ────────────────────────────────────────────────
  branchId: integer("branch_id"),
  divisionId: integer("division_id"),
  sourceSchema: text("source_schema"),
  sourceModule: text("source_module"),
  postedAt: timestamp("posted_at"),
  voidedAt: timestamp("voided_at"),
}, (t) => ({
  companyIdx: index("accounting_payments_company_idx").on(t.companyId),
  journalIdx: index("accounting_payments_journal_idx").on(t.journalId),
  dateIdx: index("accounting_payments_date_idx").on(t.date),
}));

// ── Accounting Hub: Posting Errors ────────────────────────────────────────────
export const accountingPostingErrorsTable = pgTable("accounting_posting_errors", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  branchId: integer("branch_id"),
  divisionId: integer("division_id"),
  sourceModule: text("source_module").notNull(),
  sourceTable: text("source_table"),
  sourceId: integer("source_id"),
  sourceRef: text("source_ref"),
  errorCode: text("error_code").notNull(),
  errorMessage: text("error_message").notNull(),
  payload: jsonb("payload"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  resolveNote: text("resolve_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  companyIdx: index("posting_errors_company_idx").on(t.companyId),
  moduleIdx: index("posting_errors_module_idx").on(t.sourceModule),
  resolvedIdx: index("posting_errors_resolved_idx").on(t.resolvedAt),
}));

// ── Accounting Hub: COA Module Mapping ───────────────────────────────────────
export const coaModuleMappingTable = pgTable("coa_module_mapping", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  module: text("module").notNull(),
  transactionType: text("transaction_type").notNull(),
  debitAccountId: integer("debit_account_id")
    .notNull()
    .references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  creditAccountId: integer("credit_account_id")
    .notNull()
    .references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyModuleTxUniq: uniqueIndex("coa_module_mapping_uniq").on(t.companyId, t.module, t.transactionType),
  companyIdx: index("coa_module_mapping_company_idx").on(t.companyId),
}));

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
});
export const insertAccountSchema = createInsertSchema(chartOfAccountsTable).omit({
  id: true,
  createdAt: true,
});
export const insertJournalSchema = createInsertSchema(accountingJournalsTable).omit({
  id: true,
  createdAt: true,
});
export const insertTaxSchema = createInsertSchema(accountingTaxesTable).omit({
  id: true,
  createdAt: true,
});
export const insertEntrySchema = createInsertSchema(accountingEntriesTable).omit({
  id: true,
  createdAt: true,
  entryNumber: true,
  totalDebit: true,
  totalCredit: true,
});
export const insertEntryLineSchema = createInsertSchema(accountingEntryLinesTable).omit({
  id: true,
  entryId: true,
});

export type Company = typeof companiesTable.$inferSelect;
export type Account = typeof chartOfAccountsTable.$inferSelect;
export type CoaChangeRequest = typeof coaChangeRequestsTable.$inferSelect;
export type CoaVersion = typeof coaVersionsTable.$inferSelect;
export type AccountingJournal = typeof accountingJournalsTable.$inferSelect;
export type AccountingTax = typeof accountingTaxesTable.$inferSelect;
export type AccountingEntry = typeof accountingEntriesTable.$inferSelect;
export type AccountingEntryLine = typeof accountingEntryLinesTable.$inferSelect;
export type AccountingSettings = typeof accountingSettingsTable.$inferSelect;
export type AccountingPayment = typeof accountingPaymentsTable.$inferSelect;
export type CostCenter = typeof costCentersTable.$inferSelect;
export type InsertCostCenter = typeof costCentersTable.$inferInsert;
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type InsertAccount = z.infer<typeof insertAccountSchema>;
export type InsertJournal = z.infer<typeof insertJournalSchema>;
export type InsertTax = z.infer<typeof insertTaxSchema>;
export type InsertEntry = z.infer<typeof insertEntrySchema>;
export type InsertEntryLine = z.infer<typeof insertEntryLineSchema>;
export type AccountingPostingError = typeof accountingPostingErrorsTable.$inferSelect;
export type CoaModuleMapping = typeof coaModuleMappingTable.$inferSelect;

export const taxRulesTable = pgTable("tax_rules", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  name: text("name").notNull(),
  transactionType: text("transaction_type").notNull(),
  moduleSource: text("module_source").notNull().default("all"),
  partnerType: text("partner_type").notNull().default("all"),
  partnerPkpStatus: text("partner_pkp_status").notNull().default("all"),
  partnerHasNpwp: text("partner_has_npwp").notNull().default("all"),
  taxType: text("tax_type").notNull(),
  taxRate: numeric("tax_rate", { precision: 8, scale: 4 }).notNull().default("0"),
  taxBaseType: text("tax_base_type").notNull().default("dpp"),
  direction: text("direction").notNull().default("output"),
  isActive: boolean("is_active").notNull().default(true),
  effectiveFrom: date("effective_from"),
  effectiveTo: date("effective_to"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyActiveIdx: index("tax_rules_company_idx").on(t.companyId, t.isActive),
  txTypeIdx: index("tax_rules_tx_type_idx").on(t.transactionType),
}));

export const transactionTaxesTable = pgTable("transaction_taxes", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  transactionType: text("transaction_type").notNull(),
  transactionId: integer("transaction_id").notNull(),
  transactionRef: text("transaction_ref"),
  taxId: integer("tax_id").notNull().references(() => accountingTaxesTable.id, { onDelete: "restrict" }),
  taxName: text("tax_name").notNull(),
  taxRate: numeric("tax_rate", { precision: 6, scale: 3 }).notNull(),
  cutType: text("cut_type").notNull().default("self_borne"),
  baseAmount: numeric("base_amount", { precision: 14, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull(),
  accountId: integer("account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  period: text("period").notNull(),
  status: text("status").notNull().default("pending"),
  direction: text("direction").notNull().default("output"),
  taxRuleId: integer("tax_rule_id").references(() => taxRulesTable.id, { onDelete: "set null" }),
  partnerName: text("partner_name"),
  npwp: text("npwp"),
  fakturPajakNumber: text("faktur_pajak_number"),
  buktiPotongNumber: text("bukti_potong_number"),
  taxInvoiceNumber: text("tax_invoice_number"),
  postedAt: timestamp("posted_at"),
  paidAt: timestamp("paid_at"),
  reportedAt: timestamp("reported_at"),
  notes: text("notes"),
  // ── Kolom ditambahkan via taxSptMigration (sudah ada di DB) ──────────────
  sptStatus: text("spt_status").default("INCLUDED"),
  excludedReason: text("excluded_reason"),
  excludedBy: text("excluded_by"),
  excludedAt: timestamp("excluded_at", { withTimezone: true }),
  // ── Kolom baru via taxAuditMigration ─────────────────────────────────────
  dppNilaiLain: numeric("dpp_nilai_lain", { precision: 14, scale: 2 }).default("0"),
  nik: text("nik"),
  validationErrors: jsonb("validation_errors").default([]),
  metadata: jsonb("metadata").default({}),
  includeInSpt: boolean("include_in_spt").default(true),
  postingDate: timestamp("posting_date", { withTimezone: true }),
  // ── Coretax C7 fields ─────────────────────────────────────────────────────
  invoiceDate: date("invoice_date"),
  fakturDate: date("faktur_date"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  txUniq: uniqueIndex("tx_taxes_tx_uniq").on(t.transactionType, t.transactionId, t.taxId),
  companyPeriodIdx: index("tx_taxes_company_period_idx").on(t.companyId, t.period),
  statusIdx: index("tx_taxes_status_idx").on(t.status),
  directionIdx: index("tx_taxes_direction_idx").on(t.direction),
  sptStatusIdx: index("tx_taxes_spt_status_idx").on(t.companyId, t.period, t.sptStatus),
}));

export type TaxRule = typeof taxRulesTable.$inferSelect;
export type InsertTaxRule = typeof taxRulesTable.$inferInsert;
export type TransactionTax = typeof transactionTaxesTable.$inferSelect;

export const overrideRequestStatusEnum = pgEnum("override_request_status", [
  "PENDING_SECOND_APPROVAL",
  "APPROVED",
  "REJECTED",
  "EXECUTED",
]);

export const financeOverrideRequestsTable = pgTable("finance_override_requests", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  requesterId: text("requester_id").notNull(),
  requesterEmail: text("requester_email").notNull(),
  approverId: text("approver_id"),
  approverEmail: text("approver_email"),
  status: overrideRequestStatusEnum("status").notNull().default("PENDING_SECOND_APPROVAL"),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  entitySnapshot: jsonb("entity_snapshot"),
  targetAction: text("target_action").notNull(),
  reason: text("reason").notNull(),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  executedAt: timestamp("executed_at", { withTimezone: true }),
}, (t) => ({
  companyIdx: index("finance_override_req_company_idx").on(t.companyId),
  statusIdx: index("finance_override_req_status_idx").on(t.status),
  requesterIdx: index("finance_override_req_requester_idx").on(t.requesterId),
}));

export type FinanceOverrideRequest = typeof financeOverrideRequestsTable.$inferSelect;
export type InsertFinanceOverrideRequest = typeof financeOverrideRequestsTable.$inferInsert;

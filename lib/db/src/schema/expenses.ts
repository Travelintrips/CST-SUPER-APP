import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  boolean,
  timestamp,
  date,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { chartOfAccountsTable, accountingTaxesTable } from "./accounting";
import { companiesTable } from "./companies";

export const expenseCategoriesTable = pgTable("expense_categories", {
  id: serial("id").primaryKey(),
  // Nullable only for legacy/backfill safety; every row is expected to carry
  // a companyId after the per-company backfill migration runs (see
  // ensureExpenseCategoriesCompanyScoped in routes/expenses.ts). Categories
  // used to be global across all companies — this is what scopes them.
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  code: text("code").notNull(),
  expenseAccountId: integer("expense_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  payableAccountId: integer("payable_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  defaultTaxId: integer("default_tax_id").references(() => accountingTaxesTable.id, { onDelete: "set null" }),
  defaultAmount: numeric("default_amount", { precision: 14, scale: 2 }),
  defaultCoaId: integer("default_coa_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  requiresAttachment: boolean("requires_attachment").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("expense_categories_company_code_uniq").on(t.companyId, t.code),
  index("expense_categories_company_idx").on(t.companyId),
]);

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  expenseNumber: text("expense_number").notNull().unique(),
  date: date("date").notNull(),
  vendorEmployee: text("vendor_employee"),
  expenseType: text("expense_type").notNull().default("vendor_bill"),
  salesDocId: integer("sales_doc_id"),
  shipmentId: integer("shipment_id"),
  categoryId: integer("category_id").references(() => expenseCategoriesTable.id, { onDelete: "set null" }),
  description: text("description"),
  qty: numeric("qty", { precision: 14, scale: 4 }).notNull().default("1"),
  unit: text("unit"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxRateId: integer("tax_rate_id").references(() => accountingTaxesTable.id, { onDelete: "set null" }),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  currency: text("currency").notNull().default("IDR"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  entryId: integer("entry_id"),
  expenseAccountId: integer("expense_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  payableAccountId: integer("payable_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  sourceAccountId: integer("source_account_id").references(() => chartOfAccountsTable.id, { onDelete: "set null" }),
  vendorId: integer("vendor_id"),
  userId: text("user_id"),
  rejectionReason: text("rejection_reason"),
  createdById: text("created_by_id"),
  // Bridge (nullable) ke bank_disbursements — diisi saat expense dibayar
  // lewat modul Bank Disbursement. Tidak menggabungkan tabel; expenses
  // tetap sumber pencatatan beban, bank_disbursements tetap modul pembayaran.
  disbursementId: integer("disbursement_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("expenses_company_idx").on(t.companyId),
  index("expenses_category_idx").on(t.categoryId),
  index("expenses_status_idx").on(t.status),
  index("expenses_date_idx").on(t.date),
  index("expenses_disbursement_idx").on(t.disbursementId),
]);

export const expenseLinesTable = pgTable("expense_lines", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  expenseId: integer("expense_id").notNull().references(() => expensesTable.id, { onDelete: "cascade" }),
  lineNo: integer("line_no").notNull().default(1),
  description: text("description").notNull(),
  qty: numeric("qty", { precision: 14, scale: 4 }).notNull().default("1"),
  unit: text("unit"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull().default("0"),
  taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  total: numeric("total", { precision: 14, scale: 2 }).notNull().default("0"),
  coaAccountId: integer("coa_account_id").notNull().references(() => chartOfAccountsTable.id, { onDelete: "restrict" }),
  coaResolutionStatus: text("coa_resolution_status").notNull().default("confirmed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("expense_lines_expense_line_no_uniq").on(t.expenseId, t.lineNo),
  index("expense_lines_company_idx").on(t.companyId),
  index("expense_lines_expense_idx").on(t.expenseId),
]);

export const expenseAttachmentsTable = pgTable("expense_attachments", {
  id: serial("id").primaryKey(),
  expenseId: integer("expense_id").notNull(),
  objectPath: text("object_path").notNull(),
  fileName: text("file_name").notNull(),
  contentType: text("content_type"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertExpenseCategorySchema = createInsertSchema(expenseCategoriesTable).omit({
  id: true,
  createdAt: true,
});
export const insertExpenseSchema = createInsertSchema(expensesTable).omit({
  id: true,
  expenseNumber: true,
  entryId: true,
  createdAt: true,
  updatedAt: true,
});

export type ExpenseCategory = typeof expenseCategoriesTable.$inferSelect;
export type Expense = typeof expensesTable.$inferSelect;
export type ExpenseLine = typeof expenseLinesTable.$inferSelect;
export type ExpenseAttachment = typeof expenseAttachmentsTable.$inferSelect;
export type InsertExpenseCategory = z.infer<typeof insertExpenseCategorySchema>;
export type InsertExpense = z.infer<typeof insertExpenseSchema>;

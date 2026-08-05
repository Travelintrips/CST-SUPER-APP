import {
  pgTable, serial, text, integer, numeric, timestamp, date, index,
} from "drizzle-orm/pg-core";
import { chartOfAccountsTable } from "./accounting";

export const vendorInstallmentsTable = pgTable("vendor_installments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  installmentNumber: text("installment_number").notNull().unique(),
  vendorName: text("vendor_name").notNull(),
  totalAmount: numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  paidAmount: numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  remainingAmount: numeric("remaining_amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("bank"), // 'cash' | 'bank'
  date: date("date").notNull(),
  reference: text("reference"),
  notes: text("notes"),
  status: text("status").notNull().default("active"), // 'active' | 'partial' | 'paid'
  apAccountId: integer("ap_account_id").references(
    () => chartOfAccountsTable.id, { onDelete: "set null" }
  ),
  cashBankAccountId: integer("cash_bank_account_id").references(
    () => chartOfAccountsTable.id, { onDelete: "set null" }
  ),
  entryId: integer("entry_id"),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("vendor_installments_company_idx").on(t.companyId),
  index("vendor_installments_status_idx").on(t.status),
  index("vendor_installments_date_idx").on(t.date),
]);

export const vendorInstallmentPaymentsTable = pgTable("vendor_installment_payments", {
  id: serial("id").primaryKey(),
  installmentId: integer("installment_id").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod: text("payment_method").notNull().default("bank"),
  date: date("date").notNull(),
  reference: text("reference"),
  notes: text("notes"),
  entryId: integer("entry_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VendorInstallment = typeof vendorInstallmentsTable.$inferSelect;
export type VendorInstallmentPayment = typeof vendorInstallmentPaymentsTable.$inferSelect;

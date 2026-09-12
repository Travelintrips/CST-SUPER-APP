import { pgTable, serial, integer, text, numeric, date, timestamp, boolean } from "drizzle-orm/pg-core";

export const bankLoansTable = pgTable("bank_loans", {
  id:               serial("id").primaryKey(),
  companyId:        integer("company_id"),
  loanNumber:       text("loan_number").notNull().unique(),
  loanType:         text("loan_type").notNull().default("bank"), // bank | leasing | other
  lenderName:       text("lender_name").notNull(),
  principalAmount:  numeric("principal_amount", { precision: 14, scale: 2 }).notNull(),
  outstandingAmount:numeric("outstanding_amount", { precision: 14, scale: 2 }).notNull(),
  paidAmount:       numeric("paid_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  paymentMethod:    text("payment_method").notNull().default("bank"),
  disbursementDate: date("disbursement_date").notNull(),
  tenorMonths:      integer("tenor_months"),
  interestRate:     numeric("interest_rate", { precision: 7, scale: 4 }).default("0"),
  adminFee:         numeric("admin_fee", { precision: 14, scale: 2 }).default("0"),
  notes:            text("notes"),
  status:           text("status").notNull().default("active"), // active | partial | paid
  journalEntryId:   integer("journal_entry_id"),
  createdById:      text("created_by_id"),
  createdAt:        timestamp("created_at").defaultNow(),
});

export const bankLoanPaymentsTable = pgTable("bank_loan_payments", {
  id:              serial("id").primaryKey(),
  loanId:          integer("loan_id").notNull(),
  paymentDate:     date("payment_date").notNull(),
  principalAmount: numeric("principal_amount", { precision: 14, scale: 2 }).notNull(),
  interestAmount:  numeric("interest_amount", { precision: 14, scale: 2 }).notNull().default("0"),
  totalAmount:     numeric("total_amount", { precision: 14, scale: 2 }).notNull(),
  paymentMethod:   text("payment_method").notNull().default("bank"),
  reference:       text("reference"),
  notes:           text("notes"),
  journalEntryId:  integer("journal_entry_id"),
  createdAt:       timestamp("created_at").defaultNow(),
});

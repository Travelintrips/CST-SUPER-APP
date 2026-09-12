import { pgTable, serial, integer, text, numeric, date, timestamp } from "drizzle-orm/pg-core";

export const bankMutationImportsTable = pgTable("bank_mutation_imports", {
  id:               serial("id").primaryKey(),
  importBatchId:    integer("import_batch_id"),
  transactionDate:  date("transaction_date"),
  description:      text("description"),
  debit:            numeric("debit", { precision: 18, scale: 2 }),
  credit:           numeric("credit", { precision: 18, scale: 2 }),
  balance:          numeric("balance", { precision: 18, scale: 2 }),
  erpCategory:      text("erp_category"),
  entityType:       text("entity_type"),
  entityName:       text("entity_name"),
  businessUnit:     text("business_unit"),
  company:          text("company"),
  taxType:          text("tax_type"),
  paymentMethod:    text("payment_method"),
  sourceAccount:    text("source_account"),
  plFlag:           text("pl_flag"),
  accountingClass:  text("accounting_class"),
  uniqueKey:        text("unique_key"),
  status:           text("status").notNull().default("DRAFT"),
  createdAt:        timestamp("created_at").defaultNow(),
});

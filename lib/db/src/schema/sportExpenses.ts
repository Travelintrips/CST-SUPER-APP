import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const sportExpensesTable = pgTable(
  "sport_expenses",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id"),
    facilityId: integer("facility_id"),
    expenseNumber: text("expense_number").notNull().unique(),
    date: date("date").notNull(),
    category: text("category").notNull().default("lain-lain"),
    description: text("description"),
    amount: numeric("amount", { precision: 14, scale: 2 }).notNull().default("0"),
    paymentMethod: text("payment_method").notNull().default("cash"),
    status: text("status").notNull().default("draft"),
    entryId: integer("entry_id"),
    notes: text("notes"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    index("idx_sport_expenses_company").on(t.companyId),
    index("idx_sport_expenses_facility").on(t.facilityId),
    index("idx_sport_expenses_date").on(t.date),
    index("idx_sport_expenses_status").on(t.status),
  ],
);

export const insertSportExpenseSchema = createInsertSchema(sportExpensesTable, {
  date: z.string().min(1),
  category: z.string().min(1),
  amount: z.union([z.string(), z.number()]).transform(String),
  paymentMethod: z.enum(["cash", "transfer", "hutang"]).default("cash"),
  status: z.enum(["draft", "posted", "void"]).default("draft"),
}).omit({ id: true, expenseNumber: true, entryId: true, createdAt: true, updatedAt: true });

export type SportExpense = typeof sportExpensesTable.$inferSelect;
export type NewSportExpense = typeof sportExpensesTable.$inferInsert;

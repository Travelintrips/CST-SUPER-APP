import { pgTable, serial, text, numeric, timestamp, pgEnum, jsonb, index, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const orderStatusEnum = pgEnum("order_status", ["pending", "processing", "shipped", "delivered", "cancelled"]);

export const ordersTable = pgTable("orders", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email").notNull(),
  customerPhone: text("customer_phone"),
  status: orderStatusEnum("status").default("pending").notNull(),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  taxAmount: numeric("tax_amount", { precision: 12, scale: 2 }).default("0").notNull(),
  grandTotal: numeric("grand_total", { precision: 12, scale: 2 }).notNull(),
  items: text("items"),
  lineItems: jsonb("line_items").$type<Array<{ name: string; qty: number; unitPrice: number }>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  // [H5-FIX] Performance indexes: full table scan tiap query tanpa ini
  index("orders_customer_email_idx").on(t.customerEmail),
  index("orders_status_idx").on(t.status),
  index("orders_created_at_idx").on(t.createdAt),
  index("orders_company_idx").on(t.companyId),
]);

export const insertOrderSchema = createInsertSchema(ordersTable).omit({ id: true, createdAt: true });
export type InsertOrder = z.infer<typeof insertOrderSchema>;
export type Order = typeof ordersTable.$inferSelect;

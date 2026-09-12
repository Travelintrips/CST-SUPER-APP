import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const customerFeedbackLinksTable = pgTable("customer_feedback_links", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  orderId: integer("order_id"),
  orderNumber: text("order_number"),
  customerName: text("customer_name"),
  serviceType: text("service_type"),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("pending"),
  rating: integer("rating"),
  feedback: text("feedback"),
  submittedAt: timestamp("submitted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
  expiresAt: timestamp("expires_at"),
});

export const purchaseMiniFormsTable = pgTable("purchase_mini_forms", {
  id: serial("id").primaryKey(),
  token: text("token").notNull().unique(),
  formType: text("form_type").notNull(),
  refNumber: text("ref_number"),
  title: text("title"),
  notes: text("notes"),
  targetName: text("target_name"),
  currency: text("currency").notNull().default("IDR"),
  payload: jsonb("payload").notNull().default({}),
  status: text("status").notNull().default("pending"),
  submissionData: jsonb("submission_data").default({}),
  submittedAt: timestamp("submitted_at"),
  orderId: integer("order_id"),
  purchaseDocId: integer("purchase_doc_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  createdBy: text("created_by"),
  expiresAt: timestamp("expires_at"),
});

export type CustomerFeedbackLink = typeof customerFeedbackLinksTable.$inferSelect;
export type InsertCustomerFeedbackLink = typeof customerFeedbackLinksTable.$inferInsert;
export type PurchaseMiniForm = typeof purchaseMiniFormsTable.$inferSelect;
export type InsertPurchaseMiniForm = typeof purchaseMiniFormsTable.$inferInsert;

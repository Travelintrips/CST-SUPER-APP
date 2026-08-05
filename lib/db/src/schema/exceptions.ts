import { pgEnum, pgTable, serial, integer, text, timestamp, index, jsonb } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const exceptionTypeEnum = pgEnum("exception_type", [
  "order_rejected",
  "vendor_reject_rfq",
  "vendor_out_of_stock",
  "price_changed",
  "delivery_delayed",
  "failed_delivery",
  "customer_complaint",
  "document_missing",
  "payment_overdue",
  "vendor_rejected",
  "pod_pending_review",
]);

export const exceptionStatusEnum = pgEnum("exception_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

export const exceptionSeverityEnum = pgEnum("exception_severity", [
  "low",
  "medium",
  "high",
  "critical",
]);

export const exceptionsTable = pgTable("exceptions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  exceptionType: exceptionTypeEnum("exception_type").notNull(),
  severity: exceptionSeverityEnum("severity").notNull().default("medium"),
  status: exceptionStatusEnum("status").notNull().default("open"),
  title: text("title").notNull(),
  description: text("description"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  refNumber: text("ref_number"),
  customerName: text("customer_name"),
  supplierName: text("supplier_name"),
  assignedTo: text("assigned_to"),
  resolvedBy: text("resolved_by"),
  resolvedAt: timestamp("resolved_at"),
  resolutionNotes: text("resolution_notes"),
  reportedByType: text("reported_by_type"),
  reportedById: text("reported_by_id"),
  attachments: jsonb("attachments").$type<Array<{ url: string; name: string; type?: string }>>(),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("exc_company_idx").on(t.companyId),
  index("exc_type_idx").on(t.exceptionType),
  index("exc_status_idx").on(t.status),
  index("exc_severity_idx").on(t.severity),
  index("exc_created_idx").on(t.createdAt),
]);

export type ExceptionRow = typeof exceptionsTable.$inferSelect;
export type InsertException = typeof exceptionsTable.$inferInsert;

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  date,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const erpAuditReportsTable = pgTable("erp_audit_reports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  reportNumber: text("report_number").notNull().unique(),
  title: text("title").notNull(),
  auditorName: text("auditor_name"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: text("status").notNull().default("draft"),
  okCount: integer("ok_count").notNull().default(0),
  notOkCount: integer("not_ok_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  naCount: integer("na_count").notNull().default(0),
  totalAnswered: integer("total_answered").notNull().default(0),
  conclusion: text("conclusion"),
  overallNotes: text("overall_notes"),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const erpAuditResponsesTable = pgTable("erp_audit_responses", {
  id: serial("id").primaryKey(),
  reportId: integer("report_id")
    .notNull()
    .references(() => erpAuditReportsTable.id, { onDelete: "cascade" }),
  itemId: text("item_id").notNull(),
  status: text("status").notNull().default("na"),
  notes: text("notes"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("erp_audit_responses_report_item_idx").on(t.reportId, t.itemId),
]);

export type ErpAuditReport = typeof erpAuditReportsTable.$inferSelect;
export type InsertErpAuditReport = typeof erpAuditReportsTable.$inferInsert;
export type ErpAuditResponse = typeof erpAuditResponsesTable.$inferSelect;
export type InsertErpAuditResponse = typeof erpAuditResponsesTable.$inferInsert;

export const insertErpAuditReportSchema = createInsertSchema(erpAuditReportsTable);
export const insertErpAuditResponseSchema = createInsertSchema(erpAuditResponsesTable);

import { pgTable, serial, integer, text, timestamp, jsonb, pgEnum } from "drizzle-orm/pg-core";

export const errorSeverityEnum = pgEnum("error_severity", ["low", "medium", "high", "critical"]);
export const errorTypeEnum = pgEnum("error_type_enum", ["ui_crash", "api_failure", "validation_error", "network_error", "unknown"]);

export const systemErrorLogs = pgTable("system_error_logs", {
  id: serial("id").primaryKey(),
  company_id: integer("company_id"),
  error_message: text("error_message").notNull(),
  stack_trace: text("stack_trace"),
  route: text("route"),
  component: text("component"),
  severity: errorSeverityEnum("severity").notNull().default("medium"),
  error_type: errorTypeEnum("error_type").notNull().default("unknown"),
  metadata: jsonb("metadata"),
  created_at: timestamp("created_at").defaultNow().notNull(),
});

export type SystemErrorLog = typeof systemErrorLogs.$inferSelect;
export type InsertSystemErrorLog = typeof systemErrorLogs.$inferInsert;

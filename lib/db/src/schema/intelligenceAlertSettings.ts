import { pgTable, serial, integer, text, boolean, numeric, timestamp } from "drizzle-orm/pg-core";

export const intelligenceAlertSettingsTable = pgTable("intelligence_alert_settings", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),

  masterEnabled: boolean("master_enabled").notNull().default(true),

  rfqAlertEnabled: boolean("rfq_alert_enabled").notNull().default(true),
  rfqWarningHours: integer("rfq_warning_hours").notNull().default(24),
  rfqCriticalHours: integer("rfq_critical_hours").notNull().default(48),

  marginAlertEnabled: boolean("margin_alert_enabled").notNull().default(true),
  marginMinPct: numeric("margin_min_pct", { precision: 6, scale: 2 }).notNull().default("5.00"),

  etaAlertEnabled: boolean("eta_alert_enabled").notNull().default(true),

  quoteExpiredAlertEnabled: boolean("quote_expired_alert_enabled").notNull().default(true),

  invoiceReminderEnabled: boolean("invoice_reminder_enabled").notNull().default(true),

  alertWindowStart: text("alert_window_start").notNull().default("00:00"),
  alertWindowEnd: text("alert_window_end").notNull().default("23:59"),

  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  updatedBy: text("updated_by"),
});

export type IntelligenceAlertSettings = typeof intelligenceAlertSettingsTable.$inferSelect;
export type InsertIntelligenceAlertSettings = typeof intelligenceAlertSettingsTable.$inferInsert;

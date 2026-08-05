import { pgTable, serial, integer, text, jsonb, timestamp, boolean, index } from "drizzle-orm/pg-core";

export const intelligenceAlertsTable = pgTable("intelligence_alerts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id"),
  alertType: text("alert_type").notNull(),
  // vendor_slow_response | rfq_no_response | quote_expired | order_eta_breach |
  // margin_below_minimum | missing_required_doc | stage_stalled | duplicate_order
  entityType: text("entity_type").notNull(),
  // logistic_order | rfq | customer_quote | shipment | vendor
  entityId: integer("entity_id"),
  entityRef: text("entity_ref"),
  // human-readable ref e.g. order number, rfq number
  severity: text("severity").notNull().default("warning"),
  // info | warning | critical
  title: text("title").notNull(),
  message: text("message").notNull(),
  contextJson: jsonb("context_json").default({}),
  status: text("status").notNull().default("open"),
  // open | acknowledged | resolved
  isRead: boolean("is_read").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at"),
  acknowledgedBy: text("acknowledged_by"),
  resolvedAt: timestamp("resolved_at"),
  resolvedBy: text("resolved_by"),
  triggeredAt: timestamp("triggered_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("intelligence_alerts_company_status_idx").on(t.companyId, t.status),
  index("intelligence_alerts_type_entity_idx").on(t.alertType, t.entityType, t.entityId),
  index("intelligence_alerts_severity_idx").on(t.severity, t.status),
]);

export type IntelligenceAlert = typeof intelligenceAlertsTable.$inferSelect;
export type InsertIntelligenceAlert = typeof intelligenceAlertsTable.$inferInsert;

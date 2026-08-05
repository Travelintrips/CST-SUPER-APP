import { pgTable, serial, integer, numeric, text, timestamp, index } from "drizzle-orm/pg-core";
import { suppliersTable } from "./suppliers";

export const vendorPerformanceTable = pgTable("vendor_performance", {
  id: serial("id").primaryKey(),
  vendorId: integer("vendor_id").notNull().references(() => suppliersTable.id, { onDelete: "cascade" }),
  totalOrders: integer("total_orders").notNull().default(0),
  completedOrders: integer("completed_orders").notNull().default(0),
  cancelledOrders: integer("cancelled_orders").notNull().default(0),
  ontimePercentage: numeric("ontime_percentage", { precision: 5, scale: 2 }).default("0"),
  averageResponseMinutes: numeric("average_response_minutes", { precision: 10, scale: 2 }).default("0"),
  podCompletenessScore: numeric("pod_completeness_score", { precision: 5, scale: 2 }).default("0"),
  etaAccuracyScore: numeric("eta_accuracy_score", { precision: 5, scale: 2 }).default("0"),
  customerRating: numeric("customer_rating", { precision: 3, scale: 2 }).default("0"),
  orderSuccessRate: numeric("order_success_rate", { precision: 5, scale: 2 }).default("0"),
  cancelRate: numeric("cancel_rate", { precision: 5, scale: 2 }).default("0"),
  totalComplaints: integer("total_complaints").notNull().default(0),
  recommendationScore: numeric("recommendation_score", { precision: 5, scale: 2 }).default("0"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  // Extended spec columns (additive)
  totalRfqInvites: integer("total_rfq_invites").default(0),
  totalSubmitted: integer("total_submitted").default(0),
  totalSelected: integer("total_selected").default(0),
  totalRejected: integer("total_rejected").default(0),
  avgResponseHours: numeric("avg_response_hours", { precision: 10, scale: 2 }).default("0"),
  onTimeOrders: integer("on_time_orders").default(0),
  lateOrders: integer("late_orders").default(0),
  podCompleteOrders: integer("pod_complete_orders").default(0),
  score: numeric("score", { precision: 5, scale: 2 }).default("0"),
  lastCalculatedAt: timestamp("last_calculated_at"),
  // Financial metrics
  totalRevenue: numeric("total_revenue", { precision: 18, scale: 2 }).default("0"),
  totalCost: numeric("total_cost", { precision: 18, scale: 2 }).default("0"),
  totalMargin: numeric("total_margin", { precision: 18, scale: 2 }).default("0"),
  marginPct: numeric("margin_pct", { precision: 7, scale: 2 }).default("0"),
  // POD counts
  podUploadedCount: integer("pod_uploaded_count").default(0),
  podMissingCount: integer("pod_missing_count").default(0),
  // Invoice counts
  invoiceIssuedCount: integer("invoice_issued_count").default(0),
  invoiceDisputeCount: integer("invoice_dispute_count").default(0),
  // Complaint count
  customerComplaintCount: integer("customer_complaint_count").default(0),
  // Preferred vendor score & grade
  preferredVendorScore: numeric("preferred_vendor_score", { precision: 5, scale: 2 }).default("0"),
  vendorGrade: text("vendor_grade").default("D"),
}, (t) => [
  index("vendor_perf_vendor_idx").on(t.vendorId),
]);

export type VendorPerformance = typeof vendorPerformanceTable.$inferSelect;
export type InsertVendorPerformance = typeof vendorPerformanceTable.$inferInsert;

import { pgTable, serial, integer, numeric, timestamp, text, index } from "drizzle-orm/pg-core";
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
}, (t) => [
  index("vendor_perf_vendor_idx").on(t.vendorId),
]);

export type VendorPerformance = typeof vendorPerformanceTable.$inferSelect;
export type InsertVendorPerformance = typeof vendorPerformanceTable.$inferInsert;

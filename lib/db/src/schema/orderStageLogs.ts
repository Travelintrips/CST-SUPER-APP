import { pgTable, serial, integer, text, numeric, timestamp, index } from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";

export const orderStageLogsTable = pgTable("order_stage_logs", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id"),
  stageFrom: text("stage_from"),
  stageTo: text("stage_to").notNull(),
  durationHours: numeric("duration_hours", { precision: 10, scale: 2 }),
  actorId: text("actor_id"),
  actorType: text("actor_type").notNull().default("system"),
  // admin | vendor | driver | customer | system
  actorName: text("actor_name"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("order_stage_logs_order_idx").on(t.orderId),
  index("order_stage_logs_company_idx").on(t.companyId),
]);

export type OrderStageLog = typeof orderStageLogsTable.$inferSelect;
export type InsertOrderStageLog = typeof orderStageLogsTable.$inferInsert;

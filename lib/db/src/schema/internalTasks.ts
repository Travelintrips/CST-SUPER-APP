import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { logisticOrdersTable } from "./logisticOrders";

export const internalTasksTable = pgTable("internal_tasks", {
  id: serial("id").primaryKey(),
  orderId: integer("order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),
  orderNumber: text("order_number"),
  refType: text("ref_type").notNull().default("logistic_order"),
  refId: text("ref_id"),
  assignedTo: text("assigned_to"),
  assignedUserId: integer("assigned_user_id"),
  department: text("department"),
  taskType: text("task_type").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  deadline: timestamp("deadline"),
  status: text("status").notNull().default("open"),
  priority: text("priority").notNull().default("normal"),
  completedAt: timestamp("completed_at"),
  completedBy: text("completed_by"),
  companyId: integer("company_id"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("int_tasks_order_idx").on(t.orderId),
  index("int_tasks_status_idx").on(t.status),
  index("int_tasks_dept_idx").on(t.department),
  index("int_tasks_assigned_idx").on(t.assignedTo),
  index("int_tasks_company_idx").on(t.companyId),
]);

export type InternalTask = typeof internalTasksTable.$inferSelect;
export type InsertInternalTask = typeof internalTasksTable.$inferInsert;

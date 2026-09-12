import { pgTable, serial, text, integer, boolean, timestamp, numeric, index } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { departmentsTable } from "./orgStructure";
import { customRolesTable } from "./customRoles";
import { suppliersTable } from "./suppliers";

export const approvalMatrixTable = pgTable("approval_matrix", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  module: text("module").notNull().default("general"),
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  currency: text("currency"),
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  priority: integer("priority").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("approval_matrix_company_idx").on(t.companyId),
  index("approval_matrix_module_idx").on(t.module),
]);

export const approvalMatrixLevelTable = pgTable("approval_matrix_levels", {
  id: serial("id").primaryKey(),
  matrixId: integer("matrix_id").references(() => approvalMatrixTable.id, { onDelete: "cascade" }).notNull(),
  level: integer("level").notNull().default(1),
  label: text("label"),
  minAmount: numeric("min_amount", { precision: 18, scale: 2 }).notNull().default("0"),
  maxAmount: numeric("max_amount", { precision: 18, scale: 2 }),
  approverRoleId: integer("approver_role_id").references(() => customRolesTable.id, { onDelete: "set null" }),
  approverUserId: text("approver_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("approval_matrix_levels_matrix_idx").on(t.matrixId),
]);

export type ApprovalMatrix = typeof approvalMatrixTable.$inferSelect;
export type ApprovalMatrixLevel = typeof approvalMatrixLevelTable.$inferSelect;

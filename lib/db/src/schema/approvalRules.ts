import { pgTable, serial, text, integer, boolean, timestamp, numeric, pgEnum, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { branchesTable, divisionsTable, departmentsTable } from "./orgStructure";
import { customRolesTable } from "./customRoles";

export const approvalScopeEnum = pgEnum("approval_scope", [
  "company",
  "branch",
  "division",
  "department",
]);

export const approvalModuleEnum = pgEnum("approval_module", [
  "purchase_request",
  "purchase_order",
  "rfq",
  "sales_order",
  "expense",
  "inventory_transfer",
  "general",
]);

export const approvalRulesTable = pgTable("approval_rules", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  module: approvalModuleEnum("module").notNull().default("general"),
  scope: approvalScopeEnum("scope").notNull().default("company"),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  divisionId: integer("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  amountThreshold: numeric("amount_threshold", { precision: 18, scale: 2 }),
  approverRoleId: integer("approver_role_id").references(() => customRolesTable.id, { onDelete: "set null" }),
  approverUserId: text("approver_user_id"),
  level: integer("level").notNull().default(1),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("approval_rules_company_idx").on(t.companyId),
  index("approval_rules_module_idx").on(t.module),
  index("approval_rules_scope_idx").on(t.scope),
]);

export const insertApprovalRuleSchema = createInsertSchema(approvalRulesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertApprovalRule = z.infer<typeof insertApprovalRuleSchema>;
export type ApprovalRule = typeof approvalRulesTable.$inferSelect;

import { pgTable, serial, text, timestamp, integer, jsonb, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { branchesTable, divisionsTable, departmentsTable } from "./orgStructure";

export const customRolesTable = pgTable("custom_roles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color").notNull().default("#6366f1"),
  permissions: jsonb("permissions").notNull().default([]),
  scopeType: text("scope_type").default("company_only"),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  divisionId: integer("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("custom_roles_company_idx").on(t.companyId),
  index("custom_roles_scope_idx").on(t.scopeType),
]);

export const insertCustomRoleSchema = createInsertSchema(customRolesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertCustomRole = z.infer<typeof insertCustomRoleSchema>;
export type CustomRole = typeof customRolesTable.$inferSelect;

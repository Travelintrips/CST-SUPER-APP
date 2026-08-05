import { pgTable, serial, text, integer, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { sql } from "drizzle-orm";

export const branchesTable = pgTable("branches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  code: text("code"),
  address: text("address"),
  phone: text("phone"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("branches_company_idx").on(t.companyId),
  uniqueIndex("branches_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`),
]);

export const divisionsTable = pgTable("divisions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  managerId: text("manager_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("divisions_company_idx").on(t.companyId),
  uniqueIndex("divisions_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`),
  index("divisions_branch_idx").on(t.branchId),
]);

export const departmentsTable = pgTable("departments", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  divisionId: integer("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  managerId: text("manager_id"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("departments_company_idx").on(t.companyId),
  index("departments_division_idx").on(t.divisionId),
  uniqueIndex("departments_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`),
  index("departments_branch_idx").on(t.branchId),
]);

export const sectionsTable = pgTable("sections", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  code: text("code"),
  description: text("description"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("sections_company_idx").on(t.companyId),
  index("sections_department_idx").on(t.departmentId),
  uniqueIndex("sections_company_code_unique").on(t.companyId, t.code).where(sql`${t.code} IS NOT NULL AND ${t.code} <> ''`),
]);

export const insertBranchSchema = createInsertSchema(branchesTable).omit({ id: true, createdAt: true });
export type InsertBranch = z.infer<typeof insertBranchSchema>;
export type Branch = typeof branchesTable.$inferSelect;

export const insertDivisionSchema = createInsertSchema(divisionsTable).omit({ id: true, createdAt: true });
export type InsertDivision = z.infer<typeof insertDivisionSchema>;
export type Division = typeof divisionsTable.$inferSelect;

export const insertDepartmentSchema = createInsertSchema(departmentsTable).omit({ id: true, createdAt: true });
export type InsertDepartment = z.infer<typeof insertDepartmentSchema>;
export type Department = typeof departmentsTable.$inferSelect;

export const insertSectionSchema = createInsertSchema(sectionsTable).omit({ id: true, createdAt: true });
export type InsertSection = z.infer<typeof insertSectionSchema>;
export type Section = typeof sectionsTable.$inferSelect;

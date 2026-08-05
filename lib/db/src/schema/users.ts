import { pgTable, text, timestamp, pgEnum, integer, serial } from "drizzle-orm/pg-core";
import { uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { branchesTable, divisionsTable, departmentsTable, sectionsTable } from "./orgStructure";
import { customRolesTable } from "./customRoles";

export const userRoleEnum = pgEnum("user_role", ["admin", "ecommerce", "trading", "logistics"]);

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull().default(""),
  firstName: text("first_name"),
  lastName: text("last_name"),
  profileImageUrl: text("profile_image_url"),
  role: userRoleEnum("role").default("ecommerce").notNull(),
  division: text("division"),
  department: text("department"),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  branchId: integer("branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  divisionId: integer("division_id").references(() => divisionsTable.id, { onDelete: "set null" }),
  departmentId: integer("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
  sectionId: integer("section_id").references(() => sectionsTable.id, { onDelete: "set null" }),
  customRoleId: integer("custom_role_id").references(() => customRolesTable.id, { onDelete: "set null" }),
  defaultBranchId: integer("default_branch_id").references(() => branchesTable.id, { onDelete: "set null" }),
  systemRole: text("system_role"),
  whatsapp: text("whatsapp"),
  passwordHash: text("password_hash"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ createdAt: true, updatedAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;

/**
 * Allowed-company access list for admin users.
 * Empty = all companies permitted. Non-empty = restricted to listed companies only.
 */
export const userAllowedCompaniesTable = pgTable("user_allowed_companies", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("uac_user_company_idx").on(t.userId, t.companyId),
]);

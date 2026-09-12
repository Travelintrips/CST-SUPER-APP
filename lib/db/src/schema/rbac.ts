import { pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";

export const rbacRolePermissionsTable = pgTable("rbac_role_permissions", {
  id: serial("id").primaryKey(),
  roleName: text("role_name").notNull(),
  module: text("module").notNull(),
  action: text("action").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  unique("rbac_role_permissions_unique").on(t.roleName, t.module, t.action),
]);

export type RbacRolePermission = typeof rbacRolePermissionsTable.$inferSelect;

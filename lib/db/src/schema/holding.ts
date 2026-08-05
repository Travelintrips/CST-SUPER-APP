import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  timestamp,
} from "drizzle-orm/pg-core";

export const holdingGroupsTable = pgTable("holding_groups", {
  id: serial("id").primaryKey(),
  holdingName: text("holding_name").notNull(),
  holdingCode: text("holding_code").notNull().unique(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const companyHoldingMembersTable = pgTable("company_holding_members", {
  id: serial("id").primaryKey(),
  holdingGroupId: integer("holding_group_id").references(() => holdingGroupsTable.id),
  companyId: integer("company_id").notNull(),
  ownershipPercentage: numeric("ownership_percentage", { precision: 5, scale: 2 }).default("100.00"),
  consolidationMethod: text("consolidation_method").default("full"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type HoldingGroup = typeof holdingGroupsTable.$inferSelect;
export type CompanyHoldingMember = typeof companyHoldingMembersTable.$inferSelect;

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { portalCustomersTable } from "./portalCustomers";
import { companiesTable } from "./companies";

/**
 * A customer request for an organisation which is not yet in the canonical
 * companies table.  A request never grants company access by itself; only an
 * admin approval with a canonical company mapping creates membership.
 */
export const portalCompanyRequestsTable = pgTable("portal_company_requests", {
  id: serial("id").primaryKey(),
  portalCustomerId: integer("portal_customer_id")
    .notNull()
    .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  requestedCompanyName: text("requested_company_name").notNull(),
  requestedRegistrationNumber: text("requested_registration_number"),
  status: text("status").notNull().default("pending"),
  matchedCompanyId: integer("matched_company_id")
    .references(() => companiesTable.id, { onDelete: "set null" }),
  reviewNote: text("review_note"),
  reviewedBy: integer("reviewed_by")
    .references(() => portalCustomersTable.id, { onDelete: "set null" }),
  reviewedAt: timestamp("reviewed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("pcr_customer_idx").on(t.portalCustomerId),
  index("pcr_status_idx").on(t.status),
  index("pcr_company_idx").on(t.matchedCompanyId),
]);

export const insertPortalCompanyRequestSchema = createInsertSchema(portalCompanyRequestsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertPortalCompanyRequest = z.infer<typeof insertPortalCompanyRequestSchema>;
export type PortalCompanyRequest = typeof portalCompanyRequestsTable.$inferSelect;
import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { portalCustomersTable } from "./portalCustomers";

/**
 * Durable login identities for the public Customer/Vendor Portal.
 *
 * portal_customers remains the canonical account/profile. This table only
 * records verified provider identities so a second login method can link to
 * the same account without creating a duplicate profile.
 */
export const portalAuthIdentitiesTable = pgTable("portal_auth_identities", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id")
    .notNull()
    .references(() => portalCustomersTable.id, { onDelete: "cascade" }),
  provider: text("provider").notNull(),
  subject: text("subject").notNull(),
  verifiedAt: timestamp("verified_at").defaultNow().notNull(),
  lastUsedAt: timestamp("last_used_at").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("portal_auth_identity_provider_subject_unique").on(t.provider, t.subject),
  uniqueIndex("portal_auth_identity_customer_provider_unique").on(t.customerId, t.provider),
]);

export type PortalAuthIdentity = typeof portalAuthIdentitiesTable.$inferSelect;
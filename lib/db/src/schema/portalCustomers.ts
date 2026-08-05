import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const portalCustomersTable = pgTable("portal_customers", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  phone: text("phone"),
  company: text("company"),
  role: text("role").notNull().default("customer"),
  avatarUrl: text("avatar_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  resetPasswordToken: text("reset_password_token"),
  resetPasswordExpiry: timestamp("reset_password_expiry"),
  oauthProvider: text("oauth_provider"),
  oauthId: text("oauth_id"),
}, (t) => ({
  phoneUniqueIdx: uniqueIndex("portal_customers_phone_unique").on(t.phone).where(sql`${t.phone} IS NOT NULL AND ${t.phone} <> ''`),
}));

export const portalCustomerServicesTable = pgTable("portal_customer_services", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").notNull(),
  serviceId: integer("service_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// portal_content is a shared key-value table used by CMS content AND several
// unrelated features (settings.ts, adminWa.ts, appSecrets.ts, etc.) that all
// upsert/read by bare `key` with a key-only unique constraint. Do NOT change
// that uniqueness — locale-aware CMS text uses a `${key}__${locale}` suffix
// convention instead (see portalContentService.ts), which is fully additive
// and never collides with existing non-suffixed keys used elsewhere.
export const portalContentTable = pgTable("portal_content", {
  id: serial("id").primaryKey(),
  key: text("key").notNull(),
  value: text("value").notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  locale: text("locale").notNull().default("id-ID"),
}, (t) => [
  uniqueIndex("portal_content_key_locale_unique").on(t.key, t.locale),
]);

export const insertPortalCustomerSchema = createInsertSchema(portalCustomersTable).omit({ id: true, createdAt: true });
export type InsertPortalCustomer = z.infer<typeof insertPortalCustomerSchema>;
export type PortalCustomer = typeof portalCustomersTable.$inferSelect;
export type PortalContent = typeof portalContentTable.$inferSelect;

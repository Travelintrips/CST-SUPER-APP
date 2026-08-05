import { pgTable, serial, text, timestamp, integer, index } from "drizzle-orm/pg-core";

export const shortLinksTable = pgTable("short_links", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  targetUrl: text("target_url").notNull(),
  context: text("context").notNull().default("general"),
  refType: text("ref_type"),
  refId: text("ref_id"),
  hitCount: integer("hit_count").notNull().default(0),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("short_links_context_idx").on(t.context),
  index("short_links_ref_idx").on(t.refType, t.refId),
]);

export type ShortLink = typeof shortLinksTable.$inferSelect;
export type InsertShortLink = typeof shortLinksTable.$inferInsert;

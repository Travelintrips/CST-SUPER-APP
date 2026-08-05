import {
  pgTable, serial, integer, text, timestamp, index,
} from "drizzle-orm/pg-core";
import { logisticOrdersTable, logisticOrderRfqsTable } from "./logisticOrders";

export const adminActionLinksTable = pgTable("admin_action_links", {
  id: serial("id").primaryKey(),
  // Transition: token = raw (legacy lookup); token_hash = HMAC-SHA256 (new lookup)
  token: text("token").notNull().unique(),
  tokenHash: text("token_hash"),            // P0.1 — HMAC-SHA256 of raw token
  actionType: text("action_type").notNull(),
  // review_order | compare_vendors | forward_vendor
  orderId: integer("order_id").notNull().references(() => logisticOrdersTable.id, { onDelete: "cascade" }),
  rfqId: integer("rfq_id").references(() => logisticOrderRfqsTable.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at"),
  usedAt: timestamp("used_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("admin_action_links_token_hash_idx").on(t.tokenHash),
  index("admin_action_links_order_idx").on(t.orderId),
]);

export type AdminActionLink = typeof adminActionLinksTable.$inferSelect;

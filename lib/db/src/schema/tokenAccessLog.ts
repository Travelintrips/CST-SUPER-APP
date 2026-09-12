import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Token Access Log — Security Audit Trail (P2.1 Enriched)
 *
 * Setiap kali token dibuka atau digunakan (berhasil maupun gagal),
 * catat ke sini untuk keperluan forensik dan deteksi anomali.
 */
export const tokenAccessLogTable = pgTable("token_access_log", {
  id: serial("id").primaryKey(),
  // Jenis token: admin_action | customer_quote | customer_approval | customer_invoice |
  //              vendor_mini_form | vendor_fulfillment | vendor_job | customer_feedback |
  //              driver_progress | payment_proof | air_freight_approval | customer_data |
  //              order_task | customer_order | ocean_freight_approval
  tokenType: text("token_type").notNull(),
  // Token ref — ALWAYS masked (first 8 chars only). Never store raw token here.
  tokenRef: text("token_ref").notNull(),
  // ID entitas terkait (order ID, approval ID, dsb.)
  entityId: text("entity_id"),
  // Action yang dilakukan: view | submit | approve | reject | revoke | expired_attempt | used_attempt | revoked_attempt
  action: text("action").notNull(),
  // Outcome: ok | denied_expired | denied_used | denied_revoked | denied_not_found
  outcome: text("outcome").notNull().default("ok"),
  // Request metadata (original)
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  // P2.1 — Enriched audit fields
  requestId:      text("request_id"),       // correlation ID per request
  responseStatus: integer("response_status"), // HTTP status code sent back
  latencyMs:      integer("latency_ms"),    // request processing time in ms
  requestMethod:  text("request_method"),   // GET | POST | PATCH | etc.
  route:          text("route"),            // matched Express route path
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type TokenAccessLog = typeof tokenAccessLogTable.$inferSelect;
export type InsertTokenAccessLog = typeof tokenAccessLogTable.$inferInsert;

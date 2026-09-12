import { pgTable, serial, text, integer, jsonb, timestamp, index } from "drizzle-orm/pg-core";

/**
 * ENTERPRISE DB PHASE 3C — Order Links Cross-Reference Table
 *
 * Additive-only cross-reference table linking orders/documents across
 * domains (marketplace RFQ, logistic order, portal product order, sales
 * document, invoice/payment, purchase order, fulfillment, ppjk order,
 * accounting document, etc).
 *
 * Rules enforced:
 *   - No existing order table is merged, dropped, renamed, or altered.
 *   - source_table/target_table are polymorphic string references —
 *     NO foreign keys are declared against them (a table name can point
 *     at any physical table, so a real FK is neither possible nor safe).
 *   - Purely additive: existing write paths, APIs, and frontend are
 *     untouched. This table is populated only via orderLinkService.
 */
export const orderLinksTable = pgTable(
  "order_links",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id"),
    // Polymorphic source reference — table name + row id (no DB-level FK possible)
    sourceTable: text("source_table").notNull(),
    sourceId: integer("source_id").notNull(),
    // Polymorphic target reference — table name + row id (no DB-level FK possible)
    targetTable: text("target_table").notNull(),
    targetId: integer("target_id").notNull(),
    // e.g. "rfq_to_logistic_order" | "product_order_to_sales_document" |
    //      "logistic_order_to_invoice" | "purchase_order_to_fulfillment" |
    //      "ppjk_order_to_logistic_order" | "unified_order_to_accounting_document"
    linkType: text("link_type").notNull(),
    // e.g. "active" | "superseded" | "cancelled" | "candidate" (dry-run backfill suggestion)
    relationStatus: text("relation_status").notNull().default("active"),
    metadata: jsonb("metadata"),
    createdBy: text("created_by"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => ({
    companyIdIdx: index("order_links_company_id_idx").on(t.companyId),
    sourceIdx: index("order_links_source_idx").on(t.sourceTable, t.sourceId),
    targetIdx: index("order_links_target_idx").on(t.targetTable, t.targetId),
    linkTypeIdx: index("order_links_link_type_idx").on(t.linkType),
    relationStatusIdx: index("order_links_relation_status_idx").on(t.relationStatus),
  })
);

export type OrderLink = typeof orderLinksTable.$inferSelect;
export type InsertOrderLink = typeof orderLinksTable.$inferInsert;

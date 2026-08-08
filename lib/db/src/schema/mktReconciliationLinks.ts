import {
  index,
  integer,
  jsonb,
  numeric,
  serial,
  text,
  timestamp,
  uniqueIndex,
  pgTable,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { suppliersTable } from "./suppliers";
import { paymentRequestsTable } from "./purchaseWorkflow";
import { mktApPreparationsTable } from "./mktApPreparations";
import { mktAccountingHandoffsTable } from "./mktAccountingHandoffs";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";

/**
 * Marketplace's additive boundary to the existing Bank Reconciliation module.
 *
 * This record is a canonical reference only. It is deliberately not a bank
 * mutation, match, approval, journal, posting, or reconciliation result.
 */
export const mktReconciliationLinksTable = pgTable("mkt_reconciliation_links", {
  id: serial("id").primaryKey(),
  linkKey: text("link_key").notNull(),
  correlationReference: text("correlation_reference").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  accountingHandoffId: integer("accounting_handoff_id")
    .notNull()
    .references(() => mktAccountingHandoffsTable.id, { onDelete: "restrict" }),
  apPreparationId: integer("ap_preparation_id")
    .notNull()
    .references(() => mktApPreparationsTable.id, { onDelete: "restrict" }),
  mktPurchaseOrderId: integer("mkt_purchase_order_id")
    .notNull()
    .references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
  paymentRequestId: integer("payment_request_id")
    .notNull()
    .references(() => paymentRequestsTable.id, { onDelete: "restrict" }),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id")
    .notNull()
    .references(() => suppliersTable.id, { onDelete: "restrict" }),
  currency: text("currency").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  paymentReference: text("payment_reference").notNull(),
  accountingReference: text("accounting_reference").notNull(),
  marketplaceReference: text("marketplace_reference").notNull(),
  status: text("status").notNull().default("created"),
  payload: jsonb("payload").notNull(),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mkt_reconciliation_links_key_unique").on(t.linkKey),
  uniqueIndex("mkt_reconciliation_links_correlation_unique").on(t.correlationReference),
  uniqueIndex("mkt_reconciliation_links_handoff_unique").on(t.accountingHandoffId),
  uniqueIndex("mkt_reconciliation_links_payment_unique").on(t.paymentRequestId),
  index("mkt_reconciliation_links_company_idx").on(t.companyId),
  index("mkt_reconciliation_links_po_idx").on(t.mktPurchaseOrderId),
  index("mkt_reconciliation_links_status_idx").on(t.status),
]);

export type MktReconciliationLink = typeof mktReconciliationLinksTable.$inferSelect;
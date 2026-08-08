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
import { vendorInvoicesTable } from "./purchaseWorkflow";
import { paymentRequestsTable } from "./purchaseWorkflow";
import { mktApPreparationsTable } from "./mktApPreparations";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";
import { mktPoGoodsReceiptsTable } from "./mktPoGoodsReceipts";

/**
 * Marketplace's durable boundary to Accounting.
 *
 * This is evidence/status only. It is deliberately not an accounting journal,
 * journal line, COA mapping, or posting record.
 */
export const mktAccountingHandoffsTable = pgTable("mkt_accounting_handoffs", {
  id: serial("id").primaryKey(),
  handoffKey: text("handoff_key").notNull(),
  correlationReference: text("correlation_reference").notNull(),
  payloadFingerprint: text("payload_fingerprint").notNull(),
  apPreparationId: integer("ap_preparation_id")
    .notNull()
    .references(() => mktApPreparationsTable.id, { onDelete: "restrict" }),
  vendorInvoiceId: integer("vendor_invoice_id")
    .notNull()
    .references(() => vendorInvoicesTable.id, { onDelete: "restrict" }),
  mktPurchaseOrderId: integer("mkt_purchase_order_id")
    .notNull()
    .references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
  mktGoodsReceiptId: integer("mkt_goods_receipt_id")
    .notNull()
    .references(() => mktPoGoodsReceiptsTable.id, { onDelete: "restrict" }),
  paymentRequestId: integer("payment_request_id")
    .notNull()
    .references(() => paymentRequestsTable.id, { onDelete: "restrict" }),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id")
    .notNull()
    .references(() => suppliersTable.id, { onDelete: "restrict" }),
  currency: text("currency").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  approvalState: text("approval_state").notNull(),
  paymentLifecycleState: text("payment_lifecycle_state").notNull(),
  status: text("status").notNull().default("accepted"),
  accountingReference: text("accounting_reference"),
  accountingStatus: text("accounting_status"),
  failureCode: text("failure_code"),
  failureReason: text("failure_reason"),
  payload: jsonb("payload").notNull(),
  requestedBy: text("requested_by"),
  acceptedAt: timestamp("accepted_at"),
  lastResponseAt: timestamp("last_response_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mkt_accounting_handoffs_key_unique").on(t.handoffKey),
  uniqueIndex("mkt_accounting_handoffs_correlation_unique").on(t.correlationReference),
  uniqueIndex("mkt_accounting_handoffs_ap_unique").on(t.apPreparationId),
  index("mkt_accounting_handoffs_company_idx").on(t.companyId),
  index("mkt_accounting_handoffs_status_idx").on(t.status),
  index("mkt_accounting_handoffs_payment_idx").on(t.paymentRequestId),
]);

export type MktAccountingHandoff = typeof mktAccountingHandoffsTable.$inferSelect;
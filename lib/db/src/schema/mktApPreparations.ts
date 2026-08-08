import {
  pgEnum,
  pgTable,
  serial,
  integer,
  numeric,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { suppliersTable } from "./suppliers";
import { vendorInvoicesTable } from "./purchaseWorkflow";
import { mktPurchaseOrdersTable } from "./mktPurchaseOrders";
import { mktPoGoodsReceiptsTable } from "./mktPoGoodsReceipts";

export const mktApPreparationStatusEnum = pgEnum("mkt_ap_preparation_status", [
  "ap_preparation",
  "finance_review",
  "waiting_payment",
]);

export const mktApPreparationsTable = pgTable("mkt_ap_preparations", {
  id: serial("id").primaryKey(),
  preparationNumber: text("preparation_number").notNull().unique(),
  vendorInvoiceId: integer("vendor_invoice_id")
    .notNull()
    .references(() => vendorInvoicesTable.id, { onDelete: "restrict" }),
  mktPurchaseOrderId: integer("mkt_purchase_order_id")
    .notNull()
    .references(() => mktPurchaseOrdersTable.id, { onDelete: "restrict" }),
  mktGoodsReceiptId: integer("mkt_goods_receipt_id")
    .notNull()
    .references(() => mktPoGoodsReceiptsTable.id, { onDelete: "restrict" }),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),
  supplierId: integer("supplier_id")
    .notNull()
    .references(() => suppliersTable.id, { onDelete: "restrict" }),
  supplierName: text("supplier_name").notNull(),
  invoiceNumberSnapshot: text("invoice_number_snapshot").notNull(),
  vendorInvoiceRefSnapshot: text("vendor_invoice_ref_snapshot"),
  currencySnapshot: text("currency_snapshot").notNull(),
  totalAmountSnapshot: numeric("total_amount_snapshot", { precision: 14, scale: 2 }).notNull(),
  taxAmountSnapshot: numeric("tax_amount_snapshot", { precision: 14, scale: 2 }).notNull(),
  grandTotalSnapshot: numeric("grand_total_snapshot", { precision: 14, scale: 2 }).notNull(),
  status: mktApPreparationStatusEnum("status").notNull().default("ap_preparation"),
  notes: text("notes"),
  financeReviewedBy: text("finance_reviewed_by"),
  financeReviewedAt: timestamp("finance_reviewed_at"),
  waitingPaymentAt: timestamp("waiting_payment_at"),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("mkt_ap_preparations_invoice_unique").on(t.vendorInvoiceId),
  index("mkt_ap_preparations_status_idx").on(t.status),
  index("mkt_ap_preparations_company_idx").on(t.companyId),
  index("mkt_ap_preparations_vendor_idx").on(t.supplierId),
]);

export type MktApPreparation = typeof mktApPreparationsTable.$inferSelect;
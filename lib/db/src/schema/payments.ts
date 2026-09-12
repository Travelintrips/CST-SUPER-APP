import { pgTable, serial, text, integer, numeric, timestamp, pgEnum, jsonb, boolean, index } from "drizzle-orm/pg-core";

export const paymentRefKindEnum = pgEnum("payment_ref_kind", ["sales", "purchase", "logistic"]);
export const paymentStatusEnum = pgEnum("payment_status", [
  "pending",
  "paid",
  "expired",
  "cancelled",
  "failed",
]);
export const paymentProviderEnum = pgEnum("payment_provider", ["paylabs"]);

export const paymentsTable = pgTable("payments", {
  id: serial("id").primaryKey(),
  // Phase 1 isolation — nullable during backfill; enforce NOT NULL after data migration
  companyId: integer("company_id"),
  refKind: paymentRefKindEnum("ref_kind").notNull(),
  refId: integer("ref_id").notNull(),
  refDocNumber: text("ref_doc_number").notNull(),
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(),
  status: paymentStatusEnum("status").notNull().default("pending"),
  provider: paymentProviderEnum("provider").notNull().default("paylabs"),
  /** Metode pembayaran yang dipilih di provider, mis. qris, transfer, atau cash. */
  paymentMethod: text("payment_method"),
  providerOrderId: text("provider_order_id"),
  providerMerchantTradeNo: text("provider_merchant_trade_no").notNull().unique(),
  paymentUrl: text("payment_url"),
  raw: jsonb("raw"),
  expiredAt: timestamp("expired_at"),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("payments_company_idx").on(t.companyId),
  index("payments_ref_idx").on(t.refKind, t.refId),
  index("payments_paid_at_idx").on(t.paidAt),
  index("payments_status_paid_at_idx").on(t.status, t.paidAt),
]);

export type Payment = typeof paymentsTable.$inferSelect;

export const paylabsConfigurationsTable = pgTable("paylabs_configurations", {
  id: serial("id").primaryKey(),
  sandboxMode: boolean("sandbox_mode").notNull().default(false),
  storeId: text("store_id"),
  sandboxPublicKey: text("sandbox_public_key"),
  sandboxPrivateKey: text("sandbox_private_key"),
  sandboxMerchantId: text("sandbox_merchant_id"),
  prodPublicKey: text("prod_public_key"),
  prodPrivateKey: text("prod_private_key"),
  prodMerchantId: text("prod_merchant_id"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type PaylabsConfiguration = typeof paylabsConfigurationsTable.$inferSelect;

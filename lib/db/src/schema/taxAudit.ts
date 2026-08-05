import {
  pgTable,
  serial,
  integer,
  text,
  numeric,
  timestamp,
  boolean,
  jsonb,
  uuid,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { transactionTaxesTable } from "./accounting";

// ─── tax_adjustments ────────────────────────────────────────────────────────
// Dibuat oleh taxSptMigration.ts — Drizzle schema ditambahkan untuk type-safety.

export const taxAdjustmentsTable = pgTable("tax_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull(),
  transactionTaxId: integer("transaction_tax_id")
    .notNull()
    .references(() => transactionTaxesTable.id, { onDelete: "restrict" }),
  adjustmentType: text("adjustment_type").notNull(),
  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  reason: text("reason").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  rejectedBy: text("rejected_by"),
  rejectedAt: timestamp("rejected_at", { withTimezone: true }),
  rejectionReason: text("rejection_reason"),
  status: text("status").notNull().default("PENDING"),
}, (t) => ({
  companyStatusIdx: index("tax_adj_company_idx").on(t.companyId, t.status),
  txTaxIdx: index("tax_adj_tx_tax_idx").on(t.transactionTaxId),
}));

export type TaxAdjustment = typeof taxAdjustmentsTable.$inferSelect;
export type InsertTaxAdjustment = typeof taxAdjustmentsTable.$inferInsert;

// ─── tax_audit_logs ─────────────────────────────────────────────────────────
// Dibuat oleh taxSptMigration.ts — Drizzle schema ditambahkan untuk type-safety.

export const taxAuditLogsTable = pgTable("tax_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: integer("company_id").notNull(),
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id").notNull(),
  action: text("action").notNull(),
  beforeData: jsonb("before_data"),
  afterData: jsonb("after_data"),
  performedBy: text("performed_by").notNull(),
  ipAddress: text("ip_address"),
  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyTimestampIdx: index("tax_audit_logs_company_idx").on(t.companyId, t.timestamp),
  entityIdx: index("tax_audit_logs_entity_idx").on(t.entityType, t.entityId),
}));

export type TaxAuditLog = typeof taxAuditLogsTable.$inferSelect;

// ─── tax_spt_drafts ─────────────────────────────────────────────────────────
// Dibuat self-migrating oleh taxSptDraftRepository.ts — Drizzle schema untuk type-safety.

export const taxSptDraftsTable = pgTable("tax_spt_drafts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  period: text("period").notNull(),
  type: text("type").notNull(),
  status: text("status").notNull().default("draft"),
  payloadJson: jsonb("payload_json"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyPeriodIdx: index("idx_tax_spt_drafts_company_period").on(t.companyId, t.period, t.type),
}));

export type TaxSptDraft = typeof taxSptDraftsTable.$inferSelect;

// ─── tax_periods ────────────────────────────────────────────────────────────
// Tabel baru: kontrol lock status per periode per company.

export const taxPeriodsTable = pgTable("tax_periods", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  taxPeriod: text("tax_period").notNull(),
  taxType: text("tax_type").notNull().default("ALL"),
  status: text("status").notNull().default("open"),
  lockedAt: timestamp("locked_at", { withTimezone: true }),
  lockedBy: text("locked_by"),
  exportedAt: timestamp("exported_at", { withTimezone: true }),
  exportedBy: text("exported_by"),
  revisedAt: timestamp("revised_at", { withTimezone: true }),
  revisedBy: text("revised_by"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyPeriodTypeUniq: uniqueIndex("tax_periods_company_period_type_uniq").on(t.companyId, t.taxPeriod, t.taxType),
  statusIdx: index("tax_periods_status_idx").on(t.companyId, t.status),
}));

export type TaxPeriod = typeof taxPeriodsTable.$inferSelect;
export type InsertTaxPeriod = typeof taxPeriodsTable.$inferInsert;

// ─── tax_export_batches ──────────────────────────────────────────────────────

export const taxExportBatchesTable = pgTable("tax_export_batches", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull(),
  taxPeriod: text("tax_period").notNull(),
  taxType: text("tax_type").notNull(),
  exportType: text("export_type").notNull().default("CSV"),
  status: text("status").notNull().default("pending"),
  fileName: text("file_name"),
  rowCount: integer("row_count").notNull().default(0),
  totalDpp: numeric("total_dpp", { precision: 18, scale: 2 }).notNull().default("0"),
  totalTax: numeric("total_tax", { precision: 18, scale: 2 }).notNull().default("0"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  companyPeriodIdx: index("tax_export_batches_company_period_idx").on(t.companyId, t.taxPeriod),
}));

export type TaxExportBatch = typeof taxExportBatchesTable.$inferSelect;
export type InsertTaxExportBatch = typeof taxExportBatchesTable.$inferInsert;

// ─── tax_export_rows ─────────────────────────────────────────────────────────

export const taxExportRowsTable = pgTable("tax_export_rows", {
  id: serial("id").primaryKey(),
  batchId: integer("batch_id")
    .notNull()
    .references(() => taxExportBatchesTable.id, { onDelete: "cascade" }),
  transactionTaxId: integer("transaction_tax_id")
    .references(() => transactionTaxesTable.id, { onDelete: "set null" }),
  rowNumber: integer("row_number").notNull(),
  rowData: jsonb("row_data").notNull(),
  validationErrors: jsonb("validation_errors").notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  batchIdx: index("tax_export_rows_batch_idx").on(t.batchId),
}));

export type TaxExportRow = typeof taxExportRowsTable.$inferSelect;

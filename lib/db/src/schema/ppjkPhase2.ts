/**
 * PPJK Phase 2 — Enterprise Customs Management
 * New tables: ppjk_status_logs, ppjk_document_checklist
 */
import {
  pgTable, serial, integer, text, timestamp, index, boolean,
} from "drizzle-orm/pg-core";
import { ppjkOrdersTable } from "./ppjkOrders";

// ── Phase 4: Status audit log ─────────────────────────────────────────────────
export const ppjkStatusLogsTable = pgTable("ppjk_status_logs", {
  id: serial("id").primaryKey(),
  ppjkOrderId: integer("ppjk_order_id")
    .notNull()
    .references(() => ppjkOrdersTable.id, { onDelete: "cascade" }),
  oldStatus: text("old_status"),
  newStatus: text("new_status").notNull(),
  changedBy: text("changed_by").notNull(),
  changedById: text("changed_by_id"),
  changedAt: timestamp("changed_at").defaultNow().notNull(),
  notes: text("notes"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
}, (t) => ({
  orderIdx: index("ppjk_sl_order_idx").on(t.ppjkOrderId),
  changedAtIdx: index("ppjk_sl_changed_at_idx").on(t.changedAt),
}));

export type PpjkStatusLog = typeof ppjkStatusLogsTable.$inferSelect;
export type InsertPpjkStatusLog = typeof ppjkStatusLogsTable.$inferInsert;

// ── Phase 5: Document checklist ───────────────────────────────────────────────
export const PPJK_DOC_TYPES = [
  "invoice",
  "packing_list",
  "bl",
  "awb",
  "coo",
  "insurance",
  "pib",
  "peb",
  "ska",
  "ls",
  "msds",
  "photo_cargo",
] as const;

export type PpjkDocType = typeof PPJK_DOC_TYPES[number];

export const PPJK_DOC_LABELS: Record<PpjkDocType, string> = {
  invoice: "Commercial Invoice",
  packing_list: "Packing List",
  bl: "Bill of Lading (BL)",
  awb: "Air Waybill (AWB)",
  coo: "Certificate of Origin (COO)",
  insurance: "Insurance Certificate",
  pib: "PIB (Pemberitahuan Impor Barang)",
  peb: "PEB (Pemberitahuan Ekspor Barang)",
  ska: "SKA (Surat Keterangan Asal)",
  ls: "Laporan Surveyor (LS)",
  msds: "Material Safety Data Sheet (MSDS)",
  photo_cargo: "Foto Kargo",
};

export const ppjkDocumentChecklistTable = pgTable("ppjk_document_checklist", {
  id: serial("id").primaryKey(),
  ppjkOrderId: integer("ppjk_order_id")
    .notNull()
    .references(() => ppjkOrdersTable.id, { onDelete: "cascade" }),
  docType: text("doc_type").notNull(),
  docLabel: text("doc_label").notNull(),
  status: text("status").notNull().default("pending"),
  // pending | uploaded | verified | rejected
  isRequired: boolean("is_required").notNull().default(false),
  fileUrl: text("file_url"),
  fileName: text("file_name"),
  rejectionReason: text("rejection_reason"),
  verifiedBy: text("verified_by"),
  verifiedAt: timestamp("verified_at"),
  uploadedBy: text("uploaded_by"),
  uploadedAt: timestamp("uploaded_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("ppjk_dc_order_idx").on(t.ppjkOrderId),
  typeIdx: index("ppjk_dc_type_idx").on(t.ppjkOrderId, t.docType),
}));

export type PpjkDocumentChecklist = typeof ppjkDocumentChecklistTable.$inferSelect;
export type InsertPpjkDocumentChecklist = typeof ppjkDocumentChecklistTable.$inferInsert;

import {
  pgTable, serial, integer, text, numeric, timestamp, index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { suppliersTable } from "./suppliers";
import { logisticOrdersTable } from "./logisticOrders";

export const ppjkOrdersTable = pgTable("ppjk_orders", {
  id: serial("id").primaryKey(),
  orderNumber: text("order_number").notNull().unique(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "set null" }),

  // ── Link ke portal order customer (logistic_orders)
  portalOrderId: integer("portal_order_id").references(() => logisticOrdersTable.id, { onDelete: "set null" }),

  // ── Customer
  customerName: text("customer_name").notNull(),
  customerEmail: text("customer_email"),
  customerPhone: text("customer_phone"),
  customerCompany: text("customer_company"),
  customerNpwp: text("customer_npwp"),

  // ── Cargo & Customs
  tradeType: text("trade_type").notNull().default("import"),
  commodity: text("commodity"),
  hsCode: text("hs_code"),
  origin: text("origin"),
  destination: text("destination"),
  grossWeight: numeric("gross_weight", { precision: 12, scale: 3 }),
  cbm: numeric("cbm", { precision: 12, scale: 3 }),
  packingType: text("packing_type"),
  koli: integer("koli"),
  portOfEntry: text("port_of_entry"),
  kantorPabean: text("kantor_pabean"),

  // ── Service type
  jenisPelayanan: text("jenis_pelayanan"),

  // ── Status
  status: text("status").notNull().default("draft"),
  customsStatus: text("customs_status"),

  // ── Key document numbers (denormalized for quick access)
  nomorAju: text("nomor_aju"),
  nomorPib: text("nomor_pib"),
  nomorPeb: text("nomor_peb"),
  nomorSppb: text("nomor_sppb"),
  tanggalAju: text("tanggal_aju"),

  // ── Financial (pabean)
  nilaiPabean: numeric("nilai_pabean", { precision: 14, scale: 2 }),
  beaMasuk: numeric("bea_masuk", { precision: 14, scale: 2 }),
  ppnImpor: numeric("ppn_impor", { precision: 14, scale: 2 }),
  pphImpor: numeric("pph_impor", { precision: 14, scale: 2 }),
  totalTagihanPabean: numeric("total_tagihan_pabean", { precision: 14, scale: 2 }),

  // ── Service fee (PPJK charge to customer)
  serviceFee: numeric("service_fee", { precision: 14, scale: 2 }),
  ppnServiceFee: numeric("ppn_service_fee", { precision: 14, scale: 2 }),
  totalServiceFee: numeric("total_service_fee", { precision: 14, scale: 2 }),

  // ── Vendor (who handles clearance)
  vendorId: integer("vendor_id").references(() => suppliersTable.id, { onDelete: "set null" }),
  vendorName: text("vendor_name"),

  // ── Phase 2: Workflow engine flag
  workflowValidated: text("workflow_validated").default("no"), // "yes" | "no"

  // ── Phase 7: SLA monitoring
  slaDeadline: timestamp("sla_deadline"),
  isOverdue: text("is_overdue").default("no"), // "yes" | "no"
  statusEnteredAt: timestamp("status_entered_at").defaultNow(),

  // ── Phase 8: Assignment
  assignedOfficerName: text("assigned_officer_name"),
  assignedOfficerId: text("assigned_officer_id"),
  assignedTeam: text("assigned_team"),
  assignedSupervisor: text("assigned_supervisor"),
  assignedAt: timestamp("assigned_at"),

  // ── Phase 9: Extended financial breakdown
  bmtp: text("bmtp"),           // Bea Masuk Tindakan Pengamanan
  bmad: text("bmad"),           // Bea Masuk Anti Dumping
  storageFee: text("storage_fee"),
  handlingFee: text("handling_fee"),
  thc: text("thc"),             // Terminal Handling Charge
  doFee: text("do_fee"),        // Delivery Order
  forwardingFee: text("forwarding_fee"),
  truckingFee: text("trucking_fee"),
  miscFee: text("misc_fee"),

  // ── Meta
  notes: text("notes"),
  adminNotes: text("admin_notes"),
  createdById: text("created_by_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  companyIdx: index("ppjk_company_idx").on(t.companyId, t.status),
  statusIdx: index("ppjk_status_idx").on(t.status),
  tradeIdx: index("ppjk_trade_idx").on(t.tradeType),
}));

export const ppjkAuditLogsTable = pgTable("ppjk_audit_logs", {
  id: serial("id").primaryKey(),
  ppjkOrderId: integer("ppjk_order_id")
    .notNull()
    .references(() => ppjkOrdersTable.id, { onDelete: "cascade" }),
  action: text("action").notNull(),
  fromStatus: text("from_status"),
  toStatus: text("to_status"),
  field: text("field"),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  changedBy: text("changed_by").notNull(),
  changedById: text("changed_by_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  orderIdx: index("ppjk_audit_order_idx").on(t.ppjkOrderId),
}));

export type PpjkOrder = typeof ppjkOrdersTable.$inferSelect;
export type InsertPpjkOrder = typeof ppjkOrdersTable.$inferInsert;
export type PpjkAuditLog = typeof ppjkAuditLogsTable.$inferSelect;

import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  boolean,
  date,
  index,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const fleetPartnersTable = pgTable("fleet_partners", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  partnerType: text("partner_type").notNull().default("gojek"),
  contractNumber: text("contract_number"),
  contactName: text("contact_name"),
  contactPhone: text("contact_phone"),
  contactEmail: text("contact_email"),
  address: text("address"),
  commissionRate: numeric("commission_rate", { precision: 5, scale: 2 }).default("0"),
  isActive: boolean("is_active").default(true).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_partners_company_idx").on(t.companyId),
]);

export const fleetReportsTable = pgTable("fleet_reports", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  partnerId: integer("partner_id").references(() => fleetPartnersTable.id, { onDelete: "set null" }),
  filename: text("filename").notNull(),
  originalFilename: text("original_filename").notNull(),
  fileHash: text("file_hash"),
  version: integer("version").default(1).notNull(),
  reportType: text("report_type").notNull().default("gojek_driver"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  status: text("status").notNull().default("processing"),
  rowCount: integer("row_count").default(0),
  processedCount: integer("processed_count").default(0),
  errorCount: integer("error_count").default(0),
  errorDetails: jsonb("error_details"),
  uploadedBy: text("uploaded_by"),
  uploadedByEmail: text("uploaded_by_email"),
  columnMapping: jsonb("column_mapping"),
  summaryStats: jsonb("summary_stats"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_reports_company_idx").on(t.companyId),
  index("fleet_reports_status_idx").on(t.status),
  index("fleet_reports_period_idx").on(t.periodStart, t.periodEnd),
]);

export const fleetDriversTable = pgTable("fleet_drivers", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  partnerId: integer("partner_id").references(() => fleetPartnersTable.id, { onDelete: "set null" }),
  driverExternalId: text("driver_external_id"),
  name: text("name").notNull(),
  phone: text("phone"),
  email: text("email"),
  licenseNumber: text("license_number"),
  vehiclePlate: text("vehicle_plate"),
  vehicleType: text("vehicle_type"),
  joinDate: date("join_date"),
  status: text("status").notNull().default("active"),
  lastActiveDate: date("last_active_date"),
  totalTrips: integer("total_trips").default(0),
  totalRevenue: numeric("total_revenue", { precision: 18, scale: 2 }).default("0"),
  avgDailyTrips: numeric("avg_daily_trips", { precision: 8, scale: 2 }).default("0"),
  performanceTier: text("performance_tier").default("standard"),
  notes: text("notes"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_drivers_company_idx").on(t.companyId),
  index("fleet_drivers_partner_idx").on(t.partnerId),
  index("fleet_drivers_status_idx").on(t.status),
  index("fleet_drivers_ext_id_idx").on(t.driverExternalId),
]);

export const fleetVehiclesTable = pgTable("fleet_vehicles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  partnerId: integer("partner_id").references(() => fleetPartnersTable.id, { onDelete: "set null" }),
  driverId: integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  plate: text("plate").notNull(),
  vehicleType: text("vehicle_type").notNull().default("motor"),
  brand: text("brand"),
  model: text("model"),
  year: integer("year"),
  color: text("color"),
  status: text("status").notNull().default("active"),
  lastServiceDate: date("last_service_date"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_vehicles_company_idx").on(t.companyId),
  index("fleet_vehicles_plate_idx").on(t.plate),
]);

export const fleetTransactionsTable = pgTable("fleet_transactions", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  reportId: integer("report_id").references(() => fleetReportsTable.id, { onDelete: "set null" }),
  driverId: integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  vehicleId: integer("vehicle_id").references(() => fleetVehiclesTable.id, { onDelete: "set null" }),
  driverExternalId: text("driver_external_id"),
  driverName: text("driver_name"),
  vehiclePlate: text("vehicle_plate"),
  transactionDate: date("transaction_date").notNull(),
  tripCount: integer("trip_count").default(0),
  grossRevenue: numeric("gross_revenue", { precision: 18, scale: 2 }).default("0"),
  incentive: numeric("incentive", { precision: 18, scale: 2 }).default("0"),
  commission: numeric("commission", { precision: 18, scale: 2 }).default("0"),
  deduction: numeric("deduction", { precision: 18, scale: 2 }).default("0"),
  netRevenue: numeric("net_revenue", { precision: 18, scale: 2 }).default("0"),
  outstandingBalance: numeric("outstanding_balance", { precision: 18, scale: 2 }).default("0"),
  ppnRate: numeric("ppn_rate", { precision: 5, scale: 2 }).default("0"),
  ppnAmount: numeric("ppn_amount", { precision: 18, scale: 2 }).default("0"),
  serviceType: text("service_type").default("GoRide"),
  rawData: jsonb("raw_data"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_trx_company_idx").on(t.companyId),
  index("fleet_trx_date_idx").on(t.transactionDate),
  index("fleet_trx_driver_idx").on(t.driverId),
  index("fleet_trx_report_idx").on(t.reportId),
  index("fleet_trx_plate_idx").on(t.vehiclePlate),
]);

export const fleetDailySummaryTable = pgTable("fleet_daily_summary", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  summaryDate: date("summary_date").notNull(),
  activeDrivers: integer("active_drivers").default(0),
  totalTrips: integer("total_trips").default(0),
  grossRevenue: numeric("gross_revenue", { precision: 18, scale: 2 }).default("0"),
  totalIncentive: numeric("total_incentive", { precision: 18, scale: 2 }).default("0"),
  totalCommission: numeric("total_commission", { precision: 18, scale: 2 }).default("0"),
  totalDeduction: numeric("total_deduction", { precision: 18, scale: 2 }).default("0"),
  netRevenue: numeric("net_revenue", { precision: 18, scale: 2 }).default("0"),
  avgRevenuePerDriver: numeric("avg_revenue_per_driver", { precision: 18, scale: 2 }).default("0"),
  avgTripsPerDriver: numeric("avg_trips_per_driver", { precision: 8, scale: 2 }).default("0"),
  topDriverId: integer("top_driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_daily_company_date_idx").on(t.companyId, t.summaryDate),
]);

export const fleetOutstandingTable = pgTable("fleet_outstanding", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  driverId: integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  driverExternalId: text("driver_external_id"),
  driverName: text("driver_name").notNull(),
  outstandingAmount: numeric("outstanding_amount", { precision: 18, scale: 2 }).default("0"),
  lastUpdatedDate: date("last_updated_date"),
  dueDays: integer("due_days").default(0),
  status: text("status").notNull().default("open"),
  notes: text("notes"),
  resolvedAt: timestamp("resolved_at"),
  isNotified: boolean("is_notified").default(false).notNull(),
  lastWaSentAt: timestamp("last_wa_sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_outstanding_company_idx").on(t.companyId),
  index("fleet_outstanding_status_idx").on(t.status),
  index("fleet_outstanding_driver_idx").on(t.driverId),
]);

export const fleetAlertsTable = pgTable("fleet_alerts", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  severity: text("severity").notNull().default("info"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  referenceType: text("reference_type"),
  referenceId: text("reference_id"),
  driverId: integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  isRead: boolean("is_read").default(false).notNull(),
  isNotified: boolean("is_notified").default(false).notNull(),
  notifiedAt: timestamp("notified_at"),
  notifiedTo: text("notified_to"),
  autoResolvedAt: timestamp("auto_resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_alerts_company_idx").on(t.companyId),
  index("fleet_alerts_type_idx").on(t.alertType),
  index("fleet_alerts_read_idx").on(t.isRead),
]);

export const fleetAccountingJournalsTable = pgTable("fleet_accounting_journals", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  reportId: integer("report_id").references(() => fleetReportsTable.id, { onDelete: "set null" }),
  journalDate: date("journal_date").notNull(),
  referenceNo: text("reference_no"),
  status: text("status").notNull().default("draft"),
  journalType: text("journal_type").notNull().default("fleet_revenue"),
  revenueAccount: text("revenue_account").default("Fleet Revenue"),
  grossRevenue: numeric("gross_revenue", { precision: 18, scale: 2 }).default("0"),
  arAccount: text("ar_account").default("Accounts Receivable"),
  outstandingAmount: numeric("outstanding_amount", { precision: 18, scale: 2 }).default("0"),
  costAccount: text("cost_account").default("Cost of Service - Fleet"),
  driverPayout: numeric("driver_payout", { precision: 18, scale: 2 }).default("0"),
  ppnAccount: text("ppn_account").default("PPN Keluaran"),
  ppnAmount: numeric("ppn_amount", { precision: 18, scale: 2 }).default("0"),
  ppnRate: numeric("ppn_rate", { precision: 5, scale: 2 }).default("11"),
  netRevenue: numeric("net_revenue", { precision: 18, scale: 2 }).default("0"),
  commissionTotal: numeric("commission_total", { precision: 18, scale: 2 }).default("0"),
  incentiveTotal: numeric("incentive_total", { precision: 18, scale: 2 }).default("0"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  createdBy: text("created_by"),
  approvedBy: text("approved_by"),
  approvedAt: timestamp("approved_at"),
  postedBy: text("posted_by"),
  postedAt: timestamp("posted_at"),
  notes: text("notes"),
  rawStats: jsonb("raw_stats"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_acc_journals_company_idx").on(t.companyId),
  index("fleet_acc_journals_status_idx").on(t.status),
  index("fleet_acc_journals_date_idx").on(t.journalDate),
]);

export const fleetAlertSuppressionTable = pgTable("fleet_alert_suppression", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  referenceId: text("reference_id").notNull(),
  suppressedUntil: timestamp("suppressed_until").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  uniqueIndex("fleet_alert_sup_unique").on(t.companyId, t.alertType, t.referenceId),
]);

export const fleetWaLogsTable = pgTable("fleet_wa_logs", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }),
  outstandingId: integer("outstanding_id").references(() => fleetOutstandingTable.id, { onDelete: "set null" }),
  driverName: text("driver_name"),
  driverPhone: text("driver_phone"),
  vehiclePlate: text("vehicle_plate"),
  outstandingAmount: numeric("outstanding_amount", { precision: 18, scale: 2 }),
  message: text("message"),
  sentBy: text("sent_by").notNull().default("system"),
  sendType: text("send_type").notNull().default("manual"),
  status: text("status").notNull().default("sent"),
  sentAt: timestamp("sent_at").defaultNow().notNull(),
}, (t) => [
  index("fleet_wa_logs_company_idx").on(t.companyId, t.sentAt),
  index("fleet_wa_logs_outstanding_idx").on(t.outstandingId),
]);

export type FleetPartner = typeof fleetPartnersTable.$inferSelect;
export type FleetReport = typeof fleetReportsTable.$inferSelect;
export type FleetDriver = typeof fleetDriversTable.$inferSelect;
export type FleetVehicle = typeof fleetVehiclesTable.$inferSelect;
export type FleetTransaction = typeof fleetTransactionsTable.$inferSelect;
export type FleetDailySummary = typeof fleetDailySummaryTable.$inferSelect;
export type FleetOutstanding = typeof fleetOutstandingTable.$inferSelect;
export type FleetAlert = typeof fleetAlertsTable.$inferSelect;
export type FleetAccountingJournal = typeof fleetAccountingJournalsTable.$inferSelect;
export type FleetAlertSuppression = typeof fleetAlertSuppressionTable.$inferSelect;
export const fleetCashPaymentsTable = pgTable("fleet_cash_payments", {
  id:               serial("id").primaryKey(),
  companyId:        integer("company_id").references(() => companiesTable.id, { onDelete: "cascade" }).notNull(),
  outstandingId:    integer("outstanding_id").references(() => fleetOutstandingTable.id, { onDelete: "set null" }),
  driverId:         integer("driver_id").references(() => fleetDriversTable.id, { onDelete: "set null" }),
  driverName:       text("driver_name").notNull(),
  driverExternalId: text("driver_external_id"),
  driverPhone:      text("driver_phone"),
  vehiclePlate:     text("vehicle_plate"),
  paymentDate:      date("payment_date").notNull().defaultNow(),
  amount:           numeric("amount", { precision: 18, scale: 4 }).notNull(),
  paymentMethod:    text("payment_method").notNull().default("cash"),
  referenceNo:      text("reference_no"),
  notes:            text("notes"),
  recordedBy:       text("recorded_by"),
  status:           text("status").notNull().default("confirmed"),
  createdAt:        timestamp("created_at").defaultNow().notNull(),
  updatedAt:        timestamp("updated_at").defaultNow().notNull(),
}, (t) => [
  index("fcp_company_idx").on(t.companyId),
  index("fcp_driver_idx").on(t.driverId),
  index("fcp_outstanding_idx").on(t.outstandingId),
  index("fcp_date_idx").on(t.paymentDate),
  index("fcp_ext_id_idx").on(t.driverExternalId),
]);

export type FleetCashPayment = typeof fleetCashPaymentsTable.$inferSelect;
export type FleetWaLog = typeof fleetWaLogsTable.$inferSelect;

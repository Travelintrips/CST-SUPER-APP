// ============================================================
// Drizzle ORM — Schema definitions untuk semua tabel baru
// Tanggal: 2026-07-07
//
// Cara pakai:
//   1. Salin definisi tabel yang relevan ke lib/db/src/schema/
//   2. Sesuaikan import path
//   3. Jalankan: tsc -b . di root workspace
// ============================================================
import {
  pgTable, pgSchema,
  text, integer, bigint, boolean, jsonb, json,
  uuid, numeric, doublePrecision, timestamp, serial, date,
} from "drizzle-orm/pg-core";

// ── AI Intelligence ──────────────────────────────────────────

export const accuracySnapshots = pgTable("accuracy_snapshots", {
  id:                    serial("id").primaryKey(),
  company_id:            text("company_id").notNull().default("default"),
  snapshot_at:           timestamp("snapshot_at", { withTimezone: true }).defaultNow().notNull(),
  period_start:          timestamp("period_start", { withTimezone: true }).notNull(),
  period_end:            timestamp("period_end", { withTimezone: true }).notNull(),
  prompt_version_id:     integer("prompt_version_id"),
  intent_accuracy:       numeric("intent_accuracy", { precision: 5, scale: 2 }),
  routing_accuracy:      numeric("routing_accuracy", { precision: 5, scale: 2 }),
  priority_accuracy:     numeric("priority_accuracy", { precision: 5, scale: 2 }),
  sla_accuracy:          numeric("sla_accuracy", { precision: 5, scale: 2 }),
  approval_accuracy:     numeric("approval_accuracy", { precision: 5, scale: 2 }),
  fallback_rate:         numeric("fallback_rate", { precision: 5, scale: 2 }),
  low_confidence_rate:   numeric("low_confidence_rate", { precision: 5, scale: 2 }),
  correction_rate:       numeric("correction_rate", { precision: 5, scale: 2 }),
  total_tasks_processed: integer("total_tasks_processed").default(0),
  total_corrections:     integer("total_corrections").default(0),
  intent_breakdown:      jsonb("intent_breakdown"),
  created_at:            timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const aiExperiments = pgTable("ai_experiments", {
  id:                     serial("id").primaryKey(),
  company_id:             text("company_id").notNull().default("default"),
  name:                   text("name").notNull(),
  description:            text("description"),
  control_version_id:     integer("control_version_id").notNull(),
  challenger_version_id:  integer("challenger_version_id").notNull(),
  challenger_traffic_pct: integer("challenger_traffic_pct").default(20),
  primary_metric:         text("primary_metric").default("intent_accuracy"),
  min_sample_size:        integer("min_sample_size").default(100),
  status:                 text("status").default("draft"),
  conclusion:             text("conclusion"),
  conclusion_notes:       text("conclusion_notes"),
  created_by:             text("created_by").notNull(),
  concluded_by:           text("concluded_by"),
  started_at:             timestamp("started_at", { withTimezone: true }),
  ended_at:               timestamp("ended_at", { withTimezone: true }),
  created_at:             timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:             timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const correctionQueue = pgTable("correction_queue", {
  id:                  serial("id").primaryKey(),
  company_id:          text("company_id").notNull().default("default"),
  task_id:             integer("task_id").notNull(),
  corrected_by:        text("corrected_by").notNull(),
  session_id:          integer("session_id"),
  field_corrected:     text("field_corrected").notNull(),
  original_value:      text("original_value").notNull(),
  original_confidence: numeric("original_confidence"),
  corrected_value:     text("corrected_value").notNull(),
  correction_reason:   text("correction_reason"),
  task_snapshot:       jsonb("task_snapshot"),
  status:              text("status").default("pending"),
  created_at:          timestamp("created_at", { withTimezone: true }).defaultNow(),
  exported_at:         timestamp("exported_at", { withTimezone: true }),
});

export const correctionSessions = pgTable("correction_sessions", {
  id:               serial("id").primaryKey(),
  company_id:       text("company_id").notNull().default("default"),
  task_id:          integer("task_id").notNull(),
  reviewed_by:      text("reviewed_by").notNull(),
  started_at:       timestamp("started_at", { withTimezone: true }).defaultNow(),
  completed_at:     timestamp("completed_at", { withTimezone: true }),
  corrections_made: integer("corrections_made").default(0),
  notes:            text("notes"),
});

export const datasetExports = pgTable("dataset_exports", {
  id:            serial("id").primaryKey(),
  company_id:    text("company_id").notNull().default("default"),
  exported_by:   text("exported_by").notNull(),
  format:        text("format").default("jsonl"),
  row_count:     integer("row_count").default(0),
  file_path:     text("file_path"),
  status:        text("status").default("pending"),
  created_at:    timestamp("created_at", { withTimezone: true }).defaultNow(),
  completed_at:  timestamp("completed_at", { withTimezone: true }),
  error_message: text("error_message"),
  filters:       jsonb("filters"),
});

export const escalationLogs = pgTable("escalation_logs", {
  id:           serial("id").primaryKey(),
  company_id:   text("company_id").notNull().default("default"),
  task_id:      integer("task_id").notNull(),
  escalated_by: text("escalated_by"),
  reason:       text("reason"),
  from_agent:   text("from_agent"),
  to_agent:     text("to_agent"),
  resolved_at:  timestamp("resolved_at", { withTimezone: true }),
  created_at:   timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const experimentObservations = pgTable("experiment_observations", {
  id:                    serial("id").primaryKey(),
  experiment_id:         integer("experiment_id").notNull(),
  task_id:               integer("task_id").notNull(),
  group_tag:             text("group_tag").notNull(),
  prompt_version_id:     integer("prompt_version_id").notNull(),
  predicted_intent:      text("predicted_intent"),
  predicted_routing:     text("predicted_routing"),
  predicted_confidence:  numeric("predicted_confidence"),
  predicted_approval:    text("predicted_approval"),
  intent_correct:        boolean("intent_correct"),
  routing_correct:       boolean("routing_correct"),
  approval_correct:      boolean("approval_correct"),
  was_corrected:         boolean("was_corrected").default(false),
  correction_id:         integer("correction_id"),
  observed_at:           timestamp("observed_at", { withTimezone: true }).defaultNow(),
  outcome_determined_at: timestamp("outcome_determined_at", { withTimezone: true }),
});

export const experimentResults = pgTable("experiment_results", {
  id:               serial("id").primaryKey(),
  experiment_id:    integer("experiment_id").notNull(),
  group_tag:        text("group_tag").notNull(),
  sample_size:      integer("sample_size").default(0),
  intent_accuracy:  numeric("intent_accuracy", { precision: 5, scale: 2 }),
  routing_accuracy: numeric("routing_accuracy", { precision: 5, scale: 2 }),
  approval_accuracy:numeric("approval_accuracy", { precision: 5, scale: 2 }),
  correction_rate:  numeric("correction_rate", { precision: 5, scale: 2 }),
  fallback_rate:    numeric("fallback_rate", { precision: 5, scale: 2 }),
  avg_confidence:   numeric("avg_confidence", { precision: 5, scale: 2 }),
  computed_at:      timestamp("computed_at", { withTimezone: true }).defaultNow(),
});

export const performanceByIntent = pgTable("performance_by_intent", {
  id:                  serial("id").primaryKey(),
  company_id:          text("company_id").notNull().default("default"),
  intent:              text("intent").notNull(),
  prompt_version_id:   integer("prompt_version_id"),
  period_start:        timestamp("period_start", { withTimezone: true }).notNull(),
  period_end:          timestamp("period_end", { withTimezone: true }).notNull(),
  total_predictions:   integer("total_predictions").default(0),
  correct_predictions: integer("correct_predictions").default(0),
  accuracy_rate:       numeric("accuracy_rate", { precision: 5, scale: 2 }),
  avg_confidence:      numeric("avg_confidence", { precision: 5, scale: 2 }),
  created_at:          timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const performanceDaily = pgTable("performance_daily", {
  id:                   serial("id").primaryKey(),
  company_id:           text("company_id").notNull().default("default"),
  date:                 date("date").notNull(),
  prompt_version_id:    integer("prompt_version_id"),
  total_predictions:    integer("total_predictions").default(0),
  intent_accuracy:      numeric("intent_accuracy", { precision: 5, scale: 2 }),
  routing_accuracy:     numeric("routing_accuracy", { precision: 5, scale: 2 }),
  approval_accuracy:    numeric("approval_accuracy", { precision: 5, scale: 2 }),
  correction_rate:      numeric("correction_rate", { precision: 5, scale: 2 }),
  fallback_rate:        numeric("fallback_rate", { precision: 5, scale: 2 }),
  low_confidence_rate:  numeric("low_confidence_rate", { precision: 5, scale: 2 }),
  total_corrections:    integer("total_corrections").default(0),
  total_fallbacks:      integer("total_fallbacks").default(0),
  total_low_confidence: integer("total_low_confidence").default(0),
  avg_confidence:       numeric("avg_confidence", { precision: 5, scale: 2 }),
  avg_llm_latency_ms:   numeric("avg_llm_latency_ms"),
  p95_llm_latency_ms:   numeric("p95_llm_latency_ms"),
  created_at:           timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const promptTestResults = pgTable("prompt_test_results", {
  id:                serial("id").primaryKey(),
  prompt_version_id: integer("prompt_version_id").notNull(),
  test_case_id:      integer("test_case_id"),
  company_id:        text("company_id").default("default"),
  input_text:        text("input_text").notNull(),
  expected_intent:   text("expected_intent"),
  predicted_intent:  text("predicted_intent"),
  expected_routing:  text("expected_routing"),
  predicted_routing: text("predicted_routing"),
  confidence:        numeric("confidence"),
  passed:            boolean("passed"),
  error_message:     text("error_message"),
  latency_ms:        integer("latency_ms"),
  created_at:        timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const routingRules = pgTable("routing_rules", {
  id:          serial("id").primaryKey(),
  company_id:  text("company_id").notNull().default("default"),
  intent:      text("intent").notNull(),
  conditions:  jsonb("conditions"),
  target_team: text("target_team").notNull(),
  priority:    integer("priority").default(0),
  is_active:   boolean("is_active").default(true),
  created_by:  text("created_by"),
  created_at:  timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:  timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const slaMatrix = pgTable("sla_matrix", {
  id:         serial("id").primaryKey(),
  company_id: text("company_id").notNull().default("default"),
  intent:     text("intent").notNull(),
  priority:   text("priority").notNull(),
  sla_hours:  numeric("sla_hours").notNull(),
  is_active:  boolean("is_active").default(true),
  created_at: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const trainingDataset = pgTable("training_dataset", {
  id:                   serial("id").primaryKey(),
  company_id:           text("company_id").notNull().default("default"),
  source_task_id:       integer("source_task_id"),
  correction_id:        integer("correction_id"),
  original_message:     text("original_message").notNull(),
  field_corrected:      text("field_corrected").notNull(),
  predicted_intent:     text("predicted_intent"),
  predicted_routing:    text("predicted_routing"),
  predicted_priority:   text("predicted_priority"),
  predicted_sla_hours:  numeric("predicted_sla_hours"),
  predicted_approval:   text("predicted_approval"),
  predicted_confidence: numeric("predicted_confidence"),
  correct_value:        text("correct_value").notNull(),
  prompt_version_id:    integer("prompt_version_id"),
  split_tag:            text("split_tag").default("train"),
  is_active:            boolean("is_active").default(true),
  corrected_by:         text("corrected_by"),
  corrected_at:         timestamp("corrected_at", { withTimezone: true }).defaultNow(),
  created_at:           timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Sport Center — Tabel Baru ─────────────────────────────────
const sportCenterSchema = pgSchema("sport_center");

export const sportCompanyInvoiceSettings = sportCenterSchema.table("company_invoice_settings", {
  id:                serial("id").primaryKey(),
  company_name:      text("company_name"),
  address:           text("address"),
  phone:             text("phone"),
  email:             text("email"),
  logo_url:          text("logo_url"),
  invoice_prefix:    text("invoice_prefix").default("INV"),
  tax_rate:          numeric("tax_rate", { precision: 5, scale: 2 }).default("11"),
  bank_name:         text("bank_name"),
  bank_account:      text("bank_account"),
  bank_account_name: text("bank_account_name"),
  finance_name:      text("finance_name"),
  finance_title:     text("finance_title"),
  signature_url:     text("signature_url"),
  footer_text:       text("footer_text"),
  kop_surat_html:    text("kop_surat_html"),
  is_active:         boolean("is_active").default(true),
  created_at:        timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:        timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sportGymMemberships = sportCenterSchema.table("gym_memberships", {
  id:          serial("id").primaryKey(),
  customer_id: integer("customer_id").notNull(),
  plan_name:   text("plan_name").notNull(),
  start_date:  date("start_date").notNull(),
  end_date:    date("end_date").notNull(),
  status:      text("status").default("active"),
  price:       numeric("price", { precision: 12, scale: 2 }),
  notes:       text("notes"),
  created_at:  timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:  timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const sportSettings = sportCenterSchema.table("settings", {
  id:                serial("id").primaryKey(),
  center_name:       text("center_name"),
  address:           text("address"),
  phone:             text("phone"),
  email:             text("email"),
  whatsapp:          text("whatsapp"),
  open_hour:         text("open_hour").default("06:00"),
  close_hour:        text("close_hour").default("22:00"),
  bank_name:         text("bank_name"),
  bank_account:      text("bank_account"),
  bank_account_name: text("bank_account_name"),
  logo_url:          text("logo_url"),
  qris_image_url:    text("qris_image_url"),
  app_url:           text("app_url"),
  payment_domain:    text("payment_domain"),
  fonnte_token:      text("fonnte_token"),
  fonnte_admin_wa:   text("fonnte_admin_wa"),
  admin_wa_phones:   text("admin_wa_phones"),
  created_at:        timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:        timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

// ── HR Kasbon ─────────────────────────────────────────────────

export const hrKasbon = pgTable("hr_kasbon", {
  id:          serial("id").primaryKey(),
  company_id:  integer("company_id"),
  employee_id: integer("employee_id").notNull(),
  amount:      numeric("amount", { precision: 15, scale: 2 }).notNull(),
  purpose:     text("purpose"),
  status:      text("status").default("pending"),
  approved_by: integer("approved_by"),
  approved_at: timestamp("approved_at", { withTimezone: true }),
  disbursed_at:timestamp("disbursed_at", { withTimezone: true }),
  notes:       text("notes"),
  created_at:  timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:  timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const hrKasbonInstallments = pgTable("hr_kasbon_installments", {
  id:          serial("id").primaryKey(),
  kasbon_id:   integer("kasbon_id").notNull(),
  due_date:    date("due_date").notNull(),
  amount:      numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paid_amount: numeric("paid_amount", { precision: 15, scale: 2 }).default("0"),
  status:      text("status").default("unpaid"),
  paid_at:     timestamp("paid_at", { withTimezone: true }),
  notes:       text("notes"),
  created_at:  timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const employeeAdvances = pgTable("employee_advances", {
  id:              serial("id").primaryKey(),
  employee_id:     integer("employee_id").notNull(),
  company_id:      integer("company_id"),
  advance_number:  text("advance_number"),
  amount:          numeric("amount", { precision: 15, scale: 2 }).notNull(),
  purpose:         text("purpose"),
  status:          text("status").default("draft"),
  approved_by:     integer("approved_by"),
  approved_at:     timestamp("approved_at", { withTimezone: true }),
  disbursed_at:    timestamp("disbursed_at", { withTimezone: true }),
  fully_repaid_at: timestamp("fully_repaid_at", { withTimezone: true }),
  balance:         numeric("balance", { precision: 15, scale: 2 }).default("0"),
  notes:           text("notes"),
  created_at:      timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:      timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const cashAdvanceInstallments = pgTable("cash_advance_installments", {
  id:            serial("id").primaryKey(),
  advance_id:    integer("advance_id").notNull(),
  due_date:      date("due_date").notNull(),
  amount:        numeric("amount", { precision: 15, scale: 2 }).notNull(),
  paid_amount:   numeric("paid_amount", { precision: 15, scale: 2 }).default("0"),
  status:        text("status").default("unpaid"),
  paid_at:       timestamp("paid_at", { withTimezone: true }),
  payroll_run_id:integer("payroll_run_id"),
  notes:         text("notes"),
  created_at:    timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── Sales Delivery ────────────────────────────────────────────

export const salesDeliveries = pgTable("sales_deliveries", {
  id:               serial("id").primaryKey(),
  company_id:       integer("company_id"),
  sales_order_id:   integer("sales_order_id"),
  delivery_number:  text("delivery_number"),
  status:           text("status").default("pending"),
  scheduled_date:   date("scheduled_date"),
  delivered_at:     timestamp("delivered_at", { withTimezone: true }),
  driver_id:        integer("driver_id"),
  vehicle_plate:    text("vehicle_plate"),
  recipient_name:   text("recipient_name"),
  recipient_phone:  text("recipient_phone"),
  delivery_address: text("delivery_address"),
  notes:            text("notes"),
  created_at:       timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:       timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const salesDeliveryLines = pgTable("sales_delivery_lines", {
  id:           serial("id").primaryKey(),
  delivery_id:  integer("delivery_id").notNull(),
  product_id:   integer("product_id"),
  product_name: text("product_name").notNull(),
  quantity:     numeric("quantity", { precision: 12, scale: 3 }).notNull(),
  uom:          text("uom"),
  notes:        text("notes"),
  created_at:   timestamp("created_at", { withTimezone: true }).defaultNow(),
});

// ── TravelInTrips ─────────────────────────────────────────────
const travelInTripsSchema = pgSchema("travelintrips");

export const travelUsers = travelInTripsSchema.table("users", {
  id:            serial("id").primaryKey(),
  email:         text("email").notNull().unique(),
  name:          text("name"),
  phone:         text("phone"),
  password_hash: text("password_hash"),
  role:          text("role").default("customer"),
  is_active:     boolean("is_active").default(true),
  created_at:    timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:    timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const travelProducts = travelInTripsSchema.table("products", {
  id:          serial("id").primaryKey(),
  name:        text("name").notNull(),
  slug:        text("slug"),
  description: text("description"),
  price:       numeric("price", { precision: 12, scale: 2 }).notNull(),
  image_url:   text("image_url"),
  category:    text("category"),
  is_active:   boolean("is_active").default(true),
  stock:       integer("stock"),
  sort_order:  integer("sort_order").default(0),
  metadata:    jsonb("metadata"),
  created_at:  timestamp("created_at", { withTimezone: true }).defaultNow(),
  updated_at:  timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const travelOrders = travelInTripsSchema.table("orders", {
  id:                     serial("id").primaryKey(),
  customer_name:          text("customer_name"),
  customer_phone:         text("customer_phone"),
  customer_address:       text("customer_address"),
  email:                  text("email"),
  status:                 text("status").default("pending"),
  total:                  numeric("total", { precision: 12, scale: 2 }).notNull(),
  notes:                  text("notes"),
  product_id:             integer("product_id"),
  harga:                  numeric("harga", { precision: 12, scale: 2 }),
  paylabs_order_id:       text("paylabs_order_id"),
  paylabs_payment_url:    text("paylabs_payment_url"),
  paylabs_payment_type:   text("paylabs_payment_type"),
  paylabs_paid_at:        timestamp("paylabs_paid_at", { withTimezone: true }),
  paylabs_transaction_id: text("paylabs_transaction_id"),
  created_at:             timestamp("created_at", { withTimezone: true }).defaultNow(),
});

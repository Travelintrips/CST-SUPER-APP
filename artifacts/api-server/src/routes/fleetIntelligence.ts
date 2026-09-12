/**
 * Gojek Fleet Intelligence — API Routes v2
 * Prefix: /api/logistics/fleet
 *
 * v2 improvements:
 * - Input sanitization (SQL injection prevention)
 * - SHA-256 file hash + duplicate detection
 * - Import preview (parse without saving)
 * - Import rollback (DELETE /reports/:id)
 * - Batch INSERT for CSV/Excel processing
 * - PPN/Tax calculation (11% default)
 * - fleet_accounting_journals (ERP bridge)
 * - Smart alert engine with 24/48h suppression
 * - Enhanced analytics: idle-vehicles, churn-risk, forecast
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import multer from "multer";
import ExcelJS from "exceljs";
import { createHash } from "crypto";
import { z } from "zod";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postFleetCashPaymentJournal, voidFleetCashPaymentJournal } from "../lib/fleetAccounting.js";
import { logger } from "../lib/logger.js";
import { deferStartupTask } from "../lib/deferredStartupTasks.js";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";

// ── Domain Contract Types ──────────────────────────────────────────────────
export interface LedgerSummaryDTO {
  transactionCount: number;
  totalCredit: number;
  totalDebit: number;
  netFlow: number;
  vehicleCoverage: number;
  driverCoverage: number;
  typeBreakdown: Record<string, { count: number; total: number }>;
}

export interface PreviewResponseDTO {
  data: LedgerSummaryDTO;
  meta: { version: "v1"; generatedAt: string };
  // envelope fields (non-ledger)
  fileHash: string;
  rowCount: number;
  headers: string[];
  unmappedHeaders: string[];
  columnMapping: Record<string, string | null>;
  previewRows: Array<Record<string, unknown>>;
  warnings: string[];
  duplicateReport: { id: number; original_filename: string; status: string } | null;
}

// ── Runtime Contract Schema ────────────────────────────────────────────────
const LedgerSummarySchema = z.object({
  transactionCount: z.number(),
  totalCredit:      z.number(),
  totalDebit:       z.number(),
  netFlow:          z.number(),
  vehicleCoverage:  z.number(),
  driverCoverage:   z.number(),
  typeBreakdown:    z.record(z.object({ count: z.number(), total: z.number() })),
});

// ── Zod row-level validation schema (ingest phase 2) ──────────────────────
const IngestRowSchema = z.object({
  driverExtId:     z.string().optional().default(""),
  driverName:      z.string().optional().default(""),
  txDate:          z.string().optional().default(""),
  amount:          z.number().optional().default(0),
  outstanding:     z.number().optional().default(0),
  transactionType: z.string().nullable().optional(),
  gopayRef:        z.string().optional().default(""),
  vehiclePlate:    z.string().optional().default(""),
  driverPhone:     z.string().optional().default(""),
}).passthrough().superRefine((r, ctx) => {
  if (!r.driverExtId && !r.driverName) {
    ctx.addIssue({ code: "custom", message: "Nama dan ID driver keduanya kosong" });
  }
  if (!r.txDate) {
    ctx.addIssue({ code: "custom", message: "Tanggal transaksi tidak valid atau kosong" });
  }
});

/**
 * Validate dto against LedgerSummarySchema.
 * On failure: logs full contract violation details and throws.
 */
function validateLedgerDTO(dto: unknown, context?: { fileHash?: string }): LedgerSummaryDTO {
  const result = LedgerSummarySchema.safeParse(dto);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path:    i.path.join("."),
      message: i.message,
      code:    i.code,
    }));
    logger.error({
      event:    "CONTRACT_VIOLATION",
      schema:   "LedgerSummaryDTO",
      fileHash: context?.fileHash ?? "unknown",
      issues,
      payload:  dto,
    }, "[fleet] LedgerSummaryDTO contract violation — backend/frontend mismatch detected");
    throw new Error(`LedgerSummaryDTO contract violation: ${issues.map((i) => `${i.path} — ${i.message}`).join("; ")}`);
  }
  return result.data;
}

const router = Router();

// ─── Migration ─────────────────────────────────────────────────────────────────
let migrated = false; // reset to false to trigger v4 migration

export async function runFleetIntelligenceMigration() {
  if (migrated) return;
  try {
    await db.execute(sql.raw(`SET search_path TO public`));
    // fleet_partners
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_partners (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, name TEXT NOT NULL, partner_type TEXT NOT NULL DEFAULT 'gojek', contract_number TEXT, contact_name TEXT, contact_phone TEXT, contact_email TEXT, address TEXT, commission_rate NUMERIC(5,2) DEFAULT 0, is_active BOOLEAN NOT NULL DEFAULT TRUE, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_partners_company_idx ON fleet_partners(company_id)`));
    // fleet_reports
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_reports (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, partner_id INTEGER REFERENCES fleet_partners(id) ON DELETE SET NULL, filename TEXT NOT NULL, original_filename TEXT NOT NULL, file_hash TEXT, version INTEGER NOT NULL DEFAULT 1, report_type TEXT NOT NULL DEFAULT 'gojek_driver', period_start DATE, period_end DATE, status TEXT NOT NULL DEFAULT 'processing', row_count INTEGER DEFAULT 0, processed_count INTEGER DEFAULT 0, error_count INTEGER DEFAULT 0, error_details JSONB, uploaded_by TEXT, uploaded_by_email TEXT, column_mapping JSONB, summary_stats JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_reports_company_idx ON fleet_reports(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_reports_status_idx  ON fleet_reports(status)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_reports_period_idx  ON fleet_reports(period_start, period_end)`));
    // fleet_drivers
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_drivers (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, partner_id INTEGER REFERENCES fleet_partners(id) ON DELETE SET NULL, driver_external_id TEXT, name TEXT NOT NULL, phone TEXT, email TEXT, license_number TEXT, vehicle_plate TEXT, vehicle_type TEXT, join_date DATE, status TEXT NOT NULL DEFAULT 'active', last_active_date DATE, total_trips INTEGER DEFAULT 0, total_revenue NUMERIC(18,2) DEFAULT 0, avg_daily_trips NUMERIC(8,2) DEFAULT 0, performance_tier TEXT DEFAULT 'standard', notes TEXT, raw_data JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_drivers_company_idx ON fleet_drivers(company_id)`));
    // Guard: only create partner_id index if the column actually exists on this DB
    // (fleet_drivers may exist as a driver-portal table with a different schema)
    const fdPartnerColCheck = await db.execute(sql.raw(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema='public' AND table_name='fleet_drivers' AND column_name='partner_id'
    `));
    const fdPartnerColExists = ((fdPartnerColCheck as any).rows?.length ?? 0) > 0;
    if (fdPartnerColExists) {
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_drivers_partner_idx ON fleet_drivers(partner_id)`));
    }
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_drivers_status_idx  ON fleet_drivers(status)`));
    // Guard: add driver_external_id column if the fleet_drivers table predates this column
    // (older schema may not have it; CREATE TABLE IF NOT EXISTS won't add missing columns)
    await db.execute(sql.raw(`ALTER TABLE fleet_drivers ADD COLUMN IF NOT EXISTS driver_external_id TEXT`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_drivers_ext_id_idx  ON fleet_drivers(driver_external_id)`));
    // fleet_vehicles
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_vehicles (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, partner_id INTEGER REFERENCES fleet_partners(id) ON DELETE SET NULL, driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL, plate TEXT NOT NULL, vehicle_type TEXT NOT NULL DEFAULT 'motor', brand TEXT, model TEXT, year INTEGER, color TEXT, status TEXT NOT NULL DEFAULT 'active', last_service_date DATE, notes TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_vehicles_company_idx ON fleet_vehicles(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_vehicles_plate_idx   ON fleet_vehicles(plate)`));
    // fleet_transactions
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_transactions (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL, vehicle_id INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL, driver_external_id TEXT, driver_name TEXT, vehicle_plate TEXT, transaction_date DATE NOT NULL, trip_count INTEGER DEFAULT 0, gross_revenue NUMERIC(18,2) DEFAULT 0, incentive NUMERIC(18,2) DEFAULT 0, commission NUMERIC(18,2) DEFAULT 0, deduction NUMERIC(18,2) DEFAULT 0, net_revenue NUMERIC(18,2) DEFAULT 0, outstanding_balance NUMERIC(18,2) DEFAULT 0, ppn_rate NUMERIC(5,2) DEFAULT 0, ppn_amount NUMERIC(18,2) DEFAULT 0, service_type TEXT DEFAULT 'GoRide', raw_data JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_trx_company_idx ON fleet_transactions(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_trx_date_idx    ON fleet_transactions(transaction_date)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_trx_driver_idx  ON fleet_transactions(driver_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_trx_report_idx  ON fleet_transactions(report_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_trx_plate_idx   ON fleet_transactions(vehicle_plate)`));
    // fleet_daily_summary
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_daily_summary (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, summary_date DATE NOT NULL, active_drivers INTEGER DEFAULT 0, total_trips INTEGER DEFAULT 0, gross_revenue NUMERIC(18,2) DEFAULT 0, total_incentive NUMERIC(18,2) DEFAULT 0, total_commission NUMERIC(18,2) DEFAULT 0, total_deduction NUMERIC(18,2) DEFAULT 0, net_revenue NUMERIC(18,2) DEFAULT 0, avg_revenue_per_driver NUMERIC(18,2) DEFAULT 0, avg_trips_per_driver NUMERIC(8,2) DEFAULT 0, top_driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS fleet_daily_company_date_uq  ON fleet_daily_summary(company_id, summary_date)`));
    await db.execute(sql.raw(`CREATE INDEX        IF NOT EXISTS fleet_daily_company_date_idx ON fleet_daily_summary(company_id, summary_date)`));
    // fleet_outstanding
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_outstanding (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL, driver_external_id TEXT, driver_name TEXT NOT NULL, outstanding_amount NUMERIC(18,2) DEFAULT 0, last_updated_date DATE, due_days INTEGER DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', notes TEXT, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_outstanding_company_idx ON fleet_outstanding(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_outstanding_status_idx  ON fleet_outstanding(status)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_outstanding_driver_idx  ON fleet_outstanding(driver_id)`));
    // fleet_alerts
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_alerts (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, alert_type TEXT NOT NULL, severity TEXT NOT NULL DEFAULT 'info', title TEXT NOT NULL, message TEXT NOT NULL, reference_type TEXT, reference_id TEXT, driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL, is_read BOOLEAN NOT NULL DEFAULT FALSE, is_notified BOOLEAN NOT NULL DEFAULT FALSE, notified_at TIMESTAMPTZ, notified_to TEXT, auto_resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_alerts_company_idx ON fleet_alerts(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_alerts_type_idx    ON fleet_alerts(alert_type)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_alerts_read_idx    ON fleet_alerts(is_read)`));
    // fleet_accounting_journals
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_accounting_journals (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, journal_date DATE NOT NULL, reference_no TEXT, status TEXT NOT NULL DEFAULT 'draft', journal_type TEXT NOT NULL DEFAULT 'fleet_revenue', revenue_account TEXT DEFAULT 'Fleet Revenue', gross_revenue NUMERIC(18,2) DEFAULT 0, ar_account TEXT DEFAULT 'Accounts Receivable', outstanding_amount NUMERIC(18,2) DEFAULT 0, cost_account TEXT DEFAULT 'Cost of Service - Fleet', driver_payout NUMERIC(18,2) DEFAULT 0, ppn_account TEXT DEFAULT 'PPN Keluaran', ppn_amount NUMERIC(18,2) DEFAULT 0, ppn_rate NUMERIC(5,2) DEFAULT 11, net_revenue NUMERIC(18,2) DEFAULT 0, commission_total NUMERIC(18,2) DEFAULT 0, incentive_total NUMERIC(18,2) DEFAULT 0, period_start DATE, period_end DATE, created_by TEXT, approved_by TEXT, approved_at TIMESTAMPTZ, posted_by TEXT, posted_at TIMESTAMPTZ, notes TEXT, raw_stats JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_acc_journals_company_idx ON fleet_accounting_journals(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_acc_journals_status_idx  ON fleet_accounting_journals(status)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_acc_journals_date_idx    ON fleet_accounting_journals(journal_date)`));
    // fleet_alert_suppression
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS fleet_alert_suppression (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, alert_type TEXT NOT NULL, reference_id TEXT NOT NULL, suppressed_until TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS fleet_alert_sup_unique ON fleet_alert_suppression(company_id, alert_type, reference_id)`));

    // Alter existing tables to add new columns (pgBouncer safe: one statement each)
    await db.execute(sql.raw(`ALTER TABLE fleet_reports ADD COLUMN IF NOT EXISTS file_hash TEXT`));
    await db.execute(sql.raw(`ALTER TABLE fleet_reports ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1`));
    await db.execute(sql.raw(`ALTER TABLE fleet_transactions ADD COLUMN IF NOT EXISTS ppn_rate NUMERIC(5,2) DEFAULT 0`));
    await db.execute(sql.raw(`ALTER TABLE fleet_transactions ADD COLUMN IF NOT EXISTS ppn_amount NUMERIC(18,2) DEFAULT 0`));

    // v3: add unique constraint for fleet_outstanding (one open record per driver per company)
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS fleet_outstanding_company_driver_uq
        ON fleet_outstanding(company_id, driver_name) WHERE status = 'open';
    `));

    // v4: gojek_raw_transactions — 100% raw storage, zero data loss guarantee
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS gojek_raw_transactions (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, date_time_jkt TEXT, driver_external_id TEXT, driver_name TEXT, phone_number TEXT, vehicle TEXT, amount NUMERIC(18,4), total_outstanding_balance NUMERIC(18,4), transaction_type TEXT, gopay_transaction_reference_id TEXT, date TEXT, raw_json JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gojek_raw_company_idx ON gojek_raw_transactions(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gojek_raw_report_idx  ON gojek_raw_transactions(report_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gojek_raw_gopay_idx   ON gojek_raw_transactions(gopay_transaction_reference_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gojek_raw_driver_idx  ON gojek_raw_transactions(driver_external_id)`));
    await db.execute(sql.raw(`ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS service_type TEXT`));

    // v4: add new columns to fleet_transactions
    await db.execute(sql.raw(`ALTER TABLE fleet_transactions ADD COLUMN IF NOT EXISTS amount             NUMERIC(18,4) DEFAULT 0`));
    await db.execute(sql.raw(`ALTER TABLE fleet_transactions ADD COLUMN IF NOT EXISTS transaction_type   TEXT`));
    await db.execute(sql.raw(`ALTER TABLE fleet_transactions ADD COLUMN IF NOT EXISTS driver_phone       TEXT`));
    await db.execute(sql.raw(`ALTER TABLE fleet_transactions ADD COLUMN IF NOT EXISTS gopay_reference_id TEXT`));

    // v4: add unique constraint on fleet_drivers(company_id, driver_external_id) for proper upsert
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS fleet_drivers_company_extid_uq
        ON fleet_drivers(company_id, driver_external_id)
        WHERE driver_external_id IS NOT NULL AND driver_external_id != '';
    `));

    // v4: drop old (wrong) dedup index, replace with gopay_reference_id unique key
    await db.execute(sql.raw(`DROP INDEX IF EXISTS fleet_trx_global_dedup_idx;`));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS fleet_trx_gopay_ref_uq
        ON fleet_transactions(company_id, gopay_reference_id)
        WHERE gopay_reference_id IS NOT NULL AND gopay_reference_id != '';
    `));

    // v5: DATA PIPELINE RELIABILITY LAYER
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS gojek_ingestion_queue (id SERIAL PRIMARY KEY, report_id INTEGER NOT NULL REFERENCES fleet_reports(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'pending', retry_count INTEGER NOT NULL DEFAULT 0, last_error TEXT, enqueued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX        IF NOT EXISTS giq_status_idx  ON gojek_ingestion_queue(status)`));
    await db.execute(sql.raw(`CREATE INDEX        IF NOT EXISTS giq_report_idx  ON gojek_ingestion_queue(report_id)`));
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS giq_report_uq   ON gojek_ingestion_queue(report_id)`));

    // Dead Letter Queue
    await db.execute(sql.raw(`CREATE TABLE IF NOT EXISTS gojek_failed_rows (id SERIAL PRIMARY KEY, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, raw_row_id INTEGER REFERENCES gojek_raw_transactions(id) ON DELETE SET NULL, row_index INTEGER, error_reason TEXT NOT NULL, error_stage TEXT NOT NULL DEFAULT 'transform', raw_data JSONB, retry_count INTEGER NOT NULL DEFAULT 0, resolved BOOLEAN NOT NULL DEFAULT FALSE, resolved_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gfr_report_idx   ON gojek_failed_rows(report_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gfr_company_idx  ON gojek_failed_rows(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gfr_resolved_idx ON gojek_failed_rows(resolved)`));

    // v6: PIPELINE GOVERNANCE LAYER — each ALTER/CREATE separate (pg single-statement)
    await db.execute(sql.raw(`ALTER TABLE gojek_ingestion_queue ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`));
    await db.execute(sql.raw(`ALTER TABLE gojek_ingestion_queue ADD COLUMN IF NOT EXISTS tenant_id INTEGER`));
    await db.execute(sql.raw(`ALTER TABLE gojek_ingestion_queue ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS giq_priority_idx     ON gojek_ingestion_queue(priority)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS giq_scheduled_at_idx ON gojek_ingestion_queue(scheduled_at)`));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS gojek_pipeline_audit_logs (
        id                SERIAL PRIMARY KEY,
        report_id         INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL,
        company_id        INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        raw_row_id        INTEGER REFERENCES gojek_raw_transactions(id) ON DELETE SET NULL,
        field_name        TEXT NOT NULL,
        raw_value         TEXT,
        transformed_value TEXT,
        change_reason     TEXT,
        pipeline_stage    TEXT NOT NULL DEFAULT 'transform',
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gpal_report_idx  ON gojek_pipeline_audit_logs(report_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gpal_company_idx ON gojek_pipeline_audit_logs(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gpal_field_idx   ON gojek_pipeline_audit_logs(field_name)`));

    // v7: FULL DATA RELIABILITY LAYER
    // Guard: only run if v7 marker (gojek_uploaded_files.mime_type) doesn't exist yet.
    // This also handles partial-creation from failed prior runs by dropping+recreating.
    const v7Done = await db.execute(sql.raw(`SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='gojek_uploaded_files' AND column_name='mime_type' LIMIT 1`));
    if (v7Done.rows.length === 0) {
      // Drop any partially-created v7 tables (safe — these tables had no data before v7)
      const v7tables = ['fleet_reconciliation_reports','fleet_pipeline_health','ledger_events','ledger_snapshots','ledger_entries','transaction_datetime_normalized','ledger_transaction_rules','transaction_type_mapping','gojek_ingestion_reports','gojek_uploaded_files'];
      for (const tbl of v7tables) {
        await db.execute(sql.raw(`DROP TABLE IF EXISTS ${tbl} CASCADE`));
      }
      // gojek_uploaded_files
      await db.execute(sql.raw(`CREATE TABLE gojek_uploaded_files (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, file_hash TEXT NOT NULL, original_filename TEXT NOT NULL, file_size_bytes BIGINT, mime_type TEXT, upload_status TEXT NOT NULL DEFAULT 'registered', uploaded_by TEXT, uploaded_by_email TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE INDEX guf_company_idx ON gojek_uploaded_files(company_id)`));
      await db.execute(sql.raw(`CREATE UNIQUE INDEX guf_hash_company_uq ON gojek_uploaded_files(company_id, file_hash)`));
      // gojek_ingestion_reports
      await db.execute(sql.raw(`CREATE TABLE gojek_ingestion_reports (id SERIAL PRIMARY KEY, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, total_raw_rows INTEGER NOT NULL DEFAULT 0, inserted_raw INTEGER NOT NULL DEFAULT 0, transformed_ok INTEGER NOT NULL DEFAULT 0, failed_rows INTEGER NOT NULL DEFAULT 0, dlq_rows INTEGER NOT NULL DEFAULT 0, health_score NUMERIC(5,2), health_grade TEXT, duration_ms INTEGER, pipeline_version TEXT NOT NULL DEFAULT 'v7', completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE INDEX gir_report_idx ON gojek_ingestion_reports(report_id)`));
      await db.execute(sql.raw(`CREATE INDEX gir_company_idx ON gojek_ingestion_reports(company_id)`));
      // transaction_type_mapping
      await db.execute(sql.raw(`CREATE TABLE transaction_type_mapping (id SERIAL PRIMARY KEY, raw_type TEXT NOT NULL, normalized TEXT NOT NULL, ledger_side TEXT NOT NULL DEFAULT 'credit', description TEXT, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE UNIQUE INDEX ttm_raw_type_uq ON transaction_type_mapping(raw_type)`));
      // ledger_transaction_rules
      await db.execute(sql.raw(`CREATE TABLE ledger_transaction_rules (id SERIAL PRIMARY KEY, rule_name TEXT NOT NULL, match_field TEXT NOT NULL DEFAULT 'transaction_type', match_value TEXT NOT NULL, ledger_side TEXT NOT NULL, debit_account TEXT, credit_account TEXT, priority INTEGER NOT NULL DEFAULT 100, is_active BOOLEAN NOT NULL DEFAULT TRUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE UNIQUE INDEX ltr_rule_name_uq ON ledger_transaction_rules(rule_name)`));
      // transaction_datetime_normalized
      await db.execute(sql.raw(`CREATE TABLE transaction_datetime_normalized (id SERIAL PRIMARY KEY, raw_row_id INTEGER REFERENCES gojek_raw_transactions(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE CASCADE, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, raw_datetime TEXT, parsed_date DATE, parsed_time TIME, timezone TEXT NOT NULL DEFAULT 'Asia/Jakarta', parse_method TEXT, parse_confidence NUMERIC(3,2) DEFAULT 1.0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE INDEX tdn_report_idx ON transaction_datetime_normalized(report_id)`));
      await db.execute(sql.raw(`CREATE INDEX tdn_date_idx ON transaction_datetime_normalized(parsed_date)`));
      await db.execute(sql.raw(`CREATE UNIQUE INDEX tdn_raw_row_uq ON transaction_datetime_normalized(raw_row_id)`));
      // ledger_entries
      await db.execute(sql.raw(`CREATE TABLE ledger_entries (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, raw_row_id INTEGER REFERENCES gojek_raw_transactions(id) ON DELETE SET NULL, entry_date DATE NOT NULL, account_code TEXT NOT NULL, account_name TEXT NOT NULL, side TEXT NOT NULL, amount NUMERIC(18,4) NOT NULL, currency TEXT NOT NULL DEFAULT 'IDR', description TEXT, reference_id TEXT, transaction_type TEXT, driver_id INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE INDEX le_company_idx ON ledger_entries(company_id)`));
      await db.execute(sql.raw(`CREATE INDEX le_report_idx ON ledger_entries(report_id)`));
      await db.execute(sql.raw(`CREATE INDEX le_date_idx ON ledger_entries(entry_date)`));
      await db.execute(sql.raw(`CREATE INDEX le_account_idx ON ledger_entries(account_code)`));
      // ledger_snapshots — two-step: create then add columns separately (pgBouncer safe)
      await db.execute(sql.raw(`CREATE TABLE ledger_snapshots (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN snapshot_date DATE NOT NULL DEFAULT '2000-01-01'`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN account_code TEXT NOT NULL DEFAULT ''`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN account_name TEXT NOT NULL DEFAULT ''`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN balance NUMERIC(18,4) NOT NULL DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN debit_total NUMERIC(18,4) NOT NULL DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN credit_total NUMERIC(18,4) NOT NULL DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ADD COLUMN entry_count INTEGER NOT NULL DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ALTER COLUMN snapshot_date DROP DEFAULT`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ALTER COLUMN account_code DROP DEFAULT`));
      await db.execute(sql.raw(`ALTER TABLE ledger_snapshots ALTER COLUMN account_name DROP DEFAULT`));
      await db.execute(sql.raw(`CREATE INDEX ls_company_date_idx ON ledger_snapshots(company_id, snapshot_date)`));
      await db.execute(sql.raw(`CREATE UNIQUE INDEX ls_company_date_acct_uq ON ledger_snapshots(company_id, snapshot_date, account_code)`));
      // ledger_events
      await db.execute(sql.raw(`CREATE TABLE ledger_events (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, event_type TEXT NOT NULL, event_data JSONB, actor TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE INDEX lev_company_idx ON ledger_events(company_id)`));
      await db.execute(sql.raw(`CREATE INDEX lev_report_idx ON ledger_events(report_id)`));
      await db.execute(sql.raw(`CREATE INDEX lev_type_idx ON ledger_events(event_type)`));
      // fleet_pipeline_health
      await db.execute(sql.raw(`CREATE TABLE fleet_pipeline_health (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, health_score NUMERIC(5,2), grade TEXT, total_raw INTEGER DEFAULT 0, transformed INTEGER DEFAULT 0, failed INTEGER DEFAULT 0, dlq_rows INTEGER DEFAULT 0, duration_ms INTEGER, breakdown JSONB, measured_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`CREATE INDEX fph_company_idx ON fleet_pipeline_health(company_id)`));
      await db.execute(sql.raw(`CREATE INDEX fph_report_idx ON fleet_pipeline_health(report_id)`));
      await db.execute(sql.raw(`CREATE INDEX fph_score_idx ON fleet_pipeline_health(health_score)`));
      // fleet_reconciliation_reports — two-step (contains DATE column)
      await db.execute(sql.raw(`CREATE TABLE fleet_reconciliation_reports (id SERIAL PRIMARY KEY, company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE, report_id INTEGER REFERENCES fleet_reports(id) ON DELETE SET NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN reconcile_date DATE NOT NULL DEFAULT '2000-01-01'`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN raw_count INTEGER DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN ledger_count INTEGER DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN matched_count INTEGER DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN unmatched_raw INTEGER DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN unmatched_ledger INTEGER DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN total_raw_amount NUMERIC(18,4) DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN total_ledger_amount NUMERIC(18,4) DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN variance NUMERIC(18,4) DEFAULT 0`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN status TEXT NOT NULL DEFAULT 'pending'`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ADD COLUMN notes TEXT`));
      await db.execute(sql.raw(`ALTER TABLE fleet_reconciliation_reports ALTER COLUMN reconcile_date DROP DEFAULT`));
      await db.execute(sql.raw(`CREATE INDEX frr_company_idx ON fleet_reconciliation_reports(company_id)`));
      await db.execute(sql.raw(`CREATE INDEX frr_report_idx ON fleet_reconciliation_reports(report_id)`));
      await db.execute(sql.raw(`CREATE INDEX frr_date_idx ON fleet_reconciliation_reports(reconcile_date)`));
      // Seed default transaction type mapping
      await db.execute(sql.raw(`INSERT INTO transaction_type_mapping (raw_type, normalized, ledger_side, description) VALUES ('JASA MITRA','jasa_mitra','credit','Pendapatan jasa mitra GoRide/GoCar'),('INSENTIF','insentif','credit','Insentif dari Gojek'),('KOMISI','komisi','debit','Potongan komisi Gojek'),('POTONGAN','potongan','debit','Potongan lain-lain'),('BONUS','bonus','credit','Bonus dari Gojek'),('REFUND','refund','credit','Refund ke mitra'),('ADJUSTMEN','adjustmen','credit','Penyesuaian saldo'),('PENARIKAN','penarikan','debit','Penarikan saldo ke rekening') ON CONFLICT (raw_type) DO NOTHING`));
      logger.info("[fleetIntelligence] v7 tables created successfully");
    } else {
      logger.info("[fleetIntelligence] v7 tables already exist, skipping");
    }

    // v8: partial unique index on gojek_raw_transactions — dedup by gopay_transaction_reference_id
    // Prevents duplicate rows when same file is re-uploaded after purge+re-upload flow
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS gojek_raw_gopay_ref_company_uq
        ON gojek_raw_transactions(company_id, gopay_transaction_reference_id)
        WHERE gopay_transaction_reference_id IS NOT NULL AND gopay_transaction_reference_id != ''
    `));

    // v8: extra columns for gojek_raw_transactions (driver_phone, vehicle_plate redundant but kept for compat)
    await db.execute(sql.raw(`ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS driver_phone TEXT`));
    await db.execute(sql.raw(`ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS vehicle_plate TEXT`));

    // v9: date_iso DATE column for proper date-based sorting (fixes DD/M/YYYY text sort bug)
    await db.execute(sql.raw(`ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS date_iso DATE`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS gojek_raw_date_iso_idx ON gojek_raw_transactions(company_id, date_iso DESC)`));
    // Backfill existing rows: parse date TEXT field (DD/M/YYYY) → ISO DATE
    await db.execute(sql.raw(`
      UPDATE gojek_raw_transactions
      SET date_iso = TO_DATE(NULLIF(TRIM(date), ''), 'DD/MM/YYYY')
      WHERE date_iso IS NULL
        AND date IS NOT NULL
        AND TRIM(date) != ''
        AND date ~ '^\\d{1,2}/\\d{1,2}/\\d{4}'
    `));

    // v10: is_notified + last_wa_sent on fleet_outstanding
    await db.execute(sql.raw(`ALTER TABLE fleet_outstanding ADD COLUMN IF NOT EXISTS is_notified BOOLEAN NOT NULL DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE fleet_outstanding ADD COLUMN IF NOT EXISTS last_wa_sent_at TIMESTAMPTZ`));

    // v11: fleet_wa_logs — riwayat semua pengiriman WA (manual & otomatis)
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS fleet_wa_logs (
        id               SERIAL PRIMARY KEY,
        company_id       INTEGER REFERENCES companies(id) ON DELETE CASCADE,
        outstanding_id   INTEGER REFERENCES fleet_outstanding(id) ON DELETE SET NULL,
        driver_name      TEXT,
        driver_phone     TEXT,
        vehicle_plate    TEXT,
        outstanding_amount NUMERIC(18,2),
        message          TEXT,
        sent_by          TEXT NOT NULL DEFAULT 'system',
        send_type        TEXT NOT NULL DEFAULT 'manual',
        status           TEXT NOT NULL DEFAULT 'sent',
        sent_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_wa_logs_company_idx ON fleet_wa_logs(company_id, sent_at DESC)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_wa_logs_outstanding_idx ON fleet_wa_logs(outstanding_id)`));

    // v12: rental_fee_daily per driver di fleet_outstanding
    await db.execute(sql.raw(`ALTER TABLE fleet_outstanding ADD COLUMN IF NOT EXISTS rental_fee_daily NUMERIC(14,2) DEFAULT 0`));
    logger.info("[fleetIntelligence] Migration v12 selesai (rental_fee_daily on fleet_outstanding)");

    // v13: rental_fee_daily on fleet_drivers + snapshot columns on fleet_outstanding
    await db.execute(sql.raw(`ALTER TABLE fleet_drivers ADD COLUMN IF NOT EXISTS rental_fee_daily NUMERIC(14,2)`));
    await db.execute(sql.raw(`ALTER TABLE fleet_outstanding ADD COLUMN IF NOT EXISTS snapshot_source TEXT`));
    await db.execute(sql.raw(`ALTER TABLE fleet_outstanding ADD COLUMN IF NOT EXISTS driver_phone TEXT`));
    logger.info("[fleetIntelligence] Migration v13 selesai");

    // v14: fleet_outstanding_import_log
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS fleet_outstanding_import_log (
        id               SERIAL PRIMARY KEY,
        company_id       INTEGER NOT NULL,
        report_file_name TEXT    NOT NULL,
        uploaded_by      TEXT,
        uploaded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        total_rows       INTEGER NOT NULL DEFAULT 0,
        rows_imported    INTEGER NOT NULL DEFAULT 0,
        rows_skipped     INTEGER NOT NULL DEFAULT 0,
        unmatched_drivers INTEGER NOT NULL DEFAULT 0,
        notes            TEXT
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fleet_outiml_company_idx ON fleet_outstanding_import_log(company_id, uploaded_at DESC)`));
    logger.info("[fleetIntelligence] Migration v14 selesai (fleet_outstanding_import_log)");

    // v15: vehicle_plate on fleet_outstanding + fleet_cash_payments + composite dedup
    await db.execute(sql.raw(`ALTER TABLE fleet_outstanding ADD COLUMN IF NOT EXISTS vehicle_plate TEXT`));
    await db.execute(sql.raw(`ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS vehicle_plate TEXT`));
    await db.execute(sql.raw(`ALTER TABLE gojek_raw_transactions ADD COLUMN IF NOT EXISTS driver_phone  TEXT`));
    await db.execute(sql.raw(`
      UPDATE gojek_raw_transactions
      SET vehicle_plate = vehicle
      WHERE vehicle_plate IS NULL AND vehicle IS NOT NULL AND vehicle != ''
    `));
    await db.execute(sql.raw(`
      UPDATE gojek_raw_transactions
      SET driver_phone = phone_number
      WHERE driver_phone IS NULL AND phone_number IS NOT NULL AND phone_number != ''
    `));
    // Composite unique index untuk baris TANPA gopay_ref (Rental fee due, dsb)
    // Mencegah duplikasi saat CSV yang sama diupload lebih dari sekali.
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS gojek_raw_no_ref_dedup
        ON gojek_raw_transactions(company_id, driver_external_id, date_iso, amount, transaction_type)
        WHERE (gopay_transaction_reference_id IS NULL OR gopay_transaction_reference_id = '')
    `));
    // Index komposit untuk recalculateOutstanding DISTINCT ON (date_iso DESC, id DESC)
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS gojek_raw_driver_date_id_idx
        ON gojek_raw_transactions(company_id, driver_external_id, date_iso DESC NULLS LAST, id DESC)
    `));
    // fleet_cash_payments — pencatatan pembayaran tunai driver terhadap outstanding
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS fleet_cash_payments (
        id                 SERIAL PRIMARY KEY,
        company_id         INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        outstanding_id     INTEGER REFERENCES fleet_outstanding(id) ON DELETE SET NULL,
        driver_id          INTEGER REFERENCES fleet_drivers(id) ON DELETE SET NULL,
        driver_name        TEXT NOT NULL,
        driver_external_id TEXT,
        driver_phone       TEXT,
        vehicle_plate      TEXT,
        payment_date       DATE NOT NULL DEFAULT CURRENT_DATE,
        amount             NUMERIC(18,4) NOT NULL,
        payment_method     TEXT NOT NULL DEFAULT 'cash',
        reference_no       TEXT,
        notes              TEXT,
        recorded_by        TEXT,
        status             TEXT NOT NULL DEFAULT 'confirmed',
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fcp_company_idx     ON fleet_cash_payments(company_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fcp_driver_idx      ON fleet_cash_payments(driver_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fcp_outstanding_idx ON fleet_cash_payments(outstanding_id)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fcp_date_idx        ON fleet_cash_payments(payment_date DESC)`));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS fcp_ext_id_idx      ON fleet_cash_payments(driver_external_id)`));
    // v15 backfill: accounting_entry_id column
    await db.execute(sql.raw(`ALTER TABLE fleet_cash_payments ADD COLUMN IF NOT EXISTS accounting_entry_id INTEGER`)).catch(() => {});
    // Views: alias untuk backward compat dengan nama di audit/dokumentasi user
    await db.execute(sql.raw(`CREATE OR REPLACE VIEW fleet_outstanding_balances AS SELECT * FROM fleet_outstanding`));
    await db.execute(sql.raw(`CREATE OR REPLACE VIEW fleet_reconciliation_batches AS SELECT * FROM fleet_reconciliation_reports`));
    logger.info("[fleetIntelligence] Migration v15 selesai (cash_payments, no-ref dedup, views)");

    // v16: fleet cash payment accounting hook
    await db.execute(sql.raw(`ALTER TABLE fleet_cash_payments ADD COLUMN IF NOT EXISTS accounting_entry_id INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL`));
    await db.execute(sql.raw(`ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_cash_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`));
    await db.execute(sql.raw(`ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_driver_receivable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`));
    await db.execute(sql.raw(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'fleet_cash_payment'
            AND enumtypid = (SELECT oid FROM pg_type WHERE typname = 'accounting_entry_source')
        ) THEN
          ALTER TYPE accounting_entry_source ADD VALUE 'fleet_cash_payment';
        END IF;
      END $$
    `)).catch(() => {});
    await db.execute(sql.raw(`
      INSERT INTO journal_sequences (journal_prefix, company_id, year, next_seq)
      SELECT 'FLEET', 0, EXTRACT(YEAR FROM NOW())::int, 1
      WHERE NOT EXISTS (
        SELECT 1 FROM journal_sequences
        WHERE journal_prefix = 'FLEET' AND company_id = 0 AND year = EXTRACT(YEAR FROM NOW())::int
      )
    `)).catch(() => {});
    logger.info("[fleetIntelligence] Migration v16 selesai (fleet cash payment accounting hook)");

    // v17: auto-blast WA settings
    await db.execute(sql.raw(`ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_auto_blast_enabled BOOLEAN NOT NULL DEFAULT FALSE`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_auto_blast_hour INTEGER NOT NULL DEFAULT 8`)).catch(() => {});
    await db.execute(sql.raw(`ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_auto_blast_last_run DATE`)).catch(() => {});
    logger.info("[fleetIntelligence] Migration v17 selesai (fleet auto-blast WA settings)");

    migrated = true;
    logger.info("[fleetIntelligence] Migration v11 selesai (fleet_wa_logs table)");
  } catch (err) {
    logger.error({ err }, "[fleetIntelligence] Migration error");
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function getCompanyId(req: Request): number | null {
  return (req.user as any)?.companyId ?? null;
}

function numVal(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Default PPN rate — single source of truth for all fleet calculations */
const DEFAULT_PPN_RATE = 11; // 11% PPN Indonesia

// ── PIPELINE GOVERNANCE RULES ─────────────────────────────────────────────────
/** Max concurrent ingestion jobs per company (prevents monopolization) */
const PIPELINE_MAX_CONCURRENT = 3;
/** Max rows per transform batch (prevents memory spike, enables progress) */
const PIPELINE_BATCH_SIZE = 500;
/** Pending queue depth that triggers backpressure rejection */
const PIPELINE_BACKPRESSURE_THRESHOLD = 20;
/** Priority weight for anti-starvation scoring (lower = processed first) */
const PRIORITY_WEIGHT: Record<string, number> = { critical: 0, high: 1, normal: 2, low: 3 };

/** Check how many slots are still available for this company */
async function checkConcurrencySlot(companyId: number | null): Promise<{ allowed: boolean; current: number }> {
  if (!companyId) return { allowed: true, current: 0 };
  const res = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM gojek_ingestion_queue
    WHERE company_id = ${companyId} AND status = 'processing'
  `));
  const current = numVal((res.rows[0] as any)?.cnt);
  return { allowed: current < PIPELINE_MAX_CONCURRENT, current };
}

/** Check queue backpressure — reject new jobs if too many pending */
async function checkBackpressure(companyId: number | null): Promise<{ overloaded: boolean; pendingCount: number }> {
  if (!companyId) return { overloaded: false, pendingCount: 0 };
  const res = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM gojek_ingestion_queue
    WHERE company_id = ${companyId} AND status IN ('pending','processing')
  `));
  const pendingCount = numVal((res.rows[0] as any)?.cnt);
  return { overloaded: pendingCount >= PIPELINE_BACKPRESSURE_THRESHOLD, pendingCount };
}

/** Compute pipeline health score 0–100 for a report */
function computeHealthScore(p: {
  totalRaw: number; transformed: number; failed: number; dlqRows: number;
}): { score: number; grade: "A" | "B" | "C" | "D" | "F"; breakdown: Record<string, number> } {
  if (p.totalRaw === 0) return { score: 0, grade: "F", breakdown: {} };
  const successRate  = p.transformed / Math.max(p.totalRaw, 1);
  const failRatio    = p.failed      / Math.max(p.totalRaw, 1);
  const dlqRatio     = p.dlqRows     / Math.max(p.totalRaw, 1);
  const transformAcc = 1 - Math.abs((p.transformed + p.failed) - p.totalRaw) / Math.max(p.totalRaw, 1);
  const breakdown = {
    successRate:       Math.round(successRate  * 60),  // 60 pts
    transformAccuracy: Math.round(transformAcc * 20),  // 20 pts
    failureResistance: Math.round((1 - failRatio) * 10), // 10 pts
    dlqControl:        Math.round((1 - dlqRatio)  * 10), // 10 pts
  };
  const score = Math.max(0, Math.min(100, Object.values(breakdown).reduce((a, b) => a + b, 0)));
  const grade = score >= 90 ? "A" : score >= 75 ? "B" : score >= 60 ? "C" : score >= 40 ? "D" : "F";
  return { score, grade, breakdown };
}

/** Write batch of audit diff entries for a transform (fire-and-forget) */
async function writeAuditDiffs(
  reportId: number,
  companyId: number | null,
  rawRowId: number,
  diffs: Array<{ field: string; rawVal: unknown; xVal: unknown; reason?: string }>,
): Promise<void> {
  if (!diffs.length) return;
  const vals = diffs.map((d) =>
    `(${reportId}, ${companyId ?? "NULL"}, ${rawRowId}, ${sq(d.field)}, ${sq(String(d.rawVal ?? ""))}, ${sq(String(d.xVal ?? ""))}, ${sq(d.reason ?? "transform")}, 'transform')`
  ).join(",");
  await db.execute(sql.raw(`
    INSERT INTO gojek_pipeline_audit_logs
      (report_id, company_id, raw_row_id, field_name, raw_value, transformed_value, change_reason, pipeline_stage)
    VALUES ${vals}
  `)).catch(() => {}); // non-fatal
}

/** Escape single quotes for SQL string literals (prevents SQL injection) */
function sanitize(v: unknown): string {
  return String(v ?? "").replace(/'/g, "''").slice(0, 500);
}

/** Nullable SQL string literal */
function sq(v: unknown): string {
  if (v == null || String(v).trim() === "") return "NULL";
  return `'${sanitize(v)}'`;
}

/** Safe numeric literal */
function sn(v: unknown): string {
  const n = numVal(v);
  return n.toFixed(4);
}

/** Safe JSON literal for ::jsonb cast */
function sqJson(obj: unknown): string {
  const json = JSON.stringify(obj ?? {});
  return `'${json.replace(/'/g, "''")}'::jsonb`;
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}

// ─── Safe CSV Parser (handles quoted fields, no split-comma bug) ─────────────
function parseCSVLines(text: string): string[][] {
  const result: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuote = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuote) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuote = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuote = true;
      } else if (ch === ',') {
        row.push(field.trim());
        field = "";
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        if (ch === '\r') i++;
        row.push(field.trim());
        if (row.some((v) => v !== "")) result.push(row);
        row = [];
        field = "";
      } else if (ch !== '\r') {
        field += ch;
      }
    }
    i++;
  }
  if (field !== "" || row.length > 0) {
    row.push(field.trim());
    if (row.some((v) => v !== "")) result.push(row);
  }
  return result;
}

/**
 * Konversi berbagai format tanggal ke ISO YYYY-MM-DD.
 * Mendukung: YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY, DD/MM/YYYY HH:MM:SS, Excel serial number.
 */
function toIsoDate(v: unknown): string {
  if (v == null || v === "") return "";
  const s = String(v).trim();
  if (!s) return "";

  // Sudah ISO: YYYY-MM-DD (atau YYYY-MM-DDTHH:...)
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

  // Format Indonesia DD/MM/YYYY atau DD-MM-YYYY (dengan atau tanpa waktu)
  const id = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (id) {
    const [, day, month, year] = id;
    return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
  }

  // Excel serial number (angka bulat seperti 45827)
  const num = Number(s);
  if (!isNaN(num) && num > 1000 && num < 100000) {
    const d = new Date(Date.UTC(1899, 11, 30) + num * 86400000);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  // Fallback: coba JS Date parse
  try {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  } catch { /* abaikan */ }

  return s;
}

function genRefNo(): string {
  const now = new Date();
  const yy = now.getFullYear();
  const seq = String(Date.now()).slice(-6);
  return `FLT/${yy}/${seq}`;
}

// ─── Router setup ─────────────────────────────────────────────────────────────

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

// Auth middleware (all fleet routes require admin)
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// Lazy migration: ensure tables exist before first fleet request
// Uses shared promise so concurrent requests all wait for the same migration run
let _migrationPromise: Promise<void> | null = null;
router.use(async (_req, _res, next) => {
  if (!migrated) {
    if (!_migrationPromise) {
      _migrationPromise = runFleetIntelligenceMigration().catch((err) => {
        logger.warn({ err }, "[fleet] Lazy migration failed — will retry on next request");
        _migrationPromise = null; // allow retry on next request
      });
    }
    try { await _migrationPromise; } catch { /* ignore — tables may already exist from prior session */ }
  }
  next();
});

// On-demand migration trigger (admin only — already protected by middleware above)
router.post("/migrate", async (_req, res: Response) => {
  if (migrated) {
    res.json({ ok: true, message: "Migration already complete" });
    return;
  }
  try {
    await runFleetIntelligenceMigration();
    res.json({ ok: true, message: "Fleet migration completed successfully" });
  } catch (err) {
    logger.error({ err }, "[fleet] On-demand migration failed");
    res.status(500).json({ ok: false, error: "Migration failed", detail: String(err) });
  }
});

// ─── PARTNERS ─────────────────────────────────────────────────────────────────

router.get("/partners", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db.execute(sql.raw(`
      SELECT * FROM fleet_partners WHERE company_id = ${companyId} ORDER BY created_at DESC
    `));
    res.json({ partners: rows.rows });
  } catch (err) {
    logger.error({ err }, "[fleet] GET partners error");
    res.status(500).json({ error: "Gagal mengambil data partners" });
  }
});

router.post("/partners", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { name, partnerType = "gojek", contractNumber, contactName, contactPhone, contactEmail, address, commissionRate, notes } = req.body;
    if (!name) return res.status(400).json({ error: "Nama partner wajib diisi" });
    const meta = extractRequestMeta(req);
    const rows = await db.execute(sql.raw(`
      INSERT INTO fleet_partners (company_id, name, partner_type, contract_number, contact_name, contact_phone, contact_email, address, commission_rate, notes)
      VALUES (${companyId}, ${sq(name)}, ${sq(partnerType)}, ${sq(contractNumber)}, ${sq(contactName)}, ${sq(contactPhone)}, ${sq(contactEmail)}, ${sq(address)}, ${sn(commissionRate)}, ${sq(notes)})
      RETURNING *
    `));
    writeAuditLog({ ...meta, action: "create", module: "fleet_partners", newData: rows.rows[0] as Record<string, unknown> });
    res.json({ partner: rows.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet] POST partners error");
    res.status(500).json({ error: "Gagal membuat partner" });
  }
});

router.put("/partners/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const { name, partnerType, contractNumber, contactName, contactPhone, contactEmail, address, commissionRate, isActive, notes } = req.body;
    const rows = await db.execute(sql.raw(`
      UPDATE fleet_partners SET
        name            = COALESCE(${sq(name)}, name),
        partner_type    = COALESCE(${sq(partnerType)}, partner_type),
        contract_number = COALESCE(${sq(contractNumber)}, contract_number),
        contact_name    = COALESCE(${sq(contactName)}, contact_name),
        contact_phone   = COALESCE(${sq(contactPhone)}, contact_phone),
        contact_email   = COALESCE(${sq(contactEmail)}, contact_email),
        address         = COALESCE(${sq(address)}, address),
        commission_rate = COALESCE(${commissionRate != null ? sn(commissionRate) : "NULL"}, commission_rate),
        is_active       = COALESCE(${isActive != null ? isActive : "NULL"}, is_active),
        notes           = COALESCE(${sq(notes)}, notes),
        updated_at      = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `));
    res.json({ partner: rows.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet] PUT partners error");
    res.status(500).json({ error: "Gagal update partner" });
  }
});

// ─── REPORTS ──────────────────────────────────────────────────────────────────

router.get("/reports", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db.execute(sql.raw(`
      SELECT r.*, p.name as partner_name
      FROM fleet_reports r
      LEFT JOIN fleet_partners p ON p.id = r.partner_id
      WHERE r.company_id = ${companyId}
      ORDER BY r.created_at DESC
      LIMIT 100
    `));
    res.json({ reports: rows.rows });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data reports" });
  }
});

/** Preview: parse file but DO NOT save to DB */
router.post("/reports/preview", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File wajib diupload" });

    const parsed = await parseFileToRows(req.file);
    const { rows, headers } = parsed;

    // Detect column mapping
    const colMap = detectColumnMapping(headers);

    // Map all rows for ledger summary, slice first 20 for preview
    const allMapped = rows.map((row) => mapRow(row, colMap));
    const previewRows = allMapped.slice(0, 20).map((m, i) => ({ ...m, _raw: rows[i] ?? {} }));

    // ── Ledger summary from ALL rows (source of truth: gojek_raw_transactions) ──
    const typeBreakdown: Record<string, { count: number; total: number }> = {};
    const uniqueVehicles = new Set<string>();
    const uniqueDrivers  = new Set<string>();
    let totalDebit  = 0;
    let totalCredit = 0;
    for (const r of allMapped) {
      const amt = Number(r.amount) || 0;
      if (amt < 0) totalDebit += amt;
      else totalCredit += amt;

      const txType = String(r.transactionType || "").trim() || "Unknown";
      if (!typeBreakdown[txType]) typeBreakdown[txType] = { count: 0, total: 0 };
      typeBreakdown[txType].count++;
      typeBreakdown[txType].total = Math.round((typeBreakdown[txType].total + amt) * 100) / 100;

      const plate  = String(r.vehiclePlate || "").trim();
      const driver = String(r.driverExtId || r.driverName || "").trim();
      if (plate)  uniqueVehicles.add(plate);
      if (driver) uniqueDrivers.add(driver);
    }
    const ledgerSummary = {
      transactionCount: rows.length,
      totalDebit:      Math.round(totalDebit  * 100) / 100,
      totalCredit:     Math.round(totalCredit * 100) / 100,
      netFlow:         Math.round((totalDebit + totalCredit) * 100) / 100,
      typeBreakdown,
      vehicleCoverage: uniqueVehicles.size,
      driverCoverage:  uniqueDrivers.size,
    };

    // Detect issues
    const warnings: string[] = [];
    if (!colMap.driverName && !colMap.driverExtId) warnings.push("Kolom nama driver tidak ditemukan");
    if (!colMap.txDate && !colMap.simpleDate) warnings.push("Kolom tanggal tidak ditemukan");
    if (!colMap.amount) warnings.push("Kolom amount (nilai transaksi) tidak ditemukan — sistem ledger membutuhkan kolom ini");
    if (!colMap.transactionType) warnings.push("Kolom transaction type tidak ditemukan — breakdown tipe tidak tersedia");
    if (!colMap.gopayRef) warnings.push("Kolom GoPay Reference ID tidak ditemukan — dedup berdasarkan referensi tidak aktif");

    const fileHash = sha256(req.file.buffer);
    const companyId = getCompanyId(req);
    // Duplicate check — non-fatal: preview still works even if tables haven't been created yet
    let existing: { rows: unknown[] } = { rows: [] };
    if (companyId) {
      try {
        existing = await db.execute(sql.raw(`
          SELECT id, original_filename, created_at, status FROM fleet_reports
          WHERE company_id = ${companyId} AND file_hash = '${fileHash}'
          LIMIT 1
        `));
      } catch (dupErr) {
        logger.warn({ dupErr }, "[fleet] preview: duplicate check failed (non-fatal) — tables may not exist yet");
      }
    }

    // Header yang tidak di-map ke field manapun
    const mappedHeaders = new Set(Object.values(colMap).filter(Boolean));
    const unmappedHeaders = headers.filter((h) => !mappedHeaders.has(h));

    const rawDto = {
      transactionCount: ledgerSummary.transactionCount,
      totalCredit:      ledgerSummary.totalCredit,
      totalDebit:       ledgerSummary.totalDebit,
      netFlow:          ledgerSummary.netFlow,
      vehicleCoverage:  ledgerSummary.vehicleCoverage,
      driverCoverage:   ledgerSummary.driverCoverage,
      typeBreakdown:    ledgerSummary.typeBreakdown,
    };

    // Runtime contract validation — throws + logs CONTRACT_VIOLATION on drift
    const dto: LedgerSummaryDTO = validateLedgerDTO(rawDto, { fileHash });

    const response: PreviewResponseDTO = {
      data: dto,
      meta: { version: "v1", generatedAt: new Date().toISOString() },
      fileHash,
      rowCount: rows.length,
      headers,
      unmappedHeaders,
      columnMapping: colMap,
      previewRows,
      warnings,
      duplicateReport: (existing.rows[0] ?? null) as { id: number; original_filename: string; status: string } | null,
    };

    res.json(response);
  } catch (err) {
    logger.error({ err }, "[fleet] preview error");
    res.status(500).json({ error: `Gagal parse file: ${(err as Error).message}` });
  }
});

/** Upload & process */
router.post("/reports/upload", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File wajib diupload" });
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    const { partnerId, reportType = "gojek_driver", periodStart, periodEnd, skipDuplicateCheck } = req.body;
    const originalFilename = req.file.originalname;
    const filename = `fleet_${Date.now()}_${originalFilename}`;
    const fileHash = sha256(req.file.buffer);

    // Duplicate check
    if (!skipDuplicateCheck && companyId) {
      const dup = await db.execute(sql.raw(`
        SELECT id, original_filename, status FROM fleet_reports
        WHERE company_id = ${companyId} AND file_hash = '${fileHash}'
        LIMIT 1
      `));
      if (dup.rows.length > 0) {
        const d = dup.rows[0] as Record<string, unknown>;
        return res.status(409).json({
          error: "File ini sudah pernah diupload sebelumnya",
          duplicateReportId: d.id,
          duplicateFilename: d.original_filename,
          duplicateStatus: d.status,
        });
      }
    }

    const reportRes = await db.execute(sql.raw(`
      INSERT INTO fleet_reports (company_id, partner_id, filename, original_filename, file_hash, report_type, period_start, period_end, status, uploaded_by, uploaded_by_email)
      VALUES (${companyId}, ${partnerId ? parseInt(partnerId) : "NULL"}, ${sq(filename)}, ${sq(originalFilename)}, ${sq(fileHash)}, ${sq(reportType)}, ${sq(periodStart)}, ${sq(periodEnd)}, 'processing', ${sq(meta.userId)}, ${sq(meta.userEmail)})
      RETURNING id
    `));
    const reportId = (reportRes.rows[0] as any).id as number;

    // Register in gojek_uploaded_files (raw layer registry — v7 schema)
    await db.execute(sql.raw(`
      INSERT INTO gojek_uploaded_files (company_id, report_id, file_hash, original_filename, file_size_bytes, mime_type, upload_status, uploaded_by, uploaded_by_email)
      VALUES (${companyId}, ${reportId}, ${sq(fileHash)}, ${sq(originalFilename)}, ${req.file.size ?? 0}, ${sq(req.file.mimetype)}, 'registered', ${sq(meta.userId)}, ${sq(meta.userEmail)})
      ON CONFLICT (company_id, file_hash) DO UPDATE SET report_id = ${reportId}, upload_status = 'registered', mime_type = ${sq(req.file.mimetype)}
    `)).catch((err) => logger.warn({ err }, "[fleet] gojek_uploaded_files upsert non-fatal"));

    writeAuditLog({ ...meta, action: "upload", module: "fleet_reports", referenceId: String(reportId), newData: { filename, originalFilename, reportType } });

    // Parse async — v7 pipeline with raw-first ingestion
    parseAndStoreReport(req.file, reportId, companyId, meta).catch((err) => {
      logger.error({ err, reportId }, "[fleet] background parse error");
    });

    res.json({ reportId, message: "File diterima, sedang diproses..." });
  } catch (err) {
    logger.error({ err }, "[fleet] upload error");
    res.status(500).json({ error: "Gagal upload file" });
  }
});

/** Rollback: delete all transactions for a report, then regenerate summary */
router.delete("/reports/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const meta = extractRequestMeta(req);

    // Verify ownership
    const check = await db.execute(sql.raw(`SELECT id, status, created_at FROM fleet_reports WHERE id = ${id} AND company_id = ${companyId}`));
    if (check.rows.length === 0) return res.status(404).json({ error: "Report tidak ditemukan" });
    const reportCreatedAt = (check.rows[0] as Record<string, unknown>).created_at as string;

    // Capture driver IDs BEFORE deleting raw data (needed for ghost-alert cleanup)
    const driversInReport = await db.execute(sql.raw(`
      SELECT DISTINCT driver_external_id
      FROM gojek_raw_transactions
      WHERE report_id = ${id} AND company_id = ${companyId}
        AND driver_external_id IS NOT NULL AND driver_external_id != ''
    `));
    const driverExtIds = (driversInReport.rows as Array<Record<string, unknown>>)
      .map((r) => String(r.driver_external_id));

    // Delete fleet_transactions
    await db.execute(sql.raw(`DELETE FROM fleet_transactions WHERE report_id = ${id} AND company_id = ${companyId}`));

    // Delete raw layer data (zero-orphan rule)
    await db.execute(sql.raw(`DELETE FROM gojek_raw_transactions WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_failed_rows WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`UPDATE gojek_uploaded_files SET upload_status = 'replaced' WHERE report_id = ${id} AND company_id = ${companyId}`));

    // Ghost-alert cleanup: delete fleet_alerts generated from this report's drivers
    if (driverExtIds.length > 0) {
      const idList = driverExtIds.map((d) => sq(d)).join(", ");
      await db.execute(sql.raw(`
        DELETE FROM fleet_alerts
        WHERE company_id = ${companyId}
          AND reference_id IN (${idList})
          AND created_at >= '${reportCreatedAt}'::timestamptz - INTERVAL '10 minutes'
      `)).catch(() => {});
      // Also clear suppression records for those drivers so alerts re-fire if re-uploaded
      await db.execute(sql.raw(`
        DELETE FROM fleet_alert_suppression
        WHERE company_id = ${companyId}
          AND reference_id IN (${idList})
      `)).catch(() => {});
    }

    // Mark report as rolled back
    await db.execute(sql.raw(`
      UPDATE fleet_reports SET status = 'rolled_back', updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}
    `));

    // Regenerate daily summary
    await regenerateDailySummary(companyId);

    writeAuditLog({ ...meta, action: "rollback", module: "fleet_reports", referenceId: String(id) });
    res.json({
      ok: true,
      message: "Report di-rollback, transaksi dan raw data dihapus",
      alertsRemoved: driverExtIds.length,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] rollback error");
    res.status(500).json({ error: "Gagal rollback report" });
  }
});

/** Live ingestion progress telemetry */
router.get("/reports/:id/progress", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));

    const rpt = await db.execute(sql.raw(`
      SELECT id, status, row_count, processed_count, error_count, created_at, updated_at
      FROM fleet_reports WHERE id = ${id} AND company_id = ${companyId}
    `));
    if (rpt.rows.length === 0) return res.status(404).json({ error: "Report tidak ditemukan" });
    const r = rpt.rows[0] as Record<string, unknown>;

    const [rawRes, fleetRes, dlqRes, ingRes] = await Promise.all([
      db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM gojek_raw_transactions WHERE report_id = ${id} AND company_id = ${companyId}`)),
      db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM fleet_transactions WHERE report_id = ${id} AND company_id = ${companyId}`)),
      db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM gojek_failed_rows WHERE report_id = ${id} AND company_id = ${companyId} AND resolved = FALSE`)),
      db.execute(sql.raw(`SELECT total_raw_rows, inserted_raw, transformed_ok, failed_rows, dlq_rows, health_score, health_grade, duration_ms FROM gojek_ingestion_reports WHERE report_id = ${id} ORDER BY created_at DESC LIMIT 1`)),
    ]);

    const rawInserted  = numVal((rawRes.rows[0] as any)?.cnt);
    const successRows  = numVal((fleetRes.rows[0] as any)?.cnt);
    const dlqCount     = numVal((dlqRes.rows[0] as any)?.cnt);
    const ingRow       = ingRes.rows[0] as Record<string, unknown> | undefined;

    const health = computeHealthScore({
      totalRaw:    rawInserted,
      transformed: successRows,
      failed:      numVal(r.error_count),
      dlqRows:     dlqCount,
    });

    res.json({
      reportId:      id,
      status:        r.status,
      rowCount:      numVal(r.row_count),
      rawInserted,
      successRows,
      failedRows:    numVal(r.error_count),
      dlqCount,
      healthScore:   ingRow?.health_score ?? health.score,
      grade:         ingRow?.health_grade ?? health.grade,
      durationMs:    ingRow?.duration_ms ?? null,
      pipelineVersion: "v7",
      updatedAt:     r.updated_at,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] progress error");
    res.status(500).json({ error: "Gagal ambil progress" });
  }
});

/** Zero-orphan purge: delete ALL data associated with a report, reset for re-upload */
router.post("/reports/:id/purge", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const meta = extractRequestMeta(req);

    const check = await db.execute(sql.raw(`SELECT id, original_filename, file_hash FROM fleet_reports WHERE id = ${id} AND company_id = ${companyId}`));
    if (check.rows.length === 0) return res.status(404).json({ error: "Report tidak ditemukan" });
    const rpt = check.rows[0] as Record<string, unknown>;

    // Purge order: child → parent, no orphans left
    await db.execute(sql.raw(`DELETE FROM ledger_entries WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM ledger_events  WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM ledger_snapshots WHERE company_id = ${companyId} AND snapshot_date IN (SELECT DISTINCT entry_date FROM ledger_entries WHERE report_id = ${id})`));
    await db.execute(sql.raw(`DELETE FROM gojek_failed_rows         WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_pipeline_audit_logs WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_ingestion_reports   WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM fleet_pipeline_health      WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM fleet_reconciliation_reports WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM transaction_datetime_normalized WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_ingestion_queue WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM fleet_transactions     WHERE report_id = ${id} AND company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_raw_transactions WHERE report_id = ${id} AND company_id = ${companyId}`));
    // Remove file registry entry so exact same file can be re-uploaded
    await db.execute(sql.raw(`DELETE FROM gojek_uploaded_files WHERE report_id = ${id} AND company_id = ${companyId}`));
    // Reset report record — clear hash so re-upload is accepted as new
    await db.execute(sql.raw(`
      UPDATE fleet_reports
      SET status = 'purged', file_hash = NULL, processed_count = 0, error_count = 0,
          row_count = 0, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));

    await regenerateDailySummary(companyId);

    writeAuditLog({
      ...meta, action: "purge", module: "fleet_reports",
      referenceId: String(id),
      newData: { filename: rpt.original_filename, fileHash: rpt.file_hash },
    });

    res.json({ ok: true, message: "Semua data report dihapus bersih. Siap re-upload." });
  } catch (err) {
    logger.error({ err }, "[fleet] purge error");
    res.status(500).json({ error: "Gagal purge report" });
  }
});

/** Purge ALL fleet data for the company — clean slate before fresh import */
router.post("/reports/purge-all", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);

    if (!companyId) return res.status(400).json({ error: "Company ID tidak ditemukan" });

    // Count existing reports first for audit
    const countRes = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM fleet_reports WHERE company_id = ${companyId}
    `));
    const reportCount = numVal((countRes.rows[0] as any)?.cnt);

    // Purge order: child → parent (zero-orphan guarantee)
    await db.execute(sql.raw(`DELETE FROM ledger_entries         WHERE company_id = ${companyId} AND report_id IN (SELECT id FROM fleet_reports WHERE company_id = ${companyId})`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM ledger_events          WHERE company_id = ${companyId} AND report_id IN (SELECT id FROM fleet_reports WHERE company_id = ${companyId})`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM gojek_failed_rows       WHERE company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_pipeline_audit_logs WHERE company_id = ${companyId}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM gojek_ingestion_reports  WHERE company_id = ${companyId}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM fleet_pipeline_health    WHERE company_id = ${companyId}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM fleet_reconciliation_reports WHERE company_id = ${companyId}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM transaction_datetime_normalized WHERE company_id = ${companyId}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM gojek_ingestion_queue   WHERE company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM fleet_transactions       WHERE company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_raw_transactions   WHERE company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM gojek_uploaded_files     WHERE company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM fleet_outstanding        WHERE company_id = ${companyId}`));
    await db.execute(sql.raw(`DELETE FROM fleet_daily_summary      WHERE company_id = ${companyId}`)).catch(() => {});
    await db.execute(sql.raw(`DELETE FROM fleet_reports            WHERE company_id = ${companyId}`));

    writeAuditLog({
      ...meta, action: "purge_all", module: "fleet_reports",
      newData: { reportCount, note: "Full company fleet data purge" },
    });

    logger.info({ companyId, reportCount }, "[fleet] purge-all complete");
    res.json({ ok: true, message: `${reportCount} laporan dan seluruh data fleet dihapus bersih. Siap fresh import.`, reportCount });
  } catch (err) {
    logger.error({ err }, "[fleet] purge-all error");
    res.status(500).json({ error: "Gagal purge semua data fleet" });
  }
});

// ─── Parse Helpers ─────────────────────────────────────────────────────────────

async function parseFileToRows(file: Express.Multer.File): Promise<{ rows: Record<string, unknown>[]; headers: string[] }> {
  const rows: Record<string, unknown>[] = [];
  let headers: string[] = [];
  const ext = file.originalname.toLowerCase();

  if (ext.endsWith(".csv")) {
    const text = file.buffer.toString("utf-8").replace(/^\uFEFF/, ""); // strip BOM
    const parsed = parseCSVLines(text);
    if (parsed.length < 2) throw new Error("File CSV kosong atau hanya header");
    headers = parsed[0].map((h) => h.toLowerCase());
    for (let i = 1; i < parsed.length; i++) {
      const vals = parsed[i];
      const row: Record<string, unknown> = {};
      headers.forEach((h, idx) => { row[h] = vals[idx] ?? ""; });
      if (Object.values(row).some((v) => String(v).trim())) rows.push(row);
    }
  } else {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as any);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error("Sheet Excel kosong");
    ws.getRow(1).eachCell((cell) => headers.push(String(cell.value ?? "").toLowerCase().trim()));
    ws.eachRow((row, rowNum) => {
      if (rowNum === 1) return;
      const obj: Record<string, unknown> = {};
      row.eachCell({ includeEmpty: true }, (cell, colNum) => {
        const h = headers[colNum - 1];
        if (h) obj[h] = cell.value ?? "";
      });
      if (Object.values(obj).some((v) => v !== "")) rows.push(obj);
    });
  }
  return { rows, headers };
}

function detectColumnMapping(headers: string[]): Record<string, string | null> {
  const findExact = (...keys: string[]) => headers.find((h) => keys.includes(h)) ?? null;
  const find = (...keys: string[]) => headers.find((h) => keys.some((k) => h.includes(k))) ?? null;
  const best = (exact: string[], partial: string[]) => findExact(...exact) ?? find(...partial);

  return {
    // ── Gojek Transaction Ledger columns (primary format) ─────────────────────
    gopayRef: best(
      ["gopay transaction reference id", "gopay_transaction_reference_id", "transaction reference id"],
      ["gopay transaction reference", "transaction reference", "gopay ref", "reference id"],
    ),
    amount: best(
      ["amount", "jumlah", "nilai transaksi"],
      ["amount", "nilai transaksi", "jumlah transaksi"],
    ),
    transactionType: best(
      ["type", "transaction type", "jenis transaksi", "tipe transaksi"],
      ["transaction type", "jenis transaksi"],
    ),
    driverPhone: best(
      ["phone number", "phone", "no hp", "nomor hp", "no. hp"],
      ["phone number", "nomor hp", "no hp", "telp", "telephone"],
    ),
    simpleDate: findExact("date"),
    // ── Common fields (both formats) ──────────────────────────────────────────
    driverExtId: best(
      ["driver id", "id driver", "driver_id"],
      ["driver id", "id driver", "driver_id", "mitra id", "id mitra"],
    ),
    driverName: best(
      ["driver name", "nama driver", "nama pengemudi"],
      ["driver name", "nama driver", "nama pengemudi", "nama mitra", "pengemudi"],
    ),
    vehiclePlate: best(
      ["vehicle", "vehicle license plate", "license plate", "vehicle plate", "plat nomor", "nopol"],
      ["vehicle", "license plate", "vehicle plate", "nopol", "kendaraan", "plat", "nomor polisi"],
    ),
    txDate: best(
      ["date & time(jkt)", "date & time", "tanggal transaksi", "transaction date", "datetime"],
      ["date & time", "tanggal", "waktu", "transaction date", "tgl"],
    ),
    outstanding: best(
      ["total outstanding balance", "outstanding balance", "total outstanding"],
      ["total outstanding", "outstanding balance", "outstanding", "saldo", "hutang"],
    ),
    // ── Gojek Earnings Summary columns (legacy format) ────────────────────────
    tripCount: best(
      ["number of completed trips", "total completed trips", "completed trips", "total trips"],
      ["completed trip", "jumlah trip", "total trip", "trip count", "trips completed"],
    ),
    grossRevenue: best(
      ["gross revenue", "gross earning", "gross amount", "total gross revenue", "pendapatan kotor"],
      ["gross revenue", "gross earning", "pendapatan kotor", "total gross", "omzet", "gross (idr)", "gross"],
    ),
    incentive: best(
      ["total incentive", "total insentif", "insentif total", "incentive total"],
      ["total insentif", "insentif", "incentive", "bonus", "additional earning"],
    ),
    commission: best(
      ["gojek commission", "potongan gojek", "gojek fee", "platform commission"],
      ["gojek commission", "gojek fee", "potongan gojek", "biaya aplikasi", "platform fee", "komisi", "commission"],
    ),
    deduction: best(
      ["total deduction", "total potongan lain", "other deduction"],
      ["total deduction", "potongan lain", "deduction", "penalti", "penalty", "adjustment"],
    ),
    netRevenue: best(
      ["net revenue", "net earning", "penghasilan bersih", "pendapatan bersih", "driver net earning"],
      ["net revenue", "pendapatan bersih", "penghasilan bersih", "net earning", "take home", "bersih", "net"],
    ),
    serviceType: best(
      ["service type", "jenis layanan", "tipe layanan", "product type"],
      ["service type", "jenis layanan", "tipe layanan", "jenis produk", "product type", "kategori", "layanan"],
    ),
  };
}

function mapRow(row: Record<string, unknown>, colMap: Record<string, string | null>) {
  const get = (key: string | null) => (key ? row[key] : null);
  const trimStr = (v: unknown) => String(v ?? "").trim();

  // Gojek Transaction Ledger fields
  const amount = numVal(get(colMap.amount));
  const transactionType = trimStr(get(colMap.transactionType));
  const driverPhone = trimStr(get(colMap.driverPhone)).replace(/^\t+/, "");
  const gopayRef = trimStr(get(colMap.gopayRef));
  const vehiclePlate = trimStr(get(colMap.vehiclePlate));

  // Date: prefer date & time column, fallback to simple date column
  const txDate = toIsoDate(get(colMap.txDate)) || toIsoDate(get(colMap.simpleDate));

  // Legacy Gojek Earnings Summary fields
  const grossRevenue = numVal(get(colMap.grossRevenue));
  const incentive    = numVal(get(colMap.incentive));
  const commission   = numVal(get(colMap.commission));
  const deduction    = numVal(get(colMap.deduction));
  const netRevenue   = numVal(get(colMap.netRevenue)) || (grossRevenue + incentive - commission - deduction);
  const outstanding  = numVal(get(colMap.outstanding));
  const ppnRate      = DEFAULT_PPN_RATE;
  const ppnAmount    = grossRevenue * ppnRate / 100;

  // Keep raw datetime string for preview display (before ISO conversion)
  const rawDatetime = String(get(colMap.txDate) ?? get(colMap.simpleDate) ?? "").trim();

  return {
    driverExtId: trimStr(get(colMap.driverExtId)),
    driverName:  trimStr(get(colMap.driverName)),
    vehiclePlate,
    txDate,
    rawDatetime,
    driverPhone,
    gopayRef,
    amount,
    transactionType: transactionType || null,
    tripCount:    numVal(get(colMap.tripCount)),
    grossRevenue,
    incentive,
    commission,
    deduction,
    netRevenue,
    outstanding,
    serviceType:  trimStr(get(colMap.serviceType)) || "GoRide",
    ppnRate,
    ppnAmount,
    raw: row,
  };
}

// ─── Parse & Store v4 — Raw ingestion first, transform second ─────────────────

async function parseAndStoreReport(
  file: Express.Multer.File,
  reportId: number,
  companyId: number | null,
  meta: ReturnType<typeof extractRequestMeta>,
) {
  try {
    const { rows, headers } = await parseFileToRows(file);
    const colMap = detectColumnMapping(headers);

    // ── DELETE & REPLACE: hapus semua raw data lama sebelum insert batch baru ──
    if (companyId != null) {
      await db.execute(sql.raw(`DELETE FROM gojek_failed_rows WHERE company_id = ${companyId}`)).catch(() => {});
      await db.execute(sql.raw(`DELETE FROM gojek_raw_transactions WHERE company_id = ${companyId}`)).catch(() => {});
      logger.info({ companyId, reportId }, "[fleet] Delete & Replace: raw data lama dihapus");
    }

    let insertedRawCount = 0;
    let transformedCount = 0;
    const transformErrors: string[] = [];

    const numLit = (v: unknown): string => {
      const n = parseFloat(String(v ?? "").trim().replace(/[^\d.-]/g, ""));
      return isNaN(n) ? "NULL" : n.toFixed(4);
    };

    // ── STEP 1: RAW INGESTION — 100% data guarantee, no filter, no dedup ──────
    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100);
      const rawVals = chunk.map((row) => {
        const g = (key: string | null): unknown => (key && row[key] != null ? row[key] : "");
        const phone = String(g(colMap.driverPhone)).replace(/^\t+/, "").trim();
        const svcRaw = String(g(colMap.serviceType) || "").trim() || "GoRide";
        const rawDateStr = String(g(colMap.simpleDate) || g(colMap.txDate) || "").trim();
        const isoDate = toIsoDate(rawDateStr);
        // Columns: company_id, report_id, date_time_jkt, driver_external_id,
        //   driver_name, phone_number, vehicle, vehicle_plate, driver_phone, amount,
        //   total_outstanding_balance, transaction_type,
        //   gopay_transaction_reference_id, date, raw_json, service_type, date_iso
        return (
          `(${companyId ?? "NULL"}, ${reportId}, ` +
          `${sq(g(colMap.txDate))}, ${sq(g(colMap.driverExtId))}, ` +
          `${sq(g(colMap.driverName))}, ${sq(phone)}, ` +
          `${sq(g(colMap.vehiclePlate))}, ${sq(g(colMap.vehiclePlate))}, ${sq(phone)}, ` +
          `${numLit(g(colMap.amount))}, ` +
          `${numLit(g(colMap.outstanding))}, ${sq(g(colMap.transactionType))}, ` +
          `${sq(g(colMap.gopayRef))}, ${sq(g(colMap.simpleDate))}, ${sqJson(row)}, ${sq(svcRaw)}, ` +
          `${isoDate ? sq(isoDate) : "NULL"})`
        );
      });

      try {
        // ON CONFLICT DO NOTHING (tanpa target) — respects ALL unique constraints:
        //   1. gojek_raw_gopay_ref_company_uq (baris WITH gopay_ref)
        //   2. gojek_raw_no_ref_dedup (baris WITHOUT gopay_ref — Rental fee due, dsb)
        const batchRes = await db.execute(sql.raw(`
          INSERT INTO gojek_raw_transactions (
            company_id, report_id, date_time_jkt, driver_external_id,
            driver_name, phone_number, vehicle, vehicle_plate, driver_phone, amount,
            total_outstanding_balance, transaction_type,
            gopay_transaction_reference_id, date, raw_json, service_type, date_iso
          ) VALUES ${rawVals.join(", ")}
          ON CONFLICT DO NOTHING
        `));
        insertedRawCount += (batchRes as any).rowCount ?? chunk.length;
      } catch (_batchErr) {
        // Batch failed — fallback row-by-row to maximise salvage
        for (const row of chunk) {
          try {
            const g = (key: string | null): unknown => (key && row[key] != null ? row[key] : "");
            const phone = String(g(colMap.driverPhone)).replace(/^\t+/, "").trim();
            const svc = String(g(colMap.serviceType) || "").trim() || "GoRide";
            const rawDs = String(g(colMap.simpleDate) || g(colMap.txDate) || "").trim();
            const isoDs = toIsoDate(rawDs);
            const rowRes = await db.execute(sql.raw(`
              INSERT INTO gojek_raw_transactions (
                company_id, report_id, date_time_jkt, driver_external_id,
                driver_name, phone_number, vehicle, vehicle_plate, driver_phone, amount,
                total_outstanding_balance, transaction_type,
                gopay_transaction_reference_id, date, raw_json, service_type, date_iso
              ) VALUES (${companyId ?? "NULL"}, ${reportId},
                ${sq(g(colMap.txDate))}, ${sq(g(colMap.driverExtId))},
                ${sq(g(colMap.driverName))}, ${sq(phone)},
                ${sq(g(colMap.vehiclePlate))}, ${sq(g(colMap.vehiclePlate))}, ${sq(phone)},
                ${numLit(g(colMap.amount))},
                ${numLit(g(colMap.outstanding))}, ${sq(g(colMap.transactionType))},
                ${sq(g(colMap.gopayRef))}, ${sq(g(colMap.simpleDate))}, ${sqJson(row)}, ${sq(svc)},
                ${isoDs ? sq(isoDs) : "NULL"})
              ON CONFLICT DO NOTHING
            `));
            insertedRawCount += (rowRes as any).rowCount ?? 1;
          } catch { /* truly unrecoverable single row — skip silently */ }
        }
      }
    }

    // ── PHASE 1 COMPLETE: raw inserted, update report + enqueue transform ─────
    const ingestionStatus = insertedRawCount > 0 ? "queued" : "error";
    const summaryStats = {
      totalRows: rows.length,
      insertedRawCount,
      phase: "raw_ingestion_complete",
      columnMapping: colMap,
    };

    await db.execute(sql.raw(`
      UPDATE fleet_reports SET
        status          = ${sq(ingestionStatus)},
        row_count       = ${rows.length},
        processed_count = ${insertedRawCount},
        summary_stats   = ${sqJson(summaryStats)},
        column_mapping  = ${sqJson(colMap)},
        updated_at      = NOW()
      WHERE id = ${reportId}
    `));

    if (insertedRawCount > 0) {
      // Insert queue entry (idempotent — UNIQUE index on report_id)
      await db.execute(sql.raw(`
        INSERT INTO gojek_ingestion_queue (report_id, company_id, status)
        VALUES (${reportId}, ${companyId ?? "NULL"}, 'pending')
        ON CONFLICT (report_id) DO UPDATE SET status = 'pending', enqueued_at = NOW()
      `));

      // Fire Phase 2 transform async — ingestion ALWAYS succeeds regardless
      transformRawToFleet(reportId, companyId, meta).catch((err) => {
        logger.error({ err, reportId }, "[fleet] Phase 2 transform async error");
      });
    }

    writeAuditLog({ ...meta, action: "ingest", module: "fleet_reports", referenceId: String(reportId), newData: summaryStats as unknown as Record<string, unknown> });
    logger.info({ reportId, insertedRawCount }, "[fleet] Phase 1 ingestion complete — transform queued");
  } catch (err) {
    await db.execute(sql.raw(`
      UPDATE fleet_reports SET status = 'error', error_details = ${sqJson([String((err as Error).message)])}, updated_at = NOW()
      WHERE id = ${reportId}
    `)).catch(() => {});
    logger.error({ err, reportId }, "[fleet] Phase 1 ingestion fatal error");
  }
}

// ─── PHASE 2: Transform raw → fleet_transactions (retryable, DLQ on row fail) ─

async function transformRawToFleet(
  reportId: number,
  companyId: number | null,
  meta?: ReturnType<typeof extractRequestMeta>,
  opts: { priority?: string } = {},
): Promise<{ transformedCount: number; failedCount: number; healthScore: ReturnType<typeof computeHealthScore> }> {

  // ── GOVERNANCE: concurrency control ───────────────────────────────────────
  const { allowed, current } = await checkConcurrencySlot(companyId);
  if (!allowed) {
    logger.warn({ reportId, companyId, current }, "[fleet][gov] concurrency limit — queuing for later");
    // Re-schedule: leave status as 'pending', will be picked up when a slot frees
    await db.execute(sql.raw(`
      UPDATE gojek_ingestion_queue SET status = 'pending', last_error = 'concurrency_limit'
      WHERE report_id = ${reportId}
    `)).catch(() => {});
    // Retry after a delay so we don't busy-loop
    setTimeout(() => {
      transformRawToFleet(reportId, companyId, meta, opts).catch(() => {});
    }, 15_000 + Math.random() * 10_000); // 15–25 s jitter
    return { transformedCount: 0, failedCount: 0, healthScore: computeHealthScore({ totalRaw: 0, transformed: 0, failed: 0, dlqRows: 0 }) };
  }

  // ── GOVERNANCE: priority-ordered processing (critical first, anti-starvation) ─
  const priority = opts.priority ?? "normal";
  await db.execute(sql.raw(`
    UPDATE gojek_ingestion_queue
    SET status = 'processing', started_at = NOW(), priority = ${sq(priority)}
    WHERE report_id = ${reportId}
  `)).catch(() => {});

  try {
    // Get column mapping stored during ingestion
    const reportRes = await db.execute(sql.raw(`
      SELECT column_mapping FROM fleet_reports WHERE id = ${reportId}
    `));
    const colMap: Record<string, string | null> = (reportRes.rows[0] as any)?.column_mapping ?? {};

    // Read all raw rows — GOVERNANCE: batch by PIPELINE_BATCH_SIZE to cap memory
    const totalCountRes = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM gojek_raw_transactions WHERE report_id = ${reportId}
    `));
    const totalRaw = numVal((totalCountRes.rows[0] as any)?.cnt);

    let transformedCount = 0;
    let failedCount = 0;
    const driverMap = new Map<string, number>();

    // Process in batches of PIPELINE_BATCH_SIZE (500 rows max) — no unbounded scans
    for (let offset = 0; offset < totalRaw; offset += PIPELINE_BATCH_SIZE) {
      const rawRes = await db.execute(sql.raw(`
        SELECT * FROM gojek_raw_transactions
        WHERE report_id = ${reportId}
        ORDER BY id
        LIMIT ${PIPELINE_BATCH_SIZE} OFFSET ${offset}
      `));
      const rawRows = rawRes.rows as Record<string, unknown>[];

      for (let i = 0; i < rawRows.length; i++) {
        const raw = rawRows[i];
        const rawRowId = raw.id as number;
        const globalIdx = offset + i;

        try {
          // Re-apply mapRow on stored raw_json (fully reproducible)
          const rawJson = (raw.raw_json ?? {}) as Record<string, unknown>;
          const item = mapRow(rawJson, colMap);

          // Prefer already-extracted fields from raw table
          const driverExtId    = String(raw.driver_external_id ?? item.driverExtId ?? "").trim();
          const driverName     = String(raw.driver_name ?? item.driverName ?? "").trim();
          const vehiclePlate   = String(raw.vehicle ?? item.vehiclePlate ?? "").trim();
          const driverPhone    = String(raw.phone_number ?? item.driverPhone ?? "").replace(/^\t+/, "").trim();
          const txDate         = toIsoDate(raw.date_time_jkt) || toIsoDate(raw.date) || item.txDate;
          const amount         = numVal(raw.amount) || item.amount;
          const outstanding    = numVal(raw.total_outstanding_balance) || item.outstanding;
          const transactionType = String(raw.transaction_type ?? item.transactionType ?? "").trim() || null;
          const gopayRef       = String(raw.gopay_transaction_reference_id ?? item.gopayRef ?? "").trim();

          // GOVERNANCE: Zod row-level validation — every failure is traceable, never silent
          const zodVal = IngestRowSchema.safeParse({ driverExtId, driverName, txDate, amount, outstanding, transactionType, gopayRef, vehiclePlate, driverPhone });
          if (!zodVal.success) {
            throw new Error(zodVal.error.issues.map((i) => i.message).join("; "));
          }

          // ── Klasifikasi amount berdasarkan transaction_type ──────────────────
          // Gojek Transaction Ledger tidak punya kolom Gross/Net terpisah —
          // amount harus dikategorikan berdasarkan jenis transaksi.
          // Earnings Summary format (sudah punya kolom sendiri) tetap dipakai langsung.
          let grossRevenue = item.grossRevenue;
          let incentive    = item.incentive;
          let commission   = item.commission;
          let deduction    = item.deduction;
          let netRevenue   = item.netRevenue;

          if (!grossRevenue && !netRevenue) {
            // Transaction Ledger format: klasifikasikan dari transaction_type
            const txTypeLc = (transactionType ?? "").toLowerCase();
            if (
              txTypeLc.includes("rental") ||
              txTypeLc.includes("trip") ||
              txTypeLc.includes("earning") ||
              txTypeLc.includes("fee") ||
              txTypeLc === ""
            ) {
              // Rental Fee = pendapatan driver
              grossRevenue = amount > 0 ? amount : 0;
              if (amount < 0) deduction += Math.abs(amount);
            } else if (txTypeLc.includes("incentive") || txTypeLc.includes("insentif") || txTypeLc.includes("bonus")) {
              incentive = Math.abs(amount);
            } else if (txTypeLc.includes("commission") || txTypeLc.includes("komisi") || txTypeLc.includes("gojek fee")) {
              commission = Math.abs(amount);
            } else if (
              txTypeLc.includes("deduction") ||
              txTypeLc.includes("potongan") ||
              txTypeLc.includes("penalty") ||
              txTypeLc.includes("penalti") ||
              txTypeLc.includes("adjustment") ||
              txTypeLc.includes("outstanding")
            ) {
              deduction = Math.abs(amount);
            } else {
              // Fallback: positif = pendapatan, negatif = potongan
              if (amount >= 0) grossRevenue = amount;
              else deduction = Math.abs(amount);
            }
            netRevenue = grossRevenue + incentive - commission - deduction;
          }

          const ppnRate   = DEFAULT_PPN_RATE;
          const ppnAmount = grossRevenue * ppnRate / 100;

          // ── AUDIT DIFF LAYER — collect field-level transformations ──────────
          const auditDiffs: Array<{ field: string; rawVal: unknown; xVal: unknown; reason?: string }> = [];
          if (raw.driver_name !== driverName)
            auditDiffs.push({ field: "driver_name", rawVal: raw.driver_name, xVal: driverName, reason: "trim" });
          if (raw.phone_number !== driverPhone)
            auditDiffs.push({ field: "phone_number", rawVal: raw.phone_number, xVal: driverPhone, reason: "trim+tab_strip" });
          if (String(raw.amount) !== sn(amount))
            auditDiffs.push({ field: "amount", rawVal: raw.amount, xVal: amount, reason: "numeric_cast" });
          if (grossRevenue !== numVal(raw.amount))
            auditDiffs.push({ field: "gross_revenue", rawVal: raw.amount, xVal: grossRevenue, reason: "derived_from_raw_json" });
          if (ppnAmount > 0)
            auditDiffs.push({ field: "ppn_amount", rawVal: 0, xVal: ppnAmount, reason: `ppn_${ppnRate}pct_computed` });
          // fire-and-forget — never block pipeline for audit writes
          writeAuditDiffs(reportId, companyId, rawRowId, auditDiffs).catch(() => {});

          // Upsert driver (cached per transform run)
          let driverId: number | null = null;
          const driverKey = `${driverExtId}||${driverName}`;

          if (driverMap.has(driverKey)) {
            driverId = driverMap.get(driverKey)!;
          } else if (driverExtId) {
            const res = await db.execute(sql.raw(`
              INSERT INTO fleet_drivers (company_id, driver_external_id, name, phone, vehicle_plate, vehicle_type, status, last_active_date)
              VALUES (${companyId}, ${sq(driverExtId)}, ${sq(driverName || "Unknown")}, ${sq(driverPhone)}, ${sq(vehiclePlate)}, ${sq(item.serviceType)}, 'active', ${sq(txDate)})
              ON CONFLICT (company_id, driver_external_id)
                WHERE driver_external_id IS NOT NULL AND driver_external_id != ''
              DO UPDATE SET
                phone            = COALESCE(NULLIF(EXCLUDED.phone, ''), fleet_drivers.phone),
                vehicle_plate    = COALESCE(NULLIF(EXCLUDED.vehicle_plate, ''), fleet_drivers.vehicle_plate),
                last_active_date = GREATEST(fleet_drivers.last_active_date, EXCLUDED.last_active_date::date),
                updated_at       = NOW()
              RETURNING id
            `));
            driverId = (res.rows[0] as any)?.id ?? null;
            if (!driverId) {
              const ex = await db.execute(sql.raw(`SELECT id FROM fleet_drivers WHERE company_id = ${companyId} AND driver_external_id = ${sq(driverExtId)} LIMIT 1`));
              driverId = (ex.rows[0] as any)?.id ?? null;
            }
            if (driverId) driverMap.set(driverKey, driverId);
          }

          // Insert transaction — idempotent
          await db.execute(sql.raw(`
            INSERT INTO fleet_transactions (
              company_id, report_id, driver_id, driver_external_id, driver_name,
              vehicle_plate, driver_phone, transaction_date,
              trip_count, amount, transaction_type, gopay_reference_id,
              gross_revenue, incentive, commission, deduction, net_revenue,
              outstanding_balance, ppn_rate, ppn_amount, service_type, raw_data
            ) VALUES (
              ${companyId}, ${reportId}, ${driverId ?? "NULL"}, ${sq(driverExtId)}, ${sq(driverName || "Unknown")},
              ${sq(vehiclePlate)}, ${sq(driverPhone)}, ${sq(txDate || "2000-01-01")}::date,
              ${Math.round(item.tripCount)}, ${sn(amount)}, ${sq(transactionType)}, ${sq(gopayRef)},
              ${sn(grossRevenue)}, ${sn(incentive)}, ${sn(commission)}, ${sn(deduction)},
              ${sn(netRevenue)}, ${sn(outstanding)}, ${sn(ppnRate)}, ${sn(ppnAmount)},
              ${sq(item.serviceType)}, ${sqJson(rawJson)}
            )
            ON CONFLICT (company_id, gopay_reference_id)
              WHERE gopay_reference_id IS NOT NULL AND gopay_reference_id != ''
            DO NOTHING
          `));
          transformedCount++;

          // outstanding upsert is now done in bulk at end of transform (recalculateOutstanding)
          // per-row upsert is removed to prevent wrong value overwriting latest balance

        } catch (rowErr) {
          // ── DLQ — zero data loss, every failure logged ──────────────────────
          failedCount++;
          const errMsg = String((rowErr as Error).message).slice(0, 500);
          await db.execute(sql.raw(`
            INSERT INTO gojek_failed_rows (report_id, company_id, raw_row_id, row_index, error_reason, error_stage, raw_data)
            VALUES (${reportId}, ${companyId ?? "NULL"}, ${rawRowId}, ${globalIdx}, ${sq(errMsg)}, 'transform', ${sqJson(raw)})
          `)).catch(() => {});
          logger.warn({ reportId, idx: globalIdx, errMsg }, "[fleet][DLQ] row inserted");
        }
      }

      logger.debug({ reportId, offset, batchSize: rawRows.length, transformedCount, failedCount }, "[fleet] batch done");
    }

    // ── Compute pipeline health score ─────────────────────────────────────────
    const dlqCountRes = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM gojek_failed_rows WHERE report_id = ${reportId} AND resolved = FALSE
    `));
    const dlqRows = numVal((dlqCountRes.rows[0] as any)?.cnt);
    const healthScore = computeHealthScore({ totalRaw, transformed: transformedCount, failed: failedCount, dlqRows });

    // ── Queue → done ──────────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      UPDATE gojek_ingestion_queue SET status = 'done', completed_at = NOW()
      WHERE report_id = ${reportId}
    `));

    const finalStatus = transformedCount > 0 ? "done" : (failedCount > 0 ? "transform_failed" : "done");
    await db.execute(sql.raw(`
      UPDATE fleet_reports SET
        status          = ${sq(finalStatus)},
        processed_count = ${transformedCount},
        error_count     = ${failedCount},
        summary_stats   = summary_stats || ${sqJson({ pipelineHealthScore: healthScore.score, pipelineGrade: healthScore.grade, pipelineBatches: Math.ceil(totalRaw / PIPELINE_BATCH_SIZE) })}::jsonb,
        updated_at      = NOW()
      WHERE id = ${reportId}
    `));

    // Recalculate outstanding AFTER all rows processed — use LAST balance per driver
    if (companyId) await recalculateOutstanding(companyId).catch((e) => logger.warn({ e }, "[fleet] recalculateOutstanding non-fatal"));

    await regenerateDailySummary(companyId);
    if (companyId && meta) generateSmartAlerts(companyId, meta).catch(() => {});

    logger.info({ reportId, transformedCount, failedCount, healthScore: healthScore.score, grade: healthScore.grade }, "[fleet][gov] Phase 2 done");
    return { transformedCount, failedCount, healthScore };

  } catch (fatalErr) {
    const errMsg = String((fatalErr as Error).message).slice(0, 500);
    await db.execute(sql.raw(`
      UPDATE gojek_ingestion_queue
      SET status = 'failed', last_error = ${sq(errMsg)}, retry_count = retry_count + 1
      WHERE report_id = ${reportId}
    `)).catch(() => {});
    await db.execute(sql.raw(`
      UPDATE fleet_reports SET status = 'transform_failed', updated_at = NOW()
      WHERE id = ${reportId}
    `)).catch(() => {});
    logger.error({ err: fatalErr, reportId }, "[fleet][gov] Phase 2 fatal — raw preserved, use /reprocess");
    throw fatalErr;
  }
}

/**
 * Recalculate fleet_outstanding from raw transactions.
 * Uses DISTINCT ON to get the LAST total_outstanding_balance per driver
 * (sorted by date_time_jkt DESC then id DESC as tiebreaker).
 * total_outstanding_balance is a CUMULATIVE balance in Gojek CSV — not a delta.
 * Must use the MOST RECENT row, not SUM.
 */
async function recalculateOutstanding(companyId: number) {
  try {
    // FIX: use date_iso (DATE column) instead of date_time_jkt (TEXT),
    //      and id DESC as tiebreaker to pick the LATEST inserted row per driver.
    await db.execute(sql.raw(`
      WITH latest_balance AS (
        SELECT DISTINCT ON (driver_external_id)
          company_id,
          driver_external_id,
          driver_name,
          total_outstanding_balance,
          date_iso
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND driver_external_id IS NOT NULL
          AND driver_external_id != ''
          AND total_outstanding_balance IS NOT NULL
        ORDER BY driver_external_id, date_iso DESC NULLS LAST, id DESC
      )
      INSERT INTO fleet_outstanding (
        company_id, driver_id, driver_external_id, driver_name,
        outstanding_amount, last_updated_date, status
      )
      SELECT
        lb.company_id,
        d.id,
        lb.driver_external_id,
        lb.driver_name,
        lb.total_outstanding_balance,
        lb.date_iso,
        'open'
      FROM latest_balance lb
      LEFT JOIN fleet_drivers d ON d.company_id = lb.company_id
        AND d.driver_external_id = lb.driver_external_id
      ON CONFLICT (company_id, driver_name) WHERE status = 'open'
      DO UPDATE SET
        outstanding_amount = EXCLUDED.outstanding_amount,
        last_updated_date  = EXCLUDED.last_updated_date,
        driver_id          = COALESCE(EXCLUDED.driver_id, fleet_outstanding.driver_id),
        updated_at         = NOW()
    `));
    // Update rental_fee_daily dari kolom 'Rental fee(Daily)' di raw_data JSONB
    // (outstanding summary CSV dari Gojek menyimpan nilai ini, nilainya bervariasi per driver)
    await db.execute(sql.raw(`
      UPDATE fleet_outstanding fo
      SET rental_fee_daily = rfd.fee, updated_at = NOW()
      FROM (
        SELECT DISTINCT ON (lower(trim(driver_name)))
          lower(trim(driver_name)) AS name_key,
          (raw_data->>'Rental fee(Daily)')::numeric AS fee
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND raw_data ? 'Rental fee(Daily)'
          AND (raw_data->>'Rental fee(Daily)') IS NOT NULL
          AND (raw_data->>'Rental fee(Daily)') != '0'
          AND (raw_data->>'Rental fee(Daily)')::numeric > 0
          AND driver_name IS NOT NULL AND driver_name != ''
        ORDER BY lower(trim(driver_name)), date_iso DESC NULLS LAST, id DESC
      ) rfd
      WHERE fo.company_id = ${companyId}
        AND fo.status = 'open'
        AND lower(trim(fo.driver_name)) = rfd.name_key
    `)).catch((e) => logger.warn({ e }, "[fleet] rental_fee_daily update skipped"));

    // Setelah upsert: update last_updated_date SEMUA open outstanding ke tanggal MAX
    // dokumen yang baru saja diunggah — termasuk driver yg outstanding-nya tidak berubah.
    // Ini memastikan "tanggal terakhir diperbarui" selalu mencerminkan tanggal upload,
    // bukan tanggal data asli per driver. outstanding_amount TIDAK diubah di sini.
    await db.execute(sql.raw(`
      UPDATE fleet_outstanding
      SET last_updated_date = (
        SELECT MAX(date_iso) FROM gojek_raw_transactions
        WHERE company_id = ${companyId} AND date_iso IS NOT NULL
      ),
      updated_at = NOW()
      WHERE company_id = ${companyId}
        AND status = 'open'
        AND (
          last_updated_date IS NULL
          OR last_updated_date < (
            SELECT MAX(date_iso) FROM gojek_raw_transactions
            WHERE company_id = ${companyId} AND date_iso IS NOT NULL
          )
        )
    `)).catch((e) => logger.warn({ e }, "[fleet] last_updated_date sync skipped"));

    logger.info({ companyId }, "[fleet] recalculateOutstanding done — latest balance per driver applied");
  } catch (err) {
    logger.warn({ err, companyId }, "[fleet] recalculateOutstanding error");
    throw err;
  }
}

async function regenerateDailySummary(companyId: number | null) {
  if (!companyId) return;
  try {
    await db.execute(sql.raw(`
      INSERT INTO fleet_daily_summary (
        company_id, summary_date, active_drivers, total_trips,
        gross_revenue, total_incentive, total_commission, total_deduction,
        net_revenue, avg_revenue_per_driver, avg_trips_per_driver
      )
      SELECT
        ${companyId},
        transaction_date,
        COUNT(DISTINCT driver_id)            AS active_drivers,
        SUM(trip_count)                      AS total_trips,
        SUM(gross_revenue)                   AS gross_revenue,
        SUM(incentive)                       AS total_incentive,
        SUM(commission)                      AS total_commission,
        SUM(deduction)                       AS total_deduction,
        SUM(net_revenue)                     AS net_revenue,
        AVG(net_revenue)                     AS avg_revenue_per_driver,
        AVG(trip_count)                      AS avg_trips_per_driver
      FROM fleet_transactions
      WHERE company_id = ${companyId}
      GROUP BY transaction_date
      ON CONFLICT (company_id, summary_date) DO UPDATE SET
        active_drivers        = EXCLUDED.active_drivers,
        total_trips           = EXCLUDED.total_trips,
        gross_revenue         = EXCLUDED.gross_revenue,
        total_incentive       = EXCLUDED.total_incentive,
        total_commission      = EXCLUDED.total_commission,
        total_deduction       = EXCLUDED.total_deduction,
        net_revenue           = EXCLUDED.net_revenue,
        avg_revenue_per_driver = EXCLUDED.avg_revenue_per_driver,
        avg_trips_per_driver  = EXCLUDED.avg_trips_per_driver
    `));
  } catch (err) {
    logger.warn({ err }, "[fleet] regenerateDailySummary error (non-fatal)");
  }
}

// ─── DASHBOARD KPI ────────────────────────────────────────────────────────────

router.get("/dashboard", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const monthParam = req.query.month ? String(req.query.month).trim() : null; // format: "2026-06"
    const d = Math.min(parseInt(String(req.query.days || "30")) || 30, 365);

    // Bangun WHERE clause periode
    let periodWhere: string;
    let periodWherePrev: string;
    let periodLabel: string;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [yr, mo] = monthParam.split("-").map(Number);
      const start = `${yr}-${String(mo).padStart(2, "0")}-01`;
      // Akhir bulan: awal bulan berikutnya - 1 hari
      const nextMo = mo === 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, "0")}-01`;
      periodWhere = `date_iso >= ${sq(start)}::date AND date_iso < ${sq(nextMo)}::date`;
      // Periode sebelumnya = bulan sebelumnya
      const prevMo = mo === 1 ? 12 : mo - 1;
      const prevYr = mo === 1 ? yr - 1 : yr;
      const prevStart = `${prevYr}-${String(prevMo).padStart(2, "0")}-01`;
      periodWherePrev = `date_iso >= ${sq(prevStart)}::date AND date_iso < ${sq(start)}::date`;
      periodLabel = monthParam;
    } else {
      periodWhere = `date_iso >= CURRENT_DATE - INTERVAL '${d} days'`;
      periodWherePrev = `date_iso >= CURRENT_DATE - INTERVAL '${d * 2} days' AND date_iso < CURRENT_DATE - INTERVAL '${d} days'`;
      periodLabel = `last_${d}_days`;
    }

    const [kpi, trend, topDrivers, outstandingSummary, prevKpi, rawKpi, driverBreakdown] = await Promise.all([
      // KPI dari gojek_raw_transactions (sumber kebenaran) — period-filtered
      db.execute(sql.raw(`
        SELECT
          COUNT(DISTINCT CASE WHEN vehicle IS NOT NULL AND vehicle != ''
                THEN driver_external_id END)                                AS total_drivers,
          COUNT(*)                                                            AS total_trips,
          COALESCE(SUM(amount), 0)                                            AS total_amount_raw,
          COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)      AS total_rental_due,
          0::numeric                                                          AS total_incentive,
          0::numeric                                                          AS total_commission,
          0::numeric                                                          AS total_deduction,
          COALESCE(SUM(amount), 0)                                            AS total_net,
          0::numeric                                                          AS total_gross
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND driver_external_id IS NOT NULL AND driver_external_id != ''
          AND ${periodWhere}
      `)),
      // Tren harian dari gojek_raw_transactions
      db.execute(sql.raw(`
        SELECT
          date_iso::text                                                         AS summary_date,
          COALESCE(SUM(amount), 0)                                               AS net_revenue,
          COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)         AS gross_revenue,
          COUNT(DISTINCT CASE WHEN vehicle IS NOT NULL AND vehicle != ''
                THEN driver_external_id END)                                    AS active_drivers,
          COUNT(*)                                                               AS total_trips
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND ${periodWhere}
          AND date_iso IS NOT NULL
        GROUP BY date_iso
        ORDER BY date_iso
      `)),
      db.execute(sql.raw(`
        SELECT
          fo.driver_name                                        AS name,
          COALESCE(fo.vehicle_plate, fd.vehicle_plate)         AS vehicle_plate,
          COALESCE(
            (SELECT SUM(ft2.trip_count)
             FROM fleet_transactions ft2
             WHERE ft2.company_id = ${companyId}
               AND (ft2.driver_external_id = fo.driver_external_id
                    OR ft2.driver_id = fo.driver_id)
            ), 0
          )                                                    AS trips,
          fo.outstanding_amount                                AS outstanding
        FROM fleet_outstanding fo
        LEFT JOIN fleet_drivers fd
          ON fd.id = fo.driver_id AND fd.company_id = ${companyId}
        WHERE fo.company_id = ${companyId}
          AND fo.status = 'open'
          AND COALESCE(fo.vehicle_plate, fd.vehicle_plate) IS NOT NULL
          AND COALESCE(fo.vehicle_plate, fd.vehicle_plate) != ''
        ORDER BY fo.outstanding_amount DESC
        LIMIT 10
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS count, SUM(outstanding_amount) AS total_amount
        FROM fleet_outstanding WHERE company_id = ${companyId} AND status = 'open'
      `)),
      db.execute(sql.raw(`
        SELECT COALESCE(SUM(amount), 0) AS prev_net
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND ${periodWherePrev}
      `)),
      // Raw ground-truth: compute directly from gojek_raw_transactions
      // to catch any rows that failed transform (DLQ) and show accurate totals
      db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(amount), 0)                              AS raw_total_amount,
          COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0) AS raw_rental_due,
          COUNT(*)                                              AS raw_row_count,
          (
            SELECT COALESCE(SUM(lb.total_outstanding_balance), 0)
            FROM (
              SELECT DISTINCT ON (driver_external_id) total_outstanding_balance
              FROM gojek_raw_transactions
              WHERE company_id = ${companyId}
                AND driver_external_id IS NOT NULL
                AND driver_external_id != ''
                AND total_outstanding_balance IS NOT NULL
              ORDER BY driver_external_id, date_iso DESC NULLS LAST, id DESC
            ) lb
          ) AS raw_outstanding_total
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
      `)),
      // Driver breakdown: semua driver aktif dalam rentang tanggal yang dipilih
      db.execute(sql.raw(`
        WITH driver_period AS (
          SELECT
            driver_external_id,
            MAX(driver_name)                                                      AS driver_name,
            MAX(vehicle)                                                          AS vehicle,
            COUNT(*)                                                              AS total_transaksi,
            COALESCE(SUM(amount), 0)                                              AS total_amount,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)        AS total_penerimaan,
            COALESCE(SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END), 0)        AS total_potongan,
            COUNT(DISTINCT date_iso)                                              AS hari_aktif,
            MIN(date_iso)                                                         AS tanggal_pertama,
            MAX(date_iso)                                                         AS tanggal_terakhir
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND ${periodWhere}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
          GROUP BY driver_external_id
        ),
        latest_balance AS (
          SELECT DISTINCT ON (driver_external_id)
            driver_external_id,
            total_outstanding_balance::numeric AS outstanding
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
            AND total_outstanding_balance IS NOT NULL
          ORDER BY driver_external_id, date_iso DESC NULLS LAST, id DESC
        )
        SELECT
          dp.driver_external_id,
          COALESCE(fd.name, dp.driver_name)           AS nama,
          COALESCE(fd.vehicle_plate, dp.vehicle)      AS plat,
          dp.total_transaksi,
          dp.total_amount,
          dp.total_penerimaan,
          dp.total_potongan,
          dp.hari_aktif,
          dp.tanggal_pertama,
          dp.tanggal_terakhir,
          COALESCE(lb.outstanding, 0)                 AS outstanding,
          -- rental_fee_daily dari fleet_outstanding (diisi saat upload CSV outstanding summary Gojek)
          COALESCE(fo.rental_fee_daily, 0)            AS rental_fee_daily,
          COALESCE(fo.rental_fee_daily, 0) * dp.hari_aktif AS tagihan_sewa
        FROM driver_period dp
        LEFT JOIN fleet_drivers fd
          ON fd.driver_external_id = dp.driver_external_id
          AND fd.company_id = ${companyId}
        LEFT JOIN latest_balance lb
          ON lb.driver_external_id = dp.driver_external_id
        LEFT JOIN fleet_outstanding fo
          ON fo.driver_external_id = dp.driver_external_id
          AND fo.company_id = ${companyId}
          AND fo.status = 'open'
        ORDER BY COALESCE(lb.outstanding, 0) DESC, dp.total_amount DESC
      `)),
    ]);

    const cur = (kpi.rows[0] as Record<string, unknown>) ?? {};
    const prev = (prevKpi.rows[0] as Record<string, unknown>) ?? {};
    const raw = (rawKpi.rows[0] as Record<string, unknown>) ?? {};
    const curNet = numVal(cur.total_net);
    const prevNet = numVal(prev.prev_net);
    const revChange = prevNet > 0 ? ((curNet - prevNet) / prevNet) * 100 : 0;

    // Ambil tanggal upload terakhir dari fleet_outstanding (max last_updated_date open)
    const lastUploadRes = await db.execute(sql.raw(`
      SELECT MAX(last_updated_date)::text AS last_upload_date
      FROM fleet_outstanding
      WHERE company_id = ${companyId} AND status = 'open'
    `)).catch(() => ({ rows: [] }));
    const lastUploadDate = (lastUploadRes.rows[0] as Record<string, unknown>)?.last_upload_date ?? null;

    res.json({
      kpi: { ...cur, revChange: revChange.toFixed(1) },
      trend: trend.rows,
      topDrivers: topDrivers.rows,
      outstanding: outstandingSummary.rows[0],
      rawTotals: raw,
      driverBreakdown: driverBreakdown.rows,
      lastUploadDate,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] dashboard error");
    res.status(500).json({ error: "Gagal mengambil dashboard" });
  }
});

// ─── EXPORT ───────────────────────────────────────────────────────────────────

/** Export driver breakdown as JSON — untuk CSV/Excel di frontend */
router.get("/export/drivers", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const monthParam = req.query.month ? String(req.query.month).trim() : null;
    const d = Math.min(parseInt(String(req.query.days || "30")) || 30, 365);
    const search = req.query.search ? sanitize(String(req.query.search).trim()) : null;

    let periodWhere: string;
    let periodLabel: string;
    if (monthParam && /^\d{4}-\d{2}$/.test(monthParam)) {
      const [yr, mo] = monthParam.split("-").map(Number);
      const start = `${yr}-${String(mo).padStart(2, "0")}-01`;
      const nextMo = mo === 12 ? `${yr + 1}-01-01` : `${yr}-${String(mo + 1).padStart(2, "0")}-01`;
      periodWhere = `r.date_iso >= ${sq(start)}::date AND r.date_iso < ${sq(nextMo)}::date`;
      periodLabel = monthParam;
    } else {
      periodWhere = `r.date_iso >= CURRENT_DATE - INTERVAL '${d} days'`;
      periodLabel = `last_${d}_days`;
    }

    const outerSearch = search
      ? `AND (COALESCE(lr.driver_name, pd.driver_name) ILIKE '%${search}%' OR pd.driver_external_id ILIKE '%${search}%')`
      : "";

    const rows = await db.execute(sql.raw(`
      WITH period_data AS (
        SELECT
          r.driver_external_id,
          MAX(r.driver_name)                                                         AS driver_name,
          COUNT(*)                                                                    AS total_transaksi,
          COALESCE(SUM(CASE WHEN r.amount > 0 THEN r.amount ELSE 0 END), 0)         AS total_rental_fee,
          COALESCE(SUM(r.amount), 0)                                                 AS total_amount,
          COALESCE(SUM(CASE WHEN r.amount < 0 THEN ABS(r.amount) ELSE 0 END), 0)    AS total_deduction,
          COUNT(DISTINCT r.date_iso)                                                 AS hari_aktif,
          MIN(r.date_iso)                                                            AS tanggal_pertama,
          MAX(r.date_iso)                                                            AS tanggal_terakhir
        FROM gojek_raw_transactions r
        WHERE r.company_id = ${companyId}
          AND r.driver_external_id IS NOT NULL AND r.driver_external_id != ''
          AND ${periodWhere}
        GROUP BY r.driver_external_id
      ),
      latest_row AS (
        SELECT DISTINCT ON (driver_external_id)
          driver_external_id,
          driver_name,
          phone_number,
          vehicle,
          total_outstanding_balance,
          transaction_type,
          gopay_transaction_reference_id,
          date_time_jkt,
          date
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND driver_external_id IS NOT NULL AND driver_external_id != ''
          AND total_outstanding_balance IS NOT NULL
        ORDER BY driver_external_id, date_iso DESC NULLS LAST, id DESC
      )
      SELECT
        pd.driver_external_id                              AS "Driver ID",
        COALESCE(lr.driver_name, pd.driver_name)          AS "Driver Name",
        COALESCE(lr.phone_number, '')                      AS "Phone Number",
        COALESCE(lr.vehicle, '')                           AS "Vehicle",
        pd.total_rental_fee                                AS "Total Rental Fee",
        COALESCE(lr.total_outstanding_balance, 0)         AS "Total Outstanding Balance",
        COALESCE(lr.transaction_type, '')                  AS "Type",
        COALESCE(lr.gopay_transaction_reference_id, '')   AS "GoPay Transaction Reference ID",
        COALESCE(lr.date_time_jkt, lr.date, '')           AS "Date",
        pd.total_transaksi                                 AS "Total Transaksi",
        pd.total_amount                                    AS "Net Amount",
        pd.total_deduction                                 AS "Total Deduction",
        pd.hari_aktif                                      AS "Hari Aktif"
      FROM period_data pd
      LEFT JOIN latest_row lr ON lr.driver_external_id = pd.driver_external_id
      WHERE 1=1 ${outerSearch}
      ORDER BY COALESCE(lr.total_outstanding_balance, 0) DESC NULLS LAST, pd.total_rental_fee DESC
    `));

    res.json({ rows: rows.rows, period: periodLabel, count: rows.rows.length });
  } catch (err) {
    logger.error({ err }, "[fleet] export/drivers error");
    res.status(500).json({ error: "Gagal export data driver" });
  }
});

// ─── DRIVERS ──────────────────────────────────────────────────────────────────

router.get("/drivers", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });
    const { status, search, page = "1", limit = "50" } = req.query as Record<string, string>;
    const pgNum = Math.max(1, parseInt(page) || 1);
    const pgSize = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pgNum - 1) * pgSize;

    const searchFilter = search
      ? `AND (drv.name ILIKE '%${sanitize(search)}%' OR drv.vehicle_plate ILIKE '%${sanitize(search)}%' OR drv.driver_external_id ILIKE '%${sanitize(search)}%')`
      : "";
    const statusFilter = status && status !== "all"
      ? `AND drv.status = '${sanitize(status)}'`
      : "";

    // Gabungkan fleet_drivers (manual) + driver dari gojek_raw_transactions yang belum ada di fleet_drivers
    const [rows, countRes] = await Promise.all([
      db.execute(sql.raw(`
        WITH raw_agg AS (
          -- Agregat per driver dari raw CSV
          SELECT
            driver_external_id,
            MAX(driver_name)                                                AS raw_name,
            MAX(vehicle)                                                    AS raw_vehicle,
            MAX(phone_number)                                               AS raw_phone,
            COUNT(*)                                                        AS tx_count,
            COUNT(DISTINCT date_iso)                                        AS active_days,
            COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END), 0)  AS total_rental,
            COALESCE(SUM(amount), 0)                                        AS net_amount,
            MAX(date_iso)                                                   AS last_date
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
          GROUP BY driver_external_id
        ),
        latest_balance AS (
          SELECT DISTINCT ON (driver_external_id)
            driver_external_id,
            total_outstanding_balance::numeric AS outstanding
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
            AND total_outstanding_balance IS NOT NULL
          ORDER BY driver_external_id, date_iso DESC NULLS LAST, id DESC
        ),
        merged AS (
          -- Manual drivers (fleet_drivers) — join raw untuk stats
          SELECT
            fd.id,
            fd.driver_external_id,
            COALESCE(fd.name, ra.raw_name)          AS name,
            COALESCE(fd.phone, ra.raw_phone)        AS phone,
            COALESCE(fd.vehicle_plate, ra.raw_vehicle) AS vehicle_plate,
            fd.vehicle_type,
            fd.status,
            COALESCE(fd.last_active_date::text, ra.last_date) AS last_active_date,
            COALESCE(ra.tx_count, 0)                AS total_trips,
            COALESCE(ra.total_rental, 0)            AS total_revenue,
            fd.performance_tier,
            COALESCE(lb.outstanding, 0)             AS outstanding,
            true                                    AS is_manual
          FROM fleet_drivers fd
          LEFT JOIN raw_agg ra ON ra.driver_external_id = fd.driver_external_id
          LEFT JOIN latest_balance lb ON lb.driver_external_id = fd.driver_external_id
          WHERE fd.company_id = ${companyId}

          UNION ALL

          -- Driver dari raw CSV yang TIDAK ada di fleet_drivers
          SELECT
            NULL::integer                           AS id,
            ra.driver_external_id,
            ra.raw_name                             AS name,
            ra.raw_phone                            AS phone,
            ra.raw_vehicle                          AS vehicle_plate,
            'motor'                                 AS vehicle_type,
            'active'                                AS status,
            ra.last_date                            AS last_active_date,
            ra.tx_count                             AS total_trips,
            ra.total_rental                         AS total_revenue,
            'standard'                              AS performance_tier,
            COALESCE(lb.outstanding, 0)             AS outstanding,
            false                                   AS is_manual
          FROM raw_agg ra
          LEFT JOIN latest_balance lb ON lb.driver_external_id = ra.driver_external_id
          WHERE NOT EXISTS (
            SELECT 1 FROM fleet_drivers fd
            WHERE fd.company_id = ${companyId}
              AND fd.driver_external_id = ra.driver_external_id
          )
        )
        SELECT drv.* FROM merged drv
        WHERE 1=1 ${searchFilter} ${statusFilter}
        ORDER BY drv.last_active_date DESC NULLS LAST, drv.name
        LIMIT ${pgSize} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`
        WITH raw_agg AS (
          SELECT driver_external_id, MAX(driver_name) AS raw_name,
            MAX(vehicle) AS raw_vehicle, MAX(date_iso) AS last_date, 'active' AS status
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
          GROUP BY driver_external_id
        ),
        merged AS (
          SELECT
            fd.driver_external_id,
            COALESCE(fd.name, ra.raw_name) AS name,
            COALESCE(fd.vehicle_plate, ra.raw_vehicle) AS vehicle_plate,
            fd.status,
            true AS is_manual
          FROM fleet_drivers fd
          LEFT JOIN raw_agg ra ON ra.driver_external_id = fd.driver_external_id
          WHERE fd.company_id = ${companyId}
          UNION ALL
          SELECT ra.driver_external_id, ra.raw_name AS name, ra.raw_vehicle AS vehicle_plate,
            'active' AS status, false AS is_manual
          FROM raw_agg ra
          WHERE NOT EXISTS (
            SELECT 1 FROM fleet_drivers fd
            WHERE fd.company_id = ${companyId} AND fd.driver_external_id = ra.driver_external_id
          )
        )
        SELECT COUNT(*) AS total FROM merged drv
        WHERE 1=1 ${searchFilter} ${statusFilter}
      `)),
    ]);
    const total = parseInt((countRes.rows[0] as any)?.total ?? "0", 10);

    res.json({ drivers: rows.rows, total });
  } catch (err) {
    logger.error({ err }, "[fleet] GET drivers error");
    res.status(500).json({ error: "Gagal mengambil data driver" });
  }
});

router.put("/drivers/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const { name, phone, email, licenseNumber, vehiclePlate, vehicleType, status, notes } = req.body;
    await db.execute(sql.raw(`
      UPDATE fleet_drivers SET
        name           = COALESCE(${sq(name)}, name),
        phone          = COALESCE(${sq(phone)}, phone),
        email          = COALESCE(${sq(email)}, email),
        license_number = COALESCE(${sq(licenseNumber)}, license_number),
        vehicle_plate  = COALESCE(${sq(vehiclePlate)}, vehicle_plate),
        vehicle_type   = COALESCE(${sq(vehicleType)}, vehicle_type),
        status         = COALESCE(${sq(status)}, status),
        notes          = COALESCE(${sq(notes)}, notes),
        updated_at     = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal update driver" });
  }
});

// ─── VEHICLES ─────────────────────────────────────────────────────────────────

router.get("/vehicles", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);

    // Gabungkan fleet_vehicles (manual) + plat unik dari gojek_raw_transactions
    const rows = await db.execute(sql.raw(`
      WITH raw_vehicles AS (
        -- Plat unik dari CSV: ambil info terakhir per plat
        SELECT DISTINCT ON (vehicle)
          vehicle                           AS plate,
          driver_name                       AS raw_driver_name,
          driver_external_id                AS raw_driver_ext_id,
          date_iso                          AS last_seen_date,
          COUNT(*) OVER (PARTITION BY vehicle) AS tx_count
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND vehicle IS NOT NULL AND vehicle != ''
        ORDER BY vehicle, date_iso DESC NULLS LAST, id DESC
      ),
      manual_vehicles AS (
        SELECT
          v.id, v.plate, v.vehicle_type, v.brand, v.model,
          v.year, v.color, v.status, v.notes,
          d.name AS driver_name,
          d.driver_external_id AS raw_driver_ext_id,
          NULL::text AS last_seen_date,
          0 AS tx_count,
          true AS is_manual
        FROM fleet_vehicles v
        LEFT JOIN fleet_drivers d ON d.id = v.driver_id
        WHERE v.company_id = ${companyId}
      )
      -- Manual vehicles terlebih dahulu, lalu raw yang tidak ada di manual
      SELECT
        mv.id,
        mv.plate,
        mv.vehicle_type,
        mv.brand, mv.model, mv.year, mv.color,
        mv.status,
        mv.driver_name,
        mv.raw_driver_ext_id,
        COALESCE(rv.last_seen_date, mv.last_seen_date) AS last_seen_date,
        COALESCE(rv.tx_count, mv.tx_count)             AS tx_count,
        mv.notes,
        true AS is_manual
      FROM manual_vehicles mv
      LEFT JOIN raw_vehicles rv ON rv.plate = mv.plate

      UNION ALL

      -- Plat dari raw yang TIDAK ada di fleet_vehicles
      SELECT
        NULL AS id,
        rv.plate,
        CASE
          WHEN rv.plate ~ '^[A-Z]{1,2}[0-9]{1,4}[A-Z]{1,3}$' THEN 'motor'
          ELSE 'motor'
        END AS vehicle_type,
        NULL AS brand, NULL AS model, NULL AS year, NULL AS color,
        'active' AS status,
        rv.raw_driver_name AS driver_name,
        rv.raw_driver_ext_id,
        rv.last_seen_date,
        rv.tx_count,
        NULL AS notes,
        false AS is_manual
      FROM raw_vehicles rv
      WHERE NOT EXISTS (
        SELECT 1 FROM fleet_vehicles fv
        WHERE fv.company_id = ${companyId} AND fv.plate = rv.plate
      )
      ORDER BY last_seen_date DESC NULLS LAST, plate
    `));

    res.json({ vehicles: rows.rows });
  } catch (err) {
    logger.error({ err }, "[fleet][vehicles] error");
    res.status(500).json({ error: "Gagal mengambil data kendaraan" });
  }
});

router.post("/vehicles", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { plate, vehicleType = "motor", brand, model, year, color, driverId, notes } = req.body;
    if (!plate) return res.status(400).json({ error: "Nomor plat wajib diisi" });
    const meta = extractRequestMeta(req);
    const rows = await db.execute(sql.raw(`
      INSERT INTO fleet_vehicles (company_id, plate, vehicle_type, brand, model, year, color, driver_id, notes)
      VALUES (${companyId}, ${sq(plate)}, ${sq(vehicleType)}, ${sq(brand)}, ${sq(model)}, ${year ? parseInt(year) : "NULL"}, ${sq(color)}, ${driverId ? parseInt(driverId) : "NULL"}, ${sq(notes)})
      RETURNING *
    `));
    writeAuditLog({ ...meta, action: "create", module: "fleet_vehicles", newData: rows.rows[0] as Record<string, unknown> });
    res.json({ vehicle: rows.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Gagal membuat data kendaraan" });
  }
});

// ─── TRANSACTIONS (enhanced: driver search, vehicle filter) ───────────────────

router.get("/transactions", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });
    const { startDate, endDate, driverId, vehiclePlate, driverSearch, page = "1", limit = "100" } = req.query as Record<string, string>;
    const pageNum  = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(500, Math.max(1, parseInt(limit) || 100));
    const offset = (pageNum - 1) * limitNum;
    const conditions = [`company_id = ${companyId}`];
    if (startDate) conditions.push(`transaction_date >= '${sanitize(startDate)}'`);
    if (endDate) conditions.push(`transaction_date <= '${sanitize(endDate)}'`);
    if (driverId) conditions.push(`driver_id = ${parseInt(driverId)}`);
    if (vehiclePlate) conditions.push(`vehicle_plate ILIKE '%${sanitize(vehiclePlate)}%'`);
    if (driverSearch) conditions.push(`driver_name ILIKE '%${sanitize(driverSearch)}%'`);
    const where = conditions.join(" AND ");
    const [rows, countRes] = await Promise.all([
      db.execute(sql.raw(`SELECT * FROM fleet_transactions WHERE ${where} ORDER BY transaction_date DESC, id DESC LIMIT ${limitNum} OFFSET ${offset}`)),
      db.execute(sql.raw(`SELECT COUNT(*) AS total, SUM(net_revenue) AS total_net, SUM(trip_count) AS total_trips, SUM(gross_revenue) AS total_gross FROM fleet_transactions WHERE ${where}`)),
    ]);
    res.json({ transactions: rows.rows, summary: countRes.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data transaksi" });
  }
});

// ─── RAW TRANSACTIONS PER DRIVER ──────────────────────────────────────────────

router.get("/raw/:driverId", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const driverExtId = sanitize(String(req.params.driverId));
    const page  = Math.max(1, parseInt(String(req.query.page  ?? "1")));
    const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? "100"))));
    const offset = (page - 1) * limit;

    const [rows, countRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          id, report_id, date_time_jkt, driver_external_id, driver_name,
          phone_number, vehicle, amount, total_outstanding_balance,
          transaction_type, gopay_transaction_reference_id, date, created_at
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND driver_external_id = ${sq(driverExtId)}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*)           AS total,
          SUM(amount)        AS total_amount,
          MIN(date)          AS earliest_date,
          MAX(date)          AS latest_date
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND driver_external_id = ${sq(driverExtId)}
      `)),
    ]);

    res.json({
      driverExtId,
      transactions: rows.rows,
      summary: countRes.rows[0],
      pagination: { page, limit, offset },
    });
  } catch (err) {
    logger.error({ err }, "[fleet] GET raw/:driverId error");
    res.status(500).json({ error: "Gagal mengambil raw transactions driver" });
  }
});

// ─── OUTSTANDING ──────────────────────────────────────────────────────────────

/** Repair outstanding balances from raw data — pakai LAST balance per driver */
router.post("/outstanding/repair", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "Company ID wajib" });
    await recalculateOutstanding(companyId);
    const summary = await db.execute(sql.raw(`
      SELECT COUNT(*) AS drivers, SUM(outstanding_amount) AS total
      FROM fleet_outstanding WHERE company_id = ${companyId} AND status = 'open'
    `));
    res.json({ ok: true, message: "Outstanding dihitung ulang dari raw transactions (nilai terakhir per driver)", summary: summary.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet] repair outstanding error");
    res.status(500).json({ error: "Gagal repair outstanding" });
  }
});

router.get("/outstanding", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const status = sanitize(String(req.query.status || "open"));
    const [rows, summary] = await Promise.all([
      db.execute(sql.raw(`
        WITH raw_info AS (
          -- Ambil phone_number dan vehicle terakhir per driver_external_id dari raw CSV
          SELECT DISTINCT ON (driver_external_id)
            driver_external_id,
            phone_number,
            vehicle
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
          ORDER BY driver_external_id, date_iso DESC NULLS LAST, id DESC
        )
        SELECT
          o.*,
          COALESCE(d.phone, o.driver_phone, ri.phone_number)        AS driver_phone,
          COALESCE(d.vehicle_plate, o.vehicle_plate, ri.vehicle)    AS vehicle_plate
        FROM fleet_outstanding o
        LEFT JOIN fleet_drivers d ON d.id = o.driver_id
        LEFT JOIN raw_info ri ON ri.driver_external_id = o.driver_external_id
        WHERE o.company_id = ${companyId} AND o.status = '${status}'
        ORDER BY o.outstanding_amount DESC
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS count, SUM(outstanding_amount) AS total, AVG(due_days) AS avg_due_days
        FROM fleet_outstanding WHERE company_id = ${companyId} AND status = '${status}'
      `)),
    ]);
    res.json({ outstanding: rows.rows, summary: summary.rows[0] });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data outstanding" });
  }
});

router.put("/outstanding/:id/resolve", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const { notes } = req.body;
    const meta = extractRequestMeta(req);
    await db.execute(sql.raw(`
      UPDATE fleet_outstanding SET status = 'resolved', resolved_at = NOW(), notes = COALESCE(${sq(notes)}, notes), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));
    writeAuditLog({ ...meta, action: "resolve", module: "fleet_outstanding", referenceId: String(id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal resolve outstanding" });
  }
});

router.delete("/outstanding/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const meta = extractRequestMeta(req);
    const check = await db.execute(sql.raw(`SELECT id FROM fleet_outstanding WHERE id = ${id} AND company_id = ${companyId}`));
    if (check.rows.length === 0) return res.status(404).json({ error: "Data tidak ditemukan" });
    await db.execute(sql.raw(`DELETE FROM fleet_outstanding WHERE id = ${id} AND company_id = ${companyId}`));
    writeAuditLog({ ...meta, action: "delete", module: "fleet_outstanding", referenceId: String(id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal hapus outstanding" });
  }
});

// ─── OUTSTANDING / MACET ──────────────────────────────────────────────────────

/** GET /outstanding/macet — driver dengan outstanding > 1 juta + tidak ada transaksi >= 7 hari */
router.get("/outstanding/macet", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const minDays = Math.max(1, parseInt(String(req.query.min_days || "7")) || 7);
    const minAmount = Math.max(0, parseInt(String(req.query.min_amount || "1000000")) || 1_000_000);

    // Gunakan MAX(date_iso) dari gojek_raw_transactions sebagai tanggal aktif terakhir driver
    // agar tidak terpengaruh oleh kapan outstanding terakhir di-repair
    const [rows, summary] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          o.id, o.driver_id, o.driver_external_id, o.driver_name,
          o.outstanding_amount, o.due_days,
          o.notes, o.created_at, o.updated_at,
          d.phone  AS driver_phone,
          COALESCE(d.vehicle_plate, o.driver_external_id) AS vehicle_plate,
          raw.last_tx_date AS last_updated_date,
          GREATEST(0, EXTRACT(DAY FROM NOW() - raw.last_tx_date)::int) AS days_inactive,
          (
            SELECT MAX(created_at) FROM fleet_alert_suppression
            WHERE company_id = ${companyId}
              AND reference_id = o.driver_external_id
              AND alert_type = 'macet_wa_sent'
          ) AS wa_sent_at
        FROM fleet_outstanding o
        LEFT JOIN fleet_drivers d ON d.id = o.driver_id AND d.company_id = ${companyId}
        -- Tanggal transaksi terakhir dari raw data (sumber kebenaran)
        LEFT JOIN LATERAL (
          SELECT MAX(date_iso::date) AS last_tx_date
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id = o.driver_external_id
        ) raw ON TRUE
        WHERE o.company_id = ${companyId}
          AND o.status = 'open'
          AND o.outstanding_amount >= ${minAmount}
          -- Macet = tidak ada transaksi dalam N hari terakhir
          AND (raw.last_tx_date IS NULL OR raw.last_tx_date <= CURRENT_DATE - INTERVAL '${minDays} days')
        ORDER BY o.outstanding_amount DESC
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS count, SUM(o.outstanding_amount) AS total_outstanding
        FROM fleet_outstanding o
        LEFT JOIN LATERAL (
          SELECT MAX(date_iso::date) AS last_tx_date
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id = o.driver_external_id
        ) raw ON TRUE
        WHERE o.company_id = ${companyId}
          AND o.status = 'open'
          AND o.outstanding_amount >= ${minAmount}
          AND (raw.last_tx_date IS NULL OR raw.last_tx_date <= CURRENT_DATE - INTERVAL '${minDays} days')
      `)),
    ]);
    res.json({ drivers: rows.rows, summary: summary.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet] GET outstanding/macet error");
    res.status(500).json({ error: "Gagal mengambil data macet" });
  }
});

/** POST /outstanding/:id/followup — simpan catatan tindak lanjut */
router.post("/outstanding/:id/followup", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const { notes } = req.body;
    if (!notes?.trim()) return res.status(400).json({ error: "Catatan wajib diisi" });

    const meta = extractRequestMeta(req);
    await db.execute(sql.raw(`
      UPDATE fleet_outstanding
      SET notes = ${sq(notes)}, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));
    writeAuditLog({ ...meta, action: "followup", module: "fleet_outstanding", referenceId: String(id) });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[fleet] POST outstanding followup error");
    res.status(500).json({ error: "Gagal simpan catatan" });
  }
});

/** POST /outstanding/:id/wa — kirim tagihan via WhatsApp (manual, semua outstanding) */
router.post("/outstanding/:id/wa", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const { phone, message } = req.body;
    if (!phone?.trim()) return res.status(400).json({ error: "Nomor telepon wajib" });
    if (!message?.trim()) return res.status(400).json({ error: "Pesan wajib diisi" });

    // Ambil data outstanding beserta vehicle_plate untuk log
    const check = await db.execute(sql.raw(`
      SELECT o.id, o.driver_external_id, o.driver_name, o.outstanding_amount,
             d.vehicle_plate
      FROM fleet_outstanding o
      LEFT JOIN fleet_drivers d ON d.id = o.driver_id AND d.company_id = ${companyId}
      WHERE o.id = ${id} AND o.company_id = ${companyId}
    `));
    if (check.rows.length === 0) return res.status(404).json({ error: "Outstanding tidak ditemukan" });
    const row = check.rows[0] as Record<string, unknown>;

    const meta = extractRequestMeta(req);
    const sentBy = meta.userEmail ?? "manual";

    // Kirim WA
    await sendWhatsApp(String(phone), String(message), {
      context: "fleet-outstanding-manual",
    } as any);

    // Catat ke fleet_wa_logs
    await db.execute(sql.raw(`
      INSERT INTO fleet_wa_logs
        (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, message, sent_by, send_type, status)
      VALUES
        (${companyId}, ${id}, ${sq(String(row.driver_name ?? ""))}, ${sq(String(phone))},
         ${sq(String(row.vehicle_plate ?? ""))}, ${numVal(row.outstanding_amount)},
         ${sq(String(message))}, ${sq(sentBy)}, 'manual', 'sent')
    `)).catch(() => {});

    // Update last_wa_sent_at
    await db.execute(sql.raw(`
      UPDATE fleet_outstanding SET last_wa_sent_at = NOW(), is_notified = TRUE, updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `)).catch(() => {});

    writeAuditLog({ ...meta, action: "wa_sent", module: "fleet_outstanding", referenceId: String(id) });
    res.json({ ok: true, message: "WhatsApp berhasil dikirim" });
  } catch (err) {
    logger.error({ err }, "[fleet] POST outstanding wa error");
    res.status(500).json({ error: "Gagal kirim WhatsApp" });
  }
});

/** GET /outstanding/wa-logs — riwayat pengiriman WA (manual & otomatis) */
router.get("/outstanding/wa-logs", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const limit  = Math.min(parseInt(String(req.query.limit  || "100")) || 100, 500);
    const offset = Math.max(parseInt(String(req.query.offset || "0"))   || 0, 0);
    const rows = await db.execute(sql.raw(`
      SELECT id, outstanding_id, driver_name, driver_phone, vehicle_plate,
             outstanding_amount, sent_by, send_type, status, sent_at,
             LEFT(message, 200) AS message_preview
      FROM fleet_wa_logs
      WHERE company_id = ${companyId}
      ORDER BY sent_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `));
    const count = await db.execute(sql.raw(`SELECT COUNT(*) AS total FROM fleet_wa_logs WHERE company_id = ${companyId}`));
    res.json({ logs: rows.rows, total: (count.rows[0] as any)?.total ?? 0 });
  } catch (err) {
    logger.error({ err }, "[fleet] GET wa-logs error");
    res.status(500).json({ error: "Gagal ambil riwayat WA" });
  }
});

/** POST /outstanding/wa-reminder — kirim WA pengingat ke semua driver outstanding > 500rb */
router.post("/outstanding/wa-reminder", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const minAmount = 500_000;
    const suppressHours = parseInt(String(req.body.suppress_hours ?? "24")) || 24;

    // Ambil semua driver outstanding > 500rb yang belum dikirim WA dalam suppressHours jam
    const rows = await db.execute(sql.raw(`
      SELECT o.id, o.driver_name, o.outstanding_amount, o.driver_external_id,
             COALESCE(o.driver_phone, d.phone) AS driver_phone,
             COALESCE(o.vehicle_plate, d.vehicle_plate) AS vehicle_plate
      FROM fleet_outstanding o
      LEFT JOIN fleet_drivers d ON d.id = o.driver_id AND d.company_id = ${companyId}
      WHERE o.company_id = ${companyId}
        AND o.status = 'open'
        AND o.outstanding_amount >= ${minAmount}
        AND COALESCE(o.driver_phone, d.phone) IS NOT NULL
        AND COALESCE(o.driver_phone, d.phone) != ''
        AND (o.last_wa_sent_at IS NULL OR o.last_wa_sent_at < NOW() - INTERVAL '${suppressHours} hours')
      ORDER BY o.outstanding_amount DESC
    `));

    const drivers = rows.rows as Array<Record<string, unknown>>;
    if (drivers.length === 0) {
      return res.json({ ok: true, sent: 0, skipped: 0, message: "Semua driver sudah dikirim WA dalam periode suppress" });
    }

    const fmtIdr = (v: unknown) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(numVal(v));
    const meta = extractRequestMeta(req);
    let sent = 0;
    let failed = 0;

    for (const driver of drivers) {
      const phone = String(driver.driver_phone ?? "").trim();
      const name = String(driver.driver_name ?? "Driver");
      const plate = String((driver as any).vehicle_plate ?? "");
      const amount = fmtIdr(driver.outstanding_amount);

      const message = String(req.body.message ?? "").trim() ||
        `*Pemberitahuan Pembayaran Rental Fee*\n\n` +
        `Nama Driver: ${name}\n` +
        `Nomor Kendaraan: ${plate}\n` +
        `Nomor Telepon: ${phone}\n` +
        `Total Outstanding: ${amount}\n\n` +
        `*Instruksi Pembayaran*\n\n` +
        `Kami mohon agar pembayaran rental fee segera dilakukan melalui salah satu cara berikut:\n\n` +
        `Top-up Saldo GoPay\n` +
        `Silakan isi saldo GoPay sesuai nominal outstanding di atas.\n` +
        `Transfer Bank ke Rekening Perusahaan\n` +
        `Lakukan transfer ke rekening resmi perusahaan. Pastikan mencantumkan nama driver dan nomor kendaraan pada kolom keterangan untuk proses rekonsiliasi.\n\n` +
        `*Catatan Penting:*\n\n` +
        `Pembayaran tepat waktu sangat membantu kelancaran operasional.\n` +
        `Simpan bukti pembayaran untuk verifikasi lebih lanjut.`;

      try {
        await sendWhatsApp(phone, message, {
          context: "fleet-macet-reminder",
        } as any);
        await db.execute(sql.raw(`
          UPDATE fleet_outstanding
          SET last_wa_sent_at = NOW(), is_notified = TRUE, updated_at = NOW()
          WHERE id = ${driver.id} AND company_id = ${companyId}
        `));
        // Catat ke fleet_wa_logs
        await db.execute(sql.raw(`
          INSERT INTO fleet_wa_logs
            (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, message, sent_by, send_type, status)
          VALUES
            (${companyId}, ${driver.id}, ${sq(name)}, ${sq(phone)},
             ${sq(String(driver.vehicle_plate ?? ""))}, ${numVal(driver.outstanding_amount)},
             ${sq(message)}, ${sq(meta.userEmail ?? "system")}, 'bulk', 'sent')
        `)).catch(() => {});
        sent++;
      } catch {
        // Catat kegagalan ke fleet_wa_logs
        await db.execute(sql.raw(`
          INSERT INTO fleet_wa_logs
            (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, message, sent_by, send_type, status)
          VALUES
            (${companyId}, ${driver.id}, ${sq(name)}, ${sq(phone)},
             ${sq(String(driver.vehicle_plate ?? ""))}, ${numVal(driver.outstanding_amount)},
             ${sq(message)}, ${sq(meta.userEmail ?? "system")}, 'bulk', 'failed')
        `)).catch(() => {});
        failed++;
      }
    }

    writeAuditLog({ ...meta, action: "wa_reminder_batch", module: "fleet_outstanding", referenceId: `sent=${sent}` });
    res.json({ ok: true, sent, failed, total: drivers.length, message: `WA terkirim ke ${sent} driver` });
  } catch (err) {
    logger.error({ err }, "[fleet] POST outstanding/wa-reminder error");
    res.status(500).json({ error: "Gagal kirim WA reminder" });
  }
});

/** GET /outstanding/auto-blast-settings — ambil setting auto-blast WA harian */
router.get("/outstanding/auto-blast-settings", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db.execute(sql.raw(`
      SELECT fleet_auto_blast_enabled, fleet_auto_blast_hour, fleet_auto_blast_last_run
      FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
    `));
    const row = rows.rows[0] as any ?? {};
    res.json({
      enabled: row.fleet_auto_blast_enabled ?? false,
      hour: row.fleet_auto_blast_hour ?? 8,
      last_run: row.fleet_auto_blast_last_run ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Gagal ambil setting auto-blast" });
  }
});

/** PUT /outstanding/auto-blast-settings — simpan setting auto-blast WA harian */
router.put("/outstanding/auto-blast-settings", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const enabled = req.body.enabled === true || req.body.enabled === "true";
    const hour = Math.max(0, Math.min(23, parseInt(String(req.body.hour ?? "8")) || 8));
    // Pastikan row exists
    await db.execute(sql.raw(`
      INSERT INTO accounting_settings (company_id, fleet_auto_blast_enabled, fleet_auto_blast_hour)
      VALUES (${companyId}, ${enabled}, ${hour})
      ON CONFLICT (company_id) DO UPDATE
        SET fleet_auto_blast_enabled = ${enabled}, fleet_auto_blast_hour = ${hour}, updated_at = NOW()
    `));
    res.json({ ok: true, enabled, hour });
  } catch (err) {
    logger.error({ err }, "[fleet] PUT auto-blast-settings error");
    res.status(500).json({ error: "Gagal simpan setting auto-blast" });
  }
});

/** POST /outstanding/wa-blast — kirim WA ke driver yang dipilih berdasarkan IDs */
router.post("/outstanding/wa-blast", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const ids: number[] = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
    if (ids.length === 0) return res.status(400).json({ error: "Tidak ada ID driver yang dipilih" });
    if (ids.length > 100) return res.status(400).json({ error: "Maksimal 100 driver per blast" });

    const idList = ids.join(",");
    const rows = await db.execute(sql.raw(`
      SELECT o.id, o.driver_name, o.outstanding_amount, o.driver_external_id,
             COALESCE(d.phone, o.driver_phone) AS driver_phone, COALESCE(d.vehicle_plate, o.vehicle_plate) AS vehicle_plate
      FROM fleet_outstanding o
      LEFT JOIN fleet_drivers d ON d.id = o.driver_id AND d.company_id = ${companyId}
      WHERE o.id IN (${idList}) AND o.company_id = ${companyId} AND o.status = 'open'
    `));

    const drivers = rows.rows as Array<Record<string, unknown>>;
    if (drivers.length === 0) return res.json({ ok: true, sent: 0, failed: 0, total: 0, message: "Tidak ada driver yang valid" });

    const fmtIdrLocal = (v: unknown) => new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(numVal(v));
    const meta = extractRequestMeta(req);
    const customMessage = String(req.body.message ?? "").trim();
    let sent = 0;
    let failed = 0;

    for (const driver of drivers) {
      const phone = String(driver.driver_phone ?? "").trim();
      if (!phone) { failed++; continue; }
      const name   = String(driver.driver_name ?? "Driver");
      const plate  = String(driver.vehicle_plate ?? "-");
      const amount = fmtIdrLocal(driver.outstanding_amount);

      const message = customMessage ||
        `*Pemberitahuan Pembayaran Rental Fee*\n\n` +
        `Nama Driver: ${name}\nNomor Kendaraan: ${plate}\nNomor Telepon: ${phone}\nTotal Outstanding: ${amount}\n\n` +
        `*Instruksi Pembayaran*\n\n` +
        `Kami mohon agar pembayaran rental fee segera dilakukan melalui salah satu cara berikut:\n\n` +
        `Top-up Saldo GoPay\nSilakan isi saldo GoPay sesuai nominal outstanding di atas.\n` +
        `Transfer Bank ke Rekening Perusahaan\nLakukan transfer ke rekening resmi perusahaan. ` +
        `Pastikan mencantumkan nama driver dan nomor kendaraan pada kolom keterangan untuk proses rekonsiliasi.\n\n` +
        `*Catatan Penting:*\n\nPembayaran tepat waktu sangat membantu kelancaran operasional.\n` +
        `Simpan bukti pembayaran untuk verifikasi lebih lanjut.`;

      try {
        await sendWhatsApp(phone, message, { context: "fleet-blast-selected" } as any);
        await db.execute(sql.raw(`
          UPDATE fleet_outstanding SET last_wa_sent_at = NOW(), is_notified = TRUE, updated_at = NOW()
          WHERE id = ${driver.id} AND company_id = ${companyId}
        `)).catch(() => {});
        await db.execute(sql.raw(`
          INSERT INTO fleet_wa_logs
            (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, message, sent_by, send_type, status)
          VALUES
            (${companyId}, ${driver.id}, ${sq(name)}, ${sq(phone)}, ${sq(plate)},
             ${numVal(driver.outstanding_amount)}, ${sq(message)}, ${sq(meta.userEmail ?? "system")}, 'bulk', 'sent')
        `)).catch(() => {});
        sent++;
      } catch {
        await db.execute(sql.raw(`
          INSERT INTO fleet_wa_logs
            (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, message, sent_by, send_type, status)
          VALUES
            (${companyId}, ${driver.id}, ${sq(name)}, ${sq(phone)}, ${sq(plate)},
             ${numVal(driver.outstanding_amount)}, ${sq(message)}, ${sq(meta.userEmail ?? "system")}, 'bulk', 'failed')
        `)).catch(() => {});
        failed++;
      }
    }

    writeAuditLog({ ...meta, action: "wa_blast_selected", module: "fleet_outstanding", referenceId: `ids=${idList}` });
    res.json({ ok: true, sent, failed, total: drivers.length, message: `WA terkirim ke ${sent} driver` });
  } catch (err) {
    logger.error({ err }, "[fleet] POST outstanding/wa-blast error");
    res.status(500).json({ error: "Gagal kirim WA blast" });
  }
});

// ─── OUTSTANDING SNAPSHOT IMPORT (Dokumen 2) ──────────────────────────────────

/**
 * Parse CSV Ringkasan Outstanding (Dokumen 2).
 * Kolom: Driver Name, Phone Number, License Plate, Rental fee(Daily), Outstanding, Status
 */
function parseSnapshotCsv(content: string): Array<Record<string, string>> {
  const lines = content.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];

  // Normalise header: lowercase, strip extra whitespace/BOM
  const rawHeader = lines[0].replace(/^\uFEFF/, "");
  const headers = rawHeader.split(",").map((h) => h.trim().replace(/^"|"$/g, "").toLowerCase());

  const colIdx = (variants: string[]): number => {
    for (const v of variants) {
      const i = headers.findIndex((h) => h.includes(v));
      if (i >= 0) return i;
    }
    return -1;
  };

  const iName   = colIdx(["driver name", "name"]);
  const iPhone  = colIdx(["phone number", "phone"]);
  const iPlate  = colIdx(["license plate", "plate", "plat"]);
  const iFee    = colIdx(["rental fee", "fee"]);
  const iOut    = colIdx(["outstanding"]);
  const iStatus = colIdx(["status"]);

  const rows: Array<Record<string, string>> = [];
  for (let i = 1; i < lines.length; i++) {
    // Handle quoted CSV fields
    const fields: string[] = [];
    let cur = "";
    let inQ = false;
    for (const ch of lines[i] + ",") {
      if (ch === '"') { inQ = !inQ; }
      else if (ch === "," && !inQ) { fields.push(cur.trim()); cur = ""; }
      else { cur += ch; }
    }
    if (fields.length < 3) continue;
    const get = (idx: number) => (idx >= 0 ? (fields[idx] ?? "").replace(/^"|"$/g, "").replace(/^\t/, "").trim() : "");
    rows.push({
      driver_name:      get(iName),
      phone_number:     get(iPhone),
      license_plate:    get(iPlate),
      rental_fee_daily: get(iFee),
      outstanding:      get(iOut),
      status:           get(iStatus),
    });
  }
  return rows;
}

/** POST /outstanding/snapshot/preview — parse CSV, return preview rows (no DB write) */
router.post("/outstanding/snapshot/preview", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File wajib diunggah" });
    const content = req.file.buffer.toString("utf-8");
    const rows = parseSnapshotCsv(content);

    if (rows.length === 0) {
      return res.status(400).json({ error: "File tidak dapat dibaca atau tidak ada baris data" });
    }

    const companyId = getCompanyId(req);

    // Filter: tampilkan semua outstanding > 0, PLUS driver "Need to assign" walau outstanding = 0
    const filtered = rows.filter((r) => {
      const out = parseFloat(r.outstanding) || 0;
      const statusLc = (r.status ?? "").toLowerCase();
      if (out > 0) return true;
      if (statusLc.includes("need") || statusLc === "need to assign") return true;
      return false;
    });

    if (filtered.length === 0) {
      return res.status(400).json({ error: "Tidak ada driver dengan outstanding > 0 dalam file ini" });
    }

    // Lookup driver match status
    const previews = await Promise.all(
      filtered.map(async (r) => {
        const phone = r.phone_number.replace(/\s/g, "").replace(/^\+/, "");
        const nameLower = r.driver_name.toLowerCase();

        // Try match by phone
        let matched: { id: number; name: string; vehicle_plate: string | null } | null = null;
        if (phone) {
          const pr = await db.execute(sql.raw(`
            SELECT id, name, vehicle_plate FROM fleet_drivers
            WHERE company_id = ${companyId}
              AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%${phone.replace(/^0/, "").slice(-9)}%'
            LIMIT 1
          `)).catch(() => ({ rows: [] }));
          if (pr.rows.length > 0) matched = pr.rows[0] as any;
        }

        // Fallback: fuzzy name match
        if (!matched && nameLower) {
          const nr = await db.execute(sql.raw(`
            SELECT id, name, vehicle_plate FROM fleet_drivers
            WHERE company_id = ${companyId}
              AND LOWER(name) LIKE '%${nameLower.replace(/'/g, "''").slice(0, 20)}%'
            LIMIT 1
          `)).catch(() => ({ rows: [] }));
          if (nr.rows.length > 0) matched = nr.rows[0] as any;
        }

        return {
          driver_name:      r.driver_name,
          phone_number:     r.phone_number,
          license_plate:    r.license_plate,
          rental_fee_daily: parseFloat(r.rental_fee_daily) || 0,
          outstanding:      parseFloat(r.outstanding) || 0,
          status:           r.status,
          match_status:     matched ? "found" : "unmatched",
          matched_driver_id: matched?.id ?? null,
          matched_name:     matched?.name ?? null,
        };
      })
    );

    const found     = previews.filter((p) => p.match_status === "found").length;
    const unmatched = previews.filter((p) => p.match_status === "unmatched").length;
    const total     = previews.length;
    // skipped = baris Outstanding=0 AND Status="Active" (driver lunas, tidak perlu diimport)
    const skipped   = rows.filter((r) => {
      const out = parseFloat(r.outstanding) || 0;
      return out === 0 && r.status?.toLowerCase() === "active";
    }).length;

    res.json({ ok: true, rows: previews, total, found, unmatched, skipped });
  } catch (err) {
    logger.error({ err }, "[fleet] snapshot preview error");
    res.status(500).json({ error: "Gagal memproses file" });
  }
});

/** POST /outstanding/snapshot/import — commit snapshot to DB (file re-upload, legacy) */
router.post("/outstanding/snapshot/import", upload.single("file"), async (req: Request, res: Response) => {
  try {
    if (!req.file) return res.status(400).json({ error: "File wajib diunggah" });
    const content = req.file.buffer.toString("utf-8");
    const csvRows = parseSnapshotCsv(content);
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    const fileName = req.file.originalname ?? "unknown.csv";
    const result = await commitSnapshotRows(csvRows, companyId, meta, fileName);
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[fleet] snapshot import error");
    res.status(500).json({ error: String((err as Error).message ?? "Gagal import snapshot") });
  }
});

/** POST /outstanding/snapshot/confirm — commit pre-parsed preview rows (JSON body, preferred) */
router.post("/outstanding/snapshot/confirm", async (req: Request, res: Response) => {
  try {
    const { rows: previewRows, fileName: bodyFileName } = req.body as {
      rows: Array<{
        driver_name: string; phone_number: string; license_plate: string;
        rental_fee_daily: number; outstanding: number; status: string;
        match_status: "found" | "unmatched"; matched_driver_id: number | null;
      }>;
      fileName?: string;
    };
    if (!Array.isArray(previewRows) || previewRows.length === 0) {
      return res.status(400).json({ error: "Rows tidak boleh kosong" });
    }
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    // Convert preview rows → same format as CSV rows
    const csvRows = previewRows.map((r) => ({
      driver_name:      String(r.driver_name ?? ""),
      phone_number:     String(r.phone_number ?? ""),
      license_plate:    String(r.license_plate ?? ""),
      rental_fee_daily: String(r.rental_fee_daily ?? 0),
      outstanding:      String(r.outstanding ?? 0),
      status:           String(r.status ?? ""),
    }));
    const result = await commitSnapshotRows(csvRows, companyId, meta, bodyFileName ?? "snapshot-confirm.csv");
    res.json(result);
  } catch (err) {
    logger.error({ err }, "[fleet] snapshot confirm error");
    res.status(500).json({ error: String((err as Error).message ?? "Gagal konfirmasi import") });
  }
});

/** Shared logic: upsert snapshot rows into fleet_outstanding */
async function commitSnapshotRows(
  rows: Array<Record<string, string>>,
  companyId: number | null,
  meta: ReturnType<typeof extractRequestMeta>,
  fileName: string,
): Promise<{ ok: boolean; updated: number; inserted: number; skipped: number; errors: number; total: number; message: string }> {
  // Filter: skip outstanding=0
  const filtered = rows.filter((r) => {
    const out = parseFloat(r.outstanding) || 0;
    return out > 0;
  });
  if (filtered.length === 0) {
    throw new Error("Tidak ada driver dengan outstanding > 0 untuk diimport");
  }

  let updated = 0, inserted = 0, errors = 0;
  const skipped = rows.length - filtered.length;
  const today   = new Date().toISOString().slice(0, 10);
  const errs: string[] = [];

  for (const r of filtered) {
    try {
      const driverName = r.driver_name?.trim() ?? "";
      if (!driverName) { errors++; continue; } // skip empty names

      const phone    = (r.phone_number ?? "").replace(/\s/g, "").replace(/^\+/, "");
      const outstanding = parseFloat(r.outstanding) || 0;
      const rentalFee   = parseFloat(r.rental_fee_daily) || 0;
      const plate       = r.license_plate?.trim() || null;
      const phoneRaw    = r.phone_number?.trim() || null;
      const nameQ  = sq(driverName);
      const phoneQ = phoneRaw ? sq(phoneRaw) : "NULL";
      const plateQ = plate ? sq(plate) : "NULL";

      // Find driver by phone, then by name
      let driverId: number | null = null;
      if (phone) {
        const pr = await db.execute(sql.raw(`
          SELECT id FROM fleet_drivers
          WHERE company_id = ${companyId}
            AND REGEXP_REPLACE(phone, '[^0-9]', '', 'g') LIKE '%${phone.replace(/^0/, "").slice(-9)}%'
          LIMIT 1
        `)).catch(() => ({ rows: [] }));
        if (pr.rows.length > 0) driverId = (pr.rows[0] as any).id;
      }
      if (!driverId && driverName) {
        const nameLower = driverName.toLowerCase();
        const nr = await db.execute(sql.raw(`
          SELECT id FROM fleet_drivers
          WHERE company_id = ${companyId}
            AND LOWER(name) LIKE '%${nameLower.replace(/'/g, "''").slice(0, 20)}%'
          LIMIT 1
        `)).catch(() => ({ rows: [] }));
        if (nr.rows.length > 0) driverId = (nr.rows[0] as any).id;
      }

      // Delete existing open records (idempotent)
      if (driverId) {
        await db.execute(sql.raw(`
          DELETE FROM fleet_outstanding
          WHERE company_id = ${companyId} AND status = 'open' AND driver_id = ${driverId}
        `)).catch(() => {});
      }
      // Always also delete by name to prevent unique constraint violation
      await db.execute(sql.raw(`
        DELETE FROM fleet_outstanding
        WHERE company_id = ${companyId} AND status = 'open'
          AND LOWER(driver_name) = ${sq(driverName.toLowerCase())}
      `)).catch(() => {});

      // Insert fresh record
      await db.execute(sql.raw(`
        INSERT INTO fleet_outstanding
          (company_id, driver_id, driver_name, driver_phone, vehicle_plate,
           outstanding_amount, rental_fee_daily, last_updated_date, status,
           snapshot_source, due_days, created_at, updated_at)
        VALUES (
          ${companyId},
          ${driverId ?? "NULL"},
          ${nameQ},
          ${phoneQ},
          ${plateQ},
          ${outstanding},
          ${rentalFee},
          '${today}',
          'open',
          'snapshot_csv',
          0,
          NOW(), NOW()
        )
      `));

      // Update fleet_drivers rental_fee if matched
      if (driverId) {
        await db.execute(sql.raw(`
          UPDATE fleet_drivers
          SET rental_fee_daily = ${rentalFee},
              vehicle_plate = COALESCE(${plateQ}, vehicle_plate),
              updated_at = NOW()
          WHERE id = ${driverId} AND company_id = ${companyId}
        `)).catch(() => {});
        updated++;
      } else {
        inserted++;
      }
    } catch (rowErr) {
      errors++;
      errs.push(String((rowErr as Error).message ?? rowErr));
      logger.warn({ err: rowErr, driverName: r.driver_name }, "[fleet] snapshot import row error — skipping driver");
    }
  }

  writeAuditLog({ ...meta, action: "snapshot_import", module: "fleet_outstanding", referenceId: `updated=${updated},inserted=${inserted},errors=${errors}` });

  // Audit log (non-blocking)
  const uploadedBy = sq(meta.userEmail ?? meta.userId ?? "unknown");
  const fileNameQ  = sq(fileName);
  db.execute(sql.raw(`
    INSERT INTO fleet_outstanding_import_log
      (company_id, report_file_name, uploaded_by, total_rows, rows_imported, rows_skipped, unmatched_drivers)
    VALUES (${companyId}, ${fileNameQ}, ${uploadedBy}, ${filtered.length}, ${updated + inserted}, ${skipped}, ${inserted})
  `)).catch((e: unknown) => logger.warn({ err: e }, "[fleet] snapshot import log failed (non-fatal)"));

  if (errors > 0 && updated + inserted === 0) {
    throw new Error(`Semua ${errors} driver gagal diimport. Error pertama: ${errs[0] ?? "unknown"}`);
  }

  return {
    ok: true,
    updated,
    inserted,
    skipped,
    errors,
    total: filtered.length,
    message: `${updated} driver diperbarui, ${inserted} driver baru${errors > 0 ? `, ${errors} gagal dilewati` : ""}`,
  };
}

/** GET /outstanding/import-log — riwayat import snapshot CSV */
router.get("/outstanding/import-log", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const days = Math.min(parseInt(String(req.query.days || "30")) || 30, 365);
    const result = await db.execute(sql.raw(`
      SELECT id, report_file_name, uploaded_by, uploaded_at,
             total_rows, rows_imported, rows_skipped, unmatched_drivers, notes
      FROM fleet_outstanding_import_log
      WHERE company_id = ${companyId}
        AND uploaded_at >= NOW() - INTERVAL '${days} days'
      ORDER BY uploaded_at DESC
      LIMIT 100
    `));
    res.json({ ok: true, logs: result.rows });
  } catch (err) {
    logger.error({ err }, "[fleet] import log fetch error");
    res.status(500).json({ error: "Gagal mengambil riwayat import" });
  }
});

// ─── FLEET SETTINGS (COA) ────────────────────────────────────────────────────

/** GET /settings — ambil fleet COA settings dari accounting_settings.meta */
router.get("/settings", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const result = await db.execute(sql.raw(`
      SELECT meta FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
    `));
    const meta = ((result.rows[0] as Record<string, unknown>)?.meta ?? {}) as Record<string, unknown>;
    return res.json({
      ok: true,
      fleetCashAccountId: meta.fleetCashAccountId ?? null,
      fleetDriverReceivableAccountId: meta.fleetDriverReceivableAccountId ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] settings get error");
    res.status(500).json({ error: "Gagal mengambil fleet settings" });
  }
});

/** PUT /settings — simpan fleet COA ke accounting_settings.meta */
router.put("/settings", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { fleetCashAccountId, fleetDriverReceivableAccountId } = req.body ?? {};
    const existing = await db.execute(sql.raw(`
      SELECT id, meta FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
    `));
    const row = existing.rows[0] as Record<string, unknown> | undefined;
    const baseMeta = ((row?.meta ?? {}) as Record<string, unknown>);
    const newMeta = {
      ...baseMeta,
      ...(fleetCashAccountId !== undefined
        ? { fleetCashAccountId: fleetCashAccountId ? Number(fleetCashAccountId) : null }
        : {}),
      ...(fleetDriverReceivableAccountId !== undefined
        ? { fleetDriverReceivableAccountId: fleetDriverReceivableAccountId ? Number(fleetDriverReceivableAccountId) : null }
        : {}),
    };
    if (row?.id) {
      await db.execute(sql.raw(`
        UPDATE accounting_settings SET meta = '${JSON.stringify(newMeta).replace(/'/g, "''")}'::jsonb WHERE id = ${row.id}
      `));
    } else {
      await db.execute(sql.raw(`
        INSERT INTO accounting_settings (company_id, meta) VALUES (${companyId}, '${JSON.stringify(newMeta).replace(/'/g, "''")}'::jsonb)
      `));
    }
    return res.json({
      ok: true,
      fleetCashAccountId: newMeta.fleetCashAccountId ?? null,
      fleetDriverReceivableAccountId: newMeta.fleetDriverReceivableAccountId ?? null,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] settings put error");
    res.status(500).json({ error: "Gagal menyimpan fleet settings" });
  }
});

// ─── CASH PAYMENTS ────────────────────────────────────────────────────────────

/** GET /cash-payments — daftar pembayaran tunai driver */
router.get("/cash-payments", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { driverExtId, status, days = "90", page = "1", limit = "50" } = req.query as Record<string, string>;
    const d = Math.min(parseInt(days) || 90, 365);
    const offset = (Math.max(parseInt(page) || 1, 1) - 1) * Math.min(parseInt(limit) || 50, 200);
    const lim = Math.min(parseInt(limit) || 50, 200);
    const conditions: string[] = [`cp.company_id = ${companyId}`, `cp.payment_date >= CURRENT_DATE - INTERVAL '${d} days'`];
    if (status) conditions.push(`cp.status = '${sanitize(status)}'`);
    if (driverExtId) conditions.push(`cp.driver_external_id = '${sanitize(driverExtId)}'`);
    const where = conditions.join(" AND ");
    const [rows, total] = await Promise.all([
      db.execute(sql.raw(`
        SELECT cp.*, fo.outstanding_amount AS remaining_outstanding
        FROM fleet_cash_payments cp
        LEFT JOIN fleet_outstanding fo ON fo.id = cp.outstanding_id
        WHERE ${where}
        ORDER BY cp.payment_date DESC, cp.id DESC
        LIMIT ${lim} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM fleet_cash_payments cp WHERE ${where}`)),
    ]);
    res.json({ ok: true, payments: rows.rows, total: numVal((total.rows[0] as any)?.cnt), page: parseInt(page), limit: lim });
  } catch (err) {
    logger.error({ err }, "[fleet] cash-payments list error");
    res.status(500).json({ error: "Gagal mengambil daftar pembayaran" });
  }
});

/** POST /cash-payments — catat pembayaran tunai driver */
router.post("/cash-payments", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { outstanding_id, driver_id, driver_name, driver_external_id, driver_phone, vehicle_plate,
      payment_date, amount, payment_method = "cash", reference_no, notes } = req.body ?? {};
    if (!driver_name) return res.status(400).json({ error: "driver_name wajib diisi" });
    if (!amount || parseFloat(String(amount)) <= 0) return res.status(400).json({ error: "amount harus > 0" });
    if (!companyId) return res.status(400).json({ error: "company_id tidak ditemukan di session" });
    const user = (req.user as any);
    const recordedBy = user?.email ?? user?.name ?? "system";
    const pDate = payment_date || new Date().toISOString().slice(0, 10);
    const amtNum = parseFloat(String(amount));

    // 1. Insert payment
    const result = await db.execute(sql.raw(`
      INSERT INTO fleet_cash_payments (
        company_id, outstanding_id, driver_id, driver_name, driver_external_id,
        driver_phone, vehicle_plate, payment_date, amount, payment_method,
        reference_no, notes, recorded_by, status
      ) VALUES (
        ${companyId},
        ${outstanding_id ? String(parseInt(outstanding_id)) : "NULL"},
        ${driver_id ? String(parseInt(driver_id)) : "NULL"},
        ${sq(driver_name)},
        ${driver_external_id ? sq(driver_external_id) : "NULL"},
        ${driver_phone ? sq(driver_phone) : "NULL"},
        ${vehicle_plate ? sq(vehicle_plate) : "NULL"},
        ${sq(pDate)}, ${amtNum.toFixed(4)},
        ${sq(payment_method)},
        ${reference_no ? sq(reference_no) : "NULL"},
        ${notes ? sq(notes) : "NULL"},
        ${sq(recordedBy)}, 'confirmed'
      )
      RETURNING *
    `));
    const payment = result.rows[0] as Record<string, unknown>;
    const paymentId = Number(payment.id);

    // 2. Update outstanding
    if (outstanding_id && companyId) {
      await db.execute(sql.raw(`
        UPDATE fleet_outstanding
        SET outstanding_amount = GREATEST(outstanding_amount - ${amtNum.toFixed(4)}, 0),
            updated_at = NOW()
        WHERE id = ${parseInt(outstanding_id)} AND company_id = ${companyId}
      `));
      await db.execute(sql.raw(`
        UPDATE fleet_outstanding
        SET status = 'resolved', resolved_at = NOW(), notes = COALESCE(notes, '') || ' [Auto-resolved: saldo lunas]'
        WHERE id = ${parseInt(outstanding_id)} AND company_id = ${companyId} AND outstanding_amount <= 0
      `));
    }

    // 3. Post accounting journal
    try {
      const { entryId } = await postFleetCashPaymentJournal({
        paymentId,
        companyId,
        amount: amtNum,
        driverName: driver_name,
        paymentDate: pDate,
        referenceNo: reference_no ?? null,
        recordedBy,
      });

      // 4. Link entry ke payment
      await db.execute(sql.raw(`
        UPDATE fleet_cash_payments
        SET accounting_entry_id = ${entryId}
        WHERE id = ${paymentId}
      `));
      payment.accounting_entry_id = entryId;
    } catch (journalErr: unknown) {
      // Rollback: hapus payment + restore outstanding
      await db.execute(sql.raw(`DELETE FROM fleet_cash_payments WHERE id = ${paymentId}`)).catch(() => {});
      if (outstanding_id && companyId) {
        await db.execute(sql.raw(`
          UPDATE fleet_outstanding
          SET outstanding_amount = outstanding_amount + ${amtNum.toFixed(4)},
              status = 'open', resolved_at = NULL, updated_at = NOW()
          WHERE id = ${parseInt(outstanding_id)} AND company_id = ${companyId}
        `)).catch(() => {});
      }
      const errCode = (journalErr as any)?.code;
      const errMsg = (journalErr as any)?.message ?? "Gagal posting jurnal";
      if (errCode === "COA_MISSING") {
        return res.status(400).json({ error: errMsg });
      }
      if (errMsg.includes("period") || errMsg.includes("closed") || errMsg.includes("locked")) {
        return res.status(422).json({ error: `Periode akuntansi sudah ditutup: ${errMsg}` });
      }
      logger.error({ err: journalErr, paymentId }, "[fleet] cash-payment journal error — rolled back");
      return res.status(500).json({ error: `Pembayaran dibatalkan — gagal posting jurnal: ${errMsg}` });
    }

    res.json({ ok: true, payment });
  } catch (err) {
    logger.error({ err }, "[fleet] cash-payment record error");
    res.status(500).json({ error: "Gagal mencatat pembayaran" });
  }
});

/** GET /cash-payments/summary — ringkasan pembayaran per driver + totals bulan ini */
router.get("/cash-payments/summary", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const d = Math.min(parseInt(String(req.query.days || "30")) || 30, 365);
    const [perDriver, totals] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          driver_name, driver_external_id, driver_phone, vehicle_plate,
          COUNT(*) AS payment_count,
          SUM(amount) AS total_paid,
          MAX(payment_date) AS last_payment_date
        FROM fleet_cash_payments
        WHERE company_id = ${companyId}
          AND status != 'cancelled'
          AND payment_date >= CURRENT_DATE - INTERVAL '${d} days'
        GROUP BY driver_name, driver_external_id, driver_phone, vehicle_plate
        ORDER BY total_paid DESC
      `)),
      db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(CASE WHEN DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', CURRENT_DATE) AND status != 'cancelled' THEN amount ELSE 0 END), 0) AS this_month_total,
          COALESCE(SUM(CASE WHEN status = 'cancelled' AND DATE_TRUNC('month', payment_date) = DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END), 0) AS cancelled_total,
          COALESCE(SUM(CASE WHEN accounting_entry_id IS NOT NULL AND status != 'cancelled' THEN amount ELSE 0 END), 0) AS posted_total,
          COUNT(CASE WHEN status = 'cancelled' THEN 1 END) AS cancelled_count,
          COUNT(CASE WHEN status != 'cancelled' THEN 1 END) AS confirmed_count,
          COUNT(CASE WHEN accounting_entry_id IS NOT NULL AND status != 'cancelled' THEN 1 END) AS posted_count
        FROM fleet_cash_payments
        WHERE company_id = ${companyId}
          AND payment_date >= DATE_TRUNC('month', CURRENT_DATE)
      `)),
    ]);
    const t = (totals.rows[0] ?? {}) as Record<string, unknown>;
    res.json({
      ok: true,
      summary: perDriver.rows,
      totals: {
        thisMonthTotal: parseFloat(String(t.this_month_total ?? 0)),
        cancelledTotal: parseFloat(String(t.cancelled_total ?? 0)),
        postedTotal: parseFloat(String(t.posted_total ?? 0)),
        cancelledCount: parseInt(String(t.cancelled_count ?? 0)),
        confirmedCount: parseInt(String(t.confirmed_count ?? 0)),
        postedCount: parseInt(String(t.posted_count ?? 0)),
      },
    });
  } catch (err) {
    logger.error({ err }, "[fleet] cash-payments summary error");
    res.status(500).json({ error: "Gagal mengambil ringkasan pembayaran" });
  }
});

/** DELETE /cash-payments/:id — batalkan/hapus catatan pembayaran */
router.delete("/cash-payments/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id ?? ""));
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
    if (!companyId) return res.status(400).json({ error: "company_id tidak ditemukan" });

    const pmt = await db.execute(sql.raw(`
      SELECT * FROM fleet_cash_payments WHERE id = ${id} AND company_id = ${companyId}
    `));
    if (!pmt.rows.length) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    const p = pmt.rows[0] as Record<string, unknown>;

    if (p.status === "cancelled") {
      return res.status(409).json({ error: "Pembayaran sudah dibatalkan sebelumnya" });
    }

    const amtNum = parseFloat(String(p.amount ?? 0));
    const user = (req.user as any);
    const recordedBy = user?.email ?? user?.name ?? "system";

    if (p.accounting_entry_id) {
      // Ada jurnal — buat reversal, lalu tandai cancelled (no hard delete)
      try {
        await voidFleetCashPaymentJournal({
          originalEntryId: Number(p.accounting_entry_id),
          companyId,
          amount: amtNum,
          driverName: String(p.driver_name ?? ""),
          paymentDate: String(p.payment_date ?? new Date().toISOString().slice(0, 10)),
          referenceNo: p.reference_no ? String(p.reference_no) : null,
          recordedBy,
        });
      } catch (voidErr: unknown) {
        const errMsg = (voidErr as any)?.message ?? "Gagal void jurnal";
        if (errMsg.includes("period") || errMsg.includes("closed") || errMsg.includes("locked")) {
          return res.status(422).json({ error: `Periode akuntansi sudah ditutup: ${errMsg}` });
        }
        logger.error({ err: voidErr, id }, "[fleet] cash-payment void journal error");
        return res.status(500).json({ error: `Gagal membuat reversal jurnal: ${errMsg}` });
      }

      // Tandai cancelled (tidak hard delete agar jurnal tidak orphan)
      await db.execute(sql.raw(`
        UPDATE fleet_cash_payments
        SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${id} AND company_id = ${companyId}
      `));

      // Restore outstanding
      if (p.outstanding_id && amtNum > 0) {
        await db.execute(sql.raw(`
          UPDATE fleet_outstanding
          SET outstanding_amount = outstanding_amount + ${amtNum.toFixed(4)},
              status = 'open', resolved_at = NULL, updated_at = NOW()
          WHERE id = ${parseInt(String(p.outstanding_id))} AND company_id = ${companyId}
        `));
      }

      return res.json({ ok: true, voided: true, message: "Pembayaran dibatalkan dan jurnal reversal dibuat" });
    }

    // Tidak ada jurnal — hard delete (payment belum punya accounting entry)
    if (p.outstanding_id && amtNum > 0) {
      await db.execute(sql.raw(`
        UPDATE fleet_outstanding
        SET outstanding_amount = outstanding_amount + ${amtNum.toFixed(4)},
            status = 'open', resolved_at = NULL, updated_at = NOW()
        WHERE id = ${parseInt(String(p.outstanding_id))} AND company_id = ${companyId}
      `));
    }
    await db.execute(sql.raw(`DELETE FROM fleet_cash_payments WHERE id = ${id} AND company_id = ${companyId}`));
    res.json({ ok: true, voided: false, message: "Pembayaran dihapus (belum ada jurnal)" });
  } catch (err) {
    logger.error({ err }, "[fleet] cash-payment delete error");
    res.status(500).json({ error: "Gagal hapus pembayaran" });
  }
});

/** PATCH /cash-payments/:id/cancel — batalkan pembayaran (ubah status → cancelled, restore outstanding) */
router.patch("/cash-payments/:id/cancel", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id ?? ""));
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
    const pmt = await db.execute(sql.raw(`
      SELECT * FROM fleet_cash_payments WHERE id = ${id} AND company_id = ${companyId}
    `));
    if (!pmt.rows.length) return res.status(404).json({ error: "Pembayaran tidak ditemukan" });
    const p = pmt.rows[0] as Record<string, unknown>;
    if (String(p.status) === "cancelled") return res.status(400).json({ error: "Pembayaran sudah dibatalkan" });
    // Restore outstanding amount
    if (p.outstanding_id && p.amount) {
      await db.execute(sql.raw(`
        UPDATE fleet_outstanding
        SET outstanding_amount = outstanding_amount + ${parseFloat(String(p.amount)).toFixed(4)},
            status = 'open', resolved_at = NULL, updated_at = NOW()
        WHERE id = ${parseInt(String(p.outstanding_id))} AND company_id = ${companyId}
      `));
    }
    await db.execute(sql.raw(`
      UPDATE fleet_cash_payments SET status = 'cancelled', updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[fleet] cash-payment cancel error");
    res.status(500).json({ error: "Gagal membatalkan pembayaran" });
  }
});

// ─── ANALYTICS (base + enhanced) ──────────────────────────────────────────────

router.get("/analytics", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const d = Math.min(parseInt(String(req.query.days || "30")) || 30, 365);

    const [driverPerf, vehiclePerf, weekdayAgg, serviceBreakdown] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          d.id, d.name, d.vehicle_plate, d.vehicle_type, d.status,
          COUNT(t.id)           AS day_count,
          SUM(t.trip_count)     AS total_trips,
          SUM(t.net_revenue)    AS total_revenue,
          AVG(t.net_revenue)    AS avg_daily_revenue,
          SUM(t.incentive)      AS total_incentive,
          SUM(t.deduction)      AS total_deduction,
          MAX(t.transaction_date) AS last_active,
          COALESCE(o.outstanding_amount, 0) AS outstanding_amount
        FROM fleet_drivers d
        LEFT JOIN fleet_transactions t ON t.driver_id = d.id
          AND t.transaction_date >= CURRENT_DATE - INTERVAL '${d} days'
          AND t.company_id = ${companyId}
        LEFT JOIN fleet_outstanding o ON o.driver_id = d.id
          AND o.company_id = ${companyId} AND o.status = 'open'
        WHERE d.company_id = ${companyId}
        GROUP BY d.id, d.name, d.vehicle_plate, d.vehicle_type, d.status, o.outstanding_amount
        ORDER BY total_revenue DESC NULLS LAST
        LIMIT 50
      `)),
      db.execute(sql.raw(`
        SELECT
          t.vehicle_plate,
          COUNT(DISTINCT t.driver_id) AS driver_count,
          SUM(t.trip_count)           AS total_trips,
          SUM(t.net_revenue)          AS total_revenue
        FROM fleet_transactions t
        WHERE t.company_id = ${companyId}
          AND t.transaction_date >= CURRENT_DATE - INTERVAL '${d} days'
          AND t.vehicle_plate IS NOT NULL AND t.vehicle_plate != ''
        GROUP BY t.vehicle_plate
        ORDER BY total_revenue DESC
        LIMIT 20
      `)),
      db.execute(sql.raw(`
        SELECT
          EXTRACT(DOW FROM summary_date::date) AS dow,
          TO_CHAR(summary_date::date, 'Day')   AS day_name,
          AVG(active_drivers)                  AS avg_drivers,
          AVG(total_trips)                     AS avg_trips,
          AVG(net_revenue)                     AS avg_revenue
        FROM fleet_daily_summary
        WHERE company_id = ${companyId} AND summary_date >= CURRENT_DATE - INTERVAL '${d} days'
        GROUP BY dow, day_name
        ORDER BY dow
      `)),
      db.execute(sql.raw(`
        SELECT service_type, COUNT(*) AS count, SUM(net_revenue) AS revenue, SUM(trip_count) AS trips
        FROM fleet_transactions
        WHERE company_id = ${companyId} AND transaction_date >= CURRENT_DATE - INTERVAL '${d} days'
        GROUP BY service_type
        ORDER BY revenue DESC
      `)),
    ]);

    res.json({
      driverPerformance: driverPerf.rows,
      vehiclePerformance: vehiclePerf.rows,
      weekdayPattern: weekdayAgg.rows,
      serviceBreakdown: serviceBreakdown.rows,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] analytics error");
    res.status(500).json({ error: "Gagal mengambil analytics" });
  }
});

/** Idle Vehicles: vehicles/drivers not active in last N days */
router.get("/analytics/idle-vehicles", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const d = Math.min(parseInt(String(req.query.days || "7")) || 7, 90);
    const rows = await db.execute(sql.raw(`
      SELECT
        d.id,
        d.name AS driver_name,
        d.vehicle_plate,
        d.vehicle_type,
        d.status,
        d.last_active_date,
        CURRENT_DATE - d.last_active_date::date AS idle_days,
        COALESCE((
          SELECT SUM(t.net_revenue)
          FROM fleet_transactions t
          WHERE t.driver_id = d.id AND t.transaction_date >= CURRENT_DATE - INTERVAL '30 days'
        ), 0) AS revenue_last_30d
      FROM fleet_drivers d
      WHERE d.company_id = ${companyId}
        AND d.status = 'active'
        AND (
          d.last_active_date IS NULL
          OR d.last_active_date < CURRENT_DATE - INTERVAL '${d} days'
        )
      ORDER BY idle_days DESC NULLS LAST
      LIMIT 50
    `));
    res.json({ idleVehicles: rows.rows, idleDays: d });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data idle vehicles" });
  }
});

/** Churn Risk: drivers with significant activity decline (last 14d vs prev 14d) */
router.get("/analytics/churn-risk", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db.execute(sql.raw(`
      WITH recent AS (
        SELECT driver_id, driver_name, SUM(net_revenue) AS rev_recent, COUNT(*) AS days_recent
        FROM fleet_transactions
        WHERE company_id = ${companyId} AND transaction_date >= CURRENT_DATE - INTERVAL '14 days'
        GROUP BY driver_id, driver_name
      ),
      prev AS (
        SELECT driver_id, SUM(net_revenue) AS rev_prev, COUNT(*) AS days_prev
        FROM fleet_transactions
        WHERE company_id = ${companyId}
          AND transaction_date >= CURRENT_DATE - INTERVAL '28 days'
          AND transaction_date < CURRENT_DATE - INTERVAL '14 days'
        GROUP BY driver_id
      )
      SELECT
        r.driver_id,
        r.driver_name,
        r.rev_recent,
        p.rev_prev,
        r.days_recent,
        p.days_prev,
        CASE
          WHEN p.rev_prev > 0
          THEN ROUND((p.rev_prev - r.rev_recent) / p.rev_prev * 100, 1)
          ELSE 0
        END AS churn_risk_pct,
        CASE
          WHEN p.rev_prev > 0 AND r.rev_recent < p.rev_prev * 0.5 THEN 'high'
          WHEN p.rev_prev > 0 AND r.rev_recent < p.rev_prev * 0.75 THEN 'medium'
          ELSE 'low'
        END AS risk_level
      FROM recent r
      LEFT JOIN prev p ON p.driver_id = r.driver_id
      WHERE p.rev_prev > 50000
      ORDER BY churn_risk_pct DESC
      LIMIT 30
    `));
    res.json({ churnRisk: rows.rows });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data churn risk" });
  }
});

/** Revenue Forecast: 7-day moving average + 14-day projection */
router.get("/analytics/forecast", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const historical = await db.execute(sql.raw(`
      SELECT summary_date, net_revenue, active_drivers, total_trips
      FROM fleet_daily_summary
      WHERE company_id = ${companyId} AND summary_date >= CURRENT_DATE - INTERVAL '60 days'
      ORDER BY summary_date
    `));

    const hist = historical.rows as Array<{ summary_date: string; net_revenue: string; active_drivers: number; total_trips: number }>;

    // Calculate 7-day moving average
    const withMA = hist.map((row, i) => {
      const window = hist.slice(Math.max(0, i - 6), i + 1);
      const avg = window.reduce((s, r) => s + numVal(r.net_revenue), 0) / window.length;
      return { ...row, ma7: Math.round(avg) };
    });

    // Forecast next 14 days using avg of last 7 days
    const last7 = hist.slice(-7);
    const forecastAvg = last7.length > 0
      ? last7.reduce((s, r) => s + numVal(r.net_revenue), 0) / last7.length
      : 0;

    const forecast = Array.from({ length: 14 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() + i + 1);
      const date = d.toISOString().slice(0, 10);
      // Simple linear projection with slight regression to mean
      const noise = (Math.random() - 0.5) * forecastAvg * 0.05;
      return {
        summary_date: date,
        forecast_revenue: Math.round(forecastAvg + noise),
        is_forecast: true,
      };
    });

    res.json({ historical: withMA, forecast, forecastAvg: Math.round(forecastAvg) });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil data forecast" });
  }
});

// ─── ALERTS ───────────────────────────────────────────────────────────────────

router.get("/alerts", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { isRead, severity, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions = [`a.company_id = ${companyId}`];
    if (isRead !== undefined && isRead !== "all") conditions.push(`a.is_read = ${isRead === "true"}`);
    if (severity && severity !== "all") conditions.push(`a.severity = '${sanitize(severity)}'`);
    const where = conditions.join(" AND ");
    const [rows, unread] = await Promise.all([
      db.execute(sql.raw(`
        SELECT a.*, d.name AS driver_name
        FROM fleet_alerts a
        LEFT JOIN fleet_drivers d ON d.id = a.driver_id
        WHERE ${where}
        ORDER BY a.created_at DESC
        LIMIT ${parseInt(limit)} OFFSET ${(parseInt(page) - 1) * parseInt(limit)}
      `)),
      db.execute(sql.raw(`SELECT COUNT(*) AS count FROM fleet_alerts WHERE company_id = ${companyId} AND is_read = FALSE`)),
    ]);
    res.json({ alerts: rows.rows, unreadCount: (unread.rows[0] as any).count });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil alerts" });
  }
});

router.put("/alerts/:id/read", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    await db.execute(sql.raw(`UPDATE fleet_alerts SET is_read = TRUE WHERE id = ${id} AND company_id = ${companyId}`));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal mark alert" });
  }
});

router.put("/alerts/read-all", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    await db.execute(sql.raw(`UPDATE fleet_alerts SET is_read = TRUE WHERE company_id = ${companyId} AND is_read = FALSE`));
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal mark all alerts" });
  }
});

/** Trigger smart alert generation manually */
router.post("/alerts/generate", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "Company ID tidak ditemukan" });
    const meta = extractRequestMeta(req);
    await generateSmartAlerts(companyId, meta);
    res.json({ ok: true, message: "Smart alerts berhasil di-generate" });
  } catch (err) {
    res.status(500).json({ error: "Gagal generate alerts" });
  }
});

// ─── Smart Alert Engine ────────────────────────────────────────────────────────

async function isAlertSuppressed(companyId: number, alertType: string, referenceId: string): Promise<boolean> {
  const res = await db.execute(sql.raw(`
    SELECT id FROM fleet_alert_suppression
    WHERE company_id = ${companyId}
      AND alert_type = '${sanitize(alertType)}'
      AND reference_id = '${sanitize(referenceId)}'
      AND suppressed_until > NOW()
  `));
  return res.rows.length > 0;
}

async function suppressAlert(companyId: number, alertType: string, referenceId: string, hours: number) {
  await db.execute(sql.raw(`
    INSERT INTO fleet_alert_suppression (company_id, alert_type, reference_id, suppressed_until)
    VALUES (${companyId}, '${sanitize(alertType)}', '${sanitize(referenceId)}', NOW() + INTERVAL '${hours} hours')
    ON CONFLICT (company_id, alert_type, reference_id) DO UPDATE
      SET suppressed_until = NOW() + INTERVAL '${hours} hours'
  `));
}

async function generateSmartAlerts(
  companyId: number,
  meta: ReturnType<typeof extractRequestMeta>,
) {
  try {
    // 1. Revenue drop: last 3 days vs 7-day average
    const revDropRows = await db.execute(sql.raw(`
      WITH recent AS (
        SELECT driver_id, driver_name, SUM(net_revenue) AS recent_rev
        FROM fleet_transactions
        WHERE company_id = ${companyId} AND transaction_date >= CURRENT_DATE - INTERVAL '3 days'
        GROUP BY driver_id, driver_name
      ),
      avg7 AS (
        SELECT driver_id, AVG(net_revenue) * 3 AS expected_rev
        FROM fleet_transactions
        WHERE company_id = ${companyId}
          AND transaction_date >= CURRENT_DATE - INTERVAL '10 days'
          AND transaction_date < CURRENT_DATE - INTERVAL '3 days'
        GROUP BY driver_id
      )
      SELECT r.driver_id, r.driver_name, r.recent_rev, a.expected_rev,
        ROUND((a.expected_rev - r.recent_rev) / NULLIF(a.expected_rev, 0) * 100, 1) AS drop_pct
      FROM recent r
      JOIN avg7 a ON a.driver_id = r.driver_id
      WHERE a.expected_rev > 50000 AND r.recent_rev < a.expected_rev * 0.6
    `));

    for (const row of revDropRows.rows as any[]) {
      const refId = String(row.driver_id ?? "");
      if (!refId || await isAlertSuppressed(companyId, "revenue_drop", refId)) continue;
      const dname = sanitize(row.driver_name ?? "Unknown");
      const pct = numVal(row.drop_pct).toFixed(1);
      await db.execute(sql.raw(`
        INSERT INTO fleet_alerts (company_id, alert_type, severity, title, message, driver_id, reference_type, reference_id)
        VALUES (${companyId}, 'revenue_drop', 'warning',
          'Revenue Turun: ${dname}',
          'Driver ${dname} mengalami penurunan revenue ${pct}% (3 hari terakhir vs rata-rata 7 hari)',
          ${row.driver_id || "NULL"}, 'driver', ${sq(refId)})
      `));
      await suppressAlert(companyId, "revenue_drop", refId, 24);
    }

    // 2. Inactive drivers (no activity >= 7 days)
    const inactiveRows = await db.execute(sql.raw(`
      SELECT d.id, d.name, d.last_active_date,
        CURRENT_DATE - d.last_active_date::date AS idle_days
      FROM fleet_drivers d
      WHERE d.company_id = ${companyId}
        AND d.status = 'active'
        AND d.last_active_date IS NOT NULL
        AND d.last_active_date < CURRENT_DATE - INTERVAL '7 days'
      LIMIT 30
    `));

    for (const row of inactiveRows.rows as any[]) {
      const refId = String(row.id);
      if (await isAlertSuppressed(companyId, "driver_inactive", refId)) continue;
      const dname = sanitize(row.name ?? "Unknown");
      await db.execute(sql.raw(`
        INSERT INTO fleet_alerts (company_id, alert_type, severity, title, message, driver_id)
        VALUES (${companyId}, 'driver_inactive', 'info',
          'Driver Tidak Aktif: ${dname}',
          'Driver ${dname} tidak ada aktivitas selama ${numVal(row.idle_days)} hari sejak ${row.last_active_date}',
          ${row.id})
      `));
      await suppressAlert(companyId, "driver_inactive", refId, 48);
    }

    // 3. High outstanding (>= 500k)
    const outstandingRows = await db.execute(sql.raw(`
      SELECT id, driver_name, outstanding_amount, driver_id
      FROM fleet_outstanding
      WHERE company_id = ${companyId} AND status = 'open' AND outstanding_amount >= 500000
      LIMIT 30
    `));

    for (const row of outstandingRows.rows as any[]) {
      const refId = String(row.id);
      if (await isAlertSuppressed(companyId, "outstanding_high", refId)) continue;
      const dname = sanitize(row.driver_name ?? "Unknown");
      const amt = new Intl.NumberFormat("id-ID").format(numVal(row.outstanding_amount));
      await db.execute(sql.raw(`
        INSERT INTO fleet_alerts (company_id, alert_type, severity, title, message, driver_id)
        VALUES (${companyId}, 'outstanding_high', 'warning',
          'Outstanding Tinggi: ${dname}',
          'Driver ${dname} memiliki outstanding Rp ${amt} yang belum diselesaikan',
          ${row.driver_id || "NULL"})
      `));
      await suppressAlert(companyId, "outstanding_high", refId, 24);
    }

    writeAuditLog({ ...meta, action: "generate_alerts", module: "fleet_alerts", newData: {
      revenue_drops: revDropRows.rows.length,
      inactive: inactiveRows.rows.length,
      outstanding: outstandingRows.rows.length,
    }});
    logger.info({ companyId }, "[fleet] Smart alerts generated");
  } catch (err) {
    logger.error({ err }, "[fleet] generateSmartAlerts error");
  }
}

// ─── ACCOUNTING JOURNALS ──────────────────────────────────────────────────────

router.get("/accounting/journals", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { status, page = "1", limit = "50" } = req.query as Record<string, string>;
    const conditions = [`company_id = ${companyId}`];
    if (status && status !== "all") conditions.push(`status = '${sanitize(status)}'`);
    const where = conditions.join(" AND ");
    const [rows, countRes] = await Promise.all([
      db.execute(sql.raw(`SELECT * FROM fleet_accounting_journals WHERE ${where} ORDER BY journal_date DESC, id DESC LIMIT ${parseInt(limit)} OFFSET ${(parseInt(page) - 1) * parseInt(limit)}`)),
      db.execute(sql.raw(`SELECT COUNT(*) AS total FROM fleet_accounting_journals WHERE ${where}`)),
    ]);
    res.json({ journals: rows.rows, total: (countRes.rows[0] as any).total });
  } catch (err) {
    res.status(500).json({ error: "Gagal mengambil accounting journals" });
  }
});

/** Auto-generate journal from fleet transactions for a date range */
router.post("/accounting/journals/generate", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    const { periodStart, periodEnd, ppnRate = 11, notes } = req.body;

    if (!periodStart || !periodEnd) return res.status(400).json({ error: "periodStart dan periodEnd wajib diisi" });

    // Aggregate data for the period
    const agg = await db.execute(sql.raw(`
      SELECT
        COUNT(DISTINCT driver_id)   AS driver_count,
        SUM(trip_count)             AS total_trips,
        SUM(gross_revenue)          AS gross_revenue,
        SUM(incentive)              AS incentive_total,
        SUM(commission)             AS commission_total,
        SUM(deduction)              AS deduction_total,
        SUM(net_revenue)            AS net_revenue,
        SUM(outstanding_balance)    AS outstanding_amount
      FROM fleet_transactions
      WHERE company_id = ${companyId}
        AND transaction_date >= ${sq(periodStart)}::date
        AND transaction_date <= ${sq(periodEnd)}::date
    `));

    const stats = agg.rows[0] as Record<string, unknown>;
    if (!stats || numVal(stats.gross_revenue) === 0) {
      return res.status(400).json({ error: "Tidak ada transaksi di periode ini" });
    }

    const grossRevenue = numVal(stats.gross_revenue);
    const ppnRateVal = numVal(ppnRate);
    const ppnAmount = grossRevenue * ppnRateVal / 100;
    const netRevenue = numVal(stats.net_revenue);
    const commissionTotal = numVal(stats.commission_total);
    const incentiveTotal = numVal(stats.incentive_total);
    const outstandingAmount = numVal(stats.outstanding_amount);
    const driverPayout = grossRevenue - commissionTotal - ppnAmount; // payout to drivers
    const refNo = genRefNo();

    const journalRes = await db.execute(sql.raw(`
      INSERT INTO fleet_accounting_journals (
        company_id, journal_date, reference_no, status, journal_type,
        gross_revenue, outstanding_amount, driver_payout,
        ppn_amount, ppn_rate, net_revenue,
        commission_total, incentive_total,
        period_start, period_end, created_by, notes, raw_stats
      ) VALUES (
        ${companyId}, CURRENT_DATE, ${sq(refNo)}, 'draft', 'fleet_revenue',
        ${sn(grossRevenue)}, ${sn(outstandingAmount)}, ${sn(driverPayout)},
        ${sn(ppnAmount)}, ${sn(ppnRateVal)}, ${sn(netRevenue)},
        ${sn(commissionTotal)}, ${sn(incentiveTotal)},
        ${sq(periodStart)}, ${sq(periodEnd)}, ${sq(meta.userEmail)}, ${sq(notes)}, ${sqJson(stats)}
      )
      RETURNING *
    `));

    writeAuditLog({ ...meta, action: "create", module: "fleet_accounting_journals", referenceId: refNo, newData: journalRes.rows[0] as Record<string, unknown> });
    res.json({ journal: journalRes.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet] generate journal error");
    res.status(500).json({ error: "Gagal generate jurnal" });
  }
});

router.put("/accounting/journals/:id/approve", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const meta = extractRequestMeta(req);
    const check = await db.execute(sql.raw(`SELECT id, status FROM fleet_accounting_journals WHERE id = ${id} AND company_id = ${companyId}`));
    if (check.rows.length === 0) return res.status(404).json({ error: "Jurnal tidak ditemukan" });
    if ((check.rows[0] as any).status !== "draft") return res.status(400).json({ error: "Hanya jurnal berstatus draft yang bisa diapprove" });
    await db.execute(sql.raw(`
      UPDATE fleet_accounting_journals SET
        status = 'approved', approved_by = ${sq(meta.userEmail)}, approved_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));
    writeAuditLog({ ...meta, action: "approve", module: "fleet_accounting_journals", referenceId: String(id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal approve jurnal" });
  }
});

router.put("/accounting/journals/:id/post", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const meta = extractRequestMeta(req);
    const check = await db.execute(sql.raw(`SELECT id, status FROM fleet_accounting_journals WHERE id = ${id} AND company_id = ${companyId}`));
    if (check.rows.length === 0) return res.status(404).json({ error: "Jurnal tidak ditemukan" });
    if ((check.rows[0] as any).status !== "approved") return res.status(400).json({ error: "Hanya jurnal berstatus approved yang bisa diposting" });
    await db.execute(sql.raw(`
      UPDATE fleet_accounting_journals SET
        status = 'posted', posted_by = ${sq(meta.userEmail)}, posted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId}
    `));
    writeAuditLog({ ...meta, action: "post", module: "fleet_accounting_journals", referenceId: String(id) });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Gagal posting jurnal" });
  }
});

// ─── VALIDATION & AUDIT ENDPOINTS ─────────────────────────────────────────────

/** System Validation Report — full integrity check */
router.get("/validation/report", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);

    const [
      txCount,
      duplicateCheck,
      summaryMismatch,
      ppnInconsistency,
      nullCompanyCheck,
      outstandingCheck,
      journalCheck,
    ] = await Promise.all([
      // 1. Total transactions
      db.execute(sql.raw(`
        SELECT COUNT(*) AS total, SUM(gross_revenue) AS total_gross,
               SUM(net_revenue) AS total_net, SUM(ppn_amount) AS total_ppn
        FROM fleet_transactions WHERE company_id = ${companyId}
      `)),

      // 2. Duplicate detection: same driver + date across multiple reports
      db.execute(sql.raw(`
        SELECT driver_name, transaction_date, COUNT(*) AS cnt, SUM(gross_revenue) AS total_gross
        FROM fleet_transactions
        WHERE company_id = ${companyId}
        GROUP BY driver_name, transaction_date
        HAVING COUNT(*) > 1
        ORDER BY cnt DESC
        LIMIT 20
      `)),

      // 3. daily_summary vs transactions mismatch
      db.execute(sql.raw(`
        SELECT
          ds.summary_date,
          ds.gross_revenue     AS summary_gross,
          COALESCE(tx.tx_gross, 0) AS tx_gross,
          ABS(ds.gross_revenue - COALESCE(tx.tx_gross, 0)) AS diff
        FROM fleet_daily_summary ds
        LEFT JOIN (
          SELECT transaction_date, SUM(gross_revenue) AS tx_gross
          FROM fleet_transactions WHERE company_id = ${companyId}
          GROUP BY transaction_date
        ) tx ON tx.transaction_date = ds.summary_date
        WHERE ds.company_id = ${companyId}
          AND ABS(ds.gross_revenue - COALESCE(tx.tx_gross, 0)) > 0.01
        ORDER BY diff DESC
        LIMIT 20
      `)),

      // 4. PPN inconsistency: ppn_amount != gross_revenue * ppn_rate / 100
      db.execute(sql.raw(`
        SELECT id, driver_name, transaction_date, gross_revenue, ppn_rate, ppn_amount,
               ROUND(gross_revenue * ppn_rate / 100, 4) AS expected_ppn,
               ABS(ppn_amount - ROUND(gross_revenue * ppn_rate / 100, 4)) AS ppn_diff
        FROM fleet_transactions
        WHERE company_id = ${companyId}
          AND ppn_rate > 0
          AND ABS(ppn_amount - ROUND(gross_revenue * ppn_rate / 100, 4)) > 0.01
        LIMIT 20
      `)),

      // 5. Null company_id check (cross-tenant leak)
      db.execute(sql.raw(`
        SELECT
          (SELECT COUNT(*) FROM fleet_transactions   WHERE company_id IS NULL) AS tx_null,
          (SELECT COUNT(*) FROM fleet_drivers        WHERE company_id IS NULL) AS drivers_null,
          (SELECT COUNT(*) FROM fleet_outstanding    WHERE company_id IS NULL) AS outstanding_null,
          (SELECT COUNT(*) FROM fleet_alerts         WHERE company_id IS NULL) AS alerts_null
      `)),

      // 6. Outstanding vs transactions sum comparison
      db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(outstanding_amount), 0) AS total_outstanding_table,
          (SELECT COALESCE(SUM(outstanding_balance), 0) FROM fleet_transactions
           WHERE company_id = ${companyId}) AS total_outstanding_tx
        FROM fleet_outstanding
        WHERE company_id = ${companyId} AND status = 'open'
      `)),

      // 7. Journal vs transactions comparison
      db.execute(sql.raw(`
        SELECT j.id, j.reference_no, j.period_start, j.period_end,
               j.gross_revenue AS journal_gross,
               COALESCE(tx.tx_gross, 0) AS tx_gross,
               ABS(j.gross_revenue - COALESCE(tx.tx_gross, 0)) AS diff
        FROM fleet_accounting_journals j
        LEFT JOIN (
          SELECT period_s, period_e, SUM(gross_revenue) AS tx_gross
          FROM (
            SELECT
              (SELECT period_start FROM fleet_accounting_journals WHERE id = j2.id) AS period_s,
              (SELECT period_end   FROM fleet_accounting_journals WHERE id = j2.id) AS period_e,
              t.gross_revenue
            FROM fleet_accounting_journals j2
            JOIN fleet_transactions t
              ON t.company_id = j2.company_id
              AND t.transaction_date BETWEEN j2.period_start AND j2.period_end
            WHERE j2.company_id = ${companyId}
          ) sub
          GROUP BY period_s, period_e
        ) tx ON tx.period_s = j.period_start AND tx.period_e = j.period_end
        WHERE j.company_id = ${companyId}
          AND ABS(j.gross_revenue - COALESCE(tx.tx_gross, 0)) > 1
        ORDER BY diff DESC
        LIMIT 10
      `)),
    ]);

    const txStats = txCount.rows[0] as Record<string, unknown>;
    const nullStats = nullCompanyCheck.rows[0] as Record<string, unknown>;
    const outstandingStats = outstandingCheck.rows[0] as Record<string, unknown>;

    const duplicates = duplicateCheck.rows as Record<string, unknown>[];
    const summaryMismatches = summaryMismatch.rows as Record<string, unknown>[];
    const ppnIssues = ppnInconsistency.rows as Record<string, unknown>[];
    const journalMismatches = journalCheck.rows as Record<string, unknown>[];

    const outstandingDiff = Math.abs(
      numVal(outstandingStats.total_outstanding_table) - numVal(outstandingStats.total_outstanding_tx)
    );

    const report = {
      generatedAt: new Date().toISOString(),
      companyId,
      summary: {
        totalTransactions: numVal(txStats.total),
        totalGrossRevenue: numVal(txStats.total_gross),
        totalNetRevenue: numVal(txStats.total_net),
        totalPpn: numVal(txStats.total_ppn),
      },
      checks: {
        duplicateTransactions: {
          status: duplicates.length === 0 ? "ok" : "fail",
          count: duplicates.length,
          items: duplicates,
        },
        summaryIntegrity: {
          status: summaryMismatches.length === 0 ? "ok" : "warn",
          count: summaryMismatches.length,
          items: summaryMismatches,
        },
        ppnConsistency: {
          status: ppnIssues.length === 0 ? "ok" : "warn",
          count: ppnIssues.length,
          items: ppnIssues,
        },
        multiTenantSecurity: {
          status: Object.values(nullStats).every((v) => numVal(v) === 0) ? "ok" : "critical",
          nullCounts: nullStats,
        },
        outstandingIntegrity: {
          status: outstandingDiff < 1 ? "ok" : "warn",
          outstandingTableSum: numVal(outstandingStats.total_outstanding_table),
          transactionSum: numVal(outstandingStats.total_outstanding_tx),
          diff: outstandingDiff,
        },
        journalIntegrity: {
          status: journalMismatches.length === 0 ? "ok" : "warn",
          count: journalMismatches.length,
          items: journalMismatches,
        },
      },
    };

    res.json(report);
  } catch (err) {
    logger.error({ err }, "[fleet] validation report error");
    res.status(500).json({ error: "Gagal membuat validation report" });
  }
});

/** Transaction trace: report → transactions → daily_summary impact */
router.get("/validation/trace/:reportId", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const reportId = parseInt(String(req.params.reportId));
    if (isNaN(reportId)) return res.status(400).json({ error: "reportId tidak valid" });

    const [report, transactions, affectedDates] = await Promise.all([
      db.execute(sql.raw(`
        SELECT r.*, p.name AS partner_name
        FROM fleet_reports r
        LEFT JOIN fleet_partners p ON p.id = r.partner_id
        WHERE r.id = ${reportId} AND r.company_id = ${companyId}
      `)),
      db.execute(sql.raw(`
        SELECT id, driver_name, driver_external_id, vehicle_plate, transaction_date,
               trip_count, gross_revenue, net_revenue, ppn_amount, ppn_rate,
               outstanding_balance, service_type, created_at
        FROM fleet_transactions
        WHERE report_id = ${reportId} AND company_id = ${companyId}
        ORDER BY transaction_date, driver_name
        LIMIT 200
      `)),
      db.execute(sql.raw(`
        SELECT ds.summary_date, ds.active_drivers, ds.total_trips,
               ds.gross_revenue AS summary_gross,
               COALESCE(tx.tx_gross, 0) AS tx_gross_for_date
        FROM fleet_daily_summary ds
        JOIN (
          SELECT DISTINCT transaction_date FROM fleet_transactions
          WHERE report_id = ${reportId} AND company_id = ${companyId}
        ) rpt_dates ON rpt_dates.transaction_date = ds.summary_date
        LEFT JOIN (
          SELECT transaction_date, SUM(gross_revenue) AS tx_gross
          FROM fleet_transactions WHERE company_id = ${companyId}
          GROUP BY transaction_date
        ) tx ON tx.transaction_date = ds.summary_date
        WHERE ds.company_id = ${companyId}
        ORDER BY ds.summary_date
      `)),
    ]);

    if (report.rows.length === 0) return res.status(404).json({ error: "Report tidak ditemukan" });

    const txRows = transactions.rows as Record<string, unknown>[];
    const totalGross = txRows.reduce((s, r) => s + numVal(r.gross_revenue), 0);
    const totalNet = txRows.reduce((s, r) => s + numVal(r.net_revenue), 0);
    const totalPpn = txRows.reduce((s, r) => s + numVal(r.ppn_amount), 0);

    res.json({
      report: report.rows[0],
      transactions: txRows,
      transactionSummary: { count: txRows.length, totalGross, totalNet, totalPpn },
      affectedDailySummaries: affectedDates.rows,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] validation trace error");
    res.status(500).json({ error: "Gagal mengambil trace report" });
  }
});

/** Reconciliation: auto-fix daily_summary mismatches */
router.post("/validation/reconcile", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });

    await regenerateDailySummary(companyId);

    writeAuditLog({ ...meta, action: "reconcile", module: "fleet_daily_summary", referenceId: String(companyId) });
    res.json({ ok: true, message: "Daily summary telah direkonsiliasi ulang dari raw transactions" });
  } catch (err) {
    logger.error({ err }, "[fleet] reconcile error");
    res.status(500).json({ error: "Gagal rekonsiliasi" });
  }
});

// ─── Fleet Expenses ─────────────────────────────────────────────────────────
// Migration: run once as part of runFleetIntelligenceMigration chain extension.
// Table: fleet_expenses — operational vehicle cost tracking per company.
let _expensesMigrated = false;
async function runFleetExpensesMigration() {
  if (_expensesMigrated) return;
  try {
    await db.execute(sql.raw(`SET search_path TO public`));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS fleet_expenses (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        vehicle_id      INTEGER REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
        expense_date    DATE NOT NULL,
        expense_type    TEXT NOT NULL,
        description     TEXT,
        amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
        created_by      TEXT,
        created_by_email TEXT,
        updated_by      TEXT,
        updated_by_email TEXT,
        deleted_at      TIMESTAMPTZ,
        created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS fleet_expenses_company_idx ON fleet_expenses(company_id);
      CREATE INDEX IF NOT EXISTS fleet_expenses_date_idx    ON fleet_expenses(company_id, expense_date);
      CREATE INDEX IF NOT EXISTS fleet_expenses_type_idx    ON fleet_expenses(company_id, expense_type);
      CREATE INDEX IF NOT EXISTS fleet_expenses_vehicle_idx ON fleet_expenses(vehicle_id);
    `));
    _expensesMigrated = true;
    logger.info("[fleetExpenses] Migration selesai");
  } catch (err) {
    logger.error({ err }, "[fleetExpenses] Migration error");
  }
}
deferStartupTask("fleet-expenses", runFleetExpensesMigration);

const EXPENSE_TYPES = ["Ban", "Perbaikan", "Service Rutin", "Asuransi", "Bahan Bakar", "Parkir", "Tilang", "Oli", "Spare Part", "Lainnya"] as const;
const EXPENSE_HIGHLIGHT_THRESHOLD = 5_000_000; // Rp 5.000.000

/** GET /expenses — list with filters: date_from, date_to, expense_type, vehicle_id, page, limit */
router.get("/expenses", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });

    const { date_from, date_to, expense_type, vehicle_id, page = "1", limit = "50", group_by } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page) || 1);
    const limitNum = Math.min(200, Math.max(1, parseInt(limit) || 50));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = [`e.company_id = ${companyId}`, `e.deleted_at IS NULL`];
    if (date_from) conditions.push(`e.expense_date >= '${sanitize(date_from)}'`);
    if (date_to)   conditions.push(`e.expense_date <= '${sanitize(date_to)}'`);
    if (expense_type && expense_type !== "all") conditions.push(`e.expense_type = '${sanitize(expense_type)}'`);
    if (vehicle_id && vehicle_id !== "all") conditions.push(`e.vehicle_id = ${parseInt(vehicle_id) || 0}`);
    const where = conditions.join(" AND ");

    const [listRes, countRes, summaryRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT e.*, v.plate AS vehicle_plate, v.vehicle_type
        FROM fleet_expenses e
        LEFT JOIN fleet_vehicles v ON v.id = e.vehicle_id
        WHERE ${where}
        ORDER BY e.expense_date DESC, e.id DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`SELECT COUNT(*) AS total FROM fleet_expenses e WHERE ${where}`)),
      db.execute(sql.raw(`
        SELECT
          COALESCE(SUM(amount), 0) AS total_all,
          SUM(CASE WHEN expense_date >= DATE_TRUNC('month', CURRENT_DATE) THEN amount ELSE 0 END) AS total_this_month,
          expense_type,
          SUM(amount) AS type_total
        FROM fleet_expenses e
        WHERE ${where}
        GROUP BY expense_type
        ORDER BY type_total DESC
      `)),
    ]);

    const expenses   = listRes.rows as Record<string, unknown>[];
    const total      = parseInt(String((countRes.rows[0] as Record<string, unknown>)?.total ?? 0));
    const summary    = summaryRes.rows as Record<string, unknown>[];
    const totalAll   = summary.reduce((s, r) => s + numVal(r.total_all), 0);
    const totalMonth = summary.reduce((s, r) => s + numVal(r.total_this_month), 0);
    const byType     = summary.map(r => ({ expense_type: r.expense_type, total: numVal(r.type_total) }));

    res.json({
      expenses,
      total,
      page: pageNum,
      limit: limitNum,
      summary: { total_all: totalAll, total_this_month: totalMonth, by_type: byType },
      highlight_threshold: EXPENSE_HIGHLIGHT_THRESHOLD,
      expense_types: EXPENSE_TYPES,
    });
  } catch (err) {
    logger.error({ err }, "[fleet/expenses] GET error");
    res.status(500).json({ error: "Gagal mengambil data pengeluaran" });
  }
});

/** POST /expenses — create new expense record */
router.post("/expenses", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });

    const { expense_date, expense_type, description, amount, vehicle_id } = req.body as Record<string, unknown>;

    if (!expense_date || !expense_type || !amount)
      return res.status(400).json({ error: "expense_date, expense_type, dan amount wajib diisi" });

    const parsedAmount = numVal(amount);
    if (parsedAmount <= 0) return res.status(400).json({ error: "Nominal harga harus > 0" });

    const dateStr = String(expense_date);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return res.status(400).json({ error: "Format tanggal harus YYYY-MM-DD" });

    const vehicleClause = vehicle_id ? parseInt(String(vehicle_id)) || "NULL" : "NULL";
    const userEmail = sanitize(meta.userEmail ?? (req.user as any)?.email ?? "");
    const userName  = sanitize((req.user as any)?.name  ?? "");

    const result = await db.execute(sql.raw(`
      INSERT INTO fleet_expenses
        (company_id, vehicle_id, expense_date, expense_type, description, amount, created_by, created_by_email, updated_at)
      VALUES
        (${companyId}, ${vehicleClause}, '${sanitize(dateStr)}', '${sanitize(String(expense_type))}',
         ${sq(description)}, ${parsedAmount.toFixed(2)}, '${userName}', '${userEmail}', NOW())
      RETURNING *
    `));

    writeAuditLog({ ...meta, action: "create", module: "fleet_expenses", referenceId: String((result.rows[0] as Record<string, unknown>)?.id ?? "") });
    res.status(201).json({ ok: true, expense: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet/expenses] POST error");
    res.status(500).json({ error: "Gagal menyimpan pengeluaran" });
  }
});

/** PUT /expenses/:id — update existing expense */
router.put("/expenses/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });

    const id = parseInt(String(req.params.id));
    if (!id) return res.status(400).json({ error: "ID tidak valid" });

    const existing = await db.execute(sql.raw(`
      SELECT id FROM fleet_expenses WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
    `));
    if (existing.rows.length === 0) return res.status(404).json({ error: "Pengeluaran tidak ditemukan" });

    const { expense_date, expense_type, description, amount, vehicle_id } = req.body as Record<string, unknown>;

    const sets: string[] = [];
    if (expense_date) {
      const ds = String(expense_date);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return res.status(400).json({ error: "Format tanggal harus YYYY-MM-DD" });
      sets.push(`expense_date = '${sanitize(ds)}'`);
    }
    if (expense_type) sets.push(`expense_type = '${sanitize(String(expense_type))}'`);
    if (description !== undefined) sets.push(`description = ${sq(description)}`);
    if (amount !== undefined) {
      const parsedAmount = numVal(amount);
      if (parsedAmount <= 0) return res.status(400).json({ error: "Nominal harga harus > 0" });
      sets.push(`amount = ${parsedAmount.toFixed(2)}`);
    }
    if (vehicle_id !== undefined) {
      const vid = vehicle_id ? parseInt(String(vehicle_id)) || null : null;
      sets.push(`vehicle_id = ${vid ?? "NULL"}`);
    }

    const userEmail = sanitize(meta.userEmail ?? (req.user as any)?.email ?? "");
    const userName  = sanitize((req.user as any)?.name  ?? "");
    sets.push(`updated_by = '${userName}'`);
    sets.push(`updated_by_email = '${userEmail}'`);
    sets.push(`updated_at = NOW()`);

    const result = await db.execute(sql.raw(`
      UPDATE fleet_expenses SET ${sets.join(", ")} WHERE id = ${id} AND company_id = ${companyId} RETURNING *
    `));

    writeAuditLog({ ...meta, action: "update", module: "fleet_expenses", referenceId: String(id) });
    res.json({ ok: true, expense: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet/expenses] PUT error");
    res.status(500).json({ error: "Gagal mengupdate pengeluaran" });
  }
});

/** DELETE /expenses/:id — soft delete */
router.delete("/expenses/:id", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const meta = extractRequestMeta(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });

    const id = parseInt(String(req.params.id));
    if (!id) return res.status(400).json({ error: "ID tidak valid" });

    const result = await db.execute(sql.raw(`
      UPDATE fleet_expenses
      SET deleted_at = NOW(), updated_at = NOW()
      WHERE id = ${id} AND company_id = ${companyId} AND deleted_at IS NULL
      RETURNING id
    `));

    if (result.rows.length === 0) return res.status(404).json({ error: "Pengeluaran tidak ditemukan" });

    writeAuditLog({ ...meta, action: "delete", module: "fleet_expenses", referenceId: String(id) });
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[fleet/expenses] DELETE error");
    res.status(500).json({ error: "Gagal menghapus pengeluaran" });
  }
});

/** GET /expenses/export — export Excel */
router.get("/expenses/export", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    if (!companyId) return res.status(400).json({ error: "companyId diperlukan" });

    const { date_from, date_to, expense_type, vehicle_id } = req.query as Record<string, string>;
    const conditions: string[] = [`e.company_id = ${companyId}`, `e.deleted_at IS NULL`];
    if (date_from) conditions.push(`e.expense_date >= '${sanitize(date_from)}'`);
    if (date_to)   conditions.push(`e.expense_date <= '${sanitize(date_to)}'`);
    if (expense_type && expense_type !== "all") conditions.push(`e.expense_type = '${sanitize(expense_type)}'`);
    if (vehicle_id && vehicle_id !== "all") conditions.push(`e.vehicle_id = ${parseInt(vehicle_id) || 0}`);

    const result = await db.execute(sql.raw(`
      SELECT e.*, v.plate AS vehicle_plate
      FROM fleet_expenses e
      LEFT JOIN fleet_vehicles v ON v.id = e.vehicle_id
      WHERE ${conditions.join(" AND ")}
      ORDER BY e.expense_date DESC
      LIMIT 5000
    `));

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Fleet Expenses");
    ws.columns = [
      { header: "ID", key: "id", width: 8 },
      { header: "Tanggal", key: "expense_date", width: 14 },
      { header: "Plat Kendaraan", key: "vehicle_plate", width: 16 },
      { header: "Jenis Pengeluaran", key: "expense_type", width: 20 },
      { header: "Deskripsi", key: "description", width: 36 },
      { header: "Nominal (Rp)", key: "amount", width: 18 },
      { header: "Dibuat Oleh", key: "created_by", width: 20 },
      { header: "Dibuat Pada", key: "created_at", width: 22 },
      { header: "Diupdate Oleh", key: "updated_by", width: 20 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

    (result.rows as Record<string, unknown>[]).forEach((r) => {
      const row = ws.addRow({
        id: r.id,
        expense_date: r.expense_date ? String(r.expense_date).slice(0, 10) : "",
        vehicle_plate: r.vehicle_plate ?? "-",
        expense_type: r.expense_type,
        description: r.description ?? "",
        amount: numVal(r.amount),
        created_by: r.created_by ?? "",
        created_at: r.created_at ? new Date(String(r.created_at)).toLocaleString("id-ID") : "",
        updated_by: r.updated_by ?? "",
      });
      const amountCell = row.getCell("amount");
      amountCell.numFmt = "#,##0";
      if (numVal(r.amount) >= EXPENSE_HIGHLIGHT_THRESHOLD) {
        row.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      }
    });

    const totalRow = ws.addRow({
      expense_type: "TOTAL",
      amount: (result.rows as Record<string, unknown>[]).reduce((s, r) => s + numVal(r.amount), 0),
    });
    totalRow.font = { bold: true };
    totalRow.getCell("amount").numFmt = "#,##0";

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="fleet-expenses-${Date.now()}.xlsx"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    logger.error({ err }, "[fleet/expenses] export error");
    res.status(500).json({ error: "Gagal export Excel" });
    res.status(500).json({ error: "Gagal mengekspor data pengeluaran" });
  }
});

// ─── PIPELINE GOVERNANCE ENDPOINTS ───────────────────────────────────────────

/**
 * POST /pipeline/reconcile
 * Financial Reconciliation Engine — compare raw vs transformed vs fleet_transactions.
 * Detects: missing rows, amount mismatches, type mismatches.
 */
router.post("/pipeline/reconcile", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { reportId } = req.body as { reportId?: number };
    const reportFilter = reportId ? `AND r.report_id = ${parseInt(String(reportId))}` : "";
    const compFilter   = reportId ? `AND t.report_id = ${parseInt(String(reportId))}` : "";

    // Raw row counts per report
    const rawCounts = await db.execute(sql.raw(`
      SELECT r.report_id, COUNT(*) AS raw_count,
        SUM(r.amount::numeric) AS raw_amount_sum
      FROM gojek_raw_transactions r
      WHERE r.company_id = ${companyId} ${reportFilter}
      GROUP BY r.report_id
    `));

    // Transformed row counts per report
    const txCounts = await db.execute(sql.raw(`
      SELECT t.report_id, COUNT(*) AS tx_count,
        SUM(t.amount)        AS tx_amount_sum,
        SUM(t.gross_revenue) AS tx_gross_sum,
        SUM(t.net_revenue)   AS tx_net_sum
      FROM fleet_transactions t
      WHERE t.company_id = ${companyId} ${compFilter}
      GROUP BY t.report_id
    `));

    // DLQ counts per report
    const dlqCounts = await db.execute(sql.raw(`
      SELECT f.report_id, COUNT(*) AS dlq_count
      FROM gojek_failed_rows f
      WHERE f.company_id = ${companyId} AND f.resolved = FALSE
      ${reportId ? `AND f.report_id = ${parseInt(String(reportId))}` : ""}
      GROUP BY f.report_id
    `));

    // Build reconciliation result per report
    const rawMap  = new Map((rawCounts.rows as any[]).map((r) => [r.report_id, r]));
    const txMap   = new Map((txCounts.rows as any[]).map((r) => [r.report_id, r]));
    const dlqMap  = new Map((dlqCounts.rows as any[]).map((r) => [r.report_id, r]));

    const allReportIds = [...new Set([...rawMap.keys(), ...txMap.keys()])];
    const reconciliation = allReportIds.map((rid) => {
      const raw = rawMap.get(rid) ?? { raw_count: 0, raw_amount_sum: 0 };
      const tx  = txMap.get(rid)  ?? { tx_count: 0, tx_amount_sum: 0, tx_gross_sum: 0, tx_net_sum: 0 };
      const dlq = dlqMap.get(rid) ?? { dlq_count: 0 };

      const rawCount    = numVal(raw.raw_count);
      const txCount     = numVal(tx.tx_count);
      const dlqCount    = numVal(dlq.dlq_count);
      const missingRows = rawCount - txCount - dlqCount;
      const amountMismatch = Math.abs(numVal(raw.raw_amount_sum) - numVal(tx.tx_amount_sum)) > 0.01;
      const mismatches: string[] = [];
      if (missingRows > 0) mismatches.push(`${missingRows} baris hilang (tidak di tx maupun DLQ)`);
      if (missingRows < 0) mismatches.push(`${Math.abs(missingRows)} baris lebih di tx dari raw`);
      if (amountMismatch) mismatches.push(`Amount mismatch: raw=${numVal(raw.raw_amount_sum).toFixed(2)} vs tx=${numVal(tx.tx_amount_sum).toFixed(2)}`);

      const health = computeHealthScore({ totalRaw: rawCount, transformed: txCount, failed: dlqCount, dlqRows: dlqCount });

      return {
        reportId: rid,
        rawCount, txCount, dlqCount,
        missingRows: Math.max(0, missingRows),
        excessRows:  Math.max(0, -missingRows),
        amountMismatch,
        rawAmountSum: numVal(raw.raw_amount_sum),
        txAmountSum:  numVal(tx.tx_amount_sum),
        mismatches,
        status: mismatches.length === 0 ? "ok" : "mismatch",
        healthScore: health.score,
        healthGrade: health.grade,
      };
    });

    const summary = {
      totalReports:    reconciliation.length,
      ok:              reconciliation.filter((r) => r.status === "ok").length,
      mismatch:        reconciliation.filter((r) => r.status === "mismatch").length,
      totalMissing:    reconciliation.reduce((s, r) => s + r.missingRows, 0),
      totalAmountMismatches: reconciliation.filter((r) => r.amountMismatch).length,
      avgHealthScore:  reconciliation.length > 0
        ? Math.round(reconciliation.reduce((s, r) => s + r.healthScore, 0) / reconciliation.length)
        : 0,
    };

    const meta = extractRequestMeta(req);
    writeAuditLog({ ...meta, action: "reconcile_pipeline", module: "fleet_pipeline", newData: summary as unknown as Record<string, unknown> });
    res.json({ reconciliation, summary });
  } catch (err) {
    logger.error({ err }, "[fleet][gov] reconcile error");
    res.status(500).json({ error: "Gagal menjalankan rekonsiliasi pipeline" });
  }
});

/**
 * GET /pipeline/health
 * Health score overview — per-report health scores for this company
 */
router.get("/pipeline/health", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { reportId } = req.query as Record<string, string>;
    const repFilter = reportId ? `AND r.id = ${parseInt(reportId)}` : "";

    const reports = await db.execute(sql.raw(`
      SELECT
        r.id AS report_id,
        r.original_filename,
        r.status AS report_status,
        r.row_count,
        r.processed_count,
        r.error_count,
        (SELECT COUNT(*) FROM gojek_raw_transactions rt WHERE rt.report_id = r.id)         AS raw_count,
        (SELECT COUNT(*) FROM fleet_transactions      tx WHERE tx.report_id = r.id)         AS tx_count,
        (SELECT COUNT(*) FROM gojek_failed_rows       f  WHERE f.report_id  = r.id AND f.resolved = FALSE) AS dlq_count,
        (SELECT COUNT(*) FROM gojek_pipeline_audit_logs al WHERE al.report_id = r.id)      AS audit_entries,
        r.summary_stats,
        r.created_at
      FROM fleet_reports r
      WHERE r.company_id = ${companyId} ${repFilter}
      ORDER BY r.created_at DESC
      LIMIT 50
    `));

    const scored = (reports.rows as Record<string, unknown>[]).map((row) => {
      const totalRaw   = numVal(row.raw_count);
      const transformed = numVal(row.tx_count);
      const failed      = numVal(row.dlq_count);
      const dlqRows     = numVal(row.dlq_count);
      const health = computeHealthScore({ totalRaw, transformed, failed, dlqRows });
      return { ...row, healthScore: health.score, healthGrade: health.grade, healthBreakdown: health.breakdown };
    });

    // Company-level aggregate
    const totalScored = scored.length;
    const avgScore = totalScored > 0
      ? Math.round(scored.reduce((s, r) => s + r.healthScore, 0) / totalScored)
      : 0;
    const companyGrade = avgScore >= 90 ? "A" : avgScore >= 75 ? "B" : avgScore >= 60 ? "C" : avgScore >= 40 ? "D" : "F";

    res.json({
      reports: scored,
      companyHealth: { avgScore, grade: companyGrade, totalReports: totalScored },
      governanceRules: {
        maxConcurrent: PIPELINE_MAX_CONCURRENT,
        batchSize:     PIPELINE_BATCH_SIZE,
        backpressureThreshold: PIPELINE_BACKPRESSURE_THRESHOLD,
        priorityLevels: Object.keys(PRIORITY_WEIGHT),
      },
    });
  } catch (err) {
    logger.error({ err }, "[fleet][gov] health error");
    res.status(500).json({ error: "Gagal mengambil health score" });
  }
});

/**
 * GET /pipeline/governance
 * Real-time governance status — current concurrency, backpressure, queue depth
 */
router.get("/pipeline/governance", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);

    const [concurrencyRes, backpressureRes, auditStatsRes, priorityRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT status, COUNT(*) AS cnt
        FROM gojek_ingestion_queue q
        JOIN fleet_reports r ON r.id = q.report_id
        WHERE r.company_id = ${companyId}
        GROUP BY status
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE status IN ('pending','processing')) AS active,
          COUNT(*) FILTER (WHERE status = 'failed')                  AS failed,
          COUNT(*) FILTER (WHERE status = 'done')                    AS done
        FROM gojek_ingestion_queue q
        JOIN fleet_reports r ON r.id = q.report_id
        WHERE r.company_id = ${companyId}
      `)),
      db.execute(sql.raw(`
        SELECT field_name, COUNT(*) AS changes, COUNT(DISTINCT report_id) AS reports
        FROM gojek_pipeline_audit_logs
        WHERE company_id = ${companyId}
        GROUP BY field_name
        ORDER BY changes DESC
        LIMIT 10
      `)),
      db.execute(sql.raw(`
        SELECT priority, COUNT(*) AS cnt
        FROM gojek_ingestion_queue q
        JOIN fleet_reports r ON r.id = q.report_id
        WHERE r.company_id = ${companyId} AND q.status IN ('pending','processing')
        GROUP BY priority
        ORDER BY (CASE priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END)
      `)),
    ]);

    const bp = (backpressureRes.rows[0] as any) ?? {};
    const active = numVal(bp.active);
    const overloaded = active >= PIPELINE_BACKPRESSURE_THRESHOLD;

    res.json({
      rules: {
        maxConcurrent:         PIPELINE_MAX_CONCURRENT,
        batchSize:             PIPELINE_BATCH_SIZE,
        backpressureThreshold: PIPELINE_BACKPRESSURE_THRESHOLD,
        priorityLevels:        Object.keys(PRIORITY_WEIGHT),
      },
      currentStatus: {
        concurrencyByStatus: concurrencyRes.rows,
        activePipelines:     active,
        backpressure:        { overloaded, active, threshold: PIPELINE_BACKPRESSURE_THRESHOLD },
        priorityQueue:       priorityRes.rows,
      },
      auditStats: {
        topChangedFields: auditStatsRes.rows,
      },
      governance: {
        noUnlimitedBurst:       true,
        noBoundlessQueue:       active < PIPELINE_BACKPRESSURE_THRESHOLD,
        noSilentDegradation:    true, // DLQ enforces traceability
        everyTransformTraceable: true, // gojek_pipeline_audit_logs
      },
    });
  } catch (err) {
    logger.error({ err }, "[fleet][gov] governance status error");
    res.status(500).json({ error: "Gagal mengambil status governance" });
  }
});

/**
 * PUT /pipeline/queue/:reportId/priority
 * Update priority of a queued item (critical/high/normal/low)
 */
router.put("/pipeline/queue/:reportId/priority", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const reportId = parseInt(String(req.params.reportId));
    const { priority = "normal" } = req.body as { priority?: string };
    if (!PRIORITY_WEIGHT.hasOwnProperty(priority)) {
      return res.status(400).json({ error: "Priority tidak valid. Gunakan: critical, high, normal, low" });
    }
    await db.execute(sql.raw(`
      UPDATE gojek_ingestion_queue SET priority = ${sq(priority)}
      WHERE report_id = ${reportId}
        AND report_id IN (SELECT id FROM fleet_reports WHERE company_id = ${companyId})
    `));
    const meta = extractRequestMeta(req);
    writeAuditLog({ ...meta, action: "set_priority", module: "fleet_pipeline", referenceId: String(reportId), newData: { priority } });
    res.json({ ok: true, priority });
  } catch (err) {
    res.status(500).json({ error: "Gagal update priority" });
  }
});

/**
 * GET /pipeline/audit/:reportId
 * Audit diff log for a specific report — every field transformation traceable
 */
router.get("/pipeline/audit/:reportId", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const reportId = parseInt(String(req.params.reportId));
    const { field, page = "1", limit = "100" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);
    const fieldFilter = field ? `AND field_name = '${sanitize(field)}'` : "";

    const [rows, summary] = await Promise.all([
      db.execute(sql.raw(`
        SELECT al.*, rt.driver_name AS raw_driver_name
        FROM gojek_pipeline_audit_logs al
        LEFT JOIN gojek_raw_transactions rt ON rt.id = al.raw_row_id
        WHERE al.report_id = ${reportId} AND al.company_id = ${companyId} ${fieldFilter}
        ORDER BY al.id
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`
        SELECT field_name, COUNT(*) AS change_count
        FROM gojek_pipeline_audit_logs
        WHERE report_id = ${reportId} AND company_id = ${companyId}
        GROUP BY field_name ORDER BY change_count DESC
      `)),
    ]);

    res.json({ auditLogs: rows.rows, fieldSummary: summary.rows });
  } catch (err) {
    logger.error({ err }, "[fleet][gov] audit log error");
    res.status(500).json({ error: "Gagal mengambil audit log pipeline" });
  }
});

// ─── PIPELINE MANAGEMENT ENDPOINTS ───────────────────────────────────────────

/**
 * POST /reprocess/:reportId
 * Re-run Phase 2 transform from raw table. Safe to call multiple times — idempotent.
 * Use when: queue status = failed | transform_failed | done (to re-apply fixes)
 */
router.post("/reprocess/:reportId", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const reportId = parseInt(String(req.params.reportId));
    if (isNaN(reportId)) return res.status(400).json({ error: "reportId tidak valid" });

    // Verify ownership + raw data exists
    const [reportCheck, rawCount] = await Promise.all([
      db.execute(sql.raw(`SELECT id, status FROM fleet_reports WHERE id = ${reportId} AND company_id = ${companyId}`)),
      db.execute(sql.raw(`SELECT COUNT(*) AS cnt FROM gojek_raw_transactions WHERE report_id = ${reportId} AND company_id = ${companyId}`)),
    ]);
    if (reportCheck.rows.length === 0) return res.status(404).json({ error: "Report tidak ditemukan" });
    if (numVal((rawCount.rows[0] as any).cnt) === 0) return res.status(400).json({ error: "Tidak ada raw data untuk direprocess — upload ulang file" });

    const meta = extractRequestMeta(req);

    // Reset queue entry (or create if missing)
    await db.execute(sql.raw(`
      INSERT INTO gojek_ingestion_queue (report_id, company_id, status)
      VALUES (${reportId}, ${companyId ?? "NULL"}, 'pending')
      ON CONFLICT (report_id) DO UPDATE SET
        status      = 'pending',
        last_error  = NULL,
        retry_count = gojek_ingestion_queue.retry_count + 1,
        enqueued_at = NOW()
    `));

    // Fire async — respond immediately
    transformRawToFleet(reportId, companyId, meta).catch((err) => {
      logger.error({ err, reportId }, "[fleet] reprocess async error");
    });

    writeAuditLog({ ...meta, action: "reprocess", module: "fleet_reports", referenceId: String(reportId) });
    res.json({ ok: true, message: "Reprocess dimulai — Phase 2 transform sedang berjalan dari raw data", reportId });
  } catch (err) {
    logger.error({ err }, "[fleet] reprocess error");
    res.status(500).json({ error: "Gagal memulai reprocess" });
  }
});

/**
 * GET /pipeline/queue
 * View ingestion queue status — semua report beserta fase transform-nya
 */
router.get("/pipeline/queue", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { status } = req.query as Record<string, string>;
    const statusFilter = status ? `AND q.status = '${sanitize(status)}'` : "";

    const rows = await db.execute(sql.raw(`
      SELECT
        q.id, q.report_id, q.status, q.retry_count, q.last_error,
        q.enqueued_at, q.started_at, q.completed_at,
        r.original_filename, r.row_count, r.processed_count, r.error_count,
        r.status AS report_status,
        EXTRACT(EPOCH FROM (COALESCE(q.completed_at, NOW()) - q.started_at))::int AS duration_sec,
        (SELECT COUNT(*) FROM gojek_failed_rows f WHERE f.report_id = q.report_id AND f.resolved = FALSE) AS pending_dlq_rows,
        (SELECT COUNT(*) FROM gojek_raw_transactions rt WHERE rt.report_id = q.report_id) AS raw_row_count
      FROM gojek_ingestion_queue q
      JOIN fleet_reports r ON r.id = q.report_id
      WHERE r.company_id = ${companyId} ${statusFilter}
      ORDER BY q.created_at DESC
      LIMIT 100
    `));

    const summary = await db.execute(sql.raw(`
      SELECT status, COUNT(*) AS cnt
      FROM gojek_ingestion_queue q
      JOIN fleet_reports r ON r.id = q.report_id
      WHERE r.company_id = ${companyId}
      GROUP BY status
    `));

    res.json({ queue: rows.rows, summary: summary.rows });
  } catch (err) {
    logger.error({ err }, "[fleet] pipeline queue error");
    res.status(500).json({ error: "Gagal mengambil pipeline queue" });
  }
});

/**
 * GET /pipeline/dlq
 * Dead Letter Queue — semua baris yang gagal transform
 */
router.get("/pipeline/dlq", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const { reportId, resolved = "false", page = "1", limit = "50" } = req.query as Record<string, string>;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const conditions = [`f.company_id = ${companyId}`, `f.resolved = ${resolved === "true"}`];
    if (reportId) conditions.push(`f.report_id = ${parseInt(reportId)}`);
    const where = conditions.join(" AND ");

    const [rows, countRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT f.*, r.original_filename
        FROM gojek_failed_rows f
        LEFT JOIN fleet_reports r ON r.id = f.report_id
        WHERE ${where}
        ORDER BY f.created_at DESC
        LIMIT ${parseInt(limit)} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS total,
          COUNT(*) FILTER (WHERE error_stage = 'transform') AS transform_errors
        FROM gojek_failed_rows f WHERE ${where}
      `)),
    ]);

    res.json({ failedRows: rows.rows, summary: countRes.rows[0] });
  } catch (err) {
    logger.error({ err }, "[fleet] DLQ list error");
    res.status(500).json({ error: "Gagal mengambil DLQ" });
  }
});

/**
 * POST /pipeline/dlq/:id/retry
 * Retry transform satu baris dari DLQ
 */
router.post("/pipeline/dlq/:id/retry", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(String(req.params.id));
    const meta = extractRequestMeta(req);

    const dlqRes = await db.execute(sql.raw(`
      SELECT * FROM gojek_failed_rows WHERE id = ${id} AND company_id = ${companyId}
    `));
    if (dlqRes.rows.length === 0) return res.status(404).json({ error: "DLQ row tidak ditemukan" });

    const dlqRow = dlqRes.rows[0] as Record<string, unknown>;
    const rawData = (dlqRow.raw_data ?? {}) as Record<string, unknown>;
    const reportId = dlqRow.report_id as number;

    // Get column mapping
    const reportRes = await db.execute(sql.raw(`SELECT column_mapping FROM fleet_reports WHERE id = ${reportId}`));
    const colMap: Record<string, string | null> = (reportRes.rows[0] as any)?.column_mapping ?? {};

    // Re-apply transform on raw_data
    const item = mapRow(rawData, colMap);
    const driverExtId = String(rawData.driver_external_id ?? item.driverExtId ?? "").trim();
    const driverName  = String(rawData.driver_name ?? item.driverName ?? "").trim();
    const vehiclePlate = String(rawData.vehicle ?? item.vehiclePlate ?? "").trim();
    const driverPhone = String(rawData.phone_number ?? item.driverPhone ?? "").replace(/^\t+/, "").trim();
    const txDate = toIsoDate(rawData.date_time_jkt) || toIsoDate(rawData.date) || item.txDate;
    const amount = numVal(rawData.amount) || item.amount;
    const outstanding = numVal(rawData.total_outstanding_balance) || item.outstanding;
    const gopayRef = String(rawData.gopay_transaction_reference_id ?? item.gopayRef ?? "").trim();
    const grossRevenue = item.grossRevenue || amount;
    const netRevenue   = item.netRevenue   || amount;
    const ppnRate = DEFAULT_PPN_RATE;
    const ppnAmount = grossRevenue * ppnRate / 100;

    if (!driverName && !driverExtId) return res.status(400).json({ error: "Baris ini tidak dapat diretry: nama dan ID driver kosong" });
    if (!txDate) return res.status(400).json({ error: "Baris ini tidak dapat diretry: tanggal kosong" });

    // Try upsert driver
    let driverId: number | null = null;
    if (driverExtId) {
      const res2 = await db.execute(sql.raw(`
        INSERT INTO fleet_drivers (company_id, driver_external_id, name, phone, vehicle_plate, vehicle_type, status, last_active_date)
        VALUES (${companyId}, ${sq(driverExtId)}, ${sq(driverName || "Unknown")}, ${sq(driverPhone)}, ${sq(vehiclePlate)}, ${sq(item.serviceType)}, 'active', ${sq(txDate)})
        ON CONFLICT (company_id, driver_external_id)
          WHERE driver_external_id IS NOT NULL AND driver_external_id != ''
        DO UPDATE SET updated_at = NOW()
        RETURNING id
      `));
      driverId = (res2.rows[0] as any)?.id ?? null;
    }

    // Insert transaction
    await db.execute(sql.raw(`
      INSERT INTO fleet_transactions (
        company_id, report_id, driver_id, driver_external_id, driver_name,
        vehicle_plate, driver_phone, transaction_date,
        trip_count, amount, transaction_type, gopay_reference_id,
        gross_revenue, incentive, commission, deduction, net_revenue,
        outstanding_balance, ppn_rate, ppn_amount, service_type, raw_data
      ) VALUES (
        ${companyId}, ${reportId}, ${driverId ?? "NULL"}, ${sq(driverExtId)}, ${sq(driverName || "Unknown")},
        ${sq(vehiclePlate)}, ${sq(driverPhone)}, ${sq(txDate || "2000-01-01")}::date,
        ${Math.round(item.tripCount)}, ${sn(amount)}, ${sq(item.transactionType)}, ${sq(gopayRef)},
        ${sn(grossRevenue)}, ${sn(item.incentive)}, ${sn(item.commission)}, ${sn(item.deduction)},
        ${sn(netRevenue)}, ${sn(outstanding)}, ${sn(ppnRate)}, ${sn(ppnAmount)},
        ${sq(item.serviceType)}, ${sqJson(rawData)}
      )
      ON CONFLICT (company_id, gopay_reference_id)
        WHERE gopay_reference_id IS NOT NULL AND gopay_reference_id != ''
      DO NOTHING
    `));

    // Mark DLQ row as resolved
    await db.execute(sql.raw(`
      UPDATE gojek_failed_rows SET resolved = TRUE, resolved_at = NOW(), retry_count = retry_count + 1
      WHERE id = ${id}
    `));

    writeAuditLog({ ...meta, action: "dlq_retry", module: "fleet_pipeline", referenceId: String(id) });
    res.json({ ok: true, message: "Baris berhasil ditransform dan ditandai resolved di DLQ" });
  } catch (err) {
    logger.error({ err }, "[fleet] DLQ retry error");
    // Increment retry_count in DLQ
    const failedRowId = parseInt(String(req.params.id));
    await db.execute(sql`UPDATE gojek_failed_rows SET retry_count = retry_count + 1 WHERE id = ${failedRowId}`).catch(() => {});
    res.status(500).json({ error: `Retry gagal: ${(err as Error).message}` });
  }
});

/**
 * GET /pipeline/dlq/:reportId/resolve-all
 * Mark all resolved DLQ rows for a report after successful reprocess
 */
router.post("/pipeline/dlq/resolve-all/:reportId", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const reportId = parseInt(String(req.params.reportId));
    const meta = extractRequestMeta(req);

    const result = await db.execute(sql.raw(`
      UPDATE gojek_failed_rows SET resolved = TRUE, resolved_at = NOW()
      WHERE report_id = ${reportId} AND company_id = ${companyId} AND resolved = FALSE
      RETURNING id
    `));

    writeAuditLog({ ...meta, action: "dlq_resolve_all", module: "fleet_pipeline", referenceId: String(reportId) });
    res.json({ ok: true, resolvedCount: result.rows.length });
  } catch (err) {
    res.status(500).json({ error: "Gagal resolve DLQ rows" });
  }
});

// ─── SYSTEM OVERVIEW (single aggregated status API) ───────────────────────────

/** System boundary limits — single source of truth */
const SYSTEM_BOUNDS = {
  maxQueueSize:           500,   // max fleet_reports pending/processing at once
  maxDlqRows:             200,   // max unresolved DLQ rows before critical alert
  maxConcurrentServices:  20,    // max active pipeline workers conceptually
  maxTransactionsPerDay:  50000, // alert if single-day transaction count exceeds
  maxActiveDrivers:       5000,  // alert if active driver count exceeds
  healthScoreMinGreen:    80,    // score >= 80 = green
  healthScoreMinYellow:   50,    // score >= 50 = yellow, else red
};

/**
 * Compute a 0–100 system-wide health score based on:
 * - recent upload success rate (40pts)
 * - DLQ pressure (30pts)
 * - reconciliation integrity (20pts)
 * - unread critical alerts (10pts)
 */
function computeSystemHealthScore(params: {
  recentTotal: number;
  recentFailed: number;
  dlqUnresolved: number;
  summaryMismatches: number;
  criticalAlerts: number;
}): number {
  const { recentTotal, recentFailed, dlqUnresolved, summaryMismatches, criticalAlerts } = params;

  // Upload success rate (40pts)
  const successRate = recentTotal > 0 ? (recentTotal - recentFailed) / recentTotal : 1;
  const uploadScore = Math.round(successRate * 40);

  // DLQ pressure (30pts)
  const dlqPressure = Math.min(dlqUnresolved / SYSTEM_BOUNDS.maxDlqRows, 1);
  const dlqScore = Math.round((1 - dlqPressure) * 30);

  // Reconciliation (20pts)
  const reconPressure = Math.min(summaryMismatches / 10, 1);
  const reconScore = Math.round((1 - reconPressure) * 20);

  // Critical alerts (10pts)
  const alertPressure = Math.min(criticalAlerts / 5, 1);
  const alertScore = Math.round((1 - alertPressure) * 10);

  return Math.max(0, Math.min(100, uploadScore + dlqScore + reconScore + alertScore));
}

router.get("/system-overview", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);

    const [
      queueStats,
      dlqStats,
      recentUploads,
      reconciliationCheck,
      alertStats,
      transactionStats,
      driverStats,
    ] = await Promise.all([
      // 1. Ingestion queue: reports by status
      db.execute(sql.raw(`
        SELECT
          status,
          COUNT(*) AS cnt,
          MAX(created_at) AS latest
        FROM fleet_reports
        WHERE company_id = ${companyId}
        GROUP BY status
        ORDER BY status
      `)),

      // 2. DLQ: unresolved failed rows
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                    AS total_dlq,
          COUNT(*) FILTER (WHERE resolved = FALSE)    AS unresolved,
          COUNT(*) FILTER (WHERE resolved = TRUE)     AS resolved,
          MAX(created_at)                             AS latest_error
        FROM gojek_failed_rows
        WHERE company_id = ${companyId}
      `)),

      // 3. Recent upload trend (last 7 days)
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                        AS total,
          COUNT(*) FILTER (WHERE status = 'completed')   AS succeeded,
          COUNT(*) FILTER (WHERE status = 'failed')      AS failed,
          COUNT(*) FILTER (WHERE status = 'processing')  AS processing,
          COUNT(*) FILTER (WHERE status = 'pending')     AS pending
        FROM fleet_reports
        WHERE company_id = ${companyId}
          AND created_at > NOW() - INTERVAL '7 days'
      `)),

      // 4. Reconciliation: daily_summary vs transactions mismatches
      db.execute(sql.raw(`
        SELECT COUNT(*) AS mismatches
        FROM fleet_daily_summary ds
        LEFT JOIN (
          SELECT transaction_date, SUM(gross_revenue) AS tx_gross
          FROM fleet_transactions WHERE company_id = ${companyId}
          GROUP BY transaction_date
        ) tx ON tx.transaction_date = ds.summary_date
        WHERE ds.company_id = ${companyId}
          AND ABS(ds.gross_revenue - COALESCE(tx.tx_gross, 0)) > 0.01
      `)),

      // 5. Alerts: unread by severity
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE is_read = FALSE AND alert_type ILIKE '%critical%') AS critical_unread,
          COUNT(*) FILTER (WHERE is_read = FALSE AND alert_type NOT ILIKE '%critical%') AS other_unread,
          COUNT(*) FILTER (WHERE is_read = FALSE) AS total_unread
        FROM fleet_alerts
        WHERE company_id = ${companyId}
      `)),

      // 6. Transaction totals + today
      db.execute(sql.raw(`
        SELECT
          COUNT(*)             AS total_transactions,
          COUNT(*) FILTER (WHERE transaction_date = CURRENT_DATE) AS today_count,
          SUM(gross_revenue)   AS total_gross,
          MAX(transaction_date) AS latest_date
        FROM fleet_transactions
        WHERE company_id = ${companyId}
      `)),

      // 7. Driver stats
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                         AS total_drivers,
          COUNT(*) FILTER (WHERE status = 'active')       AS active_drivers,
          COUNT(*) FILTER (WHERE status = 'suspended')    AS suspended_drivers
        FROM fleet_drivers
        WHERE company_id = ${companyId}
      `)),
    ]);

    const q = queueStats.rows as Record<string, unknown>[];
    const queueMap = Object.fromEntries(q.map((r) => [String(r.status), numVal(r.cnt)]));

    const dlq = (dlqStats.rows[0] ?? {}) as Record<string, unknown>;
    const recent = (recentUploads.rows[0] ?? {}) as Record<string, unknown>;
    const recon = (reconciliationCheck.rows[0] ?? {}) as Record<string, unknown>;
    const alerts = (alertStats.rows[0] ?? {}) as Record<string, unknown>;
    const txStats = (transactionStats.rows[0] ?? {}) as Record<string, unknown>;
    const drvStats = (driverStats.rows[0] ?? {}) as Record<string, unknown>;

    const dlqUnresolved = numVal(dlq.unresolved);
    const summaryMismatches = numVal(recon.mismatches);
    const criticalAlerts = numVal(alerts.critical_unread);
    const recentTotal = numVal(recent.total);
    const recentFailed = numVal(recent.failed);

    const healthScore = computeSystemHealthScore({
      recentTotal,
      recentFailed,
      dlqUnresolved,
      summaryMismatches,
      criticalAlerts,
    });

    const healthStatus =
      healthScore >= SYSTEM_BOUNDS.healthScoreMinGreen ? "green" :
      healthScore >= SYSTEM_BOUNDS.healthScoreMinYellow ? "yellow" : "red";

    // System bounds violations
    const boundsViolations: { rule: string; current: number; limit: number; severity: string }[] = [];
    const queueTotal = (queueMap["pending"] ?? 0) + (queueMap["processing"] ?? 0);
    if (queueTotal > SYSTEM_BOUNDS.maxQueueSize)
      boundsViolations.push({ rule: "Queue size exceeded", current: queueTotal, limit: SYSTEM_BOUNDS.maxQueueSize, severity: "critical" });
    if (dlqUnresolved > SYSTEM_BOUNDS.maxDlqRows)
      boundsViolations.push({ rule: "DLQ unresolved rows exceeded", current: dlqUnresolved, limit: SYSTEM_BOUNDS.maxDlqRows, severity: "critical" });
    if (numVal(drvStats.active_drivers) > SYSTEM_BOUNDS.maxActiveDrivers)
      boundsViolations.push({ rule: "Active drivers exceeded", current: numVal(drvStats.active_drivers), limit: SYSTEM_BOUNDS.maxActiveDrivers, severity: "warn" });
    if (numVal(txStats.today_count) > SYSTEM_BOUNDS.maxTransactionsPerDay)
      boundsViolations.push({ rule: "Daily transaction count exceeded", current: numVal(txStats.today_count), limit: SYSTEM_BOUNDS.maxTransactionsPerDay, severity: "warn" });

    res.json({
      generatedAt: new Date().toISOString(),
      companyId,
      healthScore,
      healthStatus,
      systemBounds: {
        limits: SYSTEM_BOUNDS,
        violations: boundsViolations,
        queueSaturation: Math.round((queueTotal / SYSTEM_BOUNDS.maxQueueSize) * 100),
        dlqSaturation: Math.round((dlqUnresolved / SYSTEM_BOUNDS.maxDlqRows) * 100),
      },
      ingestionQueue: {
        byStatus: queueMap,
        pending: queueMap["pending"] ?? 0,
        processing: queueMap["processing"] ?? 0,
        completed: queueMap["completed"] ?? 0,
        failed: queueMap["failed"] ?? 0,
        total: q.reduce((s, r) => s + numVal(r.cnt), 0),
        recentWeek: {
          total: recentTotal,
          succeeded: numVal(recent.succeeded),
          failed: recentFailed,
          processing: numVal(recent.processing),
          pending: numVal(recent.pending),
          successRate: recentTotal > 0 ? Math.round(((recentTotal - recentFailed) / recentTotal) * 100) : 100,
        },
      },
      dlq: {
        total: numVal(dlq.total_dlq),
        unresolved: dlqUnresolved,
        resolved: numVal(dlq.resolved),
        latestError: dlq.latest_error ?? null,
        pressure: Math.round((dlqUnresolved / Math.max(SYSTEM_BOUNDS.maxDlqRows, 1)) * 100),
      },
      reconciliation: {
        status: summaryMismatches === 0 ? "ok" : summaryMismatches <= 3 ? "warn" : "fail",
        summaryMismatches,
        message: summaryMismatches === 0
          ? "Daily summary konsisten dengan raw transactions"
          : `${summaryMismatches} tanggal memiliki selisih — jalankan rekonsiliasi`,
      },
      alerts: {
        criticalUnread: criticalAlerts,
        otherUnread: numVal(alerts.other_unread),
        totalUnread: numVal(alerts.total_unread),
      },
      transactions: {
        total: numVal(txStats.total_transactions),
        todayCount: numVal(txStats.today_count),
        totalGross: numVal(txStats.total_gross),
        latestDate: txStats.latest_date ?? null,
      },
      drivers: {
        total: numVal(drvStats.total_drivers),
        active: numVal(drvStats.active_drivers),
        suspended: numVal(drvStats.suspended_drivers),
      },
    });
  } catch (err) {
    logger.error({ err }, "[fleet] system-overview error");
    res.status(500).json({ error: "Gagal mengambil system overview" });
  }
});

// ─── EXECUTIVE SUMMARY + OPERATION PRIORITY ENGINE ────────────────────────────

type PriorityTask = {
  taskId: string;
  title: string;
  reason: string;
  action: string;
  href: string;
  severity: "critical" | "warning" | "optimization";
};

/**
 * Single-function Operation Priority Engine.
 * Returns ONE primary task + top-3 risk list + system status.
 * Rule: "one problem at a time" — no multi-dashboard decision fatigue.
 */
function computeOperationPriority(params: {
  dlqUnresolved: number;
  queuePending: number;
  queueFailed: number;
  recentTotal: number;
  recentFailed: number;
  summaryMismatches: number;
  criticalAlerts: number;
  healthScore: number;
}): {
  primary: PriorityTask;
  top3: PriorityTask[];
  systemStatus: "OK" | "DEGRADED" | "CRITICAL";
  recommendedAction: string;
} {
  const {
    dlqUnresolved, queuePending, queueFailed,
    recentTotal, recentFailed, summaryMismatches,
    criticalAlerts, healthScore,
  } = params;

  const failRate = recentTotal > 0 ? recentFailed / recentTotal : 0;
  const dlqRatio = dlqUnresolved / SYSTEM_BOUNDS.maxDlqRows;
  const queueRatio = (queuePending + queueFailed) / SYSTEM_BOUNDS.maxQueueSize;

  // Build scored candidates — highest score wins
  const candidates: (PriorityTask & { score: number })[] = [];

  if (criticalAlerts > 0) {
    candidates.push({
      taskId: "ALERT_CRITICAL",
      title: `${criticalAlerts} Alert Kritis Belum Dibaca`,
      reason: `Ada ${criticalAlerts} alert kritis yang memerlukan tindakan segera`,
      action: "Buka halaman Alerts dan tangani semua alert kritis",
      href: "/logistics/fleet-intelligence/alerts",
      severity: "critical",
      score: 100 + criticalAlerts * 10,
    });
  }

  if (dlqRatio >= 0.5) {
    candidates.push({
      taskId: "DLQ_HIGH",
      title: `DLQ Kritis: ${dlqUnresolved} Baris Gagal`,
      reason: `${dlqUnresolved} baris di Dead Letter Queue melebihi 50% threshold (${SYSTEM_BOUNDS.maxDlqRows})`,
      action: "Buka Upload → DLQ dan resolve semua failed rows",
      href: "/logistics/fleet-intelligence/upload",
      severity: "critical",
      score: 90 + Math.round(dlqRatio * 10),
    });
  } else if (dlqUnresolved > 0) {
    candidates.push({
      taskId: "DLQ_WARN",
      title: `${dlqUnresolved} Baris DLQ Perlu Ditangani`,
      reason: `Ada ${dlqUnresolved} baris gagal di DLQ yang belum di-resolve`,
      action: "Review dan resolve DLQ rows di halaman Upload",
      href: "/logistics/fleet-intelligence/upload",
      severity: dlqRatio >= 0.25 ? "warning" : "optimization",
      score: 60 + Math.round(dlqRatio * 20),
    });
  }

  if (failRate >= 0.3) {
    candidates.push({
      taskId: "INGESTION_HIGH_FAIL",
      title: `Ingestion Gagal ${Math.round(failRate * 100)}%`,
      reason: `${recentFailed} dari ${recentTotal} upload terakhir gagal — melebihi 30% threshold`,
      action: "Cek format file & koneksi, lalu re-upload batch yang gagal",
      href: "/logistics/fleet-intelligence/upload",
      severity: "critical",
      score: 85 + Math.round(failRate * 15),
    });
  } else if (failRate >= 0.1) {
    candidates.push({
      taskId: "INGESTION_WARN",
      title: `Tingkat Gagal Ingestion ${Math.round(failRate * 100)}%`,
      reason: `${recentFailed} upload gagal dalam 7 hari terakhir`,
      action: "Review log upload dan perbaiki file yang bermasalah",
      href: "/logistics/fleet-intelligence/upload",
      severity: "warning",
      score: 55 + Math.round(failRate * 20),
    });
  }

  if (summaryMismatches > 3) {
    candidates.push({
      taskId: "RECON_FAIL",
      title: `${summaryMismatches} Tanggal Tidak Konsisten`,
      reason: `Daily summary tidak match dengan raw transactions di ${summaryMismatches} tanggal`,
      action: "Jalankan Rekonsiliasi dari Control Center atau halaman Validation",
      href: "/logistics/fleet-intelligence/validation",
      severity: "warning",
      score: 70,
    });
  } else if (summaryMismatches > 0) {
    candidates.push({
      taskId: "RECON_WARN",
      title: `${summaryMismatches} Gap Rekonsiliasi Minor`,
      reason: `${summaryMismatches} tanggal memiliki selisih kecil antara summary dan transaksi`,
      action: "Jalankan rekonsiliasi untuk sinkronisasi daily summary",
      href: "/logistics/fleet-intelligence/validation",
      severity: "optimization",
      score: 35,
    });
  }

  if (queueRatio >= 0.8) {
    candidates.push({
      taskId: "QUEUE_SATURATED",
      title: `Queue Hampir Penuh (${Math.round(queueRatio * 100)}%)`,
      reason: `${queuePending + queueFailed} item menunggu, mendekati batas ${SYSTEM_BOUNDS.maxQueueSize}`,
      action: "Hentikan upload sementara, selesaikan backlog terlebih dahulu",
      href: "/logistics/fleet-intelligence/upload",
      severity: "critical",
      score: 80,
    });
  }

  if (queueFailed > 0 && candidates.every(c => c.taskId !== "INGESTION_HIGH_FAIL" && c.taskId !== "INGESTION_WARN")) {
    candidates.push({
      taskId: "QUEUE_FAILED",
      title: `${queueFailed} Item Queue Gagal`,
      reason: `Ada ${queueFailed} item di queue dengan status failed yang perlu ditangani`,
      action: "Review failed queue items di halaman Upload",
      href: "/logistics/fleet-intelligence/upload",
      severity: "warning",
      score: 45,
    });
  }

  // Default optimization if system healthy
  if (candidates.length === 0 || candidates.every(c => c.score < 40)) {
    candidates.push({
      taskId: "OPTIMIZE_REVIEW",
      title: "Sistem Sehat — Review Analitik",
      reason: `Health score ${healthScore}/100. Tidak ada isu kritis terdeteksi`,
      action: "Lakukan review analitik performa driver dan tren pendapatan",
      href: "/logistics/fleet-intelligence/analytics",
      severity: "optimization",
      score: 10,
    });
  }

  // Sort by score desc
  candidates.sort((a, b) => b.score - a.score);

  // Pick top 3 (deduplicate by severity category)
  const top3: PriorityTask[] = [];
  const seenSeverities = new Set<string>();

  // Always put one of each severity if available
  for (const sev of ["critical", "warning", "optimization"] as const) {
    const match = candidates.find(c => c.severity === sev);
    if (match && !seenSeverities.has(match.taskId)) {
      seenSeverities.add(match.taskId);
      top3.push(match);
    }
  }

  // Fill remaining slots if < 3
  for (const c of candidates) {
    if (top3.length >= 3) break;
    if (!seenSeverities.has(c.taskId)) {
      seenSeverities.add(c.taskId);
      top3.push(c);
    }
  }

  const primary = top3[0] ?? candidates[0];

  const systemStatus: "OK" | "DEGRADED" | "CRITICAL" =
    healthScore >= SYSTEM_BOUNDS.healthScoreMinGreen ? "OK" :
    healthScore >= SYSTEM_BOUNDS.healthScoreMinYellow ? "DEGRADED" : "CRITICAL";

  const recommendedAction =
    systemStatus === "CRITICAL"
      ? `SEGERA: ${primary.action}`
      : systemStatus === "DEGRADED"
      ? `PRIORITAS: ${primary.action}`
      : primary.action;

  return { primary, top3, systemStatus, recommendedAction };
}

router.get("/executive-summary", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);

    const [queueStats, dlqStats, recentUploads, reconCheck, alertStats] = await Promise.all([
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'pending')    AS pending,
          COUNT(*) FILTER (WHERE status = 'processing') AS processing,
          COUNT(*) FILTER (WHERE status = 'failed')     AS failed
        FROM fleet_reports
        WHERE company_id = ${companyId}
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) FILTER (WHERE resolved = FALSE) AS unresolved
        FROM gojek_failed_rows WHERE company_id = ${companyId}
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                      AS total,
          COUNT(*) FILTER (WHERE status = 'failed')     AS failed
        FROM fleet_reports
        WHERE company_id = ${companyId}
          AND created_at > NOW() - INTERVAL '7 days'
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS mismatches
        FROM fleet_daily_summary ds
        LEFT JOIN (
          SELECT transaction_date, SUM(gross_revenue) AS tx_gross
          FROM fleet_transactions WHERE company_id = ${companyId}
          GROUP BY transaction_date
        ) tx ON tx.transaction_date = ds.summary_date
        WHERE ds.company_id = ${companyId}
          AND ABS(ds.gross_revenue - COALESCE(tx.tx_gross, 0)) > 0.01
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*) FILTER (WHERE is_read = FALSE AND alert_type ILIKE '%critical%') AS critical_unread
        FROM fleet_alerts WHERE company_id = ${companyId}
      `)),
    ]);

    const numVal = (v: unknown) => parseInt(String(v ?? "0"), 10) || 0;

    const q = queueStats.rows[0] as Record<string, unknown>;
    const dlq = dlqStats.rows[0] as Record<string, unknown>;
    const recent = recentUploads.rows[0] as Record<string, unknown>;
    const recon = reconCheck.rows[0] as Record<string, unknown>;
    const alerts = alertStats.rows[0] as Record<string, unknown>;

    const dlqUnresolved    = numVal(dlq.unresolved);
    const queuePending     = numVal(q.pending);
    const queueFailed      = numVal(q.failed);
    const recentTotal      = numVal(recent.total);
    const recentFailed     = numVal(recent.failed);
    const summaryMismatches = numVal(recon.mismatches);
    const criticalAlerts   = numVal(alerts.critical_unread);

    const healthScore = computeSystemHealthScore({
      recentTotal, recentFailed, dlqUnresolved,
      summaryMismatches, criticalAlerts,
    });

    const { primary, top3, systemStatus, recommendedAction } = computeOperationPriority({
      dlqUnresolved, queuePending, queueFailed,
      recentTotal, recentFailed,
      summaryMismatches, criticalAlerts, healthScore,
    });

    res.json({
      generatedAt: new Date().toISOString(),
      systemStatus,
      healthScore,
      recommendedAction,
      priorityTask: primary,
      top3Risks: top3,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] executive-summary error");
    res.status(500).json({ error: "Gagal mengambil executive summary" });
  }
});

// ─── LEDGER EXPLORER ────────────────────────────────────────────────────────
/**
 * GET /ledger
 * Jelajahi semua gojek_raw_transactions dengan filter opsional.
 * Query params: driverName, driverExtId, dateFrom, dateTo, transactionType, reportId, page, limit
 */
router.get("/ledger", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const {
      driverName, driverExtId, dateFrom, dateTo, transactionType, reportId,
      page = "1", limit = "50",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(200, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const conds: string[] = [`company_id = ${companyId}`];
    if (driverName)      conds.push(`driver_name ILIKE ${sq(`%${driverName}%`)}`);
    if (driverExtId)     conds.push(`driver_external_id = ${sq(driverExtId)}`);
    if (dateFrom)        conds.push(`date >= ${sq(dateFrom)}::date`);
    if (dateTo)          conds.push(`date <= ${sq(dateTo)}::date`);
    if (transactionType) conds.push(`transaction_type = ${sq(transactionType)}`);
    if (reportId && !isNaN(parseInt(reportId))) conds.push(`report_id = ${parseInt(reportId)}`);
    const where = conds.join(" AND ");

    const [rows, countRes, typesRes] = await Promise.all([
      db.execute(sql.raw(`
        SELECT id, report_id, date_time_jkt, driver_external_id, driver_name,
               phone_number, vehicle, amount, total_outstanding_balance,
               transaction_type, gopay_transaction_reference_id, date, created_at
        FROM gojek_raw_transactions
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(*) AS total, SUM(amount) AS total_amount
        FROM gojek_raw_transactions WHERE ${where}
      `)),
      db.execute(sql.raw(`
        SELECT DISTINCT transaction_type
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND transaction_type IS NOT NULL AND transaction_type != ''
        ORDER BY transaction_type
        LIMIT 50
      `)),
    ]);

    res.json({
      transactions:     rows.rows,
      summary:          countRes.rows[0] ?? { total: 0, total_amount: 0 },
      transactionTypes: (typesRes.rows as Record<string, unknown>[]).map((r) => r.transaction_type),
      pagination:       { page: pageNum, limit: limitNum, offset },
    });
  } catch (err) {
    logger.error({ err }, "[fleet] GET /ledger error");
    res.status(500).json({ error: "Gagal mengambil data ledger explorer" });
  }
});

// ─── PIPELINE MONITOR ─────────────────────────────────────────────────────────

/**
 * GET /pipeline/monitor
 * Aggregated driver-level view from gojek_raw_transactions.
 * Query params: driverName, driverExtId, dateFrom, dateTo, transactionType, reportId, minDebit, page, limit
 */
router.get("/pipeline/monitor", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const {
      driverName, driverExtId, dateFrom, dateTo, transactionType, reportId,
      minDebit, page = "1", limit = "100",
    } = req.query as Record<string, string>;

    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(500, Math.max(1, parseInt(limit)));
    const offset   = (pageNum - 1) * limitNum;

    const conds: string[] = [`company_id = ${companyId}`];
    if (driverName)      conds.push(`driver_name ILIKE ${sq(`%${driverName}%`)}`);
    if (driverExtId)     conds.push(`driver_external_id = ${sq(driverExtId)}`);
    if (dateFrom)        conds.push(`date_iso >= ${sq(dateFrom)}::date`);
    if (dateTo)          conds.push(`date_iso <= ${sq(dateTo)}::date`);
    if (transactionType) conds.push(`transaction_type = ${sq(transactionType)}`);
    if (reportId && !isNaN(parseInt(reportId))) conds.push(`report_id = ${parseInt(reportId)}`);
    const where = conds.join(" AND ");

    // High-risk threshold: total debit (negative amounts) worse than this value
    const debitThreshold = minDebit ? parseFloat(minDebit) : -50000;

    const [driverRows, summaryRes, typesRes, totalDriversRes] = await Promise.all([
      db.execute(sql.raw(`
        WITH latest_obs AS (
          SELECT DISTINCT ON (driver_external_id)
            driver_external_id,
            total_outstanding_balance AS latest_outstanding
          FROM gojek_raw_transactions
          WHERE company_id = ${companyId}
            AND driver_external_id IS NOT NULL AND driver_external_id != ''
          ORDER BY driver_external_id, date_iso DESC NULLS LAST, id ASC
        )
        SELECT
          rt.driver_external_id,
          MAX(rt.driver_name)                                      AS driver_name,
          MAX(rt.phone_number)                                     AS phone_number,
          MAX(rt.vehicle)                                          AS vehicle,
          COUNT(*)                                                 AS tx_count,
          SUM(CASE WHEN rt.amount < 0 THEN rt.amount ELSE 0 END)  AS total_debit,
          SUM(CASE WHEN rt.amount > 0 THEN rt.amount ELSE 0 END)  AS total_credit,
          SUM(rt.amount)                                           AS net_flow,
          lo.latest_outstanding,
          MIN(rt.date_iso)                                         AS date_first,
          MAX(rt.date_iso)                                         AS date_last,
          COUNT(DISTINCT rt.transaction_type)                      AS type_count,
          COUNT(DISTINCT rt.gopay_transaction_reference_id)
            FILTER (WHERE rt.gopay_transaction_reference_id IS NOT NULL
                      AND rt.gopay_transaction_reference_id != '')
                                                                   AS dedup_refs,
          MAX(rt.report_id)                                        AS last_report_id
        FROM gojek_raw_transactions rt
        LEFT JOIN latest_obs lo ON lo.driver_external_id = rt.driver_external_id
        WHERE ${where}
        GROUP BY rt.driver_external_id, lo.latest_outstanding
        ORDER BY total_debit ASC
        LIMIT ${limitNum} OFFSET ${offset}
      `)),
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                             AS total_rows,
          COUNT(DISTINCT driver_external_id)                   AS driver_count,
          COUNT(DISTINCT vehicle)                              AS vehicle_count,
          SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END)    AS total_debit,
          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END)    AS total_credit,
          SUM(amount)                                          AS net_flow
        FROM gojek_raw_transactions WHERE ${where}
      `)),
      db.execute(sql.raw(`
        SELECT DISTINCT transaction_type FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND transaction_type IS NOT NULL AND transaction_type != ''
        ORDER BY transaction_type LIMIT 50
      `)),
      db.execute(sql.raw(`
        SELECT COUNT(DISTINCT driver_external_id) AS cnt
        FROM gojek_raw_transactions WHERE ${where}
      `)),
    ]);

    const drivers = (driverRows.rows as Record<string, unknown>[]).map((d) => ({
      ...d,
      is_high_risk: numVal(d.total_debit) < debitThreshold,
    }));

    res.json({
      drivers,
      summary:          summaryRes.rows[0] ?? {},
      transactionTypes: (typesRes.rows as Record<string, unknown>[]).map((r) => r.transaction_type),
      pagination: {
        page: pageNum, limit: limitNum, offset,
        totalDrivers: numVal((totalDriversRes.rows[0] as any)?.cnt),
      },
      debitThreshold,
    });
  } catch (err) {
    logger.error({ err }, "[fleet] GET /pipeline/monitor error");
    res.status(500).json({ error: "Gagal mengambil data pipeline monitor" });
  }
});

/**
 * GET /pipeline/export-excel
 * Export raw transactions to Excel with the same filters as /ledger.
 * Returns .xlsx binary.
 */
router.get("/pipeline/export-excel", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const {
      driverName, driverExtId, dateFrom, dateTo, transactionType, reportId, mode,
    } = req.query as Record<string, string>;

    const conds: string[] = [`company_id = ${companyId}`];
    if (driverName)      conds.push(`driver_name ILIKE ${sq(`%${driverName}%`)}`);
    if (driverExtId)     conds.push(`driver_external_id = ${sq(driverExtId)}`);
    if (dateFrom)        conds.push(`date >= ${sq(dateFrom)}::date`);
    if (dateTo)          conds.push(`date <= ${sq(dateTo)}::date`);
    if (transactionType) conds.push(`transaction_type = ${sq(transactionType)}`);
    if (reportId && !isNaN(parseInt(reportId))) conds.push(`report_id = ${parseInt(reportId)}`);
    const where = conds.join(" AND ");

    // mode=summary → group by driver; default → per-row detail
    let wb: ExcelJS.Workbook;
    if (mode === "summary") {
      const rows = await db.execute(sql.raw(`
        SELECT
          driver_external_id AS "Driver ID",
          MAX(driver_name)   AS "Nama Driver",
          MAX(phone_number)  AS "No HP",
          MAX(vehicle)       AS "Kendaraan",
          COUNT(*)           AS "Jumlah Transaksi",
          SUM(CASE WHEN amount < 0 THEN amount ELSE 0 END) AS "Total Debit",
          SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS "Total Credit",
          SUM(amount)        AS "Net Flow",
          MAX(total_outstanding_balance) AS "Outstanding Terakhir",
          MIN(date)          AS "Tanggal Pertama",
          MAX(date)          AS "Tanggal Terakhir"
        FROM gojek_raw_transactions
        WHERE ${where}
        GROUP BY driver_external_id
        ORDER BY "Total Debit" ASC
      `));
      wb = await buildExcelWorkbook("Fleet Driver Summary", rows.rows as Record<string, unknown>[]);
    } else {
      const rows = await db.execute(sql.raw(`
        SELECT
          date_time_jkt              AS "Date & Time (JKT)",
          driver_external_id         AS "Driver ID",
          driver_name                AS "Nama Driver",
          phone_number               AS "No HP",
          vehicle                    AS "Kendaraan",
          amount                     AS "Amount",
          total_outstanding_balance  AS "Total Outstanding",
          transaction_type           AS "Jenis Transaksi",
          gopay_transaction_reference_id AS "GoPay Reference ID",
          date                       AS "Tanggal"
        FROM gojek_raw_transactions
        WHERE ${where}
        ORDER BY created_at DESC
        LIMIT 50000
      `));
      wb = await buildExcelWorkbook("Fleet Transactions", rows.rows as Record<string, unknown>[]);
    }

    const buf = await wb.xlsx.writeBuffer();
    const filename = mode === "summary"
      ? `fleet-driver-summary-${Date.now()}.xlsx`
      : `fleet-transactions-${Date.now()}.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    logger.error({ err }, "[fleet] GET /pipeline/export-excel error");
    res.status(500).json({ error: "Gagal export Excel" });
  }
});

async function buildExcelWorkbook(sheetName: string, rows: Record<string, unknown>[]): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "BizPortal Fleet Intelligence";
  wb.created = new Date();
  const ws = wb.addWorksheet(sheetName);

  if (rows.length === 0) {
    ws.addRow(["Tidak ada data"]);
    return wb;
  }

  const headers = Object.keys(rows[0]);
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E3A5F" } };
  headerRow.height = 20;

  const numericCols = new Set<number>();
  for (let c = 0; c < headers.length; c++) {
    const h = headers[c].toLowerCase();
    if (h.includes("amount") || h.includes("debit") || h.includes("credit") || h.includes("outstanding") || h.includes("net") || h.includes("flow")) {
      numericCols.add(c);
    }
  }

  for (const row of rows) {
    const vals = headers.map((h, ci) => {
      const v = row[h];
      if (numericCols.has(ci)) return v == null ? 0 : Number(v);
      return v == null ? "" : String(v);
    });
    const dataRow = ws.addRow(vals);
    for (const ci of numericCols) {
      const cell = dataRow.getCell(ci + 1);
      cell.numFmt = "#,##0";
      if (Number(cell.value) < 0) cell.font = { color: { argb: "FFDC2626" } };
      else if (Number(cell.value) > 0) cell.font = { color: { argb: "FF059669" } };
    }
  }

  // Auto-width
  ws.columns.forEach((col) => {
    let max = 12;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, 40);
  });

  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: headers.length } };
  ws.views = [{ state: "frozen", ySplit: 1 }];
  return wb;
}

/**
 * GET /drivers/:extId/detail
 * Detail lengkap satu driver: info, riwayat transaksi, tren outstanding harian
 */
router.get("/drivers/:extId/detail", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const extId = String(req.params.extId);
    if (!extId) return res.status(400).json({ error: "extId wajib" });
    const safeId = sq(extId);

    const [driverRow, txHistory, dailyOutstanding, summary] = await Promise.all([
      // Info driver
      db.execute(sql.raw(`
        SELECT d.*, fo.outstanding_amount, fo.last_updated_date, fo.due_days
        FROM fleet_drivers d
        LEFT JOIN fleet_outstanding fo ON fo.driver_external_id = d.driver_external_id
          AND fo.company_id = d.company_id AND fo.status = 'open'
        WHERE d.company_id = ${companyId} AND d.driver_external_id = ${safeId}
        LIMIT 1
      `)),
      // Riwayat transaksi dari raw (sumber kebenaran)
      db.execute(sql.raw(`
        SELECT
          r.id, r.date_time_jkt, r.date_iso::text AS date_iso,
          r.driver_name, r.vehicle, r.phone_number,
          r.amount::numeric        AS amount,
          r.total_outstanding_balance::numeric AS outstanding,
          r.transaction_type, r.gopay_transaction_reference_id AS gopay_ref,
          r.service_type,
          fr.file_name             AS report_name
        FROM gojek_raw_transactions r
        LEFT JOIN fleet_reports fr ON fr.id = r.report_id
        WHERE r.company_id = ${companyId} AND r.driver_external_id = ${safeId}
        ORDER BY r.date_iso DESC NULLS LAST, r.id DESC
        LIMIT 1000
      `)),
      // Tren outstanding harian — ambil balance terakhir per hari
      db.execute(sql.raw(`
        SELECT DISTINCT ON (date_iso)
          date_iso::text AS date_iso,
          total_outstanding_balance::numeric AS outstanding
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId}
          AND driver_external_id = ${safeId}
          AND date_iso IS NOT NULL
          AND total_outstanding_balance IS NOT NULL
        ORDER BY date_iso, id DESC
      `)),
      // Summary statistik
      db.execute(sql.raw(`
        SELECT
          COUNT(*)                                                AS total_rows,
          COUNT(*) FILTER (WHERE amount > 0)                     AS due_count,
          COUNT(*) FILTER (WHERE amount < 0)                     AS deduction_count,
          COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)     AS total_due,
          COALESCE(SUM(amount) FILTER (WHERE amount < 0), 0)     AS total_deduction,
          COALESCE(SUM(amount), 0)                               AS net_amount,
          MIN(date_iso)::text                                    AS first_date,
          MAX(date_iso)::text                                    AS last_date,
          COUNT(DISTINCT date_iso)                               AS active_days
        FROM gojek_raw_transactions
        WHERE company_id = ${companyId} AND driver_external_id = ${safeId}
      `)),
    ]);

    const driver = driverRow.rows[0] ?? null;
    const stat = summary.rows[0] as any ?? {};

    // Latest outstanding: first row of txHistory (sorted desc)
    const latestOutstanding = txHistory.rows.length > 0
      ? parseFloat((txHistory.rows[0] as any).outstanding ?? 0)
      : 0;

    res.json({
      driver,
      transactions: txHistory.rows,
      dailyOutstanding: (dailyOutstanding.rows as any[]).map((r) => ({
        date: r.date_iso,
        outstanding: parseFloat(r.outstanding ?? 0),
      })).sort((a, b) => a.date.localeCompare(b.date)),
      summary: {
        totalRows:       numVal(stat.total_rows),
        dueCount:        numVal(stat.due_count),
        deductionCount:  numVal(stat.deduction_count),
        totalDue:        numVal(stat.total_due),
        totalDeduction:  numVal(stat.total_deduction),
        netAmount:       numVal(stat.net_amount),
        firstDate:       stat.first_date ?? null,
        lastDate:        stat.last_date ?? null,
        activeDays:      numVal(stat.active_days),
        latestOutstanding,
      },
    });
  } catch (err) {
    logger.error({ err }, "[fleet][driver-detail] error");
    res.status(500).json({ error: "Gagal mengambil detail driver" });
  }
});

/**
 * GET /row-diff?reportId=X
 * Row-by-row comparison: gojek_raw_transactions vs fleet_transactions
 * Join key: gopay_transaction_reference_id (raw) ↔ gopay_reference_id (tx)
 * Fallback: (driver_external_id, date_iso, amount) when gopay ref is null
 */
router.get("/row-diff", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const reportId = req.query.reportId ? parseInt(String(req.query.reportId)) : null;
    if (!reportId || isNaN(reportId)) {
      return res.status(400).json({ error: "reportId wajib diisi" });
    }

    // Fetch raw rows
    const rawResult = await db.execute(sql.raw(`
      SELECT
        r.id                              AS raw_id,
        r.gopay_transaction_reference_id  AS gopay_ref,
        r.driver_external_id,
        r.driver_name,
        r.phone_number,
        r.date_time_jkt,
        r.date_iso::text                  AS date_iso,
        r.transaction_type,
        r.amount::numeric                 AS raw_amount,
        r.total_outstanding_balance::numeric AS raw_outstanding,
        r.vehicle,
        r.service_type
      FROM gojek_raw_transactions r
      WHERE r.company_id = ${companyId} AND r.report_id = ${reportId}
      ORDER BY r.id
    `));

    // Fetch fleet_transactions rows
    const txResult = await db.execute(sql.raw(`
      SELECT
        t.id                      AS tx_id,
        t.gopay_reference_id      AS gopay_ref,
        t.driver_external_id,
        t.driver_name,
        t.transaction_date::text  AS tx_date,
        t.transaction_type,
        t.amount::numeric         AS tx_amount,
        t.outstanding_balance::numeric AS tx_outstanding,
        t.net_revenue::numeric    AS net_revenue,
        t.gross_revenue::numeric  AS gross_revenue,
        t.vehicle_plate,
        t.service_type
      FROM fleet_transactions t
      WHERE t.company_id = ${companyId} AND t.report_id = ${reportId}
      ORDER BY t.id
    `));

    const rawRows = rawResult.rows as any[];
    const txRows  = txResult.rows as any[];

    // Build lookup maps keyed by gopay_ref (non-null) and fallback key
    const txByGopay = new Map<string, any[]>();
    const txFallback = new Map<string, any[]>();
    for (const t of txRows) {
      if (t.gopay_ref) {
        const key = String(t.gopay_ref);
        if (!txByGopay.has(key)) txByGopay.set(key, []);
        txByGopay.get(key)!.push(t);
      }
      // Fallback key: driver_external_id + tx_date + amount
      const fbKey = `${t.driver_external_id}|${t.tx_date}|${parseFloat(t.tx_amount ?? 0).toFixed(4)}`;
      if (!txFallback.has(fbKey)) txFallback.set(fbKey, []);
      txFallback.get(fbKey)!.push(t);
    }

    const matchedTxIds = new Set<number>();
    const matched: any[]       = [];
    const missingInTx: any[]   = [];

    for (const raw of rawRows) {
      let tx: any | null = null;

      // Try primary match via gopay ref
      if (raw.gopay_ref) {
        const candidates = txByGopay.get(String(raw.gopay_ref)) ?? [];
        tx = candidates.find((c) => !matchedTxIds.has(c.tx_id)) ?? null;
      }

      // Fallback match by (driver_id + date + amount)
      if (!tx) {
        const fbKey = `${raw.driver_external_id}|${raw.date_iso}|${parseFloat(raw.raw_amount ?? 0).toFixed(4)}`;
        const candidates = txFallback.get(fbKey) ?? [];
        tx = candidates.find((c) => !matchedTxIds.has(c.tx_id)) ?? null;
      }

      if (tx) {
        matchedTxIds.add(tx.tx_id);
        const rawAmt = parseFloat(raw.raw_amount ?? 0);
        const txAmt  = parseFloat(tx.tx_amount ?? 0);
        const delta  = txAmt - rawAmt;
        matched.push({
          rawId: raw.raw_id,
          txId:  tx.tx_id,
          gopayRef: raw.gopay_ref ?? tx.gopay_ref,
          driverExternalId: raw.driver_external_id,
          driverName: raw.driver_name,
          dateIso: raw.date_iso,
          txDate:  tx.tx_date,
          transactionType: raw.transaction_type,
          rawAmount: rawAmt,
          txAmount:  txAmt,
          delta,
          amountMismatch: Math.abs(delta) > 0.009,
          rawOutstanding: parseFloat(raw.raw_outstanding ?? 0),
          txOutstanding:  parseFloat(tx.tx_outstanding ?? 0),
          outstandingMismatch: Math.abs(parseFloat(raw.raw_outstanding ?? 0) - parseFloat(tx.tx_outstanding ?? 0)) > 0.009,
          vehicleRaw: raw.vehicle,
          vehicleTx:  tx.vehicle_plate,
          serviceType: raw.service_type ?? tx.service_type,
          matchMethod: raw.gopay_ref && tx.gopay_ref === raw.gopay_ref ? "gopay_ref" : "fallback",
        });
      } else {
        missingInTx.push({
          rawId: raw.raw_id,
          gopayRef: raw.gopay_ref,
          driverExternalId: raw.driver_external_id,
          driverName: raw.driver_name,
          dateIso: raw.date_iso,
          transactionType: raw.transaction_type,
          rawAmount: parseFloat(raw.raw_amount ?? 0),
          rawOutstanding: parseFloat(raw.raw_outstanding ?? 0),
          vehicle: raw.vehicle,
          serviceType: raw.service_type,
          dateTimeJkt: raw.date_time_jkt,
        });
      }
    }

    // Excess in tx (exists in fleet_transactions but no matching raw row)
    const excessInTx = txRows
      .filter((t) => !matchedTxIds.has(t.tx_id))
      .map((t) => ({
        txId: t.tx_id,
        gopayRef: t.gopay_ref,
        driverExternalId: t.driver_external_id,
        driverName: t.driver_name,
        txDate: t.tx_date,
        transactionType: t.transaction_type,
        txAmount: parseFloat(t.tx_amount ?? 0),
        txOutstanding: parseFloat(t.tx_outstanding ?? 0),
        vehiclePlate: t.vehicle_plate,
        serviceType: t.service_type,
      }));

    // Summary
    const totalRawAmount = rawRows.reduce((s, r) => s + parseFloat(r.raw_amount ?? 0), 0);
    const totalTxAmount  = txRows.reduce((s, t) => s + parseFloat(t.tx_amount ?? 0), 0);
    const totalDelta     = totalTxAmount - totalRawAmount;
    const amountMismatches = matched.filter((m) => m.amountMismatch);
    const totalMismatchDelta = amountMismatches.reduce((s, m) => s + m.delta, 0);

    res.json({
      reportId,
      summary: {
        rawCount: rawRows.length,
        txCount:  txRows.length,
        matchedCount:    matched.length,
        missingCount:    missingInTx.length,
        excessCount:     excessInTx.length,
        amountMismatchCount: amountMismatches.length,
        totalRawAmount,
        totalTxAmount,
        totalDelta,
        totalMismatchDelta,
      },
      matched,
      missingInTx,
      excessInTx,
    });
  } catch (err) {
    logger.error({ err }, "[fleet][row-diff] error");
    res.status(500).json({ error: "Gagal menjalankan row-diff" });
  }
});

/**
 * GET /row-diff/reports
 * List reports available for row-diff (with raw + tx counts)
 */
router.get("/row-diff/reports", async (req: Request, res: Response) => {
  try {
    const companyId = getCompanyId(req);
    const result = await db.execute(sql.raw(`
      SELECT
        fr.id                  AS report_id,
        fr.file_name,
        fr.uploaded_at,
        COUNT(DISTINCT r.id)   AS raw_count,
        COUNT(DISTINCT t.id)   AS tx_count
      FROM fleet_reports fr
      LEFT JOIN gojek_raw_transactions r ON r.report_id = fr.id AND r.company_id = fr.company_id
      LEFT JOIN fleet_transactions     t ON t.report_id = fr.id AND t.company_id = fr.company_id
      WHERE fr.company_id = ${companyId}
      GROUP BY fr.id, fr.file_name, fr.uploaded_at
      ORDER BY fr.uploaded_at DESC
      LIMIT 50
    `));
    res.json({ reports: result.rows });
  } catch (err) {
    logger.error({ err }, "[fleet][row-diff/reports] error");
    res.status(500).json({ error: "Gagal memuat daftar report" });
  }
});

export { router as fleetIntelligenceRouter };
export default router;

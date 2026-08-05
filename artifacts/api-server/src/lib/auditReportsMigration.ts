import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runAuditReportsMigration() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS erp_audit_reports (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      report_number TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      auditor_name TEXT,
      period_start DATE,
      period_end DATE,
      status TEXT NOT NULL DEFAULT 'draft',
      ok_count INTEGER NOT NULL DEFAULT 0,
      not_ok_count INTEGER NOT NULL DEFAULT 0,
      warning_count INTEGER NOT NULL DEFAULT 0,
      na_count INTEGER NOT NULL DEFAULT 0,
      total_answered INTEGER NOT NULL DEFAULT 0,
      conclusion TEXT,
      overall_notes TEXT,
      created_by_id TEXT,
      created_at TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS erp_audit_responses (
      id SERIAL PRIMARY KEY,
      report_id INTEGER NOT NULL REFERENCES erp_audit_reports(id) ON DELETE CASCADE,
      item_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'na',
      notes TEXT,
      updated_at TIMESTAMP DEFAULT NOW() NOT NULL,
      UNIQUE(report_id, item_id)
    );
  `);

  logger.info("Audit reports migration: ok (erp_audit_reports + erp_audit_responses)");
}

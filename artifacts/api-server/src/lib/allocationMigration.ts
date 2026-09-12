import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runAllocationMigration(): Promise<void> {
  try {
    // ── allocation_headers ────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS allocation_headers (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER NOT NULL,
        allocation_no       TEXT NOT NULL,
        bank_transaction_id INTEGER,
        bank_account_id     INTEGER,
        currency            TEXT NOT NULL DEFAULT 'IDR',
        exchange_rate       NUMERIC(14,6) NOT NULL DEFAULT 1,
        received_amount     NUMERIC(14,2) NOT NULL DEFAULT 0,
        allocated_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
        remaining_amount    NUMERIC(14,2) NOT NULL DEFAULT 0,
        status              TEXT NOT NULL DEFAULT 'draft',
        reference_no        TEXT,
        customer_id         INTEGER,
        vendor_id           INTEGER,
        project_id          TEXT,
        notes               TEXT,
        allocation_date     DATE NOT NULL DEFAULT CURRENT_DATE,
        created_by          TEXT,
        approved_by         TEXT,
        posted_by           TEXT,
        journal_entry_id    INTEGER,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_alloc_headers_no ON allocation_headers(allocation_no)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_headers_company ON allocation_headers(company_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_headers_status ON allocation_headers(status)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_headers_date ON allocation_headers(allocation_date)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_headers_bank ON allocation_headers(bank_account_id)`).catch(() => {});

    // ── allocation_lines ──────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS allocation_lines (
        id                    SERIAL PRIMARY KEY,
        allocation_header_id  INTEGER NOT NULL,
        allocation_type       TEXT NOT NULL,
        reference_type        TEXT,
        reference_id          INTEGER,
        coa_id                INTEGER,
        amount                NUMERIC(14,2) NOT NULL DEFAULT 0,
        remarks               TEXT,
        sort_order            INTEGER NOT NULL DEFAULT 0,
        allocation_status     TEXT NOT NULL DEFAULT 'pending',
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_lines_header ON allocation_lines(allocation_header_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_lines_type ON allocation_lines(allocation_type)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_lines_ref ON allocation_lines(reference_type, reference_id)`).catch(() => {});

    // ── allocation_audit_logs ─────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS allocation_audit_logs (
        id                    SERIAL PRIMARY KEY,
        allocation_header_id  INTEGER NOT NULL,
        action                TEXT NOT NULL,
        actor                 TEXT,
        actor_id              INTEGER,
        from_status           TEXT,
        to_status             TEXT,
        notes                 TEXT,
        snapshot              JSONB,
        created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).catch(() => {});

    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_audit_header ON allocation_audit_logs(allocation_header_id)`).catch(() => {});
    await db.execute(sql`CREATE INDEX IF NOT EXISTS idx_alloc_audit_action ON allocation_audit_logs(action)`).catch(() => {});

    logger.info("[allocationMigration] Tables allocation_headers, allocation_lines, allocation_audit_logs ready");
  } catch (err) {
    logger.warn({ err }, "[allocationMigration] Non-fatal migration warning");
  }
}

/**
 * FINANCE CORE MIGRATION
 * SAP-like Finance Core — DB migration idempotent
 *
 * Tables baru:
 *  - gl_journal_bridge        : maps accounting_entries → GL doc type + period
 *  - ar_subledger             : Accounts Receivable per invoice
 *  - ap_subledger             : Accounts Payable per bill
 *  - elimination_runs         : IC elimination run header
 *  - gl_elimination_entries   : IC elimination journal lines
 *  - gl_tax_lines             : per-journal tax lines (PPh23, WHT, PPN)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runFinanceCoreMigration(): Promise<void> {
  try {
    // ── gl_journal_bridge ────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS gl_journal_bridge (
        id                   SERIAL PRIMARY KEY,
        company_id           INTEGER NOT NULL,
        accounting_entry_id  INTEGER NOT NULL REFERENCES accounting_entries(id) ON DELETE CASCADE,
        gl_doc_type          TEXT    NOT NULL DEFAULT 'SA',
        gl_period            TEXT    NOT NULL,
        is_intercompany      BOOLEAN NOT NULL DEFAULT FALSE,
        elimination_run_id   INTEGER,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT gl_journal_bridge_entry_uniq UNIQUE (accounting_entry_id)
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_gl_jb_company_period
        ON gl_journal_bridge(company_id, gl_period)
    `));

    // ── ar_subledger ─────────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ar_subledger (
        id                 SERIAL PRIMARY KEY,
        company_id         INTEGER NOT NULL,
        invoice_id         INTEGER,
        customer_id        INTEGER,
        invoice_number     TEXT,
        invoice_date       DATE,
        due_date           DATE,
        currency           TEXT    NOT NULL DEFAULT 'IDR',
        gross_amount       NUMERIC(18,2) NOT NULL DEFAULT 0,
        outstanding_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
        paid_amount        NUMERIC(18,2) NOT NULL DEFAULT 0,
        status             TEXT    NOT NULL DEFAULT 'OPEN',
        gl_entry_id        INTEGER,
        period             TEXT,
        notes              TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ar_sub_invoice
        ON ar_subledger(company_id, invoice_id) WHERE invoice_id IS NOT NULL
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_ar_sub_status
        ON ar_subledger(company_id, status)
    `));

    // ── ap_subledger ─────────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS ap_subledger (
        id               SERIAL PRIMARY KEY,
        company_id       INTEGER NOT NULL,
        bill_id          INTEGER,
        vendor_id        INTEGER,
        bill_number      TEXT,
        bill_date        DATE,
        due_date         DATE,
        currency         TEXT    NOT NULL DEFAULT 'IDR',
        payable_amount   NUMERIC(18,2) NOT NULL DEFAULT 0,
        paid_amount      NUMERIC(18,2) NOT NULL DEFAULT 0,
        status           TEXT    NOT NULL DEFAULT 'OPEN',
        gl_entry_id      INTEGER,
        period           TEXT,
        notes            TEXT,
        created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_ap_sub_bill
        ON ap_subledger(company_id, bill_id) WHERE bill_id IS NOT NULL
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_ap_sub_status
        ON ap_subledger(company_id, status)
    `));

    // ── elimination_runs ─────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS elimination_runs (
        id                  SERIAL PRIMARY KEY,
        holding_company_id  INTEGER NOT NULL,
        period              TEXT    NOT NULL,
        run_date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status              TEXT    NOT NULL DEFAULT 'DRAFT',
        created_by          TEXT,
        notes               TEXT,
        total_eliminated    NUMERIC(18,2) NOT NULL DEFAULT 0,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_elim_runs_period
        ON elimination_runs(holding_company_id, period)
    `));

    // ── gl_elimination_entries ───────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS gl_elimination_entries (
        id                 SERIAL PRIMARY KEY,
        run_id             INTEGER NOT NULL REFERENCES elimination_runs(id) ON DELETE CASCADE,
        company_from_id    INTEGER NOT NULL,
        company_to_id      INTEGER NOT NULL,
        elimination_type   TEXT    NOT NULL,
        debit_coa_code     TEXT,
        credit_coa_code    TEXT,
        amount             NUMERIC(18,2) NOT NULL,
        description        TEXT,
        original_entry_id  INTEGER,
        is_reversed        BOOLEAN NOT NULL DEFAULT FALSE,
        reversed_at        TIMESTAMPTZ,
        reversed_by        TEXT,
        created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_gl_elim_run
        ON gl_elimination_entries(run_id)
    `));

    // ── gl_tax_lines ─────────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS gl_tax_lines (
        id                   SERIAL PRIMARY KEY,
        company_id           INTEGER NOT NULL,
        accounting_entry_id  INTEGER,
        tax_type             TEXT    NOT NULL,
        rate                 NUMERIC(5,2) NOT NULL DEFAULT 0,
        base_amount          NUMERIC(18,2) NOT NULL DEFAULT 0,
        tax_amount           NUMERIC(18,2) NOT NULL DEFAULT 0,
        direction            TEXT    NOT NULL DEFAULT 'output',
        period               TEXT,
        entity_type          TEXT,
        entity_id            TEXT,
        taxpayer_npwp        TEXT,
        taxpayer_name        TEXT,
        is_reported          BOOLEAN NOT NULL DEFAULT FALSE,
        reported_at          TIMESTAMPTZ,
        created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS idx_gl_tax_lines_period
        ON gl_tax_lines(company_id, period, tax_type)
    `));

    logger.info("[finance-core-migration] Semua tabel Finance Core OK");
  } catch (err: any) {
    logger.error({ err }, "[finance-core-migration] Gagal");
    throw err;
  }
}

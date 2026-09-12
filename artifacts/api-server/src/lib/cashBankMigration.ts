import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runCashBankMigration(): Promise<void> {
  try {
    // ── Extend company_bank_accounts (additive) ─────────────────────────────
    const extendCba = [
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS branch_id INTEGER`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS account_holder TEXT`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS minimum_balance NUMERIC(14,2) DEFAULT 0`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS bank_branch TEXT`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS swift_code TEXT`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS iban TEXT`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS virtual_account_prefix TEXT`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS reconciliation_method TEXT DEFAULT 'MANUAL'`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT FALSE`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS opening_balance NUMERIC(14,2) DEFAULT 0`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS description TEXT`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS category_id INTEGER`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'IDR'`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(14,6) DEFAULT 1`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS base_currency TEXT DEFAULT 'IDR'`,
      `ALTER TABLE company_bank_accounts ADD COLUMN IF NOT EXISTS updated_by TEXT`,
    ];
    for (const q of extendCba) {
      await db.execute(sql.raw(q)).catch(() => {});
    }

    // ── Extend fund_transfers (additive) ────────────────────────────────────
    const extendFt = [
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS approved_by TEXT`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS voided_at TIMESTAMP`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS void_reason TEXT`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS notes TEXT`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
      `ALTER TABLE fund_transfers ADD COLUMN IF NOT EXISTS updated_by TEXT`,
    ];
    for (const q of extendFt) {
      await db.execute(sql.raw(q)).catch(() => {});
    }

    // Fix existing fund_transfers status default to DRAFT
    await db.execute(sql`
      ALTER TABLE fund_transfers ALTER COLUMN status SET DEFAULT 'DRAFT'
    `).catch(() => {});

    // ── cash_bank_categories ─────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cash_bank_categories (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER,
        branch_id   INTEGER,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT DEFAULT '#6B7280',
        is_active   BOOLEAN DEFAULT TRUE,
        sort_order  INTEGER DEFAULT 0,
        created_by  TEXT,
        updated_by  TEXT,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at  TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cbc_company_idx ON cash_bank_categories(company_id)
    `).catch(() => {});

    // Seed default categories jika kosong
    await db.execute(sql`
      INSERT INTO cash_bank_categories (name, description, color, sort_order)
      SELECT name, description, color, sort_order FROM (VALUES
        ('Operational',  'Rekening operasional sehari-hari',   '#3B82F6', 1),
        ('Payroll',      'Rekening gaji karyawan',             '#10B981', 2),
        ('Tax',          'Rekening pembayaran pajak',          '#F59E0B', 3),
        ('Petty Cash',   'Kas kecil operasional',              '#8B5CF6', 4),
        ('Escrow',       'Rekening escrow/titipan',            '#EF4444', 5),
        ('Collection',   'Rekening penerimaan piutang',        '#06B6D4', 6),
        ('Deposit',      'Rekening deposito',                  '#84CC16', 7),
        ('Investment',   'Rekening investasi',                 '#F97316', 8),
        ('Clearing',     'Rekening kliring/transit',           '#6B7280', 9),
        ('Transit',      'Rekening transit antar bank',        '#EC4899', 10)
      ) AS t(name, description, color, sort_order)
      WHERE NOT EXISTS (SELECT 1 FROM cash_bank_categories LIMIT 1)
    `).catch(() => {});

    // ── petty_cash_transactions ──────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS petty_cash_transactions (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER NOT NULL,
        branch_id       INTEGER,
        account_id      INTEGER REFERENCES company_bank_accounts(id) ON DELETE SET NULL,
        transaction_no  TEXT UNIQUE,
        transaction_type TEXT NOT NULL,
        date            DATE NOT NULL,
        amount          NUMERIC(14,2) NOT NULL DEFAULT 0,
        description     TEXT,
        category        TEXT,
        recipient       TEXT,
        receipt_no      TEXT,
        receipt_url     TEXT,
        entry_id        INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL,
        status          TEXT NOT NULL DEFAULT 'DRAFT',
        approved_by     TEXT,
        approved_at     TIMESTAMP,
        settled_by      TEXT,
        settled_at      TIMESTAMP,
        void_reason     TEXT,
        voided_at       TIMESTAMP,
        notes           TEXT,
        created_by      TEXT,
        updated_by      TEXT,
        created_at      TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at      TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pct_company_idx ON petty_cash_transactions(company_id)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pct_date_idx ON petty_cash_transactions(date)
    `).catch(() => {});
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS pct_account_idx ON petty_cash_transactions(account_id)
    `).catch(() => {});

    // ── cash_flow_forecasts ──────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cash_flow_forecasts (
        id            SERIAL PRIMARY KEY,
        company_id    INTEGER NOT NULL,
        branch_id     INTEGER,
        forecast_date DATE NOT NULL,
        horizon_days  INTEGER NOT NULL DEFAULT 30,
        generated_at  TIMESTAMP DEFAULT NOW() NOT NULL,
        opening_balance NUMERIC(14,2) DEFAULT 0,
        expected_inflow NUMERIC(14,2) DEFAULT 0,
        expected_outflow NUMERIC(14,2) DEFAULT 0,
        net_cash_flow   NUMERIC(14,2) DEFAULT 0,
        closing_balance NUMERIC(14,2) DEFAULT 0,
        source_breakdown JSONB,
        daily_detail     JSONB,
        status          TEXT DEFAULT 'draft',
        notes           TEXT,
        created_by      TEXT,
        updated_by      TEXT,
        created_at      TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at      TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cff_company_date_idx ON cash_flow_forecasts(company_id, forecast_date)
    `).catch(() => {});

    // ── cash_bank_balance_history ────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS cash_bank_balance_history (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER NOT NULL,
        branch_id       INTEGER,
        account_id      INTEGER REFERENCES company_bank_accounts(id) ON DELETE CASCADE,
        snapshot_date   DATE NOT NULL,
        opening_balance NUMERIC(14,2) DEFAULT 0,
        closing_balance NUMERIC(14,2) DEFAULT 0,
        total_cash_in   NUMERIC(14,2) DEFAULT 0,
        total_cash_out  NUMERIC(14,2) DEFAULT 0,
        transaction_count INTEGER DEFAULT 0,
        notes           TEXT,
        created_by      TEXT,
        updated_by      TEXT,
        created_at      TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at      TIMESTAMP DEFAULT NOW() NOT NULL,
        UNIQUE (account_id, snapshot_date)
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS cbbh_company_date_idx ON cash_bank_balance_history(company_id, snapshot_date)
    `).catch(() => {});

    logger.info("Cash Bank migration: semua tabel enterprise siap");
  } catch (err) {
    logger.warn({ err }, "Cash Bank migration: non-fatal error");
  }
}

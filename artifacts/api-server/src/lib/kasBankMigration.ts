import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runKasBankMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS company_bank_accounts (
        id            SERIAL PRIMARY KEY,
        company_id    INTEGER NOT NULL,
        name          TEXT NOT NULL,
        account_type  TEXT NOT NULL DEFAULT 'bank',
        bank_name     TEXT,
        account_number TEXT,
        currency      TEXT NOT NULL DEFAULT 'IDR',
        coa_id        INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
        is_active     BOOLEAN NOT NULL DEFAULT TRUE,
        notes         TEXT,
        created_by_id TEXT,
        created_at    TIMESTAMP DEFAULT NOW() NOT NULL,
        updated_at    TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS company_bank_accounts_company_idx ON company_bank_accounts(company_id)
    `).catch(() => {});

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS fund_transfers (
        id              SERIAL PRIMARY KEY,
        company_id      INTEGER NOT NULL,
        transfer_number TEXT NOT NULL UNIQUE,
        from_account_id INTEGER NOT NULL REFERENCES company_bank_accounts(id) ON DELETE RESTRICT,
        to_account_id   INTEGER NOT NULL REFERENCES company_bank_accounts(id) ON DELETE RESTRICT,
        amount          NUMERIC(14,2) NOT NULL,
        date            DATE NOT NULL,
        description     TEXT,
        entry_id        INTEGER REFERENCES accounting_entries(id) ON DELETE SET NULL,
        status          TEXT NOT NULL DEFAULT 'posted',
        created_by_id   TEXT,
        created_at      TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS fund_transfers_company_idx ON fund_transfers(company_id)
    `).catch(() => {});

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS fund_transfers_date_idx ON fund_transfers(date)
    `).catch(() => {});

    logger.info("Kas Bank migration: company_bank_accounts + fund_transfers siap");
  } catch (err) {
    logger.warn({ err }, "Kas Bank migration: non-fatal error");
  }
}

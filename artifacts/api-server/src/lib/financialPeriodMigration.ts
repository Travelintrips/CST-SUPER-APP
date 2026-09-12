import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runFinancialPeriodMigration(): Promise<void> {
  // 1. Tabel financial_periods
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS financial_periods (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      month            INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year             INTEGER NOT NULL,
      is_closed        BOOLEAN NOT NULL DEFAULT FALSE,
      override_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      closed_at        TIMESTAMP,
      closed_by        TEXT,
      created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
      CONSTRAINT financial_periods_company_month_year_uniq
        UNIQUE (company_id, month, year)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS financial_periods_company_idx
      ON financial_periods (company_id, year, month)
  `);
  logger.info("financialPeriodMigration: tabel financial_periods siap");

  // 2. Trigger function — hard lock di level DB
  //    Berlaku untuk INSERT dan UPDATE (jika tanggal entri diubah ke periode tertutup)
  //    Exceptions di-raise sehingga transaksi dibatalkan, bahkan dari direct psql.
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION check_period_locked()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_month          INTEGER;
      v_year           INTEGER;
      v_company_id     INTEGER;
      v_is_closed      BOOLEAN;
      v_override       BOOLEAN;
    BEGIN
      -- Ambil company_id dan tanggal dari baris baru
      v_company_id := NEW.company_id;

      -- Kolom date bisa bertipe DATE atau TIMESTAMP; cast aman ke DATE dulu
      v_month := EXTRACT(MONTH FROM NEW.date::DATE)::INTEGER;
      v_year  := EXTRACT(YEAR  FROM NEW.date::DATE)::INTEGER;

      -- Skip jika company_id NULL (data lama tanpa company)
      IF v_company_id IS NULL THEN
        RETURN NEW;
      END IF;

      -- Cek apakah periode terkunci
      SELECT is_closed, override_allowed
        INTO v_is_closed, v_override
        FROM financial_periods
       WHERE company_id = v_company_id
         AND month      = v_month
         AND year       = v_year
       LIMIT 1;

      -- Tidak ada row di financial_periods → periode belum didefinisikan → boleh
      IF NOT FOUND THEN
        RETURN NEW;
      END IF;

      -- Periode ditutup dan tidak ada override → BLOK
      IF v_is_closed AND NOT COALESCE(v_override, FALSE) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Periode %/% untuk company_id % sudah ditutup dan tidak dapat diubah.',
          v_month, v_year, v_company_id
          USING ERRCODE = 'P0001';
      END IF;

      RETURN NEW;
    END;
    $$
  `);
  logger.info("financialPeriodMigration: trigger function check_period_locked dibuat");

  // 3. Pasang trigger pada accounting_entries (INSERT + UPDATE tanggal/company_id)
  await db.execute(sql`
    DROP TRIGGER IF EXISTS trg_check_period_locked_entries ON accounting_entries
  `);
  await db.execute(sql`
    CREATE TRIGGER trg_check_period_locked_entries
    BEFORE INSERT OR UPDATE OF date, company_id
    ON accounting_entries
    FOR EACH ROW
    EXECUTE FUNCTION check_period_locked()
  `);
  logger.info("financialPeriodMigration: trigger accounting_entries terpasang");

  // 4. Pasang trigger pada accounting_payments
  await db.execute(sql`
    DROP TRIGGER IF EXISTS trg_check_period_locked_payments ON accounting_payments
  `);
  await db.execute(sql`
    CREATE TRIGGER trg_check_period_locked_payments
    BEFORE INSERT OR UPDATE OF date, company_id
    ON accounting_payments
    FOR EACH ROW
    EXECUTE FUNCTION check_period_locked()
  `);
  logger.info("financialPeriodMigration: trigger accounting_payments terpasang");
}

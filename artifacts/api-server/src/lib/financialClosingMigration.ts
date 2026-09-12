import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runFinancialClosingMigration(): Promise<void> {
  // ── 1. journal_sequences — atomic counter (fix race condition di _nextEntryNumber) ──
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS journal_sequences (
      journal_prefix  TEXT    NOT NULL,
      company_id      INTEGER NOT NULL DEFAULT 0,
      year            INTEGER NOT NULL,
      next_seq        INTEGER NOT NULL DEFAULT 1,
      PRIMARY KEY (journal_prefix, company_id, year)
    )
  `);
  logger.info("financialClosingMigration: journal_sequences siap");

  // Seed journal_sequences dari data accounting_entries yang sudah ada
  await db.execute(sql`
    INSERT INTO journal_sequences (journal_prefix, company_id, year, next_seq)
    SELECT
      SPLIT_PART(entry_number, '/', 1)        AS journal_prefix,
      COALESCE(company_id, 0)                 AS company_id,
      SPLIT_PART(entry_number, '/', 2)::int   AS year,
      MAX(SPLIT_PART(entry_number, '/', 3)::int) + 1 AS next_seq
    FROM accounting_entries
    WHERE entry_number ~ '^[A-Za-z]+/[0-9]{4}/[0-9]+$'
      AND SPLIT_PART(entry_number, '/', 3) ~ '^[0-9]+$'
    GROUP BY 1, 2, 3
    ON CONFLICT (journal_prefix, company_id, year) DO UPDATE
      SET next_seq = GREATEST(journal_sequences.next_seq, EXCLUDED.next_seq)
  `);
  logger.info("financialClosingMigration: journal_sequences di-seed dari data existing");

  // ── 2. financial_closings ─────────────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS financial_closings (
      id                SERIAL PRIMARY KEY,
      company_id        INTEGER NOT NULL,
      period            TEXT    NOT NULL,
      status            TEXT    NOT NULL DEFAULT 'OPEN',
      net_income        NUMERIC(14,2),
      closing_entry_id  INTEGER,
      closed_at         TIMESTAMP,
      closed_by         TEXT,
      reopened_at       TIMESTAMP,
      reopened_by       TEXT,
      notes             TEXT,
      created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, period)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS financial_closings_company_idx
      ON financial_closings (company_id, period)
  `);
  logger.info("financialClosingMigration: financial_closings siap");

  // ── 3. ledger_snapshots ───────────────────────────────────────────────────────
  // CREATE TABLE IF NOT EXISTS hanya berlaku untuk tabel baru.
  // Tabel yang sudah ada (dari versi lama) tidak punya kolom baru.
  // ALTER TABLE ADD COLUMN IF NOT EXISTS di bawah menangani upgrade schema secara idempoten.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ledger_snapshots (
      id               SERIAL PRIMARY KEY,
      company_id       INTEGER NOT NULL,
      period           TEXT    NOT NULL,
      account_id       INTEGER NOT NULL,
      account_code     TEXT    NOT NULL,
      account_name     TEXT    NOT NULL,
      account_type     TEXT,
      opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
      period_debit     NUMERIC(14,2) NOT NULL DEFAULT 0,
      period_credit    NUMERIC(14,2) NOT NULL DEFAULT 0,
      closing_balance  NUMERIC(14,2) NOT NULL DEFAULT 0,
      entry_count      INTEGER NOT NULL DEFAULT 0,
      snapshot_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      closing_id       INTEGER REFERENCES financial_closings(id) ON DELETE SET NULL,
      UNIQUE (company_id, period, account_id)
    )
  `);
  // Backfill missing columns for existing tables (upgrade dari skema lama)
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS period           TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS company_id       INTEGER`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS account_id       INTEGER`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS account_type     TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS opening_balance  NUMERIC(14,2) NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS period_debit     NUMERIC(14,2) NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS period_credit    NUMERIC(14,2) NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS closing_balance  NUMERIC(14,2) NOT NULL DEFAULT 0`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS snapshot_at      TIMESTAMP NOT NULL DEFAULT NOW()`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS closing_id       INTEGER`).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ledger_snapshots_company_period_idx
      ON ledger_snapshots (company_id, period)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ledger_snapshots_account_idx
      ON ledger_snapshots (account_id, period)
  `).catch(() => {});
  logger.info("financialClosingMigration: ledger_snapshots siap");

  // ── 4. Chained audit hash columns ────────────────────────────────────────────
  // snapshot_hash: SHA256 dari full state snapshot (termasuk previous_snapshot_hash)
  // previous_snapshot_hash: hash periode sebelumnya → membentuk chain immutable
  await db.execute(sql`
    ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS snapshot_hash TEXT
  `);
  await db.execute(sql`
    ALTER TABLE ledger_snapshots ADD COLUMN IF NOT EXISTS previous_snapshot_hash TEXT
  `);
  logger.info("financialClosingMigration: snapshot_hash + previous_snapshot_hash siap");

  // ── 5. ledger_events — event audit trail ─────────────────────────────────────
  // Semua perubahan finansial dicatat: POST/REVERSE/ADJUST/CLOSE_PERIOD
  // Single source of truth: hanya ledger yang boleh merekam financial events
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS ledger_events (
      id              BIGSERIAL PRIMARY KEY,
      company_id      INTEGER   NOT NULL,
      event_type      TEXT      NOT NULL,
      period          TEXT      NOT NULL,
      entry_id        INTEGER,
      ledger_entry_id BIGINT,
      actor           TEXT,
      payload         JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // Backfill missing columns for existing tables (upgrade dari skema lama)
  await db.execute(sql`ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS period          TEXT NOT NULL DEFAULT ''`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS ledger_entry_id BIGINT`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS actor           TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE ledger_events ADD COLUMN IF NOT EXISTS payload         JSONB`).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ledger_events_company_period_idx
      ON ledger_events (company_id, period)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ledger_events_type_idx
      ON ledger_events (event_type)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ledger_events_created_at_idx
      ON ledger_events (created_at DESC)
  `).catch(() => {});
  logger.info("financialClosingMigration: ledger_events siap");

  // ── 6. fleet_ledger_entries — SINGLE SOURCE OF TRUTH untuk semua data finansial ──
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS fleet_ledger_entries (
      id              BIGSERIAL PRIMARY KEY,
      company_id      INTEGER     NOT NULL,
      ledger_date     DATE        NOT NULL,
      period          TEXT        NOT NULL,
      source_type     TEXT        NOT NULL,
      source_id       INTEGER,
      source_ref      TEXT,
      account_id      INTEGER     NOT NULL,
      account_code    TEXT        NOT NULL,
      account_name    TEXT        NOT NULL,
      account_type    TEXT        NOT NULL,
      debit           NUMERIC(14,2) NOT NULL DEFAULT 0,
      credit          NUMERIC(14,2) NOT NULL DEFAULT 0,
      description     TEXT,
      cost_center_id  INTEGER,
      is_voided       BOOLEAN     NOT NULL DEFAULT false,
      void_ref_id     BIGINT,
      created_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS fle_company_period_idx ON fleet_ledger_entries (company_id, period)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS fle_account_idx        ON fleet_ledger_entries (account_id, period)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS fle_source_idx         ON fleet_ledger_entries (source_type, source_id)`).catch(() => {});
  await db.execute(sql`CREATE INDEX IF NOT EXISTS fle_is_voided_idx      ON fleet_ledger_entries (is_voided)`).catch(() => {});
  // Backfill columns for existing tables (upgrade dari skema lama)
  await db.execute(sql`ALTER TABLE fleet_ledger_entries ADD COLUMN IF NOT EXISTS source_ref     TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE fleet_ledger_entries ADD COLUMN IF NOT EXISTS cost_center_id INTEGER`).catch(() => {});
  await db.execute(sql`ALTER TABLE fleet_ledger_entries ADD COLUMN IF NOT EXISTS void_ref_id    BIGINT`).catch(() => {});
  await db.execute(sql`ALTER TABLE fleet_ledger_entries ADD COLUMN IF NOT EXISTS created_by     TEXT`).catch(() => {});
  logger.info("financialClosingMigration: fleet_ledger_entries siap");

  // ── 7. Period lock trigger on fleet_ledger_entries ───────────────────────────
  // Hard lock: jika period CLOSED, tidak boleh ada INSERT ke ledger
  // Closing entries diizinkan bypass (source_type='closing_entry') karena
  // mereka diposting SEBELUM period di-lock dalam proses closeFinancialPeriod
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fn_ledger_period_lock()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_month      INTEGER;
      v_year       INTEGER;
      v_is_closed  BOOLEAN;
      v_override   BOOLEAN;
    BEGIN
      IF NEW.source_type = 'closing_entry' THEN
        RETURN NEW;
      END IF;

      v_month := EXTRACT(MONTH FROM NEW.ledger_date)::INTEGER;
      v_year  := EXTRACT(YEAR  FROM NEW.ledger_date)::INTEGER;

      SELECT is_closed, override_allowed
        INTO v_is_closed, v_override
        FROM financial_periods
       WHERE company_id = NEW.company_id
         AND month      = v_month
         AND year       = v_year
       LIMIT 1;

      IF NOT FOUND THEN
        RETURN NEW;
      END IF;

      IF v_is_closed AND NOT COALESCE(v_override, FALSE) THEN
        RAISE EXCEPTION 'PERIOD_LOCKED: Ledger periode %/% untuk company_id % sudah ditutup.',
          v_month, v_year, NEW.company_id
          USING ERRCODE = 'P0001';
      END IF;

      RETURN NEW;
    END;
    $$
  `);
  await db.execute(sql`
    DROP TRIGGER IF EXISTS trg_ledger_period_lock ON fleet_ledger_entries
  `);
  await db.execute(sql`
    CREATE TRIGGER trg_ledger_period_lock
    BEFORE INSERT ON fleet_ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION fn_ledger_period_lock()
  `);
  logger.info("financialClosingMigration: period lock trigger on fleet_ledger_entries terpasang");

  // ── 8. v_ledger_balance_view — aggregated balance per account per period ─────
  await db.execute(sql`DROP VIEW IF EXISTS v_ledger_balance_view`).catch(() => {});
  await db.execute(sql`
    CREATE VIEW v_ledger_balance_view AS
    SELECT
      fle.company_id,
      fle.period,
      fle.account_id,
      fle.account_code,
      fle.account_name,
      fle.account_type,
      COALESCE(SUM(fle.debit),  0)::numeric(14,2) AS total_debit,
      COALESCE(SUM(fle.credit), 0)::numeric(14,2) AS total_credit,
      (COALESCE(SUM(fle.debit), 0) - COALESCE(SUM(fle.credit), 0))::numeric(14,2) AS net_balance,
      COUNT(fle.id)::int AS entry_count
    FROM fleet_ledger_entries fle
    WHERE fle.is_voided = false
    GROUP BY
      fle.company_id, fle.period,
      fle.account_id, fle.account_code, fle.account_name, fle.account_type
  `);
  logger.info("financialClosingMigration: v_ledger_balance_view siap");

  // ── 9. Trigger: accounting_entry_lines → fleet_ledger_entries ────────────────
  // Setiap INSERT ke accounting_entry_lines otomatis direspon dengan INSERT ke
  // fleet_ledger_entries (single source of truth). Period lock exception ditangkap
  // agar tidak abort transaksi utama (data tetap masuk ke accounting_entry_lines).
  await db.execute(sql`
    CREATE OR REPLACE FUNCTION fn_sync_entry_line_to_ledger()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_company_id  INTEGER;
      v_date        DATE;
      v_period      TEXT;
      v_source_type TEXT;
      v_source_id   INTEGER;
      v_entry_num   TEXT;
      v_created_by  TEXT;
      v_code        TEXT;
      v_name        TEXT;
      v_type        TEXT;
    BEGIN
      -- ambil data dari accounting_entries
      SELECT
        ae.company_id, ae.date, to_char(ae.date, 'YYYY-MM'),
        ae.source::text, ae.source_id, ae.entry_number, ae.created_by_id
      INTO
        v_company_id, v_date, v_period,
        v_source_type, v_source_id, v_entry_num, v_created_by
      FROM accounting_entries ae
      WHERE ae.id = NEW.entry_id;

      IF NOT FOUND THEN RETURN NEW; END IF;

      -- ambil data COA
      SELECT code, name, type::text
      INTO v_code, v_name, v_type
      FROM chart_of_accounts
      WHERE id = NEW.account_id;

      IF NOT FOUND THEN RETURN NEW; END IF;

      BEGIN
        INSERT INTO fleet_ledger_entries (
          company_id, ledger_date, period,
          source_type, source_id, source_ref,
          account_id, account_code, account_name, account_type,
          debit, credit, description, created_by
        ) VALUES (
          v_company_id, v_date, v_period,
          v_source_type, v_source_id, v_entry_num,
          NEW.account_id, v_code, v_name, v_type,
          COALESCE(NEW.debit,  0),
          COALESCE(NEW.credit, 0),
          NEW.description,
          v_created_by
        );
      EXCEPTION WHEN OTHERS THEN
        -- Period lock atau error lain: catat di log, jangan abort transaksi utama
        RAISE WARNING '[fn_sync_entry_line_to_ledger] INSERT gagal (entry_id=%, account_id=%): %',
          NEW.entry_id, NEW.account_id, SQLERRM;
      END;

      RETURN NEW;
    END;
    $$
  `);

  await db.execute(sql`
    DROP TRIGGER IF EXISTS trg_sync_entry_line_to_ledger ON accounting_entry_lines
  `);
  await db.execute(sql`
    CREATE TRIGGER trg_sync_entry_line_to_ledger
    AFTER INSERT ON accounting_entry_lines
    FOR EACH ROW
    EXECUTE FUNCTION fn_sync_entry_line_to_ledger()
  `);
  logger.info("financialClosingMigration: trigger entry_lines → fleet_ledger_entries terpasang");

  // ── 11. Repair: buat accounting_entries untuk accounting_payments yg entry_id IS NULL ─
  // Data lama yang dibuat via raw INSERT (tidak lewat ingestModulePayment) tidak
  // punya entry_id. Step ini memperbaiki secara idempoten.
  try {
    const brokenPayments = await db.execute(sql`
      SELECT ap.id, ap.company_id, ap.amount, ap.journal_id, ap.date,
             ap.ref, ap.memo, ap.payment_number, ap.source_type, ap.source_id
      FROM accounting_payments ap
      WHERE ap.entry_id IS NULL
        AND ap.amount IS NOT NULL
        AND ap.amount::numeric > 0
      ORDER BY ap.id
      LIMIT 200
    `);

    let repaired = 0;
    for (const ap of brokenPayments.rows as Array<Record<string, unknown>>) {
      try {
        const apId = Number(ap["id"]);
        const apCompanyId = Number(ap["company_id"] ?? 1);
        const apAmount = String(Number(ap["amount"] ?? 0));
        const apJournalId = ap["journal_id"] ? Number(ap["journal_id"]) : null;
        const apDate = ap["date"] ? String(ap["date"]).slice(0, 10) : new Date().toISOString().slice(0, 10);
        const apRef = String(ap["ref"] ?? ap["payment_number"] ?? "");
        const apDesc = String(ap["memo"] ?? ap["ref"] ?? "Pembayaran sport center");

        if (!apJournalId) continue;

        const settingsRes = await db.execute(sql`
          SELECT default_bank_account_id, default_cash_account_id, sales_income_account_id
          FROM accounting_settings WHERE company_id = ${apCompanyId} LIMIT 1
        `);
        const sa = settingsRes.rows[0] as Record<string, unknown> | undefined;

        const bankAccRes = await db.execute(sql`
          SELECT id FROM chart_of_accounts
          WHERE (company_id = ${apCompanyId} OR company_id IS NULL)
            AND type = 'asset' AND is_active = true
            AND (code LIKE '1-11%' OR code LIKE '111%' OR lower(name) LIKE '%bank%' OR lower(name) LIKE '%kas%')
          ORDER BY company_id DESC NULLS LAST, code ASC LIMIT 1
        `);
        const revenueAccRes = await db.execute(sql`
          SELECT id FROM chart_of_accounts
          WHERE (company_id = ${apCompanyId} OR company_id IS NULL)
            AND type = 'revenue' AND is_active = true
          ORDER BY company_id DESC NULLS LAST LIMIT 1
        `);

        const bankAccountId = Number(
          sa?.["default_bank_account_id"] ?? sa?.["default_cash_account_id"] ??
          (bankAccRes.rows[0] as Record<string, unknown>)?.["id"] ?? 0
        );
        const revenueAccountId = Number(
          sa?.["sales_income_account_id"] ??
          (revenueAccRes.rows[0] as Record<string, unknown>)?.["id"] ?? 0
        );

        if (!bankAccountId || !revenueAccountId) continue;

        const apYear = apDate.slice(0, 4);
        const seqRes = await db.execute(sql`
          SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'/',3) AS INTEGER)),0)+1 AS next_seq
          FROM accounting_entries
          WHERE company_id = ${apCompanyId} AND entry_number LIKE 'JNL/%'
        `);
        const nextSeq = Number((seqRes.rows[0] as Record<string, unknown>)?.["next_seq"] ?? 1);
        const entryNumber = `JNL/${apYear}/${String(nextSeq).padStart(6, "0")}`;

        // A previous repair attempt may already have created the journal but
        // failed before linking accounting_payments.entry_id. Reuse it instead
        // of trying to insert another posted row with the same company+source+ref.
        const existingEntryRes = await db.execute(sql`
          SELECT id
          FROM accounting_entries
          WHERE company_id = ${apCompanyId}
            AND source = 'sport_center_booking'
            AND ref = ${apRef || null}
            AND status IN ('posted', 'pending_approval', 'approved')
          ORDER BY id
          LIMIT 1
        `);
        const existingEntryId = Number(
          (existingEntryRes.rows[0] as Record<string, unknown> | undefined)?.["id"] ?? 0,
        );
        if (existingEntryId) {
          await db.execute(sql`
            UPDATE accounting_payments
            SET entry_id = ${existingEntryId}
            WHERE id = ${apId}
              AND entry_id IS NULL
          `);
          repaired++;
          continue;
        }

        const entryRes = await db.execute(sql`
          INSERT INTO accounting_entries
            (company_id, entry_number, journal_id, date, ref, description,
             status, source, source_id, total_debit, total_credit, created_by_id, created_at)
          VALUES
            (${apCompanyId}, ${entryNumber}, ${apJournalId}, ${apDate}::date,
             ${apRef || null}, ${apDesc},
             'posted', 'sport_center_booking', ${Number(ap["source_id"] ?? 0) || null},
             ${apAmount}, ${apAmount}, 'SYSTEM', NOW())
          RETURNING id
        `);
        const entryId = Number((entryRes.rows[0] as Record<string, unknown>)?.["id"] ?? 0);

        if (entryId) {
          await db.execute(sql`
            INSERT INTO accounting_entry_lines (entry_id, account_id, description, debit, credit)
            VALUES
              (${entryId}, ${bankAccountId},    ${apDesc}, ${apAmount}, '0'),
              (${entryId}, ${revenueAccountId}, ${apDesc}, '0', ${apAmount})
          `);
          await db.execute(sql`
            UPDATE accounting_payments SET entry_id = ${entryId} WHERE id = ${apId}
          `);
          repaired++;
        }
      } catch (repErr) {
        logger.warn({ err: repErr, apId: ap["id"] }, "financialClosingMigration: repair entry failed for one accounting_payment (non-fatal)");
      }
    }
    if (repaired > 0) {
      logger.info({ repaired }, "financialClosingMigration: accounting_payments repair selesai");
    }
  } catch (repairErr) {
    logger.warn({ err: repairErr }, "financialClosingMigration: repair step gagal (non-fatal)");
  }

  // ── 10. Backfill: sync semua accounting_entry_lines yang sudah ada ────────────
  try {
    const backfillRes = await db.execute(sql`
      INSERT INTO fleet_ledger_entries (
        company_id, ledger_date, period,
        source_type, source_id, source_ref,
        account_id, account_code, account_name, account_type,
        debit, credit, description, created_by
      )
      SELECT
        ae.company_id,
        ae.date,
        to_char(ae.date, 'YYYY-MM'),
        ae.source::text,
        ae.source_id,
        ae.entry_number,
        ael.account_id,
        coa.code,
        coa.name,
        coa.type::text,
        COALESCE(ael.debit::numeric,  0),
        COALESCE(ael.credit::numeric, 0),
        ael.description,
        ae.created_by_id
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae   ON ae.id  = ael.entry_id
      JOIN chart_of_accounts  coa ON coa.id = ael.account_id
      WHERE ae.status = 'posted'
        AND ae.company_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM fleet_ledger_entries fle
          WHERE fle.source_ref  = ae.entry_number
            AND fle.account_id  = ael.account_id
        )
      ON CONFLICT DO NOTHING
    `);
    const cnt = (backfillRes as { rowCount?: number }).rowCount ?? 0;
    logger.info({ rows: cnt }, "financialClosingMigration: backfill fleet_ledger_entries selesai");
  } catch (backfillErr) {
    logger.warn({ err: backfillErr }, "financialClosingMigration: backfill fleet_ledger_entries gagal (non-fatal)");
  }
}

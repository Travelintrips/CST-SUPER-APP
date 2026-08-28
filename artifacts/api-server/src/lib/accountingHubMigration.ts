import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Accounting Hub Migration — idempotent, aman dijalankan berkali-kali.
 * - Tambah kolom hub ke accounting_entries & accounting_payments
 * - Buat tabel accounting_posting_errors & coa_module_mapping
 * - Buat SQL Views multi-company
 */
export async function runAccountingHubMigration(): Promise<void> {
  try {
    // ── 1. accounting_entries: tambah kolom hub ─────────────────────────────
    await db.execute(sql`
      ALTER TABLE accounting_entries
        ADD COLUMN IF NOT EXISTS branch_id     INTEGER,
        ADD COLUMN IF NOT EXISTS division_id   INTEGER,
        ADD COLUMN IF NOT EXISTS source_schema TEXT,
        ADD COLUMN IF NOT EXISTS source_module TEXT,
        ADD COLUMN IF NOT EXISTS source_table  TEXT,
        ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS void_entry_id INTEGER,
         ADD COLUMN IF NOT EXISTS payment_method TEXT,
         ADD COLUMN IF NOT EXISTS payment_provider TEXT,
         ADD COLUMN IF NOT EXISTS bank_account_id TEXT
    `);
    await db.execute(sql.raw(`
      DO $repair$
      DECLARE
        v_data_type text;
      BEGIN
        SELECT data_type
          INTO v_data_type
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'accounting_entries'
           AND column_name = 'bank_account_id';
        IF v_data_type IS NOT NULL AND v_data_type <> 'text' THEN
          ALTER TABLE accounting_entries
            ALTER COLUMN bank_account_id TYPE TEXT
            USING bank_account_id::text;
        END IF;
      END
      $repair$;
    `)).catch((err) => logger.warn({ err }, "[AccountingHub] Sport Center journal bank account type repair failed"));

    // ── 2. accounting_payments: tambah kolom hub ────────────────────────────
    await db.execute(sql`
      ALTER TABLE accounting_payments
        ADD COLUMN IF NOT EXISTS branch_id     INTEGER,
        ADD COLUMN IF NOT EXISTS division_id   INTEGER,
        ADD COLUMN IF NOT EXISTS source_schema TEXT,
        ADD COLUMN IF NOT EXISTS source_module TEXT,
        ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMP,
         ADD COLUMN IF NOT EXISTS payment_method TEXT,
         ADD COLUMN IF NOT EXISTS payment_provider TEXT
    `);

    // ── 2b. Backfill source payment metadata ──────────────────────────────────
    // Sport Center is canonical in sport_center.sport_payments, while the
    // accounting mirror uses public.sport_payments.method.
    await db.execute(sql`
      UPDATE accounting_payments ap
      SET payment_method = sp.method,
          payment_provider = sp.payment_provider,
          company_id = COALESCE(sp.company_id, ap.company_id)
      FROM sport_payments sp
      WHERE ap.source_type = 'sport_center'
        AND ap.source_doc_id = sp.id
        AND (
          (sp.method IS NOT NULL AND ap.payment_method IS DISTINCT FROM sp.method)
          OR (sp.payment_provider IS NOT NULL AND ap.payment_provider IS DISTINCT FROM sp.payment_provider)
          OR (sp.company_id IS NOT NULL AND ap.company_id IS DISTINCT FROM sp.company_id)
        )
    `).catch((err) => logger.warn({ err }, "[AccountingHub] Sport Center payment method backfill failed"));

    // Existing linked journal headers receive the same non-financial metadata.
    // The external bank number belongs on accounting_entries; accounting_payments
    // intentionally has no bank_account_id column.
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET company_id = COALESCE(sp.company_id, ae.company_id),
          payment_method = COALESCE(sp.method, ae.payment_method),
          payment_provider = COALESCE(sp.payment_provider, ae.payment_provider)
      FROM accounting_payments ap
      JOIN sport_payments sp
        ON ap.source_type = 'sport_center'
       AND ap.source_doc_id = sp.id
      WHERE ae.id = ap.entry_id
        AND (
          (sp.company_id IS NOT NULL AND ae.company_id IS DISTINCT FROM sp.company_id)
          OR (sp.method IS NOT NULL AND ae.payment_method IS DISTINCT FROM sp.method)
          OR (sp.payment_provider IS NOT NULL AND ae.payment_provider IS DISTINCT FROM sp.payment_provider)
        )
    `).catch((err) => logger.warn({ err }, "[AccountingHub] Sport Center journal company/provider backfill failed"));

    // `external_bank_account_id` is the lossless source identity. Do not copy
    // the mirror's internal company_bank_accounts.id into the journal header.
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET bank_account_id = NULLIF(BTRIM(sp.external_bank_account_id::text), '')
      FROM accounting_payments ap
      JOIN sport_payments sp
        ON ap.source_type = 'sport_center'
       AND ap.source_doc_id = sp.id
      WHERE ae.id = ap.entry_id
        AND NULLIF(BTRIM(sp.external_bank_account_id::text), '') IS NOT NULL
        AND ae.bank_account_id IS DISTINCT FROM NULLIF(BTRIM(sp.external_bank_account_id::text), '')
    `).catch((err) => logger.warn({ err }, "[AccountingHub] Sport Center journal bank account backfill failed"));

    // Some legacy booking journals predate accounting_payments. Recover only
    // an unambiguous booking→payment mapping; never pick one payment when a
    // booking has multiple candidates.
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET company_id = COALESCE(source.company_id, ae.company_id),
          payment_method = COALESCE(source.method, ae.payment_method),
          payment_provider = COALESCE(source.payment_provider, ae.payment_provider),
          bank_account_id = COALESCE(
            NULLIF(BTRIM(source.external_bank_account_id::text), ''),
            ae.bank_account_id
          )
      FROM (
        SELECT
          ae0.id AS entry_id,
          MIN(sp.company_id) AS company_id,
          MIN(sp.method) AS method,
          MIN(sp.payment_provider) AS payment_provider,
          MIN(sp.external_bank_account_id::text) AS external_bank_account_id,
          COUNT(*) AS payment_count
        FROM accounting_entries ae0
        JOIN sport_payments sp
          ON ae0.source = 'sport_center_booking'
         AND ae0.source_id = sp.booking_id
        GROUP BY ae0.id
      ) source
      WHERE ae.id = source.entry_id
        AND source.payment_count = 1
        AND (
          (source.company_id IS NOT NULL AND ae.company_id IS DISTINCT FROM source.company_id)
          OR (source.method IS NOT NULL AND ae.payment_method IS DISTINCT FROM source.method)
          OR (source.payment_provider IS NOT NULL AND ae.payment_provider IS DISTINCT FROM source.payment_provider)
          OR (
            NULLIF(BTRIM(source.external_bank_account_id::text), '') IS NOT NULL
            AND ae.bank_account_id IS DISTINCT FROM NULLIF(BTRIM(source.external_bank_account_id::text), '')
          )
        )
    `).catch((err) => logger.warn({ err }, "[AccountingHub] Legacy Sport Center journal metadata backfill failed"));

    // ── 2b-pre. Patch fn_block_posted_entry_update SEBELUM backfill ────────────
    // accountingHubMigration runs before financeGovernanceMigration in the
    // startup chain, so the OLD trigger (blocks ALL posted-entry updates) is still
    // active when the backfills below execute.  Patch it here to allow
    // metadata-only changes (no financial-field or status change) so the backfill
    // can fill NULL payment_method on already-posted Sport Center entries.
    // financeGovernanceMigration will later install the same definition idempotently.
    await db.execute(sql.raw(`
      CREATE OR REPLACE FUNCTION fn_block_posted_entry_update()
      RETURNS TRIGGER LANGUAGE plpgsql AS $$
      BEGIN
        IF OLD.status = 'posted' THEN
          -- Izinkan cancellation: status posted → draft dengan cancel_reason terisi
          IF NEW.status = 'draft' AND NEW.cancel_reason IS NOT NULL AND NEW.cancelled_at IS NOT NULL THEN
            RETURN NEW;
          END IF;
          -- Izinkan metadata-only update (payment_method dll.) selama data finansial
          -- dan status tidak berubah.
          IF NEW.status IS NOT DISTINCT FROM OLD.status
            AND NEW.total_debit  IS NOT DISTINCT FROM OLD.total_debit
            AND NEW.total_credit IS NOT DISTINCT FROM OLD.total_credit
            AND NEW.journal_id   IS NOT DISTINCT FROM OLD.journal_id
            AND NEW.date         IS NOT DISTINCT FROM OLD.date
            AND NEW.source       IS NOT DISTINCT FROM OLD.source
            AND NEW.source_id    IS NOT DISTINCT FROM OLD.source_id
          THEN
            RETURN NEW;
          END IF;
          RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot modify a posted journal entry (id=%). Posted entries are immutable. Use a reversal entry.', OLD.id;
        END IF;
        RETURN NEW;
      END;
      $$
    `)).catch((err) => logger.warn({ err }, "[AccountingHub] Trigger patch fn_block_posted_entry_update failed (non-fatal)"));

    // Backfill journal headers as well. Older Sport Center postings may have
    // payment_method on accounting_payments (or on the public mirror) while
    // accounting_entries.payment_method is still NULL or set to the generic
    // 'cash' default. 'cash' is a fallback — overwrite it when the Sport Center
    // source has a more specific method (QRIS, transfer, etc.).
    // The journal is linked through accounting_payments.entry_id; do not alter
    // any financial values (debit/credit amounts).
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET payment_method = COALESCE(sp.method, ap.payment_method),
          payment_provider = COALESCE(sp.payment_provider, ap.payment_provider)
      FROM accounting_payments ap
      LEFT JOIN sport_payments sp
        ON ap.source_type = 'sport_center'
       AND ap.source_doc_id = sp.id
      WHERE ae.id = ap.entry_id
        AND ap.source_type = 'sport_center'
        AND (ae.payment_method IS NULL OR ae.payment_method = 'cash')
        AND (
          (
            COALESCE(sp.method, ap.payment_method) IS NOT NULL
            AND COALESCE(sp.method, ap.payment_method) <> 'cash'
          )
          OR COALESCE(sp.payment_provider, ap.payment_provider) IS NOT NULL
        )
    `).then((r) => {
      const n = (r as { rowCount?: number }).rowCount ?? 0;
      if (n > 0) logger.info({ updated: n }, "[AccountingHub] Sport Center journal payment method backfill via accounting_payments");
    }).catch((err) => logger.warn({ err }, "[AccountingHub] Sport Center journal payment method backfill failed"));

    // Also repair entries where payment_method = 'cash' but a non-cash source
    // is now known (handles backfills where 'cash' was set as a generic default).
    // Fallback for legacy booking journals that were created before an
    // accounting_payments row existed. Current Sport Center contract is one
    // payment per booking, so source_id can safely resolve the mirror row.
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET payment_method = sp.method,
          payment_provider = sp.payment_provider
      FROM sport_payments sp
      WHERE ae.source = 'sport_center_booking'
        AND ae.source_id = sp.booking_id
        AND (
          (ae.payment_method IS NULL OR ae.payment_method = 'cash')
          OR ae.payment_provider IS DISTINCT FROM sp.payment_provider
        )
        AND (sp.method IS NOT NULL OR sp.payment_provider IS NOT NULL)
    `).then((r) => {
      const n = (r as { rowCount?: number }).rowCount ?? 0;
      if (n > 0) logger.info({ updated: n }, "[AccountingHub] Legacy Sport Center journal payment method backfill via source_id");
    }).catch((err) => logger.warn({ err }, "[AccountingHub] Legacy Sport Center journal payment method backfill failed"));

    // ── 2c. Journal-code backfill (most reliable path) ───────────────────────
    // When sport_payments.booking_id is NULL (trigger couldn't resolve the
    // public booking), all join-based paths above fail. Derive the payment
    // method directly from the journal code used when the entry was posted:
    //   CSH  → 'cash'  | BNK → 'transfer'  | QRIS → 'qris'
    // Only fills NULL values — does not overwrite explicit methods.
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET payment_method = CASE aj.code
        WHEN 'CSH'  THEN 'cash'
        WHEN 'QRIS' THEN 'qris'
        ELSE 'transfer'
      END
      FROM accounting_journals aj
      WHERE ae.journal_id = aj.id
        AND ae.source = 'sport_center_booking'
        AND ae.payment_method IS NULL
    `).then((r) => {
      const n = (r as { rowCount?: number }).rowCount ?? 0;
      if (n > 0) logger.info({ updated: n }, "[AccountingHub] Sport Center journal-code payment method backfill (journal code → method)");
    }).catch((err) => logger.warn({ err }, "[AccountingHub] Sport Center journal-code payment method backfill failed"));

    // ── 2d. Booking-number ref path via sport_payments ────────────────────────
    // Matches accounting_entries.ref (= booking_number) → sport_bookings →
    // sport_payments (via SCPAY-SC-{sc_booking_id} when booking_id is NULL).
    // Overrides 'cash' default when actual method is more specific.
    await db.execute(sql`
      UPDATE accounting_entries ae
      SET payment_method = sp.method,
          payment_provider = sp.payment_provider
      FROM sport_bookings sb
      JOIN sport_payments sp
        ON sp.payment_number = 'SCPAY-SC-' || sb.sc_booking_id::text
      WHERE ae.source = 'sport_center_booking'
        AND ae.ref = sb.booking_number
        AND sb.sc_booking_id IS NOT NULL
        AND (
          (ae.payment_method IS NULL OR ae.payment_method = 'cash')
          OR ae.payment_provider IS DISTINCT FROM sp.payment_provider
        )
        AND (sp.method IS NOT NULL OR sp.payment_provider IS NOT NULL)
    `).then((r) => {
      const n = (r as { rowCount?: number }).rowCount ?? 0;
      if (n > 0) logger.info({ updated: n }, "[AccountingHub] Sport Center payment method backfill via booking-number ref");
    }).catch((err) => logger.warn({ err }, "[AccountingHub] Booking-number Sport Center payment method backfill failed"));

    // ── 3. accounting_posting_errors ─────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS accounting_posting_errors (
        id             SERIAL PRIMARY KEY,
        company_id     INTEGER,
        branch_id      INTEGER,
        division_id    INTEGER,
        source_module  TEXT NOT NULL,
        source_table   TEXT,
        source_id      INTEGER,
        source_ref     TEXT,
        error_code     TEXT NOT NULL,
        error_message  TEXT NOT NULL,
        payload        JSONB,
        resolved_at    TIMESTAMP,
        resolved_by    TEXT,
        resolve_note   TEXT,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS posting_errors_company_idx  ON accounting_posting_errors (company_id);
      CREATE INDEX IF NOT EXISTS posting_errors_module_idx   ON accounting_posting_errors (source_module);
      CREATE INDEX IF NOT EXISTS posting_errors_resolved_idx ON accounting_posting_errors (resolved_at)
    `).catch(() => {});

    // ── 4. coa_module_mapping ─────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS coa_module_mapping (
        id                 SERIAL PRIMARY KEY,
        company_id         INTEGER NOT NULL,
        module             TEXT NOT NULL,
        transaction_type   TEXT NOT NULL,
        debit_account_id   INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
        credit_account_id  INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
        description        TEXT,
        is_active          BOOLEAN NOT NULL DEFAULT TRUE,
        created_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at         TIMESTAMP NOT NULL DEFAULT NOW(),
        UNIQUE (company_id, module, transaction_type)
      )
    `);

    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS coa_module_mapping_company_idx ON coa_module_mapping (company_id)
    `).catch(() => {});

    // ── 5. View: accounting_general_ledger_v ──────────────────────────────────
    await db.execute(sql`
      CREATE OR REPLACE VIEW accounting_general_ledger_v AS
       SELECT
        el.id            AS line_id,
        e.id             AS entry_id,
        e.entry_number,
        e.company_id,
        e.branch_id,
        e.division_id,
        e.date,
        e.source,
        e.source_module,
        e.source_schema,
        e.source_table,
        e.source_id,
        e.ref,
        e.description    AS entry_description,
        el.description   AS line_description,
        e.status,
        j.name           AS journal_name,
        j.type           AS journal_type,
        coa.id           AS account_id,
        coa.code         AS account_code,
        coa.name         AS account_name,
        coa.type         AS account_type,
        el.debit,
        el.credit,
        e.created_at,
        e.posted_at,
        e.voided_at
      FROM accounting_entry_lines el
      JOIN accounting_entries e    ON e.id = el.entry_id
      JOIN accounting_journals j   ON j.id = e.journal_id
      JOIN chart_of_accounts coa   ON coa.id = el.account_id
    `);

    // ── 6. View: accounting_trial_balance_v ───────────────────────────────────
    await db.execute(sql`
      CREATE OR REPLACE VIEW accounting_trial_balance_v AS
      SELECT
        e.company_id,
        e.branch_id,
        e.division_id,
        coa.id           AS account_id,
        coa.code         AS account_code,
        coa.name         AS account_name,
        coa.type         AS account_type,
        SUM(el.debit)    AS total_debit,
        SUM(el.credit)   AS total_credit,
        SUM(el.debit) - SUM(el.credit) AS balance
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id AND e.status = 'posted'
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      GROUP BY e.company_id, e.branch_id, e.division_id,
               coa.id, coa.code, coa.name, coa.type
    `);

    // ── 7. View: accounting_profit_loss_v ─────────────────────────────────────
    await db.execute(sql`
      CREATE OR REPLACE VIEW accounting_profit_loss_v AS
      SELECT
        e.company_id,
        e.branch_id,
        e.division_id,
        e.source_module,
        TO_CHAR(e.date::date, 'YYYY-MM') AS period,
        coa.type         AS account_type,
        coa.id           AS account_id,
        coa.code         AS account_code,
        coa.name         AS account_name,
        SUM(el.debit)    AS total_debit,
        SUM(el.credit)   AS total_credit,
        CASE
          WHEN coa.type = 'revenue'  THEN SUM(el.credit) - SUM(el.debit)
          WHEN coa.type = 'expense'  THEN SUM(el.debit)  - SUM(el.credit)
          ELSE 0
        END AS net_amount
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id AND e.status = 'posted'
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      WHERE coa.type IN ('revenue', 'expense')
      GROUP BY e.company_id, e.branch_id, e.division_id, e.source_module,
               TO_CHAR(e.date::date, 'YYYY-MM'),
               coa.type, coa.id, coa.code, coa.name
    `);

    // ── 8. View: accounting_balance_sheet_v ───────────────────────────────────
    await db.execute(sql`
      CREATE OR REPLACE VIEW accounting_balance_sheet_v AS
      SELECT
        e.company_id,
        e.branch_id,
        e.division_id,
        coa.type         AS account_type,
        coa.id           AS account_id,
        coa.code         AS account_code,
        coa.name         AS account_name,
        SUM(el.debit)    AS total_debit,
        SUM(el.credit)   AS total_credit,
        CASE
          WHEN coa.type IN ('asset')              THEN SUM(el.debit) - SUM(el.credit)
          WHEN coa.type IN ('liability', 'equity') THEN SUM(el.credit) - SUM(el.debit)
          ELSE 0
        END AS balance
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id AND e.status = 'posted'
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      WHERE coa.type IN ('asset', 'liability', 'equity')
      GROUP BY e.company_id, e.branch_id, e.division_id,
               coa.type, coa.id, coa.code, coa.name
    `);

    // ── 9. View: accounting_payments_v ────────────────────────────────────────
    // DROP first so column renames / reordering don't block CREATE OR REPLACE
    await db.execute(sql`DROP VIEW IF EXISTS accounting_payments_v`).catch(() => {});
    await db.execute(sql`
      CREATE OR REPLACE VIEW accounting_payments_v AS
      SELECT
        p.id,
        p.company_id,
        p.branch_id,
        p.division_id,
        p.source_module,
        p.source_schema,
        p.payment_number,
        p.payment_type,
        p.status,
        p.amount,
        p.date,
        p.ref,
        p.memo,
        p.payment_method,
        p.partner_name,
        p.source_type,
        p.source_doc_id,
        p.void_reason,
        p.posted_at,
        p.voided_at,
        j.name AS journal_name,
        j.type AS journal_type,
        p.created_at
      FROM accounting_payments p
      JOIN accounting_journals j ON j.id = p.journal_id
    `);

    logger.info("[AccountingHub] Migration selesai — kolom hub, tabel baru, dan views berhasil dibuat");
  } catch (err) {
    logger.error({ err }, "[AccountingHub] Migration error");
    throw err;
  }
}

/**
 * Additive repair for environments where runAccountingHubMigration() was
 * already marked complete before Sport Center payment metadata was added.
 *
 * This is deliberately separate from the broad Accounting Hub migration:
 * startup migration markers can skip an older completed stage. The repair is
 * idempotent and updates metadata only; it never creates accounting rows or
 * changes financial values, dates, or statuses.
 */
export async function runSportCenterPaymentAccountingMetadataBackfill(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE accounting_entries
      ADD COLUMN IF NOT EXISTS bank_account_id TEXT
  `);
  await db.execute(sql.raw(`
    DO $repair$
    DECLARE
      v_data_type text;
    BEGIN
      SELECT data_type
        INTO v_data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'accounting_entries'
         AND column_name = 'bank_account_id';
      IF v_data_type IS NOT NULL AND v_data_type <> 'text' THEN
        ALTER TABLE accounting_entries
          ALTER COLUMN bank_account_id TYPE TEXT
          USING bank_account_id::text;
      END IF;
    END
    $repair$;
  `));

  // Posted entries are allowed to receive metadata-only corrections by the
  // existing accounting immutability contract. Keep the repair fail-closed:
  // if that contract is unavailable, the stage fails instead of pretending
  // that the backfill completed.
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION fn_block_posted_entry_update()
    RETURNS TRIGGER LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.status = 'posted' THEN
        IF NEW.status = 'draft' AND NEW.cancel_reason IS NOT NULL AND NEW.cancelled_at IS NOT NULL THEN
          RETURN NEW;
        END IF;
        IF NEW.status IS NOT DISTINCT FROM OLD.status
          AND NEW.total_debit  IS NOT DISTINCT FROM OLD.total_debit
          AND NEW.total_credit IS NOT DISTINCT FROM OLD.total_credit
          AND NEW.journal_id   IS NOT DISTINCT FROM OLD.journal_id
          AND NEW.date         IS NOT DISTINCT FROM OLD.date
          AND NEW.source       IS NOT DISTINCT FROM OLD.source
          AND NEW.source_id    IS NOT DISTINCT FROM OLD.source_id
        THEN
          RETURN NEW;
        END IF;
        RAISE EXCEPTION 'IMMUTABILITY_VIOLATION: Cannot modify a posted journal entry (id=%). Posted entries are immutable. Use a reversal entry.', OLD.id;
      END IF;
      RETURN NEW;
    END;
    $$
  `));

  await db.execute(sql`
    UPDATE accounting_payments ap
    SET company_id = COALESCE(sp.company_id, ap.company_id),
        payment_method = COALESCE(sp.method, ap.payment_method),
        payment_provider = COALESCE(sp.payment_provider, ap.payment_provider)
    FROM sport_payments sp
    WHERE ap.source_type = 'sport_center'
      AND ap.source_doc_id = sp.id
      AND (
        (sp.company_id IS NOT NULL AND ap.company_id IS DISTINCT FROM sp.company_id)
        OR (sp.method IS NOT NULL AND ap.payment_method IS DISTINCT FROM sp.method)
        OR (sp.payment_provider IS NOT NULL AND ap.payment_provider IS DISTINCT FROM sp.payment_provider)
      )
  `);

  await db.execute(sql`
    UPDATE accounting_entries ae
    SET company_id = COALESCE(sp.company_id, ae.company_id),
        payment_method = COALESCE(sp.method, ae.payment_method),
        payment_provider = COALESCE(sp.payment_provider, ae.payment_provider),
        bank_account_id = COALESCE(
          NULLIF(BTRIM(sp.external_bank_account_id::text), ''),
          ae.bank_account_id
        )
    FROM sport_payments sp
    WHERE ae.source = 'sport_center_payment'
      AND ae.source_id = sp.id
      AND (
        (sp.company_id IS NOT NULL AND ae.company_id IS DISTINCT FROM sp.company_id)
        OR (sp.method IS NOT NULL AND ae.payment_method IS DISTINCT FROM sp.method)
        OR (sp.payment_provider IS NOT NULL AND ae.payment_provider IS DISTINCT FROM sp.payment_provider)
        OR (
          NULLIF(BTRIM(sp.external_bank_account_id::text), '') IS NOT NULL
          AND ae.bank_account_id IS DISTINCT FROM NULLIF(BTRIM(sp.external_bank_account_id::text), '')
        )
      )
  `);

  await db.execute(sql`
    UPDATE accounting_entries ae
    SET company_id = COALESCE(sp.company_id, ae.company_id),
        payment_method = COALESCE(sp.method, ap.payment_method, ae.payment_method),
        payment_provider = COALESCE(sp.payment_provider, ap.payment_provider, ae.payment_provider),
        bank_account_id = COALESCE(
          NULLIF(BTRIM(sp.external_bank_account_id::text), ''),
          ae.bank_account_id
        )
    FROM accounting_payments ap
    LEFT JOIN sport_payments sp
      ON ap.source_type = 'sport_center'
     AND ap.source_doc_id = sp.id
    WHERE ae.id = ap.entry_id
      AND ap.source_type = 'sport_center'
      AND (
        (sp.company_id IS NOT NULL AND ae.company_id IS DISTINCT FROM sp.company_id)
        OR (COALESCE(sp.method, ap.payment_method) IS NOT NULL
            AND ae.payment_method IS DISTINCT FROM COALESCE(sp.method, ap.payment_method))
        OR (COALESCE(sp.payment_provider, ap.payment_provider) IS NOT NULL
            AND ae.payment_provider IS DISTINCT FROM COALESCE(sp.payment_provider, ap.payment_provider))
        OR (
          NULLIF(BTRIM(sp.external_bank_account_id::text), '') IS NOT NULL
          AND ae.bank_account_id IS DISTINCT FROM NULLIF(BTRIM(sp.external_bank_account_id::text), '')
        )
      )
  `);

  // Legacy booking journals can be recovered only when exactly one payment
  // maps to the booking. Ambiguous bookings remain untouched for review.
  await db.execute(sql`
    UPDATE accounting_entries ae
    SET company_id = COALESCE(source.company_id, ae.company_id),
        payment_method = COALESCE(source.method, ae.payment_method),
        payment_provider = COALESCE(source.payment_provider, ae.payment_provider),
        bank_account_id = COALESCE(
          NULLIF(BTRIM(source.external_bank_account_id::text), ''),
          ae.bank_account_id
        )
    FROM (
      SELECT
        ae0.id AS entry_id,
        MIN(sp.company_id) AS company_id,
        MIN(sp.method) AS method,
        MIN(sp.payment_provider) AS payment_provider,
        MIN(sp.external_bank_account_id::text) AS external_bank_account_id,
        COUNT(*) AS payment_count
      FROM accounting_entries ae0
      JOIN sport_payments sp
        ON ae0.source = 'sport_center_booking'
       AND ae0.source_id = sp.booking_id
      GROUP BY ae0.id
    ) source
    WHERE ae.id = source.entry_id
      AND source.payment_count = 1
      AND (
        (source.company_id IS NOT NULL AND ae.company_id IS DISTINCT FROM source.company_id)
        OR (source.method IS NOT NULL AND ae.payment_method IS DISTINCT FROM source.method)
        OR (source.payment_provider IS NOT NULL AND ae.payment_provider IS DISTINCT FROM source.payment_provider)
        OR (
          NULLIF(BTRIM(source.external_bank_account_id::text), '') IS NOT NULL
          AND ae.bank_account_id IS DISTINCT FROM NULLIF(BTRIM(source.external_bank_account_id::text), '')
        )
      )
  `);

  logger.info("[AccountingHub] Sport Center payment accounting metadata backfill complete");
}

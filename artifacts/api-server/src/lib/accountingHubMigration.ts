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
        ADD COLUMN IF NOT EXISTS void_entry_id INTEGER
    `);

    // ── 2. accounting_payments: tambah kolom hub ────────────────────────────
    await db.execute(sql`
      ALTER TABLE accounting_payments
        ADD COLUMN IF NOT EXISTS branch_id     INTEGER,
        ADD COLUMN IF NOT EXISTS division_id   INTEGER,
        ADD COLUMN IF NOT EXISTS source_schema TEXT,
        ADD COLUMN IF NOT EXISTS source_module TEXT,
        ADD COLUMN IF NOT EXISTS posted_at     TIMESTAMP,
        ADD COLUMN IF NOT EXISTS voided_at     TIMESTAMP
    `);

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

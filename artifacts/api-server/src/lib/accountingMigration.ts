import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent migration untuk fitur accounting automation.
 * Aman dijalankan berkali-kali — hanya menambahkan kolom yang belum ada.
 */
export async function runAccountingMigration(): Promise<void> {
  try {
    // ── sales_documents ──────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE sales_documents
        ADD COLUMN IF NOT EXISTS invoice_number   TEXT,
        ADD COLUMN IF NOT EXISTS invoice_date     DATE,
        ADD COLUMN IF NOT EXISTS due_date         DATE,
        ADD COLUMN IF NOT EXISTS payment_term_days INTEGER DEFAULT 30,
        ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMP
    `);

    // ── purchase_documents ───────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE purchase_documents
        ADD COLUMN IF NOT EXISTS bill_number      TEXT,
        ADD COLUMN IF NOT EXISTS bill_date        TEXT,
        ADD COLUMN IF NOT EXISTS due_date         TEXT,
        ADD COLUMN IF NOT EXISTS payment_term_days INTEGER DEFAULT 30,
        ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMP
    `);

    // ── accounting_payments ──────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE accounting_payments
        ADD COLUMN IF NOT EXISTS payment_number TEXT
    `);

    // ── Server-side ledger reconciliation state ───────────────────────────
    // Keep this migration additive and idempotent because the API runs it on
    // every startup in both development and production environments.
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_type WHERE typname = 'reconciliation_status'
        ) THEN
          CREATE TYPE reconciliation_status AS ENUM ('unreconciled', 'suggested', 'reconciled');
        END IF;
      END $$;
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS accounting_reconciliations (
        id SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL,
        line_id INTEGER NOT NULL UNIQUE
          REFERENCES accounting_entry_lines(id) ON DELETE CASCADE,
        status reconciliation_status NOT NULL DEFAULT 'unreconciled',
        match_source_type TEXT,
        match_source_id INTEGER,
        match_method TEXT,
        match_score NUMERIC(5,2),
        match_details JSONB,
        reconciled_by TEXT,
        reconciled_at TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS accounting_reconciliations_company_status_idx
        ON accounting_reconciliations(company_id, status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS accounting_reconciliations_source_idx
        ON accounting_reconciliations(match_source_type, match_source_id)
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_reconciliations_reconciled_source_uniq
        ON accounting_reconciliations(company_id, match_source_type, match_source_id)
        WHERE status = 'reconciled'
          AND match_source_type IS NOT NULL
          AND match_source_id IS NOT NULL
    `);

    // ── accounting_entry_source enum: tambahkan 'reversal' jika belum ada ──
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumlabel = 'reversal'
            AND enumtypid = 'accounting_entry_source'::regtype
        ) THEN
          ALTER TYPE accounting_entry_source ADD VALUE 'reversal';
        END IF;
      END $$
    `);

    // ── accounting_payment_status enum: tambahkan nilai yang dipakai di kode ──
    // DB awal hanya punya 'posted' dan 'voided'; kode butuh pending_approval/approved/rejected
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'accounting_payment_status'::regtype
            AND enumlabel = 'pending_approval'
        ) THEN
          ALTER TYPE accounting_payment_status ADD VALUE 'pending_approval';
        END IF;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'accounting_payment_status'::regtype
            AND enumlabel = 'approved'
        ) THEN
          ALTER TYPE accounting_payment_status ADD VALUE 'approved';
        END IF;
      END $$
    `);
    await db.execute(sql`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_enum
          WHERE enumtypid = 'accounting_payment_status'::regtype
            AND enumlabel = 'rejected'
        ) THEN
          ALTER TYPE accounting_payment_status ADD VALUE 'rejected';
        END IF;
      END $$
    `);

    // ── chart_of_accounts: tambah kolom yang belum ada ──────────────────────
    await db.execute(sql`
      ALTER TABLE chart_of_accounts
        ADD COLUMN IF NOT EXISTS company_id integer,
        ADD COLUMN IF NOT EXISTS subtype    text,
        ADD COLUMN IF NOT EXISTS is_active  boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS parent_id  integer
    `);

    // ── Dedup guard: cancel JNL duplikat sport_center_booking sebelum buat unique index ──
    // Strategi: per (company_id, ref), pertahankan entry id terkecil.
    // Cancellation path: posted → draft dengan cancel_reason (diizinkan oleh trigger).
    try {
      // Step a: cancel posted duplikat via cancellation path
      await db.execute(sql`
        UPDATE accounting_entries
        SET status       = 'draft',
            cancel_reason = 'DUPLIKAT-AUTO-VOID: entry duplikat sport_center_booking dihapus otomatis',
            cancelled_at  = NOW()
        WHERE source = 'sport_center_booking'
          AND status = 'posted'
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source = 'sport_center_booking'
              AND status IN ('posted', 'draft', 'pending_approval', 'approved', 'rejected')
            GROUP BY company_id, ref
          )
      `);
      // Step b: void payments terhubung ke entry yang baru di-cancel
      await db.execute(sql`
        UPDATE accounting_payments
        SET status = 'voided'
        WHERE source_type = 'sport_center'
          AND status = 'posted'
          AND entry_id IN (
            SELECT id FROM accounting_entries
            WHERE source = 'sport_center_booking'
              AND status = 'draft'
              AND cancel_reason LIKE 'DUPLIKAT-AUTO-VOID%'
          )
      `).catch(() => {});
      // Step c: hapus draft duplikat (setelah posted→draft, dan native draft juga)
      await db.execute(sql`
        DELETE FROM accounting_entries
        WHERE source = 'sport_center_booking'
          AND status IN ('draft', 'rejected')
          AND id NOT IN (
            SELECT MIN(id)
            FROM accounting_entries
            WHERE source = 'sport_center_booking'
              AND status IN ('posted', 'pending_approval', 'approved', 'draft', 'rejected')
            GROUP BY company_id, ref
          )
      `).catch(() => {});
    } catch (dedupErr) {
      logger.warn({ dedupErr }, "Accounting migration: dedup sport_center_booking gagal (non-fatal)");
    }

    // ── UNIQUE INDEX: (company_id, source, ref) hanya untuk status aktif ──────────────
    // Hanya enforce pada posted/pending_approval/approved — mencegah posting duplikat
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_company_source_ref_uniq
        ON accounting_entries (company_id, source, ref)
        WHERE status IN ('posted', 'pending_approval', 'approved')
    `).catch(async (err: unknown) => {
      logger.warn({ err }, "Accounting migration: gagal buat unique index (mungkin masih ada duplikat) — lanjut");
    });

    // ── CORE UNIQUE INDEX: (company_id, source, source_id) ────────────────────────────
    // R-1 Fix: use enum literal comparison `source <> 'manual'::accounting_entry_source`
    // instead of cast `source::text <> 'manual'`. PostgreSQL requires IMMUTABLE expressions
    // in partial index predicates. Casting an enum column to text (source::text) is not
    // guaranteed IMMUTABLE and causes "functions in index predicate must be marked IMMUTABLE"
    // on some PostgreSQL versions, silently skipping index creation.
    //
    // The correct form compares against the typed enum literal directly, which IS IMMUTABLE.
    // Index name changed to avoid confusion with old failed name.
    // company_id is included in the unique key to allow same source+source_id across companies.
    //
    // NOTE: Sport-center migration also creates idx_accounting_entries_source_source_id (no
    // company_id). Both coexist — the scoped index here is canonical; the unscoped one is
    // an additional guard.
    //
    // Drop old failed attempt (IF EXISTS) before creating the corrected index.
    await db.execute(sql`DROP INDEX IF EXISTS idx_accounting_entries_co_src_srcid`).catch(() => {});
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_entries_company_source_source_id_uniq
        ON accounting_entries (company_id, source, source_id)
        WHERE source IS NOT NULL
          AND source_id IS NOT NULL
          AND source <> 'manual'::accounting_entry_source
    `).catch(async (err: unknown) => {
      logger.warn({ err }, "Accounting migration: gagal buat core source_id unique index — lanjut (mungkin masih ada duplikat)");
    });

    // ── CORE UNIQUE INDEX: one module payment → one accounting payment ─────────
    // Application-side SELECT-then-INSERT checks are not race-safe. This guard
    // covers the module payment sources without changing the accounting status
    // enum or deleting historical duplicates. If an old database still contains
    // duplicates, the index creation is logged and the migration continues so
    // operators can review those rows explicitly before enforcing the constraint.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS accounting_payments_company_source_doc_uniq
        ON accounting_payments (company_id, source_type, source_doc_id)
        WHERE source_type IN ('sport_center', 'tenant', 'logistics')
          AND source_doc_id IS NOT NULL
    `).catch(async (err: unknown) => {
      logger.warn(
        { err },
        "Accounting migration: gagal buat unique payment source guard (mungkin masih ada duplikat historis) — lanjut",
      );
    });

    // ── Drop ALL legacy non-company-scoped source dedup indexes (R-1 remediation) ───────
    // These indexes enforce uniqueness on (source, source_id) WITHOUT company_id, which
    // prevents the same source_id from appearing in two different companies — wrong for
    // a multi-tenant system. The new company-scoped index above is the sole canonical guard.
    await db.execute(sql`DROP INDEX IF EXISTS accounting_entries_source_uniq`).catch(() => {});
    await db.execute(sql`DROP INDEX IF EXISTS idx_accounting_entries_source_source_id`).catch(() => {});

    logger.info("Accounting migration: selesai (invoice/bill/payment numbering + due date columns + reversal enum + dedup index + core source_id unique index)");
  } catch (err) {
    logger.error({ err }, "Accounting migration error");
    throw err;
  }
}

/**
 * Repair one-time: void entri sport_center_booking yang salah dicatat ke akun Kas (1-1010-*)
 * padahal seharusnya ke Bank (1-1020-*).
 *
 * Root cause: resolveBankAccount() sebelumnya method-agnostic dan memilih akun pertama
 * berdasarkan code ASC, sehingga 1-1010 (Kas) selalu menang atas 1-1020 (Bank Mandiri)
 * untuk semua metode pembayaran termasuk transfer bank.
 *
 * Fix: void entri yang debitnya ke akun Kas, reset posting_status sport_payments → 'unposted'
 * sehingga backfillSportCenterAccountingPayments() dapat re-post ke akun yang benar.
 *
 * Idempoten — aman dijalankan berkali-kali.
 */
export async function repairKasErSportCenterEntries(): Promise<void> {
  try {
    // Cari accounting_entries sport_center_booking yang line debit-nya ke akun Kas (1-1010-*)
    // DAN metode pembayarannya bukan cash/tunai (= salah catat, seharusnya ke Bank).
    // Cash/tunai yang benar memang debit ke Kas — tidak di-void.
    const wrongEntries = await db.execute(sql`
      SELECT DISTINCT ae.id AS entry_id, ae.company_id, ae.ref
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      JOIN accounting_payments ap ON ap.entry_id = ae.id
      JOIN sport_payments sp ON sp.id = ap.source_doc_id AND ap.source_type = 'sport_center'
      WHERE ae.source = 'sport_center_booking'
        AND ae.status = 'posted'
        AND ael.debit > 0
        AND coa.code LIKE '1-1010%'
        AND lower(sp.method) NOT IN ('cash', 'tunai')
    `);

    const rows = wrongEntries.rows as Array<Record<string, unknown>>;
    if (rows.length === 0) {
      logger.info("[repairKasER] Tidak ada entri salah — skip");
      return;
    }

    logger.warn({ count: rows.length }, "[repairKasER] Ditemukan entri sport_center_booking yang salah debit ke Kas — mulai repair");

    for (const row of rows) {
      const entryId = Number(row["entry_id"]);
      const ref = row["ref"] as string | null; // untuk logging saja

      try {
        // Step 1: cancel/void entry (posted → draft dengan cancel_reason)
        await db.execute(sql`
          UPDATE accounting_entries
          SET status = 'draft',
              cancel_reason = 'REPAIR-KAS-ER: entri sport_center_booking salah debit ke Kas, re-post ke Bank',
              cancelled_at  = NOW()
          WHERE id = ${entryId}
            AND status = 'posted'
        `);

        // Step 2: void linked accounting_payment
        await db.execute(sql`
          UPDATE accounting_payments
          SET status = 'voided'
          WHERE entry_id = ${entryId}
            AND status = 'posted'
        `);

        // Step 3: reset sport_payment posting_status → unposted agar backfill bisa re-run
        await db.execute(sql`
          UPDATE sport_payments sp
          SET posting_status = 'unposted',
              accounting_payment_id = NULL,
              updated_at = NOW()
          FROM accounting_payments ap
          WHERE ap.entry_id  = ${entryId}
            AND ap.source_doc_id = sp.id
            AND ap.source_type   = 'sport_center'
        `);

        logger.info({ entryId, ref }, "[repairKasER] Voided entry — sport_payment reset ke unposted");
      } catch (rowErr) {
        logger.warn({ rowErr, entryId }, "[repairKasER] Gagal repair satu entry — skip");
      }
    }

    logger.info({ repaired: rows.length }, "[repairKasER] Repair selesai — backfill akan re-post ke akun Bank yang benar");
  } catch (err) {
    logger.warn({ err }, "[repairKasER] Repair gagal (non-fatal)");
  }
}

/**
 * Repair: posted entries yang tidak punya baris jurnal (accounting_entry_lines).
 *
 * Root cause: bug draft-first — postToAccountingHub lama menginsert entry langsung
 * sebagai 'posted', sehingga trigger fn_block_posted_lines_mutation memblok INSERT
 * baris, dan entry tersimpan tanpa baris. Akibatnya reversal gagal dengan
 * "Entri tidak memiliki baris jurnal".
 *
 * Strategi repair per entry:
 *   1. Downgrade posted → draft (trigger mengizinkan ini dengan cancel_reason + cancelled_at)
 *   2. Insert baris yang direkonstruksi dari totalDebit/totalCredit + accounting_settings
 *   3. Promote kembali draft → posted dan clear cancel fields
 *      (trigger tidak menghalangi karena OLD.status = 'draft' pada UPDATE ini)
 *
 * Idempoten — aman dijalankan berkali-kali.
 */
export async function repairOrphanedEntryLines(): Promise<void> {
  const SPORT_CENTER_INBOUND_SOURCES = [
    "sport_center_booking",
    "sport_center_payment",
    "sport_center_membership_payment",
    "sport_center_ppn_correction",
    "sport_center_amount_correction",
  ];
  const SPORT_CENTER_OUTBOUND_SOURCES = [
    "sport_center_booking_refund",
    "sport_center_refund",
  ];
  const ALL_SPORT_SOURCES = [...SPORT_CENTER_INBOUND_SOURCES, ...SPORT_CENTER_OUTBOUND_SOURCES];
  const TENANT_INBOUND_SOURCES = ["tenant_rent_payment"];

  const ALL_KNOWN_SOURCES = [...ALL_SPORT_SOURCES, ...TENANT_INBOUND_SOURCES];

  try {
    // Find ALL posted entries that have no lines, across all known source types.
    const inList = ALL_KNOWN_SOURCES.map(s => `'${s}'`).join(', ');
    const orphansRes = await db.execute(sql`
      SELECT ae.id, ae.company_id, ae.source, ae.total_debit, ae.total_credit, ae.journal_id
      FROM accounting_entries ae
      LEFT JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      WHERE ae.status = 'posted'
        AND ael.id IS NULL
        AND ae.source::text IN (${sql.raw(inList)})
      ORDER BY ae.id
    `);

    const orphans = orphansRes.rows as Array<Record<string, unknown>>;
    if (orphans.length === 0) {
      logger.info("[repairOrphanedEntryLines] Tidak ada orphan entry — skip");
      return;
    }

    logger.warn({ count: orphans.length }, "[repairOrphanedEntryLines] Ditemukan posted entries tanpa baris — mulai repair");

    let repaired = 0;
    let skipped = 0;

    for (const row of orphans) {
      const entryId   = Number(row["id"]);
      const companyId = Number(row["company_id"] ?? 1);
      const source    = String(row["source"] ?? "");
      const totalDebit = Number(row["total_debit"] ?? 0);

      try {
        // Resolve accounts from accounting_settings for this company
        const settingsRes = await db.execute(sql`
          SELECT default_cash_account_id, default_bank_account_id, sales_income_account_id
          FROM accounting_settings
          WHERE company_id = ${companyId}
          LIMIT 1
        `);
        const settings = (settingsRes.rows[0] ?? {}) as Record<string, unknown>;

        const kasAccountId     = Number(settings["default_cash_account_id"] ?? settings["default_bank_account_id"] ?? 0);
        const bankAccountId    = Number(settings["default_bank_account_id"] ?? settings["default_cash_account_id"] ?? 0);
        const fallbackIncomeId = Number(settings["sales_income_account_id"] ?? 0);

        let debitAccountId: number;
        let creditAccountId: number;

        if (TENANT_INBOUND_SOURCES.includes(source)) {
          // tenant_rent_payment: Bank receives → Debit Bank, Credit Pendapatan Sewa Tenant (4-1021%)
          const rentIncomeRes = await db.execute(sql`
            SELECT id FROM chart_of_accounts
            WHERE code LIKE '4-1021%' AND company_id = ${companyId}
            LIMIT 1
          `);
          const rentIncomeId = Number(
            (rentIncomeRes.rows[0] as Record<string, unknown> | undefined)?.["id"] ?? fallbackIncomeId
          );
          debitAccountId  = bankAccountId;
          creditAccountId = rentIncomeId;
        } else {
          // Sport center: look for booking income account (4-1017%)
          const incomeRes = await db.execute(sql`
            SELECT id FROM chart_of_accounts
            WHERE code LIKE '4-1017%' AND company_id = ${companyId}
            LIMIT 1
          `);
          const incomeAccountId = Number(
            (incomeRes.rows[0] as Record<string, unknown> | undefined)?.["id"] ?? fallbackIncomeId
          );
          const isOutbound = SPORT_CENTER_OUTBOUND_SOURCES.includes(source);
          // Inbound: Debit = Kas, Credit = Pendapatan  |  Outbound (refund): reversed
          debitAccountId  = isOutbound ? incomeAccountId : kasAccountId;
          creditAccountId = isOutbound ? kasAccountId    : incomeAccountId;
        }

        if (!debitAccountId || !creditAccountId) {
          logger.warn({ entryId, companyId, source }, "[repairOrphanedEntryLines] Akun tidak ditemukan — skip entry");
          skipped++;
          continue;
        }
        const amount          = totalDebit > 0 ? totalDebit : Number(row["total_credit"] ?? 0);

        // Step 1: downgrade posted → draft (trigger allows with cancel_reason + cancelled_at)
        await db.execute(sql`
          UPDATE accounting_entries
          SET status        = 'draft',
              cancel_reason = 'REPAIR-ORPHAN-LINES: entry tanpa baris jurnal akibat bug draft-first — diperbaiki otomatis',
              cancelled_at  = NOW()
          WHERE id = ${entryId} AND status = 'posted'
        `);

        // Step 2: insert the two reconstructed lines (trigger allows INSERT on 'draft' entries)
        await db.execute(sql`
          INSERT INTO accounting_entry_lines (entry_id, account_id, debit, credit, description)
          VALUES
            (${entryId}, ${debitAccountId},  ${amount}, 0,        '[repair] baris debit rekonstruksi'),
            (${entryId}, ${creditAccountId}, 0,         ${amount}, '[repair] baris kredit rekonstruksi')
        `);

        // Step 3: promote back to posted and clear cancel fields
        // OLD.status = 'draft' here so the immutability trigger does NOT fire
        await db.execute(sql`
          UPDATE accounting_entries
          SET status        = 'posted',
              cancel_reason = NULL,
              cancelled_at  = NULL
          WHERE id = ${entryId} AND status = 'draft'
        `);

        logger.info({ entryId, source, amount, debitAccountId, creditAccountId }, "[repairOrphanedEntryLines] Entry berhasil direpair");
        repaired++;
      } catch (rowErr) {
        logger.warn({ rowErr, entryId }, "[repairOrphanedEntryLines] Gagal repair satu entry — skip");
        skipped++;
      }
    }

    logger.info({ repaired, skipped }, "[repairOrphanedEntryLines] Repair selesai");
  } catch (err) {
    logger.warn({ err }, "[repairOrphanedEntryLines] Repair gagal (non-fatal)");
  }
}

// ── Sequence desync helpers ───────────────────────────────────────────────────

/**
 * Discover all (table, id_column, sequence_name) triples in the public schema
 * that are owned by the sequence (i.e. SERIAL / GENERATED BY DEFAULT columns).
 *
 * Uses pg_depend so it works for both SERIAL and IDENTITY columns without
 * having to enumerate table names manually.
 */
async function discoverSerialSequences(): Promise<Array<{ table: string; column: string; seq: string }>> {
  const res = await db.execute(sql`
    SELECT
      t.relname  AS table_name,
      a.attname  AS column_name,
      s.relname  AS sequence_name
    FROM pg_class s
    JOIN pg_depend d   ON d.objid      = s.oid
    JOIN pg_class t    ON t.oid        = d.refobjid
    JOIN pg_attribute a ON a.attrelid  = t.oid
                       AND a.attnum    = d.refobjsubid
    JOIN pg_namespace n ON n.oid       = t.relnamespace
    WHERE s.relkind   = 'S'          -- sequences only
      AND t.relkind   = 'r'          -- ordinary tables only
      AND n.nspname   = 'public'
      AND d.deptype   = 'a'          -- auto dependency (owned-by)
    ORDER BY t.relname, a.attname
  `);

  return (res.rows as Array<Record<string, unknown>>).map(r => ({
    table:  String(r["table_name"]),
    column: String(r["column_name"]),
    seq:    String(r["sequence_name"]),
  }));
}

/**
 * Diagnostic: return all sequences where last_value < MAX(id).
 *
 * This is a read-only check — it never mutates anything.
 * Call it from a health endpoint or a manual script to detect desync
 * before it causes a duplicate-key error in production.
 *
 * Returns an array of desync records (empty = all good).
 */
export async function checkSequenceDesync(): Promise<Array<{
  table: string;
  column: string;
  seq: string;
  lastValue: number;
  maxId: number;
  gap: number;
}>> {
  const desynced: Array<{
    table: string;
    column: string;
    seq: string;
    lastValue: number;
    maxId: number;
    gap: number;
  }> = [];

  try {
    const sequences = await discoverSerialSequences();

    for (const { table, column, seq } of sequences) {
      try {
        // last_value from pg_sequences (never mutates)
        const seqRes = await db.execute(
          sql.raw(`SELECT last_value FROM "${seq}"`)
        );
        const lastValue = Number((seqRes.rows[0] as any)?.last_value ?? 0);

        // MAX of the id column in the table
        const maxRes = await db.execute(
          sql.raw(`SELECT COALESCE(MAX("${column}"), 0) AS max_id FROM "${table}"`)
        );
        const maxId = Number((maxRes.rows[0] as any)?.max_id ?? 0);

        if (maxId > lastValue) {
          desynced.push({ table, column, seq, lastValue, maxId, gap: maxId - lastValue });
        }
      } catch (rowErr) {
        // Non-fatal: sequence or table might not exist in this environment
        logger.debug({ rowErr, table, seq }, "[checkSequenceDesync] skipped one table");
      }
    }

    if (desynced.length > 0) {
      logger.warn(
        { count: desynced.length, tables: desynced.map(d => d.table) },
        "[checkSequenceDesync] Sequence desync terdeteksi — jalankan syncAccountingSequences() untuk memperbaiki"
      );
    } else {
      logger.info("[checkSequenceDesync] Semua sequence sinkron");
    }
  } catch (err) {
    logger.warn({ err }, "[checkSequenceDesync] Gagal menjalankan pengecekan sequence (non-fatal)");
  }

  return desynced;
}

/**
 * Sync PostgreSQL serial sequences to match the actual MAX(id) in each table.
 *
 * WHY THIS IS NEEDED:
 * Drizzle ORM v0.45+ changed INSERT behavior: serial/identity columns are now
 * explicitly included as `DEFAULT` in the column list. This forces PostgreSQL to
 * consume the sequence on every INSERT. If rows were previously bulk-imported with
 * explicit IDs (bypassing the sequence), the sequence stays at a low value and the
 * next auto-generated ID collides → "duplicate key value violates unique constraint".
 *
 * This function now auto-discovers ALL serial sequences in the public schema via
 * pg_depend, so tables like accounting_payments, bank_mutations,
 * bank_reconciliation_matches etc. are covered automatically without having to be
 * named explicitly.
 *
 * Idempotent — safe to call on every startup.
 */
export async function syncAccountingSequences(): Promise<void> {
  try {
    const sequences = await discoverSerialSequences();

    let synced = 0;
    let skipped = 0;

    for (const { table, column, seq } of sequences) {
      try {
        const result = await db.execute(
          sql.raw(`
            SELECT setval(
              '${seq}',
              GREATEST((SELECT COALESCE(MAX("${column}"), 1) FROM "${table}"), 1)
            )
          `)
        );
        const newVal = (result.rows[0] as any)?.setval;
        logger.debug({ table, seq, newVal }, "[syncAccountingSequences] Sequence synced");
        synced++;
      } catch (rowErr) {
        // Non-fatal: table may not exist in this DB environment
        logger.debug({ rowErr, table, seq }, "[syncAccountingSequences] Skipped one sequence");
        skipped++;
      }
    }

    logger.info(
      { synced, skipped, total: sequences.length },
      "[syncAccountingSequences] All serial sequences synced"
    );
  } catch (err) {
    logger.warn({ err }, "[syncAccountingSequences] Sequence sync gagal (non-fatal)");
  }
}

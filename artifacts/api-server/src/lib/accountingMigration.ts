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

  try {
    // Find posted entries that have no lines at all.
    // Use sql.raw() for the static IN-list — these are hardcoded constants, no user input.
    const inList = ALL_SPORT_SOURCES.map(s => `'${s}'`).join(', ');
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

        const kasAccountId       = Number(settings["default_cash_account_id"] ?? settings["default_bank_account_id"] ?? 0);
        const fallbackIncomeId   = Number(settings["sales_income_account_id"] ?? 0);

        // Sport center income account: look for code LIKE '4-1017%' for this company
        const incomeRes = await db.execute(sql`
          SELECT id FROM chart_of_accounts
          WHERE code LIKE '4-1017%' AND company_id = ${companyId}
          LIMIT 1
        `);
        const incomeAccountId = Number((incomeRes.rows[0] as Record<string, unknown> | undefined)?.["id"] ?? fallbackIncomeId);

        if (!kasAccountId || !incomeAccountId) {
          logger.warn({ entryId, companyId }, "[repairOrphanedEntryLines] Akun kas/pendapatan tidak ditemukan — skip entry");
          skipped++;
          continue;
        }

        const isOutbound = SPORT_CENTER_OUTBOUND_SOURCES.includes(source);
        // Inbound (booking/payment): Debit = Kas, Credit = Pendapatan
        // Outbound (refund):         Debit = Pendapatan, Credit = Kas
        const debitAccountId  = isOutbound ? incomeAccountId : kasAccountId;
        const creditAccountId = isOutbound ? kasAccountId    : incomeAccountId;
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

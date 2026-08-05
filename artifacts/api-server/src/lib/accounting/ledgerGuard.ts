/**
 * Ledger Guard — Central journal creation validator + canonical entry point
 *
 * RULE 1: Semua journal WAJIB melalui createJournal() atau approveAndCreateJournal()
 * RULE 2: DB trigger blocks direct SQL insert tanpa source
 * RULE 3: source_type harus dalam ALLOWED_SOURCES whitelist
 * RULE 5: DB trigger blocks UPDATE pada posted entry kecuali → voided
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { PostingLine } from "../accounting.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type LedgerSourceType =
  | "RECONCILIATION"
  | "POS"
  | "HRD"
  | "MANUAL_ADJUSTMENT"
  | "SYSTEM_BOOT";

export interface JournalCreationRequest {
  sourceType: LedgerSourceType;
  sourceId: string | number;
  amount: number;
  actor: string;
  companyId?: number | null;
  ref?: string | null;
  entryNumber?: string;
}

export interface LedgerGuardResult {
  allowed: boolean;
  reason?: string;
  auditId?: number;
}

export interface CreateJournalInput {
  sourceType:   LedgerSourceType;
  sourceId:     string | number;
  actor:        string;             // createdById — WAJIB
  companyId:    number;
  journalId:    number;
  journalCode:  string;
  lines:        PostingLine[];      // minimum 2
  ref?:         string | null;
  description?: string | null;
  date?:        Date | null;
  previousEntryId?: number | null;
}

export interface CreateJournalResult {
  ok:       boolean;
  entryId?: number;
  error?:   string;
}

// Allowed source types — tambahkan secara sadar dan terdokumentasi
const ALLOWED_SOURCES: Set<LedgerSourceType> = new Set([
  "RECONCILIATION",
  "POS",
  "HRD",
  "MANUAL_ADJUSTMENT",
]);

// ─── Migration ────────────────────────────────────────────────────────────────

let guardMigrated = false;

export async function runGuardMigration(): Promise<void> {
  if (guardMigrated) return;
  guardMigrated = true;

  // Audit table
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS ledger_guard_audit (
      id            BIGSERIAL PRIMARY KEY,
      verdict       TEXT NOT NULL DEFAULT 'ALLOWED',
      source_type   TEXT NOT NULL,
      source_id     TEXT,
      amount        NUMERIC(14,2),
      actor         TEXT,
      company_id    INTEGER,
      ref           TEXT,
      reject_reason TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS lga_verdict_idx ON ledger_guard_audit(verdict) WHERE verdict = 'REJECTED'`
  )).catch(() => {});

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS lga_created_idx ON ledger_guard_audit(created_at)`
  )).catch(() => {});

  // Rule 3: ledger_source_type + ledger_source_id columns
  await db.execute(sql.raw(
    `ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS ledger_source_type TEXT`
  )).catch(() => {});

  await db.execute(sql.raw(
    `ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS ledger_source_id TEXT`
  )).catch(() => {});

  // Rule 6: checksum_hash + previous_entry_id columns
  await db.execute(sql.raw(
    `ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS checksum_hash TEXT`
  )).catch(() => {});

  await db.execute(sql.raw(
    `ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS previous_entry_id INTEGER`
  )).catch(() => {});

  // Add bank_reconciliation source values to enum (safe ADD VALUE IF NOT EXISTS)
  await db.execute(sql.raw(
    `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation'`
  )).catch(() => {});

  await db.execute(sql.raw(
    `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation_void'`
  )).catch(() => {});

  // ── CRITICAL FIX (discovered while hardening this migration): 'voided' was
  // NEVER a valid label of accounting_entry_status (only draft/posted/
  // pending_approval/approved/rejected existed). Every void flow that does
  // `SET status = 'voided'` (voidApprovedJournal, accountingPostingGuard
  // reversal, tax void logic) has been silently failing at the DB level —
  // some call sites wrap it in try/catch logged as "non-fatal", so voided
  // entries in this system have likely NEVER actually flipped status; only
  // the offsetting reversal entry got created. Adding the missing label is
  // the minimal, additive, non-breaking fix that makes the already-written
  // void code paths actually work as originally intended.
  await db.execute(sql.raw(
    `ALTER TYPE accounting_entry_status ADD VALUE IF NOT EXISTS 'voided'`
  )).catch(() => {});

  // ── RULE 2: INSERT guard trigger ──────────────────────────────────────────
  // Safety net untuk direct SQL insert yang bypass application layer.
  // Memblok insert jika source adalah NULL (schema sudah NOT NULL default 'manual',
  // tapi trigger memberikan error message yang lebih jelas + audit trail).
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION ae_insert_guard_fn()
    RETURNS TRIGGER AS $$
    BEGIN
      -- Block completely anonymous inserts (no source at all)
      IF NEW.source IS NULL THEN
        RAISE EXCEPTION
          'LEDGER GUARD VIOLATION [INSERT]: accounting_entries.source WAJIB diisi. '
          'Gunakan ledgerGuard.createJournal() atau postEntry() melalui application layer. '
          'Direct SQL insert ke accounting_entries TIDAK DIIZINKAN.';
      END IF;
      -- Warn jika tidak ada actor (created_by_id)
      -- NOTE: NEW.source::text dipakai (bukan enum compare langsung) karena
      -- 'system_boot' BUKAN label valid di enum accounting_entry_source —
      -- compare langsung ke enum akan RAISE ERROR "invalid input value for enum"
      -- untuk SEMUA insert (bukan cuma warning) begitu trigger ini aktif.
      IF NEW.created_by_id IS NULL AND NEW.source::text NOT IN ('manual', 'system_boot', 'closing_entry') THEN
        RAISE WARNING
          'LEDGER GUARD WARNING [INSERT]: accounting_entries #% tidak memiliki created_by_id (source=%). '
          'Semua journal non-manual HARUS memiliki actor yang jelas.',
          NEW.id, NEW.source;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)).catch(() => {});

  await db.execute(sql.raw(
    `DROP TRIGGER IF EXISTS ae_insert_guard ON accounting_entries`
  )).catch(() => {});

  await db.execute(sql.raw(`
    CREATE TRIGGER ae_insert_guard
    BEFORE INSERT ON accounting_entries
    FOR EACH ROW EXECUTE FUNCTION ae_insert_guard_fn()
  `)).catch(() => {});

  // ── RULE 7 (P0 hardening): DB-level financial period lock on INSERT ───────
  // _postEntryCore() sudah mengecek financial_periods.is_closed di application
  // layer (defense-in-depth #1). Tapi beberapa modul (advances reklasifikasi,
  // unified matching engine, ingestModulePayment, financialClosingMigration)
  // melakukan direct SQL INSERT status='posted' ke accounting_entries TANPA
  // lewat postEntry() sama sekali — sehingga cek periode itu tidak pernah
  // terpanggil untuk jalur-jalur ini. Trigger ini adalah defense-in-depth #2
  // di level database: berlaku untuk SEMUA jalur, termasuk yang belum ada dan
  // yang mungkin ditambahkan di masa depan, tanpa terkecuali.
  //
  // EXEMPT_SOURCES sengaja disamakan dengan PERIOD_LOCK_EXEMPT_SOURCES di
  // accounting.ts (_postEntryCore) agar reversal/closing_entry tetap bisa
  // diposting ke tanggal asal walau periode sudah closed.
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION ae_period_lock_insert_guard_fn()
    RETURNS TRIGGER AS $$
    DECLARE
      v_is_closed BOOLEAN;
      v_override  BOOLEAN;
    BEGIN
      IF NEW.status = 'posted'
         AND NEW.company_id IS NOT NULL
         AND NEW.date IS NOT NULL
         AND NEW.source NOT IN ('closing_entry', 'reversal', 'bank_reconciliation_void')
      THEN
        SELECT is_closed, override_allowed INTO v_is_closed, v_override
        FROM financial_periods
        WHERE company_id = NEW.company_id
          AND year  = EXTRACT(YEAR  FROM NEW.date)::INT
          AND month = EXTRACT(MONTH FROM NEW.date)::INT
        LIMIT 1;

        IF v_is_closed AND NOT COALESCE(v_override, FALSE) THEN
          RAISE EXCEPTION
            'LEDGER PERIOD LOCK VIOLATION [INSERT]: accounting_entries tidak bisa di-insert '
            'dengan status=posted ke periode %-% yang sudah DITUTUP (company_id=%, source=%). '
            'Buat reversal/adjustment di periode terbuka, atau set override_allowed=true pada '
            'financial_periods jika koreksi ini benar-benar disengaja.',
            EXTRACT(YEAR FROM NEW.date), EXTRACT(MONTH FROM NEW.date), NEW.company_id, NEW.source;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)).catch(() => {});

  await db.execute(sql.raw(
    `DROP TRIGGER IF EXISTS ae_period_lock_insert_guard ON accounting_entries`
  )).catch(() => {});

  await db.execute(sql.raw(`
    CREATE TRIGGER ae_period_lock_insert_guard
    BEFORE INSERT ON accounting_entries
    FOR EACH ROW EXECUTE FUNCTION ae_period_lock_insert_guard_fn()
  `)).catch(() => {});

  // ── RULE 5: UPDATE immutability trigger ───────────────────────────────────
  // Memblok semua UPDATE pada posted entry kecuali perubahan status → 'voided'.
  // Tag columns (ledger_source_type, ledger_source_id, checksum_hash, previous_entry_id)
  // tetap BOLEH di-update (mereka metadata, bukan financial data).
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION ae_immutability_fn()
    RETURNS TRIGGER AS $$
    DECLARE
      v_is_closed BOOLEAN;
      v_override  BOOLEAN;
    BEGIN
      -- Izinkan repair/cancellation: posted → draft dengan cancel_reason + cancelled_at
      -- Konsisten dengan fn_block_posted_entry_update (financeGovernanceMigration).
      IF OLD.status = 'posted' AND NEW.status = 'draft'
         AND NEW.cancel_reason IS NOT NULL AND NEW.cancelled_at IS NOT NULL THEN
        RETURN NEW;
      END IF;

      -- Jika status berubah dari 'posted' ke bukan 'voided' → BLOK
      IF OLD.status = 'posted' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'voided' THEN
        RAISE EXCEPTION
          'LEDGER IMMUTABILITY VIOLATION [UPDATE]: Entry #% status=posted TIDAK BISA diubah ke "%" — '
          'hanya perubahan ke "voided" (via reversal) yang diizinkan. '
          'Untuk membatalkan, gunakan voidApprovedJournal() atau POST /api/accounting/payments/:id/void.',
          OLD.id, NEW.status;
      END IF;

      -- Jika data finansial diubah pada entry posted → BLOK
      IF OLD.status = 'posted' AND (
        NEW.total_debit IS DISTINCT FROM OLD.total_debit OR
        NEW.total_credit IS DISTINCT FROM OLD.total_credit OR
        NEW.journal_id IS DISTINCT FROM OLD.journal_id OR
        NEW.date IS DISTINCT FROM OLD.date OR
        NEW.source IS DISTINCT FROM OLD.source OR
        NEW.source_id IS DISTINCT FROM OLD.source_id
      ) THEN
        RAISE EXCEPTION
          'LEDGER IMMUTABILITY VIOLATION [UPDATE]: Financial fields pada posted entry #% TIDAK BISA diubah. '
          'total_debit, total_credit, journal_id, date, source, source_id bersifat IMMUTABLE setelah di-post. '
          'Buat reversal entry untuk koreksi.',
          OLD.id;
      END IF;

      -- ── P0 hardening: draft→posted transition juga wajib lolos period lock ──
      -- postEntry() insert entry sebagai 'draft' dulu baru UPDATE ke 'posted'
      -- (untuk satisfy trg_block_lines_mutation). ae_period_lock_insert_guard
      -- hanya menangkap INSERT langsung dengan status='posted'; transisi
      -- draft→posted lewat UPDATE harus dicek di sini juga.
      IF OLD.status = 'draft' AND NEW.status = 'posted'
         AND NEW.company_id IS NOT NULL AND NEW.date IS NOT NULL
         AND NEW.source NOT IN ('closing_entry', 'reversal', 'bank_reconciliation_void')
      THEN
        SELECT is_closed, override_allowed INTO v_is_closed, v_override
        FROM financial_periods
        WHERE company_id = NEW.company_id
          AND year  = EXTRACT(YEAR  FROM NEW.date)::INT
          AND month = EXTRACT(MONTH FROM NEW.date)::INT
        LIMIT 1;

        IF v_is_closed AND NOT COALESCE(v_override, FALSE) THEN
          RAISE EXCEPTION
            'LEDGER PERIOD LOCK VIOLATION [UPDATE draft→posted]: Entry #% tidak bisa diposting ke '
            'periode %-% yang sudah DITUTUP (company_id=%, source=%).',
            OLD.id, EXTRACT(YEAR FROM NEW.date), EXTRACT(MONTH FROM NEW.date), NEW.company_id, NEW.source;
        END IF;
      END IF;

      -- ── P2 hardening: tag/audit metadata columns immutable setelah di-set ────
      -- Sebelumnya kolom ini (ledger_source_type, ledger_source_id, checksum_hash,
      -- previous_entry_id) BOLEH diubah kapan saja karena dianggap "metadata".
      -- Ini adalah celah: seseorang bisa re-tag source sebuah entry posted tanpa
      -- jejak audit. Pola pakai yang sah (tagJournalEntry/checksum computation)
      -- selalu men-set dari NULL → nilai, sesaat setelah INSERT selesai. Maka:
      -- set pertama (OLD IS NULL) tetap diizinkan, tapi begitu terisi, TIDAK
      -- BISA diubah lagi oleh siapapun/apapun.
      IF OLD.ledger_source_type IS NOT NULL AND NEW.ledger_source_type IS DISTINCT FROM OLD.ledger_source_type THEN
        RAISE EXCEPTION 'LEDGER IMMUTABILITY VIOLATION [UPDATE]: ledger_source_type entry #% sudah di-set ("%") dan TIDAK BISA diubah lagi ke "%".',
          OLD.id, OLD.ledger_source_type, NEW.ledger_source_type;
      END IF;
      IF OLD.ledger_source_id IS NOT NULL AND NEW.ledger_source_id IS DISTINCT FROM OLD.ledger_source_id THEN
        RAISE EXCEPTION 'LEDGER IMMUTABILITY VIOLATION [UPDATE]: ledger_source_id entry #% sudah di-set dan TIDAK BISA diubah lagi.', OLD.id;
      END IF;
      IF OLD.checksum_hash IS NOT NULL AND NEW.checksum_hash IS DISTINCT FROM OLD.checksum_hash THEN
        RAISE EXCEPTION 'LEDGER IMMUTABILITY VIOLATION [UPDATE]: checksum_hash entry #% sudah di-set dan TIDAK BISA diubah lagi.', OLD.id;
      END IF;
      IF OLD.previous_entry_id IS NOT NULL AND NEW.previous_entry_id IS DISTINCT FROM OLD.previous_entry_id THEN
        RAISE EXCEPTION 'LEDGER IMMUTABILITY VIOLATION [UPDATE]: previous_entry_id entry #% sudah di-set dan TIDAK BISA diubah lagi.', OLD.id;
      END IF;

      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `)).catch(() => {});

  await db.execute(sql.raw(
    `DROP TRIGGER IF EXISTS ae_immutability ON accounting_entries`
  )).catch(() => {});

  await db.execute(sql.raw(`
    CREATE TRIGGER ae_immutability
    BEFORE UPDATE ON accounting_entries
    FOR EACH ROW EXECUTE FUNCTION ae_immutability_fn()
  `)).catch(() => {});

  // ── RULE 7: Patch check_period_locked() trigger untuk konsistensi ─────────
  // trg_check_period_locked_entries fires BEFORE INSERT OR UPDATE OF date, company_id.
  // Masalah: ia memblok SEMUA INSERT (termasuk status='draft') — berbeda dengan
  // ae_period_lock_insert_guard yang hanya memblok INSERT dengan status='posted'.
  //
  // _postEntryCore sengaja insert sebagai 'draft' dulu agar trigger period-lock
  // di level INSERT tidak menghalangi (aplikasi sudah cek sendiri di step sebelumnya).
  // Tapi trg_check_period_locked_entries memblok INSERT 'draft' juga — inkonsisten.
  //
  // Fix: UPDATE function check_period_locked() agar:
  //   a) Skip jika status='draft' atau 'pending_approval' (insert interim)
  //   b) Skip source-source exempt (closing_entry, reversal, bank_reconciliation_void)
  //      supaya konsisten dengan ae_period_lock_insert_guard
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION check_period_locked()
    RETURNS TRIGGER AS $$
    DECLARE
      v_month          INTEGER;
      v_year           INTEGER;
      v_company_id     INTEGER;
      v_is_closed      BOOLEAN;
      v_override       BOOLEAN;
    BEGIN
      -- Skip untuk INSERT interim (draft/pending_approval) agar konsisten dengan
      -- ae_period_lock_insert_guard yang hanya cek INSERT dengan status='posted'.
      -- Transisi draft→posted dicek oleh ae_immutability trigger (BEFORE UPDATE).
      IF TG_OP = 'INSERT' AND NEW.status IN ('draft', 'pending_approval') THEN
        RETURN NEW;
      END IF;

      -- Skip untuk source yang dikecualikan (sama dengan ae_period_lock_insert_guard)
      IF NEW.source::text IN ('closing_entry', 'reversal', 'bank_reconciliation_void') THEN
        RETURN NEW;
      END IF;

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
    $$ LANGUAGE plpgsql
  `)).catch((e: unknown) => {
    logger.warn({ err: e }, "[LedgerGuard] check_period_locked patch failed (non-fatal)");
  });

  logger.info("[LedgerGuard] Migration selesai — triggers + columns + period-lock consistency patch applied");
}

// ─── Internal audit writer ────────────────────────────────────────────────────

async function writeGuardAudit(
  verdict: "ALLOWED" | "REJECTED",
  req: JournalCreationRequest,
  reason: string | null,
): Promise<number | null> {
  try {
    const srcId = String(req.sourceId ?? "").replace(/'/g, "''");
    const actor = (req.actor ?? "system").replace(/'/g, "''");
    const ref = req.ref ? `'${req.ref.replace(/'/g, "''")}'` : "NULL";
    const rejectReason = reason ? `'${reason.replace(/'/g, "''")}'` : "NULL";
    const companyId = req.companyId != null ? String(req.companyId) : "NULL";
    const amount = Number(req.amount ?? 0);

    const { rows } = await db.execute(sql.raw(`
      INSERT INTO ledger_guard_audit
        (verdict, source_type, source_id, amount, actor, company_id, ref, reject_reason)
      VALUES
        ('${verdict}', '${req.sourceType}', '${srcId}',
         ${amount}, '${actor}', ${companyId}, ${ref}, ${rejectReason})
      RETURNING id
    `));
    return Number((rows[0] as Record<string, unknown>)?.id ?? null) || null;
  } catch {
    return null;
  }
}

// ─── validateJournalCreation — reconciliation-specific guard ─────────────────

/**
 * validateJournalCreation — WAJIB dipanggil sebelum INSERT ke accounting_entries
 * dari bank reconciliation approval flow.
 *
 * Returns { allowed: true } → lanjutkan insert.
 * Returns { allowed: false, reason } → reject, jangan insert.
 */
export async function validateJournalCreation(
  req: JournalCreationRequest,
): Promise<LedgerGuardResult> {
  await runGuardMigration();

  if (!ALLOWED_SOURCES.has(req.sourceType)) {
    const reason = `source_type '${req.sourceType}' tidak dalam daftar yang diizinkan`;
    logger.warn({ req, reason }, "[LedgerGuard] REJECTED — source type");
    const auditId = (await writeGuardAudit("REJECTED", req, reason)) ?? undefined;
    return { allowed: false, reason, auditId };
  }

  if (req.sourceId == null || req.sourceId === "" || req.sourceId === 0) {
    const reason = "source_id wajib diisi";
    logger.warn({ req, reason }, "[LedgerGuard] REJECTED — missing source_id");
    const auditId = (await writeGuardAudit("REJECTED", req, reason)) ?? undefined;
    return { allowed: false, reason, auditId };
  }

  if (!req.amount || Number(req.amount) <= 0) {
    const reason = `amount harus positif (diterima: ${req.amount})`;
    logger.warn({ req, reason }, "[LedgerGuard] REJECTED — invalid amount");
    const auditId = (await writeGuardAudit("REJECTED", req, reason)) ?? undefined;
    return { allowed: false, reason, auditId };
  }

  if (!req.actor || req.actor.trim() === "") {
    const reason = "actor wajib diisi";
    logger.warn({ req, reason }, "[LedgerGuard] REJECTED — missing actor");
    const auditId = (await writeGuardAudit("REJECTED", req, reason)) ?? undefined;
    return { allowed: false, reason, auditId };
  }

  if (req.sourceType === "RECONCILIATION") {
    try {
      const { rows } = await db.execute(sql.raw(`
        SELECT id, status FROM bank_mutations
        WHERE id = ${Number(req.sourceId)} LIMIT 1
      `));
      if (!rows.length) {
        const reason = `mutation id=${req.sourceId} tidak ditemukan di bank_mutations`;
        const auditId = (await writeGuardAudit("REJECTED", req, reason)) ?? undefined;
        return { allowed: false, reason, auditId };
      }
      const mut = rows[0] as Record<string, unknown>;
      const alreadyProcessed = (
        mut["status"] === "approved" ||
        mut["status"] === "approved_pending_posting" ||
        mut["status"] === "posted"
      );
      if (alreadyProcessed) {
        const reason = `mutation id=${req.sourceId} sudah pernah diapprove (status='${mut["status"]}') — cegah double journal`;
        const auditId = (await writeGuardAudit("REJECTED", req, reason)) ?? undefined;
        return { allowed: false, reason, auditId };
      }
    } catch (e: unknown) {
      logger.warn({ err: (e as Error).message }, "[LedgerGuard] mutation check failed (non-fatal, allowing)");
    }
  }

  const auditId = (await writeGuardAudit("ALLOWED", req, null)) ?? undefined;
  logger.info({ sourceType: req.sourceType, sourceId: req.sourceId, auditId }, "[LedgerGuard] ALLOWED");
  return { allowed: true, auditId };
}

// ─── tagJournalEntry — post-insert metadata tagger ────────────────────────────

export async function tagJournalEntry(
  entryId: number,
  sourceType: LedgerSourceType,
  sourceId: string | number,
): Promise<void> {
  await runGuardMigration();
  await db.execute(sql.raw(`
    UPDATE accounting_entries
    SET ledger_source_type = '${sourceType}',
        ledger_source_id   = '${String(sourceId).replace(/'/g, "''")}',
        source_module      = COALESCE(source_module, '${sourceType.toLowerCase()}')
    WHERE id = ${entryId}
  `)).catch((e: unknown) => {
    logger.warn({ err: (e as Error).message, entryId }, "[LedgerGuard] tagJournalEntry failed (non-fatal)");
  });
}

// ─── RULE 1: createJournal — canonical strict entry point ─────────────────────

/**
 * createJournal — CANONICAL ENTRY POINT untuk semua modul yang butuh membuat
 * accounting journal melalui guard layer.
 *
 * BERBEDA dengan approveAndCreateJournal() yang spesifik untuk bank reconciliation:
 * - createJournal() = generic, untuk POS, HRD, MANUAL_ADJUSTMENT, dll.
 * - approveAndCreateJournal() = reconciliation-specific, dengan mutation check.
 *
 * THROW jika:
 * - Required fields kosong (sourceType, sourceId, actor, companyId, journalId, lines)
 * - sourceType tidak dalam ALLOWED_SOURCES
 * - lines < 2
 * - lines tidak balance (debit ≠ credit)
 */
export async function createJournal(
  input: CreateJournalInput,
): Promise<CreateJournalResult> {
  // ── Strict field validation ──────────────────────────────────────────────
  if (!input.sourceType) throw new Error("createJournal: sourceType WAJIB diisi");
  if (!ALLOWED_SOURCES.has(input.sourceType)) {
    throw new Error(`createJournal: sourceType '${input.sourceType}' tidak diizinkan. Allowed: ${[...ALLOWED_SOURCES].join(", ")}`);
  }
  if (input.sourceId == null || input.sourceId === "" || input.sourceId === 0) {
    throw new Error("createJournal: sourceId WAJIB diisi");
  }
  if (!input.actor || input.actor.trim() === "") {
    throw new Error("createJournal: actor (createdById) WAJIB diisi");
  }
  if (!input.companyId || input.companyId <= 0) {
    throw new Error("createJournal: companyId WAJIB diisi dan harus positif");
  }
  if (!input.journalId || input.journalId <= 0) {
    throw new Error("createJournal: journalId WAJIB diisi");
  }
  if (!input.journalCode || input.journalCode.trim() === "") {
    throw new Error("createJournal: journalCode WAJIB diisi");
  }
  if (!input.lines || input.lines.length < 2) {
    throw new Error("createJournal: minimal 2 baris jurnal diperlukan (debit + credit)");
  }

  // ── Balance check ─────────────────────────────────────────────────────────
  const totalDebit  = input.lines.reduce((s, l) => s + (Number(l.debit)  || 0), 0);
  const totalCredit = input.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  if (diff > 0.01) {
    throw new Error(`createJournal: jurnal tidak balance — debit ${totalDebit.toFixed(2)} ≠ credit ${totalCredit.toFixed(2)} (selisih: ${diff.toFixed(2)})`);
  }

  // ── Phase 14: COA posting validity ────────────────────────────────────────
  // Validate that all account IDs in the journal lines are ACTIVE and postable.
  // Fail-closed: any invalid account rejects the journal with a typed error.
  {
    const { validateAccountsForPosting } = await import("../coa/coaValidation.js");
    const accountIds = [...new Set(input.lines.map(l => l.accountId).filter(id => id != null && id > 0))];
    if (accountIds.length > 0) {
      const coaResult = await validateAccountsForPosting(accountIds, input.companyId);
      if (!coaResult.valid) {
        const firstErr = coaResult.errors[0];
        throw new Error(
          `createJournal: akun tidak valid untuk posting — ${firstErr?.message ?? "COA validation failed"}` +
          (coaResult.errors.length > 1 ? ` (+${coaResult.errors.length - 1} error lainnya)` : ""),
        );
      }
    }
  }

  // ── Write audit record ────────────────────────────────────────────────────
  await writeGuardAudit("ALLOWED", {
    sourceType: input.sourceType,
    sourceId:   input.sourceId,
    amount:     totalDebit,
    actor:      input.actor,
    companyId:  input.companyId,
    ref:        input.ref ?? null,
  }, null);

  // ── Post entry via accounting layer ──────────────────────────────────────
  // Lazy import to avoid circular dependency
  const { postEntry } = await import("../accounting.js");

  let entry: Awaited<ReturnType<typeof postEntry>>;
  try {
    entry = await postEntry(
      {
        journalId:    input.journalId,
        date:         input.date ?? new Date(),
        ref:          input.ref ?? null,
        description:  input.description ?? `${input.sourceType} #${input.sourceId}`,
        source:       "bank_reconciliation" as any,
        sourceId:     typeof input.sourceId === "number" ? input.sourceId : null,
        createdById:  input.actor,
        companyId:    input.companyId,
        lines:        input.lines,
      },
      input.journalCode,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, sourceType: input.sourceType, sourceId: input.sourceId }, "[createJournal] postEntry failed");
    return { ok: false, error: msg };
  }

  // ── Tag entry ─────────────────────────────────────────────────────────────
  await tagJournalEntry(entry.id, input.sourceType, input.sourceId);

  // ── Set previous_entry_id if reversal ─────────────────────────────────────
  if (input.previousEntryId) {
    await db.execute(sql.raw(
      `UPDATE accounting_entries SET previous_entry_id = ${input.previousEntryId} WHERE id = ${entry.id}`
    )).catch(() => {});
  }

  // ── Emit event (lazy import) ──────────────────────────────────────────────
  import("../events/financialEventBus.js").then(({ emitJournalCreated }) => {
    emitJournalCreated({
      entryId:    entry.id,
      sourceType: input.sourceType,
      sourceId:   input.sourceId,
      amount:     totalDebit,
      actor:      input.actor,
      ref:        input.ref ?? null,
      companyId:  input.companyId,
    });
  }).catch(() => {});

  logger.info(
    { entryId: entry.id, sourceType: input.sourceType, sourceId: input.sourceId, actor: input.actor },
    "[createJournal] Journal created via guard",
  );

  return { ok: true, entryId: entry.id };
}

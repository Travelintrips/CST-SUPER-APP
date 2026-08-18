import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId, getAllowedCompanyIds } from "../lib/resolveCompany.js";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { logger } from "../lib/logger.js";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import multer from "multer";
import { emitFinancialEvent } from "../lib/financialEventBus.js";
import { validateMultiCurrencyBalance } from "../lib/currencyTolerance.js";
import { validateBeforePost } from "../lib/prePostGate.js";
import { checkRevenueFieldLock, reportImmutabilityViolation } from "../lib/ledgerImmutability.js";
import { queueIntegrityError } from "../lib/errorContainment.js";
import { safeAccountingPost } from "../lib/safeAccountingPost.js";
import { sportPaymentCanonicalSettlementExclusionSql } from "../lib/reconciliation/sportPaymentCanonicalSettlement.js";
import {
  isStartupMigrationComplete,
  markStartupMigrationComplete,
} from "../lib/startupMigrationState.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration ─────────────────────────────────────────────────────────
let migrated = false;
const BANK_MUTATION_IMPORT_VERSION = "schema-bootstrap-v1";

export async function runBankMutationImportMigration() {
  if (migrated) return;
  if (await isStartupMigrationComplete("bank_mutation_import", BANK_MUTATION_IMPORT_VERSION)) {
    migrated = true;
    logger.info("Bank mutation import migration already provisioned; startup DDL skipped");
    return;
  }

  try {
  await db.execute(sql.raw(`SET search_path TO public`));

  // ── Buat tabel-tabel utama satu per satu (pgBouncer tidak support multi-statement) ──
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_mutation_import_batches (
      id            SERIAL PRIMARY KEY,
      filename      TEXT NOT NULL,
      status        TEXT NOT NULL DEFAULT 'DRAFT_IMPORT',
      column_mapping JSONB,
      row_count     INTEGER NOT NULL DEFAULT 0,
      company_id    INTEGER,
      created_by    TEXT,
      notes         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_mutation_import_rows (
      id              SERIAL PRIMARY KEY,
      batch_id        INTEGER NOT NULL REFERENCES bank_mutation_import_batches(id) ON DELETE CASCADE,
      row_index       INTEGER NOT NULL,
      date            TEXT,
      description     TEXT,
      debit           NUMERIC(18,2),
      credit          NUMERIC(18,2),
      balance         NUMERIC(18,2),
      erp_category    TEXT,
      entity_type     TEXT,
      entity_name     TEXT,
      business_unit   TEXT,
      company         TEXT,
      tax_type        TEXT,
      payment_method  TEXT,
      source_account  TEXT,
      pl_flag         TEXT,
      accounting_class TEXT,
      unique_key      TEXT,
      raw             JSONB,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmib_status_idx ON bank_mutation_import_batches(status)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmir_batch_idx  ON bank_mutation_import_rows(batch_id)`)).catch(() => {});
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_mutation_imports (
      id               SERIAL PRIMARY KEY,
      import_batch_id  INTEGER REFERENCES bank_mutation_import_batches(id) ON DELETE SET NULL,
      transaction_date DATE,
      description      TEXT,
      debit            NUMERIC(18,2),
      credit           NUMERIC(18,2),
      balance          NUMERIC(18,2),
      erp_category     TEXT,
      entity_type      TEXT,
      entity_name      TEXT,
      business_unit    TEXT,
      company          TEXT,
      tax_type         TEXT,
      payment_method   TEXT,
      source_account   TEXT,
      pl_flag          TEXT,
      accounting_class TEXT,
      unique_key       TEXT,
      status           TEXT NOT NULL DEFAULT 'DRAFT',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmi_batch_idx  ON bank_mutation_imports(import_batch_id)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmi_status_idx ON bank_mutation_imports(status)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmi_date_idx   ON bank_mutation_imports(transaction_date)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS bmi_unique_key_uidx ON bank_mutation_imports(unique_key) WHERE unique_key IS NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_import_rows    ADD COLUMN IF NOT EXISTS skip_reason TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS branch_id     INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS division_id   INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS department_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS team_id       INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS counterparty_company_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS bank_account_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_import_batches ADD COLUMN IF NOT EXISTS branch_id     INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_import_batches ADD COLUMN IF NOT EXISTS division_id   INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_import_batches ADD COLUMN IF NOT EXISTS department_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_import_batches ADD COLUMN IF NOT EXISTS team_id       INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_mutation_import_audit (
      id          SERIAL PRIMARY KEY,
      batch_id    INTEGER REFERENCES bank_mutation_import_batches(id) ON DELETE SET NULL,
      row_id      INTEGER,
      action      TEXT NOT NULL,
      actor       TEXT NOT NULL DEFAULT 'system',
      field       TEXT,
      before_val  TEXT,
      after_val   TEXT,
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmia_batch_idx   ON bank_mutation_import_audit(batch_id)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmia_actor_idx   ON bank_mutation_import_audit(actor)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmia_created_idx ON bank_mutation_import_audit(created_at DESC)`)).catch(() => {});

  // ── Normalisasi data lama: INCOME/TRANSFER/LIABILITY_SETTLEMENT/ASSET → nilai kanonik
  // Idempoten: WHERE clause hanya match baris yang belum dinormalisasi
  await db.execute(sql.raw(`
    UPDATE bank_mutation_imports
    SET accounting_class = CASE
      WHEN accounting_class = 'INCOME'               THEN 'REVENUE'
      WHEN accounting_class = 'TRANSFER'             THEN 'INTERNAL_TRANSFER'
      WHEN accounting_class = 'LIABILITY_SETTLEMENT' THEN 'REIMBURSEMENT'
      WHEN accounting_class = 'ASSET'                THEN 'REIMBURSEMENT'
      ELSE accounting_class
    END
    WHERE accounting_class IN ('INCOME','TRANSFER','LIABILITY_SETTLEMENT','ASSET')
      AND journal_entry_id IS NULL;

    UPDATE bank_mutation_import_rows
    SET accounting_class = CASE
      WHEN accounting_class = 'INCOME'               THEN 'REVENUE'
      WHEN accounting_class = 'TRANSFER'             THEN 'INTERNAL_TRANSFER'
      WHEN accounting_class = 'LIABILITY_SETTLEMENT' THEN 'REIMBURSEMENT'
      WHEN accounting_class = 'ASSET'                THEN 'REIMBURSEMENT'
      ELSE accounting_class
    END
    WHERE accounting_class IN ('INCOME','TRANSFER','LIABILITY_SETTLEMENT','ASSET');
  `));

  // ── P0: Reset batch yang stuck di PROCESSING (akibat server restart) ─────────
  await db.execute(sql.raw(`
    UPDATE bank_mutation_import_batches
    SET status = 'DRAFT_IMPORT', updated_at = NOW()
    WHERE status = 'PROCESSING';
  `));

  // ── P1: Set company_id pada semua batch Ciputat yang masih NULL ─────────────
  // Mandiri Ciputat = PT Cahaya Sejati Teknologi = company_id 1
  await db.execute(sql.raw(`
    UPDATE bank_mutation_import_batches
    SET company_id = 1
    WHERE company_id IS NULL
      AND (filename ILIKE '%ciputat%');
  `));

  // ── P2 + P3: COA baru — Kliring Transfer Internal (1-1029) ──────────────────
  for (const [companyId, suffix] of [[1,"CST"],[2,"WS"],[3,"DV"],[4,"ER"]] as [number,string][]) {
    const code = `1-1029-${suffix}`;
    const name = `Kliring Transfer Internal ${suffix}`;
    await db.execute(sql.raw(
      `INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, is_active)
       SELECT ${companyId}, '${code}', '${name}', 'asset',
         (SELECT parent_id FROM chart_of_accounts WHERE code = '1-1020-${suffix}' AND company_id = ${companyId} LIMIT 1),
         true
       WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE code = '${code}' AND company_id = ${companyId})`
    ));
  }

  // ── P2: COA baru — Piutang Pinjaman Pihak Ketiga (1-1034) ───────────────────
  for (const [companyId, suffix] of [[1,"CST"],[2,"WS"],[3,"DV"],[4,"ER"]] as [number,string][]) {
    const code = `1-1034-${suffix}`;
    const name = `Piutang Pinjaman Pihak Ketiga ${suffix}`;
    await db.execute(sql.raw(
      `INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, is_active)
       SELECT ${companyId}, '${code}', '${name}', 'asset',
         (SELECT parent_id FROM chart_of_accounts WHERE code = '1-1020-${suffix}' AND company_id = ${companyId} LIMIT 1),
         true
       WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE code = '${code}' AND company_id = ${companyId})`
    ));
  }

  // ── P3: Update INTERNAL_TRANSFER mapping → pakai akun clearing 1-1029 ───────
  await db.execute(sql.raw(`
    UPDATE master_coa_mapping
    SET coa_code = '1-1029', coa_name = 'Kliring Transfer Internal'
    WHERE erp_category = 'INTERNAL_TRANSFER' AND coa_code = '1-1020';
  `));

  // ── P2: Tambah THIRD_PARTY_LOAN ke master_coa_mapping ───────────────────────
  await db.execute(sql.raw(`
    INSERT INTO master_coa_mapping (erp_category, accounting_class, coa_code, coa_name, is_active)
    SELECT 'THIRD_PARTY_LOAN_GIVEN', 'LOAN_RECEIVABLE', '1-1034', 'Piutang Pinjaman Pihak Ketiga', true
    WHERE NOT EXISTS (SELECT 1 FROM master_coa_mapping WHERE erp_category = 'THIRD_PARTY_LOAN_GIVEN');

    INSERT INTO master_coa_mapping (erp_category, accounting_class, coa_code, coa_name, is_active)
    SELECT 'THIRD_PARTY_LOAN_SETTLEMENT', 'LOAN_RECEIVABLE', '1-1034', 'Piutang Pinjaman Pihak Ketiga', true
    WHERE NOT EXISTS (SELECT 1 FROM master_coa_mapping WHERE erp_category = 'THIRD_PARTY_LOAN_SETTLEMENT');
  `));

  // ── P4: Upsert master_bank_accounts — per perusahaan (idempoten) ───────────
  // CST (company_id=1) — Mandiri Ciputat
  await db.execute(sql.raw(`
    INSERT INTO master_bank_accounts (account_name, bank_name, coa_code, company_id, is_active)
    SELECT 'Mandiri Ciputat', 'Bank Mandiri', '1-1023-CST', 1, true
    WHERE NOT EXISTS (SELECT 1 FROM master_bank_accounts WHERE company_id=1 AND coa_code='1-1023-CST');
  `)).catch(() => {});
  await db.execute(sql.raw(`
    UPDATE master_bank_accounts
    SET account_name = 'Mandiri Ciputat', coa_code = '1-1023-CST', company_id = 1
    WHERE is_active = TRUE
      AND company_id = 1
      AND (account_name ILIKE 'Mandiri Ciputat' OR coa_code IN ('1-1020-CST', '1-1023-CST'));
  `)).catch(() => {});
  // Hapus duplicate: hanya simpan satu entry per (company_id, coa_code)
  await db.execute(sql.raw(`
    DELETE FROM master_bank_accounts a
    WHERE a.company_id IS NOT NULL
      AND a.id > (
        SELECT MIN(b.id) FROM master_bank_accounts b
        WHERE b.company_id = a.company_id AND b.coa_code = a.coa_code
      );
  `)).catch(() => {});
  // Hapus semua entry tanpa company_id (legacy generic, tidak terpakai)
  await db.execute(sql.raw(`
    DELETE FROM master_bank_accounts WHERE company_id IS NULL;
  `)).catch(() => {});

  // ERA (company_id=4) — Mandiri, BCA, BNI
  for (const [cid, suffix, bankName, coaSuffix] of [
    [4, 'ER', 'Bank Mandiri', '1-1020-ER'],
    [4, 'ER', 'Bank BCA',     '1-1021-ER'],
    [4, 'ER', 'Bank BNI',     '1-1022-ER'],
    [2, 'WS', 'Bank Mandiri', '1-1020-WS'],
    [2, 'WS', 'Bank BCA',     '1-1021-WS'],
    [2, 'WS', 'Bank BNI',     '1-1022-WS'],
    [3, 'DV', 'Bank Mandiri', '1-1020-DV'],
    [3, 'DV', 'Bank BCA',     '1-1021-DV'],
    [3, 'DV', 'Bank BNI',     '1-1022-DV'],
  ] as [number, string, string, string][]) {
    const accName = `${bankName.replace('Bank ', '')} ${suffix}`;
    await db.execute(sql.raw(
      `INSERT INTO master_bank_accounts (account_name, bank_name, coa_code, company_id, is_active)
       SELECT '${accName}', '${bankName}', '${coaSuffix}', ${cid}, true
       WHERE NOT EXISTS (SELECT 1 FROM master_bank_accounts WHERE company_id=${cid} AND coa_code='${coaSuffix}')`
    )).catch(() => {});
  }

  // ── P0-1 (P0): import_mode pada batch ───────────────────────────────────────
  await db.execute(sql.raw(`
    ALTER TABLE bank_mutation_import_batches
      ADD COLUMN IF NOT EXISTS import_mode TEXT NOT NULL DEFAULT 'HISTORICAL_IMPORT';
  `));

  // ── P0-3 (P0): kolom baru pada bank_mutation_imports ────────────────────────
  await db.execute(sql.raw(`
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS linked_transaction_type TEXT;
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS linked_transaction_id   INTEGER;
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS reconciliation_status   TEXT;
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS import_mode             TEXT;
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS used_fallback_coa       BOOLEAN DEFAULT FALSE;
  `));

  // ── Fix 2: Tambah 'bank_mutation_import' ke enum accounting_entry_source ────
  await db.execute(sql.raw(`
    DO $$ BEGIN
      ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_mutation_import';
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `)).catch(() => {/* non-fatal jika enum tidak ada atau sudah ada */});

  // ── P0-4 (P0): COA Pendapatan Tenant (4-1025-*) — clone dari 4-1020 per company ──
  await db.execute(sql.raw(`
    INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, is_active)
    SELECT
      e.company_id,
      REGEXP_REPLACE(e.code, '4-1020', '4-1025'),
      'Pendapatan Tenant',
      e.type,
      e.parent_id,
      true
    FROM chart_of_accounts e
    WHERE e.code LIKE '4-1020%'
      AND NOT EXISTS (
        SELECT 1 FROM chart_of_accounts x
        WHERE x.company_id = e.company_id AND x.code LIKE '4-1025%'
      );
  `)).catch(() => {/* non-fatal jika sudah ada */});

  // ── P1: Row-level status, rejection, dan linked-transaction pada rows ────────
  await db.execute(sql.raw(`
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'DRAFT';
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS rejected_by TEXT;
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS linked_transaction_type TEXT;
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS linked_transaction_id INTEGER;
    ALTER TABLE bank_mutation_import_rows ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;
  `));

  // ── P1: Rejection columns pada bank_mutation_imports ────────────────────────
  await db.execute(sql.raw(`
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS rejected_by TEXT;
    ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ;
  `));

  // ── P1: Bridge columns pada bank_mutations (non-breaking) ───────────────────
  await db.execute(sql.raw(`
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS import_batch_id INTEGER;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS import_row_id INTEGER;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS source TEXT;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS company_id INTEGER;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS source_account TEXT;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS reconciliation_status TEXT;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS linked_transaction_type TEXT;
    ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS linked_transaction_id INTEGER;
  `)).catch(() => {/* non-fatal jika bank_mutations belum ada */});

  // ── Normalization Layer: bank_mutation_normalized_entries ─────────────────────
  // Split per-statement karena pgBouncer Supabase tidak support multi-statement query
  // Drop VIEW jika ada (bisa terbentuk dari migration lama), ganti dengan TABLE
  await db.execute(sql.raw(`DROP VIEW IF EXISTS bank_mutation_normalized_entries`)).catch(() => {});
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_mutation_normalized_entries (
      id                       SERIAL PRIMARY KEY,
      batch_id                 INTEGER NOT NULL REFERENCES bank_mutation_import_batches(id) ON DELETE CASCADE,
      row_id                   INTEGER,
      transaction_date         DATE,
      description              TEXT,
      amount                   NUMERIC(18,2) NOT NULL DEFAULT 0,
      direction                TEXT NOT NULL DEFAULT 'IN',
      erp_category             TEXT,
      accounting_class         TEXT,
      company_id               INTEGER,
      branch_id                INTEGER,
      division_id              INTEGER,
      department_id            INTEGER,
      cost_center_id           TEXT,
      business_unit_id         TEXT,
      coa_debit                TEXT,
      coa_credit               TEXT,
      unique_key               TEXT,
      status                   TEXT NOT NULL DEFAULT 'READY',
      match_score              NUMERIC(5,2) DEFAULT 0,
      linked_transaction_type  TEXT,
      linked_transaction_id    INTEGER,
      used_fallback_coa        BOOLEAN DEFAULT FALSE,
      journal_entry_id         INTEGER,
      created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmne_batch_idx  ON bank_mutation_normalized_entries(batch_id)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmne_status_idx ON bank_mutation_normalized_entries(status)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmne_date_idx   ON bank_mutation_normalized_entries(transaction_date)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS bmne_unique_key_uidx ON bank_mutation_normalized_entries(unique_key) WHERE unique_key IS NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS used_fallback_coa BOOLEAN DEFAULT FALSE`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS superseded_at TIMESTAMPTZ`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS coa_drift BOOLEAN DEFAULT FALSE`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmne_uk_batch_idx ON bank_mutation_normalized_entries(unique_key, batch_id) WHERE unique_key IS NOT NULL`)).catch(() => {});
  await db.execute(sql.raw(`
    UPDATE bank_mutation_normalized_entries
    SET status = 'NEED_REVIEW'
    WHERE status NOT IN ('POSTED','MATCHED','SUPERSEDED','DUPLICATE')
      AND (
        coa_debit   IS NULL OR coa_debit   = '' OR
        coa_credit  IS NULL OR coa_credit  = '' OR
        direction   IS NULL OR direction   = '' OR
        amount      IS NULL OR amount      = 0
      )
  `)).catch(() => {});

  // ── FASE 2: Multi-company per row ────────────────────────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS revenue_company_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS collecting_company_id INTEGER`)).catch(() => {});

  // ── FASE 4: Internal transfer pairing ────────────────────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS transaction_pair_id TEXT`)).catch(() => {});

  // ── FASE 1/8: COA status per row ─────────────────────────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS coa_status TEXT DEFAULT 'PENDING'`)).catch(() => {});

  // ── FASE 6: Subledger tracking (warning only, tidak blocking) ────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS subledger_status TEXT DEFAULT 'MISSING'`)).catch(() => {});

  // ── FASE 9: Audit log — reason field ─────────────────────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_import_audit ADD COLUMN IF NOT EXISTS reason TEXT`)).catch(() => {});

  // ── FASE 5: Normalized entries — kolom baru ──────────────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS revenue_company_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS collecting_company_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS transaction_pair_id TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS coa_status TEXT DEFAULT 'PENDING'`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS subledger_status TEXT DEFAULT 'MISSING'`)).catch(() => {});

  // ── SAP HARDENING FASE 5: Normalized-entry versioning ───────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS previous_version_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS is_latest_version BOOLEAN NOT NULL DEFAULT TRUE`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmne_latest_version_idx ON bank_mutation_normalized_entries(batch_id, is_latest_version) WHERE is_latest_version = TRUE`)).catch(() => {});

  // ── MULTI-COMPANY BALANCE SHEET HANDLER: kolom baru ──────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS correlation_id TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS integrity_audit_queued BOOLEAN DEFAULT FALSE`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bmne_bs_handler_idx ON bank_mutation_normalized_entries(batch_id, pl_flag, status) WHERE pl_flag = 'BALANCE_SHEET'`)).catch(() => {});
  // ── is_balance_sheet flag + pl_flag di normalized entries ────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS is_balance_sheet BOOLEAN NOT NULL DEFAULT FALSE`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_imports ADD COLUMN IF NOT EXISTS is_balance_sheet BOOLEAN NOT NULL DEFAULT FALSE`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutation_normalized_entries ADD COLUMN IF NOT EXISTS pl_flag TEXT`)).catch(() => {});
  // Back-fill is_balance_sheet dari pl_flag yang sudah ada
  await db.execute(sql.raw(`
    UPDATE bank_mutation_normalized_entries
    SET is_balance_sheet = TRUE
    WHERE UPPER(COALESCE(pl_flag,'')) = 'BALANCE_SHEET'
      AND is_balance_sheet = FALSE
  `)).catch(() => {});

  // ── FASE 7: COA intercompany — Hutang IC DIVA (2-1060-CST) ──────────────────
  await db.execute(sql.raw(`
    INSERT INTO chart_of_accounts (company_id, code, name, type, parent_id, is_active)
    SELECT 1, '2-1060-CST', 'Hutang Intercompany - PT Diva Servis', 'liability',
      (SELECT parent_id FROM chart_of_accounts WHERE company_id=1 AND type='liability' LIMIT 1),
      true
    WHERE NOT EXISTS (SELECT 1 FROM chart_of_accounts WHERE code='2-1060-CST' AND company_id=1)
  `)).catch(() => {});

  // ── FASE 7: master_coa_mapping — REVENUE_AIRPORT_TRANSFER → IC Payable DIVA ─
  // CST hanya mencatat Hutang IC DIVA saat uang masuk (collecting company, bukan revenue company)
  await db.execute(sql.raw(`
    UPDATE master_coa_mapping
    SET coa_code = '2-1060', coa_name = 'Hutang Intercompany - PT Diva Servis', accounting_class = 'LIABILITY'
    WHERE erp_category = 'REVENUE_AIRPORT_TRANSFER' AND is_active = true
  `)).catch(() => {});
  await db.execute(sql.raw(`
    INSERT INTO master_coa_mapping (erp_category, accounting_class, coa_code, coa_name, is_active)
    SELECT 'REVENUE_AIRPORT_TRANSFER', 'LIABILITY', '2-1060', 'Hutang Intercompany - PT Diva Servis', true
    WHERE NOT EXISTS (SELECT 1 FROM master_coa_mapping WHERE erp_category = 'REVENUE_AIRPORT_TRANSFER')
  `)).catch(() => {});

  await markStartupMigrationComplete(
    "bank_mutation_import",
    BANK_MUTATION_IMPORT_VERSION,
    "Bank mutation import tables, normalization schema, and baseline accounting mappings",
  );
  migrated = true;
  } catch (err) {
    logger.error({ err }, "runBankMutationImportMigration: DDL error");
    // Do not turn a failed migration into a completed process-local fast path.
    // The startup runner must persist `failed` and retry on the next startup.
    throw err;
  }
}

// ─── Audit log helper ─────────────────────────────────────────────────────────
async function auditImportLog(opts: {
  batchId?: number | null;
  rowId?: number | null;
  action: string;
  actor: string;
  field?: string;
  beforeVal?: string | null;
  afterVal?: string | null;
  meta?: object;
}) {
  try {
    const meta = opts.meta ? `'${JSON.stringify(opts.meta).replace(/'/g, "''")}'` : "NULL";
    await db.execute(sql.raw(`
      INSERT INTO bank_mutation_import_audit
        (batch_id, row_id, action, actor, field, before_val, after_val, meta)
      VALUES (
        ${opts.batchId ?? "NULL"},
        ${opts.rowId ?? "NULL"},
        '${opts.action.replace(/'/g, "''")}',
        '${opts.actor.replace(/'/g, "''")}',
        ${opts.field ? `'${opts.field.replace(/'/g, "''")}'` : "NULL"},
        ${opts.beforeVal != null ? `'${String(opts.beforeVal).replace(/'/g, "''")}'` : "NULL"},
        ${opts.afterVal != null ? `'${String(opts.afterVal).replace(/'/g, "''")}'` : "NULL"},
        ${meta}
      )
    `));
  } catch (e) {
    logger.warn({ err: e }, "auditImportLog failed (non-fatal)");
  }
}

// ─── Cost center mapping ───────────────────────────────────────────────────────
function mapCostCenter(erpCategory: string | null): string {
  if (!erpCategory) return 'FINANCE';
  const c = erpCategory.toUpperCase();
  // Sport Center
  if (c === 'REVENUE_GYM' || c === 'REVENUE_BADMINTON' || c === 'REVENUE_TENNIS'
    || c === 'REVENUE_FUTSAL' || c === 'REVENUE_BASKET'
    || c.includes('GYM') || c.includes('SPORT') || c.includes('BADMINTON')
    || c.includes('FUTSAL') || c.includes('BASKET'))           return 'SPORT_CENTER';
  // Tenant
  if (c === 'REVENUE_TENANT' || c.includes('TENANT'))          return 'TENANT';
  // Logistics
  if (c === 'REVENUE_LOGISTICS'
    || c.includes('LOGISTIC') || c.includes('FREIGHT') || c.includes('SHIPPING'))
                                                                return 'LOGISTICS';
  // Airport Service
  if (c === 'REVENUE_AIRPORT_TRANSFER' || c === 'REVENUE_PERSONAL_HANDLING'
    || c.includes('AIRPORT'))                                   return 'AIRPORT_SERVICE';
  // Finance (default)
  return 'FINANCE';
}

// ─── FASE 7: Bank Fee COA default — tidak perlu master_coa_mapping ───────────
// Biaya administrasi bank (admin fee, provisi, materai, dsb) selalu expense.
// Jika tidak ada entry di master_coa_mapping untuk 'BANK_FEE', pakai COA ini.
const BANK_FEE_COA_DEFAULT = '5-3010'; // Beban Bunga & Administrasi Bank

// ─── normalizeBankMutationRow — resolve COA dr/cr, cost center, direction ─────
async function normalizeBankMutationRow(row: {
  erpCategory:    string | null;
  accountingClass:string | null;
  credit:         number | null;
  debit:          number | null;
  bankAccountId?: number | null;
  sourceAccount?: string | null;
  taxType?:       string | null;
  companyId?:     number | null;
}): Promise<{
  coaDebit:       string;
  coaCredit:      string;
  direction:      'IN' | 'OUT';
  costCenter:     string;
  accountingClass:string;
  usedFallback:   boolean;
  coaStatus:      'VALID' | 'MISSING' | 'PENDING';
  status:         'READY' | 'NEED_REVIEW' | 'NEED_COA_MAPPING';
}> {
  const credit     = Number(row.credit || 0);
  const direction: 'IN' | 'OUT' = credit > 0 ? 'IN' : 'OUT';
  const erpCategory = row.erpCategory ?? null;

  let normClass = normalizeAccountingClass(row.accountingClass);
  if (!normClass && erpCategory) normClass = deriveAccClassFromErp(erpCategory);
  const accClass = normClass ?? 'NEED_REVIEW';

  if (accClass === 'NEED_REVIEW' || !VALID_ACC_CLASSES.includes(accClass)) {
    return { coaDebit: '1-1020', coaCredit: '4-1020', direction, costCenter: mapCostCenter(erpCategory), accountingClass: accClass, usedFallback: true, coaStatus: 'PENDING', status: 'NEED_REVIEW' };
  }

  const masterMapping = await resolveCoaMapping(erpCategory);
  const bankCoaCode   = await resolveBankCoaCode(row.bankAccountId ?? null, row.sourceAccount ?? null);
  const usedFallback  = !masterMapping;
  const normResolved  = normalizeAccountingClass(masterMapping?.accountingClass ?? accClass) ?? accClass;

  let drCode: string;
  let crCode: string;

  // ── FASE 1/8: Strict COA enforcement — INCOME/EXPENSE wajib punya master_coa_mapping ──
  if (normResolved === 'INCOME' || normResolved === 'REVENUE') {
    if (!masterMapping) {
      return {
        coaDebit: '', coaCredit: '', direction, costCenter: mapCostCenter(erpCategory),
        accountingClass: accClass, usedFallback: true, coaStatus: 'MISSING', status: 'NEED_COA_MAPPING',
      };
    }
    drCode = bankCoaCode;
    crCode = masterMapping.coaCode;
  } else if (normResolved === 'EXPENSE') {
    if (!masterMapping) {
      // ── FASE 7: BANK_FEE pakai COA hardcoded — tidak perlu master_coa_mapping ──
      // Biaya admin bank (admin fee, provisi, materai, bi-fast fee, dsb) selalu
      // masuk COA BANK_FEE_COA_DEFAULT tanpa perlu konfigurasi manual.
      const isBankFeeCategory = (erpCategory ?? '').toUpperCase() === 'BANK_FEE';
      if (isBankFeeCategory) {
        drCode = BANK_FEE_COA_DEFAULT;
        crCode = bankCoaCode;
      } else {
        return {
          coaDebit: '', coaCredit: '', direction, costCenter: mapCostCenter(erpCategory),
          accountingClass: accClass, usedFallback: true, coaStatus: 'MISSING', status: 'NEED_COA_MAPPING',
        };
      }
    } else {
      drCode = masterMapping.coaCode;
      crCode = bankCoaCode;
    }
  } else if (normResolved === 'TAX' || normResolved === 'TAX_PAYMENT') {
    const taxLiab = await resolveTaxMapping(row.taxType ?? null);
    // Generic tax must never silently become PPN Keluaran or an operating
    // expense. A subtype-specific active mapping is required.
    if (!taxLiab) {
      return {
        coaDebit: '', coaCredit: '', direction, costCenter: mapCostCenter(erpCategory),
        accountingClass: accClass, usedFallback: true, coaStatus: 'MISSING', status: 'NEED_COA_MAPPING',
      };
    }
    drCode = taxLiab;
    crCode = bankCoaCode;
  } else if (normResolved === 'TRANSFER' || normResolved === 'INTERNAL_TRANSFER') {
    const clearingCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.TRANSFER.drCode;
    drCode = direction === 'IN' ? bankCoaCode : clearingCode;
    crCode = direction === 'IN' ? clearingCode : bankCoaCode;
  } else if (normResolved === 'ASSET' || normResolved === 'EMPLOYEE_ADVANCE'
           || normResolved === 'INTERCOMPANY_LOAN' || normResolved === 'LOAN_RECEIVABLE') {
    const assetCoa = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.ASSET.drCode;
    const eu = (erpCategory ?? '').toUpperCase();
    if (eu === 'THIRD_PARTY_LOAN_GIVEN' || eu === 'INTERCOMPANY_LOAN_GIVEN'
      || eu === 'EMPLOYEE_ADVANCE' || eu === 'REIMBURSEMENT_RECEIVED') {
      drCode = assetCoa; crCode = bankCoaCode;
    } else {
      drCode = bankCoaCode; crCode = assetCoa;
    }
  } else if (normResolved === 'LIABILITY') {
    drCode = bankCoaCode;
    crCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.LIABILITY.crCode;
  } else if (normResolved === 'LIABILITY_SETTLEMENT' || normResolved === 'REIMBURSEMENT') {
    drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.LIABILITY_SETTLEMENT.drCode;
    crCode = bankCoaCode;
  } else if (normResolved === 'EQUITY') {
    const equityCoa = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.EQUITY.crCode;
    drCode = direction === 'IN' ? bankCoaCode : equityCoa;
    crCode = direction === 'IN' ? equityCoa   : bankCoaCode;
  } else {
    const fb = CLASS_MAP_FALLBACK[normResolved];
    if (!fb) {
      return { coaDebit: '1-1020', coaCredit: '4-1020', direction, costCenter: mapCostCenter(erpCategory), accountingClass: accClass, usedFallback: true, coaStatus: 'PENDING', status: 'NEED_REVIEW' };
    }
    drCode = fb.drCode; crCode = fb.crCode;
  }

  return {
    coaDebit: drCode, coaCredit: crCode, direction,
    costCenter: mapCostCenter(erpCategory),
    accountingClass: normResolved,
    usedFallback,
    coaStatus: usedFallback ? 'MISSING' : 'VALID',
    status: 'READY',
  };
}

// ─── copyBatchToNormalized — FASE 5: Normalization layer (AKTIF) ─────────────
// RAW IMPORT → NORMALIZATION → bank_mutation_normalized_entries → JOURNAL POSTING
async function copyBatchToNormalized(
  batchId:   number,
  companyId: number | null,
  version:   number = 1,
): Promise<void> {
  try {
    const { rows: importRows } = await db.execute(sql.raw(`
      SELECT * FROM bank_mutation_imports
      WHERE import_batch_id = ${batchId}
        AND status NOT IN ('REJECTED')
    `));
    if (!importRows.length) return;

    const esc = (v: unknown): string =>
      v !== null && v !== undefined && String(v) !== ''
        ? `'${String(v).replace(/'/g, "''")}'`
        : 'NULL';

    for (const row of importRows as any[]) {
      const uniqueKey = row.unique_key ? String(row.unique_key) : null;

      // Idempoten: skip jika sudah ada entry aktif (bukan SUPERSEDED) untuk versi ini
      if (uniqueKey) {
        const { rows: ex } = await db.execute(sql.raw(
          `SELECT id FROM bank_mutation_normalized_entries
           WHERE unique_key = '${uniqueKey.replace(/'/g, "''")}'
             AND status != 'SUPERSEDED' AND version = ${version} LIMIT 1`
        ));
        if (ex.length) continue;
      } else {
        const { rows: ex } = await db.execute(sql.raw(
          `SELECT id FROM bank_mutation_normalized_entries
           WHERE batch_id = ${batchId} AND row_id = ${row.id}
             AND status != 'SUPERSEDED' AND version = ${version} LIMIT 1`
        ));
        if (ex.length) continue;
      }

      // Deteksi duplikat lintas batch (entry aktif di batch lain)
      let isDuplicate = false;
      if (uniqueKey) {
        const { rows: dupCheck } = await db.execute(sql.raw(
          `SELECT id FROM bank_mutation_normalized_entries
           WHERE unique_key = '${uniqueKey.replace(/'/g, "''")}'
             AND batch_id != ${batchId}
             AND status NOT IN ('SUPERSEDED','DUPLICATE') LIMIT 1`
        ));
        isDuplicate = dupCheck.length > 0;
      }

      // ── FASE 3: Bank fee override untuk baris existing ─────────────────────
      // Jika description mengandung keyword fee tapi erp_category belum 'BANK_FEE',
      // override di sini agar normalization konsisten dengan aturan di /save.
      let effectiveErpCategory  = row.erp_category  ?? null;
      let effectiveAccClass     = row.accounting_class ?? null;

      // ── PRIORITY RULE: RENTAL_CAR_EXPENSE + External Company → INTERCOMPANY/PREPAID ──
      const srcAccNorm = row.source_account ? String(row.source_account).toLowerCase() : '';
      if ((effectiveErpCategory ?? '').toUpperCase().includes('RENTAL_CAR_EXPENSE')
          && srcAccNorm.includes('external company')) {
        effectiveErpCategory = 'INTERCOMPANY_SETTLEMENT';
        effectiveAccClass    = 'LIABILITY_SETTLEMENT';
      }

      // ── PRIORITY 1: Balance Sheet ERP_CATEGORY override ────────────────────────
      // Terapkan kembali rule BS saat normalization, override nilai lama jika ada
      if (effectiveErpCategory) {
        const bsClass = ERP_BALANCE_SHEET_RULES[effectiveErpCategory.trim().toUpperCase()];
        if (bsClass) effectiveAccClass = bsClass;
      }

      const descForFee = row.description ? String(row.description) : null;
      if (isBankFee(descForFee) && Number(row.debit || 0) > 0 && Number(row.credit || 0) === 0) {
        effectiveErpCategory = 'BANK_FEE';
        effectiveAccClass    = 'EXPENSE';
        // Sync kembali ke bank_mutation_imports agar konsisten
        await db.execute(sql.raw(
          `UPDATE bank_mutation_imports
           SET erp_category = 'BANK_FEE', accounting_class = 'EXPENSE'
           WHERE id = ${row.id}
             AND status NOT IN ('IMPORTED','REJECTED')
             AND (erp_category IS NULL OR erp_category != 'BANK_FEE')`
        )).catch(() => {});
      }

      const norm = await normalizeBankMutationRow({
        erpCategory:     effectiveErpCategory,
        accountingClass: effectiveAccClass,
        credit:          Number(row.credit || 0),
        debit:           Number(row.debit  || 0),
        bankAccountId:   row.bank_account_id ?? null,
        sourceAccount:   row.source_account ?? null,
        taxType:         row.tax_type ?? null,
        companyId,
      });

      // §3 COA Drift Detection: cek apakah unique_key sama punya COA berbeda di batch lain
      let coaDrift = false;
      if (uniqueKey && !isDuplicate) {
        const ukSafe = uniqueKey.replace(/'/g, "''");
        const { rows: driftRows } = await db.execute(sql.raw(
          `SELECT id FROM bank_mutation_normalized_entries
           WHERE unique_key = '${ukSafe}'
             AND batch_id != ${batchId}
             AND status NOT IN ('SUPERSEDED')
             AND (coa_debit != '${norm.coaDebit.replace(/'/g, "''")}' OR coa_credit != '${norm.coaCredit.replace(/'/g, "''")}')
           LIMIT 1`
        ));
        if (driftRows.length) {
          coaDrift = true;
          // Tandai entry lama sebagai drift juga
          await db.execute(sql.raw(
            `UPDATE bank_mutation_normalized_entries
             SET coa_drift = TRUE, status = 'NEED_REVIEW', updated_at = NOW()
             WHERE unique_key = '${ukSafe}'
               AND batch_id != ${batchId}
               AND status NOT IN ('SUPERSEDED','POSTED','MATCHED')`
          ));
          logger.warn({ batchId, uniqueKey, newDr: norm.coaDebit, newCr: norm.coaCredit },
            'bank-mutation-import: COA drift detected');
          emitFinancialEvent({
            event_type: 'COA_DRIFT_DETECTED',
            source_type: 'normalized_entry',
            entity_type: 'normalized_entry',
            entity_id: `${batchId}:${uniqueKey}`,
            payload: { batch_id: batchId, unique_key: uniqueKey, new_coa_debit: norm.coaDebit, new_coa_credit: norm.coaCredit },
            company_id: companyId ?? null,
          });
        }
      }

      const credit = Number(row.credit || 0);
      const debit  = Number(row.debit  || 0);
      const amount = credit > 0 ? credit : debit;
      const txDate = row.transaction_date
        ? `'${new Date(row.transaction_date).toISOString().split('T')[0]}'`
        : 'NULL';

      // §1 FASE 1/8: NEED_COA_MAPPING diprioritaskan, lalu consistency null/blank → NEED_REVIEW
      const finalStatus = isDuplicate ? 'DUPLICATE'
        : norm.status === 'NEED_COA_MAPPING' ? 'NEED_COA_MAPPING'
        : coaDrift ? 'NEED_REVIEW'
        : (!norm.coaDebit || !norm.coaCredit) ? 'NEED_REVIEW'
        : norm.status;

      // §FASE 2: propagate company per row dari bank_mutation_imports
      const rowRevCompany  = row.revenue_company_id  ?? null;
      const rowColCompany  = row.collecting_company_id ?? null;
      const rowCompanyId   = row.company_id ?? companyId ?? null;

      const rowPlFlag = row.pl_flag ? String(row.pl_flag).toUpperCase().trim() : null;
      const rowIsBS   = rowPlFlag === 'BALANCE_SHEET';
      const { rows: insertedNe } = await db.execute(sql.raw(`
        INSERT INTO bank_mutation_normalized_entries
          (batch_id, row_id, transaction_date, description, amount, direction,
           erp_category, accounting_class, company_id, branch_id, division_id, department_id,
           cost_center_id, business_unit_id, coa_debit, coa_credit, unique_key,
           status, used_fallback_coa, coa_drift, version,
           revenue_company_id, collecting_company_id, coa_status, subledger_status,
           is_latest_version, pl_flag, is_balance_sheet,
           created_at, updated_at)
        VALUES (
          ${batchId}, ${row.id}, ${txDate}, ${esc(row.description)},
          ${amount || 0}, '${norm.direction}',
          ${esc(row.erp_category)}, ${esc(norm.accountingClass)},
          ${rowCompanyId ?? 'NULL'}, ${row.branch_id ?? 'NULL'}, ${row.division_id ?? 'NULL'},
          ${row.department_id ?? 'NULL'}, ${esc(norm.costCenter)}, ${esc(row.business_unit)},
          ${esc(norm.coaDebit)}, ${esc(norm.coaCredit)},
          ${uniqueKey ? esc(uniqueKey) : 'NULL'},
          '${finalStatus}', ${norm.usedFallback}, ${coaDrift}, ${version},
          ${rowRevCompany ?? 'NULL'}, ${rowColCompany ?? 'NULL'},
          '${norm.coaStatus ?? 'PENDING'}', 'MISSING',
          TRUE, ${rowPlFlag ? esc(rowPlFlag) : 'NULL'}, ${rowIsBS},
          NOW(), NOW()
        )
        RETURNING id
      `));

      // §FASE 1/8: Update coa_status dan status di bank_mutation_imports
      await db.execute(sql.raw(`
        UPDATE bank_mutation_imports
        SET coa_status = '${norm.coaStatus ?? 'PENDING'}'
          ${finalStatus === 'NEED_COA_MAPPING' ? `, status = 'NEED_COA_MAPPING'` : ''}
        WHERE id = ${row.id} AND status NOT IN ('IMPORTED','REJECTED')
      `)).catch(() => {});

      const neId = (insertedNe[0] as any)?.id;
      if (neId) {
        emitFinancialEvent({
          event_type: 'NORMALIZED_ENTRY_CREATED',
          source_type: 'normalized_entry',
          entity_type: 'normalized_entry',
          entity_id: neId,
          payload: {
            batch_id: batchId, erp_category: row.erp_category, direction: norm.direction,
            coa_debit: norm.coaDebit, coa_credit: norm.coaCredit,
            amount: amount || 0, status: finalStatus, version, coa_drift: coaDrift,
          },
          company_id: companyId ?? null,
          cost_center_id: norm.costCenter ?? null,
        });
      }
    }
    logger.info({ batchId, count: importRows.length, version }, 'bank-mutation-import: copyBatchToNormalized done');
  } catch (e: any) {
    logger.warn({ err: e, batchId }, 'bank-mutation-import: copyBatchToNormalized failed (non-fatal)');
  }
}

// ─── postBatchFromNormalized — posting jurnal dari normalized_entries ──────────
// §2 LOCK — posting engine hanya MEMBACA coa_debit/coa_credit dari tabel.
// DILARANG melakukan re-kalkulasi COA di sini.
// Sumber kebenaran tunggal: normalizeBankMutationRow() via copyBatchToNormalized().
// §6 LOCK — function ini hanya menulis ke accounting_entries (bukan normalized table sebagai laporan).
async function postBatchFromNormalized(
  batchId:    number,
  batch:      any,
  actor:      string,
  onProgress?: (posted: number, failed: number, total: number) => void,
): Promise<{
  posted: number; matched: number; failed: number; skipped: number;
  errors: { id: number; reason: string }[];
  total: number;
}> {
  const companyId: number = batch.company_id;
  const importMode: string = batch.import_mode ?? 'HISTORICAL_IMPORT';

  // ── MULTI-COMPANY BALANCE SHEET HANDLER — Pre-processing ──────────────────
  // Step A: Promote NEED_REVIEW entries dengan pl_flag=BALANCE_SHEET ke READY.
  // Covers: REVENUE_*, EXPENSE_*, *_EXPENSE (e.g. RENTAL_CAR_EXPENSE),
  //         ASSET-class entries (RENTAL_CAR_EXPENSE, PREPAID_RENT, SECURITY_DEPOSIT),
  //         dan LIABILITY_SETTLEMENT entries dari ERP_BALANCE_SHEET_RULES.
  // Bank mutation tidak butuh subledger link → exempt dari subledger requirement.
  if (importMode === 'HISTORICAL_IMPORT') {
    const { rows: bsNeedReview } = await db.execute(sql.raw(`
      SELECT id, erp_category, pl_flag
      FROM bank_mutation_normalized_entries
      WHERE batch_id = ${batchId}
        AND status = 'NEED_REVIEW'
        AND UPPER(COALESCE(pl_flag,'')) = 'BALANCE_SHEET'
        AND (
          erp_category ILIKE 'REVENUE_%'
          OR erp_category ILIKE 'EXPENSE_%'
          OR erp_category ILIKE '%_EXPENSE'
          OR UPPER(erp_category) IN ('RENTAL_CAR_EXPENSE','PREPAID_RENT','SECURITY_DEPOSIT','INTERCOMPANY_SETTLEMENT')
          OR accounting_class IN ('ASSET','LIABILITY_SETTLEMENT')
        )
        AND coa_debit  IS NOT NULL AND coa_debit  != ''
        AND coa_credit IS NOT NULL AND coa_credit != ''
        AND (amount IS NOT NULL AND amount > 0)
    `));
    if ((bsNeedReview as any[]).length > 0) {
      for (const bsRow of bsNeedReview as any[]) {
        await db.execute(sql.raw(`
          UPDATE bank_mutation_normalized_entries
          SET status = 'READY', subledger_status = 'EXEMPT', updated_at = NOW()
          WHERE id = ${bsRow.id}
        `));
      }
      logger.info({ batchId, promoted: (bsNeedReview as any[]).length },
        '[BS-HANDLER] BALANCE_SHEET NEED_REVIEW → READY (subledger_status=EXEMPT, no subledger required)');
    }

    // Step B: INTERNAL_TRANSFER multi-company Diva → promote ke READY.
    // Syarat: punya revenue_company_id ATAU collecting_company_id (multi-company Diva),
    // baik yang sudah dipasangkan (transaction_pair_id IS NOT NULL) maupun
    // yang inter-batch / single-side (transaction_pair_id IS NULL tapi Diva teridentifikasi).
    const { rows: icTransferNeedReview } = await db.execute(sql.raw(`
      SELECT id
      FROM bank_mutation_normalized_entries
      WHERE batch_id = ${batchId}
        AND status = 'NEED_REVIEW'
        AND accounting_class IN ('TRANSFER', 'INTERNAL_TRANSFER')
        AND (revenue_company_id IS NOT NULL OR collecting_company_id IS NOT NULL)
        AND coa_debit  IS NOT NULL AND coa_debit  != ''
        AND coa_credit IS NOT NULL AND coa_credit != ''
    `));
    if ((icTransferNeedReview as any[]).length > 0) {
      for (const icRow of icTransferNeedReview as any[]) {
        await db.execute(sql.raw(`
          UPDATE bank_mutation_normalized_entries
          SET status = 'READY', updated_at = NOW()
          WHERE id = ${icRow.id}
        `));
      }
      logger.info({ batchId, promoted: (icTransferNeedReview as any[]).length },
        '[BS-HANDLER] INTERNAL_TRANSFER multi-company Diva → READY (paired or inter-batch)');
    }

    // Step C: Multi-company non-transfer NEED_REVIEW → promote ke READY.
    // Baris dari perusahaan berbeda (company_id != batch.company_id) dengan COA valid
    // dan amount > 0 bisa diposting langsung menggunakan company_id per-baris.
    // Ini mencakup CST→DIVA cross-company entries yang bukan INTERNAL_TRANSFER.
    const { rows: mcNeedReview } = await db.execute(sql.raw(`
      SELECT id
      FROM bank_mutation_normalized_entries
      WHERE batch_id = ${batchId}
        AND status = 'NEED_REVIEW'
        AND accounting_class NOT IN ('TRANSFER', 'INTERNAL_TRANSFER')
        AND company_id IS NOT NULL
        AND company_id != ${companyId}
        AND coa_debit  IS NOT NULL AND coa_debit  != ''
        AND coa_credit IS NOT NULL AND coa_credit != ''
        AND (amount IS NOT NULL AND amount > 0)
    `));
    if ((mcNeedReview as any[]).length > 0) {
      for (const mcRow of mcNeedReview as any[]) {
        await db.execute(sql.raw(`
          UPDATE bank_mutation_normalized_entries
          SET status = 'READY', subledger_status = 'EXEMPT', updated_at = NOW()
          WHERE id = ${mcRow.id}
        `));
      }
      logger.info({ batchId, promoted: (mcNeedReview as any[]).length, batchCompanyId: companyId },
        '[BS-HANDLER] Multi-company non-transfer NEED_REVIEW → READY (per-row company_id akan dipakai saat posting)');
    }
  }

  const { rows: readyRows } = await db.execute(sql.raw(`
    SELECT * FROM bank_mutation_normalized_entries
    WHERE batch_id = ${batchId}
      AND status = 'READY'
    ORDER BY transaction_date ASC, id ASC
  `));

  if (!readyRows.length) return { posted: 0, matched: 0, failed: 0, skipped: 0, errors: [], total: 0 };

  // ── FASE 9: Pre-post consistency check ────────────────────────────────────
  // Blokir posting jika ada pelanggaran konsistensi kritis di batch ini.
  const consistencyErrors: string[] = [];

  // 9a. TRANSFER tanpa pasangan (transaction_pair_id IS NULL) → flag NEED_REVIEW, jangan blok
  // (inter-batch transfer boleh terjadi; hanya log warning)
  const transferUnpaired = (readyRows as any[]).filter(
    ne => (ne.accounting_class === 'TRANSFER' || ne.accounting_class === 'INTERNAL_TRANSFER')
       && !ne.transaction_pair_id
  );
  if (transferUnpaired.length > 0) {
    // Tidak blokir — hanya flag sebagai NEED_REVIEW agar reviewer bisa konfirmasi
    for (const ne of transferUnpaired) {
      await db.execute(sql.raw(
        `UPDATE bank_mutation_normalized_entries
         SET status = 'NEED_REVIEW', updated_at = NOW()
         WHERE id = ${ne.id}`
      )).catch(() => {});
      logger.warn({ batchId, normalizedId: ne.id },
        'FASE 5: TRANSFER tanpa pasangan → NEED_REVIEW (tidak diblokir)');
    }
  }

  // 9b. INCOME/EXPENSE tanpa COA valid → ini sudah diblokir di normalization (NEED_COA_MAPPING)
  // Tapi sebagai double-guard, skip baris yang coa_debit/coa_credit kosong
  const missingCoa = (readyRows as any[]).filter(
    ne => !ne.coa_debit || !ne.coa_credit
  );
  if (missingCoa.length > 0) {
    consistencyErrors.push(`${missingCoa.length} baris READY memiliki coa_debit/coa_credit kosong — normalisasi ulang diperlukan`);
  }

  if (consistencyErrors.length > 0) {
    logger.error({ batchId, consistencyErrors }, 'FASE 9: Consistency check gagal — posting diblokir');
    return {
      posted: 0, matched: 0, failed: consistencyErrors.length, skipped: 0,
      errors: [{ id: 0, reason: `CONSISTENCY_BLOCK: ${consistencyErrors.join('; ')}` }],
      total: readyRows.length,
    };
  }

  // Re-fetch readyRows setelah flag transfer unpaired (beberapa mungkin sudah jadi NEED_REVIEW)
  const { rows: filteredReadyRows } = await db.execute(sql.raw(`
    SELECT * FROM bank_mutation_normalized_entries
    WHERE batch_id = ${batchId}
      AND status = 'READY'
    ORDER BY transaction_date ASC, id ASC
  `));
  const effectiveReadyRows = filteredReadyRows;

  // Validasi jurnal untuk batch company — per-row akan di-resolve terpisah jika company beda
  const batchJournalId = await resolveBankJournalId(companyId);
  if (!batchJournalId) return { posted: 0, matched: 0, failed: 0, skipped: 0, errors: [{ id: 0, reason: 'Jurnal bank tidak ditemukan untuk perusahaan batch' }], total: effectiveReadyRows.length };

  const { postEntry } = await import("../lib/accounting.js");
  const coaIdCache     = new Map<string, number | null>();
  const journalIdCache = new Map<number, number | null>();

  async function cachedCoaId(code: string, effCompanyId?: number | null) {
    const key = `${code}|${effCompanyId ?? companyId}`;
    if (coaIdCache.has(key)) return coaIdCache.get(key)!;
    const v = await resolveCoaId(code, effCompanyId ?? companyId);
    coaIdCache.set(key, v);
    return v;
  }

  async function cachedJournalId(effCompanyId: number): Promise<number | null> {
    if (journalIdCache.has(effCompanyId)) return journalIdCache.get(effCompanyId)!;
    const v = await resolveBankJournalId(effCompanyId);
    journalIdCache.set(effCompanyId, v);
    return v;
  }

  let posted  = 0;
  let matched = 0;
  let failed  = 0;
  const errors: { id: number; reason: string }[] = [];

  for (const ne of effectiveReadyRows as any[]) {
    try {
      // ⚡ RECONCILIATION_ONLY — menggunakan Unified Matching Engine (bukan findMatchingTransaction lama)
      if (importMode === 'RECONCILIATION_ONLY') {
        const _amount = Number(ne.credit || ne.amount || 0) > 0
          ? Number(ne.credit || ne.amount || 0)
          : Number(ne.debit || 0);
        const _txDate = ne.transaction_date
          ? new Date(ne.transaction_date).toISOString().split('T')[0]!
          : new Date().toISOString().split('T')[0]!;
        const _dir: 'IN' | 'OUT' = Number(ne.credit || 0) > 0 ? 'IN' : 'OUT';
        const _mk = ne.unique_key ?? `${_txDate.replace(/-/g, '')}_${Math.round(_amount)}_${_dir}`;
        const _descSafe = String(ne.description ?? '').replace(/'/g, "''");
        const _normDesc = _descSafe.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
        const _effCoId: number = (ne.company_id ?? companyId) as number;

        // Sync ke bank_mutations
        let _mutId: number | null = null;
        try {
          const { rows: _ex } = await db.execute(sql.raw(
            `SELECT id FROM bank_mutations WHERE mutation_key = '${_mk.replace(/'/g, "''")}' LIMIT 1`
          ));
          if (_ex.length) {
            _mutId = Number((_ex[0] as any).id);
          } else {
            const { rows: _ins } = await db.execute(sql.raw(`
              INSERT INTO bank_mutations
                (transaction_date, description, credit_amount, debit_amount, amount, direction,
                 mutation_key, normalized_description, company_id, import_batch_id, import_row_id, source, status)
              VALUES (
                '${_txDate}', '${_descSafe.slice(0, 500)}',
                ${Number(ne.credit || 0)}, ${Number(ne.debit || 0)},
                ${_amount}, '${_dir}',
                '${_mk.replace(/'/g, "''")}',
                '${_normDesc.replace(/'/g, "''").slice(0, 500)}',
                ${_effCoId ?? 'NULL'}, ${batchId}, ${ne.id}, 'bank_import', 'unmatched'
              )
              RETURNING id
            `)).catch(() => ({ rows: [] }));
            _mutId = Number((_ins[0] as any)?.id ?? null) || null;
          }
        } catch (_e: any) {
          logger.warn({ err: _e.message, rowId: ne.id }, 'RECONCILIATION_ONLY: gagal sync ke bank_mutations');
        }

        if (_mutId) {
          const { runUnifiedMatching } = await import('../lib/reconciliation/unifiedMatchingEngine.js');
          const _result = await runUnifiedMatching({
            id: _mutId, amount: _amount, transaction_date: _txDate,
            mutation_key: _mk, company_id: _effCoId ?? null,
            provider_name: null,
            direction: _dir,
          }, actor).catch(() => ({ status: 'unmatched' as const, all: [] }));

          const _matched = _result.status === 'auto_matched' || _result.status === 'manual_review';
          const _cand = (_result as any).best?.candidate;

          await db.execute(sql.raw(`
            UPDATE bank_mutation_normalized_entries
            SET status = '${_matched ? 'MATCHED' : 'NEED_REVIEW'}',
                linked_transaction_type = ${_cand?.type ? `'${_cand.type}'` : 'NULL'},
                linked_transaction_id   = ${_cand?.id ?? 'NULL'},
                updated_at = NOW()
            WHERE id = ${ne.id}
          `)).catch(() => {});

          if (ne.row_id && _matched) {
            await db.execute(sql.raw(`
              UPDATE bank_mutation_imports
              SET status = 'IMPORTED', reconciliation_status = 'MATCHED',
                  linked_transaction_type = ${_cand?.type ? `'${_cand.type}'` : 'NULL'},
                  linked_transaction_id   = ${_cand?.id ?? 'NULL'}
              WHERE id = ${ne.row_id} AND status NOT IN ('IMPORTED','REJECTED')
            `)).catch(() => {});
          }
          if (_matched) { matched++; posted++; }
        } else {
          await db.execute(sql.raw(
            `UPDATE bank_mutation_normalized_entries SET status = 'NEED_REVIEW', updated_at = NOW() WHERE id = ${ne.id}`
          )).catch(() => {});
        }
        if (onProgress && (posted + failed) % 10 === 0) onProgress(posted, failed, readyRows.length);
        continue;
      }

      // ⚠️ RECONCILIATION GATE — Direct journal creation dari import DINONAKTIFKAN.
      // Semua mutasi bank harus melalui: import → matching → approval → jurnal.
      // Jurnal HANYA dibuat di /api/bank-reconciliation/:id/approve (approveAndCreateJournal).
      if (importMode === 'HISTORICAL_IMPORT' || importMode === 'BANK_RECONCILIATION' || true) {
        const _gAmount = Number(ne.amount || ne.credit || ne.debit || 0);
        if (_gAmount <= 0) {
          failed++; errors.push({ id: ne.id, reason: 'Jumlah nol atau negatif' }); continue;
        }
        const _gCoId: number = (ne.company_id ?? companyId) as number;
        const _gDate = ne.transaction_date
          ? new Date(ne.transaction_date).toISOString().split('T')[0]!
          : new Date().toISOString().split('T')[0]!;
        const _gDir: 'IN' | 'OUT' = Number(ne.credit || 0) > 0 ? 'IN' : 'OUT';
        const _gMk = ne.unique_key ?? `${_gDate.replace(/-/g, '')}_${Math.round(_gAmount)}_${_gDir}`;
        const _gDesc = String(ne.description ?? '').replace(/'/g, "''");
        const _gNorm = _gDesc.toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

        await db.execute(sql.raw(`
          INSERT INTO bank_mutations
            (transaction_date, description, credit_amount, debit_amount, amount, direction,
             mutation_key, normalized_description, company_id, import_batch_id, import_row_id, source, status)
          VALUES (
            '${_gDate}', '${_gDesc.slice(0, 500)}',
            ${Number(ne.credit || 0)}, ${Number(ne.debit || 0)},
            ${_gAmount}, '${_gDir}',
            '${_gMk.replace(/'/g, "''")}',
            '${_gNorm.replace(/'/g, "''").slice(0, 500)}',
            ${_gCoId ?? 'NULL'}, ${batchId}, ${ne.id}, 'bank_import', 'unmatched'
          )
          ON CONFLICT DO NOTHING
        `)).catch(() => {});

        await db.execute(sql.raw(
          `UPDATE bank_mutation_normalized_entries SET status = 'NEED_REVIEW', updated_at = NOW() WHERE id = ${ne.id}`
        )).catch(() => {});

        if (ne.row_id) {
          await db.execute(sql.raw(`
            UPDATE bank_mutation_imports
            SET status = 'IMPORTED', reconciliation_status = 'PENDING_RECONCILIATION'
            WHERE id = ${ne.row_id} AND status NOT IN ('IMPORTED','REJECTED')
          `)).catch(() => {});
        }
        posted++;
        if (onProgress && (posted + failed) % 10 === 0) onProgress(posted, failed, readyRows.length);
        continue;
      }
      const amount = Number(ne.amount || 0);
      if (amount <= 0) { failed++; errors.push({ id: ne.id, reason: 'Jumlah nol atau negatif' }); continue; }

      // ── Per-row effective company & journal ─────────────────────────────────
      // Baris dari perusahaan berbeda (multi-company) harus pakai company & journal sendiri
      const effCompanyId: number = (ne.company_id ?? companyId) as number;
      const effJournalId: number | null = effCompanyId !== companyId
        ? await cachedJournalId(effCompanyId)
        : batchJournalId;
      if (!effJournalId) {
        failed++;
        errors.push({ id: ne.id, reason: `Jurnal bank tidak ditemukan untuk company ${effCompanyId}` });
        continue;
      }

      // FAIL-CLOSED (Task #6): COA harus sudah dipetakan secara spesifik pada baris
      // normalisasi. Tidak ada fallback ke akun generik (1-1020, 4-1020, dsb).
      if (!ne.coa_debit || !ne.coa_credit) {
        await db.execute(sql.raw(
          `UPDATE bank_mutation_normalized_entries
           SET status = 'NEED_REVIEW', coa_status = 'MISSING', updated_at = NOW()
           WHERE id = ${ne.id}`
        )).catch(() => {});
        if (ne.row_id) {
          await db.execute(sql.raw(
            `UPDATE bank_mutation_imports
             SET status = 'NEED_COA_MAPPING', coa_status = 'MISSING'
             WHERE id = ${ne.row_id} AND status NOT IN ('IMPORTED','REJECTED')`
          )).catch(() => {});
        }
        failed++;
        errors.push({ id: ne.id, reason: `[FAIL-CLOSED] COA belum dipetakan (dr=${ne.coa_debit ?? 'null'}, cr=${ne.coa_credit ?? 'null'}) — tidak ada fallback ke akun generik` });
        continue;
      }

      const drCode = String(ne.coa_debit);
      const crCode = String(ne.coa_credit);

      const drAccId = await cachedCoaId(drCode, effCompanyId);
      const crAccId = await cachedCoaId(crCode, effCompanyId);

      if (!drAccId || !crAccId) {
        // Tandai di imports & normalized agar reviewer tahu COA apa yang hilang
        await db.execute(sql.raw(
          `UPDATE bank_mutation_normalized_entries
           SET status = 'NEED_REVIEW', coa_status = 'MISSING', updated_at = NOW()
           WHERE id = ${ne.id}`
        )).catch(() => {});
        if (ne.row_id) {
          await db.execute(sql.raw(
            `UPDATE bank_mutation_imports
             SET status = 'NEED_COA_MAPPING', coa_status = 'MISSING'
             WHERE id = ${ne.row_id} AND status NOT IN ('IMPORTED','REJECTED')`
          )).catch(() => {});
        }
        failed++;
        errors.push({ id: ne.id, reason: `CoA tidak ditemukan: dr=${drCode}, cr=${crCode} (company=${effCompanyId})` });
        continue;
      }

      // Anti-double guard via unique_key
      if (ne.unique_key) {
        const ukSafe = String(ne.unique_key).replace(/'/g, "''");
        const { rows: dup } = await db.execute(sql.raw(`
          SELECT id FROM bank_mutation_normalized_entries
          WHERE unique_key = '${ukSafe}' AND journal_entry_id IS NOT NULL AND id != ${ne.id} LIMIT 1
        `));
        if (dup.length) {
          await db.execute(sql.raw(
            `UPDATE bank_mutation_normalized_entries SET status = 'DUPLICATE', updated_at = NOW() WHERE id = ${ne.id}`
          ));
          errors.push({ id: ne.id, reason: `Dilewati: unique_key sudah diposting (normalized id: ${(dup[0] as any).id})` });
          emitFinancialEvent({
            event_type: 'ENTRY_SKIPPED',
            source_type: 'normalized_entry',
            entity_type: 'normalized_entry',
            entity_id: ne.id,
            payload: { reason: 'DUPLICATE', batch_id: batchId, unique_key: ne.unique_key },
            company_id: effCompanyId ?? null,
          });
          continue;
        }
      }

      // ── SAP HARDENING FASE 4: Pre-post validation gate ─────────────────────
      {
        const gateResult = await validateBeforePost({
          companyId: effCompanyId,
          journalId: effJournalId ?? 0,
          date: ne.transaction_date ?? new Date().toISOString().split('T')[0]!,
          lines: [
            { accountId: drAccId!, debit: amount, credit: 0 },
            { accountId: crAccId!, debit: 0, credit: amount },
          ],
          normalizedEntryId: ne.id,
          transactionPairId: ne.transaction_pair_id ?? null,
          source: 'bank_mutation_normalized',
        });
        if (!gateResult.valid) {
          await db.execute(sql.raw(
            `UPDATE bank_mutation_normalized_entries SET status = 'NEED_REVIEW', updated_at = NOW() WHERE id = ${ne.id}`
          )).catch(() => {});
          failed++;
          errors.push({
            id: ne.id,
            reason: `PRE_POST_GATE: ${gateResult.errors.map((e: any) => e.code).join(', ')}`,
          });
          logger.warn({ batchId, normalizedId: ne.id, effCompanyId, errors: gateResult.errors },
            '[postBatchFromNormalized] FASE 4: pre-post gate blokir entry → NEED_REVIEW');
          onProgress?.(posted, failed, readyRows.length);
          continue;
        }
      }

      const txDate    = ne.transaction_date ? new Date(ne.transaction_date) : new Date();
      const txDateStr = txDate.toISOString().split('T')[0]!;
      // Gunakan is_balance_sheet dari normalized entry (di-set saat copyBatchToNormalized)
      const isBalanceSheet = ne.is_balance_sheet === true
        || String(ne.pl_flag ?? '').toUpperCase() === 'BALANCE_SHEET';

      let entryId: number;

      if (isBalanceSheet) {
        // ── MULTI-COMPANY BALANCE SHEET PATH — via safeAccountingPost() ──────
        // Revenue/Expense bank mutation tanpa subledger: GL posting penuh dengan audit trail.
        const safeResult = await safeAccountingPost({
          companyId:   effCompanyId,
          journalId:   effJournalId ?? 0,
          date:        txDateStr,
          lines: [
            { accountId: drAccId!, debit: amount, credit: 0 },
            { accountId: crAccId!, debit: 0,      credit: amount },
          ],
          normalizedEntryId:  ne.id,
          transactionPairId:  ne.transaction_pair_id ?? null,
          source:             'bank_mutation_bs_handler',
          actor,
          actorType:          'ADMIN',
          description:        ne.description ?? null,
          postFn: () => postEntry(
            {
              journalId:   effJournalId ?? 0,
              date:        txDate,
              description: ne.description ?? null,
              ref:         ne.unique_key ?? null,
              source:      'bank_mutation_normalized' as any,
              sourceId:    ne.id,
              companyId:   effCompanyId,
              lines: [
                { accountId: drAccId!, debit: amount, credit: 0,      description: ne.description ?? null },
                { accountId: crAccId!, debit: 0,      credit: amount, description: ne.description ?? null },
              ],
            },
            'BNK',
          ).then(e => e.id),
        });

        if (!safeResult.ok || !safeResult.journalEntryId) {
          failed++;
          const reason = safeResult.errors?.map(e => e.code).join(', ') ?? 'safeAccountingPost gagal';
          errors.push({ id: ne.id, reason: `BS_HANDLER: ${reason}` });
          logger.warn({ batchId, normalizedId: ne.id, effCompanyId, errors: safeResult.errors, blocked: safeResult.blocked },
            '[BS-HANDLER] safeAccountingPost gagal → baris dilewati');
          await queueIntegrityError({
            errorCode:      'BS_POST_FAILED',
            module:         'bank_mutation_bs_handler',
            entityType:     'normalized_entry',
            entityId:       String(ne.id),
            companyId:      effCompanyId,
            message:        `BS posting failed: ${reason}`,
            classification: 'HIGH',
          }).catch(() => {});
          onProgress?.(posted, failed, readyRows.length);
          continue;
        }

        entryId = safeResult.journalEntryId!;

        // Update normalized entry: correlation_id, version bump, status POSTED, subledger_status EXEMPT
        await db.execute(sql.raw(`
          UPDATE bank_mutation_normalized_entries
          SET journal_entry_id       = ${entryId},
              status                 = 'POSTED',
              correlation_id         = '${safeResult.correlationId.replace(/'/g, "''")}',
              version                = COALESCE(version, 1) + 1,
              subledger_status       = 'EXEMPT',
              is_balance_sheet       = TRUE,
              integrity_audit_queued = TRUE,
              updated_at             = NOW()
          WHERE id = ${ne.id}
        `));

        await queueIntegrityError({
          errorCode:      'BS_POST_OK',
          module:         'bank_mutation_bs_handler',
          entityType:     'normalized_entry',
          entityId:       String(ne.id),
          companyId:      effCompanyId,
          message:        `BS posted OK — correlationId=${safeResult.correlationId}, journalEntryId=${entryId}, erp_category=${ne.erp_category ?? ''}, pl_flag=BALANCE_SHEET, company=${effCompanyId}`,
          classification: 'LOW',
        }).catch(() => {});

        logger.info({
          batchId, normalizedId: ne.id, entryId, effCompanyId,
          correlationId: safeResult.correlationId,
          erp_category: ne.erp_category,
          revenue_company_id:   ne.revenue_company_id,
          collecting_company_id: ne.collecting_company_id,
        }, '[BS-HANDLER] BALANCE_SHEET entry posted via safeAccountingPost');

      } else {
        // ── STANDARD PATH — postEntry() langsung ─────────────────────────────
        const entry = await postEntry(
          {
            journalId:   effJournalId ?? 0,
            date:        txDate,
            description: ne.description ?? null,
            ref:         ne.unique_key ?? null,
            source:      'bank_mutation_normalized' as any,
            sourceId:    ne.id,
            companyId:   effCompanyId,
            lines: [
              { accountId: drAccId!, debit: amount, credit: 0,      description: ne.description ?? null },
              { accountId: crAccId!, debit: 0,      credit: amount, description: ne.description ?? null },
            ],
          },
          'BNK',
        );
        entryId = entry.id;

        // Update normalized entry — termasuk version bump agar history terlacak
        await db.execute(sql.raw(`
          UPDATE bank_mutation_normalized_entries
          SET journal_entry_id = ${entryId},
              status           = 'POSTED',
              version          = COALESCE(version, 1) + 1,
              updated_at       = NOW()
          WHERE id = ${ne.id}
        `));
      }

      // Sync ke bank_mutation_imports (kedua path) — preserve is_balance_sheet flag
      if (ne.row_id) {
        await db.execute(sql.raw(`
          UPDATE bank_mutation_imports
          SET journal_entry_id  = ${entryId},
              status            = 'IMPORTED',
              import_mode       = 'HISTORICAL_IMPORT',
              used_fallback_coa = ${ne.used_fallback_coa ?? false},
              is_balance_sheet  = ${isBalanceSheet}
          WHERE id = ${ne.row_id}
        `));
      }

      await auditImportLog({
        batchId, rowId: ne.row_id ?? null,
        action: isBalanceSheet ? 'posted_bs_handler' : 'posted_from_normalized',
        actor,
        field: 'journal_entry_id', beforeVal: null, afterVal: String(entryId),
        meta: {
          normalized_entry_id: ne.id, coa_debit: drCode, coa_credit: crCode, amount,
          pl_flag: ne.pl_flag ?? null, is_balance_sheet: isBalanceSheet,
          eff_company_id: effCompanyId,
          revenue_company_id:    ne.revenue_company_id   ?? null,
          collecting_company_id: ne.collecting_company_id ?? null,
        },
      });

      emitFinancialEvent({
        event_type:  'ENTRY_POSTED',
        source_type: 'accounting_entry',
        entity_type: 'accounting_entry',
        entity_id:   entryId,
        payload: {
          batch_id: batchId, normalized_entry_id: ne.id,
          coa_debit: drCode, coa_credit: crCode, amount,
          erp_category: ne.erp_category,
          pl_flag: ne.pl_flag ?? null,
          is_balance_sheet: isBalanceSheet,
          eff_company_id: effCompanyId,
        },
        company_id:       effCompanyId ?? null,
        cost_center_id:   ne.cost_center_id ?? null,
        business_unit_id: ne.business_unit_id ?? null,
      });
      emitFinancialEvent({
        event_type:  'BANK_MUTATION_POSTED',
        source_type: 'bank_mutation',
        entity_type: 'normalized_entry',
        entity_id:   ne.id,
        payload: { journal_entry_id: entryId, batch_id: batchId, amount, erp_category: ne.erp_category },
        company_id:     companyId ?? null,
        cost_center_id: ne.cost_center_id ?? null,
      });

      posted++;
      if (posted % 10 === 0) onProgress?.(posted, failed, readyRows.length);
    } catch (e: any) {
      failed++;
      errors.push({ id: ne.id, reason: e?.message ?? 'Unknown error' });
      logger.error({ err: e, normalizedId: ne.id }, 'postBatchFromNormalized: row error');
    }
  }

  return { posted, matched, failed, skipped: 0, errors, total: effectiveReadyRows.length };
}

// ─── Multer setup ─────────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = (file.originalname ?? "").toLowerCase().split(".").pop();
    if (ext === "xlsx" || ext === "csv" || ext === "xls") {
      cb(null, true);
    } else {
      cb(new Error("Hanya file XLSX, XLS, atau CSV yang diizinkan"));
    }
  },
});

// ─── Column mapping helpers ────────────────────────────────────────────────────
const CANONICAL_COLUMNS = [
  "Date", "Description", "Debit", "Credit", "Balance",
  "ERP_CATEGORY", "ENTITY_TYPE", "ENTITY_NAME", "BUSINESS_UNIT",
  "COMPANY", "TAX_TYPE", "PAYMENT_METHOD", "SOURCE_ACCOUNT",
  "PL_FLAG", "ACCOUNTING_CLASS", "UNIQUE_KEY",
] as const;

const CANONICAL_ALIASES: Record<string, string> = {
  // Date
  date: "Date", tanggal: "Date", tgl: "Date", "transaction date": "Date",
  "transaction_date": "Date", "trans date": "Date",
  "tanggal transaksi": "Date", "date & time": "Date", "date time": "Date",
  "tgl transaksi": "Date", "waktu transaksi": "Date",
  // Description
  description: "Description", keterangan: "Description", uraian: "Description",
  "desc": "Description", narasi: "Description",
  deskripsi: "Description",
  // Debit
  debit: "Debit", db: "Debit", "debet": "Debit", "debit amount": "Debit",
  pengeluaran: "Debit",
  // Credit
  credit: "Credit", cr: "Credit", kredit: "Credit", "credit amount": "Credit",
  pemasukan: "Credit",
  // Balance
  balance: "Balance", saldo: "Balance", "saldo akhir": "Balance",
  "ending balance": "Balance",
  // ERP columns
  erp_category: "ERP_CATEGORY", "erp category": "ERP_CATEGORY",
  entity_type: "ENTITY_TYPE", "entity type": "ENTITY_TYPE",
  entity_name: "ENTITY_NAME", "entity name": "ENTITY_NAME",
  business_unit: "BUSINESS_UNIT", "business unit": "BUSINESS_UNIT", bu: "BUSINESS_UNIT",
  company: "COMPANY", perusahaan: "COMPANY",
  tax_type: "TAX_TYPE", "tax type": "TAX_TYPE", pajak: "TAX_TYPE",
  payment_method: "PAYMENT_METHOD", "payment method": "PAYMENT_METHOD",
  "metode pembayaran": "PAYMENT_METHOD",
  source_account: "SOURCE_ACCOUNT", "source account": "SOURCE_ACCOUNT",
  "rekening sumber": "SOURCE_ACCOUNT",
  pl_flag: "PL_FLAG", "pl flag": "PL_FLAG",
  accounting_class: "ACCOUNTING_CLASS", "accounting class": "ACCOUNTING_CLASS",
  unique_key: "UNIQUE_KEY", "unique key": "UNIQUE_KEY", "kunci unik": "UNIQUE_KEY",
};

/**
 * Normalize a column header for alias matching:
 * lowercase → trim → replace non-alphanumeric chars with space → collapse spaces
 */
function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pre-built lookup: normalizedAlias → canonical (built once at startup) */
const NORMALIZED_ALIAS_MAP: Record<string, string> = {};
for (const [alias, canonical] of Object.entries(CANONICAL_ALIASES)) {
  NORMALIZED_ALIAS_MAP[normalizeHeader(alias)] = canonical;
}

function autoMapHeaders(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  for (const h of headers) {
    if (!h || typeof h !== "string") continue; // guard sparse/undefined
    const normalized = normalizeHeader(h);
    const canonical = NORMALIZED_ALIAS_MAP[normalized];
    if (canonical) {
      mapping[h] = canonical;
    }
  }
  return mapping;
}

// ─── Sheet detection helpers ───────────────────────────────────────────────────

/** Sheet names yang harus diabaikan saat auto-detect (case-insensitive) */
const IGNORED_SHEET_NAMES = new Set([
  "SUMMARY_KOREKSI",
  "README_KOREKSI",
  "MASTER_COA",
  "MASTER_BUSINESS_UNIT",
  "MASTER_ENTITY",
  "MASTER_ENTITY_REVIEW",
]);

function isIgnoredSheet(name: string): boolean {
  return IGNORED_SHEET_NAMES.has(name.toUpperCase().trim());
}

/**
 * Cek apakah headers dari sheet terlihat seperti sheet mutasi bank.
 * Syarat minimal: ada kolom tanggal, ada kolom deskripsi, ada debit atau credit.
 */
function validateMutationSheet(headers: string[]): { valid: boolean; error?: string } {
  const mapped = autoMapHeaders(headers);
  const canonicals = new Set(Object.values(mapped));

  const hasDate         = canonicals.has("Date");
  const hasDescription  = canonicals.has("Description");
  const hasDebitOrCredit = canonicals.has("Debit") || canonicals.has("Credit");

  if (!hasDate || !hasDescription || !hasDebitOrCredit) {
    return {
      valid: false,
      error: "Sheet yang dipilih bukan sheet mutasi. Pilih sheet data mutasi.",
    };
  }
  return { valid: true };
}

/**
 * Cari index sheet terbaik:
 * 1. Sheet non-ignored pertama yang header-nya lulus validateMutationSheet
 * 2. Fallback: sheet non-ignored pertama
 * 3. Fallback: index 0
 */
function findBestSheetIndex(worksheets: ExcelJS.Worksheet[]): number {
  // Pass 1: sheet non-ignored dengan header mutasi valid
  for (let i = 0; i < worksheets.length; i++) {
    if (isIgnoredSheet(worksheets[i].name)) continue;
    // Gunakan push agar tidak terbentuk sparse array (holes undefined)
    const headers: string[] = [];
    worksheets[i].getRow(1).eachCell({ includeEmpty: false }, (cell) => {
      const val = String(cell.value ?? "").trim();
      if (val) headers.push(val);
    });
    if (validateMutationSheet(headers).valid) return i;
  }
  // Pass 2: sheet non-ignored pertama (walaupun header tidak match)
  for (let i = 0; i < worksheets.length; i++) {
    if (!isIgnoredSheet(worksheets[i].name)) return i;
  }
  return 0;
}

// Normalisasi accounting_class: semua nilai valid diterima langsung, lama di-alias ke baru
const ACC_CLASS_NORMALIZE: Record<string, string> = {
  // === Nilai resmi (diterima langsung) ===
  INCOME:               "INCOME",
  EXPENSE:              "EXPENSE",
  ASSET:                "ASSET",
  LIABILITY:            "LIABILITY",
  LIABILITY_SETTLEMENT: "LIABILITY_SETTLEMENT",
  EQUITY:               "EQUITY",
  TRANSFER:             "TRANSFER",
  TAX:                  "TAX",
  NEED_REVIEW:          "NEED_REVIEW",
  // === Backward compat: nilai lama internal → nilai baru ===
  REVENUE:              "INCOME",
  INTERNAL_TRANSFER:    "TRANSFER",
  TAX_PAYMENT:          "TAX",
  EMPLOYEE_ADVANCE:     "ASSET",
  INTERCOMPANY_LOAN:        "ASSET",
  LOAN_RECEIVABLE:          "ASSET",
  REIMBURSEMENT:            "LIABILITY_SETTLEMENT",
  INTERCOMPANY_SETTLEMENT:  "LIABILITY_SETTLEMENT",
};

function normalizeAccountingClass(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  return ACC_CLASS_NORMALIZE[upper] ?? upper;
}

// Derive accounting_class dari erp_category jika class kosong
// ── PRIORITY RULE 1: ERP_CATEGORY Balance Sheet overrides ─────────────────────
// Kategori di bawah ini SELALU Balance Sheet, TIDAK pernah P&L/EXPENSE.
// Rule ini lebih tinggi dari generic EXPENSE check di bawah.
// ─────────────────────────────────────────────────────────────────────────────
const ERP_BALANCE_SHEET_RULES: Record<string, string> = {
  RENTAL_CAR_EXPENSE:      "ASSET",               // Sewa kendaraan dibayar di muka → Prepaid
  PREPAID_RENT:            "ASSET",               // Sewa dibayar di muka → Aset lancar
  SECURITY_DEPOSIT:        "ASSET",               // Uang jaminan sewa → Aset tidak lancar
  INTERCOMPANY_SETTLEMENT: "LIABILITY_SETTLEMENT", // Pelunasan hutang antar perusahaan
};

function deriveAccClassFromErp(erpCategory: string | null): string | null {
  if (!erpCategory) return null;
  const c = erpCategory.trim().toUpperCase();
  // ── PRIORITY 1: Balance Sheet overrides (lebih tinggi dari generic EXPENSE) ──
  if (ERP_BALANCE_SHEET_RULES[c]) return ERP_BALANCE_SHEET_RULES[c];
  // ── Generic rules ──
  if (c.startsWith("REVENUE") || c.includes("INCOME"))                return "INCOME";
  if (c.includes("EXPENSE") || c === "BANK_FEE")                      return "EXPENSE";
  if (c === "INTERNAL_TRANSFER")                                        return "TRANSFER";
  if (c === "EMPLOYEE_ADVANCE")                                         return "ASSET";
  if (c === "INTERCOMPANY_LOAN_GIVEN")                                  return "ASSET";
  if (c === "THIRD_PARTY_LOAN_GIVEN")                                   return "ASSET";
  if (c === "LOAN_RECEIVABLE")                                          return "ASSET";
  if (c === "REIMBURSEMENT_RECEIVED")                                   return "ASSET";
  if (c === "REIMBURSEMENT_PAYMENT")                                    return "LIABILITY_SETTLEMENT";
  if (c === "INTERCOMPANY_LOAN_SETTLEMENT")                             return "LIABILITY_SETTLEMENT";
  if (c === "THIRD_PARTY_LOAN_SETTLEMENT")                              return "LIABILITY_SETTLEMENT";
  if (c === "OWNER_CAPITAL" || c === "OWNER_DRAWING")                   return "EQUITY";
  if (c === "TAX_PAYMENT" || c.startsWith("TAX"))                       return "TAX";
  return null;
}

// ── FASE 3: Bank fee auto-detection (LOCKED RULE) ────────────────────────────
// Jika deskripsi mengandung keyword fee → WAJIB BANK_FEE / EXPENSE, tidak boleh revenue
function isBankFee(description: string | null): boolean {
  if (!description) return false;
  const d = description.toLowerCase();
  return d.includes(' fee') || d.startsWith('fee')
    || /\badm\b/.test(d) || /\badmin\b/.test(d)
    || d.includes('charge') || d.includes('biaya adm')
    || d.includes('monthly card') || d.includes('provisi')
    || d.includes('materai') || d.includes('biaya bulanan')
    || d.includes('adm. bank') || d.includes('bi-fast fee');
}

// ── FASE 2: Resolve kolom COMPANY dari Excel → company_id integer ─────────────
function resolveRowCompanyId(companyCol: string | null): number | null {
  if (!companyCol) return null;
  const c = companyCol.trim().toUpperCase();
  if (c === 'CST' || c.includes('CAHAYA SEJATI') || c === '1') return 1;
  if (c === 'WGS' || c === 'WS' || c.includes('WANGSAMAS') || c === '2') return 2;
  if (c === 'DVS' || c === 'DV' || c.includes('DIVA SERVIS') || c === '3') return 3;
  if (c === 'ERA' || c === 'ER' || c.includes('ELMIRA') || c === '4') return 4;
  return null;
}

function parseNumeric(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") return isNaN(val) ? null : val;
  const raw = String(val).trim();
  // Hapus semua karakter non-numeric kecuali titik, koma, minus
  const stripped = raw.replace(/[^0-9.,-]/g, "");
  if (!stripped) return null;

  // Deteksi format: jika koma adalah pemisah ribuan (1,000,000 atau 1,000,000.50)
  // vs koma sebagai desimal (1.000,50) — format Eropa/Indonesia
  // Heuristik: jika ada titik DAN koma, karakter terakhir menentukan desimal
  let normalized: string;
  if (stripped.includes(",") && stripped.includes(".")) {
    const lastComma = stripped.lastIndexOf(",");
    const lastDot   = stripped.lastIndexOf(".");
    if (lastDot > lastComma) {
      // Titik = desimal, koma = ribuan → hapus koma
      normalized = stripped.replace(/,/g, "");
    } else {
      // Koma = desimal, titik = ribuan → hapus titik, ganti koma jadi titik
      normalized = stripped.replace(/\./g, "").replace(",", ".");
    }
  } else if (stripped.includes(",")) {
    // Hanya ada koma: bisa ribuan (1,000) atau desimal (1,5)
    const parts = stripped.split(",");
    if (parts.length === 2 && parts[1].length <= 2) {
      // Kemungkinan desimal: "1,50" → "1.50"
      normalized = stripped.replace(",", ".");
    } else {
      // Ribuan: "1,000,000" → "1000000"
      normalized = stripped.replace(/,/g, "");
    }
  } else {
    normalized = stripped;
  }

  const n = parseFloat(normalized);
  return isNaN(n) ? null : n;
}

/**
 * Cek apakah string terlihat seperti tanggal valid.
 * Menolak baris footer/summary seperti "Total data rows", "Saldo Awal", dsb.
 */
function looksLikeDate(val: unknown): boolean {
  if (val === null || val === undefined || val === "") return false;
  const s = String(val).trim();
  // Format umum: DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, DD-MM-YYYY, D/M/YY, dst.
  if (/^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}$/.test(s)) return true;
  // Format dengan waktu: DD/MM/YYYY HH:MM atau YYYY-MM-DD HH:MM:SS
  if (/^\d{1,4}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}[\s\T]\d{1,2}:\d{2}/.test(s)) return true;
  // Format "15 Jan 2024" atau "15 January 2024"
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}$/.test(s)) return true;
  // Format "Jan 15, 2024"
  if (/^[A-Za-z]{3,9}\s+\d{1,2},?\s+\d{2,4}$/.test(s)) return true;
  // ISO datetime full: "2024-01-15T10:30:00.000Z"
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return true;
  // Format tanggal + waktu Indonesia: "15 Jan 2024 10:30"
  if (/^\d{1,2}\s+[A-Za-z]{3,9}\s+\d{2,4}\s+\d{1,2}:\d{2}/.test(s)) return true;
  return false;
}

function mapRow(
  raw: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const mapped: Record<string, unknown> = {};
  for (const [header, canonical] of Object.entries(mapping)) {
    mapped[canonical] = raw[header] ?? null;
  }
  return mapped;
}

// ─── POST /api/bank-mutation-import/preview ───────────────────────────────────
// Upload file → parse ALL rows → return preview (100 baris) + all_rows untuk save
// Batas keras: 20.000 baris — cukup untuk mutasi bulanan rekening apapun.
const MAX_IMPORT_ROWS = 20_000;

router.post("/preview", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "File tidak ditemukan. Kirim field 'file'." });
  }

  try {
    const workbook = new ExcelJS.Workbook();
    const ext = (req.file.originalname ?? "").toLowerCase().split(".").pop();

    let worksheet: ExcelJS.Worksheet;
    let sheets: { index: number; name: string }[] = [];

    let selectedSheetIndex = 0;
    let suggestedSheetIndex = 0;

    if (ext === "csv") {
      const stream = new Readable({ read() {} });
      stream.push(req.file.buffer);
      stream.push(null);
      worksheet = await workbook.csv.read(stream as any);
      sheets = [{ index: 0, name: "Sheet1" }];
    } else {
      await workbook.xlsx.load(req.file.buffer as any);
      sheets = workbook.worksheets.map((ws, i) => ({ index: i, name: ws.name }));

      suggestedSheetIndex = findBestSheetIndex(workbook.worksheets);

      // Jika client minta auto_detect (upload pertama), pakai sheet terbaik.
      // Jika user sudah memilih sheet secara eksplisit, pakai pilihan user.
      const autoDetect = req.body?.auto_detect === "1" || req.body?.auto_detect === true;
      const requestedIndex = parseInt(String(req.body?.sheet_index ?? "0"), 10) || 0;
      selectedSheetIndex = autoDetect ? suggestedSheetIndex : Math.min(requestedIndex, workbook.worksheets.length - 1);

      worksheet = workbook.worksheets[selectedSheetIndex];
    }

    const headers: string[] = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colIdx) => {
      headers[colIdx - 1] = String(cell.value ?? `col_${colIdx}`).trim();
    });

    // Validasi apakah sheet ini adalah sheet mutasi
    const sheetValidation = validateMutationSheet(headers);

    const allRows: Record<string, unknown>[] = [];
    let totalRows = 0;
    let truncated = false;

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      totalRows++;
      if (allRows.length >= MAX_IMPORT_ROWS) {
        truncated = true;
        return;
      }

      const obj: Record<string, unknown> = {};
      headers.forEach((header, i) => {
        const cell = row.getCell(i + 1);
        let val: unknown = cell.value;
        if (val !== null && typeof val === "object" && "result" in (val as object)) {
          val = (val as { result: unknown }).result;
        }
        if (val instanceof Date) {
          val = val.toISOString().split("T")[0];
        }
        obj[header] = val ?? null;
      });
      allRows.push(obj);
    });

    const autoMapping = autoMapHeaders(headers);

    return res.json({
      filename: req.file.originalname,
      headers,
      total_rows: totalRows,
      sheets,
      // all_rows: semua baris (maks MAX_IMPORT_ROWS) — dipakai saat POST /save
      all_rows: allRows,
      // preview_rows: 100 baris pertama — hanya untuk tampilan di UI
      preview_rows: allRows.slice(0, 100),
      truncated,
      auto_mapping: autoMapping,
      canonical_columns: CANONICAL_COLUMNS,
      // Sheet selection info
      selected_sheet_index: selectedSheetIndex,
      suggested_sheet_index: suggestedSheetIndex,
      sheet_valid: sheetValidation.valid,
      sheet_error: sheetValidation.error ?? null,
    });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import preview error");
    return res.status(500).json({ error: "Gagal membaca file. Pastikan format valid." });
  }
});

// ─── POST /api/bank-mutation-import/save ─────────────────────────────────────
router.post("/save", async (req, res) => {
  await runBankMutationImportMigration();

  const { filename, column_mapping, rows, notes, company_id } = req.body as {
    filename: string;
    column_mapping: Record<string, string>;
    rows: Record<string, unknown>[];
    notes?: string;
    company_id?: number;
  };

  if (!filename || !column_mapping || !Array.isArray(rows) || rows.length === 0) {
    return res.status(400).json({ error: "filename, column_mapping, dan rows wajib diisi." });
  }
  // ── P1: Validasi company_id wajib diisi sebelum import ──────────────────────
  if (!company_id || isNaN(Number(company_id)) || Number(company_id) <= 0) {
    return res.status(400).json({ error: "company_id wajib diisi dan valid sebelum import. Pilih perusahaan terlebih dahulu." });
  }

  const actor = (req as any).user?.email ?? "system";

  try {
    // ── 1. Kumpulkan semua unique_key dari input ─────────────────────────────
    const mappedRows = rows.map((raw, i) => ({ raw, mapped: mapRow(raw, column_mapping), idx: i }));
    const incomingKeys = mappedRows
      .map(r => String(r.mapped["UNIQUE_KEY"] ?? "").trim())
      .filter(k => k !== "");

    // ── 2. Bulk-cek unique_key yang sudah ada di bank_mutation_imports ───────
    const existingKeySet = new Set<string>();
    if (incomingKeys.length > 0) {
      const quotedKeys = incomingKeys.map(k => `'${k.replace(/'/g, "''")}'`).join(", ");
      const { rows: existingRows } = await db.execute(sql.raw(
        `SELECT unique_key FROM bank_mutation_imports WHERE unique_key IN (${quotedKeys})`
      ));
      for (const r of existingRows) {
        existingKeySet.add(String((r as any).unique_key));
      }
    }

    // ── 3. Buat batch header ─────────────────────────────────────────────────
    const { rows: batchRows } = await db.execute(sql.raw(`
      INSERT INTO bank_mutation_import_batches
        (filename, status, column_mapping, row_count, company_id, created_by, notes)
      VALUES (
        '${filename.replace(/'/g, "''")}',
        'DRAFT_IMPORT',
        '${JSON.stringify(column_mapping).replace(/'/g, "''")}',
        ${rows.length},
        ${company_id ? Number(company_id) : "NULL"},
        '${actor.replace(/'/g, "''")}',
        ${notes ? `'${notes.replace(/'/g, "''")}'` : "NULL"}
      )
      RETURNING id
    `));
    const batchId = (batchRows[0] as any).id;

    // ── 4. Proses semua row di memori, lalu bulk INSERT per chunk 500 rows ──────
    let imported = 0;
    let skipped  = 0;
    const skippedKeys: string[] = [];

    // Helper: escape string SQL aman
    const esc = (v: unknown): string =>
      v !== null && v !== undefined && String(v) !== ""
        ? `'${String(v).replace(/'/g, "''")}'`
        : "NULL";

    // Kumpulkan nilai per tabel
    type AuditRow   = string; // satu tuple VALUES untuk bank_mutation_import_rows
    type ImportRow  = string; // satu tuple VALUES untuk bank_mutation_imports

    const auditValues:  AuditRow[]  = [];
    const importValues: ImportRow[] = [];

    for (const { raw, mapped, idx } of mappedRows) {
      const uniqueKeyRaw = String(mapped["UNIQUE_KEY"] ?? "").trim();
      const isDuplicate  = uniqueKeyRaw !== "" && existingKeySet.has(uniqueKeyRaw);

      const rawDateVal = mapped["Date"];
      const isInvalidDate = rawDateVal !== null && rawDateVal !== undefined && rawDateVal !== ""
        && !looksLikeDate(rawDateVal);

      const date       = esc(mapped["Date"]);
      const desc       = esc(mapped["Description"]);
      const debit      = parseNumeric(mapped["Debit"]);
      const credit     = parseNumeric(mapped["Credit"]);

      const isZeroAmount = !isDuplicate && !isInvalidDate
        && (debit === null || debit === 0) && (credit === null || credit === 0);

      if (isDuplicate || isInvalidDate || isZeroAmount) {
        skipped++;
        if (isDuplicate) skippedKeys.push(uniqueKeyRaw);
      } else {
        imported++;
        if (uniqueKeyRaw !== "") existingKeySet.add(uniqueKeyRaw);
      }

      const skipReason = isDuplicate ? "'DUPLICATE'"
        : isInvalidDate ? "'INVALID_DATE'"
        : isZeroAmount  ? "'ZERO_AMOUNT'"
        : "NULL";
      const balance    = parseNumeric(mapped["Balance"]);
      const entType    = esc(mapped["ENTITY_TYPE"]);
      const entName    = esc(mapped["ENTITY_NAME"]);
      const bu         = esc(mapped["BUSINESS_UNIT"]);
      const company    = esc(mapped["COMPANY"]);
      const taxType    = esc(mapped["TAX_TYPE"]);
      const payMethod  = esc(mapped["PAYMENT_METHOD"]);
      const srcAccRaw  = mapped["SOURCE_ACCOUNT"] ? String(mapped["SOURCE_ACCOUNT"]).trim() : null;
      const srcAcc     = esc(srcAccRaw);
      const plFlagRaw  = mapped["PL_FLAG"] ? String(mapped["PL_FLAG"]).trim().toUpperCase() : null;
      const plFlag     = esc(mapped["PL_FLAG"]);
      const rawClass     = mapped["ACCOUNTING_CLASS"] ? String(mapped["ACCOUNTING_CLASS"]) : null;
      let   rawErpCatStr = mapped["ERP_CATEGORY"] ? String(mapped["ERP_CATEGORY"]) : null;

      // ── PRIORITY RULE: RENTAL_CAR_EXPENSE + External Company → INTERCOMPANY/PREPAID ──
      // Jika ERP_CATEGORY mengandung RENTAL_CAR_EXPENSE DAN source_account = "External Company",
      // klasifikasikan sebagai INTERCOMPANY_SETTLEMENT (Balance Sheet), BUKAN EXPENSE.
      if ((rawErpCatStr ?? '').toUpperCase().includes('RENTAL_CAR_EXPENSE')
          && srcAccRaw?.toLowerCase().includes('external company')) {
        rawErpCatStr = 'INTERCOMPANY_SETTLEMENT';
      }

      // ── PRIORITY 1: ERP_CATEGORY mapping (tertinggi) ──────────────────────────
      // Normalisasi class dari file; jika kosong, derive dari ERP_CATEGORY
      // deriveAccClassFromErp sudah memiliki Balance Sheet overrides di dalamnya.
      let normClass = normalizeAccountingClass(rawClass);
      if (!normClass && rawErpCatStr) normClass = deriveAccClassFromErp(rawErpCatStr);

      // ── PRIORITY 2: PL_FLAG dari Excel (fallback jika ERP_CATEGORY tidak menghasilkan class) ──
      if (!normClass && plFlagRaw) {
        if (plFlagRaw === 'BALANCE_SHEET' || plFlagRaw === 'BS') {
          normClass = 'ASSET';
        } else if (plFlagRaw === 'P&L' || plFlagRaw === 'PL' || plFlagRaw === 'INCOME_STATEMENT' || plFlagRaw === 'IS') {
          normClass = 'EXPENSE';
        }
      }
      // ── PRIORITY 3: Default EXPENSE/P&L hanya jika tidak ada rule yang cocok ──
      // (ditangani oleh isNeedReview = !normClass di bawah)

      // ── FASE 3: Bank fee auto-detection (LOCKED RULE) ─────────────────────────
      const descStr = mapped["Description"] ? String(mapped["Description"]).trim() : null;
      if (isBankFee(descStr) && (debit ?? 0) > 0 && (credit ?? 0) === 0) {
        rawErpCatStr = 'BANK_FEE';
        normClass    = 'EXPENSE';
      }

      // ── FASE 2: Company per row + intercompany assignment ──────────────────────
      const companyColStr          = mapped["COMPANY"] ? String(mapped["COMPANY"]).trim() : null;
      const rowCompanyId           = resolveRowCompanyId(companyColStr) ?? (company_id ? Number(company_id) : null);
      const isAirportTransfer      = (rawErpCatStr ?? '').toUpperCase() === 'REVENUE_AIRPORT_TRANSFER';
      const rowRevenueCompanyId    = isAirportTransfer ? 3 : null;   // PT Diva Servis = 3
      const rowCollectingCompanyId = isAirportTransfer ? 1 : null;   // CST = 1

      const erpCat   = rawErpCatStr ? `'${rawErpCatStr.replace(/'/g, "''")}'` : "NULL";
      const accClass = normClass ? `'${normClass.replace(/'/g, "''")}'` : "NULL";
      const uniqueKey  = uniqueKeyRaw !== "" ? `'${uniqueKeyRaw.replace(/'/g, "''")}'` : "NULL";
      const rawJson    = `'${JSON.stringify(raw).replace(/'/g, "''")}'`;

      // Status: NEED_REVIEW hanya jika class / erp_category = NEED_REVIEW atau class masih kosong
      const isNeedReview = normClass === "NEED_REVIEW"
        || (rawErpCatStr?.toUpperCase() === "NEED_REVIEW")
        || !normClass;
      const rowStatus  = isNeedReview ? "'NEED_REVIEW'" : "'DRAFT'";

      auditValues.push(
        `(${batchId}, ${idx}, ${date}, ${desc}, ${debit ?? "NULL"}, ${credit ?? "NULL"}, ${balance ?? "NULL"}, ` +
        `${erpCat}, ${entType}, ${entName}, ${bu}, ${company}, ${taxType}, ${payMethod}, ${srcAcc}, ${plFlag}, ` +
        `${accClass}, ${uniqueKey}, ${rawJson}, ${skipReason})`
      );

      if (!isDuplicate && !isInvalidDate && !isZeroAmount) {
        importValues.push(
          `(${batchId}, ${date}, ${desc}, ${debit ?? "NULL"}, ${credit ?? "NULL"}, ${balance ?? "NULL"}, ` +
          `${erpCat}, ${entType}, ${entName}, ${bu}, ${company}, ${taxType}, ${payMethod}, ${srcAcc}, ${plFlag}, ` +
          `${accClass}, ${uniqueKey}, ${rowStatus}, ` +
          `${rowCompanyId ?? "NULL"}, ${rowRevenueCompanyId ?? "NULL"}, ${rowCollectingCompanyId ?? "NULL"}, 'PENDING', 'MISSING')`
        );
      }
    }

    // Bulk INSERT dalam chunk 500 rows per eksekusi
    const CHUNK = 500;
    const auditCols = `(batch_id, row_index, date, description, debit, credit, balance,
      erp_category, entity_type, entity_name, business_unit, company,
      tax_type, payment_method, source_account, pl_flag, accounting_class,
      unique_key, raw, skip_reason)`;
    for (let i = 0; i < auditValues.length; i += CHUNK) {
      const chunk = auditValues.slice(i, i + CHUNK);
      await db.execute(sql.raw(
        `INSERT INTO bank_mutation_import_rows ${auditCols} VALUES ${chunk.join(",")}`
      ));
    }

    const importCols = `(import_batch_id, transaction_date, description, debit, credit, balance,
      erp_category, entity_type, entity_name, business_unit, company,
      tax_type, payment_method, source_account, pl_flag, accounting_class,
      unique_key, status, company_id, revenue_company_id, collecting_company_id, coa_status, subledger_status)`;
    for (let i = 0; i < importValues.length; i += CHUNK) {
      const chunk = importValues.slice(i, i + CHUNK);
      await db.execute(sql.raw(
        `INSERT INTO bank_mutation_imports ${importCols} VALUES ${chunk.join(",")}`
      ));
    }

    // ── 5. Update row_count di batch dengan jumlah actual imported ───────────
    await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET row_count = ${imported} WHERE id = ${batchId}`
    ));

    // ── 6. Normalization layer + FASE 4 pairing (non-blocking) ───────────────
    setImmediate(async () => {
      // FASE 5: Populate normalized_entries
      await copyBatchToNormalized(batchId, company_id ? Number(company_id) : null);

      // ── FASE 4: Transfer pair detection ───────────────────────────────────
      try {
        const { rows: transferRows } = await db.execute(sql.raw(`
          SELECT id, debit, credit, erp_category
          FROM bank_mutation_imports
          WHERE import_batch_id = ${batchId}
            AND erp_category IN ('INTERNAL_TRANSFER','TRANSFER')
            AND transaction_pair_id IS NULL
        `));
        type TxRow = { id: number; amount: number; direction: 'IN' | 'OUT' };
        const txRows: TxRow[] = (transferRows as any[]).map(r => ({
          id: Number(r.id),
          amount: Math.max(Number(r.debit || 0), Number(r.credit || 0)),
          direction: Number(r.credit || 0) > 0 ? 'IN' : 'OUT',
        }));
        const byAmount = new Map<number, TxRow[]>();
        for (const r of txRows) {
          const bucket = byAmount.get(r.amount) ?? [];
          bucket.push(r);
          byAmount.set(r.amount, bucket);
        }
        for (const [amount, bucket] of byAmount.entries()) {
          if (bucket.length < 2) continue;
          const inRow  = bucket.find(r => r.direction === 'IN');
          const outRow = bucket.find(r => r.direction === 'OUT');
          if (!inRow || !outRow || inRow.id === outRow.id) continue;
          const pairId = `batch-${batchId}-tf-${amount}`;
          await db.execute(sql.raw(
            `UPDATE bank_mutation_imports SET transaction_pair_id = '${pairId}'
             WHERE id IN (${inRow.id}, ${outRow.id})`
          ));
          // ── FASE 5: Sync pairing ke bank_mutation_normalized_entries ──────
          await db.execute(sql.raw(
            `UPDATE bank_mutation_normalized_entries
             SET transaction_pair_id = '${pairId}', updated_at = NOW()
             WHERE row_id IN (${inRow.id}, ${outRow.id}) AND status != 'SUPERSEDED'`
          )).catch(() => {});
        }
      } catch (e) {
        logger.warn({ err: e, batchId }, 'bank-mutation-import: transfer pairing failed (non-fatal)');
      }
    });

    logger.info(
      { batchId, total: rows.length, imported, skipped, actor },
      "bank-mutation-import: batch saved",
    );

    return res.json({
      success: true,
      batch_id: batchId,
      total: rows.length,
      imported,
      skipped,
      skipped_keys: skippedKeys,
      status: "DRAFT_IMPORT",
    });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import save error");
    return res.status(500).json({ error: "Gagal menyimpan data import." });
  }
});

// ─── GET /api/bank-mutation-import/recon ─────────────────────────────────────
// WAJIB di atas /:id agar tidak tertangkap sebagai id=NaN
router.get("/recon", async (req, res) => {
  await runBankMutationImportMigration();
  const { date_from, date_to, status } = req.query as Record<string, string>;
  const conditions: string[] = [];
  if (date_from) conditions.push(`bmi.transaction_date >= '${date_from}'`);
  if (date_to)   conditions.push(`bmi.transaction_date <= '${date_to}'`);
  if (status === "MATCHED")   conditions.push("bmi.journal_entry_id IS NOT NULL");
  if (status === "UNMATCHED") conditions.push("bmi.journal_entry_id IS NULL");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        bmi.id, bmi.transaction_date, bmi.description, bmi.debit, bmi.credit,
        bmi.accounting_class, bmi.erp_category, bmi.status,
        bmi.journal_entry_id, bmi.import_batch_id,
        ae.entry_number, ae.total_debit AS je_debit, ae.total_credit AS je_credit,
        ae.date AS je_date,
        b.filename
      FROM bank_mutation_imports bmi
      LEFT JOIN accounting_entries ae ON ae.id = bmi.journal_entry_id
      LEFT JOIN bank_mutation_import_batches b ON b.id = bmi.import_batch_id
      ${where}
      ORDER BY bmi.transaction_date DESC NULLS LAST, bmi.id DESC
      LIMIT 500
    `));
    return res.json({ rows });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import recon error");
    return res.status(500).json({ error: "Gagal mengambil data rekonsiliasi." });
  }
});

// ─── POST /api/bank-mutation-import/repair-accounting-class ──────────────────
// Normalisasi accounting_class lama (INCOME/TRANSFER/LIABILITY_SETTLEMENT/ASSET)
// ke nilai yang valid di posting engine. Hanya update baris yg belum di-posting.
router.post("/repair-accounting-class", async (req, res) => {
  await runBankMutationImportMigration();
  const actor = (req as any).user?.email ?? "system";
  try {
    const { rows: before } = await db.execute(sql.raw(`
      SELECT accounting_class, COUNT(*) as cnt
      FROM bank_mutation_imports
      WHERE accounting_class IN ('INCOME','TRANSFER','LIABILITY_SETTLEMENT','ASSET','NEED_REVIEW')
        AND journal_entry_id IS NULL
      GROUP BY accounting_class
      ORDER BY cnt DESC
    `));

    const { rows: updated } = await db.execute(sql.raw(`
      UPDATE bank_mutation_imports
      SET accounting_class = CASE
        WHEN accounting_class = 'INCOME'               THEN 'REVENUE'
        WHEN accounting_class = 'TRANSFER'             THEN 'INTERNAL_TRANSFER'
        WHEN accounting_class = 'LIABILITY_SETTLEMENT' THEN 'REIMBURSEMENT'
        WHEN accounting_class = 'ASSET'                THEN 'REIMBURSEMENT'
        ELSE accounting_class
      END,
      status = CASE
        WHEN status = 'NEED_REVIEW' AND accounting_class IN ('INCOME','TRANSFER','LIABILITY_SETTLEMENT','ASSET')
          THEN 'DRAFT'
        ELSE status
      END
      WHERE accounting_class IN ('INCOME','TRANSFER','LIABILITY_SETTLEMENT','ASSET')
        AND journal_entry_id IS NULL
      RETURNING id, accounting_class
    `));

    logger.info({ count: updated.length, actor }, "bank-mutation-import: repair-accounting-class done");
    return res.json({
      success: true,
      repaired: updated.length,
      before: before,
      note: "NEED_REVIEW rows tidak diubah accounting_class-nya — perlu review manual.",
    });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import repair-accounting-class error");
    return res.status(500).json({ error: "Gagal repair accounting_class." });
  }
});

// ─── GET /api/bank-mutation-import ───────────────────────────────────────────
// List semua batch
router.get("/", async (_req, res) => {
  await runBankMutationImportMigration();
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT id, filename, status, row_count, company_id, created_by, notes, created_at, updated_at
      FROM bank_mutation_import_batches
      ORDER BY created_at DESC
      LIMIT 200
    `));
    return res.json({ batches: rows });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import list error");
    return res.status(500).json({ error: "Gagal mengambil daftar import." });
  }
});

// ─── FASE 8: GET /api/bank-mutation-import/integrity-audit ───────────────────
// Laporan integritas data seluruh bank_mutation_imports:
// - INCOME/EXPENSE tanpa COA valid (coa_status = MISSING)
// - TRANSFER tanpa transaction_pair_id
// - REVENUE_* tanpa revenue_company_id/collecting_company_id
// - BANK_FEE bukan di class EXPENSE
// - Baris READY tanpa normalized entry
// PENTING: rute ini harus didaftarkan SEBELUM /:id agar tidak ditangkap sebagai ID.
router.get("/integrity-audit", async (req, res) => {
  await runBankMutationImportMigration();
  const { batch_id } = req.query as Record<string, string>;
  const batchFilter = batch_id ? `AND bmi.import_batch_id = ${Number(batch_id)}` : '';

  try {
    const { rows: missingCoa } = await db.execute(sql.raw(`
      SELECT bmi.id, bmi.import_batch_id AS batch_id, bmi.erp_category,
             bmi.accounting_class, bmi.coa_status, bmi.status,
             bmi.transaction_date, bmi.description, bmi.debit, bmi.credit
      FROM bank_mutation_imports bmi
      WHERE bmi.accounting_class IN ('INCOME','EXPENSE','REVENUE')
        AND bmi.coa_status IN ('MISSING','PENDING')
        AND bmi.status NOT IN ('IMPORTED','REJECTED','DUPLICATE')
        ${batchFilter}
      ORDER BY bmi.import_batch_id DESC, bmi.id DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] }));

    const { rows: unpairedTransfers } = await db.execute(sql.raw(`
      SELECT bmi.id, bmi.import_batch_id AS batch_id, bmi.erp_category,
             bmi.accounting_class, bmi.transaction_pair_id, bmi.status,
             bmi.transaction_date, bmi.description, bmi.debit, bmi.credit
      FROM bank_mutation_imports bmi
      WHERE bmi.accounting_class IN ('TRANSFER','INTERNAL_TRANSFER')
        AND bmi.transaction_pair_id IS NULL
        AND bmi.status NOT IN ('IMPORTED','REJECTED','DUPLICATE')
        ${batchFilter}
      ORDER BY bmi.import_batch_id DESC, bmi.id DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] }));

    const { rows: missingRevenueCompany } = await db.execute(sql.raw(`
      SELECT bmi.id, bmi.import_batch_id AS batch_id, bmi.erp_category,
             bmi.accounting_class, bmi.revenue_company_id, bmi.collecting_company_id,
             bmi.status, bmi.transaction_date, bmi.description, bmi.debit, bmi.credit
      FROM bank_mutation_imports bmi
      WHERE bmi.erp_category ILIKE 'REVENUE_%'
        AND (bmi.revenue_company_id IS NULL OR bmi.collecting_company_id IS NULL)
        AND bmi.status NOT IN ('IMPORTED','REJECTED','DUPLICATE')
        ${batchFilter}
      ORDER BY bmi.import_batch_id DESC, bmi.id DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] }));

    const { rows: bankFeeWrongClass } = await db.execute(sql.raw(`
      SELECT bmi.id, bmi.import_batch_id AS batch_id, bmi.erp_category,
             bmi.accounting_class, bmi.status,
             bmi.transaction_date, bmi.description, bmi.debit, bmi.credit
      FROM bank_mutation_imports bmi
      WHERE bmi.erp_category = 'BANK_FEE'
        AND bmi.accounting_class != 'EXPENSE'
        AND bmi.status NOT IN ('IMPORTED','REJECTED','DUPLICATE')
        ${batchFilter}
      ORDER BY bmi.import_batch_id DESC, bmi.id DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] }));

    const { rows: missingNormalized } = await db.execute(sql.raw(`
      SELECT bmi.id, bmi.import_batch_id AS batch_id, bmi.erp_category,
             bmi.accounting_class, bmi.status,
             bmi.transaction_date, bmi.description, bmi.debit, bmi.credit
      FROM bank_mutation_imports bmi
      LEFT JOIN bank_mutation_normalized_entries ne
        ON ne.row_id = bmi.id AND ne.status != 'SUPERSEDED'
      WHERE bmi.status NOT IN ('IMPORTED','REJECTED','DUPLICATE','SKIPPED_ALREADY_POSTED','MATCHED')
        AND bmi.journal_entry_id IS NULL
        AND ne.id IS NULL
        ${batchFilter}
      ORDER BY bmi.import_batch_id DESC, bmi.id DESC
      LIMIT 200
    `)).catch(() => ({ rows: [] }));

    const { rows: batchSummary } = await db.execute(sql.raw(`
      SELECT
        b.id AS batch_id,
        b.filename,
        b.company_id,
        b.status AS batch_status,
        COUNT(bmi.id)                                                           AS total_rows,
        SUM(CASE WHEN bmi.status = 'IMPORTED'           THEN 1 ELSE 0 END)     AS posted,
        SUM(CASE WHEN bmi.coa_status = 'MISSING'        THEN 1 ELSE 0 END)     AS coa_missing,
        SUM(CASE WHEN bmi.subledger_status = 'MISSING'  THEN 1 ELSE 0 END)     AS subledger_missing,
        SUM(CASE WHEN bmi.accounting_class IN ('TRANSFER','INTERNAL_TRANSFER')
                  AND bmi.transaction_pair_id IS NULL    THEN 1 ELSE 0 END)    AS unpaired_transfers,
        SUM(CASE WHEN bmi.status = 'NEED_REVIEW'        THEN 1 ELSE 0 END)     AS need_review,
        SUM(CASE WHEN bmi.status = 'NEED_COA_MAPPING'   THEN 1 ELSE 0 END)     AS need_coa_mapping
      FROM bank_mutation_import_batches b
      LEFT JOIN bank_mutation_imports bmi ON bmi.import_batch_id = b.id
      ${batch_id ? `WHERE b.id = ${Number(batch_id)}` : ''}
      GROUP BY b.id, b.filename, b.company_id, b.status
      ORDER BY b.id DESC
      LIMIT 50
    `)).catch(() => ({ rows: [] }));

    return res.json({
      summary: {
        missing_coa:             missingCoa.length,
        unpaired_transfers:      unpairedTransfers.length,
        missing_revenue_company: missingRevenueCompany.length,
        bank_fee_wrong_class:    bankFeeWrongClass.length,
        missing_normalized:      missingNormalized.length,
        total_violations:        missingCoa.length + unpairedTransfers.length
          + missingRevenueCompany.length + bankFeeWrongClass.length + missingNormalized.length,
      },
      missing_coa:             missingCoa,
      unpaired_transfers:      unpairedTransfers,
      missing_revenue_company: missingRevenueCompany,
      bank_fee_wrong_class:    bankFeeWrongClass,
      missing_normalized:      missingNormalized,
      batch_summary:           batchSummary,
    });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import integrity-audit error");
    return res.status(500).json({ error: "Gagal menjalankan integrity audit." });
  }
});

// ─── GET /api/bank-mutation-import/:id ───────────────────────────────────────
router.get("/:id", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

  try {
    const { rows: batches } = await db.execute(sql.raw(
      `SELECT * FROM bank_mutation_import_batches WHERE id = ${id}`
    ));
    if (!batches.length) return res.status(404).json({ error: "Batch tidak ditemukan." });

    const { rows: importRows } = await db.execute(sql.raw(
      `SELECT * FROM bank_mutation_import_rows WHERE batch_id = ${id} ORDER BY row_index ASC`
    ));

    return res.json({ batch: batches[0], rows: importRows });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import get detail error");
    return res.status(500).json({ error: "Gagal mengambil detail batch." });
  }
});

// ─── GET /api/bank-mutation-import/:id/preview ───────────────────────────────
// Kembalikan bank_mutation_imports (data bersih) + skipped rows dari bank_mutation_import_rows
router.get("/:id/preview", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  try {
    const { rows: batches } = await db.execute(sql.raw(
      `SELECT * FROM bank_mutation_import_batches WHERE id = ${id}`
    ));
    if (!batches.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const { rows: imports } = await db.execute(sql.raw(`
      SELECT bmi.*, ae.entry_number AS journal_entry_number
      FROM bank_mutation_imports bmi
      LEFT JOIN accounting_entries ae ON ae.id = bmi.journal_entry_id
      WHERE bmi.import_batch_id = ${id}
      ORDER BY bmi.transaction_date ASC, bmi.id ASC
    `));
    const { rows: skippedRows } = await db.execute(sql.raw(`
      SELECT id, row_index, date, description, debit, credit, balance,
             erp_category, accounting_class, unique_key, skip_reason, raw
      FROM bank_mutation_import_rows
      WHERE batch_id = ${id} AND skip_reason IS NOT NULL
      ORDER BY row_index ASC
    `));
    return res.json({ batch: batches[0], rows: imports, skipped_rows: skippedRows });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import preview error");
    return res.status(500).json({ error: "Gagal mengambil preview." });
  }
});

// ─── PATCH /api/bank-mutation-import/:id ─────────────────────────────────────
// Update company_id / notes pada batch header
router.patch("/:id", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  const { company_id, notes } = req.body as { company_id?: number; notes?: string };
  const sets: string[] = [];
  if (company_id !== undefined) {
    const cid = Number(company_id);
    if (isNaN(cid) || cid <= 0) return res.status(400).json({ error: "company_id tidak valid." });
    sets.push(`company_id = ${cid}`);
  }
  if (notes !== undefined) sets.push(`notes = '${String(notes).replace(/'/g, "''")}'`);
  if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diupdate." });
  sets.push(`updated_at = NOW()`);
  try {
    const { rows } = await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`
    ));
    if (!rows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    return res.json({ batch: rows[0] });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import patch batch error");
    return res.status(500).json({ error: "Gagal mengupdate batch." });
  }
});

// ─── PATCH /api/bank-mutation-import/imports/:rowId ──────────────────────────
// Update erp_category / accounting_class / status satu baris
router.patch("/imports/:rowId", async (req, res) => {
  await runBankMutationImportMigration();
  const rowId = parseInt(String(req.params.rowId), 10);
  if (isNaN(rowId)) return res.status(400).json({ error: "ID tidak valid." });
  const { erp_category, accounting_class, status } = req.body as {
    erp_category?: string; accounting_class?: string; status?: string;
  };
  const sets: string[] = [];
  if (erp_category !== undefined) sets.push(`erp_category = '${String(erp_category).replace(/'/g, "''")}'`);
  if (accounting_class !== undefined) sets.push(`accounting_class = ${accounting_class ? `'${String(accounting_class).replace(/'/g, "''")}'` : "NULL"}`);
  if (status !== undefined) sets.push(`status = '${String(status).replace(/'/g, "''")}'`);
  if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diupdate." });
  sets.push(`reviewed_at = NOW()`);
  const actor = (req as any).user?.email ?? "system";
  try {
    // Ambil nilai sebelum diupdate untuk audit trail
    const { rows: before } = await db.execute(sql.raw(
      `SELECT import_batch_id, erp_category, accounting_class, status FROM bank_mutation_imports WHERE id = ${rowId}`
    ));
    const prev = before[0] as any;

    const { rows } = await db.execute(sql.raw(
      `UPDATE bank_mutation_imports SET ${sets.join(", ")} WHERE id = ${rowId} RETURNING *`
    ));
    if (!rows.length) return res.status(404).json({ error: "Baris tidak ditemukan." });

    // Catat perubahan ke audit log
    const batchId: number | null = prev?.import_batch_id ?? null;
    if (accounting_class !== undefined && prev?.accounting_class !== accounting_class) {
      await auditImportLog({ batchId, rowId, action: "update_class", actor, field: "accounting_class", beforeVal: prev?.accounting_class, afterVal: accounting_class });
    }
    if (erp_category !== undefined && prev?.erp_category !== erp_category) {
      await auditImportLog({ batchId, rowId, action: "update_category", actor, field: "erp_category", beforeVal: prev?.erp_category, afterVal: erp_category });
    }
    if (status !== undefined && prev?.status !== status) {
      await auditImportLog({ batchId, rowId, action: "update_status", actor, field: "status", beforeVal: prev?.status, afterVal: status });
    }

    return res.json({ row: rows[0] });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import patch row error");
    return res.status(500).json({ error: "Gagal mengupdate baris." });
  }
});

// ─── POST /api/bank-mutation-import/:id/post ─────────────────────────────────
// Buat jurnal otomatis untuk semua baris READY dalam batch ini (dynamic COA — Fase 7)
const VALID_ACC_CLASSES = [
  // Nilai resmi baru
  "INCOME", "EXPENSE", "ASSET", "LIABILITY", "LIABILITY_SETTLEMENT",
  "EQUITY", "TRANSFER", "TAX",
  // Backward compat (lama — masih ada di DB lama)
  "REVENUE", "INTERNAL_TRANSFER", "EMPLOYEE_ADVANCE",
  "INTERCOMPANY_LOAN", "TAX_PAYMENT", "REIMBURSEMENT", "LOAN_RECEIVABLE",
];

// FALLBACK jika erp_category tidak ada di master_coa_mapping
const CLASS_MAP_FALLBACK: Record<string, { drCode: string; crCode: string }> = {
  // === Nilai resmi baru ===
  INCOME:               { drCode: "1-1020", crCode: "4-1020" },  // Dr Bank, Cr Pendapatan
  EXPENSE:              { drCode: "5-3010", crCode: "1-1020" },  // Safe bank-expense account; normalizer still requires mapping
  ASSET:                { drCode: "1-1032", crCode: "1-1020" },  // Dr Aset/Piutang, Cr Bank
  LIABILITY:            { drCode: "1-1020", crCode: "2-1010" },  // Dr Bank, Cr Hutang
  LIABILITY_SETTLEMENT: { drCode: "2-1010", crCode: "1-1020" },  // Dr Hutang, Cr Bank
  EQUITY:               { drCode: "1-1020", crCode: "3-1010" },  // Dr Bank, Cr Ekuitas
  TRANSFER:             { drCode: "1-1029", crCode: "1-1020" },  // Dr Kliring, Cr Bank
  TAX:                  { drCode: "2-1030", crCode: "1-1020" },  // Generic tax liability only for legacy display; posting requires tax mapping
  // === Backward compat ===
  REVENUE:              { drCode: "1-1020", crCode: "4-1020" },
  INTERNAL_TRANSFER:    { drCode: "1-1029", crCode: "1-1020" },
  EMPLOYEE_ADVANCE:     { drCode: "1-1032", crCode: "1-1020" },
  INTERCOMPANY_LOAN:    { drCode: "1-1031", crCode: "1-1020" },
  REIMBURSEMENT:        { drCode: "2-1010", crCode: "1-1020" },
  LOAN_RECEIVABLE:      { drCode: "1-1034", crCode: "1-1020" },
};

async function resolveCoaId(coaCode: string, companyId?: number | null): Promise<number | null> {
  const escaped = coaCode.replace(/'/g, "''");
  // Coba exact match dulu; fallback ke LIKE hanya jika tidak ditemukan
  const { rows } = await db.execute(sql.raw(
    `SELECT id FROM chart_of_accounts
     WHERE code = '${escaped}'
     ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
     ORDER BY company_id DESC NULLS LAST, id ASC LIMIT 1`
  ));
  if (rows.length) return (rows[0] as any).id;
  // Fallback LIKE untuk kode yang disimpan dengan suffix
  const { rows: fallback } = await db.execute(sql.raw(
    `SELECT id FROM chart_of_accounts
     WHERE code LIKE '${escaped}%'
     ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
     ORDER BY company_id DESC NULLS LAST, id ASC LIMIT 1`
  ));
  return fallback.length ? (fallback[0] as any).id : null;
}

async function resolveBankJournalId(companyId?: number | null): Promise<number | null> {
  const companyFilter = companyId
    ? `AND (company_id = ${companyId} OR company_id IS NULL)`
    : "";
  const { rows } = await db.execute(sql.raw(
    `SELECT id FROM accounting_journals
     WHERE (code IN ('BNK','BANK','GEN','JE','MISC')
        OR code LIKE 'BNK-%' OR code LIKE 'BANK-%')
     ${companyFilter}
     ORDER BY
       CASE WHEN company_id = ${companyId ?? 0} THEN 0 ELSE 1 END,
       CASE WHEN code IN ('BNK','BANK') THEN 0
            WHEN code LIKE 'BNK-%' OR code LIKE 'BANK-%' THEN 1
            ELSE 2 END,
       id ASC
     LIMIT 1`
  ));
  return rows.length ? (rows[0] as any).id : null;
}

// Ambil COA mapping dari master_coa_mapping (Fase 7)
async function resolveCoaMapping(
  erpCategory: string | null,
  txDate?: Date,
  companyId?: number | null,
): Promise<{ coaCode: string; accountingClass: string } | null> {
  if (!erpCategory) return null;
  const cat = erpCategory.replace(/'/g, "''");
  const dateStr = (txDate ?? new Date()).toISOString().split('T')[0];

  // P2: Cari di versioned table dahulu (date-aware, company-specific)
  try {
    const companyFilter = companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : '';
    const { rows: vRows } = await db.execute(sql.raw(
      `SELECT coa_code, accounting_class FROM master_coa_mapping_versioned
       WHERE erp_category = '${cat}' AND is_active = TRUE
         ${companyFilter}
         AND valid_from <= '${dateStr}'
         AND (valid_to IS NULL OR valid_to >= '${dateStr}')
       ORDER BY company_id DESC NULLS LAST, valid_from DESC
       LIMIT 1`
    ));
    if (vRows.length) {
      return { coaCode: (vRows[0] as any).coa_code, accountingClass: (vRows[0] as any).accounting_class };
    }
  } catch (_) { /* fallback ke legacy jika tabel belum ada */ }

  // Fallback: legacy table (tanpa versioning)
  const { rows } = await db.execute(sql.raw(
    `SELECT coa_code, accounting_class FROM master_coa_mapping
     WHERE erp_category = '${cat}' AND is_active = TRUE LIMIT 1`
  ));
  if (!rows.length) return null;
  return { coaCode: (rows[0] as any).coa_code, accountingClass: (rows[0] as any).accounting_class };
}

// Ambil tax mapping untuk TAX_PAYMENT (Fase 10)
async function resolveTaxMapping(taxType: string | null): Promise<string | null> {
  if (!taxType) return null;
  const { rows } = await db.execute(sql.raw(
    `SELECT liability_coa FROM master_tax_mapping
     WHERE tax_type = '${taxType.replace(/'/g,"''")}' AND is_active = TRUE LIMIT 1`
  ));
  return rows.length ? (rows[0] as any).liability_coa : null;
}

// Resolve bank COA dari master_bank_accounts (Fase 12)
async function resolveBankCoaCode(bankAccountId: number | null, sourceAccount: string | null): Promise<string> {
  if (bankAccountId) {
    const { rows } = await db.execute(sql.raw(
      `SELECT coa_code FROM master_bank_accounts WHERE id = ${bankAccountId} AND is_active = TRUE LIMIT 1`
    ));
    if (rows.length && (rows[0] as any).coa_code) return (rows[0] as any).coa_code;
  }
  if (sourceAccount) {
    const { rows } = await db.execute(sql.raw(
      `SELECT coa_code FROM master_bank_accounts
       WHERE is_active = TRUE
         AND (account_name ILIKE '%${sourceAccount.replace(/'/g,"''")}%'
           OR bank_name ILIKE '%${sourceAccount.replace(/'/g,"''")}%')
       LIMIT 1`
    ));
    if (rows.length && (rows[0] as any).coa_code) return (rows[0] as any).coa_code;
  }
  return "1-1020"; // default bank: Bank Mandiri (prefix match 1-1020-CST/DV/ER/WS)
}

// ─── P0-2: Cari transaksi existing untuk RECONCILIATION_ONLY ─────────────────
/**
 * @deprecated findMatchingTransaction — DEPRECATED.
 * Gunakan unifiedMatchingEngine.runUnifiedMatching() sebagai gantinya.
 * Fungsi ini memakai toleransi ±1 unit yang longgar, tidak ada UNIQUE lock,
 * dan menggunakan dua engine berbeda (inkonsisten dengan RECONCILIATION_ONLY).
 * Dipertahankan untuk backward compat tetapi tidak boleh dipanggil dari path baru.
 */
async function findMatchingTransaction(
  row: any,
  companyId: number,
): Promise<{ type: string; id: number } | null> {
  logger.warn('[DEPRECATED] findMatchingTransaction dipanggil — gunakan unifiedMatchingEngine.runUnifiedMatching()');
  const creditAmt = Number(row.credit || 0);
  const debitAmt  = Number(row.debit  || 0);
  const amount = creditAmt > 0 ? creditAmt : debitAmt;
  if (amount <= 0) return null;

  const rawDate = row.transaction_date ? new Date(row.transaction_date) : null;
  if (!rawDate || isNaN(rawDate.getTime())) return null;
  const dateStr = rawDate.toISOString().split('T')[0];

  // Toleransi jumlah ±1 dan date ±3 hari
  const dateFilter = `'${dateStr}'::date - INTERVAL '3 days' AND '${dateStr}'::date + INTERVAL '3 days'`;

  // 1. sport_payments
  try {
    const { rows: sp } = await db.execute(sql.raw(`
      SELECT id FROM sport_payments
      WHERE ABS(amount::numeric - ${amount}) < 1
        AND payment_date BETWEEN ${dateFilter}
        AND status = 'paid'
        ${sportPaymentCanonicalSettlementExclusionSql("sport_payments")}
      LIMIT 1
    `));
    if (sp.length) return { type: 'sport_payment', id: (sp[0] as any).id };
  } catch (_) { /* tabel mungkin tidak ada */ }

  // 2. accounting_payments
  try {
    const { rows: ap } = await db.execute(sql.raw(`
      SELECT id FROM accounting_payments
      WHERE ABS(amount::numeric - ${amount}) < 1
        AND date BETWEEN ${dateFilter}
        AND status = 'posted'
        AND company_id = ${companyId}
      LIMIT 1
    `));
    if (ap.length) return { type: 'accounting_payment', id: (ap[0] as any).id };
  } catch (_) { /* ignore */ }

  // 3. tenant_invoices
  try {
    const { rows: ti } = await db.execute(sql.raw(`
      SELECT id FROM tenant_invoices
      WHERE ABS(total_amount::numeric - ${amount}) < 1
        AND created_at::date BETWEEN ${dateFilter}
      LIMIT 1
    `));
    if (ti.length) return { type: 'tenant_invoice', id: (ti[0] as any).id };
  } catch (_) { /* tabel mungkin tidak ada */ }

  // 4. sales_documents (invoice)
  try {
    const { rows: sd } = await db.execute(sql.raw(`
      SELECT id FROM sales_documents
      WHERE ABS(total_amount::numeric - ${amount}) < 1
        AND created_at::date BETWEEN ${dateFilter}
        AND company_id = ${companyId}
      LIMIT 1
    `));
    if (sd.length) return { type: 'sales_document', id: (sd[0] as any).id };
  } catch (_) { /* ignore */ }

  // 5. logistic_orders
  try {
    const { rows: lo } = await db.execute(sql.raw(`
      SELECT id FROM logistic_orders
      WHERE ABS(total_amount::numeric - ${amount}) < 1
        AND created_at::date BETWEEN ${dateFilter}
      LIMIT 1
    `));
    if (lo.length) return { type: 'logistic_order', id: (lo[0] as any).id };
  } catch (_) { /* ignore */ }

  // 6. expenses
  try {
    const { rows: ex } = await db.execute(sql.raw(`
      SELECT id FROM expenses
      WHERE ABS(amount::numeric - ${amount}) < 1
        AND date BETWEEN ${dateFilter}
        AND company_id = ${companyId}
      LIMIT 1
    `));
    if (ex.length) return { type: 'expense', id: (ex[0] as any).id };
  } catch (_) { /* ignore */ }

  return null;
}

// ─── P1: Bridge — sync baris yang sudah posted ke bank_mutations ─────────────
// Idempoten: upsert berdasarkan mutation_key
async function syncToBankMutations(batchId: number): Promise<void> {
  try {
    const { rows: importRows } = await db.execute(sql.raw(`
      SELECT bmi.*, b.company_id AS batch_company_id
      FROM bank_mutation_imports bmi
      JOIN bank_mutation_import_batches b ON b.id = bmi.import_batch_id
      WHERE bmi.import_batch_id = ${batchId}
        AND bmi.unique_key IS NOT NULL
        AND bmi.status NOT IN ('REJECTED','DUPLICATE')
    `));

    for (const row of importRows as any[]) {
      if (!row.unique_key) continue;
      const ukSafe    = String(row.unique_key).replace(/'/g, "''");
      const descSafe  = String(row.description ?? "").replace(/'/g, "''");
      const credit    = Number(row.credit  || 0);
      const debit     = Number(row.debit   || 0);
      const amount    = credit > 0 ? credit : debit;
      const direction = credit > 0 ? "IN" : "OUT";
      const txDate    = row.transaction_date
        ? new Date(row.transaction_date).toISOString().split("T")[0]
        : new Date().toISOString().split("T")[0];
      const companyId  = row.batch_company_id ?? null;
      const srcAccount = row.source_account ? `'${String(row.source_account).replace(/'/g, "''")}' ` : "NULL";
      const recon      = row.reconciliation_status ? `'${String(row.reconciliation_status).replace(/'/g, "''")}'` : "NULL";
      const ltype      = row.linked_transaction_type ? `'${String(row.linked_transaction_type).replace(/'/g, "''")}'` : "NULL";
      const lid        = row.linked_transaction_id ?? "NULL";

      // Normalize description untuk matching engine
      const normDesc = descSafe.toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

      await db.execute(sql.raw(`
        INSERT INTO bank_mutations
          (transaction_date, description, credit_amount, debit_amount, amount, direction,
           mutation_key, normalized_description,
           import_batch_id, import_row_id, source, company_id, source_account,
           reconciliation_status, linked_transaction_type, linked_transaction_id,
           status, created_at, updated_at)
        VALUES (
          '${txDate}', '${descSafe}', ${credit}, ${debit}, ${amount}, '${direction}',
          '${ukSafe}', '${normDesc.replace(/'/g, "''")}',
          ${batchId}, ${row.id}, 'bank_import',
          ${companyId ?? "NULL"}, ${srcAccount},
          ${recon}, ${ltype}, ${lid},
          '${row.status === "IMPORTED" ? "matched" : "unmatched"}',
          NOW(), NOW()
        )
        ON CONFLICT DO NOTHING
      `)).catch(() => {/* non-fatal jika bank_mutations belum ada */});
    }

    logger.info({ batchId, count: importRows.length }, "bank-mutation-import: syncToBankMutations done");
  } catch (e: any) {
    logger.warn({ err: e, batchId }, "bank-mutation-import: syncToBankMutations failed (non-fatal)");
  }
}

// ─── P3: Financial Period Lock check ─────────────────────────────────────────
async function checkPeriodLock(
  companyId: number,
  txDate: Date,
): Promise<{ locked: boolean; reason?: string }> {
  try {
    const month = txDate.getMonth() + 1;
    const year  = txDate.getFullYear();
    const { rows } = await db.execute(sql.raw(
      `SELECT is_closed, override_allowed FROM financial_periods
       WHERE company_id = ${companyId} AND month = ${month} AND year = ${year} LIMIT 1`
    ));
    if (rows.length && (rows[0] as any).is_closed && !(rows[0] as any).override_allowed) {
      return { locked: true, reason: `Periode ${month}/${year} sudah ditutup (PERIOD_LOCKED)` };
    }
  } catch (_) { /* tabel belum ada = lewati */ }
  return { locked: false };
}

// ─── P6: Journal Balance Validation ─────────────────────────────────────────
function validateJournalBalance(
  lines: Array<{ debit: number; credit: number; currency?: string | null; exchangeRate?: number | null }>,
): { balanced: boolean; imbalance: number; detail?: string } {
  const result = validateMultiCurrencyBalance(lines);
  return { balanced: result.balanced, imbalance: result.imbalanceBase, detail: result.detail };
}

// ─── P7: Audit Accounting Event ──────────────────────────────────────────────
async function logAccountingEvent(opts: {
  journalId:    number | null;
  action:       'CREATE' | 'POST' | 'VOID' | 'REPOST';
  companyId?:   number | null;
  erpCategory?: string | null;
  amount?:      number | null;
  beforeState?: Record<string, unknown> | null;
  afterState?:  Record<string, unknown> | null;
  userId:       string;
  batchId?:     number | null;
  importRowId?: number | null;
}): Promise<void> {
  try {
    const before = opts.beforeState
      ? `'${JSON.stringify(opts.beforeState).replace(/'/g, "''")}'::jsonb` : 'NULL';
    const after = opts.afterState
      ? `'${JSON.stringify(opts.afterState).replace(/'/g, "''")}'::jsonb` : 'NULL';
    await db.execute(sql.raw(`
      INSERT INTO audit_accounting_events
        (journal_id, action, company_id, erp_category, amount,
         before_state, after_state, user_id, batch_id, import_row_id)
      VALUES (
        ${opts.journalId ?? 'NULL'},
        '${opts.action}',
        ${opts.companyId ?? 'NULL'},
        ${opts.erpCategory ? `'${opts.erpCategory.replace(/'/g, "''")}'` : 'NULL'},
        ${opts.amount ?? 'NULL'},
        ${before}, ${after},
        '${(opts.userId || 'system').replace(/'/g, "''")}',
        ${opts.batchId ?? 'NULL'},
        ${opts.importRowId ?? 'NULL'}
      )
    `));
  } catch (e) {
    logger.warn({ err: e }, 'logAccountingEvent failed (non-fatal)');
  }
}

// ─── Core posting logic (shared by /:id/post dan /repost-all-draft) ──────────
async function postBatchInternal(
  batchId: number,
  actor: string,
  onProgress?: (posted: number, failed: number, total: number) => void,
): Promise<{
  posted: number;
  matched: number;
  failed: number;
  skipped: number;
  errors: { id: number; reason: string }[];
  total: number;
  notFound?: boolean;
  noJournal?: boolean;
}> {
  const { rows: batchRows } = await db.execute(sql.raw(
    `SELECT * FROM bank_mutation_import_batches WHERE id = ${batchId}`
  ));
  if (!batchRows.length) return { posted: 0, matched: 0, failed: 0, skipped: 0, errors: [], total: 0, notFound: true };
  const batch = batchRows[0] as any;
  const importMode: string = batch.import_mode ?? 'HISTORICAL_IMPORT';

  // ── Normalization layer: jika ada READY entries, gunakan postBatchFromNormalized ──
  // Guard: hanya aktif jika batch punya normalized entries (batch baru pasca-implementasi)
  try {
    const { rows: normCheck } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_mutation_normalized_entries
      WHERE batch_id = ${batchId} AND status IN ('READY','NEED_REVIEW')
    `));
    const hasNormalized = Number((normCheck[0] as any)?.cnt ?? 0) > 0;
    if (hasNormalized) {
      logger.info({ batchId, importMode }, 'bank-mutation-import: menggunakan normalized posting path');
      const normResult = await postBatchFromNormalized(batchId, batch, actor, onProgress);
      // Update batch status
      const remainNorm = await db.execute(sql.raw(
        `SELECT COUNT(*) AS cnt FROM bank_mutation_normalized_entries WHERE batch_id = ${batchId} AND status = 'READY'`
      ));
      const remainCount = Number((remainNorm.rows[0] as any)?.cnt ?? 0);
      if (importMode === 'RECONCILIATION_ONLY') {
        const needRev = await db.execute(sql.raw(
          `SELECT COUNT(*) AS cnt FROM bank_mutation_normalized_entries WHERE batch_id = ${batchId} AND status = 'NEED_REVIEW'`
        ));
        const nrCount = Number((needRev.rows[0] as any)?.cnt ?? 0);
        await db.execute(sql.raw(
          `UPDATE bank_mutation_import_batches SET status = '${nrCount > 0 ? 'DRAFT_IMPORT' : 'IMPORTED'}', updated_at = NOW() WHERE id = ${batchId}`
        ));
      } else if (normResult.posted > 0 && remainCount === 0) {
        await db.execute(sql.raw(
          `UPDATE bank_mutation_import_batches SET status = 'IMPORTED', updated_at = NOW() WHERE id = ${batchId}`
        ));
      } else {
        await db.execute(sql.raw(
          `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${batchId}`
        ));
      }
      return normResult;
    }
  } catch (e: any) {
    logger.warn({ err: e, batchId }, 'bank-mutation-import: normalized check failed, fallback ke legacy path');
  }

  const { rows: pendingRows } = await db.execute(sql.raw(`
    SELECT * FROM bank_mutation_imports
    WHERE import_batch_id = ${batchId}
      AND status NOT IN ('IMPORTED','REJECTED','DUPLICATE','SKIPPED_ALREADY_POSTED','MATCHED',
                         'NEED_COA_MAPPING','NEED_SUBLEDGER_LINK')
      AND journal_entry_id IS NULL
      AND accounting_class IS NOT NULL
    ORDER BY transaction_date ASC, id ASC
  `));

  // ── Normalisasi accounting_class di runtime (defense-in-depth) ─────────────
  // Normalisasi in-memory DAN update DB untuk baris yang belum di-normalisasi
  const toNormalizeInDb = pendingRows.filter((r: any) => {
    const norm = normalizeAccountingClass(r.accounting_class);
    return norm && norm !== r.accounting_class;
  });
  if (toNormalizeInDb.length > 0) {
    for (const r of toNormalizeInDb) {
      const normVal = normalizeAccountingClass(r.accounting_class as string | null | undefined) as string;
      (r as any).accounting_class = normVal;
      await db.execute(sql.raw(
        `UPDATE bank_mutation_imports SET accounting_class = '${normVal}' WHERE id = ${(r as any).id}`
      ));
    }
    logger.info({ batchId, count: toNormalizeInDb.length }, "bank-mutation-import: runtime normalize accounting_class");
  }

  // ── Pisahkan baris yang tidak dikenal (NEED_REVIEW / nilai lain) — skip, jangan blok ──
  const validRows   = pendingRows.filter((r: any) => VALID_ACC_CLASSES.includes(r.accounting_class));
  const skippedRows = pendingRows.filter((r: any) => !VALID_ACC_CLASSES.includes(r.accounting_class));
  const skipped     = skippedRows.length;

  if (validRows.length === 0) {
    return {
      posted: 0, matched: 0, failed: 0, skipped,
      errors: skippedRows.map((r: any) => ({ id: r.id, reason: `accounting_class '${r.accounting_class}' tidak dikenal — baris dilewati` })),
      total: pendingRows.length,
    };
  }

  // ── P1: Blok posting jika company_id NULL ────────────────────────────────────
  const companyId: number | null = batch.company_id ?? null;
  if (!companyId) {
    return {
      posted: 0, matched: 0, failed: 0, skipped: 0, errors: [{
        id: 0,
        reason: `Batch ${batchId} company_id NULL — posting diblokir. Set company_id terlebih dahulu.`,
      }], total: 0,
    };
  }

  // ── P1: Pre-pass — tandai baris yang journal_entry_id IS NOT NULL sebagai SKIPPED_ALREADY_POSTED ──
  // Ini terjadi saat repost batch yang sudah IMPORTED atau ada race condition.
  const { rows: alreadyPostedRows } = await db.execute(sql.raw(`
    SELECT id, status FROM bank_mutation_imports
    WHERE import_batch_id = ${batchId}
      AND journal_entry_id IS NOT NULL
      AND status NOT IN ('REJECTED','DUPLICATE','SKIPPED_ALREADY_POSTED','MATCHED')
  `));
  for (const apr of alreadyPostedRows as any[]) {
    await db.execute(sql.raw(`
      UPDATE bank_mutation_imports
      SET status = 'SKIPPED_ALREADY_POSTED',
          reconciliation_status = 'SKIPPED_ALREADY_POSTED'
      WHERE id = ${apr.id}
    `));
    await auditImportLog({
      batchId, rowId: apr.id, action: 'skipped_already_posted', actor,
      field: 'status', beforeVal: apr.status ?? null, afterVal: 'SKIPPED_ALREADY_POSTED',
      meta: { reason: 'Row already has journal_entry_id (repost detected)' },
    });
  }

  const journalId = await resolveBankJournalId(companyId);
  if (!journalId) return { posted: 0, matched: 0, failed: 0, skipped, errors: [], total: pendingRows.length, noJournal: true };
  let posted  = 0;
  let matched = 0;
  let failed  = 0;
  const errors: { id: number; reason: string }[] = [];

  // Catat baris yang dilewati karena class tidak dikenal
  for (const r of skippedRows as any[]) {
    errors.push({ id: r.id, reason: `accounting_class '${r.accounting_class}' tidak dikenal — baris dilewati` });
  }

  const { postEntry, postIntercompanyPair } = await import("../lib/accounting.js");

  // In-batch caches untuk menghindari query DB berulang per baris
  const coaMappingCache = new Map<string, { coaCode: string; accountingClass: string } | null>();
  const bankCoaCache    = new Map<string, string>();
  const coaIdCache      = new Map<string, number | null>();
  const taxMappingCache = new Map<string, string | null>();

  async function cachedResolveCoaMapping(cat: string | null, txDateHint?: Date) {
    const key = cat ?? "__null__";
    if (coaMappingCache.has(key)) return coaMappingCache.get(key)!;
    const v = await resolveCoaMapping(cat, txDateHint, companyId);
    coaMappingCache.set(key, v);
    return v;
  }
  async function cachedResolveBankCoaCode(bankId: number | null, src: string | null) {
    const key = `${bankId ?? ""}|${src ?? ""}`;
    if (bankCoaCache.has(key)) return bankCoaCache.get(key)!;
    const v = await resolveBankCoaCode(bankId, src);
    bankCoaCache.set(key, v);
    return v;
  }
  async function cachedResolveCoaId(code: string, cId: number | null) {
    const key = `${code}|${cId ?? ""}`;
    if (coaIdCache.has(key)) return coaIdCache.get(key)!;
    const v = await resolveCoaId(code, cId);
    coaIdCache.set(key, v);
    return v;
  }
  async function cachedResolveTaxMapping(tax: string | null) {
    const key = tax ?? "__null__";
    if (taxMappingCache.has(key)) return taxMappingCache.get(key)!;
    const v = await resolveTaxMapping(tax);
    taxMappingCache.set(key, v);
    return v;
  }

  for (const row of validRows as any[]) {
    try {
      // ── P0-2: RECONCILIATION_ONLY — match dulu, jangan buat jurnal ───────────
      if (importMode === 'RECONCILIATION_ONLY') {
        const matchResult = await findMatchingTransaction(row, companyId);
        if (matchResult) {
          await db.execute(sql.raw(`
            UPDATE bank_mutation_imports
            SET reconciliation_status    = 'MATCHED',
                linked_transaction_type  = '${matchResult.type}',
                linked_transaction_id    = ${matchResult.id},
                import_mode              = 'RECONCILIATION_ONLY',
                status                   = 'IMPORTED'
            WHERE id = ${row.id}
          `));
          await auditImportLog({
            batchId, rowId: row.id, action: 'reconciliation_matched', actor,
            field: 'linked_transaction_type', beforeVal: null, afterVal: matchResult.type,
            meta: { linked_transaction_type: matchResult.type, linked_transaction_id: matchResult.id },
          });
          matched++;
          posted++;
        } else {
          await db.execute(sql.raw(`
            UPDATE bank_mutation_imports
            SET reconciliation_status = 'NEED_REVIEW',
                import_mode           = 'RECONCILIATION_ONLY',
                status                = 'NEED_REVIEW'
            WHERE id = ${row.id}
          `));
          await auditImportLog({
            batchId, rowId: row.id, action: 'reconciliation_need_review', actor,
            meta: { reason: 'Tidak ada transaksi matching di aplikasi' },
          });
        }
        if (onProgress && (posted + failed) % 10 === 0) onProgress(posted, failed, validRows.length);
        continue; // skip pembuatan jurnal
      }

      const accClass: string = row.accounting_class;
      const erpCategory: string | null = row.erp_category ?? null;
      const taxType: string | null = row.tax_type ?? null;

      const txDateForCoa = row.transaction_date ? new Date(row.transaction_date) : new Date();
      const masterMapping = await cachedResolveCoaMapping(erpCategory, txDateForCoa);
      const resolvedClass = masterMapping?.accountingClass ?? accClass;
      const bankCoaCode   = await cachedResolveBankCoaCode(row.bank_account_id ?? null, row.source_account ?? null);
      const usedFallbackCoa = !masterMapping; // P0-3: set true jika tidak ada mapping eksplisit

      let drCode: string;
      let crCode: string;

      // Normalize lama→baru di runtime jika masih ada nilai lama di DB
      const normResolved = normalizeAccountingClass(resolvedClass) ?? resolvedClass;

      if (normResolved === "INCOME" || normResolved === "REVENUE") {
        // Dr Bank, Cr Pendapatan
        if (!masterMapping) {
          failed++;
          errors.push({ id: row.id, reason: `Mapping COA pendapatan tidak tersedia untuk erp_category=${erpCategory ?? "NULL"}` });
          continue;
        }
        drCode = bankCoaCode;
        crCode = masterMapping.coaCode;
      } else if (normResolved === "EXPENSE") {
        // Dr Beban, Cr Bank
        const isBankFeeCategory = (erpCategory ?? "").toUpperCase() === "BANK_FEE";
        if (!masterMapping && !isBankFeeCategory) {
          failed++;
          errors.push({ id: row.id, reason: `Mapping COA beban tidak tersedia untuk erp_category=${erpCategory ?? "NULL"}` });
          continue;
        }
        drCode = masterMapping?.coaCode ?? "5-3010";
        crCode = bankCoaCode;
      } else if (normResolved === "TAX" || normResolved === "TAX_PAYMENT") {
        // Dr Hutang Pajak, Cr Bank
        const taxLiabilityCoa = await cachedResolveTaxMapping(taxType);
        if (!taxLiabilityCoa) {
          failed++;
          errors.push({ id: row.id, reason: `Mapping COA pajak aktif tidak tersedia untuk tax_type=${taxType ?? "NULL"}; jurnal tidak dibuat` });
          continue;
        }
        drCode = taxLiabilityCoa;
        crCode = bankCoaCode;
      } else if (normResolved === "TRANSFER" || normResolved === "INTERNAL_TRANSFER") {
        // direction-aware — outflow: Dr Kliring Cr Bank; inflow: Dr Bank Cr Kliring
        const clearingCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.TRANSFER.drCode;
        const isInflow = Number(row.credit || 0) > 0;
        drCode = isInflow ? bankCoaCode  : clearingCode;
        crCode = isInflow ? clearingCode : bankCoaCode;
      } else if (normResolved === "ASSET" || normResolved === "EMPLOYEE_ADVANCE"
               || normResolved === "INTERCOMPANY_LOAN" || normResolved === "LOAN_RECEIVABLE") {
        // Dr Aset/Piutang, Cr Bank  (atau sebaliknya untuk settlement)
        const assetCoa = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.ASSET.drCode;
        if (erpCategory === "THIRD_PARTY_LOAN_GIVEN" || erpCategory === "INTERCOMPANY_LOAN_GIVEN"
          || erpCategory === "EMPLOYEE_ADVANCE" || erpCategory === "REIMBURSEMENT_RECEIVED") {
          drCode = assetCoa;
          crCode = bankCoaCode;
        } else {
          drCode = bankCoaCode;
          crCode = assetCoa;
        }
      } else if (normResolved === "LIABILITY") {
        // Dr Bank, Cr Hutang
        drCode = bankCoaCode;
        crCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.LIABILITY.crCode;
      } else if (normResolved === "LIABILITY_SETTLEMENT" || normResolved === "REIMBURSEMENT") {
        // Dr Hutang, Cr Bank
        drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.LIABILITY_SETTLEMENT.drCode;
        crCode = bankCoaCode;
      } else if (normResolved === "EQUITY") {
        // Dr/Cr Ekuitas sesuai ERP_CATEGORY
        const equityCoa = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.EQUITY.crCode;
        const isInflow = Number(row.credit || 0) > 0;
        drCode = isInflow ? bankCoaCode : equityCoa;
        crCode = isInflow ? equityCoa   : bankCoaCode;
      } else {
        const fb = CLASS_MAP_FALLBACK[normResolved];
        if (!fb) { failed++; errors.push({ id: row.id, reason: `accounting_class '${normResolved}' tidak dikenal` }); continue; }
        drCode = fb.drCode;
        crCode = fb.crCode;
      }

      const drAccId = await cachedResolveCoaId(drCode, companyId);
      const crAccId = await cachedResolveCoaId(crCode, companyId);

      const creditAmt = Number(row.credit || 0);
      const debitAmt  = Number(row.debit  || 0);
      const amount    = creditAmt > 0 ? creditAmt : debitAmt;

      if (!drAccId || !crAccId) {
        failed++;
        errors.push({ id: row.id, reason: `CoA tidak ditemukan: dr=${drCode}, cr=${crCode} (erp_category=${erpCategory}, class=${resolvedClass}, ${Number(row.credit || 0) > 0 ? "inflow" : "outflow"})` });
        continue;
      }
      if (amount <= 0) { failed++; errors.push({ id: row.id, reason: "Jumlah nol atau negatif" }); continue; }

      // ── Fix 4: Anti-double guard — cek unique_key sudah dipost di batch lain ──
      if (row.unique_key) {
        const ukSafe = String(row.unique_key).replace(/'/g, "''");
        const { rows: existingPosted } = await db.execute(sql.raw(`
          SELECT bmi.id FROM bank_mutation_imports bmi
          WHERE bmi.unique_key = '${ukSafe}'
            AND bmi.journal_entry_id IS NOT NULL
            AND bmi.import_batch_id != ${batchId}
          LIMIT 1
        `));
        if (existingPosted.length > 0) {
          const existId = (existingPosted[0] as any).id;
          await db.execute(sql.raw(`
            UPDATE bank_mutation_imports
            SET status = 'SKIPPED_ALREADY_POSTED',
                reconciliation_status = 'SKIPPED_ALREADY_POSTED'
            WHERE id = ${row.id}
          `));
          await auditImportLog({
            batchId, rowId: row.id, action: 'skipped_already_posted', actor,
            field: 'status', beforeVal: row.status ?? null, afterVal: 'SKIPPED_ALREADY_POSTED',
            meta: { reason: 'unique_key sudah diposting di batch lain', existing_id: existId },
          });
          errors.push({ id: row.id, reason: `Dilewati: unique_key sudah diposting di batch lain (id:${existId})` });
          continue;
        }
      }

      const txDate = row.transaction_date ? new Date(row.transaction_date) : new Date();

      // ── P3: Period Lock check ────────────────────────────────────────────────
      const periodCheck = await checkPeriodLock(companyId, txDate);
      if (periodCheck.locked) {
        failed++;
        errors.push({ id: row.id, reason: periodCheck.reason! });
        await db.execute(sql.raw(
          `UPDATE bank_mutation_imports SET status = 'FAILED' WHERE id = ${row.id}`
        ));
        continue;
      }

      // ── P6: Balance Validation (DR = CR) ─────────────────────────────────────
      const journalLines = [
        { debit: amount, credit: 0 },
        { debit: 0, credit: amount },
      ];
      const balanceCheck = validateJournalBalance(journalLines);
      if (!balanceCheck.balanced) {
        failed++;
        const reason = `UNBALANCED_JOURNAL_BLOCKED: ${balanceCheck.detail ?? `imbalance=${balanceCheck.imbalance.toFixed(2)}`}`;
        errors.push({ id: row.id, reason });
        await db.execute(sql.raw(
          `UPDATE bank_mutation_imports SET status = 'FAILED' WHERE id = ${row.id}`
        ));
        logger.warn({ batchId, rowId: row.id, imbalance: balanceCheck.imbalance, detail: balanceCheck.detail }, reason);
        continue;
      }

      // ── P4: Deteksi intercompany SEBELUM posting ──────────────────────────────
      // Jika intercompany, source + mirror di-posting atomic dalam 1 DB transaction.
      // Kalau salah satu gagal → rollback penuh, tidak ada orphan journal.
      const isIntercompany = (normResolved === "INTERCOMPANY_LOAN" || normResolved === "ASSET")
        && erpCategory && erpCategory.toUpperCase().startsWith("INTERCOMPANY_LOAN")
        && companyId && row.counterparty_company_id;

      let entry: Awaited<ReturnType<typeof postEntry>>;
      let icMirrorEntryId: number | null = null;
      let icTargetCompanyId: number | null = null;

      if (isIntercompany) {
        icTargetCompanyId = Number(row.counterparty_company_id);
        const mirrorJournalId = await resolveBankJournalId(icTargetCompanyId);

        if (mirrorJournalId) {
          // ATOMIC: source + mirror dalam satu DB transaction
          const { sourceEntry, mirrorEntry } = await postIntercompanyPair({
            sourceInput: {
              journalId,
              date: txDate,
              description: row.description ?? null,
              ref: row.unique_key ?? null,
              source: "bank_mutation_import" as any,
              companyId,
              lines: [
                { accountId: drAccId, debit: amount, credit: 0, description: row.description ?? null },
                { accountId: crAccId, debit: 0, credit: amount, description: row.description ?? null },
              ],
            },
            mirrorInput: {
              journalId: mirrorJournalId,
              date: txDate,
              description: `[INTERCOMPANY MIRROR] ${row.description ?? ''}`,
              ref: row.unique_key ? `MIR-${String(row.unique_key).slice(0, 30)}` : null,
              source: "bank_mutation_import" as any,
              companyId: icTargetCompanyId,
              lines: [
                // DR/CR dibalik dari source
                { accountId: crAccId, debit: amount, credit: 0, description: row.description ?? null },
                { accountId: drAccId, debit: 0, credit: amount, description: row.description ?? null },
              ],
            },
            sourceJournalCode: "BNK",
            mirrorJournalCode: "BNK",
          });
          entry         = sourceEntry;
          icMirrorEntryId = mirrorEntry.id;
        } else {
          // Tidak ada journal di target company — posting source saja (non-fatal degradation)
          logger.warn({ rowId: row.id, targetCompanyId: icTargetCompanyId },
            "bank-mutation-import: tidak ada bank journal di target company, intercompany mirror dilewati");
          entry = await postEntry(
            {
              journalId,
              date: txDate,
              description: row.description ?? null,
              ref: row.unique_key ?? null,
              source: "bank_mutation_import" as any,
              companyId,
              lines: [
                { accountId: drAccId, debit: amount, credit: 0, description: row.description ?? null },
                { accountId: crAccId, debit: 0, credit: amount, description: row.description ?? null },
              ],
            },
            "BNK",
          );
        }
      } else {
        // Non-intercompany — path normal
        entry = await postEntry(
          {
            journalId,
            date: txDate,
            description: row.description ?? null,
            ref: row.unique_key ?? null,
            source: "bank_mutation_import" as any,
             companyId,
            lines: [
              { accountId: drAccId, debit: amount, credit: 0, description: row.description ?? null },
              { accountId: crAccId, debit: 0, credit: amount, description: row.description ?? null },
            ],
          },
          "BNK",
        );
      }

      await db.execute(sql.raw(
        `UPDATE bank_mutation_imports
         SET journal_entry_id   = ${entry.id},
             status             = 'IMPORTED',
             import_mode        = '${importMode}',
             used_fallback_coa  = ${usedFallbackCoa}
         WHERE id = ${row.id}`
      ));

      await auditImportLog({
        batchId, rowId: row.id, action: "posted", actor,
        field: "journal_entry_id", beforeVal: null, afterVal: String(entry.id),
        meta: { entry_number: (entry as any).entryNumber ?? null, amount, used_fallback_coa: usedFallbackCoa },
      });

      // ── P0-5: TAX_PAYMENT → isi transaction_taxes agar muncul di Tax Report ──
      if (normResolved === "TAX_PAYMENT" || normResolved === "TAX") {
        try {
          const period = txDate.toISOString().slice(0, 7); // YYYY-MM
          const taxTypeName = taxType ?? 'TAX';
          // Lookup tax_id dari accounting_taxes berdasarkan name/code sesuai tax_type
          const { rows: taxLookup } = await db.execute(sql.raw(`
            SELECT id, name, rate FROM accounting_taxes
            WHERE UPPER(name) LIKE UPPER('%${taxTypeName.replace(/'/g, "''")}%')
               OR UPPER(code) = UPPER('${taxTypeName.replace(/'/g, "''")}')
            ORDER BY id ASC
            LIMIT 1
          `));
          if (taxLookup.length) {
            const taxRow = taxLookup[0] as any;
            await db.execute(sql.raw(`
              INSERT INTO transaction_taxes
                (company_id, transaction_type, transaction_id, transaction_ref,
                 tax_id, tax_name, tax_rate, cut_type,
                 base_amount, tax_amount, account_id, period, status)
              VALUES (
                ${companyId},
                'bank_import',
                ${row.id},
                ${(entry as any).entryNumber ? `'${String((entry as any).entryNumber).replace(/'/g, "''")}' ` : 'NULL'},
                ${taxRow.id},
                '${String(taxRow.name).replace(/'/g, "''")}',
                ${Number(taxRow.rate) || 0},
                'self_borne',
                ${amount},
                ${amount},
                ${drAccId},
                '${period}',
                'pending'
              )
              ON CONFLICT (transaction_type, transaction_id, tax_id) DO NOTHING
            `));
          }
        } catch (taxErr: any) {
          logger.warn({ err: taxErr, rowId: row.id }, "bank-mutation-import: transaction_taxes insert failed (non-fatal)");
        }
      }

      // ── P7: Audit event for POST ──────────────────────────────────────────────
      await logAccountingEvent({
        journalId: entry.id, action: 'POST',
        companyId, erpCategory: erpCategory ?? null,
        amount,
        afterState: { entry_number: (entry as any).entryNumber ?? null, dr: drCode, cr: crCode },
        userId: actor, batchId, importRowId: row.id,
      });

      // ── P4: Post-transaction intercompany linkage & audit ─────────────────────
      // Source + mirror sudah ter-commit atomic di atas. Di sini hanya catat:
      // - audit event untuk mirror entry
      // - link di intercompany_mirrors
      // - legacy intercompany_transactions (non-fatal)
      if (isIntercompany && icMirrorEntryId && icTargetCompanyId) {
        await logAccountingEvent({
          journalId: icMirrorEntryId, action: 'POST',
          companyId: icTargetCompanyId, erpCategory: erpCategory ?? null,
          amount,
          afterState: { mirror_of: entry.id, dr: crCode, cr: drCode },
          userId: actor, batchId,
        });
        await db.execute(sql.raw(`
          INSERT INTO intercompany_mirrors
            (source_journal_id, mirror_journal_id, source_company_id,
             target_company_id, status, erp_category, amount, created_by)
          VALUES (
            ${entry.id},
            ${icMirrorEntryId},
            ${companyId},
            ${icTargetCompanyId},
            'MIRRORED',
            ${erpCategory ? `'${erpCategory.replace(/'/g,"''")}'` : 'NULL'},
            ${amount},
            '${actor.replace(/'/g,"''")}'
          )
        `)).catch((e: any) => {
          logger.warn({ err: e, rowId: row.id }, "intercompany_mirrors insert failed (non-fatal)");
        });
        await db.execute(sql.raw(`
          INSERT INTO intercompany_transactions
            (source_company_id, target_company_id, amount, transaction_date,
             reference_no, mutation_row_id, journal_id, erp_category)
          VALUES (
            ${companyId}, ${icTargetCompanyId}, ${amount},
            '${txDate.toISOString().split("T")[0]}',
            ${row.unique_key ? `'${String(row.unique_key).replace(/'/g,"''")}'` : "NULL"},
            ${row.id}, ${entry.id},
            ${erpCategory ? `'${erpCategory.replace(/'/g,"''")}'` : "NULL"}
          )
        `)).catch(() => {});
      } else if (resolvedClass === "INTERCOMPANY_LOAN" && companyId && row.counterparty_company_id) {
        // Legacy path (non-INTERCOMPANY_LOAN_* erpCategory) — non-atomic, biarkan apa adanya
        await db.execute(sql.raw(`
          INSERT INTO intercompany_transactions
            (source_company_id, target_company_id, amount, transaction_date, reference_no, mutation_row_id, journal_id, erp_category)
          VALUES (
            ${companyId}, ${row.counterparty_company_id}, ${amount},
            '${txDate.toISOString().split("T")[0]}',
            ${row.unique_key ? `'${String(row.unique_key).replace(/'/g,"''")}'` : "NULL"},
            ${row.id}, ${entry.id},
            ${erpCategory ? `'${erpCategory.replace(/'/g,"''")}'` : "NULL"}
          )
        `)).catch(() => {});
      }

      posted++;
      // Update progress setiap 10 baris agar polling frontend dapat progres akurat
      if (onProgress && posted % 10 === 0) onProgress(posted, failed, validRows.length);
    } catch (e: any) {
      failed++;
      errors.push({ id: row.id, reason: e?.message ?? "Unknown error" });
      logger.error({ err: e, rowId: row.id }, "bank-mutation-import post row error");
      if (onProgress && failed % 10 === 0) onProgress(posted, failed, validRows.length);
    }
  }

  // Hitung sisa baris yang masih READY (belum diimport) setelah proses selesai
  // Untuk RECONCILIATION_ONLY: NEED_REVIEW dan MATCHED sudah dianggap terproses (tidak blokir IMPORTED)
  const { rows: remainingRows } = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM bank_mutation_imports
    WHERE import_batch_id = ${batchId}
      AND status NOT IN ('IMPORTED','NEED_REVIEW','DUPLICATE','REJECTED','SKIPPED_ALREADY_POSTED','MATCHED')
      AND journal_entry_id IS NULL
      AND accounting_class IS NOT NULL
  `));
  const remainingCount = Number((remainingRows[0] as any)?.cnt ?? 0);

  // Hitung berapa baris NEED_REVIEW untuk menentukan status batch RECONCILIATION_ONLY
  const { rows: needReviewRows } = await db.execute(sql.raw(`
    SELECT COUNT(*) AS cnt FROM bank_mutation_imports
    WHERE import_batch_id = ${batchId}
      AND status = 'NEED_REVIEW'
  `));
  const needReviewCount = Number((needReviewRows[0] as any)?.cnt ?? 0);

  if (importMode === 'RECONCILIATION_ONLY') {
    if (needReviewCount > 0) {
      // Ada baris yang tidak tercocokkan → DRAFT_IMPORT agar admin bisa review
      await db.execute(sql.raw(
        `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${batchId}`
      ));
    } else {
      // Semua tercocokkan → tandai selesai
      await db.execute(sql.raw(
        `UPDATE bank_mutation_import_batches SET status = 'IMPORTED', updated_at = NOW() WHERE id = ${batchId}`
      ));
    }
  } else if (posted > 0 && remainingCount === 0) {
    // HISTORICAL_IMPORT: semua baris berhasil diimport
    await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET status = 'IMPORTED', updated_at = NOW() WHERE id = ${batchId}`
    ));
  } else {
    // Ada sisa baris atau tidak ada yang berhasil → kembalikan ke DRAFT_IMPORT agar bisa dicoba lagi
    await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${batchId}`
    ));
  }

  return { posted, matched, failed, skipped, errors, total: pendingRows.length };
}

// In-memory job tracker: batchId → { running, posted, matched, failed, skipped, total, errors, done }
const postingJobs = new Map<number, {
  running: boolean; done: boolean;
  posted: number; matched: number; failed: number; skipped: number; total: number;
  errors: { id: number; reason: string }[];
  startedAt: number;
}>();

router.post("/:id/post", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  const actor = (req as any).user?.email ?? "system";

  // Cegah double-post
  const existing = postingJobs.get(id);
  if (existing?.running) {
    return res.json({
      accepted: true, running: true,
      posted: existing.posted, matched: existing.matched ?? 0,
      failed: existing.failed, skipped: existing.skipped, total: existing.total,
      message: "Import sedang berjalan di background.",
    });
  }

  try {
    // Validasi cepat sebelum fire-and-forget
    const { rows: batchCheck } = await db.execute(sql.raw(
      `SELECT id, company_id, status FROM bank_mutation_import_batches WHERE id = ${id}`
    ));
    if (!batchCheck.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const batchRow = batchCheck[0] as any;
    if (!batchRow.company_id) return res.status(422).json({ error: "Perusahaan belum dipilih. Set company_id terlebih dahulu." });

    // Jika batch stuck di PROCESSING tapi tidak ada job aktif (misal server restart),
    // otomatis reset agar bisa diproses ulang
    if (batchRow.status === 'PROCESSING' && !postingJobs.get(id)?.running) {
      await db.execute(sql.raw(
        `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${id}`
      ));
    }

    const journalId = await resolveBankJournalId(batchRow.company_id);
    if (!journalId) return res.status(422).json({ error: "Tidak ditemukan jurnal bank (BNK/BANK/GEN). Pastikan jurnal akuntansi sudah disetup untuk perusahaan ini." });

    // Set status PROCESSING di DB
    await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET status = 'PROCESSING', updated_at = NOW() WHERE id = ${id}`
    ));

    // Inisialisasi job tracker
    postingJobs.set(id, { running: true, done: false, posted: 0, matched: 0, failed: 0, skipped: 0, total: 0, errors: [], startedAt: Date.now() });

    // Fire-and-forget
    setImmediate(async () => {
      try {
        const result = await postBatchInternal(id, actor, (posted, failed, total) => {
          // Update job tracker real-time saat proses berjalan
          const job = postingJobs.get(id);
          if (job) { job.posted = posted; job.failed = failed; job.total = total; }
        });
        const job = postingJobs.get(id);
        if (job) {
          job.running = false; job.done = true;
          job.posted = result.posted; job.matched = result.matched ?? 0;
          job.failed = result.failed;
          job.skipped = result.skipped; job.total = result.total;
          job.errors = result.errors;
        }
        // Status batch sudah diupdate di dalam postBatchInternal
        logger.info({ batchId: id, ...result }, "bank-mutation-import: background post completed");
        // ── P1: Bridge — sync ke bank_mutations setelah posting selesai ─────────
        await syncToBankMutations(id);
      } catch (err) {
        const job = postingJobs.get(id);
        if (job) { job.running = false; job.done = true; }
        logger.error({ err, batchId: id }, "bank-mutation-import: background post failed");
        // Reset status agar user bisa coba lagi
        await db.execute(sql.raw(
          `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${id}`
        )).catch(() => {});
      }
    });

    return res.json({ accepted: true, running: true, message: "Import dimulai di background. Halaman akan update otomatis." });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import post error");
    return res.status(500).json({ error: "Gagal memulai import." });
  }
});

// ─── GET /api/bank-mutation-import/:id/post/status ───────────────────────────
// Poll status background posting job
router.get("/:id/post/status", async (req, res) => {
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  const job = postingJobs.get(id);
  if (!job) {
    // Cek status batch dari DB
    const { rows } = await db.execute(sql.raw(
      `SELECT status FROM bank_mutation_import_batches WHERE id = ${id}`
    ));
    const st = rows.length ? (rows[0] as any).status : null;
    // Auto-reset batch yang stuck di PROCESSING tapi tidak ada job aktif di memory
    // (terjadi akibat server restart / crash mid-import)
    if (st === 'PROCESSING') {
      await db.execute(sql.raw(
        `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${id}`
      )).catch(() => {});
      return res.json({ running: false, done: false, status: 'DRAFT_IMPORT' });
    }
    return res.json({ running: false, done: st === 'IMPORTED', status: st });
  }
  return res.json({ ...job });
});

// ─── PATCH /api/bank-mutation-import/:id/mode ────────────────────────────────
// Set import_mode batch: HISTORICAL_IMPORT atau RECONCILIATION_ONLY
router.patch("/:id/mode", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  const { import_mode } = req.body ?? {};
  const VALID_MODES = ["HISTORICAL_IMPORT", "RECONCILIATION_ONLY"];
  if (!VALID_MODES.includes(import_mode)) {
    return res.status(400).json({ error: `import_mode harus salah satu dari: ${VALID_MODES.join(", ")}` });
  }
  try {
    const { rows } = await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches
       SET import_mode = '${import_mode}', updated_at = NOW()
       WHERE id = ${id}
       RETURNING id, import_mode, status`
    ));
    if (!rows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    return res.json({ success: true, batch: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/bank-mutation-import/:id/unpost ───────────────────────────────
// Batalkan posting jurnal dari batch IMPORTED → kembali ke DRAFT_IMPORT.
// Batch & baris tetap ada, audit trail tetap tercatat.
router.post("/:id/unpost", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  const actor = (req as any).user?.email ?? "system";

  try {
    // 1. Cek batch ada dan statusnya IMPORTED
    const { rows: batchRows } = await db.execute(
      sql.raw(`SELECT id, status FROM bank_mutation_import_batches WHERE id = ${id}`)
    );
    if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const batch = batchRows[0] as any;
    if (batch.status !== "IMPORTED") {
      return res.status(400).json({ error: `Batch statusnya ${batch.status}, hanya IMPORTED yang bisa di-unpost.` });
    }

    // 2. Kumpulkan semua journal_entry_id dari baris batch ini
    const { rows: importRows } = await db.execute(
      sql.raw(`SELECT id, journal_entry_id FROM bank_mutation_imports WHERE import_batch_id = ${id} AND journal_entry_id IS NOT NULL`)
    );
    const journalIds: number[] = (importRows as any[])
      .map((r) => Number(r.journal_entry_id))
      .filter((n) => n > 0);

    // 3. P1: Cancel journals (soft — TIDAK hapus, SET status='draft', isi cancelled_*)
    const voidReason = (req.body as any)?.reason ?? 'Unpost by user';
    const voidReasonSafe = String(voidReason).replace(/'/g, "''");
    if (journalIds.length > 0) {
      await db.execute(sql.raw(
        `UPDATE accounting_entries
         SET status        = 'draft',
             cancelled_at  = NOW(),
             cancelled_by  = '${actor.replace(/'/g, "''")}',
             cancel_reason = '${voidReasonSafe}'
         WHERE id IN (${journalIds.join(",")})`
      ));
    }

    // 4. Reset status baris import → READY, journal_entry_id → NULL
    await db.execute(
      sql.raw(`UPDATE bank_mutation_imports SET journal_entry_id = NULL, status = 'READY' WHERE import_batch_id = ${id}`)
    );

    // 5. Reset status batch → DRAFT_IMPORT
    await db.execute(
      sql.raw(`UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', updated_at = NOW() WHERE id = ${id}`)
    );

    // 6. P7: Audit log ke audit_accounting_events
    for (const jId of journalIds) {
      await logAccountingEvent({
        journalId: jId, action: 'VOID', companyId: null,
        beforeState: { entry_status: 'POSTED' },
        afterState: { entry_status: 'VOID', voided_by: actor, void_reason: voidReason },
        userId: actor, batchId: id,
      });
    }
    await auditImportLog({
      batchId: id, rowId: null, action: "unpost", actor,
      field: "status", beforeVal: "IMPORTED", afterVal: "DRAFT_IMPORT",
      meta: { voided_journals: journalIds.length, void_reason: voidReason },
    });

    return res.json({ success: true, reversed_journals: journalIds.length });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import unpost error");
    return res.status(500).json({ error: "Gagal membatalkan posting." });
  }
});

// ─── PATCH /api/bank-mutation-import/:batchId/bulk-classify ──────────────────
// Set accounting_class untuk SEMUA baris NEED_REVIEW di satu batch sekaligus.
router.patch("/:batchId/bulk-classify", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  if (isNaN(batchId)) return res.status(400).json({ error: "ID tidak valid." });
  const { accounting_class } = req.body as { accounting_class?: string };
  const VALID = ["INCOME","EXPENSE","ASSET","LIABILITY","LIABILITY_SETTLEMENT","EQUITY","TRANSFER","TAX"];
  if (!accounting_class || !VALID.includes(accounting_class))
    return res.status(400).json({ error: `accounting_class harus salah satu dari: ${VALID.join(", ")}` });
  const actor = (req as any).user?.email ?? "system";

  // ── Ownership: verify batch belongs to resolvedCompanyId ──────────────────
  const resolvedCid = resolveCompanyId(req);
  const isSuperAdmin = (req as any).user?.role === "super_admin";
  const { rows: batchRows } = await db.execute(sql.raw(
    `SELECT id, company_id FROM bank_mutation_import_batches WHERE id = ${batchId} LIMIT 1`
  ));
  if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
  const batchCompanyId = (batchRows[0] as any).company_id as number | null;
  if (!isSuperAdmin && batchCompanyId !== null && batchCompanyId !== resolvedCid) {
    const meta = extractRequestMeta(req);
    writeAuditLog({
      ...meta, companyId: resolvedCid, action: "BULK_OPERATION_DENIED", module: "bank-mutation-import",
      newData: {
        operationType: "bulk-classify", batchId, batchCompanyId,
        timestamp: new Date().toISOString(),
      },
    });
    return res.status(403).json({ error: "Akses ditolak: batch ini bukan milik perusahaan Anda." });
  }

  try {
    const { rows } = await db.execute(sql.raw(
      `UPDATE bank_mutation_imports
       SET accounting_class = '${accounting_class}', status = 'DRAFT', reviewed_at = NOW()
       WHERE import_batch_id = ${batchId}
         AND journal_entry_id IS NULL
         AND (accounting_class IS NULL OR accounting_class = 'NEED_REVIEW' OR status = 'NEED_REVIEW')
       RETURNING id`
    ));
    const meta = extractRequestMeta(req);
    writeAuditLog({
      ...meta, companyId: resolvedCid, action: "BULK_OPERATION_VERIFIED", module: "bank-mutation-import",
      newData: {
        operationType: "bulk-classify", batchId, recordCount: rows.length,
        accounting_class, timestamp: new Date().toISOString(),
      },
    });
    await auditImportLog({ batchId, rowId: null as any, action: "bulk_classify", actor,
      field: "accounting_class", beforeVal: "NEED_REVIEW", afterVal: accounting_class });
    return res.json({ updated: rows.length, accounting_class });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/bank-mutation-import/repost-all-draft ─────────────────────────
// Re-run posting untuk semua batch yang masih DRAFT_IMPORT.
// Berguna setelah migration normalisasi accounting_class atau setelah repair.
// Scoped ke resolvedCompanyId; super_admin bisa repost semua perusahaan.
router.post("/repost-all-draft", async (req, res) => {
  await runBankMutationImportMigration();
  const actor = (req as any).user?.email ?? "system";
  const resolvedCid = resolveCompanyId(req);
  const isSuperAdmin = (req as any).user?.role === "super_admin";

  const meta = extractRequestMeta(req);
  writeAuditLog({
    ...meta, companyId: resolvedCid, action: "BULK_OPERATION_VERIFIED", module: "bank-mutation-import",
    newData: {
      operationType: "repost-all-draft", scope: isSuperAdmin ? "all-companies" : `company:${resolvedCid}`,
      timestamp: new Date().toISOString(),
    },
  });

  try {
    // Super-admin: repost semua company. Regular admin: hanya company mereka sendiri.
    const companyFilter = isSuperAdmin
      ? ""
      : `AND company_id = ${resolvedCid}`;
    const { rows: draftBatches } = await db.execute(sql.raw(`
      SELECT id FROM bank_mutation_import_batches
      WHERE status = 'DRAFT_IMPORT' ${companyFilter}
      ORDER BY id ASC
    `));

    if (!draftBatches.length) {
      return res.json({ success: true, message: "Tidak ada batch DRAFT_IMPORT.", batches: 0, posted: 0, failed: 0, skipped: 0 });
    }

    let totalPosted  = 0;
    let totalFailed  = 0;
    let totalSkipped = 0;
    const batchResults: { batchId: number; posted: number; failed: number; skipped: number; errors: { id: number; reason: string }[] }[] = [];

    for (const b of draftBatches as any[]) {
      const batchId = Number(b.id);
      try {
        const result = await postBatchInternal(batchId, actor);
        totalPosted  += result.posted;
        totalFailed  += result.failed;
        totalSkipped += result.skipped;
        batchResults.push({ batchId, posted: result.posted, failed: result.failed, skipped: result.skipped, errors: result.errors });
        logger.info({ batchId, posted: result.posted, failed: result.failed, skipped: result.skipped }, "repost-all-draft: batch selesai");
      } catch (e: any) {
        totalFailed++;
        batchResults.push({ batchId, posted: 0, failed: 1, skipped: 0, errors: [{ id: 0, reason: e?.message ?? "Unknown error" }] });
        logger.error({ err: e, batchId }, "repost-all-draft: batch error");
      }
    }

    logger.info({ totalPosted, totalFailed, totalSkipped, batchCount: draftBatches.length, actor }, "repost-all-draft selesai");

    // ── P5: Breakdown company, ERP_CATEGORY, bank account setelah repost ──────
    const { rows: companyBreakdown } = await db.execute(sql.raw(`
      SELECT
        b.company_id,
        COALESCE(c.name, 'Unknown') AS company_name,
        COUNT(DISTINCT b.id)        AS total_batches,
        COUNT(bmi.id)               AS total_rows,
        SUM(CASE WHEN bmi.status = 'IMPORTED' THEN 1 ELSE 0 END) AS posted,
        SUM(CASE WHEN bmi.status != 'IMPORTED' AND bmi.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS unposted
      FROM bank_mutation_import_batches b
      LEFT JOIN bank_mutation_imports bmi ON bmi.import_batch_id = b.id
      LEFT JOIN companies c ON c.id = b.company_id
      GROUP BY b.company_id, c.name
      ORDER BY b.company_id NULLS LAST
    `)).catch(() => ({ rows: [] }));

    const { rows: erpBreakdown } = await db.execute(sql.raw(`
      SELECT
        COALESCE(bmi.erp_category, '(null)') AS erp_category,
        bmi.accounting_class,
        COUNT(*)                              AS total,
        SUM(CASE WHEN bmi.status = 'IMPORTED' THEN 1 ELSE 0 END) AS posted,
        SUM(CASE WHEN bmi.status != 'IMPORTED' AND bmi.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS unposted
      FROM bank_mutation_imports bmi
      GROUP BY bmi.erp_category, bmi.accounting_class
      ORDER BY total DESC
    `)).catch(() => ({ rows: [] }));

    const { rows: bankBreakdown } = await db.execute(sql.raw(`
      SELECT
        COALESCE(bmi.source_account, '(null)') AS source_account,
        mba.account_name                        AS bank_account_name,
        mba.coa_code                            AS bank_coa_code,
        COUNT(*)                                AS total,
        SUM(CASE WHEN bmi.status = 'IMPORTED' THEN 1 ELSE 0 END) AS posted,
        SUM(CASE WHEN bmi.status != 'IMPORTED' AND bmi.journal_entry_id IS NULL THEN 1 ELSE 0 END) AS unposted
      FROM bank_mutation_imports bmi
      LEFT JOIN master_bank_accounts mba
        ON mba.is_active = TRUE
        AND (mba.account_name ILIKE '%' || bmi.source_account || '%'
          OR mba.bank_name ILIKE '%' || bmi.source_account || '%')
      GROUP BY bmi.source_account, mba.account_name, mba.coa_code
      ORDER BY total DESC
    `)).catch(() => ({ rows: [] }));

    // Ringkasan total jurnal
    const { rows: journalSummary } = await db.execute(sql.raw(`
      SELECT
        COUNT(DISTINCT bmi.journal_entry_id) AS total_journals_created,
        COUNT(DISTINCT ael.id)               AS total_journal_lines,
        SUM(bmi.debit)                       AS total_debit,
        SUM(bmi.credit)                      AS total_credit
      FROM bank_mutation_imports bmi
      LEFT JOIN accounting_entry_lines ael ON ael.entry_id = bmi.journal_entry_id
      WHERE bmi.journal_entry_id IS NOT NULL
    `)).catch(() => ({ rows: [{ total_journals_created: 0, total_journal_lines: 0, total_debit: 0, total_credit: 0 }] }));

    const summary = journalSummary[0] as any ?? {};

    return res.json({
      success: true,
      batches:  draftBatches.length,
      posted:   totalPosted,
      failed:   totalFailed,
      skipped:  totalSkipped,
      total_journals_created: Number(summary.total_journals_created ?? 0),
      total_journal_lines:    Number(summary.total_journal_lines ?? 0),
      total_debit:            Number(summary.total_debit ?? 0),
      total_credit:           Number(summary.total_credit ?? 0),
      company_breakdown:      companyBreakdown,
      erp_category_breakdown: erpBreakdown,
      bank_breakdown:         bankBreakdown,
      batch_results:          batchResults,
    });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import repost-all-draft error");
    return res.status(500).json({ error: "Gagal re-post batch." });
  }
});

// ─── GET /api/bank-mutation-import/audit-log ──────────────────────────────────
// Audit log sistem keseluruhan (bisa difilter by actor, action, batch, date)
router.get("/audit-log", async (req, res) => {
  await runBankMutationImportMigration();
  const { batch_id, actor, action, from, to, limit = "100", offset = "0" } = req.query as Record<string, string>;
  const conds: string[] = [];
  if (batch_id) conds.push(`a.batch_id = ${Number(batch_id)}`);
  if (actor) conds.push(`a.actor ILIKE '%${actor.replace(/'/g, "''")}%'`);
  if (action) conds.push(`a.action = '${action.replace(/'/g, "''")}'`);
  if (from)  conds.push(`a.created_at >= '${from}'`);
  if (to)    conds.push(`a.created_at <= '${to}'::date + interval '1 day'`);
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT a.*,
        b.filename AS batch_filename,
        bmi.description AS row_description,
        bmi.transaction_date AS row_date
      FROM bank_mutation_import_audit a
      LEFT JOIN bank_mutation_import_batches b ON b.id = a.batch_id
      LEFT JOIN bank_mutation_imports bmi ON bmi.id = a.row_id
      ${where}
      ORDER BY a.created_at DESC
      LIMIT ${Math.min(parseInt(limit) || 100, 500)}
      OFFSET ${parseInt(offset) || 0}
    `));
    const { rows: countRows } = await db.execute(sql.raw(
      `SELECT COUNT(*) AS total FROM bank_mutation_import_audit a ${where}`
    ));
    return res.json({ logs: rows, total: Number((countRows[0] as any)?.total ?? 0) });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import audit-log error");
    return res.status(500).json({ error: "Gagal mengambil audit log." });
  }
});

// ─── GET /api/bank-mutation-import/:id/audit-log ─────────────────────────────
// Audit log untuk batch tertentu
router.get("/:id/audit-log", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT a.*,
        bmi.description AS row_description,
        bmi.transaction_date AS row_date,
        bmi.debit AS row_debit,
        bmi.credit AS row_credit
      FROM bank_mutation_import_audit a
      LEFT JOIN bank_mutation_imports bmi ON bmi.id = a.row_id
      WHERE a.batch_id = ${id}
      ORDER BY a.created_at DESC
      LIMIT 500
    `));
    return res.json({ logs: rows });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import batch audit-log error");
    return res.status(500).json({ error: "Gagal mengambil audit log batch." });
  }
});

// ─── GET /api/bank-mutation-import/recon ─────────────────────────────────────
// Data rekonsiliasi: bank_mutation_imports vs accounting_entries
router.get("/recon", async (req, res) => {
  await runBankMutationImportMigration();
  const { date_from, date_to, status } = req.query as Record<string, string>;
  const conditions: string[] = [];
  if (date_from) conditions.push(`bmi.transaction_date >= '${date_from}'`);
  if (date_to)   conditions.push(`bmi.transaction_date <= '${date_to}'`);
  if (status === "MATCHED")   conditions.push("bmi.journal_entry_id IS NOT NULL");
  if (status === "UNMATCHED") conditions.push("bmi.journal_entry_id IS NULL AND bmi.status != 'DRAFT'");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        bmi.id, bmi.transaction_date, bmi.description, bmi.debit, bmi.credit,
        bmi.accounting_class, bmi.erp_category, bmi.status,
        bmi.journal_entry_id, bmi.import_batch_id,
        ae.entry_number, ae.total_debit AS je_debit, ae.total_credit AS je_credit,
        ae.date AS je_date,
        b.filename
      FROM bank_mutation_imports bmi
      LEFT JOIN accounting_entries ae ON ae.id = bmi.journal_entry_id
      LEFT JOIN bank_mutation_import_batches b ON b.id = bmi.import_batch_id
      ${where}
      ORDER BY bmi.transaction_date DESC NULLS LAST, bmi.id DESC
      LIMIT 500
    `));
    return res.json({ rows });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import recon error");
    return res.status(500).json({ error: "Gagal mengambil data rekonsiliasi." });
  }
});

// ─── P1: POST /api/bank-mutation-import/:batchId/rows/:rowId/reject ──────────
router.post("/:batchId/rows/:rowId/reject", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  const rowId   = parseInt(String(req.params.rowId),   10);
  if (isNaN(batchId) || isNaN(rowId)) return res.status(400).json({ error: "ID tidak valid." });
  const actor  = (req as any).user?.email ?? "system";
  const reason = String(req.body?.reason ?? "Ditolak oleh reviewer").replace(/'/g, "''");
  try {
    const { rows: before } = await db.execute(sql.raw(
      `SELECT status FROM bank_mutation_imports WHERE id = ${rowId} AND import_batch_id = ${batchId}`
    ));
    if (!before.length) return res.status(404).json({ error: "Baris tidak ditemukan." });
    const prevStatus = (before[0] as any).status;
    await db.execute(sql.raw(`
      UPDATE bank_mutation_imports
      SET status = 'REJECTED', rejection_reason = '${reason}', rejected_by = '${actor.replace(/'/g, "''")}', rejected_at = NOW()
      WHERE id = ${rowId} AND import_batch_id = ${batchId}
    `));
    await auditImportLog({ batchId, rowId, action: "row_rejected", actor,
      field: "status", beforeVal: prevStatus, afterVal: "REJECTED",
      meta: { reason, rejected_by: actor } });
    return res.json({ success: true, id: rowId, status: "REJECTED" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── P1: POST /api/bank-mutation-import/:batchId/rows/:rowId/duplicate ───────
// 🔐 LOCKED: hanya super_admin / owner yang boleh akses endpoint ini
router.post("/:batchId/rows/:rowId/duplicate", async (req, res) => {
  const userRole = (
    (req as any).user?.role
    ?? (req as any).user?.publicMetadata?.role
    ?? (req as any).user?.privateMetadata?.role
    ?? ""
  );
  if (!["super_admin", "superadmin", "owner"].includes(String(userRole).toLowerCase())) {
    logger.warn({ userRole, path: req.path }, "[bankMutationImport] /duplicate: akses ditolak (bukan super_admin)");
    return res.status(403).json({ error: "Akses ditolak. Endpoint ini hanya untuk super admin." });
  }
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  const rowId   = parseInt(String(req.params.rowId),   10);
  if (isNaN(batchId) || isNaN(rowId)) return res.status(400).json({ error: "ID tidak valid." });
  const actor  = (req as any).user?.email ?? "system";
  const reason = String(req.body?.reason ?? "Ditandai duplikat oleh reviewer").replace(/'/g, "''");
  try {
    const { rows: before } = await db.execute(sql.raw(
      `SELECT status FROM bank_mutation_imports WHERE id = ${rowId} AND import_batch_id = ${batchId}`
    ));
    if (!before.length) return res.status(404).json({ error: "Baris tidak ditemukan." });
    const prevStatus = (before[0] as any).status;
    await db.execute(sql.raw(`
      UPDATE bank_mutation_imports
      SET status = 'DUPLICATE', rejection_reason = '${reason}', rejected_by = '${actor.replace(/'/g, "''")}', rejected_at = NOW()
      WHERE id = ${rowId} AND import_batch_id = ${batchId}
    `));
    await auditImportLog({ batchId, rowId, action: "row_marked_duplicate", actor,
      field: "status", beforeVal: prevStatus, afterVal: "DUPLICATE",
      meta: { reason, marked_by: actor } });
    return res.json({ success: true, id: rowId, status: "DUPLICATE" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── P1: POST /api/bank-mutation-import/:batchId/rows/:rowId/reset ────────────
router.delete("/:batchId/rows/:rowId", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  const rowId   = parseInt(String(req.params.rowId),   10);
  if (isNaN(batchId) || isNaN(rowId)) return res.status(400).json({ error: "ID tidak valid." });
  const actor = (req as any).user?.email ?? "system";

  try {
    const { rows: importRows } = await db.execute(sql.raw(`
      SELECT id, journal_entry_id, status, import_batch_id
      FROM bank_mutation_imports
      WHERE id = ${rowId} AND import_batch_id = ${batchId}
      LIMIT 1
    `));
    if (!importRows.length) return res.status(404).json({ error: "Baris tidak ditemukan." });
    const row = importRows[0] as any;

    const journalId: number | null = row.journal_entry_id ? Number(row.journal_entry_id) : null;

    if (journalId) {
      await db.execute(sql.raw(`
        UPDATE accounting_entries
        SET status        = 'draft',
            cancelled_at  = NOW(),
            cancelled_by  = '${actor.replace(/'/g, "''")}',
            cancel_reason = 'Deleted by user (per-row delete)'
        WHERE id = ${journalId}
      `));
      await db.execute(sql.raw(`DELETE FROM accounting_entry_lines WHERE entry_id = ${journalId}`));
      await db.execute(sql.raw(`DELETE FROM accounting_entries WHERE id = ${journalId}`));
    }

    await db.execute(sql.raw(`
      UPDATE bank_mutation_imports
      SET journal_entry_id = NULL,
          status           = 'READY',
          reconciliation_status = NULL,
          linked_transaction_type = NULL,
          linked_transaction_id   = NULL,
          updated_at = NOW()
      WHERE id = ${rowId}
    `));

    await db.execute(sql.raw(`
      UPDATE bank_mutation_normalized_entries
      SET status = 'NEED_REVIEW', journal_entry_id = NULL, updated_at = NOW()
      WHERE row_id = ${rowId} AND batch_id = ${batchId}
        AND journal_entry_id ${journalId ? `= ${journalId}` : 'IS NULL'}
    `)).catch(() => {});

    const { rows: remaining } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_mutation_imports
      WHERE import_batch_id = ${batchId} AND status = 'IMPORTED'
    `));
    const remainingImported = Number((remaining[0] as any)?.cnt ?? 0);
    if (remainingImported === 0) {
      await db.execute(sql.raw(`
        UPDATE bank_mutation_import_batches
        SET status = 'DRAFT_IMPORT', updated_at = NOW()
        WHERE id = ${batchId}
      `));
    }

    await auditImportLog({
      batchId, rowId, action: 'row_deleted', actor,
      field: 'journal_entry_id', beforeVal: journalId ? String(journalId) : null, afterVal: null,
      meta: { deleted_journal_id: journalId, remaining_imported: remainingImported },
    });

    return res.json({ success: true, deleted_journal_id: journalId });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import row delete error");
    return res.status(500).json({ error: "Gagal menghapus transaksi." });
  }
});

router.post("/:batchId/rows/:rowId/reset", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  const rowId   = parseInt(String(req.params.rowId),   10);
  if (isNaN(batchId) || isNaN(rowId)) return res.status(400).json({ error: "ID tidak valid." });
  const actor = (req as any).user?.email ?? "system";
  try {
    const { rows: before } = await db.execute(sql.raw(
      `SELECT status, journal_entry_id, accounting_class FROM bank_mutation_imports WHERE id = ${rowId} AND import_batch_id = ${batchId}`
    ));
    if (!before.length) return res.status(404).json({ error: "Baris tidak ditemukan." });
    const row = before[0] as any;
    if (row.journal_entry_id) {
      return res.status(400).json({ error: "Baris sudah memiliki jurnal. Lakukan unpost batch terlebih dahulu." });
    }
    const prevStatus = row.status;
    const newStatus  = row.accounting_class && row.accounting_class !== "NEED_REVIEW" ? "READY" : "NEED_REVIEW";
    await db.execute(sql.raw(`
      UPDATE bank_mutation_imports
      SET status = '${newStatus}', rejection_reason = NULL, rejected_by = NULL, rejected_at = NULL
      WHERE id = ${rowId} AND import_batch_id = ${batchId}
    `));
    await auditImportLog({ batchId, rowId, action: "row_reset", actor,
      field: "status", beforeVal: prevStatus, afterVal: newStatus,
      meta: { reset_by: actor } });
    return res.json({ success: true, id: rowId, status: newStatus });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── P1: POST /api/bank-mutation-import/:batchId/reject ───────────────────────
router.post("/:batchId/reject", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  if (isNaN(batchId)) return res.status(400).json({ error: "ID tidak valid." });
  const actor  = (req as any).user?.email ?? "system";
  const reason = String(req.body?.reason ?? "Batch ditolak oleh reviewer").replace(/'/g, "''");
  try {
    const { rows: batchRows } = await db.execute(sql.raw(
      `SELECT id, status FROM bank_mutation_import_batches WHERE id = ${batchId}`
    ));
    if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const prevStatus = (batchRows[0] as any).status;
    if (prevStatus === "IMPORTED") {
      return res.status(400).json({ error: "Batch sudah IMPORTED. Lakukan unpost terlebih dahulu." });
    }
    await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET status = 'REJECTED', notes = '${reason}', updated_at = NOW() WHERE id = ${batchId}`
    ));
    await auditImportLog({ batchId, rowId: null, action: "batch_rejected", actor,
      field: "status", beforeVal: prevStatus, afterVal: "REJECTED",
      meta: { reason, rejected_by: actor } });
    return res.json({ success: true, batchId, status: "REJECTED" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── P1: POST /api/bank-mutation-import/:batchId/reopen ──────────────────────
router.post("/:batchId/reopen", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  if (isNaN(batchId)) return res.status(400).json({ error: "ID tidak valid." });
  const actor = (req as any).user?.email ?? "system";
  try {
    const { rows: batchRows } = await db.execute(sql.raw(
      `SELECT id, status FROM bank_mutation_import_batches WHERE id = ${batchId}`
    ));
    if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const prevStatus = (batchRows[0] as any).status;
    await db.execute(sql.raw(
      `UPDATE bank_mutation_import_batches SET status = 'DRAFT_IMPORT', notes = NULL, updated_at = NOW() WHERE id = ${batchId}`
    ));
    await auditImportLog({ batchId, rowId: null, action: "batch_reopened", actor,
      field: "status", beforeVal: prevStatus, afterVal: "DRAFT_IMPORT",
      meta: { reopened_by: actor } });
    return res.json({ success: true, batchId, status: "DRAFT_IMPORT" });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/bank-mutation-import/:batchId/reprocess-bs ────────────────────
// Jalankan ulang Step A & B BS-HANDLER pada batch yang sudah ada.
// Berguna untuk promote entries NEED_REVIEW lama setelah fix logika BS/multi-company.
router.post("/:batchId/reprocess-bs", async (req, res) => {
  await runBankMutationImportMigration();
  const batchId = parseInt(String(req.params.batchId), 10);
  if (isNaN(batchId)) return res.status(400).json({ error: "ID tidak valid." });
  try {
    const { rows: batchRows } = await db.execute(sql.raw(
      `SELECT id, company_id, status, import_mode FROM bank_mutation_import_batches WHERE id = ${batchId}`
    ));
    if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const batch = batchRows[0] as any;
    const importMode: string = batch.import_mode ?? 'HISTORICAL_IMPORT';

    let promotedBs = 0;
    let promotedIc = 0;

    if (importMode === 'HISTORICAL_IMPORT') {
      // Step A: BALANCE_SHEET entries
      const { rows: bsRows } = await db.execute(sql.raw(`
        SELECT id FROM bank_mutation_normalized_entries
        WHERE batch_id = ${batchId}
          AND status = 'NEED_REVIEW'
          AND UPPER(COALESCE(pl_flag,'')) = 'BALANCE_SHEET'
          AND (
            erp_category ILIKE 'REVENUE_%'
            OR erp_category ILIKE 'EXPENSE_%'
            OR erp_category ILIKE '%_EXPENSE'
            OR UPPER(erp_category) IN ('RENTAL_CAR_EXPENSE','PREPAID_RENT','SECURITY_DEPOSIT','INTERCOMPANY_SETTLEMENT')
            OR accounting_class IN ('ASSET','LIABILITY_SETTLEMENT')
          )
          AND coa_debit  IS NOT NULL AND coa_debit  != ''
          AND coa_credit IS NOT NULL AND coa_credit != ''
          AND (amount IS NOT NULL AND amount > 0)
      `));
      for (const r of bsRows as any[]) {
        await db.execute(sql.raw(
          `UPDATE bank_mutation_normalized_entries SET status = 'READY', subledger_status = 'EXEMPT', updated_at = NOW() WHERE id = ${r.id}`
        ));
        promotedBs++;
      }

      // Step B: INTERNAL_TRANSFER multi-company Diva
      const { rows: icRows } = await db.execute(sql.raw(`
        SELECT id FROM bank_mutation_normalized_entries
        WHERE batch_id = ${batchId}
          AND status = 'NEED_REVIEW'
          AND accounting_class IN ('TRANSFER', 'INTERNAL_TRANSFER')
          AND (revenue_company_id IS NOT NULL OR collecting_company_id IS NOT NULL)
          AND coa_debit  IS NOT NULL AND coa_debit  != ''
          AND coa_credit IS NOT NULL AND coa_credit != ''
      `));
      for (const r of icRows as any[]) {
        await db.execute(sql.raw(
          `UPDATE bank_mutation_normalized_entries SET status = 'READY', updated_at = NOW() WHERE id = ${r.id}`
        ));
        promotedIc++;
      }
    }

    const totalPromoted = promotedBs + promotedIc;
    logger.info({ batchId, promotedBs, promotedIc }, '[reprocess-bs] selesai');
    return res.json({
      success: true, batchId,
      promoted: totalPromoted, promotedBs, promotedIc,
      message: totalPromoted > 0
        ? `${totalPromoted} baris dipromote ke READY (${promotedBs} Balance Sheet, ${promotedIc} Internal Transfer Diva)`
        : "Tidak ada baris NEED_REVIEW yang memenuhi syarat untuk dipromote.",
    });
  } catch (e: any) {
    logger.error({ err: e, batchId }, '[reprocess-bs] error');
    return res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/bank-mutation-import/:id ────────────────────────────────────
router.delete("/:id", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

  try {
    // 1. Kumpulkan journal_entry_id yang terkait batch ini
    const rows = await db.execute(
      sql.raw(`SELECT journal_entry_id FROM bank_mutation_imports WHERE import_batch_id = ${id} AND journal_entry_id IS NOT NULL`)
    );
    const journalIds: number[] = (rows.rows ?? [])
      .map((r: any) => Number(r.journal_entry_id))
      .filter((n: number) => n > 0);

    // 2. Cancel dulu (posted → draft) agar trigger immutability tidak blokir DELETE
    const actor = (req as any).user?.email ?? "system";
    if (journalIds.length > 0) {
      await db.execute(sql.raw(
        `UPDATE accounting_entries
         SET status        = 'draft',
             cancelled_at  = NOW(),
             cancelled_by  = '${actor.replace(/'/g, "''")}',
             cancel_reason = 'Batch deleted by user'
         WHERE id IN (${journalIds.join(",")}) AND status = 'posted'`
      ));
    }

    // 3. Hapus accounting_entries → accounting_entry_lines ikut CASCADE
    if (journalIds.length > 0) {
      await db.execute(
        sql.raw(`DELETE FROM accounting_entries WHERE id IN (${journalIds.join(",")})`)
      );
    }

    // 3. Hapus baris import (set null FK sudah handle, tapi hapus eksplisit lebih bersih)
    await db.execute(
      sql.raw(`DELETE FROM bank_mutation_imports WHERE import_batch_id = ${id}`)
    );

    // 4. Hapus batch (bank_mutation_import_rows ikut CASCADE)
    await db.execute(
      sql.raw(`DELETE FROM bank_mutation_import_batches WHERE id = ${id}`)
    );

    return res.json({ success: true, deleted_journals: journalIds.length });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import delete error");
    return res.status(500).json({ error: "Gagal menghapus batch." });
  }
});

// ─── GET /api/bank-mutation-import/:id/normalized ────────────────────────────
// Ambil semua normalized entries untuk satu batch
router.get("/:id/normalized", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  try {
    // §5 Hanya tampilkan entries aktif (bukan SUPERSEDED) ke UI
    const { rows } = await db.execute(sql.raw(`
      SELECT ne.*,
             ae.entry_number AS journal_entry_number
      FROM bank_mutation_normalized_entries ne
      LEFT JOIN accounting_entries ae ON ae.id = ne.journal_entry_id
      WHERE ne.batch_id = ${id}
        AND ne.status != 'SUPERSEDED'
      ORDER BY ne.transaction_date ASC, ne.id ASC
    `));
    const { rows: summary } = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                              AS total,
        SUM(CASE WHEN status = 'READY'        THEN 1 ELSE 0 END)            AS ready,
        SUM(CASE WHEN status = 'NEED_REVIEW'  THEN 1 ELSE 0 END)            AS need_review,
        SUM(CASE WHEN status = 'POSTED'       THEN 1 ELSE 0 END)            AS posted,
        SUM(CASE WHEN status = 'MATCHED'      THEN 1 ELSE 0 END)            AS matched,
        SUM(CASE WHEN status = 'DUPLICATE'    THEN 1 ELSE 0 END)            AS duplicate,
        SUM(CASE WHEN used_fallback_coa = TRUE THEN 1 ELSE 0 END)           AS fallback_coa_count,
        SUM(CASE WHEN coa_drift = TRUE        THEN 1 ELSE 0 END)            AS coa_drift_count,
        (SELECT COUNT(*) FROM bank_mutation_normalized_entries
         WHERE batch_id = ${id} AND status = 'SUPERSEDED')                  AS superseded_count,
        COALESCE(MAX(version), 1)                                            AS version_max
      FROM bank_mutation_normalized_entries
      WHERE batch_id = ${id} AND status != 'SUPERSEDED'
    `));
    return res.json({ rows, summary: summary[0] ?? {} });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import normalized list error");
    return res.status(500).json({ error: "Gagal mengambil normalized entries." });
  }
});

// ─── PATCH /api/bank-mutation-import/normalized/:entryId ─────────────────────
// Update status / coa_debit / coa_credit / erp_category satu normalized entry
// §4 IMMUTABILITY: jika entry sudah POSTED, field kritis TIDAK BISA diedit.
router.patch("/normalized/:entryId", async (req, res) => {
  await runBankMutationImportMigration();
  const entryId = parseInt(String(req.params.entryId), 10);
  if (isNaN(entryId)) return res.status(400).json({ error: "ID tidak valid." });
  const { status, coa_debit, coa_credit, erp_category, accounting_class, cost_center_id } = req.body as {
    status?: string; coa_debit?: string; coa_credit?: string;
    erp_category?: string; accounting_class?: string; cost_center_id?: string;
  };
  const actor = (req as any).user?.email ?? "system";

  // §4 Fetch current entry untuk immutability check
  const { rows: existing } = await db.execute(sql.raw(
    `SELECT id, status, batch_id, row_id FROM bank_mutation_normalized_entries WHERE id = ${entryId}`
  ));
  if (!existing.length) return res.status(404).json({ error: "Entry tidak ditemukan." });
  const currentEntry = existing[0] as any;

  // ── SAP HARDENING FASE 2: Revenue Engine Lock ──────────────────────────────
  // checkRevenueFieldLock() memblokir edit field kritis jika entry sudah POSTED.
  {
    const attemptedFields = Object.keys(req.body ?? {});
    const revLock = checkRevenueFieldLock(currentEntry.status, attemptedFields);
    if (revLock.blocked) {
      await reportImmutabilityViolation({
        companyId: currentEntry.company_id ?? null,
        entryId: entryId,
        attemptedAction: "UPDATE",
        actor,
      }).catch(() => {});
      await queueIntegrityError({
        companyId: currentEntry.company_id ?? null,
        classification: "HIGH",
        module: "bank_mutation",
        errorCode: "REVENUE_FIELD_LOCKED",
        message: revLock.message ?? `Update diblokir — entry ${entryId} sudah POSTED`,
        context: { entryId, attemptedFields, blockedFields: revLock.blockedFields, actor },
        entityType: "normalized_entry",
        entityId: String(entryId),
      }).catch(() => {});
      return res.status(409).json({
        error: revLock.message,
        code: "REVENUE_FIELD_LOCKED",
        blockedFields: revLock.blockedFields,
      });
    }
  }

  const VALID_NE_STATUSES = ['READY', 'NEED_REVIEW', 'MATCHED', 'DUPLICATE'];
  if (status && !VALID_NE_STATUSES.includes(status))
    return res.status(400).json({ error: `Status tidak valid. Gunakan: ${VALID_NE_STATUSES.join(', ')}` });

  const sets: string[] = [];
  if (status)           sets.push(`status = '${status}'`);
  if (coa_debit)        sets.push(`coa_debit = '${coa_debit.replace(/'/g, "''")}'`);
  if (coa_credit)       sets.push(`coa_credit = '${coa_credit.replace(/'/g, "''")}'`);
  if (erp_category)     sets.push(`erp_category = '${erp_category.replace(/'/g, "''")}'`);
  if (accounting_class) sets.push(`accounting_class = '${accounting_class.replace(/'/g, "''")}'`);
  if (cost_center_id)   sets.push(`cost_center_id = '${cost_center_id.replace(/'/g, "''")}'`);
  if (!sets.length) return res.status(400).json({ error: "Tidak ada field yang diupdate." });
  sets.push("updated_at = NOW()");

  try {
    const { rows } = await db.execute(sql.raw(
      `UPDATE bank_mutation_normalized_entries SET ${sets.join(", ")} WHERE id = ${entryId} RETURNING *`
    ));
    if (!rows.length) return res.status(404).json({ error: "Entry tidak ditemukan." });
    await auditImportLog({
      batchId: currentEntry.batch_id, rowId: currentEntry.row_id, action: "normalized_updated", actor,
      meta: { normalized_entry_id: entryId, ...req.body },
    });
    return res.json({ entry: rows[0] });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/bank-mutation-import/:id/normalize ────────────────────────────
// Trigger normalization ulang untuk batch existing (idempoten)
router.post("/:id/normalize", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
  const actor = (req as any).user?.email ?? "system";
  try {
    const { rows: batchRows } = await db.execute(sql.raw(
      `SELECT id, company_id, status FROM bank_mutation_import_batches WHERE id = ${id}`
    ));
    if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const batch = batchRows[0] as any;

    // §5 RE-NORMALIZE RULE: soft-delete entries yang belum POSTED/MATCHED → status SUPERSEDED
    // Versi baru = max(version) + 1
    const { rows: versionRows } = await db.execute(sql.raw(
      `SELECT COALESCE(MAX(version), 0) AS max_ver
       FROM bank_mutation_normalized_entries
       WHERE batch_id = ${id} AND status NOT IN ('SUPERSEDED')`
    ));
    const nextVersion = (Number((versionRows[0] as any)?.max_ver ?? 0)) + 1;

    // Kumpulkan ID yang akan di-SUPERSEDED sebelum di-update untuk emit event
    const { rows: toSupersede } = await db.execute(sql.raw(
      `SELECT id FROM bank_mutation_normalized_entries
       WHERE batch_id = ${id} AND status NOT IN ('POSTED','MATCHED','SUPERSEDED')`
    ));

    await db.execute(sql.raw(
      `UPDATE bank_mutation_normalized_entries
       SET status = 'SUPERSEDED', superseded_at = NOW(), updated_at = NOW(),
           is_latest_version = FALSE
       WHERE batch_id = ${id} AND status NOT IN ('POSTED','MATCHED','SUPERSEDED')`
    ));

    for (const sup of toSupersede as any[]) {
      emitFinancialEvent({
        event_type: 'SUPERSEDED',
        source_type: 'normalized_entry',
        entity_type: 'normalized_entry',
        entity_id: sup.id,
        payload: { batch_id: id, superseded_by_version: nextVersion },
        company_id: batch.company_id ?? null,
      });
    }

    await copyBatchToNormalized(id, batch.company_id ?? null, nextVersion);

    // ── SAP HARDENING FASE 5: Link previous_version_id ke versi lama ──────────
    // Setelah copyBatchToNormalized, hubungkan entri baru (version=nextVersion)
    // ke entri lama (version=nextVersion-1, is_latest_version=FALSE) via row_id.
    if (nextVersion > 1) {
      await db.execute(sql.raw(`
        UPDATE bank_mutation_normalized_entries AS new_entry
        SET previous_version_id = old_entry.id
        FROM bank_mutation_normalized_entries AS old_entry
        WHERE new_entry.batch_id = ${id}
          AND new_entry.version = ${nextVersion}
          AND new_entry.is_latest_version = TRUE
          AND old_entry.batch_id = ${id}
          AND old_entry.version = ${nextVersion - 1}
          AND old_entry.row_id = new_entry.row_id
          AND old_entry.row_id IS NOT NULL
      `)).catch(() => {});
    }

    await auditImportLog({
      batchId: id, rowId: null, action: 're_normalized', actor,
      meta: { new_version: nextVersion },
    });

    const { rows: summary } = await db.execute(sql.raw(`
      SELECT
        COUNT(*)                                                    AS total,
        SUM(CASE WHEN status = 'READY'        THEN 1 ELSE 0 END)  AS ready,
        SUM(CASE WHEN status = 'NEED_REVIEW'  THEN 1 ELSE 0 END)  AS need_review,
        SUM(CASE WHEN status = 'DUPLICATE'    THEN 1 ELSE 0 END)  AS duplicate,
        SUM(CASE WHEN coa_drift = TRUE        THEN 1 ELSE 0 END)  AS coa_drift_count,
        MAX(version)                                               AS version_max
      FROM bank_mutation_normalized_entries
      WHERE batch_id = ${id} AND status != 'SUPERSEDED'
    `));
    return res.json({ success: true, batch_id: id, version: nextVersion, summary: summary[0] ?? {} });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import normalize error");
    return res.status(500).json({ error: "Gagal menjalankan normalisasi." });
  }
});

// ─── FASE 9: POST /api/bank-mutation-import/:id/consistency-check ─────────────
// Jalankan consistency check manual untuk batch tertentu SEBELUM posting.
// Mengembalikan daftar pelanggaran dan rekomendasi tindakan.
router.post("/:id/consistency-check", async (req, res) => {
  await runBankMutationImportMigration();
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

  try {
    const { rows: batchRows } = await db.execute(sql.raw(
      `SELECT * FROM bank_mutation_import_batches WHERE id = ${id}`
    ));
    if (!batchRows.length) return res.status(404).json({ error: "Batch tidak ditemukan." });
    const batch = batchRows[0] as any;

    const violations: Array<{
      code: string; severity: 'BLOCK' | 'WARN'; count: number; message: string; action: string;
    }> = [];

    // C1: INCOME/EXPENSE tanpa COA (BLOCK — tidak bisa posting)
    const { rows: c1 } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_mutation_imports
      WHERE import_batch_id = ${id}
        AND accounting_class IN ('INCOME','EXPENSE','REVENUE')
        AND coa_status IN ('MISSING','PENDING')
        AND status NOT IN ('IMPORTED','REJECTED','DUPLICATE')
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));
    const c1Count = Number((c1[0] as any)?.cnt ?? 0);
    if (c1Count > 0) {
      violations.push({
        code: 'COA_MISSING_INCOME_EXPENSE',
        severity: 'BLOCK',
        count: c1Count,
        message: `${c1Count} baris INCOME/EXPENSE tidak memiliki COA valid`,
        action: 'Tambahkan mapping di master_coa_mapping atau ubah accounting_class ke NEED_REVIEW',
      });
    }

    // C2: Normalized entries dengan COA kosong (BLOCK)
    const { rows: c2 } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_mutation_normalized_entries
      WHERE batch_id = ${id}
        AND status = 'READY'
        AND (coa_debit IS NULL OR coa_debit = '' OR coa_credit IS NULL OR coa_credit = '')
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));
    const c2Count = Number((c2[0] as any)?.cnt ?? 0);
    if (c2Count > 0) {
      violations.push({
        code: 'NORMALIZED_MISSING_COA',
        severity: 'BLOCK',
        count: c2Count,
        message: `${c2Count} normalized entries READY memiliki coa_debit/coa_credit kosong`,
        action: 'Jalankan POST /:id/normalize ulang untuk re-generate normalized entries',
      });
    }

    // C3: TRANSFER tanpa pasangan (WARN — reviewer harus konfirmasi)
    const { rows: c3 } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_mutation_normalized_entries
      WHERE batch_id = ${id}
        AND accounting_class IN ('TRANSFER','INTERNAL_TRANSFER')
        AND transaction_pair_id IS NULL
        AND status = 'READY'
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));
    const c3Count = Number((c3[0] as any)?.cnt ?? 0);
    if (c3Count > 0) {
      violations.push({
        code: 'TRANSFER_UNPAIRED',
        severity: 'WARN',
        count: c3Count,
        message: `${c3Count} transaksi TRANSFER tidak memiliki pasangan dalam batch ini`,
        action: 'Pastikan kedua kaki transfer ada di batch ini, atau konfirmasi ini transfer antar-batch',
      });
    }

    // C4: BANK_FEE bukan EXPENSE (WARN)
    const { rows: c4 } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM bank_mutation_imports
      WHERE import_batch_id = ${id}
        AND erp_category = 'BANK_FEE'
        AND accounting_class != 'EXPENSE'
        AND status NOT IN ('IMPORTED','REJECTED','DUPLICATE')
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));
    const c4Count = Number((c4[0] as any)?.cnt ?? 0);
    if (c4Count > 0) {
      violations.push({
        code: 'BANK_FEE_WRONG_CLASS',
        severity: 'WARN',
        count: c4Count,
        message: `${c4Count} baris BANK_FEE tidak diklasifikasikan sebagai EXPENSE`,
        action: 'Jalankan normalize ulang — bank fee akan dikoreksi otomatis',
      });
    }

    // C5: Baris READY tanpa normalized entry (WARN)
    const { rows: c5 } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt
      FROM bank_mutation_imports bmi
      LEFT JOIN bank_mutation_normalized_entries ne
        ON ne.row_id = bmi.id AND ne.status != 'SUPERSEDED'
      WHERE bmi.import_batch_id = ${id}
        AND bmi.status NOT IN ('IMPORTED','REJECTED','DUPLICATE','SKIPPED_ALREADY_POSTED','MATCHED')
        AND bmi.journal_entry_id IS NULL
        AND ne.id IS NULL
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));
    const c5Count = Number((c5[0] as any)?.cnt ?? 0);
    if (c5Count > 0) {
      violations.push({
        code: 'MISSING_NORMALIZED_ENTRY',
        severity: 'WARN',
        count: c5Count,
        message: `${c5Count} baris belum memiliki normalized entry`,
        action: 'Jalankan POST /:id/normalize untuk membuat normalized entries',
      });
    }

    const blockingViolations = violations.filter(v => v.severity === 'BLOCK');
    const canPost = blockingViolations.length === 0;

    return res.json({
      batch_id: id,
      batch_status: batch.status,
      can_post: canPost,
      blocking_count: blockingViolations.length,
      warning_count: violations.length - blockingViolations.length,
      violations,
      message: canPost
        ? 'Batch siap untuk diposting'
        : `Posting diblokir: ${blockingViolations.length} pelanggaran kritis harus diselesaikan`,
    });
  } catch (err) {
    logger.error({ err }, "bank-mutation-import consistency-check error");
    return res.status(500).json({ error: "Gagal menjalankan consistency check." });
  }
});

export default router;

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline Migration ────────────────────────────────────────────────────────
let migrated = false;
export async function runBankMutationMastersMigration() {
  if (migrated) return;
  await db.execute(sql.raw(`
    -- Fase 7: Dynamic COA Mapping
    CREATE TABLE IF NOT EXISTS master_coa_mapping (
      id              SERIAL PRIMARY KEY,
      erp_category    TEXT NOT NULL,
      accounting_class TEXT NOT NULL,
      coa_code        TEXT NOT NULL,
      coa_name        TEXT,
      description     TEXT,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mcm_category_uidx ON master_coa_mapping(erp_category);

    -- Fase 10: Tax Ledger Mapping
    CREATE TABLE IF NOT EXISTS master_tax_mapping (
      id              SERIAL PRIMARY KEY,
      tax_type        TEXT NOT NULL,
      liability_coa   TEXT NOT NULL,
      expense_coa     TEXT,
      description     TEXT,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS mtm_type_uidx ON master_tax_mapping(tax_type);

    -- Fase 12: Bank Account Master
    CREATE TABLE IF NOT EXISTS master_bank_accounts (
      id              SERIAL PRIMARY KEY,
      account_name    TEXT NOT NULL,
      bank_name       TEXT NOT NULL,
      account_number  TEXT,
      coa_code        TEXT,
      company_id      INTEGER,
      branch_id       INTEGER,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS mba_company_idx ON master_bank_accounts(company_id);

    -- Fase 13: Master Entities + Review Queue
    CREATE TABLE IF NOT EXISTS master_entities (
      id                    SERIAL PRIMARY KEY,
      entity_name           TEXT NOT NULL,
      entity_name_normalized TEXT NOT NULL,
      entity_type           TEXT NOT NULL,
      company_id            INTEGER,
      is_active             BOOLEAN NOT NULL DEFAULT TRUE,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS me_name_type_uidx ON master_entities(entity_name_normalized, entity_type);

    CREATE TABLE IF NOT EXISTS master_entity_review (
      id                    SERIAL PRIMARY KEY,
      entity_name           TEXT NOT NULL,
      entity_name_normalized TEXT,
      entity_type_suggestion TEXT,
      source_mutation_key   TEXT,
      status                TEXT NOT NULL DEFAULT 'PENDING',
      approved_as           TEXT,
      reviewed_by           TEXT,
      reviewed_at           TIMESTAMPTZ,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS mer_status_idx ON master_entity_review(status);

    -- Fase 11: Intercompany Transactions
    CREATE TABLE IF NOT EXISTS intercompany_transactions (
      id                    SERIAL PRIMARY KEY,
      source_company_id     INTEGER NOT NULL,
      target_company_id     INTEGER NOT NULL,
      amount                NUMERIC(18,2) NOT NULL,
      transaction_date      DATE NOT NULL,
      reference_no          TEXT,
      mutation_row_id       INTEGER,
      journal_id            INTEGER,
      erp_category          TEXT,
      status                TEXT NOT NULL DEFAULT 'PENDING',
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS ict_source_idx ON intercompany_transactions(source_company_id);
    CREATE INDEX IF NOT EXISTS ict_target_idx ON intercompany_transactions(target_company_id);

    -- Seed default tax mappings
    INSERT INTO master_tax_mapping (tax_type, liability_coa, expense_coa, description)
    VALUES
      ('PPN',   '2-1030', '5-3010', 'Pajak Pertambahan Nilai'),
      ('PPH21', '2-1031', '5-3011', 'Pajak Penghasilan Pasal 21'),
      ('PPH23', '2-1032', '5-3012', 'Pajak Penghasilan Pasal 23'),
      ('PPH22', '2-1033', '5-3013', 'Pajak Penghasilan Pasal 22'),
      ('PPH4',  '2-1034', '5-3014', 'Pajak Penghasilan Pasal 4 Ayat 2')
    ON CONFLICT DO NOTHING;

    -- Seed default COA mappings
    -- Kode COA disesuaikan dengan chart_of_accounts aktual (prefix LIKE match)
    -- ON CONFLICT DO UPDATE agar kode lama yang salah ikut dikoreksi
    INSERT INTO master_coa_mapping (erp_category, accounting_class, coa_code, coa_name)
    VALUES
      -- Revenue (4-1016 Membership Sport Center, 4-1017 Booking, 4-1018 Handling, 4-1020 Lain-lain)
      ('REVENUE_GYM',                  'REVENUE',           '4-1016', 'Pendapatan Membership Sport Center'),
      ('REVENUE_BADMINTON',            'REVENUE',           '4-1017', 'Pendapatan Booking Sport Center'),
      ('REVENUE_TENNIS',               'REVENUE',           '4-1017', 'Pendapatan Booking Sport Center'),
      ('REVENUE_AIRPORT_TRANSFER',     'REVENUE',           '4-1018', 'Pendapatan Handling Service'),
      ('REVENUE_PERSONAL_HANDLING',    'REVENUE',           '4-1018', 'Pendapatan Handling Service'),
      ('REVENUE_RENTAL_CAR',           'REVENUE',           '4-1020', 'Pendapatan Lain-lain'),
      -- Tenant revenue (P0-4)
      ('REVENUE_TENANT',               'REVENUE',           '4-1025', 'Pendapatan Tenant'),
      -- Revenue baru (belum ada di mapping)
      ('REVENUE_SPORTCENTER',          'REVENUE',           '4-1016', 'Pendapatan Membership Sport Center'),
      ('REVENUE_BASKET',               'REVENUE',           '4-1017', 'Pendapatan Booking Sport Center'),
      ('REVENUE_FUTSAL',               'REVENUE',           '4-1017', 'Pendapatan Booking Sport Center'),
      -- Expense (5-2010 Gaji, 5-2020 Sewa, 5-2030 Utilitas, 5-2040 Operasional Lain, 5-2050 Perjalanan, 5-2080 Komunikasi)
      ('BANK_FEE',               'EXPENSE',           '5-3010', 'Beban Bunga & Administrasi Bank'),
      ('SOFTWARE_EXPENSE',       'EXPENSE',           '5-2080', 'Beban Komunikasi & Internet'),
      ('TRANSPORT_EXPENSE',      'EXPENSE',           '5-2050', 'Beban Perjalanan Dinas'),
      ('SALARY_EXPENSE',         'EXPENSE',           '5-2010', 'Beban Gaji & Tunjangan'),
      -- Expense baru
      ('RENTAL_CAR_EXPENSE',     'EXPENSE',           '5-2020', 'Beban Sewa'),
      ('PAYROLL_EXPENSE',        'EXPENSE',           '5-2010', 'Beban Gaji & Tunjangan'),
      ('RENT_CONCESSION_EXPENSE','EXPENSE',           '5-2020', 'Beban Sewa'),
      ('UTILITY_EXPENSE',        'EXPENSE',           '5-2030', 'Beban Utilitas'),
      ('LEGAL_EXPENSE',          'EXPENSE',           '5-2040', 'Beban Operasional Lain'),
      ('EXPENSE',                'EXPENSE',           '5-2040', 'Beban Operasional Lain'),
      ('CUSTOMER_REFUND',        'EXPENSE',           '5-2040', 'Beban Operasional Lain'),
      -- Asset / Liability
      ('INTERNAL_TRANSFER',            'INTERNAL_TRANSFER', '1-1029', 'Kliring Transfer Internal'),
      ('EMPLOYEE_ADVANCE',             'EMPLOYEE_ADVANCE',  '1-1032', 'Piutang Karyawan (Kasbon)'),
      ('INTERCOMPANY_LOAN_GIVEN',      'INTERCOMPANY_LOAN', '1-1031', 'Piutang Lainnya'),
      ('INTERCOMPANY_LOAN_SETTLEMENT', 'INTERCOMPANY_LOAN', '1-1031', 'Piutang Lainnya'),
      ('TAX_PAYMENT',                  'TAX',               '2-1030', 'Hutang Pajak Lainnya — subtype mapping wajib'),
      ('REIMBURSEMENT_PAYMENT',        'REIMBURSEMENT',     '2-1010', 'Hutang Usaha'),
      ('REIMBURSEMENT_RECEIVED',       'REIMBURSEMENT',     '1-1031', 'Piutang Lainnya'),
      -- Pinjaman pihak ketiga (P2)
      ('THIRD_PARTY_LOAN_GIVEN',       'LOAN_RECEIVABLE',   '1-1034', 'Piutang Pinjaman Pihak Ketiga'),
      ('THIRD_PARTY_LOAN_SETTLEMENT',  'LOAN_RECEIVABLE',   '1-1034', 'Piutang Pinjaman Pihak Ketiga')
    ON CONFLICT (erp_category) DO UPDATE SET
      accounting_class = EXCLUDED.accounting_class,
      coa_code         = EXCLUDED.coa_code,
      coa_name         = EXCLUDED.coa_name,
      updated_at       = NOW();

    -- Hapus legacy bank accounts tanpa company_id (tidak terpakai, sumber duplikasi)
    DELETE FROM master_bank_accounts WHERE company_id IS NULL;
  `));
  migrated = true;
}

// ════════════════════════════════════════════════════════════
// FASE 7 — MASTER COA MAPPING
// ════════════════════════════════════════════════════════════

router.get("/coa-mapping", async (_req, res) => {
  await runBankMutationMastersMigration();
  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT * FROM master_coa_mapping ORDER BY accounting_class, erp_category`
    ));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post("/coa-mapping", async (req, res) => {
  await runBankMutationMastersMigration();
  const { erp_category, accounting_class, coa_code, coa_name, description } = req.body;
  if (!erp_category || !accounting_class || !coa_code)
    return res.status(400).json({ error: "erp_category, accounting_class, coa_code wajib diisi." });
  try {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO master_coa_mapping (erp_category, accounting_class, coa_code, coa_name, description)
      VALUES (
        '${String(erp_category).replace(/'/g,"''")}',
        '${String(accounting_class).replace(/'/g,"''")}',
        '${String(coa_code).replace(/'/g,"''")}',
        ${coa_name ? `'${String(coa_name).replace(/'/g,"''")}'` : "NULL"},
        ${description ? `'${String(description).replace(/'/g,"''")}'` : "NULL"}
      )
      ON CONFLICT (erp_category) DO UPDATE SET
        accounting_class = EXCLUDED.accounting_class,
        coa_code = EXCLUDED.coa_code,
        coa_name = EXCLUDED.coa_name,
        description = EXCLUDED.description,
        updated_at = NOW()
      RETURNING *
    `));
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.put("/coa-mapping/:id", async (req, res) => {
  await runBankMutationMastersMigration();
  const id = parseInt(req.params.id);
  const { erp_category, accounting_class, coa_code, coa_name, description, is_active } = req.body;
  try {
    const sets: string[] = [`updated_at = NOW()`];
    if (erp_category !== undefined)    sets.push(`erp_category = '${String(erp_category).replace(/'/g,"''")}'`);
    if (accounting_class !== undefined) sets.push(`accounting_class = '${String(accounting_class).replace(/'/g,"''")}'`);
    if (coa_code !== undefined)        sets.push(`coa_code = '${String(coa_code).replace(/'/g,"''")}'`);
    if (coa_name !== undefined)        sets.push(`coa_name = ${coa_name ? `'${String(coa_name).replace(/'/g,"''")}'` : "NULL"}`);
    if (description !== undefined)     sets.push(`description = ${description ? `'${String(description).replace(/'/g,"''")}'` : "NULL"}`);
    if (is_active !== undefined)       sets.push(`is_active = ${Boolean(is_active)}`);
    const { rows } = await db.execute(sql.raw(
      `UPDATE master_coa_mapping SET ${sets.join(",")} WHERE id = ${id} RETURNING *`
    ));
    if (!rows.length) return res.status(404).json({ error: "Tidak ditemukan." });
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.delete("/coa-mapping/:id", async (req, res) => {
  await runBankMutationMastersMigration();
  await db.execute(sql.raw(`DELETE FROM master_coa_mapping WHERE id = ${parseInt(req.params.id)}`));
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
// FASE 10 — MASTER TAX MAPPING
// ════════════════════════════════════════════════════════════

router.get("/tax-mapping", async (_req, res) => {
  await runBankMutationMastersMigration();
  try {
    const { rows } = await db.execute(sql.raw(`SELECT * FROM master_tax_mapping ORDER BY tax_type`));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post("/tax-mapping", async (req, res) => {
  await runBankMutationMastersMigration();
  const { tax_type, liability_coa, expense_coa, description } = req.body;
  if (!tax_type || !liability_coa) return res.status(400).json({ error: "tax_type dan liability_coa wajib." });
  try {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO master_tax_mapping (tax_type, liability_coa, expense_coa, description)
      VALUES (
        '${String(tax_type).replace(/'/g,"''")}',
        '${String(liability_coa).replace(/'/g,"''")}',
        ${expense_coa ? `'${String(expense_coa).replace(/'/g,"''")}'` : "NULL"},
        ${description ? `'${String(description).replace(/'/g,"''")}'` : "NULL"}
      )
      ON CONFLICT (tax_type) DO UPDATE SET
        liability_coa = EXCLUDED.liability_coa,
        expense_coa = EXCLUDED.expense_coa,
        description = EXCLUDED.description
      RETURNING *
    `));
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.put("/tax-mapping/:id", async (req, res) => {
  await runBankMutationMastersMigration();
  const id = parseInt(req.params.id);
  const { liability_coa, expense_coa, description, is_active } = req.body;
  try {
    const sets: string[] = [];
    if (liability_coa !== undefined) sets.push(`liability_coa = '${String(liability_coa).replace(/'/g,"''")}'`);
    if (expense_coa !== undefined)   sets.push(`expense_coa = ${expense_coa ? `'${String(expense_coa).replace(/'/g,"''")}'` : "NULL"}`);
    if (description !== undefined)   sets.push(`description = ${description ? `'${String(description).replace(/'/g,"''")}'` : "NULL"}`);
    if (is_active !== undefined)     sets.push(`is_active = ${Boolean(is_active)}`);
    if (!sets.length) return res.status(400).json({ error: "Tidak ada field." });
    const { rows } = await db.execute(sql.raw(
      `UPDATE master_tax_mapping SET ${sets.join(",")} WHERE id = ${id} RETURNING *`
    ));
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// FASE 12 — MASTER BANK ACCOUNTS
// ════════════════════════════════════════════════════════════

router.get("/bank-accounts", async (_req, res) => {
  await runBankMutationMastersMigration();
  try {
    const { rows } = await db.execute(sql.raw(
      `SELECT mba.*, c.name as company_name
       FROM master_bank_accounts mba
       LEFT JOIN companies c ON c.id = mba.company_id
       ORDER BY mba.company_id, mba.bank_name, mba.account_name`
    ));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post("/bank-accounts", async (req, res) => {
  await runBankMutationMastersMigration();
  const { account_name, bank_name, account_number, coa_code, company_id, branch_id } = req.body;
  if (!account_name || !bank_name) return res.status(400).json({ error: "account_name dan bank_name wajib." });
  try {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO master_bank_accounts (account_name, bank_name, account_number, coa_code, company_id, branch_id)
      VALUES (
        '${String(account_name).replace(/'/g,"''")}',
        '${String(bank_name).replace(/'/g,"''")}',
        ${account_number ? `'${String(account_number).replace(/'/g,"''")}'` : "NULL"},
        ${coa_code ? `'${String(coa_code).replace(/'/g,"''")}'` : "NULL"},
        ${company_id ? Number(company_id) : "NULL"},
        ${branch_id ? Number(branch_id) : "NULL"}
      )
      RETURNING *
    `));
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.put("/bank-accounts/:id", async (req, res) => {
  await runBankMutationMastersMigration();
  const id = parseInt(req.params.id);
  const { account_name, bank_name, account_number, coa_code, company_id, branch_id, is_active } = req.body;
  try {
    const sets: string[] = [`updated_at = NOW()`];
    if (account_name !== undefined)  sets.push(`account_name = '${String(account_name).replace(/'/g,"''")}'`);
    if (bank_name !== undefined)     sets.push(`bank_name = '${String(bank_name).replace(/'/g,"''")}'`);
    if (account_number !== undefined) sets.push(`account_number = ${account_number ? `'${String(account_number).replace(/'/g,"''")}'` : "NULL"}`);
    if (coa_code !== undefined)      sets.push(`coa_code = ${coa_code ? `'${String(coa_code).replace(/'/g,"''")}'` : "NULL"}`);
    if (company_id !== undefined)    sets.push(`company_id = ${company_id ? Number(company_id) : "NULL"}`);
    if (branch_id !== undefined)     sets.push(`branch_id = ${branch_id ? Number(branch_id) : "NULL"}`);
    if (is_active !== undefined)     sets.push(`is_active = ${Boolean(is_active)}`);
    const { rows } = await db.execute(sql.raw(
      `UPDATE master_bank_accounts SET ${sets.join(",")} WHERE id = ${id} RETURNING *`
    ));
    if (!rows.length) return res.status(404).json({ error: "Tidak ditemukan." });
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.delete("/bank-accounts/:id", async (req, res) => {
  await runBankMutationMastersMigration();
  await db.execute(sql.raw(`UPDATE master_bank_accounts SET is_active = FALSE WHERE id = ${parseInt(req.params.id)}`));
  return res.json({ success: true });
});

// Resolve source_account text → bank_account_id
router.get("/bank-accounts/resolve", async (req, res) => {
  await runBankMutationMastersMigration();
  const { q } = req.query as Record<string, string>;
  if (!q) return res.json({ items: [] });
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM master_bank_accounts
      WHERE is_active = TRUE
        AND (account_name ILIKE '%${q.replace(/'/g,"''")}%'
          OR bank_name ILIKE '%${q.replace(/'/g,"''")}%'
          OR account_number ILIKE '%${q.replace(/'/g,"''")}%')
      LIMIT 10
    `));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// FASE 13 — MASTER ENTITY LEARNING
// ════════════════════════════════════════════════════════════

router.get("/entities", async (req, res) => {
  await runBankMutationMastersMigration();
  const { type, search } = req.query as Record<string, string>;
  let where = "WHERE is_active = TRUE";
  if (type) where += ` AND entity_type = '${type.replace(/'/g,"''")}'`;
  if (search) where += ` AND entity_name ILIKE '%${search.replace(/'/g,"''")}%'`;
  try {
    const { rows } = await db.execute(sql.raw(`SELECT * FROM master_entities ${where} ORDER BY entity_type, entity_name LIMIT 500`));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.get("/entity-review", async (req, res) => {
  await runBankMutationMastersMigration();
  const { status = "PENDING" } = req.query as Record<string, string>;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM master_entity_review
      WHERE status = '${status.replace(/'/g,"''")}'
      ORDER BY created_at DESC LIMIT 200
    `));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// Submit unknown entity to review queue
router.post("/entity-review", async (req, res) => {
  await runBankMutationMastersMigration();
  const { entity_name, entity_type_suggestion, source_mutation_key } = req.body;
  if (!entity_name) return res.status(400).json({ error: "entity_name wajib." });
  const normalized = String(entity_name).toLowerCase().trim();
  try {
    // Cek apakah sudah di queue
    const { rows: existing } = await db.execute(sql.raw(`
      SELECT id FROM master_entity_review
      WHERE entity_name_normalized = '${normalized.replace(/'/g,"''")}'
        AND status = 'PENDING'
      LIMIT 1
    `));
    if (existing.length) return res.json({ item: existing[0], skipped: true });

    const { rows } = await db.execute(sql.raw(`
      INSERT INTO master_entity_review (entity_name, entity_name_normalized, entity_type_suggestion, source_mutation_key)
      VALUES (
        '${String(entity_name).replace(/'/g,"''")}',
        '${normalized.replace(/'/g,"''")}',
        ${entity_type_suggestion ? `'${String(entity_type_suggestion).replace(/'/g,"''")}'` : "NULL"},
        ${source_mutation_key ? `'${String(source_mutation_key).replace(/'/g,"''")}'` : "NULL"}
      )
      RETURNING *
    `));
    return res.json({ item: rows[0] });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// Approve entity review → promote to master_entities
router.post("/entity-review/:id/approve", async (req, res) => {
  await runBankMutationMastersMigration();
  const id = parseInt(req.params.id);
  const { entity_type } = req.body;
  const actor = (req as any).user?.email ?? "admin";
  if (!entity_type) return res.status(400).json({ error: "entity_type wajib." });
  try {
    const { rows: rev } = await db.execute(sql.raw(`SELECT * FROM master_entity_review WHERE id = ${id}`));
    if (!rev.length) return res.status(404).json({ error: "Review tidak ditemukan." });
    const r = rev[0] as any;

    // Promote ke master_entities
    await db.execute(sql.raw(`
      INSERT INTO master_entities (entity_name, entity_name_normalized, entity_type)
      VALUES (
        '${String(r.entity_name).replace(/'/g,"''")}',
        '${String(r.entity_name_normalized ?? r.entity_name.toLowerCase()).replace(/'/g,"''")}',
        '${String(entity_type).replace(/'/g,"''")}'
      )
      ON CONFLICT (entity_name_normalized, entity_type) DO NOTHING
    `));

    await db.execute(sql.raw(`
      UPDATE master_entity_review
      SET status = 'APPROVED', approved_as = '${String(entity_type).replace(/'/g,"''")}',
          reviewed_by = '${actor.replace(/'/g,"''")}', reviewed_at = NOW()
      WHERE id = ${id}
    `));
    return res.json({ success: true });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

router.post("/entity-review/:id/reject", async (req, res) => {
  await runBankMutationMastersMigration();
  const id = parseInt(req.params.id);
  const actor = (req as any).user?.email ?? "admin";
  await db.execute(sql.raw(`
    UPDATE master_entity_review
    SET status = 'REJECTED', reviewed_by = '${actor.replace(/'/g,"''")}', reviewed_at = NOW()
    WHERE id = ${id}
  `));
  return res.json({ success: true });
});

// ════════════════════════════════════════════════════════════
// FASE 11 — INTERCOMPANY TRANSACTIONS
// ════════════════════════════════════════════════════════════

router.get("/intercompany", async (req, res) => {
  await runBankMutationMastersMigration();
  const { source_company_id, target_company_id, from, to } = req.query as Record<string, string>;
  let where = "WHERE 1=1";
  if (source_company_id) where += ` AND source_company_id = ${Number(source_company_id)}`;
  if (target_company_id) where += ` AND target_company_id = ${Number(target_company_id)}`;
  if (from) where += ` AND transaction_date >= '${from}'`;
  if (to)   where += ` AND transaction_date <= '${to}'`;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT ict.*,
        sc.name AS source_company_name,
        tc.name AS target_company_name
      FROM intercompany_transactions ict
      LEFT JOIN companies sc ON sc.id = ict.source_company_id
      LEFT JOIN companies tc ON tc.id = ict.target_company_id
      ${where}
      ORDER BY transaction_date DESC, id DESC
      LIMIT 500
    `));
    // Saldo per pasangan perusahaan
    const { rows: balances } = await db.execute(sql.raw(`
      SELECT
        source_company_id, target_company_id,
        sc.name AS source_name, tc.name AS target_name,
        SUM(amount) AS total_amount,
        COUNT(*) AS tx_count
      FROM intercompany_transactions ict
      LEFT JOIN companies sc ON sc.id = ict.source_company_id
      LEFT JOIN companies tc ON tc.id = ict.target_company_id
      GROUP BY source_company_id, target_company_id, sc.name, tc.name
      ORDER BY source_company_id, target_company_id
    `));
    return res.json({ transactions: rows, balances });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// FASE 9 — P&L BY BUSINESS UNIT
// ════════════════════════════════════════════════════════════

router.get("/pl-by-bu", async (req, res) => {
  await runBankMutationMastersMigration();
  const { from, to, company_id } = req.query as Record<string, string>;
  let where = "WHERE bmi.status = 'IMPORTED'";
  if (from) where += ` AND bmi.transaction_date >= '${from}'`;
  if (to)   where += ` AND bmi.transaction_date <= '${to}'`;
  if (company_id) where += ` AND b.company_id = ${Number(company_id)}`;
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        COALESCE(bmi.business_unit, 'UNASSIGNED') AS business_unit,
        COALESCE(mcm.accounting_class, bmi.accounting_class) AS accounting_class,
        bmi.erp_category,
        SUM(COALESCE(bmi.credit, 0)) AS total_credit,
        SUM(COALESCE(bmi.debit, 0)) AS total_debit,
        COUNT(*) AS tx_count
      FROM bank_mutation_imports bmi
      LEFT JOIN bank_mutation_import_batches b ON b.id = bmi.import_batch_id
      LEFT JOIN master_coa_mapping mcm ON mcm.erp_category = bmi.erp_category
      ${where}
      GROUP BY business_unit, accounting_class, bmi.erp_category
      ORDER BY business_unit, accounting_class, bmi.erp_category
    `));
    // Pivot: per BU → revenue/expense/net
    const buMap: Record<string, { revenue: number; expense: number; others: number }> = {};
    for (const r of rows as any[]) {
      const bu = r.business_unit as string;
      if (!buMap[bu]) buMap[bu] = { revenue: 0, expense: 0, others: 0 };
      const cls = String(r.accounting_class ?? "").toUpperCase();
      if (cls === "REVENUE") buMap[bu].revenue += Number(r.total_credit) - Number(r.total_debit);
      else if (cls === "EXPENSE") buMap[bu].expense += Number(r.total_debit) - Number(r.total_credit);
      else buMap[bu].others += Number(r.total_credit) - Number(r.total_debit);
    }
    const summary = Object.entries(buMap).map(([bu, v]) => ({
      business_unit: bu,
      revenue: v.revenue,
      expense: v.expense,
      net: v.revenue - v.expense + v.others,
      others: v.others,
    }));
    return res.json({ detail: rows, summary });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// FASE 15 — AUDIT VALIDATION SUMMARY
// ════════════════════════════════════════════════════════════

router.get("/audit-summary", async (req, res) => {
  await runBankMutationMastersMigration();
  const { batch_id, from, to, company_id } = req.query as Record<string, string>;
  const conds: string[] = ["1=1"];
  if (batch_id) conds.push(`bmi.import_batch_id = ${Number(batch_id)}`);
  if (from)     conds.push(`bmi.transaction_date >= '${from}'`);
  if (to)       conds.push(`bmi.transaction_date <= '${to}'`);
  if (company_id) conds.push(`b2.company_id = ${Number(company_id)}`);
  const batchFilter = conds.length > 1 ? `AND ${conds.slice(1).join(" AND ")}` : "";
  const bmiJoin = (from || to || company_id) ? `LEFT JOIN bank_mutation_import_batches b2 ON b2.id = bmi.import_batch_id` : "";
  try {
    const { rows: counts } = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE bmi.status = 'IMPORTED')                                  AS total_imported,
        COUNT(*) FILTER (WHERE bmi.status = 'NEED_REVIEW')                               AS total_need_review,
        COUNT(*) FILTER (WHERE bmi.entity_type IS NULL OR bmi.entity_type = 'UNKNOWN')   AS total_unknown_entity,
        COUNT(*) FILTER (WHERE bmi.accounting_class = 'INTERCOMPANY_LOAN')               AS total_intercompany,
        COUNT(*) FILTER (WHERE bmi.accounting_class = 'REIMBURSEMENT')                   AS total_reimbursement,
        COUNT(*) FILTER (WHERE bmi.accounting_class = 'TAX_PAYMENT')                     AS total_tax_payment,
        COUNT(*) FILTER (WHERE bmi.erp_category IS NULL OR bmi.erp_category = 'UNKNOWN') AS total_unknown_category,
        COUNT(*)                                                                           AS grand_total,
        COALESCE(SUM(bmi.credit) FILTER (WHERE bmi.status = 'IMPORTED'), 0)              AS total_credit_imported,
        COALESCE(SUM(bmi.debit)  FILTER (WHERE bmi.status = 'IMPORTED'), 0)              AS total_debit_imported,
        COUNT(*) FILTER (WHERE bmi.status = 'DRAFT')                                     AS total_draft,
        MIN(bmi.transaction_date)                                                         AS earliest_date,
        MAX(bmi.transaction_date)                                                         AS latest_date
      FROM bank_mutation_imports bmi
      ${bmiJoin}
      WHERE 1=1 ${batchFilter}
    `));

    const { rows: pendingEntities } = await db.execute(sql.raw(
      `SELECT COUNT(*) AS cnt FROM master_entity_review WHERE status = 'PENDING'`
    ));

    const batchWhere = (() => {
      const c: string[] = [];
      if (from) c.push(`b.created_at >= '${from}'`);
      if (to)   c.push(`b.created_at <= '${to}'::date + interval '1 day'`);
      if (company_id) c.push(`b.company_id = ${Number(company_id)}`);
      return c.length ? `WHERE ${c.join(" AND ")}` : "";
    })();

    const { rows: batches } = await db.execute(sql.raw(`
      SELECT b.id, b.filename, b.status, b.row_count, b.created_at, b.created_by, b.notes,
        COALESCE(SUM(bmi.credit) FILTER (WHERE bmi.status = 'IMPORTED'), 0) AS total_credit,
        COALESCE(SUM(bmi.debit)  FILTER (WHERE bmi.status = 'IMPORTED'), 0) AS total_debit,
        COUNT(bmi.id) FILTER (WHERE bmi.status = 'IMPORTED')                AS imported_count,
        COUNT(bmi.id) FILTER (WHERE bmi.status = 'NEED_REVIEW')             AS need_review,
        COUNT(bmi.id) FILTER (WHERE bmi.erp_category IS NULL OR bmi.erp_category = 'UNKNOWN') AS unknown_category
      FROM bank_mutation_import_batches b
      LEFT JOIN bank_mutation_imports bmi ON bmi.import_batch_id = b.id
      ${batchWhere}
      GROUP BY b.id ORDER BY b.created_at DESC LIMIT 100
    `));

    // Recent audit activity (50 entri terbaru)
    let recentActivity: any[] = [];
    try {
      const { rows: activity } = await db.execute(sql.raw(`
        SELECT a.id, a.batch_id, a.row_id, a.action, a.actor, a.field,
          a.before_val, a.after_val, a.created_at,
          b.filename AS batch_filename
        FROM bank_mutation_import_audit a
        LEFT JOIN bank_mutation_import_batches b ON b.id = a.batch_id
        ORDER BY a.created_at DESC
        LIMIT 50
      `));
      recentActivity = activity as any[];
    } catch { /* tabel mungkin belum ada */ }

    return res.json({
      counts: counts[0],
      pending_entity_review: Number((pendingEntities[0] as any)?.cnt ?? 0),
      batches,
      recent_activity: recentActivity,
    });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ─── GET /api/bank-mutation-masters/recap-by-coa ─────────────────────────────
// Rekap total debit/kredit per akun COA dari jurnal yang sudah diposting
router.get("/recap-by-coa", async (req, res) => {
  await runBankMutationMastersMigration();
  const { from, to, company_id } = req.query as Record<string, string>;
  const conds: string[] = ["bmi.journal_entry_id IS NOT NULL"];
  if (from)       conds.push(`bmi.transaction_date >= '${from}'`);
  if (to)         conds.push(`bmi.transaction_date <= '${to}'`);
  if (company_id) conds.push(`b.company_id = ${Number(company_id)}`);
  const where = `WHERE ${conds.join(" AND ")}`;
  try {
    // Rekap per akun COA dari accounting_entry_lines
    const { rows: byAccount } = await db.execute(sql.raw(`
      SELECT
        coa.code                              AS account_code,
        coa.name                              AS account_name,
        coa.type                              AS account_type,
        COUNT(DISTINCT bmi.journal_entry_id)  AS journal_count,
        COUNT(ael.id)                         AS line_count,
        COALESCE(SUM(ael.debit),  0)          AS total_debit,
        COALESCE(SUM(ael.credit), 0)          AS total_credit,
        COALESCE(SUM(ael.debit) - SUM(ael.credit), 0) AS net
      FROM bank_mutation_imports bmi
      LEFT JOIN bank_mutation_import_batches b ON b.id = bmi.import_batch_id
      JOIN accounting_entry_lines ael ON ael.entry_id = bmi.journal_entry_id
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      ${where}
      GROUP BY coa.id, coa.code, coa.name, coa.type
      ORDER BY SUM(ael.debit + ael.credit) DESC
    `));

    // Rekap per accounting_class (dimensi import)
    const { rows: byClass } = await db.execute(sql.raw(`
      SELECT
        COALESCE(bmi.accounting_class, '(null)')  AS accounting_class,
        COALESCE(bmi.erp_category,     '(null)')  AS erp_category,
        COUNT(*)                                   AS row_count,
        COALESCE(SUM(bmi.credit), 0)               AS total_credit,
        COALESCE(SUM(bmi.debit),  0)               AS total_debit
      FROM bank_mutation_imports bmi
      LEFT JOIN bank_mutation_import_batches b ON b.id = bmi.import_batch_id
      ${where}
      GROUP BY bmi.accounting_class, bmi.erp_category
      ORDER BY (SUM(bmi.credit) + SUM(bmi.debit)) DESC
    `));

    return res.json({ success: true, by_account: byAccount, by_class: byClass });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════
// FASE 8 — Multi-company filter: list companies
// ════════════════════════════════════════════════════════════

router.get("/companies", async (_req, res) => {
  try {
    const { rows } = await db.execute(sql.raw(`SELECT id, name FROM companies ORDER BY name`));
    return res.json({ items: rows });
  } catch (e: any) { return res.status(500).json({ error: e.message }); }
});

export { router as bankMutationMastersRouter };
export default router;

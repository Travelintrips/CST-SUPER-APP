import {
  db,
  chartOfAccountsTable,
  accountingJournalsTable,
  accountingTaxesTable,
  accountingSettingsTable,
  expenseCategoriesTable,
  companiesTable,
} from "@workspace/db";
import { eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { logger } from "./logger.js";

type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

interface SeedAccount {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
}

/**
 * Abbreviasi perusahaan — diisi secara dinamis dari DB oleh populateDynamicCompanies().
 * Company 1 (holding CST) dicantumkan sebagai fallback sebelum DB query berjalan.
 * Jangan tambahkan entry hardcode untuk perusahaan lain di sini; gunakan company_code di DB.
 */
const COMPANY_ABBR: Record<number, string> = {
  1: "CST",
};

/** Map lama → baru untuk rename akun yang sudah dibuat dengan singkatan lama */
const OLD_TO_NEW_ABBR: Record<string, string> = {
  WSM: "WS",
  DVS: "DV",
  ERA: "ER",
};

const ALL_COMPANY_IDS: number[] = [1, 2, 3, 4];

/**
 * Populate ALL_COMPANY_IDS dan COMPANY_ABBR secara dinamis dari tabel companies.
 * Perusahaan baru (ID > 4 atau yang belum terdaftar) akan ditambahkan ke daftar
 * seed menggunakan company_code sebagai abbreviasi.
 * Ini harus dipanggil sebelum seed loop berjalan.
 */
async function populateDynamicCompanies(): Promise<void> {
  try {
    const rows = await db
      .select({ id: companiesTable.id, companyCode: companiesTable.companyCode })
      .from(companiesTable)
      .where(eq(companiesTable.isActive, true));
    for (const row of rows) {
      // Selalu gunakan company_code dari DB sebagai sumber kebenaran abbreviasi.
      // Ini memastikan tidak ada desync antara DB dan kode seed.
      COMPANY_ABBR[row.id] = row.companyCode.slice(0, 8).toUpperCase();
      // Tambahkan ID ke list jika belum ada
      if (!ALL_COMPANY_IDS.includes(row.id)) {
        ALL_COMPANY_IDS.push(row.id);
      }
    }
    logger.info(
      { companyIds: ALL_COMPANY_IDS, companyAbbr: COMPANY_ABBR },
      "populateDynamicCompanies: daftar perusahaan berhasil dimuat dari DB",
    );
  } catch (err) {
    logger.warn({ err }, "populateDynamicCompanies: gagal membaca companies dari DB, menggunakan daftar fallback");
  }
}

/**
 * Parent/group accounts — global (no companyId), inserted once.
 */
const COA_PARENTS: SeedAccount[] = [
  { code: "1-0000", name: "Aset", type: "asset" },
  { code: "1-1000", name: "Aset Lancar", type: "asset", parentCode: "1-0000" },
  { code: "1-2000", name: "Aset Tidak Lancar", type: "asset", parentCode: "1-0000" },
  { code: "2-0000", name: "Kewajiban", type: "liability" },
  { code: "2-1000", name: "Kewajiban Lancar", type: "liability", parentCode: "2-0000" },
  { code: "2-2000", name: "Kewajiban Jangka Panjang", type: "liability", parentCode: "2-0000" },
  { code: "3-0000", name: "Ekuitas", type: "equity" },
  { code: "3-1000", name: "Modal", type: "equity", parentCode: "3-0000" },
  { code: "3-2000", name: "Laba / Rugi", type: "equity", parentCode: "3-0000" },
  { code: "4-0000", name: "Pendapatan", type: "revenue" },
  { code: "4-1000", name: "Pendapatan Usaha", type: "revenue", parentCode: "4-0000" },
  { code: "4-2000", name: "Pendapatan Lain-lain", type: "revenue", parentCode: "4-0000" },
  { code: "5-0000", name: "Beban", type: "expense" },
  { code: "5-1000", name: "Harga Pokok Penjualan", type: "expense", parentCode: "5-0000" },
  { code: "5-2000", name: "Beban Operasional", type: "expense", parentCode: "5-0000" },
  { code: "5-3000", name: "Beban Lain-lain", type: "expense", parentCode: "5-0000" },
];

/**
 * Tax hierarchy is governed by coaTaxMigration + maker-checker approval.
 * accountingSeed must never create tax headers/subaccounts or repair their
 * parent links. The three legacy fallback accounts remain in the general
 * leaf template for first-time setup, but become insert-only after creation
 * so approved governance changes cannot be overwritten by a later seed.
 */
const GOVERNED_TAX_COA_BASE_CODES = new Set([
  "1-1050", "1-1070", "1-1071", "1-1072", "1-1073", "1-1074", "1-1075", "1-1076",
  "2-1030", "2-1060", "2-1061", "2-1062", "2-1063", "2-1064", "2-1065", "2-1066",
  "2-1067", "2-1068", "2-1069", "2-1070", "2-1071", "2-1072",
  "5-3020", "5-3040", "5-3041", "5-3042", "5-3043", "5-3044", "5-3045", "5-3046",
  "5-3047", "5-3048",
]);

export function isGovernedTaxCoaCode(baseCode: string): boolean {
  return GOVERNED_TAX_COA_BASE_CODES.has(baseCode);
}

/**
 * Leaf account templates — seeded per-company with abbreviation suffix.
 * code here is the BASE code; actual code will be "code-ABBR".
 */
const COA_LEAF_TEMPLATES: SeedAccount[] = [
  // ── Aset Lancar ───────────────────────────────────────────
  { code: "1-1010", name: "Kas Kecil",                        type: "asset",   parentCode: "1-1000" },
  { code: "1-1020", name: "Bank Mandiri",                     type: "asset",   parentCode: "1-1000" },
  { code: "1-1021", name: "Bank BCA",                         type: "asset",   parentCode: "1-1000" },
  { code: "1-1022", name: "Bank BNI",                         type: "asset",   parentCode: "1-1000" },
  { code: "1-1030", name: "Piutang Usaha",                    type: "asset",   parentCode: "1-1000" },
  { code: "1-1031", name: "Piutang Lainnya",                  type: "asset",   parentCode: "1-1000" },
  { code: "1-1032", name: "Piutang Karyawan (Kasbon)",        type: "asset",   parentCode: "1-1000" },
  { code: "1-1033", name: "Piutang Dana Talangan",            type: "asset",   parentCode: "1-1000" },
  { code: "1-1099", name: "Piutang Intercompany Dana Talangan", type: "asset", parentCode: "1-1000" },
  { code: "1-1040", name: "Persediaan Barang",                type: "asset",   parentCode: "1-1000" },
  { code: "1-1050", name: "PPN Masukan",                      type: "asset",   parentCode: "1-1000" },
  { code: "1-1060", name: "Uang Muka Biaya",                  type: "asset",   parentCode: "1-1000" },
  // ── Aset Tidak Lancar ─────────────────────────────────────
  { code: "1-2010", name: "Aset Tetap",                       type: "asset",   parentCode: "1-2000" },
  { code: "1-2020", name: "Akumulasi Depresiasi",             type: "asset",   parentCode: "1-2000" },
  // ── Kewajiban Lancar ──────────────────────────────────────
  { code: "2-1010", name: "Hutang Usaha",                     type: "liability", parentCode: "2-1000" },
  { code: "2-1020", name: "PPN Keluaran",                     type: "liability", parentCode: "2-1000" },
  { code: "2-1030", name: "Hutang Pajak Lainnya",             type: "liability", parentCode: "2-1000" },
  { code: "2-1040", name: "Uang Muka Pelanggan",              type: "liability", parentCode: "2-1000" },
  { code: "2-1045", name: "GR/IR Clearing (Barang Diterima/Belum Ditagih)", type: "liability", parentCode: "2-1000" },
  { code: "2-1050", name: "Hutang Bank Jangka Pendek",        type: "liability", parentCode: "2-1000" },
  { code: "2-1055", name: "Hutang Leasing Jangka Pendek",     type: "liability", parentCode: "2-1000" },
  // ── Kewajiban Jangka Panjang ──────────────────────────────
  { code: "2-2010", name: "Hutang Jangka Panjang",            type: "liability", parentCode: "2-2000" },
  { code: "2-2020", name: "Hutang Bank Jangka Panjang",       type: "liability", parentCode: "2-2000" },
  { code: "2-2030", name: "Hutang Leasing Jangka Panjang",    type: "liability", parentCode: "2-2000" },
  { code: "2-2098", name: "Hutang Intercompany Dana Talangan", type: "liability", parentCode: "2-2000" },
  // ── Modal ─────────────────────────────────────────────────
  { code: "3-1010", name: "Modal Disetor",                    type: "equity",  parentCode: "3-1000" },
  // ── Laba / Rugi ───────────────────────────────────────────
  { code: "3-2010", name: "Laba Ditahan",                     type: "equity",  parentCode: "3-2000" },
  { code: "3-2020", name: "Laba Tahun Berjalan",              type: "equity",  parentCode: "3-2000" },
  // ── Pendapatan Usaha (Freight) ────────────────────────────
  { code: "4-1010", name: "Pendapatan Jasa Freight",          type: "revenue", parentCode: "4-1000" },
  { code: "4-1011", name: "Pendapatan Sea Freight",           type: "revenue", parentCode: "4-1000" },
  { code: "4-1012", name: "Pendapatan Air Freight",           type: "revenue", parentCode: "4-1000" },
  { code: "4-1013", name: "Pendapatan Land Freight",          type: "revenue", parentCode: "4-1000" },
  { code: "4-1014", name: "Pendapatan Custom Clearance",      type: "revenue", parentCode: "4-1000" },
  { code: "4-1015", name: "Pendapatan Penjualan Barang",      type: "revenue", parentCode: "4-1000" },
  { code: "4-1016", name: "Pendapatan Membership Sport Center", type: "revenue", parentCode: "4-1000" },
  { code: "4-1017", name: "Pendapatan Booking Sport Center",    type: "revenue", parentCode: "4-1000" },
  { code: "4-1018", name: "Pendapatan Handling Service",        type: "revenue", parentCode: "4-1000" },
  { code: "4-1019", name: "Pendapatan Document Service",        type: "revenue", parentCode: "4-1000" },
  { code: "4-1021", name: "Pendapatan Sewa Tenant",             type: "revenue", parentCode: "4-1000" },
  // ── Pendapatan Lain-lain ──────────────────────────────────
  { code: "4-1020", name: "Pendapatan Lain-lain",             type: "revenue", parentCode: "4-2000" },
  { code: "4-2010", name: "Pendapatan Bunga",                 type: "revenue", parentCode: "4-2000" },
  { code: "4-2020", name: "Keuntungan Selisih Kurs",          type: "revenue", parentCode: "4-2000" },
  // ── HPP ───────────────────────────────────────────────────
  { code: "5-1010", name: "Harga Pokok Penjualan",            type: "expense", parentCode: "5-1000" },
  { code: "5-1011", name: "Biaya Pengiriman Langsung",        type: "expense", parentCode: "5-1000" },
  { code: "5-1012", name: "Biaya Kepabeanan",                 type: "expense", parentCode: "5-1000" },
  { code: "5-1013", name: "Biaya Penanganan & Handling",      type: "expense", parentCode: "5-1000" },
  // ── HPP Logistics Marketplace ─────────────────────────────
  { code: "5-1020", name: "HPP Jasa Logistik",                type: "expense", parentCode: "5-1000" },
  { code: "5-1021", name: "HPP Sea Freight",                  type: "expense", parentCode: "5-1000" },
  { code: "5-1022", name: "HPP Air Freight",                  type: "expense", parentCode: "5-1000" },
  { code: "5-1023", name: "HPP Trucking / Land Freight",      type: "expense", parentCode: "5-1000" },
  { code: "5-1024", name: "HPP PPJK / Kepabeanan",            type: "expense", parentCode: "5-1000" },
  { code: "5-1025", name: "HPP Handling Service",             type: "expense", parentCode: "5-1000" },
  { code: "5-1026", name: "HPP Document Service",             type: "expense", parentCode: "5-1000" },
  // ── Beban Operasional ─────────────────────────────────────
  { code: "5-2010", name: "Beban Gaji & Tunjangan",           type: "expense", parentCode: "5-2000" },
  { code: "5-2020", name: "Beban Sewa",                       type: "expense", parentCode: "5-2000" },
  { code: "5-2030", name: "Beban Utilitas",                   type: "expense", parentCode: "5-2000" },
  { code: "5-2040", name: "Beban Operasional Lain",           type: "expense", parentCode: "5-2000" },
  { code: "5-2050", name: "Beban Perjalanan Dinas",           type: "expense", parentCode: "5-2000" },
  { code: "5-2060", name: "Beban Representasi & Hiburan",     type: "expense", parentCode: "5-2000" },
  { code: "5-2070", name: "Beban Asuransi",                   type: "expense", parentCode: "5-2000" },
  { code: "5-2080", name: "Beban Komunikasi & Internet",      type: "expense", parentCode: "5-2000" },
  { code: "5-2090", name: "Beban ATK & Perlengkapan",         type: "expense", parentCode: "5-2000" },
  { code: "5-2100", name: "Beban Penyusutan",                 type: "expense", parentCode: "5-2000" },
  // ── Beban Lain-lain ───────────────────────────────────────
  { code: "5-3010", name: "Beban Bunga & Administrasi Bank",  type: "expense", parentCode: "5-3000" },
  { code: "5-3020", name: "Beban Pajak & Perijinan",          type: "expense", parentCode: "5-3000" },
  { code: "5-3030", name: "Kerugian Selisih Kurs",            type: "expense", parentCode: "5-3000" },
];

/** All leaf accounts (for backward compat export) */
export const DEFAULT_ACCOUNTS = COA_LEAF_TEMPLATES;

/** Apply any pending column additions to the companies table and accounting tables */
async function applyRuntimeMigrations(): Promise<void> {
  // companies table column additions
  const companyColMigrations = [
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS code TEXT NOT NULL DEFAULT 'CST'`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'PT B2B Marketplace and Logistic'`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_holding BOOLEAN NOT NULL DEFAULT FALSE`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id INTEGER`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS address TEXT`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS npwp TEXT`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS logo_url TEXT`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE`,
    `ALTER TABLE companies ADD COLUMN IF NOT EXISTS created_at TIMESTAMP NOT NULL DEFAULT NOW()`,
    `CREATE UNIQUE INDEX IF NOT EXISTS companies_code_uniq ON companies (code)`,
  ];
  // accounting tables company_id additions
  const accountingColMigrations = [
    `ALTER TABLE chart_of_accounts ADD COLUMN IF NOT EXISTS company_id INTEGER`,
    `ALTER TABLE accounting_journals ADD COLUMN IF NOT EXISTS company_id INTEGER`,
    `ALTER TABLE accounting_taxes ADD COLUMN IF NOT EXISTS company_id INTEGER`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS company_id INTEGER`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS grir_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS gsheet_spreadsheet_id TEXT`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS tenant_rent_income_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS salary_expense_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS allowance_expense_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS salary_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS tax_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS bpjs_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_cash_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_driver_receivable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
    `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
    `CREATE TABLE IF NOT EXISTS transaction_taxes (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      transaction_type TEXT NOT NULL,
      transaction_id INTEGER NOT NULL,
      transaction_ref TEXT,
      tax_id INTEGER NOT NULL REFERENCES accounting_taxes(id),
      tax_name TEXT NOT NULL,
      tax_rate NUMERIC(6,3) NOT NULL,
      cut_type TEXT NOT NULL DEFAULT 'self_borne',
      base_amount NUMERIC(14,2) NOT NULL,
      tax_amount NUMERIC(14,2) NOT NULL,
      account_id INTEGER REFERENCES chart_of_accounts(id),
      period TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TIMESTAMP,
      reported_at TIMESTAMP,
      notes TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS tx_taxes_tx_uniq ON transaction_taxes(transaction_type, transaction_id, tax_id)`,
    `CREATE INDEX IF NOT EXISTS tx_taxes_company_period_idx ON transaction_taxes(company_id, period)`,
    `CREATE INDEX IF NOT EXISTS tx_taxes_status_idx ON transaction_taxes(status)`,
  ];
  for (const q of [...companyColMigrations, ...accountingColMigrations]) {
    try { await db.execute(sql.raw(q)); } catch { /* column/index already exists or duplicate */ }
  }
  // Sinkronisasi company_code di DB agar konsisten dengan COA codes yang sudah ada.
  // company_code digunakan langsung sebagai abbreviasi suffix di COA dan journal codes.
  const companyCodeFixes: [string, string][] = [
    ["WGS", "WS"],
    ["DVS", "DV"],
    ["ERA", "ER"],
  ];
  for (const [oldCode, newCode] of companyCodeFixes) {
    try {
      await db.execute(sql.raw(
        `UPDATE companies SET company_code = '${newCode}' WHERE company_code = '${oldCode}'`
      ));
    } catch { /* non-fatal */ }
  }

  // Bersihkan gsheet_spreadsheet_id yang tersimpan sebagai URL penuh → extract ID saja
  try {
    await db.execute(sql.raw(`
      UPDATE accounting_settings
      SET gsheet_spreadsheet_id = (regexp_match(gsheet_spreadsheet_id, '/spreadsheets/d/([a-zA-Z0-9_-]+)'))[1]
      WHERE gsheet_spreadsheet_id LIKE '%/spreadsheets/d/%'
    `));
  } catch { /* ignore */ }
  // Add new enum values to accounting_entry_source (safe: ignored if already exists)
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'cogs_delivery'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'logistic_vendor_cost'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_payment'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_reversal'`)); } catch { /* already exists */ }
  // closing_entry + reversal dipakai oleh trigger ae_period_lock_insert_guard_fn — WAJIB ada di enum
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'closing_entry'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'reversal'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation_void'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'fund_transfer'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking'`)); } catch { /* already exists */ }
  try { await db.execute(sql.raw(`ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking_reversal'`)); } catch { /* already exists */ }
  // Deduplicate chart_of_accounts keeping lowest id per (company_id, code) before creating unique index
  try {
    await db.execute(sql.raw(`
      DELETE FROM chart_of_accounts
      WHERE id NOT IN (
        SELECT MIN(id) FROM chart_of_accounts
        GROUP BY COALESCE(company_id::text, '__null__'), code
      )
    `));
  } catch { /* non-fatal: table may be empty or index already prevents dups */ }
  // Deduplicate accounting_journals
  try {
    await db.execute(sql.raw(`
      DELETE FROM accounting_journals
      WHERE id NOT IN (
        SELECT MIN(id) FROM accounting_journals
        GROUP BY COALESCE(company_id::text, '__null__'), code
      )
    `));
  } catch { /* non-fatal */ }
  // Deduplicate expense_categories by code (keep min id per code)
  try {
    await db.execute(sql.raw(`
      DELETE FROM expense_categories
      WHERE id NOT IN (
        SELECT MIN(id) FROM expense_categories GROUP BY code
      )
    `));
  } catch { /* non-fatal */ }
  // Ensure expense_categories.code unique index exists
  try {
    await db.execute(sql.raw(`CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_code_uniq ON expense_categories (code)`));
  } catch { /* already exists */ }
  // Ensure compound unique indexes exist (ignore error if already exists)
  const indexes = [
    `CREATE UNIQUE INDEX IF NOT EXISTS coa_company_code_uniq ON chart_of_accounts (company_id, code)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS journals_company_code_uniq ON accounting_journals (company_id, code)`,
  ];
  for (const q of indexes) {
    try { await db.execute(sql.raw(q)); } catch { /* already exists */ }
  }
  // Remove old single-column unique constraints if they still exist
  const dropConstraints = [
    `ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS chart_of_accounts_code_unique`,
    `ALTER TABLE chart_of_accounts DROP CONSTRAINT IF EXISTS coa_code_global_uniq`,
    `DROP INDEX IF EXISTS coa_code_global_uniq`,
    `ALTER TABLE accounting_journals DROP CONSTRAINT IF EXISTS accounting_journals_code_unique`,
  ];
  for (const q of dropConstraints) {
    try { await db.execute(sql.raw(q)); } catch { /* ok */ }
  }
}

/** Ensure the default holding company exists and return its id */
export async function ensureDefaultCompany(): Promise<number> {
  await applyRuntimeMigrations();
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.companyCode, "CST")).limit(1);
  if (existing) return existing.id;
  const [created] = await db.insert(companiesTable).values({
    companyName: "PT B2B Marketplace and Logistic",
    companyCode: "CST",
    isHolding: true,
  }).onConflictDoNothing().returning();
  if (created) return created.id;
  // Row was inserted by concurrent call — fetch it
  const [row] = await db.select().from(companiesTable).where(eq(companiesTable.companyCode, "CST")).limit(1);
  return row!.id;
}

export async function seedAccountingDefaults(companyId?: number): Promise<void> {
  const cid = companyId ?? (await ensureDefaultCompany());

  // ── Populate ALL_COMPANY_IDS & COMPANY_ABBR dari DB secara dinamis ────────
  // Harus dijalankan sebelum fast-path check agar perusahaan baru (ID > 4)
  // turut disertakan dalam seed COA, jurnal, dan settings.
  await populateDynamicCompanies();

  // ── Fast-path: skip heavy seed if COA, journals, AND settings already fully populated ──
  // Check journals FIRST: if empty → always run full seed regardless of COA state.
  // Count leaf accounts that have a company_id (per-company accounts).
  // Expected: COA_LEAF_TEMPLATES.length × ALL_COMPANY_IDS.length leaf accounts,
  //           6 journal types × companies, settings rows with cash_journal_id populated.
  try {
    const expectedJournals = 6 * ALL_COMPANY_IDS.length; // 6 journal types × N companies

    // ── GUARD: if journals are completely missing, skip fast-path immediately ──────
    const [{ jCount }] = await db
      .select({ jCount: sql<number>`count(*)::int` })
      .from(accountingJournalsTable)
      .where(sql`company_id IS NOT NULL`);
    if (Number(jCount) === 0) {
      logger.info(
        { expectedJournals },
        "Accounting seed: journals table empty — skipping fast-path, running full seed."
      );
      // Fall through to full seed below (do NOT return)
    } else {
      // Journals exist — check COA completeness before deciding to skip
      const [{ leafCount }] = await db
        .select({ leafCount: sql<number>`count(*)::int` })
        .from(chartOfAccountsTable)
        .where(sql`company_id IS NOT NULL`);
      const [{ intercompanyCoaCount }] = await db
        .select({ intercompanyCoaCount: sql<number>`count(*)::int` })
        .from(chartOfAccountsTable)
        .where(sql`
          company_id IS NOT NULL
          AND (code LIKE '1-1099-%' OR code LIKE '2-2098-%')
        `);
      // Governed tax accounts are created only through COA maker-checker
      // requests, so their absence must not force the general seed to rerun.
      const seedManagedLeafCount = COA_LEAF_TEMPLATES.filter(
        (leaf) => !isGovernedTaxCoaCode(leaf.code),
      ).length;
      const expectedLeaves = seedManagedLeafCount * ALL_COMPANY_IDS.length;
      const expectedIntercompanyCoa = ALL_COMPANY_IDS.length * 2;
      if (
        Number(leafCount) >= expectedLeaves &&
        Number(intercompanyCoaCount) >= expectedIntercompanyCoa
      ) {
        // Also verify journals count and settings completeness
        const [{ nullSettingsCnt }] = await db
          .select({ nullSettingsCnt: sql<number>`count(*)::int` })
          .from(accountingSettingsTable)
          .where(sql`cash_journal_id IS NULL AND company_id IS NOT NULL`);
        const [{ totalSettingsCnt }] = await db
          .select({ totalSettingsCnt: sql<number>`count(*)::int` })
          .from(accountingSettingsTable)
          .where(sql`company_id IS NOT NULL`);
        const settingsMissing = Number(totalSettingsCnt) < ALL_COMPANY_IDS.length;
        if (Number(jCount) < expectedJournals || Number(nullSettingsCnt) > 0 || settingsMissing) {
          logger.info(
            { jCount: Number(jCount), expectedJournals, nullSettingsCnt: Number(nullSettingsCnt) },
            "Accounting seed: COA seeded but journals/settings incomplete — running full seed to repair."
          );
          // Fall through to full seed below
        } else {
          logger.info("Accounting seed: COA already fully seeded — skipping (fast path).");
          // Still patch grirAccountId in settings if it's NULL but 2-1045 account exists
          try {
            await db.execute(sql`
              UPDATE accounting_settings AS s
              SET grir_account_id = coa.id
              FROM chart_of_accounts coa
              WHERE coa.code = CONCAT('2-1045-', (
                SELECT abbr FROM companies c WHERE c.id = s.company_id LIMIT 1
              ))
              AND s.grir_account_id IS NULL
              AND s.company_id IS NOT NULL
            `);
            // Also handle global settings row (no company_id)
            await db.execute(sql`
              UPDATE accounting_settings AS s
              SET grir_account_id = (
                SELECT id FROM chart_of_accounts WHERE code LIKE '2-1045%' ORDER BY id LIMIT 1
              )
              WHERE s.grir_account_id IS NULL
            `);
          } catch (e) { /* non-fatal */ }
          return;
        } // end else (journals+settings already seeded)
      } // end if (leafCount >= expectedLeaves)
    } // end else (journals exist)
  } catch {
    // column may not exist yet — fall through to full seed
  }

  logger.info({ companyId: cid }, "Accounting seed: starting COA hierarchy build...");

  // ── Ensure company_id column exists before any insert ────────────────────
  await db.execute(sql`
    ALTER TABLE chart_of_accounts
      ADD COLUMN IF NOT EXISTS company_id integer
  `);

  // ── Dedup chart_of_accounts: keep min(id) per code, reroute FK refs ──────
  await db.execute(sql`
    DO $$
    DECLARE
      loser RECORD;
    BEGIN
      FOR loser IN
        SELECT coa.id AS loser_id, winners.keep_id
        FROM chart_of_accounts coa
        JOIN (
          SELECT code, MIN(id) AS keep_id FROM chart_of_accounts GROUP BY code HAVING COUNT(*) > 1
        ) winners ON coa.code = winners.code AND coa.id <> winners.keep_id
      LOOP
        UPDATE accounting_entry_lines SET account_id = loser.keep_id WHERE account_id = loser.loser_id;
        UPDATE accounting_journals SET default_debit_account_id = loser.keep_id WHERE default_debit_account_id = loser.loser_id;
        UPDATE accounting_journals SET default_credit_account_id = loser.keep_id WHERE default_credit_account_id = loser.loser_id;
        UPDATE accounting_settings SET ar_account_id = loser.keep_id WHERE ar_account_id = loser.loser_id;
        UPDATE accounting_settings SET ap_account_id = loser.keep_id WHERE ap_account_id = loser.loser_id;
        UPDATE accounting_settings SET sales_income_account_id = loser.keep_id WHERE sales_income_account_id = loser.loser_id;
        UPDATE accounting_settings SET purchase_expense_account_id = loser.keep_id WHERE purchase_expense_account_id = loser.loser_id;
        UPDATE accounting_settings SET default_bank_account_id = loser.keep_id WHERE default_bank_account_id = loser.loser_id;
        UPDATE accounting_settings SET default_cash_account_id = loser.keep_id WHERE default_cash_account_id = loser.loser_id;
        UPDATE accounting_settings SET ppn_output_account_id = loser.keep_id WHERE ppn_output_account_id = loser.loser_id;
        UPDATE accounting_settings SET ppn_input_account_id = loser.keep_id WHERE ppn_input_account_id = loser.loser_id;
        UPDATE accounting_settings SET inventory_account_id = loser.keep_id WHERE inventory_account_id = loser.loser_id;
        UPDATE accounting_settings SET cogs_account_id = loser.keep_id WHERE cogs_account_id = loser.loser_id;
        UPDATE accounting_taxes SET account_id = loser.keep_id WHERE account_id = loser.loser_id;
        DELETE FROM chart_of_accounts WHERE id = loser.loser_id;
      END LOOP;
    END $$
  `);

  // ── Migrate single-column index → composite (company_id, code) ───────────
  await db.execute(sql`
    DROP INDEX IF EXISTS chart_of_accounts_code_key
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS coa_company_code_uniq ON chart_of_accounts(company_id, code)
  `);
  // Partial index untuk global accounts (company_id IS NULL) — diperlukan agar
  // ON CONFLICT (code) WHERE company_id IS NULL dapat digunakan saat upsert
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS coa_global_code_uniq ON chart_of_accounts(code) WHERE company_id IS NULL
  `);

  // ── Pass 1: Upsert global parent group accounts (company_id IS NULL) ────────
  // Menggunakan raw SQL karena partial index (WHERE company_id IS NULL) diperlukan
  // untuk ON CONFLICT target — Drizzle ORM tidak mendukung WHERE clause di conflict target
  const parentRoots = COA_PARENTS.filter((p) => !p.parentCode);
  for (const p of parentRoots) {
    await db.execute(sql`
      INSERT INTO chart_of_accounts (code, name, type, company_id)
      VALUES (${p.code}, ${p.name}, ${p.type}::account_type, NULL)
      ON CONFLICT (code) WHERE company_id IS NULL
      DO UPDATE SET name = excluded.name
    `);
  }

  // ── Pass 2: Upsert sub-parent group accounts (level-2 groups) ────────────
  let allAccounts = await db.select().from(chartOfAccountsTable);
  let byCode = new Map(allAccounts.map((a) => [a.code, a]));

  const parentSubs = COA_PARENTS.filter((p) => p.parentCode);
  for (const p of parentSubs) {
    const parentId = byCode.get(p.parentCode!)?.id ?? null;
    await db.execute(sql`
      INSERT INTO chart_of_accounts (code, name, type, parent_id, company_id)
      VALUES (${p.code}, ${p.name}, ${p.type}::account_type, ${parentId}, NULL)
      ON CONFLICT (code) WHERE company_id IS NULL
      DO UPDATE SET name = excluded.name, parent_id = ${parentId}
    `);
  }

  // ── Pass 2b: Rename akun yang masih pakai singkatan lama ─────────────────
  for (const [oldAbbr, newAbbr] of Object.entries(OLD_TO_NEW_ABBR)) {
    const governedTaxCodePredicates = [...GOVERNED_TAX_COA_BASE_CODES].map(
      (baseCode) => sql`${chartOfAccountsTable.code} = ${`${baseCode}-${oldAbbr}`}`,
    );
    await db.execute(sql`
      UPDATE chart_of_accounts
         SET code = REPLACE(code, ${"-" + oldAbbr}, ${"-" + newAbbr}),
             name = REPLACE(name, ${" " + oldAbbr}, ${" " + newAbbr})
       WHERE code LIKE ${"%-" + oldAbbr}
         AND NOT (${sql.join(governedTaxCodePredicates, sql` OR `)})
    `);
  }

  // ── Pass 3: Upsert per-company leaf accounts with abbreviation suffix ─────
  allAccounts = await db.select().from(chartOfAccountsTable);
  byCode = new Map(allAccounts.map((a) => [a.code, a]));

  for (const companyId of ALL_COMPANY_IDS) {
    const abbr = COMPANY_ABBR[companyId]!;
    for (const leaf of COA_LEAF_TEMPLATES) {
      if (isGovernedTaxCoaCode(leaf.code)) {
        // Tax headers/subaccounts and legacy tax fallback accounts are
        // governed. Do not create, rename, or repair them from startup seed.
        continue;
      }
      const parentId = leaf.parentCode ? (byCode.get(leaf.parentCode)?.id ?? null) : null;
      const companyCode = `${leaf.code}-${abbr}`;
      const companyName = `${leaf.name} ${abbr}`;
      await db
        .insert(chartOfAccountsTable)
        .values({
          code: companyCode,
          name: companyName,
          type: leaf.type,
          parentId: parentId ?? undefined,
          companyId,
        })
        .onConflictDoUpdate({
          target: [chartOfAccountsTable.companyId, chartOfAccountsTable.code],
          set: { name: sql`excluded.name`, parentId: parentId },
        });
    }
  }

  // Tax headers and subaccounts are intentionally absent from this seed.
  // Run coaTaxMigration and approve its change requests instead.
  logger.info("Accounting seed: tax COA creation deferred to maker-checker governance.");

  logger.info("Accounting seed: COA hierarchy done.");

  allAccounts = await db.select().from(chartOfAccountsTable);
  byCode = new Map(allAccounts.map((a) => [a.code, a]));

  const needFor = (baseCode: string, companyId: number) => {
    const abbr = COMPANY_ABBR[companyId]!;
    const key = `${baseCode}-${abbr}`;
    const a = byCode.get(key);
    if (!a) throw new Error(`Seed missing required account ${key}`);
    return a;
  };

  // ── Journals: ensure company_id column exists ─────────────────────────────
  await db.execute(sql`
    ALTER TABLE accounting_journals ADD COLUMN IF NOT EXISTS company_id integer
  `);

  // ── Migrate legacy global journals (no company_id) → assign to company 1 ─
  const LEGACY_RENAME: Record<string, string> = {
    SAL: "SAL-CST",
    PUR: "PUR-CST",
    BNK: "BNK-CST",
    CSH: "CSH-CST",
    GEN: "GEN-CST",
    EXP: "EXP-CST",
  };
  for (const [oldCode, newCode] of Object.entries(LEGACY_RENAME)) {
    await db.execute(sql`
      UPDATE accounting_journals
         SET code = ${newCode}, company_id = 1
       WHERE code = ${oldCode} AND (company_id IS NULL)
    `);
  }

  // ── Per-company journal templates ─────────────────────────────────────────
  interface JournalTemplate {
    suffix: string;
    label: string;
    type: "sales" | "purchase" | "bank" | "cash" | "general";
    debitBase: string | null;
    creditBase: string | null;
  }
  const JOURNAL_TEMPLATES: JournalTemplate[] = [
    { suffix: "SAL", label: "Penjualan",              type: "sales",    debitBase: "1-1030", creditBase: "4-1010" },
    { suffix: "PUR", label: "Pembelian",              type: "purchase", debitBase: "5-1010", creditBase: "2-1010" },
    { suffix: "BNK", label: "Bank Mandiri",           type: "bank",     debitBase: "1-1020", creditBase: "1-1020" },
    { suffix: "CSH", label: "Kas Kecil",              type: "cash",     debitBase: "1-1010", creditBase: "1-1010" },
    { suffix: "GEN", label: "Memorial / Penyesuaian", type: "general",  debitBase: null,     creditBase: null     },
    { suffix: "EXP", label: "Beban & Reimburse",      type: "purchase", debitBase: "5-1010", creditBase: "2-1010" },
  ];

  for (const companyId of ALL_COMPANY_IDS) {
    const abbr = COMPANY_ABBR[companyId]!;
    for (const tpl of JOURNAL_TEMPLATES) {
      const code = `${tpl.suffix}-${abbr}`;
      const name = tpl.label + (tpl.suffix === "BNK" ? ` ${abbr}` : "");
      const debitId  = tpl.debitBase  ? (byCode.get(`${tpl.debitBase}-${abbr}`)?.id  ?? null) : null;
      const creditId = tpl.creditBase ? (byCode.get(`${tpl.creditBase}-${abbr}`)?.id ?? null) : null;
      await db
        .insert(accountingJournalsTable)
        .values({
          code,
          name,
          type: tpl.type,
          companyId,
          defaultDebitAccountId:  debitId,
          defaultCreditAccountId: creditId,
        })
        .onConflictDoUpdate({
          target: [accountingJournalsTable.companyId, accountingJournalsTable.code],
          set: {
            name: sql`excluded.name`,
            // COALESCE: preserve any manually-configured account; only fill in null
            // slots from the seed value (existing non-null is always kept).
            defaultDebitAccountId:  sql`COALESCE(accounting_journals.default_debit_account_id,  excluded.default_debit_account_id)`,
            defaultCreditAccountId: sql`COALESCE(accounting_journals.default_credit_account_id, excluded.default_credit_account_id)`,
          },
        });
    }
  }

  // Load journals for ALL companies (not just cid) so that getJournal("BNK", 2) etc.
  // can resolve WS/DV/ER journals when seeding settings for companies 2–4.
  const allJournals = await db.select().from(accountingJournalsTable).where(isNotNull(accountingJournalsTable.companyId));
  const journalByCode = new Map(allJournals.map((j) => [j.code, j]));

  const getJournal = (suffix: string, companyId: number) => {
    const abbr = COMPANY_ABBR[companyId]!;
    return journalByCode.get(`${suffix}-${abbr}`)!;
  };

  // aliases for company 1 (used below for taxes & expense categories)
  const salesJ = getJournal("SAL", 1);
  const purJ   = getJournal("PUR", 1);
  const bankJ  = getJournal("BNK", 1);
  const cashJ  = getJournal("CSH", 1);
  const expJ   = getJournal("EXP", 1);

  // ── Taxes: add company_id column + migrate to per-company ────────────────
  await db.execute(sql`
    ALTER TABLE accounting_taxes ADD COLUMN IF NOT EXISTS company_id integer
  `);

  // ── Taxes: add withholding value to tax_kind enum if not exists ───────────
  try {
    await db.execute(sql.raw(`ALTER TYPE tax_kind ADD VALUE IF NOT EXISTS 'withholding'`));
  } catch { /* already exists */ }

  // ── Taxes: create cut_type enum and add cut_type column ──────────────────
  try {
    await db.execute(sql.raw(`
      DO $$ BEGIN
        CREATE TYPE cut_type AS ENUM ('self_borne', 'withholding');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `));
  } catch { /* already exists */ }
  try {
    await db.execute(sql.raw(`
      ALTER TABLE accounting_taxes
        ADD COLUMN IF NOT EXISTS cut_type cut_type NOT NULL DEFAULT 'self_borne'
    `));
  } catch { /* already exists */ }

  // Dedup taxes: keep min(id) per (kind, company_id)
  await db.execute(sql`
    DELETE FROM accounting_taxes
    WHERE id NOT IN (
      SELECT MIN(id) FROM accounting_taxes GROUP BY kind, COALESCE(company_id, 0)
    )
  `);

  // Assign existing taxes with null company_id to company 1
  await db.execute(sql`
    UPDATE accounting_taxes SET company_id = 1 WHERE company_id IS NULL
  `);

  // Define PPh tax templates
  interface TaxTemplate {
    name: string;
    rate: string;
    kind: "sale" | "purchase" | "withholding";
    cutType: "self_borne" | "withholding";
    accountBase: string; // base COA code
    uniqueKey: string;   // used to detect if already exists
  }
  const TAX_TEMPLATES: TaxTemplate[] = [
    { name: "PPN Keluaran 11%",         rate: "11.000", kind: "sale",        cutType: "self_borne",  accountBase: "2-1020", uniqueKey: "sale" },
    { name: "PPN Masukan 11%",          rate: "11.000", kind: "purchase",     cutType: "self_borne",  accountBase: "1-1050", uniqueKey: "purchase" },
    { name: "PPh 21",                   rate: "5.000",  kind: "withholding",  cutType: "withholding", accountBase: "2-1030", uniqueKey: "pph21" },
    { name: "PPh 23",                   rate: "2.000",  kind: "withholding",  cutType: "withholding", accountBase: "2-1030", uniqueKey: "pph23" },
    { name: "PPh Final",                rate: "0.500",  kind: "withholding",  cutType: "self_borne",  accountBase: "2-1030", uniqueKey: "pphfinal" },
    { name: "PPh Freight Paket 1,1%",   rate: "1.100",  kind: "withholding",  cutType: "withholding", accountBase: "2-1030", uniqueKey: "pphfreight" },
  ];

  // Seed all tax templates per company
  for (const companyId of ALL_COMPANY_IDS) {
    const existingForCompany = await db
      .select()
      .from(accountingTaxesTable)
      .where(eq(accountingTaxesTable.companyId, companyId));

    for (const tpl of TAX_TEMPLATES) {
      const accountRow = byCode.get(`${tpl.accountBase}-${COMPANY_ABBR[companyId]}`);
      if (!accountRow) {
        logger.warn(
          { accountCode: `${tpl.accountBase}-${COMPANY_ABBR[companyId]}`, companyId },
          "Accounting seed: tax template deferred until governed COA account is approved.",
        );
        continue;
      }

      // Detect existing by kind for PPN, by name-prefix for PPh
      let existing: typeof existingForCompany[0] | undefined;
      if (tpl.uniqueKey === "sale")       existing = existingForCompany.find((t) => t.kind === "sale");
      else if (tpl.uniqueKey === "purchase") existing = existingForCompany.find((t) => t.kind === "purchase");
      else existing = existingForCompany.find((t) => t.name === tpl.name);

      if (!existing) {
        await db.execute(sql.raw(`
          INSERT INTO accounting_taxes (name, rate, kind, cut_type, account_id, company_id, is_active)
          VALUES ('${tpl.name}', '${tpl.rate}', '${tpl.kind}', '${tpl.cutType}', ${accountRow.id}, ${companyId}, true)
          ON CONFLICT DO NOTHING
        `));
      } else {
        // Patch account_id and cut_type on existing rows
        await db.execute(sql.raw(`
          UPDATE accounting_taxes
          SET account_id = ${accountRow.id},
              cut_type = '${tpl.cutType}'
          WHERE id = ${existing.id}
        `));
      }
    }
  }

  const allTaxes    = await db.select().from(accountingTaxesTable).where(eq(accountingTaxesTable.companyId, 1));
  const saleTax     = allTaxes.find((t) => t.kind === "sale");
  const purchaseTax = allTaxes.find((t) => t.kind === "purchase");

  // ── Settings: upsert for all 4 companies using their own accounts ─────────
  const existingSettingsList = await db.select().from(accountingSettingsTable);
  const existingByCompany    = new Map(existingSettingsList.map((s) => [s.companyId ?? 1, s]));

  for (const companyId of ALL_COMPANY_IDS) {
    const cash        = needFor("1-1010", companyId);
    const bankMandiri = needFor("1-1020", companyId);
    const ar          = needFor("1-1030", companyId);
    const inventory   = needFor("1-1040", companyId);
    const ppnIn       = byCode.get(`1-1050-${COMPANY_ABBR[companyId]}`);
    const ap          = needFor("2-1010", companyId);
    const ppnOut      = needFor("2-1020", companyId);
    const salesIncome           = needFor("4-1010", companyId);
    const tenantRentIncome      = byCode.get(`4-1021-${COMPANY_ABBR[companyId]}`) ?? byCode.get("4-1021") ?? null;
    const cogs                  = needFor("5-1010", companyId);
    const freightExpense        = needFor("5-1011", companyId);

    const cSalesJ = getJournal("SAL", companyId);
    const cPurJ   = getJournal("PUR", companyId);
    const cBankJ  = getJournal("BNK", companyId);
    const cCashJ  = getJournal("CSH", companyId);
    const abbr = COMPANY_ABBR[companyId]!;

    const grir = byCode.get(`2-1045-${abbr}`);

    const settingsBase = {
      arAccountId:             ar.id,
      apAccountId:             ap.id,
      salesIncomeAccountId:    salesIncome.id,
      purchaseExpenseAccountId: freightExpense.id,
      defaultBankAccountId:    bankMandiri.id,
      defaultCashAccountId:    cash.id,
      ppnOutputAccountId:      ppnOut.id,
      ppnInputAccountId:       ppnIn?.id ?? null,
      salesJournalId:          cSalesJ?.id ?? salesJ.id,
      purchaseJournalId:       cPurJ?.id   ?? purJ.id,
      bankJournalId:           cBankJ?.id  ?? bankJ.id,
      cashJournalId:           cCashJ?.id  ?? cashJ.id,
      defaultSalesTaxId:       saleTax?.id ?? null,
      defaultPurchaseTaxId:    purchaseTax?.id ?? null,
      inventoryAccountId:      inventory.id,
      cogsAccountId:              cogs.id,
      grirAccountId:              grir?.id ?? null,
      tenantRentIncomeAccountId:  tenantRentIncome?.id ?? null,
    };

    const existing = existingByCompany.get(companyId);
    if (!existing) {
      await db.insert(accountingSettingsTable).values({ ...settingsBase, companyId });
      logger.info(`Accounting seed: created settings for company ${companyId} (${COMPANY_ABBR[companyId]}).`);
    } else {
      await db.update(accountingSettingsTable)
        .set(settingsBase)
        .where(eq(accountingSettingsTable.id, existing.id));
      logger.info(`Accounting seed: updated settings for company ${companyId} (${COMPANY_ABBR[companyId]}).`);
    }
  }

  // ── Expense categories: seed using CST accounts ───────────────────────────
  const c1ExpByCode = new Map(
    allAccounts
      .filter((a) => a.companyId === 1)
      .map((a) => {
        const baseCode = a.code.replace(/-CST$/, "");
        return [baseCode, a];
      }),
  );
  const c1ap = needFor("2-1010", 1);
  await seedExpenseCategories(c1ExpByCode, expJ.id, c1ap.id);

  // ── Post-seed health check: warn loudly if any settings row still has null journals ──
  // A null cashJournalId/bankJournalId after seed means sport center accounting will fail
  // at payment time. Surface it now as a prominent WARNING rather than a silent skip later.
  try {
    const nullJournalRows = await db.execute(sql`
      SELECT s.company_id, c.company_name, s.cash_journal_id, s.bank_journal_id
      FROM accounting_settings s
      LEFT JOIN companies c ON c.id = s.company_id
      WHERE s.company_id IS NOT NULL
        AND (s.cash_journal_id IS NULL OR s.bank_journal_id IS NULL)
    `);
    if (nullJournalRows.rows.length > 0) {
      const affected = (nullJournalRows.rows as Array<Record<string, unknown>>).map(
        (r) => `company_id=${r["company_id"]} (${r["company_name"] ?? "?"}) cashJournalId=${r["cash_journal_id"] ?? "NULL"} bankJournalId=${r["bank_journal_id"] ?? "NULL"}`
      );
      logger.warn(
        { affectedCompanies: affected },
        "⚠️  ACCOUNTING HEALTH CHECK: accounting_settings rows with NULL journal IDs detected after seed. " +
        "Sport center payments will throw JOURNAL_MISSING errors until these are configured. " +
        "Go to Accounting → Settings and set Cash Journal / Bank Journal for each affected company. " +
        `Affected: ${affected.join("; ")}`
      );
    } else {
      logger.info("Accounting health check: all settings rows have journal IDs populated — OK.");
    }
  } catch (hcErr) {
    logger.warn({ hcErr }, "Accounting health check: could not verify journal settings (non-fatal).");
  }

  logger.info({ totalCompanies: ALL_COMPANY_IDS.length, companyIds: ALL_COMPANY_IDS }, "Accounting seed: complete (per-company COA).");
}

async function seedExpenseCategories(
  byBaseCode: Map<string, { id: number; code: string; name: string }>,
  expJournalId: number,
  apAccountId: number,
): Promise<void> {
  const existing = await db.select().from(expenseCategoriesTable);
  if (existing.length > 0) return;

  const get = (code: string) => byBaseCode.get(code)?.id ?? null;

  const cats = [
    { code: "EXP-GAJI",    name: "Gaji & Tunjangan",           expenseAccountId: get("5-2010"), payableAccountId: apAccountId },
    { code: "EXP-SEWA",    name: "Sewa Gedung & Kantor",        expenseAccountId: get("5-2020"), payableAccountId: apAccountId },
    { code: "EXP-UTIL",    name: "Listrik, Air & Gas",          expenseAccountId: get("5-2030"), payableAccountId: apAccountId },
    { code: "EXP-ATK",     name: "ATK & Perlengkapan Kantor",   expenseAccountId: get("5-2090"), payableAccountId: apAccountId },
    { code: "EXP-DINAS",   name: "Perjalanan Dinas",            expenseAccountId: get("5-2050"), payableAccountId: apAccountId },
    { code: "EXP-REPRS",   name: "Representasi & Hiburan",      expenseAccountId: get("5-2060"), payableAccountId: apAccountId },
    { code: "EXP-ASURANSI",name: "Asuransi",                    expenseAccountId: get("5-2070"), payableAccountId: apAccountId },
    { code: "EXP-KOMUN",   name: "Komunikasi & Internet",       expenseAccountId: get("5-2080"), payableAccountId: apAccountId },
    { code: "EXP-KIRIM",   name: "Biaya Pengiriman",            expenseAccountId: get("5-1011"), payableAccountId: apAccountId },
    { code: "EXP-PABEAN",  name: "Biaya Kepabeanan",            expenseAccountId: get("5-1012"), payableAccountId: apAccountId },
    { code: "EXP-HANDLING",name: "Biaya Handling & Penanganan", expenseAccountId: get("5-1013"), payableAccountId: apAccountId },
    { code: "EXP-BUNGA",   name: "Beban Bunga & Adm. Bank",     expenseAccountId: get("5-3010"), payableAccountId: apAccountId },
    { code: "EXP-PAJAK",   name: "Pajak & Perijinan",           expenseAccountId: get("5-3020"), payableAccountId: apAccountId },
    { code: "EXP-OPS",     name: "Beban Operasional Lainnya",   expenseAccountId: get("5-2040"), payableAccountId: apAccountId },
  ];
  const validCats = cats.filter((c) => c.expenseAccountId !== null);
  if (validCats.length > 0) {
    await db.insert(expenseCategoriesTable).values(validCats).onConflictDoNothing();
    logger.info(`Accounting seed: seeded ${validCats.length} expense categories.`);
  }
}

// ── Backfill legacy expense categories missing an account mapping ────────────
// Some early "EXP-*" rows were inserted before their target account existed,
// leaving expense_account_id NULL. Any expense that later "auto-detects" this
// category (e.g. via OCR) then falls back to the generic "Beban Operasional
// Lain" account instead of the category's real account (e.g. "Pajak &
// Perijinan" → "Beban Pajak & Perijinan"). This backfill is idempotent: it
// only fills rows that are still NULL, matching by the category code's
// intended base account code against that company's chart of accounts.
const LEGACY_CATEGORY_ACCOUNT_CODE: Record<string, string> = {
  "EXP-GAJI": "5-2010",
  "EXP-SEWA": "5-2020",
  "EXP-UTIL": "5-2030",
  "EXP-ATK": "5-2090",
  "EXP-DINAS": "5-2050",
  "EXP-REPRS": "5-2060",
  "EXP-ASURANSI": "5-2070",
  "EXP-KOMUN": "5-2080",
  "EXP-KIRIM": "5-1011",
  "EXP-PABEAN": "5-1012",
  "EXP-HANDLING": "5-1013",
  "EXP-BUNGA": "5-3010",
  "EXP-PAJAK": "5-3020",
  "EXP-OPS": "5-2040",
  "BIAYA-OCEAN-FREIGHT": "5-1021",
  "BIAYA-AIR-FREIGHT": "5-1022",
  "BIAYA-TRUCKING": "5-1023",
  "BIAYA-CUSTOMS": "5-1024",
  "BIAYA-HANDLING": "5-1025",
  "BIAYA-STORAGE": "5-1020",
  "BIAYA-ASURANSI": "5-2070",
  "BIAYA-LAINNYA": "5-1020",
};

export async function backfillExpenseCategoryAccounts(): Promise<void> {
  try {
    const rows = await db
      .select({
        id: expenseCategoriesTable.id,
        code: expenseCategoriesTable.code,
        companyId: expenseCategoriesTable.companyId,
      })
      .from(expenseCategoriesTable)
      .where(sql`${expenseCategoriesTable.expenseAccountId} IS NULL`);

    const candidates = rows.filter((r) => LEGACY_CATEGORY_ACCOUNT_CODE[String(r.code ?? "").toUpperCase()]);
    if (candidates.length === 0) return;

    let fixed = 0;
    for (const cat of candidates) {
      const baseCode = LEGACY_CATEGORY_ACCOUNT_CODE[String(cat.code).toUpperCase()];
      const [account] = await db
        .select({ id: chartOfAccountsTable.id })
        .from(chartOfAccountsTable)
        .where(
          sql`${chartOfAccountsTable.companyId} = ${cat.companyId} AND ${chartOfAccountsTable.code} LIKE ${baseCode + "-%"}`,
        )
        .limit(1);
      if (!account) continue;

      await db
        .update(expenseCategoriesTable)
        .set({ expenseAccountId: account.id })
        .where(eq(expenseCategoriesTable.id, cat.id));
      fixed++;
    }
    if (fixed > 0) {
      logger.info(`Accounting seed: backfilled ${fixed} expense categor${fixed === 1 ? "y" : "ies"} missing an account mapping.`);
    }
  } catch (err) {
    logger.warn({ err }, "backfillExpenseCategoryAccounts: failed (non-fatal)");
  }
}

// ── Additional tax rates — runs unconditionally on every boot ────────────────
const ADDITIONAL_TAX_TEMPLATES: {
  name: string;
  rate: string;
  kind: "sale" | "purchase" | "withholding";
  cutType: "self_borne" | "withholding";
  accountBase: string;
}[] = [
  { name: "PPN Keluaran 12%",           rate: "12.000", kind: "sale",       cutType: "self_borne",  accountBase: "2-1020" },
  { name: "PPN Masukan 12%",            rate: "12.000", kind: "purchase",   cutType: "self_borne",  accountBase: "1-1050" },
  { name: "PPh 4(2) Sewa 10%",          rate: "10.000", kind: "withholding",cutType: "withholding", accountBase: "2-1030" },
  { name: "PPh 15 Pelayaran DN 1,2%",   rate: "1.200",  kind: "withholding",cutType: "withholding", accountBase: "2-1030" },
  { name: "PPh 15 Pelayaran LN 2,64%",  rate: "2.640",  kind: "withholding",cutType: "withholding", accountBase: "2-1030" },
  { name: "PPh 26 20%",                 rate: "20.000", kind: "withholding",cutType: "withholding", accountBase: "2-1030" },
];

export async function seedAdditionalTaxes(): Promise<void> {
  try {
    await populateDynamicCompanies();
    for (const cid of ALL_COMPANY_IDS) {
      const abbr = COMPANY_ABBR[cid]!;

      const existingRows = await db
        .select({ id: accountingTaxesTable.id, name: accountingTaxesTable.name })
        .from(accountingTaxesTable)
        .where(eq(accountingTaxesTable.companyId, cid));

      const existingNames = new Set(existingRows.map((r) => r.name.trim().toLowerCase()));

      for (const tpl of ADDITIONAL_TAX_TEMPLATES) {
        if (existingNames.has(tpl.name.trim().toLowerCase())) continue;

        const accountCode = `${tpl.accountBase}-${abbr}`;
        const [accountRow] = await db
          .select({ id: chartOfAccountsTable.id })
          .from(chartOfAccountsTable)
          .where(sql`${chartOfAccountsTable.code} = ${accountCode} AND ${chartOfAccountsTable.companyId} = ${cid}`)
          .limit(1);

        if (!accountRow) {
          logger.warn({ accountCode, cid }, "seedAdditionalTaxes: account not found, skip");
          continue;
        }

        await db.execute(sql.raw(`
          INSERT INTO accounting_taxes (name, rate, kind, cut_type, account_id, company_id, is_active)
          VALUES ('${tpl.name.replace(/'/g, "''")}', '${tpl.rate}', '${tpl.kind}', '${tpl.cutType}', ${accountRow.id}, ${cid}, true)
          ON CONFLICT DO NOTHING
        `));

        logger.info({ name: tpl.name, cid, abbr }, "seedAdditionalTaxes: inserted new tax");
      }
    }

    logger.info("seedAdditionalTaxes: done");
  } catch (err) {
    logger.warn({ err }, "seedAdditionalTaxes: failed (non-fatal)");
  }
}

/** List of ALTER TABLE statements to add missing columns to accounting_settings.
 *  Called automatically if a SELECT fails with "column does not exist" (PG 42703). */
const ACCOUNTING_SETTINGS_COL_PATCHES = [
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS salary_expense_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS allowance_expense_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS salary_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS tax_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS bpjs_payable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_cash_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS fleet_driver_receivable_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS tenant_rent_income_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS grir_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS gsheet_spreadsheet_id TEXT`,
  `ALTER TABLE accounting_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()`,
];

let _accountingSettingsPatchApplied = false;

async function applyAccountingSettingsColumnPatches(): Promise<void> {
  if (_accountingSettingsPatchApplied) return;
  for (const q of ACCOUNTING_SETTINGS_COL_PATCHES) {
    try { await db.execute(sql.raw(q)); } catch { /* column already exists or FK missing — ignore */ }
  }
  _accountingSettingsPatchApplied = true;
  logger.info("accounting_settings column patches applied");
}

/** Enum values required by triggers and application logic but sometimes missing in prod.
 *  Safe to call multiple times — ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent. */
const ENUM_PATCHES = [
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'closing_entry'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'reversal'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'bank_reconciliation_void'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'fund_transfer'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'cogs_delivery'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'logistic_vendor_cost'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_payment'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'tenant_rent_reversal'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking'`,
  `ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'sport_center_booking_reversal'`,
];

let _enumPatchApplied = false;

/** Apply missing enum values to accounting_entry_source. Called automatically on 22P02 error. */
export async function applyAccountingEnumPatches(): Promise<void> {
  if (_enumPatchApplied) return;
  for (const q of ENUM_PATCHES) {
    try { await db.execute(sql.raw(q)); } catch { /* ignore */ }
  }
  _enumPatchApplied = true;
  logger.info("accounting_entry_source enum patches applied");
}

export async function getAccountingSettings(companyId = 1): Promise<typeof accountingSettingsTable.$inferSelect | null> {
  try {
    const [row] = await db
      .select()
      .from(accountingSettingsTable)
      .where(eq(accountingSettingsTable.companyId, companyId))
      .limit(1);
    return row ?? null;
  } catch (err: unknown) {
    // PostgreSQL 42703 = "column does not exist" — schema drift between Drizzle model and DB.
    // Self-heal: apply missing column patches then retry once.
    const pgCode = (err as { cause?: { code?: string } })?.cause?.code;
    if (pgCode === "42703") {
      logger.warn({ companyId, pgCode }, "getAccountingSettings: column missing — applying schema patches and retrying");
      await applyAccountingSettingsColumnPatches();
      const [row] = await db
        .select()
        .from(accountingSettingsTable)
        .where(eq(accountingSettingsTable.companyId, companyId))
        .limit(1);
      return row ?? null;
    }
    throw err;
  }
}

/** Lookup COA dan journal yang tersedia lalu return partial settings untuk auto-populate. */
async function resolveSettingsFromCoa(companyId: number): Promise<Partial<typeof accountingSettingsTable.$inferInsert>> {
  const cFilter = companyId;
  // Gunakan kode akun dengan suffix perusahaan agar menemukan akun yang tepat
  // (misal: 1-1010-ER bukan 1-1010 global). FIX: sebelumnya pakai base code saja
  // sehingga fallback ke akun global/CST yang salah untuk perusahaan lain.
  const abbr = COMPANY_ABBR[companyId as keyof typeof COMPANY_ABBR] ?? null;
  const coaCode = (base: string) => abbr ? `${base}-${abbr}` : base;

  const lookupCoa = async (baseCode: string): Promise<number | null> => {
    const code = coaCode(baseCode);
    // Coba kode dengan suffix perusahaan dahulu
    let [row] = await db
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(sql`${chartOfAccountsTable.code} = ${code} AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
      .limit(1);
    // Fallback ke kode base tanpa suffix (untuk perusahaan tanpa abbreviation)
    if (!row && code !== baseCode) {
      [row] = await db
        .select({ id: chartOfAccountsTable.id })
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} = ${baseCode} AND ${chartOfAccountsTable.companyId} = ${cFilter}`)
        .limit(1);
    }
    // Fallback global: cari suffixed code tanpa filter company
    if (!row) {
      [row] = await db
        .select({ id: chartOfAccountsTable.id })
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} = ${code}`)
        .limit(1);
    }
    // Fallback global: cari base code tanpa suffix (legacy/global accounts)
    if (!row && code !== baseCode) {
      [row] = await db
        .select({ id: chartOfAccountsTable.id })
        .from(chartOfAccountsTable)
        .where(sql`${chartOfAccountsTable.code} = ${baseCode}`)
        .limit(1);
    }
    return row?.id ?? null;
  };

  const lookupJournal = async (type: string): Promise<number | null> => {
    let [row] = await db
      .select({ id: accountingJournalsTable.id })
      .from(accountingJournalsTable)
      .where(sql`${accountingJournalsTable.type} = ${type} AND ${accountingJournalsTable.companyId} = ${cFilter}`)
      .limit(1);
    if (!row) {
      [row] = await db
        .select({ id: accountingJournalsTable.id })
        .from(accountingJournalsTable)
        .where(sql`${accountingJournalsTable.type} = ${type}`)
        .limit(1);
    }
    return row?.id ?? null;
  };

  const [cashAccountId, bankAccountId, salesIncomeId, arAccountId, apAccountId, cashJournalId, bankJournalId, salesJournalId, purchaseJournalId] = await Promise.all([
    lookupCoa("1-1010"),
    lookupCoa("1-1020"),
    lookupCoa("4-1010"),
    lookupCoa("1-1030"),
    lookupCoa("2-1010"),
    lookupJournal("cash"),
    lookupJournal("bank"),
    lookupJournal("sales"),
    lookupJournal("purchase"),
  ]);

  return {
    defaultCashAccountId: cashAccountId,
    defaultBankAccountId: bankAccountId,
    salesIncomeAccountId: salesIncomeId,
    arAccountId,
    apAccountId,
    cashJournalId,
    bankJournalId,
    salesJournalId,
    purchaseJournalId,
  };
}

export async function ensureAccountingSettings(companyId = 1): Promise<typeof accountingSettingsTable.$inferSelect> {
  const existing = await getAccountingSettings(companyId);
  if (existing) {
    // Jika field kas/jurnal masih null (belum dikonfigurasi manual), coba auto-populate dari COA
    const needsPopulate = !existing.defaultCashAccountId && !existing.defaultBankAccountId && !existing.cashJournalId && !existing.bankJournalId;
    if (needsPopulate) {
      try {
        const patch = await resolveSettingsFromCoa(companyId);
        const hasAny = Object.values(patch).some((v) => v != null);
        if (hasAny) {
          const [updated] = await db
            .update(accountingSettingsTable)
            .set(patch)
            .where(eq(accountingSettingsTable.id, existing.id))
            .returning();
          logger.info({ companyId, patch }, "ensureAccountingSettings: auto-populated settings dari COA");
          return updated ?? existing;
        }
      } catch (err) {
        logger.warn({ companyId, err }, "ensureAccountingSettings: gagal auto-populate dari COA");
      }
    }
    return existing;
  }

  // Create baru dengan auto-populate dari COA
  let autoFields: Partial<typeof accountingSettingsTable.$inferInsert> = {};
  try {
    autoFields = await resolveSettingsFromCoa(companyId);
  } catch {
    // ignore, fallback ke kosong
  }
  const [created] = await db
    .insert(accountingSettingsTable)
    .values({ companyId, ...autoFields })
    .returning();
  logger.info({ companyId, autoFields }, "ensureAccountingSettings: created new settings");
  return created!;
}

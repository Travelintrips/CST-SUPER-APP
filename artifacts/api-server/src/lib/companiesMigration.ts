import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const FOUR_COMPANIES = [
  { id: 1, company_name: "PT Cahaya Sejati Teknologi", company_code: "CST", npwp: null },
  { id: 2, company_name: "PT Wangsamas", company_code: "WGS", npwp: null },
  { id: 3, company_name: "PT Diva Servis", company_code: "DVS", npwp: null },
  { id: 4, company_name: "PT Elmira Ratu Abadi", company_code: "ERA", npwp: null },
];

export async function runCompaniesMigration(): Promise<void> {
  try {
    // 1. Create companies table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS companies (
        id           SERIAL PRIMARY KEY,
        company_name TEXT NOT NULL,
        company_code TEXT NOT NULL UNIQUE,
        logo_url     TEXT,
        address      TEXT,
        phone        TEXT,
        email        TEXT,
        npwp         TEXT,
        is_active    BOOLEAN NOT NULL DEFAULT TRUE,
        created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // 2. Ensure name column is nullable (legacy schema compat)
    await db.execute(sql.raw(`ALTER TABLE companies ALTER COLUMN name DROP NOT NULL`)).catch(() => {});

    // 2. Seed 4 companies (idempotent)
    for (const c of FOUR_COMPANIES) {
      await db.execute(sql`
        INSERT INTO companies (id, company_name, company_code, npwp)
        VALUES (${c.id}, ${c.company_name}, ${c.company_code}, ${c.npwp})
        ON CONFLICT (id) DO UPDATE
          SET company_name = EXCLUDED.company_name,
              company_code = EXCLUDED.company_code
      `);
    }
    await db.execute(sql`SELECT setval('companies_id_seq', (SELECT MAX(id) FROM companies))`);

    // 2b. Add missing columns to companies table (idempotent)
    await db.execute(sql.raw(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_holding BOOLEAN NOT NULL DEFAULT FALSE`));
    await db.execute(sql.raw(`ALTER TABLE companies ADD COLUMN IF NOT EXISTS parent_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`));

    // 2c. Tambah kolom data perusahaan lengkap (idempotent)
    const newCols: string[] = [
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS city TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS province TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS postal_code TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS kode_wilayah TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS fax TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS website TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS npwp_status TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS kegiatan_utama TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS jenis_wajib_pajak TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS bentuk_badan_hukum TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS tanggal_terdaftar TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS tanggal_aktivasi TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS status_pkp BOOLEAN`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS tanggal_pkp TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS kanwil_djp TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS kpp_terdaftar TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS seksi_pengawasan TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS tanggal_pembaruan_profil TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS kode_klu TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS deskripsi_klu TEXT`,
      `ALTER TABLE companies ADD COLUMN IF NOT EXISTS nib TEXT`,
    ];
    for (const stmt of newCols) {
      await db.execute(sql.raw(stmt)).catch(() => {});
    }

    // 2d. Buat tabel dokumen legal perusahaan (idempotent)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS company_legal_documents (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        doc_type    TEXT NOT NULL,
        doc_name    TEXT NOT NULL,
        file_url    TEXT NOT NULL,
        file_size   INTEGER,
        mime_type   TEXT,
        notes       TEXT,
        uploaded_by INTEGER,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS cld_company_idx ON company_legal_documents (company_id)`));

    // 3. Add company_id to accounting tables (idempotent)
    for (const tbl of ["accounting_entries", "accounting_payments", "accounting_settings", "expenses"]) {
      await db.execute(
        sql.raw(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`),
      );
    }

    // 4. Add company_id to purchase_documents (idempotent)
    await db.execute(sql.raw(
      `ALTER TABLE purchase_documents ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`,
    ));

    // 5. Add company_id to logistic_orders (idempotent)
    await db.execute(sql.raw(
      `ALTER TABLE logistic_orders ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`,
    ));

    // 6. Add company_id to pos_branches (idempotent)
    await db.execute(sql.raw(
      `ALTER TABLE pos_branches ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`,
    ));

    // 7. Add company_id to warehouses (idempotent)
    await db.execute(sql.raw(
      `ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL`,
    ));

    // 8. Assign existing data to company 1 where untagged
    await db.execute(sql`UPDATE accounting_entries    SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE accounting_payments   SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE accounting_settings   SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE expenses              SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE purchase_documents    SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE logistic_orders       SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE pos_branches          SET company_id = 1 WHERE company_id IS NULL`);
    await db.execute(sql`UPDATE warehouses            SET company_id = 1 WHERE company_id IS NULL`);

    // 9. Populate logistic_orders.company_id from company_name if still null
    for (const c of FOUR_COMPANIES) {
      await db.execute(sql`
        UPDATE logistic_orders
        SET company_id = ${c.id}
        WHERE company_id IS NULL
          AND (
            company_name ILIKE ${"%" + c.company_code + "%"}
            OR company_name ILIKE ${"%" + c.company_name.split(" ").slice(-1)[0] + "%"}
          )
      `);
    }

    // 10. Strengthen NOT NULL on accounting fields (safe: data already backfilled)
    for (const col of [
      "accounting_entries.company_id",
      "accounting_payments.company_id",
      "expenses.company_id",
    ]) {
      const [tbl, colName] = col.split(".");
      try {
        await db.execute(sql.raw(`ALTER TABLE ${tbl} ALTER COLUMN ${colName} SET NOT NULL`));
      } catch {
        // already NOT NULL or constraint violation — skip
      }
    }

    // 11. Create performance indexes (idempotent)
    const indexes: [string, string, string][] = [
      // [index_name, table, columns]
      ["purchase_docs_company_idx",        "purchase_documents",     "company_id"],
      ["purchase_docs_supplier_idx",       "purchase_documents",     "supplier_id"],
      ["purchase_doc_lines_doc_idx",       "purchase_document_lines","document_id"],
      ["purchase_doc_lines_product_idx",   "purchase_document_lines","product_id"],
      ["logistic_orders_company_idx",      "logistic_orders",        "company_id"],
      ["logistic_orders_status_idx",       "logistic_orders",        "status"],
      ["pos_branches_company_idx",         "pos_branches",           "company_id"],
      ["pos_cashiers_branch_idx",          "pos_cashiers",           "branch_id"],
      ["pos_orders_branch_idx",            "pos_orders",             "branch_id"],
      ["pos_orders_cashier_idx",           "pos_orders",             "cashier_id"],
      ["pos_orders_created_idx",           "pos_orders",             "created_at"],
      ["pos_order_items_order_idx",        "pos_order_items",        "order_id"],
      ["pos_order_items_product_idx",      "pos_order_items",        "product_id"],
      ["accounting_entries_company_idx",   "accounting_entries",     "company_id"],
      ["accounting_entries_journal_idx",   "accounting_entries",     "journal_id"],
      ["accounting_entries_date_idx",      "accounting_entries",     "date"],
      ["entry_lines_entry_idx",            "accounting_entry_lines", "entry_id"],
      ["entry_lines_account_idx",          "accounting_entry_lines", "account_id"],
      ["accounting_payments_company_idx",  "accounting_payments",    "company_id"],
      ["accounting_payments_journal_idx",  "accounting_payments",    "journal_id"],
      ["expenses_company_idx",             "expenses",               "company_id"],
      ["expenses_category_idx",            "expenses",               "category_id"],
      ["expenses_status_idx",              "expenses",               "status"],
      ["warehouses_company_idx",           "warehouses",             "company_id"],
      ["stock_movements_product_idx",      "stock_movements",        "product_id"],
      ["stock_movements_warehouse_idx",    "stock_movements",        "warehouse_id"],
      ["stock_movements_created_idx",      "stock_movements",        "created_at"],
      ["wh_movements_product_idx",         "wh_movements",           "product_id"],
      ["wh_movements_warehouse_idx",       "wh_movements",           "warehouse_id"],
      ["wh_movements_created_idx",         "wh_movements",           "created_at"],
      ["wh_transfers_status_idx",          "wh_transfers",           "status"],
    ];

    for (const [idxName, tbl, cols] of indexes) {
      try {
        await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS ${idxName} ON ${tbl} (${cols})`));
      } catch {
        // already exists or table doesn't exist yet — skip
      }
    }

    logger.info("Companies migration: selesai (company_id semua tabel, NOT NULL, indexes)");
  } catch (err) {
    logger.error({ err }, "Companies migration failed");
    throw err;
  }
}

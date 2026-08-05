import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runAuditFixMigration(): Promise<void> {
  try {
    // ── 1. customers: add company_id ──────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE customers
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS customers_company_idx ON customers(company_id)
    `);

    // ── 2. suppliers: add company_id ──────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE suppliers
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS suppliers_company_idx ON suppliers(company_id)
    `);

    // ── 3. products: add company_id + cost_price ──────────────────────────────
    await db.execute(sql`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS cost_price NUMERIC(12,2) DEFAULT 0
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS products_company_idx ON products(company_id)
    `);

    // ── 4. users: add company_id, branch_id, department, custom_role_id, system_role, default_branch_id ───────
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS branch_id INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS division TEXT
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS department TEXT
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS system_role TEXT
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS default_branch_id INTEGER
    `);

    // ── 5. sales_documents: add warehouse_id ─────────────────────────────────
    await db.execute(sql`
      ALTER TABLE sales_documents
        ADD COLUMN IF NOT EXISTS warehouse_id INTEGER
    `);

    // ── 6. purchase_document_lines: add unit + uom_id ─────────────────────────
    await db.execute(sql`
      ALTER TABLE purchase_document_lines
        ADD COLUMN IF NOT EXISTS unit TEXT
    `);
    await db.execute(sql`
      ALTER TABLE purchase_document_lines
        ADD COLUMN IF NOT EXISTS uom_id INTEGER
    `);

    // ── 7. custom_roles table (already created by customRolesMigration, ensure exists) ──
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS custom_roles (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL,
        description TEXT,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        permissions JSONB NOT NULL DEFAULT '[]',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE users
        ADD COLUMN IF NOT EXISTS custom_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL
    `);

    // ── 8. branches table ─────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS branches (
        id         SERIAL PRIMARY KEY,
        company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name       TEXT NOT NULL,
        code       TEXT,
        address    TEXT,
        phone      TEXT,
        is_active  BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS branches_company_idx ON branches(company_id)
    `);

    // ── 9. divisions table ────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS divisions (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        code        TEXT,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS divisions_company_idx ON divisions(company_id)
    `);

    // ── 10. departments table ─────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS departments (
        id          SERIAL PRIMARY KEY,
        company_id  INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
        division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
        name        TEXT NOT NULL,
        code        TEXT,
        description TEXT,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE departments ADD COLUMN IF NOT EXISTS division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS departments_company_idx ON departments(company_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS departments_division_idx ON departments(division_id)
    `);

    logger.info("Audit fix migration: all critical/medium schema changes applied");
  } catch (err) {
    logger.error({ err }, "Audit fix migration failed");
    throw err;
  }
}

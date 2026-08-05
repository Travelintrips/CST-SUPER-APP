import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export async function runOrgRoleMigration(): Promise<void> {
  // Add branch_id + manager_id to divisions (nullable, no breaking change)
  await db.execute(sql`
    ALTER TABLE divisions
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id) ON DELETE SET NULL
  `);

  // Add branch_id + manager_id to departments
  await db.execute(sql`
    ALTER TABLE departments
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS manager_id TEXT REFERENCES users(id) ON DELETE SET NULL
  `);

  // Add scope_type enum to custom_roles
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE role_scope_type AS ENUM (
        'all_companies', 'company_only', 'branch_only', 'division_only', 'department_only'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // Add org FK columns to custom_roles
  await db.execute(sql`
    ALTER TABLE custom_roles
      ADD COLUMN IF NOT EXISTS scope_type TEXT DEFAULT 'company_only',
      ADD COLUMN IF NOT EXISTS branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
      ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL
  `);

  // Create approval_scope enum
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE approval_scope AS ENUM ('company','branch','division','department');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // Create approval_module enum
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE approval_module AS ENUM (
        'purchase_request','purchase_order','rfq','sales_order',
        'expense','inventory_transfer','general'
      );
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  // Create approval_rules table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS approval_rules (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      module approval_module NOT NULL DEFAULT 'general',
      scope approval_scope NOT NULL DEFAULT 'company',
      company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      branch_id INTEGER REFERENCES branches(id) ON DELETE SET NULL,
      division_id INTEGER REFERENCES divisions(id) ON DELETE SET NULL,
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      amount_threshold NUMERIC(18,2),
      approver_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL,
      approver_user_id TEXT,
      level INTEGER NOT NULL DEFAULT 1,
      description TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Indexes
  await db.execute(sql`CREATE INDEX IF NOT EXISTS approval_rules_company_idx ON approval_rules(company_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS approval_rules_module_idx ON approval_rules(module)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS divisions_branch_idx ON divisions(branch_id)`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS departments_branch_idx ON departments(branch_id)`);

  logger.info("Org/role migration: selesai (divisions+departments manager/branch, custom_roles scope, approval_rules)");
}

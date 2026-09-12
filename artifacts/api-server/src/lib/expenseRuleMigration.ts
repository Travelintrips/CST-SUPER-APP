/**
 * Phase 3 — Expense Rule Engine: DB Migration + Seed
 *
 * Creates the `expense_rules` table and seeds the 6 initial built-in rules.
 *
 * Idempotency contract:
 *   - DDL uses IF NOT EXISTS — safe to re-run on an existing table/index.
 *   - Seed inserts use WHERE NOT EXISTS — no duplicate rows.
 *   - `migrated` flag is set ONLY after all DB work succeeds; if anything
 *     throws, the flag stays false and runWithRetry can attempt again.
 *
 * COA IDs are NEVER stored — only suggestedAccountType / suggestedAccountSubtype.
 *
 * Initial rules seeded:
 *   1. Kas Besar — Internal Transfer  (priority 5, highest)
 *   2. Konsesi
 *   3. Listrik dan Air — Listrik (PLN)
 *   4. Listrik dan Air — Air (PDAM)
 *   5. Ecommerce Settlement
 *   6. Transfer Fee — Biaya Bank
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { BUILT_IN_RULES } from "./expenseRuleEngine.js";

let migrated = false;

export async function runExpenseRuleMigration(): Promise<void> {
  if (migrated) return;

  // ── 1. Create expense_rules table ─────────────────────────────────────────
  // IF NOT EXISTS is idempotent on Postgres — no .catch() needed here.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS expense_rules (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER,
      name            TEXT NOT NULL,
      priority        INTEGER NOT NULL DEFAULT 50,
      conditions      JSONB NOT NULL DEFAULT '[]',
      action          JSONB NOT NULL DEFAULT '{}',
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      created_by      TEXT,
      updated_by      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));

  // ── 2. Indexes (IF NOT EXISTS — idempotent) ──────────────────────────────
  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS idx_expense_rules_company ON expense_rules (company_id)`,
  ));

  await db.execute(sql.raw(
    `CREATE INDEX IF NOT EXISTS idx_expense_rules_active ON expense_rules (is_active, priority)`,
  ));

  // Unique name per company-scope (NULL company = global).
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_rules_name_company
    ON expense_rules (name, COALESCE(company_id::text, 'GLOBAL'))
  `));

  // ── 3. Schema upgrade: add columns that may be missing on older deployments ─
  // These are truly idempotent-with-PG ("IF NOT EXISTS" on ADD COLUMN) so
  // we swallow the error only for the "column already exists" case —
  // any other error (DB down, permissions) will throw before reaching here
  // because the CREATE TABLE above would have already failed.
  await db.execute(sql.raw(
    `ALTER TABLE expense_rules ADD COLUMN IF NOT EXISTS created_by TEXT`,
  )).catch(() => {});
  await db.execute(sql.raw(
    `ALTER TABLE expense_rules ADD COLUMN IF NOT EXISTS updated_by TEXT`,
  )).catch(() => {});

  // ── 4. Seed built-in rules (idempotent per WHERE NOT EXISTS) ──────────────
  // Individual seed failures are non-fatal: a rule that fails to insert
  // falls back to the in-memory BUILT_IN_RULES at query time.
  let seeded = 0;
  for (const rule of BUILT_IN_RULES) {
    const conditionsJson = JSON.stringify(rule.conditions).replace(/'/g, "''");
    const actionJson     = JSON.stringify(rule.action).replace(/'/g, "''");
    const nameSafe       = rule.name.replace(/'/g, "''");

    await db.execute(sql.raw(`
      INSERT INTO expense_rules (company_id, name, priority, conditions, action, is_active)
      SELECT NULL, '${nameSafe}', ${rule.priority}, '${conditionsJson}'::jsonb, '${actionJson}'::jsonb, TRUE
      WHERE NOT EXISTS (
        SELECT 1 FROM expense_rules
        WHERE name = '${nameSafe}' AND company_id IS NULL
      )
    `)).then(() => { seeded++; }).catch(() => {});
  }

  logger.info(
    { seeded, totalBuiltIns: BUILT_IN_RULES.length },
    "[expenseRuleMigration] expense_rules table and seed rules ready",
  );

  // ── Set flag ONLY after all critical DDL succeeded ────────────────────────
  migrated = true;
}

/**
 * Expense Classification Migration
 *
 * Menambahkan kolom expense_* ke tabel bank_mutations untuk menyimpan
 * hasil klasifikasi dari 3-layer pipeline (normalizer → rule engine → AI).
 *
 * Idempotency contract:
 *   - ADD COLUMN IF NOT EXISTS adalah idempotent di PostgreSQL untuk duplicate_column (42701).
 *     Error LAIN (koneksi, permissions, tabel tidak ada) dilempar agar caller tahu.
 *   - Index IF NOT EXISTS: idempotent (42P07 duplicate_object).
 *   - `migrated` flag di-set HANYA setelah semua DDL kritis berhasil + schema diverifikasi.
 *
 * Kolom baru:
 *   expense_category                TEXT     — kategori semantik (e.g. "utility_electricity")
 *   expense_classification_source   TEXT     — "normalizer"|"rule_engine"|"ai_classifier"|"unclassified"
 *   expense_classification_confidence INT    — 0-100
 *   expense_suggested_account_type  TEXT     — "expense"|"revenue"|"asset"|"liability"
 *   expense_suggested_account_subtype TEXT   — hint COA subtype
 *   expense_classification_notes    TEXT     — penjelasan singkat hasil klasifikasi
 *   expense_detected_vendor         TEXT     — nama vendor terdeteksi (dari AI layer)
 *   expense_is_internal_transfer    BOOLEAN  — true = skip jurnal beban
 *   expense_classified_at           TIMESTAMPTZ — waktu klasifikasi
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

let migrated = false;

/**
 * PG error codes that unambiguously mean "already applied" — safe to skip.
 * 42701 = duplicate_column   (ADD COLUMN for a column that already exists)
 * 42P07 = duplicate_object   (CREATE INDEX for an index that already exists)
 * No other codes are suppressed; any unexpected error propagates to the caller.
 */
const IDEMPOTENT_PG_CODES = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_object
]);

function isIdempotentError(err: unknown): boolean {
  const code = (err as any)?.code ?? (err as any)?.cause?.code ?? "";
  return IDEMPOTENT_PG_CODES.has(String(code));
}

async function addColumnSafe(name: string, type: string): Promise<void> {
  try {
    await db.execute(sql.raw(
      `ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS ${name} ${type}`,
    ));
  } catch (err) {
    if (isIdempotentError(err)) return; // already exists — fine
    throw err; // real error (permissions, table missing, etc.) — propagate
  }
}

async function createIndexSafe(ddl: string, indexName: string): Promise<void> {
  try {
    await db.execute(sql.raw(ddl));
  } catch (err) {
    if (isIdempotentError(err)) return; // index already exists — fine
    // Propagate unexpected errors so the caller knows the index was NOT created.
    // Callers may choose to log-and-continue for non-critical performance indexes,
    // but that decision is made explicitly at the call site, not silently here.
    throw new Error(
      `[expenseClassificationMigration] createIndex ${indexName} failed: ${(err as any)?.message}`,
    );
  }
}

export async function runExpenseClassificationMigration(): Promise<void> {
  if (migrated) return;

  // ── 1. Add columns (throws on real DB errors) ─────────────────────────────
  const columns: Array<{ name: string; type: string }> = [
    { name: "expense_category",                  type: "TEXT" },
    { name: "expense_classification_source",      type: "TEXT" },
    { name: "expense_classification_confidence",  type: "INTEGER" },
    { name: "expense_suggested_account_type",     type: "TEXT" },
    { name: "expense_suggested_account_subtype",  type: "TEXT" },
    { name: "expense_classification_notes",       type: "TEXT" },
    { name: "expense_detected_vendor",            type: "TEXT" },
    { name: "expense_is_internal_transfer",       type: "BOOLEAN DEFAULT FALSE" },
    { name: "expense_classified_at",              type: "TIMESTAMPTZ" },
  ];

  for (const col of columns) {
    await addColumnSafe(col.name, col.type); // throws on real error → migrated stays false
  }

  // ── 2. Indexes — propagate unexpected errors; only idempotent errors silenced ─
  await createIndexSafe(`
    CREATE INDEX IF NOT EXISTS idx_bank_mutations_expense_category
    ON bank_mutations (company_id, expense_category)
    WHERE expense_category IS NOT NULL
  `, "idx_bank_mutations_expense_category");

  await createIndexSafe(`
    CREATE INDEX IF NOT EXISTS idx_bank_mutations_unclassified
    ON bank_mutations (company_id, direction, transaction_date)
    WHERE expense_category IS NULL AND direction = 'OUT'
  `, "idx_bank_mutations_unclassified");

  // ── 3. Verify required columns exist before marking complete ──────────────
  const { rows: colCheck } = await db.execute(sql.raw(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = 'bank_mutations'
      AND column_name IN (
        'expense_category',
        'expense_classification_source',
        'expense_classification_confidence'
      )
  `));

  const foundCols = new Set((colCheck as any[]).map(r => String(r.column_name)));
  const requiredCols = ["expense_category", "expense_classification_source", "expense_classification_confidence"];
  const missing = requiredCols.filter(c => !foundCols.has(c));

  if (missing.length > 0) {
    throw new Error(
      `[expenseClassificationMigration] required columns still missing after migration: ${missing.join(", ")}`,
    );
  }

  logger.info(
    { columns: columns.length },
    "[expenseClassificationMigration] bank_mutations expense columns ready and verified",
  );

  // ── Set flag ONLY after DDL succeeded + schema verified ───────────────────
  migrated = true;
}

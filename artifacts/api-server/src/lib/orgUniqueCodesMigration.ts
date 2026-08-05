import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Migration: Tambah UNIQUE(company_id, code) pada branches, sections,
 * divisions, dan departments.
 *
 * Strategi aman:
 * 1. Deduplikasi setiap tabel — pertahankan id terkecil per (company_id, code).
 * 2. Hapus constraint sections lama yang salah (hanya `code`, bukan per company).
 * 3. Buat partial unique index UNIQUE(company_id, code) WHERE code IS NOT NULL AND code <> ''
 *    pada branches, sections, divisions, dan departments.
 *
 * Semua langkah idempotent — aman dijalankan berulang kali.
 */
export async function runOrgUniqueCodesMigration(): Promise<void> {
  try {
    // ─── Helper: deduplikasi satu tabel ─────────────────────────────────────
    async function dedupTable(tableName: string): Promise<void> {
      const res = await db.execute(sql.raw(`
        DELETE FROM ${tableName}
        WHERE id NOT IN (
          SELECT MIN(id)
          FROM ${tableName}
          WHERE code IS NOT NULL AND code <> ''
          GROUP BY company_id, code
        )
        AND code IS NOT NULL AND code <> ''
      `));
      const deleted = res.rowCount ?? 0;
      if (deleted > 0) {
        logger.info(`Org unique codes: hapus ${deleted} baris duplikat ${tableName}`);
      }
    }

    // ─── 1. Deduplikasi semua tabel ─────────────────────────────────────────
    await dedupTable("branches");
    await dedupTable("sections");
    await dedupTable("divisions");
    await dedupTable("departments");

    // ─── 2. Hapus constraint sections lama yang salah (hanya code, bukan per company) ──
    await db.execute(sql`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE table_name = 'sections'
            AND constraint_name = 'sections_code_unique'
            AND constraint_type = 'UNIQUE'
        ) THEN
          ALTER TABLE sections DROP CONSTRAINT sections_code_unique;
        END IF;
      END$$
    `);

    // ─── 3a. UNIQUE(company_id, code) pada branches ──────────────────────────
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS branches_company_code_unique
        ON branches(company_id, code)
        WHERE code IS NOT NULL AND code <> ''
    `);

    // ─── 3b. UNIQUE(company_id, code) pada sections ──────────────────────────
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS sections_company_code_unique
        ON sections(company_id, code)
        WHERE code IS NOT NULL AND code <> ''
    `);

    // ─── 3c. UNIQUE(company_id, code) pada divisions ─────────────────────────
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS divisions_company_code_unique
        ON divisions(company_id, code)
        WHERE code IS NOT NULL AND code <> ''
    `);

    // ─── 3d. UNIQUE(company_id, code) pada departments ───────────────────────
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS departments_company_code_unique
        ON departments(company_id, code)
        WHERE code IS NOT NULL AND code <> ''
    `);

    logger.info("Org unique codes migration: selesai (UNIQUE(company_id,code) pada branches, sections, divisions & departments)");
  } catch (err) {
    logger.error({ err }, "Org unique codes migration gagal");
    throw err;
  }
}

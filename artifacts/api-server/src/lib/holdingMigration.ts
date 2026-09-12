import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent migration untuk fitur Holding / Consolidated Accounting.
 * Aman dijalankan berkali-kali.
 *
 * Perubahan v2:
 * - Tambah UNIQUE constraint (holding_group_id, company_id) agar ON CONFLICT DO NOTHING efektif
 * - Backfill semua perusahaan non-holding ke CST-GROUP (bukan hanya 4 pertama)
 *
 * Catatan: Kolom `name` dan `code` di tabel companies dibiarkan di DB (orphaned) karena
 * orgFullMigration & accountingSeed masih mereferensikan ADD COLUMN IF NOT EXISTS.
 * Kolom tersebut sudah dihapus dari Drizzle ORM schema, jadi tidak digunakan oleh query.
 */
export async function runHoldingMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS holding_groups (
        id               SERIAL PRIMARY KEY,
        holding_name     TEXT NOT NULL,
        holding_code     TEXT NOT NULL UNIQUE,
        description      TEXT,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS company_holding_members (
        id                   SERIAL PRIMARY KEY,
        holding_group_id     INTEGER REFERENCES holding_groups(id),
        company_id           INTEGER NOT NULL,
        ownership_percentage NUMERIC(5,2) DEFAULT 100.00,
        consolidation_method TEXT DEFAULT 'full',
        created_at           TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // Tambah UNIQUE constraint agar ON CONFLICT DO NOTHING efektif mencegah duplikat member
    await db.execute(sql`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'chm_holding_company_unique'
        ) THEN
          ALTER TABLE company_holding_members
            ADD CONSTRAINT chm_holding_company_unique
            UNIQUE (holding_group_id, company_id);
        END IF;
      END $$
    `);

    // Seed holding group CST-GROUP jika belum ada
    const existing = await db.execute(sql`
      SELECT id FROM holding_groups WHERE holding_code = 'CST-GROUP' LIMIT 1
    `);

    let holdingId: number;
    if (existing.rows.length === 0) {
      const inserted = await db.execute(sql`
        INSERT INTO holding_groups (holding_name, holding_code, description)
        VALUES ('CST Group', 'CST-GROUP', 'Holding group PT Cahaya Sejati Teknologi dan entitas anak')
        RETURNING id
      `);
      holdingId = (inserted.rows[0] as { id: number }).id;
      logger.info("Holding: CST-GROUP seeded");
    } else {
      holdingId = (existing.rows[0] as { id: number }).id;
      logger.info("Holding: CST-GROUP already exists, skip seed");
    }

    // Backfill: tambahkan SEMUA perusahaan non-holding ke grup
    // (termasuk yang dibuat setelah seed awal, idempotent via UNIQUE constraint)
    const allCompanies = await db.execute(sql`
      SELECT id FROM companies WHERE is_holding = false OR is_holding IS NULL ORDER BY id
    `);

    let added = 0;
    for (const row of allCompanies.rows) {
      const companyId = (row as { id: number }).id;
      const result = await db.execute(sql`
        INSERT INTO company_holding_members (holding_group_id, company_id, ownership_percentage, consolidation_method)
        VALUES (${holdingId}, ${companyId}, 100.00, 'full')
        ON CONFLICT ON CONSTRAINT chm_holding_company_unique DO NOTHING
      `);
      if (result.rowCount && result.rowCount > 0) added++;
    }

    if (added > 0) {
      logger.info({ added }, "Holding: backfilled companies into CST-GROUP");
    }

    logger.info("Holding migration completed");
  } catch (err) {
    logger.error({ err }, "Holding migration failed");
    throw err;
  }
}

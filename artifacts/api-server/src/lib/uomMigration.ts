import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * Idempotent UOM migration — buat tabel uom + uom_conversions,
 * tambah kolom sales_uom_id/base_qty ke sales_document_lines,
 * tambah base_uom_id ke products, lalu seed default UOM.
 */
export async function runUomMigration(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS uom (
        id          SERIAL PRIMARY KEY,
        name        TEXT NOT NULL UNIQUE,
        symbol      TEXT NOT NULL,
        category    TEXT NOT NULL DEFAULT 'count',
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS uom_conversions (
        id           SERIAL PRIMARY KEY,
        from_uom_id  INTEGER NOT NULL,
        to_uom_id    INTEGER NOT NULL,
        factor       NUMERIC(18,6) NOT NULL,
        created_at   TIMESTAMP DEFAULT NOW() NOT NULL
      )
    `);

    // Pastikan FK selalu menunjuk ke tabel uom (bukan uom_master yang lama)
    await db.execute(sql`
      DO $$
      BEGIN
        ALTER TABLE uom_conversions
          DROP CONSTRAINT IF EXISTS uom_conversions_pair_uidx,
          DROP CONSTRAINT IF EXISTS uom_conversions_unique;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uom_conversions_from_uom_id_fkey'
        ) THEN
          ALTER TABLE uom_conversions
            ADD CONSTRAINT uom_conversions_from_uom_id_fkey
              FOREIGN KEY (from_uom_id) REFERENCES uom(id) ON DELETE CASCADE;
        END IF;
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uom_conversions_to_uom_id_fkey'
        ) THEN
          ALTER TABLE uom_conversions
            ADD CONSTRAINT uom_conversions_to_uom_id_fkey
              FOREIGN KEY (to_uom_id) REFERENCES uom(id) ON DELETE CASCADE;
        END IF;
      END $$
    `);
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS uom_conversions_pair_uidx
        ON uom_conversions (from_uom_id, to_uom_id)
    `);

    await db.execute(sql`
      ALTER TABLE sales_document_lines
        ADD COLUMN IF NOT EXISTS sales_uom_id INTEGER REFERENCES uom(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS base_qty     NUMERIC(12,4)
    `);

    await db.execute(sql`
      ALTER TABLE products
        ADD COLUMN IF NOT EXISTS base_uom_id INTEGER REFERENCES uom(id) ON DELETE SET NULL
    `);

    // Seed default UOMs
    await db.execute(sql`
      INSERT INTO uom (name, symbol, category) VALUES
        ('pcs',    'pcs', 'count'),
        ('lusin',  'lsn', 'count'),
        ('kodi',   'kdi', 'count'),
        ('gross',  'grs', 'count'),
        ('box',    'box', 'count'),
        ('carton', 'ctn', 'count'),
        ('pallet', 'plt', 'count'),
        ('roll',   'rol', 'count'),
        ('meter',  'm',   'length'),
        ('yard',   'yd',  'length'),
        ('cm',     'cm',  'length'),
        ('kg',     'kg',  'weight'),
        ('gram',   'g',   'weight'),
        ('ton',    'ton', 'weight'),
        ('liter',  'L',   'volume'),
        ('ml',     'ml',  'volume'),
        ('cup',    'cup', 'volume')
      ON CONFLICT (name) DO NOTHING
    `);

    // Seed default conversions
    await db.execute(sql`
      INSERT INTO uom_conversions (from_uom_id, to_uom_id, factor)
      SELECT f.id, t.id, conv.factor
      FROM (VALUES
        ('lusin',   'pcs',    12),
        ('kodi',    'pcs',    20),
        ('gross',   'lusin',  12),
        ('gross',   'pcs',    144),
        ('box',     'pcs',    12),
        ('carton',  'box',    12),
        ('pallet',  'carton', 40),
        ('yard',    'meter',  0.9144),
        ('kg',      'gram',   1000),
        ('ton',     'kg',     1000),
        ('liter',   'ml',     1000),
        ('cm',      'meter',  0.01),
        ('roll',    'meter',  50)
      ) AS conv(from_name, to_name, factor)
      JOIN uom f ON f.name = conv.from_name
      JOIN uom t ON t.name = conv.to_name
      ON CONFLICT (from_uom_id, to_uom_id) DO NOTHING
    `);

    logger.info("UOM migration: selesai (tables + columns + seed defaults)");
  } catch (err) {
    logger.error({ err }, "UOM migration failed");
    throw err;
  }
}

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runProductMediaMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS product_media (
      id                    SERIAL PRIMARY KEY,
      vendor_catalog_item_id INTEGER REFERENCES vendor_catalog_items(id) ON DELETE CASCADE,
      vendor_id             INTEGER,
      media_type            TEXT NOT NULL DEFAULT 'image',
      file_url              TEXT,
      thumbnail_url         TEXT,
      external_url          TEXT,
      title                 TEXT,
      description           TEXT,
      sort_order            INTEGER NOT NULL DEFAULT 0,
      is_primary            BOOLEAN NOT NULL DEFAULT false,
      is_active             BOOLEAN NOT NULL DEFAULT true,
      uploaded_by           TEXT,
      uploaded_by_role      TEXT,
      storage_path          TEXT,
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS product_media_catalog_item_idx ON product_media (vendor_catalog_item_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS product_media_vendor_idx ON product_media (vendor_id)
  `);
  await db.execute(sql`
    ALTER TABLE product_media
      ADD COLUMN IF NOT EXISTS image_source      TEXT DEFAULT 'admin',
      ADD COLUMN IF NOT EXISTS ai_image_status   TEXT,
      ADD COLUMN IF NOT EXISTS generation_prompt TEXT,
      ADD COLUMN IF NOT EXISTS duration          INTEGER,
      ADD COLUMN IF NOT EXISTS file_size_bytes   INTEGER
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS product_media_ai_status_idx ON product_media (ai_image_status)
    WHERE ai_image_status IS NOT NULL
  `);
  await db.execute(sql`
    ALTER TABLE product_media
      ADD COLUMN IF NOT EXISTS document_type      TEXT,
      ADD COLUMN IF NOT EXISTS visibility         TEXT DEFAULT 'public',
      ADD COLUMN IF NOT EXISTS original_filename  TEXT
  `);
}

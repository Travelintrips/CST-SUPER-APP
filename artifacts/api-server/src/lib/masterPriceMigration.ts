/**
 * Master Price Management — Phase 1 Migration
 *
 * Membuat tabel:
 *   marketplace_price_history  — riwayat setiap perubahan harga
 *   marketplace_price_config   — konfigurasi (require_approval, dll.)
 *
 * Idempotent: aman dijalankan berulang kali.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runMasterPriceMigration(): Promise<void> {
  // ── marketplace_price_history ────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS marketplace_price_history (
      id              SERIAL PRIMARY KEY,
      catalog_item_id INTEGER NOT NULL,
      item_name       TEXT,
      vendor_id       INTEGER,
      vendor_name     TEXT,
      vendor_type     TEXT NOT NULL DEFAULT 'external',
      price_base_old  NUMERIC(15,2),
      price_base_new  NUMERIC(15,2),
      markup_old      NUMERIC(5,2),
      markup_new      NUMERIC(5,2),
      price_sell_old  NUMERIC(15,2),
      price_sell_new  NUMERIC(15,2),
      currency        TEXT NOT NULL DEFAULT 'IDR',
      reason          TEXT,
      changed_by      TEXT,
      changed_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      approval_status TEXT NOT NULL DEFAULT 'auto_approved',
      approved_by     TEXT,
      approved_at     TIMESTAMP,
      effective_at    TIMESTAMP,
      applied_at      TIMESTAMP
    )
  `).catch(() => {});

  // Columns added after initial creation (idempotent)
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS item_name TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS vendor_id INTEGER`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS vendor_name TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IDR'`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'auto_approved'`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS approved_by TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS approved_at TIMESTAMP`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS effective_at TIMESTAMP`).catch(() => {});
  await db.execute(sql`ALTER TABLE marketplace_price_history ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP`).catch(() => {});

  // Indexes
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mph_catalog_item_id_idx ON marketplace_price_history (catalog_item_id)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mph_changed_at_idx ON marketplace_price_history (changed_at DESC)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mph_approval_status_idx ON marketplace_price_history (approval_status)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS mph_effective_at_idx ON marketplace_price_history (effective_at) WHERE effective_at IS NOT NULL
  `).catch(() => {});

  // ── marketplace_price_config ─────────────────────────────────────────────
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS marketplace_price_config (
      key        TEXT PRIMARY KEY,
      value      TEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_by TEXT
    )
  `).catch(() => {});

  // Seed default config if not present
  await db.execute(sql`
    INSERT INTO marketplace_price_config (key, value)
    VALUES ('require_approval', 'false')
    ON CONFLICT (key) DO NOTHING
  `).catch(() => {});

  console.log("[masterPriceMigration] migration complete");
}

/**
 * Apply pending effective-date price changes.
 * Called at startup and optionally by a background worker.
 */
export async function applyScheduledPriceChanges(): Promise<void> {
  try {
    const rows = await db.execute(sql`
      SELECT mph.id, mph.catalog_item_id, mph.price_base_new, mph.markup_new, mph.price_sell_new,
             mph.vendor_type, mph.changed_by
      FROM marketplace_price_history mph
      WHERE mph.approval_status IN ('approved', 'auto_approved')
        AND mph.effective_at IS NOT NULL
        AND mph.effective_at <= NOW()
        AND mph.applied_at IS NULL
      ORDER BY mph.effective_at ASC
    `);

    for (const r of (rows.rows ?? []) as any[]) {
      await db.execute(sql`
        UPDATE vendor_catalog_items
        SET price_base  = ${r.price_base_new},
            markup_pct  = ${r.markup_new},
            price_sell  = ${r.price_sell_new},
            updated_at  = NOW()
        WHERE id = ${r.catalog_item_id}
      `).catch(() => {});

      await db.execute(sql`
        UPDATE marketplace_price_history
        SET applied_at = NOW()
        WHERE id = ${r.id}
      `).catch(() => {});
    }
  } catch (e) {
    console.error("[masterPriceMigration] applyScheduledPriceChanges error", e);
  }
}

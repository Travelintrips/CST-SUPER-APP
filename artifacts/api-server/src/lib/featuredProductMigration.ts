import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Featured Product / Produk Unggulan Marketplace — additive migration.
 *
 * Creates mkt_featured_packages + mkt_featured_product_requests, and adds
 * featured_priority / featured_start_at columns to the existing
 * vendor_catalog_items table (is_featured / featured_until already existed —
 * reused rather than duplicated, per audit).
 *
 * All statements are idempotent (IF NOT EXISTS) and additive-only.
 */
export async function runFeaturedProductMigration(): Promise<void> {
  try {
    // ── vendor_catalog_items: additive columns for priority ordering + window ──
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS featured_priority INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS featured_start_at TIMESTAMP
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vendor_catalog_featured_idx
        ON vendor_catalog_items(is_featured, featured_priority)
    `);

    // ── mkt_featured_packages ──────────────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mkt_featured_packages (
        id               SERIAL PRIMARY KEY,
        code             TEXT NOT NULL UNIQUE,
        name             TEXT NOT NULL,
        description      TEXT,
        duration_days    INTEGER NOT NULL,
        price            NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency         TEXT NOT NULL DEFAULT 'IDR',
        placement_type   TEXT NOT NULL DEFAULT 'homepage_top',
        priority_weight  INTEGER NOT NULL DEFAULT 0,
        category_id      INTEGER,
        internal_only    BOOLEAN NOT NULL DEFAULT FALSE,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      ALTER TABLE mkt_featured_packages
        ADD COLUMN IF NOT EXISTS internal_only BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mkt_featured_packages_active_idx
        ON mkt_featured_packages(is_active)
    `);
    // Internal activation needs a selectable duration/priority package even
    // when an admin has not configured paid vendor packages yet. Keep this
    // package out of the vendor-paid flow via internal_only.
    await db.execute(sql`
      INSERT INTO mkt_featured_packages (
        code, name, description, duration_days, price, currency,
        placement_type, priority_weight, internal_only, is_active
      )
      VALUES (
        'INTERNAL-30D',
        'Internal · 30 Hari',
        'Paket default untuk aktivasi Produk Unggulan vendor internal.',
        30,
        0,
        'IDR',
        'homepage_top',
        100,
        TRUE,
        TRUE
      )
      ON CONFLICT (code) DO NOTHING
    `);

    // ── mkt_featured_product_requests ─────────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mkt_featured_product_requests (
        id                  SERIAL PRIMARY KEY,
        company_id          INTEGER REFERENCES companies(id) ON DELETE SET NULL,
        vendor_id           INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        catalog_item_id     INTEGER NOT NULL REFERENCES vendor_catalog_items(id) ON DELETE CASCADE,
        package_id          INTEGER NOT NULL REFERENCES mkt_featured_packages(id),

        status              TEXT NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending','approved','rejected','active','expired','cancelled')),

        requested_start_at  TIMESTAMP NOT NULL,
        requested_end_at    TIMESTAMP NOT NULL,
        approved_start_at   TIMESTAMP,
        approved_end_at     TIMESTAMP,

        price               NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency            TEXT NOT NULL DEFAULT 'IDR',

        payment_status      TEXT NOT NULL DEFAULT 'unpaid'
                             CHECK (payment_status IN ('unpaid','pending_verification','verified','rejected','refunded')),
        payment_reference   TEXT,
        payment_proof_url   TEXT,
        payment_proof_token TEXT UNIQUE,

        admin_notes         TEXT,
        rejection_reason    TEXT,

        approved_by         TEXT,
        approved_at         TIMESTAMP,
        rejected_by         TEXT,
        rejected_at         TIMESTAMP,
        activated_at        TIMESTAMP,
        expired_at          TIMESTAMP,
        cancelled_at        TIMESTAMP,

        created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mkt_fpr_vendor_idx
        ON mkt_featured_product_requests(vendor_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mkt_fpr_catalog_item_idx
        ON mkt_featured_product_requests(catalog_item_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mkt_fpr_status_idx
        ON mkt_featured_product_requests(status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mkt_fpr_payment_status_idx
        ON mkt_featured_product_requests(payment_status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS mkt_fpr_approved_end_at_idx
        ON mkt_featured_product_requests(approved_end_at)
    `);
    // P2: guard against duplicate ACTIVE requests for the same catalog item —
    // "produk tidak boleh sedang featured aktif" / "tidak boleh ada pengajuan
    // aktif duplikat" (Fase 3 validation). Partial unique index enforces it at
    // the DB level too, not just in application code.
    await db.execute(sql`
      CREATE UNIQUE INDEX IF NOT EXISTS mkt_fpr_one_active_per_item_idx
        ON mkt_featured_product_requests(catalog_item_id)
        WHERE status IN ('pending','approved','active')
    `);

    logger.info("Featured product migration: ok");
  } catch (err) {
    logger.error({ err }, "Featured product migration failed");
  }
}

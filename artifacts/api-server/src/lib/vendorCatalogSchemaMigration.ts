import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

/**
 * Vendor Catalog Schema Migration — Fase 2
 *
 * Memperluas tabel vendor_catalog_items agar mendukung:
 * template engine, spec values, pricing (priceBase internal-only),
 * stock, lead time, validity, dokumen, dan lifecycle status.
 *
 * Semua ALTER TABLE memakai ADD COLUMN IF NOT EXISTS → idempotent.
 * priceBase TIDAK pernah dikembalikan ke customer; hanya price_sell yang
 * boleh diekspos ke public/portal API.
 */
export async function runVendorCatalogSchemaMigration(): Promise<void> {
  try {
    // ── Pastikan tabel sudah ada (dibuat oleh Drizzle push/create) ────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_catalog_items (
        id          SERIAL PRIMARY KEY,
        vendor_id   INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `);

    // ── Vendor identity ────────────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS vendor_name TEXT
    `);

    // ── Template engine ────────────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS template_kind TEXT DEFAULT 'service'
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS category_key TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS service_type TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS template_id TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS template_version TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS template_snapshot JSONB
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS spec_values JSONB
    `);

    // ── Pricing ────────────────────────────────────────────────────────────────
    // price_base sudah ada (priceBase). price_sell = harga jual ke customer.
    // priceBase TIDAK boleh diekspos ke portal/customer API.
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS price_sell NUMERIC(15,2)
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'IDR'
    `);

    // ── Stock ──────────────────────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS stock_status TEXT DEFAULT 'available'
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS stock_qty INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS moq INTEGER DEFAULT 1
    `);

    // ── Lead time & validity ───────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS lead_time TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS validity_date TIMESTAMP
    `);

    // ── Asal & lokasi ──────────────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS location TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS origin TEXT
    `);

    // ── Dokumen pendukung ──────────────────────────────────────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS documents JSONB NOT NULL DEFAULT '[]'
    `);

    // ── Lifecycle status ───────────────────────────────────────────────────────
    // status: draft | pending_review | published | archived
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS source_submission_id INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS published_at TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    `);

    // ── Indexes ────────────────────────────────────────────────────────────────
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vci_vendor_id_idx
        ON vendor_catalog_items(vendor_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vci_template_kind_idx
        ON vendor_catalog_items(template_kind)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vci_category_key_idx
        ON vendor_catalog_items(category_key)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vci_status_idx
        ON vendor_catalog_items(status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vci_is_published_idx
        ON vendor_catalog_items(is_published)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vci_source_submission_id_idx
        ON vendor_catalog_items(source_submission_id)
    `);

    // ── FASE 5: additional columns on vendor_catalog_items ────────────────────
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '[]'
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS subcategory TEXT
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS markup_pct NUMERIC(5,2) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS master_item_id INTEGER
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS view_count INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS quote_count INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS order_count INTEGER NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS featured_until TIMESTAMP
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS price_base NUMERIC(15,2) NOT NULL DEFAULT 0
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'service'
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE
    `);
    await db.execute(sql`
      ALTER TABLE vendor_catalog_items
        ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0
    `);

    // ── FASE 5: vendor_catalog_submission_links ────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_catalog_submission_links (
        id               SERIAL PRIMARY KEY,
        token            TEXT NOT NULL UNIQUE,
        supplier_id      INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        vendor_name      TEXT,
        title            TEXT,
        notes            TEXT,
        category_key     TEXT,
        service_type     TEXT,
        template_kind    TEXT,
        template_id      TEXT,
        template_version TEXT,
        template_snapshot JSONB,
        is_active        BOOLEAN NOT NULL DEFAULT TRUE,
        expires_at       TIMESTAMP,
        max_submissions  INTEGER,
        submission_count INTEGER NOT NULL DEFAULT 0,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by       TEXT
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vcsl_supplier_idx
        ON vendor_catalog_submission_links(supplier_id)
    `);

    // ── FASE 5: vendor_catalog_submissions ────────────────────────────────────
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vendor_catalog_submissions (
        id                SERIAL PRIMARY KEY,
        link_id           INTEGER REFERENCES vendor_catalog_submission_links(id) ON DELETE SET NULL,
        token             TEXT NOT NULL UNIQUE,
        supplier_id       INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        vendor_name       TEXT,
        category_key      TEXT,
        service_type      TEXT,
        template_kind     TEXT,
        template_id       TEXT,
        template_version  TEXT,
        template_snapshot JSONB,
        spec_values       JSONB,
        name              TEXT NOT NULL,
        description       TEXT,
        unit              TEXT,
        media_assets      JSONB NOT NULL DEFAULT '[]',
        price_base        NUMERIC(15,2) NOT NULL DEFAULT 0,
        currency          TEXT NOT NULL DEFAULT 'IDR',
        stock_status      TEXT,
        stock_qty         NUMERIC(15,3),
        lead_time         TEXT,
        validity_date     TEXT,
        location          TEXT,
        origin            TEXT,
        status            TEXT NOT NULL DEFAULT 'submitted',
        catalog_item_id   INTEGER,
        reviewed_by       TEXT,
        reviewed_at       TIMESTAMP,
        review_notes      TEXT,
        submitted_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      )
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vcs_supplier_idx
        ON vendor_catalog_submissions(supplier_id)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vcs_status_idx
        ON vendor_catalog_submissions(status)
    `);
    await db.execute(sql`
      CREATE INDEX IF NOT EXISTS vcs_link_idx
        ON vendor_catalog_submissions(link_id)
    `);

    logger.info("Vendor catalog schema migration: ok");
  } catch (err) {
    logger.error({ err }, "Vendor catalog schema migration failed");
  }
}

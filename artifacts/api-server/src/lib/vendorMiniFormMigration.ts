import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

export async function runVendorMiniFormMigration(): Promise<void> {
  try {
    // ── Base tables ────────────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS vendor_mini_form_links (
        id          SERIAL PRIMARY KEY,
        token       TEXT NOT NULL UNIQUE,
        supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        service_type TEXT NOT NULL,
        title       TEXT,
        notes       TEXT,
        expires_at  TIMESTAMP,
        is_active   BOOLEAN NOT NULL DEFAULT TRUE,
        created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by  TEXT
      )
    `));
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS vendor_mini_form_submissions (
        id             SERIAL PRIMARY KEY,
        link_id        INTEGER REFERENCES vendor_mini_form_links(id) ON DELETE SET NULL,
        token          TEXT NOT NULL,
        supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        service_type   TEXT NOT NULL,
        vendor_name    TEXT,
        contact_person TEXT,
        contact_phone  TEXT,
        form_data      JSONB NOT NULL DEFAULT '{}',
        submitted_at   TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS vmfl_token_idx ON vendor_mini_form_links(token);
      CREATE INDEX IF NOT EXISTS vmfs_token_idx ON vendor_mini_form_submissions(token);
      CREATE INDEX IF NOT EXISTS vmfs_link_id_idx ON vendor_mini_form_submissions(link_id);
    `));

    // ── Batch: ALL vendor_mini_form_links columns (single ALTER TABLE) ─────────
    // Batching avoids holding ACCESS EXCLUSIVE LOCK for 40+ serial round-trips.
    await db.execute(sql.raw(`
      ALTER TABLE vendor_mini_form_links
        ADD COLUMN IF NOT EXISTS short_url         TEXT,
        ADD COLUMN IF NOT EXISTS mode              TEXT NOT NULL DEFAULT 'rate_collection',
        ADD COLUMN IF NOT EXISTS order_id          INTEGER,
        ADD COLUMN IF NOT EXISTS order_number      TEXT,
        ADD COLUMN IF NOT EXISTS order_item_id     INTEGER,
        ADD COLUMN IF NOT EXISTS item_status       TEXT DEFAULT 'waiting_vendor',
        ADD COLUMN IF NOT EXISTS phase             TEXT DEFAULT 'quotation',
        ADD COLUMN IF NOT EXISTS vendor_name       TEXT,
        ADD COLUMN IF NOT EXISTS max_submissions   INTEGER,
        ADD COLUMN IF NOT EXISTS resubmit_allowed  BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS admin_notes       TEXT,
        ADD COLUMN IF NOT EXISTS form_target       TEXT DEFAULT 'vendor',
        ADD COLUMN IF NOT EXISTS category_key      TEXT,
        ADD COLUMN IF NOT EXISTS template_id       TEXT,
        ADD COLUMN IF NOT EXISTS template_version  TEXT,
        ADD COLUMN IF NOT EXISTS template_snapshot JSONB
    `));

    // Backfill form_target for existing rows
    await db.execute(sql.raw(`UPDATE vendor_mini_form_links SET form_target = 'vendor' WHERE form_target IS NULL`));

    // ── Batch: ALL vendor_mini_form_submissions columns (single ALTER TABLE) ───
    await db.execute(sql.raw(`
      ALTER TABLE vendor_mini_form_submissions
        ADD COLUMN IF NOT EXISTS staff_data         JSONB NOT NULL DEFAULT '{}',
        ADD COLUMN IF NOT EXISTS response_status    TEXT DEFAULT 'submitted',
        ADD COLUMN IF NOT EXISTS vendor_price       NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS currency           TEXT DEFAULT 'IDR',
        ADD COLUMN IF NOT EXISTS eta                TEXT,
        ADD COLUMN IF NOT EXISTS valid_until        TEXT,
        ADD COLUMN IF NOT EXISTS attachment_url     TEXT,
        ADD COLUMN IF NOT EXISTS order_id           INTEGER,
        ADD COLUMN IF NOT EXISTS order_item_id      INTEGER,
        ADD COLUMN IF NOT EXISTS selected_by_admin  BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS selected_at        TIMESTAMP,
        ADD COLUMN IF NOT EXISTS submitted_ip       TEXT,
        ADD COLUMN IF NOT EXISTS submitted_ua       TEXT,
        ADD COLUMN IF NOT EXISTS revision_count     INTEGER DEFAULT 0,
        ADD COLUMN IF NOT EXISTS admin_notes        TEXT,
        ADD COLUMN IF NOT EXISTS locked             BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS unlock_reason      TEXT
    `));

    // ── Unique index on submissions.token (prevents duplicate submissions) ────
    await db.execute(sql.raw(`
      CREATE UNIQUE INDEX IF NOT EXISTS vmf_submissions_token_uidx
      ON vendor_mini_form_submissions(token)
    `));

    // ── customer_approvals ─────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS customer_approvals (
        id              SERIAL PRIMARY KEY,
        token           TEXT NOT NULL UNIQUE,
        order_id        INTEGER,
        order_number    TEXT,
        customer_name   TEXT,
        customer_phone  TEXT,
        customer_email  TEXT,
        offer_summary   JSONB DEFAULT '{}',
        selling_price   NUMERIC(14,2),
        currency        TEXT DEFAULT 'IDR',
        terms_notes     TEXT,
        status          TEXT NOT NULL DEFAULT 'pending',
        approved_at     TIMESTAMP,
        rejected_at     TIMESTAMP,
        notes           TEXT,
        so_id           INTEGER,
        so_number       TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        created_by      TEXT,
        expires_at      TIMESTAMP
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS ca_token_idx    ON customer_approvals(token);
      CREATE INDEX IF NOT EXISTS ca_order_id_idx ON customer_approvals(order_id);
    `));

    // ── Batch: ALL customer_approvals columns ─────────────────────────────────
    await db.execute(sql.raw(`
      ALTER TABLE customer_approvals
        ADD COLUMN IF NOT EXISTS submission_id                    INTEGER,
        ADD COLUMN IF NOT EXISTS vendor_cost                      NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS markup_pct                       NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS markup_nominal                   NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS ppn_pct                          NUMERIC(5,2) DEFAULT 11,
        ADD COLUMN IF NOT EXISTS ppn_nominal                      NUMERIC(14,2),
        ADD COLUMN IF NOT EXISTS profit_margin_pct                NUMERIC(8,2),
        ADD COLUMN IF NOT EXISTS admin_notes                      TEXT,
        ADD COLUMN IF NOT EXISTS locked                           BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS category_key                     TEXT,
        ADD COLUMN IF NOT EXISTS template_id                      TEXT,
        ADD COLUMN IF NOT EXISTS template_version                 TEXT,
        ADD COLUMN IF NOT EXISTS template_snapshot                JSONB,
        ADD COLUMN IF NOT EXISTS required_documents_from_template JSONB,
        ADD COLUMN IF NOT EXISTS checklist_from_template          JSONB
    `));

    // ── vendor_operational_confirmations ───────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS vendor_operational_confirmations (
        id             SERIAL PRIMARY KEY,
        token          TEXT NOT NULL UNIQUE,
        order_id       INTEGER,
        order_number   TEXT,
        order_item_id  INTEGER,
        supplier_id    INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
        vendor_name    TEXT,
        service_type   TEXT NOT NULL,
        payload        JSONB NOT NULL DEFAULT '{}',
        status         TEXT NOT NULL DEFAULT 'pending',
        submitted_at   TIMESTAMP,
        instruction    TEXT,
        created_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS voc_token_idx    ON vendor_operational_confirmations(token);
      CREATE INDEX IF NOT EXISTS voc_order_id_idx ON vendor_operational_confirmations(order_id);
    `));

    // ── vendor_price_history ───────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS vendor_price_history (
        id             SERIAL PRIMARY KEY,
        submission_id  INTEGER REFERENCES vendor_mini_form_submissions(id) ON DELETE CASCADE,
        version_number INTEGER NOT NULL DEFAULT 1,
        old_price      NUMERIC(14,2),
        new_price      NUMERIC(14,2),
        currency       TEXT DEFAULT 'IDR',
        reason         TEXT,
        changed_by     TEXT,
        changed_at     TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS vph_submission_id_idx ON vendor_price_history(submission_id)`));

    // ── vmf_activity_log ───────────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS vmf_activity_log (
        id          SERIAL PRIMARY KEY,
        entity_type TEXT NOT NULL,
        entity_id   INTEGER NOT NULL,
        action      TEXT NOT NULL,
        actor       TEXT,
        note        TEXT,
        data        JSONB DEFAULT '{}',
        created_at  TIMESTAMP NOT NULL DEFAULT NOW()
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS val_entity_idx  ON vmf_activity_log(entity_type, entity_id);
      CREATE INDEX IF NOT EXISTS val_created_idx ON vmf_activity_log(created_at);
    `));

    // ── customer_invoice_links ─────────────────────────────────────────────────
    await db.execute(sql.raw(`
      CREATE TABLE IF NOT EXISTS customer_invoice_links (
        id              SERIAL PRIMARY KEY,
        token           TEXT NOT NULL UNIQUE,
        sales_doc_id    INTEGER,
        order_id        INTEGER,
        order_number    TEXT,
        invoice_number  TEXT,
        customer_name   TEXT,
        customer_phone  TEXT,
        currency        TEXT DEFAULT 'IDR',
        subtotal        NUMERIC(14,2),
        tax_rate        NUMERIC(5,2) DEFAULT 11,
        tax_amount      NUMERIC(14,2),
        grand_total     NUMERIC(14,2),
        amount_paid     NUMERIC(14,2) DEFAULT 0,
        payment_status  TEXT NOT NULL DEFAULT 'unpaid',
        payment_method  TEXT,
        due_date        TIMESTAMP,
        notes           TEXT,
        line_items      JSONB DEFAULT '[]',
        viewed_at       TIMESTAMP,
        acknowledged_at TIMESTAMP,
        status          TEXT NOT NULL DEFAULT 'sent',
        created_by      TEXT,
        created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
        expires_at      TIMESTAMP
      )
    `));
    await db.execute(sql.raw(`
      CREATE INDEX IF NOT EXISTS cil_token_idx       ON customer_invoice_links(token);
      CREATE INDEX IF NOT EXISTS cil_order_id_idx    ON customer_invoice_links(order_id);
      CREATE INDEX IF NOT EXISTS cil_sales_doc_id_idx ON customer_invoice_links(sales_doc_id);
    `));

    // ── Batch: ALL customer_invoice_links columns ─────────────────────────────
    await db.execute(sql.raw(`
      ALTER TABLE customer_invoice_links
        ADD COLUMN IF NOT EXISTS category_key      TEXT,
        ADD COLUMN IF NOT EXISTS template_id       TEXT,
        ADD COLUMN IF NOT EXISTS template_version  TEXT,
        ADD COLUMN IF NOT EXISTS template_snapshot JSONB
    `));

    // ── Media Foundation: idempotent ADD COLUMN IF NOT EXISTS ─────────────────
    await db.execute(sql.raw(`
      ALTER TABLE vendor_mini_form_submissions
        ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '[]'
    `));
    await db.execute(sql.raw(`
      ALTER TABLE customer_approvals
        ADD COLUMN IF NOT EXISTS media_assets JSONB NOT NULL DEFAULT '[]'
    `));

    logger.info("Vendor mini form migration: ok");
  } catch (err) {
    logger.error({ err }, "Vendor mini form migration failed");
  }
}

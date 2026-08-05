-- ============================================================================
-- ENTERPRISE MARKETPLACE — PHASE 1B MIGRATION DRAFT (REVIEW ONLY)
-- Tanggal dibuat  : 2026-07-02
-- Referensi       : docs/enterprise-marketplace-blueprint-v1.1.1.md (Section 6, 7, 12)
-- Sumber schema   : lib/db/src/schema/mktRfqs.ts, mktRfqLines.ts, mktVendorQuotes.ts,
--                   mktVendorQuoteLines.ts, mktPurchaseOrders.ts, mktRfqGuestClaims.ts,
--                   mktCompanySettings.ts (Phase 1A — sudah typecheck PASS)
-- Status          : EXECUTED — Phase 1C Migration Completed 2026-07-02.
--                   Semua statement Group A–D berhasil dieksekusi ke Supabase production.
--                   Backup diambil sebelum eksekusi. Verifikasi post-migration PASS.
--
-- PRASYARAT SEBELUM DIEKSEKUSI (Phase 1C, bila di-approve):
--   1. Backup Supabase (snapshot) sudah diambil.
--   2. Koneksi harus pakai SESSION POOLER port 5432 — bukan transaction pooler 6543.
--      (pgBouncer transaction-mode menolak multi-statement per db.execute() dan
--       menolak ALTER TYPE ... ADD VALUE di dalam transaction block.)
--   3. Setiap blok STEP di bawah dieksekusi sebagai statement TERPISAH satu per satu,
--      bukan disatukan dalam satu transaction / satu db.execute() call.
--   4. Semua statement idempotent (aman dijalankan ulang) — tapi tetap harus direview
--      manual, bukan auto-run.
-- ============================================================================


-- ============================================================================
-- GROUP A — CREATE TYPE (enum baru) — HARUS DI LUAR TRANSACTION BLOCK
-- Idempotent via DO $$ ... pg_type check (Postgres tidak support
-- "CREATE TYPE IF NOT EXISTS").
-- ============================================================================

-- A1. mkt_rfq_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_rfq_status') THEN
    CREATE TYPE mkt_rfq_status AS ENUM (
      'draft', 'submitted', 'quoting', 'quoted', 'awarded', 'cancelled', 'expired'
    );
  END IF;
END $$;

-- A2. mkt_rfq_priority
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_rfq_priority') THEN
    CREATE TYPE mkt_rfq_priority AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
END $$;

-- A3. mkt_quote_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_quote_status') THEN
    CREATE TYPE mkt_quote_status AS ENUM (
      'invited', 'opened', 'submitted', 'selected', 'rejected', 'expired', 'withdrawn'
    );
  END IF;
END $$;

-- A4. mkt_stock_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_stock_status') THEN
    CREATE TYPE mkt_stock_status AS ENUM (
      'available', 'limited', 'backorder', 'unavailable'
    );
  END IF;
END $$;

-- A5. mkt_po_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_po_status') THEN
    CREATE TYPE mkt_po_status AS ENUM (
      'pending', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'
    );
  END IF;
END $$;

-- A6. mkt_claim_status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_claim_status') THEN
    CREATE TYPE mkt_claim_status AS ENUM ('pending', 'claimed', 'expired');
  END IF;
END $$;

-- A7. accounting_entry_source ADD VALUE — enum EXISTING, hanya menambah 1 value.
--     WAJIB statement TERSENDIRI, DI LUAR TRANSACTION BLOCK, TIDAK BOLEH
--     digabung dengan statement lain dalam satu batch. IF NOT EXISTS didukung
--     PostgreSQL 12+ untuk ALTER TYPE ... ADD VALUE.
ALTER TYPE accounting_entry_source ADD VALUE IF NOT EXISTS 'marketplace_commission';


-- ============================================================================
-- GROUP B — CREATE TABLE untuk 7 tabel P0 marketplace
-- Urutan mengikuti dependency FK (parent sebelum child).
-- ============================================================================

-- B1. mkt_rfqs (Blueprint Section 6.1)
CREATE TABLE IF NOT EXISTS mkt_rfqs (
  id                       SERIAL PRIMARY KEY,
  rfq_number               TEXT NOT NULL UNIQUE,
  company_id               INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  catalog_vendor_id        INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  buyer_name               TEXT NOT NULL,
  buyer_email              TEXT NOT NULL,
  buyer_phone              TEXT,
  buyer_company            TEXT,
  guest_token              TEXT UNIQUE,
  guest_claimed_at         TIMESTAMP,
  guest_claimed_by         TEXT,
  status                   mkt_rfq_status NOT NULL DEFAULT 'draft',
  priority                 mkt_rfq_priority DEFAULT 'normal',
  required_delivery_date   DATE,
  delivery_address         TEXT,
  notes                    TEXT,
  email_verified           BOOLEAN NOT NULL DEFAULT false,
  email_verified_at        TIMESTAMP,
  line_count               INTEGER NOT NULL DEFAULT 0,
  quote_count              INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

-- B2. mkt_rfq_lines (Blueprint Section 6.2)
CREATE TABLE IF NOT EXISTS mkt_rfq_lines (
  id                       SERIAL PRIMARY KEY,
  rfq_id                   INTEGER NOT NULL REFERENCES mkt_rfqs(id) ON DELETE CASCADE,
  vendor_catalog_item_id   INTEGER REFERENCES vendor_catalog_items(id) ON DELETE SET NULL,
  item_name                TEXT NOT NULL,
  item_description         TEXT,
  item_unit                TEXT,
  requested_qty            NUMERIC(12,3) NOT NULL DEFAULT 1,
  target_price_per_unit    NUMERIC(14,2),
  notes                    TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

-- B3. mkt_vendor_quotes (Blueprint Section 6.3)
CREATE TABLE IF NOT EXISTS mkt_vendor_quotes (
  id                       SERIAL PRIMARY KEY,
  rfq_id                   INTEGER NOT NULL REFERENCES mkt_rfqs(id) ON DELETE CASCADE,
  vendor_id                INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  token                    TEXT NOT NULL UNIQUE,
  status                   mkt_quote_status NOT NULL DEFAULT 'invited',
  valid_until              TIMESTAMP,
  delivery_date_offered    DATE,
  notes                    TEXT,
  attachment_url           TEXT,
  commission_rate          NUMERIC(5,3),
  commission_tax_id        INTEGER REFERENCES accounting_taxes(id) ON DELETE SET NULL,
  commission_amount        NUMERIC(14,2),
  net_vendor_amount        NUMERIC(14,2),
  rank_score               NUMERIC(8,4),
  rank_badges              JSONB,
  submitted_at             TIMESTAMP,
  opened_at                TIMESTAMP,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

-- B4. mkt_vendor_quote_lines (Blueprint Section 6.4)
CREATE TABLE IF NOT EXISTS mkt_vendor_quote_lines (
  id                       SERIAL PRIMARY KEY,
  quote_id                 INTEGER NOT NULL REFERENCES mkt_vendor_quotes(id) ON DELETE CASCADE,
  rfq_line_id              INTEGER NOT NULL REFERENCES mkt_rfq_lines(id) ON DELETE CASCADE,
  vendor_catalog_item_id   INTEGER REFERENCES vendor_catalog_items(id) ON DELETE SET NULL,
  offered_unit_price       NUMERIC(14,2) NOT NULL,
  offered_qty              NUMERIC(12,3) NOT NULL,
  subtotal                 NUMERIC(14,2) NOT NULL DEFAULT 0,
  lead_time_days           INTEGER,
  stock_status             mkt_stock_status DEFAULT 'available',
  notes                    TEXT,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

-- B5. mkt_purchase_orders (Blueprint Section 6.5)
CREATE TABLE IF NOT EXISTS mkt_purchase_orders (
  id                       SERIAL PRIMARY KEY,
  po_number                TEXT NOT NULL UNIQUE,
  rfq_id                   INTEGER NOT NULL REFERENCES mkt_rfqs(id) ON DELETE RESTRICT,
  quote_id                 INTEGER NOT NULL REFERENCES mkt_vendor_quotes(id) ON DELETE RESTRICT,
  company_id               INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  vendor_id                INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE RESTRICT,
  status                   mkt_po_status NOT NULL DEFAULT 'pending',
  total_amount             NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount               NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total              NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_document_id        INTEGER REFERENCES sales_documents(id) ON DELETE SET NULL,
  confirmed_at             TIMESTAMP,
  cancelled_at             TIMESTAMP,
  cancel_reason            TEXT,
  journal_posted_at        TIMESTAMP,
  created_by               TEXT,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);

-- B6. mkt_rfq_guest_claims (Blueprint Section 6.6)
CREATE TABLE IF NOT EXISTS mkt_rfq_guest_claims (
  id                       SERIAL PRIMARY KEY,
  rfq_id                   INTEGER NOT NULL REFERENCES mkt_rfqs(id) ON DELETE CASCADE,
  guest_email              TEXT NOT NULL,
  guest_token              TEXT NOT NULL,
  claimed_by_user_id       TEXT,
  claim_status             mkt_claim_status NOT NULL DEFAULT 'pending',
  claimed_at               TIMESTAMP,
  expires_at               TIMESTAMP NOT NULL,
  created_at               TIMESTAMP NOT NULL DEFAULT now()
);

-- B7. mkt_company_settings (Blueprint Section 6.7 — F26 resolved)
CREATE TABLE IF NOT EXISTS mkt_company_settings (
  id                       SERIAL PRIMARY KEY,
  company_id               INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  setting_key              TEXT NOT NULL,
  setting_value            JSONB NOT NULL,
  description              TEXT,
  created_at               TIMESTAMP NOT NULL DEFAULT now(),
  updated_at               TIMESTAMP NOT NULL DEFAULT now()
);


-- ============================================================================
-- GROUP C — CREATE INDEX / UNIQUE INDEX (Blueprint Section 18)
-- ============================================================================

-- mkt_rfqs
CREATE INDEX IF NOT EXISTS mkt_rfqs_company_idx          ON mkt_rfqs(company_id);
CREATE INDEX IF NOT EXISTS mkt_rfqs_catalog_vendor_idx    ON mkt_rfqs(catalog_vendor_id);
CREATE INDEX IF NOT EXISTS mkt_rfqs_status_idx            ON mkt_rfqs(status);
CREATE INDEX IF NOT EXISTS mkt_rfqs_guest_token_idx       ON mkt_rfqs(guest_token);

-- mkt_rfq_lines
CREATE INDEX IF NOT EXISTS mkt_rfq_lines_rfq_idx                    ON mkt_rfq_lines(rfq_id);
CREATE INDEX IF NOT EXISTS mkt_rfq_lines_vendor_catalog_item_idx    ON mkt_rfq_lines(vendor_catalog_item_id);

-- mkt_vendor_quotes
CREATE INDEX IF NOT EXISTS mkt_vendor_quotes_rfq_idx      ON mkt_vendor_quotes(rfq_id);
CREATE INDEX IF NOT EXISTS mkt_vendor_quotes_vendor_idx   ON mkt_vendor_quotes(vendor_id);
CREATE INDEX IF NOT EXISTS mkt_vendor_quotes_status_idx   ON mkt_vendor_quotes(status);

-- mkt_vendor_quote_lines
CREATE INDEX IF NOT EXISTS mkt_vendor_quote_lines_quote_idx               ON mkt_vendor_quote_lines(quote_id);
CREATE INDEX IF NOT EXISTS mkt_vendor_quote_lines_rfq_line_idx            ON mkt_vendor_quote_lines(rfq_line_id);
CREATE INDEX IF NOT EXISTS mkt_vendor_quote_lines_vendor_catalog_item_idx ON mkt_vendor_quote_lines(vendor_catalog_item_id);

-- mkt_purchase_orders
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_rfq_idx      ON mkt_purchase_orders(rfq_id);
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_quote_idx    ON mkt_purchase_orders(quote_id);
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_company_idx  ON mkt_purchase_orders(company_id);
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_vendor_idx   ON mkt_purchase_orders(vendor_id);
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_status_idx   ON mkt_purchase_orders(status);

-- mkt_rfq_guest_claims
CREATE INDEX IF NOT EXISTS mkt_rfq_guest_claims_rfq_idx          ON mkt_rfq_guest_claims(rfq_id);
CREATE INDEX IF NOT EXISTS mkt_rfq_guest_claims_guest_token_idx  ON mkt_rfq_guest_claims(guest_token);
CREATE INDEX IF NOT EXISTS mkt_rfq_guest_claims_status_idx       ON mkt_rfq_guest_claims(claim_status);

-- mkt_company_settings
CREATE UNIQUE INDEX IF NOT EXISTS mkt_company_settings_company_key_uniq ON mkt_company_settings(company_id, setting_key);
CREATE INDEX IF NOT EXISTS mkt_company_settings_key_idx                 ON mkt_company_settings(setting_key);


-- ============================================================================
-- GROUP D — ALTER TABLE ke tabel ERP existing (nullable FK, aman/non-breaking)
-- ============================================================================

-- D1. purchase_documents ← mkt_purchase_orders [KEPUTUSAN #8]
ALTER TABLE purchase_documents
  ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER
  REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS purchase_documents_mkt_po_idx ON purchase_documents(mkt_purchase_order_id);

-- D2. activity_logs — audit trail marketplace [F02 resolved]
ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS mkt_rfq_id INTEGER
  REFERENCES mkt_rfqs(id) ON DELETE SET NULL;

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS mkt_vendor_quote_id INTEGER
  REFERENCES mkt_vendor_quotes(id) ON DELETE SET NULL;

ALTER TABLE activity_logs
  ADD COLUMN IF NOT EXISTS mkt_purchase_order_id INTEGER
  REFERENCES mkt_purchase_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS activity_logs_mkt_rfq_idx           ON activity_logs(mkt_rfq_id);
CREATE INDEX IF NOT EXISTS activity_logs_mkt_vendor_quote_idx   ON activity_logs(mkt_vendor_quote_id);
CREATE INDEX IF NOT EXISTS activity_logs_mkt_purchase_order_idx ON activity_logs(mkt_purchase_order_id);

-- ============================================================================
-- END OF DRAFT — lihat migrations/enterprise-marketplace-p0-rollback.sql
-- untuk rollback plan lengkap.
-- ============================================================================

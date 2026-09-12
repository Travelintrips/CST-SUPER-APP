-- ─────────────────────────────────────────────────────────────────────────────
-- MARKETPLACE CORE BASE TABLES
-- The marketplace tables are installed by the runtime Phase 1C migration in
-- existing environments, but several later SQL migrations alter them directly.
-- Keep a fresh TEST database bootstrap-compatible with that canonical schema.
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_rfq_status') THEN
    CREATE TYPE mkt_rfq_status AS ENUM (
      'draft', 'submitted', 'quoting', 'quoted', 'awarded', 'cancelled', 'expired'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_rfq_priority') THEN
    CREATE TYPE mkt_rfq_priority AS ENUM ('low', 'normal', 'high', 'urgent');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_quote_status') THEN
    CREATE TYPE mkt_quote_status AS ENUM (
      'invited', 'opened', 'submitted', 'selected', 'rejected', 'expired', 'withdrawn'
    );
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'mkt_po_status') THEN
    CREATE TYPE mkt_po_status AS ENUM (
      'pending', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled'
    );
  END IF;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mkt_rfqs (
  id                    SERIAL PRIMARY KEY,
  rfq_number            TEXT NOT NULL UNIQUE,
  company_id            INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  catalog_vendor_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
  buyer_name            TEXT NOT NULL,
  buyer_email           TEXT NOT NULL,
  buyer_phone           TEXT,
  buyer_company         TEXT,
  guest_token           TEXT UNIQUE,
  guest_token_hash      TEXT,
  guest_token_expires_at TIMESTAMP,
  guest_claimed_at      TIMESTAMP,
  guest_claimed_by      TEXT,
  status                mkt_rfq_status NOT NULL DEFAULT 'draft',
  priority              mkt_rfq_priority DEFAULT 'normal',
  required_delivery_date DATE,
  delivery_address      TEXT,
  destination_place_id  TEXT,
  destination_lat       NUMERIC(10,7),
  destination_lng       NUMERIC(10,7),
  notes                 TEXT,
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  email_verified_at     TIMESTAMP,
  line_count            INTEGER NOT NULL DEFAULT 0,
  quote_count           INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS mkt_rfqs_company_idx
  ON mkt_rfqs(company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_rfqs_catalog_vendor_idx
  ON mkt_rfqs(catalog_vendor_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_rfqs_status_idx
  ON mkt_rfqs(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_rfqs_guest_token_idx
  ON mkt_rfqs(guest_token);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_rfqs_guest_token_hash_idx
  ON mkt_rfqs(guest_token_hash);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mkt_rfq_lines (
  id                    SERIAL PRIMARY KEY,
  rfq_id                INTEGER NOT NULL
                          REFERENCES mkt_rfqs(id) ON DELETE CASCADE,
  vendor_catalog_item_id INTEGER
                          REFERENCES vendor_catalog_items(id) ON DELETE SET NULL,
  item_name             TEXT NOT NULL,
  item_description      TEXT,
  item_unit             TEXT,
  requested_qty         NUMERIC(12,3) NOT NULL DEFAULT 1,
  target_price_per_unit NUMERIC(14,2),
  notes                 TEXT,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  created_at            TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_rfq_lines_rfq_idx
  ON mkt_rfq_lines(rfq_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_rfq_lines_vendor_catalog_item_idx
  ON mkt_rfq_lines(vendor_catalog_item_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mkt_vendor_quotes (
  id                  SERIAL PRIMARY KEY,
  rfq_id              INTEGER NOT NULL
                       REFERENCES mkt_rfqs(id) ON DELETE CASCADE,
  vendor_id           INTEGER NOT NULL
                       REFERENCES suppliers(id) ON DELETE RESTRICT,
  token               TEXT NOT NULL UNIQUE,
  status              mkt_quote_status NOT NULL DEFAULT 'invited',
  valid_until         TIMESTAMP,
  delivery_date_offered DATE,
  notes               TEXT,
  attachment_url      TEXT,
  quotation_number    TEXT,
  quotation_date      DATE,
  payment_terms       TEXT,
  incoterm            TEXT,
  delivery_location   TEXT,
  commission_rate     NUMERIC(5,3),
  commission_tax_id   INTEGER REFERENCES accounting_taxes(id) ON DELETE SET NULL,
  commission_amount   NUMERIC(14,2),
  net_vendor_amount   NUMERIC(14,2),
  rank_score          NUMERIC(8,4),
  rank_badges         JSONB,
  submitted_at        TIMESTAMP,
  opened_at           TIMESTAMP,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_vendor_quotes_rfq_idx
  ON mkt_vendor_quotes(rfq_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_vendor_quotes_vendor_idx
  ON mkt_vendor_quotes(vendor_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_vendor_quotes_status_idx
  ON mkt_vendor_quotes(status);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS mkt_vendor_quotes_rfq_vendor_unique
  ON mkt_vendor_quotes(rfq_id, vendor_id);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS mkt_purchase_orders (
  id                SERIAL PRIMARY KEY,
  po_number         TEXT NOT NULL UNIQUE,
  rfq_id            INTEGER NOT NULL
                    REFERENCES mkt_rfqs(id) ON DELETE RESTRICT,
  quote_id          INTEGER NOT NULL
                    REFERENCES mkt_vendor_quotes(id) ON DELETE RESTRICT,
  company_id        INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  vendor_id         INTEGER NOT NULL
                    REFERENCES suppliers(id) ON DELETE RESTRICT,
  status            mkt_po_status NOT NULL DEFAULT 'pending',
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  tax_amount        NUMERIC(14,2) NOT NULL DEFAULT 0,
  grand_total       NUMERIC(14,2) NOT NULL DEFAULT 0,
  sales_document_id INTEGER REFERENCES sales_documents(id) ON DELETE SET NULL,
  confirmed_at      TIMESTAMP,
  cancelled_at      TIMESTAMP,
  cancel_reason     TEXT,
  journal_posted_at TIMESTAMP,
  created_by        TEXT,
  created_at        TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMP NOT NULL DEFAULT NOW()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_company_idx
  ON mkt_purchase_orders(company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_vendor_idx
  ON mkt_purchase_orders(vendor_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS mkt_purchase_orders_status_idx
  ON mkt_purchase_orders(status);
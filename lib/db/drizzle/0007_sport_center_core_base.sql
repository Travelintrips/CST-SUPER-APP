-- ─────────────────────────────────────────────────────────────────────────────
-- SPORT CENTER PUBLIC MIRROR CORE
-- The Sport Center runtime migration historically created these public mirror
-- tables before later accounting/reconciliation migrations altered them.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS sport_facilities (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'court',
  description     TEXT,
  capacity        INTEGER DEFAULT 1,
  price_per_hour  NUMERIC(14,2) NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  image_url       TEXT,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_customers (
  id          SERIAL PRIMARY KEY,
  company_id  INTEGER,
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT,
  address     TEXT,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_members (
  id            SERIAL PRIMARY KEY,
  company_id    INTEGER,
  customer_id   INTEGER REFERENCES sport_customers(id),
  name          TEXT NOT NULL,
  email         TEXT,
  phone         TEXT,
  member_type   TEXT NOT NULL DEFAULT 'gym',
  member_number TEXT,
  start_date    DATE NOT NULL,
  end_date      DATE,
  status        TEXT NOT NULL DEFAULT 'active',
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_pricing_rules (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER,
  facility_id     INTEGER REFERENCES sport_facilities(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  day_type        TEXT NOT NULL DEFAULT 'all',
  time_start      TIME,
  time_end        TIME,
  price_per_hour  NUMERIC(14,2) NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_promos (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT,
  discount_type   TEXT NOT NULL DEFAULT 'percent',
  discount_value  NUMERIC(14,2) NOT NULL DEFAULT 0,
  min_amount      NUMERIC(14,2) DEFAULT 0,
  max_uses        INTEGER,
  used_count      INTEGER NOT NULL DEFAULT 0,
  valid_from      TIMESTAMPTZ,
  valid_until     TIMESTAMPTZ,
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_bookings (
  id                SERIAL PRIMARY KEY,
  company_id        INTEGER,
  booking_number    TEXT NOT NULL,
  customer_id       INTEGER REFERENCES sport_customers(id),
  customer_name     TEXT NOT NULL,
  customer_phone    TEXT,
  facility_id       INTEGER REFERENCES sport_facilities(id),
  facility_name     TEXT NOT NULL,
  booking_date      DATE NOT NULL,
  start_time        TIME NOT NULL,
  end_time          TIME NOT NULL,
  duration_hours    NUMERIC(5,2) NOT NULL DEFAULT 1,
  status            TEXT NOT NULL DEFAULT 'pending',
  payment_status    TEXT NOT NULL DEFAULT 'unpaid',
  base_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  discount_amount   NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
  promo_id          INTEGER REFERENCES sport_promos(id),
  promo_code        TEXT,
  notes             TEXT,
  checked_in_at     TIMESTAMPTZ,
  checked_in_by     TEXT,
  cancelled_at      TIMESTAMPTZ,
  cancelled_reason  TEXT,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS sport_payments (
  id              SERIAL PRIMARY KEY,
  company_id      INTEGER,
  booking_id      INTEGER REFERENCES sport_bookings(id) ON DELETE CASCADE,
  payment_number  TEXT NOT NULL,
  amount          NUMERIC(14,2) NOT NULL,
  method          TEXT NOT NULL DEFAULT 'cash',
  status          TEXT NOT NULL DEFAULT 'pending',
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_by      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS qris_settlements (
  id                    SERIAL PRIMARY KEY,
  company_id            INTEGER NOT NULL,
  settlement_reference  TEXT NOT NULL,
  provider_name         TEXT,
  settlement_date       DATE NOT NULL,
  gross_amount          NUMERIC(16,2) NOT NULL DEFAULT 0,
  mdr_amount            NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_withheld_amount   NUMERIC(16,2) NOT NULL DEFAULT 0,
  other_fee_amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(16,2) NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'unsettled',
  bank_mutation_id      INTEGER,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (company_id, settlement_reference)
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS qris_settlement_items (
  id                    SERIAL PRIMARY KEY,
  settlement_id         INTEGER NOT NULL
                        REFERENCES qris_settlements(id) ON DELETE CASCADE,
  sport_payment_id      INTEGER NOT NULL
                        REFERENCES sport_payments(id) ON DELETE RESTRICT,
  gross_amount          NUMERIC(16,2) NOT NULL DEFAULT 0,
  mdr_amount            NUMERIC(16,2) NOT NULL DEFAULT 0,
  tax_withheld_amount   NUMERIC(16,2) NOT NULL DEFAULT 0,
  other_fee_amount      NUMERIC(16,2) NOT NULL DEFAULT 0,
  net_amount            NUMERIC(16,2) NOT NULL DEFAULT 0,
  UNIQUE (settlement_id, sport_payment_id)
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_sport_bookings_date
  ON sport_bookings(booking_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sport_bookings_facility
  ON sport_bookings(facility_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sport_bookings_status
  ON sport_bookings(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sport_bookings_company
  ON sport_bookings(company_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_sport_payments_settlement
  ON sport_payments(status, paid_at);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_qris_settlements_company_date
  ON qris_settlements(company_id, settlement_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS idx_qris_settlement_items_payment
  ON qris_settlement_items(sport_payment_id);
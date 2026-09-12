import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export async function runLogisticsRatesMigration() {
  // Create enum types
  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'logistics_service_type') THEN
        CREATE TYPE logistics_service_type AS ENUM (
          'seaFreight', 'airFreight', 'customs', 'trucking', 'warehousing', 'projectCargo'
        );
      END IF;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rate_value_type') THEN
        CREATE TYPE rate_value_type AS ENUM ('fixed', 'percentage');
      END IF;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'surcharge_type') THEN
        CREATE TYPE surcharge_type AS ENUM ('fixed', 'percentage', 'per_unit');
      END IF;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'surcharge_unit') THEN
        CREATE TYPE surcharge_unit AS ENUM ('per_kg', 'per_cbm', 'per_container', 'per_day', 'per_pallet', 'flat');
      END IF;
    END $$
  `);

  await db.execute(sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'surcharge_applies_to') THEN
        CREATE TYPE surcharge_applies_to AS ENUM ('all', 'dg', 'temp_controlled', 'oversize', 'overnight');
      END IF;
    END $$
  `);

  // Create logistics_rate_cards
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS logistics_rate_cards (
      id          SERIAL PRIMARY KEY,
      service_type logistics_service_type NOT NULL,
      name        TEXT NOT NULL,
      description TEXT,
      currency    TEXT NOT NULL DEFAULT 'IDR',
      is_active   BOOLEAN NOT NULL DEFAULT TRUE,
      valid_from  TIMESTAMPTZ,
      valid_to    TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create logistics_service_rates
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS logistics_service_rates (
      id            SERIAL PRIMARY KEY,
      rate_card_id  INTEGER NOT NULL REFERENCES logistics_rate_cards(id) ON DELETE CASCADE,
      rate_key      TEXT NOT NULL,
      label         TEXT NOT NULL,
      value_type    rate_value_type NOT NULL DEFAULT 'fixed',
      value_amount  NUMERIC(18,4) NOT NULL DEFAULT 0,
      container_type TEXT,
      vehicle_type   TEXT,
      notes          TEXT,
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Create logistics_surcharges
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS logistics_surcharges (
      id             SERIAL PRIMARY KEY,
      service_type   TEXT NOT NULL,
      name           TEXT NOT NULL,
      label          TEXT NOT NULL,
      surcharge_type surcharge_type NOT NULL DEFAULT 'fixed',
      amount         NUMERIC(18,4) NOT NULL DEFAULT 0,
      unit           surcharge_unit NOT NULL DEFAULT 'flat',
      is_mandatory   BOOLEAN NOT NULL DEFAULT FALSE,
      is_active      BOOLEAN NOT NULL DEFAULT TRUE,
      applies_to     surcharge_applies_to NOT NULL DEFAULT 'all',
      sort_order     INTEGER NOT NULL DEFAULT 0,
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

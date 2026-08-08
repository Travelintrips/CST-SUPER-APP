import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Runtime schema for provider-level QRIS settlements.
 *
 * A settlement is the bank-facing aggregate. The items preserve the
 * one-to-many relationship back to the canonical Sport Center payments.
 */
export async function runQrisSettlementMigration(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qris_settlements (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      settlement_reference TEXT NOT NULL,
      provider_name TEXT,
      settlement_date DATE NOT NULL,
      gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'unsettled',
      bank_mutation_id INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, settlement_reference)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qris_settlement_items (
      id SERIAL PRIMARY KEY,
      settlement_id INTEGER NOT NULL REFERENCES qris_settlements(id) ON DELETE CASCADE,
      sport_payment_id INTEGER NOT NULL REFERENCES sport_payments(id) ON DELETE RESTRICT,
      gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      tax_withheld_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      UNIQUE (settlement_id, sport_payment_id)
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_qris_settlements_company_date
      ON qris_settlements(company_id, settlement_date)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_qris_settlement_items_payment
      ON qris_settlement_items(sport_payment_id)
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_qris_settlements_bank_mutation
      ON qris_settlements(bank_mutation_id)
      WHERE bank_mutation_id IS NOT NULL
  `);
}
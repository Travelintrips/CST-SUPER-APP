import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Runtime schema for provider-level QRIS settlements.
 *
 * A settlement is the bank-facing aggregate. The items preserve the
 * one-to-many relationship back to the canonical Sport Center payments.
 */
export async function runQrisSettlementMigration(): Promise<void> {
  // Provider and bank-evidence classification are additive. Historical rows
  // remain valid and are deliberately left as unknown when no explicit value
  // exists; payment_method=QRIS is never used to guess a provider.
  await db.execute(sql`
    ALTER TABLE bank_mutations
      ADD COLUMN IF NOT EXISTS source_classification TEXT NOT NULL DEFAULT 'unknown'
  `).catch(() => {});
  await db.execute(sql`
    UPDATE bank_mutations
    SET source_classification = CASE
      WHEN LOWER(COALESCE(source, '')) IN (
        'bank_import', 'csv_excel', 'google_sheet', 'statement_import',
        'mt940', 'camt053', 'actual_bank_mutation'
      ) THEN 'actual_bank_mutation'
      WHEN LOWER(COALESCE(source, '')) IN (
        'synthetic', 'generated', 'sport_center', 'sport-center', 'qris_settlement'
      ) THEN 'synthetic'
      ELSE 'unknown'
    END
    WHERE source_classification = 'unknown'
  `).catch(() => {});

  await db.execute(sql`
    ALTER TABLE sport_payments
      ADD COLUMN IF NOT EXISTS provider_code TEXT NOT NULL DEFAULT 'unknown'
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qris_business_calendar_holidays (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      holiday_date DATE NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, holiday_date)
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qris_provider_settlement_rules (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      provider_code TEXT NOT NULL,
      settlement_delay_business_days INTEGER NOT NULL DEFAULT 1,
      match_window_business_days INTEGER NOT NULL DEFAULT 1,
      max_effective_deduction_rate NUMERIC(7,6) NOT NULL DEFAULT 0.100000,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, provider_code)
    )
  `).catch(() => {});

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

  // Provisional candidates are derived only from imported bank mutations.
  // They are deliberately separate from provider-confirmed settlements so
  // reviewers can see a likely batch without treating it as authoritative.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qris_mutation_batch_candidates (
      id SERIAL PRIMARY KEY,
      mutation_id INTEGER NOT NULL UNIQUE REFERENCES bank_mutations(id) ON DELETE CASCADE,
      company_id INTEGER,
      source_date DATE NOT NULL,
      estimated_settlement_date DATE NOT NULL,
      provider_code TEXT NOT NULL DEFAULT 'unknown',
      mutation_source_classification TEXT NOT NULL DEFAULT 'unknown',
      gross_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      mdr_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      other_fee_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      payment_items JSONB NOT NULL DEFAULT '[]'::jsonb,
      status TEXT NOT NULL DEFAULT 'estimated_from_bank_mutation',
      reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED',
      confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
      observed_deduction NUMERIC(16,2) NOT NULL DEFAULT 0,
      effective_deduction_rate NUMERIC(9,8),
      review_reason TEXT,
      generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // Existing installations predate the provider-aware columns above.
  await db.execute(sql`
    ALTER TABLE qris_mutation_batch_candidates
      ADD COLUMN IF NOT EXISTS provider_code TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS mutation_source_classification TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED',
      ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS observed_deduction NUMERIC(16,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS effective_deduction_rate NUMERIC(9,8),
      ADD COLUMN IF NOT EXISTS review_reason TEXT,
      ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `).catch(() => {});

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
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_qris_candidates_status
      ON qris_mutation_batch_candidates(company_id, reconciliation_status, source_date)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_qris_candidates_provider
      ON qris_mutation_batch_candidates(provider_code, estimated_settlement_date)
  `).catch(() => {});
}
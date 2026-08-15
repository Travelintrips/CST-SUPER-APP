import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Runtime schema for provider-level QRIS settlements.
 *
 * A settlement is the bank-facing aggregate. The items preserve the
 * one-to-many relationship back to the canonical Sport Center payments.
 */
let qrisSettlementMigrationPromise: Promise<void> | null = null;

async function runQrisSettlementMigrationOnce(): Promise<void> {
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
      ADD COLUMN IF NOT EXISTS provider_code TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS settlement_rule_version TEXT
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
      bank_account_id INTEGER,
      provider_code TEXT NOT NULL,
      rule_version TEXT NOT NULL DEFAULT 'default-v1',
      settlement_delay_business_days INTEGER NOT NULL DEFAULT 1,
      match_window_business_days INTEGER NOT NULL DEFAULT 1,
      max_effective_deduction_rate NUMERIC(7,6) NOT NULL DEFAULT 0.100000,
       absolute_variance_tolerance NUMERIC(16,2) NOT NULL DEFAULT 5000.00,
       percentage_variance_tolerance NUMERIC(7,4) NOT NULL DEFAULT 1.0000,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, provider_code)
    )
  `).catch(() => {});
  await db.execute(sql`
    ALTER TABLE qris_provider_settlement_rules
      ADD COLUMN IF NOT EXISTS bank_account_id INTEGER,
       ADD COLUMN IF NOT EXISTS rule_version TEXT NOT NULL DEFAULT 'default-v1',
       ADD COLUMN IF NOT EXISTS absolute_variance_tolerance NUMERIC(16,2) NOT NULL DEFAULT 5000.00,
       ADD COLUMN IF NOT EXISTS percentage_variance_tolerance NUMERIC(7,4) NOT NULL DEFAULT 1.0000
  `).catch(() => {});
  // Settlement routing is company + account + provider. The legacy unique
  // constraint is too broad for companies with multiple settlement accounts.
  await db.execute(sql`
    ALTER TABLE qris_provider_settlement_rules
      DROP CONSTRAINT IF EXISTS qris_provider_settlement_rules_company_id_provider_code_key
  `).catch(() => {});
  // Deduplicate before creating the compound unique index; keep the latest row
  // per (company_id, COALESCE(bank_account_id,0), provider_code) triple so the
  // CREATE UNIQUE INDEX does not fail on pre-existing data.
  await db.execute(sql.raw(`
    DELETE FROM qris_provider_settlement_rules
    WHERE id NOT IN (
      SELECT MAX(id) FROM qris_provider_settlement_rules
      GROUP BY company_id, COALESCE(bank_account_id, 0), provider_code
    )
  `)).catch(() => {});
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_qris_provider_rules_company_account_provider
      ON qris_provider_settlement_rules (company_id, COALESCE(bank_account_id, 0), provider_code)
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
  // A payment may belong to only one provider settlement, including when
  // approvals are split into multiple partial selections.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_qris_settlement_items_payment
      ON qris_settlement_items (sport_payment_id)
  `);

  // Provisional candidates are derived only from imported bank mutations.
  // They are deliberately separate from provider-confirmed settlements so
  // reviewers can see a likely batch without treating it as authoritative.
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS qris_mutation_batch_candidates (
      id SERIAL PRIMARY KEY,
      mutation_id INTEGER NOT NULL UNIQUE REFERENCES bank_mutations(id) ON DELETE CASCADE,
      company_id INTEGER,
      bank_account_id INTEGER,
      source_date DATE NOT NULL,
      estimated_settlement_date DATE NOT NULL,
      provider_code TEXT NOT NULL DEFAULT 'unknown',
      provider_detection_source TEXT NOT NULL DEFAULT 'unknown',
      settlement_rule_version TEXT NOT NULL DEFAULT 'legacy-v1',
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
      ADD COLUMN IF NOT EXISTS bank_account_id INTEGER,
      ADD COLUMN IF NOT EXISTS candidate_source TEXT NOT NULL DEFAULT 'sport_center.sport_payments',
      ADD COLUMN IF NOT EXISTS mutation_key TEXT,
      ADD COLUMN IF NOT EXISTS provider_code TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS provider_detection_source TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS settlement_rule_version TEXT NOT NULL DEFAULT 'legacy-v1',
      ADD COLUMN IF NOT EXISTS mutation_source_classification TEXT NOT NULL DEFAULT 'unknown',
      ADD COLUMN IF NOT EXISTS reconciliation_status TEXT NOT NULL DEFAULT 'UNMATCHED',
      ADD COLUMN IF NOT EXISTS confidence NUMERIC(5,4) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS observed_deduction NUMERIC(16,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS effective_deduction_rate NUMERIC(9,8),
      ADD COLUMN IF NOT EXISTS review_reason TEXT,
      ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `).catch(() => {});

  // A mutation may legitimately have multiple historical candidate snapshots.
  // Keep superseded rows for audit instead of forcing the new snapshot to
  // overwrite the old evidence through mutation_id's legacy UNIQUE constraint.
  await db.execute(sql`
    ALTER TABLE qris_mutation_batch_candidates
      DROP CONSTRAINT IF EXISTS qris_mutation_batch_candidates_mutation_id_key
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_qris_candidates_mutation
      ON qris_mutation_batch_candidates(mutation_id, id DESC)
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
  // One payment cannot be part of two provider-confirmed final settlements.
  // Candidate generation itself remains provisional and never posts.
  // A Sport Center payment can only be consumed by one final provider
  // settlement. This is the race-condition backstop for concurrent approvals:
  // the EXISTS pre-check is advisory, while this unique index is authoritative.
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_qris_settlement_items_payment
      ON qris_settlement_items(sport_payment_id)
  `);
}

/**
 * Runtime migration is used by several QRIS endpoints. Share the in-flight
 * promise so concurrent requests do not each run the full DDL/backfill chain.
 * A failed run is cleared so the next request can retry after the underlying
 * database problem has been resolved.
 */
export function runQrisSettlementMigration(): Promise<void> {
  if (!qrisSettlementMigrationPromise) {
    qrisSettlementMigrationPromise = runQrisSettlementMigrationOnce().catch((error) => {
      qrisSettlementMigrationPromise = null;
      throw error;
    });
  }
  return qrisSettlementMigrationPromise;
}
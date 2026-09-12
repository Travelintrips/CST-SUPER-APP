import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Shadow evidence is deliberately separate from central_finance_processing.
 * It is comparison metadata, not a posting queue.
 */
export async function runSportCenterShadowObserverMigration(): Promise<void> {
  await db.execute(sql`
    CREATE SCHEMA IF NOT EXISTS sport_center
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sport_center.shadow_observer_comparisons (
      id BIGSERIAL PRIMARY KEY,
      project_code TEXT NOT NULL,
      source_payment_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      comparison_version TEXT NOT NULL DEFAULT '1',
      comparison_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (comparison_status IN ('pending','processing','MATCH','ALLOWED_DIFFERENCE','MISMATCH','MANUAL_REVIEW','NOT_OBSERVED')),
      comparison_class TEXT,
      comparison_evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
      expected_accounting_identity JSONB,
      actual_accounting_identity JSONB,
      expected_revenue_coa TEXT,
      actual_revenue_coa TEXT,
      expected_tax_output_coa TEXT,
      actual_tax_output_coa TEXT,
      expected_bank_coa TEXT,
      actual_bank_coa TEXT,
      expected_mdr NUMERIC(18,2),
      actual_mdr NUMERIC(18,2),
      expected_net_settlement NUMERIC(18,2),
      actual_net_settlement NUMERIC(18,2),
      expected_settlement_date DATE,
      actual_settlement_date DATE,
      shadow_started_at TIMESTAMPTZ,
      last_error TEXT,
      compared_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT shadow_observer_identity_uidx
        UNIQUE (project_code, source_payment_id, event_type, comparison_version),
      CONSTRAINT shadow_observer_correlation_uidx UNIQUE (correlation_id, comparison_version)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS shadow_observer_claim_idx
      ON sport_center.shadow_observer_comparisons
        (comparison_status, updated_at)
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sport_center.shadow_observer_config (
      id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      shadow_started_at TIMESTAMPTZ,
      allow_historical_backfill BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}
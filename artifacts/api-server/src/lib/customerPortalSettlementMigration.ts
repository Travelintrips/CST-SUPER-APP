import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-7: project-owned Customer Portal settlement storage.
 *
 * The public mutation is the canonical external identity. Customer Portal
 * settlement rows are deliberately not stored in sport_center.*.
 */
export async function runCustomerPortalSettlementMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_portal_settlement_batches (
      id BIGSERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL,
      provider_code TEXT NOT NULL,
      bank_account_id TEXT NOT NULL,
      settlement_date DATE NOT NULL,
      settlement_rule_version TEXT NOT NULL DEFAULT 'T+1_BUSINESS_DAY',
      gross_amount NUMERIC(18,2) NOT NULL,
      mdr_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      fixed_fee_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      fee_tax_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(18,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'posted'
        CHECK (status IN ('draft','posted','reconciled','failed')),
      settlement_journal_id INTEGER,
      canonical_bank_mutation_id INTEGER,
      canonical_key TEXT NOT NULL UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS customer_portal_settlement_items (
      id BIGSERIAL PRIMARY KEY,
      settlement_id BIGINT NOT NULL REFERENCES customer_portal_settlement_batches(id) ON DELETE CASCADE,
      payment_id INTEGER NOT NULL,
      gross_amount NUMERIC(18,2) NOT NULL,
      status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active','superseded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (payment_id)
    )
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS customer_portal_settlement_items_settlement_idx
      ON customer_portal_settlement_items (settlement_id)
  `);

  // Existing Sport Center public-mutation projection remains unchanged for
  // Sport Center rows, while Customer Portal owns its own public mutation.
  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION sport_center.project_public_bank_mutation_to_canonical_trigger()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'sport_center', 'public'
    AS $function$
    BEGIN
      IF NEW.source_app = 'customer_portal' THEN
        RETURN NEW;
      END IF;
      PERFORM sport_center.project_public_bank_mutation_to_canonical(NEW.id);
      RETURN NEW;
    END;
    $function$;
  `));
}
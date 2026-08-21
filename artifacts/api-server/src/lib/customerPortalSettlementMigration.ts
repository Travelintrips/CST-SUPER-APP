import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Customer Portal owns these settlement rows. No sport_center.* table or
 * owner routine is used here; the public bank mutation is the canonical
 * external identity shared with reconciliation.
 */
export async function runCustomerPortalSettlementMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    ALTER TABLE public.bank_mutations
      ADD COLUMN IF NOT EXISTS canonical_key TEXT
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bank_mutations_customer_portal_canonical_uidx
      ON public.bank_mutations (canonical_key)
      WHERE canonical_key LIKE 'customer_portal:payment:%'
  `);
  await db.execute(sql`
    CREATE UNIQUE INDEX IF NOT EXISTS bank_mutations_customer_portal_mutation_uidx
      ON public.bank_mutations (mutation_key)
      WHERE mutation_key LIKE 'CP-PAY-%'
  `);

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
      settlement_id BIGINT NOT NULL
        REFERENCES customer_portal_settlement_batches(id) ON DELETE CASCADE,
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
}
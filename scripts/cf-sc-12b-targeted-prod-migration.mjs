#!/usr/bin/env node
/**
 * CF-SC-12B targeted production foundation migration.
 *
 * This is intentionally separate from generic DEV→PROD schema tooling and from
 * application startup.  It is additive/idempotent and refuses to write unless
 * the caller explicitly opts in with CF_SC_12B_APPLY=true.
 */
import pg from "pg";

const { Client } = pg;
const apply = process.env.CF_SC_12B_APPLY === "true";
const prodUrl = process.env.SUPABASE_MIGRATION_URL || process.env.SUPABASE_DATABASE_URL;

if (process.env.APP_ENV !== "production" || !apply) {
  throw new Error(
    "CF-SC-12B requires APP_ENV=production and CF_SC_12B_APPLY=true; no database write was attempted.",
  );
}
if (!prodUrl) throw new Error("CF-SC-12B requires the canonical production PostgreSQL URL.");

const client = new Client({ connectionString: prodUrl, ssl: { rejectUnauthorized: false } });

async function one(sql, params = []) {
  return client.query(sql, params);
}

async function assertNoViolations(label, sql, params = []) {
  const result = await one(sql, params);
  if (result.rows.length) {
    throw new Error(`CF_SC_12B_CONSTRAINT_BLOCKED: ${label}: ${JSON.stringify(result.rows)}`);
  }
}

async function createFoundationTables() {
  await one(`
    CREATE TABLE IF NOT EXISTS public.finance_project_configs (
      id SERIAL PRIMARY KEY,
      project_code TEXT NOT NULL,
      company_id INTEGER NOT NULL,
      display_name TEXT NOT NULL,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from DATE NOT NULL,
      effective_to DATE,
      config_version INTEGER NOT NULL DEFAULT 1,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS finance_project_configs_identity_uidx
      ON public.finance_project_configs (project_code, company_id, config_version);
    CREATE INDEX IF NOT EXISTS finance_project_configs_effective_idx
      ON public.finance_project_configs (project_code, company_id, effective_from, effective_to)
      WHERE is_active;
  `);
  await one(`
    CREATE TABLE IF NOT EXISTS public.finance_project_payment_configs (
      id SERIAL PRIMARY KEY,
      finance_project_config_id INTEGER NOT NULL REFERENCES public.finance_project_configs(id),
      payment_method TEXT NOT NULL,
      provider_code TEXT NOT NULL,
      bank_account_id INTEGER NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'IDR',
      settlement_delay_business_days INTEGER NOT NULL DEFAULT 1,
      mdr_rate NUMERIC(12,6) NOT NULL DEFAULT 0,
      fixed_provider_fee NUMERIC(18,2) NOT NULL DEFAULT 0,
      fee_tax_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
      fee_tax_inclusive BOOLEAN NOT NULL DEFAULT FALSE,
      settlement_tolerance_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
      settlement_tolerance_rate NUMERIC(8,6) NOT NULL DEFAULT 0,
      calculation_method TEXT NOT NULL DEFAULT 'gross_less_mdr',
      rounding_method TEXT NOT NULL DEFAULT 'half_up',
      rounding_scale INTEGER NOT NULL DEFAULT 2,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from DATE NOT NULL,
      effective_to DATE,
      config_version INTEGER NOT NULL DEFAULT 1,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS finance_project_payment_configs_lookup_idx
      ON public.finance_project_payment_configs
        (finance_project_config_id, payment_method, provider_code, effective_from)
      WHERE is_active;
    CREATE UNIQUE INDEX IF NOT EXISTS finance_project_payment_configs_identity_uidx
      ON public.finance_project_payment_configs
        (finance_project_config_id, payment_method, provider_code, config_version);
  `);
  await one(`
    CREATE TABLE IF NOT EXISTS public.finance_project_tax_mappings (
      id SERIAL PRIMARY KEY,
      finance_project_config_id INTEGER NOT NULL REFERENCES public.finance_project_configs(id),
      transaction_type TEXT NOT NULL,
      tax_rule_id INTEGER NOT NULL REFERENCES public.tax_rules(id),
      payment_method TEXT,
      provider_code TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from DATE NOT NULL,
      effective_to DATE,
      config_version INTEGER NOT NULL DEFAULT 1,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS finance_project_tax_mappings_lookup_idx
      ON public.finance_project_tax_mappings
        (finance_project_config_id, transaction_type, effective_from)
      WHERE is_active;
    CREATE UNIQUE INDEX IF NOT EXISTS finance_project_tax_mappings_identity_uidx
      ON public.finance_project_tax_mappings
        (finance_project_config_id, transaction_type, tax_rule_id,
         (COALESCE(payment_method, '')), (COALESCE(provider_code, '')), config_version);
  `);
  await one(`
    CREATE TABLE IF NOT EXISTS public.finance_project_coa_mappings (
      id SERIAL PRIMARY KEY,
      finance_project_config_id INTEGER NOT NULL REFERENCES public.finance_project_configs(id),
      account_role TEXT NOT NULL,
      coa_id INTEGER NOT NULL REFERENCES public.chart_of_accounts(id),
      payment_method TEXT,
      provider_code TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      effective_from DATE NOT NULL,
      effective_to DATE,
      config_version INTEGER NOT NULL DEFAULT 1,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_by TEXT,
      updated_by TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS finance_project_coa_mappings_lookup_idx
      ON public.finance_project_coa_mappings
        (finance_project_config_id, account_role, effective_from)
      WHERE is_active;
    CREATE UNIQUE INDEX IF NOT EXISTS finance_project_coa_mappings_identity_uidx
      ON public.finance_project_coa_mappings
        (finance_project_config_id, account_role, coa_id,
         (COALESCE(payment_method, '')), (COALESCE(provider_code, '')), config_version);
  `);
  await one(`
    CREATE TABLE IF NOT EXISTS sport_center.central_finance_processing (
      id BIGSERIAL PRIMARY KEY,
      source_project TEXT NOT NULL,
      source_payment_id INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      correlation_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'posted', 'failed', 'manual_review')),
      attempts INTEGER NOT NULL DEFAULT 0,
      available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      processed_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT central_finance_processing_source_uidx
        UNIQUE (source_project, source_payment_id, event_type),
      CONSTRAINT central_finance_processing_correlation_uidx
        UNIQUE (correlation_id)
    );
    CREATE INDEX IF NOT EXISTS central_finance_processing_claim_idx
      ON sport_center.central_finance_processing (status, available_at, locked_at);
  `);
}

async function installSettlementLink() {
  await one(`
    ALTER TABLE sport_center.payment_settlement_batches
      ADD COLUMN IF NOT EXISTS canonical_bank_mutation_id INTEGER
  `);
  await assertNoViolations(
    "invalid canonical settlement references",
    `SELECT b.id, b.canonical_bank_mutation_id
       FROM sport_center.payment_settlement_batches b
       LEFT JOIN sport_center.bank_mutations m ON m.id = b.canonical_bank_mutation_id
      WHERE b.canonical_bank_mutation_id IS NOT NULL AND m.id IS NULL
      LIMIT 50`,
  );
  await one(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
         WHERE conname = 'payment_settlement_batches_canonical_bank_mutation_fk'
           AND conrelid = 'sport_center.payment_settlement_batches'::regclass
      ) THEN
        ALTER TABLE sport_center.payment_settlement_batches
          ADD CONSTRAINT payment_settlement_batches_canonical_bank_mutation_fk
          FOREIGN KEY (canonical_bank_mutation_id)
          REFERENCES sport_center.bank_mutations(id);
      END IF;
    END $$;
    ALTER TABLE sport_center.bank_mutations
      ADD COLUMN IF NOT EXISTS canonical_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS sport_center_bank_mutations_canonical_key_uidx
      ON sport_center.bank_mutations(canonical_key) WHERE canonical_key IS NOT NULL;
    CREATE UNIQUE INDEX IF NOT EXISTS payment_settlement_batches_canonical_mutation_uidx
      ON sport_center.payment_settlement_batches(canonical_bank_mutation_id)
      WHERE canonical_bank_mutation_id IS NOT NULL;
  `);
}

async function seedConfiguration() {
  const identity = await one(`
    SELECT
      (SELECT id FROM public.chart_of_accounts WHERE company_id=1 AND code='4-1017-CST' AND is_active LIMIT 1) AS revenue_id,
      (SELECT id FROM public.chart_of_accounts WHERE company_id=1 AND code='2-1020-CST' AND is_active LIMIT 1) AS tax_output_id,
      (SELECT id FROM public.tax_rules
        WHERE company_id=1 AND is_active AND direction='output' AND tax_rate=11
          AND lower(name) LIKE '%sport center%'
        ORDER BY id LIMIT 1) AS tax_rule_id,
      (SELECT COUNT(*) FROM public.chart_of_accounts WHERE company_id=1 AND code IN ('4-1017-CST','2-1020-CST') AND is_active) AS coa_count
  `);
  const row = identity.rows[0];
  if (!row?.revenue_id || !row?.tax_output_id || !row?.tax_rule_id || Number(row.coa_count) !== 2) {
    throw new Error(`CF_SC_12B_IDENTITY_BLOCKED: ${JSON.stringify(row)}`);
  }
  const project = await one(`
    INSERT INTO public.finance_project_configs
      (project_code, company_id, display_name, effective_from, config_version, created_by, updated_by)
    VALUES ('sport_center', 1, 'Sport Center Central Finance', DATE '2026-01-01', 1,
            'CF-SC-12B', 'CF-SC-12B')
    ON CONFLICT (project_code, company_id, config_version)
    DO UPDATE SET updated_at=NOW()
    RETURNING id
  `);
  const projectId = project.rows[0].id;
  await one(`
    INSERT INTO public.finance_project_payment_configs
      (finance_project_config_id, payment_method, provider_code, bank_account_id,
       currency_code, settlement_delay_business_days, mdr_rate, created_by, updated_by)
    VALUES ($1, 'QRIS', 'mandiri_direct', 2, 'IDR', 1, 0.003, 'CF-SC-12B', 'CF-SC-12B')
    ON CONFLICT (finance_project_config_id, payment_method, provider_code, config_version)
    DO UPDATE SET updated_at=NOW()
  `, [projectId]);
  await one(`
    INSERT INTO public.finance_project_tax_mappings
      (finance_project_config_id, transaction_type, tax_rule_id, effective_from, created_by, updated_by)
    VALUES ($1, 'sport_booking_payment', $2, DATE '2026-01-01', 'CF-SC-12B', 'CF-SC-12B')
    ON CONFLICT (finance_project_config_id, transaction_type, tax_rule_id,
                 (COALESCE(payment_method, '')), (COALESCE(provider_code, '')), config_version)
    DO UPDATE SET updated_at=NOW()
  `, [projectId, row.tax_rule_id]);
  for (const [role, coaId] of [
    ["RECEIVING_BANK", 75590],
    ["MDR_EXPENSE", 75594],
    ["REVENUE", row.revenue_id],
    ["TAX_OUTPUT", row.tax_output_id],
  ]) {
    await one(`
      INSERT INTO public.finance_project_coa_mappings
        (finance_project_config_id, account_role, coa_id, effective_from, created_by, updated_by)
      VALUES ($1, $2, $3, DATE '2026-01-01', 'CF-SC-12B', 'CF-SC-12B')
      ON CONFLICT (finance_project_config_id, account_role, coa_id,
                   COALESCE(payment_method, ''), COALESCE(provider_code, ''), config_version)
      DO UPDATE SET updated_at=NOW()
    `, [projectId, role, coaId]);
  }
  return { projectId: Number(projectId), taxRuleId: Number(row.tax_rule_id), revenueId: Number(row.revenue_id), taxOutputId: Number(row.tax_output_id) };
}

async function resolveProof() {
  const result = await one(`
    SELECT * FROM sport_center.resolve_shared_finance_config(
      'sport_center', 1, 'QRIS', 'mandiri_direct', CURRENT_DATE
    )
  `);
  if (result.rows.length !== 1) throw new Error(`CF_SC_12B_RESOLVER_NOT_UNIQUE: ${result.rows.length}`);
  const row = result.rows[0];
  for (const [key, expected] of [["receiving_bank_coa_id", "75590"], ["mdr_expense_coa_id", "75594"], ["currency_code", "IDR"]]) {
    if (String(row[key]) !== expected) throw new Error(`CF_SC_12B_RESOLVER_MISMATCH: ${key}=${row[key]}`);
  }
  return row;
}

await client.connect();
try {
  await one("BEGIN");
  await one("SET LOCAL lock_timeout = '10s'");
  const mode = await one("SELECT COALESCE(current_setting('app.sport_center_finance_mode', true), 'legacy') AS mode");
  if (String(mode.rows[0]?.mode).toLowerCase() !== "legacy") throw new Error("CF_SC_12B_PROD_MODE_NOT_LEGACY");
  await createFoundationTables();
  await installSettlementLink();
  const { ensureCanonicalSettlementContracts } = await import("../artifacts/api-server/dist/modules/sport-center/migration.mjs");
  await ensureCanonicalSettlementContracts();
  const config = await seedConfiguration();
  const resolved = await resolveProof();
  await one("COMMIT");
  console.log(JSON.stringify({
    migration: "CF-SC-12B",
    status: "PASS",
    generic_reconciler_used: false,
    prod_mode: "legacy",
    project_config_id: config.projectId,
    tax_rule_id: config.taxRuleId,
    revenue_coa_id: config.revenueId,
    tax_output_coa_id: config.taxOutputId,
    receiving_bank_coa_id: Number(resolved.receiving_bank_coa_id),
    mdr_expense_coa_id: Number(resolved.mdr_expense_coa_id),
    processor_runs: 0,
    payment_writes: 0,
    accounting_writes: 0,
  }, null, 2));
} catch (error) {
  await one("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end();
}
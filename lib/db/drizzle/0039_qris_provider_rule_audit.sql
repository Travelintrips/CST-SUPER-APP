-- Versioned QRIS provider/account rules for auditable production matching.
-- Existing candidate/final snapshots are untouched. Fresh databases may not
-- have the runtime QRIS tables yet, so this checked-in forward migration is a
-- guarded companion to qrisSettlementMigration.ts.
DO $migration$
BEGIN
  IF to_regclass('public.qris_provider_settlement_rules') IS NULL THEN
    RETURN;
  END IF;

  ALTER TABLE public.qris_provider_settlement_rules
    ADD COLUMN IF NOT EXISTS effective_from DATE NOT NULL DEFAULT DATE '1970-01-01',
    ADD COLUMN IF NOT EXISTS effective_until DATE,
    ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'application_default';

  ALTER TABLE public.qris_provider_settlement_rules
    DROP CONSTRAINT IF EXISTS qris_provider_settlement_rules_company_id_provider_code_key;
  DROP INDEX IF EXISTS public.uq_qris_provider_rules_company_account_provider;

  DELETE FROM public.qris_provider_settlement_rules
  WHERE id NOT IN (
    SELECT MAX(id)
    FROM public.qris_provider_settlement_rules
    GROUP BY company_id, COALESCE(bank_account_id, 0), provider_code,
             effective_from, rule_version
  );

  CREATE UNIQUE INDEX IF NOT EXISTS uq_qris_provider_rules_temporal_version
    ON public.qris_provider_settlement_rules (
      company_id,
      COALESCE(bank_account_id, 0),
      provider_code,
      effective_from,
      rule_version
    );

  ALTER TABLE public.qris_provider_settlement_rules
    DROP CONSTRAINT IF EXISTS chk_qris_provider_rules_effective_window;
  ALTER TABLE public.qris_provider_settlement_rules
    ADD CONSTRAINT chk_qris_provider_rules_effective_window
    CHECK (effective_until IS NULL OR effective_until > effective_from);

  IF to_regclass('sport_center.payment_settlement_configs') IS NULL
     OR to_regclass('public.company_bank_accounts') IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.qris_provider_settlement_rules (
    company_id,
    bank_account_id,
    provider_code,
    rule_version,
    effective_from,
    effective_until,
    source,
    settlement_delay_business_days,
    match_window_business_days,
    max_effective_deduction_rate,
    absolute_variance_tolerance,
    percentage_variance_tolerance,
    is_active
  )
  SELECT
    config.company_id,
    account.id,
    LOWER(BTRIM(config.provider_code)),
    config.rule_version,
    config.effective_from,
    config.effective_until,
    'sport_center.payment_settlement_configs',
    config.settlement_delay_business_days,
    1,
    GREATEST(
      COALESCE(config.mdr_rate, 0)
        + COALESCE(config.settlement_tolerance_rate, 0),
      0.100000
    ),
    COALESCE(config.settlement_tolerance_amount, 10000.00),
    COALESCE(config.settlement_tolerance_rate, 0.0200) * 100,
    config.is_active
  FROM sport_center.payment_settlement_configs config
  JOIN public.company_bank_accounts account
    ON account.company_id = config.company_id
   AND account.account_number::text = config.bank_account_id::text
   AND account.is_active = TRUE
  WHERE config.source = 'OWNER_APPROVED'
    AND config.rule_version IS NOT NULL
    AND BTRIM(config.rule_version) <> ''
    AND LOWER(BTRIM(config.provider_code)) IN (
      'mandiri_direct', 'paylabs', 'gpn_qris'
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.qris_provider_settlement_rules existing
      WHERE existing.company_id = config.company_id
        AND COALESCE(existing.bank_account_id, 0) = account.id
        AND existing.provider_code = LOWER(BTRIM(config.provider_code))
        AND existing.effective_from = config.effective_from
        AND existing.rule_version = config.rule_version
    );
END
$migration$;
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * CF-CP-6 DEV-only configuration and project-neutral resolver.
 *
 * Customer Portal must not use the Sport Center settlement/config tables as a
 * hidden fallback. The resolver has the same return contract as the legacy
 * shared resolver, but its owner and source mappings are public finance tables.
 */
export async function runCustomerPortalPaylabsMigration(): Promise<void> {
  const env = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
  if (env !== "development") return;

  await db.execute(sql`
    INSERT INTO finance_project_payment_configs (
      finance_project_config_id, payment_method, provider_code, bank_account_id,
      currency_code, settlement_delay_business_days, mdr_rate,
      fixed_provider_fee, fee_tax_rate, fee_tax_inclusive, is_active,
      effective_from, config_version, metadata, created_by, updated_by
    )
    SELECT 3, 'qris', 'paylabs', 17, 'IDR', 1, 0.003, 0, 0, FALSE, TRUE,
           CURRENT_DATE, 1, '{"source":"CF-CP-6","environment":"development"}'::jsonb,
           'CF-CP-6', 'CF-CP-6'
     WHERE EXISTS (
       SELECT 1 FROM finance_project_configs
        WHERE id = 3 AND project_code = 'customer_portal'
          AND company_id = 1 AND is_active = TRUE
     )
       AND EXISTS (
       SELECT 1 FROM company_bank_accounts
        WHERE id = 17 AND company_id = 1 AND is_active = TRUE
     )
       AND NOT EXISTS (
       SELECT 1 FROM finance_project_payment_configs
        WHERE finance_project_config_id = 3
          AND lower(payment_method) = 'qris'
          AND lower(provider_code) = 'paylabs'
          AND is_active = TRUE
          AND effective_from <= CURRENT_DATE
          AND (effective_to IS NULL OR CURRENT_DATE < effective_to)
     )
  `);

  await db.execute(sql`
    INSERT INTO finance_project_coa_mappings (
      finance_project_config_id, account_role, coa_id, payment_method,
      provider_code, is_active, effective_from, metadata, created_by, updated_by
    )
    SELECT 3, 'TAX_OUTPUT', ca.id, 'qris', 'paylabs', TRUE, CURRENT_DATE,
           '{"source":"CF-CP-6","canonical_code":"2-1020-CST"}'::jsonb,
           'CF-CP-6', 'CF-CP-6'
      FROM chart_of_accounts ca
     WHERE ca.company_id = 1 AND ca.code = '2-1020-CST'
       AND ca.is_active = TRUE AND ca.is_postable = TRUE
       AND NOT EXISTS (
         SELECT 1 FROM finance_project_coa_mappings cm
          WHERE cm.finance_project_config_id = 3
            AND cm.account_role = 'TAX_OUTPUT'
            AND cm.payment_method = 'qris'
            AND cm.provider_code = 'paylabs'
            AND cm.is_active = TRUE
       )
  `);

  await db.execute(sql.raw(`
    CREATE OR REPLACE FUNCTION public.resolve_customer_portal_finance_config(
      p_company_id integer,
      p_payment_method text,
      p_provider_code text,
      p_effective_date date
    )
    RETURNS TABLE (
      config_id integer,
      config_version integer,
      payment_config_id integer,
      tax_mapping_id integer,
      effective_configuration_identity text,
      tax_rule_id integer,
      tax_rate numeric,
      tax_direction text,
      bank_account_id integer,
      bank_account_number text,
      bank_name text,
      currency_code text,
      settlement_delay_business_days integer,
      mdr_rate numeric,
      fixed_provider_fee numeric,
      fee_tax_rate numeric,
      fee_tax_inclusive boolean,
      receiving_bank_coa_id integer,
      receiving_bank_coa_code text,
      receiving_bank_coa_name text,
      revenue_coa_id integer,
      revenue_coa_code text,
      revenue_coa_name text,
      tax_output_coa_id integer,
      tax_output_coa_code text,
      tax_output_coa_name text,
      mdr_expense_coa_id integer,
      mdr_expense_coa_code text,
      mdr_expense_coa_name text,
      clearing_coa_id integer,
      clearing_coa_code text,
      clearing_coa_name text
    )
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'public'
    AS $function$
    DECLARE
      v_config record;
      v_payment record;
      v_tax record;
      v_bank record;
      v_count integer;
      v_receiving record;
      v_revenue record;
      v_tax_output record;
      v_mdr record;
    BEGIN
      SELECT COUNT(*)::integer INTO v_count
        FROM public.finance_project_configs c
       WHERE c.id = 3 AND c.project_code = 'customer_portal'
         AND c.company_id = p_company_id AND c.is_active = TRUE
         AND c.effective_from <= p_effective_date
         AND (c.effective_to IS NULL OR p_effective_date < c.effective_to);
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: customer_portal company=% matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END,
          p_company_id, v_count;
      END IF;
      SELECT c.* INTO v_config FROM public.finance_project_configs c
       WHERE c.id = 3 AND c.project_code = 'customer_portal'
         AND c.company_id = p_company_id AND c.is_active = TRUE
         AND c.effective_from <= p_effective_date
         AND (c.effective_to IS NULL OR p_effective_date < c.effective_to);

      SELECT COUNT(*)::integer INTO v_count
        FROM public.finance_project_payment_configs pc
       WHERE pc.finance_project_config_id = v_config.id
         AND lower(btrim(pc.payment_method)) = lower(btrim(p_payment_method))
         AND lower(btrim(pc.provider_code)) = lower(btrim(p_provider_code))
         AND pc.is_active = TRUE AND pc.effective_from <= p_effective_date
         AND (pc.effective_to IS NULL OR p_effective_date < pc.effective_to);
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: payment=% provider=% matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END,
          p_payment_method, p_provider_code, v_count;
      END IF;
      SELECT pc.* INTO v_payment
        FROM public.finance_project_payment_configs pc
       WHERE pc.finance_project_config_id = v_config.id
         AND lower(btrim(pc.payment_method)) = lower(btrim(p_payment_method))
         AND lower(btrim(pc.provider_code)) = lower(btrim(p_provider_code))
         AND pc.is_active = TRUE AND pc.effective_from <= p_effective_date
         AND (pc.effective_to IS NULL OR p_effective_date < pc.effective_to);

      SELECT COUNT(*)::integer INTO v_count
        FROM public.finance_project_tax_mappings tm
       WHERE tm.finance_project_config_id = v_config.id
         AND tm.transaction_type = 'sales_order' AND tm.product_scope = 'goods'
         AND tm.is_active = TRUE AND tm.effective_from <= p_effective_date
         AND (tm.effective_to IS NULL OR p_effective_date < tm.effective_to)
         AND (tm.payment_method IS NULL OR lower(tm.payment_method) = lower(p_payment_method))
         AND (tm.provider_code IS NULL OR lower(tm.provider_code) = lower(p_provider_code));
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: tax mapping matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END, v_count;
      END IF;
      SELECT tm.* INTO v_tax
        FROM public.finance_project_tax_mappings tm
       WHERE tm.finance_project_config_id = v_config.id
         AND tm.transaction_type = 'sales_order' AND tm.product_scope = 'goods'
         AND tm.is_active = TRUE AND tm.effective_from <= p_effective_date
         AND (tm.effective_to IS NULL OR p_effective_date < tm.effective_to)
         AND (tm.payment_method IS NULL OR lower(tm.payment_method) = lower(p_payment_method))
         AND (tm.provider_code IS NULL OR lower(tm.provider_code) = lower(p_provider_code))
       LIMIT 1;

      SELECT COUNT(*)::integer INTO v_count FROM public.company_bank_accounts cba
       WHERE cba.id = v_payment.bank_account_id AND cba.company_id = p_company_id
         AND cba.is_active = TRUE;
      IF v_count <> 1 THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_%: bank account=% matches=%',
          CASE WHEN v_count = 0 THEN 'MISSING' ELSE 'AMBIGUOUS' END,
          v_payment.bank_account_id, v_count;
      END IF;
      SELECT cba.* INTO v_bank FROM public.company_bank_accounts cba
       WHERE cba.id = v_payment.bank_account_id AND cba.company_id = p_company_id
         AND cba.is_active = TRUE;

      IF NOT EXISTS (
        SELECT 1 FROM public.tax_rules tr WHERE tr.id = v_tax.tax_rule_id
          AND tr.company_id = p_company_id AND tr.is_active = TRUE
      ) THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_TAX_INVALID: tax_rule=%', v_tax.tax_rule_id;
      END IF;

      SELECT ca.id, ca.code, ca.name INTO v_receiving
        FROM public.finance_project_coa_mappings cm
        JOIN public.chart_of_accounts ca ON ca.id = cm.coa_id
       WHERE cm.finance_project_config_id = v_config.id
         AND cm.account_role = 'RECEIVING_BANK' AND cm.is_active = TRUE
         AND (cm.payment_method IS NULL OR lower(cm.payment_method) = lower(p_payment_method))
         AND (cm.provider_code IS NULL OR lower(cm.provider_code) = lower(p_provider_code))
         AND ca.company_id = p_company_id AND ca.is_active = TRUE AND ca.is_postable = TRUE
       ORDER BY (cm.payment_method IS NOT NULL)::integer + (cm.provider_code IS NOT NULL)::integer DESC
       LIMIT 1;
      SELECT ca.id, ca.code, ca.name INTO v_revenue
        FROM public.finance_project_coa_mappings cm
        JOIN public.chart_of_accounts ca ON ca.id = cm.coa_id
       WHERE cm.finance_project_config_id = v_config.id AND cm.account_role = 'REVENUE'
         AND cm.product_scope = 'goods' AND cm.is_active = TRUE
         AND ca.company_id = p_company_id AND ca.is_active = TRUE AND ca.is_postable = TRUE
       LIMIT 1;
      SELECT ca.id, ca.code, ca.name INTO v_tax_output
        FROM public.finance_project_coa_mappings cm
        JOIN public.chart_of_accounts ca ON ca.id = cm.coa_id
       WHERE cm.finance_project_config_id = v_config.id AND cm.account_role = 'TAX_OUTPUT'
         AND cm.is_active = TRUE AND ca.company_id = p_company_id
         AND ca.is_active = TRUE AND ca.is_postable = TRUE
       LIMIT 1;
      SELECT ca.id, ca.code, ca.name INTO v_mdr
        FROM public.finance_project_coa_mappings cm
        JOIN public.chart_of_accounts ca ON ca.id = cm.coa_id
       WHERE cm.finance_project_config_id = v_config.id AND cm.account_role = 'MDR_EXPENSE'
         AND cm.is_active = TRUE AND ca.company_id = p_company_id
         AND ca.is_active = TRUE AND ca.is_postable = TRUE
       LIMIT 1;
      IF v_receiving.id IS NULL OR v_revenue.id IS NULL OR v_tax_output.id IS NULL OR v_mdr.id IS NULL THEN
        RAISE EXCEPTION 'BLOCKED_CONFIG_MISSING: Customer Portal COA mapping';
      END IF;

      RETURN QUERY
      SELECT v_config.id::integer, v_config.config_version::integer,
        v_payment.id::integer, v_tax.id::integer,
        'customer_portal:' || v_config.id || ':' || v_payment.id || ':' || v_tax.id,
        tr.id::integer, tr.tax_rate, tr.direction, v_bank.id::integer, v_bank.account_number,
        v_bank.bank_name, v_payment.currency_code, v_payment.settlement_delay_business_days,
        v_payment.mdr_rate, v_payment.fixed_provider_fee, v_payment.fee_tax_rate,
        v_payment.fee_tax_inclusive,
        v_receiving.id::integer, v_receiving.code, v_receiving.name,
        v_revenue.id::integer, v_revenue.code, v_revenue.name,
        v_tax_output.id::integer, v_tax_output.code, v_tax_output.name,
        v_mdr.id::integer, v_mdr.code, v_mdr.name,
        NULL::integer, NULL::text, NULL::text
        FROM public.tax_rules tr WHERE tr.id = v_tax.tax_rule_id;
    END;
    $function$;
  `));
}
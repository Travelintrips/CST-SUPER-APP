import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type FinanceAccountRole =
  | "RECEIVING_BANK"
  | "REVENUE"
  | "TAX_OUTPUT"
  | "MDR_EXPENSE"
  | "CLEARING";

export interface ResolveFinanceProjectConfigInput {
  projectCode: string;
  companyId: number;
  paymentMethod: string;
  providerCode: string;
  effectiveDate: string;
}

export interface FinanceProjectConfig {
  configId: number;
  configVersion: number;
  paymentConfigId: number;
  taxMappingId: number;
  effectiveConfigurationIdentity: string;
  taxRuleId: number;
  taxRate: number;
  taxDirection: string;
  bankAccountId: number;
  bankAccountNumber: string;
  bankName: string | null;
  currency: string;
  settlementDelayBusinessDays: number;
  mdrRate: number;
  fixedProviderFee: number;
  feeTaxRate: number;
  feeTaxInclusive: boolean;
  accountIds: Partial<Record<FinanceAccountRole, number>>;
  accountCodes: Partial<Record<FinanceAccountRole, string>>;
  accountNames: Partial<Record<FinanceAccountRole, string>>;
}

type ResolverRow = Record<string, unknown>;

function number(value: unknown, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`SHARED_CONFIG_INVALID: ${field}`);
  return parsed;
}

/**
 * The database owner and the API use the same fail-closed SQL resolver.
 * The resolver never falls back to the Sport Center legacy tables.
 */
export async function resolveFinanceProjectConfig(
  input: ResolveFinanceProjectConfigInput,
): Promise<FinanceProjectConfig> {
  if (!Number.isInteger(input.companyId) || input.companyId <= 0) {
    throw new Error("SHARED_CONFIG_COMPANY_INVALID");
  }
  let result: { rows: unknown[] };
  try {
    result = await db.execute(sql`
      SELECT *
      FROM sport_center.resolve_shared_finance_config(
        ${input.projectCode},
        ${input.companyId},
        ${input.paymentMethod},
        ${input.providerCode},
        ${input.effectiveDate}::date
      )
    `);
  } catch (error) {
    const cause = (error as { cause?: { message?: unknown } }).cause?.message;
    throw new Error(String(cause ?? (error instanceof Error ? error.message : error)));
  }
  const row = result.rows[0] as ResolverRow | undefined;
  if (!row) throw new Error("BLOCKED_CONFIG_MISSING");

  const roles = ["RECEIVING_BANK", "REVENUE", "TAX_OUTPUT", "MDR_EXPENSE", "CLEARING"] as const;
  const accountIds: FinanceProjectConfig["accountIds"] = {};
  const accountCodes: FinanceProjectConfig["accountCodes"] = {};
  const accountNames: FinanceProjectConfig["accountNames"] = {};
  for (const role of roles) {
    const id = row[`${role.toLowerCase()}_coa_id`];
    if (id != null) accountIds[role] = number(id, `${role}.coa_id`);
    const code = row[`${role.toLowerCase()}_coa_code`];
    if (code != null) accountCodes[role] = String(code);
    const name = row[`${role.toLowerCase()}_coa_name`];
    if (name != null) accountNames[role] = String(name);
  }

  return {
    configId: number(row.config_id, "config_id"),
    configVersion: number(row.config_version, "config_version"),
    paymentConfigId: number(row.payment_config_id, "payment_config_id"),
    taxMappingId: number(row.tax_mapping_id, "tax_mapping_id"),
    effectiveConfigurationIdentity: String(row.effective_configuration_identity),
    taxRuleId: number(row.tax_rule_id, "tax_rule_id"),
    taxRate: number(row.tax_rate, "tax_rate"),
    taxDirection: String(row.tax_direction),
    bankAccountId: number(row.bank_account_id, "bank_account_id"),
    bankAccountNumber: String(row.bank_account_number),
    bankName: row.bank_name == null ? null : String(row.bank_name),
    currency: String(row.currency_code),
    settlementDelayBusinessDays: number(row.settlement_delay_business_days, "settlement_delay_business_days"),
    mdrRate: number(row.mdr_rate, "mdr_rate"),
    fixedProviderFee: number(row.fixed_provider_fee, "fixed_provider_fee"),
    feeTaxRate: number(row.fee_tax_rate, "fee_tax_rate"),
    feeTaxInclusive: row.fee_tax_inclusive === true,
    accountIds,
    accountCodes,
    accountNames,
  };
}
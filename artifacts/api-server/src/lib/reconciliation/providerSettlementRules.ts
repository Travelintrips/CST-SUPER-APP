import { addBusinessDays, jakartaDateFromTimestamp } from "./businessCalendar.js";

export type QrisProviderCode = "mandiri_direct" | "paylabs" | "unknown";

export interface QrisProviderRule {
  providerCode: QrisProviderCode;
  bankAccountId?: number | null;
  ruleVersion?: string | null;
  settlementDelayBusinessDays: number;
  matchWindowBusinessDays: number;
  maxEffectiveDeductionRate: number;
  absoluteVarianceTolerance?: number;
  percentageVarianceTolerance?: number;
}

export const DEFAULT_QRIS_PROVIDER_RULES: Record<QrisProviderCode, QrisProviderRule> = {
  mandiri_direct: {
    providerCode: "mandiri_direct",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 5000,
    percentageVarianceTolerance: 1,
  },
  paylabs: {
    providerCode: "paylabs",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 5000,
    percentageVarianceTolerance: 1,
  },
  unknown: {
    providerCode: "unknown",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 5000,
    percentageVarianceTolerance: 1,
  },
};

const PROVIDER_ALIASES: Array<[QrisProviderCode, string[]]> = [
  ["mandiri_direct", ["mandiri_direct", "mandiri direct", "mandiri qris", "bank mandiri", "mandiri"]],
  ["paylabs", ["paylabs", "paylabs qris", "paylabs settlement"]],
];

/**
 * Provider identity must come from an explicit provider field or a provider
 * label in bank evidence. Payment method=QRIS alone is intentionally ignored.
 */
export function normalizeQrisProvider(value: string | null | undefined): QrisProviderCode {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ");
  if (!normalized) return "unknown";
  for (const [provider, aliases] of PROVIDER_ALIASES) {
    if (aliases.some((alias) => normalized === alias || normalized.includes(alias))) return provider;
  }
  return "unknown";
}

export function classifyProviderFromBankEvidence(
  providerName: string | null | undefined,
  description: string | null | undefined,
): QrisProviderCode {
  const explicit = normalizeQrisProvider(providerName);
  if (explicit !== "unknown") return explicit;
  return normalizeQrisProvider(description);
}

export function expectedQrisSettlementDate(
  paidAt: string | Date,
  provider: QrisProviderCode,
  holidays: Iterable<string> = [],
  ruleOverrides: Partial<QrisProviderRule> = {},
): string {
  const paymentDate = jakartaDateFromTimestamp(paidAt);
  if (!paymentDate) return "";
  const rule = {
    ...DEFAULT_QRIS_PROVIDER_RULES[provider],
    ...ruleOverrides,
  };
  return addBusinessDays(paymentDate, rule.settlementDelayBusinessDays, holidays);
}

export function providerRulesFromRows(
  rows: Array<Partial<QrisProviderRule> & {
    provider_code?: string;
    rule_version?: string | null;
    settlement_delay_business_days?: number;
    match_window_business_days?: number;
    max_effective_deduction_rate?: number;
    absolute_variance_tolerance?: number;
    percentage_variance_tolerance?: number;
  }>,
): Record<QrisProviderCode, QrisProviderRule> {
  const result = { ...DEFAULT_QRIS_PROVIDER_RULES };
  for (const row of rows) {
    if (row.bankAccountId != null || (row as { bank_account_id?: number | null }).bank_account_id != null) {
      continue;
    }
    const provider = normalizeQrisProvider(row.providerCode ?? row.provider_code);
    if (provider === "unknown") continue;
    result[provider] = {
      ...result[provider],
      providerCode: provider,
      ruleVersion: row.ruleVersion ?? row.rule_version ?? result[provider].ruleVersion ?? "legacy-v1",
      settlementDelayBusinessDays: Number(row.settlementDelayBusinessDays
        ?? row.settlement_delay_business_days
        ?? result[provider].settlementDelayBusinessDays),
      matchWindowBusinessDays: Number(row.matchWindowBusinessDays
        ?? row.match_window_business_days
        ?? result[provider].matchWindowBusinessDays),
      maxEffectiveDeductionRate: Number(row.maxEffectiveDeductionRate
        ?? row.max_effective_deduction_rate
        ?? result[provider].maxEffectiveDeductionRate),
      absoluteVarianceTolerance: Number(row.absoluteVarianceTolerance
        ?? row.absolute_variance_tolerance
        ?? result[provider].absoluteVarianceTolerance
        ?? 0),
      percentageVarianceTolerance: Number(row.percentageVarianceTolerance
        ?? row.percentage_variance_tolerance
        ?? result[provider].percentageVarianceTolerance
        ?? 0),
    };
  }
  return result;
}

export function providerRulesByBankAccountFromRows(
  rows: Array<Partial<QrisProviderRule> & {
    provider_code?: string;
    bank_account_id?: number | null;
    rule_version?: string | null;
    settlement_delay_business_days?: number;
    match_window_business_days?: number;
    max_effective_deduction_rate?: number;
    absolute_variance_tolerance?: number;
    percentage_variance_tolerance?: number;
  }>,
): Record<string, Record<QrisProviderCode, QrisProviderRule>> {
  const result: Record<string, Record<QrisProviderCode, QrisProviderRule>> = {};
  for (const row of rows) {
    const accountId = row.bankAccountId ?? row.bank_account_id;
    if (accountId == null) continue;
    const provider = normalizeQrisProvider(row.providerCode ?? row.provider_code);
    if (provider === "unknown") continue;
    const accountRules = result[String(accountId)] ?? { ...DEFAULT_QRIS_PROVIDER_RULES };
    accountRules[provider] = {
      ...accountRules[provider],
      providerCode: provider,
      bankAccountId: Number(accountId),
      ruleVersion: row.ruleVersion ?? row.rule_version ?? "legacy-v1",
      settlementDelayBusinessDays: Number(row.settlementDelayBusinessDays
        ?? row.settlement_delay_business_days
        ?? accountRules[provider].settlementDelayBusinessDays),
      matchWindowBusinessDays: Number(row.matchWindowBusinessDays
        ?? row.match_window_business_days
        ?? accountRules[provider].matchWindowBusinessDays),
      maxEffectiveDeductionRate: Number(row.maxEffectiveDeductionRate
        ?? row.max_effective_deduction_rate
        ?? accountRules[provider].maxEffectiveDeductionRate),
      absoluteVarianceTolerance: Number(row.absoluteVarianceTolerance
        ?? row.absolute_variance_tolerance
        ?? accountRules[provider].absoluteVarianceTolerance
        ?? 0),
      percentageVarianceTolerance: Number(row.percentageVarianceTolerance
        ?? row.percentage_variance_tolerance
        ?? accountRules[provider].percentageVarianceTolerance
        ?? 0),
    };
    result[String(accountId)] = accountRules;
  }
  return result;
}
import { addCalendarDays, addBusinessDays, jakartaDateFromTimestamp } from "./businessCalendar.js";

export type QrisProviderCode = "mandiri_direct" | "paylabs" | "gpn_qris" | "unknown";

export interface QrisProviderRule {
  providerCode: QrisProviderCode;
  bankAccountId?: number | null;
  ruleVersion?: string | null;
  effectiveFrom?: string | null;
  effectiveUntil?: string | null;
  resolutionError?: "AMBIGUOUS_EFFECTIVE_WINDOW";
  settlementDelayBusinessDays: number;
  matchWindowBusinessDays: number;
  maxEffectiveDeductionRate: number;
  absoluteVarianceTolerance?: number;
  percentageVarianceTolerance?: number;
}

export type QrisProviderRuleCatalog =
  Partial<Record<QrisProviderCode, QrisProviderRule[]>>;

export type QrisAccountProviderRuleCatalog =
  Record<string, Partial<Record<QrisProviderCode, QrisProviderRule[]>>>;

export const DEFAULT_QRIS_PROVIDER_RULES: Record<QrisProviderCode, QrisProviderRule> = {
  mandiri_direct: {
    providerCode: "mandiri_direct",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 10000,
    percentageVarianceTolerance: 2,
  },
  paylabs: {
    providerCode: "paylabs",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 10000,
    percentageVarianceTolerance: 2,
  },
  // GPN (Gerbang Pembayaran Nasional) is Indonesia's national QRIS switching
  // network.  BCA and other banks label their QRIS settlements with labels such
  // as "QRTRAVELI", "QRPAY", "QRGPN", etc.  These are routed through GPN and
  // settle T+1 like direct settlements.
  gpn_qris: {
    providerCode: "gpn_qris",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 10000,
    percentageVarianceTolerance: 2,
  },
  unknown: {
    providerCode: "unknown",
    ruleVersion: "default-v1",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
    absoluteVarianceTolerance: 10000,
    percentageVarianceTolerance: 2,
  },
};

const PROVIDER_ALIASES: Array<[QrisProviderCode, string[]]> = [
  ["mandiri_direct", ["mandiri_direct", "mandiri direct", "mandiri qris", "bank mandiri", "mandiri"]],
  ["paylabs", ["paylabs", "paylabs qris", "paylabs settlement"]],
  // BCA and other banks print GPN/national-switch QRIS settlements using codes
  // like "QRTRAVELI", "QRPAY", "QRGPN".  The regex /qr[a-z0-9]{4,}/ in
  // isQrisSettlementDescription() already flags these rows as QRIS; here we
  // assign them the gpn_qris provider code so the engine can match them.
  ["gpn_qris", [
    "qrtraveli", "qr traveli", "qrpay", "qr pay",
    "qrgpn", "qr gpn", "gpn qris", "gpn",
    "qrnusantara", "qr nusantara",
    "qris gpn", "qris national",
  ]],
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

/**
 * Resolve a provider from the same evidence hierarchy used during candidate
 * generation. A persisted literal such as "unknown" is not evidence and must
 * not mask a provider encoded in the settlement reference or description.
 */
export function resolveQrisProviderFromEvidence(input: {
  providerName?: string | null;
  providerOrderId?: string | null;
  settlementReference?: string | null;
  providerBatchReference?: string | null;
  providerTransactionReference?: string | null;
  description?: string | null;
}): QrisProviderCode {
  const explicit = normalizeQrisProvider(input.providerName);
  if (explicit !== "unknown") return explicit;

  for (const reference of [
    input.providerOrderId,
    input.settlementReference,
    input.providerBatchReference,
    input.providerTransactionReference,
  ]) {
    const provider = normalizeQrisProvider(reference);
    if (provider !== "unknown") return provider;
  }

  return normalizeQrisProvider(input.description);
}

/**
 * Provider identity is required for an automatic reconciliation. The only
 * intentional cross-label mapping is Mandiri's payment-side provider label
 * settling through the GPN label used by some bank statements.
 */
export function areQrisProvidersCompatible(
  paymentProvider: string | null | undefined,
  mutationProvider: string | null | undefined,
): boolean {
  const payment = normalizeQrisProvider(paymentProvider);
  const mutation = normalizeQrisProvider(mutationProvider);
  if (payment === "unknown" || mutation === "unknown") return false;
  return payment === mutation
    || (payment === "mandiri_direct" && mutation === "gpn_qris");
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
  // QRIS settles on the next calendar day. Weekends and holidays do not
  // postpone QRIS settlement; keep the legacy holidays argument for API
  // compatibility with callers that also calculate transfer dates.
  void holidays;
  return addCalendarDays(paymentDate, Math.max(0, Math.trunc(rule.settlementDelayBusinessDays)));
}

type QrisProviderRuleRow = Partial<QrisProviderRule> & {
  provider_code?: string;
  bank_account_id?: number | null;
  rule_version?: string | null;
  effective_from?: string | Date | null;
  effective_until?: string | Date | null;
  settlement_delay_business_days?: number;
  match_window_business_days?: number;
  max_effective_deduction_rate?: number;
  absolute_variance_tolerance?: number;
  percentage_variance_tolerance?: number;
};

function dateOnly(value: string | Date | null | undefined): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  const result = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(result) ? result : null;
}

function ruleFromRow(row: QrisProviderRuleRow): QrisProviderRule | null {
  const provider = normalizeQrisProvider(row.providerCode ?? row.provider_code);
  if (provider === "unknown") return null;
  const baseRule = DEFAULT_QRIS_PROVIDER_RULES[provider];
  const accountId = row.bankAccountId ?? row.bank_account_id;
  return {
    ...baseRule,
    providerCode: provider,
    bankAccountId: accountId == null ? null : Number(accountId),
    ruleVersion: row.ruleVersion ?? row.rule_version ?? baseRule.ruleVersion ?? "legacy-v1",
    effectiveFrom: dateOnly(row.effectiveFrom ?? row.effective_from),
    effectiveUntil: dateOnly(row.effectiveUntil ?? row.effective_until),
    settlementDelayBusinessDays: Number(row.settlementDelayBusinessDays
      ?? row.settlement_delay_business_days
      ?? baseRule.settlementDelayBusinessDays),
    matchWindowBusinessDays: Number(row.matchWindowBusinessDays
      ?? row.match_window_business_days
      ?? baseRule.matchWindowBusinessDays),
    maxEffectiveDeductionRate: Number(row.maxEffectiveDeductionRate
      ?? row.max_effective_deduction_rate
      ?? baseRule.maxEffectiveDeductionRate),
    absoluteVarianceTolerance: Number(row.absoluteVarianceTolerance
      ?? row.absolute_variance_tolerance
      ?? baseRule.absoluteVarianceTolerance
      ?? 0),
    percentageVarianceTolerance: Number(row.percentageVarianceTolerance
      ?? row.percentage_variance_tolerance
      ?? baseRule.percentageVarianceTolerance
      ?? 0),
  };
}

function isEffectiveOn(rule: QrisProviderRule, effectiveDate: string): boolean {
  const date = dateOnly(effectiveDate);
  if (!date) return false;
  return (!rule.effectiveFrom || rule.effectiveFrom <= date)
    && (!rule.effectiveUntil || date < rule.effectiveUntil);
}

function latestEffectiveRule(
  rules: readonly QrisProviderRule[] | undefined,
  effectiveDate: string,
): QrisProviderRule | undefined {
  const matches = (rules ?? []).filter((rule) => isEffectiveOn(rule, effectiveDate));
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    return {
      ...matches[0],
      ruleVersion: "AMBIGUOUS_EFFECTIVE_WINDOW",
      resolutionError: "AMBIGUOUS_EFFECTIVE_WINDOW",
    };
  }
  return matches[0];
}

export function providerRuleCatalogFromRows(
  rows: QrisProviderRuleRow[],
): QrisProviderRuleCatalog {
  const result: QrisProviderRuleCatalog = {};
  for (const row of rows) {
    if (row.bankAccountId != null || row.bank_account_id != null) continue;
    const rule = ruleFromRow(row);
    if (!rule) continue;
    (result[rule.providerCode] ??= []).push(rule);
  }
  return result;
}

export function accountProviderRuleCatalogFromRows(
  rows: QrisProviderRuleRow[],
): QrisAccountProviderRuleCatalog {
  const result: QrisAccountProviderRuleCatalog = {};
  for (const row of rows) {
    const accountId = row.bankAccountId ?? row.bank_account_id;
    if (accountId == null) continue;
    const rule = ruleFromRow(row);
    if (!rule) continue;
    const accountRules = result[String(accountId)] ?? {};
    (accountRules[rule.providerCode] ??= []).push(rule);
    result[String(accountId)] = accountRules;
  }
  return result;
}

export function providerRulesForDate(
  catalog: QrisProviderRuleCatalog | undefined,
  effectiveDate: string,
  options: { includeDefaults?: boolean } = {},
): Partial<Record<QrisProviderCode, QrisProviderRule>> {
  const result: Partial<Record<QrisProviderCode, QrisProviderRule>> =
    options.includeDefaults === false ? {} : { ...DEFAULT_QRIS_PROVIDER_RULES };
  for (const provider of Object.keys(catalog ?? {}) as QrisProviderCode[]) {
    const rule = latestEffectiveRule(catalog?.[provider], effectiveDate);
    if (rule) result[provider] = rule;
  }
  return result;
}

export function accountProviderRulesForDate(
  catalog: QrisAccountProviderRuleCatalog | undefined,
  effectiveDate: string,
): Record<string, Partial<Record<QrisProviderCode, QrisProviderRule>>> {
  const result: Record<string, Partial<Record<QrisProviderCode, QrisProviderRule>>> = {};
  for (const [accountId, providerCatalog] of Object.entries(catalog ?? {})) {
    const accountRules: Partial<Record<QrisProviderCode, QrisProviderRule>> = {};
    for (const provider of Object.keys(providerCatalog) as QrisProviderCode[]) {
      const rule = latestEffectiveRule(providerCatalog[provider], effectiveDate);
      if (rule) accountRules[provider] = rule;
    }
    if (Object.keys(accountRules).length) result[accountId] = accountRules;
  }
  return result;
}

export function providerRulesFromRows(
  rows: QrisProviderRuleRow[],
  options: { includeDefaults?: boolean } = {},
): Partial<Record<QrisProviderCode, QrisProviderRule>> {
  const result: Partial<Record<QrisProviderCode, QrisProviderRule>> =
    options.includeDefaults === false ? {} : { ...DEFAULT_QRIS_PROVIDER_RULES };
  for (const row of rows) {
    if (row.bankAccountId != null || row.bank_account_id != null) {
      continue;
    }
    const rule = ruleFromRow(row);
    if (rule) result[rule.providerCode] = rule;
  }
  return result;
}

export function providerRulesByBankAccountFromRows(
  rows: QrisProviderRuleRow[],
): Record<string, Record<QrisProviderCode, QrisProviderRule>> {
  const result: Record<string, Record<QrisProviderCode, QrisProviderRule>> = {};
  for (const row of rows) {
    const accountId = row.bankAccountId ?? row.bank_account_id;
    if (accountId == null) continue;
    const rule = ruleFromRow(row);
    if (!rule) continue;
    const provider = rule.providerCode;
    // Keep this map limited to explicit account configuration. Global
    // defaults are resolved by the caller after account-specific rules have
    // had a chance to select a compatible payment-side provider.
    const accountRules = result[String(accountId)] ?? {};
    accountRules[provider] = {
      ...rule,
      bankAccountId: Number(accountId),
    };
    result[String(accountId)] = accountRules;
  }
  return result;
}
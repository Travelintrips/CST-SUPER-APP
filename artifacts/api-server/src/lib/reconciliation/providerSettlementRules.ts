import { addBusinessDays, jakartaDateFromTimestamp } from "./businessCalendar.js";

export type QrisProviderCode = "mandiri_direct" | "paylabs" | "unknown";

export interface QrisProviderRule {
  providerCode: QrisProviderCode;
  settlementDelayBusinessDays: number;
  matchWindowBusinessDays: number;
  maxEffectiveDeductionRate: number;
}

export const DEFAULT_QRIS_PROVIDER_RULES: Record<QrisProviderCode, QrisProviderRule> = {
  mandiri_direct: {
    providerCode: "mandiri_direct",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
  },
  paylabs: {
    providerCode: "paylabs",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
  },
  unknown: {
    providerCode: "unknown",
    settlementDelayBusinessDays: 1,
    matchWindowBusinessDays: 1,
    maxEffectiveDeductionRate: 0.1,
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
  rows: Array<Partial<QrisProviderRule> & { provider_code?: string }>,
): Record<QrisProviderCode, QrisProviderRule> {
  const result = { ...DEFAULT_QRIS_PROVIDER_RULES };
  for (const row of rows) {
    const provider = normalizeQrisProvider(row.providerCode ?? row.provider_code);
    if (provider === "unknown") continue;
    result[provider] = {
      ...result[provider],
      providerCode: provider,
      settlementDelayBusinessDays: Number(row.settlementDelayBusinessDays ?? result[provider].settlementDelayBusinessDays),
      matchWindowBusinessDays: Number(row.matchWindowBusinessDays ?? result[provider].matchWindowBusinessDays),
      maxEffectiveDeductionRate: Number(row.maxEffectiveDeductionRate ?? result[provider].maxEffectiveDeductionRate),
    };
  }
  return result;
}
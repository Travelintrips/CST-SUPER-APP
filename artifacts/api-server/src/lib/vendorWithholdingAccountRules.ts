export type VendorWithholdingAccountRule = {
  key: string;
  codePrefixes: string[];
  namePattern: RegExp;
};

const ACCOUNT_RULES: Record<string, VendorWithholdingAccountRule> = {
  pph_21: {
    key: "pph_21",
    codePrefixes: ["2-1092-"],
    namePattern: /hutang\s+pph.*21/i,
  },
  pph_22: {
    key: "pph_22",
    codePrefixes: ["2-1093-"],
    namePattern: /hutang\s+pph.*22/i,
  },
  pph_23: {
    key: "pph_23",
    // 2-1032 is retained only as a legacy fallback. New company-scoped
    // accounts use 2-1094.
    codePrefixes: ["2-1094-", "2-1032-"],
    namePattern: /hutang\s+pph.*23/i,
  },
  pph_25: {
    key: "pph_25",
    codePrefixes: ["2-1095-"],
    namePattern: /hutang\s+pph.*25/i,
  },
  pph_26: {
    key: "pph_26",
    codePrefixes: ["2-1096-"],
    namePattern: /hutang\s+pph.*26/i,
  },
  pph_29: {
    key: "pph_29",
    codePrefixes: ["2-1097-"],
    namePattern: /hutang\s+pph.*29/i,
  },
  pph_4_2: {
    key: "pph_4_2",
    codePrefixes: ["2-1098-"],
    namePattern: /hutang\s+pph.*4\s*ayat\s*2/i,
  },
  pph_15: {
    key: "pph_15",
    codePrefixes: ["2-1102-"],
    namePattern: /hutang\s+pph.*15/i,
  },
};

export function normalizeWithholdingTaxType(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Recognize the explicit PPh type printed by OCR without guessing from the
 * invoice amount or the tax rate. Unknown/ambiguous text stays unresolved.
 */
export function getVendorWithholdingAccountRule(
  value: unknown,
): VendorWithholdingAccountRule | null {
  const normalized = normalizeWithholdingTaxType(value);
  if (!normalized) return null;

  const pphFinalPasal4Ayat2 =
    /\bpph\s*(?:final\s+)?(?:pasal\s*)?4\s*(?:\(\s*2\s*\)|ayat\s+2)(?!\d)/.test(normalized);
  if (pphFinalPasal4Ayat2) return ACCOUNT_RULES.pph_4_2;

  const pphNumber = normalized.match(
    /\bpph\s*(?:final\s+)?(?:pasal\s*)?(15|21|22|23|25|26|29)\b/,
  )?.[1];
  return pphNumber ? ACCOUNT_RULES[`pph_${pphNumber}`] ?? null : null;
}
export interface WithholdingRateHint {
  component: string;
  type: string;
  rate: number;
}

export interface WithholdingCalculationResult {
  components: Record<string, unknown>[];
  withholding: Record<string, unknown>;
  totals: Record<string, unknown>;
  flags: string[];
  vendorPolicyApplied?: string | null;
}

const ANGKASA_PURA_POLICY = {
  name: "PT Angkasa Pura Indonesia",
  ppnRate: 11,
  components: {
    concession: { type: "PPh 15", rate: 15 },
    electricity: { type: "PPh 4(2)", rate: 10 },
    water: { type: "PPh 4(2)", rate: 10 },
  } as Record<string, { type: string; rate: number }>,
} as const;

function resolveVendorPolicy(vendorName: string): typeof ANGKASA_PURA_POLICY | null {
  const normalized = vendorName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  if (
    normalized.includes("angkasa pura indonesia") ||
    normalized.includes("angkasa pura i") ||
    normalized.includes("pt angkasa pura")
  ) {
    return ANGKASA_PURA_POLICY;
  }
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

function asText(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function componentKeyFromLabel(component: Record<string, unknown>): string {
  const key = String(component.component ?? "").toLowerCase();
  const label = String(component.label ?? "").toLowerCase();
  if (key === "concession" || /konsesi|concession/.test(label)) return "concession";
  if (key === "electricity" || /listrik|electricity/.test(label)) return "electricity";
  if (key === "water" || /air|water/.test(label)) return "water";
  return key || "other";
}

function parseRate(value: string): number | null {
  const rate = Number(value.replace(",", "."));
  return Number.isFinite(rate) && rate > 0 && rate <= 100 ? rate : null;
}

function findTaxType(segment: string): string | null {
  if (/\bP\s*P\s*H\s*(?:PASAL\s*)?23\b/i.test(segment)) return "PPh 23";
  if (/\bP\s*P\s*H\s*(?:PASAL\s*)?22\b/i.test(segment)) return "PPh 22";
  if (/\bP\s*P\s*H\s*(?:PASAL\s*)?21\b/i.test(segment)) return "PPh 21";
  if (/\bP\s*P\s*H\s*(?:PASAL\s*)?26\b/i.test(segment)) return "PPh 26";
  if (/\bP\s*P\s*H\s*(?:PASAL\s*)?15\b/i.test(segment)) return "PPh 15";
  if (/\bP\s*P\s*H\s*(?:PASAL\s*)?4\s+AYAT\s*2\b/i.test(segment)) return "PPh 4(2)";
  return null;
}

/**
 * Finds component-level PPh evidence in the PDF text layer. This is a
 * deterministic fallback for invoices whose visual table contains the PPh
 * phrase in the description but the model omits it from the structured row.
 */
export function extractWithholdingRateHints(sourceText: string): WithholdingRateHint[] {
  const normalized = sourceText.replace(/\u00a0/g, " ").replace(/\s+/g, " ");
  const anchors: Array<{ component: string; pattern: RegExp }> = [
    { component: "concession", pattern: /pendapatan\s+konsesi|konsesi\s*\/\s*revenue\s+sharing/i },
    { component: "electricity", pattern: /pemakaian\s+listrik|listrik\s+pasca\s+bayar/i },
    { component: "water", pattern: /pemakaian\s+air/i },
  ];
  const found: WithholdingRateHint[] = [];

  for (const anchor of anchors) {
    const match = anchor.pattern.exec(normalized);
    if (!match || match.index == null) continue;
    const nextAnchorIndex = anchors
      .filter((candidate) => candidate.component !== anchor.component)
      .map((candidate) => candidate.pattern.exec(normalized.slice(match.index + match[0].length))?.index)
      .filter((index): index is number => index != null)
      .map((index) => index + match.index! + match[0].length)
      .sort((a, b) => a - b)[0];
    const segment = normalized.slice(match.index, nextAnchorIndex ?? match.index + 280);
    const type = findTaxType(segment);
    const rateMatch = /(?:tarif|rate)\s*[:=]?\s*([0-9]+(?:[.,][0-9]+)?)\s*%/i.exec(segment);
    const rate = rateMatch ? parseRate(rateMatch[1]) : null;
    if (type && rate != null) found.push({ component: anchor.component, type, rate });
  }

  return found;
}

/**
 * Calculates withholding only from an explicit tax base and printed/modelled
 * rate. It never uses VAT as a withholding base and never derives a payable
 * amount when the gross amount is absent.
 */
export function applyWithholdingCalculations(
  components: Record<string, unknown>[],
  withholding: Record<string, unknown>,
  totals: Record<string, unknown>,
  sourceText = "",
  vendorName = "",
): WithholdingCalculationResult {
  const hints = extractWithholdingRateHints(sourceText);
  const vendorPolicy = resolveVendorPolicy(vendorName);
  const flags: string[] = [];
  if (vendorPolicy) {
    flags.push(
      `POLICY_APPLIED: ${vendorPolicy.name}; PPN ${vendorPolicy.ppnRate}%; ` +
      "Konsesi PPh 15% dan Listrik/Air PPh 4(2) 10% dihitung dari DPP.",
    );
  }

  const normalizedComponents: Record<string, unknown>[] = components.map((component): Record<string, unknown> => {
    const key = componentKeyFromLabel(component);
    const hint = hints.find((candidate) => candidate.component === key);
    const dpp = asNumber(component.dpp);
    const policyComponent = vendorPolicy?.components[key];
    const policyPpn = vendorPolicy && dpp != null && dpp >= 0
      ? Math.round((dpp * vendorPolicy.ppnRate) / 100)
      : null;
    const ppn = policyPpn ?? asNumber(component.ppn);
    const gross = vendorPolicy && dpp != null && ppn != null
      ? dpp + ppn
      : asNumber(component.gross);
    const existingRate = asNumber(component.withholding_tax_rate);
    const rate = policyComponent?.rate
      ?? (existingRate != null && existingRate > 0 ? existingRate : hint?.rate ?? null);
    const type = policyComponent?.type
      ?? asText(component.withholding_tax_type)
      ?? hint?.type
      ?? null;
    let amount = asNumber(component.withholding_tax_amount);
    let payable = asNumber(component.payable_amount);
    let calculated = false;

    if (rate != null && dpp != null && dpp > 0 && gross != null && gross >= 0) {
      const computedAmount = Math.round((dpp * rate) / 100);
      if (amount == null || amount <= 0 || hint != null) {
        amount = computedAmount;
        calculated = true;
      }
      if (payable == null || calculated) {
        const computedPayable = gross - amount;
        payable = computedPayable >= 0 ? computedPayable : null;
      }
    }

    return {
      ...component,
      ppn,
      gross,
      withholding_tax_type: type,
      withholding_tax_rate: rate,
      withholding_tax_amount: amount,
      payable_amount: payable,
      withholding_tax_calculated: calculated,
    };
  });

  const calculatedComponents = normalizedComponents.filter(
    (component) => component.withholding_tax_calculated === true,
  );
  const hasCalculatedWithholding = calculatedComponents.length > 0;

  let calculatedTotalPph: number | null = null;
  let calculatedPayable: number | null = null;
  let calculatedBase: number | null = null;
  let calculatedDpp: number | null = null;
  let calculatedPpn: number | null = null;
  let calculatedGross: number | null = null;
  if (hasCalculatedWithholding) {
    const allAmountsKnown = normalizedComponents.every(
      (component) => asNumber(component.withholding_tax_amount) != null,
    );
    const allPayablesKnown = normalizedComponents.every(
      (component) => asNumber(component.payable_amount) != null,
    );
    if (allAmountsKnown) {
      calculatedTotalPph = normalizedComponents.reduce(
        (sum, component) => sum + (asNumber(component.withholding_tax_amount) ?? 0),
        0,
      );
    }
    if (allPayablesKnown) {
      calculatedPayable = normalizedComponents.reduce(
        (sum, component) => sum + (asNumber(component.payable_amount) ?? 0),
        0,
      );
    }
    calculatedBase = normalizedComponents.reduce((sum, component) => {
      const rate = asNumber(component.withholding_tax_rate);
      const dpp = asNumber(component["dpp"]);
      return sum + (rate != null && rate > 0 && dpp != null ? dpp : 0);
    }, 0);
    if (vendorPolicy) {
      const financialValues = normalizedComponents.map((component) => [
        asNumber(component.dpp),
        asNumber(component.ppn),
        asNumber(component.gross),
      ]);
      if (financialValues.every((values) => values.every((value) => value != null))) {
        calculatedDpp = financialValues.reduce((sum, values) => sum + (values[0] ?? 0), 0);
        calculatedPpn = financialValues.reduce((sum, values) => sum + (values[1] ?? 0), 0);
        calculatedGross = financialValues.reduce((sum, values) => sum + (values[2] ?? 0), 0);
      }
    }
    flags.push(
      vendorPolicy
        ? "CALCULATED: PPh = DPP × tarif vendor; PPN = DPP × 11%; pembayaran = bruto − PPh."
        : "CALCULATED: PPh dihitung dari DPP/NET per komponen dikali tarif PPh yang tercetak.",
    );
  }

  const types = Array.from(new Set(
    normalizedComponents
      .map((component) => asText(component.withholding_tax_type))
      .filter((value): value is string => value != null),
  ));
  const rates = Array.from(new Set(
    normalizedComponents
      .map((component) => asNumber(component.withholding_tax_rate))
      .filter((value): value is number => value != null && value > 0),
  ));

  const normalizedWithholding = {
    ...withholding,
    type: types.length > 0 ? types.join(" + ") : asText(withholding.type),
    rate: rates.length === 1 ? rates[0] : null,
    amount: calculatedTotalPph ?? asNumber(withholding.amount),
    base_amount: calculatedBase ?? asNumber(withholding.base_amount),
    calculation_method: hasCalculatedWithholding
      ? vendorPolicy ? "calculated_from_vendor_policy" : "calculated_from_printed_rate"
      : asText(withholding.calculation_method),
    evidence: hasCalculatedWithholding
      ? vendorPolicy
        ? "Kebijakan pajak vendor PT Angkasa Pura Indonesia; nominal dihitung dari DPP."
        : "Tarif PPh tercetak; nominal dihitung dari NET/DPP per komponen."
      : asText(withholding.evidence),
  };

  return {
    components: normalizedComponents,
    withholding: normalizedWithholding,
    totals: {
      ...totals,
      dpp: calculatedDpp ?? asNumber(totals.dpp),
      ppn: calculatedPpn ?? asNumber(totals.ppn),
      gross: calculatedGross ?? asNumber(totals.gross),
      withholding_tax_amount:
        calculatedTotalPph ?? asNumber(totals.withholding_tax_amount),
      payable_amount: calculatedPayable ?? asNumber(totals.payable_amount),
    },
    flags,
    vendorPolicyApplied: vendorPolicy?.name ?? null,
  };
}

export function recalculateVendorInvoiceBreakdown(
  invoiceBreakdown: unknown,
  vendorName: string,
): WithholdingCalculationResult | null {
  if (!invoiceBreakdown || typeof invoiceBreakdown !== "object" || Array.isArray(invoiceBreakdown)) {
    return null;
  }
  const breakdown = invoiceBreakdown as Record<string, unknown>;
  const components = Array.isArray(breakdown.components)
    ? breakdown.components.filter(
        (component): component is Record<string, unknown> =>
          Boolean(component && typeof component === "object" && !Array.isArray(component)),
      )
    : [];
  const withholding =
    breakdown.withholding_tax &&
    typeof breakdown.withholding_tax === "object" &&
    !Array.isArray(breakdown.withholding_tax)
      ? breakdown.withholding_tax as Record<string, unknown>
      : {};
  const totals =
    breakdown.totals &&
    typeof breakdown.totals === "object" &&
    !Array.isArray(breakdown.totals)
      ? breakdown.totals as Record<string, unknown>
      : {};
  return applyWithholdingCalculations(components, withholding, totals, "", vendorName);
}
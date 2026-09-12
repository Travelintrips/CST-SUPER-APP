/**
 * INVOICE TAX ENGINE — SAP-Level, Audit-Compliant
 *
 * Pure computation module — zero DB calls, no side effects.
 * Safe to call from OCR post-processing, API routes, or unit tests.
 *
 * Follows the 5-step pipeline:
 *  1. NORMALIZATION   — derive missing fields from known ones
 *  2. CLASSIFICATION  — determine tax type from country / rate hint / context
 *  3. RECONCILIATION  — check NET + VAT = GROSS within tolerance
 *  4. SAP MAPPING     — map each amount to its GL account bucket
 *  5. AUDIT OUTPUT    — return structured, flag-annotated result
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * How VAT was sourced on this invoice.
 *
 *  HEADER       — taken directly from invoice header field (subtotal/tax/total_amount row)
 *  ITEMS        — summed from per-line VAT amounts
 *  HEADER_WINS  — header_vat overrode a conflicting items_vat_sum
 *  FALLBACK     — items VAT was 0; header_vat used as fallback (FIX 4)
 *  DERIVED      — back-computed from gross and net
 *  INPUT        — passed directly as `vat` with no header/items context
 */
export type VatSource =
  | "HEADER"
  | "ITEMS"
  | "HEADER_WINS"
  | "FALLBACK"
  | "DERIVED"
  | "INPUT";

export interface InvoiceTaxInput {
  /** NET / DPP — taxable base (pre-tax) */
  net: number | null;
  /**
   * VAT / PPN — used when header_vat and items_vat_sum are both absent.
   * Prefer populating header_vat / items_vat_sum instead.
   */
  vat: number | null;
  /** GROSS / TOTAL — final invoice amount */
  gross: number | null;
  /** Override the effective tax rate (percentage, e.g. 11 for 11%) */
  tax_rate_hint: number | null;
  /** ISO 4217 currency code */
  currency: string;
  /** ISO 3166-1 alpha-2 country of vendor, e.g. "ID", "SG", "US" */
  vendor_country: string | null;

  // ── Header-vs-Items VAT resolution (FIX 1 / 2 / 3 / 4) ───────────────────

  /**
   * FIX 1 — Explicit VAT from the invoice header section
   * (the "PPN / Tax" line that appears after subtotal and before grand total).
   * This ALWAYS takes precedence over summing per-line VAT.
   */
  header_vat: number | null;

  /**
   * Sum of per-line VAT amounts extracted from line_items[].tax.
   * Only used when header_vat is absent or zero.
   */
  items_vat_sum: number | null;

  /**
   * FIX 2 / 3 — When true, the engine forces HEADER TAX MODE:
   * it will never fall back to items_vat_sum and will always use header_vat.
   *
   * Auto-detected from the Angkasa Pura pattern:
   *   invoice has explicit subtotal (NET) + tax (VAT) + total_amount (GROSS)
   *   all at the header level → has_header_tax = true.
   */
  has_header_tax: boolean;
}

export type TaxClassification =
  | "PPN_INPUT"       // Indonesian VAT — purchase / input
  | "VAT_INPUT"       // Foreign VAT — purchase
  | "NONE"            // Explicitly zero-rated or no tax
  | "UNKNOWN";        // Insufficient signals

export interface SapAccountMapping {
  /** GL bucket for the taxable base — Expense / Asset account */
  net_account: "EXPENSE" | "ASSET" | "REVENUE";
  /** GL bucket for tax — VAT Input / VAT Payable */
  vat_account: "VAT_INPUT" | "VAT_PAYABLE" | "NONE";
  /** GL bucket controlling the full invoice liability */
  gross_account: "INVOICE_CONTROL";
}

export interface InvoiceTaxResult {
  /** Resolved tax classification */
  tax_type: TaxClassification;
  /** Effective tax rate applied (percentage) */
  effective_rate: number;
  /**
   * Which tax mode was active.
   *  HEADER_ONLY — FIX 1: has_header_tax=true; header VAT locked, item tax forced to 0,
   *                grand_total taken from header.gross directly (never re-derived)
   *  HEADER      — engine used header_vat; items absent/ignored
   *  ITEMS       — engine used summed per-line VAT
   *  MIXED       — fallback path (neither header_vat nor items_vat_sum was available)
   */
  tax_mode: "HEADER_ONLY" | "HEADER" | "ITEMS" | "MIXED";
  /** Which source the final VAT value came from (for audit trail) */
  vat_source: VatSource;
  /** DPP — net taxable base (rounded rupiah) */
  dpp: number;
  /** VAT / PPN amount (rounded rupiah) */
  vat: number;
  /** Gross / total invoice amount */
  gross: number;
  /** Validation results */
  validation: {
    is_balanced: boolean;
    /** gross − (dpp + vat); 0 = perfect; ± tolerance = acceptable */
    difference: number;
    tolerance: number;
  };
  /** SAP GL account mapping */
  sap_mapping: SapAccountMapping;
  /** Human-readable audit flags */
  flags: string[];
  /**
   * Confidence in the output: 1.0 = all three values were consistent;
   * lower when fields were derived or mismatch detected
   */
  confidence: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rupiah rounding tolerance — 1–100 IDR acceptable per SAP FI standard */
const IDR_TOLERANCE = 100;
const USD_TOLERANCE = 0.01;
const DEFAULT_TOLERANCE = 100;

/** Countries where Indonesian PPN rules apply */
const INDONESIA_COUNTRIES = new Set(["ID", "IDN", "INDONESIA"]);

/** Default Indonesian PPN rates (%) */
const PPN_RATES = [11, 12, 10]; // 11% standard, 12% new rate, 10% legacy

// ─── Step 0 — VAT Source Resolution (FIX 1 / 2 / 3 / 4) ─────────────────────

interface VatResolved {
  vat: number | null;
  source: VatSource;
  tax_mode: "HEADER_ONLY" | "HEADER" | "ITEMS" | "MIXED";
  flags: string[];
}

/**
 * Determines the canonical VAT amount before normalization runs.
 *
 * Priority chain (mutually-exclusive, top-to-bottom):
 *
 *  1. has_header_tax = true  [FIX 2/3 — Angkasa Pura forced HEADER mode]
 *       header_vat present  →  use header_vat; items ignored forever
 *       header_vat absent   →  FAIL CLOSED (vat=null + blocking flag); do NOT fall through
 *
 *  2. header_vat > 0  [FIX 1 — header always beats items]
 *       items_vat_sum conflict?  →  HEADER_WINS + flag
 *       no conflict              →  HEADER
 *
 *       NOTE: FIX 4 ("if vat===0 && headerVatExists, use headerVat") is implicitly
 *       satisfied here. If items_vat_sum=0 but header_vat>0, step 2 returns header_vat
 *       before step 3 is ever evaluated. No separate code path is needed.
 *
 *  3. items_vat_sum > 0  →  ITEMS
 *
 *  4. raw input.vat  →  INPUT (legacy / standalone /tax-validate call)
 */
function resolveVatSource(input: InvoiceTaxInput): VatResolved {
  const flags: string[] = [];

  const hv  = isPresent(input.header_vat)    ? input.header_vat    : null;
  const ivs = isPresent(input.items_vat_sum) ? input.items_vat_sum : null;

  // ── Step 1: FIX 1 — HEADER_ONLY mode locked when has_header_tax=true ────────
  // Grand total will be taken from input.gross directly (FIX 3).
  // Item tax total is forced to 0 (FIX 2).
  if (input.has_header_tax === true) {
    if (hv !== null) {
      flags.push(
        `TAX_MODE=HEADER_ONLY: Invoice has explicit header-level NET+VAT+GROSS layout. ` +
        `Using header_vat=${hv}; per-line VAT forced to 0; grand_total = header.gross.`,
      );
      // FIX 4 — ANTI DOUBLE TAX: flag if item-level tax is also present
      if (ivs !== null && ivs > 0) {
        flags.push(
          `POTENTIAL_DOUBLE_TAX: header_vat=${hv} is set AND items_vat_sum=${ivs} > 0. ` +
          `HEADER_ONLY mode forces item tax to 0 to prevent double-counting. ` +
          `Review line items — tax may be captured at both header and line level.`,
        );
      }
      return { vat: hv, source: "HEADER", tax_mode: "HEADER_ONLY", flags };
    }
    // Fail closed — has_header_tax=true but no header_vat is a hard contradiction.
    flags.push(
      "FATAL_HEADER_VAT_MISSING: has_header_tax=true but header_vat is absent. " +
      "Cannot determine VAT for HEADER_ONLY invoice — ERP posting blocked. " +
      "Verify OCR extraction returned a 'tax' value from the invoice summary section.",
    );
    return { vat: null, source: "INPUT", tax_mode: "HEADER_ONLY", flags };
  }

  // ── Step 2: header_vat wins over item sum (FIX 1) ─────────────────────────
  if (hv !== null && hv > 0) {
    if (ivs !== null && ivs !== hv) {
      flags.push(
        `VAT_SOURCE_CONFLICT: header_vat(${hv}) ≠ items_vat_sum(${ivs}). ` +
        `header_vat wins per SAP invoice-level tax rule. Reconcile line items if needed.`,
      );
      return { vat: hv, source: "HEADER_WINS", tax_mode: "HEADER", flags };
    }
    return { vat: hv, source: "HEADER", tax_mode: "HEADER", flags };
  }

  // ── Step 3: items_vat_sum when positive ────────────────────────────────────
  if (ivs !== null && ivs > 0) {
    return { vat: ivs, source: "ITEMS", tax_mode: "ITEMS", flags };
  }

  // ── Step 4: raw vat field (legacy / standalone /tax-validate call) ─────────
  const rawVat = isPresent(input.vat) ? input.vat : null;
  return { vat: rawVat, source: "INPUT", tax_mode: "MIXED", flags };
}

// ─── Step 1 — Normalization ───────────────────────────────────────────────────

interface Normalized {
  net: number | null;
  vat: number | null;
  gross: number | null;
  derivedFields: string[];
}

/** A field is "present" when it is a finite number (0 is a valid invoice amount). */
function isPresent(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v);
}

function normalize(input: InvoiceTaxInput, effectiveRate: number): Normalized {
  let { net, vat, gross } = input;
  const derived: string[] = [];

  // Replace any non-finite values (NaN, Infinity) with null so downstream is clean
  if (!isPresent(net))   net   = null;
  if (!isPresent(vat))   vat   = null;
  if (!isPresent(gross)) gross = null;

  const hasNet   = net   != null;  // 0 is valid (zero-value net e.g. credit memo)
  const hasVat   = vat   != null;  // 0 is valid (zero-rated PPN)
  const hasGross = gross != null;

  // All three present — accept as-is, reconciliation will flag mismatches
  if (hasNet && hasVat && hasGross) {
    return { net, vat, gross, derivedFields: [] };
  }

  // Only gross — derive net and vat from rate
  if (!hasNet && !hasVat && hasGross) {
    if (effectiveRate > 0) {
      // gross = net × (1 + rate/100)  →  net = gross / (1 + rate/100)
      const rateDecimal = effectiveRate / 100;
      net = Math.round(gross! / (1 + rateDecimal));
      vat = gross! - net;
      // DPP_BACK_CALCULATED: DPP dihitung balik dari gross, bukan diambil dari
      // data asli transaksi. Ini risiko audit DJP — jika tarif berubah atau
      // pembulatan berbeda, DPP yang dilaporkan bisa tidak sesuai faktur.
      // Pastikan sistem sumber menyimpan DPP (net/subtotal) secara eksplisit.
      derived.push("DPP_BACK_CALCULATED: NET (DPP) diturunkan dari GROSS dengan tarif efektif — simpan DPP asli dari sumber transaksi untuk kepatuhan DJP");
      derived.push("VAT derived from GROSS using effective rate");
    } else {
      // No rate — assume zero-rated, net = gross
      net = gross!;
      vat = 0;
      derived.push("NET set equal to GROSS (zero-rate assumed; no tax_rate_hint)");
      derived.push("VAT set to 0 (zero-rate assumed)");
    }
    return { net, vat, gross, derivedFields: derived };
  }

  // NET + VAT present, no gross — compute gross
  if (hasNet && hasVat && !hasGross) {
    gross = net! + vat!;
    derived.push("GROSS computed as NET + VAT");
    return { net, vat, gross, derivedFields: derived };
  }

  // NET only — derive VAT and gross from rate
  if (hasNet && !hasVat && !hasGross) {
    if (effectiveRate > 0) {
      vat   = Math.round(net! * (effectiveRate / 100));
      gross = net! + vat;
      derived.push("VAT derived from NET using effective rate");
      derived.push("GROSS computed as NET + VAT");
    } else {
      vat   = 0;
      gross = net!;
      derived.push("VAT set to 0 (no tax_rate_hint; zero-rate assumed)");
      derived.push("GROSS set equal to NET");
    }
    return { net, vat, gross, derivedFields: derived };
  }

  // NET + GROSS, no VAT — back-compute VAT
  if (hasNet && !hasVat && hasGross) {
    const backVat = gross! - net!;
    if (backVat < 0) {
      // gross < net is impossible on a normal invoice — flag and clamp to 0
      derived.push(
        `IMPOSSIBLE_VAT: GROSS(${gross}) < NET(${net}); derived VAT would be negative. ` +
        `VAT clamped to 0. Review source invoice for label swap or data error.`,
      );
      vat = 0;
    } else {
      vat = backVat;
      derived.push("VAT back-computed as GROSS − NET");
    }
    return { net, vat, gross, derivedFields: derived };
  }

  // VAT + GROSS, no NET — back-compute net
  if (!hasNet && hasVat && hasGross) {
    net = gross! - vat!;
    if (net < 0) {
      derived.push(
        `IMPOSSIBLE_NET: GROSS(${gross}) < VAT(${vat}); derived NET would be negative. ` +
        `Review source invoice — VAT cannot exceed gross amount.`,
      );
    } else {
      derived.push("NET back-computed as GROSS − VAT");
    }
    return { net, vat, gross, derivedFields: derived };
  }

  // Minimal data — cannot derive anything reliable
  return { net, vat, gross, derivedFields: ["INSUFFICIENT_DATA: Cannot normalize; provide at least two of net/vat/gross"] };
}

// ─── Step 2 — Tax Classification ─────────────────────────────────────────────

/**
 * Classification is driven by BOTH the effective rate AND the resolved VAT amount.
 * A zero effective rate alone is not enough to declare NONE — a non-zero resolved
 * VAT amount overrides it (e.g., rate hint was missing but VAT was back-computed).
 * Similarly, a non-zero rate with an explicitly resolved VAT of 0 means zero-rated.
 */
function classify(
  input: InvoiceTaxInput,
  effectiveRate: number,
  resolvedVat: number | null,
): { tax_type: TaxClassification; sap_mapping: SapAccountMapping; flags: string[] } {
  const flags: string[] = [];
  const country = (input.vendor_country ?? "").toUpperCase().trim();
  const isIndonesia = INDONESIA_COUNTRIES.has(country) || country === "";

  // Determine whether tax is effectively zero from both rate and resolved amount
  const vatIsZero   = resolvedVat != null && resolvedVat === 0;
  const vatNonZero  = resolvedVat != null && resolvedVat > 0;
  const isZeroRated = effectiveRate === 0 || (vatIsZero && !vatNonZero);

  let tax_type: TaxClassification;

  if (isZeroRated) {
    tax_type = "NONE";
    if (effectiveRate > 0 && vatIsZero) {
      // Rate says taxable but resolved VAT is 0 — flag the contradiction
      flags.push(
        `ZERO_VAT_NONZERO_RATE: tax_rate_hint=${effectiveRate}% but resolved VAT=0. ` +
        `Classified as NONE (zero-rated). Confirm invoice is genuinely VAT-exempt.`,
      );
    }
  } else if (isIndonesia) {
    tax_type = "PPN_INPUT";
    if (!PPN_RATES.includes(effectiveRate)) {
      flags.push(`NONSTANDARD_RATE: ${effectiveRate}% is not a standard Indonesian PPN rate (10/11/12%)`);
    }
    if (country === "") {
      flags.push("VENDOR_COUNTRY_ASSUMED: No vendor_country provided — defaulting to Indonesia (PPN rules)");
    }
  } else {
    tax_type = "VAT_INPUT";
    flags.push(`FOREIGN_INVOICE: vendor_country=${country}; applying foreign VAT treatment`);
  }

  const sap_mapping: SapAccountMapping = {
    net_account:   "EXPENSE",
    vat_account:   tax_type === "NONE" ? "NONE" : "VAT_INPUT",
    gross_account: "INVOICE_CONTROL",
  };

  return { tax_type, sap_mapping, flags };
}

// ─── Step 3 — Reconciliation ─────────────────────────────────────────────────

function reconcile(
  net: number,
  vat: number,
  gross: number,
  currency: string,
  effectiveRate: number,
): { is_balanced: boolean; difference: number; tolerance: number; flags: string[] } {
  const flags: string[] = [];

  // Pick tolerance by currency
  const cur = (currency ?? "IDR").toUpperCase();
  let tolerance = cur === "USD" ? USD_TOLERANCE : cur === "IDR" ? IDR_TOLERANCE : DEFAULT_TOLERANCE;
  // Scale non-IDR tolerance to at least 1 unit
  if (tolerance < 1 && cur !== "USD") tolerance = 1;

  const expectedGross = net + vat;
  const difference    = Math.round((gross - expectedGross) * 100) / 100;
  const is_balanced   = Math.abs(difference) <= tolerance;

  if (!is_balanced) {
    flags.push(
      `TAX_MISMATCH: NET(${net}) + VAT(${vat}) = ${expectedGross}, ` +
      `but GROSS = ${gross}. Difference = ${difference} (tolerance ±${tolerance})`,
    );
  }

  // Additional sanity checks — do NOT correct, only flag
  if (vat > 0 && net > 0) {
    const impliedRate = Math.round((vat / net) * 1000) / 10; // one decimal
    const rateDiff    = Math.abs(impliedRate - effectiveRate);
    if (effectiveRate > 0 && rateDiff > 1.5) {
      flags.push(
        `RATE_DRIFT: Implied rate from values = ${impliedRate}%, ` +
        `expected ${effectiveRate}%. Difference = ${rateDiff.toFixed(1)}pp`,
      );
    }
  }

  if (vat > net) {
    flags.push(`VAT_EXCEEDS_NET: VAT(${vat}) > NET(${net}) — likely a DPP/PPN label swap on the invoice`);
  }

  if (vat > gross * 0.5) {
    flags.push(`VAT_EXCEEDS_HALF_GROSS: VAT(${vat}) > 50% of GROSS(${gross}) — review invoice labels`);
  }

  return { is_balanced, difference, tolerance, flags };
}

// ─── Step 4+5 — Engine Entry Point ───────────────────────────────────────────

export function runInvoiceTaxEngine(input: InvoiceTaxInput): InvoiceTaxResult {
  const allFlags: string[] = [];

  // ── Step 0: Resolve VAT source (FIX 1/2/3/4) ───────────────────────────────
  const { vat: resolvedVat, source: vatSource, tax_mode, flags: vatFlags } = resolveVatSource(input);
  allFlags.push(...vatFlags);

  // FIX 2 — DISABLE ITEM TAX TOTAL in HEADER_ONLY mode.
  // In HEADER_ONLY, item-level tax is explicitly zeroed out to prevent
  // double-counting. In all other modes, items_vat_sum passes through normally.
  const itemTaxTotal: number | null =
    tax_mode === "HEADER_ONLY"
      ? 0
      : (isPresent(input.items_vat_sum) ? input.items_vat_sum : null);

  // Build a normalized input where `vat` is already resolved and items tax is guarded
  const resolvedInput: InvoiceTaxInput = {
    ...input,
    vat: resolvedVat,
    items_vat_sum: itemTaxTotal,
  };

  // ── Resolve effective rate ──────────────────────────────────────────────────
  let effectiveRate: number;

  if (input.tax_rate_hint != null && input.tax_rate_hint >= 0) {
    effectiveRate = input.tax_rate_hint;
  } else {
    // Default to 11% PPN for Indonesia, 0 for fully foreign with no hint
    const country = (input.vendor_country ?? "").toUpperCase().trim();
    effectiveRate = INDONESIA_COUNTRIES.has(country) || country === "" ? 11 : 0;
    if (effectiveRate === 0 && country !== "") {
      allFlags.push("RATE_UNKNOWN: Foreign invoice with no tax_rate_hint — VAT set to 0 unless derivable");
    }
  }

  // ── Step 1: Normalize ───────────────────────────────────────────────────────
  const { net, vat, gross: normalizedGross, derivedFields } = normalize(resolvedInput, effectiveRate);
  allFlags.push(...derivedFields);

  // FIX 3 — GRAND TOTAL RULE (WAJIB):
  // In HEADER_ONLY mode the grand total MUST come from header.gross (input.gross)
  // directly — never re-derived as subtotal + item_tax, which would ignore any
  // rounding or header-level adjustments printed on the invoice.
  const gross: number | null =
    tax_mode === "HEADER_ONLY" && isPresent(input.gross)
      ? input.gross
      : normalizedGross;

  // Guard — if still null, we cannot proceed
  if (net == null || vat == null || gross == null) {
    return {
      tax_type:       "UNKNOWN",
      effective_rate: effectiveRate,
      tax_mode,
      vat_source:     vatSource,
      dpp:            0,
      vat:            0,
      gross:          0,
      validation:     { is_balanced: false, difference: 0, tolerance: IDR_TOLERANCE },
      sap_mapping:    { net_account: "EXPENSE", vat_account: "NONE", gross_account: "INVOICE_CONTROL" },
      flags:          [...allFlags, "FATAL: Could not resolve net/vat/gross from input — ERP posting blocked"],
      confidence:     0,
    };
  }

  // ── Step 2: Classify ────────────────────────────────────────────────────────
  // Pass the resolved VAT so classification accounts for back-computed zero-VAT
  const { tax_type, sap_mapping, flags: classFlags } = classify(resolvedInput, effectiveRate, vat);
  allFlags.push(...classFlags);

  // ── Step 3: Reconcile ───────────────────────────────────────────────────────
  const { is_balanced, difference, tolerance, flags: reconFlags } = reconcile(
    net, vat, gross, input.currency ?? "IDR", effectiveRate,
  );
  allFlags.push(...reconFlags);

  // ── Confidence score ────────────────────────────────────────────────────────
  // Start at 1.0, deduct per issue
  let confidence = 1.0;
  if (derivedFields.length > 0)                              confidence -= 0.15 * Math.min(derivedFields.length, 2);
  if (!is_balanced)                                          confidence -= 0.3;
  if (allFlags.some(f => f.startsWith("DPP_BACK_CALCULATED"))) confidence -= 0.25; // risiko audit DJP
  if (allFlags.some(f => f.startsWith("VAT_EXCEEDS")))      confidence -= 0.2;
  if (allFlags.some(f => f.startsWith("RATE_DRIFT")))       confidence -= 0.1;
  if (allFlags.some(f => f.startsWith("VENDOR_COUNTRY")))   confidence -= 0.05;
  if (allFlags.some(f => f.startsWith("VAT_SOURCE_CONFL"))) confidence -= 0.1;
  confidence = Math.max(0, Math.round(confidence * 100) / 100);

  return {
    tax_type,
    effective_rate: effectiveRate,
    tax_mode,
    vat_source:     vatSource,
    dpp:   net,
    vat,
    gross,
    validation: { is_balanced, difference, tolerance },
    sap_mapping,
    flags:      allFlags,
    confidence,
  };
}

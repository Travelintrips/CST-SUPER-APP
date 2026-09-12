/**
 * SAP-LEVEL ENTERPRISE TAX ENGINE — Spec v1
 *
 * Strict extraction-and-validation only.
 * NEVER performs arithmetic. NEVER derives missing values.
 * NEVER overrides invoice values. Header is always the source of truth.
 *
 * Implements the exact pipeline from the spec file:
 *  STEP 0 — Tax Mode Detection   (HEADER_TAX_ONLY if NET/DPP, VAT/PPN, or GROSS/TOTAL present)
 *  STEP 1 — Field Extraction     (header-only; pass-through of already-extracted OCR values)
 *  STEP 2 — Tax Classification   (PPN if vat present, NONE otherwise; no inference)
 *  STEP 3 — Validation Engine    (compute expected_gross = net + vat; flag if diff > 100; never fix)
 *  STEP 4 — Strict JSON Output   (exact spec format)
 *
 * Purpose: Accounting Journal Posting, PPN/VAT Reporting, Audit Compliance (SAP standard)
 */

// ─── Input ────────────────────────────────────────────────────────────────────

/**
 * Values extracted from the invoice header by OCR / AI.
 * All fields are as-read from the invoice — never recalculated.
 */
export interface SapTaxInput {
  vendor_name:    string | null;
  invoice_number: string | null;
  invoice_date:   string | null;
  currency:       string | null;

  /** NET / DPP — taxable base read from invoice header */
  net:   number | null;
  /** VAT / PPN — tax amount read from invoice header */
  vat:   number | null;
  /** GROSS / TOTAL — grand total read from invoice header */
  gross: number | null;

  /**
   * Evidence-normalization notes generated before the strict engine runs.
   * The engine never invents values; this records when explicit invoice
   * breakdown evidence was selected over an incomplete header extraction.
   */
  normalizationFlags?: string[];
}

// ─── Output ───────────────────────────────────────────────────────────────────

export type SapTaxMode = "HEADER_TAX_ONLY" | "NO_HEADER_TAX";
export type SapTaxType = "PPN" | "NONE";

export interface SapTaxResult {
  /** Whether this invoice carries explicit header-level tax fields */
  tax_mode: SapTaxMode;

  invoice: {
    vendor_name:    string | null;
    invoice_number: string | null;
    invoice_date:   string | null;
    currency:       string | null;
  };

  tax: {
    /** PPN if vat field is present and non-null; NONE otherwise */
    type:  SapTaxType;
    net:   number | null;
    vat:   number | null;
    gross: number | null;
  };

  validation: {
    /** true if |gross − (net + vat)| ≤ MISMATCH_THRESHOLD, or if any of net/vat/gross is null */
    is_valid:   boolean;
    /** gross − (net + vat); 0 when any field is null (cannot compute) */
    difference: number;
  };

  /** Audit flags — diagnostic strings; never causes automatic correction */
  flags: string[];

  /**
   * Confidence: 1.0 = all three fields present and balanced.
   * Deducted per missing field and per flag.
   */
  confidence: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Tolerance per SAP FI standard (IDR): differences within ±100 are acceptable */
const MISMATCH_THRESHOLD = 100;

/** Deduction per missing header field */
const CONFIDENCE_MISSING_FIELD = 0.15;

/** Deduction for TAX_MISMATCH flag */
const CONFIDENCE_MISMATCH = 0.30;

/** Deduction for any other warning flag */
const CONFIDENCE_FLAG = 0.05;

// ─── Engine ───────────────────────────────────────────────────────────────────

/**
 * Run the SAP Enterprise Tax Engine on pre-extracted invoice header values.
 *
 * This function is PURELY a classification and validation layer.
 * It does NOT call external services, does NOT touch the database,
 * does NOT fix values, and does NOT infer missing fields.
 */
export function runSapTaxEngine(input: SapTaxInput): SapTaxResult {
  const flags: string[] = [...(input.normalizationFlags ?? [])];

  // ── STEP 0: Tax Mode Detection ─────────────────────────────────────────────
  // HEADER_TAX_ONLY if the invoice carries ANY of: NET/DPP, VAT/PPN, GROSS/TOTAL
  const hasAnyTaxField = input.net != null || input.vat != null || input.gross != null;
  const tax_mode: SapTaxMode = hasAnyTaxField ? "HEADER_TAX_ONLY" : "NO_HEADER_TAX";

  if (tax_mode === "NO_HEADER_TAX") {
    flags.push(
      "NO_HEADER_TAX: Invoice contains no NET/DPP, VAT/PPN, or GROSS/TOTAL at header level. " +
      "Cannot perform tax validation. ERP posting requires manual review.",
    );
  }

  // ── STEP 1: Field Extraction ───────────────────────────────────────────────
  // Values are taken directly from input — no computation allowed here.
  // Flag any missing critical fields for audit trail.
  if (input.net == null)   flags.push("FIELD_MISSING: net (NET/DPP) not found in invoice header");
  if (input.vat == null)   flags.push("FIELD_MISSING: vat (VAT/PPN) not found in invoice header");
  if (input.gross == null) flags.push("FIELD_MISSING: gross (GROSS/TOTAL) not found in invoice header");

  if (input.vendor_name == null)    flags.push("FIELD_MISSING: vendor_name not found");
  if (input.invoice_number == null) flags.push("FIELD_MISSING: invoice_number not found");
  if (input.invoice_date == null)   flags.push("FIELD_MISSING: invoice_date not found");
  if (input.currency == null)       flags.push("FIELD_MISSING: currency not found");

  // ── STEP 2: Tax Classification ─────────────────────────────────────────────
  // PPN if and only if vat field is present and explicitly set.
  // DO NOT infer tax if missing.
  const taxType: SapTaxType = input.vat != null ? "PPN" : "NONE";

  if (taxType === "NONE" && tax_mode === "HEADER_TAX_ONLY") {
    flags.push(
      "TAX_TYPE=NONE: VAT/PPN field is absent. " +
      "Invoice may be zero-rated or tax field was not extracted from header. " +
      "Confirm exemption before ERP posting.",
    );
  }

  // ── STEP 3: Validation Engine ──────────────────────────────────────────────
  // Compute expected_gross = net + vat.
  // Add TAX_MISMATCH flag if difference > threshold.
  // NEVER modify or correct values — only flag.
  let is_valid = true;
  let difference = 0;

  if (input.net != null && input.vat != null && input.gross != null) {
    const expectedGross = input.net + input.vat;
    difference = Math.round((input.gross - expectedGross) * 100) / 100;

    if (Math.abs(difference) > MISMATCH_THRESHOLD) {
      is_valid = false;
      flags.push(
        `TAX_MISMATCH: NET(${input.net}) + VAT(${input.vat}) = ${expectedGross}, ` +
        `but GROSS on invoice = ${input.gross}. ` +
        `Difference = ${difference} (threshold ±${MISMATCH_THRESHOLD}). ` +
        "Values NOT corrected — review source invoice before journal posting.",
      );
    }
  } else {
    // Cannot validate — one or more fields missing
    is_valid = false;
    if (input.net != null || input.vat != null || input.gross != null) {
      flags.push(
        "VALIDATION_INCOMPLETE: Cannot compute NET + VAT = GROSS check — " +
        "one or more of net/vat/gross is missing from invoice header.",
      );
    }
  }

  // ── Sanity checks (flag only, never fix) ───────────────────────────────────
  if (input.vat != null && input.net != null && input.vat > input.net) {
    flags.push(
      `VAT_EXCEEDS_NET: VAT(${input.vat}) > NET(${input.net}). ` +
      "Possible DPP/PPN label swap on the source invoice. Verify before posting.",
    );
  }

  if (input.gross != null && input.net != null && input.gross < input.net) {
    flags.push(
      `GROSS_LESS_THAN_NET: GROSS(${input.gross}) < NET(${input.net}). ` +
      "Impossible on a normal invoice — possible data extraction error or credit note.",
    );
  }

  // ── STEP 4: Confidence Score ───────────────────────────────────────────────
  let confidence = 1.0;

  // Deduct for each critical missing field
  if (input.net   == null) confidence -= CONFIDENCE_MISSING_FIELD;
  if (input.vat   == null) confidence -= CONFIDENCE_MISSING_FIELD;
  if (input.gross == null) confidence -= CONFIDENCE_MISSING_FIELD;

  // Deduct for mismatch
  if (!is_valid && difference !== 0) confidence -= CONFIDENCE_MISMATCH;

  // Deduct for other flags (sanity, missing minor fields)
  const warningFlagCount = flags.filter(f =>
    f.startsWith("VAT_EXCEEDS") ||
    f.startsWith("GROSS_LESS") ||
    f.startsWith("FIELD_MISSING: vendor") ||
    f.startsWith("FIELD_MISSING: invoice_number") ||
    f.startsWith("FIELD_MISSING: invoice_date") ||
    f.startsWith("VALIDATION_INCOMPLETE"),
  ).length;
  confidence -= warningFlagCount * CONFIDENCE_FLAG;

  confidence = Math.max(0, Math.round(confidence * 100) / 100);

  // ── STEP 4: Final Output (strict spec format) ──────────────────────────────
  return {
    tax_mode,
    invoice: {
      vendor_name:    input.vendor_name,
      invoice_number: input.invoice_number,
      invoice_date:   input.invoice_date,
      currency:       input.currency,
    },
    tax: {
      type:  taxType,
      net:   input.net,
      vat:   input.vat,
      gross: input.gross,
    },
    validation: {
      is_valid,
      difference,
    },
    flags,
    confidence,
  };
}

/**
 * Build a SapTaxInput from the raw sanitized OCR result.
 * Maps the OCR schema fields to the SAP engine's strict header fields.
 */
export function buildSapTaxInput(ocr: Record<string, unknown>): SapTaxInput {
  function toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function toStr(v: unknown): string | null {
    return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
  }

  const header = {
    vendor_name:    toStr(ocr.vendor_name),
    invoice_number: toStr(ocr.invoice_number),
    invoice_date:   toStr(ocr.invoice_date),
    currency:       toStr(ocr.currency),
    net:            toNum(ocr.subtotal),     // subtotal = DPP/NET
    vat:            toNum(ocr.tax),          // tax = PPN/VAT
    gross:          toNum(ocr.total_amount), // total_amount = GROSS
  };

  /**
   * Some Indonesian tax invoices use DPP Nilai Lain (for example 11/12 of
   * the commercial selling price). In that format the printed component
   * prices are the accounting net amount, while the header tax table carries
   * the authoritative PPN. Older OCR commonly maps the component total to
   * both subtotal and total_amount and leaves tax at zero.
   *
   * Only use this repair when the evidence is explicit and independently
   * consistent: a positive breakdown PPN, complete component gross values,
   * and component gross total matching the extracted commercial total.
   * Otherwise preserve the strict header-only values and let review block
   * posting.
   */
  const rawBreakdown = ocr.invoice_breakdown;
  const breakdown = rawBreakdown && typeof rawBreakdown === "object" && !Array.isArray(rawBreakdown)
    ? rawBreakdown as Record<string, unknown>
    : null;
  const rawTotals = breakdown?.totals;
  const totals = rawTotals && typeof rawTotals === "object" && !Array.isArray(rawTotals)
    ? rawTotals as Record<string, unknown>
    : null;
  const rawComponents = breakdown?.components;
  const components = Array.isArray(rawComponents)
    ? rawComponents.filter((component): component is Record<string, unknown> =>
        Boolean(component && typeof component === "object" && !Array.isArray(component)),
      )
    : [];
  const breakdownVat = toNum(totals?.ppn);
  const componentGrossValues = components.map((component) => toNum(component.gross));
  const componentGrossTotal = componentGrossValues.every((value) => value != null) && componentGrossValues.length > 0
    ? componentGrossValues.reduce((sum, value) => sum + (value ?? 0), 0)
    : null;
  const topLevelCommercialTotal = header.gross ?? header.net;
  const headerHasDroppedTax =
    (header.vat == null || header.vat <= 0) &&
    header.net != null &&
    header.gross != null &&
    Math.abs(header.net - header.gross) <= 100;
  const breakdownMatchesCommercialTotal =
    componentGrossTotal != null &&
    topLevelCommercialTotal != null &&
    Math.abs(componentGrossTotal - topLevelCommercialTotal) <= 100;

  if (
    headerHasDroppedTax &&
    breakdownVat != null &&
    breakdownVat > 0 &&
    breakdownMatchesCommercialTotal
  ) {
    const normalizedNet = Math.round(componentGrossTotal! * 100) / 100;
    const normalizedGross = Math.round((normalizedNet + breakdownVat) * 100) / 100;
    return {
      ...header,
      net: normalizedNet,
      vat: breakdownVat,
      gross: normalizedGross,
      normalizationFlags: [
        `TAX_RESOLVED_FROM_BREAKDOWN: explicit invoice_breakdown PPN ${breakdownVat} was recovered after header tax extraction returned zero.`,
      ],
    };
  }

  return header;
}
